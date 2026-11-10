"""Every plugin works for every member on every brain, through the real listing and the real execution.

Live, a member asked to read the owner's mail searched Composio seven times and never executed
anything: the tool that executes what Composio discovers shares no word with any request, so a list
narrowed by the request's words never offered it. Composio's router is the core's own (pinned) and
always listed. Every other tool of a connection is found with find_tools and called with use_tool
(owner, 2026-11-09, decision 2): a subscription CLI reads its tool list once, when it starts, and the
list never changes, so it calls what it found without starting again.

These tests send a request through the ordinary turn, for Raphael and for a member, to an API model
(a scripted fake) and to a CLI (a fake process that reads and calls the MCP server like the real
ones), against a fake Composio router and fake MCP servers. They see what the model was offered and
what reached the servers.
"""

import json
from types import SimpleNamespace

import httpx
import pytest
from mcp.server.mcpserver import MCPServer
from mcp_types import ToolAnnotations

from agent.conftest import FakeActions
from agent.test_narration import chat
from agent.test_plugins import Plugins
from agent.test_service import Rig
from integrations import fake_server
from raphael_core.agent.plugins import MAX_OFFERED
from raphael_core.agent.policy import Tier
from raphael_core.agent.speaker import RAPHAEL, Speaker
from raphael_core.background.snapshot import take_snapshot
from raphael_core.connectors.service import META_EXECUTE, ConnectorsService
from test_connectors import Platform

from .test_answering import Team, client, live_said, member, typed  # noqa: F401
from .test_cli_brains import fake_brain

READ, WRITE, DELETE = "GMAIL_FETCH_EMAILS", "GMAIL_SEND_EMAIL", "GMAIL_DELETE_MESSAGE"
ENVELOPE = {"tools": [{"tool_slug": READ, "arguments": {}}]}
MAIL = "read my newest mail"  # shares its words with the filler tools below, and with no router tool
LOOK = "look something up"  # names the one tool of the Notes server that the filler tools outrank


class RouterFake(Platform):
    """Composio's tool router over a mock transport: its three tools, and what was called on it."""

    def __init__(self):
        super().__init__(["ACTIVE"])
        self.called = []

    def __call__(self, request):
        if request.url.host == "app.composio.dev" and request.method == "POST":
            body = json.loads(request.content)
            if body.get("method") == "tools/list":
                self.requests.append(request)
                return self._answer(body, {"tools": [
                    {"name": "COMPOSIO_SEARCH_TOOLS", "inputSchema": {"type": "object"},
                     "description": "Discover the tools of the connected apps, such as Gmail, for a task."},
                    {"name": "COMPOSIO_GET_TOOL_SCHEMAS", "inputSchema": {"type": "object"},
                     "description": "Get the input schema of tools found by a search."},
                    {"name": META_EXECUTE, "inputSchema": {"type": "object", "required": ["tools"],
                        "properties": {"tools": {"type": "array"}, "sync_response_to_workbench": {"type": "boolean"}}},
                     "description": "Run the tools a search discovered, in parallel, with their schemas' arguments."},
                ]})
            if body.get("method") == "tools/call":
                self.requests.append(request)
                self.called.append(body["params"])
                return self._answer(body, {"content": [{"type": "text", "text": "Synthetic list of mail."}]})
        return super().__call__(request)

    @staticmethod
    def _answer(body, result):
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"], "result": result})


def archive(count):
    """An ordinary MCP server with `count` read-only tools about mail records: more than a turn is shown."""
    server = MCPServer("archive")
    for number in range(count):
        @server.tool(name=f"mail_record_{number:02d}", annotations=ToolAnnotations(read_only_hint=True),
                     description=f"Read newest mail record number {number}.")
        def record() -> str:
            return "a record"
    return server


async def no_browser(url):
    pass


async def no_wait(seconds):
    pass


@pytest.fixture(autouse=True)
def calls():
    fake_server.CALLS.clear()
    yield fake_server.CALLS
    fake_server.CALLS.clear()


@pytest.fixture
async def world(conn, tmp_path, client):  # noqa: F811
    """An assistant with a team, Gmail through the router, an ordinary server (Notes) and the archive."""
    team = Team(conn, tmp_path / "team")
    plugins = Plugins(conn, tmp_path)
    router = RouterFake()
    service = ConnectorsService(tmp_path, plugins.vault, plugins.hub, transport=httpx.MockTransport(router),
                                open_browser=no_browser, sleep=no_wait)
    service.register(plugins.rpc)
    await plugins.rpc.call("connectors.set_key", {"key": "ak_private"})
    assert (await plugins.rpc.call("connectors.connect", {"toolkit": "gmail"}))["connected"]
    await plugins.rpc.call("connectors.set_tools", {"id": "composio:gmail", "disabled_tools": [WRITE, DELETE]})
    plugins.servers.by_name["Notes"] = fake_server.build()
    plugins.servers.by_name["Archive"] = archive(MAX_OFFERED + 5)
    for name in ("Notes", "Archive"):
        added = await plugins.rpc.call("integrations.add", {"name": name, "transport": "stdio", "command": "unused"})
        identifier = added["server"]["id"]
        await plugins.rpc.call("integrations.set_enabled", {"id": identifier, "enabled": True})
        await plugins.rpc.call("integrations.refresh", {"id": identifier})
    rig = Rig(conn, client, FakeActions(), team=team.members, memory=team.memory, plugins=plugins.hub)
    yield SimpleNamespace(rig=rig, team=team, hub=plugins.hub, router=router, client=client)
    await rig.aclose()
    await team.memory.aclose()


def who(world, kind):
    """The member id a request is sent to: Raphael's, or an ordinary member's."""
    return 0 if kind == "raphael" else member(world.team, name="Helper", role="Does what it is asked").id


def names_in(tools):
    return [tool["function"]["name"] for tool in tools]


# --- what a turn is offered, whoever asks ---------------------------------------------------------------


@pytest.mark.parametrize("speaker", [RAPHAEL, Speaker(id=7), Speaker(id=7, depth=1)], ids=["raphael", "member", "asked"])
async def test_the_router_is_listed_for_everyone_and_a_connections_other_tools_are_found(world, speaker):
    """The apps connected through Composio are one door of three tools: none is ever left out."""
    assert len(world.hub.offered()) > MAX_OFFERED
    snapshot = take_snapshot(world.hub, speaker=speaker, max_tier=Tier.T3)
    listed = names_in(snapshot.definitions)
    assert {name for name in listed if name.startswith("Composio__")} == {
        f"Composio__{name}" for name in ("COMPOSIO_SEARCH_TOOLS", "COMPOSIO_GET_TOOL_SCHEMAS", META_EXECUTE)}
    assert not [name for name in listed if name.startswith(("Notes__", "Archive__"))]
    assert "Notes__look" in names_in(snapshot.find(LOOK)[0])


# --- the API path ---------------------------------------------------------------------------------------


def found_name(text, suffix):
    """The name of the tool ending with `suffix` among the definitions find_tools returned."""
    names = [json.loads(line)["name"] for line in text.splitlines() if line.startswith("{")]
    return next((name for name in names if name.endswith(suffix)), None)


def calling(suffix, arguments, offered):
    """A scripted model that calls the tool whose name ends with `suffix`: directly when it is listed, through
    use_tool when find_tools found it."""

    def turn(**kwargs):
        offered.append(names_in(kwargs["tools"]))
        target = next((name for name in names_in(kwargs["tools"]) if name.endswith(suffix)), None)
        if target:
            return chat("Working.", (target, arguments))
        found = found_name(kwargs["messages"][-1]["content"], suffix) if kwargs["messages"][-1]["role"] == "tool" else None
        return chat("Working.", ("use_tool", {"name": found, "arguments": arguments})) if found else live_said("I was not offered it.")

    return turn


@pytest.mark.parametrize("kind", ["raphael", "member"])
async def test_an_api_model_executes_a_composio_tool_for_raphael_and_a_member(world, kind):
    offered = []
    world.client.chats += [calling(META_EXECUTE, ENVELOPE, offered), live_said("Your newest mail is in.")]
    reply = await typed(world.rig, MAIL, who(world, kind), language="en")
    assert reply["status"] == "done" and "Your newest mail is in." in reply["text"]
    assert any(name.endswith(META_EXECUTE) for name in offered[0]), "the executing tool was never offered"
    assert [call["name"] for call in world.router.called] == [META_EXECUTE]
    assert world.router.called[0]["arguments"] == ENVELOPE


@pytest.mark.parametrize("kind", ["raphael", "member"])
async def test_an_api_model_finds_and_calls_an_ordinary_plugin_for_raphael_and_a_member(world, kind):
    offered = []

    def search(**kwargs):
        offered.append(names_in(kwargs["tools"]))
        assert "find_tools" in names_in(kwargs["tools"])
        return chat("Looking for it.", ("find_tools", {"query": LOOK}))

    world.client.chats += [search, calling("__look", {"topic": "tea"}, offered), live_said("Found tea.")]
    reply = await typed(world.rig, MAIL, who(world, kind), language="en")
    assert reply["status"] == "done" and "Found tea." in reply["text"]
    assert fake_server.CALLS == ["look"]
    assert len(offered) == 2 and offered[1] == offered[0], "finding and calling a tool never changes the list"


# --- the CLI path ---------------------------------------------------------------------------------------

# A fake of Claude Code: it reads the MCP server's tool list once, when it starts (as the real CLIs do), calls
# the tool it wants (directly when listed, through use_tool when find_tools found it), and ends its turn with what
# came of it. A CLI that cannot see the tool ends the turn.
CLI = '''import json, sys, time, urllib.request
from pathlib import Path
config = json.loads(Path(sys.argv[sys.argv.index("--mcp-config") + 1]).read_text())["mcpServers"]["raphael"]
json.loads(sys.stdin.readline())
number = [0]
def send(value): print(json.dumps(value), flush=True)
def rpc(method, params=None):
    number[0] += 1
    packet = {"jsonrpc": "2.0", "id": number[0], "method": method, "params": params or {}}
    request = urllib.request.Request(config["url"], data=json.dumps(packet).encode(),
                                     headers={**config["headers"], "Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(request, timeout=15))["result"]
def finish(text): send({"type": "result", "subtype": "success", "session_id": "thread-1", "result": text})
def ended(): send({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "t"}]}})
send({"type": "system", "session_id": "thread-1"})
listed = [tool["name"] for tool in rpc("tools/list")["tools"]]
log = Path(LOG)
log.write_text(json.dumps([*(json.loads(log.read_text()) if log.exists() else []), listed]))
target = next((name for name in listed if name.endswith(TARGET)), None)
result = None
if target is not None:
    result = rpc("tools/call", {"name": target, "arguments": ARGUMENTS})
elif "find_tools" in listed:
    text = rpc("tools/call", {"name": "find_tools", "arguments": {"query": FIND}})["content"][0]["text"]
    ended()
    names = [json.loads(line)["name"] for line in text.splitlines() if line.startswith("{")]
    found = next((name for name in names if name.endswith(TARGET)), None)
    if found:
        result = rpc("tools/call", {"name": "use_tool", "arguments": {"name": found, "arguments": ARGUMENTS}})
if result is None:
    finish("I was not offered it.")
else:
    ended()
    finish("The tool failed." if result.get("isError") else "Done.")
'''


def cli(world, tmp_path, target, arguments=None, find=LOOK):
    """Make every speaker's brain a CLI, a fake that calls the tool whose name ends with `target`.
    Returns what the tool lists were, one for each time the CLI started."""
    world.rig.settings.set("agent_model", "cli:claude")
    log = tmp_path / "listed.json"
    script = (CLI.replace("LOG", repr(str(log))).replace("TARGET", repr(target))
              .replace("ARGUMENTS", repr(arguments or {})).replace("FIND", repr(find)))
    fake_brain(world.rig, tmp_path, script)
    return lambda: json.loads(log.read_text()) if log.exists() else []


@pytest.mark.parametrize("kind", ["raphael", "member"])
async def test_a_cli_brain_executes_a_composio_tool_for_raphael_and_a_member(world, tmp_path, kind):
    asked = who(world, kind)
    listed = cli(world, tmp_path, META_EXECUTE, ENVELOPE)
    reply = await typed(world.rig, MAIL, asked, language="en")
    assert any(name.endswith(META_EXECUTE) for name in listed()[0]), "the executing tool was never offered"
    assert [call["name"] for call in world.router.called] == [META_EXECUTE]
    assert world.router.called[0]["arguments"] == ENVELOPE
    assert reply["status"] == "done" and "Done." in reply["text"]


@pytest.mark.parametrize("kind", ["raphael", "member"])
async def test_a_cli_brain_calls_a_tool_find_tools_found_without_starting_again(world, tmp_path, kind):
    """A CLI reads its tools when it starts; it calls what find_tools found through use_tool, in the same run."""
    asked = who(world, kind)
    listed = cli(world, tmp_path, "__look", {"topic": "tea"})
    reply = await typed(world.rig, MAIL, asked, language="en")
    [first] = listed()
    assert not any(name.endswith("__look") for name in first) and {"find_tools", "use_tool"} <= set(first)
    assert fake_server.CALLS == ["look"]
    assert reply["status"] == "done" and "Done." in reply["text"]

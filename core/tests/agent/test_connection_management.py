"""API and authenticated CLI MCP manage connections through the same production services."""

import pytest

from .test_service import make_rig  # noqa: F401
from .test_narration import chat, typed, use
from .test_service import until
from background.conftest import Rig as BackgroundRig, plugins, call, turn, report  # noqa: F401
from raphael_core.connectors.secret_cards import SecretCards


@pytest.fixture
async def wired_connections(conn, plugins, make_rig, tmp_path):
    background = BackgroundRig(conn, plugins)
    keys = SecretCards(conn, plugins.hub)
    from raphael_core.members.service import MembersService
    team = MembersService(conn, tmp_path, background=background.service)
    agent = make_rig(background=background.service, plugins=plugins.hub, gate=background.gate, secret_cards=keys, team=team)
    team.register(agent.rpc)
    agent.settings.set("worker_cost_cap_usd", 1.0)
    background.service.use_team(team, agent.service.team_tool)
    background.service.use_owner_tools(agent.service.background_owner_tool)
    yield agent, background
    await background.close()


async def test_disconnect_waits_in_private_chat_until_the_owner_says_yes(wired_connections, client, plugins):
    agent, background = wired_connections
    server = await plugins.connect(look="T1")
    agent.settings.set("action_mode", "ask")
    client.chats = [chat("Disconnect.", use("manage_connection", {"connection": server, "operation": "disconnect"})), chat("Disconnected.")]
    asked = await typed(agent, "Disconnect sample")
    assert asked["status"] == "confirm" and plugins.hub.offered()
    await agent.confirm(asked["confirm"]["id"])
    assert not plugins.hub.offered()


@pytest.mark.parametrize("mode", ["ask", "bypass"])
@pytest.mark.parametrize("tool,args", [
    ("manage_connection", {"connection": "Notes", "operation": "disable"}),
    ("add_mcp_server", {"name": "Sample", "transport": "http", "url": "https://example.invalid/mcp"}),
])
async def test_background_cannot_manage_connections_or_propose_mcp(wired_connections, plugins, mode, tool, args):
    agent, background = wired_connections
    await plugins.connect(look="T1")
    agent.settings.set("action_mode", mode)
    background.client.replies = [turn("Try management.", [call(tool, args)]), report("Unavailable.")]
    identifier = background.submit("Change connections")
    origin = agent.history.add(session_id="sample-background", question="Change connections", route="delegate", prefix="", text="", status="running", source="app",
        conversation_id=agent.service.conversations.main())
    background.service.attach_turn(identifier, origin)
    await until(lambda: background.task(identifier).state in ("done", "failed"))
    assert background.task(identifier).state == "done"
    assert plugins.hub.offered()
    assert not background.service.waiting_questions()
    for request in background.client.chat_calls:
        assert not {"manage_connection", "add_mcp_server"} & {item["function"]["name"] for item in request["tools"]}


async def test_cli_lists_and_calls_use_current_grants(wired_connections, plugins, tmp_path, monkeypatch):
    import httpx
    from raphael_core.agent.cli.discovery import CliBrains
    from raphael_core.agent.cli.drivers import Driver, Event

    agent, background = wired_connections
    server = await plugins.connect(look="T1")
    agent.settings.set("action_mode", "bypass")
    (tmp_path / ".codex").mkdir()
    (tmp_path / ".codex/auth.json").touch()
    agent.service._cli_brains = CliBrains(home=tmp_path, environ={}, commands={"codex": ["fake"]})
    agent.settings.set("agent_model", "cli:codex:test")
    attempts = []

    async def run(driver, **kwargs):
        attempts.append(len(attempts))
        async with httpx.AsyncClient(headers={"Authorization": "Bearer " + kwargs["token"]}, trust_env=False) as http:
            async def rpc(method, **params):
                return (await http.post(kwargs["endpoint"], json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params})).json()
            def use(name, arguments):
                return rpc("tools/call", name="use_tool", arguments={"name": name, "arguments": arguments})
            names = lambda response: {item["name"] for item in response["result"]["tools"]}
            # The list is fixed (decision 2): the connection's tool and the management are found and called
            # through use_tool, and the list the CLI read when it started stays right, whatever the grants do.
            listed = names(await rpc("tools/list"))
            assert "Notes__look" not in listed and {"find_tools", "use_tool"} <= listed
            assert not (await use("manage_connection", {"connection": server, "operation": "disable"}))["result"]["isError"]
            stale = await use("Notes__look", {"topic": "sample"})
            assert "error" in stale or stale["result"]["isError"]
            assert not (await use("manage_connection", {"connection": server, "operation": "enable"}))["result"]["isError"]
            assert not (await use("Notes__look", {"topic": "sample"}))["result"]["isError"]
            assert names(await rpc("tools/list")) == listed
        yield Event("final", "Sample read.")

    monkeypatch.setattr(Driver, "run", run)
    assert (await typed(agent, "Manage sample connection and read"))["status"] == "done"
    assert attempts == [0], "a grant that changes never starts the CLI again"


async def test_background_cli_observes_owner_connection_changes_without_management_tools(wired_connections, plugins, monkeypatch):
    from raphael_core.agent.cli.loop import CliLoop
    from raphael_core.worker.loop import Outcome

    agent, background = wired_connections
    server = await plugins.connect(look="T1")
    background.service.use_cli(object())
    async def work(loop):
        names = lambda: {item["function"]["name"] for item in loop.tools}
        before = names()
        assert "Notes__look" not in before and "use_tool" in before
        assert not {"manage_connection", "add_mcp_server"} & before
        assert (await loop._tool("found", "use_tool", {"name": "Notes__look", "arguments": {"topic": "sample"}})).ok
        # The owner changes the service externally while this worker is running.
        await plugins.hub._set_enabled({"id": server, "enabled": False})
        stale = await loop._tool("stale", "use_tool", {"name": "Notes__look", "arguments": {"topic": "sample"}})
        assert not stale.ok and names() == before
        loop._queue.put_nowait(Outcome("done", final="Owner disabled sample."))
    monkeypatch.setattr(CliLoop, "_work", work)
    identifier = background.submit("Read sample", model="cli:codex:test")
    origin = agent.history.add(session_id="cli-background", question="Read sample", route="delegate", prefix="", text="", status="running", source="app", conversation_id=agent.service.conversations.main())
    background.service.attach_turn(identifier, origin)
    await until(lambda: background.task(identifier).state in ("done", "failed"))
    assert background.task(identifier).state == "done"


@pytest.mark.parametrize("mode", ["ask", "plan", "direct", "bypass"])
@pytest.mark.parametrize("approved", [False, True])
async def test_background_own_routine_delete_always_waits_and_names_the_routine(wired_connections, mode, approved):
    agent, background = wired_connections
    agent.settings.set("action_mode", mode)
    routine = (await agent.call("routines.create", {"member_id": 0, "title": "Morning report", "prompt": "Read the report",
                                                  "schedule": {"kind": "daily", "time": "09:00"}}))["routine"]
    background.client.replies = [turn("Delete my routine.", [call("routine_delete", {"id": routine["id"]})]), report("Finished.")]
    identifier = background.submit("Delete Morning report")
    origin = agent.history.add(session_id="routine-background", question="Delete Morning report", route="delegate", prefix="", text="", status="running", source="app",
        conversation_id=agent.service.conversations.main())
    background.service.attach_turn(identifier, origin)
    await until(lambda: background.task(identifier).state in ("waiting", "done", "failed"))
    assert background.task(identifier).state == "waiting"
    [question] = background.service.waiting_questions()
    assert question["tier"] == "T3" and "Morning report" in question["text"]
    assert agent.service._team.store.routine(routine["id"])
    background.service.answer(identifier, question["id"], approved)
    await until(lambda: background.task(identifier).state in ("done", "failed"))
    assert background.task(identifier).state == "done"
    assert bool(agent.service._team.store.routine(routine["id"])) != approved


@pytest.mark.parametrize("operation", ["disable", "enable", "tool_disable", "tool_enable", "disconnect"])
async def test_managed_app_changes_use_the_existing_connector_policy(make_rig, client, tmp_path, conn, operation):
    from test_connectors import connected
    from raphael_core.connectors.service import COMPOSIO_SERVER, META_EXECUTE
    _, managed, hub, _, _ = await connected(tmp_path, conn)
    entry = managed.store.connectors["composio:gmail"]
    if operation == "enable":
        await managed.set_tools({"id": entry.id, "enabled": False})
    if operation == "tool_enable":
        await managed.set_tools({"id": entry.id, "disabled_tools": ["GMAIL_FETCH_EMAILS"]})
    from raphael_core.members.service import MembersService
    from members.conftest import FakeBackground
    team = MembersService(conn, tmp_path, background=FakeBackground(conn))
    rig = make_rig(plugins=hub, secret_cards=SecretCards(conn, hub), team=team)
    team.register(rig.rpc)
    rig.settings.set("action_mode", "bypass")
    client.chats = [chat("Change.", use("manage_connection", {"connection": entry.id, "operation": operation, "tool": "GMAIL_FETCH_EMAILS"})), chat("Changed.")]
    asked = await typed(rig, "Change sample app access")
    if operation == "disconnect":
        assert asked["status"] == "confirm" and entry.id in asked["confirm"]["text"]
        asked = await rig.confirm(asked["confirm"]["id"])
    assert asked["text"] == "Changed."
    allowed = managed.allow_call(COMPOSIO_SERVER, META_EXECUTE, {"tools": [{"tool_slug": "GMAIL_FETCH_EMAILS", "arguments": {}}]}, "auto")
    assert allowed == (operation in ("enable", "tool_enable"))

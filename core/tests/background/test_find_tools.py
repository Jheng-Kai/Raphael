"""Tests for a task finding the tools it is not listed, and calling them by use_tool.

The list is fixed (owner, 2026-11-09, decision 2): many tools of a connection stay out of it, and
find_tools returns the ones that fit what the task wants, each with its input schema."""

import json

from raphael_core.agent.plugins import PluginTool
from raphael_core.agent.policy import Tier
from raphael_core.background.snapshot import FIND, FIND_MAX, FOUND, MCP, USE, take_snapshot
from raphael_core.worker.loop import NOT_LISTED, Call, ToolOutcome, Turn, run_task

from .test_run import Rig


def notion_tools(count=65):
    """`count` tools of one service; search and update sort after the listing tools."""
    tools = [
        PluginTool(
            f"mcp:n/notion-a{n:03d}-list",
            "Notion",
            f"notion-a{n:03d}-list",
            "List some pages.",
            {"type": "object", "properties": {"cursor": {"type": "string"}}},
            Tier.T0,
        )
        for n in range(count - 2)
    ]
    for name, text in (
        ("notion-search", "Search the workspace for pages by words."),
        ("notion-update-page", "Change the properties or the content of a page."),
    ):
        tools.append(PluginTool(f"mcp:n/{name}", "Notion", name, text, {"type": "object"}, Tier.T0))
    return tools


class Hub:
    def __init__(self, tools):
        self.tools = tools

    def offered(self):
        return list(self.tools)


def listed(snapshot):
    return [d["function"]["name"] for d in snapshot.definitions]


def test_a_connections_tools_are_found_not_listed():
    snapshot = take_snapshot(Hub(notion_tools()))
    assert not [name for name in listed(snapshot) if name.startswith("Notion__")]
    assert snapshot.refs["find_tools"].kind == FIND and snapshot.refs["use_tool"].kind == USE
    assert len(snapshot.hidden()) == 65


def test_find_returns_the_tools_that_fit_with_their_schemas_and_lists_nothing():
    snapshot = take_snapshot(Hub(notion_tools()))
    before = json.dumps(snapshot.definitions)
    found, lines = snapshot.find("update a page")
    # The connection's page tool fits; its listing tools do not, and Raphael's own update_page is listed already.
    assert [d["function"]["name"] for d in found] == ["Notion__notion-update-page"]
    assert len(found) <= FIND_MAX and FOUND in lines
    assert json.loads(lines[lines.index(FOUND) + 1]) == found[0]["function"], "a line is the whole definition"
    assert any(line.startswith("calendar_update is in your list already") for line in lines)
    assert json.dumps(snapshot.definitions) == before
    again, _ = snapshot.find("update a page")
    assert again == found, "a search may be made again: nothing was taken out of the catalog"


def test_an_exact_name_finds_that_tool_and_a_listed_one_says_so():
    snapshot = take_snapshot(Hub(notion_tools()))
    found, _ = snapshot.find("Notion__notion-a050-list")
    assert [d["function"]["name"] for d in found] == ["Notion__notion-a050-list"]
    assert snapshot.find("web_search") == ([], ["web_search is in your list already: call it directly."])


def test_words_that_fit_nothing_get_the_names_to_choose_from():
    snapshot = take_snapshot(Hub(notion_tools(3)))
    found, lines = snapshot.find("qqqqq")
    assert found == [] and "Notion__notion-search" in lines[-1] and "slack_draft" in lines[-1]


async def test_find_tools_counts_as_a_tool_call_and_use_tool_calls_what_it_found(conn, plugins, calls):
    await plugins.connect(look="T0")
    rig = Rig(conn, plugins, snapshot=take_snapshot(plugins.hub))
    reply = await rig.tool("find_tools", {"query": "look it up"})
    assert reply["ok"] and "Notes__look" in reply["content"] and "tools" not in reply
    assert rig.run.tool_calls == 1
    bad = await rig.tool("find_tools", {"query": 5})
    assert not bad["ok"] and bad["kind"] == "bad_arguments"
    used = await rig.tool("use_tool", {"name": "Notes__look", "arguments": {"topic": "x"}}, call_id="c2")
    assert used["ok"] and calls == ["look"] and rig.run.snapshot.refs["Notes__look"].kind == MCP
    assert "Notes__look" not in listed(rig.run.snapshot)
    await rig.meteo.http.aclose()


# --- the worker's loop ---------------------------------------------------------------------

FIND_TOOLS = {"type": "function", "function": {"name": "find_tools", "parameters": {}}}
USE_TOOL = {"type": "function", "function": {"name": "use_tool", "parameters": {}}}


class Host:
    def __init__(self):
        self.turns = [
            Turn("", [Call("c0", "Notion__update", {}, "{}")]),
            Turn("", [Call("c1", "find_tools", {"query": "update"}, "{}")]),
            Turn("", [Call("c2", "use_tool", {"name": "Notion__update", "arguments": {}}, "{}")]),
            Turn(json.dumps({"prefix": "告", "text": "ok", "detail": ""})),
        ]
        self.seen = []
        self.made = []
        self.results = []

    async def chat(self, messages, tools):
        self.seen.append([t["function"]["name"] for t in tools])
        if messages[-1].get("role") == "tool":
            self.results.append(messages[-1]["content"])
        return self.turns.pop(0)

    async def tool(self, call_id, name, arguments):
        self.made.append(name)
        return ToolOutcome(True, content="Notion__update" if name == "find_tools" else "done")


async def test_the_loop_sends_an_unlisted_name_to_find_tools_and_never_grows_its_list():
    host = Host()
    outcome = await run_task(host, system="s", user="u", tools=[FIND_TOOLS, USE_TOOL])
    assert outcome.status == "done"
    assert host.made == ["find_tools", "use_tool"]  # the first call, by a name not listed, was refused
    assert NOT_LISTED in host.results[0]
    assert host.seen == [["find_tools", "use_tool"]] * 4

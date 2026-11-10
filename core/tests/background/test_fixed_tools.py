"""A task's tools are one fixed list, sorted by name, whatever the task says (owner, 2026-11-09, decision 2).

Any other tool of the task is found with find_tools, which returns its name, description and input
schema, and called with use_tool, through the same gate as a direct call. Neither changes the list:
the worker, the CLI's MCP server and the provider see the same tools from the first call to the last."""

import json
from types import SimpleNamespace

from raphael_core.background.cli import member_loop
from raphael_core.background.snapshot import take_snapshot

from .conftest import call, report, turn
from .test_run import Rig


def listed(snapshot):
    return json.dumps(snapshot.definitions, ensure_ascii=False)


def names(snapshot):
    return [item["function"]["name"] for item in snapshot.definitions]


async def test_two_tasks_that_ask_different_things_send_the_same_sorted_tools(make_rig, plugins):
    rig = make_rig()
    await plugins.connect(look="T0", note="T0")
    rig.client.replies = [report("Done."), report("Done.")]
    # Words that once chose tools: a Slack draft, the notes of a connection.
    rig.submit("Draft a Slack reply to the team about the launch")
    await rig.wait_for_reports(1)
    rig.submit("Look up my notes about the launch", session="s2")
    await rig.wait_for_reports(2)
    first, second = (json.dumps(sent["tools"], ensure_ascii=False) for sent in rig.client.chat_calls)
    assert first == second
    sent = [item["function"]["name"] for item in rig.client.chat_calls[0]["tools"]]
    assert sent == sorted(sent) and {"find_tools", "use_tool", "read_attachment"} <= set(sent)
    assert "slack_draft" not in sent and not [name for name in sent if name.startswith("Notes__")]


async def test_a_plugin_tool_is_found_and_called_while_the_list_stays(conn, plugins, calls):
    await plugins.connect(look="T0", note="T0")
    snapshot = take_snapshot(plugins.hub)
    before = listed(snapshot)
    assert not [name for name in names(snapshot) if name.startswith("Notes__")]
    rig = Rig(conn, plugins, snapshot=snapshot)
    found = await rig.tool("find_tools", {"query": "look it up"})
    assert found["ok"] and "Notes__look" in found["content"] and "tools" not in found
    assert '"topic"' in found["content"], "the schema a call needs comes with the name"
    assert listed(rig.run.snapshot) == before
    used = await rig.tool("use_tool", {"name": "Notes__look", "arguments": {"topic": "launch"}}, call_id="c2")
    assert used["ok"] and "found launch" in used["content"] and calls == ["look"]
    assert [step.tool for step in rig.steps() if step.kind == "tool"][-1] == "look", "the step names the tool it ran"
    rig.client.replies = [turn("Done.", [])]
    reply = await rig.chat()
    assert "tools" not in reply, "the worker keeps the list it has"
    assert json.dumps(rig.client.chat_calls[0]["tools"], ensure_ascii=False) == before
    await rig.meteo.http.aclose()


async def test_use_tool_reaches_only_the_tools_of_the_task(conn, plugins):
    rig = Rig(conn, plugins, snapshot=take_snapshot(plugins.hub))
    for arguments in ({"name": "group_delete", "arguments": {"id": 1}},  # owner-private management
                      {"name": "use_tool", "arguments": {}},
                      {"name": "find_tools", "arguments": {"query": "x"}},
                      {"name": 5, "arguments": {}},
                      {"name": "weather", "arguments": "Taipei"}):
        assert not (await rig.tool("use_tool", arguments))["ok"], arguments
    assert rig.steps()[0].tool == "group_delete", "a refused call is the step of the tool it named, never use_tool"
    assert (await rig.tool("use_tool", {"name": "local_time", "arguments": {}}))["ok"]
    await rig.meteo.http.aclose()


async def test_a_connection_that_comes_or_goes_mid_task_leaves_the_list(conn, plugins, calls):
    rig = Rig(conn, plugins, snapshot=take_snapshot(plugins.hub))
    before = listed(rig.run.snapshot)
    server = await plugins.connect(look="T0")
    rig.client.replies = [turn("Looking.", []), turn("Done.", [])]
    assert "tools" not in await rig.chat()
    assert listed(rig.run.snapshot) == before
    found = await rig.tool("find_tools", {"query": "look it up"})
    assert "Notes__look" in found["content"], "a tool connected mid-task can be found"
    await plugins.set_on(server, "look", False)
    assert "tools" not in await rig.chat()
    assert listed(rig.run.snapshot) == before
    gone = await rig.tool("use_tool", {"name": "Notes__look", "arguments": {"topic": "launch"}}, call_id="c3")
    assert not gone["ok"] and calls == []
    await rig.meteo.http.aclose()


async def test_a_worker_task_calls_a_found_tool_through_use_tool(make_rig, plugins, calls):
    rig = make_rig()
    await plugins.connect(look="T0")
    rig.client.replies = [
        turn("Finding.", [call("find_tools", {"query": "look it up"}, "c1")]),
        turn("Looking.", [call("use_tool", {"name": "Notes__look", "arguments": {"topic": "launch"}}, "c2")]),
        report("Found it."),
    ]
    task_id = rig.submit()
    [done] = await rig.wait_for_reports()
    assert done["state"] == "done" and calls == ["look"]
    sent = [json.dumps(chat["tools"], ensure_ascii=False) for chat in rig.client.chat_calls]
    assert len(sent) == 3 and sent[1] == sent[0] and sent[2] == sent[0]
    assert [(step.tool, step.server) for step in rig.steps(task_id) if step.kind == "tool"] == [
        ("find_tools", "Raphael"), ("look", "Notes")]


async def test_a_cli_task_finds_and_calls_without_its_mcp_list_changing(conn, plugins, calls):
    await plugins.connect(look="T0")
    rig = Rig(conn, plugins, snapshot=take_snapshot(plugins.hub))
    task = SimpleNamespace(id=rig.task_id, member_id=0, language="en", scope="private", text="Find the notes")
    spec = {"system": "persona", "user": "task", "tools": rig.run.snapshot.definitions}
    loop = member_loop(None, None, task, rig.run, spec, wait_s=1, progress=lambda text: None)
    before = json.dumps(loop._mcp_tools(), ensure_ascii=False)
    found = await loop._tool("1", "find_tools", {"query": "look it up"})
    assert found.ok and "Notes__look" in found.content
    assert json.dumps(loop._mcp_tools(), ensure_ascii=False) == before and not loop.catalog_changed
    used = await loop._tool("2", "use_tool", {"name": "Notes__look", "arguments": {"topic": "launch"}})
    assert used.ok and calls == ["look"]
    assert json.dumps(loop._mcp_tools(), ensure_ascii=False) == before and not loop.catalog_changed
    await rig.meteo.http.aclose()

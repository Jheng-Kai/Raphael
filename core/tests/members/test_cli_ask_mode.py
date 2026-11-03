"""The 手動 mode (`action_mode = "ask"`) with a member on a CLI brain: a tool of a connection is called through
Raphael's MCP server, the owner answers the card through the production `agent.confirm`, and the call is
made. A fake Claude Code process stands in for the CLI; the plugins are real ones over in-memory servers."""

import asyncio

import pytest

from agent.conftest import FakeActions
from agent.test_plugins import calls, plugins  # noqa: F401
from agent.test_service import Rig
from .test_answering import Team, client, member, typed  # noqa: F401
from .test_cli_brains import fake_brain, fake_mcp


@pytest.fixture
async def setup(conn, tmp_path, client, plugins):  # noqa: F811
    team = Team(conn, tmp_path)
    rig = Rig(conn, client, FakeActions(), team=team.members, memory=team.memory, plugins=plugins.hub)
    yield rig, team
    await rig.aclose()
    await team.memory.aclose()


@pytest.mark.parametrize("tool,name,arguments", [
    ("look", "Notes__look", {"topic": "tea"}),
    ("note", "Notes__note", {"text": "tea"}),
])
async def test_cli_member_in_ask_mode_makes_a_t1_call_after_a_yes(setup, plugins, calls, tmp_path, tool, name, arguments):
    rig, team = setup
    teacher = member(team, model="cli:claude:opus?effort=high")
    await plugins.connect(look="T1", note="T1")
    rig.settings.set("action_mode", "ask")
    fake_mcp(rig, tmp_path, [(name, arguments)])
    pending = await asyncio.wait_for(typed(rig, "Use the tool", teacher.id, language="en"), 30)
    assert pending["status"] == "confirm", pending
    assert calls == []
    result = await asyncio.wait_for(rig.confirm(pending["confirm"]["id"]), 30)
    assert result["text"] == "Finished."
    assert calls == [tool]
    assert plugins.audit()[-1][3:] == ("user", "ok")
    [turn] = (await rig.call("agent.history.list", {"member_id": teacher.id}))["turns"]
    assert turn["status"] == "done"
    assert [step["outcome"] for step in turn["steps"] if step["tool"] == tool] == ["ok"]

"""The owner's PC is out of reach of the background worker (R-PC-01): no task, routine or event run is offered a local command."""

from unittest.mock import AsyncMock

import pytest

from raphael_core.computer.local_tools import LocalTools
from .conftest import call, turn, report, until


def with_local_tools(plugins, conn):
    host = AsyncMock()
    host.execute.return_value = {"exit_code": 0, "stdout": "cpu", "stderr": "", "truncated": False}
    plugins.hub = LocalTools(plugins.hub, conn, host=host)
    return host


@pytest.mark.parametrize("mode", ["ask", "always", "never"])
async def test_a_task_that_asks_for_a_local_command_is_told_there_is_no_such_tool(make_rig, plugins, conn, mode):
    host = with_local_tools(plugins, conn)
    plugins.hub.settings.set("local_commands_mode", mode)
    plugins.hub.settings.set("local_commands_seen", True)
    rig = make_rig()
    rig.client.replies = [turn("Checking CPU.", [call("local__local_exec", {"command": "Get-Process"}, "cpu")]), report("I cannot reach the PC.")]
    task_id = rig.submit("幫我看一下為甚麼我電腦 CPU 使用率這麼高")
    await rig.wait_for_reports()
    assert rig.service.waiting_questions() == []
    host.execute.assert_not_awaited()
    tools = {item["function"]["name"] for item in rig.client.chat_calls[0]["tools"]}
    assert tools and not [name for name in tools if name.startswith("local__") or name in ("computer", "open", "lock_screen")]
    assert not [step for step in rig.steps(task_id) if step.tool == "local_exec" and step.outcome == "ok"]


async def test_an_event_run_is_not_offered_the_local_command_either(make_rig, plugins, conn):
    host = with_local_tools(plugins, conn)
    plugins.hub.settings.set("local_commands_mode", "always")
    plugins.hub.settings.set("local_commands_seen", True)
    rig = make_rig()
    rig.client.replies = [turn("Checking.", [call("local__local_exec", {"command": "Get-Process"}, "cpu")]), report("Checked.")]
    task_id = rig.service.submit(session_id="routine:9:event:synthetic", routine_id=9, text="Prepare a draft from untrusted event data", language="en", model="fake/model")
    await until(lambda: rig.task(task_id).state not in ("queued", "running"))
    assert rig.service.waiting_questions() == []
    host.execute.assert_not_awaited()

"""Local command consent through the real worker loop and background questions."""

from unittest.mock import AsyncMock

import pytest

from raphael_core.computer.local_tools import LocalTools
from raphael_core.protocol import RpcError
from .conftest import call, turn, report, until


async def test_routine_timeout_is_a_failed_step_in_task_and_conversation_history(make_rig, plugins, conn):
    from raphael_core.agent.history import AgentHistory
    host = AsyncMock()
    host.execute.return_value = {"timed_out": True, "stdout": "Partial synthetic output", "exit_code": None}
    plugins.hub = LocalTools(plugins.hub, conn, host=host)
    plugins.hub.settings.set("local_commands_mode", "always")
    plugins.hub.settings.set("local_commands_seen", True)
    rig = make_rig()
    history = AgentHistory(conn)
    origin = history.add(session_id="routine:sample", question="Check samples", route="routine", source="routine",
                         prefix="", text="", status="running")
    rig.client.replies = [turn("Checking.", [call("local__local_exec", {"command": "Get-Process"}, "cpu")]), report("The command timed out.")]
    task = rig.submit("Check samples")
    rig.service.attach_turn(task, origin)
    await rig.wait_for_reports()
    task_step = next(s for s in rig.steps(task) if s.tool == "local_exec")
    history_step = next(s for s in history.steps([origin])[origin] if s.tool == "local_exec")
    assert task_step.outcome == history_step.outcome == "timeout"
    assert task_step.reason == history_step.reason == "timeout"
    assert host.execute.await_count == 1


async def test_event_item_requires_command_confirmation_even_when_local_commands_are_always_allowed(make_rig, plugins, conn):
    host = AsyncMock()
    host.execute.return_value = {"exit_code": 0, "stdout": "ok", "stderr": "", "truncated": False}
    plugins.hub = LocalTools(plugins.hub, conn, host=host)
    plugins.hub.settings.set("local_commands_mode", "always")
    plugins.hub.settings.set("local_commands_seen", True)
    rig = make_rig()
    rig.client.replies = [turn("Checking.", [call("local__local_exec", {"command": "Get-Process"}, "cpu")]), report("Checked.")]
    task_id = rig.service.submit(session_id="routine:9:event:synthetic", routine_id=9, text="Prepare a draft from untrusted event data", language="en", model="fake/model")
    await until(lambda: rig.task(task_id).state == "waiting")
    [question] = rig.service.waiting_questions()
    assert question["permission"]["kind"] == "local_command"
    host.execute.assert_not_awaited()
    assert rig.service.answer(task_id, question["id"], False, digest=question["permission"]["digest"]) == "denied"
    await until(lambda: rig.task(task_id).state not in ("queued", "running", "waiting"))
    host.execute.assert_not_awaited()


@pytest.mark.parametrize("choice", ["once", "always", "never"])
@pytest.mark.parametrize("brain", ["api", "cli"])
async def test_routine_command_waits_thirty_minutes_and_resumes_only_from_app(make_rig, plugins, conn, tmp_path, choice, brain):
    host = AsyncMock()
    host.execute.return_value = {"exit_code": 0, "stdout": "cpu", "stderr": "", "truncated": False}
    plugins.hub = LocalTools(plugins.hub, conn, host=host)
    rig = make_rig()
    rig.client.replies = [turn("Checking CPU.", [call("local__local_exec", {"command": "Get-Process"}, "cpu")]), report("Checked.")]
    if brain == "cli":
        from members.test_cli_brains import fake_mcp
        fake_mcp(rig, tmp_path, [("local__local_exec", {"command": "Get-Process"})], allowed=choice != "never")
    task_id = rig.submit("幫我看一下為甚麼我電腦 CPU 使用率這麼高", model="cli:claude" if brain == "cli" else "fake/model")
    await until(lambda: rig.task(task_id).state == "waiting")
    [question] = rig.service.waiting_questions()
    assert question["expires_at_ms"] - question["created_at_ms"] == 30 * 60 * 1000
    assert question["permission"]["kind"] == "local_access"
    assert "Get-Process" in question["permission"]["summary"]
    assert "Get-Process" not in question["text"]
    if brain == "cli":
        assert rig.service._cli_loops[task_id].approval_wait_s == 1800
    host.execute.assert_not_awaited()
    with pytest.raises(RpcError):
        rig.service.answer(task_id, question["id"], True, source="telegram")
    assert rig.service.answer(task_id, question["id"], True, digest="wrong") == "changed"
    assert rig.service.answer(task_id, question["id"], choice != "never", always=choice == "always", never=choice == "never",
                              digest=question["permission"]["digest"]) in ("approved", "denied")
    await rig.wait_for_reports()
    assert host.execute.await_count == (0 if choice == "never" else 1)
    assert plugins.hub.settings.get("local_commands_mode") == {"once": "ask", "always": "always", "never": "never"}[choice]
    assert "Get-Process" not in str(rig.steps(task_id))

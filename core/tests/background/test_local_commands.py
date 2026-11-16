"""Local command consent through the real worker loop and background questions: a task, a routine and an event run use the
hidden commands on the owner's PC with the card (R-PC-02), and never open anything on its screen (R-PC-06)."""

from unittest.mock import AsyncMock

import pytest

from raphael_core.computer.local_tools import LocalTools
from raphael_core.protocol import RpcError
from .conftest import call, turn, report, until
from .test_run import rig  # noqa: F401


def with_local_tools(plugins, conn, **result):
    host = AsyncMock()
    host.execute.return_value = result or {"exit_code": 0, "stdout": "cpu", "stderr": "", "truncated": False}
    plugins.hub = LocalTools(plugins.hub, conn, host=host)
    return host


async def test_routine_timeout_is_a_failed_step_in_task_and_conversation_history(make_rig, plugins, conn):
    from raphael_core.agent.history import AgentHistory
    host = with_local_tools(plugins, conn, timed_out=True, stdout="Partial synthetic output", exit_code=None)
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
    host = with_local_tools(plugins, conn)
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
    host = with_local_tools(plugins, conn)
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
        assert rig.service._cli_loops[task_id].approval_wait_s == 1800 + 60  # the question's own end (30 minutes) comes first
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


@pytest.mark.parametrize("mode", ["ask", "always", "never", "bypass"])
async def test_a_task_that_would_open_something_on_the_owners_screen_is_sent_to_its_own_computer(make_rig, plugins, conn, mode):
    # R-PC-06: whatever the mode, 全部允許 included, nothing asks for it and nothing runs.
    host = with_local_tools(plugins, conn)
    plugins.hub.settings.set("local_commands_seen", True)
    if mode == "bypass":
        plugins.hub.settings.set("action_mode", "bypass")
    else:
        plugins.hub.settings.set("local_commands_mode", mode)
    rig = make_rig()
    rig.client.replies = [turn("Opening YouTube.", [call("local__local_exec", {"command": "Start-Process https://www.youtube.com"}, "yt")]),
                          report("I opened nothing on the owner's screen.")]
    task_id = rig.submit("Open YouTube")
    await rig.wait_for_reports()
    assert rig.service.waiting_questions() == []
    host.execute.assert_not_awaited()
    tools = {item["function"]["name"] for item in rig.client.chat_calls[0]["tools"]}
    assert "local__local_exec" in tools and not tools & {"computer", "open", "lock_screen"}
    told = [message["content"] for message in rig.client.chat_calls[-1]["messages"] if message["role"] == "tool"]
    assert any("your own computer" in text for text in told)
    assert not [step for step in rig.steps(task_id) if step.tool == "local_exec" and step.outcome == "ok"]


async def test_a_cli_tasks_own_command_that_would_open_something_is_refused_under_allow_all(rig):
    # The CLI's own shell under 全部允許 runs without Raphael's tool gate, but never to show something on the owner's screen.
    from raphael_core.background.cli import member_loop
    rig.settings.set("action_mode", "bypass")
    task = rig.store.get(rig.task_id)
    loop = member_loop(None, None, task, rig.run, {"system": "Persona", "user": "Task", "tools": []},
                       wait_s=1, progress=lambda text: None)
    refused = await loop.execute("open", "cli_permission", {"command": "cmd /c start https://www.youtube.com"})
    hidden = await loop.execute("read", "cli_permission", {"command": "Get-Process"})
    assert not refused.ok and refused.kind == "shows_on_screen" and "your own computer" in refused.instruction
    assert hidden.ok

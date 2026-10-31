"""Local command consent through the real worker loop and background questions."""

from unittest.mock import AsyncMock

import pytest

from raphael_core.computer.local_tools import LocalTools
from raphael_core.protocol import RpcError
from .conftest import call, turn, report, until


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

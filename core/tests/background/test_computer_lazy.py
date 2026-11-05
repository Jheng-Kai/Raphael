"""Background API and CLI turns share the offline offer and on-use discovery."""

from unittest.mock import AsyncMock

import pytest

from raphael_core.agent.cli.loop import CliLoop
from raphael_core.agent.gate import ToolGate
from raphael_core.computer.vm import LocalVm
from raphael_core.computer.vm_tools import VmTools
from raphael_core.services.attachment_store import AttachmentStore
from raphael_core.worker.loop import Outcome
from computer.test_vm import Runtime, Bridge, container
from .conftest import call, report, turn, until


@pytest.mark.parametrize("cli", [False, "codex", "claude"], ids=["api", "codex", "claude"])
@pytest.mark.parametrize("use_computer", [False, True])
async def test_background_turn_starts_only_for_real_computer_call(make_rig, tmp_path, monkeypatch, cli, use_computer):
    rig = make_rig()
    runtime = Runtime()
    vm = LocalVm(tmp_path, runner=runtime)
    async def start(target):
        runtime.raw = container(vm, target, runtime)
    vm.start = AsyncMock(side_effect=start)
    hub = VmTools(rig.plugins.hub, vm, attachments=AttachmentStore(tmp_path), conn=rig.conn, bridge=Bridge)
    vm.grants.set(0, True)
    rig.gate = rig.service._gate = ToolGate(hub, conn=rig.conn)
    used = False

    async def work(loop):
        nonlocal used
        names = {tool["function"]["name"] for tool in loop.tools}
        assert "computer__get_desktop_state" in names and "computer__request_computer" not in names
        if use_computer and not used:
            assert {"computer__click", "computer__browser_open", "computer__browser_type"} <= names
            result = await loop._tool("screen", "computer__get_desktop_state", {})
            assert result.ok and result.replace_tools and loop.catalog_changed
            assert "computer__click" in {tool["function"]["name"] for tool in loop.tools}
            if cli == "claude":
                assert "approve" in {tool["function"]["name"] for tool in loop.tools}
            loop.catalog_changed = False
            assert (await loop._tool("click", "computer__click", {})).ok
            assert (await loop._tool("check", "computer__get_window_state", {"pid": 7, "window_id": 9})).ok
            used = True
        loop._queue.put_nowait(Outcome("done", final="Done."))

    if cli:
        rig.service.use_cli(object())
        monkeypatch.setattr(CliLoop, "_work", work)
    for index in range(2):
        if not cli:
            rig.client.replies = ([turn("Look.", [call("computer__get_desktop_state", {})]),
                turn("Click.", [call("computer__click", {})]),
                turn("Check.", [call("computer__get_window_state", {"pid": 7, "window_id": 9})])] if use_computer and index == 0 else []) + [report("Done.")]
        before = vm.start.await_count, len(runtime.calls)
        task = rig.submit(session=f"lazy-{index}", model=f"cli:{cli}:test" if cli else "fake/model")
        await until(lambda: rig.task(task).state in ("done", "failed"))
        assert rig.task(task).state == "done"
        if index or not use_computer:
            assert (vm.start.await_count, len(runtime.calls)) == before
    if use_computer:
        assert vm.start.await_count == 3
    else:
        vm.start.assert_not_awaited()
        assert runtime.calls == []

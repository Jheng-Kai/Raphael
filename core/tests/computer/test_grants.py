"""Computer permission regressions over the real adapter and a fake Docker boundary."""
from unittest.mock import AsyncMock, Mock
from types import SimpleNamespace

import pytest

from raphael_core.agent.gate import ToolGate
from raphael_core.background.run import TaskRun
from raphael_core.background.snapshot import take_snapshot
from raphael_core.brain.db import connect
from raphael_core.brain.settings import SettingsStore
from raphael_core.computer.grants import ComputerGrants
from raphael_core.computer.viewer import DesktopViewer
from raphael_core.computer.vm import LocalVm
from raphael_core.computer.vm_tools import VmTools, vm_scope
from raphael_core.services.attachment_store import AttachmentStore
from .test_vm import Runtime, Bridge, EmptyHub, container


@pytest.mark.parametrize("member", [0, 7])
@pytest.mark.parametrize("mode", ["shared", "per-bot"])
@pytest.mark.parametrize("state", ["missing", "stopped", "running"])
async def test_no_grant_never_starts_or_offers_desktop_tools(tmp_path, conn, member, mode, state):
    runtime = Runtime()
    settings = SettingsStore(conn)
    settings.set("computer_vm_mode", mode)
    vm = LocalVm(tmp_path, runner=runtime, settings=settings)
    if state != "missing":
        runtime.raw = container(vm, vm.target(member), runtime)
        runtime.raw["State"]["Running"] = state == "running"
    vm.start = AsyncMock()
    vm.launch = Mock()
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Bridge)
    await hub.prepare(member)
    assert vm.grants.state(member) is None
    assert conn.execute("SELECT COUNT(*) FROM computer_grants").fetchone()[0] == 0
    assert [tool.name for tool in hub.offered_for(member)] == ["request_computer"]
    runtime.raw = None
    await hub.prepare(member)
    assert vm.grants.state(member) is None
    assert [tool.name for tool in hub.offered_for(member)] == ["request_computer"]
    vm.start.assert_not_awaited()
    vm.launch.assert_not_called()
    assert not hub.catalogs
    assert not runtime.calls


async def test_shared_vm_does_not_share_grants_and_revocation_blocks_stale_calls(tmp_path, conn):
    runtime = Runtime()
    vm = LocalVm(tmp_path, runner=runtime)
    runtime.raw = container(vm, vm.target(), runtime)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Bridge)
    vm.grants.set(0, True)
    await hub.prepare(0)
    await hub.prepare(7)
    assert [tool.name for tool in hub.offered_for(7)] == ["request_computer"]
    tool = next(tool for tool in hub.offered() if tool.name == "get_desktop_state")
    before = len(runtime.calls)
    with vm_scope(("turn", 7, 1)):
        assert (await hub.call(tool.key, {}, approver="auto")).kind == "computer_permission_required"
    vm.grants.set(0, False)
    assert (await hub.call(tool.key, {}, approver="auto")).kind == "computer_permission_required"
    await hub.prepare()
    assert [tool.name for tool in hub.offered()] == ["request_computer"]
    assert len(runtime.calls) == before


async def test_viewer_start_grants_but_preview_and_status_do_not(tmp_path, conn):
    runtime = Runtime()
    vm = LocalVm(tmp_path, runner=runtime)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Bridge)
    vm.launch = Mock()
    viewer = DesktopViewer(vm)
    try:
        await viewer.status({"member_id": 7})
        await viewer.open({"member_id": 7, "preview": True})
        assert vm.grants.state(7) is None
        vm.launch.assert_not_called()
        await viewer.open({"member_id": 7})
        assert vm.grants.allowed(7) and not vm.grants.allowed(0)
        vm.launch.assert_called_once_with(vm.target(7))
        await viewer.revoke({"member_id": 7})
        assert vm.grants.state(7) is False
    finally:
        await viewer.aclose()


def test_grant_and_revocation_survive_restart_and_v44_upgrade(tmp_path):
    import sqlite3
    from raphael_core.brain import db
    path = tmp_path / "grants.db"
    raw = sqlite3.connect(path)
    for version in range(1, 45):
        step = db._MIGRATIONS[version]
        step(raw) if callable(step) else raw.executescript(step)
    raw.close()
    conn = connect(path)
    grants = ComputerGrants(conn)
    assert grants.state(0) is None
    grants.set(0, True)
    grants.set(7, False)
    conn.close()
    conn = connect(path)
    grants = ComputerGrants(conn)
    assert grants.allowed(0) and grants.state(7) is False
    grants.set(0, False)
    conn.close()
    conn = connect(path)
    assert ComputerGrants(conn).state(0) is False
    conn.close()


async def test_routine_without_grant_fails_visibly_without_asking_or_starting(tmp_path, conn):
    vm = LocalVm(tmp_path, runner=Runtime())
    vm.start = AsyncMock()
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Bridge)
    snapshot = take_snapshot(hub)
    ref = snapshot.refs["computer__request_computer"]
    caller = SimpleNamespace(tool_allowed=lambda key: True, _gate=ToolGate(hub), task_id=123)
    reply, outcome, tier, sent = await TaskRun._plugin(caller, ref, {"reason": "routine screenshot"})
    assert reply["kind"] == "computer_permission_required" and "routine cannot start" in reply["content"]
    assert outcome == "blocked" and sent is None
    assert not vm.grants.allowed(0)
    vm.start.assert_not_awaited()
    assert (await hub.call(ref.key, {"reason": "routine"}, approver="user", task_id=123)).kind == "computer_permission_required"


async def test_worker_stops_and_persists_a_failed_report_for_missing_grant(tmp_path, conn):
    from unittest.mock import Mock
    from raphael_core.protocol import RpcError
    from raphael_core.background.service import BackgroundService
    vm = LocalVm(tmp_path, runner=Runtime())
    vm.start = AsyncMock()
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Bridge)
    caller = SimpleNamespace(tool_allowed=lambda key: True, _gate=ToolGate(hub), task_id=123, tool_calls=0, snapshot=take_snapshot(hub),
                             _check=lambda **kwargs: None, _end_step=Mock(), _note_action=lambda *args: None, _note_result=lambda *args: None)
    caller._plugin = lambda *args: TaskRun._plugin(caller, *args)
    with pytest.raises(RpcError) as stopped:
        await TaskRun._tool(caller, "computer__request_computer", {"reason": "Routine needs desktop"})
    assert stopped.value.data == {"stop": "failed", "detail": "computer_permission_required"}
    caller._end_step.assert_called_once()
    store = SimpleNamespace(get=lambda identifier: SimpleNamespace(state="running", generation=1))
    service = SimpleNamespace(_store=store, _conclude=Mock())
    task = SimpleNamespace(id=123, language="en")
    run = SimpleNamespace(tool_calls=1, cancelled=False, generation=1)
    BackgroundService._conclude_run(service, task, run, {"status": "stopped", "kind": "failed", "detail": "computer_permission_required"})
    args = service._conclude.call_args.args
    assert args[2] == "failed" and "routine cannot use the computer" in args[4]
    vm.start.assert_not_awaited()


async def test_revoke_during_first_listing_prevents_driver_action(tmp_path, conn):
    vm = LocalVm(tmp_path, runner=Runtime())
    vm.start = AsyncMock()
    calls = []
    class RevokingBridge(Bridge):
        async def request(self, method, params=None):
            calls.append(method)
            vm.grants.set(0, False)
            return await super().request(method, params)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=RevokingBridge)
    vm.grants.set(0, True)
    await hub.prepare()
    tool = next(tool for tool in hub.offered() if tool.name == "get_desktop_state")
    assert (await hub.call(tool.key, {}, approver="auto")).kind == "computer_permission_required"
    assert vm.grants.state(0) is False
    assert [tool.name for tool in hub.offered()] == ["request_computer"]
    assert calls == ["tools/call"]


async def test_revoke_during_viewer_status_probe_prevents_launch(tmp_path):
    vm = LocalVm(tmp_path, runner=Runtime())
    vm.launch = Mock()
    viewer = DesktopViewer(vm)
    async def status(target):
        vm.grants.set(0, False)
        return {"state": "stopped"}
    viewer.status_for = status
    try:
        await viewer.open({"member_id": 0})
        vm.launch.assert_not_called()
        assert not vm.grants.allowed(0)
    finally:
        await viewer.aclose()


async def test_allow_all_opens_the_computer_while_it_is_on_and_writes_no_grant(tmp_path, conn):
    settings = SettingsStore(conn)
    vm = LocalVm(tmp_path, runner=Runtime(), settings=settings)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Bridge)
    settings.set("action_mode", "bypass")
    await hub.prepare(7)
    names = [tool.name for tool in hub.offered_for(7)]
    assert "get_desktop_state" in names and "request_computer" not in names
    assert hub.has_own_computer(7)
    assert conn.execute("SELECT COUNT(*) FROM computer_grants").fetchone()[0] == 0
    settings.set("action_mode", "direct")
    assert [tool.name for tool in hub.offered_for(7)] == ["request_computer"]
    assert not hub.has_own_computer(7)


async def test_a_computer_the_owner_took_away_stays_away_under_allow_all(tmp_path, conn):
    settings = SettingsStore(conn)
    vm = LocalVm(tmp_path, runner=Runtime(), settings=settings)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Bridge)
    vm.grants.set(7, False)
    settings.set("action_mode", "bypass")
    await hub.prepare(7)
    assert hub.offered_for(7) == []
    assert vm.grants.state(7) is False


async def test_allow_all_without_docker_leaves_the_owners_desktop_on_offer(tmp_path, conn):
    settings = SettingsStore(conn)
    vm = LocalVm(tmp_path, runner=Runtime(), settings=settings)
    vm.desktop = Mock(installed=Mock(return_value=False))
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Bridge)
    settings.set("action_mode", "bypass")
    await hub.prepare(7)
    assert hub.offered_for(7) == [] and not hub.has_own_computer(7)

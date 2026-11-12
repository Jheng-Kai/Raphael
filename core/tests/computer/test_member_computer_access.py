"""A member uses its computer when its work needs it: no grant, no question, over the real adapter and a fake Docker boundary."""
from unittest.mock import AsyncMock, Mock
from types import SimpleNamespace

import pytest

from raphael_core.agent.gate import ToolGate
from raphael_core.agent.policy import Action, NotApproved, Tier
from raphael_core.brain.settings import SettingsStore
from raphael_core.computer.viewer import DesktopViewer
from raphael_core.computer.vm import LocalVm
from raphael_core.computer.vm_tools import VmTools, vm_scope
from raphael_core.background.tasks import TaskStore
from raphael_core.router import Router
from raphael_core.services.attachment_store import AttachmentStore
from .test_vm import Runtime, Bridge, EmptyHub, container


@pytest.mark.parametrize("member", [0, 7])
@pytest.mark.parametrize("mode", ["shared", "per-bot"])
@pytest.mark.parametrize("state", ["missing", "stopped", "running"])
async def test_every_member_is_offered_the_computer_without_a_question_and_nothing_starts(tmp_path, conn, member, mode, state):
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
    before = len(runtime.calls)
    await hub.prepare(member)
    names = [tool.name for tool in hub.offered_for(member)]
    assert "get_desktop_state" in names and "vm_exec" in names and "request_computer" not in names
    assert hub.has_own_computer(member)
    assert conn.execute("SELECT COUNT(*) FROM computer_grants").fetchone()[0] == 0
    # Per-bot offers ask nothing; a new shared seat first proves its screen empty without starting it.
    vm.start.assert_not_awaited()
    vm.launch.assert_not_called()
    if mode == 'per-bot':
        assert len(runtime.calls) == before
    else:
        assert any(args[:2] == ['container', 'inspect'] for args, _ in runtime.calls[before:])
        assert not any(args[0] in ('run', 'start', 'stop', 'rm') for args, _ in runtime.calls[before:])


async def test_a_never_asked_member_calls_the_computer_and_the_call_starts_it(tmp_path, conn):
    runtime = Runtime()
    vm = LocalVm(tmp_path, runner=runtime)
    async def start(target):
        runtime.raw = container(vm, target, runtime)
    vm.start = AsyncMock(side_effect=start)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Bridge)
    await hub.prepare(7)
    tool = next(tool for tool in hub.offered_for(7) if tool.name == "get_desktop_state")
    with vm_scope(("turn", 7, 1)):
        assert (await hub.call(tool.key, {}, approver="auto")).ok
    vm.start.assert_awaited()
    assert conn.execute("SELECT COUNT(*) FROM computer_grants").fetchone()[0] == 0


async def test_a_call_on_a_computer_that_is_no_longer_the_members_own_is_refused(tmp_path, conn):
    runtime = Runtime()
    settings = SettingsStore(conn)
    settings.set("computer_vm_mode", "per-bot")
    vm = LocalVm(tmp_path, runner=runtime, settings=settings)
    runtime.raw = container(vm, vm.target(7), runtime)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Bridge)
    await hub.prepare(7)
    tool = next(tool for tool in hub.offered_for(7) if tool.name == "get_desktop_state")
    before = len(runtime.calls)
    settings.set("computer_vm_mode", "shared")
    with vm_scope(("turn", 7, 1)):
        result = await hub.call(tool.key, {}, approver="auto")
    assert not result.ok
    assert result.kind == 'computer_changed'
    assert all(args[:2] == ['container', 'inspect'] or 'wmctrl' in args for args, _ in runtime.calls[before:])


async def test_a_room_speaker_is_offered_the_computer_the_same_way(tmp_path, conn):
    vm = LocalVm(tmp_path, runner=Runtime())
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Bridge)
    await hub.prepare(3)
    await hub.prepare(9)
    in_private = [tool.name for tool in hub.offered_for(3)]
    in_room = [tool.name for tool in hub.offered_for(9)]
    assert in_private == in_room and "vm_exec" in in_room
    assert "request_computer" not in in_room


async def test_a_pc_without_docker_offers_no_computer_tools_and_leaves_the_owners_desktop_on_offer(tmp_path, conn):
    vm = LocalVm(tmp_path, runner=Runtime())
    vm.desktop = Mock(installed=Mock(return_value=False))
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Bridge)
    await hub.prepare(7)
    assert hub.offered_for(7) == [] and not hub.has_own_computer(7)


async def test_computer_tools_off_offer_nothing(tmp_path, conn):
    vm = LocalVm(tmp_path, runner=Runtime(), enabled=False)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Bridge)
    await hub.prepare(7)
    assert hub.offered_for(7) == [] and not hub.has_own_computer(7)


@pytest.mark.parametrize("mode", ["ask", "direct", "plan", "bypass"])
async def test_every_permission_mode_keeps_the_gate_of_the_computers_tools(tmp_path, conn, mode):
    settings = SettingsStore(conn)
    settings.set("action_mode", mode)
    vm = LocalVm(tmp_path, runner=Runtime(), settings=settings)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Bridge)
    await hub.prepare(7)
    tools = {tool.name: tool for tool in hub.offered_for(7)}
    # The same tools in every mode, and the same tiers: a gesture is T0, a card number is T3 and always asked.
    assert "request_computer" not in tools and tools["vm_exec"].tier == Tier.T0 and tools["click"].tier == Tier.T0
    assert tools["fill_card"].tier == Tier.T3
    gate = ToolGate(hub, conn=conn)
    card = Action(tools["fill_card"].key, {})
    with pytest.raises(NotApproved):
        gate.check(card, None)
    assert gate.is_vm_tool(tools["click"].key) and not gate.is_vm_tool(tools["fill_card"].key)
    assert not gate.is_vm_tool(tools["fill_login"].key) and not gate.is_vm_tool(tools["dataset"].key)


async def test_a_routine_of_a_never_asked_member_runs_a_gesture_and_stops_at_the_card_entry(tmp_path, conn):
    runtime = Runtime()
    vm = LocalVm(tmp_path, runner=runtime)
    runtime.raw = container(vm, vm.target(7), runtime)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Bridge)
    await hub.prepare(7)
    tools = {tool.name: tool for tool in hub.offered_for(7)}
    gate = ToolGate(hub, conn=conn)
    task = TaskStore(conn).create(session_id="routine", language="en", text="Look at the screen", member_id=7)
    reply = await gate.call_plugin(tools["get_desktop_state"].key, {}, task_id=task)
    assert reply.ok
    # The card entry needs the owner's yes, which nobody away can give.
    refused = await gate.call_plugin(tools["fill_card"].key, {}, task_id=task)
    assert not refused.ok and refused.kind == "blocked"
    assert conn.execute("SELECT COUNT(*) FROM computer_grants").fetchone()[0] == 0


async def test_the_worker_still_cannot_drive_the_owners_own_desktop(tmp_path, conn):
    vm = LocalVm(tmp_path, runner=Runtime())
    gate = ToolGate(VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Bridge), conn=conn)
    with pytest.raises(NotApproved):
        gate.check(Action("computer_open", {}), None, worker=True)


async def test_status_and_a_preview_never_launch_but_an_open_wakes_a_stopped_computer(tmp_path, conn):
    runtime = Runtime()
    vm = LocalVm(tmp_path, runner=runtime)
    VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Bridge)
    vm.launch = Mock()
    viewer = DesktopViewer(vm)
    try:
        status = await viewer.status({"member_id": 7})
        assert "granted" not in status
        await viewer.open({"member_id": 7, "preview": True})
        vm.launch.assert_not_called()
        await viewer.open({"member_id": 7})
        vm.launch.assert_called_once_with(vm.target(7))
    finally:
        await viewer.aclose()


async def test_the_core_has_no_revoke_method_and_no_grant_is_written(tmp_path, conn):
    vm = LocalVm(tmp_path, runner=Runtime())
    viewer = DesktopViewer(vm)
    router = Router()
    viewer.register(router)
    try:
        assert not hasattr(viewer, "revoke")
        assert "computer.revoke" not in router.methods() and "computer.viewer_open" in router.methods()
        await viewer.open({"member_id": 7})
        assert conn.execute("SELECT COUNT(*) FROM computer_grants").fetchone()[0] == 0
    finally:
        await viewer.aclose()


async def test_the_maintenance_rpc_needs_no_grant(tmp_path, conn, monkeypatch):
    vm = LocalVm(tmp_path, runner=Runtime())
    viewer = DesktopViewer(vm)
    maintained = AsyncMock()
    monkeypatch.setattr("raphael_core.computer.lifecycle.maintain", maintained)
    viewer.status = AsyncMock(return_value={"state": "stopped"})
    try:
        target = vm.target(7)
        await viewer.lifecycle({"member_id": 7, "action": "restart", "host": target.remote, "target": target.key})
        maintained.assert_awaited_once()
    finally:
        await viewer.aclose()


def test_the_unused_grant_table_survives_an_upgrade_untouched(tmp_path):
    """No migration: a v44 database upgrades with computer_grants kept (and unread) beside the rest."""
    import sqlite3
    from raphael_core.brain import db
    path = tmp_path / "grants.db"
    raw = sqlite3.connect(path)
    for version in range(1, 45):
        step = db._MIGRATIONS[version]
        step(raw) if callable(step) else raw.executescript(step)
    raw.close()
    conn = db.connect(path)
    assert conn.execute("SELECT COUNT(*) FROM computer_grants").fetchone()[0] == 0
    conn.close()

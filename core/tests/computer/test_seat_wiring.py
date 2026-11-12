"""Seat routing and unit lifecycle contracts without containers or network."""

import asyncio
import json
from dataclasses import replace
from unittest.mock import AsyncMock

import pytest

from raphael_core.brain.settings import SettingsStore
from raphael_core.computer.checkpoint_service import Checkpoints
from raphael_core.computer.lifecycle import maintain
from raphael_core.computer.vm import LABEL, LocalVm, VmError, compatible, known_previous, run_args
from raphael_core.computer.viewer import DesktopViewer, Session
from raphael_core.computer.vm_tools import VmTools, vm_scope
from raphael_core.protocol import RpcError
from raphael_core.services.attachment_store import AttachmentStore
from .test_vm import Bridge, CatalogBridge, EmptyHub, Runtime, container


@pytest.fixture
def shared_vm(tmp_path, conn):
    settings = SettingsStore(conn)
    settings.set("computer_vm_mode", "shared")
    runtime = Runtime()
    return LocalVm(tmp_path, settings=settings, runner=runtime, conn=conn), runtime


async def test_target_never_assigns_and_seat_persists_across_recovery(shared_vm):
    vm, runtime = shared_vm
    empty = vm.target(11)
    assert empty.key == vm.key_for("", 11) and empty.screen == 0 and empty.unit == "shared"
    assert not vm.seats.rows
    first, second = await vm.seat(11), await vm.seat(12)
    assert (first.screen, second.screen, first.screens) == (1, 2, 6)
    assert first.key != second.key and first.name == second.name
    runtime.raw = container(vm, first, runtime)
    restarted = LocalVm(vm.root, settings=vm.settings, runner=runtime, conn=vm.seats.conn)
    await restarted.recover()
    assert restarted.target(11) == first and restarted.target(12) == second
    assert restarted.target(13).screen == 0
    assert not restarted.data.rows


async def test_two_seats_start_the_unit_once_and_keep_their_own_view_url(shared_vm):
    vm, runtime = shared_vm
    first, second = await vm.seat(1), await vm.seat(2)
    original = vm.run

    async def run(args, **kwargs):
        if args[0] == "run":
            runtime.raw = container(vm, first, runtime)
        await asyncio.sleep(0)
        return await original(args, **kwargs)

    vm.run = run
    states = await asyncio.gather(vm.start(first), vm.start(second))
    assert sum(args[0] == "run" for args, _ in runtime.calls) == 1
    assert "screen-1" in states[0]["viewer_url"] and "screen-2" in states[1]["viewer_url"]
    assert (await vm.status(vm.target(3)))["viewer_url"] == ""


@pytest.mark.parametrize("guard", ["active", "held", "busy"])
@pytest.mark.parametrize("action", ["stop", "restart", "update", "repair", "reset", "restore", "timezone"])
async def test_physical_actions_refuse_another_seats_work(shared_vm, guard, action):
    vm, runtime = shared_vm
    first, second = await vm.seat(1), await vm.seat(2)
    runtime.raw = container(vm, first, runtime)
    if guard == "active":
        vm.active[second.key] = 1
    elif guard == "held":
        vm.hold(second, True)
    else:
        vm.busy = lambda key: key == second.key
    if action == "restore":
        with pytest.raises(RpcError, match="computer_busy"):
            await Checkpoints(vm, lambda member: True).call({"member_id": 1, "action": "restore", "confirmed": True})
    elif action == "timezone":
        vm.timezone = lambda: "Asia/Taipei"
        await vm.refresh_timezone()
        assert vm.timezone_pending
    else:
        with pytest.raises(VmError, match="busy"):
            await (vm.stop(first) if action == "stop" else maintain(vm, first, action, confirmed=True))
    assert not any(args[0] in ("stop", "rm", "restart", "run") for args, _ in runtime.calls)


async def test_idle_stop_waits_for_every_seat_and_stops_only_once(shared_vm):
    vm, runtime = shared_vm
    first, second = await vm.seat(1), await vm.seat(2)
    runtime.raw = container(vm, first, runtime)
    vm.clock = lambda: 0
    await vm.start(first)
    vm.clock = lambda: 10000
    vm.active[second.key] = 1
    await vm.sweep()
    assert runtime.raw["State"]["Running"]
    vm.active.clear()
    await vm.sweep()
    assert sum(args[0] == "stop" for args, _ in runtime.calls) == 1


async def test_seventh_member_disconnects_displaced_seat_and_invalidates_its_route(shared_vm, tmp_path):
    vm, runtime = shared_vm
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    viewer = DesktopViewer(vm)
    for member in range(1, 7):
        await hub.prepare(member)
    first = vm.target(1)
    runtime.raw = container(vm, first, runtime)
    await hub._connection(first)
    old = next(tool for tool in hub.offered_for(1) if tool.name == "list_windows")
    viewer.sessions["old"] = Session(first, vm.clock() + 100, member_id=1)
    vm.close_displaced_seat_windows = AsyncMock()
    await hub.prepare(7)
    assert vm.target(7).screen == 1 and vm.target(1).screen == 0
    assert first.key not in hub.connections and "old" not in viewer.sessions
    vm.close_displaced_seat_windows.assert_awaited_once_with(first)
    with vm_scope(("turn", 1, 1)):
        assert (await hub.call(old.key, {}, approver="auto")).kind == "computer_changed"
    await hub.prepare(1)
    assert vm.target(1).screen > 0
    await hub.aclose()


async def test_all_busy_seats_return_the_existing_busy_notice(shared_vm, tmp_path):
    vm, runtime = shared_vm
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    for member in range(1, 7):
        target = await vm.seat(member)
        vm.active[target.key] = 1
    with pytest.raises(VmError, match="seats_full"):
        await vm.seat(7)
    await hub.prepare(7)
    tool = next(tool for tool in hub.offered_for(7) if tool.name == "list_windows")
    with vm_scope(("turn", 7, 1)):
        result = await hub.call(tool.key, {}, approver="auto")
    assert result.ok and result.kind == "computer_busy"
    assert "every screen of the computer is in use" in result.text
    viewer = DesktopViewer(vm)
    with pytest.raises(RpcError, match="unavailable"):
        await viewer.open({"member_id": 7})
    assert not viewer.sessions


async def test_seat_zero_view_is_forbidden_without_resolving_a_connection(shared_vm):
    vm, _ = shared_vm
    viewer = DesktopViewer(vm)
    viewer.origin = "http://127.0.0.1:1234"
    viewer.sessions["empty"] = Session(vm.target(1), vm.clock() + 10, member_id=1)
    viewer.connection_for = AsyncMock()
    reply = await viewer._prepare_request("GET", "/empty/vnc.html", {"host": "127.0.0.1:1234"})
    assert reply == {"code": 403}
    viewer.connection_for.assert_not_called()


@pytest.mark.parametrize("shared", [False, True])
async def test_container_kind_owns_sizing_and_compatibility(shared_vm, shared):
    vm, runtime = shared_vm
    vm.settings.set("computer_vm_mode", "shared" if shared else "per-bot")
    target = await vm.seat(1)
    args = run_args(target, vm.owner, "secret")
    assert args[args.index("--memory") + 1] == ("6g" if shared else "3g")
    assert args[args.index("--memory-swap") + 1] == ("6g" if shared else "3g")
    assert args[args.index("--cpus") + 1] == ("4" if shared else "2")
    assert f"RAPHAEL_SCREENS={6 if shared else 1}" in args
    raw = container(vm, target, runtime)
    assert raw["Config"]["Labels"][f"{LABEL}.target"] == target.unit
    assert compatible(raw, target, vm.owner, runtime.image_id)
    raw["HostConfig"]["Memory"] += 1
    assert not compatible(raw, target, vm.owner, runtime.image_id)


@pytest.mark.parametrize("layer", [3, 4, 5])
async def test_old_shared_shape_rebuilds_to_six_screens_and_keeps_mounts(shared_vm, layer):
    vm, runtime = shared_vm
    target = await vm.seat(1)
    previous = vm.target_for("", "shared")
    runtime.raw = container(vm, previous, runtime)
    runtime.raw["Config"]["Labels"][f"{LABEL}.layer"] = str(layer)
    if layer < 5:
        runtime.raw["Config"]["Env"] = ["VNC_PW=private"]
        runtime.raw["Image"] = "old-image"
    memory = 2 if layer == 3 else 3
    runtime.raw["HostConfig"].update(Memory=memory * 1024**3, MemorySwap=memory * 1024**3)
    assert known_previous(runtime.raw, target, vm.owner)
    mounts = runtime.raw["Mounts"]
    target.workspace.mkdir(parents=True)
    marker = target.workspace / "kept.txt"
    marker.write_text("workspace and browser profile", encoding="utf-8")
    original = vm.run

    async def run(args, **kwargs):
        if args[0] == "run":
            runtime.raw = container(vm, target, runtime)
        return await original(args, **kwargs)

    vm.run = run
    assert (await vm.start(target))["ready"]
    assert runtime.raw["Mounts"] == mounts and marker.exists()
    assert sum(args[0] == "rm" for args, _ in runtime.calls) == 1


async def test_seat_targets_are_never_erased_or_recorded_as_member_computers(shared_vm):
    vm, runtime = shared_vm
    target = await vm.seat(1)
    vm.data.made(target)
    assert not vm.data.rows
    with pytest.raises(VmError, match="shared"):
        await vm.erase(target)
    assert not runtime.calls


@pytest.mark.parametrize("name,native", [("click", True), ("browser_navigate", False)])
async def test_native_driver_calls_serialize_but_page_calls_overlap(shared_vm, tmp_path, name, native):
    vm, runtime = shared_vm
    first, second = await vm.seat(1), await vm.seat(2)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    inside, peak = 0, 0

    class Client:
        async def request(self, method, params):
            nonlocal inside, peak
            if params["name"] == "list_windows":
                from .test_seat_tools import window
                return {"structuredContent": {"windows": [window(1, 20), window(2, 1300)]}}
            inside += 1
            peak = max(peak, inside)
            await asyncio.sleep(.02)
            inside -= 1
            return {}

    client = Client()
    await asyncio.gather(*(hub._driver_call(target, client, name, {"window_id": target.screen, "pid": target.screen}
                                           if native else {}) for target in (first, second)))
    assert peak == (1 if native else 2)


async def test_a_hold_refuses_its_seat_but_only_blocks_other_seats_native_input(shared_vm, tmp_path, monkeypatch):
    monkeypatch.setattr("raphael_core.computer.rfb_view.capture", lambda *args, **kwargs: b"\x89PNG\r\n\x1a\nimage")
    vm, runtime = shared_vm
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=CatalogBridge)
    for member in (1, 2):
        await hub.prepare(member)
        await hub._discover(vm.target(member))
    first, second = vm.target(1), vm.target(2)
    runtime.raw = container(vm, first, runtime)
    hub.busy_wait_s = .02
    vm.hold(first, True)
    for member, name, kind in [(1, "get_desktop_state", "owner_holds_control"),
                                (1, "browser_navigate", "owner_holds_control"), (2, "click", "computer_busy"),
                                (2, "get_desktop_state", None), (2, "browser_navigate", None)]:
        tool = next(tool for tool in hub.offered_for(member) if tool.name == name)
        with vm_scope(("turn", member, 1)):
            result = await hub.call(tool.key, {}, approver="auto")
        assert result.kind == kind
        if kind == "computer_busy":
            assert json.loads(result.text)["held_by"] == "the owner"
    vm.hold(second, True)
    vm.hold(first, False)
    assert vm.unit_held(first)
    await hub.aclose()


def test_every_native_input_name_is_a_driver_tool():
    from raphael_core.computer.vm_catalog import DRIVER_TOOLS, NATIVE_INPUT_TOOLS
    assert NATIVE_INPUT_TOOLS <= DRIVER_TOOLS.keys()
    assert {"click", "type_text", "move_cursor", "clipboard_write", "browser_prepare"} <= NATIVE_INPUT_TOOLS


async def test_shared_catalog_keeps_dataset_and_teaching_unavailable(shared_vm, tmp_path):
    from raphael_core.computer.teaching import Teaching
    vm, _ = shared_vm
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare(1)
    assert vm.target(1).key == vm.key_for("", 1)
    assert "dataset" not in {tool.name for tool in hub.offered_for(1)}
    teaching = Teaching(DesktopViewer(vm), None, None)
    teaching.recover = lambda *args: None
    assert not teaching.status(1, 1, vm.target(1))["teach_available"]


async def test_local_limit_counts_containers_and_cannot_evict_a_busy_seat(shared_vm):
    vm, _ = shared_vm
    seats = [await vm.seat(member) for member in range(1, 7)]
    vm.settings.set("computer_vm_mode", "per-bot")
    incoming = vm.target(20)
    vm.recover = AsyncMock()
    vm.stop = AsyncMock()
    states = {seats[0].name: "running", incoming.name: "missing"}

    async def status(target, **kwargs):
        return {"state": states[target.name]}

    vm.status = status
    await vm._make_room(incoming)
    vm.stop.assert_not_called()
    other = vm.target(21)
    states[other.name] = "running"
    vm.active[seats[-1].key] = 1
    await vm._make_room(incoming)
    vm.stop.assert_awaited_once_with(other)
    vm.stop.reset_mock()
    vm.active[other.key] = 1
    with pytest.raises(VmError, match="local_capacity"):
        await vm._make_room(incoming)
    vm.stop.assert_not_called()


async def test_shared_hosts_have_separate_physical_state_and_driver_sessions(shared_vm, tmp_path):
    vm, runtime = shared_vm
    local = await vm.seat(1)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    local_connection = await hub._connection(local)
    other = await vm.seat(2)
    other_connection = await hub._connection(other)
    assert local_connection[0] is not other_connection[0] and local_connection[1] != other_connection[1]
    vm.settings.set("computer_ssh_alias", "studio")
    remote = await vm.seat(1)
    assert remote.unit == local.unit and remote.state_key != local.state_key
    vm.hold(local, True)
    assert vm.unit_held(other) and not vm.unit_held(remote)
    await hub._disconnect(local.key)
    assert other.key in hub.connections
    await hub.aclose()


async def test_previews_do_not_assign_and_closing_one_seat_keeps_another_viewers_tunnel(shared_vm):
    vm, runtime = shared_vm
    viewer = DesktopViewer(vm)
    vm.launch = lambda target: None
    runtime.raw = container(vm, vm.target(1), runtime)
    preview = await viewer.open({"member_id": 1, "preview": True})
    assert vm.target(1).screen == 0
    await viewer.status({"member_id": 2})
    assert vm.target(2).screen == 0
    first = await viewer.open({"member_id": 1})
    second = await viewer.open({"member_id": 2})
    tunnel = AsyncMock()
    target = vm.target(1)
    vm.tunnels[(target.remote, target.name)] = tunnel
    await viewer.close(first)
    tunnel.close.assert_not_called()
    assert second["session"] in viewer.sessions
    await viewer.close(preview)
    await viewer.aclose()
    tunnel.close.assert_awaited_once()


async def test_repair_rechecks_other_seats_after_awaiting_the_driver_probe(shared_vm):
    from raphael_core.computer.lifecycle import repair_connection
    from raphael_core.computer.vm import Result
    vm, runtime = shared_vm
    first, second = await vm.seat(1), await vm.seat(2)
    runtime.raw = container(vm, first, runtime)
    original = vm.run

    async def run(args, **kwargs):
        if "test" in args and "-S" in args:
            vm.active[second.key] = 1
            return Result(1)
        return await original(args, **kwargs)

    vm.run = run
    with pytest.raises(VmError, match="busy"):
        await repair_connection(vm, first)
    assert not any(args[0] == "restart" for args, _ in runtime.calls)


async def test_takeover_request_refuses_input_already_running_on_another_seat(shared_vm, tmp_path):
    vm, runtime = shared_vm
    first, second = await vm.seat(1), await vm.seat(2)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare(1)
    vm.active[second.key] = 1
    lock = hub.native_actions.setdefault(second.state_key, asyncio.Lock())
    await lock.acquire()
    key = next(tool.key for tool in hub.offered_for(1) if tool.name == "request_takeover")
    with vm_scope(("turn", 1, 1), turn_id=1, private=True):
        result = await asyncio.wait_for(hub.call(key, {"reason": "sign_in"}, approver="auto"), .1)
    assert result.kind == "computer_busy" and not vm.held
    lock.release()

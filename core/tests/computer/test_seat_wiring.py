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
from .fixtures.driver_contract import validate_call, runtime_refusal


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
    runtime.calls.clear()
    vm.data.made(target)
    assert not vm.data.rows
    with pytest.raises(VmError, match="shared"):
        await vm.erase(target)
    assert not runtime.calls


@pytest.mark.parametrize("name,native", [("click", True), ("browser_navigate", False),
    ("browser_click", True), ("browser_pointer", True), ("browser_dialog", True)])
async def test_native_driver_calls_serialize_but_page_calls_overlap(shared_vm, tmp_path, name, native):
    vm, runtime = shared_vm
    first, second = await vm.seat(1), await vm.seat(2)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    inside, peak = 0, 0

    class Client:
        async def request(self, method, params):
            nonlocal inside, peak
            validate_call(method, params)
            refusal = runtime_refusal(method, params)
            if refusal:
                return refusal
            if params["name"] == "list_windows":
                from .test_seat_tools import window
                return {"structuredContent": {"windows": [window(1, 20), window(2, 1300)]}}
            inside += 1
            peak = max(peak, inside)
            await asyncio.sleep(.02)
            inside -= 1
            return {}

    client = Client()
    for target in (first, second):
        hub.page_windows[(target.key, "own")] = ("test", target.screen, target.screen)
    extra = {"browser_navigate": dict(url="about:blank"), "browser_click": dict(x=5, y=6, delivery_mode="foreground"),
             "browser_pointer": dict(action="hover", ref="button", delivery_mode="foreground"),
             "browser_dialog": dict(action="dismiss", dialog_id="dialog", delivery_mode="foreground")}
    await asyncio.gather(*(hub._driver_call(target, client, name,
        {"window_id": target.screen, "pid": target.screen, "x": 5, "y": 6, "session": "test"} if name == "click" else
        {"target_id": "own", "tab_id": "tab", "session": "test", **extra[name]}) for target in (first, second)))
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
    _, session = await hub._connection(second)
    hub.page_windows[(second.key, "own")] = (session, 2, 2)
    vm.hold(first, True)
    for member, name, kind in [(1, "get_desktop_state", "owner_holds_control"),
                                (1, "browser_navigate", "owner_holds_control"), (2, "click", "computer_busy"),
                                (2, "get_desktop_state", None), (2, "browser_navigate", None)]:
        tool = next(tool for tool in hub.offered_for(member) if tool.name == name)
        with vm_scope(("turn", member, 1)):
            args = ({"window_id": 2, "pid": 2, "x": 5, "y": 6} if name == "click" else
                    {"target_id": "own", "tab_id": "tab", "url": "about:blank"} if name == "browser_navigate" else {})
            result = await hub.call(tool.key, args, approver="auto")
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


async def test_waiting_viewer_open_cannot_register_a_seat_displaced_during_status(shared_vm):
    vm, _ = shared_vm
    for member in range(1, 7):
        await vm.seat(member)
    for member in range(2, 7):
        vm.active[vm.target(member).key] = 1
    viewer = DesktopViewer(vm)
    viewer.server = object()
    viewer.origin = "http://127.0.0.1:1234"
    entered, resume = asyncio.Event(), asyncio.Event()
    async def status(target):
        entered.set()
        await resume.wait()
        return dict(state="running", ready=True)
    viewer.status_for = status
    opening = asyncio.create_task(viewer.open(dict(member_id=1)))
    await entered.wait()
    await vm.seat(7)
    resume.set()
    with pytest.raises(RpcError, match="seat changed"):
        await opening
    assert not viewer.sessions
    assert vm.target(1).screen == 0 and vm.seats.holders("")[1] == 7


async def test_viewer_displaced_during_relay_start_keeps_a_usable_server_without_a_stale_session(shared_vm, monkeypatch):
    from types import SimpleNamespace
    vm, _ = shared_vm
    for member in range(1, 7):
        await vm.seat(member)
    for member in range(2, 7):
        vm.active[vm.target(member).key] = 1
    class Relay:
        def __init__(self, *args):
            pass
        async def start(self):
            await vm.seat(7)
            return SimpleNamespace(sockets=[SimpleNamespace(getsockname=lambda: ("127.0.0.1", 1234))])
        async def aclose(self):
            pass
    monkeypatch.setattr("raphael_core.computer.viewer.ViewerRelay", Relay)
    viewer = DesktopViewer(vm)
    try:
        with pytest.raises(RpcError, match="seat changed"):
            await viewer.open(dict(member_id=1))
        assert viewer.server and viewer.origin == "http://127.0.0.1:1234" and viewer.monitor
        assert not viewer.sessions
    finally:
        await viewer.aclose()


@pytest.mark.parametrize("action", ["renew", "control", "request", "after_connection", "after_status", "register"])
async def test_stale_viewer_sessions_are_dropped_at_every_entry_and_after_await(shared_vm, action):
    vm, _ = shared_vm
    target = await vm.seat(1)
    viewer = DesktopViewer(vm)
    viewer.origin = "http://127.0.0.1:1234"
    viewer.sessions["old"] = session = Session(target, vm.clock() + 100, member_id=1)
    async def displace():
        vm.seats.release("", 1)
        await vm.seat(2)
    if action in ("after_connection", "after_status"):
        async def connection(_):
            await displace()
            return 2222, "private"
        async def status(_):
            await displace()
            return dict(state="running", ready=True)
        viewer.connection_for, viewer.status_for = connection, status
    else:
        await displace()
    if action in ("request", "after_connection"):
        assert await viewer._prepare_request("GET", "/old/connection", dict(host="127.0.0.1:1234")) == {"code": 403}
    elif action == "register":
        assert not await viewer._register_peer("old", session.revision, "socket")
    else:
        with pytest.raises(RpcError, match="seat changed"):
            await (viewer.control(dict(session="old", held=True)) if action == "control" else viewer.renew(dict(session="old")))
    assert "old" not in viewer.sessions and target.key not in viewer.owners


async def test_member_deletion_cleans_up_before_a_replacement_can_take_the_screen(shared_vm):
    from raphael_core.computer.seats import ComputerSeats
    vm, _ = shared_vm
    vm.seats = ComputerSeats(count=1)
    target = await vm.seat(1)
    entered, resume = asyncio.Event(), asyncio.Event()
    async def disconnect(key):
        entered.set()
        await resume.wait()
    vm.disconnect_driver = disconnect
    cleaned = []
    async def cleanup(old):
        assert old.screen == target.screen
        cleaned.append(1)
        return True
    vm.close_displaced_seat_windows = cleanup
    deletion = asyncio.create_task(vm.release_member_seats(1))
    await entered.wait()
    replacement = asyncio.create_task(vm.seat(2))
    await asyncio.sleep(0)
    assert not replacement.done()
    resume.set()
    await deletion
    assert (await replacement).screen == 1 and cleaned == [1, 1]
    assert vm.seats.holders("")[1] == 2


async def test_displaced_window_cleanup_rechecks_holder_after_window_list_await(shared_vm):
    from .test_seat_tools import window
    vm, runtime = shared_vm
    target = await vm.seat(1)
    runtime.raw = container(vm, target, runtime)
    async def rows(_):
        vm.seats.release("", 1)
        vm.seats.restore("", 2, 1)
        return dict(windows=[window(10, 20)])
    vm.seat_windows = rows
    await vm.close_displaced_seat_windows(target)
    assert not any("-c" in args for args, _ in runtime.calls)


@pytest.mark.parametrize("background", [False, True])
@pytest.mark.parametrize("shared", [False, True])
async def test_only_shared_member_shell_loses_display_in_foreground_and_background(shared_vm, shared, background):
    from raphael_core.computer.vm import Result
    vm, _ = shared_vm
    if not shared:
        vm.settings.set("computer_vm_mode", "per-bot")
    target = await vm.seat(1)
    vm.run_for = AsyncMock(return_value=Result(0))
    await vm.execute(target, "printf hello", background=background)
    args = vm.run_for.call_args_list[0].args[1]
    if background:
        assert ("env -u DISPLAY sh -lc" in args[args.index("sh") + 2]) is shared
    else:
        assert (["env", "-u", "DISPLAY"] == args[-6:-3]) is shared


async def test_shared_catalog_offers_dataset_and_teaching(shared_vm, tmp_path):
    from raphael_core.computer.teaching import Teaching
    vm, _ = shared_vm
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare(1)
    assert vm.target(1).key == vm.key_for("", 1)
    assert "dataset" in {tool.name for tool in hub.offered_for(1)}
    teaching = Teaching(DesktopViewer(vm), None, None)
    teaching.recover = lambda *args: None
    assert teaching.status(1, 1, vm.target(1))["teach_available"]


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


async def test_returning_member_cached_route_cannot_launch_during_displacement_cleanup(shared_vm, tmp_path):
    from raphael_core.computer.seats import ComputerSeats
    vm, runtime = shared_vm
    vm.seats = ComputerSeats(count=1)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare(1)
    first = vm.target(1)
    runtime.raw = container(vm, first, runtime)
    cached = next(tool for tool in hub.offered_for(1) if tool.name == "launch_app")
    await vm.seat(2)
    entered, resume = asyncio.Event(), asyncio.Event()
    disconnect = vm.disconnect_driver
    async def pause(key):
        if key == vm.key_for("", 2):
            entered.set()
            await resume.wait()
        await disconnect(key)
    vm.disconnect_driver = pause
    cleanup = AsyncMock()
    vm.close_displaced_seat_windows = cleanup
    returning = asyncio.create_task(vm.seat(1))
    try:
        await asyncio.wait_for(entered.wait(), 2)
        assert vm.seat_lock.locked()
        with vm_scope(("turn", 1, 1)):
            pending = asyncio.create_task(hub.call(cached.key, {"name": "xfce4-terminal"}, approver="auto"))
        await asyncio.sleep(.01)
        assert not pending.done()
        assert not cleanup.await_count and vm.target(1).screen == 0
        resume.set()
        assert (await asyncio.wait_for(returning, 2)) == first
        result = await asyncio.wait_for(pending, 2)
        assert not result.ok and result.kind == "computer_changed"
        cleanup.assert_awaited_once()
        assert vm.seats.holders("") == {1: 1}
    finally:
        resume.set()
        await returning
        await hub.aclose()


@pytest.mark.parametrize("cancelled", [False, True])
async def test_incomplete_displacement_restores_the_old_holder_before_unlocking(shared_vm, cancelled):
    from raphael_core.computer.seats import ComputerSeats
    vm, _ = shared_vm
    vm.seats = ComputerSeats(count=1)
    old = await vm.seat(2)
    async def fail(key):
        assert vm.seat_lock.locked() and not vm.seats.holders("")
        if cancelled:
            raise asyncio.CancelledError()
        raise OSError("Driver close failed")
    vm.disconnect_driver = fail
    vm.close_displaced_seat_windows = AsyncMock()
    with pytest.raises(asyncio.CancelledError if cancelled else OSError):
        await vm.seat(1)
    assert vm.seats.holders("") == {1: 2} and vm.target(2) == old
    assert not vm.seat_lock.locked() and vm.target(1).screen == 0
    vm.close_displaced_seat_windows.assert_not_awaited()
    vm.disconnect_driver = AsyncMock()
    assert (await vm.seat(1)).screen == 1
    vm.close_displaced_seat_windows.assert_awaited_once_with(old)


@pytest.mark.parametrize("restore_failure", [False, True])
async def test_final_seat_publish_failure_restores_the_exact_screen_or_reports_failure(shared_vm, conn, restore_failure):
    import sqlite3
    from raphael_core.computer.seats import ComputerSeats
    from raphael_core.computer.vm import VmError
    vm, _ = shared_vm
    vm.seats = ComputerSeats(conn, count=3, clock=iter(range(100)).__next__)
    vm.seats.restore('', 2, 3)
    # A lower numbered free screen appears during cleanup. Rollback must still restore screen 3.
    vm.seats.restore('', 3, 1)
    vm.seats.restore('', 4, 2)
    old = vm.target(2)
    vm.disconnect_driver = AsyncMock()
    vm.close_seat_viewers = AsyncMock()
    async def cleanup(target):
        assert target == old and vm.seat_lock.locked()
        vm.seats.release('', 3)
        return True
    vm.close_displaced_seat_windows = cleanup
    conn.executescript("""
        CREATE TRIGGER reject_new_seat BEFORE INSERT ON computer_seats
        WHEN NEW.member_id = 1
        BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END;
    """)
    if restore_failure:
        conn.executescript("""
            CREATE TRIGGER reject_restored_seat BEFORE INSERT ON computer_seats
            WHEN NEW.member_id = 2
            BEGIN SELECT RAISE(ABORT, 'synthetic restore failure'); END;
        """)
    with pytest.raises(VmError if restore_failure else sqlite3.Error, match='seat_restore_failed' if restore_failure else 'synthetic write failure'):
        await vm.seat(1)
    assert not vm.seat_lock.locked() and vm.target(1).screen == 0
    assert vm.target(2).screen == (0 if restore_failure else 3)
    assert [tuple(row) for row in conn.execute('SELECT seat FROM computer_seats WHERE member_id=2')] == ([] if restore_failure else [(3,)])


@pytest.mark.parametrize("failure", ["list", "close", "timeout", "stays", "unknown-class"])
@pytest.mark.parametrize("displace", [False, True])
async def test_a_new_holder_requires_proof_of_an_empty_screen(shared_vm, failure, displace):
    from raphael_core.computer.seats import ComputerSeats
    from .test_seat_tools import window
    vm, runtime = shared_vm
    vm.seats = ComputerSeats(count=1)
    if displace:
        await vm.seat(1)
    target = vm.shared_target("", 2, 1)
    runtime.raw = container(vm, target, runtime)
    async def rows(_):
        if failure == "list":
            raise OSError("list failed")
        if failure == "timeout":
            raise TimeoutError()
        return {"windows": [window(10, 1279, "" if failure == "unknown-class" else "Chromium-browser")]}
    vm.seat_windows = rows
    original = vm.run_for
    async def run(target, args, **kwargs):
        if "-c" in args and failure == "close":
            raise OSError("close failed")
        return await original(target, args, **kwargs)
    vm.run_for = run
    with pytest.raises(VmError, match="seats_full"):
        await vm.seat(2)
    assert vm.seats.holders("") == ({1: 1} if displace else {})
    assert vm.target(2).screen == 0 and not vm.seat_lock.locked()
    assert not any("kill" in part for args, _ in runtime.calls for part in args)
    # A failed attempt leaves no durable quarantine; a new attempt must list again.
    vm.seat_windows = AsyncMock(return_value={"windows": []})
    assert (await vm.seat(2)).screen == 1
    vm.seat_windows.assert_awaited_once()


async def test_cleanup_has_a_total_bound_even_when_the_window_list_never_answers(shared_vm):
    from raphael_core.computer.seats import ComputerSeats
    vm, runtime = shared_vm
    vm.seats = ComputerSeats(count=1)
    old = await vm.seat(1)
    runtime.raw = container(vm, old, runtime)
    async def stalled(_):
        await asyncio.sleep(10)
    vm.seat_windows = stalled
    vm.seat_clean_seconds = 1
    with pytest.raises(VmError, match='seats_full'):
        await asyncio.wait_for(vm.seat(2), 3)
    assert vm.target(1) == old and vm.target(2).screen == 0


async def test_a_failed_hand_over_leaves_the_idle_member_first_in_line(shared_vm):
    # Seen on a real computer: the holder put back after a failed hand-over was stamped "just used", so the
    # retry took the other, busier member's screen.
    from raphael_core.computer.seats import ComputerSeats
    vm, runtime = shared_vm
    ticks = iter(range(1, 100))
    vm.seats = ComputerSeats(count=2, clock=lambda: next(ticks))
    first = await vm.seat(1)
    await vm.seat(2)
    runtime.raw = container(vm, first, runtime)
    stamp = vm.seats.rows["", 1][1]
    vm.seat_windows = AsyncMock(side_effect=OSError("list failed"))
    with pytest.raises(VmError, match="seats_full"):
        await vm.seat(3)
    assert vm.seats.rows["", 1] == (1, stamp) and vm.seats.holders("") == {1: 1, 2: 2}
    vm.seat_windows = AsyncMock(return_value={"windows": []})
    assert (await vm.seat(3)).screen == 1
    assert vm.seats.holders("") == {1: 3, 2: 2}


async def test_the_desktops_own_windows_never_keep_a_screen_from_a_new_holder(shared_vm):
    # As an idle six-screen computer lists itself (measured): ONE desktop window across the whole canvas and a
    # panel on each screen. Counting the desktop window left every screen occupied: no member could ever sit down.
    from raphael_core.computer.seat_view import wmctrl_windows
    vm, runtime = shared_vm
    panels = [(0x00c00003, 567, 851), (0x00c00007, 1847, 851), (0x00c0000b, 3127, 851),
              (0x00c0000f, 567, 1751), (0x00c00013, 1847, 1751), (0x00c00017, 3127, 1751)]
    geometry = "0x00a00028 -1 0    0    3840 1800 host Desktop\n" + "".join(
        f"0x{identifier:08x} -1 {x}  {y}  146  49   host xfce4-panel\n" for identifier, x, y in panels)
    classes = "0x00a00028 -1 xfdesktop.Xfdesktop   host Desktop\n" + "".join(
        f"0x{identifier:08x} -1 xfce4-panel.Xfce4-panel  host xfce4-panel\n" for identifier, _, _ in panels)
    runtime.raw = container(vm, vm.shared_target("", 1, 1), runtime)
    vm.seat_windows = AsyncMock(return_value=wmctrl_windows(geometry, classes))
    assert [(await vm.seat(member)).screen for member in (1, 2, 3)] == [1, 2, 3]
    assert not any("wmctrl" in args and "-c" in args for args, _ in runtime.calls)
    # A member's window on the next screen is still in the way, and it is the only thing closed.
    listed = wmctrl_windows(geometry + "0x02000003  0 100 950 600 400 host Terminal\n",
                            classes + "0x02000003  0 xfce4-terminal.Xfce4-terminal  host Terminal\n")
    vm.seat_windows = AsyncMock(side_effect=[listed, wmctrl_windows(geometry, classes)])
    assert (await vm.seat(4)).screen == 4
    closed = [args[args.index("-c") + 1] for args, _ in runtime.calls if "wmctrl" in args and "-c" in args]
    assert closed == [str(0x02000003)]


async def test_dirty_free_screens_are_skipped_and_delayed_closure_is_observed(shared_vm):
    from .test_seat_tools import window
    vm, runtime = shared_vm
    target = vm.shared_target("", 2, 1)
    runtime.raw = container(vm, target, runtime)
    calls = []
    async def rows(target):
        calls.append(target.screen)
        # The first window only overlaps screen 1; it is centre-owned by screen 2.
        # Screen 2 cannot be claimed either until that same window has gone.
        return {"windows": [window(10, 1279)] if target.screen == 1 or calls.count(2) == 1 else [window(99, 1300, "xfce4-panel")]}
    vm.seat_windows = rows
    taken = await vm.seat(2)
    assert taken.screen == 2 and calls.count(1) == 10 and calls.count(2) == 2
    closes = [args for args, _ in runtime.calls if "wmctrl" in args and "-c" in args]
    assert len(closes) == 2 and all(args[-1] == "10" for args in closes)


async def test_an_existing_holder_is_never_cleaned_and_stopped_computers_need_no_list(shared_vm):
    vm, runtime = shared_vm
    target = await vm.seat(1)
    vm.seat_windows = AsyncMock(side_effect=AssertionError("Unexpected list"))
    runtime.raw = container(vm, target, runtime)
    vm.close_displaced_seat_windows = AsyncMock(side_effect=AssertionError("Unexpected cleanup"))
    assert await vm.seat(1) == target
    vm.close_displaced_seat_windows.assert_not_awaited()
    del vm.close_displaced_seat_windows
    runtime.raw["State"]["Running"] = False
    assert (await vm.seat(2)).screen == 2
    vm.seat_windows.assert_not_awaited()


async def test_failed_restore_cannot_give_leftover_windows_to_the_next_holder(shared_vm, conn):
    from raphael_core.computer.seats import ComputerSeats
    from .test_seat_tools import window
    vm, runtime = shared_vm
    vm.seats = ComputerSeats(conn, count=1)
    old = await vm.seat(1)
    runtime.raw = container(vm, old, runtime)
    vm.disconnect_driver = AsyncMock(side_effect=OSError("Disconnect failed"))
    conn.executescript("""
        CREATE TRIGGER reject_restoration BEFORE INSERT ON computer_seats
        WHEN NEW.member_id=1 BEGIN SELECT RAISE(ABORT, 'restore failure'); END;
    """)
    with pytest.raises(VmError, match="seat_restore_failed"):
        await vm.seat(2)
    assert not vm.seats.holders("")
    vm.seat_windows = AsyncMock(return_value={"windows": [window(10, 20)]})
    with pytest.raises(VmError, match="seats_full"):
        await vm.seat(3)
    assert vm.target(3).screen == 0
    vm.seat_windows = AsyncMock(return_value={"windows": []})
    assert (await vm.seat(3)).screen == 1


async def test_a_cached_displaced_route_keeps_the_busy_answer_when_cleanup_cannot_be_proved(shared_vm, tmp_path):
    from raphael_core.computer.seats import ComputerSeats
    vm, runtime = shared_vm
    vm.seats = ComputerSeats(count=1)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    try:
        await hub.prepare(1)
        cached = next(tool.key for tool in hub.offered_for(1) if tool.name == 'list_windows')
        await vm.seat(2)
        runtime.raw = container(vm, vm.target(2), runtime)
        vm.seat_windows = AsyncMock(side_effect=OSError('List failed'))
        with vm_scope(('turn', 1, 1)):
            result = await hub.call(cached, {}, approver='auto')
        assert result.ok and result.kind == 'computer_busy'
        assert 'every screen of the computer is in use' in result.text and not result.blocks
        assert vm.target(1).screen == 0 and vm.target(2).screen == 1
    finally:
        await hub.aclose()

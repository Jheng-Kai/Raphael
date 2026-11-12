"""The core seat wall with measured driver windows and in-memory sessions."""

import asyncio
import base64
import json
from copy import deepcopy
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from raphael_core.computer import vm as module
from raphael_core.computer.viewer import DesktopViewer, Session
from raphael_core.computer.vm_tools import VmTools, vm_scope
from raphael_core.computer.vm_catalog import offline_catalog
from raphael_core.protocol import RpcError
from raphael_core.services.attachment_store import AttachmentStore
from .test_seat_wiring import shared_vm
from .test_vm import EmptyHub, container


def window(identifier, x, app="Xfce4-terminal", pid=None):
    return dict(window_id=identifier, pid=pid or identifier, title=app, app_name=app,
                bounds=dict(x=x, y=30, width=600, height=400))


class SeatBridge:
    alive = True

    def __init__(self, vm, target):
        self.vm, self.target, self.calls = vm, target, []
        self.rows = [window(10, 20), window(20, 1300), window(30, 2580, "Chromium-browser", 99)]

    async def request(self, method, params):
        assert method == "tools/call"
        name, args = params["name"], params["arguments"]
        self.calls.append((name, deepcopy(args)))
        state = {"windows": deepcopy(self.rows)} if name == "list_windows" else {}
        if name == "get_window_state":
            state = deepcopy(next(w for w in self.rows if w["window_id"] == args["window_id"]))
            state["coordinate_frame"] = "window"
            state["nodes"] = [{"bounds": dict(x=5, y=6, width=10, height=10)}]
        if name == "get_cursor_position":
            state = dict(x=1310, y=40)
        if name == "launch_app":
            self.rows.append(window(40, 2600))
        if name == "get_browser_state":
            state = dict(target_id="own-target", tabs=[dict(tab_id="tab", active=True)])
        return dict(content=[dict(type="text", text=json.dumps(state))], structuredContent=state)

    async def __aexit__(self, *args):
        self.alive = False


@pytest.fixture
async def seat_tools(shared_vm, tmp_path):
    vm, runtime = shared_vm
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=SeatBridge)
    for member in (1, 2):
        await hub.prepare(member)
        target = vm.target(member)
        hub.connections[target.key] = SeatBridge(vm, target), f"session-{member}"
        hub.listed.add(target.key)
    runtime.raw = container(vm, vm.target(1), runtime)
    yield hub, vm, runtime
    await hub.aclose()


async def call(hub, member, name, args):
    tool = next(tool for tool in hub.offered_for(member) if tool.name == name)
    with vm_scope(("turn", member, 1)):
        return await hub.call(tool.key, args, approver="auto")


async def test_lists_only_own_windows_in_seat_coordinates(seat_tools):
    hub, vm, _ = seat_tools
    result = await call(hub, 2, "list_windows", {})
    assert result.ok and "window_id=20" in result.text
    assert "window_id=10" not in result.text and "window_id=30" not in result.text
    assert "600x400+20+30" in result.text


@pytest.mark.parametrize("name", [name for name, schema in offline_catalog().items()
                                 if "window_id" in schema["parameters"].get("properties", {})])
async def test_every_window_tool_refuses_foreign_windows_before_dispatch(seat_tools, name):
    hub, vm, _ = seat_tools
    client, session = hub.connections[vm.target(1).key]
    result = await hub._driver_call(vm.target(1), client, name,
                                    dict(window_id=20, pid=20, session=session))
    assert result["isError"] and "not on this member's screen" in str(result)
    assert "list_windows" in str(result)
    assert all(sent != name for sent, _ in client.calls)


@pytest.mark.parametrize("name,args", [("click", dict(x=5, y=6)), ("type_text", dict(text="hello")),
    ("press_key", dict(key="Return")), ("hotkey", dict(keys=["CTRL", "L"])),
    ("scroll", dict(direction="down")), ("bring_to_front", dict(pid=10))])
async def test_ambient_native_input_is_refused(seat_tools, name, args):
    hub, vm, _ = seat_tools
    client, session = hub.connections[vm.target(1).key]
    result = await hub._driver_call(vm.target(1), client, name, {**args, "session": session})
    assert result["isError"] and "name one" in str(result)
    assert not client.calls


async def test_explicit_desktop_scope_is_refused_even_with_an_own_window(seat_tools):
    hub, vm, _ = seat_tools
    client, session = hub.connections[vm.target(1).key]
    reply = await hub._driver_call(vm.target(1), client, "click",
                                  dict(window_id=10, pid=10, scope="desktop", x=5, y=6, session=session))
    assert reply["isError"] and not client.calls


@pytest.mark.parametrize("point", [(-1, 0), (1280, 0), (0, 900)])
async def test_cursor_cannot_leave_the_callers_screen(seat_tools, point):
    hub, vm, _ = seat_tools
    client, session = hub.connections[vm.target(2).key]
    reply = await hub._driver_call(vm.target(2), client, "move_cursor", dict(x=point[0], y=point[1], session=session))
    assert reply["isError"] and not client.calls


async def test_pid_mismatch_and_window_moved_since_previous_call_are_refused(seat_tools):
    hub, vm, _ = seat_tools
    client, session = hub.connections[vm.target(2).key]
    args = dict(window_id=20, pid=10, session=session)
    assert (await hub._driver_call(vm.target(2), client, "get_window_state", args))["isError"]
    args["pid"] = 20
    assert not (await hub._driver_call(vm.target(2), client, "get_window_state", args)).get("isError")
    client.rows[1]["bounds"]["x"] = 2600
    client.calls.clear()
    assert (await hub._driver_call(vm.target(2), client, "click", args))["isError"]
    assert [name for name, _ in client.calls] == ["list_windows"]


async def test_cursor_and_window_results_use_seat_coordinates(seat_tools):
    hub, vm, _ = seat_tools
    result = await call(hub, 2, "get_cursor_position", {})
    assert json.loads(result.text) == dict(x=30, y=40)
    result = await call(hub, 1, "get_cursor_position", {})
    assert "another screen" in result.text and '"x"' not in result.text
    result = await call(hub, 2, "get_window_state", dict(pid=20, window_id=20))
    state = json.loads(result.text.splitlines()[0])
    assert state["bounds"]["x"] == 20
    assert state["nodes"][0]["bounds"]["x"] == 5
    await call(hub, 2, "move_cursor", dict(x=40, y=50))
    client, _ = hub.connections[vm.target(2).key]
    assert client.calls[-1][1]["x"] == 1320


async def test_desktop_picture_uses_only_the_seat_rfb_view(seat_tools, monkeypatch):
    from raphael_core.computer import rfb_view
    hub, vm, _ = seat_tools
    captured = []
    def capture(port, password, screen, **kwargs):
        captured.append((port, password, screen))
        return b"\x89PNG\r\n\x1a\nimage"
    monkeypatch.setattr(rfb_view, "capture", capture)
    result = await call(hub, 2, "get_desktop_state", {})
    assert result.ok and captured == [(6080, "private", 2)]
    assert result.blocks[0]["data"] == base64.b64encode(b"\x89PNG\r\n\x1a\nimage").decode()
    assert "window_id=20" in result.text and "window_id=10" not in result.text
    assert all(name != "get_desktop_state" for name, _ in hub.connections[vm.target(2).key][0].calls)


async def test_launch_moves_only_new_foreign_windows_under_native_lock(seat_tools):
    hub, vm, runtime = seat_tools
    original = vm.run_for
    async def run(target, args, **kwargs):
        if "wmctrl" in args:
            assert vm.native_busy(target)
        return await original(target, args, **kwargs)
    vm.run_for = run
    assert (await call(hub, 2, "launch_app", dict(name="xfce4-terminal"))).ok
    moves = [args for args, _ in runtime.calls if "wmctrl" in args]
    assert len(moves) == 1 and moves[0][-6:] == ["wmctrl", "-i", "-r", "40", "-e", "0,1300,20,-1,-1"]


async def test_shared_browser_attaches_computer_window_and_never_launches_driver_browser(seat_tools):
    hub, vm, runtime = seat_tools
    client, _ = hub.connections[vm.target(2).key]
    async def launch(target):
        assert vm.native_busy(target)
        client.rows.append(window(50, 1320, "Chromium-browser", 99))
        return dict(pid=99, window_id=50)
    vm.seat_browser = launch
    result = await call(hub, 2, "browser_open", dict(url="about:blank"))
    assert result.ok
    prepared = [args for name, args in client.calls if name == "browser_prepare"]
    assert prepared == [dict(pid=99, window_id=50, strategy=dict(kind="existing_profile"), session="session-2")]
    client.calls.clear()
    result = await call(hub, 2, "browser_prepare", dict(allow_launch=True, profile=dict(mode="isolated_new")))
    assert result.ok
    assert client.calls[-1] == ("browser_prepare", prepared[0])


async def test_browser_launcher_pid_must_match_the_fresh_own_window(seat_tools):
    hub, vm, _ = seat_tools
    vm.seat_browser = AsyncMock(return_value=dict(pid=999, window_id=20))
    client, session = hub.connections[vm.target(2).key]
    result = await hub._driver_call(vm.target(2), client, "browser_prepare", dict(session=session))
    assert result["isError"] and all(name != "browser_prepare" for name, _ in client.calls)


@pytest.mark.parametrize("other_kind", ["page", "read", "command"])
async def test_owner_can_take_seat_while_another_seat_works(seat_tools, other_kind):
    hub, vm, _ = seat_tools
    first, second = vm.target(1), vm.target(2)
    vm.active[second.key] = 1
    if other_kind == "command":
        hub.commands[second.key] = 1
    viewer = DesktopViewer(vm)
    viewer.sessions["owner"] = Session(first, vm.clock() + 100, member_id=1)
    viewer.sessions["owner"].sockets.add("connected")
    assert (await viewer.control(dict(session="owner", held=True)))["control"] == "owner"


async def test_peer_native_wait_preserves_its_existing_connection_and_bound_pages(seat_tools):
    hub, vm, _ = seat_tools
    first, second = vm.target(1), vm.target(2)
    connection = hub.connections[second.key]
    hub.busy_wait_s = .01
    vm.hold(first, True)
    try:
        result = await call(hub, 2, "click", dict(pid=20, window_id=20, x=5, y=6))
        assert result.kind == "computer_busy"
        assert hub.connections.get(second.key) == connection and connection[0].alive
        assert (await call(hub, 2, "get_browser_state", dict(target_id="own-target"))).ok
    finally:
        vm.hold(first, False)


async def test_owner_refuses_own_activity_or_any_inflight_native_call(seat_tools):
    hub, vm, _ = seat_tools
    first, second = vm.target(1), vm.target(2)
    viewer = DesktopViewer(vm)
    viewer.sessions["owner"] = Session(first, vm.clock() + 100, member_id=1)
    viewer.sessions["owner"].sockets.add("connected")
    vm.active[first.key] = 1
    with pytest.raises(RpcError, match="busy"):
        await viewer.control(dict(session="owner", held=True))
    hub.commands[first.key] = 1
    assert (await viewer.control(dict(session="owner", held=True)))["control"] == "owner"
    await viewer.control(dict(session="owner", held=False))
    lock = hub.native_actions.setdefault(second.state_key, asyncio.Lock())
    await lock.acquire()
    try:
        with pytest.raises(RpcError, match="busy"):
            await viewer.control(dict(session="owner", held=True))
    finally:
        lock.release()


@pytest.mark.parametrize("activity,refused", [("own", True), ("native", True), ("peer", False)])
async def test_takeover_rechecks_activity_after_the_async_status_probe(seat_tools, activity, refused):
    hub, vm, _ = seat_tools
    first, second = vm.target(1), vm.target(2)
    viewer = DesktopViewer(vm)
    viewer.sessions["owner"] = Session(first, vm.clock() + 100, member_id=1)
    lock = hub.native_actions.setdefault(second.state_key, asyncio.Lock())
    async def status(target):
        if activity == "native" and not lock.locked():
            await lock.acquire()
        elif activity == "own":
            vm.active[first.key] = 1
        else:
            vm.active[second.key] = 1
        return dict(state="running", ready=True)
    viewer.status_for = status
    try:
        if refused:
            with pytest.raises(RpcError, match="busy"):
                await viewer.control(dict(session="owner", held=True))
        else:
            assert (await viewer.control(dict(session="owner", held=True)))["control"] == "owner"
    finally:
        if lock.locked():
            lock.release()


async def test_member_takeover_request_allows_another_seats_page_or_command(seat_tools):
    hub, vm, _ = seat_tools
    vm.active[vm.target(2).key] = 1
    vm.work.request = AsyncMock(return_value={"status": "owner"})
    tool = next(tool for tool in hub.offered_for(1) if tool.name == "request_takeover")
    with vm_scope(("turn", 1, 1), turn_id=1, private=True):
        result = await hub.call(tool.key, {"reason": "sign_in"}, approver="auto")
    assert result.ok and result.kind is None
    vm.work.request.assert_awaited_once()


def test_move_window_argv_preserves_the_host_and_never_uses_a_shell(tmp_path):
    from dataclasses import replace
    vm = module.LocalVm(tmp_path, runner=object())
    target = replace(vm.shared_target("studio", 1, 6), screen=6)
    args = module.move_window_args(target, 123)
    assert args[-7:] == [target.name, "wmctrl", "-i", "-r", "123", "-e", "0,2580,920,-1,-1"]
    assert "sh" not in args and args[args.index("-u") + 1] == "cua"
    with pytest.raises(ValueError):
        module.move_window_args(target, "123; rm")


async def test_shared_tool_description_additions_are_small_and_per_bot_is_unchanged(seat_tools):
    from raphael_core.computer.vm_tools import SHARED_CONTRACT
    hub, vm, _ = seat_tools
    shared = {tool.name: tool for tool in hub.offered_for(1)}
    assert len(SHARED_CONTRACT) <= 72
    assert all(tool.description.endswith(SHARED_CONTRACT) for tool in shared.values())
    vm.settings.set("computer_vm_mode", "per-bot")
    await hub.prepare(1)
    own = {tool.name: tool for tool in hub.offered_for(1)}
    for name in shared:
        assert shared[name].description == own[name].description + SHARED_CONTRACT


async def test_displacement_closes_screen_windows_except_panel_and_never_raises(seat_tools):
    hub, vm, runtime = seat_tools
    runtime.calls.clear()
    vm.seat_windows = AsyncMock(return_value={"windows": [window(10, 20), window(11, 20, "Xfce4-panel"), window(20, 1300)]})
    await vm.close_displaced_seat_windows(vm.target(1))
    closed = [args for args, _ in runtime.calls if "wmctrl" in args]
    assert len(closed) == 1 and closed[0][-4:] == ["wmctrl", "-i", "-c", "10"]
    vm.seat_windows.side_effect = OSError("gone")
    await vm.close_displaced_seat_windows(vm.target(1))


def test_disconnected_window_listing_joins_geometry_and_class_without_losing_titles():
    from raphael_core.computer.seat_view import wmctrl_windows, windows
    geometry = "0x0a 0 20 30 600 400 host Terminal with spaces\n0x0b 0 567 851 146 49 host Panel\n0x0c 0 1300 30 600 400 host Neighbour"
    classes = "0x0a 0 xfce4-terminal.Xfce4-terminal host Terminal with spaces\n0x0b 0 xfce4-panel.Xfce4-panel host Panel"
    result = windows(wmctrl_windows(geometry, classes), 1, 6)["windows"]
    assert [(row["window_id"], row["app_name"], row["title"]) for row in result] == [
        (10, "xfce4-terminal", "Terminal with spaces"), (11, "xfce4-panel", "Panel")]


async def test_launcher_uses_only_the_seat_rectangle_and_checks_its_output(seat_tools):
    _, vm, _ = seat_tools
    vm.run_for = AsyncMock(return_value=module.Result(0, "pid=99 window_id=301\n"))
    assert await vm.seat_browser(vm.target(2)) == dict(pid=99, window_id=301)
    args = vm.run_for.call_args.args[1]
    assert args[-5:] == ["raphael-seat-browser", "1280", "0", "1280", "900"]
    for result in (module.Result(1, ""), module.Result(0, "pid=0 window_id=301"), module.Result(0, "unrecognized")):
        vm.run_for.return_value = result
        with pytest.raises(module.VmError, match="browser_window_missing"):
            await vm.seat_browser(vm.target(2))


def test_layer_six_installs_computer_browser_and_existing_profile_grant():
    image = Path(module.__file__).parent / "image"
    dockerfile = (image / "Dockerfile").read_text(encoding="utf-8")
    assert '--permission-mode standard --grant existing-profile' in dockerfile
    assert 'install -m 0755 /opt/raphael-desktop/raphael-seat-browser /usr/local/bin/raphael-seat-browser' in dockerfile
    assert module.IMAGE.endswith("-v6") and module.IMAGE_LABELS[f"{module.LABEL}.layer"] == "6"
    launcher = (image / "desktop/raphael-seat-browser").read_text(encoding="utf-8")
    assert "wmctrl -lG" in launcher and '"$attempt" -lt 50' in launcher
    assert 'about:blank' in launcher and '${5' not in launcher


@pytest.mark.parametrize("shared,screens", [(False, 1), (True, 1), (True, 6)])
async def test_layer_five_shapes_upgrade_with_mounts_kept(shared_vm, shared, screens):
    from dataclasses import replace
    vm, runtime = shared_vm
    target = await vm.seat(1) if shared else vm.target_for("", vm.key_for("", 1))
    previous = replace(target, screens=screens, screen=1, container="" if screens == 1 else target.container)
    raw = container(vm, previous, runtime)
    raw["Config"]["Labels"][f"{module.LABEL}.target"] = target.unit
    raw["Config"]["Labels"][f"{module.LABEL}.layer"] = "5"
    assert module.known_previous(raw, target, vm.owner)
    raw["HostConfig"]["NanoCpus"] += 1
    assert not module.known_previous(raw, target, vm.owner)

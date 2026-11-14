"""The core seat wall with measured driver windows and in-memory sessions."""

import asyncio
import base64
import json
import re
import shutil
import subprocess
import sys
import time
from copy import deepcopy
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from raphael_core.computer import vm as module
from raphael_core.computer.viewer import DesktopViewer, Session
from raphael_core.computer.vm_tools import VmTools, vm_scope
from raphael_core.computer.vm_catalog import DRIVER_TOOLS, offline_catalog, without_session
from raphael_core.protocol import RpcError
from raphael_core.services.attachment_store import AttachmentStore
from .test_seat_wiring import shared_vm
from .test_vm import EmptyHub, container
from .fixtures.driver_contract import SCHEMAS, catalog, validate_call, runtime_refusal


def window(identifier, x, app="Xfce4-terminal", pid=None):
    return dict(window_id=identifier, pid=pid or identifier, title=app, app_name=app,
                bounds=dict(x=x, y=30, width=600, height=400))


class SeatBridge:
    alive = True

    def __init__(self, vm, target):
        self.vm, self.target, self.calls = vm, target, []
        self.rows = [window(10, 20), window(20, 1300), window(30, 2580, "Chromium-browser", 99)]

    async def request(self, method, params, **kwargs):
        validate_call(method, params)
        refusal = runtime_refusal(method, params)
        if refusal:
            return refusal
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
            state = dict(pid=40, windows=[deepcopy(self.rows[-1])])
        if name == "get_browser_state":
            state = dict(target_id="own-target", tabs=[dict(tab_id="tab", active=True, url="https://example.com")])
        text = json.dumps(state)
        if name == "get_window_state":
            text = f"window_id={args['window_id']}\n[1] button\nelement_token for row [1] = s00000001:1"
        if name.startswith("browser_") or name == "get_browser_state":
            text = "Bound page with current references."
        return dict(content=[dict(type="text", text=text)], structuredContent=state)

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
        hub._catalog(target, {name: dict(description=DRIVER_TOOLS[name], parameters=without_session(schema)) for name, schema in SCHEMAS.items()})
        hub.listed.add(target.key)
    runtime.raw = container(vm, vm.target(1), runtime)
    yield hub, vm, runtime
    await hub.aclose()


async def call(hub, member, name, args):
    tool = next(tool for tool in hub.offered_for(member) if tool.name == name)
    with vm_scope(("turn", member, 1)):
        return await hub.call(tool.key, args, approver="auto")


@pytest.mark.parametrize('name', ['get_window_state', 'get_desktop_state'])
async def test_a_moved_private_window_withholds_peer_product_pictures(seat_tools, monkeypatch, name):
    from raphael_core.computer.rfb_view import png
    hub, vm, _ = seat_tools
    first, second = vm.target(1), vm.target(2)
    client, session = hub.connections[second.key]
    rows = client.rows
    rows[0]['bounds']['x'] = 1300
    hub.page_windows[first.key, 'private-target'] = ('marker-session', 10, 10)
    hub._protect_page(first, 'private-target', 'https://example.com', ['secret'], tab_id='private-tab')
    monkeypatch.setattr(vm, 'window_bounds', AsyncMock(return_value={'windows': rows}))
    picture = png([b'\x00\x00\x00'], 1, 1)
    monkeypatch.setattr('raphael_core.computer.rfb_view.capture', lambda *args: picture)
    original = client.request
    async def request(method, params):
        reply = await original(method, params)
        if params['name'] == 'get_window_state':
            reply['content'].append(dict(type='image', mimeType='image/png', data=base64.b64encode(picture).decode()))
        return reply
    client.request = request
    args = dict(pid=10, window_id=10, include_screenshot=True) if name == 'get_window_state' else {}
    hidden = await call(hub, 2, name, args)
    assert hidden.ok and not hidden.blocks and 'no screenshot was returned' in hidden.text
    own = await call(hub, 1, 'get_desktop_state', {})
    assert own.ok and not own.blocks  # The marker's seat stays protected even while its window is elsewhere.
    hub.private_pages.clear()
    assert (await call(hub, 2, name, args)).blocks


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


@pytest.mark.parametrize("named", [dict(), dict(pid=99), dict(include_screenshot=False),
                                   dict(target_id="2", tab_id="2"), dict(target_id="peer-target")])
async def test_a_page_read_that_names_the_browser_or_nothing_reads_the_seats_own_browser_window(seat_tools, named):
    # A real member's turn at a seat (2026-11-12): browser_prepare, then get_browser_state with the browser's pid
    # only, was told "the window is not on this member's screen" about its own window, and gave up.
    hub, vm, _ = seat_tools
    client, session = hub.connections[vm.target(1).key]
    client.rows.append(window(50, 100, "Chromium-browser", 99))
    result = await hub._driver_call(vm.target(1), client, "get_browser_state", {**named, "session": session}, own=True)
    assert not result.get("isError"), result
    sent = [args for name, args in client.calls if name == "get_browser_state"]
    assert len(sent) == 1 and (sent[0]["window_id"], sent[0]["pid"]) == (50, 99)
    # Ids the member never bound are not sent on: the reply names the real ones.
    assert "target_id" not in sent[0] and "tab_id" not in sent[0]


@pytest.mark.parametrize("rows,named,words", [
    ([], dict(), "Name one of this member's own windows"),
    ([], dict(pid=99), "Name one of this member's own windows"),
    ([(50, 100, 99), (51, 300, 99)], dict(pid=99), "Name one of this member's own windows"),
    ([(50, 100, 99)], dict(pid=77), "Name one of this member's own windows"),
    ([], dict(target_id="2"), "bind an own window again"),
    ([(50, 100, 99), (51, 300, 99)], dict(target_id="2", tab_id="2"), "bind an own window again"),
])
async def test_a_page_read_guesses_no_window_when_the_seat_has_none_or_several(seat_tools, rows, named, words):
    hub, vm, _ = seat_tools
    client, session = hub.connections[vm.target(1).key]
    client.rows += [window(identifier, x, "Chromium-browser", pid) for identifier, x, pid in rows]
    result = await hub._driver_call(vm.target(1), client, "get_browser_state", {**named, "session": session}, own=True)
    # Window 30 is a browser of the same process on another member's screen: never the one meant.
    assert result["isError"] and words in str(result)
    assert all(name != "get_browser_state" for name, _ in client.calls)


@pytest.mark.parametrize("named", [dict(), dict(target_id="2", tab_id="2")])
async def test_what_the_core_reads_for_a_member_never_finds_another_window(seat_tools, named):
    # The private-page gate and the saved fills read a page by its ids. A read that settled for "the member's
    # browser window" would judge, or type into, another tab than the one asked for.
    hub, vm, _ = seat_tools
    client, session = hub.connections[vm.target(1).key]
    client.rows.append(window(50, 100, "Chromium-browser", 99))
    result = await hub._driver_call(vm.target(1), client, "get_browser_state", {**named, "session": session})
    assert result["isError"] and all(name != "get_browser_state" for name, _ in client.calls)


async def test_a_process_alone_is_not_called_a_window_off_the_screen(seat_tools):
    hub, vm, _ = seat_tools
    client, session = hub.connections[vm.target(1).key]
    result = await hub._driver_call(vm.target(1), client, "get_window_state", dict(pid=10, session=session))
    assert result["isError"] and "pass window_id with pid" in str(result) and "not on this member's screen" not in str(result)
    assert all(name != "get_window_state" for name, _ in client.calls)


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
    assert result.text == "✅ Cursor at (30, 40)"  # the driver's own sentence, with this screen's point
    result = await call(hub, 1, "get_cursor_position", {})
    assert "another screen" in result.text and '"x"' not in result.text
    result = await call(hub, 2, "get_window_state", dict(pid=20, window_id=20))
    assert result.text.startswith("window_id=20") and "element_token for row [1]" in result.text
    client, session = hub.connections[vm.target(2).key]
    reply = await hub._driver_call(vm.target(2), client, "get_window_state", dict(pid=20, window_id=20, session=session))
    state = reply["structuredContent"]
    assert state["bounds"]["x"] == 20
    assert state["nodes"][0]["bounds"]["x"] == 5
    await call(hub, 2, "move_cursor", dict(x=40, y=50))
    client, _ = hub.connections[vm.target(2).key]
    assert client.calls[-1][1]["x"] == 1320
    # "desktop" is how the driver's own guide says to move the real pointer: the same point, the same translation.
    await call(hub, 2, "move_cursor", dict(x=40, y=50, scope="desktop"))
    assert client.calls[-1][0] == "move_cursor" and (client.calls[-1][1]["x"], client.calls[-1][1]["y"], client.calls[-1][1]["scope"]) == (1320, 50, "desktop")


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
    assert prepared == [dict(pid=99, window_id=50, strategy=dict(kind="existing_profile"), session="session-2", delivery_mode="foreground")]
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
    assert (await call(hub, 2, "get_browser_state", dict(pid=20, window_id=20))).ok
    vm.hold(first, True)
    try:
        result = await call(hub, 2, "click", dict(pid=20, window_id=20, x=5, y=6))
        assert result.kind == "computer_busy"
        assert hub.connections.get(second.key) == connection and connection[0].alive
        assert (await call(hub, 2, "get_browser_state", dict(target_id="own-target", tab_id="tab"))).ok
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
    from raphael_core.computer.vm_tools import SHARED_CONTRACT, SHARED_NOTED
    hub, vm, _ = seat_tools
    shared = {tool.name: tool for tool in hub.offered_for(1)}
    assert len(SHARED_CONTRACT) <= 160
    assert "The shell has no screen here; open a window with launch_app." in SHARED_CONTRACT
    # On the tools it is about (the shell, opening a window, the clipboard), not said once per tool.
    assert SHARED_NOTED == {"vm_exec", "launch_app", "clipboard_read", "clipboard_write"} <= shared.keys()
    vm.settings.set("computer_vm_mode", "per-bot")
    await hub.prepare(1)
    own = {tool.name: tool for tool in hub.offered_for(1)}
    for name in shared:
        assert shared[name].description == own[name].description + (SHARED_CONTRACT if name in SHARED_NOTED else "")


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


def test_layer_seven_installs_computer_browser_and_existing_profile_grant():
    image = Path(module.__file__).parent / "image"
    dockerfile = (image / "Dockerfile").read_text(encoding="utf-8")
    assert '--permission-mode standard --grant existing-profile' in dockerfile
    assert 'install -m 0755 /opt/raphael-desktop/raphael-seat-browser /usr/local/bin/raphael-seat-browser' in dockerfile
    # Layer 6 is main's (the desktop's picture, its keys, a lost X server); the seat browser and the grant came on top
    # as 7, 8 is what a computer has from its first start (Google's Chrome, the tools, the fonts), 9 is the
    # desktop saying which browser that is, and 10 is the computer without Firefox ESR.
    assert module.IMAGE.endswith("-v11") and module.IMAGE_LABELS[f"{module.LABEL}.layer"] == "11"
    assert 'org.raphael.computer.layer="11"' in dockerfile and "librsvg2-common" in dockerfile
    launcher = (image / "layer11/raphael-seat-browser").read_text(encoding="utf-8")
    assert "wmctrl -lG" in launcher and "settle_deadline" in launcher
    assert 'data:text/html,<title>$marker</title>' in launcher and '${5' not in launcher
    assert "uniq -u" not in launcher and '!($0 in old)' in launcher
    # The title is not at a fixed column: the class of a browser with its own profile folder has a space in it.
    assert '$3 == pid' in launcher and 'if ($i == marker)' in launcher and '$6 == marker' not in launcher


def test_a_loaded_pc_gets_a_minute_for_the_browsers_window_and_every_outer_bound_outlasts_it():
    # Owner, 2026-11-14: 「你就一次把所有東西都修復吧」. On a loaded PC (2026-11-13) a browser's first window took 13 to 41 s
    # and members saw browser_window_missing: the launcher waited 15 s (150 looks of 0.1 s, each look several processes,
    # so a loaded PC counted fewer seconds still), the settle wait 5 s, the driver's own launch 5 s.
    from raphael_core.computer import carry
    launcher = (Path(module.__file__).parent / "image/layer11/raphael-seat-browser").read_text(encoding="utf-8")
    assert '-lt 150' not in launcher and '-lt 50' not in launcher
    first = int(re.search(r'deadline=\$\(\( \$\(date \+%s\) \+ (\d+) \)\)', launcher)[1])
    settle = int(re.search(r'settle_deadline=\$\(\( \$\(date \+%s\) \+ (\d+) \)\)', launcher)[1])
    assert first >= 60 and settle >= 30
    assert f"within {first} seconds" in launcher and f"within {settle} seconds" in launcher
    # The script ends itself and says why; every bound outside it is longer, so its answer is the one a member reads.
    assert module.LocalVm.seat_browser_s > first + settle
    assert VmTools.browser_open_s > carry.BUDGET_SECONDS + module.LocalVm.seat_browser_s
    assert VmTools.browser_window_wait_s >= 60 and VmTools.browser_open_s > VmTools.browser_window_wait_s + 60


@pytest.mark.parametrize("appears_after", [0, 2, None])
def test_the_launcher_waits_for_the_window_by_the_clock_and_then_says_how_long(appears_after, tmp_path):
    launcher = (Path(module.__file__).parent / "image/layer11/raphael-seat-browser").read_text(encoding="utf-8")
    shell = shutil.which("sh")
    if shell is None:
        pytest.skip("An installed POSIX shell is required for the launcher's wait test")
    loop = launcher[launcher.index("new=\nattempt=0"):launcher.index("# The browser opens a new window beside its first")]
    # The launcher's deadline is in whole seconds (`date +%s`): a wait of N seconds ends after N-1 to N, so 3 here waits at least 2.
    loop = re.sub(r"(deadline=\$\(\( \$\(date \+%s\) \+ )60", r"\g<1>3", loop)
    count = (tmp_path / "looks").as_posix()
    after = 10**6 if appears_after is None else appears_after
    script = f'''set -eu
before=
main=99
marker=raphael-seat-test
window_class=chromium-browser
looks() {{ cat {count} 2>/dev/null || echo 0; }}
windows() {{ if [ "$(looks)" -ge {after} ]; then echo 0x5; fi; }}
browser_pid() {{ echo 99; }}
wmctrl() {{
  n=$(looks); echo $((n + 1)) > {count}
  if [ "$n" -ge {after} ]; then
    echo "0x5  0 99 chromium-browser.Chromium-browser host raphael-seat-test - Chromium"
  fi
}}
''' + loop + '\necho "found $new"\n'
    began = time.monotonic()
    result = subprocess.run([shell], input=script, text=True, capture_output=True, timeout=30)
    took = time.monotonic() - began
    if appears_after is None:
        assert result.returncode == 1 and "no browser window appeared within 60 seconds" in result.stderr
        assert 2 <= took < 20, took  # by the clock: three seconds here, however many looks that took
    else:
        assert result.returncode == 0 and result.stdout.strip() == "found 0x5", result
        # It stops at the look that finds the window, counted rather than timed: a loaded CI runner took 8.8 s over one look.
        assert int((tmp_path / "looks").read_text()) == after + 1


@pytest.mark.parametrize("late", [False, True])
async def test_a_window_the_manager_moves_slowly_is_waited_for_before_it_is_called_outside_the_screen(seat_tools, late):
    # Half a second (ten looks of 0.05 s) was all a moved window had to reach its screen; a loaded PC takes longer.
    hub, vm, _ = seat_tools
    client, session = hub.connections[vm.target(2).key]
    client.rows[1]["bounds"].update(x=1200, width=2000, height=950)
    first = None
    original = client.request
    async def request(method, params, **kwargs):
        nonlocal first
        if params["name"] == "list_windows":
            first = first or time.monotonic()
            if late and time.monotonic() - first >= 1.0:
                client.rows[1]["bounds"].update(x=1300, y=20, width=1240, height=860)
        return await original(method, params, **kwargs)
    client.request = request
    vm.fit_window = AsyncMock()
    hub.window_fit_wait_s = 6.0 if late else 0.3
    reply = await hub._driver_call(vm.target(2), client, "get_window_state", dict(pid=20, window_id=20, session=session))
    assert bool(reply.get("isError")) is not late
    assert time.monotonic() - first >= (1.0 if late else 0.3)


def test_the_computer_starts_with_googles_chrome_the_tools_and_the_fonts():
    # Owner, 2026-11-13, of Grok Bot's computer: 「他們會有 chrome 等等之類的 我們一開始就要把環境架設好了 不會只有 cua」.
    # Nothing in a computer is root: what is not in the image a member cannot add.
    image = Path(module.__file__).parent / "image"
    dockerfile = (image / "Dockerfile").read_text(encoding="utf-8")
    for package in ("git", "wget", "zip", "unzip", "jq", "ripgrep", "npm", "sqlite3", "poppler-utils", "build-essential",
                    "fonts-noto-cjk", "fonts-noto-color-emoji"):
        assert f" {package}" in dockerfile, package
    # Google's own build, from Google's repository and under Google's key, only where there is one.
    assert 'if [ "$(dpkg --print-architecture)" = amd64 ]; then' in dockerfile
    assert "signed-by=/usr/share/keyrings/google-linux.asc] https://dl.google.com/linux/chrome/deb/ stable main" in dockerfile
    assert "apt-get install -y --no-install-recommends google-chrome-stable;" in dockerfile
    launcher = (image / "layer11/raphael-seat-browser").read_text(encoding="utf-8")
    assert "if [ -x /opt/google/chrome/chrome ]; then" in launcher and "chromium=/usr/lib/chromium/chromium window_class=chromium-browser" in launcher


def test_the_desktop_names_the_browser_it_opens_and_every_way_to_a_browser_opens_it():
    # Owner, 2026-11-13, of the panel of his members' computer: 「但看起來底下不是顯示 Chrome ㄟ?」. Measured on layer 8:
    # the launcher wore a globe named "Browser" over Google Chrome; XFCE's "Web Browser" named a helper that does
    # not exist and asked which application to prefer; the menu's own Chrome entry and x-www-browser could not
    # start (they make a sandbox); the menu's Chromium and Firefox were second browsers with profiles of their own.
    image = Path(module.__file__).parent / "image"
    dockerfile = (image / "Dockerfile").read_text(encoding="utf-8")
    step = dockerfile[dockerfile.index("if [ -x /opt/google/chrome/chrome ]; then name='Google Chrome' icon=google-chrome;"):]
    step = step[:step.index("\n# ")]
    # Which browser there is, is known only after it was installed: the step that names it comes after that one.
    assert dockerfile.index("apt-get install -y --no-install-recommends google-chrome-stable;") < dockerfile.index(step)
    assert "else name=Chromium icon=chromium; fi;" in step
    # A mark that is not among the icons would be drawn as nothing: the build stops there.
    assert 'test -e "/usr/share/icons/hicolor/48x48/apps/$icon.png";' in step
    assert ("for file in /home/cua/.config/xfce4/panel/launcher-*/browser.desktop "
            "/home/cua/.local/share/applications/raphael-browser.desktop; do") in step
    assert 'sed -i -e "s/^Name=.*/Name=$name/" -e "s/^Icon=.*/Icon=$icon/" "$file";' in step
    # XFCE's own "Web Browser".
    assert "'X-XFCE-Binaries=raphael-browser;' 'X-XFCE-Category=WebBrowser'" in step
    assert "> /usr/share/xfce4/helpers/raphael-browser.desktop;" in step
    assert "sed -i 's/^WebBrowser=.*/WebBrowser=raphael-browser/' /home/cua/.config/xfce4/helpers.rc;" in step
    assert "grep -qx 'WebBrowser=raphael-browser' /home/cua/.config/xfce4/helpers.rc;" in step
    # The menu's other browser entries start the computer's browser and are out of the menu. Firefox has none: it
    # is not in the computer.
    assert "for entry in google-chrome com.google.Chrome chromium; do" in step
    assert "'Exec=raphael-browser %U' \"Icon=$icon\" 'Terminal=false' 'NoDisplay=true'" in step
    assert "firefox" not in step.lower()
    assert 'update-alternatives --install "/usr/bin/$link" "$link" /usr/local/bin/raphael-browser 500;' in step
    assert 'test "$(readlink -f /usr/bin/x-www-browser)" = /usr/local/bin/raphael-browser' in step
    # The files are the session user's, as the ones they replace were.
    assert "chown cua:cua /home/cua/.config/xfce4/helpers.rc" in step
    # What the repository keeps is the entry before it is named: it starts the computer's browser either way.
    entry = (image / "desktop/browser.desktop").read_text(encoding="utf-8").splitlines()
    assert "Exec=raphael-browser %U" in entry


def test_firefox_esr_is_purged_and_nothing_that_opens_it_is_left():
    # Owner, 2026-11-14: 「Firefox 應該是沒有用了，你可以幫我把它從印象檔中移除，沒有關係。」 The members' browser is Google's
    # Chrome (Chromium on arm64) and the driver's is Chromium, so a browser the base image brought was only a place an
    # owner would sign in for nobody. Layer 9 had hidden its menu entry and kept the package.
    image = Path(module.__file__).parent / "image"
    dockerfile = (image / "Dockerfile").read_text(encoding="utf-8")
    start = dockerfile.index("RUN set -eux; \\\n    apt-get purge -y --auto-remove firefox-esr;")
    step = dockerfile[start:dockerfile.index("\n# ", start)]
    assert dockerfile.count("apt-get purge") == 1 and "apt-get remove" not in dockerfile
    # The step is after the browsers' own and before the one that names the desktop's browser: nothing before it is
    # run again on a PC that built layer 9.
    assert dockerfile.index("apt-get install -y --no-install-recommends google-chrome-stable;") < start
    assert start < dockerfile.index("if [ -x /opt/google/chrome/chrome ]; then name='Google Chrome' icon=google-chrome;")
    # The package, what the base put beside it that no package owns, and every way to find it again.
    assert "rm -rf /etc/firefox-esr /usr/lib/mozilla /usr/lib/firefox-esr /usr/share/xfce4/helpers/firefox.desktop /home/cua/.mozilla;" in step
    assert 'test -z "$(grep -ril firefox /usr/share/xfce4/helpers || true)";' in step
    # Each is a `test -z` of what is found: under `set -e` a negated command (`! grep ...`) never stops a build.
    assert 'test -z "$(dpkg-divert --list | grep -i firefox || true)";' in step
    assert 'test -z "$(dpkg -l | grep -i firefox || true)";' in step
    assert 'test -z "$(command -v firefox || command -v firefox-esr || true)";' in step
    assert 'test -z "$(grep -il firefox /usr/local/bin/raphael-browser /usr/share/applications/mimeinfo.cache || true)";' in step
    assert 'test -z "$(grep -il -e mozilla -e parentlock /usr/local/bin/prepare-raphael-workspace.sh || true)";' in step
    assert "test ! -e /usr/share/applications/firefox-esr.desktop;" in step
    # Chromium, the driver's browser and the arm64 members', survives the purge.
    assert step.rstrip().endswith("/usr/lib/chromium/chromium --version")
    # A menu entry for it is no longer made, nor is any hidden one.
    assert "firefox-esr.desktop" not in dockerfile.replace("/usr/share/applications/firefox-esr.desktop", "")
    # The two scripts that named it are rewritten in the image, not in desktop/ or in the step that wrote them: any
    # change there would make every step after it run again (Chrome and the packages downloaded anew).
    fallback = r"""sed -i 's|^exec firefox "\$@"$|echo "raphael-browser: this computer has no browser" >\&2; exit 1|' /usr/local/bin/raphael-browser;"""
    assert fallback in step
    assert r"""sed -i -e '/migrate_profile "\$HOME\/\.mozilla" mozilla/d' -e 's# "\$profiles/mozilla"##g'""" in step
    assert r"""-e 's/ -o -name \.parentlock -o -name lock -type l//' /usr/local/bin/prepare-raphael-workspace.sh;""" in step
    assert "sh -n /usr/local/bin/raphael-browser;" in step and "sh -n /usr/local/bin/prepare-raphael-workspace.sh;" in step
    assert "\n    ! " not in step
    # Run what the step runs on the script the repository keeps: no Firefox is left in it and it is still a shell script.
    sed, shell = shutil.which("sed"), shutil.which("sh")
    if sed is not None and shell is not None:
        source = (image / "desktop/raphael-browser").read_bytes().replace(b"\r\n", b"\n")
        rewritten = subprocess.run([sed, r's|^exec firefox "\$@"$|echo "raphael-browser: this computer has no browser" >\&2; exit 1|'],
                                   input=source, capture_output=True, timeout=10)
        assert rewritten.returncode == 0, rewritten.stderr
        assert b"firefox" not in rewritten.stdout.lower() and rewritten.stdout.rstrip().endswith(b"exit 1")
        assert subprocess.run([shell, "-n"], input=rewritten.stdout, capture_output=True, timeout=10).returncode == 0


def test_the_members_browser_is_never_signed_in_to_as_a_browser_and_keeps_nothing_typed():
    # Every member reads the one profile. Google's own Chrome offers an owner who signs in to Google on a page to
    # "turn on sync": his own passwords, history and bookmarks would come down into that profile. As policy, which
    # holds whatever a profile says, for Chrome and for Chromium.
    dockerfile = (Path(module.__file__).parent / "image" / "Dockerfile").read_text(encoding="utf-8")
    written = next(line for line in dockerfile.splitlines() if "BrowserSignin" in line)
    policy = json.loads(written[written.index("'{") + 1:written.index("}'") + 1])
    assert policy == {"BrowserSignin": 0, "SyncDisabled": True, "PasswordManagerEnabled": False,
                      "AutofillCreditCardEnabled": False, "AutofillAddressEnabled": False}
    assert "for folder in /etc/opt/chrome/policies/managed /etc/chromium/policies/managed; do" in dockerfile
    assert 'chmod 0644 "$folder/raphael.json"' in dockerfile


def test_the_shared_computers_browser_icon_opens_the_members_own_browser():
    # What an owner signs in to has to be every member's: the icon of a shared computer gives a window of the one
    # browser, on the screen the pointer is on, and never starts a second browser with a profile of its own.
    script = (Path(module.__file__).parent / "image/desktop/raphael-browser").read_text(encoding="utf-8")
    shared = script[script.index('if [ "${width:-0}" -gt 1280 ]; then'):script.index("\nfi\n")]
    assert "/usr/local/bin/raphael-seat-browser $origin 1280 900" in shared and "XQueryPointer" in shared
    assert 'exec "$browser" --user-data-dir="$profile" "$@"' in shared and "--no-sandbox" not in shared
    assert script.count("profile=/home/cua/workspace/.browser-profiles/driver/main") == 1
    # A computer of a member's own keeps the desktop's browser, and Google's Chrome there is told what Debian's
    # Chromium reads from /etc/chromium.d: without it the icon opened nothing.
    own = script[script.index("\nfi\n"):]
    chrome = own[own.index("google-chrome-stable"):own.index("for browser in /usr/bin/chromium")]
    # The last line of the source names Firefox; the image's step for layer 10 rewrites it (see the test of that step).
    assert "--no-sandbox --test-type" in chrome and own.rstrip().endswith('exec firefox "$@"')
    shell = shutil.which("sh")
    if shell is not None:
        assert subprocess.run([shell, "-n"], input=script, text=True, capture_output=True, timeout=10).returncode == 0


def test_the_members_browser_is_one_a_person_signs_in_with():
    # An owner signing in to Google for his members (2026-11-13): "This browser or app may not be secure", a yellow
    # bar about --no-sandbox, and "Restore pages?". A browser started with --remote-debugging-port=0 tells every
    # page it is automated; --test-type keeps the unsupported-flag bars away; a computer is stopped by ending its
    # processes, so the profile is marked as closed before the browser is started.
    launcher = (Path(module.__file__).parent / "image/layer11/raphael-seat-browser").read_text(encoding="utf-8")
    flags = next(line for line in launcher.splitlines() if line.startswith('flags="'))
    for flag in ("--disable-blink-features=AutomationControlled", "--test-type", "--hide-crash-restore-bubble", "--no-sandbox"):
        assert flag in flags.split('"')[1].split(), flag
    assert "--enable-automation" not in launcher and "--headless" not in launcher
    first = launcher[launcher.index('  mkdir -p "$profile"'):launcher.index("new=\nattempt=0")]
    assert first.index("ended_cleanly") < first.index('setsid "$chromium" --remote-debugging-port=0')


KEEPS_NOTHING = {"credentials_enable_service": False, "credentials_enable_autosignin": False,
                 "autofill": {"profile_enabled": False, "credit_card_enabled": False}}


@pytest.mark.parametrize("before,after", [
    ('{"profile":{"exit_type":"Crashed","exited_cleanly":false,"name":"Person 1","password_manager_enabled":true},"browser":{"x":1},'
     '"autofill":{"credit_card_enabled":true,"last_version_deduped":157},"credentials_enable_service":true}',
     {"profile": {"exit_type": "Normal", "exited_cleanly": True, "name": "Person 1", "password_manager_enabled": False},
      "browser": {"x": 1}, **KEEPS_NOTHING,
      "autofill": {"profile_enabled": False, "credit_card_enabled": False, "last_version_deduped": 157}}),
    ('{"browser":{"x":1}}', {"browser": {"x": 1}, **KEEPS_NOTHING,
                              "profile": {"exit_type": "Normal", "exited_cleanly": True, "password_manager_enabled": False}}),
    # A computer's first browser: the profile is made with what it must say before the browser writes the rest.
    (None, {**KEEPS_NOTHING, "profile": {"exit_type": "Normal", "exited_cleanly": True, "password_manager_enabled": False}}),
    ("not json", None), ('["a list"]', None), ('{"profile":"odd"}', None), ('{"autofill":7}', None),
])
def test_a_profile_whose_browser_was_ended_is_marked_closed_and_any_other_file_is_left(tmp_path, before, after):
    # The same step keeps passwords, cards and addresses out of the profile every member reads (2026-11-13: an owner
    # signing in at a seat was offered "Save password?").
    launcher = (Path(module.__file__).parent / "image/layer11/raphael-seat-browser").read_text(encoding="utf-8")
    source = launcher[launcher.index("<<'PY' || true\n") + len("<<'PY' || true\n"):launcher.index("\nPY\n")]
    preferences = tmp_path / "Default" / "Preferences"
    if before is not None:
        preferences.parent.mkdir()
        preferences.write_text(before, encoding="utf-8")
    result = subprocess.run([sys.executable, "-", str(preferences)], input=source, text=True, capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr
    if after is None:
        assert (preferences.read_text(encoding="utf-8") if before is not None else None) == before
    else:
        assert json.loads(preferences.read_text(encoding="utf-8")) == after
    assert not preferences.with_name("Preferences.raphael").exists()


@pytest.mark.parametrize("prefix,window_class", [
    ("chromium-browser", "chromium-browser (/home/cua/workspace/.browser-profiles/driver/main).Chromium-browser"),
    ("google-chrome", "google-chrome (/home/cua/workspace/.browser-profiles/driver/main).Google-chrome"),
])
def test_launcher_difference_excludes_disappeared_windows_and_attributes_same_pid_popups(prefix, window_class):
    launcher = (Path(module.__file__).parent / "image/layer11/raphael-seat-browser").read_text(encoding="utf-8")
    # Run the shipped selection itself against a pure shell wmctrl double; no browser, X or Docker.
    selection = launcher[launcher.index("  candidates=$("):launcher.index('  [ -n "$new" ]')]
    shell = shutil.which("sh")
    if shell is None:
        pytest.skip("An installed POSIX shell is required for the launcher's awk selection")
    script = '''before='0x1
0x2'
now='0x2
0x3
0x4
0x5
0x6'
main=99
marker=raphael-seat-test
window_class=PREFIX
class='WINDOW_CLASS'
wmctrl() { printf '%s\\n' "0x2  0 99   $class  host old - Chromium" "0x3  0 99   $class  host peer-popup - Chromium" "0x4  0 100  $class  host raphael-seat-test - Chromium" "0x5  0 99   $class  host raphael-seat-test - Chromium" '0x6  0 99   chromium-browser.Chromium-browser  host raphael-seat-testing - Chromium'; }
'''
    # The rows are `wmctrl -lpx` as a real computer printed them on 2026-11-12: the class has a space in it, which
    # is where a title looked for at a fixed column was never found and no seat got a browser.
    script = script.replace("PREFIX", prefix).replace("WINDOW_CLASS", window_class)
    result = subprocess.run([shell], input=script + selection + '\nprintf "%s\\n" "$new"\n',
                            text=True, capture_output=True, timeout=10)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "0x5"


@pytest.mark.parametrize("state,geometry,x,settled", [
    # Measured on 2026-11-12: maximized, the content filling screen 6, the browser's own frame reaching past it.
    ("_NET_WM_STATE_MAXIMIZED_HORZ, _NET_WM_STATE_MAXIMIZED_VERT", "2544 890 1312 893", 2560, True),
    ("_NET_WM_STATE_MAXIMIZED_HORZ, _NET_WM_STATE_MAXIMIZED_VERT", "2544 890 1312 893", 1280, False),  # the next screen's
    ("_NET_WM_STATE_FOCUSED", "2544 890 1312 893", 2560, False),                                        # not maximized
    ("_NET_WM_STATE_MAXIMIZED_VERT", "2580 920 1200 851", 2560, False),                                 # half maximized
])
def test_launcher_takes_a_maximized_window_that_keeps_its_own_frame_as_settled_on_its_own_screen(state, geometry, x, settled):
    launcher = (Path(module.__file__).parent / "image/layer11/raphael-seat-browser").read_text(encoding="utf-8")
    function = launcher[launcher.index("filling() {"):launcher.index("attempt=0\nsettled=")]
    shell = shutil.which("sh")
    if shell is None:
        pytest.skip("An installed POSIX shell is required for the launcher's settle test")
    script = f'''new=0x5 x={x} y=900 width=1280 height=900
xprop() {{ printf '%s\\n' '_NET_WM_STATE(ATOM) = {state}'; }}
wmctrl() {{ printf '%s\\n' '0x4  0 0 0 1280 851 host other' '0x5  0 {geometry} host raphael-seat-test - Chromium'; }}
''' + function + '\nif filling; then echo settled; else echo waiting; fi\n'
    result = subprocess.run([shell], input=script, text=True, capture_output=True, timeout=10)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == ("settled" if settled else "waiting")
    # The exact geometry is still asked for first; the looser test only after a second and a half.
    assert '[ "$attempt" -ge 15 ] && filling' in launcher


@pytest.mark.parametrize("layer", ["7", "8", "9"])
async def test_the_shared_computer_of_layer_seven_is_made_again_on_the_next_layer(shared_vm, layer):
    # The owner's own computer on the day layer 8 came: six screens, 6 GiB, four cores, labelled layer 7. The
    # acceptance run found that layer 7 was not yet named as a released one, and such a computer did not start.
    # It was on layer 8, in the same shape, the day layer 9 came, and on layers 9 and 10 the day the next came.
    vm, runtime = shared_vm
    target = await vm.seat(1)
    raw = container(vm, target, runtime)
    raw["Config"]["Labels"][f"{module.LABEL}.layer"] = layer
    raw["Image"] = "sha256:the-layer-before"
    assert "RAPHAEL_SCREENS=6" in raw["Config"]["Env"] and raw["HostConfig"]["Memory"] == 6 * 1024**3
    assert not module.compatible(raw, target, vm.owner, runtime.image_id)
    assert module.known_previous(raw, target, vm.owner)
    runtime.raw = raw
    assert await vm._upgrade_image(target) == {"state": "missing", "image": True}
    assert [args[0] for args, _ in runtime.calls if args[0] in ("stop", "rm")][-1] == "rm"
    # Nothing but the released shape: another memory limit is somebody else's container.
    raw["HostConfig"]["Memory"] = 4 * 1024**3
    assert not module.known_previous(raw, target, vm.owner)


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


@pytest.mark.parametrize("name", list(SCHEMAS))
async def test_unknown_parameters_fail_closed_for_every_offered_driver_tool(seat_tools, name):
    hub, vm, _ = seat_tools
    client, session = hub.connections[vm.target(2).key]
    reply = await hub._driver_call(vm.target(2), client, name, dict(session=session, future_parameter=True))
    assert reply["isError"] and "future_parameter" in str(reply)
    assert not client.calls


@pytest.mark.parametrize("name", ["click", "double_click", "right_click", "type_text", "press_key", "hotkey", "scroll", "drag"])
async def test_every_native_window_point_is_checked_against_the_screen_not_the_window(seat_tools, name):
    hub, vm, _ = seat_tools
    client, session = hub.connections[vm.target(2).key]
    args = dict(pid=20, window_id=20, session=session)
    args.update(dict(type_text=dict(text="hello"), press_key=dict(key="Return"), hotkey=dict(keys=["ctrl", "a"]),
                     scroll=dict(direction="down")).get(name, {}))
    if name == "drag":
        args.update(from_x=5, from_y=6, to_x=1380, to_y=80)
    else:
        args.update(x=1380, y=80)
    reply = await hub._driver_call(vm.target(2), client, name, args)
    assert reply["isError"] and "inside this member's screen" in str(reply)
    assert all(sent != name for sent, _ in client.calls)
    if name == "drag":
        args.update(from_x=-30, to_x=5)
        assert (await hub._driver_call(vm.target(2), client, name, args))["isError"]
        args.update(from_x=5, to_x=700)
    else:
        args.update(x=700)  # Beyond the 600px window but within the screen: a menu remains clickable.
    assert not (await hub._driver_call(vm.target(2), client, name, args)).get("isError")


@pytest.mark.parametrize("extra", [dict(coordinate_frame="desktop"), dict(target={"kind": "window", "pid": 20, "window_id": 20}),
    dict(from_zoom=False), dict(capture_id="old-window-or-desktop-capture")])
async def test_unreviewed_coordinate_sources_are_refused_before_dispatch(seat_tools, extra):
    hub, vm, _ = seat_tools
    client, session = hub.connections[vm.target(2).key]
    reply = await hub._driver_call(vm.target(2), client, "click", dict(pid=20, window_id=20, x=5, y=6, session=session, **extra))
    assert reply["isError"] and not client.calls


async def test_unreviewed_nested_predicate_parameters_fail_closed_before_dispatch(seat_tools):
    hub, vm, _ = seat_tools
    client, session = hub.connections[vm.target(2).key]
    reply = await hub._driver_call(vm.target(2), client, "verify_state", dict(pid=20, window_id=20, session=session,
        expect=[dict(window=dict(future_target=dict(x=10000)))]))
    assert reply["isError"] and "expect[].window.future_target" in str(reply)
    assert not client.calls


@pytest.mark.parametrize("name,args", [("get_window_state", {}), ("verify_state", {"expect": [{"window": {"exists": True}}]}),
    ("click", {"x": 5, "y": 6})])
@pytest.mark.parametrize("fits", [False, True])
async def test_straddling_and_oversized_windows_fit_before_read_or_input_else_refuse(seat_tools, name, args, fits):
    hub, vm, _ = seat_tools
    client, session = hub.connections[vm.target(2).key]
    client.rows[1]["bounds"].update(x=1200, width=2000, height=950)
    async def fit(target, row):
        assert vm.native_busy(target)
        assert all(sent != name for sent, _ in client.calls)
        if fits:
            row["bounds"].update(x=1300, y=20, width=1240, height=860)
            client.rows[1] = deepcopy(row)
    vm.fit_window = AsyncMock(side_effect=fit)
    reply = await hub._driver_call(vm.target(2), client, name, dict(pid=20, window_id=20, session=session, **args))
    assert bool(reply.get("isError")) is not fits
    vm.fit_window.assert_awaited_once()
    assert any(sent == name for sent, _ in client.calls) is fits


@pytest.mark.parametrize("name,args", [("get_browser_state", {}), ("browser_navigate", dict(tab_id="tab", url="about:blank")),
    ("browser_type", dict(tab_id="tab", ref="field", text="hello")), ("browser_click", dict(tab_id="tab", ref="button", delivery_mode="foreground"))])
async def test_bound_page_is_revoked_when_its_native_window_moves_to_a_peer(seat_tools, name, args):
    hub, vm, _ = seat_tools
    client, session = hub.connections[vm.target(2).key]
    assert not (await hub._driver_call(vm.target(2), client, "get_browser_state", dict(pid=20, window_id=20, session=session))).get("isError")
    client.rows[1]["bounds"]["x"] = 2600
    client.calls.clear()
    reply = await hub._driver_call(vm.target(2), client, name, dict(target_id="own-target", session=session, **args))
    assert reply["isError"] and (vm.target(2).key, "own-target") not in hub.page_windows
    assert [sent for sent, _ in client.calls] == ["list_windows"]


@pytest.mark.parametrize("name,args", [("browser_click", dict(ref="button")),
    ("browser_pointer", dict(action="drag", ref="source", destination_ref="dest")),
    ("browser_dialog", dict(action="accept", dialog_id="dialog")), ("browser_dialog", dict(action="dismiss", dialog_id="dialog"))])
async def test_owner_hold_blocks_foreground_page_input_but_navigation_continues(seat_tools, name, args):
    hub, vm, _ = seat_tools
    await call(hub, 2, "get_browser_state", dict(pid=20, window_id=20))
    client, session = hub.connections[vm.target(2).key]
    hub.busy_wait_s = .01
    vm.hold(vm.target(1), True)
    try:
        result = await call(hub, 2, name, dict(target_id="own-target", tab_id="tab", delivery_mode="foreground", **args))
        assert result.kind == "computer_busy" and all(sent != name for sent, _ in client.calls)
        assert (await call(hub, 2, "browser_navigate", dict(target_id="own-target", tab_id="tab", url="about:blank"))).ok
        assert (await call(hub, 2, "browser_dialog", dict(target_id="own-target", tab_id="tab", action="inspect"))).ok
    finally:
        vm.hold(vm.target(1), False)


async def test_seat_two_reply_projection_preserves_prose_and_translates_nested_verification(seat_tools):
    hub, vm, _ = seat_tools
    client, session = hub.connections[vm.target(2).key]
    original = client.request
    async def request(method, params):
        if params["name"] == "verify_state":
            validate_call(method, params)
            assert params["arguments"]["expect"][0]["window"]["bounds"]["x"] == 1300
            return dict(content=[dict(type="text", text="Verification satisfied.")], structuredContent=dict(
                status="satisfied", predicates=[dict(observed_json=json.dumps(dict(bounds=dict(x=1300, y=30, width=600, height=400))))]))
        return await original(method, params)
    client.request = request
    args = dict(pid=20, window_id=20, session=session, expect=[dict(window=dict(bounds=dict(x=20, y=30, width=600, height=400)))])
    reply = await hub._driver_call(vm.target(2), client, "verify_state", args)
    assert reply["content"][0]["text"] == "Verification satisfied."
    assert json.loads(reply["structuredContent"]["predicates"][0]["observed_json"])["bounds"]["x"] == 20
    assert args["expect"][0]["window"]["bounds"]["x"] == 20
    result = await call(hub, 2, "get_browser_state", dict(pid=20, window_id=20))
    assert result.text.startswith("Bound page with current references.\n")
    assert len([line for line in result.text.splitlines() if line.startswith("{")]) == 1


async def test_launch_does_not_take_a_peers_new_popup_from_an_existing_process(seat_tools):
    hub, vm, _ = seat_tools
    client, session = hub.connections[vm.target(2).key]
    original = client.request
    async def request(method, params):
        reply = await original(method, params)
        if params["name"] == "launch_app":
            client.rows.append(window(51, 2600, "Chromium-browser", 99))
        return reply
    client.request = request
    async def move(target, identifier):
        row = next(row for row in client.rows if row["window_id"] == identifier)
        row["bounds"].update(x=1300, y=20)
    vm.move_window = AsyncMock(side_effect=move)
    reply = await hub._driver_call(vm.target(2), client, "launch_app", dict(name="xfce4-terminal", session=session))
    vm.move_window.assert_awaited_once_with(vm.target(2), 40)
    assert reply["structuredContent"]["windows"][0]["bounds"]["x"] == 20
    assert client.rows[-1]["bounds"]["x"] == 2600


@pytest.mark.parametrize("operation", ["picture", "login", "contact", "card"])
async def test_private_reads_and_fill_helpers_share_the_moved_target_gate(seat_tools, operation):
    from types import SimpleNamespace
    hub, vm, _ = seat_tools
    target = vm.target(2)
    client, session = hub.connections[target.key]
    await hub._driver_call(target, client, "get_browser_state", dict(pid=20, window_id=20, session=session))
    client.rows[1]["bounds"]["x"] = 2600
    client.calls.clear()
    hub.logins = SimpleNamespace(load=lambda *args: dict(username="private-user", password="private-password"),
        entry=lambda *args: (dict(label="Saved"), dict(name="private-name")), entries=lambda *args: [dict(id="saved", label="Saved")])
    hub._observe_page(target, dict(target_id="own-target", tab_id="tab", refs=[
        dict(ref=ref, frame="main", role="textbox", name=ref, actions=["type"])
        for ref in ("user", "password", "field")]))
    hub._protect_page(target, "own-target", "https://example.com", ("field",), tab_id="tab")
    args = dict(reference="saved", site="https://example.com", target_id="own-target", username_ref="user", password_ref="password",
                fields=dict(name="field"), label="Saved", amount="")
    if operation == "picture":
        assert await hub._private_picture(target, {})
        assert target.key not in hub.private_tree
    elif operation == "login":
        assert not (await hub._fill_login(target, 2, args)).ok
    else:
        assert not (await hub._fill_entry(target, 2, args, operation)).ok
    assert [name for name, _ in client.calls] == ["list_windows"]
    assert (target.key, "own-target") not in hub.page_windows


async def test_native_click_text_drops_only_the_canvas_coordinate_trailer_on_seat_two(seat_tools):
    hub, vm, _ = seat_tools
    client, session = hub.connections[vm.target(2).key]
    original = client.request
    async def request(method, params):
        if params["name"] == "click":
            validate_call(method, params)
            text = "Clicked the button. [window_point=(5, 6) screen_point=(1305, 36)]"
            return dict(content=[dict(type="text", text=text)], structuredContent=dict(summary=text))
        return await original(method, params)
    client.request = request
    reply = await hub._driver_call(vm.target(2), client, "click", dict(pid=20, window_id=20, x=5, y=6, session=session))
    assert reply["content"][0]["text"] == reply["structuredContent"]["summary"] == "Clicked the button."


async def test_per_bot_dispatch_retains_the_unmodified_driver_arguments(seat_tools):
    hub, vm, _ = seat_tools
    vm.settings.set("computer_vm_mode", "per-bot")
    target = vm.target(2)
    client = SimpleRecordingClient()
    args = dict(target=dict(kind="desktop"), coordinate_frame="desktop", capture_id="capture", from_zoom=True, future_parameter=1)
    await hub._driver_call(target, client, "click", args)
    assert client.sent == dict(name="click", arguments=args)


class SimpleRecordingClient:
    async def request(self, method, params):
        assert method == "tools/call"
        self.sent = params
        return {}


@pytest.mark.parametrize("case,moved", [("peer", [40]), ("helper", [51]), ("ambiguous", []), ("launcher", [51])])
async def test_launch_only_moves_its_reply_pids_or_a_single_unattributed_window(seat_tools, case, moved):
    hub, vm, _ = seat_tools
    client, session = hub.connections[vm.target(2).key]
    original = client.request
    async def request(method, params):
        reply = await original(method, params)
        if params["name"] == "launch_app":
            if case != "peer":
                client.rows[:] = [row for row in client.rows if row["window_id"] != 40]
            client.rows.append(window(51, 2600, pid=51))
            if case == "ambiguous":
                client.rows.append(window(52, 2600, pid=52))
            if case == "launcher":
                reply["structuredContent"]["launcher_pid"] = 51
                client.rows.append(window(52, 2600, pid=52))
        return reply
    client.request = request
    vm.move_window = AsyncMock()
    await hub._driver_call(vm.target(2), client, "launch_app", dict(name="xfce4-terminal", session=session))
    assert [call.args[1] for call in vm.move_window.await_args_list] == moved

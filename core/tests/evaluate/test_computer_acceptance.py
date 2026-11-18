"""Computer acceptance contracts: in-memory protocols and injected Docker only."""

import asyncio
import base64
from dataclasses import replace
import hashlib
import json
from pathlib import PureWindowsPath
import struct

import pytest

from raphael_core.computer import rfb_view, vm
from raphael_core.evaluate import computer_acceptance as acceptance
from computer.fixtures.driver_contract import KEPT, SCHEMAS, catalog, validate_call, runtime_refusal


@pytest.fixture(autouse=True)
def no_network_or_docker(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("Offline acceptance tests must not create network sockets or Docker processes")
    monkeypatch.setattr(acceptance.socket, "create_connection", forbidden)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", forbidden)
    monkeypatch.setattr(asyncio, "open_connection", forbidden)
    monkeypatch.setattr(asyncio, "start_server", forbidden)


async def test_canvas_counter_includes_separate_recorder_bridges_and_restores_on_failure(monkeypatch):
    from unittest.mock import AsyncMock
    original = AsyncMock(return_value={'content': []})
    monkeypatch.setattr(acceptance.CuaBridge, 'request', original)
    with pytest.raises(RuntimeError, match='synthetic'):
        with acceptance.canvas_observations() as calls:
            recorder = acceptance.CuaBridge(None, None, observation_command=('test-only',))
            for name in ('get_accessibility_tree', 'list_windows', 'get_desktop_state'):
                await recorder.request('tools/call', {'name': name, 'arguments': {}}, owner_observation=True)
            raise RuntimeError('synthetic')
    assert calls == ['get_accessibility_tree', 'get_desktop_state']
    assert acceptance.CuaBridge.request is original and original.await_count == 3


def server_frame(payload, opcode=2, final=True):
    header = bytes([(128 if final else 0) | opcode])
    if len(payload) < 126:
        return header + bytes([len(payload)]) + payload
    if len(payload) < 65536:
        return header + b"\x7e" + struct.pack(">H", len(payload)) + payload
    return header + b"\x7f" + struct.pack(">Q", len(payload)) + payload


class MemoryServer:
    """Socket-shaped in-process peer. Validates every masked client frame and RFB step."""

    def __init__(self, *, refused=False, password="password", failed_auth=False, size=(1280, 900)):
        self.output, self.input = bytearray(), bytearray()
        self.refused, self.password, self.failed_auth, self.size = refused, password, failed_auth, size
        self.upgraded, self.state, self.messages, self.opcodes = False, "banner", [], []

    def recv(self, size):
        # Deliberately split both headers and payloads across reads.
        result = bytes(self.output[:min(size, 3)])
        del self.output[:len(result)]
        return result

    def sendall(self, data):
        if not self.upgraded:
            assert data.startswith(b"GET /websockify?token=screen-3 HTTP/1.1\r\n")
            assert b"Sec-WebSocket-Protocol: binary\r\n" in data
            key = next(line.split(b": ", 1)[1] for line in data.split(b"\r\n") if line.startswith(b"Sec-WebSocket-Key:"))
            digest = base64.b64encode(hashlib.sha1(key + b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest())
            self.upgraded = True
            if self.refused:
                self.output.extend(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
            else:
                self.output.extend(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + digest + b"\r\nSec-WebSocket-Protocol: binary\r\n\r\n")
                self.output.extend(server_frame(b"RFB 003.", final=False) + server_frame(b"ping", 9) + server_frame(b"008\n", 0))
            return
        self.input.extend(data)
        first, second = self.input[:2]
        assert first & 128 and second & 128
        length, offset = second & 127, 2
        if length in (126, 127):
            width = 2 if length == 126 else 8
            length = int.from_bytes(self.input[offset:offset + width], "big")
            offset += width
        mask = self.input[offset:offset + 4]
        payload = bytes(value ^ mask[i % 4] for i, value in enumerate(self.input[offset + 4:]))
        assert len(payload) == length
        self.input.clear()
        opcode = first & 15
        self.opcodes.append(opcode)
        if opcode == 10:
            assert payload == b"ping"
            return
        assert opcode == 2
        self.messages.append(payload)
        if self.state == "banner":
            assert payload == b"RFB 003.008\n"
            self.output.extend(server_frame(b"\x01\x02"))
            self.state = "security"
        elif self.state == "security":
            assert payload == b"\x02"
            # Fixed challenge and a recorded response for the known password "password".
            self.output.extend(server_frame(bytes.fromhex("0123456789abcdef0123456789abcdef")))
            self.state = "challenge"
        elif self.state == "challenge":
            assert self.password == "password"
            assert payload == bytes.fromhex("2b237257e9f90c81" * 2)
            self.output.extend(server_frame(struct.pack(">I", 1 if self.failed_auth else 0)))
            self.state = "init"
        elif self.state == "init":
            assert payload == b"\x01"
            self.output.extend(server_frame(struct.pack(">HH", *self.size) + bytes([32, 24, 0, 1]) + bytes(12) + struct.pack(">I", 4) + b"test"))
            self.state = "ready"
        elif payload and payload[0] == 3:
            _, _, x, y, width, height = struct.unpack(">BBHHHH", payload)
            self.output.extend(server_frame(b"\0\0\0\x01" + struct.pack(">HHHHi", x, y, width, height, 0) + b"\x12\x34\x56\0" * width * height))


def websocket(server):
    return acceptance.WebSocket(server, "127.0.0.1:12345", "/websockify?token=screen-3")


def test_rfb_authentication_uses_image_des_and_known_challenge():
    helper = acceptance.image_helper()
    original = helper.vnc_key
    called = []
    def key(password):
        called.append(original(password))
        return original(password)
    helper.vnc_key = key
    server = MemoryServer(password="password")
    client = acceptance.Rfb(websocket(server), helper)
    assert client.authenticate("password") == (1280, 900)
    assert called == [bytes.fromhex("0e86ceceeef64e26")]
    assert 10 in server.opcodes  # Fragmented RFB banner with an interleaved ping.
    client.pointer(688, 876, 1)
    assert server.messages[-1] == struct.pack(">BBHH", 5, 1, 688, 876)
    client.close_window()
    assert [message[0] for message in server.messages[-4:]] == [4] * 4
    assert client.pixels((10, 20, 8, 6)) == [b"\x12\x34\x56"] * 48
    assert server.messages[-3][0] == 0 and server.messages[-3][4:8] == bytes([32, 24, 0, 1])


@pytest.mark.parametrize("length", [0, 1, 125, 126, 65535, 65536])
def test_websocket_masks_all_payload_length_forms(length):
    server = MemoryServer()
    stream = websocket(server)
    server.state = "ready"
    stream.sendall(bytes(length))
    assert server.messages[-1] == bytes(length)
    server.output.clear()
    server.output.extend(server_frame(b"x" * length))
    if length:
        assert acceptance.exact(stream, length) == b"x" * length


def test_rfb_pixels_keep_spatial_order_when_raw_rectangles_arrive_out_of_order():
    class TiledServer(MemoryServer):
        def sendall(self, data):
            super().sendall(data)
            if self.state == "ready" and self.messages[-1][0] == 3:
                self.output.clear()
                # The right tile arrives first, and overlaps the left tile by one column.
                self.output.extend(server_frame(b"\0\0\0\x02"
                    + struct.pack(">HHHHi", 11, 20, 2, 2, 0) + b"\x44\x55\x66\0" * 4
                    + struct.pack(">HHHHi", 10, 20, 2, 2, 0) + b"\x11\x22\x33\0" * 4))
    server = TiledServer()
    client = acceptance.Rfb(websocket(server), acceptance.image_helper())
    client.authenticate("password")
    assert client.pixels((10, 20, 3, 2)) == [b"\x11\x22\x33", b"\x11\x22\x33", b"\x44\x55\x66"] * 2


def test_refused_upgrade_and_failed_authentication_are_actionable():
    with pytest.raises(AssertionError, match="Expected WebSocket 101, observed HTTP/1.1 403"):
        websocket(MemoryServer(refused=True))
    server = MemoryServer(failed_auth=True)
    with pytest.raises(AssertionError, match="authentication success, observed status 1"):
        acceptance.Rfb(websocket(server), acceptance.image_helper()).authenticate("password")
    server = MemoryServer(size=(2560, 1800))
    with pytest.raises(AssertionError, match="Expected ServerInit 1280x900, observed 2560x1800"):
        acceptance.Rfb(websocket(server), acceptance.image_helper()).authenticate("password")


@pytest.mark.parametrize("frame,match", [
    (b"\x82\x80", "unmasked"),
    (b"\x81\0", "binary/continuation"),
    (b"\x80\0", "binary/continuation"),
    (b"\x82\x7f" + struct.pack(">Q", 9 * 1024 * 1024), "8 MiB"),
    (server_frame(b"", 8), "closed"),
])
def test_websocket_rejects_invalid_or_oversized_server_frames(frame, match):
    server = MemoryServer()
    stream = websocket(server)
    server.output[:] = frame
    with pytest.raises((AssertionError, EOFError), match=match):
        stream.recv(1)


def test_parses_real_monitor_window_and_tcp_line_shapes():
    assert acceptance.monitors("Monitors: 2\n 0: +*VNC-0 1280/339x900/238+0+0  VNC-0\n 1: +VNC-1 1280/339x900/238+1280+0  VNC-1\n") == {
        "VNC-0": (0, 0, 1280, 900), "VNC-1": (1280, 0, 1280, 900)}
    with pytest.raises(AssertionError, match="monitor header"):
        acceptance.monitors("Monitors: 3\n")
    tree = acceptance.windows('''xwininfo: Window id: 0x50d (the root window) (has no name)
     0x400003 "xfce4-panel": ("xfce4-panel" "Xfce4-panel")  146x49+568+851  +1848+1751
        0x600003 "Terminal - user": ("xfce4-terminal" "Xfce4-terminal")  800x600+0+0  +1300+950
     0x700003 "Displays": ("xfce4-display-settings" "Xfce4-display-settings")  500x400-2+0  -2+0
     0x800003 (has no name): ()  1x1+0+0  +0+0
''')
    assert len(tree) == 3
    assert tree[0].rectangle == (1848, 1751, 146, 49)
    assert tree[1].terminal
    assert tree[2].rectangle == (-2, 0, 500, 400)
    assert acceptance.inside((1280, 900, 1280, 900), acceptance.centre(tree[1].rectangle))
    tcp = """  sl  local_address rem_address st
  0: 0100007F:1717 00000000:0000 0A
  1: 00000000:1718 00000000:0000 0A
  2: 0100007F:1719 00000000:0000 01
"""
    assert acceptance.listeners(tcp) == {5911: {"127.0.0.1"}, 5912: {"0.0.0.0"}}


def test_terminal_tree_ignores_leader_and_uses_absolute_canvas_corner():
    tree = acceptance.windows('''     0x1800001 "Xfce Terminal": ("xfce4-terminal" "Xfce4-terminal")  10x10+10+10  +10+10
     0x1800003 "Terminal - cua@host: ~/workspace": ("xfce4-terminal" "Xfce4-terminal")  817x483+5+29  +1385+1079''')
    assert len(tree) == 1
    assert tree[0].rectangle == (1385, 1079, 817, 483)
    assert tree[0].frame_offset == (5, 29)
    assert acceptance.inside((1280, 900, 1280, 900), acceptance.centre(tree[0].rectangle))


async def test_layout_passes_posix_token_and_mark_paths_to_docker_on_windows(tmp_path):
    run = acceptance.Acceptance(FakeDocker())
    run.machine = vm.LocalVm(tmp_path, runner=run.runner)
    target = run.machine.target(1)
    run.runner.containers[target.name] = raw_container(target.name, run.machine.owner)
    run.docker = acceptance.IsolatedDocker(run.runner, run.machine.owner, run.tag)
    run.helper.TOKENS = PureWindowsPath('/run/user/1000/raphael-vnc-tokens')
    run.helper.READY = PureWindowsPath('/dev/shm/raphael-screens.ready')
    original = run.runner.__call__
    async def runner(args, **kwargs):
        if args[0] != "exec":
            return await original(args, **kwargs)
        run.runner.calls.append(args)
        command = args[6:]
        if command == ["xrandr", "--listmonitors"]:
            return vm.Result(0, "Monitors: 1\n 0: +*VNC-0 1280/339x900/238+0+0  VNC-0")
        if command == ["cat", "/run/user/1000/raphael-vnc-tokens"]:
            return vm.Result(0, run.helper.token_text(1))
        if command == ["cat", "/dev/shm/raphael-screens.ready"]:
            return vm.Result(0, "1")
        if command == ["python3", "-c", acceptance.PROCESS_SNAPSHOT]:
            return vm.Result(0, json.dumps([dict(pid=1, ppid=0, start="1", cmd="python3 /screens.py")]))
        if command == ["cat", "/proc/net/tcp"]:
            return vm.Result(0, "")
        if command[-1] == "/panels":
            return vm.Result(0, "1")
        if command[-1] == "/panels/panel-1/output-name":
            # A real one-screen computer has no such property: the layout check must not ask for it.
            return vm.Result(1, "", 'Property "/panels/panel-1/output-name" does not exist on channel "xfce4-panel".')
        raise AssertionError(f"Unexpected guest argv {args}")
    run.docker.runner = runner
    await run.layout(target)
    for path in ("/run/user/1000/raphael-vnc-tokens", "/dev/shm/raphael-screens.ready"):
        assert ["exec", "-u", "cua", "-e", "DISPLAY=:1", target.name, "cat", path] in run.runner.calls


class MemoryDriver:
    """The driver's end of the product's connection. Like the real one (cua-driver 0.37.0 `describe`), it refuses an
    argument its schema does not name."""

    accepted = {"set_config": {"max_image_dimension", "session"}, "set_agent_cursor_enabled": {"enabled", "session"},
                "list_windows": set(SCHEMAS["list_windows"]["properties"])}
    calls = []

    def __init__(self, machine, target):
        self.target, self.alive = target, False

    async def __aenter__(self):
        self.alive = True
        return self

    async def __aexit__(self, *exc):
        self.alive = False

    async def request(self, method, params=None, **kwargs):
        if method == "tools/list":
            return catalog()
        name, arguments = params["name"], params["arguments"]
        type(self).calls.append((name, dict(arguments)))
        unknown = set(arguments) - self.accepted[name]
        if unknown:
            return {"isError": True, "content": [{"type": "text", "text": f"{name}: unknown argument {sorted(unknown)[0]}"}]}
        validate_call(method, params)
        refusal = runtime_refusal(method, params)
        if refusal:
            return refusal
        text = 'Found 1 windows:\n  window_id=7 pid=9 "Desktop" 1280x900+0+0 app=Xfdesktop' if name == "list_windows" else "ok"
        return {"content": [{"type": "text", "text": text}]}


def driver_run(tmp_path, monkeypatch, *, owner=None):
    monkeypatch.setattr(acceptance, "CuaBridge", MemoryDriver)
    MemoryDriver.calls = []
    run = acceptance.Acceptance(FakeDocker())
    run.root = tmp_path
    run.machine = vm.LocalVm(tmp_path, runner=run.runner)
    target = run.machine.target(1)
    run.runner.containers[target.name] = raw_container(target.name, owner or run.machine.owner)
    run.docker = acceptance.IsolatedDocker(run.runner, run.machine.owner, run.tag)
    return run, target


async def test_driver_check_makes_the_products_own_connection_with_arguments_the_driver_accepts(tmp_path, monkeypatch):
    run, target = driver_run(tmp_path, monkeypatch)
    detail = await run.driver(target)
    assert "driver sessions raphael-" in detail and "Found 1 windows:" in detail
    assert [name for name, _ in MemoryDriver.calls] == ["set_config", "set_agent_cursor_enabled", "list_windows"] * 2
    assert all(set(arguments) <= MemoryDriver.accepted[name] for name, arguments in MemoryDriver.calls)
    # The second connection is a core started again: it must not reuse the label the first one ended.
    labels = [arguments["session"] for name, arguments in MemoryDriver.calls if name == "list_windows"]
    assert len(set(labels)) == 2


async def test_driver_check_fails_when_the_driver_refuses_a_set_up_argument(tmp_path, monkeypatch):
    run, target = driver_run(tmp_path, monkeypatch)
    # What the product once sent: the real driver answered "unknown argument cursor_id".
    monkeypatch.setitem(MemoryDriver.accepted, "set_agent_cursor_enabled", {"session"})
    with pytest.raises(vm.VmError, match="^driver_configuration_failed$"):
        await run.driver(target)
    assert not MemoryDriver.calls or MemoryDriver.calls[-1][0] == "set_agent_cursor_enabled"


async def test_driver_check_starts_no_driver_process_in_another_owners_container(tmp_path, monkeypatch):
    run, target = driver_run(tmp_path, monkeypatch, owner="someone-else")
    with pytest.raises(AssertionError, match="Refused container"):
        await run.driver(target)
    assert MemoryDriver.calls == []


@pytest.mark.parametrize("changed", [None, "parameter", "words", "order"])
async def test_live_schema_check_requires_the_kept_list_to_be_the_drivers_own(tmp_path, monkeypatch, changed):
    # Anything a member reads of a parameter is part of its tool list: a kept list with other words or another order
    # is replaced at the member's first use of the computer, as one with other parameters is.
    from computer.fixtures.generate_driver_tools import snapshot
    run, target = driver_run(tmp_path, monkeypatch)
    run.out = tmp_path / "out"
    original = MemoryDriver.request
    async def request(self, method, params=None, **kwargs):
        reply = await original(self, method, params, **kwargs)
        if method == "tools/list" and changed:
            tool = next(tool for tool in reply["tools"] if tool["name"] == "get_guide")
            properties = tool["originalInputSchema"]["properties"]
            if changed == "parameter":
                properties["future_parameter"] = {"type": "boolean"}
            elif changed == "words":
                properties["topic"]["description"] = "Other words."
            else:
                tool["originalInputSchema"]["properties"] = dict(reversed(properties.items()))
        return reply
    monkeypatch.setattr(MemoryDriver, "request", request)
    if changed:
        with pytest.raises(AssertionError, match="Driver parameters changed.*driver-tools.json"):
            await run.driver_schema(target)
    else:
        detail = await run.driver_schema(target)
        # 40 before the six file tools (read_file, edit_file, write_file, glob, grep, file_history), browser_tabs (R-COMP-TABS-01)
        # and copy_from_owner (R-COMP-FILE-02).
        assert "All 30 DRIVER_TOOLS" in detail and "left the 48 offered tools as they were" in detail
    # What the driver listed is kept beside the report: the file the two kept lists are written from.
    assert (json.dumps(snapshot(run.out / "driver-tools.json")["tools"]) == json.dumps(KEPT)) == (changed is None)


async def test_live_schema_check_fails_when_asking_the_driver_changes_the_offer(tmp_path, monkeypatch):
    run, target = driver_run(tmp_path, monkeypatch)
    from raphael_core.computer import vm_tools
    monkeypatch.setattr(vm_tools, "driver_definition", lambda name, schema, original=None:
                        {"description": "Other words.", "parameters": schema, "validation": schema})
    with pytest.raises(AssertionError, match="leave the offered tools as they were"):
        await run.driver_schema(target)


class SteeringDesktop:
    """Two in-memory views: dark wallpaper and a black terminal with light window chrome."""

    def __init__(self, run, *, neighbour_changes=False, capture_failure=False):
        self.run, self.opened, self.sockets, self.captures = run, [], [], []
        self.neighbour_changes, self.capture_failure = neighbour_changes, capture_failure
        self.panel = acceptance.Window("0x4", "xfce4-panel", (1848, 1751, 146, 49), False)
        self.terminal_text = '''0x1800003 "Terminal - cua@host: ~/workspace": ("xfce4-terminal" "Xfce4-terminal")  817x483+5+29  +1385+1079'''

    async def tree(self, target):
        return [self.panel, *self.opened]

    async def viewer(self, target):
        return 12345, "private"

    def connect(self, port, path, password):
        desktop = self
        seat = int(path.rsplit("-", 1)[1])
        class View:
            closed = False

            def pointer(self, x, y, buttons=0):
                if buttons == 1 and not desktop.opened:
                    desktop.opened = acceptance.windows(desktop.terminal_text)

            def close_window(self):
                desktop.opened = []

            def pixels(self, area):
                desktop.captures.append((seat, bool(desktop.opened), area))
                if desktop.opened and desktop.capture_failure:
                    raise RuntimeError("synthetic capture failure")
                x, y, width, height = area
                if not desktop.opened:
                    return [b"\x05\x05\x05"] * (width * height)
                # Only the frame/title/menu strip is light; the terminal body is black.
                return [b"\xff\xff\xff" if (seat == 4 or desktop.neighbour_changes) and 150 <= yy < 200
                        else b"\x05\x05\x05" for yy in range(y, y + height) for _ in range(width)]

            def close(self):
                self.closed = True
        view = View()
        desktop.sockets.append(view)
        return view, view


@pytest.fixture
def steering(tmp_path, monkeypatch):
    run = acceptance.Acceptance(FakeDocker())
    run.machine = vm.LocalVm(tmp_path, runner=run.runner)
    target = replace(run.machine.target(4), screens=4)
    desktop = SteeringDesktop(run)
    monkeypatch.setattr(run, "tree", desktop.tree)
    monkeypatch.setattr(run, "connect", desktop.connect)
    monkeypatch.setattr(run.machine, "viewer_connection", desktop.viewer)
    async def pause(seconds):
        pass
    monkeypatch.setattr(acceptance.asyncio, "sleep", pause)
    return run, target, desktop


async def test_steering_compares_before_and_after_light_chrome_at_night(steering):
    run, target, desktop = steering
    detail = await run.steer(target, 4)
    assert "changed=1.000" in detail and "neighbour_changed=0.000" in detail
    assert "(1385, 1079, 817, 483)" in detail
    assert {seat for seat, opened, _ in desktop.captures if not opened} == {1, 4}
    assert {area for _, opened, area in desktop.captures if opened} == {(105, 150, 817, 50)}
    assert not desktop.opened and all(sock.closed for sock in desktop.sockets)


async def test_steering_picture_failure_cleans_up_before_the_next_check(steering):
    run, target, desktop = steering
    desktop.neighbour_changes = True
    assert not await run.check("steer", lambda: run.steer(target, 4))
    assert "neighbour_changed=1.000" in run.results[-1]["detail"]
    assert "changed=1.000" in run.results[-1]["detail"]
    assert not desktop.opened and all(sock.closed for sock in desktop.sockets)
    desktop.neighbour_changes = False
    assert await run.check("next steer", lambda: run.steer(target, 4))


async def test_steering_capture_exception_still_closes_what_it_opened(steering):
    run, target, desktop = steering
    desktop.capture_failure = True
    with pytest.raises(RuntimeError, match="synthetic capture failure"):
        await run.steer(target, 4)
    assert not desktop.opened and all(sock.closed for sock in desktop.sockets)


async def test_steering_tree_failure_after_click_still_closes_terminal(steering, monkeypatch):
    run, target, desktop = steering
    failed = False
    async def tree(target):
        nonlocal failed
        if desktop.opened and not failed:
            failed = True
            raise RuntimeError("synthetic tree failure after click")
        return await desktop.tree(target)
    monkeypatch.setattr(run, "tree", tree)
    with pytest.raises(RuntimeError, match="synthetic tree failure after click"):
        await run.steer(target, 4)
    assert failed and not desktop.opened and all(sock.closed for sock in desktop.sockets)


async def test_steering_wrong_screen_failure_still_closes_terminal(steering):
    run, target, desktop = steering
    desktop.terminal_text = desktop.terminal_text.replace("+1385+1079", "+105+179")
    with pytest.raises(AssertionError, match="only inside screen 4.*105, 179, 817, 483"):
        await run.steer(target, 4)
    assert not desktop.opened and all(sock.closed for sock in desktop.sockets)


async def test_steering_failed_close_reports_leftover_after_cleanup(steering, monkeypatch):
    run, target, desktop = steering
    original = desktop.connect
    def connect(*args):
        sock, client = original(*args)
        client.close_window = lambda: None
        return sock, client
    monkeypatch.setattr(run, "connect", connect)
    ticks = iter(range(1000))
    monkeypatch.setattr(acceptance.time, "monotonic", lambda: next(ticks))
    with pytest.raises(AssertionError, match="after.*cleanup.*Terminal - cua@host.*1385, 1079, 817, 483"):
        await run.steer(target, 4)
    assert desktop.opened and all(sock.closed for sock in desktop.sockets)


async def test_steering_refuses_leftover_with_title_and_absolute_rectangle(steering):
    run, target, desktop = steering
    desktop.opened = acceptance.windows(desktop.terminal_text)
    with pytest.raises(AssertionError, match="before.*Terminal - cua@host.*1385, 1079, 817, 483"):
        await run.steer(target, 4)
    assert not desktop.sockets


@pytest.mark.parametrize("ready", [True, False])
async def test_computer_block_prints_duration_including_stop_even_when_start_fails(tmp_path, monkeypatch, capsys, ready):
    run = acceptance.Acceptance(FakeDocker())
    run.machine = vm.LocalVm(tmp_path, runner=run.runner)
    async def start(target):
        if not ready:
            raise AssertionError("synthetic start failure")
    async def matched(target):
        return "fake matched"
    monkeypatch.setattr(run, "start", start)
    for name in ("boot_mark", "layout", "views", "quiet", "restart", "stop"):
        monkeypatch.setattr(run, name, matched)
    await run.computer(1, 3)
    lines = capsys.readouterr().out.splitlines()
    assert lines[-2].startswith("ok 1 screens stop:")
    assert lines[-1].startswith("summary 1 screens: ") and lines[-1].endswith(" s")
    assert float(lines[-1].split(": ")[1].removesuffix(" s")) >= 0


def test_the_desktop_picture_verdict_tells_the_owner_picture_the_default_and_a_flat_colour_apart():
    teal, orange, navy = acceptance.TEAL, acceptance.ORANGE, bytes((47, 33, 21))
    picture = [teal] * 640 + [orange] * 640
    flat = [navy] * 1280
    # The night picture across the middle: a soft dark gradient, a few dozen colours along a row.
    default = [bytes((18 + value // 64, 18 + value // 64, 24 + value // 64)) for value in range(1280)]
    # The owner's picture: shown only when both halves are its colours.
    assert acceptance.desktop_shows(picture, picture * 2, True)[0]
    assert not acceptance.desktop_shows(flat, flat * 2, True)[0]
    assert not acceptance.desktop_shows(default, default * 2, True)[0]
    # No picture: the default is many colours; the flat colour layer 5 showed is not it, nor is a picture left up.
    assert acceptance.desktop_shows(default, default * 2, False)[0]
    assert not acceptance.desktop_shows(flat, flat * 2, False) [0]
    assert not acceptance.desktop_shows(picture, picture * 2, False)[0]
    assert acceptance.desktop_shows(flat, flat * 2, False)[1] == (0.0, 0.0, 1)
    # The embedded picture is a JPEG the product accepts as an owner's picture.
    assert acceptance.OWN_PICTURE[:3] == b"\xff\xd8\xff" and len(acceptance.OWN_PICTURE) < 2000


def test_previous_fixture_matches_release_shape_without_changing_vm(tmp_path, monkeypatch):
    machine = vm.LocalVm(tmp_path, runner=object())
    target = machine.target(1)
    monkeypatch.setattr(vm, "IMAGE", "raphael-acceptance/cua-local-vm:test")
    args = acceptance.previous_args(target, machine.owner, "private")
    current = vm.run_args(target, machine.owner, "private")
    # The shape the layers before 13 were made in: no locale variables.
    assert not any(value.startswith(("LANG=", "LC_ALL=")) for value in args)
    earlier = []
    index = 0
    while index < len(current):
        if current[index] == "-e" and current[index + 1].startswith(("LANG=", "LC_ALL=")):
            index += 2
            continue
        earlier.append(current[index])
        index += 1
    current = earlier
    assert args[-1] == acceptance.OLD_IMAGES["4"] == "raphael/cua-local-vm:driver-0.37.0-v4"
    assert f"{vm.LABEL}.layer=4" in args
    assert f"{vm.LABEL}.owner={machine.owner}" in args
    assert not any(value.startswith(("RAPHAEL_SCREENS=", "VNC_RESOLUTION=")) for value in args)
    for flag in ("--memory", "--memory-swap", "--cpus", "--pids-limit", "--ipc", "--cgroupns", "--cap-drop", "--cap-add", "--shm-size", "--mount", "-p"):
        assert args[args.index(flag) + 1] == current[current.index(flag) + 1]
    assert "RAPHAEL_SCREENS=1" in current and current[-1] == vm.IMAGE
    # Layer 5, the one every released computer is on today, differs from the current shape by label and image only.
    fifth = acceptance.previous_args(target, machine.owner, "private", "5")
    assert fifth[-1] == acceptance.OLD_IMAGES["5"] == "raphael/cua-local-vm:driver-0.37.0-v5"
    assert [a for a, b in zip(fifth, current) if a != b] == [f"{vm.LABEL}.layer=5", acceptance.OLD_IMAGES["5"]]
    assert len(fifth) == len(current) and f"{vm.LABEL}.layer=" + vm.IMAGE_LABELS[f"{vm.LABEL}.layer"] not in fifth
    sixth = acceptance.previous_args(target, machine.owner, "private", "6")
    assert [a for a, b in zip(sixth, current) if a != b] == [f"{vm.LABEL}.layer=6", acceptance.OLD_IMAGES["6"]]
    seventh = acceptance.previous_args(target, machine.owner, "private", "7")
    assert [a for a, b in zip(seventh, current) if a != b] == [f"{vm.LABEL}.layer=7", acceptance.OLD_IMAGES["7"]]
    eighth = acceptance.previous_args(target, machine.owner, "private", "8")
    assert [a for a, b in zip(eighth, current) if a != b] == [f"{vm.LABEL}.layer=8", acceptance.OLD_IMAGES["8"]]
    ninth = acceptance.previous_args(target, machine.owner, "private", "9")
    assert [a for a, b in zip(ninth, current) if a != b] == [f"{vm.LABEL}.layer=9", acceptance.OLD_IMAGES["9"]]
    tenth = acceptance.previous_args(target, machine.owner, "private", "10")
    assert [a for a, b in zip(tenth, current) if a != b] == [f"{vm.LABEL}.layer=10", acceptance.OLD_IMAGES["10"]]
    eleventh = acceptance.previous_args(target, machine.owner, "private", "11")
    assert [a for a, b in zip(eleventh, current) if a != b] == [f"{vm.LABEL}.layer=11", acceptance.OLD_IMAGES["11"]]
    twelfth = acceptance.previous_args(target, machine.owner, "private", "12")
    assert [a for a, b in zip(twelfth, current) if a != b] == [f"{vm.LABEL}.layer=12", acceptance.OLD_IMAGES["12"]]
    # Layer 13 is the shape of today's, locale and all: only its label and image differ.
    with_locale = vm.run_args(target, machine.owner, "private")
    thirteenth = acceptance.previous_args(target, machine.owner, "private", "13")
    assert len(thirteenth) == len(with_locale) and "LANG=C.UTF-8" in thirteenth and "LC_ALL=C.UTF-8" in thirteenth
    assert [a for a, b in zip(thirteenth, with_locale) if a != b] == [f"{vm.LABEL}.layer=13", acceptance.OLD_IMAGES["13"]]
    assert acceptance.OLD_IMAGES["13"] == "raphael/cua-local-vm:driver-0.37.0-v13"
    assert vm.IMAGE not in acceptance.OLD_IMAGES.values() and list(acceptance.OLD_IMAGES) == ["4", "5", "6", "7", "8", "9", "10", "11", "12", "13"]


def test_the_old_browser_fixture_writes_what_an_earlier_layer_kept_in_a_real_shell(tmp_path):
    import shutil
    import subprocess
    shell = shutil.which("sh")
    if shell is None:
        pytest.skip("An installed POSIX shell is required to run the fixture")
    workspace = tmp_path / "workspace"
    (workspace / ".browser-profiles").mkdir(parents=True)
    (workspace / ".browser-profiles" / acceptance.DROPPED_MARK).write_text("", encoding="utf-8")
    command = acceptance.OLD_BROWSER_FIXTURE.replace(acceptance.PROFILES, (workspace / ".browser-profiles").as_posix())
    assert acceptance.PROFILES not in command
    done = subprocess.run([shell, "-c", command], capture_output=True, text=True, timeout=10)
    assert done.returncode == 0, done.stderr
    for relative in acceptance.OLD_BROWSER_FILES:
        assert (workspace / ".browser-profiles" / relative).read_text(encoding="utf-8") == "old"
    # No earlier layer wrote the mark: a workspace two shared blocks share is as an earlier layer left it each time.
    assert not (workspace / ".browser-profiles" / acceptance.DROPPED_MARK).exists()
    assert (workspace / "browser-data-kept.txt").read_text(encoding="utf-8") == "kept"
    assert acceptance.OLD_BROWSER_DATA == {"driver/main/Default/Cookies", "chromium/Default/Cookies"}


OTHERS = {"driver/other/kept", "google-chrome/Default/Cookies"}
CHROMIUMS = {"driver/main/Default/Cookies", "chromium/Default/Cookies"}


@pytest.mark.parametrize("architecture,files,ok", [
    ("arm64", OTHERS | {acceptance.DROPPED_MARK}, True),
    ("arm64", OTHERS | {acceptance.DROPPED_MARK, "driver/main/Default/Cookies"}, False),
    ("arm64", OTHERS | {acceptance.DROPPED_MARK, "chromium/Default/Cookies"}, False),
    ("arm64", OTHERS, False),
    ("arm64", {"google-chrome/Default/Cookies", acceptance.DROPPED_MARK}, False),
    ("amd64", OTHERS | CHROMIUMS, True),
    ("amd64", OTHERS | {"chromium/Default/Cookies"}, False),
    ("amd64", OTHERS | CHROMIUMS | {acceptance.DROPPED_MARK}, False),
])
async def test_the_old_browser_data_check_wants_chromiums_profiles_gone_on_arm64_only(architecture, files, ok):
    # R-COMP-READY-04: what an earlier layer's browsers kept, once its computer is made again on layer 14.
    run = acceptance.Acceptance(FakeDocker())
    asked = []

    async def text(target, args):
        asked.append(args)
        if args == ["dpkg", "--print-architecture"]:
            return architecture + "\n"
        if args[:2] == ["sh", "-c"]:
            assert args[2].startswith(f"cd {acceptance.PROFILES} && for file in ")
            return "".join(f"{name}\n" for name in sorted(files))
        assert args == ["cat", vm.GUEST + "/browser-data-kept.txt"]
        return "kept\n"
    run.text = text
    if ok:
        detail = await run.old_browser_data(object())
        assert ("removed once" in detail) == (architecture == "arm64")
    else:
        with pytest.raises(AssertionError):
            await run.old_browser_data(object())
    assert asked[0] == ["dpkg", "--print-architecture"]


def tiny_build(context, args, steps):
    """What the engine makes of `tiny_dockerfile`'s folder: the image (its id from its files and labels, its labels from
    the LABEL line) and BuildKit's plain progress, where a step whose files it has built before is CACHED."""
    folder = acceptance.Path(context)
    text = (folder / "Dockerfile").read_text(encoding="utf-8")
    unchanged, layer = ((folder / name).read_text(encoding="utf-8") for name in ("unchanged.txt", "layer.txt"))
    label = next((line[len("LABEL "):] for line in text.splitlines() if line.startswith("LABEL ")), "")
    labels = dict(part.split("=", 1) for part in label.split()) if label else {}
    labels = {key: value.strip('"') for key, value in labels.items()}
    log = ["#1 [internal] load build definition from Dockerfile", "#1 DONE 0.0s"]
    if "--cache-from" in args:
        log += [f"#2 importing cache manifest from {args[args.index('--cache-from') + 1]}", "#2 DONE 0.0s"]
    for number, (instruction, key) in enumerate((("COPY unchanged.txt /unchanged.txt", unchanged),
                                                 ("COPY layer.txt /layer.txt", unchanged + layer)), start=3):
        log += [f"#{number} [{number - 2}/2] {instruction}", f"#{number} CACHED" if key in steps else f"#{number} DONE 0.0s"]
        steps.add(key)
    ident = "sha256:" + hashlib.sha256((text + unchanged + layer).encode()).hexdigest()
    return {"Id": ident, "Config": {"Labels": labels}, "inline": "BUILDKIT_INLINE_CACHE=1" in args}, "\n".join(log)


class FakeDocker:
    def __init__(self, *, engine="linux", build_failure=False):
        self.engine, self.build_failure = engine, build_failure
        self.calls, self.containers, self.images = [], {}, {}
        self.steps = set()

    @staticmethod
    def identifier(name, raw):
        return raw.get("Id") or hashlib.sha256(name.encode()).hexdigest()

    def tagged(self, ident):
        return [tag for tag, image in self.images.items() if image["Id"] == ident]

    def used(self):
        return {self.identifier(name, raw): raw.get("Image", "sha256:" + "0" * 64) for name, raw in self.containers.items()}

    async def __call__(self, args, **kwargs):
        self.calls.append(list(args))
        if args[0] == "info":
            return vm.Result(0, self.engine)
        if args[0] == "build":
            if self.build_failure:
                return vm.Result(1, stderr="synthetic build failure")
            tag = args[args.index("--tag") + 1]
            if args[-1] != str(acceptance.IMAGE_FOLDER):
                self.images[tag], log = tiny_build(args[-1], args, self.steps)
                return vm.Result(0, "", log)
            self.images[tag] = {"Id": "new-image", "Config": {"Labels": vm.IMAGE_LABELS}}
            return vm.Result(0)
        if args[:2] == ["image", "inspect"]:
            found = [{**self.images[name], "RepoTags": self.tagged(self.images[name]["Id"])} for name in args[2:] if name in self.images]
            return vm.Result(0, json.dumps(found)) if len(found) == len(args[2:]) else vm.Result(1, json.dumps(found))
        if args[:2] == ["image", "rm"]:
            ident = self.images[args[2]]["Id"]
            if ident in self.used().values() and len(self.tagged(ident)) == 1:
                return vm.Result(1, stderr="conflict: unable to remove repository reference")
            self.images.pop(args[2])
            return vm.Result(0)
        if args[:2] == ["image", "ls"]:
            filters = [args[index + 1] for index, part in enumerate(args) if part == "--filter"]
            label = next((item.removeprefix("label=") for item in filters if item.startswith("label=")), None)
            reference = next((item.removeprefix("reference=") for item in filters if item.startswith("reference=")), None)
            shown = [(image["Id"], tag) for tag, image in self.images.items()
                     if (label is None or image["Config"]["Labels"].get(label.split("=", 1)[0]) == label.split("=", 1)[1])
                     and (reference is None or tag.rsplit(":", 1)[0] == reference)]
            return vm.Result(0, "".join(f"{ident} {tag}\n" if "{{.ID}}" in args[-1] else f"{tag}\n" for ident, tag in shown))
        if args == ["ps", "-a", "-q", "--no-trunc"]:
            return vm.Result(0, "".join(f"{ident}\n" for ident in self.used()))
        if args[:4] == ["container", "inspect", "--format", "{{.Image}}"]:
            used = self.used()
            return vm.Result(0, "".join(f"{used[ident]}\n" for ident in args[4:])) if all(ident in used for ident in args[4:]) else vm.Result(1)
        if args[:2] == ["create", "--name"]:
            key, value = args[4].split("=", 1)
            self.containers[args[2]] = {"Name": "/" + args[2], "Id": hashlib.sha256(args[2].encode()).hexdigest(),
                                        "Image": self.images[args[5]]["Id"], "Config": {"Labels": {key: value}}}
            return vm.Result(0)
        if args[:2] == ["save", "-o"]:
            import io
            import tarfile
            image = self.images[args[3]]
            config = {"config": {"Labels": image["Config"]["Labels"]}, **({"moby.buildkit.cache.v0": "c3ludGhldGlj"} if image.get("inline") else {})}
            with tarfile.open(args[2], "w") as tar:
                for name, data in (("manifest.json", [{"Config": "blobs/sha256/config", "RepoTags": [args[3]], "Layers": []}]),
                                   ("blobs/sha256/config", config)):
                    raw = json.dumps(data).encode()
                    member = tarfile.TarInfo(name)
                    member.size = len(raw)
                    tar.addfile(member, io.BytesIO(raw))
            return vm.Result(0)
        if args[:2] == ["container", "inspect"]:
            return vm.Result(0, json.dumps([self.containers[args[2]]])) if args[2] in self.containers else vm.Result(1)
        if args[0] == "ps":
            label = args[args.index("--filter") + 1].removeprefix("label=")
            key, value = label.split("=", 1)
            return vm.Result(0, "\n".join(name for name, raw in self.containers.items() if raw["Config"]["Labels"].get(key) == value))
        if args[0] == "rm":
            self.containers.pop(args[-1])
            return vm.Result(0)
        if args[0] in ("exec", "stop", "start", "restart", "run", "cp"):
            return vm.Result(0)
        raise AssertionError(f"Unexpected fake command {args}")


def raw_container(name, owner):
    return {"Name": "/" + name, "Config": {"Labels": {f"{vm.LABEL}.owner": owner}}}


async def test_owner_guard_accepts_product_exec_and_exact_recovery_filter(tmp_path):
    runner = FakeDocker()
    machine = vm.LocalVm(tmp_path, runner=runner)
    target = machine.target(2)
    guard = acceptance.IsolatedDocker(runner, machine.owner, "raphael-acceptance/cua-local-vm:test")
    runner.containers[target.name] = raw_container(target.name, machine.owner)
    await guard(vm.exec_args(target, ["test", "-f", vm.SCREENS_READY]))
    await guard(vm.exec_args(target, ["true"], detached=True))
    await guard(["cp", str(vm.WALLPAPER_FOLDER / "wallpaper.py"), target.name + ":/opt/raphael-desktop/wallpaper.py"])
    await guard(["cp", str(vm.WALLPAPER_FOLDER / "wallpapers"), target.name + ":/opt/raphael-desktop/"])
    # What the image's build folder holds is never the product's copy (image/desktop/ stays as the last layer built it).
    with pytest.raises(AssertionError, match="Expected product wallpaper copy only"):
        await guard(["cp", str(acceptance.IMAGE_FOLDER / "desktop/wallpaper.py"), target.name + ":/opt/raphael-desktop/wallpaper.py"])
    await guard(["ps", "-a", "--filter", f"label={guard.label}", "--format", "{{.Names}}"])
    for command in ("stop", "start", "restart", "rm"):
        await guard([command, *( ["--time", "10"] if command == "restart" else []), target.name])
        runner.containers[target.name] = raw_container(target.name, machine.owner)
    assert all(args[args.index("-u") + 1] == "cua" for args in runner.calls if args[0] == "exec")


async def test_guard_lets_only_this_runs_own_picture_into_its_own_computer(tmp_path):
    runner = FakeDocker()
    machine = vm.LocalVm(tmp_path, runner=runner)
    target = machine.target(2)
    runner.containers[target.name] = raw_container(target.name, machine.owner)
    picture = tmp_path / vm.OWN_WALLPAPER
    destination = target.name + ":" + vm.GUEST_OWN_WALLPAPER
    told = acceptance.IsolatedDocker(runner, machine.owner, "raphael-acceptance/cua-local-vm:test", picture=picture)
    await told(["cp", str(picture), destination])
    for refused in (["cp", str(tmp_path / "another.jpg"), destination],
                    ["cp", str(picture), target.name + ":/home/cua/workspace/own.jpg"],
                    ["cp", str(picture), target.name + ":/opt/raphael-desktop/wallpaper.py"]):
        with pytest.raises(AssertionError, match="Expected product wallpaper copy only"):
            await told(refused)
    untold = acceptance.IsolatedDocker(runner, machine.owner, "raphael-acceptance/cua-local-vm:test")
    with pytest.raises(AssertionError, match="Expected product wallpaper copy only"):
        await untold(["cp", str(picture), destination])
    foreign = "raphael-computer-other-member"
    runner.containers[foreign] = raw_container(foreign, "other")
    with pytest.raises(AssertionError, match="expected owner"):
        await told(["cp", str(picture), foreign + ":" + vm.GUEST_OWN_WALLPAPER])
    assert [args for args in runner.calls if args[0] == "cp"] == [["cp", str(picture), destination]]


async def test_guard_drives_real_local_vm_start_status_viewer_and_stop(tmp_path, monkeypatch):
    from computer.test_vm import Runtime, container
    runner = Runtime()
    machine = vm.LocalVm(tmp_path, runner=runner)
    monkeypatch.setattr(vm, "IMAGE", "raphael-acceptance/cua-local-vm:test")
    target = replace(machine.target(17), screens=3)
    runner.raw = container(machine, target, runner)
    picture = tmp_path / vm.OWN_WALLPAPER
    picture.write_bytes(acceptance.OWN_PICTURE)
    machine.run = acceptance.IsolatedDocker(runner, machine.owner, "raphael-acceptance/cua-local-vm:test", picture=picture)
    try:
        assert (await machine.start(target))["ready"]
        assert (await machine.status(target))["ready"]
        assert await machine.viewer_connection(target) == (6080, "private")
        assert not machine.repair_revisions
        # The product's own start reaches the desktop with the run's picture: a guard that refused this copy made
        # the first real "desktop picture" check show the desktop's default drawing instead.
        copies = [args for args, _ in runner.calls if args[0] == "cp"]
        assert len(copies) == 3 and copies[-1] == ["cp", str(picture), target.name + ":" + vm.GUEST_OWN_WALLPAPER]
        watcher = next(args[-1] for args, _ in runner.calls if args[:2] == ["exec", "-d"])
        assert "--watch --image " + vm.GUEST_OWN_WALLPAPER in watcher
        await machine.stop(target)
        assert runner.raw["State"]["Running"] is False
    finally:
        await machine.aclose(stop=False)


@pytest.mark.parametrize("error", ["docker_stopped", "unavailable"])
async def test_start_retries_slow_engine_once_after_pause(error, tmp_path, monkeypatch, capsys):
    run = acceptance.Acceptance(FakeDocker())
    run.machine = vm.LocalVm(tmp_path, runner=run.runner)
    target = run.machine.target(1)
    calls, pauses = [], []
    async def start(target):
        calls.append(target)
        if len(calls) == 1:
            raise vm.VmError(error)
        return {"ready": True}
    async def pause(seconds):
        pauses.append(seconds)
    monkeypatch.setattr(run.machine, "start", start)
    monkeypatch.setattr(acceptance.asyncio, "sleep", pause)
    assert (await run.start(target))["ready"]
    assert calls == [target, target] and pauses == [3]
    assert "retry" in capsys.readouterr().out


@pytest.mark.parametrize("args", [
    ["system", "prune"], ["container", "prune"], ["pull", vm.BASE],
    ["image", "rm", "raphael/cua-local-vm:driver-0.37.0-v13"],
    ["image", "rm", "raphael/cua-local-vm:driver-0.37.0-v12"],
    ["image", "rm", "raphael/cua-local-vm:driver-0.37.0-v11"],
    ["image", "rm", "raphael/cua-local-vm:driver-0.37.0-v9"],
    ["image", "rm", "raphael/cua-local-vm:driver-0.37.0-v8"],
    ["image", "rm", "raphael/cua-local-vm:driver-0.37.0-v7"],
    ["image", "rm", "raphael/cua-local-vm:driver-0.37.0-v6"],
    ["image", "rm", "raphael/cua-local-vm:driver-0.37.0-v5"],
    ["image", "inspect", "raphael/cua-local-vm:driver-0.37.0-v14"],
    ["ps", "-a", "--filter", "label=org.raphael.computer", "--format", "{{.ID}}"],
    ["container", "inspect", "someone-elses-container"],
    ["exec", "-u", "root", "ours", "true"],
    ["stop", "foreign", "ours"], ["rm", "foreign", "ours"], ["start", "foreign", "ours"],
    ["build", "--tag", "raphael/cua-local-vm:driver-0.37.0-v13", "image"],
    ["build", "--tag", "raphael/cua-local-vm:driver-0.37.0-v12", "image"],
    ["build", "--tag", "raphael/cua-local-vm:driver-0.37.0-v11", "image"],
    ["build", "--tag", "raphael/cua-local-vm:driver-0.37.0-v9", "image"],
    ["build", "--tag", "raphael/cua-local-vm:driver-0.37.0-v8", "image"],
    ["build", "--tag", "raphael/cua-local-vm:driver-0.37.0-v7", "image"],
    ["build", "--tag", "raphael/cua-local-vm:driver-0.37.0-v6", "image"],
    ["build", "--tag", "raphael/cua-local-vm:driver-0.37.0-v5", "image"],
])
async def test_isolation_refuses_broad_or_unrelated_commands_before_runner(args):
    runner = FakeDocker()
    guard = acceptance.IsolatedDocker(runner, "owner", "raphael-acceptance/cua-local-vm:test")
    with pytest.raises(AssertionError):
        await guard(args)
    assert runner.calls == []


async def test_owner_label_is_rechecked_even_when_name_matches():
    runner = FakeDocker()
    name = "raphael-computer-ours-key"
    runner.containers[name] = raw_container(name, "other-owner")
    guard = acceptance.IsolatedDocker(runner, "ours", "raphael-acceptance/cua-local-vm:test")
    for args in (["rm", "-f", name], ["stop", name], ["start", name], ["exec", "-u", "cua", name, "true"]):
        with pytest.raises(AssertionError, match="expected owner ours"):
            await guard(args)
    assert all(args[:2] == ["container", "inspect"] for args in runner.calls)


@pytest.mark.parametrize("keep,crash", [(False, False), (False, True), (True, False), (True, True)])
async def test_run_uses_private_tag_and_owner_and_cleans_even_after_failure(keep, crash, tmp_path, monkeypatch, capsys):
    runner = FakeDocker()
    foreign = "raphael-computer-other-member"
    runner.containers[foreign] = raw_container(foreign, "other")
    run = acceptance.Acceptance(runner, keep=keep, out=tmp_path / "report")
    original_image = vm.IMAGE
    observed = []
    async def computer(count, largest):
        target = replace(run.machine.target(count), screens=count)
        observed.append((run.root, target.name, run.machine.owner))
        runner.containers[target.name] = raw_container(target.name, run.machine.owner)
        # The guard must accept actual run_args with the isolated global image.
        await run.docker(vm.run_args(target, run.machine.owner, "transient-password"))
        if crash and count == 1:
            raise RuntimeError("synthetic failure on first computer")
        run.record(f"{count} screens fake", "ok", "fake computer only")
    async def relocation():
        return "fake move only"
    monkeypatch.setattr(run, "computer", computer)
    monkeypatch.setattr(run, "relocation", relocation)
    code = await run.run([1, 3], shared=False)
    assert code == (1 if crash else 0)
    assert len(observed) == 2  # Failure on one computer does not suppress the next.
    assert vm.IMAGE == original_image
    assert foreign in runner.containers
    assert len({item[2] for item in observed}) == 1
    assert all(name.startswith(f"raphael-computer-{owner}-") for _, name, owner in observed)
    # The computer's own image is built once, as before; the image update check builds only its throwaway image.
    assert [args for args in runner.calls if args[0] == "build" and "raphael-acceptance-" not in args[-2]] == [["build", "--tag", run.tag, str(acceptance.IMAGE_FOLDER)]]
    assert all(args[-1] == run.tag for args in runner.calls if args[0] == "run")
    assert not any("prune" in args or args[0] == "pull" for args in runner.calls)
    report = json.loads((tmp_path / "report/computer-acceptance.json").read_text(encoding="utf-8"))
    assert all(set(row) == {"name", "result", "detail", "seconds"} for row in report["checks"])
    for layer in ("4", "5", "6", "7", "8", "9"):
        assert any(row["result"] == "skipped" and row["name"] == f"previous layer {layer}" for row in report["checks"])
    assert [row["result"] for row in report["checks"] if row["name"].startswith("image update")] == ["ok"] * (6 if keep else 7)
    assert " ok, " in capsys.readouterr().out
    # Only the image update check's own throwaway tags are ever removed besides the run's image.
    removals = [args[2] for args in runner.calls if args[:2] == ["image", "rm"]]
    assert all(tag == run.tag or tag.startswith("raphael-acceptance-") for tag in removals)
    assert not any(tag.startswith("raphael-acceptance-") for tag in runner.images if not keep)
    if keep:
        assert run.root.exists() and run.tag in runner.images
        assert len(runner.containers) == 4  # with the image update check's stopped container
        assert not any(args[0] in ("rm", "stop") for args in runner.calls) and run.tag not in removals
        # Test-owned temporary resources are removed without invoking acceptance cleanup.
        acceptance.shutil.rmtree(run.root)
    else:
        assert not run.root.exists() and run.tag not in runner.images
        assert set(runner.containers) == {foreign}
        assert [tag for tag in removals if not tag.startswith("raphael-acceptance-")] == [run.tag]


@pytest.mark.parametrize("engine", ["", "windows"])
async def test_missing_linux_engine_exits_two_without_building_or_creating_data(engine, monkeypatch, capsys):
    runner = FakeDocker(engine=engine)
    def forbidden(*args, **kwargs):
        raise AssertionError("Missing engine must not create temporary data")
    monkeypatch.setattr(acceptance.tempfile, "mkdtemp", forbidden)
    assert await acceptance.Acceptance(runner).run([1]) == 2
    assert runner.calls == [["info", "--format", "{{.OSType}}"]]
    assert "Docker is not running" in capsys.readouterr().out


async def test_build_failure_still_removes_data_and_reports_observed_error(capsys):
    runner = FakeDocker(build_failure=True)
    run = acceptance.Acceptance(runner)
    assert await run.run([1]) == 1
    assert not run.root.exists()
    output = capsys.readouterr().out
    assert "synthetic build failure" in output and "Removed data" in output


async def test_cancellation_cleans_own_resources_and_restores_image(monkeypatch):
    runner = FakeDocker()
    run = acceptance.Acceptance(runner)
    original = vm.IMAGE
    async def interrupted(*args):
        target = run.machine.target(1)
        runner.containers[target.name] = raw_container(target.name, run.machine.owner)
        raise asyncio.CancelledError
    monkeypatch.setattr(run, "computer", interrupted)
    assert await run.run([1]) == 1
    assert not run.root.exists() and not runner.containers and not runner.images
    assert vm.IMAGE == original


async def test_verify_cancellation_file_runs_finally_instead_of_hard_terminating(tmp_path, monkeypatch):
    runner = FakeDocker()
    run = acceptance.Acceptance(runner)
    cancel = tmp_path / "computer.cancel"
    monkeypatch.setenv("RAPHAEL_COMPUTER_CANCEL_FILE", str(cancel))
    async def wait_for_cancel(*args):
        target = run.machine.target(1)
        runner.containers[target.name] = raw_container(target.name, run.machine.owner)
        cancel.write_text("cancel\n", encoding="utf-8")
        await asyncio.Event().wait()
    monkeypatch.setattr(run, "computer", wait_for_cancel)
    assert await asyncio.wait_for(run.run([1]), timeout=5) == 1
    assert not run.root.exists() and not runner.containers and not runner.images


@pytest.mark.parametrize("value", ["", "0", "7", "1,1", "1,no", "1,"])
def test_screen_options_fail_closed(value):
    with pytest.raises(acceptance.argparse.ArgumentTypeError):
        acceptance.screen_counts(value)


def test_image_loading_preserves_build_context():
    helper = acceptance.image_helper()
    for count in (1, 3, 6):
        assert helper.grid(count) == vm.screen_grid(count)
    assert not list(acceptance.IMAGE_FOLDER.rglob("__pycache__"))


async def test_shared_block_defaults_on_after_counts_and_no_shared_skips_it(monkeypatch):
    for enabled in (True, False):
        run = acceptance.Acceptance(FakeDocker())
        order = []
        async def computer(count, largest):
            order.append(count)
        async def shared():
            order.append("shared")
            return "fake shared boundary"
        async def previous():
            order.append("previous")
        async def relocation():
            order.append("relocation")
            return "fake move"
        monkeypatch.setattr(run, "computer", computer)
        monkeypatch.setattr(run, "shared", shared)
        monkeypatch.setattr(run, "previous", previous)
        monkeypatch.setattr(run, "relocation", relocation)
        assert await run.run([1, 3], shared=enabled) == 0
        assert order == [1, 3, *(["shared"] if enabled else []), "previous", "relocation"]


async def test_the_folders_move_alone_runs_after_the_build_and_nothing_else(monkeypatch):
    run = acceptance.Acceptance(FakeDocker())
    order = []
    async def anything(*args):
        order.append("other block")
    async def relocation():
        order.append("relocation")
        return "fake move"
    for name in ("computer", "shared", "previous"):
        monkeypatch.setattr(run, name, anything)
    monkeypatch.setattr(run, "relocation", relocation)
    assert await run.run([1, 3], relocation_only=True) == 0
    assert order == ["relocation"]
    assert [row["name"] for row in run.results][:3] == ["engine", "build", "folders move"]


async def test_guard_lets_the_move_list_this_runs_computers_and_helpers_and_bind_its_moved_homes(tmp_path):
    runner = FakeDocker()
    machine = vm.LocalVm(tmp_path, runner=runner, machine_dir=tmp_path / "machine-local")
    guard = acceptance.IsolatedDocker(runner, machine.owner, "raphael-acceptance/cua-local-vm:test")
    await guard(["ps", "-a", "--filter", f"label={guard.label}", "--format", "{{.Names}}\t{{.State}}"])
    await guard(["ps", "-a", "--filter", f"name=raphael-carry-{machine.owner}-", "--format", "{{.Names}}"])
    for refused in (["ps", "-a", "--filter", "name=raphael-carry-", "--format", "{{.Names}}"],
                    ["ps", "-a", "--filter", "name=raphael-carry-other-", "--format", "{{.Names}}"],
                    ["ps", "-a", "--filter", f"label={guard.label}", "--format", "{{.Names}}\t{{.Mounts}}"]):
        with pytest.raises(AssertionError, match="owner-only container listing"):
            await guard(refused)
    target = machine.target(4)
    args = vm.run_args(target, machine.owner, "transient-password")
    args[-1] = guard.tag
    with pytest.raises(AssertionError, match="this run's data root"):
        await guard(args)  # a home outside the data root is refused until the run moved its folders there
    guard.moved_homes.add((tmp_path / "machine-local" / vm.HOMES).resolve())
    await guard(args)
    assert guard.carry_homes[str(target.workspace)].key == target.key


def test_no_shared_cli_option_reaches_the_same_acceptance_runner(monkeypatch):
    seen = []
    async def run(self, counts, *, shared=True, relocation_only=False):
        seen.append((counts, shared, relocation_only))
        return 0
    monkeypatch.setattr(acceptance.Acceptance, "run", run)
    assert acceptance.main(["--screens", "1,6", "--no-shared"]) == 0
    assert acceptance.main(["--relocation-only"]) == 0
    assert seen == [([1, 6], False, False), ([1, 3, 6], True, True)]


async def test_guard_authorizes_real_bridge_exec_without_running_it_and_keeps_owner_checks(tmp_path):
    runner = FakeDocker()
    machine = vm.LocalVm(tmp_path, runner=runner)
    target = machine.target(1)
    runner.containers[target.name] = raw_container(target.name, machine.owner)
    guard = acceptance.IsolatedDocker(runner, machine.owner, "raphael-acceptance/cua-local-vm:test")
    await guard.authorize(vm.exec_args(target, [vm.DRIVER, "mcp", "--socket", vm.SOCKET], interactive=True))
    assert all(args[:2] == ["container", "inspect"] for args in runner.calls)
    runner.containers[target.name]["Config"]["Labels"][f"{vm.LABEL}.owner"] = "foreign"
    with pytest.raises(AssertionError):
        await guard.authorize(vm.exec_args(target, ["wmctrl", "-lG"]))


# launch_failure: "unrunnable" sends each launch as `env ... sh -c '<command>'`, which the real driver split apart and
# refused on its first real-engine run (launch_handoff_timeout); "untied" is a product that ties no window to its launch, so every
# window stays where the window manager opened it.
# transfer: the owner's clipboard and files. "xclip" is an image with a clipboard program of its own, "none" one with neither
# xclip nor xsel (read and written through the driver), "refused" a driver that refuses both clipboard tools, "corrupt" a
# placing that changes a byte of the file it copies.
@pytest.mark.parametrize("browser_failure,stop_failure,launch_failure,transfer", [(False, False, None, "xclip"), (True, False, None, "xclip"),
                                                                                  (False, True, None, "xclip"), (False, False, "unrunnable", "xclip"),
                                                                                  (False, False, "untied", "xclip"), (False, False, None, "none"),
                                                                                  (False, False, None, "refused"), (False, False, None, "corrupt")])
async def test_shared_acceptance_drives_real_tools_through_every_numbered_check(tmp_path, monkeypatch, browser_failure, stop_failure,
                                                                                launch_failure, transfer):
    """Fake only transport, guest programs and the viewer listener; product seat/tool logic runs."""
    from copy import deepcopy
    from types import SimpleNamespace
    from computer.test_seat_tools import driver_launched, driver_matches, driver_refusal, driver_runs, window
    from computer.test_vm import Runtime, container
    from raphael_core.computer import rfb_view, seat_launch
    from raphael_core.computer.vm_bridge import CuaBridge
    from raphael_core.computer.viewer import Session

    runtime = Runtime()
    run = acceptance.Acceptance(runtime)
    run.root = tmp_path
    run.machine = machine = vm.LocalVm(tmp_path, runner=runtime)
    run.docker = acceptance.IsolatedDocker(runtime, machine.owner, run.tag)
    machine.run = run.docker
    monkeypatch.setattr(vm, "IMAGE", run.tag)
    rows = [window(100 + i, (i - 1) * 1280 + 560, "Xfce4-panel") for i in range(1, 4)]
    for row in rows:
        row["bounds"].update(y=851, width=146, height=49)
        row["title"] = "xfce4-panel"  # as the window manager lists a real one
    pending, files, bindings, urls = {}, {}, {}, {}
    form_refs, form_values = {}, {}
    closed_windows = set()
    generation = 0
    pointer = [0, 0]
    active = [None]
    launches, attachments = [], []
    viewers, owner_files, owner_text = [], set(), {}
    clipboard = [""]
    launchers = []
    # xfce4-terminal as the real driver launches it (computer.test_seat_tools.OneCopyTerminal): with --disable-server, or
    # with no copy running, its own process opens its window; else the copy does. Each window carries its launch's startup id.
    copy_pid, startup_ids = [], {}
    original_runtime = runtime.__call__

    async def runner(args, **kwargs):
        if seat_launch.MARKS in args:
            given = args[args.index(seat_launch.MARKS) + 2:]
            return vm.Result(0, "".join(f"window {row.split(':')[0]}\n" + (
                f'_NET_STARTUP_ID(UTF8_STRING) = "{startup_ids[int(row.split(":")[0])]}"\n'
                if startup_ids.get(int(row.split(":")[0])) else "") for row in given))
        if acceptance.FORM_START in args:
            return vm.Result(0, '{"port": 18765, "other_port": 18766}')
        if acceptance.FORM_STOP in args:
            return vm.Result(0, '')
        if args[0] == "run":
            runtime.raw = container(machine, machine.shared_target("", 9201, 1), runtime)
        if args[0] == 'exec' and '-d' in args and args[-1] == 'x-terminal-emulator':
            rows.append(window(999, 20))
        if "wmctrl" in args:
            command = args[args.index("wmctrl"):]
            # As a real computer lists itself (measured): one desktop window across the whole canvas, before the rest.
            if command[1] == "-lG":
                return vm.Result(0, "0x00a00028 -1 0    0    3840 1800 host Desktop\n" + "\n".join(f'0x{row["window_id"]:x} 0 ' +
                    " ".join(str(row["bounds"][key]) for key in ("x", "y", "width", "height")) +
                    f' host {row["title"]}' for row in rows))
            if command[1] == "-l":
                return vm.Result(0, "\n".join(f'0x{row["window_id"]:08x}  0 host {row["title"]}' for row in rows))
            if command[1] == "-lp":
                return vm.Result(0, "\n".join(f'0x{row["window_id"]:08x}  0 {99 if "chrom" in row["app_name"].lower() else 1} host {row["title"]}' for row in rows))
            if command[1] == "-lx":
                return vm.Result(0, "0x00a00028 -1 xfdesktop.Xfdesktop   host Desktop\n" + "\n".join(
                    f'0x{row["window_id"]:x} 0 {row["app_name"]}.{row["app_name"]} host {row["title"]}' for row in rows))
            identifier = int(command[3])
            assert identifier != 0x00a00028, "The desktop window is never closed or moved"
            if command[2] == "-c":
                rows[:] = [row for row in rows if row["window_id"] != identifier]
            elif command[4] == '-e':
                row = next(row for row in rows if row["window_id"] == identifier)
                _, x, y, width, height = command[-1].split(",")
                row["bounds"].update(x=int(x), y=int(y))
                if int(width) > 0 and int(height) > 0:
                    row['bounds'].update(width=int(width), height=int(height))
        if "pgrep" in args:
            if "-af" in args:
                return vm.Result(0, "99 /opt/google/chrome/chrome --remote-debugging-port=0 --user-data-dir=/home/cua/workspace/"
                                 ".browser-profiles/driver/main --no-sandbox --disable-blink-features=AutomationControlled "
                                 "--test-type --hide-crash-restore-bubble\n")
            return vm.Result(0, "99\n")
        guest = args[args.index(machine.shared_target("", 9201, 1).name) + 1:] if args[0] == "exec" else []
        if guest[:3] == ["sh", "-c", 'command -v "$1"']:
            return vm.Result(0, "/usr/bin/xfce4-terminal\n") if guest[4] == "xfce4-terminal" else vm.Result(1, "")
        # This world is an arm64 computer of layer 14: the members' browser is Google's Chrome, as on amd64.
        if guest[:2] == ["test", "-x"]:
            return vm.Result(0 if guest[2] == "/opt/google/chrome/chrome" else 1, "")
        if guest[:2] == ["test", "-e"] and guest[2].startswith("/usr/share/icons/"):
            assert guest[2] == "/usr/share/icons/hicolor/48x48/apps/google-chrome.png", "this world's browser is Google Chrome"
            return vm.Result(0, "")
        if guest[:1] == ["cat"] and guest[1] in owner_text:
            return vm.Result(0, owner_text[guest[1]] + "\n")
        if guest[:1] == ["cat"] and guest[1].endswith("/browser.desktop"):
            launchers.append(guest[1])
            return vm.Result(0, "[Desktop Entry]\nType=Application\nName=Google Chrome\nExec=raphael-browser %U\nIcon=google-chrome\n")
        if guest[:2] == ["test", "-e"]:
            return vm.Result(0 if guest[2] in owner_files else 1, "")
        if guest[:1] == ["dpkg"]:
            return vm.Result(0, "arm64\n")
        if guest[:1] == ["cat"] and guest[1].endswith("/policies/managed/raphael.json"):
            assert guest[1].startswith("/etc/opt/chrome/"), "this world's browser is Google Chrome"
            return vm.Result(0, json.dumps({"BrowserSignin": 0, "SyncDisabled": True, "PasswordManagerEnabled": False,
                                            "AutofillCreditCardEnabled": False, "AutofillAddressEnabled": False}))
        if guest[:1] == ["cat"] and guest[1].endswith("/Default/Preferences"):
            return vm.Result(0, json.dumps({"credentials_enable_service": False, "profile": {"password_manager_enabled": False},
                                            "autofill": {"credit_card_enabled": False, "profile_enabled": False}}))
        if guest[:1] == ["raphael-browser"]:
            # As layer 12's icon: a window where the screen has none, and no second one when pressed again.
            if not any(row["window_id"] == 556 for row in rows):
                rows.append(window(556, 60, "Google-chrome"))
            return vm.Result(0, "")
        if guest == ["/usr/lib/chromium/chromium", "--version"]:
            return vm.Result(0, "Chromium 156.0.0.0\n")
        if guest[:1] == ["/opt/google/chrome/chrome"]:
            if "--version" in guest:
                return vm.Result(0, "Google Chrome 157.0.0.0\n")
            rows.append(window(555, 40, "Google-chrome"))
            rows[-1]["title"] = "raphael-webdriver-false - Google Chrome"
            return vm.Result(0, "")
        if "xprop" in args:
            if "-root" in args:
                return vm.Result(0, "_NET_NUMBER_OF_DESKTOPS(CARDINAL) = 1\n_NET_CURRENT_DESKTOP(CARDINAL) = 0\n"
                                 f"_NET_ACTIVE_WINDOW(WINDOW): window id # {hex(active[0])}\n")
            return vm.Result(0, "_NET_WM_DESKTOP(CARDINAL) = 0\n")
        if "xwininfo" in args:
            identifier = int(args[args.index("-id") + 1])
            assert any(row["window_id"] == identifier for row in rows)
            return vm.Result(0, "Map State: IsViewable\n")
        if guest[:2] == ["sh", "-c"] and guest[2] == acceptance.CLIPBOARD_TOOL:
            return vm.Result(0, ("none" if transfer == "none" else "xclip") + "\n")
        if guest[:2] == ["sh", "-c"] and "| base64 -d | xclip -selection clipboard -i >/dev/null 2>&1" in guest[2]:
            clipboard[0] = base64.b64decode(guest[2].split()[1]).decode("utf-8")
            return vm.Result(0, "")
        if guest == ["xclip", "-selection", "clipboard", "-o"]:
            return vm.Result(0, clipboard[0])
        if guest[:2] == ["python3", "-c"] and guest[2] == acceptance.TEAM_LISTING:
            folder, mark = guest[3:5]
            entries = {}
            for path in sorted(machine.target(9202).shared.iterdir()) if folder == "/home/cua/team" else []:
                if mark in path.name or path.name.startswith(".raphael-"):
                    entries[path.name] = ["dir"] if path.is_dir() else [hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_size]
            return vm.Result(0, json.dumps(entries))
        return await original_runtime(args, **kwargs)
    run.docker.runner = runner

    async def bridge_command(target, args):
        return args
    monkeypatch.setattr(machine, "bridge_command", bridge_command)

    async def enter(self):
        self.process = SimpleNamespace(returncode=None)
        return self
    async def leave(self, *args):
        self.process = None
    async def request(self, method, params=None, **kwargs):
        nonlocal generation
        if method == "tools/list":
            return catalog()
        validate_call(method, params)
        refusal = runtime_refusal(method, params)
        if refusal:
            return refusal
        name, args = params["name"], params["arguments"]
        blocks = []
        state = {}
        text = "Action completed."
        if name == "list_windows":
            state = {"windows": deepcopy(rows)}
        elif name == "launch_app":
            # As the real driver runs it and answers (computer.test_seat_tools.driver_runs and its answers); the window
            # opens where the window manager puts it, screen 3.
            launches.append(self.target.screen)
            command, launcher = args.get("launch_path") or args.get("name"), 9000 + len(launches)
            run_words = driver_runs(args)
            if run_words is None or run_words[0][0].rsplit("/", 1)[-1] != "xfce4-terminal":
                return driver_refusal(command, launcher)
            words, environment = run_words
            own = "--disable-server" in words or not copy_pid
            if own and "--disable-server" not in words:
                copy_pid.append(launcher)
            rows.append(window(len(rows) + 200, 2600, pid=launcher if own else copy_pid[0]))
            rows[-1]["title"] = next((word.removeprefix("--title=") for word in words if word.startswith("--title=")), rows[-1]["title"])
            startup_ids[rows[-1]["window_id"]] = environment.get("DESKTOP_STARTUP_ID")
            if not own and not driver_matches(rows[-1]["app_name"], command):
                return driver_refusal(command, launcher)
            return driver_launched(command, launcher, rows[-1]["pid"], [rows[-1]])
        elif name == "get_window_state":
            state = deepcopy(next(row for row in rows if row["window_id"] == args["window_id"]))
            text = f"window_id={args['window_id']}\n[1] terminal\nelement_token for row [1] = s00000001:1"
            if args.get('include_screenshot'):
                blocks = [dict(type='image', mimeType='image/png', data=base64.b64encode(rfb_view.png([b'\x00\x00\x00'], 1, 1)).decode())]
        elif name == "move_cursor":
            pointer[:] = args["x"], args["y"]
            text = f"Moved the real desktop pointer to ({pointer[0]}, {pointer[1]})."
            state = dict(summary=text)
        elif name == "get_cursor_position":
            state = dict(x=pointer[0], y=pointer[1])
            text = f"Cursor at ({pointer[0]}, {pointer[1]})"
        elif name == "bring_to_front":
            active[0] = args["window_id"]
        elif name == "verify_state":
            row = next(row for row in rows if row["window_id"] == args["window_id"])
            assert args["expect"][0]["window"]["bounds"] == row["bounds"]
            state = dict(status="satisfied", predicates=[dict(status="satisfied", observed_json=json.dumps(dict(bounds=row["bounds"])) )])
        elif name == "type_text":
            pending[args["window_id"]] = args["text"]
        elif name == "press_key" and args["window_id"] in pending:
            text = pending.pop(args["window_id"])
            text, path = text.split(" > ")
            files[path] = text.split(" ")[-1] + "\n"
        elif name == 'hotkey' and args['keys'] == ['CTRL', 'w']:
            closed_windows.add(args['window_id'])
        elif name in ("clipboard_write", "clipboard_read"):
            if transfer == "refused":
                return {"isError": True, "content": [dict(type="text", text="Synthetic clipboard refusal")]}
            if name == "clipboard_write":
                clipboard[0] = args["text"]
            else:
                state = dict(types=["text/plain"], text=clipboard[0])
        elif name == "browser_prepare":
            if browser_failure:
                return {"isError": True, "content": [dict(type="text", text="Synthetic browser failure")]}
            assert args["strategy"] == {"kind": "existing_profile"}
            assert not {"allow_launch", "profile"} & args.keys()
            attachments.append((args["session"], args["window_id"]))
        elif name in ("get_browser_state", "browser_navigate"):
            session = args["session"]
            if "window_id" in args:
                identifier = args["window_id"]
                target = f"target-{session}-{len(bindings)}"
                bindings[target] = session, identifier
                urls.setdefault(identifier, "about:blank")
            else:
                target = args["target_id"]
                if target not in bindings or bindings[target][0] != session:
                    return {"isError": True, "content": [{"type": "text", "text": "protected_resource_scope_invalid"}]}
                identifier = bindings[target][1]
            if name == 'get_browser_state' and identifier in closed_windows and 'target_id' in args:
                message = f"confirmation provider failed: tab {args['tab_id']} no longer has a live CDP page target"
                return dict(isError=True, content=[dict(type='text', text=message)], structuredContent=dict(
                    status='refused', refusal=dict(code='authorization_host_failed', message=message)))
            if name == "browser_navigate":
                urls[identifier] = args["url"]
            state = (dict(target_id=target, tabs=[dict(tab_id="tab", active=True, url=urls[identifier])]) if "window_id" in args else
                     dict(target_id=target, tab_id="tab", page=dict(url=urls[identifier])))
            if name == 'get_browser_state' and urls[identifier].startswith('http://127.0.0.1:') and 'window_id' not in args:
                generation += 1
                form_values.setdefault((identifier, 'Name'), 'existing')
                names = (['Name', 'Secret'] if generation % 2 else ['Secret', 'Name']) if urls[identifier].endswith('/') else []
                form_refs[target, 'tab'] = [dict(ref=f'p{generation}:{index}', frame='main', role='textbox', name=name,
                    actions=['type', 'pointer'], value=('????' if name == 'Secret' and form_values.get((identifier, name)) else form_values.get((identifier, name))))
                    for index, name in enumerate(names, 1)]
                if names:
                    form_refs[target, 'tab'].append(dict(ref=f'p{generation}:frame', frame='iframe', role='textbox', name='Name', actions=['type'], value=None))
                state.update(refs=form_refs[target, 'tab'], snapshot=dict(id=f'p{generation}', complete=True, continuation=None))
                if args.get('include_screenshot'):
                    blocks = [dict(type='image', mimeType='image/png', data=base64.b64encode(rfb_view.png([b'\x00\x00\x00'], 1, 1)).decode())]
            text = "Bound browser page."
        elif name == 'browser_type':
            from computer.fixtures.semantic_browser import refused
            rows_for_tab = form_refs.get((args['target_id'], args['tab_id']), [])
            row = next((row for row in rows_for_tab if row['ref'] == args['ref']), None)
            if row is None:
                return refused(args['ref'])
            identifier = bindings[args['target_id']][1]
            assert row['frame'] == 'main'
            form_values[identifier, row['name']] = args['text'] if args.get('replace') else args['text'] + (form_values.get((identifier, row['name'])) or '')
            state = dict(effect='unverifiable', delivery=dict(delivered_count=len(args['text'])))
        return dict(content=[dict(type="text", text=text), *blocks], structuredContent=state)
    monkeypatch.setattr(CuaBridge, "__aenter__", enter)
    monkeypatch.setattr(CuaBridge, "__aexit__", leave)
    monkeypatch.setattr(CuaBridge, "request", request)

    async def browser(target):
        assert machine.native_busy(target)
        row = window(300 + target.screen, (target.screen - 1) * 1280 + 20, "Google-chrome", 99)
        rows.append(row)
        return {key: row[key] for key in ("pid", "window_id")}
    monkeypatch.setattr(machine, "seat_browser", browser)

    seed = {'target': machine.target_for('', machine.key_for('', 9201)), 'port': 18767}
    seed_calls, carry_checks, dataset_tables = [], [], {}
    async def carry_seed(member):
        seed_calls.append(member)
        return seed
    async def carried(tool, supplied_seed, target, member):
        carry_checks.append((supplied_seed, target, member))
        return 'Synthetic carry boundary; Linux copy and core retry have their own offline tests'
    monkeypatch.setattr(run, 'seed_shared_carry', carry_seed)
    monkeypatch.setattr(run, 'check_shared_carry', carried)
    seat_windows = []

    async def windows_of_a_seat(tool, target, member):
        seat_windows.append((target.screen, member))
        return 'Synthetic seat windows; the real window list, tabs and geometry are proven on a real computer'
    monkeypatch.setattr(run, 'seat_windows', windows_of_a_seat)
    monkeypatch.setattr('raphael_core.computer.datasets.command_for', lambda args: 'dataset-runtime:' + json.dumps(args))

    original_sleep = asyncio.sleep
    async def execute(target, command, timeout=60, **kwargs):
        if command.startswith("sleep"):
            await original_sleep(.1)
            return dict(exit_code=0, output="")
        if command.startswith('python3 -c '):
            import ast
            import shlex
            script = ast.parse(shlex.split(command)[2])
            call = script.body[-1].value
            path = ast.literal_eval(call.func.value.args[0])
            files[path] = ast.literal_eval(call.args[0])
            return dict(exit_code=0, output='')
        if command.startswith('dataset-runtime:'):
            args = json.loads(command.removeprefix('dataset-runtime:'))
            tables = dataset_tables.setdefault((args['member_key'], args['dataset']), {})
            if args['action'] == 'import':
                tables[args['table']] = int(files[args['sources'][0]].splitlines()[1])
                result = {'count': 1}
            elif args['action'] == 'query':
                result = {'rows': [[tables[args['sql'].split()[-1]]]]}
            else:
                result = {'rows': [[table] for table in sorted(tables)]}
            return dict(exit_code=0, output=json.dumps(result))
        path = command.removeprefix("cat ")
        return dict(exit_code=0 if path in files else 1, output=files.get(path, ""))
    monkeypatch.setattr(machine, "execute", execute)
    monkeypatch.setattr(machine, "checkpoint", lambda *args, **kwargs: original_sleep(0))

    async def opened(self, params):
        target = await machine.seat(params["member_id"])
        self.sessions["owner"] = Session(target, machine.clock() + 100, member_id=params["member_id"])
        self.sessions["owner"].sockets.add("fake-listener")
        viewers.append(self)
        return {"session": "owner", "url": "http://127.0.0.1:18080/owner/vnc.html"}
    monkeypatch.setattr(acceptance.DesktopViewer, "open", opened)

    class OwnerHands:
        """The owner's end of a seat's view: what it sends reaches the seat only while the owner's session holds it."""
        typed = ""

        def held(self):
            session = viewers[-1].sessions.get("owner")
            return bool(session and viewers[-1].owners.get(session.target.key) == "owner")

        def pointer(self, x, y, buttons=0):
            # The third launcher of the seat's panel opens a terminal there.
            if buttons and self.held() and y > 851 and not any(row["window_id"] == 777 for row in rows):
                rows.append(window(777, 1280 + 300, "Xfce4-terminal"))

        def keys(self, *keysyms):
            if not self.held():
                return
            for key in keysyms:
                if key == 0xff0d:
                    owner_files.add(self.typed.removeprefix("touch "))
                    self.typed = ""
                else:
                    self.typed += chr(key)

        def type_text(self, text):
            """What a seat's view server does with the keys: a key that needs Shift arrives only with Shift held."""
            if not self.held():
                return
            shift = False
            for character in text:
                for key, down in rfb_view.keystrokes(character):
                    if key == rfb_view.SHIFT_L:
                        shift = bool(down)
                    elif not down:
                        continue
                    elif key == 0xff0d:
                        line, self.typed = self.typed, ""
                        if line.startswith("touch "):
                            owner_files.add(line.removeprefix("touch "))
                        elif line.startswith("echo '"):
                            written, _, path = line[len("echo '"):].partition("' > ")
                            owner_files.add(path)
                            owner_text[path] = written
                    elif chr(key) not in rfb_view.SHIFTED or shift:
                        self.typed += chr(key)

    monkeypatch.setattr(run, "http", lambda port, path, origin=None: (200, json.dumps({"path": "/owner/websockify/1", "password": "private"}).encode()))
    monkeypatch.setattr(run, "connect", lambda port, path, password, origin=None: (SimpleNamespace(close=lambda: None), OwnerHands()))

    async def tree(target):
        return [acceptance.Window(hex(row["window_id"]), row["title"], tuple(row["bounds"][key] for key in ("x", "y", "width", "height")),
                                  "terminal" in row["app_name"].lower()) for row in rows]
    monkeypatch.setattr(run, "tree", tree)

    def capture(port, password, screen, **kwargs):
        pixels = [b"\x05\x05\x05"] * (1280 * 900)
        for row in rows:
            if "terminal" not in row["app_name"].lower():
                continue
            bounds = row["bounds"]
            if bounds["x"] // 1280 + 1 != screen:
                continue
            x = bounds["x"] % 1280
            for y in range(bounds["y"], bounds["y"] + 50):
                pixels[y * 1280 + x:y * 1280 + x + bounds["width"]] = [b"\xff\xff\xff"] * bounds["width"]
        return rfb_view.png(pixels)
    monkeypatch.setattr(rfb_view, "capture", capture)
    if stop_failure:
        async def failed_stop(target):
            raise AssertionError("Synthetic stop failure")
        monkeypatch.setattr(run, "stop", failed_stop)
        with pytest.raises(AssertionError, match="One or more shared checks failed"):
            await run.shared()
        assert any(row["name"] == "shared stop" and row["result"] == "failed" for row in run.results)
        return
    if launch_failure:
        import shlex
        monkeypatch.setattr("raphael_core.computer.vm_tools.VmTools.launch_window_wait_s", .5)
        if launch_failure == "unrunnable":
            def tagged(args, tag, path=None):
                command = " ".join([args.get("launch_path") or shlex.quote(path), *map(shlex.quote, args.get("additional_arguments") or [])])
                sent = {key: value for key, value in args.items() if key not in ("launch_path", "name", "additional_arguments")}
                return {**sent, "launch_path": f"env DESKTOP_STARTUP_ID={tag} RAPHAEL_LAUNCH={tag} sh -c {shlex.quote(command)}"}
            monkeypatch.setattr(seat_launch, "tagged", tagged)
        else:
            monkeypatch.setattr(seat_launch, "tied", lambda *args: False)
        with pytest.raises(AssertionError, match="One or more shared checks failed"):
            await run.shared()
        wall, landed = (next(row for row in run.results if row["name"] == name)
                        for name in ("shared terminal wall", "shared launches land on their own screens"))
        assert [row["name"] for row in run.results if row["result"] == "failed"] == [wall["name"], landed["name"]]
        if launch_failure == "unrunnable":
            # As the real engine answered.
            for row in (wall, landed):
                assert "was handed off for D-Bus activation but no new window appeared within 8s" in row["detail"], row
        else:
            assert "Expected one terminal on member 9201's screen" in wall["detail"]
            assert "to name its window on its own screen" in landed["detail"] and "nothing ties to it" in landed["detail"]
        assert next(row for row in run.results if row["name"] == "shared pointer wall")["result"] == "skipped"
        return
    if transfer in ("refused", "corrupt"):
        from raphael_core.computer import owner_transfer
        if transfer == "corrupt":
            original = owner_transfer.place_copy
            def damaged(source, root, name):
                placed = original(source, root, name)
                (root / placed).write_bytes((root / placed).read_bytes()[:-1] + b"?")
                return placed
            monkeypatch.setattr(owner_transfer, "place_copy", damaged)
        with pytest.raises(AssertionError, match="One or more shared checks failed"):
            await run.shared()
        outcome = {row["name"]: row for row in run.results if row["name"].startswith("shared owner ") and row["name"] != "shared owner control"
                   and row["name"] != "shared owner input"}
        if transfer == "corrupt":
            assert {name: row["result"] for name, row in outcome.items()} == {"shared owner paste": "ok", "shared owner copy": "ok", "shared owner files": "failed"}
            assert "Expected the guest to read exactly" in outcome["shared owner files"]["detail"]
        else:
            assert {name: row["result"] for name, row in outcome.items()} == {"shared owner paste": "failed", "shared owner copy": "failed", "shared owner files": "ok"}
            assert "observed {'put': False}" in outcome["shared owner paste"]["detail"]
            assert "clipboard_write refused or failed" in outcome["shared owner paste"]["detail"]
            assert "screen held by the owner: True" in outcome["shared owner copy"]["detail"]
            assert "observed {'copied': False} and []" in outcome["shared owner copy"]["detail"]
            assert "clipboard_read refused or failed" in outcome["shared owner copy"]["detail"]
        # What was placed in the team folder is taken away again, a failed step or not.
        assert not [path for path in machine.target(9202).shared.iterdir() if "報告" in path.name or "rép" in path.name]
        return
    if browser_failure:
        with pytest.raises(AssertionError, match="One or more shared checks failed"):
            await run.shared()
        assert any(row["name"] == "shared computer browser" and row["result"] == "failed" for row in run.results)
        for name in ("shared page text", "shared foreground page hold", "shared session ends independently"):
            assert any(row["name"] == name and row["result"] == "skipped" for row in run.results)
        control = next(row for row in run.results if row["name"] == "shared owner control")
        assert "page/read continue" not in control["detail"]
        return
    result = await run.shared()
    assert "completed" in result
    assert not [row for row in run.results if row["result"] != "ok"], run.results
    assert [row["name"] for row in run.results] == ["shared carry seed", "shared prepares", "shared window lists", "shared member datasets", "shared terminal wall",
        "shared launches land on their own screens", "shared pointer wall", "shared target forms", "shared native text", "shared seat-local verify", "shared global shortcuts",
        "shared simultaneous native typing", "shared computer browser", "shared typed form", "shared browser is a person's", "shared seat windows", "shared page text", "shared clipped product pictures", "shared owner control", "shared owner input",
        "shared owner paste", "shared owner copy", "shared owner files", "shared member copy", "shared seat teaching", "shared session ends independently", "shared seat displacement", "shared carried home", "shared stop"]
    assert seed_calls == [9201] and len(carry_checks) == 1 and seat_windows == [(1, 9201)]
    paste, copy, dropped = (next(row for row in run.results if row["name"] == f"shared owner {step}")["detail"] for step in ("paste", "copy", "files"))
    # The two texts of each are read and written by the guest's own program, or by the driver when the image has none.
    assert ("the driver's own clipboard_read" if transfer == "none" else "xclip") in paste
    assert ("by the driver" if transfer == "none" else "by xclip") in copy and clipboard == [acceptance.OWNER_TEXTS[0]]
    assert "報告 ✓ (2).bin" in dropped and "rép_ort__.txt" in dropped and "3 drops placed" in dropped
    assert not [path for path in machine.target(9202).shared.iterdir() if "報告" in path.name or "rép" in path.name]
    # The terminal wall launches once a seat; the launch check twice together and once more at the second seat.
    assert launches[:2] == [1, 2] and sorted(launches[2:]) == [1, 2, 2] and launches[-1] == 2
    landed = next(row for row in run.results if row["name"] == "shared launches land on their own screens")
    # Each launch's window was brought from where this world's window manager opens it (screen 3) to its own seat.
    assert "wholly inside screen 1" in landed["detail"] and landed["detail"].count("wholly inside screen 2") == 2
    # The first launch is the copy the other two hand their windows to, and each window carries its own launch's id.
    assert landed["detail"].count("(launch pid 900") == 3 and "the second seat's second window is in the copy" in landed["detail"]
    assert "a startup id on the window itself on 3 of 3 (3 different), on its leader on 0" in landed["detail"]
    # The shared computer's panel on each of its six screens is read for the browser's name and mark.
    assert launchers == [f"/home/cua/.config/xfce4/panel/launcher-{number}/browser.desktop" for number in (1, 4, 7, 10, 13, 16)]
    assert len(attachments) == 3 and len({session for session, _ in attachments}) == 2
    assert len(files) == 6


async def test_form_server_programs_require_exact_run_owner_before_guest_execution(tmp_path):
    runner = FakeDocker()
    machine = vm.LocalVm(tmp_path, runner=runner)
    target = machine.target(1)
    runner.containers[target.name] = raw_container(target.name, machine.owner)
    guard = acceptance.IsolatedDocker(runner, machine.owner, 'raphael-acceptance/cua-local-vm:test')
    for program in (acceptance.FORM_START, acceptance.FORM_STOP):
        compile(program, "<acceptance guest>", "exec")
        for extra in ([], ['foreign'], [machine.owner, 'extra']):
            with pytest.raises(AssertionError, match='exact form program'):
                await guard.authorize(['exec', '-u', 'cua', target.name, 'python3', '-c', program, *extra])
        await guard.authorize(['exec', '-u', 'cua', target.name, 'python3', '-c', program, machine.owner])
    runner.containers[target.name]['Config']['Labels'][f'{vm.LABEL}.owner'] = 'foreign'
    with pytest.raises(AssertionError):
        await guard.authorize(['exec', '-u', 'cua', target.name, 'python3', '-c', acceptance.FORM_START, machine.owner])


async def test_carry_guard_accepts_only_exact_offline_helper_on_registered_homes_and_image(tmp_path, monkeypatch):
    from raphael_core.computer import carry
    machine = vm.LocalVm(tmp_path, runner=FakeDocker())
    guard = acceptance.IsolatedDocker(machine.run, machine.owner, 'raphael-acceptance/cua-local-vm:test')
    monkeypatch.setattr(vm, 'IMAGE', guard.tag)
    source, target = machine.target(1), machine.shared_target('', 1, 1)
    guard.carry_homes = {str(home.workspace): home for home in (source, target)}
    data = {'operation': 'copy', 'key': source.key, 'folder': 'Ada', 'profile': True, 'excluded': carry.EXCLUDE}
    args = carry.helper_args(source, target, data)
    await guard.authorize(args)
    long_base = carry.folder_name('\u754c' * 100, source.key, set())
    for folder in (long_base, carry.folder_name(long_base, source.key, {long_base})):
        await guard.authorize(carry.helper_args(source, target, {**data, 'folder': folder}))
    assert args[6:8] == ['--name', f'raphael-carry-{machine.owner}-{source.key}']
    for index, value in ((3, 'host'), (5, 'cua'), (7, f'raphael-carry-{machine.owner}-' + 'b' * 16), (7, source.name),
                         (9, str(source.workspace) + ':/from'), (11, str(tmp_path / 'foreign') + ':/to'),
                         (14, vm.BASE), (16, 'echo unsafe')):
        invalid = list(args)
        invalid[index] = value
        with pytest.raises((AssertionError, ValueError)):
            await guard.authorize(invalid)
    # A helper that is given up is killed by its own name; that permission never reaches a computer.
    for command in ('kill', 'wait'):
        await guard.authorize([command, carry.helper_name(source)])
        for name in (source.name, target.name, 'raphael-carry-foreign-' + source.key, carry.helper_name(source) + '-x'):
            with pytest.raises(AssertionError):
                await guard.authorize([command, name])
        with pytest.raises(AssertionError):
            await guard.authorize([command, carry.helper_name(source), source.name])
    for change in ({'key': 'b' * 16}, {'folder': '../other'}, {'folder': None},
                   {'folder': 'Ada-' + source.key + '-' + '2' * 256}, {'excluded': []}, {'extra': True}):
        with pytest.raises(AssertionError):
            await guard.authorize(carry.helper_args(source, target, {**data, **change}))
    guard.carry_homes.pop(str(source.workspace))
    with pytest.raises(AssertionError, match='registered'):
        await guard.authorize(args)


@pytest.mark.parametrize('cookie,rows,repeat', [(True, [[37]], False), (False, [[37]], False),
                                             (True, [[99]], False), (True, [[37]], True)])
async def test_carried_acceptance_requires_real_outcomes_and_no_copy_on_restart(tmp_path, monkeypatch, cookie, rows, repeat):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from raphael_core.computer import carry
    run = acceptance.Acceptance(FakeDocker())
    run.machine = machine = vm.LocalVm(tmp_path, runner=run.runner)
    target = machine.shared_target('', 1, 1)
    seed = {'target': machine.target(1), 'port': 18767}
    run.docker = SimpleNamespace(carry_calls=1)
    monkeypatch.setattr(carry, 'journal', AsyncMock(return_value={seed['target'].key:
                        {'status': 'done', 'profile': 'carried', 'folder': 'Ada'}}))
    machine.disconnect_unit = AsyncMock()
    machine.stop = AsyncMock()
    async def start(target):
        if repeat:
            run.docker.carry_calls += 1
    machine.start = start
    calls = []
    async def tool(member, name, args):
        calls.append((name, args))
        if name == 'vm_exec':
            data = {'exit_code': 0, 'output': 'stage-d' if args['command'].startswith('cat ') else '{}'}
        elif name == 'dataset':
            data = {'rows': rows}
        else:
            return SimpleNamespace(text='stage_d=' + machine.owner if cookie else 'no cookie')
        return SimpleNamespace(text=json.dumps(data))
    if cookie and rows == [[37]] and not repeat:
        assert 'second start' in await run.check_shared_carry(tool, seed, target, 1)
        assert [name for name, _ in calls] == ['vm_exec', 'browser_open', 'vm_exec', 'dataset', 'browser_open']
        machine.stop.assert_awaited_once_with(target)
    else:
        with pytest.raises(AssertionError):
            await run.check_shared_carry(tool, seed, target, 1)


def test_carry_cookie_server_is_persistent_loopback_and_test_owner_scoped():
    compile(acceptance.CARRY_SERVER, '<carry server>', 'exec')
    compile(acceptance.CARRY_START, '<carry start>', 'exec')
    assert "('127.0.0.1',port)" in acceptance.CARRY_SERVER
    assert 'Max-Age=3600' in acceptance.CARRY_SERVER and "self.path=='/set'" in acceptance.CARRY_SERVER
    assert "'stage_d='+owner" in acceptance.CARRY_SERVER


async def test_carry_seed_uses_product_tools_flushes_cookie_and_stops_source(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    run = acceptance.Acceptance(FakeDocker())
    run.root = tmp_path
    run.machine = vm.LocalVm(tmp_path, runner=run.runner)
    run.docker = run.runner
    source = vm.LocalVm(tmp_path, runner=run.runner)
    source.start, source.stop, source.aclose = AsyncMock(), AsyncMock(), AsyncMock()
    monkeypatch.setattr(vm, 'LocalVm', lambda *args, **kwargs: source)
    calls, waits = [], []
    class Tools:
        def __init__(self, *args, **kwargs): pass
        async def prepare(self, member): pass
        async def _discover(self, target): pass
        async def aclose(self): calls.append(('close', {}))
        async def call(self, key, args, **kwargs):
            calls.append((key, args))
            return SimpleNamespace(ok=True, kind='ok', text=json.dumps({'output': '{"port":18767}'}))
    async def sleep(seconds):
        waits.append(seconds)
    monkeypatch.setattr(acceptance, 'VmTools', Tools)
    monkeypatch.setattr(acceptance.asyncio, 'sleep', sleep)
    seed = await run.seed_shared_carry(9201)
    assert not seed['target'].container and seed['port'] == 18767
    assert waits == [40]
    assert any(key.endswith('dataset') and args['action'] == 'import' for key, args in calls)
    assert any(key.endswith('browser_open') and args['url'] == 'http://127.0.0.1:18767/set' for key, args in calls)
    source.stop.assert_awaited_once_with(seed['target'])


async def test_one_screen_block_runs_product_form_once_and_other_counts_do_not(tmp_path, monkeypatch):
    run = acceptance.Acceptance(FakeDocker())
    run.root = tmp_path
    run.machine = vm.LocalVm(tmp_path, runner=run.runner)
    seen = []
    async def check(name, action):
        if name.endswith('typed form'):
            await action()
        return True
    async def form(target, member):
        seen.append((target.screens, member))
        return 'synthetic boundary'
    monkeypatch.setattr(run, 'check', check)
    monkeypatch.setattr(run, 'per_bot_form', form)
    for count in (1, 3, 6):
        await run.computer(count, 6)
    assert seen == [(1, 1)]


@pytest.mark.parametrize("fault", [None, "globe", "helper", "second browser entry", "dialog", "firefox left"])
async def test_browser_mark_reads_the_launcher_the_helper_the_menu_and_what_the_web_browser_opens(tmp_path, monkeypatch, fault):
    # An owner looked at a globe named "Browser" over Google Chrome; XFCE's own "Web Browser" asked which
    # application to prefer; the menu's Chrome entry was a browser that cannot start in a computer.
    run = acceptance.Acceptance(FakeDocker())
    run.machine = vm.LocalVm(tmp_path, runner=run.runner)
    target = run.machine.target(1)
    listed = ["0x00c00003 -1 xfce4-panel.Xfce4-panel  host xfce4-panel"]
    closed = []

    async def guest(target, args, *, allow_failure=False):
        if args[0] == "test":
            return vm.Result(0, "")
        if args[0] == "cat" and args[1].endswith("/launcher-1/browser.desktop"):
            name, icon = ("Browser", "web-browser") if fault == "globe" else ("Google Chrome", "google-chrome")
            return vm.Result(0, f"[Desktop Entry]\nType=Application\nName={name}\nExec=raphael-browser %U\nIcon={icon}\n")
        if args == ["cat", "/home/cua/.config/xfce4/helpers.rc"]:
            return vm.Result(0, f"WebBrowser={'firefox-esr' if fault == 'helper' else 'raphael-browser'}\nTerminalEmulator=xfce4-terminal\n")
        if args[0] == "readlink":
            return vm.Result(0, "/usr/local/bin/raphael-browser\n")
        if args[:2] == ["sh", "-c"] and args[2] == acceptance.MENU_BROWSERS:
            chrome = "/usr/bin/google-chrome-stable %U" if fault == "second browser entry" else "raphael-browser %U"
            return vm.Result(0, f"google-chrome|Exec={chrome}|1\nchromium|Exec=raphael-browser %U|1\n")
        if args[:2] == ["sh", "-c"] and args[2] == acceptance.NO_FIREFOX:
            return vm.Result(0, "/usr/lib/firefox-esr\npackage firefox-esr\n" if fault == "firefox left" else "")
        if args[:2] == ["sh", "-c"]:
            assert "exo-open --launch WebBrowser" in args[2]
            opened = "xfce4-mime-helper.Xfce4-mime-helper" if fault == "dialog" else "google-chrome.Google-chrome"
            listed.append(f"0x01200004  0 {opened}  host New Tab")
            return vm.Result(0, "")
        if args == ["wmctrl", "-lx"]:
            return vm.Result(0, "\n".join(listed) + "\n")
        if args[:3] == ["wmctrl", "-i", "-c"]:
            closed.append(args[3])
            listed[:] = [line for line in listed if not line.startswith(args[3])]
            return vm.Result(0, "")
        raise AssertionError(f"unexpected guest command {args}")

    async def pause(seconds):
        return None
    monkeypatch.setattr(run, "guest", guest)
    monkeypatch.setattr(acceptance.asyncio, "sleep", pause)
    if fault is None:
        detail = await run.browser_mark(target)
        assert "every launcher is Google Chrome under the google-chrome mark" in detail
        assert "XFCE's Web Browser opened Google Chrome" in detail and "chromium, google-chrome entries" in detail
        assert detail.endswith("no Firefox ESR is left")
        assert closed == ["0x01200004"] and len(listed) == 1
        return
    expected = {"globe": "launcher to be Google Chrome under its own mark", "helper": "Web Browser to be the computer's browser",
                "second browser entry": "menu's other browser entries", "dialog": "to open Google Chrome, observed",
                "firefox left": "no Firefox ESR in the computer, observed"}[fault]
    with pytest.raises(AssertionError, match=expected):
        await run.browser_mark(target)
    # What the check opened is closed again even when it is the wrong thing.
    assert closed == (["0x01200004"] if fault == "dialog" else [])


@pytest.mark.parametrize("failure", [False, True])
async def test_per_bot_form_drives_product_open_ref_refusal_and_the_shared_fill_helper(tmp_path, monkeypatch, failure):
    from types import SimpleNamespace
    from computer.test_vm import Runtime, container
    from computer.fixtures.semantic_browser import measured
    from raphael_core.computer.vm_bridge import CuaBridge
    runtime = Runtime()
    run = acceptance.Acceptance(runtime)
    run.root = tmp_path
    run.machine = machine = vm.LocalVm(tmp_path, runner=runtime)
    target = machine.target(1)
    monkeypatch.setattr(vm, 'IMAGE', run.tag)
    runtime.raw = container(machine, target, runtime)
    programs, calls = [], []
    async def runner(args, **kwargs):
        if acceptance.FORM_START in args:
            programs.append('start')
            return vm.Result(0, '{"port": 18765, "other_port": 18766}')
        if acceptance.FORM_STOP in args:
            programs.append('stop')
            return vm.Result(0, '')
        return await runtime(args, **kwargs)
    run.docker = acceptance.IsolatedDocker(runner, machine.owner, run.tag)
    machine.run = run.docker
    async def enter(self):
        self.process = SimpleNamespace(returncode=None)
        self.url = 'about:blank'
        self.closed = False
        return self
    async def leave(self, *args):
        self.process = None
    @measured(('Name', 'Secret'))
    async def request(self, method, params=None, **kwargs):
        if method == 'tools/list':
            return catalog()
        validate_call(method, params)
        name, args = params['name'], params['arguments']
        calls.append((name, dict(args)))
        if name == 'browser_type' and failure:
            from computer.fixtures.semantic_browser import refused
            return refused(args['ref'])
        if name == 'browser_prepare':
            assert args['allow_launch'] and args['profile']['mode'] == 'isolated_named'
            return {'structuredContent': {'pid': 99}}
        if name == 'list_windows':
            window = dict(pid=99, window_id=7, app_name='Chromium-browser', title='Form', bounds=dict(x=20, y=30, width=600, height=400))
            from raphael_core.computer.seat_view import windows_text
            return {'structuredContent': {'windows': [window]}, 'content': [dict(type='text', text=windows_text({'windows': [window]}))]}
        if name == 'browser_navigate':
            self.url = args['url']
        if name == 'get_browser_state':
            if self.closed and 'target_id' in args:
                message = f"confirmation provider failed: tab {args['tab_id']} no longer has a live CDP page target"
                return dict(isError=True, content=[dict(type='text', text=message)], structuredContent=dict(
                    status='refused', refusal=dict(code='authorization_host_failed', message=message)))
            self.semantic_values.setdefault((('own', 'tab'), 'Name'), 'existing')
            if 'window_id' in args:
                return {'structuredContent': dict(target_id='own', tabs=[dict(tab_id='tab', active=True, url=self.url)])}
            return {'structuredContent': dict(target_id='own', tab_id='tab', page={'url': self.url})}
        if name == 'hotkey' and args['keys'] == ['CTRL', 'w']:
            self.closed = True
        return {'content': []}
    measured_request = request
    async def request(self, method, params=None, **kwargs):
        reply = await measured_request(self, method, params, **kwargs)
        if method == 'tools/call' and not reply.get('isError'):
            name, args = params['name'], params['arguments']
            if name == 'get_browser_state' and 'target_id' in args:
                state = reply['structuredContent']
                if self.url.endswith('/'):
                    state['refs'].append(dict(ref=f"{state['snapshot']['id']}:frame", frame='iframe', role='textbox',
                        name='Name', actions=['type'], value=None))
                else:
                    state['refs'] = []
            if name == 'get_desktop_state' or name in ('get_window_state', 'get_browser_state') and args.get('include_screenshot'):
                from raphael_core.computer.rfb_view import png
                reply.setdefault('content', []).append(dict(type='image', mimeType='image/png', data=base64.b64encode(png([b'\x00\x00\x00'], 1, 1)).decode()))
        return reply
    monkeypatch.setattr(CuaBridge, '__aenter__', enter)
    monkeypatch.setattr(CuaBridge, '__aexit__', leave)
    monkeypatch.setattr(CuaBridge, 'request', request)
    before = machine.bridge_command, machine.disconnect_driver, machine.busy, machine.native_busy, machine.input_busy
    if failure:
        with pytest.raises(ValueError):
            await run.per_bot_form(target, 1)
    else:
        result = await run.per_bot_form(target, 1)
        assert 'password masked/nonempty' in result
    assert programs == ['start', 'stop']
    typed = [args for name, args in calls if name == 'browser_type']
    assert [args['text'] for args in typed] == (['acceptance 王小明'] if failure else ['acceptance 王小明', 'acceptance-secret'] * 3)
    assert all(args['replace'] is True for args in typed)
    assert all(args['ref'] != 'p1:1' for args in typed)
    assert before == (machine.bridge_command, machine.disconnect_driver, machine.busy, machine.native_busy, machine.input_busy)


async def test_per_bot_form_restores_callbacks_even_when_teardown_raises(tmp_path, monkeypatch):
    from computer.test_vm import Runtime
    run = acceptance.Acceptance(Runtime())
    run.root = tmp_path
    run.machine = machine = vm.LocalVm(tmp_path, runner=run.runner)
    before = machine.bridge_command, machine.disconnect_driver, machine.busy, machine.native_busy, machine.input_busy
    class BrokenClose:
        def __init__(self, *args, **kwargs):
            machine.busy = machine.native_busy = machine.input_busy = lambda *_: True
            machine.disconnect_driver = lambda *_: None
        async def prepare(self, member): pass
        async def _discover(self, target): pass
        async def aclose(self): raise OSError('Synthetic teardown failure')
    async def form(*args): return 'synthetic form'
    monkeypatch.setattr(acceptance, 'VmTools', BrokenClose)
    monkeypatch.setattr(run, 'form', form)
    with pytest.raises(OSError, match='Synthetic teardown failure'):
        await run.per_bot_form(machine.target(1), 1)
    assert before == (machine.bridge_command, machine.disconnect_driver, machine.busy, machine.native_busy, machine.input_busy)


class PanelAcceptance:
    """`Acceptance.quiet` and `panel_plugins` against a computer whose panels load one after another."""

    def __init__(self, widths, plugins):
        self.widths, self.plugins, self.looks = widths, plugins, 0

    async def tree(self, target):
        self.looks += 1
        widths = self.widths[min(self.looks - 1, len(self.widths) - 1)]
        return [acceptance.Window(hex(i + 1), "xfce4-panel", (1280 * (i % 2) + 567, 900 * (i // 2) + 851, width, 49), False)
                for i, width in enumerate(widths)]

    async def viewable(self, target, window):
        return True

    async def guest(self, target, args, *, allow_failure=False):
        number = int(args[-1].split("/")[2].removeprefix("panel-"))
        ids = self.plugins.get(number, [])
        return vm.Result(0 if ids else 1, "Value is an array with 3 items:\n\n" + "\n".join(ids) if ids else "")

    panel_plugins = acceptance.Acceptance.panel_plugins
    quiet = acceptance.Acceptance.quiet


async def test_a_panel_that_loads_late_is_waited_for_and_one_that_stays_empty_fails_naming_what_it_holds(monkeypatch):
    # Seat 2's panel was seen 12 px wide, holding nothing, for twenty seconds and more.
    target = vm.Target("k", "n", None, None, screen=1, screens=4, container="shared")
    ids = {i: [*map(str, range(i * 3 - 2, i * 3 + 1)), str(18 + i)] for i in range(1, 5)}
    sleeps = []

    async def sleep(seconds):
        sleeps.append(seconds)
    monkeypatch.setattr(acceptance.asyncio, "sleep", sleep)
    late = PanelAcceptance([[146, 146, 12, 12], [146, 146, 146, 12], [146] * 4], ids)
    assert "one panel per screen with its three launchers and its window list" in await late.quiet(target)
    # A panel is as wide as its launchers and its windows' buttons (image layer 12): a wider one is as whole.
    wide = PanelAcceptance([[146, 194, 242, 146]], ids)
    assert "its window list" in await wide.quiet(target)
    assert late.looks == 3 and len(sleeps) == 2
    # The panel holds nothing: no plugin ids, and 12 px for as long as the check waits (a clock that jumps a minute).
    clock = iter([0, 0, 61, 61, 61, 61])
    monkeypatch.setattr(acceptance.time, "monotonic", lambda: next(clock))
    empty = PanelAcceptance([[146, 12, 146, 146]], {**ids, 2: []})
    with pytest.raises(AssertionError, match=r"within 60 s.*plugin ids .*2: \[\]"):
        await empty.quiet(target)
    # Whole panels without the three launchers by their own ids are no pass either.
    monkeypatch.undo()
    wrong = PanelAcceptance([[146] * 4], {**ids, 2: ["1", "2", "3", "19"]})
    with pytest.raises(AssertionError, match="its own three launchers and window list"):
        await wrong.quiet(target)
    # Nor are its launchers without its window list.
    wrong = PanelAcceptance([[146] * 4], {**ids, 2: ["4", "5", "6"]})
    with pytest.raises(AssertionError, match="its own three launchers and window list"):
        await wrong.quiet(target)


def test_the_cached_steps_are_read_from_buildkits_plain_progress():
    log = "\n".join(["#1 [internal] load build definition from Dockerfile", "#1 transferring dockerfile: 210B done", "#1 DONE 0.0s",
                     "#4 importing cache manifest from raphael-acceptance-0/cua-local-vm:driver-0.37.0-v12", "#4 DONE 0.1s",
                     "#5 [1/2] COPY unchanged.txt /unchanged.txt", "#5 CACHED", "", "#6 [2/2] COPY layer.txt /layer.txt",
                     "#6 DONE 0.0s", "#7 exporting to image", "#7 CACHED"])
    assert acceptance.cached_steps(log) == {"COPY unchanged.txt /unchanged.txt"}
    assert acceptance.cached_steps("") == set()


def test_the_inline_cache_record_is_read_from_the_saved_configuration_alone(tmp_path):
    engine = FakeDocker()
    for tag, inline in (("with:record", True), ("without:record", False)):
        engine.images[tag] = {"Id": "sha256:" + "1" * 64, "Config": {"Labels": {}}, "inline": inline}
        asyncio.run(engine(["save", "-o", str(tmp_path / f"{inline}.tar"), tag]))
    assert acceptance.inline_cache_record(tmp_path / "True.tar") is True
    assert acceptance.inline_cache_record(tmp_path / "False.tar") is False


async def test_the_image_update_commands_pass_only_while_it_runs_and_only_for_its_own_repository(tmp_path):
    runner = FakeDocker()
    guard = acceptance.IsolatedDocker(runner, "owner", "raphael-acceptance/cua-local-vm:test")
    repository, folder = "raphael-acceptance-0a/cua-local-vm", (tmp_path / "image-update").resolve()
    folder.mkdir()
    ours, theirs = f"{repository}:driver-0.37.0-v12", "raphael/cua-local-vm:driver-0.37.0-v12"
    allowed = [acceptance.build_command(ours, folder, f"{repository}:driver-0.37.0-v11"), acceptance.build_command(ours, folder),
               ["image", "ls", "--filter", f"label={vm.LABEL}=1", "--filter", f"reference={repository}", "--format", "{{.Repository}}:{{.Tag}}"],
               ["image", "inspect", ours, f"{repository}:unlabelled"], ["image", "rm", ours], ["ps", "-a", "-q", "--no-trunc"],
               ["container", "inspect", "--format", "{{.Image}}", "a" * 64], ["save", "-o", str(folder / "x.tar"), ours],
               ["create", "--name", guard.prefix + "image-update-0a", "--label", guard.label, ours, "/unchanged.txt"]]
    refused = [acceptance.build_command(theirs, folder), acceptance.build_command(ours, tmp_path),
               acceptance.build_command(ours, folder, theirs), ["image", "rm", theirs], ["image", "rm", ours, theirs],
               ["image", "inspect", ours, theirs], ["image", "rm", "--force", ours],
               ["image", "ls", "--filter", f"label={vm.LABEL}=1", "--format", "{{.Repository}}:{{.Tag}}"],
               ["container", "inspect", "--format", "{{.Config}}", "a" * 64], ["save", "-o", str(tmp_path / "x.tar"), ours],
               ["create", "--name", "someone-else", "--label", guard.label, ours, "/unchanged.txt"], ["image", "prune", "-f"]]
    for args in allowed + refused:
        assert guard.image_update_command(args) is False, args  # nothing passes before the check begins
    guard.update_repository, guard.update_folder = repository, folder
    for args in allowed:
        assert guard.image_update_command(args) is True, args
    for args in refused:
        assert guard.image_update_command(args) is False, args
        with pytest.raises(AssertionError):
            await guard.authorize(args)


async def test_the_image_update_check_never_touches_an_image_outside_its_own_repository(tmp_path, monkeypatch):
    runner = FakeDocker()
    # The owner's own computer images, of the very repository and label the product cleans, and someone else's.
    owners = {f"raphael/cua-local-vm:driver-0.37.0-v{layer}": {"Id": "sha256:" + str(layer % 10) * 64,
              "Config": {"Labels": {**vm.IMAGE_LABELS, f"{vm.LABEL}.layer": str(layer)}}} for layer in (9, 11, 12)}
    runner.images.update({**owners, "someone/else:latest": {"Id": "sha256:" + "f" * 64, "Config": {"Labels": {}}}})
    before = {tag: dict(image) for tag, image in runner.images.items()}
    run = acceptance.Acceptance(runner)
    async def computer(count, largest):
        run.record(f"{count} screens fake", "ok", "fake computer only")
    async def no_previous():
        pass  # the owner's layer images here are for this check alone: no previous-layer computer is made from them
    async def relocation():
        return "fake move only"
    monkeypatch.setattr(run, "computer", computer)
    monkeypatch.setattr(run, "previous", no_previous)
    monkeypatch.setattr(run, "relocation", relocation)
    original = vm.IMAGE, vm.REPOSITORY
    assert await run.run([1], shared=False) == 0
    rows = {row["name"]: row for row in run.results if row["name"].startswith("image update")}
    assert list(rows) == ["image update fixtures", "image update record", "image update cache source",
                          "image update press during the build", "image update cached steps", "image update old tags",
                          "image update cleanup"]
    assert all(row["result"] == "ok" for row in rows.values()), rows
    assert "answered building with update" in rows["image update press during the build"]["detail"]
    assert "names the import" in rows["image update cached steps"]["detail"]
    removed = [args[2] for args in runner.calls if args[:2] == ["image", "rm"]]
    previous = f"-v{int(vm.IMAGE_LABELS[vm.LABEL + '.layer']) - 1}"
    assert [tag for tag in removed if tag.endswith(previous)] == [next(tag for tag in removed if tag.startswith("raphael-acceptance-"))]
    assert all(tag == run.tag or tag.startswith("raphael-acceptance-") for tag in removed) and not set(removed) & set(owners)
    assert {tag: image for tag, image in runner.images.items()} == before
    assert (vm.IMAGE, vm.REPOSITORY) == original
    assert not run.root.exists()


async def test_a_failed_image_update_check_skips_the_rest_and_still_tidies_and_restores(tmp_path, monkeypatch):
    runner = FakeDocker()

    async def no_record(args, **kwargs):
        if args[:2] == ["save", "-o"]:
            runner.images[args[3]]["inline"] = False  # an engine whose build wrote no cache record
        return await runner(args, **kwargs)

    run = acceptance.Acceptance(no_record)
    async def computer(count, largest):
        run.record(f"{count} screens fake", "ok", "fake computer only")
    monkeypatch.setattr(run, "computer", computer)
    original = vm.IMAGE, vm.REPOSITORY
    assert await run.run([1], shared=False) == 1
    results = {row["name"]: row["result"] for row in run.results if row["name"].startswith("image update")}
    assert results == {"image update fixtures": "ok", "image update record": "failed", "image update cache source": "skipped",
                       "image update press during the build": "skipped", "image update cached steps": "skipped",
                       "image update old tags": "skipped", "image update cleanup": "ok"}
    assert not any(tag.startswith("raphael-acceptance-") for tag in runner.images) and not runner.containers
    assert (vm.IMAGE, vm.REPOSITORY) == original

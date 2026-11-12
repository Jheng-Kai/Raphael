"""Computer acceptance contracts: in-memory protocols and injected Docker only."""

import asyncio
import base64
from dataclasses import replace
import hashlib
import json
from pathlib import PureWindowsPath
import struct

import pytest

from raphael_core.computer import vm
from raphael_core.evaluate import computer_acceptance as acceptance


@pytest.fixture(autouse=True)
def no_network_or_docker(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("Offline acceptance tests must not create network sockets or Docker processes")
    monkeypatch.setattr(acceptance.socket, "create_connection", forbidden)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", forbidden)
    monkeypatch.setattr(asyncio, "open_connection", forbidden)
    monkeypatch.setattr(asyncio, "start_server", forbidden)


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
                "list_windows": {"session", "pid", "on_screen_only"}}
    calls = []

    def __init__(self, machine, target):
        self.target, self.alive = target, False

    async def __aenter__(self):
        self.alive = True
        return self

    async def __aexit__(self, *exc):
        self.alive = False

    async def request(self, method, params=None, **kwargs):
        name, arguments = params["name"], params["arguments"]
        type(self).calls.append((name, dict(arguments)))
        unknown = set(arguments) - self.accepted[name]
        if unknown:
            return {"isError": True, "content": [{"type": "text", "text": f"{name}: unknown argument {sorted(unknown)[0]}"}]}
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
    # What the product sent until 2026-11-12: the real driver answered "unknown argument cursor_id".
    monkeypatch.setitem(MemoryDriver.accepted, "set_agent_cursor_enabled", {"session"})
    with pytest.raises(vm.VmError, match="^driver_configuration_failed$"):
        await run.driver(target)
    assert not MemoryDriver.calls or MemoryDriver.calls[-1][0] == "set_agent_cursor_enabled"


async def test_driver_check_starts_no_driver_process_in_another_owners_container(tmp_path, monkeypatch):
    run, target = driver_run(tmp_path, monkeypatch, owner="someone-else")
    with pytest.raises(AssertionError, match="Refused container"):
        await run.driver(target)
    assert MemoryDriver.calls == []


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


def test_previous_fixture_matches_release_shape_without_changing_vm(tmp_path, monkeypatch):
    machine = vm.LocalVm(tmp_path, runner=object())
    target = machine.target(1)
    monkeypatch.setattr(vm, "IMAGE", "raphael-acceptance/cua-local-vm:test")
    args = acceptance.previous_args(target, machine.owner, "private")
    current = vm.run_args(target, machine.owner, "private")
    assert args[-1] == acceptance.OLD_IMAGE
    assert f"{vm.LABEL}.layer=4" in args
    assert f"{vm.LABEL}.owner={machine.owner}" in args
    assert not any(value.startswith(("RAPHAEL_SCREENS=", "VNC_RESOLUTION=")) for value in args)
    for flag in ("--memory", "--memory-swap", "--cpus", "--pids-limit", "--ipc", "--cgroupns", "--cap-drop", "--cap-add", "--shm-size", "--mount", "-p"):
        assert args[args.index(flag) + 1] == current[current.index(flag) + 1]
    assert "RAPHAEL_SCREENS=1" in current and current[-1] == vm.IMAGE


class FakeDocker:
    def __init__(self, *, engine="linux", build_failure=False):
        self.engine, self.build_failure = engine, build_failure
        self.calls, self.containers, self.images = [], {}, {}

    async def __call__(self, args, **kwargs):
        self.calls.append(list(args))
        if args[0] == "info":
            return vm.Result(0, self.engine)
        if args[0] == "build":
            if self.build_failure:
                return vm.Result(1, stderr="synthetic build failure")
            tag = args[args.index("--tag") + 1]
            self.images[tag] = {"Id": "new-image", "Config": {"Labels": vm.IMAGE_LABELS}}
            return vm.Result(0)
        if args[:2] == ["image", "inspect"]:
            return vm.Result(0, json.dumps([self.images[args[2]]])) if args[2] in self.images else vm.Result(1)
        if args[:2] == ["image", "rm"]:
            self.images.pop(args[2])
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
    await guard(["cp", str(acceptance.IMAGE_FOLDER / "desktop/wallpaper.py"), target.name + ":/opt/raphael-desktop/wallpaper.py"])
    await guard(["ps", "-a", "--filter", f"label={guard.label}", "--format", "{{.Names}}"])
    for command in ("stop", "start", "restart", "rm"):
        await guard([command, *( ["--time", "10"] if command == "restart" else []), target.name])
        runner.containers[target.name] = raw_container(target.name, machine.owner)
    assert all(args[args.index("-u") + 1] == "cua" for args in runner.calls if args[0] == "exec")


async def test_guard_drives_real_local_vm_start_status_viewer_and_stop(tmp_path, monkeypatch):
    from computer.test_vm import Runtime, container
    runner = Runtime()
    machine = vm.LocalVm(tmp_path, runner=runner)
    monkeypatch.setattr(vm, "IMAGE", "raphael-acceptance/cua-local-vm:test")
    target = replace(machine.target(17), screens=3)
    runner.raw = container(machine, target, runner)
    machine.run = acceptance.IsolatedDocker(runner, machine.owner, "raphael-acceptance/cua-local-vm:test")
    try:
        assert (await machine.start(target))["ready"]
        assert (await machine.status(target))["ready"]
        assert await machine.viewer_connection(target) == (6080, "private")
        assert not machine.repair_revisions
        assert len([args for args, _ in runner.calls if args[0] == "cp"]) == 2
        assert any(args[:2] == ["exec", "-d"] for args, _ in runner.calls)
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
    ["image", "rm", "raphael/cua-local-vm:driver-0.37.0-v5"],
    ["image", "inspect", "raphael/cua-local-vm:driver-0.37.0-v5"],
    ["ps", "-a", "--filter", "label=org.raphael.computer", "--format", "{{.ID}}"],
    ["container", "inspect", "someone-elses-container"],
    ["exec", "-u", "root", "ours", "true"],
    ["stop", "foreign", "ours"], ["rm", "foreign", "ours"], ["start", "foreign", "ours"],
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
    monkeypatch.setattr(run, "computer", computer)
    code = await run.run([1, 3])
    assert code == (1 if crash else 0)
    assert len(observed) == 2  # Failure on one computer does not suppress the next.
    assert vm.IMAGE == original_image
    assert foreign in runner.containers
    assert len({item[2] for item in observed}) == 1
    assert all(name.startswith(f"raphael-computer-{owner}-") for _, name, owner in observed)
    assert [args for args in runner.calls if args[0] == "build"] == [["build", "--tag", run.tag, str(acceptance.IMAGE_FOLDER)]]
    assert all(args[-1] == run.tag for args in runner.calls if args[0] == "run")
    assert not any("prune" in args or args[0] == "pull" for args in runner.calls)
    report = json.loads((tmp_path / "report/computer-acceptance.json").read_text(encoding="utf-8"))
    assert all(set(row) == {"name", "result", "detail", "seconds"} for row in report["checks"])
    assert any(row["result"] == "skipped" and row["name"] == "previous layer" for row in report["checks"])
    assert " ok, " in capsys.readouterr().out
    if keep:
        assert run.root.exists() and run.tag in runner.images
        assert len(runner.containers) == 3
        assert not any(args[0] in ("rm", "stop") or args[:2] == ["image", "rm"] for args in runner.calls)
        # Test-owned temporary resources are removed without invoking acceptance cleanup.
        acceptance.shutil.rmtree(run.root)
    else:
        assert not run.root.exists() and run.tag not in runner.images
        assert set(runner.containers) == {foreign}
        assert [args for args in runner.calls if args[:2] == ["image", "rm"]] == [["image", "rm", run.tag]]


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

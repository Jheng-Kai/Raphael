"""Opt-in real-container acceptance. Never starts Docker or uses a member's data."""

import argparse
import asyncio
import base64
from collections import Counter
from dataclasses import dataclass, replace
from datetime import datetime
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import struct
import tempfile
import time
from types import ModuleType
from urllib.parse import urlsplit

from ..computer import lifecycle, vm
from ..computer.viewer import DesktopViewer

OLD_IMAGE = "raphael/cua-local-vm:driver-0.37.0-v4"
IMAGE_FOLDER = Path(vm.__file__).parent / "image"


def image_helper():
    # Import by source, so the Docker context never acquires __pycache__.
    path = IMAGE_FOLDER / "desktop/screens.py"
    module = ModuleType("acceptance_image_screens")
    exec(compile(path.read_text(encoding="utf-8"), str(path), "exec"), module.__dict__)
    return module


def require(condition, detail):
    if not condition:
        raise AssertionError(detail)


def exact(sock, size):
    result = bytearray()
    while len(result) < size:
        chunk = sock.recv(size - len(result))
        if not chunk:
            raise EOFError(f"Expected {size} bytes, received {len(result)} before disconnect")
        result.extend(chunk)
    return bytes(result)


class UpgradeRefused(AssertionError):
    pass


class WebSocket:
    """A bounded binary WebSocket stream, including fragmented messages and ping."""

    def __init__(self, sock, host, path, *, origin=None):
        self.sock, self.pending = sock, bytearray()
        self.fragment = False
        key = base64.b64encode(secrets.token_bytes(16)).decode()
        request = (f"GET {path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\n"
                   f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
                   "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: binary\r\n")
        if origin:
            request += f"Origin: {origin}\r\n"
        sock.sendall((request + "\r\n").encode("ascii"))
        header = bytearray()
        while not header.endswith(b"\r\n\r\n"):
            require(len(header) < 16384, "Expected bounded WebSocket upgrade headers")
            header.extend(exact(sock, 1))
        lines = header.decode("latin1").split("\r\n")
        if lines[0].split()[1] != "101":
            raise UpgradeRefused(f"Expected WebSocket 101, observed {lines[0]}")
        fields = {key.lower(): value for line in lines[1:] if ":" in line for key, value in [line.split(":", 1)]}
        accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        require(fields.get("sec-websocket-accept", "").strip() == accept,
                "Expected matching Sec-WebSocket-Accept")
        require(fields.get("sec-websocket-protocol", "").strip() == "binary",
                "Expected WebSocket binary subprotocol")

    def send_frame(self, payload, opcode=2):
        length = len(payload)
        header = bytes([128 | opcode, 128 | min(length, 126)]) if length < 65536 else bytes([128 | opcode, 255])
        if length >= 65536:
            header += struct.pack(">Q", length)
        elif length >= 126:
            header += struct.pack(">H", length)
        mask = secrets.token_bytes(4)
        self.sock.sendall(header + mask + bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload)))

    def sendall(self, payload):
        self.send_frame(payload)

    def recv(self, size):
        while not self.pending:
            first, second = exact(self.sock, 2)
            opcode, final = first & 15, bool(first & 128)
            require(not first & 112 and not second & 128, "Expected unmasked server frame without extensions")
            length = second & 127
            if length in (126, 127):
                length = struct.unpack(">H" if length == 126 else ">Q", exact(self.sock, 2 if length == 126 else 8))[0]
            require(length <= 8 * 1024 * 1024, f"Expected frame <= 8 MiB, observed {length}")
            if opcode >= 8:
                require(final and length <= 125, "Expected bounded final control frame")
            payload = exact(self.sock, length)
            if opcode == 8:
                raise EOFError("WebSocket closed before expected RFB data")
            if opcode == 9:
                self.send_frame(payload, 10)
                continue
            if opcode == 10:
                continue
            require(opcode == (0 if self.fragment else 2), f"Expected binary/continuation frame, observed opcode {opcode}")
            self.fragment = not final
            self.pending.extend(payload)
        result = bytes(self.pending[:size])
        del self.pending[:size]
        return result


class Rfb:
    def __init__(self, stream, helper):
        self.stream, self.helper = stream, helper

    def banner(self):
        banner = exact(self.stream, 12)
        require(banner == b"RFB 003.008\n", f"Expected RFB 3.8 banner, observed {banner!r}")

    def authenticate(self, password):
        self.banner()
        self.stream.sendall(b"RFB 003.008\n")
        count = exact(self.stream, 1)[0]
        require(count and 2 in exact(self.stream, count), "Expected VNC authentication security type 2")
        self.stream.sendall(b"\x02")
        challenge = exact(self.stream, 16)
        key = self.helper.vnc_key(password)
        self.stream.sendall(self.helper.des_encrypt(key, challenge[:8]) + self.helper.des_encrypt(key, challenge[8:]))
        status = struct.unpack(">I", exact(self.stream, 4))[0]
        require(status == 0, f"Expected VNC authentication success, observed status {status}")
        self.stream.sendall(b"\x01")
        initial = exact(self.stream, 24)
        width, height = struct.unpack(">HH", initial[:4])
        length = struct.unpack(">I", initial[20:])[0]
        require(length <= 65536, f"Expected bounded ServerInit name, observed {length}")
        exact(self.stream, length)
        require((width, height) == (1280, 900), f"Expected ServerInit 1280x900, observed {width}x{height}")
        return width, height

    def pointer(self, x, y, buttons=0):
        self.stream.sendall(struct.pack(">BBHH", 5, buttons, x, y))

    def close_window(self):
        for key, down in ((0xffe9, 1), (0xffc1, 1), (0xffc1, 0), (0xffe9, 0)):
            self.stream.sendall(struct.pack(">BBxxI", 4, down, key))  # Alt+F4

    def pixels(self, rectangle):
        x, y, width, height = rectangle
        require(0 <= x < x + width <= 1280 and 0 <= y < y + height <= 900,
                f"Expected pixel request inside one screen, observed {rectangle}")
        pixel_format = struct.pack(">BBBBHHHBBBxxx", 32, 24, 0, 1, 255, 255, 255, 16, 8, 0)
        self.stream.sendall(b"\x00\0\0\0" + pixel_format)
        self.stream.sendall(struct.pack(">BxHi", 2, 1, 0))
        self.stream.sendall(struct.pack(">BBHHHH", 3, 0, *rectangle))
        pixels, covered = [None] * (width * height), 0
        for _ in range(64):
            kind = exact(self.stream, 1)[0]
            if kind == 2:
                continue
            if kind == 3:
                length = struct.unpack(">xxxI", exact(self.stream, 7))[0]
                require(length <= 65536, f"Expected bounded clipboard, observed {length}")
                exact(self.stream, length)
                continue
            require(kind == 0, f"Expected framebuffer update, observed RFB message {kind}")
            count = struct.unpack(">xH", exact(self.stream, 3))[0]
            require(count <= 4096, f"Expected bounded rectangles, observed {count}")
            for _ in range(count):
                rx, ry, rw, rh, encoding = struct.unpack(">HHHHi", exact(self.stream, 12))
                require(encoding == 0 and rw * rh <= 1280 * 900,
                        f"Expected bounded raw rectangle, observed {(rx, ry, rw, rh, encoding)}")
                data = exact(self.stream, rw * rh * 4)
                for yy in range(max(y, ry), min(y + height, ry + rh)):
                    for xx in range(max(x, rx), min(x + width, rx + rw)):
                        offset = ((yy - ry) * rw + xx - rx) * 4
                        index = (yy - y) * width + xx - x
                        if pixels[index] is None:
                            covered += 1
                        pixels[index] = data[offset:offset + 3]
            if covered == width * height:
                return pixels
        raise AssertionError(f"Expected {width * height} raw pixels, observed {covered}")


@dataclass(frozen=True)
class Window:
    identifier: str
    title: str
    rectangle: tuple
    terminal: bool
    frame_offset: tuple = (0, 0)


def monitors(text):
    result = {}
    for line in text.splitlines():
        match = re.search(r"(\d+)/\d+x(\d+)/\d+([+-]\d+)([+-]\d+)\s+(VNC-\d+)\s*$", line)
        if match:
            width, height, x, y = map(int, match.groups()[:4])
            result[match[5]] = (x, y, width, height)
    require(text.splitlines() and text.splitlines()[0].strip() == f"Monitors: {len(result)}",
            f"Expected monitor header matching parsed outputs, observed {text!r}")
    return result


def windows(text):
    result = []
    for line in text.splitlines():
        match = re.match(r'\s*(0x[0-9a-fA-F]+)\s+"([^"]*)".*?\s(\d+)x(\d+)([+-]\d+)([+-]\d+)\s+([+-]\d+)([+-]\d+)\s*$', line)
        if match:
            identifier, title, width, height, relative_x, relative_y, x, y = match.groups()
            terminal = '"Xfce4-terminal"' in line or '"xfce4-terminal"' in line
            if terminal and (int(width), int(height)) == (10, 10):
                continue  # Application leader, like the panel's helper, is not a screen window.
            # The trailing pair is absolute; the first pair is inside the window's frame.
            result.append(Window(identifier, title, tuple(map(int, (x, y, width, height))),
                                 terminal, (int(relative_x), int(relative_y))))
    return result


def listeners(text):
    result = {}
    for line in text.splitlines():
        fields = line.split()
        if len(fields) >= 4 and fields[3] == "0A":
            address, port = fields[1].split(":")
            result.setdefault(int(port, 16), set()).add(socket.inet_ntoa(bytes.fromhex(address)[::-1]))
    return result


def inside(rectangle, point):
    x, y, width, height = rectangle
    return x <= point[0] < x + width and y <= point[1] < y + height


def centre(rectangle):
    x, y, width, height = rectangle
    return x + width // 2, y + height // 2


def previous_args(target, owner, password):
    # This fixture mirrors release 1.2.0's run_args (layer 4, before screen variables).
    args = vm.run_args(target, owner, password)
    result, index = [], 0
    while index < len(args):
        value = args[index]
        if value == "-e" and args[index + 1].startswith(("RAPHAEL_SCREENS=", "VNC_RESOLUTION=")):
            index += 2
            continue
        if value == f"{vm.LABEL}.layer=5":
            value = f"{vm.LABEL}.layer=4"
        result.append(OLD_IMAGE if value == vm.IMAGE else value)
        index += 1
    return result


class IsolatedDocker:
    """All product and acceptance Docker commands pass through this owner guard."""

    def __init__(self, runner, owner, tag):
        self.runner, self.owner, self.tag = runner, owner, tag
        self.label = f"{vm.LABEL}.owner={owner}"
        self.prefix = f"raphael-computer-{owner}-"
        self.after_start = None

    async def owned(self, name):
        raw = await self.runner(["container", "inspect", name], timeout=60, limit=200000)
        if raw.code:
            raise AssertionError(f"Cannot verify owner of container {name}: inspect exit {raw.code}")
        data = json.loads(raw.stdout)[0]
        require(data.get("Config", {}).get("Labels", {}).get(f"{vm.LABEL}.owner") == self.owner,
                f"Refused container {name}: expected owner {self.owner}")
        return data

    async def __call__(self, args, **kwargs):
        require(bool(args), "Expected a Docker command")
        command = args[0]
        if command == "run":
            labels = [args[i + 1] for i, value in enumerate(args[:-1]) if value == "--label"]
            require([label for label in labels if label.startswith(f"{vm.LABEL}.owner=")] == [self.label]
                    and args.count("--name") == 1 and args[args.index("--name") + 1].startswith(self.prefix)
                    and args[-1] in (self.tag, OLD_IMAGE), f"Refused unowned container creation: {args[:6]}")
        elif command in ("exec", "start", "stop", "restart", "rm"):
            if command == "exec":
                index = 1
                while args[index] in ("-i", "-d"):
                    index += 1
                require(args[index:index + 2] == ["-u", "cua"], "Expected docker exec -u cua")
                index += 2
                while args[index] == "-e":
                    index += 2
                name = args[index]
            else:
                name = args[-1]
                forms = {"start": [["start", name]],
                         "stop": [["stop", name], ["stop", "--time", "10", name]],
                         "restart": [["restart", "--time", "10", name]],
                         "rm": [["rm", name], ["rm", "-f", name], ["rm", "--force", name]]}
                require(args in forms[command], f"Expected one exact owned container for {command}")
            await self.owned(name)
        elif command == "cp":
            source, destination = args[1:]
            name, guest_path = destination.split(":", 1)
            desktop = IMAGE_FOLDER / "desktop"
            require((Path(source), guest_path) in (
                (desktop / "wallpaper.py", "/opt/raphael-desktop/wallpaper.py"),
                (desktop / "wallpapers", "/opt/raphael-desktop/")), "Expected product wallpaper copy only")
            await self.owned(name)
        elif command == "ps":
            require(args[:-1] == ["ps", "-a", "--filter", f"label={self.label}", "--format"]
                    and args[-1] in ("{{.ID}}", "{{.Names}}"),
                    "Expected exact owner-only container listing")
        elif args[:2] == ["container", "inspect"]:
            require(len(args) == 3 and args[2].startswith(self.prefix), "Expected this run's container name")
        elif args[:2] == ["image", "inspect"]:
            require(len(args) == 3 and args[2] in (self.tag, OLD_IMAGE), "Expected isolated/previous image inspect")
        elif args[:2] == ["image", "rm"]:
            require(args == ["image", "rm", self.tag], "Expected removal of this run's image tag only")
        elif command == "build":
            require(args == ["build", "--tag", self.tag, str(IMAGE_FOLDER)], "Expected isolated plain Docker build")
        elif command == "info":
            require(args == ["info", "--format", "{{.OSType}}"], "Expected Linux engine probe")
        else:
            raise AssertionError(f"Refused Docker command outside acceptance scope: {command}")
        result = await self.runner(args, **kwargs)
        if command == "start" and not result.code and self.after_start:
            await self.after_start(args[-1])
        return result


PROCESS_SNAPSHOT = '''import json,pathlib
out=[]
for p in pathlib.Path('/proc').iterdir():
 if not p.name.isdigit(): continue
 try:
  cmd=(p/'cmdline').read_bytes().replace(b'\\0',b' ').decode(errors='replace')
  stat=(p/'stat').read_text(); tail=stat[stat.rfind(')')+2:].split()
  if 'X0tigervnc' in cmd or '/screens.py' in cmd:
   out.append({'pid':int(p.name),'ppid':int(tail[1]),'start':tail[19],'cmd':cmd})
 except (FileNotFoundError,ProcessLookupError,PermissionError): pass
print(json.dumps(out))'''


class Acceptance:
    def __init__(self, runner=None, *, keep=False, out=None):
        self.runner = runner or vm.Docker()
        self.keep, self.out = keep, Path(out) if out else None
        self.results, self.started = [], time.monotonic()
        self.helper = image_helper()
        self.machine = self.docker = self.root = None
        self.tag = "raphael-acceptance/cua-local-vm:" + secrets.token_hex(8)
        self.build_attempted = False

    def record(self, name, result, detail, seconds=0):
        self.results.append(dict(name=name, result=result, detail=detail, seconds=round(seconds, 3)))
        print(f"{'ok' if result == 'ok' else 'FAIL' if result == 'failed' else 'skip'} {name}: {detail}", flush=True)

    async def check(self, name, action):
        began = time.monotonic()
        try:
            detail = await action()
        except Exception as error:
            self.record(name, "failed", f"{type(error).__name__}: {error}", time.monotonic() - began)
            return False
        self.record(name, "ok", detail or "Matched expected behavior", time.monotonic() - began)
        return True

    async def command(self, args, **kwargs):
        result = await self.docker(args, **kwargs)
        require(result.code == 0, f"Expected {args[0]} exit 0, observed {result.code}: {result.stderr.strip()}")
        require(not result.truncated, f"Expected complete {args[0]} output; output was truncated")
        return result.stdout

    async def guest(self, target, args, *, allow_failure=False):
        result = await self.docker(["exec", "-u", "cua", "-e", "DISPLAY=:1", target.name, *args], timeout=60, limit=200000)
        if not allow_failure:
            require(result.code == 0 and not result.truncated,
                    f"Expected guest {args[0]} exit 0 and complete output, observed {result.code}: {result.stderr.strip()}")
        return result

    async def text(self, target, args):
        return (await self.guest(target, args)).stdout

    async def mark(self, target):
        result = await self.guest(target, ["cat", vm.SCREENS_READY], allow_failure=True)
        return result.stdout.strip() if not result.code else None

    async def processes(self, target):
        data = json.loads(await self.text(target, ["python3", "-c", PROCESS_SNAPSHOT]))
        # Ignore the snapshot interpreter, whose -c argument contains these strings.
        data = [p for p in data if "import json,pathlib" not in p["cmd"]]
        return ([p for p in data if "/screens.py" in p["cmd"]],
                [p for p in data if "X0tigervnc" in p["cmd"]])

    async def tree(self, target):
        return windows(await self.text(target, ["xwininfo", "-root", "-tree"]))

    async def viewable(self, target, window):
        result = await self.guest(target, ["xwininfo", "-id", window.identifier], allow_failure=True)
        return result.code == 0 and "Map State: IsViewable" in result.stdout

    async def start(self, target, *, operation=None):
        for attempt in range(2):
            try:
                state = await operation() if operation else await self.machine.start(target)
                require(state.get("ready"), f"Expected ready, observed {state}")
                return state
            except vm.VmError as error:
                if attempt or str(error) not in ("docker_stopped", "unavailable"):
                    raise
                print(f"retry {target.screens} screens: {error}; waiting 3 s before one retry", flush=True)
                await asyncio.sleep(3)

    async def boot_mark(self, target):
        require(not self.machine.repair_revisions,
                f"Expected no normal-boot repairs, observed {self.machine.repair_revisions}")
        raw = await self.machine.inspect(target)
        began = datetime.fromisoformat(raw["State"]["StartedAt"].replace("Z", "+00:00")).timestamp()
        written = float(await self.text(target, ["python3", "-c", f"import os; print(os.stat({vm.SCREENS_READY!r}).st_mtime)"]))
        require(written > began, f"Expected mark newer than StartedAt {began}, observed {written}")
        return f"ready mark written {written - began:.3f} s after State.StartedAt; no repair restart"

    async def layout(self, target):
        count = target.screens
        rectangles, canvas = vm.screen_grid(count)
        require((rectangles, canvas) == self.helper.grid(count), "Expected matching product/helper grids")
        observed = monitors(await self.text(target, ["xrandr", "--listmonitors"]))
        expected = {f"VNC-{i}": rect for i, rect in enumerate(rectangles)}
        require(observed == expected, f"Expected monitors {expected}, observed {observed}")
        tokens = await self.text(target, ["cat", self.helper.TOKENS.as_posix()])
        require(tokens == self.helper.token_text(count), f"Expected tokens {self.helper.token_text(count)!r}, observed {tokens!r}")
        mark = await self.mark(target)
        require(mark == str(count), f"Expected ready mark {count}, observed {mark!r}")
        helpers, servers = await self.processes(target)
        expected_count = count if count > 1 else 0
        require(len(helpers) == 1 and len(servers) == expected_count and all(p["ppid"] == helpers[0]["pid"] for p in servers),
                f"Expected one helper and {expected_count} direct clipped children, observed helpers={helpers}, servers={servers}")
        ports = listeners(await self.text(target, ["cat", "/proc/net/tcp"]))
        actual = {port: addresses for port, addresses in ports.items() if 5911 <= port <= 5916}
        expected_ports = {5911 + i: {"127.0.0.1"} for i in range(expected_count)}
        require(actual == expected_ports, f"Expected clipped listeners {expected_ports}, observed {actual}")
        panels = await self.text(target, ["xfconf-query", "-c", "xfce4-panel", "-p", "/panels"])
        ids = [int(line.strip()) for line in panels.splitlines() if line.strip().isdigit()]
        require(ids == list(range(1, count + 1)), f"Expected panel IDs 1..{count}, observed {panels!r}")
        # One screen keeps the image's own panel, which names no output (seen in a real container: the property does
        # not exist there). Only a computer of several screens binds each panel to its output.
        for i in ids if count > 1 else []:
            output = (await self.text(target, ["xfconf-query", "-c", "xfce4-panel", "-p", f"/panels/panel-{i}/output-name"])).strip()
            require(output == f"VNC-{i - 1}", f"Expected panel {i} output VNC-{i - 1}, observed {output!r}")
        return f"{count} monitors, tokens, panels and mark; {expected_count} helper-owned loopback views"

    def connect(self, port, path, password, *, origin=None):
        sock = socket.create_connection(("127.0.0.1", port), timeout=10)
        try:
            stream = WebSocket(sock, f"127.0.0.1:{port}", path, origin=origin)
            client = Rfb(stream, self.helper)
            client.authenticate(password)
            return sock, client
        except BaseException:
            sock.close()
            raise

    @staticmethod
    def http(port, path, *, origin=None):
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=15)
        try:
            connection.request("GET", path, headers={"Origin": origin} if origin else {})
            response = connection.getresponse()
            return response.status, response.read(1000000)
        finally:
            connection.close()

    async def views(self, target):
        port, password = await self.machine.viewer_connection(target)
        for i in range(1, target.screens + 1):
            sock, _ = await asyncio.to_thread(self.connect, port, f"/websockify?token=screen-{i}", password)
            sock.close()
        for token in (None, "screen-0", f"screen-{target.screens + 1}", "bogus"):
            path = "/websockify" + (f"?token={token}" if token else "")
            def refused():
                with socket.create_connection(("127.0.0.1", port), timeout=5) as sock:
                    try:
                        stream = WebSocket(sock, f"127.0.0.1:{port}", path)
                    except (UpgradeRefused, EOFError, ConnectionError):
                        return
                    try:
                        banner = exact(stream, 12)
                    except (EOFError, ConnectionError, TimeoutError):
                        return
                    require(not banner.startswith(b"RFB "), f"Expected token {token!r} refused before RFB, observed {banner!r}")
            await asyncio.to_thread(refused)
        status, _ = await asyncio.to_thread(self.http, port, "/vnc.html")
        require(status == 200, f"Expected GET /vnc.html 200, observed {status}")
        return f"{target.screens} authenticated 1280x900 views; four invalid tokens refused; /vnc.html 200"

    async def quiet(self, target):
        panels, bad = [], []
        for window in await self.tree(target):
            if window.title not in ("Displays", "xfce4-panel") or not await self.viewable(target, window):
                continue
            if window.title == "Displays":
                bad.append(window)
            elif window.rectangle[2:] == (10, 10):
                continue
            elif window.rectangle[2:] == (146, 49):
                panels.append(window)
            else:
                bad.append(window)
        rectangles, _ = vm.screen_grid(target.screens)
        require(not bad and len(panels) == target.screens and all(
            sum(inside(rect, centre(panel.rectangle)) for panel in panels) == 1 for rect in rectangles),
            f"Expected one 146x49 panel per output, only 10x10 helpers, no Displays/tooltip; observed panels={panels}, unexpected={bad}")
        return "No viewable Displays dialog or panel tooltip; one panel per screen"

    async def steer(self, target, seat):
        rectangles, _ = vm.screen_grid(target.screens)
        rect = rectangles[seat - 1]
        initial = await self.tree(target)
        before = {w.identifier for w in initial if w.terminal}
        require(not before, f"Expected no terminal before steering screen {seat}, observed {[w for w in initial if w.terminal]}")
        panels = [w for w in initial if w.title == "xfce4-panel"
                  and w.rectangle[2:] == (146, 49) and inside(rect, centre(w.rectangle))]
        require(len(panels) == 1, f"Expected one panel on screen {seat}, observed {panels}")
        px, py, pw, ph = panels[0].rectangle
        # Three launchers occupy equal thirds of the measured panel, including its border.
        click = (px - rect[0] + pw * 5 // 6, py - rect[1] + ph // 2)
        port, password = await self.machine.viewer_connection(target)
        sock, client = await asyncio.to_thread(self.connect, port, f"/websockify?token=screen-{seat}", password)
        other = 1 if seat != 1 else target.screens
        other_sock = None
        try:
            other_sock, other_client = await asyncio.to_thread(self.connect, port, f"/websockify?token=screen-{other}", password)
            # The terminal's position is not known until it opens; retain both views before the click.
            own_before = await asyncio.to_thread(client.pixels, (0, 0, 1280, 900))
            neighbour_before = await asyncio.to_thread(other_client.pixels, (0, 0, 1280, 900))
            client.pointer(*click)
            client.pointer(*click, 1)
            client.pointer(*click)
            new = []
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                new = [w for w in await self.tree(target) if w.terminal and w.identifier not in before]
                if new:
                    break
                await asyncio.sleep(.2)
            require(new, f"Expected new terminal within 10 s on screen {seat}, observed {new}")
            await asyncio.sleep(.5)
            new = [w for w in await self.tree(target) if w.terminal and w.identifier not in before]
            require(new and all(inside(rect, centre(w.rectangle)) for w in new),
                    f"Expected new terminal only inside screen {seat} {rect}, observed {new}")
            require(len(new) == 1, f"Expected one new terminal, observed {new}")
            terminal = new[0]
            client.pointer(centre(terminal.rectangle)[0] - rect[0], centre(terminal.rectangle)[1] - rect[1])
            x, y, width, _ = terminal.rectangle
            top = y - terminal.frame_offset[1]
            # The title and menu bars are the light parts of the window, even over night wallpaper.
            left, right = max(x, rect[0]), min(x + width, rect[0] + rect[2])
            bottom = min(top + 50, rect[1] + rect[3])
            top = max(top, rect[1])
            area = (left - rect[0], top - rect[1], right - left, bottom - top)
            require(area[2] > 0 and area[3] > 0, f"Expected visible title/menu strip on screen {seat}, observed {terminal}")
            own = await asyncio.to_thread(client.pixels, area)
            neighbour = await asyncio.to_thread(other_client.pixels, area)
            def changed(snapshot, after):
                ax, ay, aw, ah = area
                previous = [snapshot[yy * 1280 + xx] for yy in range(ay, ay + ah) for xx in range(ax, ax + aw)]
                require(len(after) == len(previous), f"Expected {len(previous)} pixels in {area}, observed {len(after)}")
                return sum(max(abs(a - b) for a, b in zip(pixel, old)) > 40 for pixel, old in zip(after, previous)) / len(previous)
            own_changed = changed(own_before, own)
            neighbour_changed = changed(neighbour_before, neighbour)
            detail = (f"screen {seat}: launcher {click}, terminal {terminal.title!r} absolute rectangle {terminal.rectangle}, "
                      f"strip {area}, changed={own_changed:.3f}, neighbour_changed={neighbour_changed:.3f}")
            require(own_changed >= .2 and neighbour_changed <= .01,
                    f"Expected title/menu >=20% changed and neighbour <=1% changed against their own before captures; observed {detail}")
            return detail
        finally:
            try:
                # Re-read even after a failed assertion or click: detection itself may have failed.
                opened = [w for w in await self.tree(target) if w.terminal and w.identifier not in before]
                for window in opened:
                    screen = next((i for i, r in enumerate(rectangles, 1) if inside(r, centre(window.rectangle))), None)
                    require(screen is not None, f"Expected opened terminal on a screen for cleanup, observed {window}")
                    cleanup_sock, closer = (None, client) if screen == seat else await asyncio.to_thread(
                        self.connect, port, f"/websockify?token=screen-{screen}", password)
                    try:
                        screen_rect = rectangles[screen - 1]
                        focus = (centre(window.rectangle)[0] - screen_rect[0],
                                 max(0, window.rectangle[1] - window.frame_offset[1] - screen_rect[1] + 10))
                        closer.pointer(*focus)
                        closer.pointer(*focus, 1)
                        closer.pointer(*focus)
                        closer.close_window()
                    finally:
                        if cleanup_sock:
                            cleanup_sock.close()
                deadline = time.monotonic() + 5
                while True:
                    remaining = [w for w in await self.tree(target) if w.terminal]
                    if not remaining:
                        break
                    require(time.monotonic() < deadline,
                            f"Expected no terminal after steering screen {seat} cleanup (Alt+F4), observed {remaining}")
                    await asyncio.sleep(.2)
            finally:
                sock.close()
                if other_sock:
                    other_sock.close()

    async def restart(self, target):
        await self.command(["stop", target.name], timeout=90)
        self.machine.invalidate(target)
        observations = []
        async def observe(name):
            observations.append(await self.mark(target))
        self.docker.after_start = observe
        try:
            await self.start(target)
        finally:
            self.docker.after_start = None
        require(observations == [None], f"Expected no mark immediately after docker start, observed {observations}")
        return "Fresh boot: mark absent immediately after start; " + await self.boot_mark(target)

    async def recover(self, target, helper=False):
        old_helpers, old_servers = await self.processes(target)
        require(len(old_helpers) == 1 and len(old_servers) == target.screens,
                f"Expected healthy helper and {target.screens} views before kill, observed {old_helpers}, {old_servers}")
        old = {(p["pid"], p["start"]) for p in old_servers}
        if helper:
            await self.text(target, ["kill", "-9", str(old_helpers[0]["pid"])])
        else:
            await self.text(target, ["pkill", "-f", "rfbport 591[2]"])
        began, limit = time.monotonic(), 10 if helper else 5
        observed = None
        while time.monotonic() - began < limit:
            require(await self.mark(target) == str(target.screens), "Expected boot mark to stay during recovery; observed absent/wrong mark")
            helpers, servers = await self.processes(target)
            current = {(p["pid"], p["start"]) for p in servers}
            observed = (helpers, servers)
            if len(helpers) == 1 and len(servers) == target.screens and all(p["ppid"] == helpers[0]["pid"] for p in servers):
                changed = not current & old and helpers[0]["pid"] != old_helpers[0]["pid"] if helper else len(current - old) == 1
                if changed:
                    ports = listeners(await self.text(target, ["cat", "/proc/net/tcp"]))
                    if any(ports.get(port) != {"127.0.0.1"} for port in range(5911, 5911 + target.screens)):
                        await asyncio.sleep(.1)
                        continue
                    elapsed = time.monotonic() - began
                    require(elapsed <= limit, f"Expected recovery within {limit} s, observed {elapsed:.3f} s")
                    return f"{'helper and all views replaced' if helper else 'one view replaced'} in {elapsed:.3f} s; mark stayed"
            await asyncio.sleep(.1)
        raise AssertionError(f"Expected recovery in {limit} s with mark retained, observed {observed}")

    async def lose_x(self, target):
        began = time.monotonic()
        await self.text(target, ["pkill", "-x", "Xtigervnc"])
        while time.monotonic() - began < 5:
            if await self.mark(target) is None:
                elapsed = time.monotonic() - began
                require(elapsed <= 5, f"Expected mark removed within 5 s, observed {elapsed:.3f} s")
                state = await self.machine.status(target)
                require(not state["ready"], f"Expected status not ready after X loss, observed {state}")
                return f"mark removed in {elapsed:.3f} s; status not ready"
            await asyncio.sleep(.1)
        raise AssertionError("Expected mark removed within 5 s of X server loss; observed mark retained")

    async def app_path(self, target):
        original = self.machine.target
        # Stage A has no seats yet: capture a last-screen target through the real viewer path.
        self.machine.target = lambda member=0: replace(target, screen=target.screens)
        viewer = DesktopViewer(self.machine)
        try:
            opened = await viewer.open({"member_id": 9000})
            url = urlsplit(opened["url"])
            status, body = await asyncio.to_thread(self.http, url.port, f"/{opened['session']}/connection")
            require(status == 200, f"Expected session connection 200, observed {status}")
            config = json.loads(body)
            require(isinstance(config.get("password"), str) and config.get("path", "").startswith(f"/{opened['session']}/websockify/"),
                    "Expected session-scoped connection password/path")
            sock, _ = await asyncio.to_thread(self.connect, url.port, config["path"], config["password"], origin=viewer.origin)
            sock.close()
            status, _ = await asyncio.to_thread(self.http, url.port, "/another-session/connection", origin=viewer.origin)
            require(status == 403, f"Expected another session's path 403, observed {status}")
            return f"DesktopViewer.open and relay authenticate screen {target.screens} at 1280x900; another session path 403"
        finally:
            await viewer.aclose()
            self.machine.target = original

    async def previous(self):
        result = await self.docker(["image", "inspect", OLD_IMAGE], timeout=60, limit=100000)
        if result.code:
            self.record("previous layer", "skipped", "no layer 4 image here")
            return
        image = json.loads(result.stdout)[0]
        if image.get("Config", {}).get("Labels", {}).get(f"{vm.LABEL}.layer") != "4":
            self.record("previous layer", "skipped", "no layer 4 image here")
            return
        fixtures = []
        for member, operation in ((9101, "start"), (9102, "update"), (9103, "erase")):
            target = self.machine.target(member)
            async def fixture(target=target):
                target.workspace.mkdir(parents=True, exist_ok=True)
                target.shared.mkdir(parents=True, exist_ok=True)
                await self.command(previous_args(target, self.machine.owner, secrets.token_urlsafe(24)), timeout=90)
                await self.text(target, ["sh", "-c", "printf acceptance > /home/cua/workspace/acceptance.txt"])
                await self.command(["stop", target.name], timeout=90)
                return "Created release 1.2.0 container with workspace file, then stopped it"
            if await self.check(f"previous layer fixture {operation}", fixture):
                fixtures.append((target, operation))
            else:
                self.record(f"previous layer {operation}", "skipped", "fixture creation failed")
        # All three old computers are stopped before any new-code lifecycle operation runs.
        for target, operation in fixtures:
            async def exercise(target=target, operation=operation):
                state = await self.machine.status(target)
                require(state["state"] == "incompatible", f"Expected layer 4 incompatible, observed {state}")
                if operation == "erase":
                    await self.machine.erase(target)
                    require(await self.machine.inspect(target) is None and not target.workspace.exists(),
                            "Expected erased previous container and workspace absent")
                else:
                    if operation == "start":
                        await self.start(target)
                    else:
                        await self.start(target, operation=lambda: lifecycle.maintain(self.machine, target, "update"))
                    raw = await self.machine.inspect(target)
                    require(raw["Image"] == await self.machine.image(target), "Expected rebuilt computer on isolated new image")
                    content = await self.text(target, ["cat", vm.GUEST + "/acceptance.txt"])
                    require(content == "acceptance", f"Expected preserved workspace file, observed {content!r}")
                    await self.machine.stop(target)
                return f"layer 4 {operation}: incompatible -> {'absent with workspace removed' if operation == 'erase' else 'ready on new image, workspace file preserved'}"
            await self.check(f"previous layer {operation}", exercise)

    async def computer(self, count, largest):
        began = time.monotonic()
        target = replace(self.machine.target(count), screens=count)
        self.machine.targets[target.key] = target
        prefix = f"{count} screens"
        try:
            async def starts():
                began = time.monotonic()
                await self.start(target)
                return f"LocalVm.start ready in {time.monotonic() - began:.3f} s"
            if not await self.check(prefix + " starts", starts):
                self.record(prefix + " dependent checks", "skipped", "start did not become ready; continuing other computers")
                return
            await self.check(prefix + " boot mark", lambda: self.boot_mark(target))
            await self.check(prefix + " layout", lambda: self.layout(target))
            await self.check(prefix + " views", lambda: self.views(target))
            if count > 1:
                for seat in (1, count):
                    await self.check(prefix + f" steering screen {seat}", lambda seat=seat: self.steer(target, seat))
            await self.check(prefix + " no tooltip or dialog", lambda: self.quiet(target))
            await self.check(prefix + " restart", lambda: self.restart(target))
            if count == largest:
                if count > 1:
                    await self.check(prefix + " app path", lambda: self.app_path(target))
                    await self.check(prefix + " recovers view", lambda: self.recover(target))
                    await self.check(prefix + " recovers helper", lambda: self.recover(target, helper=True))
                else:
                    self.record(prefix + " multi-screen recovery/app seat", "skipped", "requires N > 1")
                await self.check(prefix + " loses X", lambda: self.lose_x(target))
        finally:
            try:
                if not self.keep:
                    await self.check(prefix + " stop", lambda: self.stop(target))
            finally:
                print(f"summary {prefix}: {time.monotonic() - began:.3f} s", flush=True)

    async def stop(self, target):
        await self.machine.stop(target)
        return "LocalVm.stop completed for this run's target"

    async def cleanup(self):
        if self.machine:
            try:
                await self.machine.aclose(stop=False)
            except Exception as error:
                self.record("cleanup lifecycle", "failed", str(error))
        if self.keep:
            names = await self.command(["ps", "-a", "--filter", f"label={self.docker.label}", "--format", "{{.Names}}"], timeout=60)
            print(f"Kept containers (owner {self.machine.owner}): {names.strip() or '(none)'}; image: {self.tag}; data: {self.root}", flush=True)
            return
        safe_to_remove_data = True
        if self.docker:
            try:
                names = await self.command(["ps", "-a", "--filter", f"label={self.docker.label}", "--format", "{{.ID}}"], timeout=60)
                for identifier in names.split():
                    try:
                        raw = await self.docker.owned(identifier)
                        await self.command(["rm", "-f", identifier], timeout=90)
                        print(f"Removed container {raw['Name'].lstrip('/')} ({identifier})", flush=True)
                    except Exception as error:
                        safe_to_remove_data = False
                        self.record("cleanup container", "failed", str(error))
            except Exception as error:
                safe_to_remove_data = False
                self.record("cleanup listing", "failed", str(error))
            if self.build_attempted:
                await self.check("cleanup image", self.remove_image)
        if self.root and safe_to_remove_data:
            # Resolve and verify the exact temporary root before recursive removal, including on Windows.
            require(self.root.resolve() == self.root and self.root.parent == Path(tempfile.gettempdir()).resolve()
                    and self.root.name.startswith("raphael-acceptance-"), f"Refused data removal outside run root: {self.root}")
            shutil.rmtree(self.root)
            print(f"Removed data {self.root}", flush=True)
        elif self.root:
            self.record("cleanup data", "failed", f"Retained {self.root}: container removal could not be verified")

    async def remove_image(self):
        result = await self.docker(["image", "inspect", self.tag], timeout=60)
        if result.code:
            return f"Isolated image tag {self.tag} absent"
        await self.command(["image", "rm", self.tag], timeout=90)
        return f"Removed image tag {self.tag}"

    def finish(self):
        totals = Counter(row["result"] for row in self.results)
        seconds = round(time.monotonic() - self.started, 3)
        print(f"{totals['ok']} ok, {totals['failed']} failed, {totals['skipped']} skipped in {seconds:.3f} s", flush=True)
        if self.out:
            self.out.mkdir(parents=True, exist_ok=True)
            (self.out / "computer-acceptance.json").write_text(json.dumps(dict(
                checks=self.results, seconds=seconds, totals=dict(totals), image=self.tag,
                owner=self.machine.owner if self.machine else None, kept=self.keep), indent=2) + "\n", encoding="utf-8")

    async def run(self, counts):
        original_image = vm.IMAGE
        parent = asyncio.current_task()
        cancel_path = os.environ.get("RAPHAEL_COMPUTER_CANCEL_FILE")
        async def watch_cancel():
            while True:
                if Path(cancel_path).exists():
                    parent.cancel()
                    return
                await asyncio.sleep(.2)
        watcher = asyncio.create_task(watch_cancel()) if cancel_path else None
        try:
            try:
                result = await self.runner(["info", "--format", "{{.OSType}}"], timeout=60)
                running = result.code == 0 and result.stdout.strip() == "linux"
                engine_detail = f"exit {result.code}, OSType={result.stdout.strip()!r}, {result.stderr.strip()}"
            except (OSError, TimeoutError) as error:
                running = False
                engine_detail = type(error).__name__
            if not running:
                self.record("engine", "failed", f"Docker is not running; expected Linux engine, observed {engine_detail}")
                return 2
            self.record("engine", "ok", "Docker is running with a Linux engine")
            self.root = Path(tempfile.mkdtemp(prefix="raphael-acceptance-")).resolve()
            self.machine = vm.LocalVm(self.root, runner=self.runner)
            self.docker = IsolatedDocker(self.runner, self.machine.owner, self.tag)
            self.machine.run = self.docker
            vm.IMAGE = self.tag
            # Prevent product fallback from pulling or rebuilding the normal image if ours disappears.
            async def no_build(*args, **kwargs):
                raise AssertionError("Expected prebuilt isolated acceptance image; refusing product pull/build fallback")
            self.machine.build = no_build
            self.build_attempted = True
            async def build():
                await self.command(["build", "--tag", self.tag, str(IMAGE_FOLDER)], timeout=1800)
                require(await self.machine.image(), "Expected built image with production labels")
                return f"Built isolated image {self.tag}"
            if await self.check("build", build):
                for count in counts:
                    try:
                        await self.computer(count, max(counts))
                    except Exception as error:
                        self.record(f"{count} screens lifecycle", "failed", f"{type(error).__name__}: {error}")
                await self.previous()
        except (KeyboardInterrupt, asyncio.CancelledError):
            self.record("interrupted", "failed", "Interrupted; cleaning this run's resources")
        except Exception as error:
            self.record("run", "failed", f"{type(error).__name__}: {error}")
        finally:
            try:
                if watcher:
                    watcher.cancel()
                    await asyncio.gather(watcher, return_exceptions=True)
                if self.root:
                    await self.cleanup()
            except Exception as error:
                self.record("cleanup", "failed", f"{type(error).__name__}: {error}")
            finally:
                vm.IMAGE = original_image
                self.finish()
        return 1 if any(row["result"] == "failed" for row in self.results) else 0


def screen_counts(value):
    try:
        counts = [int(part) for part in value.split(",")]
        if not counts or any(not 1 <= count <= 6 for count in counts) or len(set(counts)) != len(counts):
            raise ValueError
        return counts
    except ValueError:
        raise argparse.ArgumentTypeError("Expected distinct screen counts from 1 to 6, for example 1,3,6") from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--screens", type=screen_counts, default="1,3,6")
    parser.add_argument("--keep", action="store_true", help="Leave this run's containers, image tag and data for inspection")
    parser.add_argument("--out", type=Path, help="Write computer-acceptance.json in this folder")
    options = parser.parse_args(argv)
    return asyncio.run(Acceptance(keep=options.keep, out=options.out).run(options.screens))


if __name__ == "__main__":
    raise SystemExit(main())

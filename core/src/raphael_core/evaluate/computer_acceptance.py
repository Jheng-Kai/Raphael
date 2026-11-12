"""Opt-in real-container acceptance. Never starts Docker or uses a member's data."""

import argparse
import asyncio
import base64
from collections import Counter
from dataclasses import dataclass, replace
from datetime import datetime
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
import zlib
from types import ModuleType
from urllib.parse import urlsplit

from ..computer import lifecycle, vm
from ..computer.viewer import DesktopViewer
from ..computer.rfb_view import Rfb, WebSocket, UpgradeRefused, exact
from ..computer.vm_bridge import CuaBridge
from ..computer.vm_tools import VmTools
from ..services.attachment_store import AttachmentStore

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


def png_pixels(data):
    """Decode the product's filter-zero RGB PNG for the same strip comparison as RFB."""
    require(data[:8] == b"\x89PNG\r\n\x1a\n", "Expected PNG signature")
    offset, compressed = 8, bytearray()
    while offset < len(data):
        length = int.from_bytes(data[offset:offset + 4], "big")
        kind, payload = data[offset + 4:offset + 8], data[offset + 8:offset + 8 + length]
        require(length <= 8_000_000 and len(payload) == length, "Expected bounded complete PNG chunk")
        require(zlib.crc32(kind + payload) == int.from_bytes(data[offset + 8 + length:offset + 12 + length], "big"),
                "Expected valid PNG chunk CRC")
        if kind == b"IHDR":
            require(payload == struct.pack(">IIBBBBB", 1280, 900, 8, 2, 0, 0, 0), "Expected product 1280x900 RGB PNG")
        if kind == b"IDAT":
            compressed.extend(payload)
        offset += length + 12
    raw = zlib.decompress(compressed)
    stride = 1280 * 3 + 1
    require(len(raw) == stride * 900 and all(raw[y * stride] == 0 for y in range(900)), "Expected filter-zero full PNG rows")
    return [raw[y * stride + 1 + x * 3:y * stride + 4 + x * 3] for y in range(900) for x in range(1280)]


def strip_change(before, after, area):
    x, y, width, height = area
    require(width > 0 and height > 0 and 0 <= x < x + width <= 1280 and 0 <= y < y + height <= 900,
            f"Expected a visible screen strip, observed {area}")
    indexes = [yy * 1280 + xx for yy in range(y, y + height) for xx in range(x, x + width)]
    previous = [before[index] for index in indexes]
    current = [after[index] for index in indexes] if len(after) == 1280 * 900 else after
    require(len(current) == len(previous), f"Expected {len(previous)} strip pixels, observed {len(current)}")
    return sum(max(abs(a - b) for a, b in zip(pixel, old)) > 40 for pixel, old in zip(current, previous)) / len(previous)


def previous_args(target, owner, password):
    # This fixture mirrors release 1.2.0's run_args (layer 4, before screen variables).
    args = vm.run_args(target, owner, password)
    result, index = [], 0
    while index < len(args):
        value = args[index]
        if value == "-e" and args[index + 1].startswith(("RAPHAEL_SCREENS=", "VNC_RESOLUTION=")):
            index += 2
            continue
        if value == f"{vm.LABEL}.layer={vm.IMAGE_LABELS[f'{vm.LABEL}.layer']}":
            value = f"{vm.LABEL}.layer=4"
        result.append(OLD_IMAGE if value == vm.IMAGE else value)
        index += 1
    return result


class NoHub:
    """What VmTools asks of the app's tool hub, for a check that offers no tool to a model."""

    def offered(self): return []
    def tier_of(self, key): return None
    def kind_of(self, server, name): return None
    def tier_for_call(self, key, arguments): return None
    def kind_for_call(self, server, name, arguments): return None
    def record_unrun(self, *args, **kwargs): pass


class IsolatedDocker:
    """All product and acceptance Docker commands pass through this owner guard."""

    def __init__(self, runner, owner, tag):
        self.runner, self.owner, self.tag = runner, owner, tag
        self.label = f"{vm.LABEL}.owner={owner}"
        self.prefix = f"raphael-computer-{owner}-"
        self.after_start = None
        self.created = []

    async def owned(self, name):
        raw = await self.runner(["container", "inspect", name], timeout=60, limit=200000)
        if raw.code:
            raise AssertionError(f"Cannot verify owner of container {name}: inspect exit {raw.code}")
        data = json.loads(raw.stdout)[0]
        require(data.get("Config", {}).get("Labels", {}).get(f"{vm.LABEL}.owner") == self.owner,
                f"Refused container {name}: expected owner {self.owner}")
        return data

    async def authorize(self, args):
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

    async def __call__(self, args, **kwargs):
        await self.authorize(args)
        command = args[0]
        result = await self.runner(args, **kwargs)
        if command == "run" and not result.code:
            self.created.append(args[args.index("--name") + 1])
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
                return strip_change(snapshot, after, area)
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

    async def driver(self, target):
        """The connection the product makes before any screen tool. The driver refuses a set-up call whose arguments
        its schema does not name, and then every screen tool of the computer fails: fakes cannot show that."""
        guard = self.docker

        class Bridge(CuaBridge):
            async def __aenter__(self):
                await guard.owned(self.target.name)  # a driver process only inside this run's own container
                return await super().__aenter__()

        sessions = []
        # Twice, each with its own VmTools: the second is a core started again beside the computer that kept running,
        # whose driver refuses every session label the first one ended.
        for _ in range(2):
            tools = VmTools(NoHub(), self.machine, attachments=AttachmentStore(self.root / "driver-check"), bridge=Bridge)
            try:
                client, session = await tools._connection(target)
                reply = await client.request("tools/call", {"name": "list_windows", "arguments": {"session": session}})
                text = "".join(block.get("text", "") for block in reply.get("content", []) if block.get("type") == "text")
                require(not reply.get("isError") and text.startswith("Found "),
                        f"Expected the driver to list windows through the product's own connection, observed {text[:200]!r}")
                sessions.append(session)
            finally:
                await tools.aclose()
        require(sessions[0] != sessions[1], f"Expected a core started again to use a new session label, observed {sessions}")
        return f"VmTools set up driver sessions {sessions[0]} and, as a core started again, {sessions[1]}; {text.splitlines()[0]}"

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
            await self.check(prefix + " driver connection", lambda: self.driver(target))
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

    async def shared(self):
        """Exercise product tools and sessions on two seats of this run's owned computer."""
        from ..agent.plugins import tool_key
        from ..computer import seat_view
        from ..computer.seats import ComputerSeats
        from ..computer.vm_bridge import CuaBridge
        from ..computer.vm_tools import VmTools, vm_scope
        from ..services.attachment_store import AttachmentStore

        class Settings:
            def get(self, key):
                return {"computer_vm_mode": "shared", "computer_ssh_alias": "",
                        "computer_vm_idle_minutes": 0, "action_mode": "normal"}.get(key)

        class Hub:
            def offered(self):
                return []

        calls = []

        class RecordingBridge(CuaBridge):
            async def request(self, method, params=None, **kwargs):
                if method == "tools/call":
                    calls.append((self.target.key, params["name"], dict(params["arguments"])))
                return await super().request(method, params, **kwargs)

        machine = self.machine
        old_settings, old_command, old_seats = machine.settings, machine.bridge_command, machine.seats
        old_busy, old_native, old_input = machine.busy, machine.native_busy, machine.input_busy
        old_disconnect, old_close = machine.disconnect_driver, machine.close_seat_viewers
        machine.settings = Settings()

        async def guarded_bridge(target, args):
            await self.docker.authorize(args)
            return await old_command(target, args)

        machine.bridge_command = guarded_bridge
        hub = VmTools(Hub(), machine, attachments=AttachmentStore(self.root / "acceptance-attachments"), bridge=RecordingBridge)
        viewer = DesktopViewer(machine)
        members = (9201, 9202)
        targets, terminals, pages = {}, {}, {}

        async def tool(member, name, arguments, *, allow_refusal=False):
            with vm_scope(("turn", member, 1)):
                result = await hub.call(tool_key(f"computer-{machine.target(member).key}", name), arguments, approver="auto")
            if not allow_refusal:
                require(result.ok and result.kind not in ("computer_busy", "screen_changed"),
                        f"Expected member {member} {name} success, observed {result.kind}: {result.text}")
            return result

        async def rows(member):
            result = await tool(member, "list_windows", {})
            return seat_view.canvas_windows({"content": [{"type": "text", "text": result.text}]})["windows"]

        def page(result):
            return json.loads(result.text.splitlines()[-1])

        def active_tab(state):
            # A tab snapshot (what browser_open answers) names its tab at the top level; a window bind lists tabs.
            tabs = state.get("tabs", [])
            selected = next((tab for tab in tabs if tab.get("active")), tabs[0] if tabs else {})
            tab_id = state.get("tab_id") or selected.get("tab_id")
            require(tab_id and state.get("target_id"), f"Expected a bound tab, observed {state}")
            return dict(target_id=state["target_id"], tab_id=tab_id)

        def page_url(state):
            return ((state.get("page") or {}).get("url") or state.get("url")
                    or next((tab.get("url") for tab in state.get("tabs", []) if tab.get("active")), None))

        async def screenshot(member):
            result = await tool(member, "get_desktop_state", {})
            require(len(result.blocks) == 1, f"Expected one seat image, observed {len(result.blocks)}")
            data = base64.b64decode(result.blocks[0]["data"], validate=True)
            width, height, depth, color = struct.unpack(">IIBB", data[16:26])
            require((width, height, depth, color) == (1280, 900, 8, 2),
                    f"Expected 1280x900 8-bit RGB PNG, observed {(width, height, depth, color)}")
            return png_pixels(data)

        try:
            async def prepare():
                await asyncio.gather(*(hub.prepare(member) for member in members))
                targets.update((member, machine.target(member)) for member in members)
                first, second = (targets[member] for member in members)
                require((first.screen, second.screen) == (1, 2) and first.name == second.name,
                        f"Expected seats 1 and 2 of one container, observed {first}, {second}")
                before = self.docker.created.count(first.name)
                await asyncio.gather(*(self.start(target) for target in (first, second)))
                require(self.docker.created.count(first.name) - before == 1, "Expected one container creation for two concurrent starts")
                raw = await machine.inspect(first)
                host = raw["HostConfig"]
                require(host["Memory"] == host["MemorySwap"] == 6 * 1024**3 and host["NanoCpus"] == 4_000_000_000
                        and "RAPHAEL_SCREENS=6" in raw["Config"]["Env"], "Expected 6 GiB, 4 CPUs and six screens")
                for member in members:
                    await hub._discover(targets[member])
                return "Two product VmTools catalogs and sessions, seats 1/2, one six-screen 6 GiB/4 CPU container started once"

            if not await self.check("shared prepares", prepare):
                return "Shared dependent checks skipped after preparation failure (see failed shared prepares)"

            async def lists():
                for member in members:
                    own = await rows(member)
                    require(any(row["app_name"].lower() == "xfce4-panel" for row in own),
                            f"Expected own panel for {member}, observed {own}")
                    rect = seat_view.rectangle(targets[member].screen, 6)
                    for row in own:
                        bounds = row["bounds"]
                        require(0 <= bounds["x"] + bounds["width"] / 2 < rect[2]
                                and 0 <= bounds["y"] + bounds["height"] / 2 < rect[3],
                                f"Expected seat-local bounds, observed {row}")
                return "Each list has its own panel and seat-local window centres"
            await self.check("shared window lists", lists)

            async def launches():
                for member in members:
                    before = {row["window_id"] for row in await rows(member)}
                    await tool(member, "launch_app", {"name": "xfce4-terminal", "additional_arguments": ["--disable-server"]})
                    until = time.monotonic() + 10
                    while True:
                        new = [row for row in await rows(member) if row["window_id"] not in before
                               and "terminal" in row["app_name"].lower()]
                        if len(new) == 1:
                            terminals[member] = new[0]
                            break
                        require(time.monotonic() < until, f"Expected one terminal on member {member}'s screen, observed {new}")
                        await asyncio.sleep(.2)
                foreign = terminals[members[1]]
                for name in ("get_window_state", "click"):
                    before = len([call for call in calls if call[1] == name])
                    args = {key: foreign[key] for key in ("pid", "window_id")}
                    if name == "click":
                        args.update(x=20, y=60)
                    result = await tool(members[0], name, args, allow_refusal=True)
                    require(not result.ok and "not on this member's screen" in result.text,
                            f"Expected cross-seat {name} refusal, observed {result.kind}: {result.text}")
                    require(before == len([call for call in calls if call[1] == name]), f"Expected no {name} driver dispatch")
                return "Two seat-local terminals; foreign window read/click refused before driver dispatch"
            terminals_ok = await self.check("shared terminal wall", launches)

            async def typing():
                async def type_line(member, suffix):
                    window = terminals[member]
                    args = {key: window[key] for key in ("pid", "window_id")}
                    await tool(member, "get_window_state", args)
                    began = time.monotonic()
                    await tool(member, "type_text", {**args, "text": f"printf '%s\\n' seat-{member} > /home/cua/workspace/seat-{member}-{suffix}.txt"})
                    await tool(member, "press_key", {**args, "key": "Return"})
                    return time.monotonic() - began
                alone = [await type_line(member, "alone") for member in members]
                began = time.monotonic()
                parallel = await asyncio.gather(*(type_line(member, "together") for member in members))
                together = time.monotonic() - began
                for member in members:
                    for suffix in ("alone", "together"):
                        command = f"cat /home/cua/workspace/seat-{member}-{suffix}.txt"
                        until = time.monotonic() + 5
                        while True:
                            data = page(await tool(member, "vm_exec", {"command": command}))
                            if data["exit_code"] == 0:
                                break
                            require(time.monotonic() < until, f"Expected typed file, observed {data}")
                            await asyncio.sleep(.1)
                        require(data["output"] == f"seat-{member}\n", f"Expected own exact line, observed {data}")
                return f"Exact independent file lines; alone={alone}, together={together:.3f}s, individual concurrent calls={parallel}"
            if terminals_ok:
                await self.check("shared simultaneous native typing", typing)

            async def browsers():
                for member in members:
                    pages[member] = page(await tool(member, "browser_open", {"url": "about:blank"}))
                browser_windows = [[row for row in await rows(member) if row["app_name"].lower() == "chromium-browser"] for member in members]
                require(all(len(found) == 1 for found in browser_windows), f"Expected one browser window per seat, observed {browser_windows}")
                require(browser_windows[0][0]["window_id"] != browser_windows[1][0]["window_id"]
                        and browser_windows[0][0]["pid"] == browser_windows[1][0]["pid"],
                        f"Expected two windows of one browser pid, observed {browser_windows}")
                pids = (await self.text(targets[members[0]], ["pgrep", "-f", "^/usr/lib/chromium/chromium --remote-debugging-port=0 --user-data-dir=/home/cua/workspace/.browser-profiles/driver/main"])).split()
                require(pids == [str(browser_windows[0][0]["pid"])], f"Expected exactly one main browser process, observed {pids}")
                require(pages[members[0]]["target_id"] != pages[members[1]]["target_id"], "Expected two session-private bindings")
                url = "about:blank#member-one"
                await tool(members[0], "browser_navigate", {**active_tab(pages[members[0]]), "url": url})
                for member in members:
                    state = page(await tool(member, "get_browser_state", active_tab(pages[member])))
                    observed = page_url(state)
                    require(observed == (url if member == members[0] else "about:blank"), f"Expected independent URL, observed {state}")
                result = await tool(members[0], "browser_navigate", {**active_tab(pages[members[1]]), "url": "about:blank#foreign"}, allow_refusal=True)
                require(not result.ok, f"Expected foreign page binding refusal, observed {result.text}")
                return f"One browser pid {pids[0]}, two windows and private session bindings, independent navigation, foreign target refused"
            browsers_ok = await self.check("shared computer browser", browsers)

            async def pictures():
                first, second = members
                await tool(first, "bring_to_front", {key: terminals[first][key] for key in ("pid", "window_id")})
                await asyncio.sleep(.5)
                before = {member: await screenshot(member) for member in members}
                target, row = targets[first], terminals[first]
                tree = await self.tree(target)
                terminal = next(window for window in tree if int(window.identifier, 16) == row["window_id"])
                x, y, width, _ = terminal.rectangle
                top = max(0, y - terminal.frame_offset[1])
                area = (max(0, x), top, min(1280, x + width) - max(0, x), min(50, 900 - top))
                await machine.move_window(target, row["window_id"])
                # Move away from its old title strip so that only this screen changes there.
                await self.text(target, ["wmctrl", "-i", "-r", str(row["window_id"]), "-e", "0,80,300,-1,-1"])
                await asyncio.sleep(.5)
                after = {member: await screenshot(member) for member in members}
                changed = {member: strip_change(before[member], after[member], area) for member in members}
                require(changed[first] >= .2 and changed[second] <= .01,
                        f"Expected own title strip >=20% and neighbour <=1% changed, area={area}, observed {changed}")
                return f"Two product 1280x900 RGB PNGs; title strip {area}, own_changed={changed[first]:.3f}, neighbour_changed={changed[second]:.3f}"
            if terminals_ok:
                await self.check("shared clipped product pictures", pictures)

            async def control():
                first, second = members
                opened = await viewer.open({"member_id": first})
                command = asyncio.create_task(tool(second, "vm_exec", {"command": "sleep 3", "timeout_seconds": 10}))
                try:
                    until = time.monotonic() + 10
                    while not hub.commands.get(targets[second].key):
                        require(not command.done() and time.monotonic() < until, "Expected long vm_exec to be active before takeover")
                        await asyncio.sleep(.01)
                    await viewer.control({**opened, "held": True})
                    refused = await tool(first, "list_windows", {}, allow_refusal=True)
                    require(refused.kind == "owner_holds_control", f"Expected own hold refusal, observed {refused.kind}")
                    old_wait = hub.busy_wait_s
                    hub.busy_wait_s = .2
                    try:
                        args = {key: terminals[second][key] for key in ("pid", "window_id")}
                        refused = await tool(second, "press_key", {**args, "key": "Return"}, allow_refusal=True)
                        require(refused.kind == "computer_busy", f"Expected peer native input busy, observed {refused.kind}")
                        await rows(second)
                        if browsers_ok:
                            await tool(second, "get_browser_state", active_tab(pages[second]))
                    finally:
                        hub.busy_wait_s = old_wait
                    await viewer.control({**opened, "held": False})
                    await tool(second, "press_key", {**args, "key": "Return"})
                    return "Takeover during another seat's vm_exec succeeds; own calls refused, peer native waits/busy, page/read continue, handback restores native"
                finally:
                    await command
                    await viewer.close(opened)
            if terminals_ok:
                await self.check("shared owner control", control)

            async def disconnect():
                pid = next(row["pid"] for row in await rows(members[1]) if row["app_name"].lower() == "chromium-browser")
                await hub._disconnect(targets[members[0]].key)
                await tool(members[1], "get_browser_state", active_tab(pages[members[1]]))
                current = next(row["pid"] for row in await rows(members[1]) if row["app_name"].lower() == "chromium-browser")
                require(current == pid, f"Expected browser pid {pid} to survive disconnect, observed {current}")
                return f"Seat 1 connection ended; browser pid {pid} and seat 2's bound tab survive"
            if browsers_ok:
                await self.check("shared session ends independently", disconnect)

            async def displacement():
                third = 9203
                await hub.prepare(third)
                require(machine.target(third).screen == 3 and all(machine.target(member) == targets[member] for member in members),
                        "Expected third member on free seat 3 without displacement")
                machine.seats = ComputerSeats(count=2)
                for member in members:
                    await machine.seat(member)
                # The second member was used more recently, so the first is the idle victim.
                hub.leases.clear()
                first_ids = {row["window_id"] for row in await rows(members[0]) if row["app_name"].lower() != "xfce4-panel"}
                require(first_ids, "Expected windows to close on displaced seat")
                machine.seats.touch("", members[1])
                await hub.prepare(third)
                require(machine.target(third).screen == 1 and machine.target(members[0]).screen == 0,
                        "Expected least recently used idle seat 1 displaced")
                until = time.monotonic() + 5
                while True:
                    remaining = {int(window.identifier, 16) for window in await self.tree(targets[members[1]])}
                    if not first_ids & remaining:
                        break
                    require(time.monotonic() < until, f"Expected displaced windows closed, observed {first_ids & remaining}")
                    await asyncio.sleep(.1)
                return "Free seat 3 preserves holders; with count=2 the idle LRU seat is replaced and all its non-panel windows close"
            await self.check("shared seat displacement", displacement)
            return "Shared product checks completed; see each named shared result"
        finally:
            await viewer.aclose()
            await hub.aclose()
            machine.settings, machine.bridge_command = old_settings, old_command
            machine.seats = old_seats
            machine.busy, machine.native_busy, machine.input_busy = old_busy, old_native, old_input
            machine.disconnect_driver, machine.close_seat_viewers = old_disconnect, old_close
            if targets and not self.keep:
                await self.check("shared stop", lambda: self.stop(next(iter(targets.values()))))

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

    async def run(self, counts, *, shared=True):
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
                if shared:
                    await self.check("shared computer", self.shared)
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
    parser.add_argument("--no-shared", action="store_true", help="Skip the two-member shared computer block")
    parser.add_argument("--keep", action="store_true", help="Leave this run's containers, image tag and data for inspection")
    parser.add_argument("--out", type=Path, help="Write computer-acceptance.json in this folder")
    options = parser.parse_args(argv)
    return asyncio.run(Acceptance(keep=options.keep, out=options.out).run(options.screens, shared=not options.no_shared))


if __name__ == "__main__":
    raise SystemExit(main())

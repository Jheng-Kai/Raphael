"""Opt-in real-container acceptance. Never starts Docker or uses a member's data."""

import argparse
import asyncio
import base64
import csv
from collections import Counter
from contextlib import contextmanager
from dataclasses import dataclass, replace
from datetime import datetime
import http.client
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import shutil
import socket
import struct
import tempfile
import time
import zlib
from types import ModuleType
from types import SimpleNamespace
from urllib.parse import urlsplit

from ..computer import lifecycle, vm
from ..computer.viewer import DesktopViewer
from ..computer.rfb_view import Rfb, WebSocket, UpgradeRefused, exact
from ..computer.vm_bridge import CuaBridge
from ..computer.vm_catalog import BROWSER_APPS
from ..computer.vm_tools import VmTools
from ..services.attachment_store import AttachmentStore

# Released layers a computer may still be on. A fixture of each is made from the image itself, which is only read.
# The system's browser entries a user has an entry over: what each starts, and whether it is out of the menu.
MENU_BROWSERS = ('for entry in google-chrome chromium; do [ -e "/usr/share/applications/$entry.desktop" ] || continue; '
                 'own="/home/cua/.local/share/applications/$entry.desktop"; '
                 'echo "$entry|$(grep -m1 "^Exec=" "$own")|$(grep -c "^NoDisplay=true$" "$own")"; done')
# Everything of Firefox ESR a computer could still have (removed from layer 10 on): the package, its programs, its
# menu entry (the system's and a user's), its configuration, and a mention in the menu's registrations or XFCE's choices
# (its own helper entry among them).
NO_FIREFOX = ('for found in /usr/bin/firefox /usr/bin/firefox.real /usr/bin/firefox-esr /usr/lib/firefox-esr /etc/firefox-esr /usr/lib/mozilla '
              '/usr/share/applications/firefox-esr.desktop /home/cua/.local/share/applications/firefox-esr.desktop '
              '/usr/share/xfce4/helpers/firefox.desktop /home/cua/.mozilla; do [ -e "$found" ] || [ -L "$found" ] && echo "$found"; done; '
              'dpkg -s firefox-esr >/dev/null 2>&1 && echo "package firefox-esr"; command -v firefox; command -v firefox-esr; '
              'grep -ril firefox /usr/share/applications/mimeinfo.cache /usr/share/xfce4/helpers /home/cua/.config/xfce4/helpers.rc '
              '/usr/local/bin/raphael-browser /usr/local/bin/prepare-raphael-workspace.sh 2>/dev/null; '
              'grep -il -e mozilla -e parentlock /usr/local/bin/raphael-browser /usr/local/bin/prepare-raphael-workspace.sh 2>/dev/null; true')
OLD_IMAGES = {"4": "raphael/cua-local-vm:driver-0.37.0-v4", "5": "raphael/cua-local-vm:driver-0.37.0-v5",
              "6": "raphael/cua-local-vm:driver-0.37.0-v6", "7": "raphael/cua-local-vm:driver-0.37.0-v7",
              "8": "raphael/cua-local-vm:driver-0.37.0-v8", "9": "raphael/cua-local-vm:driver-0.37.0-v9",
              "10": "raphael/cua-local-vm:driver-0.37.0-v10"}
IMAGE_FOLDER = Path(vm.__file__).parent / "image"
# A 64x48 JPEG, teal on the left half and orange on the right: an owner's picture no desktop draws by itself.
OWN_PICTURE = base64.b64decode(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMU"
    "FRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU"
    "FBQUFBQUFBT/wAARCAAwAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUF"
    "BAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVW"
    "V1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi"
    "4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAEC"
    "AxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVm"
    "Z2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq"
    "8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDxqiiivuz+VAooooA+taKKK/zXP9YwooooA+SqKKK/0oP8nAooooA+taKKK/zXP9Ywoooo"
    "A+SqKKK/0oP8nAooooA+taKKK/zXP9YwooooA//Z"
)
# The picture's two colours as a view sends a pixel: blue, green, red.
TEAL, ORANGE = bytes((128, 128, 0)), bytes((0, 140, 255))


def image_helper():
    # Import by source, so the Docker context never acquires __pycache__.
    path = IMAGE_FOLDER / "layer11/screens.py"
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


def previous_args(target, owner, password, layer="4"):
    # The run arguments a release of that layer made. Layer 4 (release 1.2.0) had no screen variables yet;
    # layer 5 differs from today's only by its label and image.
    args = vm.run_args(target, owner, password)
    current = f"{vm.LABEL}.layer=" + vm.IMAGE_LABELS[f"{vm.LABEL}.layer"]
    result, index = [], 0
    while index < len(args):
        value = args[index]
        if layer == "4" and value == "-e" and args[index + 1].startswith(("RAPHAEL_SCREENS=", "VNC_RESOLUTION=")):
            index += 2
            continue
        if value == current:
            value = f"{vm.LABEL}.layer={layer}"
        result.append(OLD_IMAGES[layer] if value == vm.IMAGE else value)
        index += 1
    return result


def colour_share(pixels, colour):
    return sum(all(abs(a - b) <= 40 for a, b in zip(pixel, colour)) for pixel in pixels) / len(pixels)


def desktop_shows(top, lower, own):
    """Whether one screen shows the owner's picture (teal left, orange right), or else a drawn picture.

    `top` is one row of pixels high on the screen, `lower` two rows across its middle. The default pictures are soft
    gradients, yet many colours there (measured at 1280x900: 95 by day, 28 by night); a desktop that drew nothing is one."""
    left, right = colour_share(top[100:540], TEAL), colour_share(top[740:1180], ORANGE)
    seen = (round(left, 2), round(right, 2), len(set(lower)))
    return (left >= .9 and right >= .9 if own else left < .1 and right < .1 and len(set(lower)) >= 12), seen


class NoHub:
    """What VmTools asks of the app's tool hub, for a check that offers no tool to a model."""

    def offered(self): return []
    def tier_of(self, key): return None
    def kind_of(self, server, name): return None
    def tier_for_call(self, key, arguments): return None
    def kind_for_call(self, server, name, arguments): return None
    def record_unrun(self, *args, **kwargs): pass


# These exact guest programs create only this run's synthetic pages and two loopback servers.
FORM_START = """import http.client,json,pathlib,socket,subprocess,sys,time
root=pathlib.Path('/tmp/raphael-form-'+sys.argv[1]); root.mkdir(exist_ok=False)
(root/'index.html').write_text('<!doctype html><title>Acceptance form</title><label>Name<input aria-label="Name" value="existing"></label><label>Secret<input type="password" aria-label="Secret"></label><iframe src="/frame.html" title="Embedded form"></iframe>')
(root/'frame.html').write_text('<!doctype html><label>Name<input aria-label="Name"></label>')
(root/'other.html').write_text('<!doctype html><title>Acceptance other page</title><p>Done</p>')
servers=[]
for index in range(2):
 s=socket.socket(); s.bind(('127.0.0.1',0)); port=s.getsockname()[1]; s.close()
 with (root/('server-'+str(index)+'.log')).open('w') as log:
  p=subprocess.Popen(['python3','-m','http.server',str(port),'--bind','127.0.0.1','--directory',str(root)],stdout=log,stderr=log,start_new_session=True)
 stat=pathlib.Path('/proc')/str(p.pid)/'stat'
 servers.append({'pid':p.pid,'start':stat.read_text().rsplit(')',1)[1].split()[19],'port':port})
 (root/'server.json').write_text(json.dumps(servers))
 for attempt in range(100):
  if p.poll() is not None: raise RuntimeError('Acceptance form server exited')
  try:
   c=http.client.HTTPConnection('127.0.0.1',port,timeout=.2); c.request('GET','/'); r=c.getresponse(); ok=r.status==200; r.read(); c.close()
   if ok: break
  except OSError: pass
  time.sleep(.05)
 else: raise RuntimeError('Acceptance form server did not become ready')
print(json.dumps({'port':servers[0]['port'],'other_port':servers[1]['port']}))
"""
FORM_STOP = """import json,os,pathlib,signal,sys
root=pathlib.Path('/tmp/raphael-form-'+sys.argv[1]); record=root/'server.json'
for data in json.loads(record.read_text()) if record.exists() else []:
 proc=pathlib.Path('/proc')/str(data['pid'])
 try:
  start=(proc/'stat').read_text().rsplit(')',1)[1].split()[19]
  cmd=(proc/'cmdline').read_bytes().split(bytes([0]))
 except FileNotFoundError: pass
 else:
  expected=[b'python3',b'-m',b'http.server',str(data['port']).encode(),b'--bind',b'127.0.0.1',b'--directory',str(root).encode(),b'']
  if start!=data['start'] or cmd!=expected: raise RuntimeError('Refused to stop an unrelated process')
  os.kill(data['pid'],signal.SIGTERM)
"""

# Only the explicitly opted-in acceptance executes this loopback server inside its own guest.
CARRY_SERVER = '''import http.server,json,pathlib,sys
owner,port=sys.argv[1],int(sys.argv[2])
class Handler(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  self.send_response(200)
  if self.path=='/set': self.send_header('Set-Cookie','stage_d='+owner+'; Max-Age=3600; Path=/')
  self.end_headers()
  self.wfile.write(('<title>Carry cookie</title><p>'+self.headers.get('Cookie','no cookie')+'</p>').encode())
 def log_message(self,*args): pass
server=http.server.HTTPServer(('127.0.0.1',port),Handler)
pathlib.Path('/tmp/raphael-carry-'+owner+'.json').write_text(json.dumps({'port':server.server_port}))
server.serve_forever()
'''
CARRY_START = '''import json,pathlib,subprocess,sys,time
owner,port=sys.argv[1],sys.argv[2]
record=pathlib.Path('/tmp/raphael-carry-'+owner+'.json')
record.unlink(missing_ok=True)
program=PROGRAM
process=subprocess.Popen(['python3','-c',program,owner,port],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
for attempt in range(100):
 if process.poll() is not None: raise RuntimeError('Carry cookie server exited')
 if record.exists():
  print(record.read_text()); break
 time.sleep(.05)
else: raise RuntimeError('Carry cookie server did not start')
'''.replace('PROGRAM', repr(CARRY_SERVER))


@contextmanager
def canvas_observations():
    # Acceptance is its own process. Count recorder-created bridges as well as the product tool connection.
    original = CuaBridge.request
    calls = []
    async def counted(bridge, method, params=None, **kwargs):
        if method == 'tools/call' and (params or {}).get('name') in ('get_accessibility_tree', 'get_desktop_state'):
            calls.append(params['name'])
        return await original(bridge, method, params, **kwargs)
    CuaBridge.request = counted
    try:
        yield calls
    finally:
        CuaBridge.request = original


class IsolatedDocker:
    """All product and acceptance Docker commands pass through this owner guard."""

    def __init__(self, runner, owner, tag, picture=None):
        # The one host file besides the image folder that may be copied into a computer: this run's own picture.
        self.picture = Path(picture) if picture else None
        self.runner, self.owner, self.tag = runner, owner, tag
        self.label = f"{vm.LABEL}.owner={owner}"
        self.prefix = f"raphael-computer-{owner}-"
        self.after_start = None
        self.created = []
        self.carry_homes = {}
        self.carry_calls = 0

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
            if args[1:6] == ['--rm', '--network', 'none', '--user', '0']:
                from ..computer.carry import helper_args, EXCLUDE, folder_name
                require(len(args) == 17 and args[6] == '--name' and args[8] == args[10] == '-v',
                        'Expected exact carry run shape')
                source = self.carry_homes.get(args[9].removesuffix(':/from:ro'))
                target = self.carry_homes.get(args[11].removesuffix(':/to'))
                require(source is not None and target is not None and not source.container and target.container == 'shared',
                        'Expected this run\'s registered per-bot and shared homes')
                program = shlex.split(args[-1])
                require(len(program) == 4 and program[:2] == ['python3', '-c'], 'Expected exact carry program')
                data = json.loads(program[-1])
                require(data.get('excluded') == EXCLUDE and data.get('operation') in ('scan', 'copy'), 'Expected carry operation')
                if data['operation'] == 'copy':
                    folder = data.get('folder', '')
                    require(isinstance(folder, str), 'Expected member folder')
                    base = re.sub('-' + re.escape(source.key) + r'(?:-[0-9]+)?$', '', folder)
                    safe_folder = 0 < len(folder.encode('utf-8')) < 255 and (folder_name(folder, source.key, set()) == folder
                        or base != folder and folder_name(base, source.key, set()) == base)
                    require(set(data) == {'operation', 'excluded', 'key', 'folder', 'profile'}
                            and data['key'] == source.key and type(data['profile']) is bool
                            and safe_folder, 'Expected own member destination')
                else:
                    require(set(data) == {'operation', 'excluded'}, 'Expected exact scan arguments')
                require(args == helper_args(source, target, data) and args[14] == self.tag
                        and args[7] == f'raphael-carry-{self.owner}-{source.key}',
                        'Expected exact isolated image, helper name and Linux carry program')
                return
            labels = [args[i + 1] for i, value in enumerate(args[:-1]) if value == "--label"]
            require([label for label in labels if label.startswith(f"{vm.LABEL}.owner=")] == [self.label]
                    and args.count("--name") == 1 and args[args.index("--name") + 1].startswith(self.prefix)
                    and args[-1] in (self.tag, *OLD_IMAGES.values()), f"Refused unowned container creation: {args[:6]}")
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
                guest = args[index + 1:]
                if len(guest) >= 3 and guest[:2] == ["python3", "-c"] and guest[2] in (FORM_START, FORM_STOP):
                    require(guest == ["python3", "-c", guest[2], self.owner], "Expected this run's exact form program")
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
            require((Path(source), guest_path) in (
                (vm.WALLPAPER_FOLDER / "wallpaper.py", "/opt/raphael-desktop/wallpaper.py"),
                (vm.WALLPAPER_FOLDER / "wallpapers", "/opt/raphael-desktop/"),
                *([(self.picture, vm.GUEST_OWN_WALLPAPER)] if self.picture else [])), "Expected product wallpaper copy only")
            await self.owned(name)
        elif command == "ps":
            require(args[:-1] == ["ps", "-a", "--filter", f"label={self.label}", "--format"]
                    and args[-1] in ("{{.ID}}", "{{.Names}}"),
                    "Expected exact owner-only container listing")
        elif args[:2] == ["container", "inspect"]:
            require(len(args) == 3 and (args[2].startswith(self.prefix)
                                       or re.fullmatch(re.escape(f'raphael-carry-{self.owner}-') + '[0-9a-f]{16}', args[2])),
                    "Expected this run's container name")
        elif args[:2] == ["image", "inspect"]:
            require(len(args) == 3 and args[2] in (self.tag, *OLD_IMAGES.values()), "Expected isolated/previous image inspect")
        elif args[:2] == ["image", "rm"]:
            require(args == ["image", "rm", self.tag], "Expected removal of this run's image tag only")
        elif command in ('kill', 'wait'):
            # Only a carry helper of this run, by its exact name: never a computer.
            require(len(args) == 2 and re.fullmatch(re.escape(f'raphael-carry-{self.owner}-') + '[0-9a-f]{16}', args[1]),
                    'Expected this run\'s carry helper')
        elif args[:2] == ['volume', 'inspect']:
            require(len(args) == 3 and args[2] in self.carry_homes, 'Expected this run\'s registered workspace volume')
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
            if args[1:6] != ['--rm', '--network', 'none', '--user', '0']:
                name = args[args.index("--name") + 1]
                self.created.append(name)
                key = name.removeprefix(self.prefix)
                workspace = next(args[i + 1] for i, value in enumerate(args[:-1])
                                 if value == '--mount' and 'target=' + vm.GUEST in args[i + 1])
                fields = dict(part.split('=', 1) for part in next(csv.reader([workspace])))
                source = fields['source']
                if fields['type'] == 'bind':
                    home = Path(source)
                    root = home.parent.parent.resolve()
                    import hashlib
                    expected_owner = hashlib.sha256(os.path.normcase(str(root)).encode()).hexdigest()[:16]
                    require(home.resolve() == root / 'vm-homes' / key and expected_owner == self.owner,
                            'Expected workspace in this run\'s data root')
                    target = vm.Target(key, name, home)
                else:
                    require(source == name + '-workspace', 'Expected exact owned workspace volume')
                    from pathlib import PurePosixPath
                    target = vm.Target(key, name, PurePosixPath(source), remote='acceptance-test-host')
                if key == 'shared':
                    target = replace(target, container='shared', screens=6)
                self.carry_homes[source] = target
            else:
                self.carry_calls += 1
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
        # This computer's own: an earlier one that was restarted after losing its X server has a repair on record.
        repairs = self.machine.repair_revisions.get(getattr(target, "state_key", target.key), 0)
        require(not repairs, f"Expected no normal-boot repairs of this computer, observed {repairs} in {self.machine.repair_revisions}")
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
        rectangles, _ = vm.screen_grid(target.screens)
        # A panel is 12 px wide until its launchers are loaded, and was once seen so for twenty seconds and more (seat 2 of
        # six, 2026-11-13): give a booting computer a minute, say how long, and name what each panel holds when it fails.
        began = time.monotonic()
        while True:
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
            whole = not bad and len(panels) == target.screens and all(
                sum(inside(rect, centre(panel.rectangle)) for panel in panels) == 1 for rect in rectangles)
            if whole or time.monotonic() > began + 60:
                break
            await asyncio.sleep(1)
        waited = time.monotonic() - began
        require(whole, f"Expected one 146x49 panel per output within 60 s, only 10x10 helpers, no Displays/tooltip; observed panels={panels}, "
                       f"unexpected={bad}" + ("" if whole else f", plugin ids {await self.panel_plugins(target)}"))
        # What makes a panel whole is its launchers: every screen's three, by their own ids.
        plugins = await self.panel_plugins(target)
        expected = {i: [str(n) for n in range(i * 3 - 2, i * 3 + 1)] for i in range(1, target.screens + 1)}
        require(plugins == expected, f"Expected each screen's panel to hold its own three launchers {expected}, observed {plugins}")
        return ("No viewable Displays dialog or panel tooltip; one panel per screen with its three launchers"
                + (f", whole after {waited:.1f} s" if waited > 3 else ""))

    async def panel_plugins(self, target):
        """The plugin ids each screen's panel holds, as the panel's own configuration says."""
        found = {}
        for i in range(1, target.screens + 1):
            result = await self.guest(target, ["xfconf-query", "-c", "xfce4-panel", "-p", f"/panels/panel-{i}/plugin-ids"], allow_failure=True)
            found[i] = [line.strip() for line in result.stdout.splitlines() if line.strip().isdigit()]
        return found

    async def browser_named(self, target):
        """Which browser this computer has, and that every screen's launcher wears its name and its mark."""
        chrome = not (await self.guest(target, ["test", "-x", "/opt/google/chrome/chrome"], allow_failure=True)).code
        name, icon = ("Google Chrome", "google-chrome") if chrome else ("Chromium", "chromium")
        for screen in range(1, target.screens + 1):
            entry = (await self.text(target, ["cat", f"/home/cua/.config/xfce4/panel/launcher-{screen * 3 - 2}/browser.desktop"])).splitlines()
            require({f"Name={name}", f"Icon={icon}", "Exec=raphael-browser %U"} <= set(entry),
                    f"Expected screen {screen}'s launcher to be {name} under its own mark, observed {entry}")
        require(not (await self.guest(target, ["test", "-e", f"/usr/share/icons/hicolor/48x48/apps/{icon}.png"], allow_failure=True)).code,
                f"Expected the {icon} mark among the computer's icons")
        return name, icon

    async def browser_mark(self, target):
        """The desktop says which browser it opens, and each of its own ways to a browser opens that one.

        An owner, of the panel of his members' computer (2026-11-13): 「但看起來底下不是顯示 Chrome ㄟ?」. Measured then: the
        launcher wore a globe named "Browser" over Google Chrome; XFCE's "Web Browser" named a helper that does not
        exist and asked which application to prefer; the menu's own Chrome entry and x-www-browser could not start
        (they make a sandbox, and nothing in a computer can); the menu's Chromium and Firefox were second browsers."""
        name, icon = await self.browser_named(target)
        helper = (await self.text(target, ["cat", "/home/cua/.config/xfce4/helpers.rc"])).splitlines()
        require("WebBrowser=raphael-browser" in helper, f"Expected XFCE's Web Browser to be the computer's browser, observed {helper}")
        link = (await self.text(target, ["readlink", "-f", "/usr/bin/x-www-browser"])).strip()
        require(link == "/usr/local/bin/raphael-browser", f"Expected x-www-browser to be the computer's browser, observed {link}")
        # The menu's other browser entries: one a user has over the system's, started as the computer's browser.
        listed = await self.text(target, ["sh", "-c", MENU_BROWSERS])
        menu = {parts[0]: parts[1:] for line in listed.splitlines() if len(parts := line.split("|")) == 3}
        require(menu and all(hidden == "1" and started == "Exec=raphael-browser %U" for started, hidden in menu.values()),
                f"Expected the menu's other browser entries hidden and started as the computer's browser, observed {listed!r}")
        # Firefox ESR is not in the computer at all: the owner's own browser is the only one a person signs in with.
        left = (await self.text(target, ["sh", "-c", NO_FIREFOX])).strip()
        require(not left, f"Expected no Firefox ESR in the computer, observed {left!r}")

        def classes(text):
            return {parts[0]: parts[2] for line in text.splitlines() if len(parts := line.split(None, 3)) >= 3}
        before = classes(await self.text(target, ["wmctrl", "-lx"]))
        await self.guest(target, ["sh", "-c", "setsid exo-open --launch WebBrowser about:blank >/dev/null 2>&1 &"])
        began, new = time.monotonic(), {}
        try:
            while not new:
                require(time.monotonic() < began + 60, "Expected XFCE's Web Browser to open a window within 60 s")
                await asyncio.sleep(.5)
                new = {key: value for key, value in classes(await self.text(target, ["wmctrl", "-lx"])).items() if key not in before}
            took = time.monotonic() - began
            require(all(value.startswith(icon) for value in new.values()),
                    f"Expected XFCE's Web Browser to open {name}, observed {sorted(new.values())}")
        finally:
            for identifier in new:
                await self.guest(target, ["wmctrl", "-i", "-c", identifier], allow_failure=True)
            until = time.monotonic() + 15
            while new and time.monotonic() < until:
                if not set(new) & set(classes((await self.guest(target, ["wmctrl", "-lx"], allow_failure=True)).stdout)):
                    break
                await asyncio.sleep(.3)
        return (f"every launcher is {name} under the {icon} mark; XFCE's Web Browser opened {name} in {took:.1f} s; "
                f"x-www-browser is the computer's browser; the menu's {', '.join(sorted(menu))} entries are out of the menu; "
                "no Firefox ESR is left")

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

    async def row(self, target, screen, y):
        port, password = await self.machine.viewer_connection(target)
        sock, client = await asyncio.to_thread(self.connect, port, f"/websockify?token=screen-{screen}", password)
        try:
            return await asyncio.to_thread(client.pixels, (0, y, 1280, 1))
        finally:
            sock.close()

    async def wallpaper(self, target):
        """What the desktop shows: the owner's picture while there is one, and the default picture once there is none.
        Neither was true of layer 5: a watcher that was merely left running kept the default (then a drawn town) over the
        picture, and the town (SVG) was never drawn, so the desktop was one flat colour."""
        picture = self.root / vm.OWN_WALLPAPER
        aside = picture.with_suffix(".aside")

        async def shown(own):
            deadline = time.monotonic() + 40
            while True:
                observed, matched = {}, True
                for screen in sorted({1, target.screens}):
                    top = await self.row(target, screen, 300)
                    lower = await self.row(target, screen, 600) + await self.row(target, screen, 760)
                    right, observed[screen] = desktop_shows(top, lower, own)
                    matched = matched and right
                if matched and not own:
                    # Many colours are not yet ours: the desktop's own default picture is a drawing too.
                    files = {(await self.text(target, ["xfconf-query", "-c", "xfce4-desktop", "-p",
                                                       f"/backdrop/screen0/monitorVNC-{screen - 1}/workspace0/last-image"])).strip()
                             for screen in observed}
                    names = {f"/opt/raphael-desktop/wallpapers/{name}" for name in ("day.jpg", "night.jpg")}
                    matched = len(files) == 1 and files <= names
                    observed = {**observed, "file": sorted(files)}
                if matched:
                    return observed
                require(time.monotonic() < deadline,
                        f"Expected {'the owner picture' if own else 'the default picture, not one flat colour'} within 40 s; "
                        f"observed per screen (teal share left, orange share right, colours in two lower rows) {observed}")
                await asyncio.sleep(1)

        async def again():
            # A start confirmed moments ago is answered from memory and looks at nothing.
            self.machine.invalidate(target)
            await self.start(target)

        first = await shown(True)
        picture.rename(aside)
        try:
            await again()
            default = await shown(False)
        finally:
            aside.rename(picture)
        await again()
        await shown(True)
        watchers = [line for line in (await self.text(target, ["ps", "-eo", "args"])).splitlines()
                    if line.startswith("/opt/venv/bin/python /opt/raphael-desktop/wallpaper.py")]
        require(len(watchers) == 1 and "--image" in watchers[0], f"Expected one watcher holding the picture, observed {watchers}")
        return f"owner picture shown {first}; without it the default picture is shown {default}; picture put back and shown; one watcher"

    async def keys(self, target):
        """One workspace and no key that acts on the whole desktop. Layer 5 had four workspaces and every default
        key: ctrl+F2 took every window off every screen, and ctrl+F4 (close this tab) did the same."""
        listing = await self.text(target, ["xfconf-query", "-c", "xfce4-keyboard-shortcuts", "-l", "-v"])
        bound = [line.split()[-1] for line in listing.splitlines() if line.startswith("/xfwm4/custom/")]
        whole = [name for name in bound if "workspace" in name or name == "show_desktop_key"]
        whole += self.helper.shortcut_removals(listing, target.screens)
        desktops = (await self.text(target, ["wmctrl", "-d"])).splitlines()
        require(len(desktops) == 1 and not whole and "close_window_key" in bound,
                f"Expected one workspace, no whole-desktop key and a window's own keys kept; observed "
                f"{len(desktops)} workspaces, still bound {whole}, kept {bound}")
        before = {line.split()[0] for line in (await self.text(target, ["wmctrl", "-l"])).splitlines()}
        await self.guest(target, ["sh", "-c", "xfce4-terminal --disable-server >/dev/null 2>&1 &"])
        opened, deadline = [], time.monotonic() + 15
        while not opened:
            opened = [line.split()[0] for line in (await self.text(target, ["wmctrl", "-l"])).splitlines() if line.split()[0] not in before]
            require(opened or time.monotonic() < deadline, "Expected a terminal window within 15 s")
            await asyncio.sleep(.3)
        try:
            port, password = await self.machine.viewer_connection(target)
            sock, client = await asyncio.to_thread(self.connect, port, "/websockify?token=screen-1", password)
            try:
                for chord in ((0xffe3, 0xffbf), (0xffe3, 0xffc1), (0xffe3, 0xffe9, 0x64)):  # ctrl+F2, ctrl+F4, ctrl+alt+d
                    client.keys(*chord)
                    await asyncio.sleep(.4)
            finally:
                sock.close()
            await asyncio.sleep(1)
            rows = {line.split()[0]: line.split()[1] for line in (await self.text(target, ["wmctrl", "-l"])).splitlines()}
            state = await self.guest(target, ["xwininfo", "-id", opened[0]], allow_failure=True)
            current = [line for line in (await self.text(target, ["wmctrl", "-d"])).splitlines() if " * " in line]
            require(rows.get(opened[0]) == "0" and "Map State: IsViewable" in state.stdout
                    and len(current) == 1 and current[0].split()[0] == "0",
                    f"Expected the window still shown on the one workspace after ctrl+F2, ctrl+F4 and ctrl+alt+d; observed "
                    f"desktop of the window {rows.get(opened[0])!r}, current {current}, viewable {'IsViewable' in state.stdout}")
        finally:
            for identifier in opened:
                await self.guest(target, ["wmctrl", "-i", "-c", identifier], allow_failure=True)
            deadline = time.monotonic() + 10
            while {line.split()[0] for line in (await self.text(target, ["wmctrl", "-l"])).splitlines()} - before:
                require(time.monotonic() < deadline, "Expected the terminal closed within 10 s")
                await asyncio.sleep(.3)
        return (f"one workspace; {len(bound)} window keys kept and none acts on the whole desktop; "
                "ctrl+F2, ctrl+F4 and ctrl+alt+d left an open window shown where it was")

    async def comes_back(self, target):
        """A computer whose X server was lost is restarted by the product's own start and is whole again."""
        began = time.monotonic()
        self.machine.invalidate(target)
        await self.start(target)
        server = (await self.text(target, ["pgrep", "-x", "Xtigervnc"])).split()
        panels = [window for window in await self.tree(target) if window.title == "xfce4-panel"]
        mark = await self.mark(target)
        require(server and panels and mark == str(target.screens),
                f"Expected a new X server, the panel and the mark; observed X {server}, {len(panels)} panel windows, mark {mark!r}")
        return f"ready again in {time.monotonic() - began:.1f} s with an X server, the mark and the panel"

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

    async def driver_schema(self, target):
        """The running driver's list is the one kept with the code, and asking it through the product leaves a
        member's offer as it was. A kept list that differs replaces every tool at the member's first use of the
        computer: a CLI turn starts again there and loses that call's result."""
        from ..computer.vm_catalog import DRIVER_TOOLS, offline_catalog
        kept = json.loads(Path(vm.__file__).with_name("driver_schemas.json").read_text(encoding="utf-8"))["tools"]
        await self.docker.owned(target.name)
        listed, cursor = [], None
        async with CuaBridge(self.machine, target) as client:
            for _ in range(10):
                page = await client.request("tools/list", {"cursor": cursor} if cursor else {})
                listed.extend(tool for tool in page.get("tools", []) if tool.get("name") in DRIVER_TOOLS)
                cursor = page.get("nextCursor")
                if not cursor:
                    break
            else:
                raise AssertionError("Driver tools/list pagination did not end")
        require(len({tool["name"] for tool in listed}) == len(listed), "Duplicate driver tool")
        source = "the running driver's tools/list"
        if self.out:
            # What tests/computer/fixtures/generate_driver_tools.py reads to write both kept files again.
            self.out.mkdir(parents=True, exist_ok=True)
            source = str(self.out / "driver-tools.json")
            Path(source).write_text(json.dumps(listed, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        # The driver's schema as it gives it: the bridge keeps that beside its own reading of it.
        found = {tool["name"]: tool.get("originalInputSchema", tool.get("inputSchema")) for tool in listed}
        written = lambda value: json.dumps(value, ensure_ascii=False)  # key order included: a provider caches the text
        names = lambda schema: sorted((schema or {}).get("properties", {}))
        changed = {name: dict(expected=names(kept.get(name)), observed=names(found.get(name)))
                   for name in sorted(kept.keys() | found.keys()) if written(kept.get(name)) != written(found.get(name))}
        require(not changed, f"Driver parameters changed; write driver_schemas.json and the fixture again from {source} "
                f"(generate_driver_tools.py) and review SHARED_ARGUMENTS. Equal names mean other words, types or order: {changed}")
        guard = self.docker

        class Bridge(CuaBridge):
            async def __aenter__(self):
                await guard.owned(self.target.name)
                return await super().__aenter__()

        tools = VmTools(NoHub(), self.machine, attachments=AttachmentStore(self.root / "driver-check"), bridge=Bridge)
        try:
            tools._catalog(target, offline_catalog())
            # By tool: the driver lists in its own order and a member's list is put in order by name.
            offer = lambda: {tool.name: written([tool.description, tool.schema, tools.schemas[tool.key]])
                             for tool in (tools.tools[key] for key in tools.catalogs[target.key])}
            before = offer()
            await tools._discover(target)
            after = offer()
            differing = sorted(name for name in before.keys() | after.keys() if before.get(name) != after.get(name))
            require(target.key in tools.listed and not differing,
                    f"Expected asking the driver through VmTools to leave the offered tools as they were; changed: {differing}")
        finally:
            await tools.aclose()
        return (f"All {len(kept)} DRIVER_TOOLS schemas are the kept 0.37.0 list to the byte; asking the driver through "
                f"VmTools left the {len(after)} offered tools as they were")

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
        for number, layer in enumerate(OLD_IMAGES):
            await self.previous_layer(layer, 9101 + 10 * number)

    async def previous_layer(self, layer, first):
        name = f"previous layer {layer}"
        result = await self.docker(["image", "inspect", OLD_IMAGES[layer]], timeout=60, limit=100000)
        if result.code:
            self.record(name, "skipped", f"no layer {layer} image here")
            return
        image = json.loads(result.stdout)[0]
        if image.get("Config", {}).get("Labels", {}).get(f"{vm.LABEL}.layer") != layer:
            self.record(name, "skipped", f"no layer {layer} image here")
            return
        fixtures = []
        for member, operation in ((first, "start"), (first + 1, "update"), (first + 2, "erase")):
            target = self.machine.target(member)
            async def fixture(target=target):
                target.workspace.mkdir(parents=True, exist_ok=True)
                target.shared.mkdir(parents=True, exist_ok=True)
                await self.command(previous_args(target, self.machine.owner, secrets.token_urlsafe(24), layer), timeout=90)
                await self.text(target, ["sh", "-c", "printf acceptance > /home/cua/workspace/acceptance.txt"])
                await self.command(["stop", target.name], timeout=90)
                return f"Created a layer {layer} container with workspace file, then stopped it"
            if await self.check(f"{name} fixture {operation}", fixture):
                fixtures.append((target, operation))
            else:
                self.record(f"{name} {operation}", "skipped", "fixture creation failed")
        # All three old computers are stopped before any new-code lifecycle operation runs.
        for target, operation in fixtures:
            async def exercise(target=target, operation=operation):
                state = await self.machine.status(target)
                require(state["state"] == "incompatible", f"Expected layer {layer} incompatible, observed {state}")
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
                return f"layer {layer} {operation}: incompatible -> {'absent with workspace removed' if operation == 'erase' else 'ready on new image, workspace file preserved'}"
            await self.check(f"{name} {operation}", exercise)
        if layer in ("7", "8", "9"):
            await self.previous_shared(layer)

    async def previous_shared(self, layer):
        """The computer every member shares, as the release before this layer left it on an owner's PC (six screens,
        its own memory and cores), is made again on this layer at its next start and keeps its workspace."""
        name = f"previous layer {layer} shared"
        target = self.machine.shared_target("", 9301, 1)

        async def fixture():
            await self.machine.stop(target, remove=True)  # this run's own shared computer of the earlier block
            target.workspace.mkdir(parents=True, exist_ok=True)
            target.shared.mkdir(parents=True, exist_ok=True)
            await self.command(previous_args(target, self.machine.owner, secrets.token_urlsafe(24), layer), timeout=90)
            await self.text(target, ["sh", "-c", "printf shared-acceptance > /home/cua/workspace/acceptance-shared.txt"])
            await self.command(["stop", target.name], timeout=90)
            return f"Created a six-screen layer {layer} shared computer with a workspace file, then stopped it"
        if not await self.check(f"{name} fixture", fixture):
            self.record(f"{name} start", "skipped", "fixture creation failed")
            return

        async def exercise():
            state = await self.machine.status(target)
            require(state["state"] == "incompatible", f"Expected the layer {layer} shared computer incompatible, observed {state}")
            await self.start(target)
            raw = await self.machine.inspect(target)
            require(raw["Image"] == await self.machine.image(target), "Expected the shared computer made again on the new image")
            require(f"RAPHAEL_SCREENS={target.screens}" in raw["Config"]["Env"], "Expected six screens kept")
            content = await self.text(target, ["cat", vm.GUEST + "/acceptance-shared.txt"])
            require(content == "shared-acceptance", f"Expected the shared workspace file kept, observed {content!r}")
            await self.machine.stop(target)
            return f"layer {layer} shared computer: incompatible -> ready on the new image with six screens, workspace file kept"
        await self.check(f"{name} start", exercise)

    async def form(self, hub, target, member, *, peer=None):
        """Type synthetic values through the same page helper used by all saved fills."""
        from ..agent.plugins import tool_key
        from ..computer.vm_tools import vm_scope
        async def tool(name, args, *, caller=member, allow_refusal=False):
            current = self.machine.target(caller)
            with vm_scope(("turn", caller, 1)):
                result = await hub.call(tool_key(f"computer-{current.key}", name), args, approver="auto")
            if not allow_refusal:
                require(result.ok and result.kind not in ("screen_changed", "computer_busy"), f"Form {name} failed: {result.kind}")
            return result
        def page(result):
            for line in reversed(result.text.splitlines()):
                try:
                    data = json.loads(line)
                except ValueError:
                    continue
                if isinstance(data, dict) and "refs" in data:
                    return data
            raise AssertionError("Expected product semantic form refs")
        def field(state, name, frame="main"):
            rows = [row for row in state['refs'] if row.get('name') == name and row.get('frame') == frame and 'type' in row.get('actions', [])]
            require(len(rows) == 1, f"Expected one {name} field")
            return rows[0]
        try:
            data = json.loads(await self.text(target, ["python3", "-c", FORM_START, self.machine.owner]))
            origin = f"http://127.0.0.1:{data['port']}"
            state = page(await tool("browser_open", {"url": origin + "/"}))
            address = dict(target_id=state['target_id'], tab_id=state['tab_id'])
            stale = field(state, 'Name')['ref']
            state = page(await tool("get_browser_state", address))
            before = {name: field(state, name).get('value') for name in ('Name', 'Secret')}
            require(before['Name'] == 'existing', "Expected a prefilled Name field")
            require(not field(state, 'Name', 'iframe').get('value'), "Expected an empty embedded field")
            page_result = await tool("browser_type", {**address, "ref": stale, "text": "must-not-appear"})
            structured = next((json.loads(line) for line in page_result.text.splitlines() if line.startswith('{')), {})
            require(structured.get('effect') == 'refused', f"Expected stale-ref refusal, observed {page_result.kind}")
            state = page(await tool("get_browser_state", address))
            require(before == {name: field(state, name).get('value') for name in before}, "Stale ref changed the form")
            def check_page(reply, url):
                require(urlsplit(url)._replace(path='', query='', fragment='').geturl() == origin, "Form left its loopback origin")
            try:
                await hub._type_page_fields(target, member, address['target_id'],
                    [(field(state, 'Name', 'iframe')['ref'], 'must-not-appear')], check_page)
            except ValueError as error:
                require('embedded frame' in str(error), "Expected actionable frame refusal")
            else:
                raise AssertionError("Embedded saved fill was accepted")
            state = page(await tool("get_browser_state", address))
            require(not field(state, 'Name', 'iframe').get('value'), "Embedded field changed after refusal")
            # A name as this owner's contacts have them: the count of what was delivered must hold beyond ASCII.
            name = 'acceptance 王小明'
            await hub._type_page_fields(target, member, address['target_id'],
                [(field(state, 'Name')['ref'], name), (field(state, 'Secret')['ref'], 'acceptance-secret')],
                check_page, private=False)  # Synthetic acceptance data must be observable through the product.
            state = page(await tool("get_browser_state", address))
            require(field(state, 'Name').get('value') == name, f"Name was not typed, observed {field(state, 'Name').get('value')!r}")
            masked = field(state, 'Secret').get('value')
            require(isinstance(masked, str) and bool(masked) and 'acceptance-secret' not in masked, "Password was not masked and nonempty")
            from ..computer import seat_view
            listed = await tool("list_windows", {})
            rows = seat_view.canvas_windows({"content": [{"type": "text", "text": listed.text}]})['windows']
            binding = hub.page_windows.get((target.key, address['target_id']))
            browser = next(row for row in rows if row['window_id'] == binding[1]) if binding else next(
                row for row in rows if 'chrom' in row['app_name'].lower())
            window = {key: browser[key] for key in ('pid', 'window_id')}
            async def fill_private():
                current = page(await tool("get_browser_state", address))
                await hub._type_page_fields(target, member, address['target_id'],
                    [(field(current, 'Name')['ref'], name), (field(current, 'Secret')['ref'], 'acceptance-secret')], check_page, private=True)
                require((target.key, address['target_id'], address['tab_id']) in hub.private_pages, "Expected a private mark")
            def hidden(result):
                require(not result.blocks and 'no screenshot was returned' in result.text, "Expected private picture withheld with notice")
            await fill_private()
            hidden(await tool("get_window_state", {**window, "include_screenshot": True}))
            hidden(await tool("get_desktop_state", {}))
            if peer is not None:
                other = self.machine.target(peer)
                async def move(screen_target):
                    x, y, width, height = seat_view.rectangle(screen_target.screen, screen_target.screens)
                    await self.text(target, ['wmctrl', '-i', '-r', str(window['window_id']), '-b', 'remove,maximized_vert,maximized_horz'])
                    await self.text(target, ['wmctrl', '-i', '-r', str(window['window_id']), '-e', f'0,{x+40},{y+60},{width-80},{height-120}'])
                    until = time.monotonic() + 5
                    while True:
                        canvas = await self.machine.seat_windows(target)
                        row = next(row for row in canvas['windows'] if row['window_id'] == window['window_id'])
                        if seat_view.contains(row['bounds'], screen_target.screen, screen_target.screens):
                            return
                        require(time.monotonic() < until, "Private window did not settle on the requested screen")
                        await asyncio.sleep(.05)
                try:
                    await move(other)
                    hidden(await tool("get_desktop_state", {}, caller=peer))
                    hidden(await tool("get_window_state", {**window, "include_screenshot": True}, caller=peer))
                finally:
                    await move(target)
            await tool("browser_navigate", {**address, "url": origin + "/other.html"})
            hidden(await tool("get_window_state", {**window, "include_screenshot": True}))
            hidden(await tool("get_desktop_state", {}))
            await tool("browser_navigate", {**address, "url": f"http://127.0.0.1:{data['other_port']}/other.html"})
            hidden(await tool("get_browser_state", {**address, "include_screenshot": True}))
            require((await tool("get_browser_state", {**address, "include_screenshot": True})).blocks, "Expected picture after another-origin observation")
            if peer is not None:
                require((await tool("get_desktop_state", {}, caller=peer)).blocks, "Expected peer pictures restored")
            await tool("browser_navigate", {**address, "url": origin + "/"})
            await fill_private()
            hidden(await tool("get_window_state", {**window, "include_screenshot": True}))
            # Open a spare real tab, return to the filled tab, and close it without closing the native window.
            for keys in (["CTRL", "t"], ["CTRL", "SHIFT", "Tab"], ["CTRL", "w"]):
                await tool("hotkey", {**window, "keys": keys})
            # The driver says a closed tab in two ways (both measured): a browser the seat attached to, and one the
            # driver launched itself. The product must know the one this computer gives.
            from ..computer.vm_tools import CLOSED_TAB_ATTACH
            message = f"confirmation provider failed: tab {address['tab_id']} no longer has a live CDP page target"
            until = time.monotonic() + 5
            while True:
                closed = await tool("get_browser_state", address, allow_refusal=True)
                if message in closed.text or CLOSED_TAB_ATTACH.search(closed.text):
                    break
                require(time.monotonic() < until, f"Expected a measured closed-tab refusal, observed {closed.kind!r}: {closed.text[:2000]!r}")
                await asyncio.sleep(.05)
            # The private probe retires the mark; pixels captured before that probe still stay withheld.
            if (target.key, address['target_id'], address['tab_id']) in hub.private_pages:
                hidden(await tool("get_window_state", {**window, "include_screenshot": True}))
            require((target.key, address['target_id'], address['tab_id']) not in hub.private_pages, "Closed-tab mark survived its probe")
            require((await tool("get_window_state", {**window, "include_screenshot": True})).blocks, "Expected pictures after tab closure")
            return "Product form: prefilled name replaced, password masked/nonempty, iframe refused; private window/desktop pictures withheld across same-origin navigation, restored after another origin and tab closure" + (
                "; moved private window withheld on peer seat" if peer is not None else "")
        finally:
            await self.text(target, ["python3", "-c", FORM_STOP, self.machine.owner])

    async def per_bot_form(self, target, member):
        old_command = self.machine.bridge_command
        old_busy, old_native, old_input = self.machine.busy, self.machine.native_busy, self.machine.input_busy
        old_disconnect = self.machine.disconnect_driver
        async def guarded_bridge(target, args):
            await self.docker.authorize(args)
            return await old_command(target, args)
        self.machine.bridge_command = guarded_bridge
        hub = VmTools(NoHub(), self.machine, attachments=AttachmentStore(self.root / "form-attachments"))
        try:
            await hub.prepare(member)
            await hub._discover(target)
            return await self.form(hub, target, member)
        finally:
            try:
                await hub.aclose()
            finally:
                self.machine.bridge_command = old_command
                self.machine.busy, self.machine.native_busy, self.machine.input_busy = old_busy, old_native, old_input
                self.machine.disconnect_driver = old_disconnect

    async def seed_shared_carry(self, member):
        """Make a stopped per-bot home using only this run's product tools and owner."""
        from ..agent.plugins import tool_key
        from ..computer.vm_tools import vm_scope
        source_vm = vm.LocalVm(self.root, runner=self.docker)
        old_command = source_vm.bridge_command
        async def guarded(target, args):
            await self.docker.authorize(args)
            return await old_command(target, args)
        source_vm.bridge_command = guarded
        hub = VmTools(NoHub(), source_vm, attachments=AttachmentStore(self.root / 'carry-attachments'))
        target = source_vm.target(member)
        async def tool(name, args):
            with vm_scope(('turn', member, 1)):
                result = await hub.call(tool_key('computer-' + target.key, name), args, approver='auto')
            require(result.ok, f'Expected carry seed {name}, observed {result.kind}: {result.text}')
            return result
        try:
            await hub.prepare(member)
            await source_vm.start(target)
            await hub._discover(target)
            script = "from pathlib import Path;p=Path('/home/cua/workspace');(p/'carried.txt').write_text('stage-d');(p/'carry.csv').write_text('n\\n37\\n')"
            await tool('vm_exec', {'command': 'python3 -c ' + shlex.quote(script)})
            await tool('dataset', {'action': 'import', 'dataset': 'carried', 'sources': ['carry.csv']})
            started = await tool('vm_exec', {'command': 'python3 -c ' + shlex.quote(CARRY_START)
                                           + ' ' + shlex.quote(source_vm.owner) + ' 0'})
            port = json.loads(json.loads(started.text)['output'].splitlines()[0])['port']
            await tool('browser_open', {'url': f'http://127.0.0.1:{port}/set'})
            # Measured: seconds-old cookies can be lost when a driver-owned browser ends.
            await asyncio.sleep(40)
            await hub.aclose()
            await source_vm.stop(target)
            self.machine.data.made(target)
            return {'target': target, 'port': port}
        finally:
            await hub.aclose()
            await source_vm.aclose(stop=True)

    async def check_shared_carry(self, tool, seed, target, member):
        from ..computer.carry import journal
        started = await tool(member, 'vm_exec', {'command': 'python3 -c ' + shlex.quote(CARRY_START)
                                               + ' ' + shlex.quote(self.machine.owner) + ' ' + str(seed['port'])})
        require(json.loads(started.text).get('exit_code') == 0, 'Expected shared cookie server started')
        state = await tool(member, 'browser_open', {'url': f'http://127.0.0.1:{seed["port"]}/check'})
        require('stage_d=' + self.machine.owner in state.text, 'Expected persistent cookie from stopped per-bot browser')
        record = await journal(self.machine, target)
        carried = record.get(seed['target'].key, {})
        require(carried.get('status') == 'done' and carried.get('profile') == 'carried', 'Expected carried member journal')
        result = await tool(member, 'vm_exec', {'command': 'cat ' + shlex.quote(carried['folder'] + '/carried.txt')})
        require(json.loads(result.text)['output'].strip() == 'stage-d', 'Expected carried file in named member folder')
        result = await tool(member, 'dataset', {'action': 'query', 'dataset': 'carried', 'sql': 'SELECT n FROM data'})
        require(json.loads(result.text)['rows'] == [[37]], 'Expected carried member dataset')
        before = self.docker.carry_calls
        await self.machine.disconnect_unit(target)
        await self.machine.stop(target)
        await self.machine.start(target)
        await tool(member, 'browser_open', {'url': 'about:blank'})
        require(self.docker.carry_calls == before, 'Expected second start to copy nothing')
        return 'Persistent cookie, named folder and member dataset carried; second start ran no copy helper'

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
            await self.check(prefix + " driver schema", lambda: self.driver_schema(target))
            if count == 1:
                await self.check(prefix + " typed form", lambda: self.per_bot_form(target, count))
            await self.check(prefix + " desktop picture", lambda: self.wallpaper(target))
            await self.check(prefix + " keys", lambda: self.keys(target))
            if count > 1:
                for seat in (1, count):
                    await self.check(prefix + f" steering screen {seat}", lambda seat=seat: self.steer(target, seat))
            await self.check(prefix + " no tooltip or dialog", lambda: self.quiet(target))
            await self.check(prefix + " browser mark", lambda: self.browser_mark(target))
            await self.check(prefix + " restart", lambda: self.restart(target))
            if count == largest:
                if count > 1:
                    await self.check(prefix + " app path", lambda: self.app_path(target))
                    await self.check(prefix + " recovers view", lambda: self.recover(target))
                    await self.check(prefix + " recovers helper", lambda: self.recover(target, helper=True))
                else:
                    self.record(prefix + " multi-screen recovery/app seat", "skipped", "requires N > 1")
            # One screen has no clipped view that dies with the X server, so it is its own case.
            if count in (1, largest):
                if await self.check(prefix + " loses X", lambda: self.lose_x(target)):
                    await self.check(prefix + " comes back after X loss", lambda: self.comes_back(target))
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

        calls, observations = [], []
        first_result = len(self.results)

        class RecordingBridge(CuaBridge):
            async def request(self, method, params=None, **kwargs):
                if method == "tools/call":
                    calls.append((self.target.key, params["name"], dict(params["arguments"])))
                reply = await super().request(method, params, **kwargs)
                if method == "tools/call":
                    observations.append((self.target.key, params["name"], reply))
                return reply

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
            seed = None
            async def carry_seed():
                nonlocal seed
                seed = await self.seed_shared_carry(members[0])
                return 'Per-bot test cookie flushed for 40 seconds, file and dataset made, computer stopped'
            seed_ok = await self.check('shared carry seed', carry_seed)
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
                self.record("shared dependent checks", "skipped", "shared prepares failed")
                raise AssertionError("Shared preparation failed; dependent checks skipped")

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

            async def datasets():
                for member, value in zip(members, (11, 22)):
                    command = "python3 -c " + shlex.quote("from pathlib import Path;Path('seat-" + str(member)
                        + ".csv').write_text('n\\n" + str(value) + "\\n')")
                    await tool(member, 'vm_exec', {'command': command})
                    await tool(member, 'dataset', {'action': 'import', 'dataset': 'sales',
                               'table': 'only_' + str(member), 'sources': [f'seat-{member}.csv']})
                    result = await tool(member, 'dataset', {'action': 'query', 'dataset': 'sales',
                                        'sql': 'SELECT n FROM only_' + str(member)})
                    require(json.loads(result.text)['rows'] == [[value]], 'Expected own same-named dataset rows')
                for member in members:
                    result = await tool(member, 'dataset', {'action': 'list', 'dataset': 'sales'})
                    require(json.loads(result.text)['rows'] == [['only_' + str(member)]], 'Expected only own dataset table')
                return 'Same dataset name, distinct rows and table lists for both seats'
            await self.check('shared member datasets', datasets)

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

            async def pointer_wall():
                member = members[1]
                args = {key: terminals[member][key] for key in ("pid", "window_id")}
                client, session = await hub._connection(targets[member])
                async def pointer():
                    reply = await client.request("tools/call", {"name": "get_cursor_position", "arguments": {"session": session}})
                    require(not reply.get("isError"), f"Expected real pointer read, observed {reply}")
                    state = reply.get("structuredContent") or {}
                    if {"x", "y"} <= state.keys():
                        return state["x"], state["y"]
                    text = "\n".join(block.get("text", "") for block in reply.get("content", []) if block.get("type") == "text")
                    match = re.search(r"Cursor at \((-?[\d.]+),\s*(-?[\d.]+)\)", text)
                    require(match, f"Expected pointer coordinates, observed {text}")
                    return tuple(map(float, match.groups()))
                await tool(member, "get_window_state", {**args, "include_screenshot": True})
                before = await pointer()
                dispatched = len([call for call in calls if call[1] == "click"])
                result = await tool(member, "click", {**args, "x": 1380, "y": 80}, allow_refusal=True)
                require(not result.ok and "inside this member's screen" in result.text, f"Expected out-of-seat refusal, observed {result}")
                require(dispatched == len([call for call in calls if call[1] == "click"]), "Refused click reached driver")
                after = await pointer()
                require(after == before, f"Refused click moved real pointer: {before} -> {after}")
                return f"Out-of-seat click refused before dispatch; real pointer unchanged at {before}"

            async def target_wall():
                member = members[1]
                args = {key: terminals[member][key] for key in ("pid", "window_id")}
                for extra in ({"coordinate_frame": "desktop"}, {"target": {"kind": "window", **args}}):
                    before = len([call for call in calls if call[1] == "click"])
                    result = await tool(member, "click", {**args, "x": 20, "y": 60, **extra}, allow_refusal=True)
                    require(not result.ok, f"Expected forbidden targeting refusal, observed {result}")
                    require(before == len([call for call in calls if call[1] == "click"]), f"Forbidden {extra} reached driver")
                return "coordinate_frame=desktop and target refused before driver dispatch"

            async def native_text():
                member = members[1]
                args = {key: terminals[member][key] for key in ("pid", "window_id")}
                result = await tool(member, "get_window_state", args)
                require(result.text.startswith("window_id=") and "element_token for row [" in result.text,
                        f"Expected driver's window/tree/token text on seat 2, observed {result.text[:500]!r}")
                moved = await tool(member, "move_cursor", {"x": 40, "y": 50})
                cursor = await tool(member, "get_cursor_position", {})
                require("Moved the real desktop pointer to (40, 50)." in moved.text and "Cursor at (40, 50)" in cursor.text,
                        f"Expected seat coordinates in pointer prose, observed {moved.text!r}, {cursor.text!r}")
                return "Seat 2 retains window_id/tree/element_token prose; move/read pointer says (40, 50)"

            async def verifies():
                member = members[1]
                window = next(row for row in await rows(member) if row["window_id"] == terminals[member]["window_id"])
                args = {key: window[key] for key in ("pid", "window_id")}
                await tool(member, "verify_state", {**args, "expect": [{"window": {"bounds": window["bounds"]}}]})
                state = next(reply.get("structuredContent", {}) for key, name, reply in reversed(observations)
                             if key == targets[member].key and name == "verify_state")
                require(state.get("status") == "satisfied", f"Expected seat-local bounds satisfied on seat 2, observed {state}")
                return "verify_state with seat 2's current seat-local bounds is satisfied"

            async def shortcuts():
                first, second = members
                args = {key: terminals[first][key] for key in ("pid", "window_id")}
                await tool(first, "bring_to_front", args)
                peer = [row["window_id"] for row in await rows(second)]
                require(peer, "Expected peer windows to observe")
                for keys in (["ctrl", "F2"], ["ctrl", "alt", "d"], ["alt", "Tab"]):
                    await tool(first, "hotkey", {**args, "keys": keys})
                    root = await self.text(targets[first], ["xprop", "-root", "_NET_NUMBER_OF_DESKTOPS", "_NET_CURRENT_DESKTOP", "_NET_ACTIVE_WINDOW"])
                    require(re.search(r"_NET_NUMBER_OF_DESKTOPS\(CARDINAL\) = 1\b", root)
                            and re.search(r"_NET_CURRENT_DESKTOP\(CARDINAL\) = 0\b", root), f"Expected one current workspace after {keys}, observed {root}")
                    active = re.search(r"_NET_ACTIVE_WINDOW\(WINDOW\): window id # (0x[0-9a-fA-F]+)", root)
                    own = {row["window_id"] for row in await rows(first)}
                    require(active and int(active[1], 16) in own, f"Expected active window on seat 1 after {keys}, observed {root}")
                    for identifier in peer:
                        mapped = await self.text(targets[first], ["xwininfo", "-id", str(identifier), "-stats"])
                        workspace = await self.text(targets[first], ["xprop", "-id", str(identifier), "_NET_WM_DESKTOP"])
                        require("Map State: IsViewable" in mapped and re.search(r"= (?:0|4294967295)\s*$", workspace),
                                f"Expected peer window {identifier} mapped on the one workspace after {keys}: {mapped}, {workspace}")
                return "ctrl+F2, ctrl+alt+d and alt+Tab retain peer mapped windows on one workspace and seat 1 focus"

            for name, action in (("shared pointer wall", pointer_wall), ("shared target forms", target_wall),
                                 ("shared native text", native_text), ("shared seat-local verify", verifies),
                                 ("shared global shortcuts", shortcuts)):
                if terminals_ok:
                    await self.check(name, action)
                else:
                    self.record(name, "skipped", "shared terminal wall failed")

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
            else:
                self.record("shared simultaneous native typing", "skipped", "shared terminal wall failed")

            async def browsers():
                for member in members:
                    pages[member] = page(await tool(member, "browser_open", {"url": "about:blank"}))
                browser_windows = [[row for row in await rows(member) if row["app_name"].lower() in BROWSER_APPS] for member in members]
                require(all(len(found) == 1 for found in browser_windows), f"Expected one browser window per seat, observed {browser_windows}")
                require(browser_windows[0][0]["window_id"] != browser_windows[1][0]["window_id"]
                        and browser_windows[0][0]["pid"] == browser_windows[1][0]["pid"],
                        f"Expected two windows of one browser pid, observed {browser_windows}")
                pids = (await self.text(targets[members[0]], ["pgrep", "-f", "^[^ ]+ --remote-debugging-port=0 --user-data-dir=/home/cua/workspace/.browser-profiles/driver/main"])).split()
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
            if browsers_ok:
                await self.check("shared typed form", lambda: self.form(hub, targets[members[0]], members[0], peer=members[1]))
            else:
                self.record("shared typed form", "skipped", "shared computer browser failed")

            async def persons_browser():
                """The members' browser is one a person signs in with: Google's own Chrome where there is one, a page
                is not told it is automated, and nothing warns over the window. An owner signing in to Google for his
                members met "This browser or app may not be secure", a yellow bar and "Restore pages?" (2026-11-13)."""
                target = targets[members[0]]
                profile = "/home/cua/workspace/.browser-profiles/driver/main"
                line = (await self.text(target, ["pgrep", "-af", f"^[^ ]+ --remote-debugging-port=0 --user-data-dir={profile}"])).splitlines()[0]
                _, binary, *flags = line.split()
                chrome = not (await self.guest(target, ["test", "-x", "/opt/google/chrome/chrome"], allow_failure=True)).code
                amd64 = (await self.text(target, ["dpkg", "--print-architecture"])).strip() == "amd64"
                require(chrome == amd64, f"Expected Google Chrome in the image exactly where Google builds one (amd64={amd64}), observed {chrome}")
                require(binary == ("/opt/google/chrome/chrome" if chrome else "/usr/lib/chromium/chromium"),
                        f"Expected the members' browser to be {'Google Chrome' if chrome else 'Chromium'}, observed {binary}")
                missing = [flag for flag in ("--disable-blink-features=AutomationControlled", "--test-type", "--hide-crash-restore-bubble")
                           if flag not in flags]
                require(not missing, f"Expected the browser started without its warnings and automation mark, missing {missing}")
                probe = 'data:text/html,<title>raphael-probing</title><script>document.title="raphael-webdriver-"+navigator.webdriver</script>'
                await self.guest(target, [binary, f"--user-data-dir={profile}", "--new-window", probe])
                until, titles = time.monotonic() + 15, ""
                while "raphael-webdriver-" not in titles:
                    require(time.monotonic() < until, f"Expected the probe page's window, observed {titles[-400:]}")
                    await asyncio.sleep(.3)
                    titles = await self.text(target, ["wmctrl", "-l"])
                said = next(word for line in titles.splitlines() for word in line.split() if word.startswith("raphael-webdriver-"))
                identifier = next(line.split()[0] for line in titles.splitlines() if said in line)
                await self.guest(target, ["wmctrl", "-i", "-c", str(int(identifier, 16))])
                require(said == "raphael-webdriver-false", f"Expected a page to be told this is not an automated browser, observed {said}")
                # The desktop's Browser icon gives a window of this same browser. A second browser with a profile of
                # its own is where an owner would sign in for nobody.
                listed = lambda text: {line.split()[0]: line.split()[2] for line in text.splitlines() if len(line.split()) > 2}
                before = listed(await self.text(target, ["wmctrl", "-lp"]))
                await self.guest(target, ["raphael-browser"])
                until, new = time.monotonic() + 15, {}
                while not new:
                    require(time.monotonic() < until, "Expected the Browser icon to open a window")
                    await asyncio.sleep(.3)
                    new = {key: pid for key, pid in listed(await self.text(target, ["wmctrl", "-lp"])).items() if key not in before}
                for key in new:
                    await self.guest(target, ["wmctrl", "-i", "-c", str(int(key, 16))])
                mains = [line.split()[0] for line in (await self.text(target, ["pgrep", "-af", "/chrome|/chromium"])).splitlines()
                         if len(line.split()) > 1 and line.split()[1].rsplit("/", 1)[-1] in ("chrome", "chromium") and "--type=" not in line]
                main = line.split()[0]
                require(set(new.values()) == {main} and mains == [main],
                        f"Expected the Browser icon to open a window of the members' own browser (pid {main}), observed windows {new} and browsers {mains}")
                # Every member reads this one profile: the browser keeps no password, card or address in it.
                kept = json.loads(await self.text(target, ["cat", profile + "/Default/Preferences"]))
                offers = {"passwords": kept.get("credentials_enable_service"), "password manager": (kept.get("profile") or {}).get("password_manager_enabled"),
                          "cards": (kept.get("autofill") or {}).get("credit_card_enabled"), "addresses": (kept.get("autofill") or {}).get("profile_enabled")}
                require(all(value is False for value in offers.values()), f"Expected the members' browser to keep nothing typed into it, observed {offers}")
                # As the browser's own policy too, which holds whatever the profile says: and never signed in to as a
                # browser, never syncing an owner's own passwords and history into the profile every member reads.
                folder = "/etc/opt/chrome/policies/managed" if chrome else "/etc/chromium/policies/managed"
                managed = json.loads(await self.text(target, ["cat", folder + "/raphael.json"]))
                wanted = {"BrowserSignin": 0, "SyncDisabled": True, "PasswordManagerEnabled": False,
                          "AutofillCreditCardEnabled": False, "AutofillAddressEnabled": False}
                require(managed == wanted, f"Expected the members' browser policy {wanted}, observed {managed}")
                # The panel of every screen names this browser under its own mark: an owner looked at a globe named
                # "Browser" (2026-11-13).
                named, _ = await self.browser_named(target)
                version = (await self.text(target, [binary, "--version"])).strip()
                return (f"{version} ({binary}); navigator.webdriver is false; started with --test-type and no crash bubble; "
                        f"every screen's launcher is {named} and opens a window of the same browser; it keeps no password, card or address, "
                        "and by policy is never signed in to as a browser and never syncs")
            if browsers_ok:
                await self.check("shared browser is a person's", persons_browser)
            else:
                self.record("shared browser is a person's", "skipped", "shared computer browser failed")

            async def page_text():
                result = await tool(members[1], "get_browser_state", active_tab(pages[members[1]]))
                lines = []
                for line in result.text.splitlines():
                    try:
                        lines.append(json.loads(line))
                    except ValueError:
                        pass
                require(len(lines) == 1, f"Expected exactly one page JSON line on seat 2, observed {result.text[:500]}")
                return "Seat 2 page prose is followed by exactly one JSON line"
            if browsers_ok:
                await self.check("shared page text", page_text)
            else:
                self.record("shared page text", "skipped", "shared computer browser failed")

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
            else:
                self.record("shared clipped product pictures", "skipped", "shared terminal wall failed")

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
                            before = len([call for call in calls if call[1] == "browser_click"])
                            refused = await tool(second, "browser_click", {**active_tab(pages[second]), "x": 20, "y": 20,
                                                  "delivery_mode": "foreground"}, allow_refusal=True)
                            require(refused.kind == "computer_busy", f"Expected held foreground browser click busy, observed {refused}")
                            require(before == len([call for call in calls if call[1] == "browser_click"]), "Held foreground browser click reached driver")
                            await tool(second, "browser_navigate", {**active_tab(pages[second]), "url": "about:blank#owner-held"})
                    finally:
                        hub.busy_wait_s = old_wait
                    await viewer.control({**opened, "held": False})
                    await tool(second, "press_key", {**args, "key": "Return"})
                    return ("Takeover during peer vm_exec; own calls refused, peer native waits/busy, peer window lists continue, handback restores native"
                            + ("; foreground browser click waits/busy before dispatch while page read/navigation continue" if browsers_ok else "; browser hold checks skipped"))
                finally:
                    await command
                    await viewer.close(opened)
            if terminals_ok:
                await self.check("shared owner control", control)
            else:
                self.record("shared owner control", "skipped", "shared terminal wall failed")

            async def owner_input():
                """The owner's own mouse and keys, sent as the app's page sends them (the session's relay path, on the
                connection it made while watching), reach the seat the owner holds; before the hold and after the
                handback they reach nothing. An owner was told "you are in control" with nothing getting in
                (2026-11-13): until then every check of a hold looked only at what the members were refused."""
                second = members[1]
                target = targets[second]
                rect = vm.screen_grid(target.screens)[0][target.screen - 1]
                mark = f"/home/cua/workspace/owner-input-{secrets.token_hex(4)}"
                opened = await viewer.open({"member_id": second})
                url, sock = urlsplit(opened["url"]), None

                async def seat_terminals():
                    return {w.identifier: w for w in await self.tree(target) if w.terminal and inside(rect, centre(w.rectangle))}

                async def made(file):
                    return not (await self.guest(target, ["test", "-e", file], allow_failure=True)).code
                try:
                    status, body = await asyncio.to_thread(self.http, url.port, f"/{opened['session']}/connection")
                    require(status == 200, f"Expected the seat's connection 200, observed {status}")
                    config = json.loads(body)
                    sock, client = await asyncio.to_thread(self.connect, url.port, config["path"], config["password"], origin=viewer.origin)
                    # A panel is as wide as what it holds, and for a moment it holds nothing (seen 12 px wide on a real
                    # computer while a browser window was settling on its screen): the launcher is pressed once the
                    # panel is whole, and how long that took is said.
                    waited, panels, seen = time.monotonic(), [], []
                    while len(panels) != 1:
                        seen = [w.rectangle for w in await self.tree(target) if w.title == "xfce4-panel" and inside(rect, centre(w.rectangle))]
                        panels = [rectangle for rectangle in seen if rectangle[2:] == (146, 49)]
                        require(len(panels) == 1 or time.monotonic() < waited + 20,
                                f"Expected one whole panel on screen {target.screen} within 20 s, observed {seen}")
                        if len(panels) != 1:
                            await asyncio.sleep(.5)
                    waited = time.monotonic() - waited
                    px, py, pw, ph = panels[0]
                    launcher = (px - rect[0] + pw * 5 // 6, py - rect[1] + ph // 2)

                    def press(point):
                        client.pointer(*point)
                        client.pointer(*point, 1)
                        client.pointer(*point)

                    def type_line(line):
                        # As a person types it: Shift held around what needs it (a bare "@" never reaches a seat).
                        client.type_text(line + "\n")
                    before = await seat_terminals()
                    await asyncio.to_thread(press, launcher)
                    await asyncio.sleep(2)
                    require((await seat_terminals()).keys() == before.keys(), "Expected a watching owner's click to reach nothing")
                    state = await viewer.control({**opened, "held": True})
                    require(state.get("control") == "owner", f"Expected the hold to be the owner's, observed {state}")
                    began, new = time.monotonic(), {}
                    await asyncio.to_thread(press, launcher)
                    while not new and time.monotonic() < began + 10:
                        await asyncio.sleep(.2)
                        new = {key: w for key, w in (await seat_terminals()).items() if key not in before}
                    require(len(new) == 1, f"Expected the holding owner's click to open one terminal on screen {target.screen} "
                            f"within 10 s, observed {list(new.values())}")
                    clicked = time.monotonic() - began
                    terminal = next(iter(new.values()))
                    await asyncio.sleep(.5)
                    await asyncio.to_thread(press, (centre(terminal.rectangle)[0] - rect[0], centre(terminal.rectangle)[1] - rect[1]))
                    await asyncio.to_thread(type_line, f"touch {mark}")
                    until = time.monotonic() + 5
                    while not await made(mark):
                        require(time.monotonic() < until, "Expected the holding owner's typed line to run in the seat's terminal")
                        await asyncio.sleep(.2)
                    # What needs Shift, typed as a person types it (2026-11-14: a script's bare "@" never reached a seat).
                    await asyncio.to_thread(type_line, f"echo 'Aa@?#%&(<' > {mark}-shift")
                    until = time.monotonic() + 5
                    while not await made(mark + "-shift"):
                        require(time.monotonic() < until, "Expected the typed line with shifted characters to run in the seat's terminal")
                        await asyncio.sleep(.2)
                    await asyncio.sleep(.3)
                    written = (await self.text(target, ["cat", mark + "-shift"])).strip()
                    require(written == "Aa@?#%&(<", f"Expected shifted characters to reach the seat's terminal as typed, observed {written!r}")
                    await viewer.control({**opened, "held": False})
                    await asyncio.to_thread(type_line, f"touch {mark}-after")
                    await asyncio.sleep(1.5)
                    require(not await made(mark + "-after"), "Expected keys after the handback to reach nothing")
                    return (f"through the app's relay path on screen {target.screen}: watching, a click reaches nothing; holding, "
                            f"a click opened a terminal in {clicked:.1f} s and a typed line ran; handed back, keys reach nothing"
                            + (f"; the screen's panel was whole after {waited:.1f} s" if waited > 1 else ""))
                finally:
                    if sock:
                        sock.close()
                    await viewer.close(opened)
            if terminals_ok:
                await self.check("shared owner input", owner_input)
            else:
                self.record("shared owner input", "skipped", "shared terminal wall failed")
            if not browsers_ok:
                self.record("shared foreground page hold", "skipped", "shared computer browser failed")

            async def demonstration():
                from ..bots.homes import BotHomes
                from ..computer.teaching import Teaching
                homes = BotHomes(self.root / 'acceptance-member-homes')
                service = SimpleNamespace(capabilities=SimpleNamespace(homes=homes),
                                          member_exists=lambda member: member in members)
                viewer.teaching = recorder = Teaching(viewer, service, None)
                opened = await viewer.open({'member_id': members[1], 'conversation_id': 1, 'preview': False})
                try:
                    with canvas_observations() as wide_calls:
                        started = await recorder.call({'action': 'start', 'session': opened['session']})
                        recording = recorder.items[started['id']]
                        # The owner's press waits for this observation on a shared computer: say what it costs.
                        began = time.monotonic()
                        await recorder.input(opened['session'], b'\x05\x01\x00\x0a\x00\x14')
                        first = time.monotonic() - began
                        began = time.monotonic()
                        await recorder.input(opened['session'], b'\x05\x01\x00\x0b\x00\x15')
                        warm = time.monotonic() - began
                        await recorder.tick(opened['session'])
                    screens = [event for event in recording.events if event['kind'] == 'screen']
                    require(screens, 'Expected a recorded seat screen')
                    foreign = [row for row in await rows(members[0]) if row['app_name'].lower() != 'xfce4-panel']
                    for event in screens:
                        require(not any('window_id=' + str(row['window_id']) + ' ' in event['screen'] for row in foreign),
                                'Seat 1 window appeared in seat 2 recording')
                        require(event['images'], 'Expected clipped teaching picture')
                        picture = base64.b64decode(event['images'][0]['data'])
                        require(struct.unpack('>II', picture[16:24]) == (1280, 900), 'Expected seat-size teaching PNG')
                    require(not wide_calls and recording.relay is None, f'Expected zero canvas observations, observed {wide_calls}')
                    # Measured 2026-11-12 on a Windows host: per-bot's relay capture 0.23 s; this path 1.03 s with the
                    # per-pixel picture and 0.22 s with Rfb.frame(). A second per press is a recorder nobody can type in.
                    require(warm < .7, f'Expected an owner press observed within 0.7 s, observed {warm:.3f} s')
                    return ('Seat 2 recording: no seat 1 window ids, 1280x900 PNG, zero canvas-wide driver calls, core input/tick; '
                            f'a press waits {first:.3f} s for its first observation and {warm:.3f} s for the next')
                finally:
                    for recording in list(recorder.items.values()):
                        await recorder.call({'action': 'discard', 'member_id': recording.member, 'id': recording.id})
                    await viewer.close(opened)
                    viewer.teaching = None
            if terminals_ok:
                await self.check('shared seat teaching', demonstration)
            else:
                self.record('shared seat teaching', 'skipped', 'shared terminal wall failed')

            async def disconnect():
                pid = next(row["pid"] for row in await rows(members[1]) if row["app_name"].lower() in BROWSER_APPS)
                await hub._disconnect(targets[members[0]].key)
                await tool(members[1], "get_browser_state", active_tab(pages[members[1]]))
                current = next(row["pid"] for row in await rows(members[1]) if row["app_name"].lower() in BROWSER_APPS)
                require(current == pid, f"Expected browser pid {pid} to survive disconnect, observed {current}")
                return f"Seat 1 connection ended; browser pid {pid} and seat 2's bound tab survive"
            if browsers_ok:
                await self.check("shared session ends independently", disconnect)
            else:
                self.record("shared session ends independently", "skipped", "shared computer browser failed")

            async def displacement():
                third = 9203
                target = targets[members[0]]
                before = {row['window_id'] for row in (await machine.seat_windows(target))['windows']}
                await self.docker(['exec', '-d', '-u', 'cua', '-e', 'DISPLAY=:1', target.name, 'x-terminal-emulator'])
                until = time.monotonic() + 5
                while True:
                    found = [row for row in (await machine.seat_windows(target))['windows']
                             if row['window_id'] not in before and row['app_name'].lower() != 'xfce4-panel']
                    if found:
                        break
                    require(time.monotonic() < until, 'Expected an external leftover window')
                    await asyncio.sleep(.05)
                leftover = found[0]['window_id']
                await machine.move_window(machine.shared_target('', third, 3), leftover)
                # A window of the member on screen 2 reaches 16 px over the edge of free screen 3, as a browser's
                # frame can (measured: 1312x893 at -16,-10). It is that member's own: seating a third member beside
                # it must close the leftover and leave this one.
                beside = next(row for row in await rows(members[1]) if row['app_name'].lower() != 'xfce4-panel')
                seat_two = targets[members[1]]
                for command in (['wmctrl', '-i', '-r', str(beside['window_id']), '-b', 'remove,maximized_vert,maximized_horz'],
                                ['wmctrl', '-i', '-r', str(beside['window_id']), '-e', '0,1976,100,600,400']):
                    moved = await machine.run_for(seat_two, vm.exec_args(seat_two, command))
                    require(not moved.code, f'Expected the neighbouring window placed, observed exit {moved.code}')
                placed = next(row for row in (await machine.seat_windows(target))['windows'] if row['window_id'] == beside['window_id'])
                require(seat_view.overlaps(placed['bounds'], 3, 6) and seat_view.holder(placed['bounds'], 6) == 2,
                        f'Expected a window of screen 2 reaching into screen 3, observed {placed["bounds"]}')
                await hub.prepare(third)
                require(machine.target(third).screen == 3 and all(machine.target(member) == targets[member] for member in members),
                        "Expected third member on free seat 3 without displacement")
                listed = (await machine.seat_windows(target))['windows']
                # The desktop's own windows are there on every screen; the leftover must be gone, and by its id.
                require(leftover not in {row['window_id'] for row in listed} and not any(
                    seat_view.overlaps(row['bounds'], 3, 6) and row['app_name'].lower() not in machine.DESKTOP_WINDOWS
                    and row['window_id'] != beside['window_id'] for row in listed),
                    'Free screen was handed over with a leftover window')
                require(beside['window_id'] in {row['window_id'] for row in listed},
                        "A seated member's window was closed because a colleague sat down beside it")
                await machine.fit_window(seat_two, placed)
                require(any(row['app_name'].lower() == 'xfdesktop' for row in listed), 'The desktop window was closed with the leftover window')
                machine.seats = ComputerSeats(count=2)
                for member in members:
                    machine.seats.restore('', member, targets[member].screen)
                # The second member was used more recently, so the first is the idle victim.
                hub.leases.clear()
                first_ids = {row["window_id"] for row in await rows(members[0]) if row["app_name"].lower() != "xfce4-panel"}
                require(first_ids, "Expected windows to close on displaced seat")
                machine.seats.touch("", members[1])
                # Fail one list at the injected Docker boundary, keeping the product path intact.
                original_runner = self.docker.runner
                failed_lists = []
                async def fail_one_list(args, **kwargs):
                    if 'wmctrl' in args and args[-1] == '-lG' and not failed_lists:
                        failed_lists.append(1)
                        return vm.Result(1, '', 'Synthetic window list failure')
                    return await original_runner(args, **kwargs)
                self.docker.runner = fail_one_list
                try:
                    refused = await tool(third, 'list_windows', {}, allow_refusal=True)
                    require(failed_lists and machine.target(third).screen == 0 and machine.target(members[0]) == targets[members[0]],
                            'A failed window list handed over a seat or failed to restore its exact holder')
                    require(refused.kind == 'computer_busy' and 'every screen of the computer is in use' in refused.text,
                            f'Expected the ordinary every-screen-in-use answer, observed {refused.kind}: {refused.text}')
                finally:
                    self.docker.runner = original_runner
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
                return "Free seat 3 is cleaned of a leftover window while the neighbour's window that reaches over its edge stays; failed listing refuses displacement and restores the exact holder; retry replaces the idle LRU seat only after all its non-panel windows close"
            await self.check("shared seat displacement", displacement)
            if seed_ok and browsers_ok:
                # Displacement deliberately closed seat 1. Re-seat its original member before checking its datasets.
                hub.leases.clear()
                await hub.prepare(members[0])
                targets[members[0]] = machine.target(members[0])
                await self.check('shared carried home', lambda: self.check_shared_carry(
                    tool, seed, targets[members[0]], members[0]))
            else:
                self.record('shared carried home', 'skipped', 'carry seed or shared browser failed')
            require(not any(row["result"] == "failed" for row in self.results[first_result:]), "One or more shared checks failed; see named results")
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
            require(not any(row["result"] == "failed" for row in self.results[first_result:]), "One or more shared checks failed; see named results")

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
            (self.root / vm.OWN_WALLPAPER).write_bytes(OWN_PICTURE)
            self.machine = vm.LocalVm(self.root, runner=self.runner)
            self.docker = IsolatedDocker(self.runner, self.machine.owner, self.tag, picture=self.root / vm.OWN_WALLPAPER)
            self.machine.run = self.docker
            vm.IMAGE = self.tag
            # Prevent product fallback from pulling or rebuilding the normal image if ours disappears.
            async def no_build(*args, **kwargs):
                raise AssertionError("Expected prebuilt isolated acceptance image; refusing product pull/build fallback")
            self.machine.build = no_build
            self.build_attempted = True
            async def build():
                # A build says as much as it installs (layer 8 passed what a command's output may be): its exit and
                # the image it leaves are what is judged, as in the product's own build.
                result = await self.docker(["build", "--tag", self.tag, str(IMAGE_FOLDER)], timeout=1800)
                require(result.code == 0, f"Expected build exit 0, observed {result.code}: {result.stderr.strip()[-2000:]}")
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

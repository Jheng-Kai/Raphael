"""Docker desktops on this computer or an SSH host.

Adapted from OpenMausBot (Apache-2.0); see core/packaging/licenses.
The engine owns containers; only the workspace survives
removal. Remote workspaces are engine volumes, never paths on this PC.
"""

import asyncio
import csv
import hashlib
import io
import json
import logging
import math
import os
import re
import secrets
import time
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, replace
from pathlib import Path, PurePosixPath
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

logger = logging.getLogger(__name__)

BASE = "docker.io/trycua/xfce-cua@sha256:274eb636f5cf3fc58f705916ee72b7a701270b3877369d08533a385c5325be9b"
VERSION = "0.37.0"
IMAGE = "raphael/cua-local-vm:driver-0.37.0-v12"
GUEST = "/home/cua/workspace"
SHARED = "/home/cua/team"
MEMORY_GB = 3
LOCAL_LIMIT = 2
PREFLIGHT_S = 45.0
DRIVER = "/usr/local/libexec/raphael/cua-driver"
SOCKET = "/run/user/1000/raphael-cua.sock"
SCREENS_READY = "/dev/shm/raphael-screens.ready"
LABEL = "org.raphael.computer"
IMAGE_LABELS = {LABEL: "1", f"{LABEL}.driver": VERSION, f"{LABEL}.base": BASE, f"{LABEL}.layer": "12"}
MAX_OUTPUT = 50_000  # what a task may be shown of a result at most (`worker.guards`)
# The owner's hold of a screen ends by itself after this long without a click or a key of his (a sign-in request that
# waits for him and a recording are held until he says so): a lease nobody uses blocks every member (2026-11-14).
OWNER_IDLE_S = 300
# The longest a command may be waited for, and the longest a job started in the background may run.
FOREGROUND_S = 1800
BACKGROUND_S = 21_600
WALLPAPER_SETUP_S = 5
# The owner's own JPEG stays in their data folder: this repository is public, and art they supply must never enter it.
OWN_WALLPAPER = "computer-wallpaper.jpg"
OWN_WALLPAPER_BYTES = 8_000_000
GUEST_OWN_WALLPAPER = "/opt/raphael-desktop/wallpapers/own.jpg"
# The watcher and the default pictures (day.jpg, night.jpg) copied into a computer at every start. Outside image/:
# what the image's build copies stays as the layer before built it, or the next build downloads Chrome again.
WALLPAPER_FOLDER = Path(__file__).parent / "wallpaper"
# How long a member's own use of its computer waits for a Docker Desktop it had to start, and how often it asks.
# Docker Desktop on Windows starts WSL first, so a cold start takes the better part of a minute.
ENGINE_WAIT_S = 120
ENGINE_POLL_S = 1.0
# Set only while a member's own tool call prepares its computer. (owner, 2026-11-11: 「理論上就算我沒有開 Docker，
# 它也會自動自己打開才對」) A viewer opening or any other read never starts the engine, so the contextvar defaults off.
_MAY_START_ENGINE = ContextVar("computer_may_start_engine", default=False)
# shutil.which walks PATH on the event loop, and one status poll asks many times.
DOCKER_LOOKUP_S = 30.0
_docker_cli = None


def docker_cli():
    global _docker_cli
    now = time.monotonic()
    if _docker_cli is None or now - _docker_cli[0] >= DOCKER_LOOKUP_S:
        from .desktop_host import DockerDesktop
        _docker_cli = (now, str(DockerDesktop().cli() or "docker"))
    return _docker_cli[1]


@contextmanager
def engine_start_allowed():
    """A member's own tool call that needs its computer may start Docker Desktop on this PC while it prepares it."""
    token = _MAY_START_ENGINE.set(True)
    try:
        yield
    finally:
        _MAY_START_ENGINE.reset(token)


class VmError(Exception):
    """Public failure kind; never contains command output or workspace contents."""


@dataclass
class Result:
    code: int
    stdout: str = ""
    stderr: str = ""
    truncated: bool = False


class Docker:
    def __init__(self, alias=""):
        self.alias = alias
        self.argv([])  # Validate before any subprocess can be constructed.

    def argv(self, args):
        if not isinstance(self.alias, str) or self.alias and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", self.alias):
            raise ValueError("Computer host must be a simple SSH config alias")
        return [docker_cli(), *(["--host", f"ssh://{self.alias}"] if self.alias else []), *args]

    async def __call__(self, args, *, timeout=15, limit=MAX_OUTPUT, progress=None, input=None):
        """`input`, when given, is written to the command's stdin and closed (`docker exec -i`): a file's text travels
        there, never on the command line, which Windows holds to 32,767 characters."""
        from .desktop_host import NO_WINDOW
        process = await asyncio.create_subprocess_exec(
            *self.argv(args), stdin=asyncio.subprocess.DEVNULL if input is None else asyncio.subprocess.PIPE,
            creationflags=NO_WINDOW, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )

        async def feed():
            if input is None:
                return
            try:
                process.stdin.write(input)
                await process.stdin.drain()
            except (BrokenPipeError, ConnectionResetError):
                pass  # The command ended without reading all of it; its exit code says why.
            finally:
                process.stdin.close()

        async def drain(stream):
            kept, size = bytearray(), 0
            pending = b""
            while chunk := await stream.read(65536):
                size += len(chunk)
                kept.extend(chunk[:max(0, limit * 4 - len(kept))])
                if progress:
                    lines = (pending + chunk).replace(b"\r", b"\n").split(b"\n")
                    pending = lines.pop()[-2048:]
                    for line in lines:
                        if line.strip():
                            progress(line.decode("utf-8", errors="replace"))
            if progress and pending.strip():
                progress(pending.decode("utf-8", errors="replace"))
            text = kept.decode("utf-8", errors="replace")
            return text[:limit], size > len(kept) or len(text) > limit

        try:
            async with asyncio.timeout(timeout):
                out, err, _ = await asyncio.gather(drain(process.stdout), drain(process.stderr), feed())
                await process.wait()
            return Result(process.returncode, out[0], err[0], out[1] or err[1])
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()


@dataclass(frozen=True)
class Target:
    key: str
    name: str
    workspace: Path | PurePosixPath
    shared: Path | PurePosixPath | None = None
    remote: str = ""
    screen: int = 1
    screens: int = 1
    container: str = ""

    @property
    def unit(self):
        return self.container or self.key

    @property
    def state_key(self):
        return (self.remote, self.unit) if self.container and self.remote else self.unit

    @property
    def physical(self):
        return replace(self, key=self.unit, screen=1) if self.container else self

    def __post_init__(self):
        if (type(self.screen) is not int or type(self.screens) is not int
                or not (0 if self.container else 1) <= self.screen <= self.screens <= 6 or self.screens < 1):
            raise ValueError("Screens must be integers with 1 <= screen <= screens <= 6")


def resources(target):
    """Memory GiB and CPUs for the captured computer kind."""
    return (6, 4) if target.container == "shared" else (MEMORY_GB, 2)


def mount_arg(path, destination=GUEST, *, remote=False):
    stream = io.StringIO(newline="")
    csv.writer(stream, lineterminator="").writerow(["type=volume" if remote else "type=bind", f"source={path}", f"target={destination}"])
    return stream.getvalue()


def timezone_name(tz):
    try:
        return ZoneInfo(tz).key
    except (TypeError, ValueError, ZoneInfoNotFoundError):
        return "UTC"


def screen_grid(count, width=1280, height=900):
    # Kept equal to the standalone image helper by test_host_and_guest_grids_match.
    count = max(1, min(6, count))
    columns = math.ceil(math.sqrt(count))
    rows = math.ceil(count / columns)
    return ([(i % columns * width, i // columns * height, width, height) for i in range(count)],
            (columns * width, rows * height))


def run_args(target, owner, password, *, tz=None):
    zone = timezone_name(tz)
    memory, cpus = resources(target)
    _, canvas = screen_grid(target.screens)
    args = ["run", "-d", "--name", target.name, "--hostname", target.name]
    for key, value in {**IMAGE_LABELS, f"{LABEL}.owner": owner, f"{LABEL}.target": target.unit}.items():
        args += ["--label", f"{key}={value}"]
    return args + [
        "--restart", "no", "--memory", f"{memory}g", "--memory-swap", f"{memory}g", "--cpus", str(cpus),
        "--pids-limit", "4096", "--ipc", "private", "--cgroupns", "private",
        "--cap-drop", "ALL", "--cap-add", "SETUID", "--cap-add", "SETGID", "--shm-size", "512m",
        "--mount", mount_arg(target.workspace, remote=bool(target.remote)),
        *(["--mount", mount_arg(target.shared, SHARED, remote=bool(target.remote))] if target.shared else []),
        "-e", f"VNC_PW={password}",
        "-e", f"TZ={zone}",
        "-e", f"RAPHAEL_SCREENS={target.screens}",
        "-e", f"VNC_RESOLUTION={canvas[0]}x{canvas[1]}",
        "-p", "127.0.0.1::6901", IMAGE,
    ]


def exec_args(target, command, *, interactive=False, detached=False):
    return ["exec", *(["-i"] if interactive else []), *(["-d"] if detached else []), "-u", "cua", "-e", "HOME=/home/cua",
            "-e", "DISPLAY=:1", "-e", "CUA_DRIVER_INSTALL_CHANNEL=python_package",
            "-e", "CUA_DRIVER_RS_TELEMETRY_ENABLED=0", target.name, *command]


def move_window_args(target, window_id):
    from .seat_view import rectangle
    x, y, _, _ = rectangle(target.screen, target.screens)
    if type(window_id) is not int or window_id <= 0:
        raise ValueError("Expected a positive window id")
    return exec_args(target, ["wmctrl", "-i", "-r", str(window_id), "-e", f"0,{x + 20},{y + 20},-1,-1"])


def healthy(raw):
    try:
        report = json.loads(raw)
        return (report.get("schema_version") == "1" and report.get("overall") in ("ok", "degraded")
                and isinstance(report.get("checks"), list))
    except (ValueError, AttributeError):
        return False


def compatible(raw, target, owner, image_id):
    """Reject stale or foreign containers rather than repairing or replacing them."""
    try:
        config, host = raw["Config"], raw["HostConfig"]
        labels = config.get("Labels") or {}
        memory, cpus = resources(target)
        expected = {**IMAGE_LABELS, f"{LABEL}.owner": owner, f"{LABEL}.target": target.unit}
        mounts = raw["Mounts"]
        configured_mounts = host.get("Mounts", mounts)
        ports = host.get("PortBindings", {})
        caps = lambda values: {v.upper().removeprefix("CAP_") for v in values or []}
        return (
            all(labels.get(k) == v for k, v in expected.items()) and raw["Image"] == image_id
            and [entry for entry in config.get("Env", []) if entry.startswith("RAPHAEL_SCREENS=")] == [f"RAPHAEL_SCREENS={target.screens}"]
            and host.get("Privileged") is False and caps(host.get("CapDrop")) == {"ALL"}
            and caps(host.get("CapAdd")) == {"SETUID", "SETGID"}
            and host.get("IpcMode") == "private" and host.get("CgroupnsMode") == "private"
            and not any(host.get(k) for k in ("PidMode", "UTSMode", "UsernsMode", "Devices", "DeviceRequests", "AutoRemove"))
            and host.get("NetworkMode") not in ("host", "none")
            and not any("unconfined" in x or "disable" in x for x in host.get("SecurityOpt") or [])
            and host.get("RestartPolicy", {}).get("Name", "no") in ("", "no")
            and host.get("Memory") == memory * 1024**3 and host.get("MemorySwap") == memory * 1024**3
            and host.get("NanoCpus") == cpus * 1_000_000_000 and host.get("PidsLimit") == 4096
            and host.get("ShmSize") == 512 * 1024**2
            and mounts_match(mounts, configured_mounts, target)
            and (
                set(ports) == {"6901/tcp"} and len(ports["6901/tcp"]) == 1
                and ports["6901/tcp"][0]["HostIp"] == "127.0.0.1")
        )
    except (KeyError, TypeError, AttributeError):
        return False


def mounts_match(mounts, configured, target):
    expected = {GUEST: target.workspace, **({SHARED: target.shared} if target.shared else {})}
    if len(mounts) != len(expected) or len(configured) != len(expected):
        return False
    for destination, source in expected.items():
        actual = next((m for m in mounts if m.get("Destination") == destination), {})
        request = next((m for m in configured if m.get("Target", m.get("Destination")) == destination), {})
        kind = "volume" if target.remote else "bind"
        if actual.get("Type") != kind or actual.get("RW") is not True or request.get("Type") != kind or request.get("ReadOnly"):
            return False
        if target.remote:
            if actual.get("Name") != str(source) or request.get("Source", actual.get("Name")) != str(source):
                return False
        elif Path(request.get("Source", "")).resolve() != source.resolve():
            return False
    return True


def known_previous(raw, target, owner):
    """Recognize released shapes with all other guards intact."""
    import copy
    try:
        previous = copy.deepcopy(raw)
        config, host = previous["Config"], previous["HostConfig"]
        labels, env = config.get("Labels") or {}, config.get("Env") or []
        layer = labels.get(f"{LABEL}.layer")
        shared_upgrade = target.container == "shared" and target.screens == 6
        screens = [entry for entry in env if entry.startswith("RAPHAEL_SCREENS=")]
        # Layer 7 is the one the computer every member shares was released on (2026-11-12): six screens, and the
        # owner's own computer the day layer 8 came; layers 8 to 11 kept that shape. A layer that is not named here is
        # refused as incompatible, and its computer does not start: each new layer adds the one before it.
        six = shared_upgrade and layer in ("5", "7", "8", "9", "10", "11") and screens == ["RAPHAEL_SCREENS=6"]
        memory = 6 if six else {"3": 2, "4": 3, "5": 3, "6": 3, "7": 3, "8": 3, "9": 3, "10": 3, "11": 3}.get(layer)
        # Layer 5 was the first to say its screen count; the two before it had no such entry.
        if ((target.screens != 1 and not shared_upgrade) or memory is None
                or screens != ([f"RAPHAEL_SCREENS={6 if six else 1}"] if layer in ("5", "6", "7", "8", "9", "10", "11") else [])
                or host.get("NanoCpus") != (4 if six else 2) * 1_000_000_000
                or host.get("Memory") != memory * 1024**3 or host.get("MemorySwap") != memory * 1024**3):
            return False
        labels[f"{LABEL}.layer"] = IMAGE_LABELS[f"{LABEL}.layer"]
        memory, cpus = resources(target)
        host.update(Memory=memory * 1024**3, MemorySwap=memory * 1024**3, NanoCpus=cpus * 1_000_000_000)
        config["Env"] = [entry for entry in env if not entry.startswith("RAPHAEL_SCREENS=")] + [f"RAPHAEL_SCREENS={target.screens}"]
        return compatible(previous, target, owner, raw["Image"])
    except (KeyError, TypeError, AttributeError):
        return False


class LocalVm:
    def __init__(self, data_dir, *, settings=None, runner=None, clock=time.monotonic, enabled=True, conn=None):
        self.root = Path(data_dir).resolve()
        self.owner = hashlib.sha256(os.path.normcase(str(self.root)).encode()).hexdigest()[:16]
        self.enabled = enabled
        self.settings, self.run, self.clock = settings, runner or Docker(), clock
        self.last_activity, self.active, self.held = {}, {}, set()
        self.held_since = {}  # target key -> when the screen was last taken (what a blocked member is told)
        self.locks, self.targets = {}, {}
        self.task = None
        self.busy = lambda key: False
        self.native_busy = lambda target: False
        self.input_busy = lambda target: bool(self.active.get(target.key))
        self.timezone = lambda: None
        self.timezone_pending = False
        from .desktop_host import DockerDesktop
        # Injected Docker runners never launch a real host application in tests.
        self._desktop = DockerDesktop() if runner is None else None
        self.capacity_lock = asyncio.Lock()
        self.tunnels = {}
        self.preparation, self.preparing = {}, {}
        self.wallpaper_attempted = {}  # (host, computer) -> the picture its watcher was started with
        # Raised whenever this core starts or stops a computer, so a remembered state is never trusted across it.
        self.changes = 0
        self.status_engines = {}
        self.running = {}
        self._installed = None
        self.engine_lock, self.build_lock = asyncio.Lock(), asyncio.Lock()
        from .takeover import ComputerWork
        self.work = ComputerWork(self)
        self.remote_sessions = {}
        self.real_transport = runner is None
        self.rebuild_notice = lambda target: None
        self.engine_notice = lambda target: None
        # Called when a computer that was asleep (or never made) has been started. `woken` keeps who woke the
        # running computer and why, until it sleeps again: a member's own tool call does (VmTools sets both), and
        # any start the owner asked for (a press, maintenance) leaves it empty. Looking never starts one.
        self.wake_notice = lambda target: None
        self.woken = {}
        self.maintenance, self.lifecycle = {}, {}
        self.disk_checked, self.disk_warned = {}, set()
        async def disconnect_driver(key):
            pass
        self.disconnect_driver = disconnect_driver
        self.repair_admit = lambda target: True
        self.repair_revisions = {}
        # The computers made here and the ones a deleted member leaves behind (removals.py).
        from .removals import ComputerData
        self.data = ComputerData(self, conn)
        from .seats import ComputerSeats
        self.seats = ComputerSeats(conn)
        self.seat_lock = asyncio.Lock()
        self.carry_lock, self.carry_attempted, self.carry_tasks, self.carry_lost = asyncio.Lock(), set(), {}, set()
        self.physical_active, self.held_targets, self.lease_targets = {}, {}, {}
        async def close_seat_viewers(target):
            pass
        self.close_seat_viewers = close_seat_viewers

    def unit_targets(self, target):
        seats = [self.shared_target(target.remote, member, number)
                 for number, member in self.seats.holders(target.remote).items()] if target.container else []
        return {other.key: other for other in [target, *self.targets.values(), *seats]
                if (other.remote, other.name) == (target.remote, target.name)}.values()

    def carry_busy(self, target):
        """Historical homes share seat keys, but only work on that physical computer protects its browser."""
        current = self.targets.get(target.key)
        if current is None or not current.container:
            return bool(self.unit_active(target) or self.unit_held(target) or self.unit_busy(target))
        return bool(self.physical_active.get(target.physical)
                    or self.held_targets.get(target.key) == target
                    or self.lease_targets.get(target.key) == target and self.busy(target.key))

    def unit_active(self, target, *, excluding=None):
        return sum(self.active.get(other.key, 0) for other in self.unit_targets(target) if other.key != excluding)

    def unit_held(self, target):
        return any(other.key in self.held for other in self.unit_targets(target))

    def unit_busy(self, target, *, excluding=None):
        return any(self.busy(other.key) for other in self.unit_targets(target) if other.key != excluding)

    def units(self):
        return {(target.remote, target.name): target for target in self.targets.values()}.values()

    async def disconnect_unit(self, target):
        for other in self.unit_targets(target):
            await self.disconnect_driver(other.key)

    # The desktop's own windows: a panel on each screen and ONE desktop window across the whole canvas (measured on
    # six screens: `xfdesktop.Xfdesktop`, 3840x1800 at 0,0). They are nobody's, are never closed, and a screen that
    # holds only these is empty; counting the desktop window would leave every screen occupied for ever.
    DESKTOP_WINDOWS = ("xfce4-panel", "xfdesktop")
    # Every list and every close is a command through the container boundary (measured on a Windows host: a list is
    # two of them), so the bound covers a screen full of windows; a list that never answers still ends here.
    seat_clean_seconds = 8

    async def close_displaced_seat_windows(self, target):
        """Gently close touching windows, then prove the screen empty within a bounded time."""
        from .seat_view import holder as screen_of, overlaps
        holder = self.seats.holders(target.remote).get(target.screen)

        def neighbours(window):
            # A window that belongs (by its centre) to another screen someone holds now is that member's own, not
            # a leftover. A browser's frame can reach a few pixels past its screen's edge (measured: 1312x893 at
            # -16,-10): closing it because a colleague sat down beside it would end that member's pages.
            owner = screen_of(window["bounds"], target.screens)
            return owner not in (None, target.screen) and owner in self.seats.holders(target.remote)
        async def clean():
            raw = await self.inspect(target)
            if raw is None or raw.get("State", {}).get("Running") is False:
                return True
            for attempt in range(10):
                found = await self.seat_windows(target)
                touching = [window for window in found["windows"]
                            if window.get("app_name", "").lower() not in self.DESKTOP_WINDOWS
                            and overlaps(window["bounds"], target.screen, target.screens) and not neighbours(window)]
                if self.seats.holders(target.remote).get(target.screen) != holder:
                    return False
                if not touching:
                    return True
                if attempt == 0:
                    for window in touching:
                        if self.seats.holders(target.remote).get(target.screen) != holder:
                            return False
                        if not window.get("app_name"):
                            continue
                        try:
                            await self.run_for(target, exec_args(target, ["wmctrl", "-i", "-c", str(window["window_id"])]))
                        except Exception:
                            pass
                await asyncio.sleep(.05)
            return False
        try:
            return await asyncio.wait_for(clean(), self.seat_clean_seconds)
        except Exception:
            return False

    async def seat_windows(self, target):
        # The displaced session is already closed. Keep cleanup on the injected Docker boundary.
        from .seat_view import wmctrl_windows
        geometry = await self.run_for(target, exec_args(target, ["wmctrl", "-lG"]))
        classes = await self.run_for(target, exec_args(target, ["wmctrl", "-lx"]))
        if geometry.code or classes.code or geometry.truncated or classes.truncated:
            raise VmError("window_list_unavailable")
        return wmctrl_windows(geometry.stdout, classes.stdout)

    async def window_bounds(self, target):
        """Where every window is, in one command: all it takes to tell whose screen a window touches.

        A full list is two commands (about half a second on a Windows host, measured); this is asked before and
        after every picture while a seat's private page stands, so it asks for no more than it needs.
        """
        from .seat_view import wmctrl_windows
        geometry = await self.run_for(target, exec_args(target, ["wmctrl", "-lG"]))
        if geometry.code or geometry.truncated:
            raise VmError("window_list_unavailable")
        return wmctrl_windows(geometry.stdout, "")

    async def move_window(self, target, window_id):
        result = await self.run_for(target, move_window_args(target, window_id))
        if result.code:
            raise VmError("window_move_failed")

    async def restore_window(self, target, window_id):
        """Bring a minimized window back to its screen (owner, 2026-11-14: he minimized his member's browser, and the member
        went on working in it where nobody could see)."""
        if type(window_id) is not int or window_id <= 0:
            raise ValueError("Expected a positive window id")
        result = await self.run_for(target, exec_args(target, ["wmctrl", "-i", "-a", str(window_id)]))
        if result.code:
            raise VmError("window_restore_failed")

    # Each command reads the browser's own list once and is ended by its own bounds (ten seconds a step); this is only the outer one.
    browser_tabs_s = 45

    async def browser_tabs(self, target, command, window_id, *args):
        """The image's raphael-browser-tabs on one X window of the computer's own browser: what it answers, or VmError."""
        if command not in ("list", "new", "show") or type(window_id) is not int or window_id <= 0:
            raise ValueError("Expected list, new or show and a positive window id")
        result = await self.run_for(target, exec_args(target, ["raphael-browser-tabs", command, str(window_id), *map(str, args)]),
                                    timeout=self.browser_tabs_s)
        try:
            answer = json.loads(result.stdout) if not result.code and not result.truncated else None
        except ValueError:
            answer = None
        if not isinstance(answer, dict):
            logger.info("raphael-browser-tabs %s failed: %s", command, (result.stderr or "").strip()[-300:])
            raise VmError("browser_tabs_failed")
        return answer

    async def fit_window(self, target, window):
        from .seat_view import rectangle
        x, y, width, height = rectangle(target.screen, target.screens)
        bounds = window["bounds"]
        wide, high = min(bounds["width"], width - 40), min(bounds["height"], height - 40)
        left = max(x + 20, min(bounds["x"], x + width - wide - 20))
        top = max(y + 20, min(bounds["y"], y + height - high - 20))
        identifier = str(window["window_id"])
        for command in (["wmctrl", "-i", "-r", identifier, "-b", "remove,maximized_vert,maximized_horz"],
                        ["wmctrl", "-i", "-r", identifier, "-e", f"0,{left},{top},{wide},{high}"]):
            result = await self.run_for(target, exec_args(target, command))
            if result.code:
                raise VmError("window_move_failed")

    # The launcher script ends itself: 60 s for the browser's first window (a loaded PC took 13 to 41 s, 2026-11-13) and
    # 30 s for the window to settle on its screen. This is only the outer bound, so that the script's own answer comes first.
    seat_browser_s = 120

    async def seat_browser(self, target):
        from .seat_view import rectangle
        from .carry import before_browser
        await before_browser(self, target)
        result = await self.run_for(target, exec_args(target, ["raphael-seat-browser",
            *map(str, rectangle(target.screen, target.screens))]), timeout=self.seat_browser_s)
        match = re.fullmatch(r"pid=([1-9][0-9]*) window_id=([1-9][0-9]*)", result.stdout.strip())
        if result.code or result.truncated or not match:
            raise VmError("browser_window_missing")
        return dict(zip(("pid", "window_id"), map(int, match.groups())))

    async def release_member_seats(self, member):
        async with self.seat_lock:
            for host, identifier in list(self.seats.rows):
                if identifier == member:
                    target = self.shared_target(host, member, self.seats.seat(host, member))
                    await self.disconnect_driver(target.key)
                    await self.close_seat_viewers(target)
                    await self.close_displaced_seat_windows(target)
                    self.seats.release(host, member)
                    self.targets.pop(target.key, None)

    def record_repair(self, target):
        # Counted, never announced: a connection that repaired itself says nothing, to the owner or in a member's progress.
        self.repair_revisions[target.state_key] = self.repair_revisions.get(target.state_key, 0) + 1

    @property
    def remote(self):
        return self.settings.get("computer_ssh_alias") if self.settings else ""

    @property
    def desktop(self):
        return None if self.remote else self._desktop

    @desktop.setter
    def desktop(self, value):
        self._desktop = value

    def command(self, target, args):
        return Docker(target.remote).argv(args)

    async def transport(self, target):
        if not target.remote:
            return []
        if self.real_transport:
            from .remote_host import RemoteSession
            session = self.remote_sessions.setdefault(target.remote, RemoteSession(target.remote))
            endpoint = await session.endpoint()
            if endpoint:
                return ["--host", endpoint]
        return ["--host", f"ssh://{target.remote}"]

    async def bridge_command(self, target, args):
        return [docker_cli(), *await self.transport(target), *args]

    async def run_for(self, target, args, **kwargs):
        # Preserve the injected runtime boundary; every Docker path shares this transport.
        transport = await self.transport(target)
        return await self.run([*transport, *args], **kwargs)

    async def installed(self):
        if not self.enabled or self.remote:
            return self.enabled
        if not self.desktop:
            return await self.available()
        now = time.monotonic()
        if self._installed is None or now - self._installed[0] >= DOCKER_LOOKUP_S:
            self._installed = (now, self.desktop.installed())
        return self._installed[1]

    def _progress(self, target, state, text=""):
        # Only fixed-image pull/build output is passed here, never exec output.
        self.preparation[target.state_key] = {"state": state, "ready": False,
                                        "progress": " ".join(text.split())[:180]}

    async def ensure_engine(self, target, *, start_desktop=False):
        if not self.enabled:
            raise VmError("absent")
        async with self.engine_lock:
            if await self.available(target):
                return
            if target.remote:
                raise VmError("remote_unavailable")
            if not await self.installed():
                raise VmError("absent")
            if not start_desktop:
                raise VmError("docker_stopped")
            self._progress(target, "starting")
            began = time.monotonic()
            logger.info("Docker Desktop is not running; launching it for a computer")
            self.engine_notice(target)
            try:
                await self.desktop.start()
            except (OSError, AttributeError) as error:
                logger.warning("Docker Desktop could not be launched (%s) after %.1f s", type(error).__name__, time.monotonic() - began)
                raise VmError("docker_start_failed") from None
            try:
                async with asyncio.timeout(ENGINE_WAIT_S):
                    while not await self.available(target):
                        await asyncio.sleep(ENGINE_POLL_S)
            except TimeoutError:
                logger.warning("Docker Desktop did not answer after %.1f s", time.monotonic() - began)
                raise VmError("docker_start_timeout") from None
            logger.info("Docker Desktop answered %.1f s after it was launched", time.monotonic() - began)

    def launch(self, target):
        """Viewer opens immediately; preparation belongs to the shared VM lifecycle."""
        if target.state_key not in self.preparing or self.preparing[target.state_key].done():
            self._progress(target, "preparing")

            async def prepare():
                try:
                    await self.start(target)
                except (VmError, OSError, TimeoutError) as error:
                    self.preparation[target.state_key] = {"state": "unavailable", "ready": False,
                        "error": str(error) if isinstance(error, VmError) else "start_failed"}

            self.preparing[target.state_key] = asyncio.create_task(prepare())

    def key_for(self, host, member_id):
        """The key a member's own computer on `host` ("" is this PC) is named by."""
        return hashlib.sha256((host + ":" + str(member_id) if host else str(member_id)).encode()).hexdigest()[:16]

    def target_for(self, host, key):
        name = f"raphael-computer-{self.owner}-{key}"
        return Target(key, name,
                      PurePosixPath(name + "-workspace") if host else self.root / "vm-homes" / key,
                      PurePosixPath(f"raphael-computer-{self.owner}-team") if host else self.root / "vm-shared",
                      host)

    @property
    def mode(self):
        """One computer for every member is the default where it has been run on real computers: this PC's Docker.
        On another host the members keep a computer each until the owner's data says otherwise: seats, the six
        screens and the carry-over have never run on a real remote host (2026-11-12). A saved choice always wins."""
        if self.settings is None:
            return "per-bot"
        chosen = getattr(self.settings, "chosen", None)
        if self.remote and chosen is not None and not chosen("computer_vm_mode"):
            return "per-bot"
        return self.settings.get("computer_vm_mode")

    def target(self, member_id=0):
        target = (self.shared_target(self.remote, member_id, self.seats.seat(self.remote, member_id) or 0)
                  if self.mode == "shared" else self.target_for(self.remote, self.key_for(self.remote, member_id)))
        self.targets[target.key] = target
        return target

    def shared_target(self, host, member, screen):
        return replace(self.target_for(host, "shared"), key=self.key_for(host, member),
                       container="shared", screen=screen, screens=6)

    async def seat(self, member_id=0):
        target = self.target(member_id)
        if not target.container:
            return target
        from .seats import SeatsFull
        async with self.seat_lock:
            def busy(member):
                key = self.key_for(target.remote, member)
                return bool(self.active.get(key) or key in self.held or self.busy(key))
            previous = {member: self.shared_target(target.remote, member, number)
                        for number, member in self.seats.holders(target.remote).items()}
            try:
                number, displaced = self.seats.candidate(target.remote, member_id, busy=busy)
            except SeatsFull:
                raise VmError("seats_full") from None
            if displaced is not None:
                old = previous[displaced]
                last_used = self.seats.rows[target.remote, displaced][1]
                # Revoke the old route before yielding; publish the new holder only after cleanup.
                self.seats.release(target.remote, displaced)
                try:
                    await self.disconnect_driver(old.key)
                    await self.close_seat_viewers(old)
                    if not await self.close_displaced_seat_windows(old):
                        raise VmError("seats_full")
                    self.seats.restore(target.remote, member_id, number)
                except BaseException:
                    # A cancelled/failed transition must not expose an uncleaned free screen.
                    try:
                        self.seats.restore(target.remote, displaced, number, last_used)
                    except Exception as error:
                        raise VmError("seat_restore_failed") from error
                    raise
                self.targets.pop(old.key, None)
            else:
                if self.seats.seat(target.remote, member_id) is not None:
                    self.seats.touch(target.remote, member_id)
                else:
                    occupied = self.seats.holders(target.remote)
                    for free in range(1, self.seats.count + 1):
                        if free not in occupied and await self.close_displaced_seat_windows(
                                self.shared_target(target.remote, member_id, free)):
                            self.seats.restore(target.remote, member_id, free)
                            break
                    else:
                        raise VmError("seats_full")
            return self.target(member_id)

    async def available(self, target=None):
        up = await self._answers(target)
        # The one place that learns an engine came up or went away: what a deleted member's computer is owed waits for it.
        (self.data.engine_up if up else self.data.engine_down)(getattr(target, "remote", "") if target else self.remote)
        return up

    async def _answers(self, target):
        if not self.enabled:
            return False
        try:
            target = target or self.target()
            if self.real_transport and not target.remote:
                from .desktop_host import engine_pipe_missing
                if engine_pipe_missing():
                    return False
            result = await self.run_for(target, ["info", "--format", "{{.OSType}}"], timeout=5)
            return result.code == 0 and result.stdout.strip() == "linux"
        except (OSError, TimeoutError):
            return False

    async def image(self, target=None):
        result = await self.run_for(target or self.target(), ["image", "inspect", IMAGE], limit=100_000)
        if result.code:
            return None
        try:
            raw = json.loads(result.stdout)[0]
            if all(raw["Config"]["Labels"].get(k) == v for k, v in IMAGE_LABELS.items()):
                return raw["Id"]
        except (ValueError, KeyError, IndexError, TypeError):
            pass
        raise VmError("incompatible_image")

    async def inspect(self, target):
        result = await self.run_for(target, ["container", "inspect", target.name], limit=200_000)
        if result.code:
            # An unavailable engine is not evidence that a container does not exist.
            if not await self.available(target):
                raise VmError("unavailable")
            return None
        try:
            return json.loads(result.stdout)[0]
        except (ValueError, IndexError, TypeError):
            raise VmError("invalid_status") from None

    async def status(self, target, *, probe=True):
        try:
            return await self._status(target, probe=probe)
        except (VmError, OSError, TimeoutError):
            self.invalidate(target)
            raise

    async def _status(self, target, *, probe=True):
        if not self.enabled:
            self.invalidate(target)
            return {"state": "unavailable", "ready": False}
        now, changes = self.clock(), self.changes
        kept = self.status_engines.get(target.remote)
        if probe or not kept or kept[2] != changes or not 0 <= now - kept[0] < 60:
            if not await self.available(target):
                self.invalidate(target)
                return {"state": "unavailable", "ready": False,
                        "error": "remote_unavailable" if target.remote else "docker_stopped" if await self.installed() else "docker_missing"}
            image_id = await self.image(target)
            self.status_engines[target.remote] = (now, image_id, changes)
        else:
            image_id = kept[1]
        try:
            raw = await self.inspect(target)
        except (VmError, OSError, TimeoutError):
            self.invalidate(target)
            raise
        if raw is None:
            # A failed inspect can mean the engine or image changed outside Raphael.
            self.invalidate(target)
            image_id = await self.image(target)
            return {"state": "missing", "image": bool(image_id), "ready": False}
        if not image_id or not compatible(raw, target, self.owner, image_id):
            self.invalidate(target)
            return {"state": "incompatible", "ready": False}
        running = raw.get("State", {}).get("Running") is True
        ready = False
        screens_pending = False
        if running and probe:
            version = await self.run_for(target, exec_args(target, ["sh", "-c", 'mark=$1; shift; "$@" || exit $?; test -f "$mark" || exit 42', "sh", SCREENS_READY, DRIVER, "--version"]))
            health = await self.run_for(target, exec_args(target, [DRIVER, "call", "health_report", "{}", "--socket", SOCKET]))
            driver_ready = health.code == 0 and version.stdout.strip() == f"cua-driver {VERSION}" and healthy(health.stdout)
            ready = version.code == 0 and driver_ready
            screens_pending = version.code == 42 and driver_ready
        if not running or probe and not ready:
            self.invalidate(target)
        bindings = raw.get("NetworkSettings", {}).get("Ports", {}).get("6901/tcp") or []
        port = next((int(p["HostPort"]) for p in bindings if p.get("HostIp") == "127.0.0.1" and str(p.get("HostPort", "")).isdigit()), None)
        url = f"http://127.0.0.1:{port}/vnc.html#autoconnect=true&resize=scale&view_only=true&path=websockify?token=screen-{target.screen}" if port and not target.remote and target.screen else ""
        return {"state": "running" if running else "stopped", "ready": ready, "viewer_url": url,
                **({"screens_pending": True} if screens_pending else {})}

    async def viewer_connection(self, target):
        try:
            return await self._viewer_connection(target)
        except VmError as error:
            if str(error) not in ("viewer_tunnel_failed", "viewer_unreachable"):
                raise
            if not self.repair_admit(target):
                raise VmError("viewer_unreachable") from None
            await self.close_viewer(target)
            result = await self._viewer_connection(target)
            self.record_repair(target)
            return result

    async def _viewer_connection(self, target):
        """Core-only credentials, never a public status, URL or diagnostic."""
        if not await self.available(target):
            raise VmError("unavailable")
        image_id = await self.image(target)
        raw = await self.inspect(target)
        if not image_id or not compatible(raw, target, self.owner, image_id) or raw.get("State", {}).get("Running") is not True:
            raise VmError("unavailable")
        bindings = raw.get("NetworkSettings", {}).get("Ports", {}).get("6901/tcp") or []
        port = next((int(p["HostPort"]) for p in bindings if p.get("HostIp") == "127.0.0.1" and str(p.get("HostPort", "")).isdigit()), None)
        if target.remote:
            from .ssh_tunnel import Tunnel, verify_viewer
            if port is None:
                raise VmError("viewer_unreachable")
            from .remote_host import SharedViewerTunnel
            shared = self.remote_sessions.get(target.remote)
            use_shared = shared and await shared.endpoint()
            tunnel = self.tunnels.setdefault((target.remote, target.name), SharedViewerTunnel(shared) if use_shared else Tunnel())
            try:
                port = await tunnel.open(target.remote, "127.0.0.1", port)
                await verify_viewer(port)
            except (OSError, ValueError, TimeoutError, httpx.HTTPError):
                await self.close_viewer(target)
                raise VmError("viewer_unreachable") from None
        if port is None or not 0 < port < 65536:
            raise VmError("unavailable")
        password = next((x[7:] for x in raw["Config"].get("Env", []) if x.startswith("VNC_PW=")), "")
        return port, password

    async def build(self, target=None, *, progress=None):
        target = target or self.target()
        if not await self.available(target):
            raise VmError("unavailable")
        result = await self.run_for(target, ["pull", BASE], timeout=1800, **({"progress": progress} if progress else {}))
        if result.code:
            raise VmError("pull_failed")
        context = Path(__file__).parent / "image"
        result = await self.run_for(target, ["build", "--progress=plain", "--tag", IMAGE, str(context)], timeout=1800,
                                **({"progress": progress} if progress else {}))
        if result.code or not await self.image(target):
            raise VmError("build_failed")

    async def start(self, target):
        self.validate_storage(target)
        if target.state_key in self.maintenance and self.maintenance[target.state_key] is not asyncio.current_task():
            raise VmError("busy")
        if (state := self._recent_start(target)) is not None:
            return state
        if target.remote:
            return await self._confirmed_start(target)
        # Capacity always precedes target locks: eviction may need another target's lock.
        async with self.capacity_lock:
            return await self._confirmed_start(target)

    def full_permission(self):
        """全部允許 is on: the owner's standing yes (only a checkpoint restore asks for it)."""
        return self.settings is not None and self.settings.get("action_mode") == "bypass"

    def invalidate(self, target):
        self.running.pop(target.physical, None)
        self.status_engines.pop(target.remote, None)

    def validate_storage(self, target):
        if target.remote:
            return
        from ..paths import local_storage_root
        try:
            for path in (target.workspace, target.shared):
                if path is not None and not local_storage_root(path).is_relative_to(self.root):
                    raise ValueError("outside_workspace")
        except (ValueError, OSError):
            raise VmError("outside_workspace") from None

    def _start_signature(self):
        return self.changes, self.enabled, self.remote, self.timezone(), self.timezone_pending

    def _recent_start(self, target):
        kept = self.running.get(target.physical)
        if kept and kept[1] == self._start_signature() and 0 <= self.clock() - kept[0] < PREFLIGHT_S:
            return self.seat_status(target, kept[2])
        return None

    @staticmethod
    def seat_status(target, state):
        state = dict(state)
        if target.container and state.get("viewer_url"):
            state["viewer_url"] = re.sub(r"screen-\d+", f"screen-{target.screen}", state["viewer_url"]) if target.screen else ""
        return state

    async def _confirmed_start(self, target):
        async with self.locks.setdefault(target.state_key, asyncio.Lock()):
            if target.state_key in self.maintenance and self.maintenance[target.state_key] is not asyncio.current_task():
                raise VmError("busy")
            if (state := self._recent_start(target)) is not None:
                return state
            self.invalidate(target)
            state = await self._prepare_start(target)
            if state.get("ready"):
                self.running[target.physical] = self.clock(), self._start_signature(), dict(state)
            return state

    async def _prepare_start(self, target):
        self.changes += 1
        try:
            await self.ensure_engine(target, start_desktop=_MAY_START_ENGINE.get())
            async with self.build_lock:
                if not await self.image(target):
                    self._progress(target, "building")
                    await self.build(target, progress=lambda text: self._progress(target, "building", text))
            # Every computer tool call passes here: a running desktop is not being prepared.
            if (await self.status(target, probe=False))["state"] != "running":
                self._progress(target, "preparing")
            if not target.remote:
                await self._make_room(target)
            return await self._start(target)
        finally:
            self.preparation.pop(target.state_key, None)
            self.changes += 1

    async def _make_room(self, target):
        if target.remote or (await self.status(target, probe=False))["state"] == "running":
            return
        await self.recover()
        running = []
        protected = set()
        for other in list(self.units()):
            if other.remote or (other.remote, other.name) == (target.remote, target.name):
                continue
            state = (await self.status(other, probe=False))["state"]
            if state == "running":
                running.append(other)
            elif state == "incompatible":
                raw = await self.inspect(other)
                if (raw and raw.get("State", {}).get("Running") is True
                        and (raw.get("Config", {}).get("Labels") or {}).get(f"{LABEL}.owner") == self.owner):
                    # Old owned computers still consume capacity, but are never auto-repaired or stopped.
                    running.append(other)
                    protected.add(other.key)
        while len(running) >= LOCAL_LIMIT:
            if target.state_key in self.maintenance:
                raise VmError("local_capacity")  # Owner maintenance never evicts another computer.
            candidates = [other for other in running if other.key not in protected and not self.unit_active(other)
                          and not self.unit_held(other) and not self.unit_busy(other)]
            if not candidates:
                raise VmError("local_capacity")
            victim = min(candidates, key=lambda other: self.last_activity.get(other.state_key, 0))
            await self.stop(victim)
            running.remove(victim)

    async def _start(self, target):
        self.validate_storage(target)
        state = await self.status(target, probe=False)
        if state["state"] == "incompatible":
            state = await self._upgrade_image(target)
        if state["state"] in ("unavailable", "incompatible"):
            raise VmError(state["state"])
        zone = timezone_name(self.timezone())
        state = await self._reconcile_timezone(target, state, zone)
        already_running = state["state"] == "running"
        if state["state"] != "running":
            self.carry_attempted.discard(target.physical)
            self.wallpaper_attempted.pop((target.remote, target.name), None)
        if state["state"] == "missing":
            if not state.get("image"):
                raise VmError("image_missing")
            if not target.remote:
                target.workspace.mkdir(parents=True, exist_ok=True, mode=0o700)
                target.shared.mkdir(parents=True, exist_ok=True, mode=0o700)
            self.validate_storage(target)
            self.data.made(target)  # before the engine makes it: a computer unrecorded could never be removed
            result = await self.run_for(target, run_args(target, self.owner, secrets.token_urlsafe(24), tz=zone), timeout=60)
        elif state["state"] == "stopped":
            result = await self.run_for(target, ["start", target.name], timeout=60)
            if not result.code and self.unit_active(target) and target.state_key not in self.maintenance:
                self.record_repair(target)
        else:
            result = Result(0)
        if result.code:
            raise VmError("start_failed")
        if not already_running:
            self.wake_notice(target)
        self.last_activity[target.state_key] = self.clock()
        repaired = False
        for attempt in range(45):
            state = await self.status(target)
            if state["ready"]:
                if target.remote:
                    layout = await self.run_for(target, exec_args(target, ["mkdir", "-p", "--", *[SHARED + "/" + name for name in ("context", "meetings", "projects")]]))
                    if layout.code:
                        raise VmError("team_layout_failed")
                else:
                    for name in ("context", "meetings", "projects"):
                        (target.shared / name).mkdir(parents=True, exist_ok=True, mode=0o700)
                await self._wallpaper(target)
                return state
            if not repaired and state["state"] == "running" and not self.unit_held(target) and self.unit_active(target) <= 1 and not self.unit_active(target, excluding=target.key) and not self.unit_busy(target, excluding=target.key):
                missing_socket = False
                if attempt == 0 and already_running:
                    socket = await self.run_for(target, exec_args(target, ["test", "-S", SOCKET]), timeout=5)
                    missing_socket = bool(socket.code)
                if (missing_socket or attempt >= 20 and state.get("screens_pending")) and self.repair_admit(target):
                    if (await self.run_for(target, ["restart", "--time", "10", target.name], timeout=60)).code:
                        raise VmError("start_failed")
                    repaired = True
                    self.record_repair(target)
                    # The restart ended the watcher with every other process of the computer.
                    self.wallpaper_attempted.pop((target.remote, target.name), None)
            await asyncio.sleep(1)
        raise VmError("health_timeout")

    async def _upgrade_image(self, target):
        import copy
        raw = await self.inspect(target)
        image_id = await self.image(target)
        # Only known image or remote binding upgrades on otherwise exactly compatible
        # owned computers may rebuild. Workspace volumes are never removed.
        previous = copy.deepcopy(raw) if raw else {}
        host = previous.get("HostConfig", {})
        legacy_remote = bool(target.remote and host.get("PortBindings") in (None, {}))
        if legacy_remote:
            host["PortBindings"] = {"6901/tcp": [{"HostIp": "127.0.0.1", "HostPort": ""}]}
        # `previous` carries the remote binding repair, so an old remote computer of a previous layer still upgrades.
        image_upgrade = known_previous(previous, target, self.owner) and (raw.get("Image") != image_id or target.container == "shared")
        if (not raw or not image_id or not (image_upgrade or legacy_remote and raw.get("Image") == image_id
                and compatible(previous, target, self.owner, raw.get("Image")))):
            raise VmError("incompatible")
        if self.unit_held(target) or (self.unit_active(target) > 1 or self.unit_active(target, excluding=target.key)) or self.unit_busy(target, excluding=target.key):
            raise VmError("busy")
        self.rebuild_notice(target)
        if raw.get("State", {}).get("Running") and (await self.run_for(target, ["stop", "--time", "10", target.name], timeout=30)).code:
            raise VmError("stop_failed")
        if (await self.run_for(target, ["rm", target.name])).code:
            raise VmError("remove_failed")
        self.invalidate(target)
        return {"state": "missing", "image": True}

    async def _wallpaper(self, target):
        """Put the desktop's picture up: once for each run of a computer, and again when the owner's picture changed.

        This is the one place a watcher is started. It ends the one before it, so the picture on the desktop is the
        one this start chose: a watcher that was merely left running kept the default picture over the owner's."""
        key = (target.remote, target.name)
        own = self.own_wallpaper()
        try:
            stat = own.stat() if own else None
        except OSError:
            own = stat = None
        picture = (stat.st_mtime_ns, stat.st_size) if stat else None
        if self.wallpaper_attempted.get(key, False) == picture:
            return
        self.wallpaper_attempted[key] = picture
        script = r'''command -v pgrep >/dev/null 2>&1 || exit 0
watcher='^/opt/venv/bin/python /opt/raphael-desktop/wallpaper[.]py( |$)'
attempt=0
while [ "$attempt" -lt 60 ]; do
    pid=$(pgrep -x xfce4-session | head -n 1)
    [ -n "$pid" ] && break
    sleep 1
    attempt=$((attempt + 1))
done
[ -n "$pid" ] || exit 0
address=$(tr '\000' '\n' < "/proc/$pid/environ" | sed -n 's/^DBUS_SESSION_BUS_ADDRESS=//p' | head -n 1)
[ -n "$address" ] || exit 0
pkill -f "$watcher" >/dev/null 2>&1
export DBUS_SESSION_BUS_ADDRESS="$address"
exec /opt/venv/bin/python /opt/raphael-desktop/wallpaper.py --watch'''
        try:
            # Decoration cannot delay a ready desktop or change a tool's result.
            async with asyncio.timeout(WALLPAPER_SETUP_S):
                for source, destination in ((WALLPAPER_FOLDER / "wallpaper.py", "wallpaper.py"), (WALLPAPER_FOLDER / "wallpapers", "")):
                    result = await self.run_for(target, ["cp", str(source), f"{target.name}:/opt/raphael-desktop/{destination}"], timeout=2)
                    if result.code:
                        return
                if own and (await self.run_for(target, ["cp", str(own), f"{target.name}:{GUEST_OWN_WALLPAPER}"], timeout=2)).code:
                    own = None
                script += f" --image {GUEST_OWN_WALLPAPER}\n" if own else "\n"
                await self.run_for(target, exec_args(target, ["sh", "-c", script], detached=True), timeout=2)
        except Exception:
            pass

    def own_wallpaper(self):
        """The owner's picture when it is a JPEG of a size worth carrying, else None."""
        path = self.root / OWN_WALLPAPER
        try:
            if path.stat().st_size > OWN_WALLPAPER_BYTES:
                return None
            with path.open("rb") as file:
                return path if file.read(3) == b"\xff\xd8\xff" else None
        except OSError:
            return None

    async def _reconcile_timezone(self, target, state, zone, *, keep_stopped=False):
        if state["state"] in ("running", "stopped") and self.timezone():
            raw = await self.inspect(target)
            if not compatible(raw, target, self.owner, await self.image(target)):
                raise VmError("incompatible")
            if f"TZ={zone}" not in raw["Config"].get("Env", []):
                if self.unit_held(target) or (self.unit_active(target) > 1 or self.unit_active(target, excluding=target.key)) or self.unit_busy(target, excluding=target.key) or self.unit_busy(target) and not self.unit_active(target):
                    raise VmError("owner_holds_control" if self.unit_held(target) else "busy")
                # Only status-validated, owned containers reach this path. Docker
                # cannot change their environment; the bind workspace survives.
                if state["state"] == "running" and (await self.run_for(target, ["stop", "--time", "10", target.name], timeout=30)).code:
                    raise VmError("stop_failed")
                if (await self.run_for(target, ["rm", target.name])).code:
                    raise VmError("remove_failed")
                if keep_stopped and state["state"] == "stopped":
                    args = run_args(target, self.owner, secrets.token_urlsafe(24), tz=zone)
                    args[:2] = ["create"]
                    if (await self.run_for(target, args, timeout=60)).code:
                        raise VmError("start_failed")
                    return state
                state = {"state": "missing", "image": True}
        return state

    async def refresh_timezone(self):
        """Reconcile desktops created before Home supplied the owner's zone."""
        self.timezone_pending = True
        self.running.clear()
        if not self.timezone() or not await self.available():
            return
        await self.recover()
        self.timezone_pending = False
        async with self.capacity_lock:
            for target in list(self.units()):
                async with self.locks.setdefault(target.state_key, asyncio.Lock()):
                    if self.unit_active(target) or self.unit_held(target) or self.unit_busy(target):
                        self.timezone_pending = True
                        continue  # The next tool start retries after the current work/hold.
                    try:
                        state = await self.status(target, probe=False)
                        if state["state"] == "running":
                            await self._start(target)
                        elif state["state"] == "stopped":
                            await self._reconcile_timezone(target, state, timezone_name(self.timezone()), keep_stopped=True)
                    except (VmError, OSError, TimeoutError):
                        self.timezone_pending = True
                        continue  # Home remains usable while Docker is unavailable.

    async def stop(self, target, *, remove=False, captured_image=None):
        async with self.locks.setdefault(target.state_key, asyncio.Lock()):
            if self.unit_active(target) or self.unit_held(target):
                raise VmError("busy")
            state = await self.status(target, probe=False)
            if state["state"] == "incompatible":
                raw = await self.inspect(target)
                if known_previous(raw, target, self.owner) or (captured_image and raw and raw.get("Image") == captured_image
                        and compatible(raw, target, self.owner, captured_image)):
                    state = {"state": "running" if raw.get("State", {}).get("Running") else "stopped"}
            if state["state"] == "missing":
                self.wallpaper_attempted.pop((target.remote, target.name), None)
                return
            if state["state"] not in ("running", "stopped"):
                raise VmError(state["state"])
            if self.unit_active(target) or self.unit_held(target) or self.unit_busy(target):
                raise VmError("busy")
            self.changes += 1
            result = await self.run_for(target, ["stop", "--time", "10", target.name], timeout=30)
            self.changes += 1
            if result.code:
                raise VmError("stop_failed")
            self.wallpaper_attempted.pop((target.remote, target.name), None)
            self.woken.pop(target.state_key, None)
            if remove and (await self.run_for(target, ["rm", target.name])).code:
                raise VmError("remove_failed")
            await self.close_viewer(target)

    async def close_viewer(self, target):
        tunnel = self.tunnels.pop((target.remote, target.name), None)
        if tunnel:
            await tunnel.close()

    async def local_installed(self):
        """Whether Docker Desktop is installed on this PC, whatever host is chosen now. A runner injected by a test
        stands for an engine that may come back, so it counts as installed."""
        return True if self._desktop is None else self._desktop.installed()

    async def erase(self, target, *, engine=True):
        """Remove one member's own computer for good: its container, then its workspace (a folder here, a volume on a
        host). Whatever is already gone is success. Never starts an engine; with `engine` false (none can exist: Docker
        is not installed) only the folder goes. The workspace of a shared computer is never a target."""
        key = target.key
        if target.container == "shared" or target.unit == "shared":
            raise VmError("shared")
        if not target.remote:
            root_path = self.root / "vm-homes"
            root = root_path.resolve()
            workspace = Path(target.workspace)
            if root_path.is_symlink() or not root.is_relative_to(self.root) or workspace.is_symlink() or workspace.resolve() != root / key:
                raise VmError("invalid_workspace")
        elif str(target.workspace) != target.name + "-workspace":
            raise VmError("invalid_workspace")
        # A computer the deleted member was still starting is not wanted: end its preparation before it takes the lock.
        preparing = self.preparing.pop(key, None)
        if preparing is not None and not preparing.done():
            preparing.cancel()
            await asyncio.gather(preparing, return_exceptions=True)
        async with self.locks.setdefault(key, asyncio.Lock()):
            if self.active.get(key) or key in self.held or self.busy(key):
                raise VmError("busy")
            if engine:
                raw = await self.inspect(target)  # an engine that is gone is "unavailable", never "no such container"
                if raw is not None:
                    labels = raw.get("Config", {}).get("Labels") or {}
                    if labels.get(f"{LABEL}.owner") != self.owner or labels.get(f"{LABEL}.target") != key:
                        raise VmError("foreign")
                    self.changes += 1
                    result = await self.run_for(target, ["rm", "--force", target.name], timeout=40)
                    self.changes += 1
                    if result.code and await self.inspect(target) is not None:
                        raise VmError("remove_failed")
            await self.close_viewer(target)
            if target.remote:
                if (await self.run_for(target, ["volume", "rm", str(target.workspace)])).code:
                    volume = await self.run_for(target, ["volume", "inspect", str(target.workspace)])
                    if volume.code == 0:
                        raise VmError("workspace_remove_failed")
                    if not await self._answers(target):
                        raise VmError("unavailable")
            else:
                import shutil
                if os.path.lexists(workspace):
                    await asyncio.to_thread(shutil.rmtree, workspace)
        self.invalidate(target)
        self.last_activity.pop(key, None)
        self.targets.pop(key, None)
        self.running.pop(target.physical, None)
        self.wallpaper_attempted.pop((target.remote, target.name), None)

    def hold(self, target, held):
        if held:
            if target.key not in self.held:
                self.held_since[target.key] = self.clock()
            self.held.add(target.key)
            self.held_targets[target.key] = target
        else:
            self.held.discard(target.key)
            self.held_targets.pop(target.key, None)
            self.held_since.pop(target.key, None)
        self.last_activity[target.state_key] = self.clock()

    def owner_note(self, target):
        """What a member that the owner's hold turned away is told, within the 240 characters a failure keeps: who holds
        the screen, for how long, that nothing was done and when it ends. None of it is a guess."""
        since = self.held_since.get(target.key)
        seconds = None if since is None else max(0, round(self.clock() - since))
        waited = "" if seconds is None else f" for {seconds} seconds" if seconds < 120 else f" for {seconds // 60} minutes"
        if self.work.pending(target) is not None:
            return (f"The owner is finishing a sign-in or payment step you asked for{waited}. Nothing was done. "
                    "Wait for their done, or do other work that needs no computer. Do not guess another cause.")
        return (f"The owner has had this screen's mouse and keyboard{waited}. Nothing was done. Do other work, or call "
                f"again later: it comes back at their press or after {OWNER_IDLE_S // 60} minutes without input. "
                "Do not guess another cause.")

    async def checkpoint(self, target, action, **metadata):
        from . import checkpoints
        source = Path(checkpoints.__file__).read_text(encoding="utf-8")
        result = await self.run_for(target, exec_args(target, ["timeout", "--signal=TERM", "--kill-after=1", "10", "/opt/venv/bin/python", "-c", source, action, json.dumps(metadata)]), timeout=12, limit=2_000_000)
        if result.code or result.truncated:
            raise VmError("checkpoint_unavailable")
        try:
            return json.loads(result.stdout)
        except ValueError:
            raise VmError("checkpoint_unavailable") from None

    async def execute(self, target, command, timeout=60, *, background=False):
        """Run `command` in the workspace. In the foreground it is waited for, at most `FOREGROUND_S`, and ended then;
        in the background it is started detached and this returns at once with a job whose log and exit code the
        caller reads with later commands. A job is ended by its own timeout, at most `BACKGROUND_S`."""
        if not isinstance(command, str) or not command.strip() or len(command) > 16_000:
            raise VmError("bad_arguments")
        if type(timeout) not in (int, float) or not math.isfinite(timeout) or not 0 < timeout <= (BACKGROUND_S if background else FOREGROUND_S):
            raise VmError("bad_arguments")
        if background:
            return await self._detached(target, command, timeout)
        # The guest timeout also ends the process when the host docker client is cancelled.
        token = secrets.token_hex(16)
        script = 'echo $$ > "$1"; shift; exec timeout --signal=TERM --kill-after=2 "$@"'
        pidfile = f"/tmp/raphael-exec-{token}.pid"
        shell = ["env", "-u", "DISPLAY", "sh", "-lc"] if target.container else ["sh", "-lc"]
        args = exec_args(target, ["sh", "-c", script, "sh", pidfile, str(timeout), *shell, f"cd {GUEST} && {command}"])
        try:
            result = await self.run_for(target, args, timeout=timeout + 5)
            output = (result.stdout + result.stderr)[:MAX_OUTPUT]
            return {"exit_code": result.code, "output": output, "truncated": result.truncated or len(result.stdout + result.stderr) > MAX_OUTPUT}
        except (asyncio.CancelledError, TimeoutError):
            await asyncio.shield(self.run_for(target, exec_args(target, ["sh", "-c", 'if test -f "$1"; then kill -TERM "$(cat "$1")" 2>/dev/null || true; fi', "sh", pidfile])))
            raise
        finally:
            await asyncio.shield(self.run_for(target, exec_args(target, ["rm", "-f", pidfile])))

    async def _detached(self, target, command, timeout):
        job = secrets.token_hex(6)
        base = f"{GUEST}/.raphael-jobs/{job}"
        shell = "env -u DISPLAY sh" if target.container else "sh"
        script = ('mkdir -p "$1" && { timeout --signal=TERM --kill-after=2 "$2" ' + shell + ' -lc "$3"; echo $? > "$5"; } > "$4" 2>&1')
        args = exec_args(target, ["sh", "-c", script, "sh", f"{GUEST}/.raphael-jobs", str(timeout),
                                  f"cd {GUEST} && {command}", f"{base}.log", f"{base}.exit"], detached=True)
        result = await self.run_for(target, args, timeout=30)
        if result.code:
            raise VmError("start_failed")
        return {"job": job, "log": f"{base}.log", "exit_file": f"{base}.exit"}

    async def read_file(self, target, guest_path, *, limit):
        path = PurePosixPath(guest_path) if isinstance(guest_path, str) else PurePosixPath("/")
        root = GUEST if path.is_relative_to(GUEST) else SHARED if target.shared and path.is_relative_to(SHARED) else None
        if not path.is_absolute() or ".." in path.parts or root is None:
            raise VmError("outside_workspace")
        # Resolve in the guest as well: Linux symlinks on a Windows bind mount are
        # not reliably visible to host pathlib. Open/copy bytes in one guest process.
        script = """import base64, os, stat, sys
fd = os.open(sys.argv[1], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
parts = sys.argv[2].split('/')
for part in parts[:-1]:
    next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
    os.close(fd)
    fd = next_fd
file_fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
os.close(fd)
assert stat.S_ISREG(os.fstat(file_fd).st_mode)
with os.fdopen(file_fd, 'rb') as stream:
    data = stream.read(int(sys.argv[3]) + 1)
assert len(data) <= int(sys.argv[3])
print(base64.b64encode(data).decode())
"""
        result = await self.run_for(target, exec_args(target, ["/opt/venv/bin/python", "-c", script, root, str(path.relative_to(root)), str(limit)]), timeout=30, limit=limit * 2)
        if result.code or result.truncated:
            raise VmError("file_unavailable")
        import base64
        try:
            return base64.b64decode(result.stdout.strip(), validate=True)
        except ValueError:
            raise VmError("file_unavailable") from None

    async def file_request(self, target, request, *, answer_bytes=0):
        """One request to the guest's file helper (`files_guest.py`) for a member's file tools: `read` (a path's kind,
        size, sha256 and first `limit` bytes) or `write` (a whole file, only over what the caller last saw). The request
        and the file's bytes go over stdin; `answer_bytes` is how many file bytes the answer may carry."""
        from . import files_guest
        source = Path(files_guest.__file__).read_text(encoding="utf-8")
        payload = json.dumps({**request, "roots": [GUEST, SHARED]}).encode("utf-8")
        args = exec_args(target, ["timeout", "--signal=TERM", "--kill-after=1", "55", "/opt/venv/bin/python", "-c", source],
                         interactive=True)
        result = await self.run_for(target, args, timeout=60, limit=answer_bytes * 4 // 3 + 65_536, input=payload)
        if result.code or result.truncated:
            raise VmError("file_unavailable")
        try:
            answer = json.loads(result.stdout)
        except ValueError:
            raise VmError("file_unavailable") from None
        if not isinstance(answer, dict):
            raise VmError("file_unavailable")
        return answer

    async def sweep(self):
        minutes = 15 if self.settings is None else self.settings.get("computer_vm_idle_minutes")
        if minutes == 0:
            return
        for target in list(self.units()):
            key = target.state_key
            last = self.last_activity.get(key)
            if last is None or key in self.maintenance:
                continue
            if self.clock() - last >= minutes * 60 and not self.unit_active(target) and not self.unit_held(target) and not self.unit_busy(target):
                try:
                    await self.stop(target)
                    self.last_activity.pop(key, None)
                except (VmError, OSError, TimeoutError):
                    pass

    async def recover(self):
        target = self.target()
        if not await self.available(target):
            return
        result = await self.run_for(target, ["ps", "-a", "--filter", f"label={LABEL}.owner={self.owner}", "--format", "{{.Names}}"])
        if result.code:
            return
        prefix = f"raphael-computer-{self.owner}-"
        for name in result.stdout.splitlines():
            key = name.removeprefix(prefix)
            if name.startswith(prefix) and (key == "shared" or len(key) == 16 and all(c in "0123456789abcdef" for c in key)):
                target = self.target_for(self.remote, key)
                if key == "shared":
                    target = replace(target, container="shared", screens=6)
                    for number, member in self.seats.holders(self.remote).items():
                        seat = self.shared_target(self.remote, member, number)
                        self.targets[seat.key] = seat
                self.targets[target.state_key] = target
                self.data.made(target)  # computers made before the app kept a record are found here
                if (await self.status(target, probe=False))["state"] == "running":
                    self.last_activity.setdefault(target.state_key, self.clock())

    def start_monitor(self):
        if self.task is None:
            self.task = asyncio.create_task(self._monitor())
        self.data.settle_soon()  # what a deleted member left owed when the core last ended

    async def _monitor(self):
        try:
            await self.recover()
            while True:
                await asyncio.sleep(30)
                if self.timezone_pending:
                    await self.refresh_timezone()
                await self.sweep()
                self.data.settle_soon()
        except (OSError, TimeoutError, VmError):
            return

    async def aclose(self, *, stop=True):
        await self.data.aclose()
        # A carry still copying ends with the core. The copy in its container finishes by itself.
        for carrying, _ in self.carry_tasks.values():
            carrying.cancel()
        await asyncio.gather(*(carrying for carrying, _ in self.carry_tasks.values()), return_exceptions=True)
        self.carry_tasks.clear()
        for pending in self.preparing.values():
            pending.cancel()
        await asyncio.gather(*self.preparing.values(), return_exceptions=True)
        self.preparing.clear()
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
            self.task = None
        for target in list(self.units()) if stop else []:
            # App shutdown stops only known, compatible idle computers. Workspaces,
            # browser profiles and volumes survive; no recovery scan or force removal.
            try:
                await self.stop(target)
            except (VmError, OSError, TimeoutError):
                pass
        await asyncio.gather(*(tunnel.close() for tunnel in self.tunnels.values()))
        self.tunnels.clear()
        await asyncio.gather(*(session.close() for session in self.remote_sessions.values()))
        self.remote_sessions.clear()

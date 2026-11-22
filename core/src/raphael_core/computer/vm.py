"""Docker desktops on this computer or an SSH host.

The engine owns containers; only the workspace survives
removal. Remote workspaces are engine volumes, never paths on this PC.

Adapted from third-party code under Apache-2.0, with changes; see core/packaging/licenses/NOTICES.md.
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
import sqlite3
import stat
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
IMAGE = "raphael/cua-local-vm:driver-0.37.0-v15"
# Every image of ours is a tag of this repository. Only its tags that carry LABEL are ever named as a build's cache or
# removed as an older layer; an image of any other repository is never touched.
REPOSITORY = IMAGE.split(":", 1)[0]
# How often an engine's older images of ours are looked at once a computer is ready on the current one (and at the first
# ready start after the core starts).
IMAGE_CLEAN_S = 86_400
GUEST = "/home/cua/workspace"
SHARED = "/home/cua/team"
MEMORY_GB = 3
# The shared computer is sized from the engine it runs on (`sized`, `LocalVm.machine_size`). SHARED_SIZE is what it
# keeps when the engine cannot be asked (what every layer before 13 was made with); the bounds are what any size stays in.
SHARED_SIZE = (6, 4)
SHARED_MEMORY_GB = (4, 12)
SHARED_CPUS = (2, 8)
SIZE_TTL_S = 300
LOCALE = "C.UTF-8"
LOCAL_LIMIT = 2
PREFLIGHT_S = 45.0
DRIVER = "/usr/local/libexec/raphael/cua-driver"
SOCKET = "/run/user/1000/raphael-cua.sock"
SCREENS_READY = "/dev/shm/raphael-screens.ready"
LABEL = "org.raphael.computer"
IMAGE_LABELS = {LABEL: "1", f"{LABEL}.driver": VERSION, f"{LABEL}.base": BASE, f"{LABEL}.layer": "15"}
MAX_OUTPUT = 50_000  # what a task may be shown of a result at most (`worker.guards`)
JOB_LOG_MAX = 256 * 1024  # bytes of combined stdout and stderr kept per detached job
# The owner's hold of a screen ends by itself after this long without a click or a key of theirs (a sign-in request that
# waits for them and a recording are held until they say so): a lease nobody uses blocks every member.
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
# Set only while a member's own tool call prepares its computer. A viewer opening or any other read never starts the engine, so the contextvar defaults off.
_MAY_START_ENGINE = ContextVar("computer_may_start_engine", default=False)
# shutil.which walks PATH on the event loop, and one status poll asks many times.
DOCKER_LOOKUP_S = 30.0
_docker_cli = None
# The folders of this PC the computers bind: each member's own home, and the team folder every computer shares.
HOMES, TEAM = "members", "team"
LEGACY_FOLDERS = {HOMES: "vm-homes", TEAM: "vm-shared"}
# The states `docker ps` gives a container that runs nothing: only such a computer may lose the folder it binds.
STOPPED_STATES = ("created", "exited", "dead")


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


def _withheld(values, text):
    from .logins import redact_values, redactable_program_key
    return redact_values((value for value in values if redactable_program_key(value)), text)


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

    async def __call__(self, args, *, timeout=15, limit=MAX_OUTPUT, progress=None, input=None, env=None, redact=None):
        """`input`, when given, is written to the command's stdin and closed (`docker exec -i`): a file's text travels
        there, never on the command line, which Windows holds to 32,767 characters. `env` (name -> value) is set in
        the environment of this one docker process, for `docker exec -e NAME` to hand on: a value is never an argument,
        which any program on this PC can read. `redact` is applied to everything read, whole, before it is cut to `limit`
        or handed to `progress`."""
        from .desktop_host import NO_WINDOW
        process = await asyncio.create_subprocess_exec(
            *self.argv(args), stdin=asyncio.subprocess.DEVNULL if input is None else asyncio.subprocess.PIPE,
            creationflags=NO_WINDOW, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            **({"env": {**os.environ, **env}} if env else {}),
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

        show = redact or (lambda text: text)

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
                            progress(show(line.decode("utf-8", errors="replace")))
            if progress and pending.strip():
                progress(show(pending.decode("utf-8", errors="replace")))
            text = show(kept.decode("utf-8", errors="replace"))
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


def resources(target, size=None):
    """Memory GiB and CPUs for the captured computer kind. The shared computer takes `size` (`sized`); a computer that
    is one member's own keeps its fixed size (the rule's smallest memory, 4 GiB, is more than it was ever given)."""
    return (size or SHARED_SIZE) if target.container == "shared" else (MEMORY_GB, 2)


def bound_folder(path):
    """Make a folder of this PC that a computer binds. On Windows, Python 3.12.4 and later give a folder made with mode 0o700
    a DACL closed to all but its owner, and the files the engine makes in it inherit that: it makes them as another account,
    so the owner could not read what a member made there. There the folder takes the access of
    the one it is in. A folder made closed before is left as it is: changing the access of the owner's folders is theirs to do."""
    path = Path(path)
    if os.name == "nt":
        path.mkdir(parents=True, exist_ok=True)
    else:
        path.mkdir(parents=True, exist_ok=True, mode=0o700)


def sized(memory_bytes, cpus):
    """The shared computer's size on an engine with this much memory and this many CPUs: half the CPUs (2 to 8) and
    four fifths of the memory in whole GiB (4 to 12). Measured on the owner's PC the fixed 6 GiB / 4 CPUs left the
    computer throttled 48% of the time while the engine had 20 CPUs."""
    return (min(SHARED_MEMORY_GB[1], max(SHARED_MEMORY_GB[0], int(memory_bytes * 4 // 5 // 1024**3))),
            min(SHARED_CPUS[1], max(SHARED_CPUS[0], cpus // 2)))


def limits_match(host, target):
    """A computer of its own has exactly its size. The shared computer's limits are only held inside the rule's bounds:
    its size follows the engine (`LocalVm.fit_limits` brings it to the current one with `docker update`), so a size that
    was right when it was made is not a reason to make it again."""
    memory, cpus = resources(target)
    if target.container != "shared":
        return (host.get("Memory") == memory * 1024**3 and host.get("MemorySwap") == memory * 1024**3
                and host.get("NanoCpus") == cpus * 1_000_000_000)
    held, swap, nano = host.get("Memory"), host.get("MemorySwap"), host.get("NanoCpus")
    return (held == swap and type(held) is int and held % 1024**3 == 0 and type(nano) is int and nano % 1_000_000_000 == 0
            and SHARED_MEMORY_GB[0] <= held // 1024**3 <= SHARED_MEMORY_GB[1]
            and SHARED_CPUS[0] <= nano // 1_000_000_000 <= SHARED_CPUS[1])


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


def run_args(target, owner, password, *, tz=None, size=None):
    zone = timezone_name(tz)
    memory, cpus = resources(target, size)
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
        # Tools handle Chinese and Japanese file names only under a UTF-8 locale; the image's default is POSIX.
        "-e", f"LANG={LOCALE}", "-e", f"LC_ALL={LOCALE}",
        "-e", f"RAPHAEL_SCREENS={target.screens}",
        "-e", f"VNC_RESOLUTION={canvas[0]}x{canvas[1]}",
        "-p", "127.0.0.1::6901", IMAGE,
    ]


def build_args(context, previous=None):
    """The image's build. The image carries its own cache record (`BUILDKIT_INLINE_CACHE=1`, BuildKit's inline cache),
    and `previous`, the newest earlier image of ours on the engine, is named as a cache source: a step whose text did not
    change is then taken from that image even when the engine's own build cache has lost it (measured: a layer that
    changed only its last label ran the 186 s package step and the Chrome step again). An image built without the record
    gives nothing as a source and costs nothing; one build on this code is needed before the next layer can use it."""
    return ["build", "--progress=plain", "--build-arg", "BUILDKIT_INLINE_CACHE=1",
            *(["--cache-from", previous] if previous else []), "--tag", IMAGE, str(context)]


def scratch_args(target):
    """The shell command that clears a computer's old scratch: plain files in /tmp not touched for three days (nothing
    whose name starts with a dot: the display's lock and sockets are there), and the logs and exit files of background
    jobs (`LocalVm._detached`) older than seven days. A job lasts BACKGROUND_S (six hours) at most, so one that old is
    over; nothing else is named."""
    script = ('status=0; '
              'find /tmp -xdev -mindepth 1 -type f ! -path "/tmp/.*" -mmin +4320 -amin +4320 -delete || status=$?; '
              '{ mkdir -p -- "$1" && '
              'find "$1" -maxdepth 1 -type f \\( -name "*.log" -o -name "*.exit" \\) -mmin +10080 -delete; } || status=$?; '
              'exit "$status"')
    return exec_args(target, ["sh", "-c", script, "sh", f"{GUEST}/.raphael-jobs"])


def exec_args(target, command, *, interactive=False, detached=False, env=()):
    """`env` is the names of variables the command gets from the environment of the docker process itself
    (`-e NAME` without a value): a secret is never on this line."""
    return ["exec", *(["-i"] if interactive else []), *(["-d"] if detached else []), "-u", "cua", "-e", "HOME=/home/cua",
            "-e", "DISPLAY=:1", "-e", "CUA_DRIVER_INSTALL_CHANNEL=python_package",
            "-e", "CUA_DRIVER_RS_TELEMETRY_ENABLED=0", *(part for name in env for part in ("-e", name)), target.name, *command]


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
            and limits_match(host, target) and host.get("PidsLimit") == 4096
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
        # Layer 7 is the one the computer every member shares was released on: six screens, and the
        # owner's own computer the day layer 8 came; layers 8 to 12 kept that shape. A layer that is not named here is
        # refused as incompatible, and its computer does not start: each new layer adds the one before it. Layer 13 is
        # the first with the UTF-8 locale in its environment: every layer before it is made again once.
        if layer in ("13", "14"):
            # Layers 14 and 15 changed only the image. The environment, screens and limits have the same shape
            # since layer 13 (a shared computer gets its size from the engine).
            labels[f"{LABEL}.layer"] = IMAGE_LABELS[f"{LABEL}.layer"]
            return compatible(previous, target, owner, raw["Image"])
        six = shared_upgrade and layer in ("5", "7", "8", "9", "10", "11", "12") and screens == ["RAPHAEL_SCREENS=6"]
        memory = 6 if six else {"3": 2, "4": 3, "5": 3, "6": 3, "7": 3, "8": 3, "9": 3, "10": 3, "11": 3, "12": 3}.get(layer)
        # Layer 5 was the first to say its screen count; the two before it had no such entry.
        if ((target.screens != 1 and not shared_upgrade) or memory is None
                or screens != ([f"RAPHAEL_SCREENS={6 if six else 1}"] if layer in ("5", "6", "7", "8", "9", "10", "11", "12") else [])
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
    def __init__(self, data_dir, *, settings=None, runner=None, clock=time.monotonic, enabled=True, conn=None, machine_dir=None):
        self.root = Path(data_dir).resolve()
        self.owner = hashlib.sha256(os.path.normcase(str(self.root)).encode()).hexdigest()[:16]
        # The computers' folders belong in the machine-local folder that goes with the data directory
        # (`paths.machine_dir`). The owner label stays the data directory's: moving the folders never makes a computer
        # someone else's.
        self.machine = self.root if machine_dir is None else Path(machine_dir).resolve()
        self.homes, self.team = self.placed(HOMES), self.placed(TEAM)
        self.relocation = None
        self.member_computer_mode = lambda member: "docker"
        self.host_work_busy = lambda: False
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
        # The computers whose preparation now makes them again on a newer image: their state says `update` (R-COMP-UPDATE-01).
        self.updating = set()
        # Older images of ours are removed only by the app's own engine: a runner a test or the acceptance injects never
        # loses an image it did not ask to lose (the acceptance reads the released layers' images).
        self.clean_images = runner is None
        self.images_checked, self.image_tasks = {}, {}  # host -> when its older images were last looked at, and that task
        self.wallpaper_attempted = {}  # (host, computer) -> the picture its watcher was started with
        self.sizes = {}  # host -> (when, (memory GiB, CPUs)) the shared computer takes there (`machine_size`)
        self.fitted = {}  # (host, computer) -> the size its limits were last seen or made at
        self.scratch_cleaned = {}  # (host, computer) -> when its old scratch was last cleared
        self.scratch_failed = set()
        self.browser_locks = {}
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
            try:
                raw = await self.inspect(target)
            except VmError as error:
                # No engine runs (Docker Desktop is closed), so no computer and no window of it: the screen is empty, and the
                # member who takes it starts the computer as any first use does. Refusing here told every member "every
                # screen of the computer is in use" while nobody used it (seen on a real computer).
                if str(error) == "unavailable":
                    return True
                raise
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

    async def command_path(self, target, name):
        """Where the computer's shell finds `name` as a program, or None: then the driver matches a desktop entry."""
        if not isinstance(name, str) or not name or name.startswith("-") or any(char in name for char in "\0\n"):
            return None
        result = await self.run_for(target, exec_args(target, ["sh", "-c", 'command -v "$1"', "sh", name]))
        path = result.stdout.strip()
        return path if not result.code and not result.truncated and path.startswith("/") and "\n" not in path else None

    async def launch_marks(self, target, rows):
        """What ties each listed window to a launch (seat_launch.marks), in one command; nothing for what cannot be read."""
        from .seat_launch import MARKS, marks
        given = [f"{row['window_id']}:{row['pid'] if type(row.get('pid')) is int and row['pid'] > 0 else 0}"
                 for row in rows if type(row.get("window_id")) is int and row["window_id"] > 0]
        if not given:
            return {}
        result = await self.run_for(target, exec_args(target, ["sh", "-c", MARKS, "sh", *given]))
        if result.code or result.truncated:
            logger.info("Launch marks unreadable: %s", (result.stderr or "").strip()[-300:])
            return {}
        return marks(result.stdout)

    async def restore_window(self, target, window_id):
        """Bring a minimized window back to its screen (a member went on working in a minimized
        browser where nobody could see)."""
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

    # The launcher script ends itself: 60 s for the browser's first window (a loaded PC took 13 to 41 s) and
    # 30 s for the window to settle on its screen. This is only the outer bound, so that the script's own answer comes first.
    seat_browser_s = 120

    async def seat_browser(self, target):
        from .seat_view import rectangle
        from .carry import before_browser
        from .seat_browser import LAUNCH, RECOVER_STALE_LOCKS, STALE_LOCK_EXIT, stale_locks
        await before_browser(self, target)
        command = ["raphael-seat-browser", *map(str, rectangle(target.screen, target.screens))]

        async def launch(*options):
            return await self.run_for(target, exec_args(target, ["/usr/bin/python3", "-", *options, *command], interactive=True),
                                      input=LAUNCH.encode("utf-8"), timeout=self.seat_browser_s)

        async with self.browser_locks.setdefault(target.physical, asyncio.Lock()):
            result = await launch() if target.remote else await launch(RECOVER_STALE_LOCKS)
            if not target.remote and result.code == STALE_LOCK_EXIT and not result.truncated:
                if names := stale_locks(result.stderr):
                    self._clear_browser_locks(target, names)
                    result = await launch()
        match = re.fullmatch(r"pid=([1-9][0-9]*) window_id=([1-9][0-9]*)", result.stdout.strip())
        if result.code or result.truncated or not match:
            # Keep diagnostics in the core log; the member gets fixed recovery guidance.
            logger.info("raphael-seat-browser failed (exit %s): %s", result.code, (result.stderr or "").strip()[-2300:])
            raise VmError("browser_window_missing")
        return dict(zip(("pid", "window_id"), map(int, match.groups())))

    def _clear_browser_locks(self, target, names):
        from .seat_browser import PROFILE_PARTS
        try:
            self.validate_storage(target)
            folder = Path(target.workspace)
            for part in PROFILE_PARTS:
                folder /= part
                info = folder.lstat()
                if (not stat.S_ISDIR(info.st_mode)
                        or getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT):
                    return
        except (OSError, VmError):
            return
        for name in names:
            try:
                (folder / name).unlink()
            except FileNotFoundError:
                pass
            except OSError as error:
                logger.info("The host could not remove browser lock %s: %s", name, error.strerror)

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
                                        "progress": " ".join(text.split())[:180],
                                        **({"update": True} if target.state_key in self.updating else {})}

    def preparing_now(self, target):
        """Whether this computer is being started, built or made now: by an open viewer (`launch`) or a member's own call."""
        task = self.preparing.get(target.state_key)
        return (task is not None and not task.done()
                or (self.preparation.get(target.state_key) or {}).get("state") in ("starting", "building", "preparing"))

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
                      PurePosixPath(name + "-workspace") if host else self.homes / key,
                      PurePosixPath(f"raphael-computer-{self.owner}-team") if host else self.team,
                      host)

    def placed(self, name):
        """Where one of the computers' folders is: in the machine-local folder once it is there, and in the data
        directory while an install made before still keeps it there (`relocate`). A folder of that name that something
        made again in the data directory after the move is never used and never merged: the moved one is the members'."""
        destination = self.machine / name
        legacy = LEGACY_FOLDERS[name]
        candidates = (destination, self.machine / legacy, self.root / name, self.root / legacy)
        return next((path for path in candidates if os.path.lexists(path)), destination)

    def relocate_soon(self):
        """Start the move of the computers' folders (`relocate`) once for this core; every start of a computer waits for it."""
        if self.relocation is None:
            async def relocate():
                try:
                    return await self.relocate()
                except Exception as error:
                    logger.warning("The computers' folders stay where they are (%s)", type(error).__name__)
                    return "failed"
            self.relocation = asyncio.create_task(relocate())
        return self.relocation

    # What a move waits for that a computer stopping can end: a computer of the old place still running, or one in use.
    MOVE_WAITS_FOR_A_STOP = ("running", "busy")

    def relocate_again(self):
        """A computer stopped while the core runs: a move that waited only for such a computer is tried again now, instead
        of at the next start, which may find the computer running again (one left running by an app that did not stop it
        on its way out is only stopped later, idle). A core that is closing tries nothing: its monitor is gone."""
        task = self.relocation
        if self.task is None or task is None or not task.done() or task.cancelled() or task.result() not in self.MOVE_WAITS_FOR_A_STOP:
            return None
        self.relocation = None
        return self.relocate_soon()

    async def settled(self):
        """Wait for a move of the computers' folders under way: a computer is never prepared on a folder being moved."""
        if self.relocation is not None and not self.relocation.done():
            await asyncio.shield(self.relocation)

    async def relocate(self):
        """Move the computers' folders of an install made before they lived in the machine-local folder, once.

        Each folder is renamed on its own volume: nothing is copied and nothing is deleted. It happens only while no
        computer of this app runs or is being prepared and no carry helper is there. If Docker is installed, its
        engine must answer before moving a folder. Every stopped computer of this app that binds a folder being moved
        is removed first, as an image upgrade removes it: its next start makes it again on the new place and its
        workspace goes on in its folder, so no computer is ever left bound to a folder that is gone. A move that
        cannot happen now is tried again at the next start. Returns what happened (`moved`, `nothing` or the reason it
        waits)."""
        moves = [(self.placed(name), self.machine / name) for name in (HOMES, TEAM)
                 if self.placed(name) != self.machine / name]
        if not moves:
            return "nothing"
        if not self.enabled:
            return self._waits("disabled")
        async with self.capacity_lock:
            if (self.host_work_busy() or any(not task.done() for task in self.preparing.values()) or any(self.active.values()) or self.held
                    or self.maintenance or any(not task.done() for task, _ in self.carry_tasks.values())):
                return self._waits("busy")
            probe = self.target_for("", "shared")
            if await self._answers(probe):
                reason = await self._release_folders([earlier for earlier, _ in moves], probe)
                if reason:
                    return self._waits(reason)
            elif await self.local_installed():
                return self._waits("engine")
            moved = 0
            try:
                for earlier, destination in moves:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    if os.stat(earlier).st_dev != os.stat(destination.parent).st_dev:
                        return self._waits("volume")
                    os.rename(earlier, destination)
                    moved += 1
                    self._repoint(earlier, destination)
            except OSError:
                return self._waits("rename")
            finally:
                # A folder that moved is used from its new place even when the other one could not follow.
                self.homes, self.team = self.placed(HOMES), self.placed(TEAM)
                if moved:
                    self.targets.clear()
                    self.running.clear()
                    self.status_engines.clear()
                    self.changes += 1
            logger.info("Moved %d computer folders to the machine-local folder", moved)
            return "moved"

    def _repoint(self, earlier, destination):
        """A task's receipts keep the folder of this PC that held each file it left (background.tasks: the artifact's
        root, and the full path of a file it found before or could not read): one in a folder that moved names it at its
        new place, or a finished task's file would no longer open and a task under way would miss its own work."""
        conn = self.data.conn
        if conn is None:
            return

        def moved(value):
            try:
                return str(destination / Path(value).relative_to(earlier)) if isinstance(value, str) and value else None
            except ValueError:
                return None
        try:
            rows = conn.execute("SELECT id, workspace, uri FROM task_evidence").fetchall()
            changes = [(moved(row[1]) or row[1], moved(row[2]) or row[2], row[0]) for row in rows
                       if moved(row[1]) or moved(row[2])]
            if changes:
                with conn:
                    conn.executemany("UPDATE task_evidence SET workspace=?, uri=? WHERE id=?", changes)
        except sqlite3.Error as error:
            logger.warning("The receipts of tasks in a moved computer folder still name its old place (%s)", type(error).__name__)

    async def _release_folders(self, folders, probe):
        """Remove every computer of this app on this PC's engine that binds one of `folders`, all of them stopped:
        None once none is left, else why the folders cannot move now."""
        listed = await self.run_for(probe, ["ps", "-a", "--filter", f"label={LABEL}.owner={self.owner}",
                                            "--format", "{{.Names}}\t{{.State}}"], limit=100_000)
        from .carry import helper_prefix
        helpers = await self.run_for(probe, ["ps", "-a", "--filter", "name=" + helper_prefix(self.owner),
                                             "--format", "{{.Names}}"], limit=100_000)
        if listed.code or listed.truncated or helpers.code or helpers.truncated:
            return "engine"
        if helpers.stdout.strip():
            return "carry"
        rows = [line.split("\t") for line in listed.stdout.splitlines() if line.strip()]
        if any(len(row) != 2 or row[1].strip() not in STOPPED_STATES for row in rows):
            return "running"
        roots = [Path(folder).resolve() for folder in folders]
        for name, _ in rows:
            result = await self.run_for(probe, ["container", "inspect", name], limit=200_000)
            try:
                raw = json.loads(result.stdout)[0] if not result.code else None
                labels = raw["Config"].get("Labels") or {}
                running = raw.get("State", {}).get("Running") is not False
                sources = [mount.get("Source") or "" for mount in (raw.get("HostConfig", {}).get("Mounts") or raw.get("Mounts") or [])]
            except (ValueError, IndexError, KeyError, TypeError, AttributeError):
                return "engine"
            if labels.get(f"{LABEL}.owner") != self.owner:
                return "engine"
            if running:
                return "running"
            if any(source and Path(source).resolve().is_relative_to(root) for source in sources for root in roots):
                if (await self.run_for(probe, ["rm", name], timeout=40)).code:
                    return "remove"
        return None

    @staticmethod
    def _waits(reason):
        logger.info("The computers' folders stay in the data folder until a later start (%s)", reason)
        return reason

    def uses_host(self, member):
        """The stored choice stays Docker when it is temporarily unavailable on this PC."""
        return (self.member_computer_mode(member) == "host"
                or bool(not self.remote and self.desktop and not self.desktop.installed()))

    @property
    def mode(self):
        """One computer for every member is the default where it has been run on real computers: this PC's Docker.
        On another host the members keep a computer each until the owner's data says otherwise: seats, the six
        screens and the carry-over have never run on a real remote host. A saved choice always wins."""
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
        await self.settled()
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

    async def build(self, target=None, *, progress=None, previous=None):
        """Build the current image. `previous` is the earlier image of ours its steps are taken from (`build_args`); None
        looks it up, "" names none."""
        target = target or self.target()
        if not await self.available(target):
            raise VmError("unavailable")
        if previous is None:
            previous = await self.cache_source(target)
        result = await self.run_for(target, ["pull", BASE], timeout=1800, **({"progress": progress} if progress else {}))
        if result.code:
            raise VmError("pull_failed")
        context = Path(__file__).parent / "image"
        result = await self.run_for(target, build_args(context, previous), timeout=1800,
                                **({"progress": progress} if progress else {}))
        if result.code or not await self.image(target):
            raise VmError("build_failed")

    async def owned_images(self, target):
        """The images of ours on this target's engine, newest layer first, as (layer, tag, id): tags of REPOSITORY whose
        image carries LABEL and a layer number. Whatever cannot be read is left out; an engine that cannot list them gives none."""
        if not IMAGE.startswith(REPOSITORY + ":"):
            return []
        listed = await self.run_for(target, ["image", "ls", "--filter", f"label={LABEL}=1", "--filter", f"reference={REPOSITORY}",
                                             "--format", "{{.Repository}}:{{.Tag}}"], timeout=30, limit=20_000)
        if listed.code or listed.truncated:
            return []
        pattern = re.escape(REPOSITORY) + r":[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}"
        tags = sorted({line.strip() for line in listed.stdout.splitlines() if re.fullmatch(pattern, line.strip())})
        if not tags:
            return []
        inspected = await self.run_for(target, ["image", "inspect", *tags], timeout=30, limit=2_000_000)
        if inspected.code or inspected.truncated:
            return []
        try:
            images = json.loads(inspected.stdout)
        except ValueError:
            return []
        found = set()
        for image in images if isinstance(images, list) else []:
            try:
                labels = image["Config"]["Labels"] or {}
                layer, ident = labels.get(f"{LABEL}.layer"), image["Id"]
                if labels.get(LABEL) != "1" or not isinstance(layer, str) or not layer.isdecimal() or not isinstance(ident, str):
                    continue
                found.update((int(layer), tag, ident) for tag in image.get("RepoTags") or [] if tag in tags)
            except (KeyError, TypeError, AttributeError):
                continue
        return sorted(found, key=lambda image: (-image[0], image[1]))

    async def cache_source(self, target):
        """The newest image of ours from an earlier layer, which a build takes its unchanged steps from, or ""."""
        layer = int(IMAGE_LABELS[f"{LABEL}.layer"])
        try:
            return next((tag for number, tag, _ in await self.owned_images(target) if number < layer and tag != IMAGE), "")
        except (OSError, TimeoutError) as error:
            logger.warning("The earlier computer images could not be listed (%s); the build names no cache source", type(error).__name__)
            return ""

    def image_work_under_way(self, *, building=True):
        """Whether a computer is being built, made, started or maintained now, or the engine is being started: older images
        are never removed meanwhile. `building` false leaves out the build lock, for the one who holds it."""
        return ((building and self.build_lock.locked()) or self.engine_lock.locked() or self.capacity_lock.locked()
                or bool(self.maintenance) or any(lock.locked() for lock in self.locks.values())
                or any(not task.done() for task in self.preparing.values())
                or any((entry or {}).get("state") in ("starting", "building", "preparing") for entry in self.preparation.values()))

    async def images_in_use(self, target):
        """The image id of every container on this target's engine, running or stopped, ours or anyone's; None when any of
        it cannot be read (then nothing is removed)."""
        listed = await self.run_for(target, ["ps", "-a", "-q", "--no-trunc"], timeout=30, limit=400_000)
        ids = listed.stdout.split()
        if listed.code or listed.truncated or not all(re.fullmatch(r"[0-9a-f]{64}", ident) for ident in ids):
            return None
        used = set()
        # A hundred at a time keeps the command line far under what Windows allows.
        for start in range(0, len(ids), 100):
            batch = ids[start:start + 100]
            inspected = await self.run_for(target, ["container", "inspect", "--format", "{{.Image}}", *batch], timeout=30, limit=200_000)
            images = inspected.stdout.split()
            if (inspected.code or inspected.truncated or len(images) != len(batch)
                    or not all(re.fullmatch(r"sha256:[0-9a-f]{64}", image) for image in images)):
                return None
            used.update(images)
        return used

    async def remove_old_images(self, target):
        """Remove the images of ours from earlier layers that no container on the target's engine uses, once a computer is
        ready on the current image (R-COMP-IMAGE-02). Never an image of another repository or without LABEL, never one a
        container (running or stopped) references, never the current one or a newer layer, never while a computer is
        being built, made, started or maintained, and never with `--force`. A failure is logged by its kind and nothing
        else happens; the tags removed are returned."""
        removed = []
        if not IMAGE.startswith(REPOSITORY + ":"):
            return removed
        try:
            if self.image_work_under_way():
                self.images_checked.pop(target.remote, None)  # looked at again at the next ready start
                return removed
            # Holding the build lock keeps any build, and every start's image check, out until this is done.
            async with self.build_lock:
                if self.image_work_under_way(building=False):
                    self.images_checked.pop(target.remote, None)
                    return removed
                current = await self.image(target)
                if not current:
                    return removed
                layer = int(IMAGE_LABELS[f"{LABEL}.layer"])
                old = [(number, tag, ident) for number, tag, ident in await self.owned_images(target)
                       if number < layer and tag != IMAGE and ident != current]
                if not old:
                    return removed
                used = await self.images_in_use(target)
                if used is None:
                    logger.warning("Older computer images were kept: the images the containers use could not be read")
                    return removed
                for number, tag, ident in old:
                    if ident in used:
                        continue
                    if self.image_work_under_way(building=False):
                        self.images_checked.pop(target.remote, None)
                        break
                    result = await self.run_for(target, ["image", "rm", tag], timeout=120)
                    if result.code:
                        logger.warning("An older computer image (layer %d) could not be removed", number)
                    else:
                        removed.append(tag)
        except (OSError, TimeoutError, VmError, ValueError) as error:
            logger.warning("Older computer images were not removed (%s)", type(error).__name__)
        if removed:
            logger.info("Removed %d older computer image(s)", len(removed))
        return removed

    def clean_soon(self, target):
        """A computer is ready on the current image: its engine's older images of ours are looked at in the background,
        at the first ready start after the core starts and then at most once a day for each engine."""
        if not self.clean_images or not IMAGE.startswith(REPOSITORY + ":"):
            return
        host, now = target.remote, self.clock()
        last, task = self.images_checked.get(host), self.image_tasks.get(host)
        if task is not None and not task.done() or last is not None and 0 <= now - last < IMAGE_CLEAN_S:
            return
        self.images_checked[host] = now
        self.image_tasks[host] = asyncio.create_task(self.remove_old_images(target))

    async def start(self, target):
        await self.settled()
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
                if path is not None and not any(local_storage_root(path).is_relative_to(root) for root in (self.root, self.machine)):
                    raise ValueError("outside_workspace")
        except (ValueError, OSError):
            raise VmError("outside_workspace") from None
        # A target taken before the folders moved names a place that is gone: starting it would make an empty one there.
        if Path(target.workspace).parent != self.homes or target.shared is not None and Path(target.shared) != self.team:
            raise VmError("busy")

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
                # Ready means running on the current image (`compatible`): older layers are no longer needed by it.
                self.clean_soon(target)
            return state

    async def _prepare_start(self, target):
        self.changes += 1
        try:
            await self.ensure_engine(target, start_desktop=_MAY_START_ENGINE.get())
            async with self.build_lock:
                if not await self.image(target):
                    # An earlier image of ours means this build is an update: the state says so while it lasts, and
                    # the build takes its unchanged steps from that image.
                    previous = await self.cache_source(target)
                    if previous:
                        self.updating.add(target.state_key)
                    self._progress(target, "building")
                    await self.build(target, progress=lambda text: self._progress(target, "building", text), previous=previous)
            # Every computer tool call passes here: a running desktop is not being prepared.
            if (await self.status(target, probe=False))["state"] != "running":
                self._progress(target, "preparing")
            if not target.remote:
                await self._make_room(target)
            return await self._start(target)
        finally:
            self.preparation.pop(target.state_key, None)
            self.updating.discard(target.state_key)
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
            self.scratch_cleaned.pop((target.remote, target.name), None)  # a computer that wakes is cleared again
        if state["state"] in ("running", "stopped"):
            await self.fit_limits(target)
        if state["state"] == "missing":
            if not state.get("image"):
                raise VmError("image_missing")
            if not target.remote:
                bound_folder(target.workspace)
                bound_folder(target.shared)
            self.validate_storage(target)
            self.data.made(target)  # before the engine makes it: a computer unrecorded could never be removed
            result = await self.create(target, zone)
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
                        bound_folder(target.shared / name)
                await self._wallpaper(target)
                await self.clear_scratch(target)
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
        if (self.preparation.get(target.state_key) or {}).get("state") in ("starting", "building", "preparing"):
            # A computer of an earlier layer is made again on this one: part of the update the state names. Only inside a
            # preparation (`_prepare_start`), whose end clears both.
            self.updating.add(target.state_key)
            self._progress(target, "preparing")
        self.rebuild_notice(target)
        if raw.get("State", {}).get("Running") and (await self.run_for(target, ["stop", "--time", "10", target.name], timeout=30)).code:
            raise VmError("stop_failed")
        if (await self.run_for(target, ["rm", target.name])).code:
            raise VmError("remove_failed")
        self.invalidate(target)
        return {"state": "missing", "image": True}

    async def machine_size(self, target):
        """The size the shared computer takes on the engine it runs on: asked from Docker itself (memory and CPUs its
        engine has: on Windows the WSL2 machine's, not the PC's) and kept for a few minutes. When the engine cannot be
        asked, or answers nonsense, it is what the computer always had (`SHARED_SIZE`), and that is not kept."""
        kept = self.sizes.get(target.remote)
        now = self.clock()
        if kept and 0 <= now - kept[0] < SIZE_TTL_S:
            return kept[1]
        try:
            result = await self.run_for(target, ["info", "--format", "{{.MemTotal}} {{.NCPU}}"], timeout=10, limit=4000)
            fields = result.stdout.split()
            if not result.code and len(fields) == 2 and all(field.isdecimal() for field in fields) and all(int(field) > 0 for field in fields):
                size = sized(int(fields[0]), int(fields[1]))
                self.sizes[target.remote] = now, size
                return size
        except (OSError, TimeoutError, VmError):
            pass
        logger.warning("The engine could not say its size; the shared computer keeps %s GiB and %s CPUs", *SHARED_SIZE)
        return SHARED_SIZE

    async def create(self, target, zone, *, only_create=False):
        """Make the computer's container; a shared computer takes the size its engine gives it."""
        size = await self.machine_size(target) if target.container == "shared" else None
        args = run_args(target, self.owner, secrets.token_urlsafe(24), tz=zone, size=size)
        if only_create:
            args[:2] = ["create"]
        self.fitted[(target.remote, target.name)] = resources(target, size)
        return await self.run_for(target, args, timeout=60)

    async def fit_limits(self, target):
        """A shared computer that was made at another size is brought to the engine's present one in place, with
        `docker update` (nothing is rebuilt, nothing in it ends). It is asked at most once for each size; a refusal
        (a smaller memory than the computer holds now) is logged and the computer goes on as it is."""
        if target.container != "shared":
            return
        key = (target.remote, target.name)
        size = await self.machine_size(target)
        if self.fitted.get(key) == size:
            return
        try:
            raw = await self.inspect(target)
            host = (raw or {}).get("HostConfig", {})
            memory, cpus = size
            if raw is None:
                return
            if (host.get("Memory") != memory * 1024**3 or host.get("MemorySwap") != memory * 1024**3
                    or host.get("NanoCpus") != cpus * 1_000_000_000):
                result = await self.run_for(target, ["update", "--memory", f"{memory}g", "--memory-swap", f"{memory}g",
                                                     "--cpus", str(cpus), target.name], timeout=30)
                if result.code:
                    logger.warning("The shared computer could not be resized in place")
                    return
            self.fitted[key] = size
        except (OSError, TimeoutError, VmError):
            logger.warning("The shared computer's size could not be checked")

    async def clear_scratch(self, target):
        """Clear a running computer's old scratch (`scratch_args`) when it is prepared, and at most once a day after
        that. A failure is logged and never stops the computer."""
        key = (target.remote, target.name)
        now = self.clock()
        last = self.scratch_cleaned.get(key)
        if last is not None and 0 <= now - last < 86_400:
            return
        try:
            result = await self.run_for(target, scratch_args(target), timeout=60)
            if result.code == 0:
                self.scratch_cleaned[key] = self.clock()
                self.scratch_failed.discard(key)
                return
            detail = (result.stderr or "").strip()[-500:] or f"exit {result.code}"
        except (OSError, TimeoutError, VmError) as error:
            detail = str(error) or type(error).__name__
        if key not in self.scratch_failed:
            self.scratch_failed.add(key)
            logger.warning("A computer's old scratch could not be cleared: %s", detail)

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
                    if (await self.create(target, zone, only_create=True)).code:
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
        self.relocate_again()

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
            root_path = self.homes
            root = root_path.resolve()
            workspace = Path(target.workspace)
            if (root_path.is_symlink() or not any(root.is_relative_to(base) for base in (self.root, self.machine))
                    or workspace.is_symlink() or workspace.resolve() != root / key):
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
        limit = checkpoints.GUEST_SECONDS
        result = await self.run_for(target, exec_args(target, ["timeout", "--signal=TERM", "--kill-after=1", f"{limit:g}", "/opt/venv/bin/python", "-c", source, action, json.dumps(metadata)]), timeout=limit + 2, limit=2_000_000)
        if result.code or result.truncated:
            # 124 is the guest's `timeout` ending it: the store took longer than it may, which is not a broken store.
            raise VmError("checkpoint_timeout" if result.code == 124 else "checkpoint_unavailable")
        try:
            return json.loads(result.stdout)
        except ValueError:
            raise VmError("checkpoint_unavailable") from None

    async def execute(self, target, command, timeout=60, *, background=False, keys=None):
        """Run `command` in the workspace. In the foreground it is waited for, at most `FOREGROUND_S`, and ended then;
        in the background it is started detached and this returns at once with a job whose log and exit code the
        caller reads with later commands. A job is ended by its own timeout, at most `BACKGROUND_S`.
        `keys` (variable name -> value) are given to this one command's environment, never to its command line, and
        what it prints has keys of at least six characters replaced by a placeholder before anything is returned."""
        if not isinstance(command, str) or not command.strip() or len(command) > 16_000:
            raise VmError("bad_arguments")
        if keys is not None and (not isinstance(keys, dict) or not keys or not all(
                isinstance(name, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", name) and isinstance(value, str) and value
                and "\0" not in value for name, value in keys.items())):
            raise VmError("bad_arguments")
        carried = {"env": keys, "redact": lambda text, values=tuple(keys.values()): _withheld(values, text)} if keys else {}
        if type(timeout) not in (int, float) or not math.isfinite(timeout) or not 0 < timeout <= (BACKGROUND_S if background else FOREGROUND_S):
            raise VmError("bad_arguments")
        if background:
            return await self._detached(target, command, timeout, keys)
        # The guest timeout also ends the process when the host docker client is cancelled.
        token = secrets.token_hex(16)
        script = 'echo $$ > "$1"; shift; exec timeout --signal=TERM --kill-after=2 "$@"'
        pidfile = f"/tmp/raphael-exec-{token}.pid"
        shell = ["env", "-u", "DISPLAY", "sh", "-lc"] if target.container else ["sh", "-lc"]
        args = exec_args(target, ["sh", "-c", script, "sh", pidfile, str(timeout), *shell, f"cd {GUEST} && {command}"], env=tuple(keys or ()))
        try:
            result = await self.run_for(target, args, timeout=timeout + 5, **carried)
            output = (result.stdout + result.stderr)[:MAX_OUTPUT]
            return {"exit_code": result.code, "output": output, "truncated": result.truncated or len(result.stdout + result.stderr) > MAX_OUTPUT}
        except (asyncio.CancelledError, TimeoutError):
            await asyncio.shield(self.run_for(target, exec_args(target, ["sh", "-c", 'if test -f "$1"; then kill -TERM "$(cat "$1")" 2>/dev/null || true; fi', "sh", pidfile])))
            raise
        finally:
            await asyncio.shield(self.run_for(target, exec_args(target, ["rm", "-f", pidfile])))

    async def _detached(self, target, command, timeout, keys=None):
        job = secrets.token_hex(6)
        base = f"{GUEST}/.raphael-jobs/{job}"
        shell = "env -u DISPLAY sh" if target.container else "sh"
        # Drain output beyond the cap so a chatty job never blocks or receives SIGPIPE at the limit.
        script = ('mkdir -p "$1" || exit; '
                  '{ { timeout --signal=TERM --kill-after=2 "$2" ' + shell + ' -lc "$3"; echo $? > "$5"; } 2>&1 '
                  '| { head -c "$6"; cat >/dev/null; }; } > "$4"')
        args = exec_args(target, ["sh", "-c", script, "sh", f"{GUEST}/.raphael-jobs", str(timeout),
                                  f"cd {GUEST} && {command}", f"{base}.log", f"{base}.exit", str(JOB_LOG_MAX)],
                         detached=True, env=tuple(keys or ()))
        result = await self.run_for(target, args, timeout=30, **({"env": keys} if keys else {}))
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
            self.relocate_soon()
            await self.settled()
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
        # A move under way can only be waiting for the engine: each rename is whole, and a folder is used wherever it is.
        if self.relocation is not None and not self.relocation.done():
            self.relocation.cancel()
            await asyncio.gather(self.relocation, return_exceptions=True)
        # A carry still copying ends with the core. The copy in its container finishes by itself.
        for carrying, _ in self.carry_tasks.values():
            carrying.cancel()
        await asyncio.gather(*(carrying for carrying, _ in self.carry_tasks.values()), return_exceptions=True)
        self.carry_tasks.clear()
        for pending in self.preparing.values():
            pending.cancel()
        await asyncio.gather(*self.preparing.values(), return_exceptions=True)
        self.preparing.clear()
        # A removal under way ends with the core; the engine finishes or refuses the one image it was asked about.
        for pending in self.image_tasks.values():
            pending.cancel()
        await asyncio.gather(*self.image_tasks.values(), return_exceptions=True)
        self.image_tasks.clear()
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

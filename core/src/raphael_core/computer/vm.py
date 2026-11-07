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
import math
import os
import re
import secrets
import time
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

BASE = "docker.io/trycua/xfce-cua@sha256:274eb636f5cf3fc58f705916ee72b7a701270b3877369d08533a385c5325be9b"
VERSION = "0.37.0"
IMAGE = "raphael/cua-local-vm:driver-0.37.0-v4"
GUEST = "/home/cua/workspace"
SHARED = "/home/cua/team"
MEMORY_GB = 3
LOCAL_LIMIT = 2
PREFLIGHT_S = 45.0
DRIVER = "/usr/local/libexec/raphael/cua-driver"
SOCKET = "/run/user/1000/raphael-cua.sock"
LABEL = "org.raphael.computer"
IMAGE_LABELS = {LABEL: "1", f"{LABEL}.driver": VERSION, f"{LABEL}.base": BASE, f"{LABEL}.layer": "4"}
MAX_OUTPUT = 50_000  # what a task may be shown of a result at most (`worker.guards`)
# The longest a command may be waited for, and the longest a job started in the background may run.
FOREGROUND_S = 1800
BACKGROUND_S = 21_600
WALLPAPER_SETUP_S = 5
# The owner's own JPEG stays in their data folder: this repository is public, and art they supply must never enter it.
OWN_WALLPAPER = "computer-wallpaper.jpg"
OWN_WALLPAPER_BYTES = 8_000_000
GUEST_OWN_WALLPAPER = "/opt/raphael-desktop/wallpapers/own.jpg"
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

    async def __call__(self, args, *, timeout=15, limit=MAX_OUTPUT, progress=None):
        from .desktop_host import NO_WINDOW
        process = await asyncio.create_subprocess_exec(
            *self.argv(args), stdin=asyncio.subprocess.DEVNULL, creationflags=NO_WINDOW,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )

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
                out, err = await asyncio.gather(drain(process.stdout), drain(process.stderr))
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


def mount_arg(path, destination=GUEST, *, remote=False):
    stream = io.StringIO(newline="")
    csv.writer(stream, lineterminator="").writerow(["type=volume" if remote else "type=bind", f"source={path}", f"target={destination}"])
    return stream.getvalue()


def timezone_name(tz):
    try:
        return ZoneInfo(tz).key
    except (TypeError, ValueError, ZoneInfoNotFoundError):
        return "UTC"


def run_args(target, owner, password, *, tz=None):
    zone = timezone_name(tz)
    args = ["run", "-d", "--name", target.name, "--hostname", target.name]
    for key, value in {**IMAGE_LABELS, f"{LABEL}.owner": owner, f"{LABEL}.target": target.key}.items():
        args += ["--label", f"{key}={value}"]
    return args + [
        "--restart", "no", "--memory", f"{MEMORY_GB}g", "--memory-swap", f"{MEMORY_GB}g", "--cpus", "2",
        "--pids-limit", "4096", "--ipc", "private", "--cgroupns", "private",
        "--cap-drop", "ALL", "--cap-add", "SETUID", "--cap-add", "SETGID", "--shm-size", "512m",
        "--mount", mount_arg(target.workspace, remote=bool(target.remote)),
        *(["--mount", mount_arg(target.shared, SHARED, remote=bool(target.remote))] if target.shared else []),
        "-e", f"VNC_PW={password}",
        "-e", f"TZ={zone}",
        "-p", "127.0.0.1::6901", IMAGE,
    ]


def exec_args(target, command, *, interactive=False, detached=False):
    return ["exec", *(["-i"] if interactive else []), *(["-d"] if detached else []), "-u", "cua", "-e", "HOME=/home/cua",
            "-e", "DISPLAY=:1", "-e", "CUA_DRIVER_INSTALL_CHANNEL=python_package",
            "-e", "CUA_DRIVER_RS_TELEMETRY_ENABLED=0", target.name, *command]


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
        expected = {**IMAGE_LABELS, f"{LABEL}.owner": owner, f"{LABEL}.target": target.key}
        mounts = raw["Mounts"]
        configured_mounts = host.get("Mounts", mounts)
        ports = host.get("PortBindings", {})
        caps = lambda values: {v.upper().removeprefix("CAP_") for v in values or []}
        return (
            all(labels.get(k) == v for k, v in expected.items()) and raw["Image"] == image_id
            and host.get("Privileged") is False and caps(host.get("CapDrop")) == {"ALL"}
            and caps(host.get("CapAdd")) == {"SETUID", "SETGID"}
            and host.get("IpcMode") == "private" and host.get("CgroupnsMode") == "private"
            and not any(host.get(k) for k in ("PidMode", "UTSMode", "UsernsMode", "Devices", "DeviceRequests", "AutoRemove"))
            and host.get("NetworkMode") not in ("host", "none")
            and not any("unconfined" in x or "disable" in x for x in host.get("SecurityOpt") or [])
            and host.get("RestartPolicy", {}).get("Name", "no") in ("", "no")
            and host.get("Memory") == MEMORY_GB * 1024**3 and host.get("MemorySwap") == MEMORY_GB * 1024**3
            and host.get("NanoCpus") == 2_000_000_000 and host.get("PidsLimit") == 4096
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


class LocalVm:
    def __init__(self, data_dir, *, settings=None, runner=None, clock=time.monotonic, enabled=True):
        self.root = Path(data_dir).resolve()
        self.owner = hashlib.sha256(os.path.normcase(str(self.root)).encode()).hexdigest()[:16]
        self.enabled = enabled
        self.settings, self.run, self.clock = settings, runner or Docker(), clock
        self.last_activity, self.active, self.held = {}, {}, set()
        from .grants import ComputerGrants
        self.grants = ComputerGrants()
        self.locks, self.targets = {}, {}
        self.task = None
        self.busy = lambda key: False
        self.timezone = lambda: None
        self.timezone_pending = False
        from .desktop_host import DockerDesktop
        # Injected Docker runners never launch a real host application in tests.
        self._desktop = DockerDesktop() if runner is None else None
        self.capacity_lock = asyncio.Lock()
        self.tunnels = {}
        self.preparation, self.preparing = {}, {}
        self.wallpaper_attempted = set()
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
        self.maintenance, self.lifecycle = {}, {}
        self.disk_checked, self.disk_warned = {}, set()
        async def disconnect_driver(key):
            pass
        self.disconnect_driver = disconnect_driver
        self.repair_notice = lambda target: None
        self.repair_admit = lambda target: True
        self.repair_revisions = {}

    def record_repair(self, target):
        self.repair_revisions[target.key] = self.repair_revisions.get(target.key, 0) + 1
        self.repair_notice(target)

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
        self.preparation[target.key] = {"state": state, "ready": False,
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
            try:
                await self.desktop.start()
            except (OSError, AttributeError):
                raise VmError("docker_start_failed") from None
            try:
                async with asyncio.timeout(120):
                    while not await self.available(target):
                        await asyncio.sleep(1)
            except TimeoutError:
                raise VmError("docker_start_timeout") from None

    def launch(self, target):
        """Viewer opens immediately; preparation belongs to the shared VM lifecycle."""
        if target.key not in self.preparing or self.preparing[target.key].done():
            self._progress(target, "preparing")

            async def prepare():
                try:
                    await self.start(target)
                except (VmError, OSError, TimeoutError) as error:
                    self.preparation[target.key] = {"state": "unavailable", "ready": False,
                        "error": str(error) if isinstance(error, VmError) else "start_failed"}

            self.preparing[target.key] = asyncio.create_task(prepare())

    def target(self, member_id=0):
        mode = "per-bot" if self.settings is None else self.settings.get("computer_vm_mode")
        key = "shared" if mode == "shared" else hashlib.sha256((self.remote + ":" + str(member_id) if self.remote else str(member_id)).encode()).hexdigest()[:16]
        name = f"raphael-computer-{self.owner}-{key}"
        target = Target(key, name,
                        PurePosixPath(name + "-workspace") if self.remote else self.root / "vm-homes" / key,
                        PurePosixPath(f"raphael-computer-{self.owner}-team") if self.remote else self.root / "vm-shared",
                        self.remote)
        self.targets[key] = target
        return target

    async def available(self, target=None):
        if not self.enabled:
            return False
        try:
            target = target or self.target()
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
        if running and probe:
            version = await self.run_for(target, exec_args(target, [DRIVER, "--version"]))
            health = await self.run_for(target, exec_args(target, [DRIVER, "call", "health_report", "{}", "--socket", SOCKET]))
            ready = version.code == health.code == 0 and version.stdout.strip() == f"cua-driver {VERSION}" and healthy(health.stdout)
        if not running or probe and not ready:
            self.invalidate(target)
        bindings = raw.get("NetworkSettings", {}).get("Ports", {}).get("6901/tcp") or []
        port = next((int(p["HostPort"]) for p in bindings if p.get("HostIp") == "127.0.0.1" and str(p.get("HostPort", "")).isdigit()), None)
        url = f"http://127.0.0.1:{port}/vnc.html#autoconnect=true&resize=scale&view_only=true" if port and not target.remote else ""
        return {"state": "running" if running else "stopped", "ready": ready, "viewer_url": url}

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
        if target.key in self.maintenance and self.maintenance[target.key] is not asyncio.current_task():
            raise VmError("busy")
        if (state := self._recent_start(target)) is not None:
            return state
        if target.remote:
            return await self._confirmed_start(target)
        # Capacity always precedes target locks: eviction may need another target's lock.
        async with self.capacity_lock:
            return await self._confirmed_start(target)

    def invalidate(self, target):
        self.running.pop(target, None)
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
        kept = self.running.get(target)
        if kept and kept[1] == self._start_signature() and 0 <= self.clock() - kept[0] < PREFLIGHT_S:
            return dict(kept[2])
        return None

    async def _confirmed_start(self, target):
        if (state := self._recent_start(target)) is not None:
            return state
        self.invalidate(target)
        state = await self._prepare_start(target)
        if state.get("ready"):
            self.running[target] = self.clock(), self._start_signature(), dict(state)
        return state

    async def _prepare_start(self, target):
        async with self.locks.setdefault(target.key, asyncio.Lock()):
            self.changes += 1
            try:
                await self.ensure_engine(target)
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
                self.preparation.pop(target.key, None)
                self.changes += 1

    async def _make_room(self, target):
        if target.remote or (await self.status(target, probe=False))["state"] == "running":
            return
        await self.recover()
        running = []
        protected = set()
        for other in list(self.targets.values()):
            if other.remote or other.key == target.key:
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
            if target.key in self.maintenance:
                raise VmError("local_capacity")  # Owner maintenance never evicts another computer.
            candidates = [other for other in running if other.key not in protected and not self.active.get(other.key)
                          and other.key not in self.held and not self.busy(other.key)]
            if not candidates:
                raise VmError("local_capacity")
            victim = min(candidates, key=lambda other: self.last_activity.get(other.key, 0))
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
            self.wallpaper_attempted.discard((target.remote, target.name))
        if state["state"] == "missing":
            if not state.get("image"):
                raise VmError("image_missing")
            if not target.remote:
                target.workspace.mkdir(parents=True, exist_ok=True, mode=0o700)
                target.shared.mkdir(parents=True, exist_ok=True, mode=0o700)
            self.validate_storage(target)
            result = await self.run_for(target, run_args(target, self.owner, secrets.token_urlsafe(24), tz=zone), timeout=60)
        elif state["state"] == "stopped":
            result = await self.run_for(target, ["start", target.name], timeout=60)
            if not result.code and self.active.get(target.key) and target.key not in self.maintenance:
                self.record_repair(target)
        else:
            result = Result(0)
        if result.code:
            raise VmError("start_failed")
        self.last_activity[target.key] = self.clock()
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
            if attempt == 0 and already_running and state["state"] == "running" and target.key not in self.held and self.active.get(target.key, 0) <= 1:
                socket = await self.run_for(target, exec_args(target, ["test", "-S", SOCKET]), timeout=5)
                if socket.code and self.repair_admit(target):
                    if (await self.run_for(target, ["restart", "--time", "10", target.name], timeout=60)).code:
                        raise VmError("start_failed")
                    self.record_repair(target)
            await asyncio.sleep(1)
        raise VmError("health_timeout")

    async def _upgrade_image(self, target):
        import copy
        raw = await self.inspect(target)
        image_id = await self.image(target)
        # Only known image or remote binding upgrades on otherwise exactly compatible
        # owned computers may rebuild. Workspace volumes are never removed.
        previous = copy.deepcopy(raw) if raw else {}
        labels = previous.get("Config", {}).get("Labels") or {}
        host = previous.get("HostConfig", {})
        known_previous = labels.get(f"{LABEL}.layer") == "3" and host.get("Memory") == host.get("MemorySwap") == 2 * 1024**3
        if known_previous:
            labels[f"{LABEL}.layer"] = IMAGE_LABELS[f"{LABEL}.layer"]
            host.update(Memory=MEMORY_GB * 1024**3, MemorySwap=MEMORY_GB * 1024**3)
        legacy_remote = bool(target.remote and host.get("PortBindings") in (None, {}))
        if legacy_remote:
            host["PortBindings"] = {"6901/tcp": [{"HostIp": "127.0.0.1", "HostPort": ""}]}
        image_upgrade = known_previous and raw.get("Image") != image_id
        if (not raw or not image_id or not (legacy_remote and raw.get("Image") == image_id or image_upgrade)
                or not compatible(previous, target, self.owner, raw.get("Image"))):
            raise VmError("incompatible")
        if target.key in self.held or self.active.get(target.key, 0) > 1:
            raise VmError("busy")
        self.rebuild_notice(target)
        if raw.get("State", {}).get("Running") and (await self.run_for(target, ["stop", "--time", "10", target.name], timeout=30)).code:
            raise VmError("stop_failed")
        if (await self.run_for(target, ["rm", target.name])).code:
            raise VmError("remove_failed")
        self.invalidate(target)
        return {"state": "missing", "image": True}

    async def _wallpaper(self, target):
        key = (target.remote, target.name)
        if key in self.wallpaper_attempted:
            return
        self.wallpaper_attempted.add(key)
        script = r'''command -v pgrep >/dev/null 2>&1 || exit 0
watcher='^/opt/venv/bin/python /opt/raphael-desktop/wallpaper[.]py( |$)'
pgrep -f "$watcher" >/dev/null 2>&1
[ "$?" = 1 ] || exit 0
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
pgrep -f "$watcher" >/dev/null 2>&1
[ "$?" = 1 ] || exit 0
export DBUS_SESSION_BUS_ADDRESS="$address"
exec /opt/venv/bin/python /opt/raphael-desktop/wallpaper.py --watch'''
        try:
            # Decoration cannot delay a ready desktop or change a tool's result.
            async with asyncio.timeout(WALLPAPER_SETUP_S):
                desktop = Path(__file__).parent / "image" / "desktop"
                for source, destination in ((desktop / "wallpaper.py", "wallpaper.py"), (desktop / "wallpapers", "")):
                    result = await self.run_for(target, ["cp", str(source), f"{target.name}:/opt/raphael-desktop/{destination}"], timeout=2)
                    if result.code:
                        return
                own = self.own_wallpaper()
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
                if target.key in self.held:
                    raise VmError("owner_holds_control")
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
            for target in list(self.targets.values()):
                async with self.locks.setdefault(target.key, asyncio.Lock()):
                    if self.active.get(target.key) or target.key in self.held or self.busy(target.key):
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
        async with self.locks.setdefault(target.key, asyncio.Lock()):
            if self.active.get(target.key, 0) or target.key in self.held:
                raise VmError("busy")
            state = await self.status(target, probe=False)
            if state["state"] == "incompatible" and captured_image:
                raw = await self.inspect(target)
                if raw and raw.get("Image") == captured_image and compatible(raw, target, self.owner, captured_image):
                    state = {"state": "running" if raw.get("State", {}).get("Running") else "stopped"}
            if state["state"] == "missing":
                self.wallpaper_attempted.discard((target.remote, target.name))
                return
            if state["state"] not in ("running", "stopped"):
                raise VmError(state["state"])
            if self.active.get(target.key, 0) or target.key in self.held or self.busy(target.key):
                raise VmError("busy")
            self.changes += 1
            result = await self.run_for(target, ["stop", "--time", "10", target.name], timeout=30)
            self.changes += 1
            if result.code:
                raise VmError("stop_failed")
            self.wallpaper_attempted.discard((target.remote, target.name))
            if remove and (await self.run_for(target, ["rm", target.name])).code:
                raise VmError("remove_failed")
            await self.close_viewer(target)

    async def close_viewer(self, target):
        tunnel = self.tunnels.pop((target.remote, target.name), None)
        if tunnel:
            await tunnel.close()

    async def delete_member_data(self, member_id, host):
        from ..protocol import invalid_params
        target = self.target(member_id)
        if target.key == "shared" or not member_id or host != target.remote:
            raise invalid_params("Computer host changed or workspace is shared; review deletion again")
        if target.remote:
            if str(target.workspace) != target.name + "-workspace":
                raise invalid_params("Invalid member workspace")
        else:
            root_path = self.root / 'vm-homes'
            root = root_path.resolve()
            workspace = Path(target.workspace)
            if root_path.is_symlink() or not root.is_relative_to(self.root) or workspace.is_symlink() or workspace.resolve() != root / target.key:
                raise invalid_params("Invalid member workspace")
        await self.stop(target, remove=True)
        if target.remote:
            if (await self.run_for(target, ["volume", "rm", str(target.workspace)])).code:
                raise VmError("workspace_remove_failed")
        else:
            import shutil
            if workspace.is_symlink() or not workspace.resolve().is_relative_to(self.root / 'vm-homes'):
                raise invalid_params("Invalid member workspace")
            if workspace.exists():
                await asyncio.to_thread(shutil.rmtree, workspace)

    def hold(self, target, held):
        if held:
            self.held.add(target.key)
        else:
            self.held.discard(target.key)
        self.last_activity[target.key] = self.clock()

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
        args = exec_args(target, ["sh", "-c", script, "sh", pidfile, str(timeout), "sh", "-lc", f"cd {GUEST} && {command}"])
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
        script = ('mkdir -p "$1" && { timeout --signal=TERM --kill-after=2 "$2" sh -lc "$3"; echo $? > "$5"; } > "$4" 2>&1')
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

    async def sweep(self):
        minutes = 15 if self.settings is None else self.settings.get("computer_vm_idle_minutes")
        if minutes == 0:
            return
        for key, last in list(self.last_activity.items()):
            if key in self.maintenance:
                continue
            if self.clock() - last >= minutes * 60 and not self.active.get(key) and key not in self.held and not self.busy(key):
                try:
                    await self.stop(self.targets[key])
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
                target = Target(key, name,
                    PurePosixPath(name + "-workspace") if self.remote else self.root / "vm-homes" / key,
                    PurePosixPath(f"raphael-computer-{self.owner}-team") if self.remote else self.root / "vm-shared", self.remote)
                self.targets[key] = target
                if (await self.status(target, probe=False))["state"] == "running":
                    self.last_activity.setdefault(key, self.clock())

    def start_monitor(self):
        if self.task is None:
            self.task = asyncio.create_task(self._monitor())

    async def _monitor(self):
        try:
            await self.recover()
            while True:
                await asyncio.sleep(30)
                if self.timezone_pending:
                    await self.refresh_timezone()
                await self.sweep()
        except (OSError, TimeoutError, VmError):
            return

    async def aclose(self, *, stop=True):
        for pending in self.preparing.values():
            pending.cancel()
        await asyncio.gather(*self.preparing.values(), return_exceptions=True)
        self.preparing.clear()
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
            self.task = None
        for target in list(self.targets.values()) if stop else []:
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

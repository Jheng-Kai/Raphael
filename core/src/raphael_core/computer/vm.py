"""Docker-only local desktops. Lifecycle and hardening ported from OpenMausBot.

See THIRD_PARTY_NOTICES.md. The engine owns containers; only the workspace survives
removal. No host shell, path translation or alternate runtime.
"""

import asyncio
import csv
import hashlib
import io
import json
import math
import os
import secrets
import time
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

BASE = "docker.io/trycua/xfce-cua@sha256:274eb636f5cf3fc58f705916ee72b7a701270b3877369d08533a385c5325be9b"
VERSION = "0.37.0"
IMAGE = "raphael/cua-local-vm:driver-0.37.0-v1"
GUEST = "/home/cua/workspace"
DRIVER = "/usr/local/libexec/raphael/cua-driver"
SOCKET = "/run/user/1000/raphael-cua.sock"
LABEL = "org.raphael.computer"
IMAGE_LABELS = {LABEL: "1", f"{LABEL}.driver": VERSION, f"{LABEL}.base": BASE, f"{LABEL}.layer": "1"}
MAX_OUTPUT = 20_000


class VmError(Exception):
    """Public failure kind; never contains command output or workspace contents."""


@dataclass
class Result:
    code: int
    stdout: str = ""
    stderr: str = ""
    truncated: bool = False


class Docker:
    async def __call__(self, args, *, timeout=15, limit=MAX_OUTPUT, progress=None):
        process = await asyncio.create_subprocess_exec(
            "docker", *args, stdin=asyncio.subprocess.DEVNULL,
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
    workspace: Path


def mount_arg(path):
    stream = io.StringIO(newline="")
    csv.writer(stream, lineterminator="").writerow(["type=bind", f"source={path}", f"target={GUEST}"])
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
        "--restart", "no", "--memory", "4g", "--memory-swap", "4g", "--cpus", "2",
        "--pids-limit", "4096", "--ipc", "private", "--cgroupns", "private",
        "--cap-drop", "ALL", "--cap-add", "SETUID", "--cap-add", "SETGID", "--shm-size", "512m",
        "--mount", mount_arg(target.workspace), "-e", f"VNC_PW={password}",
        "-e", f"TZ={zone}",
        "-p", "127.0.0.1::6901", IMAGE,
    ]


def exec_args(target, command, *, interactive=False):
    return ["exec", *(["-i"] if interactive else []), "-u", "cua", "-e", "HOME=/home/cua",
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
            and host.get("Memory") == 4 * 1024**3 and host.get("MemorySwap") == 4 * 1024**3
            and host.get("NanoCpus") == 2_000_000_000 and host.get("PidsLimit") == 4096
            and host.get("ShmSize") == 512 * 1024**2
            and len(mounts) == 1 and mounts[0]["Type"] == "bind" and mounts[0]["RW"] is True
            # Docker Desktop may report an engine-side Source in Mounts. Validate
            # the original host path from the mount request without translating it.
            and len(configured_mounts) == 1 and configured_mounts[0]["Type"] == "bind"
            and configured_mounts[0].get("Target", configured_mounts[0].get("Destination")) == GUEST
            and not configured_mounts[0].get("ReadOnly", False)
            and Path(configured_mounts[0]["Source"]).resolve() == target.workspace.resolve()
            and mounts[0]["Destination"] == GUEST
            and set(ports) == {"6901/tcp"} and len(ports["6901/tcp"]) == 1
            and ports["6901/tcp"][0]["HostIp"] == "127.0.0.1"
        )
    except (KeyError, TypeError, AttributeError):
        return False


class LocalVm:
    def __init__(self, data_dir, *, settings=None, runner=None, clock=time.monotonic, enabled=True):
        self.root = Path(data_dir).resolve()
        self.owner = hashlib.sha256(os.path.normcase(str(self.root)).encode()).hexdigest()[:16]
        self.enabled = enabled
        self.settings, self.run, self.clock = settings, runner or Docker(), clock
        self.last_activity, self.active, self.held = {}, {}, set()
        self.locks, self.targets = {}, {}
        self.task = None
        self.busy = lambda key: False
        self.timezone = lambda: None
        self.timezone_pending = False
        from .desktop_host import DockerDesktop
        # Injected Docker runners never launch a real host application in tests.
        self.desktop = DockerDesktop() if runner is None else None
        self.preparation, self.preparing = {}, {}
        self.engine_lock, self.build_lock = asyncio.Lock(), asyncio.Lock()

    async def installed(self):
        return self.enabled and (self.desktop.installed() if self.desktop else await self.available())

    def _progress(self, target, state, text=""):
        # Only fixed-image pull/build output is passed here, never exec output.
        self.preparation[target.key] = {"state": state, "ready": False,
                                        "progress": " ".join(text.split())[:180]}

    async def ensure_engine(self, target):
        if not self.enabled:
            raise VmError("absent")
        async with self.engine_lock:
            if await self.available():
                return
            if not await self.installed():
                raise VmError("absent")
            self._progress(target, "starting")
            try:
                await self.desktop.start()
            except (OSError, AttributeError):
                raise VmError("docker_start_failed") from None
            try:
                async with asyncio.timeout(120):
                    while not await self.available():
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
        mode = "shared" if self.settings is None else self.settings.get("computer_vm_mode")
        key = "shared" if mode == "shared" else hashlib.sha256(str(member_id).encode()).hexdigest()[:16]
        target = Target(key, f"raphael-computer-{self.owner}-{key}", self.root / "vm-homes" / key)
        self.targets[key] = target
        return target

    async def available(self):
        if not self.enabled:
            return False
        try:
            result = await self.run(["info", "--format", "{{.OSType}}"], timeout=5)
            return result.code == 0 and result.stdout.strip() == "linux"
        except (OSError, TimeoutError):
            return False

    async def image(self):
        result = await self.run(["image", "inspect", IMAGE], limit=100_000)
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
        result = await self.run(["container", "inspect", target.name], limit=200_000)
        if result.code:
            # An unavailable engine is not evidence that a container does not exist.
            if not await self.available():
                raise VmError("unavailable")
            return None
        try:
            return json.loads(result.stdout)[0]
        except (ValueError, IndexError, TypeError):
            raise VmError("invalid_status") from None

    async def status(self, target, *, probe=True):
        if not await self.available():
            return {"state": "unavailable", "ready": False}
        image_id = await self.image()
        raw = await self.inspect(target)
        if raw is None:
            return {"state": "missing", "image": bool(image_id), "ready": False}
        if not image_id or not compatible(raw, target, self.owner, image_id):
            return {"state": "incompatible", "ready": False}
        running = raw.get("State", {}).get("Running") is True
        ready = False
        if running and probe:
            version = await self.run(exec_args(target, [DRIVER, "--version"]))
            health = await self.run(exec_args(target, [DRIVER, "call", "health_report", "{}", "--socket", SOCKET]))
            ready = version.code == health.code == 0 and version.stdout.strip() == f"cua-driver {VERSION}" and healthy(health.stdout)
        bindings = raw.get("NetworkSettings", {}).get("Ports", {}).get("6901/tcp") or []
        port = next((int(p["HostPort"]) for p in bindings if p.get("HostIp") == "127.0.0.1" and str(p.get("HostPort", "")).isdigit()), None)
        url = f"http://127.0.0.1:{port}/vnc.html#autoconnect=true&resize=scale&view_only=true" if port else ""
        return {"state": "running" if running else "stopped", "ready": ready, "viewer_url": url}

    async def viewer_connection(self, target):
        """Core-only credentials, never a public status, URL or diagnostic."""
        if not await self.available():
            raise VmError("unavailable")
        image_id = await self.image()
        raw = await self.inspect(target)
        if not image_id or not compatible(raw, target, self.owner, image_id) or raw.get("State", {}).get("Running") is not True:
            raise VmError("unavailable")
        bindings = raw.get("NetworkSettings", {}).get("Ports", {}).get("6901/tcp") or []
        port = next((int(p["HostPort"]) for p in bindings if p.get("HostIp") == "127.0.0.1" and str(p.get("HostPort", "")).isdigit()), None)
        if port is None or not 0 < port < 65536:
            raise VmError("unavailable")
        password = next((x[7:] for x in raw["Config"].get("Env", []) if x.startswith("VNC_PW=")), "")
        return port, password

    async def build(self, *, progress=None):
        if not await self.available():
            raise VmError("unavailable")
        result = await self.run(["pull", BASE], timeout=1800, **({"progress": progress} if progress else {}))
        if result.code:
            raise VmError("pull_failed")
        context = Path(__file__).parent / "image"
        result = await self.run(["build", "--progress=plain", "--tag", IMAGE, str(context)], timeout=1800,
                                **({"progress": progress} if progress else {}))
        if result.code or not await self.image():
            raise VmError("build_failed")

    async def start(self, target):
        async with self.locks.setdefault(target.key, asyncio.Lock()):
            try:
                await self.ensure_engine(target)
                async with self.build_lock:
                    if not await self.image():
                        self._progress(target, "building")
                        await self.build(progress=lambda text: self._progress(target, "building", text))
                self._progress(target, "preparing")
                return await self._start(target)
            finally:
                self.preparation.pop(target.key, None)

    async def _start(self, target):
        state = await self.status(target, probe=False)
        if state["state"] in ("unavailable", "incompatible"):
            raise VmError(state["state"])
        zone = timezone_name(self.timezone())
        state = await self._reconcile_timezone(target, state, zone)
        if state["state"] == "missing":
            if not state.get("image"):
                raise VmError("image_missing")
            target.workspace.mkdir(parents=True, exist_ok=True, mode=0o700)
            result = await self.run(run_args(target, self.owner, secrets.token_urlsafe(24), tz=zone), timeout=60)
        elif state["state"] == "stopped":
            result = await self.run(["start", target.name], timeout=60)
        else:
            result = Result(0)
        if result.code:
            raise VmError("start_failed")
        self.last_activity[target.key] = self.clock()
        for _ in range(45):
            state = await self.status(target)
            if state["ready"]:
                return state
            await asyncio.sleep(1)
        raise VmError("health_timeout")

    async def _reconcile_timezone(self, target, state, zone, *, keep_stopped=False):
        if state["state"] in ("running", "stopped") and self.timezone():
            raw = await self.inspect(target)
            if not compatible(raw, target, self.owner, await self.image()):
                raise VmError("incompatible")
            if f"TZ={zone}" not in raw["Config"].get("Env", []):
                if target.key in self.held:
                    raise VmError("owner_holds_control")
                # Only status-validated, owned containers reach this path. Docker
                # cannot change their environment; the bind workspace survives.
                if state["state"] == "running" and (await self.run(["stop", "--time", "10", target.name], timeout=30)).code:
                    raise VmError("stop_failed")
                if (await self.run(["rm", target.name])).code:
                    raise VmError("remove_failed")
                if keep_stopped and state["state"] == "stopped":
                    args = run_args(target, self.owner, secrets.token_urlsafe(24), tz=zone)
                    args[:2] = ["create"]
                    if (await self.run(args, timeout=60)).code:
                        raise VmError("start_failed")
                    return state
                state = {"state": "missing", "image": True}
        return state

    async def refresh_timezone(self):
        """Reconcile desktops created before Home supplied the owner's zone."""
        self.timezone_pending = True
        if not self.timezone() or not await self.available():
            return
        await self.recover()
        self.timezone_pending = False
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

    async def stop(self, target, *, remove=False):
        async with self.locks.setdefault(target.key, asyncio.Lock()):
            if self.active.get(target.key, 0) or target.key in self.held:
                raise VmError("busy")
            state = await self.status(target, probe=False)
            if state["state"] == "missing":
                return
            if state["state"] not in ("running", "stopped"):
                raise VmError(state["state"])
            result = await self.run(["stop", "--time", "10", target.name], timeout=30)
            if result.code:
                raise VmError("stop_failed")
            if remove and (await self.run(["rm", target.name])).code:
                raise VmError("remove_failed")

    def hold(self, target, held):
        if held:
            self.held.add(target.key)
        else:
            self.held.discard(target.key)
        self.last_activity[target.key] = self.clock()

    async def execute(self, target, command, timeout=60):
        if not isinstance(command, str) or not command.strip() or len(command) > 16_000:
            raise VmError("bad_arguments")
        if type(timeout) not in (int, float) or not math.isfinite(timeout) or not 0 < timeout <= 300:
            raise VmError("bad_arguments")
        # The guest timeout also ends the process when the host docker client is cancelled.
        token = secrets.token_hex(16)
        script = 'echo $$ > "$1"; shift; exec timeout --signal=TERM --kill-after=2 "$@"'
        pidfile = f"/tmp/raphael-exec-{token}.pid"
        args = exec_args(target, ["sh", "-c", script, "sh", pidfile, str(timeout), "sh", "-lc", f"cd {GUEST} && {command}"])
        try:
            result = await self.run(args, timeout=timeout + 5)
            output = (result.stdout + result.stderr)[:MAX_OUTPUT]
            return {"exit_code": result.code, "output": output, "truncated": result.truncated or len(result.stdout + result.stderr) > MAX_OUTPUT}
        except (asyncio.CancelledError, TimeoutError):
            await asyncio.shield(self.run(exec_args(target, ["sh", "-c", 'if test -f "$1"; then kill -TERM "$(cat "$1")" 2>/dev/null || true; fi', "sh", pidfile])))
            raise
        finally:
            await asyncio.shield(self.run(exec_args(target, ["rm", "-f", pidfile])))

    async def read_file(self, target, guest_path, *, limit):
        path = PurePosixPath(guest_path) if isinstance(guest_path, str) else PurePosixPath("/")
        if not path.is_absolute() or ".." in path.parts or not path.is_relative_to(GUEST):
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
        result = await self.run(exec_args(target, ["/opt/venv/bin/python", "-c", script, GUEST, str(path.relative_to(GUEST)), str(limit)]), timeout=30, limit=limit * 2)
        if result.code or result.truncated:
            raise VmError("file_unavailable")
        import base64
        try:
            return base64.b64decode(result.stdout.strip(), validate=True)
        except ValueError:
            raise VmError("file_unavailable") from None

    async def sweep(self):
        minutes = 480 if self.settings is None else self.settings.get("computer_vm_idle_minutes")
        for key, last in list(self.last_activity.items()):
            if self.clock() - last >= minutes * 60 and not self.active.get(key) and key not in self.held and not self.busy(key):
                try:
                    await self.stop(self.targets[key])
                    self.last_activity.pop(key, None)
                except (VmError, OSError, TimeoutError):
                    pass

    async def recover(self):
        if not await self.available():
            return
        result = await self.run(["ps", "-a", "--filter", f"label={LABEL}.owner={self.owner}", "--format", "{{.Names}}"])
        if result.code:
            return
        prefix = f"raphael-computer-{self.owner}-"
        for name in result.stdout.splitlines():
            key = name.removeprefix(prefix)
            if name.startswith(prefix) and (key == "shared" or len(key) == 16 and all(c in "0123456789abcdef" for c in key)):
                target = Target(key, name, self.root / "vm-homes" / key)
                self.targets[key] = target
                if (await self.status(target, probe=False))["state"] == "running":
                    self.last_activity[key] = self.clock()

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

    async def aclose(self):
        for pending in self.preparing.values():
            pending.cancel()
        await asyncio.gather(*self.preparing.values(), return_exceptions=True)
        self.preparing.clear()
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
            self.task = None

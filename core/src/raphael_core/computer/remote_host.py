"""Owned SSH Docker/socket and SOCKS forwards; no remote lifecycle commands."""

import asyncio
import re
import tempfile
import time
from pathlib import Path

from .desktop_host import NO_WINDOW
from .ssh_tunnel import viewer_target, viewer_stderr
from ..storage import owner_only_directory


def checked_alias(alias):
    if not isinstance(alias, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", alias):
        raise ValueError("Invalid SSH config alias")
    return alias


def ssh_args(alias):
    return ["ssh", "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "PermitLocalCommand=no",
            "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=2", checked_alias(alias)]


async def _login_user(alias, run):
    """The user name ssh logs in with for `alias`, read locally from `ssh -G` (no connection). An IP
    without a config entry logs in as this computer's user, often not the host's account."""
    try:
        code, out, _ = await run(["ssh", "-G", checked_alias(alias)])
    except (OSError, TimeoutError):
        return ""
    if code:
        return ""
    user = next((line.split(None, 1)[1].strip() for line in out.splitlines() if line.lower().startswith("user ") and len(line.split(None, 1)) > 1), "")
    return user if re.fullmatch(r"[A-Za-z0-9._-]{1,64}", user) else ""


async def host_health(alias, *, run=None):
    """Read-only noninteractive checks. Return classifications, never raw SSH diagnostics."""
    checked_alias(alias)
    async def execute(args):
        process = await asyncio.create_subprocess_exec(*args, stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, creationflags=NO_WINDOW)
        try:
            async with asyncio.timeout(15):
                stdout, stderr = await process.communicate()
            return process.returncode, stdout[:16384].decode("utf-8", errors="replace"), stderr[:16384].decode("utf-8", errors="replace")
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()
    run = run or execute
    from .vm import IMAGE
    try:
        # Only the two architectures are read: Docker Desktop's whole `docker info` JSON and the image's
        # passed the 16 KiB read together, the image line was cut, and a matching arm64 host read as unsupported.
        code, out, err = await run([*ssh_args(alias), "command -v docker >/dev/null 2>&1 || { test -x /usr/local/bin/docker -o -x /opt/homebrew/bin/docker -o -x /Applications/Docker.app/Contents/Resources/bin/docker && exit 42; exit 43; }; "
            "docker info --format '{{.Architecture}}' || exit 44; " + f"docker image inspect {IMAGE} --format '{{{{.Architecture}}}}' || exit 45"])
    except (OSError, TimeoutError):
        return {"host": alias, "ok": False, "checks": [{"kind": "ssh_unreachable", "ok": False}]}
    checks = []
    if code == 255:
        kind = "ssh_key" if "permission denied" in err.lower() or "authentication" in err.lower() else "ssh_unreachable"
        check = {"kind": kind, "ok": False}
        if kind == "ssh_key" and (user := await _login_user(alias, run)):
            check["user"] = user
        checks.append(check)
    else:
        checks.append({"kind": "ssh", "ok": True})
        if code and code != 45:
            checks.append({"kind": "docker_path" if code == 42 else "docker_missing" if code == 43 else "docker_stopped", "ok": False})
        else:
            checks.append({"kind": "docker", "ok": True})
            normalize = lambda value: {"x86_64": "amd64", "aarch64": "arm64"}.get(value, value)
            lines = [line.strip() for line in out.splitlines() if line.strip()]
            architecture = normalize(lines[0]) if lines else ""
            image = normalize(lines[1]) if len(lines) > 1 else ""
            if code == 45:
                checks.append({"kind": "image_missing", "ok": False})
            else:
                checks.append({"kind": "architecture", "ok": bool(architecture and architecture == image),
                    "architecture": architecture if architecture in ("amd64", "arm64") else "unknown"})
    return {"host": alias, "ok": all(check["ok"] for check in checks), "checks": checks}


class RemoteSession:
    def __init__(self, alias, *, launch=None, clock=time.monotonic):
        self.alias, self.launch, self.clock = checked_alias(alias), launch or asyncio.create_subprocess_exec, clock
        self.process = None
        self.directory = None
        self.socket_endpoint = None
        self.retry_at, self.failures = 0, 0
        self.lock = asyncio.Lock()

    async def endpoint(self):
        async with self.lock:
            if self.process and self.process.returncode is None:
                return self.socket_endpoint
            if self.process:
                self.failures += 1
                self.retry_at = self.clock() + min(30, 2 ** min(self.failures, 5))
                await self._close()
                return None
            if self.clock() < self.retry_at:
                return None
            await self._close()
            try:
                path = self._socket_path()
                self.socket_endpoint = "unix://" + path.as_posix()
                args = ssh_args(self.alias)
                args[-1:-1] = ["-N", "-o", "ExitOnForwardFailure=yes", "-o", "StreamLocalBindMask=0177",
                              "-L", f"{path.as_posix()}:/var/run/docker.sock"]
                self.process = await self.launch(*args, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.DEVNULL,
                                                 stderr=asyncio.subprocess.DEVNULL, creationflags=NO_WINDOW)
                if await self._probe(self.socket_endpoint) and self.process.returncode is None:
                    self.failures = 0
                    return self.socket_endpoint
            except (OSError, TimeoutError):
                pass
            except BaseException:
                await self._close()
                raise
            await self._close()
            self.failures += 1
            self.retry_at = self.clock() + min(30, 2 ** min(self.failures, 5))
            return None

    def _socket_path(self):
        self.directory = Path(tempfile.mkdtemp(prefix="raphael-ssh-"))
        owner_only_directory(self.directory)
        return self.directory / "docker.sock"

    async def _probe(self, endpoint):
        # This also checks Docker CLI support; unsupported Windows AF_UNIX clients fail closed.
        from .vm import docker_cli
        async with asyncio.timeout(5):
            while not Path(endpoint.removeprefix("unix://")).exists():
                if self.process.returncode is not None:
                    return False
                await asyncio.sleep(0.05)
        process = await self.launch(docker_cli(), "--host", endpoint, "version", "--format", "{{.Server.Version}}",
            stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL, creationflags=NO_WINDOW)
        try:
            return await asyncio.wait_for(process.wait(), 10) == 0
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()

    async def connect_viewer(self, address, port=6901):
        destination = viewer_target(address, port)
        args = ssh_args(self.alias)
        args[-1:-1] = ["-W", destination]
        process = await self.launch(*args, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE, creationflags=NO_WINDOW)
        return process.stdout, _ViewerWriter(process)

    async def close(self):
        async with self.lock:
            await self._close()

    async def _close(self):
        if self.process:
            if self.process.returncode is None:
                self.process.kill()
            await self.process.wait()
        self.process = None
        self.socket_endpoint = None
        if self.directory:
            # Only remove our one socket and empty temporary directory, never a recursive tree.
            (self.directory / "docker.sock").unlink(missing_ok=True)
            self.directory.rmdir()
            self.directory = None


class _ViewerWriter:
    def __init__(self, process):
        self.process = process
        self.diagnostics = asyncio.create_task(viewer_stderr(process.stderr))
    def write(self, data): self.process.stdin.write(data)
    async def drain(self): await self.process.stdin.drain()
    def close(self):
        self.process.stdin.close()
        if self.process.returncode is None:
            self.process.kill()
    async def wait_closed(self):
        await self.process.wait()
        await self.diagnostics


class SharedViewerTunnel:
    def __init__(self, session):
        self.session, self.server, self.tasks = session, None, set()
        self.address = None

    async def open(self, alias, address, remote_port=6901):
        viewer_target(address, remote_port)
        destination = (address, remote_port)
        if self.server and self.address == destination:
            return self.server.sockets[0].getsockname()[1]
        await self.close()
        self.address = destination
        async def accept(reader, writer):
            task = asyncio.current_task()
            self.tasks.add(task)
            upstream = None
            async def pipe(source, destination):
                while chunk := await source.read(65536):
                    destination.write(chunk)
                    await destination.drain()
            try:
                remote, upstream = await self.session.connect_viewer(address, remote_port)
                copies = [asyncio.create_task(pipe(reader, upstream)), asyncio.create_task(pipe(remote, writer))]
                try:
                    await asyncio.wait(copies, return_when=asyncio.FIRST_COMPLETED)
                finally:
                    for copy in copies:
                        copy.cancel()
                    await asyncio.gather(*copies, return_exceptions=True)
            except (OSError, TimeoutError, asyncio.IncompleteReadError):
                pass
            finally:
                for stream in (upstream, writer):
                    if stream:
                        stream.close()
                await asyncio.gather(*(stream.wait_closed() for stream in (upstream, writer) if stream),
                                     return_exceptions=True)
                self.tasks.discard(task)
        self.server = await asyncio.start_server(accept, "127.0.0.1", 0)
        return self.server.sockets[0].getsockname()[1]

    async def close(self):
        if self.server:
            self.server.close()
            await self.server.wait_closed()
            self.server = None
        for task in list(self.tasks):
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)

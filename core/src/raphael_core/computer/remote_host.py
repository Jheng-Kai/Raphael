"""Owned SSH Docker/socket and SOCKS forwards; no remote lifecycle commands."""

import asyncio
import re
import sys
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


async def _ssh_config(alias, run):
    """The user name and host name ssh uses for `alias`, read locally from `ssh -G` (no connection). An IP
    without a config entry logs in as this computer's user, often not the host's account."""
    try:
        code, out, _ = await run(["ssh", "-G", checked_alias(alias)])
    except (OSError, TimeoutError):
        return "", ""
    if code:
        return "", ""

    def value(name):
        return next((line.split(None, 1)[1].strip() for line in out.splitlines()
                     if line.lower().startswith(name + " ") and len(line.split(None, 1)) > 1), "")
    user, hostname = value("user"), value("hostname")
    return (user if re.fullmatch(r"[A-Za-z0-9._-]{1,64}", user) else "",
            hostname if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,252}", hostname) else "")


# What a macOS non-interactive shell needs to find Docker Desktop's command. No `$` so no local shell expands it.
MAC_PATH = "/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:/usr/sbin:/sbin"


def repair_command(kind, alias, *, os_name="", user="", hostname=""):
    """The one line (or config snippet) that fixes a failed check, or "" when only the owner at the host can (Docker
    Desktop on a Mac cannot be installed over ssh). (owner, 2026-11-11) Every line is pasted into a terminal on this
    computer and reaches the host through `ssh <alias>`: nothing is built from this app's sources, and no `$` or double
    quote inside a quoted part keeps one meaning in PowerShell, cmd and sh."""
    from .vm import IMAGE

    def remote(line, tty=False):
        return f'ssh {"-t " if tty else ""}{alias} "{line}"'
    if kind in ("ssh_unreachable", "ssh_hostkey"):
        return f"ssh {alias}"
    if kind == "ssh_hostkey_changed":
        return f"ssh-keygen -R {hostname or alias}"
    if kind == "ssh_alias_unknown":
        return f"Host {alias}\n  HostName HOST_ADDRESS\n  User ACCOUNT_ON_HOST\n  IdentityFile ~/.ssh/id_ed25519"
    if kind == "ssh_key":
        install = ("Get-Content $env:USERPROFILE\\.ssh\\id_ed25519.pub | " + remote("mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys")
                   if sys.platform == "win32" else f"ssh-copy-id {alias}")
        return "ssh-keygen -t ed25519\n" + install
    if kind == "docker_path":
        if os_name == "darwin":
            return remote(f"echo 'export PATH={MAC_PATH}' >> ~/.zshenv")
        return remote("sudo ln -s /usr/local/bin/docker /usr/bin/docker", tty=True) if os_name == "linux" else ""
    if kind == "docker_missing":
        return remote("curl -fsSL https://get.docker.com | sh", tty=True) if os_name == "linux" else ""
    if kind == "docker_stopped":
        return remote("sudo systemctl start docker", tty=True) if os_name == "linux" else remote("open -a Docker") if os_name == "darwin" else ""
    if kind == "docker_access":
        return remote(f"sudo usermod -aG docker {user}", tty=True) if os_name == "linux" and user else ""
    if kind == "architecture":
        # The next start prepares an image for this host's architecture; only the stale copy has to go.
        return remote(f"docker image rm {IMAGE}")
    return ""


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

    def failed(kind, *, user="", **context):
        command = repair_command(kind, alias, user=user, **context)
        return {"kind": kind, "ok": False, **({"user": user} if user and kind == "ssh_key" else {}), **({"command": command} if command else {})}

    try:
        # The first line says which system answers (Linux or Darwin), so the repair is the one that host needs. Only the
        # two architectures are read after it: Docker Desktop's whole `docker info` JSON and the image's
        # passed the 16 KiB read together, the image line was cut, and a matching arm64 host read as unsupported.
        code, out, err = await run([*ssh_args(alias), "uname -s; command -v docker >/dev/null 2>&1 || { test -x /usr/local/bin/docker -o -x /opt/homebrew/bin/docker -o -x /Applications/Docker.app/Contents/Resources/bin/docker && exit 42; exit 43; }; "
            "docker info --format '{{.Architecture}}' || exit 44; " + f"docker image inspect {IMAGE} --format '{{{{.Architecture}}}}' || exit 45"])
    except (OSError, TimeoutError):
        return {"host": alias, "ok": False, "checks": [failed("ssh_unreachable")]}
    checks = []
    if code == 255:
        low = err.lower()
        if "identification has changed" in low:
            kind = "ssh_hostkey_changed"
        elif "host key verification failed" in low:
            kind = "ssh_hostkey"
        elif "permission denied" in low or "authentication" in low:
            kind = "ssh_key"
        elif "could not resolve hostname" in low:
            kind = "ssh_alias_unknown"
        else:
            kind = "ssh_unreachable"
        user, hostname = await _ssh_config(alias, run) if kind in ("ssh_key", "ssh_hostkey_changed") else ("", "")
        checks.append(failed(kind, user=user, hostname=hostname))
    else:
        lines = [line.strip() for line in out.splitlines() if line.strip()]
        os_name = {"linux": "linux", "darwin": "darwin"}.get(lines[0].lower(), "") if lines else ""
        if os_name:
            lines.pop(0)
        checks.append({"kind": "ssh", "ok": True})
        if code and code != 45:
            kind = "docker_path" if code == 42 else "docker_missing" if code == 43 else (
                "docker_access" if "permission denied" in err.lower() else "docker_stopped")
            user = (await _ssh_config(alias, run))[0] if kind == "docker_access" else ""
            checks.append(failed(kind, os_name=os_name, user=user))
        else:
            checks.append({"kind": "docker", "ok": True})
            normalize = lambda value: {"x86_64": "amd64", "aarch64": "arm64"}.get(value, value)
            architecture = normalize(lines[0]) if lines else ""
            image = normalize(lines[1]) if len(lines) > 1 else ""
            shown = architecture if architecture in ("amd64", "arm64") else "unknown"
            if code == 45:
                # A first start pulls and builds the image on this host by itself (vm.py `build`): not a failure.
                checks.append({"kind": "image_pending", "ok": True})
            elif architecture and architecture == image:
                checks.append({"kind": "architecture", "ok": True, "architecture": shown})
            else:
                checks.append({**failed("architecture"), "architecture": shown})
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

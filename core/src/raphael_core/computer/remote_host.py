"""Owned SSH Docker/socket and SOCKS forwards; no remote lifecycle commands."""

import asyncio
import ipaddress
import json
import re
import socket
import time

from .desktop_host import NO_WINDOW


def checked_alias(alias):
    if not isinstance(alias, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", alias):
        raise ValueError("Invalid SSH config alias")
    return alias


def ssh_args(alias):
    return ["ssh", "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "PermitLocalCommand=no",
            "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=2", checked_alias(alias)]


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


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
        code, out, err = await run([*ssh_args(alias), "command -v docker >/dev/null 2>&1 || { test -x /usr/local/bin/docker -o -x /opt/homebrew/bin/docker -o -x /Applications/Docker.app/Contents/Resources/bin/docker && exit 42; exit 43; }; "
            "docker info --format '{{json .}}' || exit 44; " + f"docker image inspect {IMAGE} --format '{{{{json .}}}}' || exit 45"])
    except (OSError, TimeoutError):
        return {"host": alias, "ok": False, "checks": [{"kind": "ssh_unreachable", "ok": False}]}
    checks = []
    if code == 255:
        kind = "ssh_key" if "permission denied" in err.lower() or "authentication" in err.lower() else "ssh_unreachable"
        checks.append({"kind": kind, "ok": False})
    else:
        checks.append({"kind": "ssh", "ok": True})
        if code and code != 45:
            checks.append({"kind": "docker_path" if code == 42 else "docker_missing" if code == 43 else "docker_stopped", "ok": False})
        else:
            checks.append({"kind": "docker", "ok": True})
            try:
                lines = out.splitlines()
                normalize = lambda value: {"x86_64": "amd64", "aarch64": "arm64"}.get(value, value)
                architecture = normalize(json.loads(lines[0]).get("Architecture", ""))
                image = normalize(json.loads(lines[1]).get("Architecture", "")) if len(lines) > 1 else ""
            except (ValueError, AttributeError, IndexError):
                architecture, image = "", ""
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
        self.port = self.socks = None
        self.retry_at, self.failures = 0, 0
        self.lock = asyncio.Lock()

    async def endpoint(self):
        async with self.lock:
            if self.process and self.process.returncode is None:
                return f"tcp://127.0.0.1:{self.port}"
            if self.process:
                self.failures += 1
                self.retry_at = self.clock() + min(30, 2 ** min(self.failures, 5))
                await self._close()
                return None
            if self.clock() < self.retry_at:
                return None
            await self._close()
            self.port, self.socks = free_port(), free_port()
            args = ssh_args(self.alias)
            args[-1:-1] = ["-N", "-o", "ExitOnForwardFailure=yes", "-L", f"127.0.0.1:{self.port}:/var/run/docker.sock", "-D", f"127.0.0.1:{self.socks}"]
            try:
                self.process = await self.launch(*args, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.DEVNULL,
                                                 stderr=asyncio.subprocess.DEVNULL, creationflags=NO_WINDOW)
                async with asyncio.timeout(10):
                    while self.process.returncode is None:
                        try:
                            reader, writer = await asyncio.open_connection("127.0.0.1", self.port)
                            try:
                                writer.write(b"GET /_ping HTTP/1.0\r\nHost: docker\r\n\r\n")
                                await writer.drain()
                                response = await asyncio.wait_for(reader.read(1024), 1)
                                if b"200 OK" in response:
                                    self.failures = 0
                                    return f"tcp://127.0.0.1:{self.port}"
                            finally:
                                writer.close()
                                await writer.wait_closed()
                        except (OSError, TimeoutError):
                            pass
                        await asyncio.sleep(0.1)
            except (OSError, TimeoutError):
                pass
            except BaseException:
                await self._close()
                raise
            await self._close()
            self.failures += 1
            self.retry_at = self.clock() + min(30, 2 ** min(self.failures, 5))
            return None

    async def connect_viewer(self, address):
        ip = ipaddress.IPv4Address(address)
        if not any(ip in ipaddress.IPv4Network(net) for net in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")):
            raise ValueError("Invalid private viewer address")
        if not await self.endpoint():
            raise OSError("SSH forwarding unavailable")
        reader, writer = await asyncio.open_connection("127.0.0.1", self.socks)
        try:
            async with asyncio.timeout(10):
                writer.write(b"\x05\x01\x00")
                await writer.drain()
                if await reader.readexactly(2) != b"\x05\x00":
                    raise OSError("SOCKS authentication refused")
                writer.write(b"\x05\x01\x00\x01" + ip.packed + (6901).to_bytes(2, "big"))
                await writer.drain()
                reply = await reader.readexactly(4)
                if reply[:3] != b"\x05\x00\x00":
                    raise OSError("SOCKS forwarding refused")
                size = {1: 4, 4: 16}.get(reply[3])
                if size is None:
                    size = (await reader.readexactly(1))[0]
                await reader.readexactly(size + 2)
            return reader, writer
        except BaseException:
            writer.close()
            await writer.wait_closed()
            raise

    async def close(self):
        async with self.lock:
            await self._close()

    async def _close(self):
        if self.process:
            if self.process.returncode is None:
                self.process.kill()
            await self.process.wait()
        self.process = None


class SharedViewerTunnel:
    def __init__(self, session):
        self.session, self.server, self.tasks = session, None, set()
        self.address = None

    async def open(self, alias, address):
        if self.server and self.address == address:
            return self.server.sockets[0].getsockname()[1]
        await self.close()
        self.address = address
        async def accept(reader, writer):
            task = asyncio.current_task()
            self.tasks.add(task)
            upstream = None
            async def pipe(source, destination):
                while chunk := await source.read(65536):
                    destination.write(chunk)
                    await destination.drain()
            try:
                remote, upstream = await self.session.connect_viewer(address)
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

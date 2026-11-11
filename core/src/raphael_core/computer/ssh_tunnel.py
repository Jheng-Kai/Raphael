"""Temporary loopback viewer forwards.

Adapted from OpenMausBot (Apache-2.0); see core/packaging/licenses.

Uses the owner's SSH config alias, never keys or an interactive password prompt.
"""

import asyncio
import ipaddress
import logging
import re
import socket

import httpx

from .desktop_host import NO_WINDOW
from ..failures import redact


def viewer_target(address, port):
    ip = ipaddress.IPv4Address(address)
    if str(ip) != "127.0.0.1" and not any(ip in ipaddress.IPv4Network(net) for net in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")):
        raise ValueError("Invalid private viewer address")
    if type(port) is not int or not 1024 <= port <= 65535:
        raise ValueError("Invalid viewer port")
    return f"{ip}:{port}"


async def verify_viewer(port):
    # A local SSH listener alone says nothing about the remote destination.
    async with asyncio.timeout(5):
        async with httpx.AsyncClient(trust_env=False, timeout=5) as client:
            async with client.stream("GET", f"http://127.0.0.1:{port}/vnc.html") as response:
                if response.status_code != 200:
                    raise OSError("Viewer HTTP unavailable")
                # Exercise the forward's response body too, without retaining the page.
                async for _ in response.aiter_bytes():
                    pass


async def viewer_stderr(stream):
    """Drain owned SSH stderr, retaining only a bounded, redacted diagnostic."""
    kept = bytearray()
    while chunk := await stream.read(4096):
        kept.extend(chunk[:max(0, 4096 - len(kept))])
    if kept:
        logging.getLogger(__name__).warning("Viewer SSH: %s", redact(kept.decode("utf-8", errors="replace"), limit=2048))


def tunnel_args(alias, port, address, remote_port=6901):
    if not isinstance(alias, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", alias):
        raise ValueError("Invalid SSH config alias")
    destination = viewer_target(address, remote_port)
    if type(port) is not int or not 1024 <= port <= 65535:
        raise ValueError("Invalid loopback port")
    return ["ssh", "-N", "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
            "-o", "ExitOnForwardFailure=yes", "-o", "PermitLocalCommand=no",
            "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3",
            "-L", f"127.0.0.1:{port}:{destination}", alias]


class Tunnel:
    def __init__(self):
        self.process, self.port, self.address = None, None, None
        self.diagnostics = None
        self.lock = asyncio.Lock()

    async def open(self, alias, address, remote_port=6901):
        async with self.lock:
            destination = (alias, address, remote_port)
            if self.process and self.process.returncode is None and self.address == destination:
                return self.port
            await self._close()
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
            self.process = await asyncio.create_subprocess_exec(
                *tunnel_args(alias, port, address, remote_port), creationflags=NO_WINDOW,
                stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE)
            self.diagnostics = asyncio.create_task(viewer_stderr(self.process.stderr))
            try:
                async with asyncio.timeout(10):
                    while self.process.returncode is None:
                        try:
                            _, writer = await asyncio.open_connection("127.0.0.1", port)
                            writer.close()
                            await writer.wait_closed()
                            self.port, self.address = port, destination
                            return port
                        except OSError:
                            await asyncio.sleep(0.1)
                raise OSError("SSH viewer unavailable")
            except BaseException:
                await self._close()
                raise

    async def close(self):
        async with self.lock:
            await self._close()

    async def _close(self):
        if self.process:
            if self.process.returncode is None:
                self.process.kill()
            await self.process.wait()
        if self.diagnostics:
            await self.diagnostics
            self.diagnostics = None
        self.process, self.port, self.address = None, None, None

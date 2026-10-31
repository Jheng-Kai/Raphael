"""Temporary loopback viewer forwards, adapted from OpenMausBot vps-computer.ts.

Uses the owner's SSH config alias, never keys or an interactive password prompt.
"""

import asyncio
import ipaddress
import re
import socket

from .desktop_host import NO_WINDOW


def tunnel_args(alias, port, address):
    if not isinstance(alias, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", alias):
        raise ValueError("Invalid SSH config alias")
    ip = ipaddress.IPv4Address(address)
    if not any(ip in ipaddress.IPv4Network(net) for net in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")):
        raise ValueError("Invalid private container address")
    if type(port) is not int or not 1024 <= port <= 65535:
        raise ValueError("Invalid loopback port")
    return ["ssh", "-N", "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
            "-o", "ExitOnForwardFailure=yes", "-o", "PermitLocalCommand=no",
            "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3",
            "-L", f"127.0.0.1:{port}:{ip}:6901", alias]


class Tunnel:
    def __init__(self):
        self.process, self.port, self.address = None, None, None
        self.lock = asyncio.Lock()

    async def open(self, alias, address):
        async with self.lock:
            if self.process and self.process.returncode is None and self.address == address:
                return self.port
            await self._close()
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
            self.process = await asyncio.create_subprocess_exec(
                *tunnel_args(alias, port, address), creationflags=NO_WINDOW,
                stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL)
            try:
                async with asyncio.timeout(10):
                    while self.process.returncode is None:
                        try:
                            _, writer = await asyncio.open_connection("127.0.0.1", port)
                            writer.close()
                            await writer.wait_closed()
                            self.port, self.address = port, address
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
        self.process, self.port, self.address = None, None, None

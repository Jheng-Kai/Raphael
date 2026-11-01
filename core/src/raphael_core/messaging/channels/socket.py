"""A bounded TLS WebSocket for Discord's JSON gateway; no optional runtime dependency."""

import asyncio
import base64
import hashlib
import json
import secrets
import ssl
import struct

from .base import ChannelError


class GatewaySocket:
    def __init__(self):
        self.writer = None
        self.lock = asyncio.Lock()

    async def __aenter__(self):
        try:
            async with asyncio.timeout(15):
                self.reader, self.writer = await asyncio.open_connection("gateway.discord.gg", 443, ssl=ssl.create_default_context())
                key = base64.b64encode(secrets.token_bytes(16)).decode()
                self.writer.write((f"GET /?v=10&encoding=json HTTP/1.1\r\nHost: gateway.discord.gg\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: {key}\r\n\r\n").encode())
                await self.writer.drain()
                response = await self.reader.readuntil(b"\r\n\r\n")
                expected = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest())
                headers = dict(line.split(b":", 1) for line in response.split(b"\r\n")[1:] if b":" in line)
                headers = {key.lower(): value.strip() for key, value in headers.items()}
                if not response.startswith(b"HTTP/1.1 101 ") or headers.get(b"sec-websocket-accept") != expected:
                    raise ChannelError("network")
            return self
        except BaseException:
            await self.__aexit__(None, None, None)
            raise

    async def __aexit__(self, *args):
        if self.writer:
            self.writer.close()
            await self.writer.wait_closed()

    async def send_frame(self, payload, opcode=1):
        mask = secrets.token_bytes(4)
        length = len(payload)
        size = bytes([0x80 | length]) if length < 126 else bytes([0x80 | 126]) + struct.pack("!H", length) if length < 65536 else bytes([0x80 | 127]) + struct.pack("!Q", length)
        async with self.lock:
            self.writer.write(bytes([0x80 | opcode]) + size + mask + bytes(value ^ mask[index % 4] for index, value in enumerate(payload)))
            await self.writer.drain()

    async def send(self, packet):
        await self.send_frame(json.dumps(packet).encode())

    async def recv(self):
        fragments = bytearray()
        while True:
            first, second = await self.reader.readexactly(2)
            opcode, length = first & 15, second & 127
            if first & 0x70 or second & 0x80:
                raise ChannelError("network")
            if length in (126, 127):
                length = int.from_bytes(await self.reader.readexactly(2 if length == 126 else 8), "big")
            if length > 2_000_000 or len(fragments) + length > 2_000_000:
                raise ChannelError("network")
            payload = await self.reader.readexactly(length)
            if opcode == 8:
                code = int.from_bytes(payload[:2], "big")
                raise ChannelError("unauthorized" if code in (4004, 4013, 4014) else "network")
            if opcode == 9:
                await self.send_frame(payload, 10)
                continue
            if opcode == 10:
                continue
            if opcode not in (0, 1) or (opcode == 0) != bool(fragments):
                raise ChannelError("network")
            fragments.extend(payload)
            if first & 0x80:
                try:
                    return json.loads(fragments)
                except (ValueError, UnicodeError):
                    raise ChannelError("network") from None

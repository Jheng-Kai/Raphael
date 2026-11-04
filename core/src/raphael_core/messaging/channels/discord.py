"""Discord DMs, with pairing and approvals owned by the existing switchboard.

Admission and gateway intents follow Hermes tools/discord_tool.py and the Discord
gateway adapter (MIT, c419cf7c); see licenses/NOTICES.md.
"""

import asyncio
import json
from contextlib import asynccontextmanager

from .base import ChannelError, ChannelType, Identity, Incoming
from .socket import GatewaySocket
from .work import download, file_attachment, request, token

ROOT = "https://discord.com/api/v10"
FILES = {"cdn.discordapp.com", "media.discordapp.net"}


def incoming(data):
    author = data.get("author")
    if data.get("guild_id") or not isinstance(author, dict) or author.get("bot") or not author.get("id") or not data.get("channel_id"):
        return None
    files = [file_attachment(item.get("url"), item.get("content_type"), item.get("size"), item.get("filename"))
             for item in data.get("attachments", []) if isinstance(item, dict)]
    text = data.get("content") or None
    return Incoming(str(data["channel_id"]), str(author["id"]), author.get("global_name") or author.get("username") or "",
                    text=None if files else text, caption=text if files else None, attachments=files)


class DiscordChannel:
    kind = "discord"

    def __init__(self, token, http, *, connect=GatewaySocket):
        self.token, self.http, self.connect = token, http, connect
        self.headers = {"Authorization": f"Bot {token}"}
        self.error = None
        self.seen = {}
        self.sequence = None
        self.acknowledged = True

    async def api(self, method, path, **kwargs):
        response = await request(self.http, method, ROOT + path, headers=self.headers, **kwargs)
        try:
            return response.json() if response.content else {}
        except ValueError:
            raise ChannelError("bad_request") from None

    async def run(self, deliver):
        backoff = 1
        while True:
            heartbeat = None
            try:
                async with self.connect() as socket:
                    hello = await asyncio.wait_for(socket.recv(), 30)
                    interval = hello.get("d", {}).get("heartbeat_interval")
                    if hello.get("op") != 10 or type(interval) not in (float, int) or not 1000 <= interval <= 120000:
                        raise ChannelError("network")
                    self.sequence, self.acknowledged = None, True
                    await socket.send({"op": 2, "d": {"token": self.token, "intents": 1 << 12,
                        "properties": {"os": "windows", "browser": "Raphael", "device": "Raphael"}}})
                    async def beat():
                        while True:
                            await asyncio.sleep(interval / 1000)
                            if not self.acknowledged:
                                raise ChannelError("network")
                            self.acknowledged = False
                            await socket.send({"op": 1, "d": self.sequence})
                    heartbeat = asyncio.create_task(beat())
                    self.error, backoff = None, 1
                    while True:
                        reading = asyncio.create_task(socket.recv())
                        try:
                            ready, _ = await asyncio.wait((reading, heartbeat), return_when=asyncio.FIRST_COMPLETED)
                            if heartbeat in ready:
                                await heartbeat
                            packet = await reading
                        finally:
                            if not reading.done():
                                reading.cancel()
                                await asyncio.gather(reading, return_exceptions=True)
                        if packet.get("s") is not None:
                            self.sequence = packet["s"]
                        if packet.get("op") == 11:
                            self.acknowledged = True
                        elif packet.get("op") == 1:
                            await socket.send({"op": 1, "d": self.sequence})
                        elif packet.get("op") in (7, 9):
                            raise ChannelError("network")
                        elif packet.get("t") == "MESSAGE_CREATE":
                            data = packet.get("d") or {}
                            identifier = data.get("id")
                            if identifier and identifier not in self.seen and (message := incoming(data)):
                                self.seen[identifier] = True
                                if len(self.seen) > 2000:
                                    self.seen.pop(next(iter(self.seen)))
                                deliver(message)
            except (ChannelError, OSError, TimeoutError, asyncio.IncompleteReadError) as error:
                self.error = error.kind if isinstance(error, ChannelError) else "network"
                if self.error == "unauthorized":
                    return
            finally:
                if heartbeat:
                    heartbeat.cancel()
                    await asyncio.gather(heartbeat, return_exceptions=True)
            await asyncio.sleep(backoff)
            backoff = min(60, backoff * 2)

    async def send(self, chat, text):
        for start in range(0, len(text), 1900):
            await self.api("POST", f"/channels/{chat}/messages", json={"content": text[start:start + 1900], "allowed_mentions": {"parse": []}})

    async def send_attachment(self, chat, file):
        if len(file.data) > 10 * 1024 * 1024:
            return False
        await self.api("POST", f"/channels/{chat}/messages", data={"payload_json": json.dumps({"allowed_mentions": {"parse": []}})},
                       files={"files[0]": (file.name, file.data, file.mime)})
        return True

    @asynccontextmanager
    async def busy(self, chat):
        async def show():
            while True:
                try:
                    await self.api("POST", f"/channels/{chat}/typing")
                except ChannelError:
                    pass
                await asyncio.sleep(7)
        task = asyncio.create_task(show())
        try:
            yield
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def fetch(self, attachment, limit):
        return await download(self.http, attachment.ref, limit, hosts=FILES)


async def check(secrets, http):
    me = await DiscordChannel(secrets["token"], http).api("GET", "/users/@me")
    if not isinstance(me, dict) or not me.get("id") or not me.get("bot"):
        raise ChannelError("unauthorized")
    return Identity(str(me["id"]), me.get("username"))


DISCORD = ChannelType("discord", ("token",), token, check, lambda secrets, http: DiscordChannel(secrets["token"], http))

"""Discord DMs, with pairing and approvals owned by the existing switchboard.

"""

import asyncio
import json
import time
from urllib.parse import urlsplit
from contextlib import asynccontextmanager

from .base import ChannelError, ChannelType, Identity, Incoming, send_through_rate_limits
from .socket import GatewaySocket
from .work import PairedHistory, download, file_attachment, request, token

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


class DiscordChannel(PairedHistory):
    kind = "discord"
    retries_rate_limits = True

    def __init__(self, token, http, *, connect=GatewaySocket):
        self.token, self.http, self.connect = token, http, connect
        self.headers = {"Authorization": f"Bot {token}"}
        self.error = None
        self.seen = {}
        self.started = str((int(time.time() * 1000) - 1420070400000) << 22)
        self.session_id = None
        self.resume_host = None
        self.sequence = None
        self.acknowledged = True

    async def api(self, method, path, **kwargs):
        response = await request(self.http, method, ROOT + path, headers=self.headers, **kwargs)
        try:
            return response.json() if response.content else {}
        except ValueError:
            raise ChannelError("bad_request") from None

    def pair_position(self, chat):
        return str((int(time.time() * 1000) - 1420070400000) << 22)

    async def _message(self, data, deliver):
        identifier = data.get("id")
        if not identifier:
            return
        user = self.paired(data.get("channel_id"))
        if user and int(identifier) <= int(user.position):
            return
        if identifier not in self.seen and (message := incoming(data)):
            while deliver(message) is False:
                await asyncio.sleep(0.25)
            self.seen[identifier] = True
            if len(self.seen) > 2000:
                self.seen.pop(next(iter(self.seen)))
        if user:
            user.position = identifier
            self.save()

    async def _catch_up(self, deliver):
        for user in list(self.config.allowed if self.config else []):
            for _ in range(20):
                if self.paired(user.chat) is not user:
                    break
                page = await self.api("GET", f"/channels/{user.chat}/messages",
                                      params={"after": user.position, "limit": 100})
                for data in sorted(page, key=lambda m: int(m["id"])):
                    await self._message(data, deliver)
                if len(page) < 100:
                    break
            else:
                # Identify again from the saved boundary before accepting newer live events.
                raise ChannelError("network")

    async def run(self, deliver):
        backoff = 1
        while True:
            heartbeat = None
            try:
                connection = GatewaySocket(self.resume_host) if self.resume_host and self.connect is GatewaySocket else self.connect()
                async with connection as socket:
                    hello = await asyncio.wait_for(socket.recv(), 30)
                    interval = hello.get("d", {}).get("heartbeat_interval")
                    if hello.get("op") != 10 or type(interval) not in (float, int) or not 1000 <= interval <= 120000:
                        raise ChannelError("network")
                    self.acknowledged = True
                    if self.session_id and self.sequence is not None:
                        await socket.send({"op": 6, "d": {"token": self.token, "session_id": self.session_id, "seq": self.sequence}})
                    else:
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
                        if packet.get("op") == 11:
                            self.acknowledged = True
                        elif packet.get("op") == 1:
                            await socket.send({"op": 1, "d": self.sequence})
                        elif packet.get("op") in (7, 9):
                            if packet["op"] == 9 and not packet.get("d"):
                                self.session_id = self.sequence = self.resume_host = None
                            raise ChannelError("network")
                        elif packet.get("t") == "READY":
                            await self._catch_up(deliver)
                            self.session_id = packet["d"]["session_id"]
                            host = urlsplit(packet["d"].get("resume_gateway_url", "")).hostname
                            self.resume_host = host if host and host.endswith(".discord.gg") else None
                        elif packet.get("t") == "MESSAGE_CREATE":
                            await self._message(packet.get("d") or {}, deliver)
                        if packet.get("s") is not None:
                            self.sequence = packet["s"]
            except (ChannelError, OSError, TimeoutError, asyncio.IncompleteReadError) as error:
                retry_after = error.retry_after if isinstance(error, ChannelError) else 0
                self.error = error.kind if isinstance(error, ChannelError) else "network"
                if self.error == "invalid_session":
                    self.session_id = self.sequence = self.resume_host = None
                    self.error = "network"
                if self.error == "unauthorized":
                    return
            finally:
                if heartbeat:
                    heartbeat.cancel()
                    await asyncio.gather(heartbeat, return_exceptions=True)
            await asyncio.sleep(max(backoff, retry_after))
            backoff = min(60, backoff * 2)

    async def send(self, chat, text):
        for start in range(0, len(text), 2000):
            payload = {"content": text[start:start + 2000], "allowed_mentions": {"parse": []}}
            await send_through_rate_limits(lambda: self.api("POST", f"/channels/{chat}/messages", json=payload), asyncio.sleep)

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

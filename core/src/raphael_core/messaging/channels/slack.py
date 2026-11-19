"""Slack direct messages through the same pairing switchboard as Telegram.

Bot tokens stay in the shared vault.
"""

import asyncio
import time
from decimal import Decimal

from .base import ChannelError, ChannelType, Identity, Incoming, send_through_rate_limits
from .work import PairedHistory, download, file_attachment, quiet_busy, receive, request, token, trusted_url

ROOT = "https://slack.com/api/"
FILES = {"files.slack.com"}


def incoming(data):
    if (data.get("type") != "message" or data.get("bot_id") or data.get("subtype") not in (None, "file_share")
            or data.get("channel_type") != "im" or not data.get("user") or not data.get("channel")):
        return None
    files = [file_attachment(item.get("url_private_download") or item.get("url_private"), item.get("mimetype"), item.get("size"), item.get("name"))
             for item in data.get("files", []) if isinstance(item, dict)]
    text = data.get("text") or None
    return Incoming(str(data["channel"]), str(data["user"]), str(data["user"]), text=None if files else text,
                    caption=text if files else None, attachments=files)


class SlackChannel(PairedHistory):
    kind = "slack"
    retries_rate_limits = True

    def __init__(self, token, http):
        self.http, self.headers = http, {"Authorization": f"Bearer {token}"}
        self.error = None
        self.since = {}
        self.started = f"{time.time():.6f}"
        self.before = {}
        self.list_cursor = None

    def pair_position(self, chat):
        return self.since.get(chat, f"{time.time():.6f}")

    async def api(self, method, **params):
        response = await request(self.http, "POST", ROOT + method, headers=self.headers, json=params)
        try:
            data = response.json()
        except ValueError:
            raise ChannelError("bad_request") from None
        if not isinstance(data, dict) or not data.get("ok"):
            error = data.get("error") if isinstance(data, dict) else None
            raise ChannelError("unauthorized" if error in ("invalid_auth", "token_revoked", "account_inactive", "missing_scope", "not_authed") else "bad_request")
        return data

    async def poll(self, deliver):
        for _ in range(20):
            listing = await self.api("conversations.list", types="im", limit=100,
                                     **({"cursor": self.list_cursor} if self.list_cursor else {}))
            for chat in listing.get("channels", []):
                if isinstance(identifier := chat.get("id"), str):
                    await self._history(identifier, deliver)
            self.list_cursor = listing.get("response_metadata", {}).get("next_cursor")
            if not self.list_cursor:
                break

    async def _history(self, chat, deliver):
        user = self.paired(chat)
        oldest = user.position if user else self.since.get(chat, self.started)
        before = user.history_before if user else self.before.get(chat)
        for _ in range(20):
            recovering = user and user.find_last_reply
            page = await self.api("conversations.history", channel=chat, oldest="0" if recovering else oldest, limit=100,
                                  **({"latest": before} if before else {}))
            messages = sorted((m for m in page.get("messages", []) if isinstance(m.get("ts"), str)),
                              key=lambda m: Decimal(m["ts"]))
            more = messages and (page.get("has_more") or page.get("response_metadata", {}).get("next_cursor"))
            if recovering:
                bot = self.config.bot_id.rsplit(":", 1)[-1]
                reply = next((m for m in reversed(messages) if m.get("user") == bot), None)
                if more and reply is None:
                    before = messages[0]["ts"]
                else:
                    # With no retained reply there is no safe way to replay pre-pairing history.
                    oldest = reply["ts"] if reply else oldest
                    user.find_last_reply = False
                    before = None
            elif more:
                # History is newest first. Narrow the time window until its oldest page fits.
                # A timestamp survives restart and cursor expiry without storing private messages.
                first = Decimal(messages[0]["ts"])
                midpoint = ((Decimal(oldest) + first) / 2).quantize(Decimal("0.000001"))
                before = str(max(Decimal(oldest) + Decimal("0.000002"), midpoint))
            else:
                for data in messages:
                    if Decimal(data["ts"]) <= Decimal(oldest):
                        continue
                    event = incoming({**data, "channel": chat, "channel_type": "im"})
                    if event and deliver(event) is False:
                        return
                    oldest = self.since[chat] = data["ts"]
                    if user:
                        user.position = oldest
                        self.save()
                if not before:
                    return
                # Even an empty subrange is known to be clear strictly before its upper bound.
                oldest = self.since[chat] = str(max(Decimal(oldest), Decimal(before) - Decimal("0.000001")))
                before = None
            self.before[chat] = before
            if user:
                user.position, user.history_before = oldest, before or ""
                self.save()

    async def run(self, deliver):
        await receive(self, self.poll, deliver)

    async def send(self, chat, text):
        for start in range(0, len(text), 3500):
            part = text[start:start + 3500]
            await send_through_rate_limits(lambda: self.api("chat.postMessage", channel=chat, text=part,
                unfurl_links=False, unfurl_media=False), asyncio.sleep)

    async def send_attachment(self, chat, file):
        if len(file.data) > 1024 * 1024 * 1024:
            return False
        upload = await self.api("files.getUploadURLExternal", filename=file.name, length=len(file.data))
        url, identifier = upload.get("upload_url"), upload.get("file_id")
        if not trusted_url(url, FILES) or not isinstance(identifier, str):
            raise ChannelError("bad_request")
        await request(self.http, "POST", url, content=file.data, headers={"Content-Type": "application/octet-stream"})
        await self.api("files.completeUploadExternal", files=[{"id": identifier, "title": file.name}], channel_id=chat)
        return True

    def busy(self, chat):
        return quiet_busy()

    async def fetch(self, attachment, limit):
        return await download(self.http, attachment.ref, limit, hosts=FILES, headers=self.headers)


async def check(secrets, http):
    data = await SlackChannel(secrets["token"], http).api("auth.test")
    if not data.get("team_id") or not data.get("user_id"):
        raise ChannelError("bad_request")
    return Identity(f'{data["team_id"]}:{data["user_id"]}', data.get("user"))


SLACK = ChannelType("slack", ("token",), token, check, lambda secrets, http: SlackChannel(secrets["token"], http))

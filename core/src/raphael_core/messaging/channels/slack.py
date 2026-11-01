"""Slack direct messages through the same pairing switchboard as Telegram.

Private-message admission follows Hermes gateway Slack/Discord adapters (MIT,
c419cf7c); see THIRD_PARTY_NOTICES.md. Bot tokens stay in the shared vault.
"""

import time

from .base import ChannelError, ChannelType, Identity, Incoming
from .work import download, file_attachment, quiet_busy, receive, request, token, trusted_url

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


class SlackChannel:
    kind = "slack"

    def __init__(self, token, http):
        self.http, self.headers = http, {"Authorization": f"Bearer {token}"}
        self.error = None
        self.since = {}
        self.started = str(time.time())

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
        cursor = None
        for _ in range(20):
            listing = await self.api("conversations.list", types="im", limit=100, **({"cursor": cursor} if cursor else {}))
            for chat in listing.get("channels", []):
                identifier = chat.get("id")
                if not isinstance(identifier, str):
                    continue
                oldest = self.since.get(identifier, self.started)
                page_cursor = None
                messages = []
                for _ in range(20):
                    page = await self.api("conversations.history", channel=identifier, oldest=oldest, limit=100,
                                          **({"cursor": page_cursor} if page_cursor else {}))
                    messages.extend(page.get("messages", []))
                    page_cursor = page.get("response_metadata", {}).get("next_cursor")
                    if not page_cursor:
                        break
                else:
                    raise ChannelError("rate_limited", 60)
                for data in sorted(messages, key=lambda item: item.get("ts", "")):
                    if not isinstance(data.get("ts"), str) or data["ts"] <= self.since.get(identifier, oldest):
                        continue
                    event = incoming({**data, "channel": identifier, "channel_type": "im"})
                    if event:
                        deliver(event)
                    if data.get("ts"):
                        self.since[identifier] = max(self.since.get(identifier, oldest), data["ts"])
            cursor = listing.get("response_metadata", {}).get("next_cursor")
            if not cursor:
                return
        raise ChannelError("rate_limited", 60)

    async def run(self, deliver):
        await receive(self, self.poll, deliver)

    async def send(self, chat, text):
        for start in range(0, len(text), 3500):
            await self.api("chat.postMessage", channel=chat, text=text[start:start + 3500], unfurl_links=False, unfurl_media=False)

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

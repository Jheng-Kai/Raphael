import asyncio
import json

import httpx
import pytest

from raphael_core.messaging.channels import CHANNEL_TYPES
from raphael_core.messaging.channels.base import Attachment, ChannelError
from raphael_core.services.attachments import Attachment as File


@pytest.mark.parametrize("kind", ["slack", "discord"])
async def test_a_caption_and_document_reach_the_assistant_together(kind):
    from raphael_core.messaging.core import Switchboard
    from .test_switchboard import FakeChannel
    module = __import__(f"raphael_core.messaging.channels.{kind}", fromlist=["incoming"])
    data = ({"type": "message", "channel": "D1", "channel_type": "im", "user": "U1", "text": "read this",
             "files": [{"url_private": "https://files.slack.com/a", "name": "report.csv", "mimetype": "text/csv", "size": 3}]}
            if kind == "slack" else {"channel_id": "D1", "author": {"id": "U1"}, "content": "read this",
             "attachments": [{"url": "https://cdn.discordapp.com/a", "filename": "report.csv", "content_type": "text/csv", "size": 3}]})
    channel, asked = FakeChannel(), []
    channel.kind = kind
    async def fetch(*_): return b"a,b"
    async def ask(*args, attachments=()): asked.append((args, attachments)); return "read"
    channel.fetch = fetch
    board = Switchboard(channel, ask=ask, stop=None, is_allowed=lambda _: True,
                        chat_allowed=lambda _: True, language=lambda: "en")
    await board._route(module.incoming(data))
    assert asked[0][0] == (f"{kind}:D1", "read this", "en", kind)
    assert [(f.name, f.data) for f in asked[0][1]] == [("report.csv", b"a,b")]


@pytest.mark.parametrize("kind", ["slack", "discord"])
async def test_work_channels_receive_private_text_and_files_and_send_stored_bytes(kind):
    module = __import__(f"raphael_core.messaging.channels.{kind}", fromlist=["Channel"])
    data = ({"type": "message", "channel": "D1", "channel_type": "im", "user": "U1", "text": "hello",
             "ts": "1.2", "files": [{"url_private_download": "https://files.slack.com/files-pri/a", "mimetype": "image/png", "size": 3, "name": "a.png"}]}
            if kind == "slack" else {"channel_id": "123", "id": "456", "author": {"id": "789", "username": "Owner"},
             "content": "hello", "attachments": [{"url": "https://cdn.discordapp.com/attachments/a/b/a.png", "content_type": "image/png", "size": 3, "filename": "a.png"}]})
    incoming = module.incoming(data)
    assert incoming.private and incoming.caption == "hello" and incoming.attachments[0].kind == "image"
    calls = []
    def server(request):
        calls.append(request)
        path = request.url.path
        if path.endswith("getUploadURLExternal"):
            return httpx.Response(200, json={"ok": True, "upload_url": "https://files.slack.com/upload/v1/a", "file_id": "F1"})
        if "files-pri" in path or "/attachments/" in path:
            return httpx.Response(200, content=b"png")
        return httpx.Response(200, json={"ok": True, "id": "1"})
    async with httpx.AsyncClient(transport=httpx.MockTransport(server)) as http:
        channel = module.SlackChannel("fake-token", http) if kind == "slack" else module.DiscordChannel("fake-token", http)
        assert await channel.fetch(incoming.attachments[0], 10) == b"png"
        await channel.send(incoming.chat, "reply")
        assert await channel.send_attachment(incoming.chat, File("a.txt", "text/plain", b"stored bytes"))
        assert any(b"stored bytes" in request.content for request in calls)
        with pytest.raises(ChannelError):
            await channel.fetch(Attachment("image", "https://evil.example/private"), 10)
    assert kind in CHANNEL_TYPES


def test_bots_groups_and_discord_guilds_cannot_enter_the_private_assistant():
    from raphael_core.messaging.channels.slack import incoming as slack
    from raphael_core.messaging.channels.discord import incoming as discord
    assert slack({"type": "message", "channel": "C1", "channel_type": "channel", "user": "U1", "text": "approve"}) is None
    assert discord({"id": "1", "channel_id": "2", "guild_id": "3", "author": {"id": "4"}, "content": "approve"}) is None
    assert discord({"id": "1", "channel_id": "2", "author": {"id": "4", "bot": True}}) is None


async def test_discord_gateway_delivers_a_dm_once_and_closes_on_revoked_credentials(caplog):
    from raphael_core.messaging.channels.discord import DiscordChannel
    packets = [{"op": 10, "d": {"heartbeat_interval": 1000}},
               {"op": 0, "t": "MESSAGE_CREATE", "s": 1, "d": {"id": "1", "channel_id": "2", "author": {"id": "3"}, "content": "hello"}}]
    packets.append(packets[-1])
    sent, messages = [], []
    class Socket:
        async def __aenter__(self): return self
        async def __aexit__(self, *_): pass
        async def send(self, packet): sent.append(packet)
        async def recv(self):
            if packets: return packets.pop(0)
            raise ChannelError("unauthorized")
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200))) as http:
        channel = DiscordChannel("fake-discord-token", http, connect=Socket)
        await channel.run(messages.append)
    assert len(messages) == 1 and messages[0].chat == "2" and channel.error == "unauthorized"
    assert sent[0]["op"] == 2 and sent[0]["d"]["intents"] == 1 << 12
    assert "fake-discord-token" not in caplog.text


async def test_slack_poll_pages_direct_messages_in_order_without_replaying_them():
    from raphael_core.messaging.channels.slack import SlackChannel
    received, requests = [], []
    def server(request):
        params = json.loads(request.content)
        requests.append((request.url.path, params))
        if request.url.path.endswith("conversations.list"):
            return httpx.Response(200, json={"ok": True, "channels": [{"id": "D1"}]})
        messages = [] if params["oldest"] == "100.002" else [
            {"type": "message", "user": "U1", "text": "second", "ts": "100.002"},
            {"type": "message", "user": "U1", "text": "first", "ts": "100.001"}]
        return httpx.Response(200, json={"ok": True, "messages": messages})
    async with httpx.AsyncClient(transport=httpx.MockTransport(server)) as http:
        channel = SlackChannel("fake-slack-token", http)
        channel.started = "100.000"
        await channel.poll(received.append)
        await channel.poll(received.append)
    assert [message.text for message in received] == ["first", "second"]
    assert all(message.chat == "D1" and message.user == "U1" for message in received)
    assert requests[-1][1]["oldest"] == "100.002"

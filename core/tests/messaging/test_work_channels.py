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


async def test_audited_switchboard_reports_capacity():
    from .test_switchboard import make, FakeChannel
    from raphael_core.messaging.core import MAX_PENDING_MESSAGES, Incoming
    board = make(FakeChannel())
    message = Incoming("D1", "U1", "Owner", text="hello")
    try:
        assert all(board._deliver(message) for _ in range(MAX_PENDING_MESSAGES))
        assert board._deliver(message) is False
        await asyncio.gather(*board._tasks)
        assert board._deliver(message)
    finally:
        await board.aclose()


@pytest.mark.parametrize("kind,limit", [("slack", 3500), ("discord", 1900)])
@pytest.mark.parametrize("exhausted", [False, True])
async def test_audited_retry_only_the_failed_piece(kind, limit, exhausted):
    from raphael_core.messaging.channels.base import RATE_LIMIT_TRIES
    from .test_switchboard import make
    channel = CHANNEL_TYPES[kind].make({"token": "test"}, None)
    sent = []
    attempts = []
    async def api(*args, **kwargs):
        piece = kwargs.get("text") or kwargs["json"]["content"]
        attempts.append(piece)
        if len(attempts) == 2 or exhausted and piece == "hello":
            raise ChannelError("rate_limited", 0)
        sent.append(piece)
    channel.api = api
    await make(channel).tell("D1", "x" * limit + "hello")
    assert sent == (["x" * limit] if exhausted else ["x" * limit, "hello"])
    assert attempts.count("hello") == (RATE_LIMIT_TRIES if exhausted else 2)


async def test_audited_slack_restart_and_backlog(tmp_path):
    from raphael_core.messaging.channels.slack import SlackChannel
    from raphael_core.messaging.config import AllowedUser, MessagingStore
    store = MessagingStore(tmp_path)
    config = store.load()
    config.channel("slack").allowed = [AllowedUser("U1", "Owner", "D1")]
    store.save(config)
    stamps = [f"100.{n:06d}" for n in range(1, 50)]
    calls = []
    async def api(method, **params):
        if method.endswith("list"):
            return {"channels": [{"id": "D1"}]}
        calls.append(params)
        rows = [ts for ts in reversed(stamps) if params["oldest"] < ts < params.get("latest", "999")]
        return {"messages": [{"type": "message", "user": "U1", "text": ts, "ts": ts} for ts in rows[:1]],
                "has_more": len(rows) > 1, "response_metadata": {"next_cursor": "next" if len(rows) > 1 else ""}}
    received = []
    for attempt in range(100):
        channel = SlackChannel("token", None)
        channel.started = "100.000000" if attempt == 0 else "200.000000"
        config = store.load()
        channel.track(config.channel("slack"), lambda: store.save(config))
        channel.api = api
        before = len(calls)
        await channel.poll(lambda event: False if attempt == 0 else received.append(event.text))
        assert len(calls) - before <= 20
        if received == stamps:
            break
    assert received == stamps


async def test_audited_discord_resumes_from_accepted_sequence_and_catches_up():
    from raphael_core.messaging.channels.discord import DiscordChannel
    from raphael_core.messaging.config import AllowedUser, ChannelConfig
    def dm(identifier):
        return {"id": identifier, "channel_id": "2", "author": {"id": "3"}, "content": identifier}
    hello = {"op": 10, "d": {"heartbeat_interval": 10000}}
    ready = {"op": 0, "s": 1, "t": "READY", "d": {"session_id": "s"}}
    sessions = iter([[hello, ready, {"op": 0, "s": 2, "t": "MESSAGE_CREATE", "d": dm("101")}, {"op": 7}],
                     [hello, {"op": 9, "d": False}], [hello, ready]])
    sent, received = [], []
    class Socket:
        def __init__(self): self.packets = iter(next(sessions))
        async def __aenter__(self): return self
        async def __aexit__(self, *_): pass
        async def send(self, packet): sent.append(packet)
        async def recv(self):
            if packet := next(self.packets, None): return packet
            raise ChannelError("unauthorized")
    channel = DiscordChannel("token", None, connect=Socket)
    config = ChannelConfig(allowed=[AllowedUser("3", "Owner", "2")])
    channel.track(config, lambda: None)
    config.allowed[0].position = "100"
    async def api(method, path, **kwargs):
        return [dm("102")] if kwargs["params"]["after"] == "101" else []
    channel.api = api
    attempts = []
    def deliver(message):
        attempts.append(message.text)
        if attempts == ["101"]:
            assert channel.sequence == 1 and "101" not in channel.seen
            return False
        received.append(message.text)
        return True
    await channel.run(deliver)
    assert attempts == ["101", "101", "102"]
    assert [packet["op"] for packet in sent] == [2, 6, 2]
    assert sent[1]["d"]["seq"] == 2
    assert received == ["101", "102"]


async def test_paired_slack_service_reads_a_dm_sent_between_processes(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from raphael_core.integrations.vault import MemoryVault
    from raphael_core.messaging.channels import slack
    from raphael_core.messaging.config import AllowedUser, MessagingStore
    from raphael_core.messaging.service import MessagingService, secret_name

    store, vault = MessagingStore(tmp_path), MemoryVault()
    vault.set(secret_name("slack", "token"), "test-token")
    config = store.load()
    paired = config.channel("slack")
    paired.enabled, paired.bot_id = True, "T:Bot"
    paired.allowed = [AllowedUser("U1", "Owner", "D1")]
    store.save(config)
    polled = asyncio.Event()
    asked = []
    now = 100
    monkeypatch.setattr(slack, "time", SimpleNamespace(time=lambda: now))

    def server(request):
        if request.url.path.endswith("conversations.list"):
            return httpx.Response(200, json={"ok": True, "channels": [{"id": "D1"}]})
        if request.url.path.endswith("conversations.history"):
            polled.set()
            offline = now > 150 and float(json.loads(request.content)["oldest"]) < 150
            messages = [{"type": "message", "user": "U1", "text": "offline", "ts": "150.000000"}] if offline else []
            return httpx.Response(200, json={"ok": True, "messages": messages})
        return httpx.Response(200, json={"ok": True})

    async def ask(session, text, *_):
        asked.append((session, text))
        return "received"

    async with httpx.AsyncClient(transport=httpx.MockTransport(server)) as http:
        for now in (100, 200):
            service = MessagingService(store, vault, ask=ask, stop=None, language=lambda: "en", http=http)
            polled.clear()
            service.start()
            try:
                await asyncio.wait_for(polled.wait(), 2)
                await asyncio.sleep(0)
            finally:
                await service.aclose()
    assert asked == [("slack:D1", "offline")]
    assert store.load().channel("slack").allowed[0].position == "150.000000"


async def test_legacy_slack_pair_recovers_after_its_last_bot_reply():
    from raphael_core.messaging.channels.slack import SlackChannel
    from raphael_core.messaging.config import AllowedUser, ChannelConfig
    channel = SlackChannel("token", None)
    channel.started = "200.000000"
    config = ChannelConfig(bot_id="T:Bot", allowed=[AllowedUser("U1", "Owner", "D1")])
    channel.track(config, lambda: None)
    history = [{"type": "message", "user": "U1", "ts": "150.000000", "text": "offline"},
               {"type": "message", "user": "Bot", "bot_id": "B", "ts": "125.000000", "text": "reply"},
               {"type": "message", "user": "U1", "ts": "120.000000", "text": "already answered"}]
    async def api(method, **params):
        if method.endswith("list"):
            return {"channels": [{"id": "D1"}]}
        return {"messages": [m for m in history if float(m["ts"]) > float(params["oldest"])]}
    channel.api = api
    messages = []
    await channel.poll(messages.append)
    assert [m.text for m in messages] == ["offline"]
    assert config.allowed[0].position == "150.000000"

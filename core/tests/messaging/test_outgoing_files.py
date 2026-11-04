import httpx
import pytest

from raphael_core.messaging.channels.telegram import TelegramChannel, TelegramApi
from raphael_core.services.attachments import Attachment
from .test_wiring import app  # noqa: F401


@pytest.mark.parametrize("mime,name,method,field", [
    ("application/pdf", "report.pdf", "sendDocument", "document"),
    ("image/png", "chart.png", "sendPhoto", "photo"),
    ("audio/mpeg", "voice.mp3", "sendAudio", "audio"),
    ("audio/wav", "voice.wav", "sendDocument", "document"),
])
async def test_telegram_uploads_the_file_bytes_to_the_same_chat(mime, name, method, field):
    requests = []

    def fake(request):
        requests.append(request)
        return httpx.Response(200, json={"ok": True, "result": {}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(fake)) as http:
        channel = TelegramChannel(TelegramApi("123:fake", http))
        assert await channel.send_attachment("12345", Attachment(name, mime, b"file bytes"))
    [request] = requests
    assert request.url.path.endswith("/" + method)
    assert b"12345" in request.content
    assert b"file bytes" in request.content
    assert f'name="{field}"'.encode() in request.content


async def test_an_oversized_file_is_never_uploaded():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: pytest.fail("no upload"))) as http:
        channel = TelegramChannel(TelegramApi("123:fake", http))
        assert not await channel.send_attachment("12345", Attachment("large.pdf", "application/pdf", b"a" * (50 * 1024 * 1024 + 1)))


async def test_only_the_paired_chat_receives_files_and_oversized_files_have_an_app_location():
    from .test_switchboard import FakeChannel, make
    channel = FakeChannel()
    board = make(channel)
    files = []

    async def send(chat, file):
        files.append((chat, file))
        return False

    channel.send_attachment = send
    file = Attachment("report.pdf", "application/pdf", b"report")
    await board.tell("stranger", "result", files=[file])
    assert not channel.sent and not files
    await board.tell("D1", "result", files=[file])
    assert files == [("D1", file)]
    assert "original conversation in Raphael" in channel.sent[-1][1]


async def test_revoking_a_chat_during_the_turn_prevents_attachment_delivery():
    from .test_switchboard import FakeChannel, make
    from raphael_core.messaging.core import Answer
    channel = FakeChannel()
    board = make(channel)

    async def ask(*args):
        board._chat_allowed = lambda chat: False
        return Answer("done", [Attachment("report.pdf", "application/pdf", b"report")])

    board._ask = ask
    await board._converse("D1", "en", text="make a report")
    assert not channel.sent


def test_a_tool_cannot_deliver_a_host_path_or_a_missing_attachment(tmp_path, conn):
    import json
    from raphael_core.agent.history import AgentHistory
    from raphael_core.services.artifacts import turn_files
    from raphael_core.services.attachment_store import AttachmentStore
    history, store = AgentHistory(conn), AttachmentStore(tmp_path)
    turn_id = history.add(session_id="telegram:42", question="Make a file", route="answer", prefix="", text="Done", status="done", cost_usd=0)
    history.add_message(turn_id, "media", json.dumps({"attachment": {"id": str(tmp_path / "private.txt"), "name": "private.txt", "mime": "text/plain"}}))
    assert list(turn_files(history, turn_id, store)) == []
    saved = store.save(Attachment("report.txt", "text/plain", b"the report"))
    history.add_message(turn_id, "media", json.dumps({"attachment": saved.metadata()}))
    assert [file.data for file in turn_files(history, turn_id, store)] == [b"the report"]


async def test_a_completed_turn_returns_its_stored_file_to_the_messaging_switchboard(app, monkeypatch):
    import json
    saved = app.attachment_store.save(Attachment("report.pdf", "application/pdf", b"the report"))
    history = app.agent._history
    turn_id = history.add(session_id="telegram:42", question="Send the report", route="answer", prefix="", text="Ready", status="done", cost_usd=0)
    history.add_message(turn_id, "media", json.dumps({"attachment": saved.metadata()}))

    async def call(method, params):
        assert method == "agent.ask"
        return {"status": "done", "turn_id": turn_id, "prefix": "", "text": "Ready"}

    monkeypatch.setattr(app, "call", call)
    answer = await app._ask_from_messaging("telegram:42", "Send the report", "en", "telegram")
    assert answer.text == "Ready"
    assert [(file.name, file.data) for file in answer.files] == [("report.pdf", b"the report")]

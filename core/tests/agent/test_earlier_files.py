"""A file the owner handed over stays reachable in the turns after: named again with its stored path,
and read again by its index."""

import base64
import json
from pathlib import Path

from raphael_core.agent.attachment_inputs import EARLIER_FILES, earlier_files
from raphael_core.services.attachment_store import AttachmentStore
from raphael_core.services.attachments import Attachment

from .test_narration import chat
from .test_service import make_rig  # noqa: F401

PAGE = b"<p>FIRST_PART</p>" + b"<p>" + b"x" * 40_000 + b"</p><p>LATE_PART_OF_THE_PAGE</p>"


def ask(session, text, files=()):
    return {"session_id": session, "text": text, "ui_language": "en", "source": "app", "member_id": 0,
            "attachments": [{"name": name, "mime": mime, "data": base64.b64encode(data).decode()} for name, mime, data in files]}


def listed(prompt: str) -> list[dict]:
    marker = "Files the owner handed over earlier in this conversation, newest first: "
    return json.loads(prompt.split(marker, 1)[1].split("\n", 1)[0])


async def test_a_later_turn_names_the_earlier_file_and_reads_it_again(make_rig, client, tmp_path):
    rig = make_rig(attachment_store=AttachmentStore(tmp_path))
    client.chats = [chat("Received the page")]
    await rig.call("agent.ask", ask("first", "Keep this page", [("page.html", "text/html", PAGE)]))
    client.chats = [chat("", ("read_attachment", {"index": 1})), chat("Read it again")]
    result = await rig.call("agent.ask", ask("second", "Make the page above again"))
    assert result["text"] == "Read it again"
    prompt = client.chat_calls[1]["messages"][1]["content"]
    [page] = listed(prompt)
    assert page["index"] == 1 and page["name"] == "page.html" and page["mime"] == "text/html"
    # The path is the whole stored copy, past what an excerpt of the page holds.
    assert b"LATE_PART_OF_THE_PAGE" in Path(page["path"]).read_bytes()
    assert "your own file tools" in prompt
    assert "FIRST_PART" in str(client.chat_calls[2]["messages"])


async def test_the_turn_that_brings_a_file_also_gives_its_stored_path(make_rig, client, tmp_path):
    rig = make_rig(attachment_store=AttachmentStore(tmp_path))
    client.chats = [chat("Received the page")]
    await rig.call("agent.ask", ask("first", "Keep this page", [("page.html", "text/html", PAGE)]))
    prompt = client.chat_calls[0]["messages"][1]["content"]
    files = json.loads(prompt.split("\nFiles: ", 1)[1].split("\n", 1)[0])
    assert b"LATE_PART_OF_THE_PAGE" in Path(files[0]["path"]).read_bytes()
    assert "handed over earlier" not in prompt


async def test_without_a_store_no_earlier_file_is_named(make_rig, client):
    rig = make_rig()
    client.chats = [chat("Received the page")]
    await rig.call("agent.ask", ask("first", "Keep this page", [("page.html", "text/html", PAGE)]))
    client.chats = [chat("Nothing to read")]
    await rig.call("agent.ask", ask("second", "Use the page above"))
    assert "handed over earlier" not in client.chat_calls[1]["messages"][1]["content"]


class _Turn:
    def __init__(self, *files):
        self.attachments = [{"name": f"{key}.txt", "mime": "text/plain", "id": key} for key in files] or None


def test_earlier_files_are_newest_first_each_once_without_the_current_ones_and_bounded():
    current = [Attachment("now.txt", "text/plain", b"x", "now")]
    turns = [_Turn("old", "shared"), _Turn(), _Turn("shared", "now"), *[_Turn(f"f{n}") for n in range(12)]]
    found = [item["id"] for item in earlier_files(turns, current)]
    assert found == [f"f{n}" for n in range(11, 11 - EARLIER_FILES, -1)]
    assert [item["id"] for item in earlier_files(turns[:3], current)] == ["shared", "old"]

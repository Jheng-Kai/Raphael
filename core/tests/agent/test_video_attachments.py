"""A video the owner attaches reaches a CLI member as frames, as its original in its own computer, and by `read_attachment`
(R-ATTACH-VIDEO-01..04): a private conversation, and the worker's prompt that a room speaker and a task are given."""

import base64
import json
import shutil
import subprocess
from dataclasses import replace
from pathlib import Path

import pytest

from agent.conftest import FakeActions
from agent.test_service import Rig
from members.test_answering import Team, client, member  # noqa: F401
from members.test_cli_brains import fake_brain
from raphael_core.background.run import RunLimits
from raphael_core.background.service import _prompts
from raphael_core.services.attachment_store import AttachmentStore
from raphael_core.services.attachments import checked

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is not installed")

SCRIPTS = {
    "claude": '''import json, sys
from pathlib import Path
def send(value): print(json.dumps(value), flush=True)
Path(RECORD).write_text(json.dumps(json.loads(sys.stdin.readline())["message"]["content"]), encoding="utf-8")
send({"type":"result", "subtype":"success", "result":"I watched it"})
''',
    "codex": '''import json, sys
from pathlib import Path
def send(value): print(json.dumps(value), flush=True)
for line in sys.stdin:
    msg = json.loads(line)
    if msg.get("method") == "initialize": send({"id":msg["id"], "result":{}})
    elif msg.get("method") == "thread/start": send({"id":msg["id"], "result":{"thread":{"id":"video"}}})
    elif msg.get("method") == "turn/start":
        Path(RECORD).write_text(json.dumps(msg["params"]["input"]), encoding="utf-8")
        send({"method":"item/completed", "params":{"item":{"type":"agentMessage", "id":"answer", "phase":"final_answer", "text":"I watched it"}}})
        send({"method":"turn/completed", "params":{"turn":{"status":"completed"}}})
        break
''',
}


@pytest.fixture(scope="module")
def clip(tmp_path_factory):
    path = tmp_path_factory.mktemp("video") / "screen.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=20:size=1920x1080:rate=5",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)], check=True)
    return path


@pytest.fixture
async def setup(conn, tmp_path, client):
    team = Team(conn, tmp_path)
    rig = Rig(conn, client, FakeActions(), team=team.members, memory=team.memory,
              attachment_store=AttachmentStore(tmp_path / "data"))
    yield rig, team
    await rig.aclose()
    await team.memory.aclose()


def payload(clip):
    return {"session_id": "video", "member_id": 1, "source": "app", "ui_language": "en",
            "text": "What is on this screen recording?",
            "attachments": [{"name": "screen.mp4", "mime": "video/mp4", "data": base64.b64encode(clip.read_bytes()).decode()}]}


class Computer:
    """The member's computer as far as this turn goes: it exists, and nothing runs on it."""

    def stop_scope(self, *args, **kwargs):
        pass

    async def aclose(self):
        pass


def computer_folder(tmp_path):
    shared = tmp_path / "vm-shared"
    return shared, lambda member_id: (shared, "/home/cua/team")


@needs_ffmpeg
async def test_claude_is_handed_frames_with_their_times_and_told_where_the_original_is_in_its_own_computer(setup, tmp_path, clip):
    rig, team = setup
    assert member(team, name="Watcher", model="cli:claude").id == 1
    record = tmp_path / "content.json"
    fake_brain(rig, tmp_path, SCRIPTS["claude"].replace("RECORD", repr(str(record))), name="claude")
    shared, folder = computer_folder(tmp_path)
    rig.service._computer = Computer()
    rig.service.use_computer_folder(folder)
    result = await rig.call("agent.ask", payload(clip))
    assert result["text"] == "I watched it"
    content = json.loads(record.read_text(encoding="utf-8"))
    text = content[0]["text"]
    pictures = [block for block in content if block["type"] == "image"]
    labels = [block["text"] for block in content[1:] if block["type"] == "text"]
    # Eight frames at the least, each after its time, as JPEG of a recording 1920 wide: nothing of it left to the model to pull.
    assert len(pictures) == 8 and labels == [f"Frame at {t}:" for t in ("0:01", "0:03", "0:06", "0:08", "0:11", "0:13", "0:16", "0:18")]
    assert all(block["source"]["media_type"] == "image/jpeg" for block in pictures)
    assert [block["type"] for block in content[1:3]] == ["text", "image"]
    # The prompt names the original in the member's own computer, beside the owner's copy that the computer cannot open.
    listed = json.loads(text[text.index("\nFiles: ") + len("\nFiles: "):].split("\n", 1)[0])
    stored = Path(listed[0]["path"])
    assert listed[0]["computer_path"] == f"/home/cua/team/attachments/{stored.name}"
    assert (shared / "attachments" / stored.name).read_bytes() == clip.read_bytes() == stored.read_bytes()
    assert "File 1 is a video" in text and "computer_path" in text and "Frame at 0:35" in text and "start and end" in text


@needs_ffmpeg
async def test_codex_is_handed_each_frame_after_its_time(setup, tmp_path, clip):
    rig, team = setup
    assert member(team, name="Watcher", model="cli:codex").id == 1
    record = tmp_path / "input.json"
    fake_brain(rig, tmp_path, SCRIPTS["codex"].replace("RECORD", repr(str(record))), name="codex")
    result = await rig.call("agent.ask", payload(clip))
    assert result["text"] == "I watched it"
    items = json.loads(record.read_text(encoding="utf-8"))
    assert items[0]["type"] == "text" and "File 1 is a video" in items[0]["text"]
    # Without a computer folder nothing is claimed about one.
    assert "computer_path" not in items[0]["text"].split("\nFiles: ", 1)[1].split("\n", 1)[0]
    pairs = [(items[n]["text"], items[n + 1]["type"]) for n in range(1, len(items) - 1, 2)]
    assert len(items) == 1 + 2 * 8 and all(label.startswith("Frame at ") and kind == "localImage" for label, kind in pairs)
    assert all(Path(item["path"]).suffix == ".jpg" for item in items if item["type"] == "localImage")


@needs_ffmpeg
async def test_a_video_that_cannot_be_read_never_stops_the_turn(setup, tmp_path):
    rig, team = setup
    assert member(team, name="Watcher", model="cli:claude").id == 1
    record = tmp_path / "content.json"
    fake_brain(rig, tmp_path, SCRIPTS["claude"].replace("RECORD", repr(str(record))), name="claude")
    broken = {"session_id": "video", "member_id": 1, "source": "app", "ui_language": "en", "text": "Watch it",
              "attachments": [{"name": "broken.mp4", "mime": "video/mp4", "data": base64.b64encode(b"not a video" * 50).decode()}]}
    assert (await rig.call("agent.ask", broken))["text"] == "I watched it"
    content = json.loads(record.read_text(encoding="utf-8"))
    # No frames: the message goes as plain text, and says what the file is and how to read it.
    assert isinstance(content, str) and "File 1 is a video" in content and "read_attachment" in content


def test_a_task_and_a_room_speaker_are_told_about_the_video_the_same_way():
    stored = "0123456789abcdef0123456789abcdef.mp4"
    files = [replace(checked("screen.mp4", "video/mp4", b"video"), stored_id=stored)]
    where = f"/home/cua/team/attachments/{stored}"
    _, user = _prompts("What is in the video?", {}, [], RunLimits(), attachments=files, placed={stored: where},
                       brain=("claude", "claude-opus-5-5"))
    assert f"1. video/mp4: screen.mp4 (the original is in your own computer, at {where})" in user
    assert "File 1 is a video" in user and "start and end" in user and "Frame at 0:35" in user
    _, api = _prompts("What is in the video?", {}, [], RunLimits(), attachments=files)
    assert "File 1 is a video" in api and "Frame at" not in api and "your own computer" not in api

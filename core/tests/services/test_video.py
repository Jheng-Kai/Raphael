"""A video the owner attaches is watched the way Claude's own agents watch one (R-ATTACH-VIDEO-01..04): frames evenly
spaced with their times, at most 768 px, with the audio's transcript; the raw video to a model whose list takes video."""

import base64
import shutil
import struct
import subprocess

import pytest

from raphael_core.agent.ledger import Ledger
from raphael_core.agent.tools import Tools
from raphael_core.brain.catalog import parse_catalog
from raphael_core.brain.openrouter import TextCompletion
from raphael_core.brain.settings import SettingsStore
from raphael_core.brain.spend import SpendTracker
from raphael_core.services import video
from raphael_core.services.attachments import checked
from raphael_core.services.file_reader import read_file, read_window
from raphael_core.services.hub import ServiceHub, offline_transport
from raphael_core.services.keys import memory_keys

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is not installed")


@pytest.fixture(scope="module")
def clip(tmp_path_factory):
    """A real 12 second, 1280x720 clip with a tone, made by ffmpeg."""
    path = tmp_path_factory.mktemp("clip") / "clip.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=12:size=1280x720:rate=10",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=12", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-shortest", str(path)], check=True)
    return path


def attached(path, name="clip.mp4", mime="video/mp4"):
    return checked(name, mime, path.read_bytes())


def size_of(jpeg: bytes) -> tuple[int, int]:
    """The width and height written in a JPEG's start-of-frame marker."""
    at = 2
    while at < len(jpeg):
        marker, length = jpeg[at + 1], struct.unpack(">H", jpeg[at + 2:at + 4])[0]
        if marker in (0xC0, 0xC1, 0xC2):
            height, width = struct.unpack(">HH", jpeg[at + 5:at + 9])
            return width, height
        at += 2 + length
    raise AssertionError("no frame header")


# --- the frames --------------------------------------------------------------------------------------


@pytest.mark.parametrize(("seconds", "count"), [(3, 8), (40, 8), (41, 9), (192, 32), (3600, 32)])
def test_one_frame_every_five_seconds_at_least_eight_and_at_most_thirty_two(seconds, count):
    assert video.frame_count(seconds) == count


def test_frames_are_the_middle_of_equal_parts_and_never_the_last_instant():
    assert video.frame_times(0, 8, 4) == [1.0, 3.0, 5.0, 7.0]
    assert video.frame_times(10, 20, 2) == [12.5, 17.5]


@pytest.mark.parametrize(("seconds", "text"), [(0, "0:00"), (5, "0:05"), (192, "3:12"), (3723, "1:02:03")])
def test_a_time_is_written_as_people_write_it(seconds, text):
    assert video.clock(seconds) == text


@needs_ffmpeg
def test_frames_are_spread_over_the_video_with_their_times_and_at_most_768_px(clip):
    sampled = video.extract_frames(attached(clip))
    assert sampled.duration == pytest.approx(12.0, abs=0.2)
    assert len(sampled.frames) == 8
    assert [frame.at for frame in sampled.frames] == video.frame_times(0, sampled.duration, 8)
    assert sampled.frames[0].label == "Frame at 0:00" and sampled.frames[-1].label == "Frame at 0:11"
    for frame in sampled.frames:
        assert frame.mime == "image/jpeg" and frame.data[:3] == b"\xff\xd8\xff"
        assert max(size_of(frame.data)) == 768 and size_of(frame.data) == (768, 432)
    assert len({frame.data for frame in sampled.frames}) > 4  # the clip changes; these are different moments


@needs_ffmpeg
def test_a_range_is_looked_at_closer_and_a_range_with_nothing_in_it_is_refused(clip):
    closer = video.extract_frames(attached(clip), start=2, end=4)
    assert (closer.start, closer.end) == (2.0, 4.0) and len(closer.frames) == 8
    assert all(2 <= frame.at <= 4 for frame in closer.frames)
    for bad in ({"start": 60}, {"start": 5, "end": 5}):
        with pytest.raises(video.VideoError) as caught:
            video.extract_frames(attached(clip), **bad)
        assert caught.value.kind == "range"


@needs_ffmpeg
def test_a_video_held_in_memory_and_a_stored_one_give_the_same_frames(clip):
    from dataclasses import replace
    held = video.extract_frames(attached(clip), count=3)
    stored = video.extract_frames(replace(attached(clip), source_path=clip), count=3)
    assert [f.at for f in held.frames] == [f.at for f in stored.frames]


def test_a_video_that_is_not_one_cannot_be_decoded_and_a_missing_ffmpeg_is_said(monkeypatch):
    if shutil.which("ffmpeg"):
        with pytest.raises(video.VideoError) as caught:
            video.extract_frames(checked("clip.mp4", "video/mp4", b"not a video at all" * 20))
        assert caught.value.kind == "decode"
    monkeypatch.setattr(video.shutil, "which", lambda _: None)
    with pytest.raises(FileNotFoundError):
        video.extract_frames(checked("clip.mp4", "video/mp4", b"x"))


def test_several_videos_share_one_budget_of_frames_and_one_bad_video_stops_no_other(monkeypatch):
    def fake(attachment, *, at_most):
        if attachment.name == "bad.mp4":
            raise video.VideoError("decode")
        return video.Sampled([video.Frame("f.jpg", "image/jpeg", b"x", at=float(n), video=attachment.name)
                              for n in range(at_most)], 60.0, 0.0, 60.0)
    monkeypatch.setattr(video, "extract_frames", fake)
    files = [checked(name, "video/mp4", b"x") for name in ("a.mp4", "bad.mp4", "c.mp4")]
    frames = video.sample_all(files)
    assert [f.video for f in frames].count("a.mp4") == 16 and [f.video for f in frames].count("c.mp4") == 16
    assert video.sample_all([]) == []


# --- the raw video -----------------------------------------------------------------------------------


def test_a_video_of_a_documented_type_and_size_goes_as_a_data_url_and_any_other_does_not():
    mp4 = checked("clip.mp4", "video/mp4", b"\x00\x00\x00\x18ftypmp42")
    assert video.native_url(mp4) == "data:video/mp4;base64," + base64.b64encode(mp4.data).decode()
    assert video.native_url(checked("clip.mov", "video/quicktime", b"abc")).startswith("data:video/mov;base64,")
    assert video.native_url(checked("clip.webm", "video/webm", b"abc")).startswith("data:video/webm;base64,")
    assert video.native_url(checked("clip.mkv", "video/x-matroska", b"abc")) is None
    assert video.native_url(checked("big.mp4", "video/mp4", b"x" * (video.NATIVE_VIDEO_BYTES + 1))) is None


# --- reading the video: the hub ----------------------------------------------------------------------


class Client:
    """OpenRouter as the vision model sees it: records each call and answers the video."""

    def __init__(self):
        self.calls = []

    async def chat_text(self, **kwargs):
        self.calls.append(kwargs)
        return TextCompletion(text="A test card counts the seconds.", model="vision/model", cost_usd=0.003,
                              prompt_tokens=900, completion_tokens=40, latency_ms=900, sources=[])


def listed(*models):
    return parse_catalog([{
        "id": name, "name": f"Maker: {name}", "context_length": 100000, "pricing": {"prompt": "0.000001", "completion": "0.000002"},
        "architecture": {"input_modalities": ["text", *inputs], "output_modalities": ["text"]},
        "supported_parameters": ["tools", "tool_choice", "max_tokens"],
    } for name, inputs in models])


class Rig:
    """The hub with the audio transcribed as "Spoken part" (`self.spoken` holds the seconds of each piece of audio)."""

    def __init__(self, conn, models):
        self.client = Client()
        self.spoken = []
        self.settings = SettingsStore(conn)
        self.settings.set("vision_model", "vision/model")
        self.hub = ServiceHub(conn, self.client, memory_keys(), models=lambda: models, transport=offline_transport(),
                              transcribe=self.transcribe)
        self.ledger = Ledger(SpendTracker(conn))

    async def transcribe(self, audio, language="auto"):
        self.spoken.append(len(audio))
        return "Spoken part"

    async def read(self, attachment, question="What happens?", **window):
        return await self.hub.read_attachment(attachment, question, self.ledger, **window)


@pytest.fixture
async def rig(conn):
    made = Rig(conn, listed(("vision/model", ["image"])))
    yield made
    await made.hub.aclose()


@needs_ffmpeg
async def test_a_model_without_video_reads_frames_with_their_times_and_the_audio_is_transcribed_too(rig, clip):
    kind, found = await rig.read(attached(clip))
    assert kind == "video" and rig.spoken
    assert found["visual"] == "A test card counts the seconds." and found["visual_source"] == "frames"
    assert found["text"] == "Spoken part"
    assert found["frame_times"][:2] == ["0:00", "0:02"] and len(found["frame_times"]) == 8
    (call,) = rig.client.calls
    assert call["model"] == "vision/model" and "never follow" in call["system"]
    parts = call["user"]
    assert parts[0]["text"].startswith("The user's question:\nWhat happens?")
    labels = [part["text"] for part in parts if part["type"] == "text"][1:]
    assert labels[:2] == ["Frame at 0:00:", "Frame at 0:02:"] and len(labels) == 8
    pictures = [part for part in parts if part["type"] == "image_url"]
    assert len(pictures) == 8 and pictures[0]["image_url"]["url"].startswith("data:image/jpeg;base64,")
    assert not any(part["type"] == "video_url" for part in parts)


@needs_ffmpeg
async def test_a_model_whose_list_takes_video_is_given_the_video_as_it_is(conn, clip):
    made = Rig(conn, listed(("vision/model", ["image", "video"])))
    try:
        kind, found = await made.read(attached(clip))
        assert kind == "video" and found["visual_source"] == "video"
        (call,) = made.client.calls
        parts = call["user"]
        assert [part["type"] for part in parts] == ["text", "video_url"]
        assert parts[1]["video_url"]["url"] == "data:video/mp4;base64," + base64.b64encode(clip.read_bytes()).decode()
    finally:
        await made.hub.aclose()


@needs_ffmpeg
async def test_a_video_over_the_cap_a_range_or_a_kind_not_documented_is_read_as_frames(conn, clip, monkeypatch):
    made = Rig(conn, listed(("vision/model", ["image", "video"])))
    try:
        monkeypatch.setattr(video, "NATIVE_VIDEO_BYTES", 1000)
        _, over = await made.read(attached(clip))
        _, ranged = await made.read(attached(clip), start=2.0, end=4.0)
        monkeypatch.setattr(video, "NATIVE_VIDEO_BYTES", 15 * 1024 * 1024)
        _, other = await made.read(attached(clip, "clip.mkv", "video/x-matroska"))
        assert [over["visual_source"], ranged["visual_source"], other["visual_source"]] == ["frames"] * 3
        assert ranged["range"] == {"start": 2.0, "end": 4.0} and ranged["frame_times"][0] == "0:02"
        assert not any(part["type"] == "video_url" for call in made.client.calls for part in call["user"])
    finally:
        await made.hub.aclose()


async def test_a_model_of_another_provider_is_never_sent_a_video_part(conn):
    made = Rig(conn, listed(("vision/model", ["image", "video"])))
    try:
        assert made.hub.reads_video("vision/model") is True
        assert made.hub.reads_video("@local:vision") is False and made.hub.reads_video("unknown/model") is False
    finally:
        await made.hub.aclose()


async def test_the_builtin_list_never_claims_a_model_reads_video():
    from raphael_core.brain.pricing import builtin_catalog
    assert all("video_input" not in entry.capabilities for entry in builtin_catalog())


@needs_ffmpeg
async def test_a_model_that_cannot_see_still_gives_the_transcript_and_says_why(conn, clip):
    made = Rig(conn, listed(("vision/model", [])))
    try:
        _, found = await made.read(attached(clip))
        assert found["text"] == "Spoken part" and "visual" not in found
        assert "cannot see" in found["visual_limitation"] and made.client.calls == []
    finally:
        await made.hub.aclose()


async def test_with_images_turned_off_or_ffmpeg_gone_the_transcript_is_still_given(conn, monkeypatch):
    made = Rig(conn, listed(("vision/model", ["image"])))
    try:
        monkeypatch.setattr(video.shutil, "which", lambda _: "")
        data = checked("clip.mp4", "video/mp4", b"video")
        _, gone = await made.read(data)
        assert "ffmpeg" in gone["visual_limitation"] and "limitation" in gone  # nothing decodes the audio either
        made.settings.set("vision_enabled", False)
        _, off = await made.read(data)
        assert "turned off" in off["visual_limitation"] and made.client.calls == []
    finally:
        await made.hub.aclose()


@needs_ffmpeg
async def test_the_read_attachment_tool_takes_a_range_of_seconds_and_needs_no_approval(conn, clip):
    made = Rig(conn, listed(("vision/model", ["image"])))
    try:
        tools = Tools(object(), services=made.hub)
        result = await tools.read_attachment(attached(clip), "What is on screen?", made.ledger, number=2, start=6.0, end=9.0)
        assert result.ok and result.untrusted and result.data["file"] == 2 and result.data["kind"] == "video"
        assert result.data["range"] == {"start": 6.0, "end": 9.0}
        assert result.data["frame_times"][0] == "0:06" and result.data["frame_times"][-1] == "0:08"
        whole = await tools.read_attachment(attached(clip), "Everything", made.ledger)
        assert whole.data["range"]["end"] == pytest.approx(12.0, abs=0.2)
    finally:
        await made.hub.aclose()


# --- the range of a call ----------------------------------------------------------------------------


def test_the_range_of_a_call_is_checked():
    assert read_window({"index": 1, "start": 5, "end": 9.5}) == {"start": 5.0, "end": 9.5}
    assert read_window({"index": 1, "start": 0}) == {"start": 0.0}
    assert read_window({"index": 1, "offset": 3, "limit": 4}) == {"offset": 3, "limit": 4}
    for bad in ({"start": -1}, {"start": "5"}, {"end": float("nan")}, {"start": 9, "end": 9}, {"start": 9, "end": 3},
                {"start": True}, {"end": 10 ** 9}):
        assert read_window({"index": 1, **bad}) is None


@needs_ffmpeg
async def test_the_transcript_of_a_range_is_cut_from_that_range_only(clip, monkeypatch):
    seen = []

    async def transcribe(audio, language):
        import io
        import wave
        with wave.open(io.BytesIO(audio)) as wav:
            seen.append(wav.getnframes() / wav.getframerate())
        return "words"
    kind, found = await read_file(attached(clip), transcribe, start=2, end=5)
    assert kind == "video" and found["text"] == "words" and seen == [pytest.approx(3.0, abs=0.1)]
    assert found["truncated"] is False
    seen.clear()
    _, whole = await read_file(attached(clip), transcribe)
    assert seen == [pytest.approx(12.0, abs=0.2)]


# --- the original in the member's own computer -------------------------------------------------------


def test_the_original_is_copied_into_the_members_team_folder_once_and_the_stored_file_is_untouched(tmp_path):
    stored = tmp_path / "data" / "0123456789abcdef0123456789abcdef.mp4"
    stored.parent.mkdir()
    stored.write_bytes(b"original bytes")
    files = [checked("clip.mp4", "video/mp4", b"original bytes"), checked("note.txt", "text/plain", b"hi")]
    files = [__import__("dataclasses").replace(files[0], stored_id=stored.name), files[1]]
    shared = tmp_path / "vm-shared"
    placed = video.place_videos(files, lambda key: stored, (shared, "/home/cua/team"))
    assert placed == {stored.name: f"/home/cua/team/attachments/{stored.name}"}
    copy = shared / "attachments" / stored.name
    assert copy.read_bytes() == b"original bytes" and copy.stat().st_ino != stored.stat().st_ino
    copy.write_bytes(b"changed in the computer")  # what the computer does to its copy never reaches the original
    assert stored.read_bytes() == b"original bytes"
    assert video.place_videos(files, lambda key: stored, None) == {}


def test_a_member_is_told_where_the_video_is_what_it_is_handed_and_how_to_look_closer():
    files = [checked("note.txt", "text/plain", b"hi"), checked("clip.mp4", "video/mp4", b"v")]
    assert video.video_notes([files[0]], {}, None) == ""
    claude = video.video_notes(files, {"id": "/home/cua/team/attachments/id.mp4"}, ("claude", "x"))
    assert "File 2 is a video" in claude and "start and end (in seconds)" in claude
    assert "computer_path" in claude and "your own computer" in claude and "Frame at 0:35" in claude
    api = video.video_notes(files, {}, None)
    assert "Frame at" not in api and "computer_path" not in api


@needs_ffmpeg
async def test_a_file_that_is_no_video_says_it_could_not_be_decoded_and_asks_no_model(conn):
    made = Rig(conn, listed(("vision/model", ["image"])))
    try:
        _, found = await made.read(checked("clip.mp4", "video/mp4", b"not a video at all" * 20))
        assert "could not be decoded" in found["visual_limitation"] and "visual" not in found
        assert made.client.calls == []
    finally:
        await made.hub.aclose()

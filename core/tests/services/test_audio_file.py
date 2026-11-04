import io
import wave

import pytest

from raphael_core.agent.tools import Tools
from raphael_core.services.attachment_store import AttachmentStore
from raphael_core.services.hub import ServiceHub


class Voice:
    audio_file = ServiceHub.audio_file
    def enabled(self, capability):
        return True

    def tts_service(self):
        return "fish"

    async def speech(self, text, *, voice=None):
        assert text == "The owner's script"
        assert voice == "chosen-voice"
        yield b"\x01\x00" * 120
        yield b"\x02\x00" * 120


async def test_the_shared_voice_stream_becomes_a_playable_stored_file(tmp_path):
    store = AttachmentStore(tmp_path)
    tools = Tools(object(), services=Voice())
    result = await tools.generate_audio({"text": "The owner's script", "voice": "chosen-voice"}, store)
    assert result.ok
    file = result.data["attachment"]
    assert file["mime"] == "audio/wav"
    with wave.open(io.BytesIO(store.path(file["id"]).read_bytes())) as audio:
        assert audio.getnchannels() == 1
        assert audio.getsampwidth() == 2
        assert audio.getnframes() == 240


async def test_missing_voice_has_visible_repair_metadata(tmp_path):
    result = await Tools(object()).generate_audio({"text": "hello"}, AttachmentStore(tmp_path))
    assert not result.ok
    assert result.data["missing"]["repair"] == "voice"

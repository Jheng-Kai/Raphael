import json

from raphael_core.services.attachment_store import AttachmentStore
from services.test_audio_file import Voice
from .test_service import make_rig  # noqa: F401
from .test_narration import chat, typed


async def test_a_model_generates_audio_and_the_owner_receives_a_stored_audio_card(make_rig, client, tmp_path):
    store = AttachmentStore(tmp_path)
    rig = make_rig(services=Voice(), attachment_store=store)
    client.chats = [chat("Preparing audio", ("generate_audio", {"text": "The owner's script", "voice": "chosen-voice"})), chat("Here is the audio file")]
    result = await typed(rig, "Make this an audio file")
    assert result["text"] == "Here is the audio file"
    assert "generate_audio" in {item["function"]["name"] for item in client.chat_calls[0]["tools"]}
    [turn] = await rig.turns()
    [media] = [message for message in turn["messages"] if message["kind"] == "media"]
    file = json.loads(media["text"])["attachment"]
    assert file["mime"] == "audio/wav" and store.path(file["id"]).read_bytes().startswith(b"RIFF")


async def test_missing_voice_is_a_visible_conversation_notice_with_the_repair(make_rig, client, tmp_path):
    rig = make_rig(attachment_store=AttachmentStore(tmp_path))
    client.chats = [chat("Preparing audio", ("generate_audio", {"text": "Hello"})), chat("Please set up the voice service")]
    await typed(rig, "Make audio")
    [turn] = await rig.turns()
    notices = [json.loads(message["text"]) for message in turn["messages"] if message["kind"] == "media"]
    assert notices[0]["missing"]["repair"] == "voice"
    assert turn["steps"][0]["missing"]["repair"] == "voice"

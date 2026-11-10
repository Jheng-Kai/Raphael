import json

from raphael_core.agent.history import AgentHistory
from raphael_core.brain.settings import SettingsStore
from raphael_core.services.attachment_store import AttachmentStore
from services.test_audio_file import Voice
from .conftest import report, turn, use


async def test_a_background_model_uses_the_same_voice_and_leaves_a_playable_file(make_rig, conn, tmp_path):
    rig = make_rig()
    rig.tools.services = Voice()
    store = AttachmentStore(tmp_path)
    rig.service.use_attachment_store(store)
    history = AgentHistory(conn)
    turn_id = history.add(session_id="s1", question="Make audio", route="delegate", prefix="", text="Working", status="running", cost_usd=0)
    rig.client.replies = [turn(calls=[use("generate_audio", {"text": "The owner's script", "voice": "chosen-voice"})]), report()]
    task_id = rig.submit()
    rig.service.attach_turn(task_id, turn_id)
    await rig.wait_for_reports()
    [media] = [message for message in history.messages([turn_id])[turn_id] if message["kind"] == "media"]
    file = json.loads(media["text"])["attachment"]
    assert file["mime"] == "audio/wav" and store.path(file["id"]).read_bytes().startswith(b"RIFF")


async def test_the_existing_paid_tool_cap_refuses_audio_before_calling_the_service(make_rig, conn, tmp_path):
    class RefusedVoice(Voice):
        async def audio_file(self, *args, **kwargs):
            raise AssertionError("the capped task must not reach the voice service")

    rig = make_rig()
    rig.tools.services = RefusedVoice()
    rig.service.use_attachment_store(AttachmentStore(tmp_path))
    SettingsStore(conn).set("worker_cost_cap_usd", 0.1)
    rig.client.replies = [turn(calls=[use("generate_audio", {"text": "The owner's script"})], cost=0.1), report("Stopped at the spending cap")]
    task_id = rig.submit()
    await rig.wait_for_reports()
    assert rig.task(task_id).reason == "limit_cost"
    assert not list((tmp_path / "attachments").glob("*.wav"))

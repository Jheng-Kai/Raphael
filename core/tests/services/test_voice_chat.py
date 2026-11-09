"""Call integration with fake recognition, streamed TTS and audio devices. No network."""
import asyncio
import queue
import sqlite3
from types import SimpleNamespace

import numpy as np
import pytest

from raphael_core.agent.conversations import Conversations
from raphael_core.agent.history import AgentHistory
from raphael_core.brain import db
from raphael_core.device.dictation import DictationService
from raphael_core.protocol import INVALID_PARAMS, NO_MICROPHONE, NO_LOCAL_MODEL, RpcError
from raphael_core.router import Router
from raphael_core.services.speaker import Speaker
from raphael_core.services.tts import PCM_RATE
from raphael_core.voice_chat import VoiceChat, call_views


def test_v67_preserves_existing_conversation_and_rolls_back_a_failed_upgrade(monkeypatch):
    with monkeypatch.context() as old:
        old.setattr(db, "LATEST_VERSION", 64)
        connection = db.connect(":memory:")
    try:
        conversation = Conversations(connection, lambda: 1000).main(1)
        with connection:
            turn = connection.execute(
                "INSERT INTO agent_turns(created_at_ms,session_id,question,route,prefix,text,status,member_id,conversation_id)"
                " VALUES(1000,'existing','Keep this','answer','','Reply','done',1,?)", (conversation,),
            ).lastrowid
        connection.execute("CREATE TABLE voice_call_turns (placeholder TEXT)")
        connection.commit()
        with pytest.raises(sqlite3.OperationalError):
            db.migrate(connection)
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 64
        assert not connection.execute("SELECT 1 FROM sqlite_master WHERE name='voice_calls'").fetchone()
        connection.execute("DROP TABLE voice_call_turns")
        connection.commit()
        db.migrate(connection)
        db.migrate(connection)
        assert connection.execute("PRAGMA user_version").fetchone()[0] == db.LATEST_VERSION
        assert connection.execute("SELECT question FROM agent_turns WHERE id=?", (turn,)).fetchone()[0] == "Keep this"
    finally:
        connection.close()


async def test_call_after_conversation_fold_uses_main_and_refuses_the_deleted_id(monkeypatch):
    with monkeypatch.context() as old:
        old.setattr(db, "LATEST_VERSION", 67)
        connection = db.connect(":memory:")
    main = Conversations(connection).main(1)
    extra = connection.execute("INSERT INTO conversations(member_id,title,created_at_ms,updated_at_ms) VALUES(1,'Old',1,2)").lastrowid
    history = AgentHistory(connection)
    with connection:
        turn = connection.execute(
            "INSERT INTO agent_turns(created_at_ms,session_id,question,route,prefix,text,status,member_id,conversation_id)"
            " VALUES(1,'previous-call','Saved call','answer','','Member reply','done',1,?)", (extra,),
        ).lastrowid
        history._index(turn, "Saved call", "Member reply", None)
    connection.execute("INSERT INTO voice_calls(id,member_id,conversation_id,started_at_ms,ended_at_ms,summary_id) VALUES('old-call',1,?,1,2,?)", (extra, turn))
    connection.execute("INSERT INTO voice_call_turns VALUES('old-call',?)", (turn,))
    connection.commit()
    db.migrate(connection)
    rig = Rig(connection)
    try:
        with pytest.raises(RpcError) as error:
            await rig.rpc.call("voice_chat.start", {"member_id": 1, "conversation_id": extra})
        assert error.value.code == INVALID_PARAMS
        assert rig.recording is None
        await rig.start(1)
        assert rig.calls.current.conversation_id == main
        assert connection.execute("SELECT conversation_id FROM voice_calls WHERE id='old-call'").fetchone()[0] == main
        assert history.get(turn).conversation_id == main
    finally:
        await rig.close()
        connection.close()


async def until(predicate):
    for _ in range(600):
        if predicate():
            return
        await asyncio.sleep(0.005)
    raise AssertionError("state did not settle")


class Player:
    def __init__(self):
        self.blocks = []
        self.stopped = None
        self.rate = None

    def play(self, source, rate, stopped, started):
        self.stopped, self.rate = stopped, rate
        while not stopped.is_set():
            try:
                block = source.get(timeout=0.005)
            except queue.Empty:
                continue
            if stopped.is_set() or block is None:
                return
            self.blocks.append(block)
            started()


class Hub:
    def __init__(self):
        self.ready = True
        self.release = asyncio.Event()
        self.fail = None
        self.voices = []

    def tts_ready(self, **kwargs):
        return self.ready

    async def speech(self, text, **kwargs):
        self.voices.append(kwargs.get("voice"))
        yield b"\x01\x00" * 160
        await self.release.wait()
        if self.fail:
            from raphael_core.services.common import ServiceError
            raise ServiceError(self.fail)
        yield b"\x02\x00" * 160


class Rig:
    def __init__(self, conn):
        self.conn = conn
        self.rpc = Router()
        self.hub, self.player = Hub(), Player()
        self.speaker = Speaker(self.hub, self.player)
        self.speaker.register(self.rpc)
        self.history = AgentHistory(conn, lambda: 1000)
        self.conversations = Conversations(conn, lambda: 1000)
        self.cancelled, self.recognizers = [], []
        self.recording = None
        self.open_error = None
        self.start_entered = self.start_release = None
        self.next_text = "Owner question"
        self.next_status = "done"
        self.stop_entered = self.stop_release = None
        self.reply = asyncio.Event()
        self.reply.set()
        team = SimpleNamespace(member=lambda key: SimpleNamespace(id=key, name="Member", voice="member-voice", avatar="slime:shion") if key in (1, 2) else None)
        agent = SimpleNamespace(conversations=self.conversations, stop_session=self.cancelled.append)
        self.calls = VoiceChat(conn, self.rpc, agent, team, self.speaker, self.hub, now_ms=lambda: 5000)
        self.calls.register()
        self.rpc.register("dictation.start", self.start_recognition)
        self.rpc.register("dictation.stop", self.stop_recognition)
        self.rpc.register("dictation.cancel", self.cancel_recognition)
        self.rpc.register("agent.ask", self.ask)

    async def start_recognition(self, params):
        if self.start_release:
            self.start_entered.set()
            await self.start_release.wait()
        if self.open_error:
            raise self.open_error
        self.recording = params["session_id"]
        self.recognizers.append(params)
        return {}

    async def stop_recognition(self, params):
        assert params["session_id"] == self.recording
        self.recording = None
        if self.stop_release:
            self.stop_entered.set()
            await self.stop_release.wait()
        return {"text": self.next_text}

    async def cancel_recognition(self, params):
        if self.recording == params["session_id"]:
            self.recording = None
        return {}

    async def ask(self, params):
        turn = self.history.add(session_id=params["session_id"], question=params["text"], route="answer", prefix="", text="", status="running", source=params["source"], member_id=params["member_id"], conversation_id=params["conversation_id"])
        try:
            await self.reply.wait()
            with self.conn:
                self.conn.execute("UPDATE agent_turns SET text='Member reply',status=? WHERE id=?", (self.next_status, turn))
        except asyncio.CancelledError:
            with self.conn:
                self.conn.execute("UPDATE agent_turns SET status='cancelled' WHERE id=?", (turn,))
            raise
        return {"turn_id": turn}

    async def start(self, member=1):
        result = await self.calls.start({"member_id": member, "ui_language": "en"})
        await until(lambda: self.calls.current is None or self.calls.current.state != "connecting")
        return result

    def speak(self):
        self.calls.activity(self.recording, "speech")
        self.calls.activity(self.recording, "pause")

    async def close(self):
        await self.calls.aclose()
        await self.speaker.aclose()


@pytest.mark.asyncio
async def test_turn_taking_streams_member_voice_and_keeps_one_folded_receipt(conn):
    rig = Rig(conn)
    try:
        await rig.start()
        call = rig.calls.current
        rig.speak()
        await until(lambda: call.state == "speaking" and rig.player.blocks)
        assert len(rig.recognizers) == 2  # Listening for an interruption during playback.
        assert rig.hub.voices == ["member-voice"]
        rig.hub.release.set()
        await until(lambda: call.state == "listening")
        assert (await rig.calls.status({}))["call"]["transcript"][0]["text"] == "Member reply"
        result = await rig.calls.end({"call_id": call.id})
        assert await rig.calls.end({"call_id": call.id}) == result
        assert conn.execute("SELECT count(*) FROM agent_turns WHERE route='voice_call'").fetchone()[0] == 1
        linked, summaries = call_views(conn, [row[0] for row in conn.execute("SELECT id FROM agent_turns")])
        assert len(linked) == len(summaries) == 1
        assert next(iter(summaries.values()))["transcript"][0]["question"] == "Owner question"
        await rig.calls.feedback({"call_id": call.id, "rating": "good"})
        assert conn.execute("SELECT rating FROM voice_calls").fetchone()[0] == "good"
    finally:
        await rig.close()


@pytest.mark.asyncio
async def test_an_owner_approval_finishes_on_the_normal_turn_before_the_reply_is_spoken(conn):
    rig = Rig(conn)
    rig.next_status = "confirm"
    try:
        await rig.start()
        call = rig.calls.current
        rig.speak()
        await until(lambda: bool(conn.execute("SELECT 1 FROM agent_turns WHERE status='confirm'").fetchone()))
        assert not rig.hub.voices and call.state == "thinking"
        with conn:
            conn.execute("UPDATE agent_turns SET status='done',text='Approved reply' WHERE status='confirm'")
        rig.calls.turn_changed()
        await until(lambda: call.state == "speaking")
        assert rig.hub.voices == ["member-voice"]
        assert (await rig.calls.status({}))["call"]["transcript"][0]["text"] == "Approved reply"
    finally:
        await rig.close()


@pytest.mark.asyncio
async def test_barge_in_sets_stop_before_another_audio_chunk_and_invalidates_old_reply(conn):
    rig = Rig(conn)
    try:
        await rig.start()
        call = rig.calls.current
        rig.speak()
        await until(lambda: call.state == "speaking" and rig.player.blocks)
        before = len(rig.player.blocks)
        rig.calls.activity(rig.recording, "speech")
        assert rig.player.stopped.is_set()  # Synchronous, before the next player chunk.
        rig.hub.release.set()
        await asyncio.sleep(0.05)
        assert len(rig.player.blocks) == before
        assert call.state == "listening"
        assert rig.cancelled
    finally:
        await rig.close()


@pytest.mark.asyncio
async def test_one_call_across_members_mute_and_hangup_during_pending_answer(conn):
    rig = Rig(conn)
    try:
        first, second = await asyncio.gather(rig.calls.start({"member_id": 1}), rig.calls.start({"member_id": 2}))
        assert first["call"]["id"] == second["busy"]["id"]
        call = rig.calls.current
        await until(lambda: call.state == "listening")
        await rig.calls.mute({"call_id": call.id, "muted": True})
        assert rig.recording is None
        rig.calls.activity(rig.recognizers[-1]["session_id"], "pause")
        assert call.task is None
        await rig.calls.mute({"call_id": call.id, "muted": False})
        rig.reply.clear()
        rig.speak()
        await until(lambda: conn.execute("SELECT count(*) FROM agent_turns").fetchone()[0] == 1)
        await rig.calls.end({"call_id": call.id})
        assert conn.execute("SELECT question FROM agent_turns WHERE route='answer'").fetchone()[0] == "Owner question"
        assert rig.recording is None and rig.calls.current is None
        assert (await rig.calls.start({"member_id": 2}))["call"]["member_id"] == 2
    finally:
        await rig.close()


@pytest.mark.asyncio
async def test_mute_while_connecting_does_not_turn_a_cancelled_device_open_into_a_call_failure(conn):
    rig = Rig(conn)
    rig.start_entered, rig.start_release = asyncio.Event(), asyncio.Event()
    rig.open_error = RpcError(NO_MICROPHONE, "cancelled device open")
    try:
        await rig.calls.start({"member_id":1})
        call = rig.calls.current
        await rig.start_entered.wait()
        await rig.calls.mute({"call_id":call.id,"muted":True})
        rig.start_release.set()
        await call.opening
        assert rig.calls.current is call and call.state == "muted"
        assert call.failure is None and call.recording is None
    finally:
        await rig.close()


@pytest.mark.asyncio
async def test_muting_discards_a_recognizer_tail_that_finishes_after_cancel(conn):
    rig = Rig(conn)
    entered, release = asyncio.Event(), asyncio.Event()
    rig.stop_entered, rig.stop_release = entered, release
    try:
        await rig.start()
        call = rig.calls.current
        rig.speak()
        await entered.wait()
        await rig.calls.mute({"call_id": call.id, "muted": True})
        release.set()
        await call.task
        assert call.state == "muted"
        assert conn.execute("SELECT count(*) FROM agent_turns").fetchone()[0] == 0
        assert rig.recording is None
    finally:
        await rig.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("code,kind", [(NO_MICROPHONE, "microphone"), (NO_LOCAL_MODEL, "model")])
async def test_missing_microphone_or_model_ends_honestly(conn, code, kind):
    rig = Rig(conn)
    rig.open_error = RpcError(code, "synthetic unavailable device")
    try:
        await rig.start()
        result = await rig.calls.status({})
        assert result["call"] is None and result["ended"]["failure"] == kind
        assert conn.execute("SELECT count(*) FROM voice_calls WHERE ended_at_ms IS NOT NULL").fetchone()[0] == 1
    finally:
        await rig.close()


@pytest.mark.asyncio
async def test_missing_key_and_network_loss_preserve_transcript(conn):
    rig = Rig(conn)
    try:
        rig.hub.ready = False
        assert await rig.calls.start({"member_id": 1}) == {"failure": "voice"}
        assert rig.calls.current is None and not rig.recognizers
        rig.hub.ready = True
        await rig.start()
        rig.speak()
        await until(lambda: rig.calls.current.state == "speaking")
        rig.hub.fail = "network"
        rig.hub.release.set()
        await until(lambda: rig.calls.current is None)
        result = await rig.calls.status({})
        assert result["ended"]["failure"] == "network"
        assert result["ended"]["transcript"][0]["text"] == "Member reply"
    finally:
        await rig.close()


@pytest.mark.asyncio
async def test_a_failed_audio_device_ends_the_call_and_keeps_the_admitted_reply(conn):
    rig = Rig(conn)
    def failed_player(*args):
        raise OSError("synthetic audio device failure")
    rig.player.play = failed_player
    try:
        await rig.start()
        rig.speak()
        await until(lambda: rig.calls.current is None)
        result = await rig.calls.status({})
        assert result["ended"]["failure"] == "network"
        assert result["ended"]["transcript"][0]["text"] == "Member reply"
    finally:
        await rig.close()


@pytest.mark.asyncio
async def test_restart_closes_one_receipt_and_recovers_an_interrupted_metadata_write(conn):
    rig = Rig(conn)
    await rig.start()
    call = rig.calls.current
    rig.speak()
    await until(lambda: call.state == "speaking")
    await rig.calls.end({"call_id": call.id})
    # Simulate a crash between the history receipt and its metadata update.
    with conn:
        conn.execute("UPDATE voice_calls SET summary_id=NULL,ended_at_ms=NULL")
    recovered = VoiceChat(conn, rig.rpc, rig.calls.agent, rig.calls.team, rig.speaker, rig.hub)
    assert recovered.current is None
    assert conn.execute("SELECT count(*) FROM agent_turns WHERE route='voice_call'").fetchone()[0] == 1
    assert conn.execute("SELECT failure FROM voice_calls").fetchone()[0] == "interrupted"
    assert conn.execute("SELECT count(*) FROM voice_call_turns").fetchone()[0] == 1
    await rig.close()


@pytest.mark.asyncio
async def test_deleting_the_conversation_releases_its_live_microphone(conn):
    rig = Rig(conn)
    try:
        await rig.start()
        call = rig.calls.current
        with conn:
            conn.execute("DELETE FROM conversations WHERE id=?", (call.conversation_id,))
        assert (await rig.calls.status({}))["call"] is None
        assert rig.recording is None
        assert conn.execute("SELECT count(*) FROM voice_calls").fetchone()[0] == 0
    finally:
        await rig.close()


@pytest.mark.asyncio
async def test_call_settings_are_bounded_and_rooms_refused(conn):
    rig = Rig(conn)
    try:
        with pytest.raises(RpcError):
            await rig.calls.start({"member_id": 1, "room_id": 1})
        await rig.start()
        call = rig.calls.current
        for params in ({"speed": 99}, {"language": "unknown"}, {"voice": "unowned"}):
            with pytest.raises(RpcError):
                await rig.calls.settings({"call_id": call.id, **params})
        await rig.calls.settings({"call_id": call.id, "speed": 1.25, "language": "ja"})
        assert rig.recognizers[-1]["language"] == "ja"
        rig.speak()
        await until(lambda: rig.player.rate is not None)
        assert rig.player.rate == round(PCM_RATE * 1.25)
    finally:
        await rig.close()


@pytest.mark.asyncio
async def test_real_dictation_vad_pauses_only_calls_and_uses_selected_language(conn):
    class Recorder:
        error = None
        def __init__(self, callback): self.push = callback
        def start(self): pass
        def stop(self): pass

    class Segmenter:
        speech_seconds = 0.0
        silence_seconds = 0.0
        def accept(self, frames):
            seconds = len(frames) / 16000
            if np.max(frames) > 0:
                self.speech_seconds += seconds
                self.silence_seconds = 0
                return [frames]
            self.silence_seconds += seconds
            return []
        def flush(self): return []

    class Engine:
        def transcribe(self, samples, **kwargs):
            assert kwargs["language"] == "ja"
            return "Recognized words"

    rpc = Router()
    async def dictionary(params): return {"entries": []}
    rpc.register("dictionary.list", dictionary)
    recorders, phases = [], []
    def recorder(callback):
        device = Recorder(callback)
        recorders.append(device)
        return device
    service = DictationService(rpc, recorder_factory=recorder, segmenter_factory=Segmenter,
                              engine_provider=Engine, on_voice_activity=lambda session, phase: phases.append((session, phase)))
    service.register(rpc)
    try:
        await rpc.call("dictation.start", {"session_id": "call", "purpose": "voice_chat", "language": "ja"})
        recorders[-1].push(np.ones(6400, dtype=np.float32))
        recorders[-1].push(np.zeros(14400, dtype=np.float32))
        await until(lambda: len(phases) == 2)
        assert phases == [("call", "speech"), ("call", "pause")]
        result = await rpc.call("dictation.stop", {"session_id": "call"})
        assert result["text"] == "Recognized words"
        await rpc.call("dictation.start", {"session_id": "hotkey"})
        recorders[-1].push(np.zeros(16000, dtype=np.float32))
        await asyncio.sleep(0.03)
        assert service.active and len(phases) == 2
        await rpc.call("dictation.cancel", {"session_id": "hotkey"})
    finally:
        await service.aclose()


def test_call_transcript_retains_all_authored_messages(conn):
    from raphael_core.agent.history import AgentHistory
    from raphael_core.agent.conversations import Conversations
    from raphael_core.voice_chat import call_transcript

    history = AgentHistory(conn)
    conversation = Conversations(conn).main(0)
    turn = history.add(session_id="call", question="Full answer", route="answer", prefix="", text="Last message", status="done", conversation_id=conversation)
    history.add_message(turn, "reply", "First complete part")
    history.add_message(turn, "reply", "Last message")
    conn.execute("INSERT INTO voice_calls(id,member_id,conversation_id,started_at_ms) VALUES('fixture',0,?,1)", (conversation,))
    conn.execute("INSERT INTO voice_call_turns VALUES('fixture',?)", (turn,))
    conn.commit()
    assert call_transcript(conn, "fixture")[0]["text"] == "First complete part\n\nLast message"

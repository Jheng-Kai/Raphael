"""One owner/member call, using the existing dictation, agent and PCM speaker.

Only metadata is stored here. Questions and replies remain ordinary private turns.
Activity comes from the dictation VAD on the loop, never from a second recorder.
"""

import asyncio
import time
import uuid
from dataclasses import dataclass, field

from .agent.history import AgentHistory
from .protocol import BUSY, NOT_CONFIGURED, NO_LOCAL_MODEL, NO_MICROPHONE, RpcError, invalid_params

CALL_SOURCE = "voicecall"

@dataclass
class Call:
    id: str
    member_id: int
    conversation_id: int
    started_at_ms: int
    voice: str
    ui_language: str
    state: str = "connecting"
    muted: bool = False
    speed: float = 1.0
    language: str = "auto"
    recording: str | None = None
    request: str | None = None
    generation: int = 0
    task: asyncio.Task | None = None
    answer: asyncio.Task | None = None
    opening: asyncio.Task | None = None
    failure: str | None = None
    summary_id: int | None = None
    updated: asyncio.Event = field(default_factory=asyncio.Event)


class VoiceChat:
    def __init__(self, conn, router, agent, team, speaker, hub, *, now_ms=None):
        self.conn, self.router, self.agent, self.team = conn, router, agent, team
        self.speaker, self.hub = speaker, hub
        self.now_ms = now_ms or (lambda: int(time.time() * 1000))
        self.history = AgentHistory(conn, self.now_ms)
        self.current: Call | None = None
        self.last_ended: Call | None = None
        self.lock = asyncio.Lock()
        # A crashed process cannot own a microphone after restart. Keep its words.
        for row in conn.execute("SELECT * FROM voice_calls WHERE ended_at_ms IS NULL").fetchall():
            call = Call(row["id"], row["member_id"], row["conversation_id"], row["started_at_ms"], "", "en")
            self._save_end(call, "interrupted")

    def register(self):
        for name in ("start", "status", "mute", "settings", "end", "feedback"):
            self.router.register(f"voice_chat.{name}", getattr(self, name))

    def _matches(self, call):
        return self.current is call and call.state != "ended"

    def _call(self, params):
        call = self.current
        if call is None or params.get("call_id") != call.id:
            raise invalid_params("call_id must name the current call")
        return call

    def _wire(self, call):
        member = self.team.member(call.member_id)
        return dict(id=call.id, member_id=call.member_id, conversation_id=call.conversation_id,
                    name=member.name if member else "", avatar=member.avatar if member else None,
                    started_at_ms=call.started_at_ms, state=call.state, muted=call.muted,
                    voice=call.voice, member_voice=member.voice if member else "", speed=call.speed, language=call.language,
                    failure=call.failure, summary_id=call.summary_id,
                    transcript=call_transcript(self.conn, call.id))

    async def start(self, params):
        if any(key in params for key in ("room_id", "thread_id")):
            raise invalid_params("voice calls are private conversations only")
        member_id = params.get("member_id")
        if type(member_id) is not int or member_id <= 0 or not (member := self.team.member(member_id)):
            raise invalid_params("member_id must name a member")
        conversation_id = self.agent.conversations.resolve(member_id, params.get("conversation_id"))
        language = params.get("ui_language", "en")
        if language not in ("en", "zh-TW", "ja"):
            raise invalid_params("ui_language is unsupported")
        async with self.lock:
            if self.current:
                return {"busy": self._wire(self.current)}
            if not self.hub.tts_ready(voice=member.voice):
                return {"failure": "voice"}
            call = Call(uuid.uuid4().hex, member_id, conversation_id, self.now_ms(), member.voice, language)
            with self.conn:
                self.conn.execute("INSERT INTO voice_calls(id,member_id,conversation_id,started_at_ms) VALUES(?,?,?,?)",
                                  (call.id, member_id, conversation_id, call.started_at_ms))
            self.current = call
            call.opening = asyncio.create_task(self._connect(call))
            return {"call": self._wire(call)}

    async def _connect(self, call):
        try:
            await self._record(call)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self._fail(call, exc)

    async def _record(self, call):
        if not self._matches(call) or call.muted or call.recording is not None:
            return
        session = f"call-{call.id}-{uuid.uuid4().hex}"
        call.recording = session
        try:
            await self.router.call("dictation.start", {"session_id": session, "purpose": "voice_chat",
                                   "ui_language": call.ui_language, "language": call.language})
        except Exception:
            if not self._matches(call) or call.muted or call.recording != session:
                return
            raise
        if not self._matches(call) or call.muted or call.recording != session:
            await self.router.call("dictation.cancel", {"session_id": session})
            return
        if call.answer is None or call.answer.done():
            call.state = "listening"

    def activity(self, session, phase):
        """Called on the event loop by dictation after VAD, before another PCM block."""
        call = self.current
        if call is None or call.recording != session or call.muted:
            return
        if phase == "speech":
            call.generation += 1
            # Setting the speaker's stop event is synchronous; its player checks each block.
            self.speaker.stop()
            if call.request:
                self.agent.stop_session(call.request)
            if call.answer and not call.answer.done():
                call.answer.cancel()
            call.state = "listening"
        elif phase in ("pause", "failed") and (call.task is None or call.task.done()):
            call.task = asyncio.create_task(self._turn(call, session))

    async def _turn(self, call, session):
        if not self._matches(call) or call.muted or call.recording != session:
            return
        generation = call.generation
        call.state = "thinking"
        stopping = True
        try:
            result = await self.router.call("dictation.stop", {"session_id": session})
            stopping = False
            if not self._matches(call) or call.muted or call.recording != session:
                return
            call.recording = None
            text = result.get("text", "").strip()
            if text:
                request = f"call-turn-{call.id}-{uuid.uuid4().hex}"
                call.request = request
                # AgentService writes the ordinary owner turn before awaiting the model.
                call.answer = asyncio.create_task(self._answer(call, request, text, generation))
                await asyncio.sleep(0)
                self._link(call, request)
            await self._record(call)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            if stopping and call.recording != session:
                return  # Mute/settings replaced this recognizer while its tail was pending.
            await self._fail(call, exc)

    def _link(self, call, session):
        row = self.conn.execute("SELECT id FROM agent_turns WHERE session_id=? AND member_id=? AND conversation_id=?",
                                (session, call.member_id, call.conversation_id)).fetchone()
        if row:
            with self.conn:
                self.conn.execute("INSERT OR IGNORE INTO voice_call_turns(call_id,turn_id) VALUES(?,?)", (call.id, row["id"]))

    def turn_changed(self):
        if self.current:
            self.current.updated.set()

    async def _answer(self, call, request, text, generation):
        try:
            await self.router.call("agent.ask", {"session_id": request, "text": text,
                "ui_language": call.ui_language, "source": CALL_SOURCE, "member_id": call.member_id,
                "conversation_id": call.conversation_id})
            self._link(call, request)
            if not self._matches(call) or generation != call.generation:
                return
            turn = self.conn.execute("SELECT id,text,status FROM agent_turns WHERE session_id=?", (request,)).fetchone()
            # Owner approvals can finish through agent.confirm after agent.ask has returned.
            while turn and turn["status"] in ("running", "confirm", "queued"):
                call.updated.clear()
                await call.updated.wait()
                if not self._matches(call) or generation != call.generation:
                    return
                turn = self.conn.execute("SELECT id,text,status FROM agent_turns WHERE session_id=?", (request,)).fetchone()
            if not turn or turn["status"] == "error":
                await self._end(call, "network")
                return
            if turn["text"] and turn["status"] == "done":
                call.state = "speaking"
                failure = await self.speaker.say_call(turn["text"], voice=call.voice, speed=call.speed, turn_id=turn["id"])
                if failure and self._matches(call) and generation == call.generation:
                    await self._end(call, "voice" if failure in ("not_configured", "missing_secret") else "network")
            if self._matches(call) and generation == call.generation:
                call.state = "muted" if call.muted else "listening"
        except asyncio.CancelledError:
            self._link(call, request)
            if self._matches(call) and generation == call.generation:
                call.state = "muted" if call.muted else "listening"
            raise
        except Exception as exc:
            self._link(call, request)
            await self._fail(call, exc)

    async def status(self, params):
        if self.current and not self.conn.execute("SELECT 1 FROM voice_calls WHERE id=?", (self.current.id,)).fetchone():
            await self._end(self.current, "interrupted")
        return {"call": self._wire(self.current) if self.current else None,
                "ended": self._wire(self.last_ended) if self.last_ended else None}

    async def mute(self, params):
        call = self._call(params)
        if type(params.get("muted")) is not bool:
            raise invalid_params("muted must be boolean")
        call.muted = params["muted"]
        if call.muted:
            recording, call.recording = call.recording, None
            if recording:
                await self.router.call("dictation.cancel", {"session_id": recording})
            call.state = "muted"
        else:
            if call.state == "muted":
                call.state = "thinking" if call.answer and not call.answer.done() else "listening"
            await self._connect(call)
        return {"call": self._wire(call)}

    async def settings(self, params):
        call = self._call(params)
        speed, language, voice = params.get("speed", call.speed), params.get("language", call.language), params.get("voice", call.voice)
        if type(speed) not in (int, float) or speed not in (0.75, 1, 1.25, 1.5):
            raise invalid_params("speed is unsupported")
        if language not in ("auto", "zh", "en", "ja"):
            raise invalid_params("language is unsupported")
        member = self.team.member(call.member_id)
        if voice not in ("", member.voice if member else ""):
            raise invalid_params("voice must be the member or default voice")
        changed = language != call.language
        call.speed, call.language, call.voice = speed, language, voice
        if changed and call.recording:
            recording, call.recording = call.recording, None
            await self.router.call("dictation.cancel", {"session_id": recording})
            await self._connect(call)
        return {"call": self._wire(call)}

    async def end(self, params):
        async with self.lock:
            call = self.current
            if not call or call.id != params.get("call_id"):
                row = self.conn.execute("SELECT summary_id FROM voice_calls WHERE id=?", (params.get("call_id"),)).fetchone()
                return {"summary_id": row[0] if row else None}
            await self._end(call)
            return {"summary_id": call.summary_id}

    async def _fail(self, call, exc):
        kind = "network"
        if isinstance(exc, RpcError):
            kind = {NO_MICROPHONE: "microphone", NO_LOCAL_MODEL: "model", NOT_CONFIGURED: "model", BUSY: "busy"}.get(exc.code, "network")
        await self._end(call, kind)

    async def _end(self, call, failure=None):
        if not self._matches(call):
            return
        call.state, call.failure = "ended", failure
        call.generation += 1
        self.speaker.stop()
        if call.request:
            self.agent.stop_session(call.request)
            self._link(call, call.request)
        tasks = [task for task in (call.opening, call.task, call.answer) if task and task is not asyncio.current_task() and not task.done()]
        for task in tasks:
            task.cancel()
        recording, call.recording = call.recording, None
        try:
            if recording:
                await self.router.call("dictation.cancel", {"session_id": recording})
            await asyncio.gather(*tasks, return_exceptions=True)
        finally:
            self._save_end(call, failure)
            self.last_ended = call
            if self.current is call:
                self.current = None
            self.router.notify("agent.turn", {"turn_id": call.summary_id, "member_id": call.member_id})

    def _save_end(self, call, failure):
        row = self.conn.execute("SELECT summary_id FROM voice_calls WHERE id=?", (call.id,)).fetchone()
        if row is None:
            return  # The owner deleted this conversation during the call.
        if row and row[0]:
            call.summary_id = row[0]
            return
        # One metadata receipt, kept in ordinary history for paging/search/deletion scope.
        session = f"call-summary-{call.id}"
        existing = self.conn.execute("SELECT id FROM agent_turns WHERE session_id=? AND member_id=? AND conversation_id=?",
                                     (session, call.member_id, call.conversation_id)).fetchone()
        call.summary_id = existing[0] if existing else self.history.add(session_id=session, question="", route="voice_call",
            prefix="", text="", status="done", source=CALL_SOURCE, member_id=call.member_id, conversation_id=call.conversation_id)
        with self.conn:
            self.conn.execute("UPDATE voice_calls SET ended_at_ms=?,failure=?,summary_id=? WHERE id=?",
                              (self.now_ms(), failure, call.summary_id, call.id))

    async def feedback(self, params):
        if params.get("rating") not in ("good", "bad"):
            raise invalid_params("rating must be good or bad")
        with self.conn:
            self.conn.execute("UPDATE voice_calls SET rating=? WHERE id=? AND ended_at_ms IS NOT NULL", (params["rating"], params.get("call_id")))
        return {"ok": True}

    async def aclose(self):
        if self.current:
            await self._end(self.current, "interrupted")


def call_transcript(conn, call_id):
    rows = conn.execute("SELECT t.id,t.question,t.text,t.status FROM agent_turns t JOIN voice_call_turns v ON v.turn_id=t.id WHERE v.call_id=? ORDER BY t.id", (call_id,)).fetchall()
    from .agent.history import AgentHistory
    from .messaging.words import plain_replies
    messages = AgentHistory(conn).messages(row["id"] for row in rows)
    return [{**dict(row), "text": "\n\n".join(plain_replies([message["text"] for message in messages.get(row["id"], [])
             if message["kind"] == "reply"])) or row["text"]} for row in rows]


def call_views(conn, ids):
    if not ids:
        return {}, {}
    marks = ",".join("?" for _ in ids)
    linked = {row["turn_id"]: {"id": row["call_id"], "summary_id": row["summary_id"]} for row in conn.execute(
        f"SELECT v.turn_id,v.call_id,c.summary_id FROM voice_call_turns v JOIN voice_calls c ON c.id=v.call_id WHERE v.turn_id IN ({marks})", ids)}
    summaries = {}
    for row in conn.execute(f"SELECT * FROM voice_calls WHERE summary_id IN ({marks})", ids):
        summaries[row["summary_id"]] = {**dict(row), "transcript": call_transcript(conn, row["id"])}
    return linked, summaries

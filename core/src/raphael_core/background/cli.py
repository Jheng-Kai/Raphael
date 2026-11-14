"""Adapt the existing CLI member loop to the background worker's tool/approval contract."""
import json
import re
from types import SimpleNamespace

from ..agent.cli import loop as cli_loop
from ..agent.cli.loop import CliLoop
from ..clock import wall_clock_ms
from ..protocol import RpcError
from ..worker.loop import WRAP_UP, Stop, ToolOutcome
from ..computer.local_tools import is_local, BACKGROUND_WAIT_S
from .snapshot import USE_TOOL

# How many calls a task that reached a ceiling may make after being asked to report, before it is ended.
CEILING_PATIENCE = 3


def room_conversation(room_id, thread_id):
    """The conversation id of a member's native session in a room thread (a folder name too: Codex and Gemini keep their
    home beside the workspace)."""
    return f"room-{room_id}-{thread_id}"


_ROOM_THREAD = re.compile(r"room-(\d+)-(\d+)")


class RoomCliSessions:
    """The native CLI sessions of room replies and tasks.

    A conversation id of the form `room-<room>-<thread>` (`room_conversation`) is a member's one session in that room
    thread: with a database it is kept in `room_cli_sessions`, so that a CLI member resumes it reply after reply, sent only
    what is new, and after a restart. It goes with its room, its thread and its member (the table's triggers), and with
    the clear-all paths (`Sessions.clear`). Any other id (a task's own `room-task-<id>`, a memory pass) is kept in memory
    for the loop that uses it: it resumes nothing else. `locks` are shared by every loop that uses this object, so two
    replies of one member in one thread take turns."""
    def __init__(self, conn=None, now_ms=wall_clock_ms):
        self.locks = {}
        self.conversations = SimpleNamespace(resolve=lambda member, conversation: conversation)
        self._sessions = {}
        self._contexts = {}
        self._conn, self._now = conn, now_ms

    def _room(self, conversation_id):
        found = _ROOM_THREAD.fullmatch(conversation_id) if self._conn is not None and isinstance(conversation_id, str) else None
        return (int(found[1]), int(found[2])) if found else None

    def get(self, member, brain, conversation_id=None):
        if room := self._room(conversation_id):
            row = self._conn.execute("SELECT session_id FROM room_cli_sessions WHERE room_id=? AND thread_id=? AND member_id=? AND brain=?",
                                     (*room, member, brain)).fetchone()
            return row[0] if row else None
        return self._sessions.get((member, brain, conversation_id))

    def put(self, member, brain, session, conversation_id=None):
        if room := self._room(conversation_id):
            if not isinstance(session, str) or not 0 < len(session) <= 512:
                return
            # A deleted room or thread is not revived by a late notification; a new session id starts without a cursor.
            with self._conn:
                self._conn.execute(
                    "INSERT INTO room_cli_sessions(room_id,thread_id,member_id,brain,session_id,state,updated_at_ms) "
                    "SELECT ?,?,?,?,?,NULL,? WHERE EXISTS(SELECT 1 FROM room_threads t JOIN rooms r ON r.id=t.room_id WHERE t.id=? AND t.room_id=?) "
                    "ON CONFLICT(room_id,thread_id,member_id,brain) DO UPDATE SET "
                    "state=CASE WHEN session_id=excluded.session_id THEN state ELSE NULL END, "
                    "session_id=excluded.session_id, updated_at_ms=excluded.updated_at_ms",
                    (*room, member, brain, session, self._now(), room[1], room[0]))
            return
        self._sessions[(member, brain, conversation_id)] = session

    def forget(self, member, brain, conversation_id=None):
        if room := self._room(conversation_id):
            with self._conn:
                self._conn.execute("DELETE FROM room_cli_sessions WHERE room_id=? AND thread_id=? AND member_id=? AND brain=?",
                                   (*room, member, brain))
            return
        self._sessions.pop((member, brain, conversation_id), None)
        self._contexts.pop((member, brain, conversation_id), None)

    def get_context(self, member, brain, session, conversation_id=None):
        if room := self._room(conversation_id):
            row = self._conn.execute("SELECT state FROM room_cli_sessions WHERE room_id=? AND thread_id=? AND member_id=? AND brain=? "
                                     "AND session_id=?", (*room, member, brain, session)).fetchone()
            return json.loads(row[0]) if row and row[0] else None
        saved_session, state = self._contexts.get((member, brain, conversation_id), (None, None))
        return state if saved_session == session else None

    def put_context(self, member, brain, session, state, conversation_id=None):
        if self.get(member, brain, conversation_id) != session:
            return
        if room := self._room(conversation_id):
            with self._conn:
                self._conn.execute("UPDATE room_cli_sessions SET state=?,updated_at_ms=? WHERE room_id=? AND thread_id=? AND member_id=? "
                                   "AND brain=? AND session_id=?", (json.dumps(state), self._now(), *room, member, brain, session))
            return
        self._contexts[(member, brain, conversation_id)] = (session, state)


def member_loop(brains, quota, task, run, spec, *, wait_s, progress, sessions=None):
    refused = [0]
    # A CLI member's reply in a room thread goes on in its own session there (`RoomCliSessions`), sent what is new
    # (agent/cli/context.py `resumed_user`); `spec["room"]` is what the room gave it for that (members/rooms.py).
    room = spec.get("room") if task.scope == "room" and sessions is not None else None

    async def execute(call_id, name, arguments):
        if name == "cli_permission":
            # Native shell/file permission is not an alternative to Raphael's tool gate, unless the owner gave them all.
            if task.scope == "room":
                return ToolOutcome(False,"room_speech_only",instruction="Start this as private work with handoff.")
            from ..agent.data_floor import WRITE_REFUSAL
            access = run._gate.data_floor.access(name, arguments)
            if access == "write":
                return ToolOutcome(False, "protected_data", instruction=WRITE_REFUSAL)
            if access == "read":
                from .snapshot import BUILTIN, ToolRef
                from ..agent.policy import Tier
                run.snapshot.refs[name] = ToolRef(BUILTIN, name, "Raphael", name, Tier.T3)
            else:
                return ToolOutcome(True, None) if getattr(run._gate, "full_permission", False) else ToolOutcome(False, "use_mcp_tools")
        try:
            result = await run.tool({"call_id":call_id, "name":name, "arguments":arguments})
        except RpcError as error:
            data = error.data if isinstance(error.data, dict) else {}
            stop = data.get("stop")
            if isinstance(stop, str) and stop.startswith("limit_") and refused[0] < CEILING_PATIENCE:
                # A ceiling: the CLI makes its own model calls, so it is told to report in place of the call it
                # asked for, and its final answer is the task's result (`TaskRun.ceiling`).
                refused[0] += 1
                run.ceiling = stop
                return ToolOutcome(False, "limit", instruction=WRAP_UP)
            if stop:
                called = arguments.get("name") if name == USE_TOOL and isinstance(arguments, dict) else name
                ref = run.snapshot.refs.get(called) if isinstance(called, str) else None
                if ref is not None and is_local(ref.key):
                    loop.approval_wait_s = BACKGROUND_WAIT_S + 60  # the question's own end (BackgroundService._expire) comes first
                raise Stop(stop, data.get("detail")) from None
            raise
        outcome = tool_outcome(result)
        if outcome.replace_tools:
            # The member's computer changed (the driver's own catalog): the one change of the list a
            # task takes, and the CLI starts again in its own session to read it. What find_tools finds is
            # called with use_tool and changes nothing.
            listed()
            outcome.tools = list(loop.tools)
            loop.reload_note, loop.catalog_changed = cli_loop.COMPUTER_CHANGED, True
        return outcome

    loop = CliLoop(brains=brains, sessions=sessions if room else RoomCliSessions(), member_id=task.member_id,
        conversation_id=room_conversation(room["room_id"], room["thread_id"]) if room else f"room-task-{task.id}",
        model=run.model, ledger=run.ledger,
        **({"resume_user": room["user"], "context_sections": room["sections"], "context_turns": room["turns"],
            "context_summary": room["summary"], "context_summary_through": room["summary_through"],
            "turn_id": room["through"]} if room else {}),
        language=task.language, plain=True, system=spec["system"], user=spec["user"],
        owner_text=task.text, tool_conversation=spec.get("tool_conversation", ()), steps=spec.get("steps", ()),
        tools=spec["tools"], skills=spec.get("skills", ()), attachments=run.attachments, progress=progress,
        thinking=lambda text: None, event=progress, reply=getattr(run, "_reply", None), execute=execute, quota=quota, wait_timeout_s=wait_s,
        rate_limit_waits=cli_loop.ROOM_RATE_LIMIT_WAITS_S, alive=run.touch, acted=lambda: run.acted,
        # The task's own clock of the last word to the owner: its updates are messages through `run._reply`, as an API
        # task's are (agent/progress_updates.py); a meeting's reply and a routine have none.
        updates=getattr(run, "updates", None))
    def listed():
        extra = [item for item in loop.tools if item["function"]["name"] in ("cli_permission", "approve")]
        loop.tools[:] = [*run.snapshot.definitions, *extra]
        return loop.tools

    def refresh_tools():
        run.snapshot.refresh_plugins(run._gate.plugins, task.member_id)
        return listed()
    if task.scope == 'room':
        loop.speech_only = True
    loop.refresh_tools = refresh_tools
    return loop


def tool_outcome(result):
    if isinstance(result, str):
        return ToolOutcome('status="ok"' in result, content=result)
    return ToolOutcome(bool(result.get("ok")), result.get("kind"), result.get("content", ""),
                       instruction=result.get("instruction") or "", blocks=result.get("blocks") or [],
                       tools=result.get("tools") or [], replace_tools=result.get("replace_tools") is True)

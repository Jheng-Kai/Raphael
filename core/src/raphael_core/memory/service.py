"""The memory of Raphael and of the members of the owner's team as one service: the living files
(`store`), each conversation's summary (`conversation`), the reflection pass and the consolidation
(`reflection`), the tools the assistants reach them by, and the RPC methods of the settings page and
of a member's 記憶 tab.

Every assistant, Raphael (0) too, has its own `bots/<id>/MEMORY.md` and `bots/<id>/SOUL.md`; the owner's
profile is one file every assistant reads and writes, `shared/USER.md`. In the pane they are 「<name> 的記憶」
and 「共同記憶」. A turn reads both at its start in a form that does not change while it runs
(`snapshot`); the tools read and write the live file. A member never reads another's MEMORY.md; `ask_member`
returns what the asked member chooses to answer. A room's turn, and work a colleague handed over, read
USER.md alone.

A model chooses the file (`target`), and the host checks that choice for USER.md. An entry goes there from a
private turn only when it is about who the owner is, not about a conversation, a plan or a task
(`reflection.about_the_owner`), and the owner did not ask to keep it from the others (`keeps_private`); any
other goes to the member's own file, and the model is told so. An owner's request to tell everyone
(`explicitly_shared`) and a room's turn write there whatever it is about. Every entry that reaches USER.md
through a member ends with whom the owner told it to and when, stamped here.

The RPC methods (the main window only; the shell checks their params before they come here). Each takes
`space` ("own", the default, or "shared") and `member_id` (whose own: 0, Raphael, by default):

- `memory.get {space?, member_id?}` -> the document: `{text, revision, chars, entries, limit, summary:
  {text, updated_at_ms} | null}` (the summary is the member's conversation's; none for the shared space)
- `memory.update {text, revision, space?, member_id?}` -> the document as it is now. The owner's edit of the
  whole file: `revision` is the copy it was made from, and an edit from an old copy is refused ("changed"),
  since a member may have written meanwhile. What the edit adds passes the scan.
- `memory.clear {space?, member_id?}` -> `{cleared}`: the file is emptied (its journal keeps what it held)
- `memory.summary_clear {member_id?}` -> `{cleared}`: the conversation's summary is forgotten

The tools of the assistant are in `growth`; `history_search` only reads (T0). Outside claims go in
marked (`store.UNCONFIRMED`), while verified restatements of the current owner's request stay trusted.

The reflection pass runs in the background on each member's selected brain (including CLI), for each
assistant over its own turns (a watermark each): after REFLECT_AFTER_TURNS answered turns it has not
read, or once the conversation has been quiet for QUIET_S with any such turn, and once soon after
the app starts when one is waiting. The consolidation runs with it for a file past `reflection.FULL_FROM` of
its limit, once a day. A timer that finds nothing due yet, and every pass when it ends, arms the timer
again for the next time something will be (the quiet time, an increasing pause after a failure, the
day), so nothing waits for the owner's next turn. Both need the key and room under the month's limit,
and both are written to the spend with the purpose "memory".

Nothing here logs a memory, a question or an answer.
"""

import asyncio
import logging
import re
import shutil
import sqlite3
import time
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass
from datetime import date, datetime, tzinfo
from pathlib import Path

from ..agent.history import AgentHistory, Turn
from ..agent.attribution import labelled_lines, turn_speakers
from ..agent.ledger import Ledger
from ..agent.speaker import RAPHAEL_NAMES
from ..agent.tools import ToolResult
from ..brain.providers.base import ModelProvider
from ..brain.providers.registry import ProviderRouter, for_purpose
from ..brain.secrets import KeyStore
from ..brain.settings import SettingsStore, api_model
from ..brain.spend import SpendTracker
from ..clock import wall_clock_ms
from ..protocol import invalid_params
from ..router import Router as RpcRouter
from . import legacy
from .conversation import SUMMARY_PURPOSE, Conversation
from .reflection import FULL_FROM, MAX_TURNS, Applied, Edit, Reflector, about_the_owner
from .store import UNCONFIRMED, MemoryFile, MemorySnapshot, is_unconfirmed, owner_stated, relation, told_stamp
from .growth import Growth

logger = logging.getLogger(__name__)

PURPOSE = SUMMARY_PURPOSE  # "memory", in the spend
QUIET_S = 25 * 60.0
REFLECT_AFTER_TURNS = 6
CONSOLIDATE_EVERY_MS = 86_400_000
# How long after the app starts the memory looks for turns it has not read.
START_DELAY_S = 60.0
# A pass that failed is not tried again for this long.
RETRY_S = 15 * 60.0
_REFLECTED = "reflected_through"
_CONSOLIDATED = "consolidated_at_ms"
# What a search gives of a turn, in characters, at most.
SNIPPET_CHARS = 150
SPACES = ("shared", "own")
# The longest document the owner's edit may be (the shell's limit too).
MAX_DOCUMENT_CHARS = 64_000


def explicitly_shared(text: str) -> bool:
    """Sharing is an owner's explicit instruction, never a model-selected space."""
    if re.search(r"不要|別|不能|不准|不可以|禁止|\b(?:don't|do not|never)\b|共有しない|伝えない", text, re.I):
        return False
    return bool(re.search(r"告訴大家|告诉大家|分享給(?:大家|所有)|分享给(?:大家|所有)|全團隊都要知道|全团队都要知道|共同記憶|共同记忆|\b(?:tell|share (?:this |it )?with) (?:everyone|all members|the team)\b|全員に(?:共有|伝え)", text, re.I))


def keeps_private(text: str) -> bool:
    """Whether the owner's words ask to keep something from the others."""
    return bool(re.search(
        r"(?:不要|別|不能|不准|不可以|禁止|先不要)[^。！？\n]{0,10}(?:告訴|跟|讓|分享|說給|傳給|透露)[^。！？\n]{0,10}(?:其他|大家|別人|他們|所有人|全部)|"
        r"(?:只|僅)(?:跟|告訴|讓)你|私下|保密|"
        r"\b(?:don't|do not|never)\b[^.!?\n]{0,24}\b(?:tell|share|mention)\b|\b(?:between us|keep (?:this|it) (?:private|secret|to yourself))\b|"
        r"共有しない|伝えない|内緒|秘密にして", text or "", re.I))


def _snippet(text: str, words: Sequence[str], *, preserve_label: bool = False) -> str:
    """`text` cut to SNIPPET_CHARS around the first of `words` it holds."""
    text = "\n".join(" ".join(line.split()) for line in (text or "").splitlines())
    if len(text) <= SNIPPET_CHARS:
        return text
    folded = text.casefold()
    at = min((folded.find(w) for w in words if w and folded.find(w) >= 0), default=0)
    start = max(0, at - SNIPPET_CHARS // 3)
    prefix = ""
    if preserve_label and start:
        line_start = text.rfind("\n", 0, start) + 1
        line_end = text.find("\n", line_start)
        if line_end < 0:
            line_end = len(text)
        colon = text.find(": ", line_start)
        # Exchanges already carry explicit line labels. Keep the label of the first
        # excerpted line even when the matching words are deep inside its content.
        if line_start <= colon < min(line_start + 80, line_end):
            if start <= colon + 2:
                start = line_start
            else:
                prefix = text[line_start:colon + 2]
    cut = text[start : start + SNIPPET_CHARS]
    return prefix + ("…" if start else "") + cut + ("…" if start + SNIPPET_CHARS < len(text) else "")


def _speaker_snippet(speaker: str, text: str, words: Sequence[str], *, exchange: bool = False) -> str:
    """Truncate content before adding labels so the snippet cannot cut its speaker away."""
    return labelled_lines(speaker, _snippet(text, words, preserve_label=exchange))


def _watermark(member_id: int) -> str:
    """The name of the state that says up to which turn the reflection pass of `member_id` read."""
    return _REFLECTED if member_id == 0 else f"{_REFLECTED}:{int(member_id)}"


class MemoryService(Growth):
    """The memory. `conn` is the open database (used on the event loop only), `root` the memory
    folder, `client` the OpenRouter client, `keys` where the key lives. `now_ms` is the wall clock,
    `tz` the time zone of the spend's months, `clock` a monotonic clock in seconds and `now` the
    local time. `quiet_s` and `start_delay_s` are for the tests."""

    def __init__(
        self,
        conn: sqlite3.Connection,
        root: Path,
        client: ModelProvider,
        keys: KeyStore,
        *,
        now_ms: Callable[[], int] = wall_clock_ms,
        tz: tzinfo | None = None,
        clock: Callable[[], float] = time.monotonic,
        now: Callable[[], datetime] | None = None,
        quiet_s: float = QUIET_S,
        start_delay_s: float = START_DELAY_S,
        notify: Callable[[str, dict], None] | None = None,
    ) -> None:
        self.skill_review = None
        self._notify = notify
        self._conn = conn
        self._keys = keys
        self._now_ms = now_ms
        self._clock = clock
        self._quiet_s = quiet_s
        self._start_delay_s = start_delay_s
        self._client = for_purpose(client, "memory")
        self._base_client = client
        self._cli_brains = None
        self._now = now
        # The language of the owner's screen, for what the host writes into a file: the app sets it.
        self.language: Callable[[], str] = lambda: "zh-TW"
        from ..bots.homes import BotHomes
        self.homes = BotHomes(root.parent)
        self.homes.migrate(root)
        legacy.migrate(self.homes, told_name=self._told_name)
        self.shared = MemoryFile(self.homes, None, on_change=lambda: self._changed(0, "shared"))
        self._files: dict[int, MemoryFile] = {}
        self._history = AgentHistory(conn, now_ms)
        self._settings = SettingsStore(conn)
        self._spend = SpendTracker(conn, now_ms, tz)
        self.conversation = Conversation(
            conn, client, now_ms=now_ms, clock=clock, reflected_through=self.reflected_through,
            on_change=lambda: self._changed(0),
        )
        # The members' conversations, made when first needed.
        self._conversations: dict[int, Conversation] = {}
        # Whether a member is there: the app sets it to the members' own answer, so that the RPC
        # methods make no folder for an id that is nobody's. Until then any id goes.
        self.member_exists: Callable[[int], bool] = lambda member_id: True
        self._timer: asyncio.TimerHandle | None = None
        self._running: asyncio.Task[None] | None = None
        self._failed_at: float | None = None
        self._failure_count = self._state("background_failures")
        # How many times the conversation was cleared: a pass that began at another count is stale.
        self._turn_clears = 0

    def _changed(self, member_id: int, space: str = "own") -> None:
        """Only the affected space and owner leave the core, never a note's contents."""
        if self._notify is not None:
            self._notify("memory.changed", {"member_id": member_id, "space": space})

    def register(self, router: RpcRouter) -> None:
        methods = {
            "memory.get": self._get,
            "memory.update": self._update,
            "memory.import": self._import,
            "memory.clear": self._clear,
            "memory.summary_clear": self._summary_clear,
        }
        for method, handler in methods.items():
            router.register(method, handler)

    # --- the state ---------------------------------------------------------------------------------

    def _state(self, key: str) -> int:
        try:
            row = self._conn.execute("SELECT value FROM memory_state WHERE key = ?", (key,)).fetchone()
        except sqlite3.Error:
            return 0
        return 0 if row is None else int(row[0])

    def _set_state(self, key: str, value: int) -> None:
        with self._conn:
            self._conn.execute(
                "INSERT INTO memory_state (key, value) VALUES (?, ?)"
                " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value),
            )

    def reflected_through(self, member_id: int = 0) -> int:
        """The last turn of the thread of `member_id` its reflection pass has read (0: none)."""
        return self._state(_watermark(member_id))

    # --- the spaces --------------------------------------------------------------------------------

    def own(self, member_id: int) -> MemoryFile:
        """The MEMORY.md of `member_id`."""
        memory = self._files.get(member_id)
        if memory is None:
            memory = MemoryFile(self.homes, member_id, on_change=lambda: self._changed(member_id))
            self._files[member_id] = memory
        return memory

    def space(self, space: str, member_id: int = 0) -> MemoryFile:
        """The file `space` names: the shared one, or the own of `member_id`."""
        return self.shared if space == "shared" else self.own(member_id)

    def conversation_for(self, member_id: int) -> Conversation:
        """The conversation of `member_id`: Raphael's for 0."""
        if member_id == 0:
            return self.conversation
        conversation = self._conversations.get(member_id)
        if conversation is None:
            conversation = Conversation(
                self._conn,
                self._client,
                now_ms=self._now_ms,
                clock=self._clock,
                reflected_through=lambda: self.reflected_through(member_id),
                member_id=member_id,
                on_change=lambda: self._changed(member_id),
            )
            self._conversations[member_id] = conversation
        return conversation

    def member_conversations(self) -> list[int]:
        """The members whose conversation has been read since the core started."""
        return list(self._conversations)

    def reader_for(self, member_id: int) -> "MemberMemory":
        """What a background task of `member_id` may do with the memory: read and search."""
        return MemberMemory(self, member_id)

    def _members(self) -> list[int]:
        """The ids of the members of the team (Raphael not among them)."""
        try:
            return [int(row[0]) for row in self._conn.execute("SELECT id FROM members ORDER BY id")]
        except sqlite3.Error:
            return []

    def _agents(self) -> list[int]:
        return [0, *self._members()]

    def _name_of(self, member_id: int) -> str:
        """What the reflection pass calls the assistant: Raphael, or the member by its name."""
        if member_id == 0:
            return "Raphael"
        try:
            row = self._conn.execute("SELECT name FROM members WHERE id = ?", (member_id,)).fetchone()
        except sqlite3.Error:
            row = None
        return "the assistant" if row is None else str(row[0])

    def _told_name(self, member_id: int) -> str:
        """Whom a shared entry was told to, as the owner knows them."""
        return RAPHAEL_NAMES.get(self.language(), RAPHAEL_NAMES["zh-TW"]) if member_id == 0 else self._name_of(member_id)

    def _today(self) -> date:
        return (self._now() if self._now is not None else datetime.now().astimezone()).date()

    def _mark(self) -> str:
        return UNCONFIRMED.get(self.language(), UNCONFIRMED["zh-TW"])

    async def forget_member(self, member_id: int) -> None:
        """A member was deleted: its own memory folder goes, with its conversation's summary and
        its reflection's watermark. What it wrote to the shared memory stays: it is the owner's."""
        if member_id == 0:
            return
        conversation = self._conversations.pop(member_id, None)
        if conversation is not None:
            await conversation.aclose()
        self._files.pop(member_id, None)
        try:
            with self._conn:
                self._conn.execute(
                    "DELETE FROM conversation_summaries WHERE member_id = ?", (member_id,)
                )
                self._conn.execute(
                    "DELETE FROM memory_state WHERE key = ?", (_watermark(member_id),)
                )
        except sqlite3.Error as exc:
            logger.warning("Could not delete a member's summary: %s", type(exc).__name__)
        for folder in (self.homes.home(member_id), self.homes.state(member_id)):
            try:
                self.homes.safe(folder)
                await asyncio.to_thread(shutil.rmtree, folder, ignore_errors=False)
            except FileNotFoundError:
                pass
            except (OSError, ValueError) as exc:
                logger.warning("Could not delete a member's memory: %s", type(exc).__name__)
        self._changed(member_id)

    # --- for the assistant -------------------------------------------------------------------------

    def snapshot(self, member_id: int | None = 0) -> MemorySnapshot:
        """The memory as a turn of `member_id` reads it, at the turn's start: USER.md and its own file;
        USER.md alone without a member (`SharedMemory`). It is text, so nothing the turn writes changes it,
        and the next turn reads what the files say then. A new turn may try a failed edit again."""
        self.shared.reset_failures()
        if member_id is None:
            return MemorySnapshot(shared=self.shared.prompt_text(), own=None, shared_usage=self.shared.usage())
        own = self.own(member_id)
        own.reset_failures()
        return MemorySnapshot(shared=self.shared.prompt_text(), own=own.prompt_text(),
                              shared_usage=self.shared.usage(), own_usage=own.usage())

    def shared_reader(self) -> "SharedMemory":
        """What a room's turn or work a colleague handed over may do with the memory."""
        return SharedMemory(self)

    def edit_memory(self, member_id: int, target: str, operations: Sequence, *, untrusted: bool = False, share: bool = False,
                    private_request: bool = False, unattended: bool = False, owner_text: str = "") -> dict:
        """Apply a model's edits to the file `target` names, with the checks of the module for USER.md.
        The result is what the model is told."""
        mark = self._mark() if untrusted else ""
        own = self.own(member_id)
        added = lambda op: isinstance(op, dict) and op.get("action") == "add"  # noqa: E731
        content = lambda op: str(op.get("content") or "")  # noqa: E731
        # What came from outside stays with the member that read it, unless the owner asked to tell everyone.
        if target != "user" or (untrusted and not share):
            # One fact keeps one line across the two files too.
            said = self.shared.entries()
            fresh = [op for op in operations if not (added(op) and any(relation(content(op), entry) in ("same", "inside") for entry in said))]
            if operations and not fresh:
                return {"success": True, "done": True, "target": "user", "changed": False, "usage": self.shared.usage(), "entry_count": len(said),
                        "message": "USER.md already says this, so nothing was added.", "note": "This update is complete: do not repeat it."}
            return own.apply(fresh, mark=mark, unattended=unattended, owner_text=owner_text)
        told = told_stamp(self._told_name(member_id), self._today().isoformat())
        kept = [] if share else [op for op in operations if added(op) and (private_request or not about_the_owner(content(op)))]
        rest = [op for op in operations if not any(op is item for item in kept)]
        if kept:
            result = own.apply(kept, mark=mark, unattended=unattended, owner_text=owner_text)
            if result["success"]:
                result["message"] = ("Kept in your own MEMORY.md, not USER.md: it is about this conversation or a plan, or "
                                     "the owner wants it kept from the others.")
            if not rest or not result["success"]:
                return result
        pending = [entry for entry in own.entries() if is_unconfirmed(entry)]
        rest = [{**op, "content": self._mark() + content(op)} if added(op) and not owner_stated(content(op), owner_text)
                and any(relation(content(op), entry) in ("same", "inside", "wider", "near") for entry in pending) else op for op in rest]
        result = self.shared.apply(rest, mark=mark, told=told, unattended=unattended, owner_text=owner_text)
        if result["success"]:
            own.drop_said([content(op) for op in rest if added(op)])
        return result

    def apply_edits(self, edits: Sequence[Edit], member_id: int = 0, *, untrusted: bool = False, share: bool = False,
                    private_request: bool = False, unattended: bool = False, owner_text: str = "") -> Applied:
        """What came of the edits of a reply or a pass, each file by itself."""
        applied = Applied()
        for target in ("memory", "user"):
            batch = [edit for edit in edits if edit.target == target]
            if not batch:
                continue
            result = self.edit_memory(member_id, target, [asdict(edit) for edit in batch], untrusted=untrusted, share=share,
                                      private_request=private_request, unattended=unattended, owner_text=owner_text)
            applied.record(result, batch, target)
        return applied

    def forget_member_turns(self, member_id: int) -> None:
        """Invalidate in-flight reflection while preserving every member's notes."""
        self._turn_clears += 1
        with self._conn:
            self._conn.execute("DELETE FROM memory_state WHERE key = ?", (_watermark(member_id),))

    def forget_turns(self) -> None:
        """The conversations were cleared: every reflection pass starts again from the first turn
        (the ids of the turns start again too). A pass that waits for the model meanwhile read
        turns that are gone: it applies nothing and leaves the watermark at 0."""
        self._turn_clears += 1
        with self._conn:
            self._conn.execute(
                "DELETE FROM memory_state WHERE key = ? OR key LIKE ?",
                (_REFLECTED, f"{_REFLECTED}:%"),
            )

    def search(
        self,
        query: str,
        *,
        limit: int = 5,
        exclude: Sequence[int] = (),
        member_id: int = 0,
        conversation_id: int | None = None,
    ) -> ToolResult:
        """`history_search`: the past turns of the thread of `member_id` (and of no other) that
        hold the words of `query`, best first, each as its date, the question and the answer, cut
        short. No model call. The turns of `exclude` (the ones in the context already) are left out
        by the search itself, before its limit. A result that holds a run on the owner's desktop
        (`operate`), an exchange with another member or a routine's run is untrusted: the answer
        there tells what the screen showed, or what a member or a service said, so the reply that
        reads it writes no note."""
        try:
            turns = self._history.search(query, limit=limit, exclude=exclude, member_id=member_id, conversation_id=conversation_id)
        except sqlite3.Error as exc:
            logger.warning("Could not search the conversation: %s", type(exc).__name__)
            return ToolResult("history_search", False, None, "error")
        words = [w.casefold() for w in query.split()]
        found = []
        screen = False
        from .growth import tainted_turn
        steps = self._history.steps([turn.id for turn in turns if turn.id is not None])
        for turn in turns:
            screen = screen or turn.route in ("operate", "exchange", "routine") or tainted_turn(turn, steps.get(turn.id, ()))
            when = datetime.fromtimestamp(turn.created_at_ms / 1000).strftime("%Y-%m-%d %H:%M")
            answer = turn.detail if turn.detail and len(turn.detail) > len(turn.text) else turn.text
            question_label, answer_label = turn_speakers(turn)
            found.append(
                {
                    "turn": turn.id,
                    "when": when,
                    "question": _speaker_snippet(question_label, turn.question, words, exchange=turn.route == "exchange"),
                    "answer": _speaker_snippet(answer_label, answer or turn.prefix, words, exchange=turn.route == "exchange"),
                }
            )
            if len(found) >= limit:
                break
        return ToolResult("history_search", True, {"turns": found}, untrusted=screen)

    # --- the background ----------------------------------------------------------------------------

    def _model(self, member_id: int = 0) -> str:
        row = self._conn.execute("SELECT model FROM members WHERE id=?", (member_id,)).fetchone() if member_id else None
        return (row[0] if row and row[0] else self._settings.get("agent_model"))

    def _brain(self, member_id):
        from .brain import MemoryBrain
        return MemoryBrain(self, member_id)

    def may_spend(self, member_id: int = 0) -> bool:
        """Whether a call of the memory's own may be made: there is a key."""
        try:
            from ..agent.cli.discovery import brain_ref
            reference = brain_ref(self._model(member_id))
            if reference:
                return self._cli_brains is not None and self._cli_brains.available(reference[0])
            if isinstance(self._client, ProviderRouter):
                return self._client.available(self._model(member_id))
            if not (self._keys.get() or "").strip():
                return False
            return True
        except Exception as exc:  # the key store's message could hold the key
            logger.warning("The memory could not check the key or the limit: %s", type(exc).__name__)
            return False

    def ledger(self) -> Ledger:
        return Ledger(self._spend, PURPOSE)

    def after_turn(self, member_id: int = 0) -> None:
        """A turn was written in the thread of `member_id`: fold its conversation if it is time,
        and run the reflection pass now if enough turns wait for one, or once the conversation has
        been quiet for a while."""
        if self.may_spend(member_id):
            conversation = self.conversation_for(member_id)
            conversation._client = self._brain(member_id)
            conversation.schedule_fold(self._model(member_id), self.ledger)
        skill_due = self.skill_review is not None and self.skill_review.due()
        if skill_due or self._waiting(limit=REFLECT_AFTER_TURNS, member_id=member_id) >= REFLECT_AFTER_TURNS:
            self._spawn()
        else:
            self._arm(self._quiet_s)

    def start(self) -> None:
        """The app is up: look for turns the reflection pass has not read, soon."""
        self._arm(self._start_delay_s)

    def _arm(self, delay_s: float) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        if self._timer is not None:
            self._timer.cancel()
        self._timer = loop.call_later(delay_s + 1.0, self._tick)

    def _tick(self) -> None:
        """The timer fired: run what is due, or arm the timer for when something will be. Without
        the second, a turn that waits at startup but is not quiet yet, or a pass that failed, would
        wait for the owner's next turn, however long that is."""
        self._timer = None
        if self.reflection_due() or self.consolidation_due():
            self._spawn()
        else:
            self._arm_next()

    def _arm_next(self) -> None:
        """Arm the timer for the next time something is due (`_next_due_s`), if anything ever is."""
        delay = self._next_due_s()
        if delay is not None:
            self._arm(delay)

    def _next_due_s(self) -> float | None:
        """In how many seconds a pass will next be due: the end of the pause after a failure, else
        the soonest of the reflection passes (now when REFLECT_AFTER_TURNS turns of one assistant
        wait, or when its conversation will have been quiet for QUIET_S) and the daily
        consolidation. None when nothing waits: the owner's next turn arms the timer again."""
        if self._failed_at is not None:
            left = self._retry_s() - (self._clock() - self._failed_at)
            if left > 0:
                return left
        delays: list[float] = []
        if self.skill_review is not None:
            if self.skill_review.due():
                delays.append(RETRY_S if self._failed_at is not None else 0.0)
            retry = getattr(self.skill_review, "retry_delay_s", lambda: None)()
            if retry is not None:
                delays.append(retry)
        for member_id in self._agents():
            try:
                unread = self._unread(member_id=member_id)
                if len(unread) >= REFLECT_AFTER_TURNS:
                    delays.append(0.0)
                elif unread:
                    last = self._last_turn_ms(unread, member_id)
                    quiet_ms = last + self._quiet_s * 1000 - self._now_ms()
                    delays.append(max(0.0, quiet_ms / 1000))
            except sqlite3.Error:
                pass
        if self._filling():
            daily_ms = self._state(_CONSOLIDATED) + CONSOLIDATE_EVERY_MS - self._now_ms()
            delays.append(max(0.0, daily_ms / 1000))
        return min(delays) if delays else None

    def _last_turn_ms(self, unread: Sequence[Turn], member_id: int = 0) -> int:
        """When the latest turn of the thread was made, whatever its status (its last sound)."""
        latest = self._history.after(0, limit=1, member_id=member_id)
        return latest[-1].created_at_ms if latest else unread[-1].created_at_ms

    def _waiting(self, limit: int = MAX_TURNS, member_id: int = 0) -> int:
        try:
            return len(self._unread(limit, member_id))
        except sqlite3.Error:
            return 0

    def _unread(self, limit: int = MAX_TURNS, member_id: int = 0) -> list[Turn]:
        """The answered turns of the thread of `member_id` its reflection pass has not read, the
        earliest `limit` of them, so a backlog never skips old facts. An exchange with another member and a routine's run are not the
        owner's own words: the pass never reads them."""
        turns = self._history.after(self.reflected_through(member_id), member_id=member_id)
        own = [t for t in turns if t.status == "done" and t.route not in ("exchange", "routine")]
        return own[:limit]

    def _due(self, member_id: int) -> bool:
        try:
            unread = self._unread(member_id=member_id)
        except sqlite3.Error:
            return False
        if len(unread) >= REFLECT_AFTER_TURNS:
            return True
        if not unread:
            return False
        return self._now_ms() - self._last_turn_ms(unread, member_id) >= self._quiet_s * 1000

    def reflection_due(self) -> bool:
        """Whether a reflection pass should run now: for an assistant, REFLECT_AFTER_TURNS turns
        wait, or one does and its last turn is QUIET_S old."""
        return any(self._due(member_id) for member_id in self._agents())

    def _spaces(self) -> list[tuple[MemoryFile, int]]:
        """Every file there is to consolidate, with the assistant whose brain does it."""
        return [(self.shared, 0), *((self.own(member_id), member_id) for member_id in self._agents())]

    def _filling(self) -> list[tuple[MemoryFile, int]]:
        return [(memory, member_id) for memory, member_id in self._spaces() if memory.fill() >= FULL_FROM]

    def consolidation_due(self) -> bool:
        if not self._filling():
            return False
        return self._now_ms() - self._state(_CONSOLIDATED) >= CONSOLIDATE_EVERY_MS

    def _spawn(self) -> None:
        """Run what is due in the background, unless a pass runs already (it arms the timer when
        it ends) or the pause after a failure is not over (the timer is armed for its end)."""
        if self._running is not None and not self._running.done():
            return
        if self._failed_at is not None and self._clock() - self._failed_at < self._retry_s():
            self._arm_next()
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        self._running = loop.create_task(self.run_due())

    async def run_due(self) -> None:
        """The reflection passes and the consolidation, whichever are due, one after the other;
        then the timer is armed for whatever is due next (the rest of a long backlog, the pause
        after a failure, the next quiet time or day). Without a key or room under the limit
        nothing runs, and the timer looks again no sooner than RETRY_S."""
        if self._failed_at is not None and self._clock() - self._failed_at < self._retry_s():
            self._arm_next()
            return
        if not any(self.may_spend(member_id) for member_id in self._agents()):
            delay = self._next_due_s()
            if delay is not None:
                self._arm(max(delay, RETRY_S))
            return
        try:
            for member_id in self._agents():
                if self._due(member_id) and self.may_spend(member_id):
                    applied = await self.reflect(member_id)
                    if applied.failed:
                        self._arm_next()
                        return
            if self.skill_review is not None:
                await self.skill_review.run_due()
            if self.consolidation_due():
                await self.consolidate()
        except Exception as exc:  # the background must not break the conversation
            self._record_failure()
            logger.warning("The memory's background pass failed: kind=internal reason=Unexpected %s", type(exc).__name__)
        self._arm_next()

    def _retry_s(self) -> float:
        return min(RETRY_S * 2 ** min(max(0, self._failure_count - 1), 5), 6 * 3600.0)

    def _record_failure(self) -> None:
        self._failure_count += 1
        self._set_state("background_failures", self._failure_count)
        self._failed_at = self._clock()
        logger.info("Memory retry deferred: failures=%d delay_s=%d", self._failure_count, self._retry_s())

    def health(self):
        """Content-free, persisted failure counts for the existing self-check tool."""
        failures = self._state("background_failures")
        reviews = sum(1 for row in self._conn.execute(
            "SELECT value FROM memory_state WHERE key LIKE 'skills:%:failures'") if int(row[0]) >= 3)
        return {"status": "attention" if failures >= 3 or reviews else "ok",
                "consecutive_failures": failures, "skill_reviews_repeatedly_failed": reviews,
                "retry_delay_s": self._retry_s() if failures else 0}

    def _recovered(self) -> None:
        self._failure_count = 0
        self._set_state("background_failures", 0)
        self._failed_at = None

    async def reflect(self, member_id: int = 0) -> Applied:
        """One reflection pass over the turns of `member_id` it has not read. The watermark moves past
        them when the model answered, whatever it made of them; a model that failed leaves them for the
        next pass, which waits RETRY_S. When the conversation or the files were cleared while the model
        thought, nothing is applied and the watermark stays where the clear put it."""
        turns = self._unread(member_id=member_id)
        if not turns:
            return Applied()
        clears = self._turn_clears
        own = self.own(member_id)
        file_clears = (own.clears, self.shared.clears)

        def current() -> bool:
            return self._turn_clears == clears and file_clears == (own.clears, self.shared.clears)

        from .growth import tainted_turn
        steps = self._history.steps([turn.id for turn in turns if turn.id is not None])
        outside = {turn.id for turn in turns if tainted_turn(turn, steps.get(turn.id, ()))}
        private_request = any(keeps_private(turn.question) for turn in turns)
        applied = await Reflector(self._brain(member_id)).reflect(
            own, self.shared, turns,
            outside=outside,
            today=self._today(),
            model=self._model(member_id),
            ledger=self.ledger(),
            current=current,
            agent=self._name_of(member_id),
            apply=lambda edits: self.apply_edits(edits, member_id, private_request=private_request, unattended=True),
        )
        if applied.failed:
            self._record_failure()
        elif self._turn_clears == clears:
            self._recovered()
            through = max(turns[-1].id or 0, self.reflected_through(member_id))
            self._set_state(_watermark(member_id), through)
        return applied

    async def consolidate(self) -> Applied:
        """The tidy of every file near or past its limit, each by itself; the next one is a day away
        once the model has answered for each."""
        total = Applied()
        for memory, member_id in self._filling():
            if not self.may_spend(member_id):
                continue

            def apply(edits, memory=memory):
                # Who was told an entry stays as it was: a tidy is nobody's telling.
                applied = Applied()
                applied.record(memory.apply([asdict(edit) for edit in edits], unattended=True), edits, memory.target)
                return applied

            clears = memory.clears
            total.merge(await Reflector(self._brain(member_id)).consolidate(
                memory, today=self._today(), model=self._model(member_id), ledger=self.ledger(), apply=apply,
                current=lambda memory=memory, clears=clears: memory.clears == clears))
        if total.failed:
            self._record_failure()
        else:
            self._recovered()
            self._set_state(_CONSOLIDATED, self._now_ms())
        return total

    async def wait_idle(self) -> None:
        """Wait for the background pass and the folds that run, if any (the tests)."""
        if self._running is not None:
            await asyncio.gather(self._running, return_exceptions=True)
        await self.conversation.wait_for_fold()
        for conversation in list(self._conversations.values()):
            await conversation.wait_for_fold()

    async def aclose(self) -> None:
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None
        if self._running is not None and not self._running.done():
            self._running.cancel()
            await asyncio.gather(self._running, return_exceptions=True)
        await self.conversation.aclose()
        for conversation in list(self._conversations.values()):
            await conversation.aclose()

    # --- the RPC methods ---------------------------------------------------------------------------

    def _member(self, params: dict) -> int:
        """The assistant whose own memory a method is about: `member_id`, 0 (Raphael) by default.
        One that is not there is refused."""
        member_id = params.get("member_id", 0)
        if member_id is None:
            return 0
        if type(member_id) is not int or member_id < 0:
            raise invalid_params("member_id must be a whole number of 0 or more")
        if member_id and not self.member_exists(member_id):
            raise invalid_params("there is no such member")
        return member_id

    @staticmethod
    def _space_of(params: dict, key: str = "space") -> str:
        space = params.get(key, "own")
        if space is None:
            return "own"
        if space not in SPACES:
            raise invalid_params(f"{key} must be shared or own")
        return space

    def _file(self, params: dict) -> MemoryFile:
        return self.space(self._space_of(params), self._member(params))

    def _view(self, params: dict) -> dict:
        """The document as the owner reads it."""
        memory = self._file(params)
        summary = None
        if self._space_of(params) == "own":
            found = self.conversation_for(self._member(params)).summary()
            if found.text:
                summary = {"text": found.text, "updated_at_ms": found.updated_at_ms}
        return {"text": memory.read(), "revision": memory.revision(), "chars": memory.chars(),
                "entries": len(memory.entries()), "limit": memory.limit, "summary": summary}

    async def _get(self, params: dict) -> dict:
        return self._view(params)

    async def _import(self, params: dict) -> dict:
        """Explicit owner import, through the shared writer and its existing secret scan.

        Refused text is never returned: it can contain the secret that was refused.
        Each paragraph or bullet is independent, so one refusal does not hide the rest.
        """
        text = params.get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_DOCUMENT_CHARS:
            raise invalid_params("text must contain 1 to 64000 characters")
        entries = [re.sub(r"^\s*(?:[-*•]|\d+[.)])\s+", "", line).strip()
                   for line in re.split(r"\n\s*\n|\n(?=\s*(?:[-*•]|\d+[.)])\s)", text)]
        memory = self.space("shared", 0)
        kept, refused = [], []
        for index, entry in enumerate(entries, 1):
            if not entry:
                continue
            memory.reset_failures()
            result = memory.apply([{"action": "add", "content": entry}])
            if result["success"]:
                kept.append(entry)
            else:
                refused.append({"index": index, "reason": result.get("kind", "invalid")})
        return {"kept": kept, "refused": refused}

    async def _update(self, params: dict) -> dict:
        text, revision = params.get("text"), params.get("revision")
        if not isinstance(text, str) or len(text) > MAX_DOCUMENT_CHARS:
            raise invalid_params("text must be the document")
        if revision is not None and not isinstance(revision, str):
            raise invalid_params("revision must be the one memory.get gave")
        result = self._file(params).edit_document(text, revision)
        if not result["success"]:
            raise invalid_params(f"{result['kind']}: {result['error']}")
        return self._view(params)

    async def _clear(self, params: dict) -> dict:
        return {"cleared": self._file(params).clear()}

    async def _summary_clear(self, params: dict) -> dict:
        return {"cleared": self.conversation_for(self._member(params)).clear_summary()}


@dataclass(frozen=True)
class MemberMemory:
    """The memory as a background task of one assistant sees it (`background.run.MemoryReader`): USER.md
    and its own file, its own thread searched, and the growth tools on its own home."""

    memory: MemoryService
    member_id: int

    def growth(self, name, args, *, untrusted=False, owner_text=""):
        return self.memory.growth(name, args, untrusted=untrusted, member_id=self.member_id, owner_text=owner_text)

    def snapshot(self) -> MemorySnapshot:
        return self.memory.snapshot(self.member_id)

    def search(self, query: str, *, limit: int = 5, exclude: Sequence[int] = ()) -> ToolResult:
        return self.memory.search(query, limit=limit, exclude=exclude, member_id=self.member_id)


@dataclass(frozen=True)
class SharedMemory:
    """The memory as a room's turn or work a colleague handed over sees it
    (`background.run.MemoryReader`): USER.md alone. What the owner told one assistant stays out of a
    group and out of a colleague's work, so no own file is read and no conversation searched; never a
    write."""

    memory: MemoryService

    def snapshot(self) -> MemorySnapshot:
        return self.memory.snapshot(None)

    def search(self, query: str, *, limit: int = 5, exclude: Sequence[int] = ()) -> ToolResult:
        return ToolResult("history_search", False, None, "blocked")

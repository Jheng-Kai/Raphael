"""The voice assistant's history: what it was asked and what it said, one row for each turn.

A turn is written when the assistant has its answer, or when it has asked for a yes or a no
(`status` "confirm"), and the row is completed when that is answered (`resolve`). The app's page of
conversations shows them, and they are the one continuous conversation the model reads: the
latest turns as they were said, the earlier ones through a summary (`memory.conversation`). A request
that failed, was refused or stopped, or was never answered is in that conversation too (`is_unfinished`),
told as one that did not finish, with what its steps already did (`Turn.work`).

A turn keeps file metadata and opaque IDs for locally stored copies. The bytes live in
its data folder, outside the database; legacy turns with names and types remain readable.

Each turn keeps where it came from (`source`: "voice", or a chat app such as "telegram") and the
model that answered, and its steps (`agent_steps`, `steps.Step`): what the fast tier did for it, so
the conversation view can show what happened between the question and the answer. The steps go with
their turns when the history is cleared.

Every turn is also in the search (`agent_turns_fts`, `search`): its question and its answer as
words and pairs of CJK characters (`memory.terms`), so that Raphael can look up what was said long
ago, a word of two Chinese characters too.

Each turn is in the thread of one member of the owner's team (`member_id`, raphael_core.members):
0 is Raphael, whose thread every turn was in before there were members, and the rest are the members
the owner made. Every reading here is of one thread (Raphael's, unless another is named), so each
member has a conversation, a summary and a search of its own. Two kinds of turn are not the owner's
own words: an exchange (`route` "exchange", `source` "member"), where one member asked another
something through `ask_member` and the other answered (kept as a separate exchange audit, `peer_id`
naming the requester), and a routine's run (`route` and `source` "routine"), whose `question` is the
routine's title and whose answer is what the run reported.

Private reads include the member's own exchanges. Room turns require a room/thread, never resolve or
touch a private conversation, and remain available through the room service and internal audit.
A member's own chat also lists its exchanges with colleagues where they came (`list` and `after`
with `exchanges`), each drawn as one line; context and search also include its own delegated work.

The conversation is not pruned: unlike the dictations, which go after the retention setting, the
turns stay until the user clears them (`clear`). Nothing here logs a question or an answer.
"""

# Postponed annotations: AgentHistory has a method called `list`, which would otherwise hide the
# builtin in the annotations of the methods defined after it.
from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field

from ..clock import wall_clock_ms
from ..protocol import RpcError
from ..memory.terms import QueryWord, fts_quote, index_terms, query_words
from .steps import Step, reason_of, work_summary
from .failure import public_failure
from .quotes import quote_from_wire
from .conversations import Conversations
from .public_events import event_text
from .actions import is_action

# Where a turn came from when nobody says: the hotkey and the overlay.
VOICE = "voice"
# The statuses of a turn that ended without the answer asked for: it failed, the owner said no or
# stopped it, or nobody answered it. It is part of the conversation all the same: the owner said it. A turn
# still "running" or waiting for a yes ("confirm") is not over, and says nothing yet.
UNFINISHED = ("error", "denied", "expired", "cancelled")


@dataclass
class Turn:
    id: int | None
    created_at_ms: int
    session_id: str
    question: str  # what the user said, after the dictionary's replacements
    route: str  # command, answer, delegate, discuss, chat or unclear
    prefix: str  # how Raphael answered, in the language the user reads
    text: str  # the short line of the overlay; empty for a command that was done
    detail: str | None  # the longer text of an answer, if it had one
    # "done", "confirm" (waiting for a yes or a no), "denied", "expired" or "error".
    status: str
    cost_usd: float = 0.0
    source: str = VOICE  # "voice", or the chat app the request came from
    model: str | None = None  # the model that answered, when one did
    # File metadata, optionally including a stored-copy ID and byte count; None for no files.
    attachments: list[dict[str, str | int]] | None = None
    member_id: int = 0  # whose thread it is in: 0 for Raphael
    peer_id: int | None = None  # for an exchange, the member on the other side
    messages: list[str] = field(default_factory=list)
    quote: dict[str, str] | None = None
    conversation_id: int | None = None
    scope: str = "private"
    room_id: int | None = None
    thread_id: int | None = None
    source_turn_id: int | None = None
    # For a turn that did not finish, what it already did (`steps.work_summary`); set where the model
    # reads the turn (`AgentHistory.with_work`), empty otherwise.
    work: str = ""
    reactions: dict = field(default_factory=dict)
    card_outcomes: list[str] = field(default_factory=list)
    failure: dict | None = None
    colleague_answers: list[Turn] = field(default_factory=list, repr=False)


def is_unfinished(turn: Turn) -> bool:
    """Whether the owner asked for `turn` and it ended without an answer (UNFINISHED). What a routine
    or a colleague asked is not the owner's, and a failed routine is no part of their conversation."""
    return (
        turn.status in UNFINISHED
        and turn.source not in ("routine", "member")
        and turn.route not in ("routine", "exchange")
    )


def is_readable(turn: Turn) -> bool:
    """Whether the model reads `turn` as part of the conversation: it was answered, or it is a request
    of the owner's that did not finish, or a turn carrying a card whose current state is needed."""
    return turn.status == "done" or is_unfinished(turn) or bool(turn.card_outcomes)


_COLUMNS = (
    "id, created_at_ms, session_id, question, route, prefix, text, detail, status, cost_usd,"
    " source, model, attachments, member_id, peer_id, quote, conversation_id, scope, room_id, thread_id, source_turn_id, failure"
)
_STEP_COLUMNS = "turn_id, kind, tool, server, outcome, ms, reason, at_ms, detail"
_TURN_COLUMNS = ", ".join(f"t.{name.strip()}" for name in _COLUMNS.split(","))
# The most turns a search returns to the model (the conversation page asks for more).
SEARCH_MAX = 10


def _attachments(saved: str | None) -> list[dict[str, str | int]] | None:
    """The files of a turn as saved (JSON), or None when it had none or what is saved is damaged."""
    if not saved:
        return None
    try:
        items = json.loads(saved)
    except ValueError:
        return None
    if not isinstance(items, list):
        return None
    kept = [
        {key: item[key] for key in ("name", "mime", "id", "size") if key in item}
        for item in items
        if isinstance(item, dict)
        and isinstance(item.get("name"), str)
        and isinstance(item.get("mime"), str)
    ]
    return kept or None


def _failure_json(value, status):
    failure = public_failure(value) if status == "error" else None
    return json.dumps(failure) if failure else None


def _to_turn(row: sqlite3.Row) -> Turn:
    data = dict(row)
    data["attachments"] = _attachments(data.get("attachments"))
    try:
        data["failure"] = public_failure(json.loads(data["failure"])) if data.get("failure") and data["status"] == "error" else None
    except (ValueError, TypeError):
        data["failure"] = None
    try:
        data["quote"] = quote_from_wire(json.loads(data["quote"])) if data.get("quote") else None
    except (ValueError, TypeError, RpcError):
        # Damaged saved context must not prevent reading the rest of a thread.
        data["quote"] = None
    return Turn(**data)


# A member's exchanges with colleagues: what another member asked it (`ask_member`) or handed it (`handoff`), kept
# outside its private conversations. Room work stays in rooms.
_EXCHANGES = "scope = 'exchange' AND peer_id IS NOT NULL"
# Each side keeps its own copy: `member_id` scopes these exchanges to the member whose thread is read.
_OWN_EXCHANGES = _EXCHANGES
# The turns the model reads as the conversation (`is_readable`), as SQL.
_READABLE = (
    f"(status = 'done' OR (status IN ({', '.join(repr(status) for status in UNFINISHED)})"
    " AND source NOT IN ('routine', 'member') AND route NOT IN ('routine', 'exchange')))"
)


def _anything(step: Step) -> bool:
    return True


def _thread(member_id: int, conversation_id: int | None, exchanges: bool) -> tuple[str, list[object]]:
    """The conditions of a member's thread as its chat lists it, and their params."""
    scopes = f"(scope = 'private' OR ({_OWN_EXCHANGES}))" if exchanges else "scope = 'private'"
    where, params = f"{scopes} AND status != 'withdrawn' AND member_id = ?", [member_id]
    if conversation_id is not None:
        where += " AND conversation_id = ?"
        params.append(conversation_id)
    return where, params


def _filters(
    since_ms: int | None, exclude: Sequence[int], member_id: int | None = 0,
    conversation_id: int | None = None,
) -> tuple[str, list[object]]:
    """The conditions of a search besides its words, as SQL to add to its WHERE, and their params:
    the turns of the thread of `member_id`, made from `since_ms` on, and none of the ids of
    `exclude`."""
    scopes = "t.scope = 'private'" if member_id is None else "t.scope IN ('private', 'exchange')"
    where, params = (f" AND {scopes} AND t.status != 'withdrawn'", [])
    if member_id is not None:
        where += " AND t.member_id = ?"
        params.append(member_id)
    if conversation_id is not None:
        where += " AND t.conversation_id = ?"
        params.append(conversation_id)
    if since_ms is not None:
        where += " AND t.created_at_ms >= ?"
        params.append(since_ms)
    ids = sorted({turn for turn in exclude if type(turn) is int})
    if ids:
        where += f" AND t.id NOT IN ({', '.join('?' * len(ids))})"
        params += ids
    return where, params


class AgentHistory:
    """The `agent_turns` table. Use it on the thread that owns `conn`."""

    def __init__(
        self, conn: sqlite3.Connection, now_ms: Callable[[], int] = wall_clock_ms
    ) -> None:
        self._conn = conn
        self._now_ms = now_ms
        self._events_indexed = False

    def _repair_event_index(self) -> None:
        if self._events_indexed:
            return
        # Older indexes included transport keys. Repair only turns with structured receipts.
        rows = self._conn.execute("SELECT DISTINCT t.id, t.question, t.text, t.detail FROM agent_turns t"
                                  " JOIN agent_messages m ON m.turn_id=t.id WHERE m.kind='event'"
                                  " AND ltrim(m.text) LIKE '{%'").fetchall()
        if rows:
            with self._conn:
                for row in rows:
                    self._index(row["id"], row["question"], row["text"], row["detail"])
        self._events_indexed = True

    def add(
        self,
        *,
        session_id: str,
        question: str,
        route: str,
        prefix: str,
        text: str,
        status: str,
        detail: str | None = None,
        cost_usd: float = 0.0,
        source: str = VOICE,
        model: str | None = None,
        steps: Sequence[Step] = (),
        attachments: Sequence[Mapping[str, str | int]] = (),
        member_id: int = 0,
        peer_id: int | None = None,
        quote: dict[str, str] | None = None,
        conversation_id: int | None = None,
        scope: str = "private",
        room_id: int | None = None,
        thread_id: int | None = None,
        source_turn_id: int | None = None,
        admission: str | None = None,
        failure: dict | None = None,
        place: tuple[int, int] | None = None,
    ) -> int:
        """Store a new turn, made now, in the thread of `member_id`, with the steps taken for it,
        and return its id. `attachments` are the names and the types of the files handed with the
        request; `peer_id` is the other member of an exchange. `place` is `(id, created_at_ms)` of a
        turn that was removed: the new turn stands where that one stood (an edited message keeps its
        place in the thread). The id must be free."""
        files = [{key: item[key] for key in ("name", "mime", "id", "size") if key in item} for item in attachments]
        if scope == "private" and (source == "member" or route == "exchange"):
            scope = "exchange"
        if scope not in ("private", "room", "exchange", "quarantine"):
            raise ValueError("unknown turn scope")
        if scope == "room":
            if not self._conn.execute("SELECT 1 FROM room_threads WHERE id=? AND room_id=?", (thread_id, room_id)).fetchone():
                raise ValueError("room turns require a valid room thread")
        elif room_id is not None or thread_id is not None:
            raise ValueError("non-room turns cannot name a room")
        if (source == "room" or route == "room") and scope != "room":
            raise ValueError("room source requires room scope")
        with self._conn:
            conversations = Conversations(self._conn, self._now_ms)
            conversation_id = conversations.resolve(member_id, conversation_id) if scope in ("private", "exchange") else None
            cursor = self._conn.execute(
                "INSERT INTO agent_turns (id, created_at_ms, session_id, question, route, prefix,"
                " text, detail, status, cost_usd, source, model, attachments, member_id, peer_id, quote, conversation_id, scope, room_id, thread_id, source_turn_id, failure)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    place[0] if place else None,
                    place[1] if place else self._now_ms(),
                    session_id,
                    question,
                    route,
                    prefix,
                    text,
                    detail,
                    status,
                    cost_usd,
                    source,
                    model,
                    json.dumps(files, ensure_ascii=False) if files else None,
                    member_id,
                    peer_id,
                    json.dumps(quote, ensure_ascii=False) if quote else None,
                    conversation_id,
                    scope, room_id, thread_id, source_turn_id, _failure_json(failure, status),
                ),
            )
            turn_id = cursor.lastrowid
            assert turn_id is not None
            self._insert_steps(turn_id, steps)
            self._index(turn_id, question, text, detail)
            if conversation_id is not None:
                conversations.touch(conversation_id, question)
            if admission is not None:
                self._conn.execute(
                    "INSERT INTO agent_inbox(turn_id,request_id,member_id,conversation_id,seq,state,payload_json,created_at_ms)"
                    " SELECT ?,?,?,?,COALESCE(MAX(seq),0)+1,'queued',?,? FROM agent_inbox WHERE member_id=? AND conversation_id=?",
                    (turn_id, session_id, member_id, conversation_id, admission, self._now_ms(), member_id, conversation_id),
                )
        return turn_id

    def _index(self, turn_id: int, question: str, text: str, detail: str | None) -> None:
        """Put a turn into the search, in place of what it held for it."""
        saved = self._conn.execute(
            "SELECT kind, text FROM agent_messages WHERE turn_id = ? ORDER BY seq", (turn_id,)
        ).fetchall()
        tools = self._conn.execute("SELECT tool,redacted_args,substr(redacted_result,1,8192) FROM turn_tool_events WHERE turn_id=? ORDER BY id", (turn_id,)) if self._conn.execute("SELECT 1 FROM sqlite_master WHERE name='turn_tool_events'").fetchone() else ()
        tool_text = "\n".join(" ".join(row) for row in tools)
        terms = index_terms(question, text, (detail or "") + "\n" + tool_text + "\n" + "\n".join(event_text(row["text"]) if row["kind"] == "event" else row["text"] for row in saved if not (row["kind"] == "event" and is_action(row["text"]))))
        self._conn.execute("DELETE FROM agent_turns_fts WHERE rowid = ?", (turn_id,))
        self._conn.execute(
            "INSERT INTO agent_turns_fts (rowid, pairs, chars) VALUES (?, ?, ?)",
            (turn_id, terms.pairs, terms.chars),
        )

    def reindex(self, turn_id):
        row = self._conn.execute("SELECT question,text,detail FROM agent_turns WHERE id=?", (turn_id,)).fetchone()
        if row:
            self._index(turn_id, row[0], row[1], row[2])

    def add_steps(self, turn_id: int, steps: Sequence[Step]) -> None:
        """Add steps to a turn that is already stored: the call made after a yes, say. They come
        after the ones it has."""
        with self._conn:
            self._insert_steps(turn_id, steps)

    def _insert_steps(self, turn_id: int, steps: Sequence[Step]) -> None:
        for step in steps:
            self._conn.execute(
                "INSERT INTO agent_steps (turn_id, n, at_ms, kind, tool, server, outcome, ms,"
                " reason, detail) VALUES (?, (SELECT COALESCE(MAX(n), 0) + 1 FROM agent_steps"
                " WHERE turn_id = ?), ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    turn_id,
                    turn_id,
                    step.at_ms or self._now_ms(),
                    step.kind,
                    step.tool,
                    step.server,
                    step.outcome,
                    max(int(step.ms), 0),
                    step.reason or (reason_of(step.outcome, None) if step.outcome == 'blocked' else None),
                    step.detail,
                ),
            )

    def steps(self, turn_ids: Iterable[int]) -> dict[int, list[Step]]:
        """The steps of each of `turn_ids` that has any, in the order they were taken."""
        ids = sorted({int(turn_id) for turn_id in turn_ids})
        found: dict[int, list[Step]] = {}
        # SQLite takes at most 999 parameters in old builds: a page of turns is far fewer.
        for start in range(0, len(ids), 500):
            chunk = ids[start : start + 500]
            marks = ", ".join("?" * len(chunk))
            rows = self._conn.execute(
                f"SELECT {_STEP_COLUMNS} FROM agent_steps WHERE turn_id IN ({marks})"
                " ORDER BY turn_id, n",
                chunk,
            )
            for row in rows:
                data = dict(row)
                found.setdefault(data.pop("turn_id"), []).append(Step(**data))
        return found

    def get(self, turn_id: int) -> Turn | None:
        row = self._conn.execute(
            f"SELECT {_COLUMNS} FROM agent_turns WHERE id = ?", (turn_id,)
        ).fetchone()
        return None if row is None else _to_turn(row)

    def get_many(self, turn_ids) -> dict[int, Turn]:
        ids = sorted(set(turn_ids))
        found = {}
        for start in range(0, len(ids), 500):
            chunk = ids[start:start + 500]
            for row in self._conn.execute(
                f"SELECT {_COLUMNS} FROM agent_turns WHERE id IN ({','.join('?' for _ in chunk)})", chunk):
                turn = _to_turn(row)
                found[turn.id] = turn
        return found

    def add_message(self, turn_id: int, kind: str, text: str) -> None:
        """Commit one visible line immediately; cleared turns are never resurrected."""
        if kind not in ("progress", "reply", "event", "thinking", "media"):
            raise ValueError("unknown message kind")
        with self._conn:
            cursor = self._conn.execute(
                "INSERT INTO agent_messages (turn_id, seq, kind, text, at_ms)"
                " SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ? FROM agent_messages"
                " WHERE turn_id = ? HAVING EXISTS (SELECT 1 FROM agent_turns WHERE id = ?)",
                (turn_id, kind, text, self._now_ms(), turn_id, turn_id),
            )
            if cursor.rowcount:
                turn = self.get(turn_id)
                if turn:
                    self._index(turn_id, turn.question, turn.text, turn.detail)

    def _with_messages(self, turns: list[Turn]) -> list[Turn]:
        saved = self.messages(turn.id for turn in turns if turn.id is not None)
        from .reactions import private_reactions
        from .card_context import card_outcomes
        outcomes = card_outcomes(self._conn, (turn.id for turn in turns), self._now_ms())
        asked = self.asked_from(turn.id for turn in turns if turn.id is not None)
        for turn in turns:
            turn.card_outcomes = outcomes.get(turn.id, [])
            turn.reactions = private_reactions(self._conn, turn.id)
            turn.messages = [event_text(m["text"]) if m["kind"] == "event" else m["text"] for m in saved.get(turn.id, []) if not (m["kind"] == "event" and is_action(m["text"]))]
            turn.colleague_answers = [exchange for exchange in asked.get(turn.id, []) if exchange.status == "done"]
        return turns

    def messages(self, turn_ids: Iterable[int]) -> dict[int, list[dict]]:
        """The visible messages of each turn, in insertion order."""
        found: dict[int, list[dict]] = {}
        ids = sorted(set(turn_ids))
        for start in range(0, len(ids), 500):
            chunk = ids[start : start + 500]
            rows = self._conn.execute(
                "SELECT turn_id, seq, kind, text, at_ms FROM agent_messages"
                f" WHERE turn_id IN ({','.join('?' * len(chunk))}) ORDER BY turn_id, seq",
                chunk,
            )
            for row in rows:
                data = dict(row)
                found.setdefault(data.pop("turn_id"), []).append(data)
        return found

    def publish_terminal(self, turn_id, *, prefix, text, detail, status, cost_usd, replies, model, failure=None):
        """Publish inside TaskStore's transaction, together with its terminal outbox event."""
        cursor = self._conn.execute("UPDATE agent_turns SET prefix=?,text=?,detail=?,status=?,cost_usd=cost_usd+?,"
                                    "model=COALESCE(?,model),failure=? WHERE id=?",
                                    (prefix,text,detail,status,cost_usd,model,_failure_json(failure, status),turn_id))
        if not cursor.rowcount:
            return
        row = self._conn.execute('SELECT question FROM agent_turns WHERE id=?',(turn_id,)).fetchone()
        self._index(turn_id,row[0],text,detail)
        for line in replies:
            if line:
                self._conn.execute("INSERT INTO agent_messages(turn_id,seq,kind,text,at_ms) "
                    "SELECT ?,COALESCE(MAX(seq),0)+1,'reply',?,? FROM agent_messages WHERE turn_id=?",
                    (turn_id,line,self._now_ms(),turn_id))

    def resolve(
        self,
        turn_id: int,
        *,
        prefix: str,
        text: str,
        status: str,
        detail: str | None = None,
        cost_usd: float = 0.0,
        model: str | None = None,
        route: str | None = None,
        failure: dict | None = None,
    ) -> bool:
        """Give a turn its outcome: what Raphael said in the end, how it ended, and the cost of
        getting there on top of what the turn cost so far (and the model that worded it, if one
        did). False if the turn is gone (the history was cleared meanwhile)."""
        with self._conn:
            cursor = self._conn.execute(
                "UPDATE agent_turns SET prefix = ?, text = ?, detail = ?, status = ?,"
                " cost_usd = cost_usd + ?, model = COALESCE(?, model),"
                " route = COALESCE(?, route), failure = ? WHERE id = ?",
                (prefix, text, detail, status, cost_usd, model, route, _failure_json(failure, status), turn_id),
            )
            if cursor.rowcount:
                row = self._conn.execute(
                    "SELECT question FROM agent_turns WHERE id = ?", (turn_id,)
                ).fetchone()
                self._index(turn_id, row[0], text, detail)
        return cursor.rowcount > 0

    def changes(self, after_id: int, turn_ids: list[int], limit: int, *, member_id: int,
                conversation_id: int, exchanges: bool = False) -> tuple[list[Turn], list[int], bool, int]:
        """One bounded forward page plus explicitly invalidated rows in this same private thread."""
        where, params = _thread(member_id, conversation_id, exchanges)
        fresh = self._conn.execute(
            f"SELECT {_COLUMNS} FROM agent_turns WHERE {where} AND id > ? ORDER BY id LIMIT ?",
            [*params, after_id, limit + 1],
        ).fetchall()
        changed = self._conn.execute(
            f"SELECT {_COLUMNS} FROM agent_turns WHERE {where} AND id IN ({','.join('?' for _ in turn_ids)})",
            [*params, *turn_ids],
        ).fetchall() if turn_ids else []
        found = {row["id"] for row in changed}
        rows = {row["id"]: row for row in [*fresh[:limit], *changed]}
        return ([_to_turn(rows[key]) for key in sorted(rows, reverse=True)],
                [key for key in turn_ids if key not in found], len(fresh) > limit,
                fresh[min(len(fresh), limit) - 1]["id"] if fresh else after_id)

    def list(
        self, limit: int = 50, before_id: int | None = None, *, member_id: int = 0,
        conversation_id: int | None = None, exchanges: bool = False,
    ) -> list[Turn]:
        """The thread of `member_id`, newest first. `before_id` keeps the turns made before that
        one: the cursor for the next page. With `exchanges`, what colleagues asked or handed the
        member's own received exchanges are among them, where they came."""
        where, params = _thread(member_id, conversation_id, exchanges)
        if before_id is not None:
            where += " AND id < ?"
            params.append(before_id)
        rows = self._conn.execute(
            f"SELECT {_COLUMNS} FROM agent_turns WHERE {where} ORDER BY id DESC LIMIT ?",
            [*params, limit],
        )
        return [_to_turn(row) for row in rows]

    def sent(self, limit: int) -> list[str]:
        """What the owner typed into a composer, newest first, whichever private conversation or room it went to (only
        their own words; typed means `source` "app", so not spoken, routine, colleague, resumed, draft or phone ones). Words
        sent twice in a row are one entry. Up to `limit` of them."""
        # A few more rows than asked for: a run of repeats collapses into one.
        rows = self._conn.execute(
            "SELECT text FROM ("
            " SELECT created_at_ms AS at, question AS text FROM agent_turns"
            "  WHERE scope = 'private' AND source = 'app' AND status != 'withdrawn' AND route <> 'draft' AND trim(question) <> ''"
            " UNION ALL SELECT created AS at, text FROM room_messages WHERE member_id IS NULL AND trim(text) <> ''"
            ") ORDER BY at DESC LIMIT ?", (limit * 4,)).fetchall()
        texts: list[str] = []
        for (text,) in rows:
            if not texts or texts[-1] != text:
                texts.append(text)
        return texts[:limit]

    def asked_from(self, turn_ids: Iterable[int]) -> dict[int, list[Turn]]:
        """What each of `turn_ids` asked or handed colleagues while it ran, by that turn: the
        exchanges written in the colleagues' own threads, oldest first."""
        found: dict[int, list[Turn]] = {}
        ids = sorted({int(turn_id) for turn_id in turn_ids})
        for start in range(0, len(ids), 500):
            chunk = ids[start : start + 500]
            rows = self._conn.execute(
                f"SELECT {_COLUMNS} FROM agent_turns WHERE source_turn_id IN ({','.join('?' * len(chunk))})"
                f" AND {_EXCHANGES} ORDER BY id", chunk,
            )
            for turn in map(_to_turn, rows):
                found.setdefault(turn.source_turn_id, []).append(turn)
        return found

    def recent(
        self, count: int, *, member_id: int = 0, conversation_id: int | None = None,
        unfinished: bool = False, changes: Callable[[Step], bool] | None = None,
    ) -> list[Turn]:
        """The last `count` turns of the thread of `member_id` that were answered, oldest first:
        the context of what is asked next. A turn that is waiting for a yes or a no, was refused
        or failed says nothing. With `unfinished`, the owner's requests that did not finish are among
        them, in their place (`is_unfinished`), each told what it already did (`with_work`)."""
        if count <= 0:
            return []
        condition = "" if conversation_id is None else " AND conversation_id = ?"
        from .card_context import CARD_TURNS_SQL
        said = _READABLE if unfinished else "status = 'done'"
        said = f"({said} OR id IN ({CARD_TURNS_SQL}))"
        rows = self._conn.execute(
            f"SELECT {_COLUMNS} FROM agent_turns WHERE scope IN ('private', 'exchange') AND {said} AND member_id = ?"
            + condition + " ORDER BY id DESC LIMIT ?",
            [member_id, *([] if conversation_id is None else [conversation_id]), count],
        )
        turns = self._with_messages([_to_turn(row) for row in reversed(rows.fetchall())])
        return self.with_work(turns, changes) if unfinished else turns

    def with_work(self, turns: list[Turn], changes: Callable[[Step], bool] | None = None) -> list[Turn]:
        """`turns`, with `Turn.work` set for each one that did not finish: what its steps already did
        (`steps.work_summary`). `changes` says which step changed something (`ToolGate.step_changes`);
        without it every step counts as a change, since a step not known to only read may have changed
        something."""
        waiting = [turn for turn in turns if turn.id is not None and is_unfinished(turn)]
        if waiting:
            steps = self.steps(turn.id for turn in waiting)
            for turn in waiting:
                turn.work = work_summary(steps.get(turn.id, []), changes or _anything)
        return turns

    def after(
        self, turn_id: int, *, limit: int | None = None, member_id: int = 0,
        conversation_id: int | None = None, exchanges: bool = False,
    ) -> list[Turn]:
        """The turns of the thread of `member_id` made after the turn `turn_id`, whatever their
        status, oldest first; with a `limit`, only the newest that many of them. `exchanges` as
        for `list`."""
        where, params = _thread(member_id, conversation_id, exchanges)
        where = f"id > ? AND {where}"
        params = [turn_id, *params]
        if limit is None:
            rows = self._conn.execute(
                f"SELECT {_COLUMNS} FROM agent_turns WHERE {where} ORDER BY id", params,
            ).fetchall()
            return self._with_messages([_to_turn(row) for row in rows])
        if limit <= 0:
            return []
        rows = self._conn.execute(
            f"SELECT {_COLUMNS} FROM agent_turns WHERE {where} ORDER BY id DESC LIMIT ?",
            [*params, limit],
        ).fetchall()
        return self._with_messages([_to_turn(row) for row in reversed(rows)])

    def last_id(self) -> int:
        """The id of the latest turn of any thread; 0 when there is none."""
        (found,) = self._conn.execute("SELECT COALESCE(MAX(id), 0) FROM agent_turns").fetchone()
        return int(found)

    def latest_by_member(self) -> dict[int, Turn]:
        """The latest turn of each thread that has one, by member: what the member column shows
        under each name."""
        rows = self._conn.execute(
            f"SELECT {_COLUMNS} FROM agent_turns WHERE id IN"
            " (SELECT MAX(id) FROM agent_turns WHERE scope = 'private' GROUP BY member_id)"
        ).fetchall()
        return {turn.member_id: turn for turn in map(_to_turn, rows)}

    def search(
        self,
        query: str,
        *,
        limit: int = 5,
        since_ms: int | None = None,
        exclude: Sequence[int] = (),
        most: int = SEARCH_MAX,
        member_id: int | None = 0,
        conversation_id: int | None = None,
    ) -> list[Turn]:
        """The answered turns that hold the words of `query`, best first (BM25, then the newest),
        at most `limit` and `most` (SEARCH_MAX for the model, more for the conversation page). Each
        word is looked for as it is written, a word of two Chinese characters too (`memory.terms`),
        and a turn that holds any of them is found. A word that is a long run of Chinese and is not
        found as it is written is looked for by its pairs of characters. `since_ms` keeps the turns made from then on. The turns of `exclude` (the
        ones the model already reads) are left out by the query itself, before the limit, so that
        the older turns behind them are found however many of them match. Only the thread of
        `member_id` is searched."""
        words = query_words(query)
        limit = max(1, min(limit, most))
        if not words:
            return []
        self._repair_event_index()
        where, params = _filters(since_ms, exclude, member_id, conversation_id)
        found = self._find(words, limit, where, params)
        if not found and any(len(word.pairs) > 1 for word in words):
            pairs = dict.fromkeys(pair for word in words for pair in word.pairs)
            found = self._find([QueryWord(pair, (pair,)) for pair in pairs], limit, where, params)
        return self._with_messages(found)

    def _find(
        self, words: Sequence[QueryWord], limit: int, where: str, params: Sequence[object]
    ) -> list[Turn]:
        if not self._has_fts():
            return self._search_like(words, limit, where, params)
        match = " OR ".join(
            f"chars : {fts_quote(word.char)}"
            if word.char
            else "pairs : " + fts_quote(" ".join(word.pairs))
            for word in words
        )
        return self._match(match, limit, where, params)

    def _match(self, match: str, limit: int, where: str, params: Sequence[object]) -> list[Turn]:
        rows = self._conn.execute(
            f"SELECT {_TURN_COLUMNS} FROM agent_turns_fts JOIN agent_turns t"
            " ON t.id = agent_turns_fts.rowid"
            f" WHERE agent_turns_fts MATCH ? AND t.status = 'done'{where}"
            " ORDER BY bm25(agent_turns_fts), t.id DESC LIMIT ?",
            [match, *params, limit],
        ).fetchall()
        return [_to_turn(row) for row in rows]

    def _search_like(
        self, words: Sequence[QueryWord], limit: int, where: str, params: Sequence[object]
    ) -> list[Turn]:
        """The search where this SQLite has no FTS5: the same terms, read with LIKE, newest first.
        The table holds a few thousand turns a year, so a scan takes milliseconds."""
        conditions: list[str] = []
        terms: list[object] = []
        for word in words:
            if word.char:
                conditions.append("f.chars LIKE ?")
                terms.append(f"%{word.char}%")
            else:
                conditions.append("(' ' || f.pairs || ' ') LIKE ?")
                terms.append(f"% {' '.join(word.pairs)} %")
        rows = self._conn.execute(
            f"SELECT {_TURN_COLUMNS} FROM agent_turns_fts f JOIN agent_turns t ON t.id = f.rowid"
            f" WHERE ({' OR '.join(conditions)}) AND t.status = 'done'{where}"
            " ORDER BY t.id DESC LIMIT ?",
            [*terms, *params, limit],
        ).fetchall()
        return [_to_turn(row) for row in rows]

    def _has_fts(self) -> bool:
        row = self._conn.execute(
            "SELECT sql FROM sqlite_master WHERE name = 'agent_turns_fts'"
        ).fetchone()
        return row is not None and "fts5" in (row[0] or "").lower()

    def clear(self) -> int:
        """Delete every turn of every thread, with its steps and its place in the search; return
        how many went."""
        with self._conn:
            self._conn.execute("DELETE FROM agent_messages")
            self._conn.execute("DELETE FROM agent_steps")
            self._conn.execute("DELETE FROM agent_turns_fts WHERE rowid > 0")
            cursor = self._conn.execute("DELETE FROM agent_turns")
        return cursor.rowcount

    def for_session(self, session_id: str) -> list[Turn]:
        rows = self._conn.execute(
            f"SELECT {_COLUMNS} FROM agent_turns WHERE session_id = ?", (session_id,)
        ).fetchall()
        return [_to_turn(row) for row in rows]

    def delete(self, turn_id: int) -> bool:
        """Remove a single turn and its public lines, steps and search terms."""
        with self._conn:
            self._conn.execute("UPDATE worker_tasks SET turn_id = NULL WHERE turn_id = ?", (turn_id,))
            self._conn.execute("DELETE FROM agent_messages WHERE turn_id = ?", (turn_id,))
            self._conn.execute("DELETE FROM agent_steps WHERE turn_id = ?", (turn_id,))
            self._conn.execute("DELETE FROM agent_turns_fts WHERE rowid = ?", (turn_id,))
            cursor = self._conn.execute("DELETE FROM agent_turns WHERE id = ?", (turn_id,))
        return cursor.rowcount > 0

    def clear_member(self, member_id: int) -> int:
        """Remove all of this member's rows and peer exchanges outside room history."""
        both = (member_id, member_id)
        ids = "SELECT id FROM agent_turns WHERE scope != 'room' AND (member_id = ? OR peer_id = ?)"
        with self._conn:
            self._conn.execute(f"DELETE FROM agent_messages WHERE turn_id IN ({ids})", both)
            self._conn.execute(f"DELETE FROM agent_steps WHERE turn_id IN ({ids})", both)
            self._conn.execute(f"DELETE FROM agent_turns_fts WHERE rowid IN ({ids})", both)
            cursor = self._conn.execute(
                "DELETE FROM agent_turns WHERE scope != 'room' AND (member_id = ? OR peer_id = ?)", both
            )
        return cursor.rowcount

    def expire_pending(self) -> int:
        """Mark the turns that still wait for a yes or a no as expired: the confirmation lived in
        a process that is gone. Returns how many there were."""
        with self._conn:
            cursor = self._conn.execute(
                "UPDATE agent_turns SET status = 'expired' WHERE status IN ('confirm', 'running')"
            )
        return cursor.rowcount

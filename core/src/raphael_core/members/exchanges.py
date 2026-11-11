"""Bounded meeting rounds: members choose to speak on one shared snapshot.

No one is asked beforehand whether they will speak (Hermes, gateway/hosted_room_discussion.py): an address is answered by
whoever it names, a message that names no one goes to the room's default responder first, and everyone else then reads
that answer in a speech turn of their own and speaks or passes. A member the owner addresses may not pass.
Speech uses the shared worker with a separate admission pool. Durable private work returns through report cards; no
member dispatches another member's speech. A reply that does not finish is a status line (a blocked intent), never words
in anyone's mouth.
"""
import asyncio
import json
import logging
from dataclasses import dataclass

from ..background.final import is_pass
from ..failures import KINDS
from ..memory.compression import FRESH_CONTEXT_CHARS, recent_turns
from ..brain.spend import SpendTracker
from ..protocol import RpcError
from ..worker.guards import neutralize

# Safety bounds apply to colleague chatter, including repeated mention pairs.
MAX_TURNS = 10
MAX_HOPS = 3
MAX_ROUNDS = 3
MAX_PAIR_REPLIES = 2
# A room thread stops asking its members after this many replies in a row failed for the same cause: the room's own
# bounds are three (MAX_HOPS, MAX_ROUNDS), and each reply was already asked again 1, 3 and 8 seconds on the way. A pass is
# no progress and does not break a run of failures; a reply with something said or started does.
BREAKER_FAILURES = 3
# How many of a thread's latest replies are looked at (passes among them are skipped).
BREAKER_LOOK = 40
# Why a reply did not finish, when that is not a failure of the model or the work (the owner's Stop, a message that took
# over, a bound, a restart, a member who left, a pass the owner did not accept).
_NOT_A_CAUSE = frozenset(('owner', 'interjection', 'reply_budget', 'revoked', 'restart', 'cost', 'membership',
                          'no_reply', 'source_unavailable', 'removed', 'restart_retry', 'circuit_open'))
# Leave room for the task wrapper, recovery receipts and the member's system prompt.
ROOM_CONTEXT_CHARS = FRESH_CONTEXT_CHARS - 4000
# A speech turn that ended without a word for this long, or whose provider gave up waiting, made no progress.
_STALLED = ('limit_time', 'timeout')
# An API brain's failures that a room's status line names, as it names a CLI's (`cli_…`): the closed kinds, each
# with its own words where the owner can act on it (`rooms.unfinished_kind`). A reply that went silent is
# "stalled" (`_STALLED`); any other reason is "worker".
_NAMED = KINDS - {'timeout', 'unknown'}
# Why an exchange stopped, when that is not a failure: the owner's Stop or new message, and the bound on colleague chatter.
_NOT_FAILURES = ('owner', 'interjection', 'reply_budget')
logger = logging.getLogger(__name__)


def bounded_transcript(transcript, *, chars=ROOM_CONTEXT_CHARS, byte_limit=ROOM_CONTEXT_CHARS, required=(), hard=float("inf")):
    """Fold older records out of the prompt; keep the source and the newest message whole. Length is never an error
    (owner, 2026-11-09): whole messages, newest first. The older ones fill what `chars` and `byte_limit` leave; the
    required ones (the message answered, the newest) are kept whole past them, up to `hard` bytes together, which is what
    the model's window leaves. A required message that alone does not fit even that (a colleague's report of 100,000
    characters) is left out and says so in its place, with its size; the log names it, and the others go on."""
    if not transcript:
        return [], 0
    required = {*required, transcript[-1]["id"]}
    encoded = {item["id"]: neutralize(json.dumps(item, ensure_ascii=False)) for item in transcript}
    skipped, mandatory, room = {}, [0, 0], hard - 2
    for item in reversed(transcript):
        if item["id"] not in required:
            continue
        text = encoded[item["id"]]
        size = len(text.encode("utf-8")) + 2
        if size > room:
            logger.warning("A room message is too long for any reply to carry and was left out: message=%s chars=%d", item["id"], len(text))
            skipped[item["id"]] = len(str(item.get("text") or ""))
            continue
        room -= size
        mandatory[0] += len(text) + 2
        mandatory[1] += size
    kept = {identifier for identifier in required if identifier not in skipped} | {identifier for identifier, _ in recent_turns(
        [(identifier, text) for identifier, text in encoded.items() if identifier not in required],
        chars - 2 - mandatory[0], min(byte_limit - 2 - mandatory[1], room))}
    result = []
    for item in transcript:
        if item["id"] in skipped:
            note = f"(this message is {skipped[item['id']]} characters long and was left out because it does not fit here)"
            result.append({**{key: item[key] for key in ("id", "member_id", "name", "role")}, "text": note, "attachments": [], "left_out": True})
        elif item["id"] in kept:
            result.append(item)
    return result, len(transcript) - len(result)


@dataclass(frozen=True)
class Exchange:
    origin_message_id: int
    room_id: int
    state: str
    language: str
    pending: str | None
    active_turn: int | None
    turns_taken: int
    spoken: str
    hops: int
    chime_ins: int
    cost: float
    stop_requested: int
    wrapup_sent: int
    reason: str
    routing: str = "{}"
    meeting: int = 0


class RoomExchanges:
    def __init__(self, rooms):
        self.rooms, self.conn = rooms, rooms._conn
        self.locks, self.tasks, self.attachments = {}, set(), {}
        self.spend = SpendTracker(self.conn, now_ms=rooms._now)
        self.closed = False
        # Only short speech is re-offered once; uncertain private tool work is never replayed.
        with self.conn:
            self.conn.execute("UPDATE room_reply_intents SET state='blocked',reason='source_unavailable' WHERE state='running' "
                              "AND NOT EXISTS(SELECT 1 FROM agent_turns t WHERE t.id=room_reply_intents.turn_id)")
            self.conn.execute("UPDATE room_reply_intents SET state='blocked', reason='restart' WHERE state='running' "
                              "AND turn_id IN (SELECT id FROM agent_turns WHERE status!='done')")
            self.conn.execute("UPDATE room_exchanges SET state='stopped', reason='restart' WHERE state IN ('queued','running') "
                              "AND ((active_turn IS NOT NULL AND NOT EXISTS (SELECT 1 FROM agent_turns t WHERE t.id=active_turn AND t.status='done')) OR origin_message_id IN "
                              "(SELECT x.origin_message_id FROM room_exchange_turns x JOIN agent_turns t ON t.id=x.turn_id WHERE x.state='running' AND t.status!='done'))")
            self.conn.execute("UPDATE room_exchange_turns SET state='interrupted' WHERE state='running' AND "
                              "turn_id IN (SELECT id FROM agent_turns WHERE status!='done')")
            self.conn.execute("UPDATE agent_turns SET status='error' WHERE status='running' AND id IN "
                              "(SELECT turn_id FROM room_exchange_turns WHERE state='interrupted')")
            # Speech no one addressed is not offered again, but the room says it was cut off rather than lose it.
            self.conn.execute("INSERT OR IGNORE INTO room_reply_intents(origin_message_id,source_message_id,recipient_id,"
                              "recipient_name,state,reason,turn_id,restart_count) "
                              "SELECT x.origin_message_id,m.id,x.member_id,COALESCE(p.name,'Raphael'),'blocked','restart',x.turn_id,1 "
                              "FROM room_exchange_turns x JOIN room_messages m ON m.turn_id=x.turn_id "
                              "LEFT JOIN members p ON p.id=x.member_id WHERE x.state='interrupted' "
                              "AND NOT EXISTS (SELECT 1 FROM room_reply_intents i WHERE i.turn_id=x.turn_id)")
            self.conn.execute("UPDATE room_reply_intents SET state='blocked', reason='restart' WHERE state='queued' "
                              "AND origin_message_id IN (SELECT origin_message_id FROM room_exchanges WHERE reason='restart')")

    def get(self, origin):
        row = self.conn.execute("SELECT * FROM room_exchanges WHERE origin_message_id = ?", (origin,)).fetchone()
        return Exchange(**dict(row)) if row else None

    def latest(self, room_id, thread_id=None):
        row = self.conn.execute("SELECT * FROM room_exchanges WHERE room_id = ? "
                                "AND (? IS NULL OR origin_message_id IN (SELECT id FROM room_messages WHERE thread_id=?)) "
                                "ORDER BY (state IN ('queued','running')) DESC, origin_message_id DESC LIMIT 1", (room_id,thread_id,thread_id)).fetchone()
        if not row:
            return None
        result = dict(row)
        result['routing'] = json.loads(result['routing'])
        result['active_turns'] = [dict(r) for r in self.conn.execute(
            "SELECT turn_id,member_id,round,seen_through,state FROM room_exchange_turns WHERE origin_message_id=? ORDER BY turn_id",
            (row['origin_message_id'],))]
        result['reply_intents'] = [dict(r) for r in self.conn.execute(
            "SELECT i.* FROM room_reply_intents i JOIN room_exchanges e ON e.origin_message_id=i.origin_message_id "
            "WHERE e.room_id=? AND (? IS NULL OR i.origin_message_id IN (SELECT id FROM room_messages WHERE thread_id=?)) "
            "AND (i.origin_message_id=? OR i.state='blocked') ORDER BY i.id", (room_id,thread_id,thread_id,row['origin_message_id']))]
        return result

    def intents(self, origin, source, recipients):
        with self.conn:
            for member in recipients:
                speaker = self.rooms._members.speaker(member)
                self.conn.execute("INSERT OR IGNORE INTO room_reply_intents "
                    "(origin_message_id,source_message_id,recipient_id,recipient_name) VALUES (?,?,?,?)",
                    (origin, source, member, speaker.name or 'Raphael'))

    def block(self, origin, reason, room=None):
        """Every reply still to come for `origin` will not come, for `reason`. With `room`, a failure on a message whose
        speakers were never chosen still says who did not answer: the room's default responder."""
        with self.conn:
            self.conn.execute("UPDATE room_reply_intents SET state='blocked', reason=? "
                              "WHERE origin_message_id=? AND state IN ('queued','running')", (reason, origin))
        if room is None or reason in _NOT_FAILURES:
            return
        if self.conn.execute("SELECT 1 FROM room_reply_intents WHERE origin_message_id=?", (origin,)).fetchone() or \
                self.conn.execute("SELECT 1 FROM room_exchange_turns WHERE origin_message_id=?", (origin,)).fetchone():
            return
        with self.conn:
            for member in self.fallback(room):
                self.conn.execute("INSERT OR IGNORE INTO room_reply_intents(origin_message_id,source_message_id,recipient_id,"
                                  "recipient_name,state,reason) VALUES (?,?,?,?,'blocked',?)",
                                  (origin, origin, member, self.name(member), reason))

    def failure(self, turn_id):
        """Why a member's reply did not finish, as the room's status line names it: the CLI loop's named kind, an API
        brain's limit, "stalled" for one that stopped making progress, else "worker"."""
        row = self.conn.execute("SELECT reason FROM worker_tasks WHERE turn_id=? ORDER BY id DESC LIMIT 1", (turn_id,)).fetchone()
        reason = str(row[0]) if row and row[0] else ''
        return reason if reason.startswith('cli_') or reason in _NAMED else 'stalled' if reason in _STALLED else 'worker'

    def breaker(self, room_id, thread_id):
        """Whether the thread's latest replies, since the owner last wrote in it, were a run of failures of one cause: None,
        or (cause, count, reason of the newest) with cause "overflow" (the model cannot read what it was given), "provider"
        (the model or its service failed) or "handoff" (the hand-offs the replies made were refused). Read from the replies
        themselves, so it holds across a restart and ends only when the owner writes in the thread again."""
        last = self.conn.execute("SELECT COALESCE(MAX(id),0) FROM room_messages WHERE room_id=? AND thread_id=? AND member_id IS NULL",
                                 (room_id, thread_id)).fetchone()[0]
        rows = self.conn.execute(
            "SELECT x.turn_id, x.state, m.id AS message_id, (SELECT reason FROM room_reply_intents i WHERE i.turn_id=x.turn_id "
            "AND i.state='blocked' LIMIT 1) AS reason FROM room_exchange_turns x JOIN room_messages m ON m.turn_id=x.turn_id "
            "WHERE m.room_id=? AND m.thread_id=? AND m.id>? AND x.state IN ('done','blocked') ORDER BY x.turn_id DESC LIMIT ?",
            (room_id, thread_id, last, BREAKER_LOOK)).fetchall()
        cause, count, newest = None, 0, ''
        for row in rows:
            if row['state'] == 'blocked':
                reason = row['reason'] or 'worker'
                if reason in _NOT_A_CAUSE:
                    continue
                this = 'overflow' if reason in ('context_overflow', 'cli_context_overflow') else 'provider'
            else:
                message = self.rooms._message(self.conn.execute('SELECT * FROM room_messages WHERE id=?', (row['message_id'],)).fetchone())
                if is_pass(message['text']):
                    continue
                steps = [step[0] for step in self.conn.execute("SELECT outcome FROM agent_steps WHERE turn_id=? AND tool='handoff'", (row['turn_id'],))]
                if not steps or 'ok' in steps:
                    break
                reason, this = 'worker', 'handoff'
            if cause not in (None, this):
                break
            cause, count, newest = this, count + 1, newest or reason
        return (cause, count, newest) if cause and count >= BREAKER_FAILURES else None

    def owner_addressed(self, turn_id):
        """Whether the owner addressed this reply's member by name (an @ or a reply to its message): such a member answers
        or says why it cannot, and may not pass."""
        return bool(self.conn.execute("SELECT 1 FROM room_reply_intents i JOIN room_messages m ON m.id=i.source_message_id "
                                      "WHERE i.turn_id=? AND m.member_id IS NULL", (turn_id,)).fetchone())

    def name(self, member):
        speaker = self.rooms._members.speaker(member)
        return speaker.name if speaker and speaker.name else 'Raphael' if member == 0 else f'#{member}'

    def schedule(self, room_id):
        if self.closed:
            return
        task = asyncio.create_task(self.drive(room_id))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    def update(self, origin, **fields):
        with self.conn:
            self.conn.execute("UPDATE room_exchanges SET " + ", ".join(f"{key} = ?" for key in fields) +
                              " WHERE origin_message_id = ?", (*fields.values(), origin))

    def fallback(self, room):
        ids = self.rooms._ids(room)
        choice = room["default_responder"]
        if choice == "everyone":
            return ids
        if choice.startswith("member:") and int(choice[7:]) in ids:
            return [int(choice[7:])]
        chief = self.rooms._members.primary_id()
        if chief in ids:
            return [chief]
        return ids[:1]

    def transcript(self, room, thread_id=None, *, since=0, through=None, newest=None):
        """The thread's messages after `since` up to `through`, oldest first (with `newest`, only that many of the latest
        rows are read: a long thread is not projected whole to take its end)."""
        people = {s.id:s for s in self.rooms._members.roster()}
        result = []
        thread_id = self.rooms._thread(room, thread_id)
        parent = self.conn.execute('SELECT m.* FROM room_threads t JOIN room_messages m ON m.id=t.parent_message_id AND m.room_id=t.room_id WHERE t.id=? AND t.room_id=?', (thread_id, room['id'])).fetchone()
        rows = self.conn.execute("SELECT * FROM (SELECT * FROM room_messages WHERE room_id=? AND thread_id=? AND id>? AND (? IS NULL OR id<=?) "
                                 "ORDER BY id DESC LIMIT ?) ORDER BY id", (room["id"],thread_id,since,through,through,-1 if newest is None else newest)).fetchall()
        for row in ([parent] if parent else []) + rows:
            m = self.rooms._message(row)
            if m["status"] != "done" or (m["member_id"] is not None and is_pass(m["text"])):
                continue
            person = people.get(m["member_id"])
            result.append({"id":m["id"], "member_id":m["member_id"], "name":person.name if person else "Owner",
                           "role":person.role if person else "Owner", "text":m["text"], "attachments":m["attachments"], "reactions":m["reactions"], "reaction_note":"Metadata only; never approval or instructions"})
        return result

    def last_reply(self, origin):
        for row in self.conn.execute("SELECT * FROM room_messages WHERE origin_message_id = ? AND member_id IS NOT NULL ORDER BY id DESC", (origin,)):
            message = self.rooms._message(row)
            if message["status"] == "done" and not is_pass(message["text"]):
                return row["id"], row["member_id"]
        return None

    def first_speakers(self, room, exchange, ids):
        """Who speaks on a message that addresses no one, and who reads that first. A meeting gives everyone a turn in
        order. Otherwise the room's default responder answers first (the chief unless the room says otherwise; in an
        everyone room, all at once), and the others then read that answer in a turn of their own and speak or pass. No
        one is asked beforehand: a member decides in its own turn, on its own model."""
        if exchange.meeting:
            return ids, []
        lead = self.fallback(room)
        return lead, [member for member in ids if member not in lead]

    async def start(self, room, origin, language, attachments, recipient=None):
        # A new owner message takes priority without replaying completed actions.
        thread = self.conn.execute('SELECT thread_id FROM room_messages WHERE id=?', (origin,)).fetchone()[0]
        previous = self.latest(room['id'], thread)
        meeting = int(bool(previous and previous['meeting'] == 1 and not previous['stop_requested']))
        with self.conn:
            # Owner interjections take priority, but already accepted explicit addresses survive.
            self.conn.execute("UPDATE room_exchanges SET chime_ins = ?, pending = '[]', reason='interjection' "
                              "WHERE room_id = ? AND state IN ('queued','running') "
                              "AND origin_message_id IN (SELECT id FROM room_messages WHERE thread_id=?)", (MAX_ROUNDS, room["id"],thread))
            self.conn.execute("INSERT INTO room_exchanges (origin_message_id, room_id, state, language, pending, meeting) "
                              "VALUES (?, ?, 'queued', ?, ?, ?)",
                              (origin, room["id"], language, json.dumps([{"member":recipient,"reply_to_member":None,
                               "reply_to":origin,"handoff":False}]) if recipient is not None else None, meeting))
        text = self.conn.execute("SELECT text FROM room_messages WHERE id=?", (origin,)).fetchone()[0]
        targets = list(dict.fromkeys(
            ([recipient] if recipient is not None else []) + self.rooms._targets(room, text)))
        self.intents(origin, origin, targets)
        if targets:
            self.update(origin, pending="[]")
        if meeting and not targets and recipient is None:
            self.update(origin, pending=json.dumps([{'member':member,'reply_to':None,'reply_to_member':None,'handoff':False}
                                                   for member in self.rooms._ids(room)]))
        self.attachments[origin] = attachments
        await self.drive(room["id"])

    def arrived(self, turn_id):
        row = self.conn.execute("SELECT room_id FROM room_messages WHERE turn_id = ? AND origin_message_id IS NOT NULL", (turn_id,)).fetchone()
        if row and not self.closed:
            self.schedule(row[0])

    async def wait_idle(self):
        while self.tasks:
            pending = [task for task in self.tasks if not task.done()]
            self.tasks.difference_update(task for task in list(self.tasks) if task.done())
            if pending:
                await asyncio.gather(*pending)

    async def close(self):
        self.closed = True
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*list(self.tasks), return_exceptions=True)

    def stop(self, room_id, thread_id=None):
        with self.conn:
            self.conn.execute("UPDATE room_reply_intents SET state='blocked', reason='owner' WHERE state IN ('queued','running') "
                              "AND origin_message_id IN (SELECT e.origin_message_id FROM room_exchanges e JOIN room_messages m ON m.id=e.origin_message_id WHERE e.room_id=? AND (? IS NULL OR m.thread_id=?))", (room_id,thread_id,thread_id))
            self.conn.execute("UPDATE room_exchanges SET stop_requested = 1, pending = '[]', reason = 'owner' "
                              "WHERE room_id = ? AND state IN ('queued','running') AND (? IS NULL OR origin_message_id IN (SELECT id FROM room_messages WHERE thread_id=?))", (room_id,thread_id,thread_id))

    def digest(self, room_id, message_id, language='en'):
        """One report/post can request one digest round, never an owner interjection."""
        with self.conn:
            inserted = self.conn.execute('INSERT OR IGNORE INTO room_digest_requests VALUES (?)', (message_id,)).rowcount
            if not inserted:
                return
            self.conn.execute("INSERT OR IGNORE INTO room_exchanges(origin_message_id,room_id,state,language,meeting) "
                              "VALUES (?,?,'queued',?,2)", (message_id,room_id,language))
        message = self.conn.execute('SELECT member_id,text FROM room_messages WHERE id=?', (message_id,)).fetchone()
        room = self.rooms._view(self.conn.execute('SELECT * FROM rooms WHERE id=?', (room_id,)).fetchone())
        self.intents(message_id, message_id, [member for member in self.rooms._targets(room, message['text'])
                                            if member != message['member_id']])
        self.schedule(room_id)

    def _settle(self, exchange, room):
        active = False
        for row in self.conn.execute("SELECT * FROM room_exchange_turns WHERE origin_message_id=? AND state='running'",
                                     (exchange.origin_message_id,)).fetchall():
            turn = self.rooms._history.get(row['turn_id'])
            if turn and turn.status == 'running':
                active = True
                continue
            message = self.conn.execute('SELECT * FROM room_messages WHERE turn_id=?', (row['turn_id'],)).fetchone()
            failure = 'source_unavailable' if not turn or not message else None
            projected = self.rooms._message(message) if message else None
            if turn and turn.status != 'done':
                failure = 'owner' if exchange.stop_requested else self.failure(turn.id)
            if row['member_id'] not in self.rooms._ids(room):
                failure = 'revoked'
            if projected and projected['status'] == 'incomplete':
                failure = projected['reason']
            if (not failure and is_pass(projected['text']) and self.owner_addressed(row['turn_id'])
                    and not self.conn.execute('SELECT 1 FROM worker_tasks WHERE source_turn_id=?', (row['turn_id'],)).fetchone()):
                # The owner named this member, and it passed without starting any work: no answer, and the room says so.
                failure = 'no_reply'
            if failure and failure not in _NOT_FAILURES:
                # Only the kind: the provider's or the CLI's own words stay with the task's private record.
                logger.warning('Room reply did not finish: room=%s member=%s reason=%s', room['id'], row['member_id'], failure)
            recipients = []
            if not failure and message['kind'] != 'wrapup' and not exchange.stop_requested and not is_pass(projected['text']):
                for recipient in self.rooms._targets(room, projected['text']):
                    if recipient == row['member_id']:
                        continue
                    count = self.conn.execute("SELECT COUNT(*) FROM room_reply_intents i JOIN room_messages m ON m.id=i.source_message_id "
                        "WHERE i.origin_message_id=? AND m.member_id=? AND i.recipient_id=?",
                        (exchange.origin_message_id,row['member_id'],recipient)).fetchone()[0]
                    if count < MAX_PAIR_REPLIES:
                        recipients.append(recipient)
            with self.conn:
                for recipient in recipients:
                    self.conn.execute('INSERT OR IGNORE INTO room_reply_intents(origin_message_id,source_message_id,recipient_id,recipient_name) VALUES (?,?,?,?)',
                                      (exchange.origin_message_id,message['id'],recipient,self.name(recipient)))
                self.conn.execute("UPDATE room_exchange_turns SET state=? WHERE turn_id=?", ('blocked' if failure else 'done',row['turn_id']))
                self.conn.execute("UPDATE room_reply_intents SET state=?,reason=? WHERE turn_id=? AND state='running'",
                                  ('blocked' if failure else 'done',failure or '',row['turn_id']))
                if message:
                    self.conn.execute('UPDATE room_messages SET exchange_settled=1 WHERE id=?', (message['id'],))
                if not failure and message:
                    self.conn.execute("INSERT INTO room_member_cursor VALUES (?,?,?,?) ON CONFLICT(room_id,thread_id,member_id) "
                        "DO UPDATE SET seen_message_id=MAX(seen_message_id,excluded.seen_message_id)",
                        (room['id'],message['thread_id'],row['member_id'],row['seen_through']))
                if failure and message and not self.conn.execute('SELECT 1 FROM room_reply_intents WHERE turn_id=?',(row['turn_id'],)).fetchone():
                    self.conn.execute("INSERT INTO room_reply_intents(origin_message_id,source_message_id,recipient_id,recipient_name,state,reason,turn_id) "
                        "VALUES (?,?,?,?,'blocked',?,?)", (exchange.origin_message_id,message['id'],row['member_id'],self.name(row['member_id']),failure,row['turn_id']))
            if turn:
                current = self.get(exchange.origin_message_id)
                self.update(exchange.origin_message_id,cost=current.cost+turn.cost_usd,
                            spoken=json.dumps(sorted(set(json.loads(current.spoken)) | {row['member_id']})))
        self.update(exchange.origin_message_id,active_turn=None)
        return active

    async def drive(self, room_id):
        async with self.locks.setdefault(room_id, asyncio.Lock()):
            # Settle all exchanges; a slow snapshot must not hide newer owner input.
            for row in self.conn.execute("SELECT * FROM room_exchanges WHERE room_id=? AND state IN ('queued','running') "
                                         "ORDER BY origin_message_id", (room_id,)).fetchall():
                if self.closed:
                    return
                exchange = self.get(row['origin_message_id'])
                room_row = self.conn.execute('SELECT * FROM rooms WHERE id=?',(room_id,)).fetchone()
                if not room_row:
                    return
                room = self.rooms._view(room_row)
                if self._settle(exchange, room):
                    continue
                exchange = self.get(exchange.origin_message_id)
                thread = self.conn.execute('SELECT thread_id FROM room_messages WHERE id=?', (exchange.origin_message_id,)).fetchone()[0]
                if (tripped := self.breaker(room_id, thread)) is not None:
                    # A run of failures of one cause: no one is asked again until the owner writes here. The room says so once.
                    self.block(exchange.origin_message_id, tripped[2], room)
                    self.update(exchange.origin_message_id, state='stopped', pending='[]', reason='circuit_open')
                    self.rooms._breaker_notice(room, thread, exchange.origin_message_id, exchange.language, *tripped[:2])
                    continue
                cap = float(self.rooms._settings.get('worker_cost_cap_usd'))
                reason = ('membership' if room['membership_state'] != 'ready' else exchange.reason if exchange.stop_requested
                          else 'cost' if exchange.cost >= cap or self.spend.is_over(self.rooms._settings.get('monthly_limit_usd')) else '')
                if reason:
                    self.block(exchange.origin_message_id,reason,room)
                    self.update(exchange.origin_message_id,state='stopped',pending='[]',reason=reason)
                    continue
                ids = self.rooms._ids(room)
                pending = [p for p in json.loads(exchange.pending or '[]') if not p.get('round')]
                later = []
                intents = self.conn.execute("SELECT * FROM room_reply_intents WHERE origin_message_id=? AND state='queued' ORDER BY id",
                                            (exchange.origin_message_id,)).fetchall()
                if exchange.pending is None and (exchange.meeting or not intents):
                    lead, others = self.first_speakers(room,exchange,ids)
                    pending = [{'member':i,'reply_to':None,'reply_to_member':None,'handoff':False,'lead':not exchange.meeting} for i in lead]
                    # They read the default responder's answer first, in the next round.
                    later = [{'member':i,'reply_to':None,'reply_to_member':None,'handoff':False} for i in others]
                for intent in intents:
                    if intent['recipient_id'] not in ids:
                        with self.conn:
                            self.conn.execute("UPDATE room_reply_intents SET state='blocked',reason='revoked' WHERE id=?",(intent['id'],))
                        continue
                    source = self.conn.execute('SELECT member_id FROM room_messages WHERE id=?',(intent['source_message_id'],)).fetchone()
                    pending.append({'member':intent['recipient_id'],'reply_to':intent['source_message_id'],
                                    'reply_to_member':source[0] if source else None,'handoff':bool(source and source[0] is not None),
                                    'intent_id':intent['id'],'required':bool(source and source[0] is None)})
                # One turn answers everyone who addressed a member; the owner's address among them makes it required.
                required = {p['member'] for p in pending if p.get('required')}
                pending = [{**p,'required':p['member'] in required} for p in {p['member']:p for p in pending if p['member'] in ids}.values()]
                current = self.get(exchange.origin_message_id)
                if current.stop_requested or current.cost >= cap or self.spend.is_over(self.rooms._settings.get('monthly_limit_usd')):
                    self.block(exchange.origin_message_id,'owner' if current.stop_requested else 'cost',room)
                    self.update(exchange.origin_message_id,state='stopped',reason='owner' if current.stop_requested else 'cost',pending='[]')
                    continue
                if current.reason == 'interjection':
                    pending, later = [p for p in pending if p.get('intent_id')], []
                rounds = self.conn.execute('SELECT COALESCE(MAX(round),0) FROM room_exchange_turns WHERE origin_message_id=?',
                                           (exchange.origin_message_id,)).fetchone()[0]
                # Everyone in a large room still reads a message once; the bound is on what follows.
                turn_cap = max(MAX_TURNS, len(ids))
                # Meeting turns are serial: each speaker consumes one round, including follow-ups.
                round_cap = turn_cap if exchange.meeting else MAX_ROUNDS
                if not pending or rounds >= round_cap or current.turns_taken >= turn_cap:
                    capped = bool(pending)
                    if capped:
                        self.block(exchange.origin_message_id,'reply_budget')
                    blocked = self.conn.execute("SELECT 1 FROM room_reply_intents WHERE origin_message_id=? AND state='blocked'",
                                                (exchange.origin_message_id,)).fetchone()
                    self.update(exchange.origin_message_id,state='stopped' if blocked else 'done',pending='[]',
                                reason='reply_budget' if capped else 'blocked_intents' if blocked else current.reason)
                    self.attachments.pop(exchange.origin_message_id,None)
                    self.rooms._changed(room_id)
                    continue
                origin = self.conn.execute('SELECT thread_id FROM room_messages WHERE id=?',(exchange.origin_message_id,)).fetchone()
                seen = self.conn.execute('SELECT COALESCE(MAX(id),0) FROM room_messages WHERE room_id=? AND thread_id=?',
                                         (room_id,origin[0])).fetchone()[0]
                # Freeze public board, decisions and the delta before submitting any speaker.
                public = self.rooms.speech_context(room_id,origin[0],seen)
                selected = pending[:1] if exchange.meeting else pending[:turn_cap-current.turns_taken]
                remaining = (pending[1:] if exchange.meeting else []) + later
                self.update(exchange.origin_message_id,state='running',pending=json.dumps(remaining),chime_ins=rounds+1)
                for target in selected:
                    try:
                        turn = self.rooms._submit_exchange_turn(room,current,{**target,'seen_through':seen,'public':public},'message',
                                                                self.attachments.get(exchange.origin_message_id,()))
                    except RpcError:
                        self.block(exchange.origin_message_id,'source_unavailable',room)
                        self.update(exchange.origin_message_id,state='stopped',reason='source_unavailable')
                        break
                    with self.conn:
                        self.conn.execute('INSERT INTO room_exchange_turns(origin_message_id,turn_id,member_id,round,seen_through) VALUES (?,?,?,?,?)',
                                          (exchange.origin_message_id,turn,target['member'],rounds+1,seen))
                    self.update(exchange.origin_message_id,turns_taken=self.get(exchange.origin_message_id).turns_taken+1,
                                hops=self.get(exchange.origin_message_id).hops+int(target.get('handoff',False)))
                self.rooms._changed(room_id)
                if not self.conn.execute("SELECT 1 FROM room_exchange_turns x JOIN agent_turns t ON t.id=x.turn_id "
                                         "WHERE x.origin_message_id=? AND x.state='running' AND t.status='running'",(exchange.origin_message_id,)).fetchone():
                    self.schedule(room_id)
            self.rooms._close_stopped(room_id)
            if not self.conn.execute("SELECT 1 FROM room_exchanges WHERE room_id=? AND state IN ('queued','running')", (room_id,)).fetchone():
                # The discussion rests: what has fallen out of the members' recent window is folded into the thread's summary.
                for thread in self.conn.execute("SELECT id FROM room_threads WHERE room_id=?", (room_id,)).fetchall():
                    self.rooms.summaries.schedule(room_id, thread[0])

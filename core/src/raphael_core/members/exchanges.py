"""Bounded meeting rounds: members choose to speak on one shared snapshot.

Speech uses the shared worker with a separate admission pool. Durable private work
returns through report cards; no member dispatches another member's speech.
"""
import asyncio
import json
import logging
import re
from dataclasses import dataclass

from ..memory.compression import FRESH_CONTEXT_CHARS, recent_turns
from ..agent.ledger import Ledger
from ..brain.spend import SpendTracker
from ..brain.settings import DEFAULTS
from ..protocol import RpcError
from ..worker.guards import neutralize

# Safety bounds apply to colleague chatter, including repeated mention pairs.
MAX_TURNS = 10
MAX_HOPS = 3
MAX_ROUNDS = 3
MAX_PAIR_REPLIES = 2
# How long a member takes to read the room; one who takes longer stays quiet this time.
LISTEN_TIMEOUT_S = 20.0
# Bound the listener's recent public context; speech itself reads its cursor delta.
LISTEN_MESSAGES = 40
# Leave room for the task wrapper, recovery receipts and the member's system prompt.
ROOM_CONTEXT_CHARS = FRESH_CONTEXT_CHARS - 4000
logger = logging.getLogger(__name__)


def bounded_transcript(transcript, *, chars=ROOM_CONTEXT_CHARS, byte_limit=ROOM_CONTEXT_CHARS, required=()):
    """Fold older records out of the prompt; preserve the source and newest messages whole."""
    if not transcript:
        return [], 0
    required = {*required, transcript[-1]["id"]}
    encoded = [(item["id"], neutralize(json.dumps(item, ensure_ascii=False))) for item in transcript]
    mandatory = [text for identifier, text in encoded if identifier in required]
    chars -= 2 + sum(len(text) + 2 for text in mandatory)
    byte_limit -= 2 + sum(len(text.encode("utf-8")) + 2 for text in mandatory)
    kept = required | {identifier for identifier, _ in recent_turns(
        [(identifier, text) for identifier, text in encoded if identifier not in required], chars, byte_limit)}
    result = [item for item in transcript if item["id"] in kept]
    return result, len(transcript) - len(result)


def is_pass(text):
    return not text.strip() or bool(re.fullmatch(r"[(（]?\s*pass\s*[)）]?[.。]?", text.strip(), re.IGNORECASE))


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
    def __init__(self, rooms, decision=None):
        self.rooms, self.conn, self.decision = rooms, rooms._conn, decision
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

    def block(self, origin, reason):
        with self.conn:
            self.conn.execute("UPDATE room_reply_intents SET state='blocked', reason=? "
                              "WHERE origin_message_id=? AND state IN ('queued','running')", (reason, origin))

    def failure(self, turn_id):
        """Why a member's reply did not finish: the CLI loop's named kind, else "worker"."""
        row = self.conn.execute("SELECT reason FROM worker_tasks WHERE turn_id=? ORDER BY id DESC LIMIT 1", (turn_id,)).fetchone()
        return row[0] if row and str(row[0]).startswith('cli_') else 'worker'

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

    def transcript(self, room, thread_id=None, *, since=0, through=None):
        people = {s.id:s for s in self.rooms._members.roster()}
        result = []
        thread_id = self.rooms._thread(room, thread_id)
        parent = self.conn.execute('SELECT m.* FROM room_threads t JOIN room_messages m ON m.id=t.parent_message_id AND m.room_id=t.room_id WHERE t.id=? AND t.room_id=?', (thread_id, room['id'])).fetchone()
        rows = self.conn.execute("SELECT * FROM room_messages WHERE room_id=? AND thread_id=? AND id>? AND (? IS NULL OR id<=?) ORDER BY id", (room["id"],thread_id,since,through,through)).fetchall()
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

    async def _heard(self, speaker, model, colleagues, transcript, ledger, unanswered):
        """What one member decided: whether it speaks, how much that matters, and why it could not say, if so."""
        failures = []
        for attempt in range(2):
            try:
                listener = self.rooms._background.room_listener if model.startswith('cli:') else self.decision.room_listener
                answer = await asyncio.wait_for(listener(
                    member={"id":speaker.id,"name":speaker.name or 'Raphael', "role":speaker.role, "personality":speaker.personality},
                    colleagues=colleagues, transcript=transcript, model=model if model.startswith('cli:') else model.split('?effort=')[0],
                    ledger=ledger, unanswered=unanswered), LISTEN_TIMEOUT_S)
                if (not isinstance(answer, dict) or type(answer.get('speak')) is not bool
                        or type(answer.get('urgency')) not in (int, float)):
                    raise ValueError('invalid_listener_result')
                break
            except Exception as error:
                data = getattr(error, 'data', None)
                kind = ('timeout' if isinstance(error, TimeoutError) else
                        data.get('kind') if isinstance(data, dict) else type(error).__name__)
                kind = re.sub(r'[^a-zA-Z0-9_]', '_', str(kind))[:64]
                failures.append(kind)
                logger.warning('Room listener failed: member=%s kind=%s attempt=%d', speaker.id, kind, attempt + 1)
        else:
            return {"member":speaker.id, "speak":False, "urgency":0, "failure":failures[-1], "failures":failures}
        urgency = answer.get("urgency")
        return {"member":speaker.id, "speak":answer.get("speak") is True,
                "urgency":urgency if type(urgency) in (int, float) else 0, "failure":"", "failures":failures}

    async def listen(self, room, exchange, candidates, *, first=False, unanswered=False):
        """Everyone in `candidates` reads the room and decides for themselves, each on their own model. Returns those who will
        speak, whoever cares most first, and whether anyone could be heard at all.
        CLI members decide through their own bounded, tool-less listener on the same speech pool."""
        if not self.decision or self.spend.is_over(self.rooms._settings.get("monthly_limit_usd")):
            return [], False
        origin = self.conn.execute("SELECT thread_id FROM room_messages WHERE id=? AND room_id=?",
                                   (exchange.origin_message_id, room['id'])).fetchone()
        if origin is None:
            return [], False
        transcript, _ = bounded_transcript(self.transcript(room, origin['thread_id'])[-LISTEN_MESSAGES:],
                                            chars=8000, byte_limit=8000)
        people = [s for s in self.rooms._members.roster() if s.id in self.rooms._ids(room)]
        default = self.rooms._settings.get("agent_model") or DEFAULTS["agent_model"]
        asked, themselves = [], []
        for speaker in people:
            if speaker.id in candidates:
                # The roster is only who is who; a member's model is on the member itself.
                model = self.rooms._members.speaker(speaker.id).model or default
                if self.decision.can_ask(model) or model.startswith("cli:") and hasattr(self.rooms._background,"room_listener"):
                    asked.append((speaker, model))
                elif first:
                    # No secondary model chooses for a CLI member. It reads the same snapshot
                    # in its own bounded speech turn and decides to speak or pass.
                    themselves.append(speaker.id)
        ledger = Ledger(self.spend)
        ledger.job = "listen"
        heard = await asyncio.gather(*(self._heard(speaker, model,
            [{"name":s.name or 'Raphael', "role":s.role} for s in people if s.id != speaker.id], transcript, ledger, unanswered)
            for speaker, model in asked))
        speaking = [one["member"] for one in sorted(heard, key=lambda one: -one["urgency"]) if one["speak"]]
        current = self.get(exchange.origin_message_id)
        if current:
            previous = json.loads(current.routing)
            listened = {one['member']: one for one in previous.get('listened', [])}
            listened.update((one['member'], one) for one in heard)
            self.update(current.origin_message_id, cost=current.cost + ledger.total,
                        routing=json.dumps({"listened":list(listened.values()), "themselves":themselves, "fallback":""}))
            for one in heard:
                if one['failure']:
                    self.intents(current.origin_message_id, current.origin_message_id, [one['member']])
                    with self.conn:
                        self.conn.execute("UPDATE room_reply_intents SET state='blocked',reason=? WHERE origin_message_id=? "
                            "AND recipient_id=? AND state='queued'", ('listener_' + one['failure'], current.origin_message_id, one['member']))
        return speaking + themselves, bool(themselves) or any(not one["failure"] for one in heard)

    async def first_speakers(self, room, exchange, ids):
        """Who speaks on an owner's message that addresses no one. If no one can be heard, the room's saved default, which the
        room says. If everyone stays quiet, the chief of staff still does not leave a request unanswered; thanks get nothing."""
        if exchange.meeting:
            return ids, False
        if room["default_responder"] != "auto":
            failed = {one['member'] for one in json.loads(self.get(exchange.origin_message_id).routing).get('listened', []) if one['failure']}
            return [member for member in self.fallback(room) if member not in failed], False
        speaking, heard = await self.listen(room, exchange, ids, first=True)
        if speaking:
            self.update(exchange.origin_message_id, chime_ins=1)
            return speaking, False
        if not heard:
            current = self.get(exchange.origin_message_id)
            if current:
                self.update(current.origin_message_id, routing=json.dumps({**json.loads(current.routing), "fallback":"unavailable"}))
            failed = {one['member'] for one in json.loads(self.get(exchange.origin_message_id).routing).get('listened', []) if one['failure']}
            return [member for member in self.fallback(room) if member not in failed], False
        self.update(exchange.origin_message_id, chime_ins=MAX_ROUNDS)
        chief = self.rooms._members.primary_id()
        failed = {one['member'] for one in json.loads(self.get(exchange.origin_message_id).routing).get('listened', []) if one['failure']}
        if chief not in ids or chief in failed:
            return [], False
        speaking, _ = await self.listen(room, exchange, [chief], first=True, unanswered=True)
        return speaking, True

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
                cap = float(self.rooms._settings.get('worker_cost_cap_usd'))
                reason = ('membership' if room['membership_state'] != 'ready' else exchange.reason if exchange.stop_requested
                          else 'cost' if exchange.cost >= cap or self.spend.is_over(self.rooms._settings.get('monthly_limit_usd')) else '')
                if reason:
                    self.block(exchange.origin_message_id,reason)
                    self.update(exchange.origin_message_id,state='stopped',pending='[]',reason=reason)
                    continue
                ids = self.rooms._ids(room)
                pending = [p for p in json.loads(exchange.pending or '[]') if not p.get('round')]
                intents = self.conn.execute("SELECT * FROM room_reply_intents WHERE origin_message_id=? AND state='queued' ORDER BY id",
                                            (exchange.origin_message_id,)).fetchall()
                if exchange.pending is None and (exchange.meeting or not intents):
                    chosen, unanswered = await self.first_speakers(room,exchange,ids)
                    pending = [{'member':i,'reply_to':None,'reply_to_member':None,'handoff':False,'unanswered':unanswered} for i in chosen]
                for intent in intents:
                    if intent['recipient_id'] not in ids:
                        with self.conn:
                            self.conn.execute("UPDATE room_reply_intents SET state='blocked',reason='revoked' WHERE id=?",(intent['id'],))
                        continue
                    source = self.conn.execute('SELECT member_id FROM room_messages WHERE id=?',(intent['source_message_id'],)).fetchone()
                    pending.append({'member':intent['recipient_id'],'reply_to':intent['source_message_id'],
                                    'reply_to_member':source[0] if source else None,'handoff':bool(source and source[0] is not None),'intent_id':intent['id']})
                pending = list({p['member']:p for p in pending if p['member'] in ids}.values())
                current = self.get(exchange.origin_message_id)
                if current.stop_requested or current.cost >= cap or self.spend.is_over(self.rooms._settings.get('monthly_limit_usd')):
                    self.block(exchange.origin_message_id,'owner' if current.stop_requested else 'cost')
                    self.update(exchange.origin_message_id,state='stopped',reason='owner' if current.stop_requested else 'cost',pending='[]')
                    continue
                if current.reason == 'interjection':
                    pending = [p for p in pending if p.get('intent_id')]
                rounds = self.conn.execute('SELECT COALESCE(MAX(round),0) FROM room_exchange_turns WHERE origin_message_id=?',
                                           (exchange.origin_message_id,)).fetchone()[0]
                turn_cap = max(MAX_TURNS, len(ids)) if exchange.meeting else MAX_TURNS
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
                remaining = pending[1:] if exchange.meeting else []
                self.update(exchange.origin_message_id,state='running',pending=json.dumps(remaining),chime_ins=rounds+1)
                for target in selected:
                    try:
                        turn = self.rooms._submit_exchange_turn(room,current,{**target,'seen_through':seen,'public':public},'message',
                                                                self.attachments.get(exchange.origin_message_id,()))
                    except RpcError:
                        self.block(exchange.origin_message_id,'source_unavailable')
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

"""Room exchanges: everyone reads every message and decides for themselves whether to speak. No one hands out the floor.

Those with something to say speak one at a time, each reading what the one before said; then everyone reads
again, until no one has more to say. An address is always answered. All member turns use the background worker;
only this orchestration state is new, and personas, tool approvals and capability checks stay in that worker.
"""
import asyncio
import json
import re
from dataclasses import dataclass

from ..agent.ledger import Ledger
from ..brain.spend import SpendTracker
from ..brain.settings import DEFAULTS
from ..protocol import RpcError

# What bounds the members talking among themselves unasked: the turns of one slice of discussion, the hand-offs and how many
# times the room is read after a message (kept in the column `chime_ins`). They never bound an address: a colleague named in a
# reply (or the owner's message) is owed a reply (`room_reply_intents`), however many turns and hops there have been, and a slice
# that is full goes on by itself. Grok Bot's documentation has no such numbers; these are only how far chatter goes.
MAX_TURNS = 6
MAX_HOPS = 3
MAX_ROUNDS = 3
# How long a member takes to read the room; one who takes longer stays quiet this time.
LISTEN_TIMEOUT_S = 20.0
# What a member reads of the room to decide; the turn itself reads all of it.
LISTEN_MESSAGES = 40


def is_pass(text):
    return not text.strip() or bool(re.fullmatch(r"[(（]?\s*pass\s*[)）]?[.。]?", text.strip(), re.IGNORECASE))


def seat(plan, member, moderator):
    """Where a member's turn sits in a moderated meeting, and the plan once that turn has taken its seat.

    A round is open once its moderator entry is gone. The moderator's turn opens the next round; a
    speaker's turn in an open round takes their place in it, whoever addressed them; any other turn is
    an aside. Without rounds left, the moderator closes and everyone else only answers."""
    rounds = [entry for entry in plan if entry.get('round')]
    if not rounds:
        return plan, {'phase': 'close' if member == moderator else 'after', 'moderator': moderator}
    head = rounds[0]
    number, between = head['round'], head['member'] == moderator
    if member == moderator:
        taken = head if between else None
    else:
        taken = None if between else next((e for e in rounds if e['round'] == number and e['member'] == member), None)
    rest = [entry for entry in plan if entry is not taken]
    still = [e['member'] for e in rest if e.get('round') == number and e['member'] != moderator]
    phase = ('open' if taken else 'floor') if member == moderator else ('turn' if taken else 'aside')
    return rest, {'phase': phase, 'round': number, 'still': still, 'moderator': moderator, 'between': between}


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
        # Never replay an uncertain in-flight worker; retain its named intent for reconciliation.
        with self.conn:
            self.conn.execute("UPDATE room_reply_intents SET state='blocked', reason='restart' WHERE state='running' "
                              "AND (turn_id IS NULL OR turn_id IN (SELECT id FROM agent_turns WHERE status!='done'))")
            self.conn.execute("UPDATE room_exchanges SET state='stopped', reason='restart' WHERE active_turn IN "
                              "(SELECT id FROM agent_turns WHERE status!='done') AND state IN ('queued','running')")
            self.conn.execute("UPDATE room_reply_intents SET state='blocked', reason='restart' WHERE state='queued' "
                              "AND origin_message_id IN (SELECT origin_message_id FROM room_exchanges WHERE reason='restart')")

    def get(self, origin):
        row = self.conn.execute("SELECT * FROM room_exchanges WHERE origin_message_id = ?", (origin,)).fetchone()
        return Exchange(**dict(row)) if row else None

    def latest(self, room_id):
        row = self.conn.execute("SELECT * FROM room_exchanges WHERE room_id = ? "
                                "ORDER BY (state IN ('queued','running')) DESC, origin_message_id DESC LIMIT 1", (room_id,)).fetchone()
        if not row:
            return None
        result = dict(row)
        result['routing'] = json.loads(result['routing'])
        result['reply_intents'] = [dict(r) for r in self.conn.execute(
            "SELECT i.* FROM room_reply_intents i JOIN room_exchanges e ON e.origin_message_id=i.origin_message_id "
            "WHERE e.room_id=? AND (i.origin_message_id=? OR i.state='blocked') ORDER BY i.id", (room_id,row['origin_message_id']))]
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

    def transcript(self, room, thread_id=None):
        people = {s.id:s for s in self.rooms._members.roster()}
        result = []
        thread_id = self.rooms._thread(room, thread_id)
        for row in self.conn.execute("SELECT * FROM room_messages WHERE room_id = ? AND thread_id=? ORDER BY id", (room["id"],thread_id)):
            m = self.rooms._message(row)
            if m["status"] != "done" or (m["member_id"] is not None and is_pass(m["text"])):
                continue
            person = people.get(m["member_id"])
            result.append({"id":m["id"], "member_id":m["member_id"], "name":person.name if person else "Owner",
                           "role":person.role if person else "Owner", "text":m["text"], "attachments":m["attachments"]})
        return result

    def last_reply(self, origin):
        for row in self.conn.execute("SELECT * FROM room_messages WHERE origin_message_id = ? AND member_id IS NOT NULL ORDER BY id DESC", (origin,)):
            message = self.rooms._message(row)
            if message["status"] == "done" and not is_pass(message["text"]):
                return row["id"], row["member_id"]
        return None

    async def _heard(self, speaker, model, colleagues, transcript, ledger, unanswered):
        """What one member decided: whether it speaks, how much that matters, and why it could not say, if so."""
        try:
            answer = await asyncio.wait_for(self.decision.room_listener(
                member={"name":speaker.name or 'Raphael', "role":speaker.role, "personality":speaker.personality},
                colleagues=colleagues, transcript=transcript, model=model.split("?effort=")[0],
                ledger=ledger, unanswered=unanswered), LISTEN_TIMEOUT_S)
        except TimeoutError:
            return {"member":speaker.id, "speak":False, "urgency":0, "failure":"timeout"}
        except Exception:
            return {"member":speaker.id, "speak":False, "urgency":0, "failure":"unavailable"}
        urgency = answer.get("urgency")
        return {"member":speaker.id, "speak":answer.get("speak") is True,
                "urgency":urgency if type(urgency) in (int, float) else 0, "failure":""}

    async def listen(self, room, exchange, candidates, *, first=False, unanswered=False):
        """Everyone in `candidates` reads the room and decides for themselves, each on their own model. Returns those who will
        speak, whoever cares most first, and whether anyone could be heard at all. A CLI or local brain takes no small question:
        it reads an owner's message in a real turn and may pass."""
        if not self.decision or self.spend.is_over(self.rooms._settings.get("monthly_limit_usd")):
            return [], False
        origin = self.conn.execute("SELECT thread_id FROM room_messages WHERE id=? AND room_id=?",
                                   (exchange.origin_message_id, room['id'])).fetchone()
        if origin is None:
            return [], False
        transcript = self.transcript(room, origin['thread_id'])[-LISTEN_MESSAGES:]
        people = [s for s in self.rooms._members.roster() if s.id in self.rooms._ids(room)]
        default = self.rooms._settings.get("agent_model") or DEFAULTS["agent_model"]
        asked, themselves = [], []
        for speaker in people:
            if speaker.id in candidates:
                # The roster is only who is who; a member's model is on the member itself.
                model = self.rooms._members.speaker(speaker.id).model or default
                if self.decision.can_ask(model):
                    asked.append((speaker, model))
                elif first:
                    themselves.append(speaker.id)
        ledger = Ledger(self.spend)
        heard = await asyncio.gather(*(self._heard(speaker, model,
            [{"name":s.name or 'Raphael', "role":s.role} for s in people if s.id != speaker.id], transcript, ledger, unanswered)
            for speaker, model in asked))
        speaking = [one["member"] for one in sorted(heard, key=lambda one: -one["urgency"]) if one["speak"]]
        current = self.get(exchange.origin_message_id)
        if current:
            self.update(current.origin_message_id, cost=current.cost + ledger.total,
                        routing=json.dumps({"listened":heard, "themselves":themselves, "fallback":""}))
        return speaking + themselves, bool(themselves) or any(not one["failure"] for one in heard)

    async def first_speakers(self, room, exchange, ids):
        """Who speaks on an owner's message that addresses no one. If no one can be heard, the room's saved default, which the
        room says. If everyone stays quiet, the chief of staff still does not leave a request unanswered; thanks get nothing."""
        if room["default_responder"] != "auto":
            return self.fallback(room), False
        speaking, heard = await self.listen(room, exchange, ids, first=True)
        if speaking:
            self.update(exchange.origin_message_id, chime_ins=1)
            return speaking, False
        if not heard:
            current = self.get(exchange.origin_message_id)
            if current:
                self.update(current.origin_message_id, routing=json.dumps({**json.loads(current.routing), "fallback":"unavailable"}))
            return self.fallback(room), False
        self.update(exchange.origin_message_id, chime_ins=MAX_ROUNDS)
        chief = self.rooms._members.primary_id()
        if chief not in ids:
            return [], False
        speaking, _ = await self.listen(room, exchange, [chief], first=True, unanswered=True)
        return speaking, True

    async def start(self, room, origin, language, attachments, recipient=None):
        # A new owner message takes priority without replaying completed actions.
        with self.conn:
            # Owner interjections take priority, but already accepted explicit addresses survive.
            self.conn.execute("UPDATE room_exchanges SET chime_ins = ?, pending = '[]', reason='interjection' "
                              "WHERE room_id = ? AND state IN ('queued','running')", (MAX_ROUNDS, room["id"]))
            self.conn.execute("INSERT INTO room_exchanges (origin_message_id, room_id, state, language, pending) "
                              "VALUES (?, ?, 'queued', ?, ?)",
                              (origin, room["id"], language, json.dumps([{"member":recipient,"reply_to_member":None,
                               "reply_to":origin,"handoff":False}]) if recipient is not None else None))
        text, request = self.conn.execute("SELECT text, request_id FROM room_messages WHERE id=?", (origin,)).fetchone()
        roles = self.rooms._view(room).get('roles', {})
        moderator = next((int(i) for i, role in roles.items() if role == 'moderator'), None)
        # A meeting's agenda, or the owner's first message after the parts are saved, is a meeting; later messages are not.
        meeting = moderator is not None and bool(str(request or '').startswith('meeting_') or
                   self.conn.execute("SELECT meeting_pending FROM rooms WHERE id=?", (room["id"],)).fetchone()[0])
        # Its rounds give everyone a turn and Raphael the conclusion, so a meeting's addresses are no call to speak
        # first: live, an agenda's 「第二輪結束後 @拉斐爾 作最後結論」 had Raphael talk before the moderator opened.
        targets = [] if meeting else list(dict.fromkeys(
            ([recipient] if recipient is not None else []) + self.rooms._targets(room, text)))
        self.intents(origin, origin, targets)
        if targets:
            self.update(origin, pending="[]")
        if meeting:
            with self.conn:
                self.conn.execute("UPDATE rooms SET meeting_pending=0 WHERE id=?", (room["id"],))
                self.conn.execute("UPDATE room_exchanges SET meeting=1 WHERE origin_message_id=?", (origin,))
            speakers = [moderator] + [i for i in self.rooms._ids(room) if i not in (self.rooms._members.primary_id(), moderator)]
            plan = [{"member":i, "reply_to_member":None, "reply_to":origin, "handoff":False, "round":round_no}
                    for round_no in (1, 2) for i in speakers]
            self.update(origin, pending=json.dumps(plan))
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

    def stop(self, room_id):
        with self.conn:
            self.conn.execute("UPDATE room_reply_intents SET state='blocked', reason='owner' WHERE state='queued' "
                              "AND origin_message_id IN (SELECT origin_message_id FROM room_exchanges WHERE room_id=?)", (room_id,))
            self.conn.execute("UPDATE room_exchanges SET stop_requested = 1, pending = '[]', reason = 'owner' "
                              "WHERE room_id = ? AND state IN ('queued','running')", (room_id,))

    async def drive(self, room_id):
        async with self.locks.setdefault(room_id, asyncio.Lock()):
            while not self.closed:
                row = self.conn.execute("SELECT * FROM room_exchanges WHERE room_id = ? AND state IN ('queued','running') "
                                        "ORDER BY (active_turn IS NULL), origin_message_id DESC LIMIT 1", (room_id,)).fetchone()
                if row is None:
                    self.rooms._close_stopped(room_id)
                    return
                exchange = Exchange(**dict(row))
                room_row = self.conn.execute("SELECT * FROM rooms WHERE id = ?", (room_id,)).fetchone()
                if room_row is None:
                    return
                room = dict(room_row)
                room = self.rooms._view(room)
                if room["membership_state"] != "ready":
                    self.block(exchange.origin_message_id, "revoked")
                    self.update(exchange.origin_message_id, state="stopped", pending="[]", reason="membership")
                    continue
                if exchange.active_turn:
                    turn = self.rooms._history.get(exchange.active_turn)
                    if turn and turn.status == "running":
                        return
                    message = self.conn.execute("SELECT * FROM room_messages WHERE turn_id = ?", (exchange.active_turn,)).fetchone()
                    if not message or not turn:
                        self.block(exchange.origin_message_id, "source_unavailable")
                        self.update(exchange.origin_message_id, state="stopped", active_turn=None, reason="missing_turn")
                        self.attachments.pop(exchange.origin_message_id, None)
                        continue
                    pending = json.loads(exchange.pending or "[]")
                    spoken = set(json.loads(exchange.spoken)) | {message["member_id"]}
                    projected = self.rooms._message(message)
                    if projected['status'] == 'incomplete':
                        self.block(exchange.origin_message_id, projected['reason'])
                        self.update(exchange.origin_message_id,state='stopped',active_turn=None,reason=projected['reason'])
                        self.rooms._changed(room_id)
                        continue
                    if turn.status == 'done' and message['kind'] != 'wrapup' and not exchange.stop_requested and not is_pass(turn.detail or turn.text):
                        self.intents(exchange.origin_message_id, message['id'],
                            [i for i in self.rooms._targets(room, projected['text']) if i != message['member_id']])
                    failure = None if turn.status == 'done' else 'owner' if exchange.stop_requested else self.failure(turn.id)
                    with self.conn:
                        self.conn.execute("UPDATE room_messages SET exchange_settled = 1 WHERE id = ?", (message["id"],))
                        self.conn.execute("UPDATE room_exchanges SET active_turn=NULL, cost=?, spoken=? WHERE origin_message_id=?",
                            (exchange.cost + turn.cost_usd, json.dumps(sorted(spoken)), exchange.origin_message_id))
                        named = self.conn.execute("UPDATE room_reply_intents SET state=?, reason=? WHERE turn_id=? AND state='running'",
                            ('blocked' if failure else 'done', failure or '', turn.id)).rowcount
                        if failure and not named and message['kind'] == 'message':
                            # A planned or chosen reply answered no address; its failure is named by its own message.
                            self.conn.execute("INSERT INTO room_reply_intents (origin_message_id,source_message_id,"
                                "recipient_id,recipient_name,state,reason,turn_id) VALUES (?,?,?,?,'blocked',?,?)",
                                (exchange.origin_message_id, message['id'], message['member_id'], self.name(message['member_id']), failure, turn.id))
                    exchange = self.get(exchange.origin_message_id)
                    if failure and message["kind"] == "wrapup":
                        self.update(exchange.origin_message_id, state="stopped", reason=failure)
                        self.attachments.pop(exchange.origin_message_id, None)
                        self.rooms._changed(room_id)
                        continue
                    if message["kind"] == "wrapup":
                        self.update(exchange.origin_message_id, state="stopped" if exchange.stop_requested else "done")
                        self.attachments.pop(exchange.origin_message_id, None)
                        self.rooms._changed(room_id)
                        continue
                    self.update(exchange.origin_message_id, pending=json.dumps(pending))
                    if self.conn.execute("SELECT 1 FROM room_exchanges WHERE room_id=? AND origin_message_id>? AND state='queued'",
                                         (room_id, exchange.origin_message_id)).fetchone():
                        continue
                exchange = self.get(exchange.origin_message_id)
                cap = float(self.rooms._settings.get("worker_cost_cap_usd"))
                if exchange.stop_requested or exchange.cost >= cap or self.spend.is_over(self.rooms._settings.get("monthly_limit_usd")):
                    self.block(exchange.origin_message_id, exchange.reason if exchange.stop_requested else "cost")
                    self.update(exchange.origin_message_id, state="stopped", pending="[]",
                                reason=exchange.reason if exchange.stop_requested else "cost")
                    self.attachments.pop(exchange.origin_message_id, None)
                    self.rooms._changed(room_id)
                    continue
                ids = self.rooms._ids(room)
                spoken = set(json.loads(exchange.spoken))
                moderator = next((int(i) for i, role in room.get('roles', {}).items() if role == 'moderator'), None)
                pending = json.loads(exchange.pending) if exchange.pending is not None else None
                if pending is None:
                    owner = self.conn.execute("SELECT text FROM room_messages WHERE id = ?", (exchange.origin_message_id,)).fetchone()[0]
                    targets = self.rooms._targets(room, owner)
                    if targets:
                        pending = [{"member":i,"reply_to_member":None,"reply_to":exchange.origin_message_id,"handoff":False} for i in targets]
                    else:
                        # Nobody was addressed, so nobody replies "to" anyone: they are just talking.
                        chosen, unanswered = await self.first_speakers(room, exchange, ids)
                        pending = [{"member":i,"reply_to_member":None,"reply_to":None,"handoff":False,"heard":True,
                                    **({"unanswered":True} if unanswered else {})} for i in chosen]
                pending = [p for p in pending if p["member"] in ids and
                           (p.get('round') or p.get('heard') or p["member"] not in spoken or p["handoff"])]
                planned = pending
                with self.conn:
                    for intent in self.conn.execute("SELECT * FROM room_reply_intents WHERE origin_message_id=? AND state='queued' ORDER BY id", (exchange.origin_message_id,)).fetchall():
                        if intent['recipient_id'] not in ids:
                            self.conn.execute("UPDATE room_reply_intents SET state='blocked', reason='revoked' WHERE id=?", (intent['id'],))
                intent = self.conn.execute("SELECT * FROM room_reply_intents WHERE origin_message_id=? AND state='queued' ORDER BY id LIMIT 1", (exchange.origin_message_id,)).fetchone()
                if intent:
                    source = self.conn.execute("SELECT member_id FROM room_messages WHERE id=?", (intent['source_message_id'],)).fetchone()
                    pending = [{"member":intent['recipient_id'], "reply_to_member":source[0],
                                "reply_to":intent['source_message_id'], "handoff":source[0] is not None,
                                "intent_id":intent['id']}]
                exchange = self.get(exchange.origin_message_id)
                if (not pending and not exchange.meeting and exchange.turns_taken and exchange.chime_ins < MAX_ROUNDS
                        and exchange.turns_taken < MAX_TURNS and exchange.hops < MAX_HOPS):
                    # What was just said is a new message, and everyone but the one who said it reads it.
                    last = self.last_reply(exchange.origin_message_id)
                    speaking = (await self.listen(room, exchange, [i for i in ids if i != last[1]]))[0] if last else []
                    pending = [{"member":i,"reply_to_member":None,"reply_to":None,"handoff":False,"heard":True} for i in speaking]
                    self.update(exchange.origin_message_id, chime_ins=exchange.chime_ins + 1 if pending else MAX_ROUNDS)
                # Any owner interjection/stop received during a routing call wins before submission.
                exchange = self.get(exchange.origin_message_id)
                if (not exchange or exchange.stop_requested or exchange.cost >= cap or
                        self.spend.is_over(self.rooms._settings.get('monthly_limit_usd'))):
                    continue
                if exchange.reason == 'interjection' and not intent:
                    pending, planned = [], []
                if self.conn.execute("SELECT 1 FROM room_exchanges WHERE room_id=? AND origin_message_id>? AND state='queued'",
                                     (room_id, exchange.origin_message_id)).fetchone():
                    self.update(exchange.origin_message_id, pending=json.dumps(planned))
                    continue
                work = self.conn.execute("SELECT state FROM worker_tasks WHERE room_id=? AND source_turn_id IN "
                    "(SELECT turn_id FROM room_messages WHERE origin_message_id=?) AND mode IS NOT NULL",
                    (room_id,exchange.origin_message_id)).fetchall()
                # Raphael called on once a meeting's rounds are over gives its one conclusion, not a reply before it.
                chief = self.rooms._members.primary_id()
                closing = (intent is not None and intent['recipient_id'] == chief and moderator is not None and
                           not any(entry.get('round') for entry in planned) and not self.conn.execute(
                               "SELECT 1 FROM room_reply_intents WHERE origin_message_id=? AND state='queued' AND recipient_id!=?",
                               (exchange.origin_message_id,chief)).fetchone())
                if (not pending or closing) and any(row['state'] in ('queued','running','waiting') for row in work):
                    return
                # A member's failed reply is named in what the chief says; any other block ends the exchange without it.
                # Only a meeting closes and only work handed out reports back: a discussion just ends when no one has more to say.
                wrapup = (exchange.turns_taken >= 1 and chief in ids and not exchange.wrapup_sent and
                          (exchange.meeting or closing or bool(work)) and
                          (not pending or closing) and not self.conn.execute("SELECT 1 FROM room_reply_intents WHERE origin_message_id=? AND state='blocked' "
                              "AND reason!='worker' AND reason NOT LIKE 'cli!_%' ESCAPE '!'", (exchange.origin_message_id,)).fetchone())
                if wrapup:
                    last = self.last_reply(exchange.origin_message_id)
                    pending = [{"member":chief,"reply_to_member":last[1] if last else None,
                                "reply_to":last[0] if last else exchange.origin_message_id,"handoff":False,
                                **({"intent_id":intent['id']} if closing else {})}]
                if not pending or (exchange.turns_taken >= MAX_TURNS and not intent and not wrapup and not pending[0].get('round')):
                    blocked = self.conn.execute("SELECT 1 FROM room_reply_intents WHERE origin_message_id=? AND state='blocked'", (exchange.origin_message_id,)).fetchone()
                    self.update(exchange.origin_message_id, state="stopped" if blocked else "done", pending="[]", reason="blocked_intents" if blocked else "turns" if pending else "")
                    self.attachments.pop(exchange.origin_message_id, None)
                    self.rooms._changed(room_id)
                    continue
                target, remaining = pending[0], pending[1:]
                if (intent or target.get('round')) and exchange.turns_taken and exchange.turns_taken % MAX_TURNS == 0:
                    # Yield admission to another scheduled slice without losing accepted addresses.
                    self.update(exchange.origin_message_id, state='queued')
                    self.schedule(room_id)
                    # The next slice sees this marker and admits exactly one turn.
                    if exchange.reason != f'slice:{exchange.turns_taken}':
                        self.update(exchange.origin_message_id, reason=f'slice:{exchange.turns_taken}')
                        return
                if target["member"] not in self.rooms._ids(room):
                    self.update(exchange.origin_message_id, state="stopped", pending="[]", reason="membership")
                    self.attachments.pop(exchange.origin_message_id, None)
                    self.rooms._changed(room_id)
                    continue
                if moderator is not None and not wrapup:
                    # An addressed member speaking in an open round takes their planned place in it.
                    rest, target['meeting'] = seat(planned, target['member'], moderator)
                    if intent:
                        planned = rest
                self.update(exchange.origin_message_id, state="running", pending=json.dumps(remaining),
                            turns_taken=exchange.turns_taken + 1,
                            hops=exchange.hops + int(target["handoff"]), wrapup_sent=int(wrapup) or exchange.wrapup_sent)
                if intent:
                    self.update(exchange.origin_message_id, pending=json.dumps(planned))
                try:
                    turn = self.rooms._submit_exchange_turn(room, exchange, target, "wrapup" if wrapup else "message",
                                                            self.attachments.get(exchange.origin_message_id, ()))
                except RpcError:
                    self.block(exchange.origin_message_id, "source_unavailable")
                    self.update(exchange.origin_message_id, state="stopped", reason="source_unavailable", pending="[]")
                    self.rooms._changed(room_id)
                    continue
                self.update(exchange.origin_message_id, active_turn=turn)
                if intent and not wrapup:
                    with self.conn:
                        self.conn.execute("UPDATE room_reply_intents SET state='running', turn_id=? WHERE id=? AND state='queued'", (turn, intent['id']))
                self.rooms._changed(room_id)
                # Refused submissions resolve immediately and must not leave a stuck exchange.
                if self.rooms._history.get(turn).status != "running":
                    continue
                return

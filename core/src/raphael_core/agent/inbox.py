"""Durable FIFO admission. Started work is never replayed.

Adapted from NousResearch/hermes-agent (MIT); see core/packaging/licenses.
Raphael deliberately has no queue limit or epochs.
"""

import json
import uuid


class AgentInbox:
    def __init__(self, conn, history, now_ms):
        self.conn, self.history, self.now_ms = conn, history, now_ms
        self.boot_id = uuid.uuid4().hex

    def find(self, member, conversation, request):
        return self.conn.execute(
            "SELECT * FROM agent_inbox WHERE member_id=? AND conversation_id=? AND request_id=? AND state!='terminal'",
            (member, conversation, request),
        ).fetchone()

    def admit(self, ask, payload):
        existing = self.find(ask.speaker.id, ask.conversation_id, ask.session_id)
        if existing:
            return existing, False
        turn_id = self.history.add(
            session_id=ask.session_id, question=ask.original_text if ask.original_text is not None else ask.text,
            route="answer", prefix="", text="", status="queued", source=ask.source,
            member_id=ask.speaker.id, conversation_id=ask.conversation_id,
            attachments=[a.metadata() for a in ask.attachments], quote=ask.quote,
            admission=json.dumps(payload, ensure_ascii=False), place=ask.place,
        )
        return self.get(turn_id), True

    def get(self, turn_id):
        return self.conn.execute("SELECT * FROM agent_inbox WHERE turn_id=?", (turn_id,)).fetchone()

    def claim(self, scope):
        with self.conn:
            row = self.conn.execute(
                "SELECT * FROM agent_inbox WHERE member_id=? AND conversation_id=? AND state='queued' ORDER BY seq LIMIT 1",
                scope,
            ).fetchone()
            if not row:
                return None
            claimed = self.conn.execute(
                "UPDATE agent_inbox SET state='started',boot_id=?,claimed_at_ms=? WHERE turn_id=? AND state='queued'"
                " AND NOT EXISTS (SELECT 1 FROM agent_inbox WHERE member_id=? AND conversation_id=? AND state IN ('started','steering'))",
                (self.boot_id, self.now_ms(), row['turn_id'], *scope),
            )
            return self.get(row['turn_id']) if claimed.rowcount else None

    def transfer(self, turn_id):
        with self.conn:
            self.conn.execute("UPDATE agent_inbox SET state='steering',boot_id=? WHERE turn_id=? AND state='queued'", (self.boot_id, turn_id))
            self.conn.execute("UPDATE agent_turns SET status='done',route='owner_input' WHERE id=?", (turn_id,))

    def settle(self, turn_id, outcome):
        with self.conn:
            row = self.get(turn_id)
            if not row or row['state'] == 'terminal':
                return
            self.conn.execute(
                "UPDATE agent_inbox SET state='terminal',outcome=?,settled_at_ms=? WHERE turn_id=?",
                (outcome, self.now_ms(), turn_id),
            )

    def requeue(self, turn_id):
        with self.conn:
            changed = self.conn.execute("UPDATE agent_inbox SET state='queued',boot_id=NULL WHERE turn_id=? AND state='steering'", (turn_id,))
            if changed.rowcount:
                self.conn.execute("UPDATE agent_turns SET status='queued',route='answer' WHERE id=?", (turn_id,))

    def recover(self):
        with self.conn:
            self.conn.execute("UPDATE agent_turns SET status='expired' WHERE id IN (SELECT turn_id FROM agent_inbox WHERE state='started')")
            self.conn.execute("UPDATE agent_inbox SET state='terminal',outcome='lost',settled_at_ms=? WHERE state='started'", (self.now_ms(),))
            self.conn.execute("UPDATE agent_turns SET status='queued',route='answer' WHERE id IN (SELECT turn_id FROM agent_inbox WHERE state='steering')")
            self.conn.execute("UPDATE agent_inbox SET state='queued',boot_id=NULL WHERE state='steering'")

    def scopes(self):
        return [tuple(row) for row in self.conn.execute("SELECT DISTINCT member_id,conversation_id FROM agent_inbox WHERE state='queued'")]

    def cancel_scope(self, scope):
        rows = self.conn.execute(
            "SELECT * FROM agent_inbox WHERE member_id=? AND conversation_id=? AND state IN ('queued','steering') ORDER BY seq", scope,
        ).fetchall()
        for row in rows:
            self.settle(row['turn_id'], 'cancelled')
            self.history.resolve(row['turn_id'], prefix='', text='', detail=None, status='denied', cost_usd=0)
        return rows

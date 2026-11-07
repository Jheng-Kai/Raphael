"""Nonsecret pairing cards that follow the member's current conversation."""

import asyncio
import secrets

from ..agent.history import AgentHistory
from ..clock import wall_clock_ms
from ..protocol import invalid_params
from .core import session_target

LINKS = {"telegram": "https://t.me/BotFather", "slack": "https://api.slack.com/apps", "discord": "https://discord.com/developers/applications"}
NAMES = {"telegram": "Telegram", "slack": "Slack", "discord": "Discord"}


class MessagingCards:
    def __init__(self, conn, service, notify=None, now_ms=wall_clock_ms):
        self.conn, self.service, self.notify, self.now_ms = conn, service, notify, now_ms
        self.history = AgentHistory(conn, now_ms)
        self.timers = {}
        # The corresponding in-memory pairing codes do not survive a restart.
        with conn:
            conn.execute("UPDATE messaging_pairing_cards SET state='expired' WHERE state='pending'")

    def connected(self, account, card_id):
        row = self.conn.execute("SELECT turn_id FROM secret_cards WHERE id=?", (card_id,)).fetchone()
        if row:
            self.watch(account, row["turn_id"])

    def watch(self, account, turn_id):
        """Show waiting codes in the conversation where the owner asked to reconnect."""
        with self.conn:
            self.conn.execute("INSERT OR REPLACE INTO messaging_card_accounts (account,turn_id) VALUES (?,?)", (account, turn_id))
            old = self.conn.execute("SELECT DISTINCT turn_id FROM messaging_pairing_cards WHERE account=? AND state='pending'", (account,)).fetchall()
            self.conn.execute("UPDATE messaging_pairing_cards SET turn_id=? WHERE account=? AND state='pending'", (turn_id, account))
        for row in old:
            self._changed(row["turn_id"])
        if old:
            self._changed(turn_id)

    def detached(self, account):
        with self.conn:
            self.conn.execute("DELETE FROM messaging_card_accounts WHERE account=?", (account,))
        self.stopped(account)

    def stopped(self, account):
        rows = self.conn.execute("SELECT id FROM messaging_pairing_cards WHERE account=? AND state='pending'", (account,)).fetchall()
        for row in rows:
            self.finish(row["id"], "expired")

    def _changed(self, turn_id):
        turn = self.history.get(turn_id)
        if turn and self.notify:
            self.notify("agent.turn", {"turn_id": turn_id, "member_id": turn.member_id})

    def event(self, account, event, pairing):
        if event == "expired":
            self.finish_code(account, pairing.code, "expired")
            return
        running = self.service._running.get(account)
        target = session_target(account + ":chat")
        if running is None or target is None or target[0] not in self.service._members():
            return
        member, platform, _ = target
        left = max(0, pairing.expires_at - running.switchboard.pairing._clock())
        previous = self.conn.execute("SELECT * FROM messaging_pairing_cards WHERE account=? AND state='pending' ORDER BY rowid DESC LIMIT 1", (account,)).fetchone()
        if previous is not None and self.history.get(previous["turn_id"]) is not None:
            identifier, turn_id = previous["id"], previous["turn_id"]
            timer = self.timers.pop(identifier, None)
            if timer:
                timer.cancel()
            # A replacement never leaves an older, still-approvable code behind.
            running.switchboard.pairing.take(previous["code"])
            with self.conn:
                self.conn.execute("UPDATE messaging_pairing_cards SET code=?,who=?,expires_at_ms=? WHERE id=?",
                                  (pairing.code, pairing.name, self.now_ms() + int(left * 1000), identifier))
        else:
            identifier = secrets.token_hex(8)
            source = self.conn.execute("SELECT t.* FROM messaging_card_accounts a JOIN agent_turns t ON t.id=a.turn_id WHERE a.account=?", (account,)).fetchone()
            turn_id = self.history.add(session_id="pairing-" + identifier, question="", route="pairing", prefix="", text="", status="done",
                                       source="messaging", member_id=member, conversation_id=source["conversation_id"] if source else None)
            with self.conn:
                self.conn.execute("INSERT INTO messaging_pairing_cards (id,turn_id,account,platform,member_id,code,who,expires_at_ms,state) VALUES (?,?,?,?,?,?,?,?, 'pending')",
                                  (identifier, turn_id, account, platform, member, pairing.code, pairing.name, self.now_ms() + int(left * 1000)))
        self.timers[identifier] = asyncio.get_running_loop().call_later(left, self.finish, identifier, "expired")
        self._changed(turn_id)

    def finish(self, identifier, state):
        timer = self.timers.pop(identifier, None)
        if timer:
            timer.cancel()
        row = self.conn.execute("SELECT * FROM messaging_pairing_cards WHERE id=? AND state='pending'", (identifier,)).fetchone()
        if row is None:
            return
        with self.conn:
            self.conn.execute("UPDATE messaging_pairing_cards SET state=? WHERE id=? AND state='pending'", (state, identifier))
        self._changed(row["turn_id"])

    def finish_code(self, account, code, state):
        for row in self.conn.execute("SELECT id FROM messaging_pairing_cards WHERE account=? AND code=? AND state='pending'", (account, code.strip().upper())).fetchall():
            self.finish(row["id"], state)

    def sweep(self):
        for row in self.conn.execute("SELECT id FROM messaging_pairing_cards WHERE state='pending' AND expires_at_ms<=?", (self.now_ms(),)).fetchall():
            self.finish(row["id"], "expired")

    async def answer(self, params):
        self.sweep()
        identifier, approve = params.get("id"), params.get("approve")
        if not isinstance(identifier, str) or type(approve) is not bool:
            raise invalid_params("id and approve are required")
        row = self.conn.execute("SELECT p.* FROM messaging_pairing_cards p JOIN agent_turns t ON t.id=p.turn_id WHERE p.id=?", (identifier,)).fetchone()
        if row is None:
            raise invalid_params("id must name a pairing card")
        if row["state"] == "pending":
            if approve:
                result = await self.service._approve(row["account"], {"code": row["code"]})
                self.finish(identifier, "approved" if result["approved"] else "expired")
            else:
                await self.service._reject(row["account"], {"code": row["code"]})
                self.finish(identifier, "rejected")
        return {"card": self.view(self.conn.execute("SELECT * FROM messaging_pairing_cards WHERE id=?", (identifier,)).fetchone())}

    @staticmethod
    def view(row):
        return {key: row[key] for key in ("id", "platform", "member_id", "code", "who", "expires_at_ms", "state")}

    def views(self, ids):
        self.sweep()
        result = {}
        for identifier in ids:
            for row in self.conn.execute("SELECT * FROM messaging_pairing_cards WHERE turn_id=? ORDER BY rowid", (identifier,)):
                result.setdefault(identifier, []).append(self.view(row))
        return result

    def close(self):
        for timer in self.timers.values():
            timer.cancel()
        self.timers.clear()

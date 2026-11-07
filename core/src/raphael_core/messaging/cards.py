"""Nonsecret pairing cards for accounts set up inside a conversation."""

import asyncio
import secrets

from ..clock import wall_clock_ms
from ..protocol import invalid_params

LINKS = {"telegram": "https://t.me/BotFather", "slack": "https://api.slack.com/apps", "discord": "https://discord.com/developers/applications"}
NAMES = {"telegram": "Telegram", "slack": "Slack", "discord": "Discord"}


class MessagingCards:
    def __init__(self, conn, service, notify=None, now_ms=wall_clock_ms):
        self.conn, self.service, self.notify, self.now_ms = conn, service, notify, now_ms
        self.timers = {}
        # The corresponding in-memory pairing codes do not survive a restart.
        with conn:
            conn.execute("UPDATE messaging_pairing_cards SET state='expired' WHERE state='pending'")

    def connected(self, account, card_id):
        with self.conn:
            self.conn.execute("INSERT OR REPLACE INTO messaging_card_accounts (account,card_id) VALUES (?,?)", (account, card_id))

    def detached(self, account):
        with self.conn:
            self.conn.execute("DELETE FROM messaging_card_accounts WHERE account=?", (account,))
            rows = self.conn.execute("SELECT id FROM messaging_pairing_cards WHERE account=? AND state='pending'", (account,)).fetchall()
        for row in rows:
            self.finish(row["id"], "expired")

    def _changed(self, card_id):
        row = self.conn.execute("SELECT turn_id,member_id FROM secret_cards WHERE id=?", (card_id,)).fetchone()
        if row and self.notify:
            self.notify("agent.turn", dict(row))

    def event(self, account, event, pairing):
        if event == "expired":
            self.finish_code(account, pairing.code, "expired")
            return
        source = self.conn.execute("SELECT c.id,c.member_id,c.server_id FROM messaging_card_accounts a JOIN secret_cards c ON c.id=a.card_id JOIN agent_turns t ON t.id=c.turn_id WHERE a.account=?", (account,)).fetchone()
        if source is None:
            return
        identifier = secrets.token_hex(8)
        running = self.service._running.get(account)
        if running is None:
            return
        left = max(0, pairing.expires_at - running.switchboard.pairing._clock())
        with self.conn:
            self.conn.execute("INSERT INTO messaging_pairing_cards VALUES (?,?,?,?,?,?,?,?, 'pending')", (identifier, source["id"], account, source["server_id"], source["member_id"], pairing.code, pairing.name, self.now_ms() + int(left * 1000)))
        self.timers[identifier] = asyncio.get_running_loop().call_later(left, self.finish, identifier, "expired")
        self._changed(source["id"])

    def finish(self, identifier, state):
        timer = self.timers.pop(identifier, None)
        if timer:
            timer.cancel()
        row = self.conn.execute("SELECT * FROM messaging_pairing_cards WHERE id=? AND state='pending'", (identifier,)).fetchone()
        if row is None:
            return
        with self.conn:
            self.conn.execute("UPDATE messaging_pairing_cards SET state=? WHERE id=? AND state='pending'", (state, identifier))
        self._changed(row["card_id"])

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
        row = self.conn.execute("SELECT p.* FROM messaging_pairing_cards p JOIN secret_cards c ON c.id=p.card_id JOIN agent_turns t ON t.id=c.turn_id WHERE p.id=?", (identifier,)).fetchone()
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
            rows = self.conn.execute("SELECT p.* FROM messaging_pairing_cards p JOIN secret_cards c ON c.id=p.card_id WHERE c.turn_id=? ORDER BY p.rowid", (identifier,))
            for row in rows:
                result.setdefault(identifier, []).append(self.view(row))
        return result

    def close(self):
        for timer in self.timers.values():
            timer.cancel()
        self.timers.clear()

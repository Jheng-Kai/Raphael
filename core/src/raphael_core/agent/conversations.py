"""One persistent main conversation per member for chat, voice, routines and messaging.

The main conversation is created lazily and cannot be replaced through public actions. Raphael has no second
one: its quick questions (Alt+Space) are written to its main conversation and only answered the quick way (`QUICK`).
"""

import sqlite3
from collections.abc import Callable

from ..clock import wall_clock_ms
from ..protocol import invalid_params

TITLE_MAX = 80
# The destination (and model purpose) of an Alt+Space question: Raphael's one conversation, answered the quick way.
QUICK = "quick"


def short_title(question: str) -> str:
    return " ".join(question.split())[:TITLE_MAX]


class Conversations:
    def __init__(self, conn: sqlite3.Connection, now_ms: Callable[[], int] = wall_clock_ms):
        self.conn = conn
        self.now_ms = now_ms

    def get(self, conversation_id: int, member_id: int | None = None) -> dict:
        if type(conversation_id) is not int or conversation_id <= 0:
            raise invalid_params("conversation_id must be a positive whole number")
        row = self.conn.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
        if row is None or (member_id is not None and row["member_id"] != member_id):
            raise invalid_params("there is no such conversation for this member")
        return dict(row)

    def main(self, member_id: int = 0) -> int:
        row = self.conn.execute(
            "SELECT id FROM conversations WHERE member_id = ? AND kind = 'standard' AND is_default = 1"
            " ORDER BY updated_at_ms DESC, id DESC LIMIT 1", (member_id,),
        ).fetchone()
        if row is not None:
            return row[0]
        # Adopt a legacy standard conversation if it has not been marked as default.
        row = self.conn.execute(
            "SELECT id FROM conversations WHERE member_id = ? AND kind = 'standard'"
            " ORDER BY updated_at_ms DESC, id DESC LIMIT 1", (member_id,),
        ).fetchone()
        if row is not None:
            with self.conn:
                self.conn.execute("UPDATE conversations SET is_default = 1 WHERE id = ?", (row[0],))
            return row[0]
        return self._create_main(member_id)

    def resolve(self, member_id: int, conversation_id: int | None = None) -> int:
        return self.main(member_id) if conversation_id is None else self.get(conversation_id, member_id)["id"]

    def destination(self, member_id: int, conversation_id: int | None, *, quick: bool) -> int:
        """Where a request is written: the member's main conversation, or the one it names. A quick request is
        Raphael's alone (it says how the turn is answered, not where it is kept)."""
        if quick and member_id != 0:
            raise invalid_params("quick questions belong to Raphael")
        return self.resolve(member_id, conversation_id)

    def _create_main(self, member_id: int) -> int:
        now = self.now_ms()
        with self.conn:
            self.conn.execute(
                "INSERT OR IGNORE INTO conversations (member_id, title, created_at_ms, updated_at_ms, is_default)"
                " VALUES (?, '', ?, ?, 1)", (member_id, now, now),
            )
        return self.conn.execute("SELECT id FROM conversations WHERE member_id = ? AND kind = 'standard'", (member_id,)).fetchone()[0]

    def list(self, member_id: int, query: str = "") -> list[dict]:
        self.main(member_id)
        rows = self.conn.execute(
            "SELECT c.*, (SELECT COUNT(*) FROM agent_turns t WHERE t.conversation_id = c.id AND t.member_id = c.member_id) AS turn_count FROM conversations c WHERE member_id = ? ORDER BY updated_at_ms DESC, id DESC", (member_id,),
        )
        return [dict(row) for row in rows if query.casefold() in row["title"].casefold()]

    def touch(self, conversation_id: int, question: str = "") -> None:
        self.conn.execute(
            "UPDATE conversations SET updated_at_ms = ?, title = CASE WHEN title = '' THEN ? ELSE title END WHERE id = ?",
            (self.now_ms(), short_title(question), conversation_id),
        )

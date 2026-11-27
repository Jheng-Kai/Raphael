"""Schema 102: Raphael keeps one conversation. Its quick conversation is folded into its main one.

Until this step Raphael (member 0) kept two: its main conversation (kind 'standard') and a quick one (kind 'quick',
written by Alt+Space and the voice key). A quick question is now one more turn of Raphael's main conversation,
answered the quick way (`AgentService._ask_settings`), so every row of the quick conversation moves to the main one:

- The turns keep their IDs, so the two histories interleave in the order they were said; the cards, drafts, pages,
  connection proposals, voice calls and the inbox of the quick conversation follow them.
- The inbox is renumbered after the main conversation's. A queued or started request that would clash with one of the
  main conversation's (the same request ID, or a second started request) is cancelled, its turn denied: never run twice.
- The unread mark is the earlier of the two.
- The summaries and CLI threads of both are dropped: a summary says how far the conversation was folded, and the
  merged one is a different conversation, so it is folded again from its turns (as when a turn is deleted). The CLI
  tables the loop makes on first use (`agent_conversation_cli_contexts`, `agent_cli_generations`, `agent/cli/loop.py`) may
  not be there yet: their rows go the same way, and the merged conversation's generation moves on, so that a late
  session of either history cannot come back.
- The quick conversation row is deleted. Where Raphael has no main conversation (its slime took it in schema 101), the
  quick conversation becomes the main one instead and keeps everything it has.

The kind CHECK, the unique index and the triggers of 'quick' stay: nothing writes a quick conversation again.
Idempotent: with no quick conversation there is nothing to do. A database migrated here cannot be opened by an older
build.
"""

import sqlite3

# Tables with a conversation_id that moves with the conversation: (table, column).
_MOVED = (
    "agent_turns", "agent_inbox", "pages", "permission_cards", "connect_cards", "connection_proposals", "secret_cards",
    "handback_cards", "email_drafts", "voice_calls",
)
# Tables of a conversation's folding and native threads, dropped for both conversations (the last two are made by the CLI loop on its first use).
_DROPPED = ("conversation_context_summaries", "agent_conversation_cli_sessions", "agent_conversation_cli_contexts")
_CANCEL = "CAST(strftime('%s', 'now') AS INTEGER) * 1000"


def _has_table(conn: sqlite3.Connection, table: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)).fetchone() is not None


def _inbox(conn: sqlite3.Connection, quick: int, main: int) -> None:
    """What waits in the quick conversation's inbox goes on behind what waits in the main one."""
    main_started = conn.execute(
        "SELECT 1 FROM agent_inbox WHERE conversation_id = ? AND state = 'started'", (main,)).fetchone() is not None
    cancelled = []
    for turn_id, request_id, state in conn.execute(
            "SELECT turn_id, request_id, state FROM agent_inbox WHERE conversation_id = ? AND state != 'terminal'"
            " ORDER BY turn_id", (quick,)).fetchall():
        clash = conn.execute(
            "SELECT 1 FROM agent_inbox WHERE conversation_id = ? AND member_id = 0 AND request_id = ? AND state != 'terminal'",
            (main, request_id)).fetchone()
        if clash or (state == "started" and main_started):
            cancelled.append(turn_id)
    for turn_id in cancelled:
        conn.execute("UPDATE agent_turns SET status = 'denied' WHERE id = ? AND status IN ('queued', 'running', 'confirm')", (turn_id,))
        conn.execute(
            f"UPDATE agent_inbox SET state = 'terminal', outcome = 'cancelled', settled_at_ms = {_CANCEL} WHERE turn_id = ?",
            (turn_id,))
    (base,) = conn.execute("SELECT COALESCE(MAX(seq), 0) FROM agent_inbox WHERE conversation_id = ?", (main,)).fetchone()
    conn.execute("UPDATE agent_inbox SET seq = seq + ? WHERE conversation_id = ?", (base, quick))


def _unread(conn: sqlite3.Connection, quick: int, main: int) -> None:
    marks = [row[0] for row in conn.execute(
        "SELECT unread_from FROM member_unread WHERE member_id = 0 AND conversation_id IN (?, ?) AND unread_from IS NOT NULL",
        (quick, main))]
    conn.execute("DELETE FROM member_unread WHERE member_id = 0 AND conversation_id IN (?, ?)", (quick, main))
    if marks:
        conn.execute("INSERT INTO member_unread (member_id, conversation_id, unread_from) VALUES (0, ?, ?)", (main, min(marks)))


def fold(conn: sqlite3.Connection) -> None:
    rows = conn.execute("SELECT id FROM conversations WHERE kind = 'quick'").fetchall()
    with conn:
        for (quick,) in rows:
            main = conn.execute(
                "SELECT id FROM conversations WHERE member_id = 0 AND kind = 'standard'"
                " ORDER BY is_default DESC, updated_at_ms DESC, id DESC LIMIT 1").fetchone()
            if main is None:
                # Nothing to fold into: the quick conversation is Raphael's one.
                conn.execute("UPDATE conversations SET kind = 'standard', is_default = 1 WHERE id = ?", (quick,))
                continue
            main = main[0]
            _inbox(conn, quick, main)
            _unread(conn, quick, main)
            for table in _MOVED:
                conn.execute(f"UPDATE {table} SET conversation_id = ? WHERE conversation_id = ?", (main, quick))
            for table in _DROPPED:
                if _has_table(conn, table):
                    conn.execute(f"DELETE FROM {table} WHERE conversation_id IN (?, ?)", (quick, main))
            if _has_table(conn, "agent_cli_generations"):
                conn.execute("DELETE FROM agent_cli_generations WHERE conversation_id = ?", (quick,))
                conn.execute("UPDATE agent_cli_generations SET generation = generation + 1 WHERE conversation_id = ?", (main,))
            conn.execute(
                "UPDATE conversations SET is_default = 1,"
                " title = CASE WHEN title = '' THEN (SELECT title FROM conversations WHERE id = ?) ELSE title END,"
                " created_at_ms = MIN(created_at_ms, (SELECT created_at_ms FROM conversations WHERE id = ?)),"
                " updated_at_ms = MAX(updated_at_ms, (SELECT updated_at_ms FROM conversations WHERE id = ?)) WHERE id = ?",
                (quick, quick, quick, main))
            conn.execute("DELETE FROM conversations WHERE id = ?", (quick,))
        conn.execute("PRAGMA user_version = 102")

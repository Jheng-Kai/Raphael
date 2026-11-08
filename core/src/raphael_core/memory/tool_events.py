"""Bounded, redacted private tool transcripts, retrievable only through their turn's scope."""

import json
import re
import uuid

from ..clock import wall_clock_ms
from ..failures import scrub
from ..bots.homes import redact_secrets

ARGS_CHARS = 8192
RESULT_CHARS = 32768
INDEX_CHARS = 8192
_PRIVATE = re.compile(r"password|passwd|secret|token|authorization|cookie|api.?key|credential|card.?number|cvv", re.I)


def safe_text(value, limit):
    def clean(item):
        if isinstance(item, dict):
            return {str(key): "[redacted]" if _PRIVATE.search(str(key)) else clean(content) for key, content in item.items()}
        if isinstance(item, (list, tuple)):
            return [clean(content) for content in item]
        return item if isinstance(item, (str, int, float, bool, type(None))) else str(item)
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            pass
    text = value if isinstance(value, str) else json.dumps(clean(value), ensure_ascii=False)
    text = redact_secrets(scrub(text))
    return text if len(text) <= limit else text[:limit - 16] + "\n[truncated]"


def record(conn, turn_id, call_id, tool, arguments, result, *, ok, kind=None, external=False):
    if not turn_id or not conn.execute("SELECT 1 FROM agent_turns WHERE id=?", (turn_id,)).fetchone():
        return
    with conn:
        conn.execute("INSERT INTO turn_tool_events(turn_id,call_id,tool,redacted_args,redacted_result,outcome,external,created_at_ms) "
                     "VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(turn_id,call_id) DO UPDATE SET "
                     "redacted_result=excluded.redacted_result,outcome=excluded.outcome,external=excluded.external",
                     (turn_id, call_id or uuid.uuid4().hex, str(tool)[:160], safe_text(arguments, ARGS_CHARS),
                      safe_text(result, RESULT_CHARS), "ok" if ok else str(kind or "error")[:80], int(bool(external)), wall_clock_ms()))
        from ..agent.history import AgentHistory
        AgentHistory(conn).reindex(turn_id)


def read(conn, turn_id):
    return [dict(row) for row in conn.execute(
        "SELECT id,tool,redacted_args,redacted_result,outcome,external FROM turn_tool_events WHERE turn_id=? ORDER BY id", (turn_id,))]


def placeholders(conn, turn_id):
    return "\n".join(f"[Tool {row['tool']}: {row['outcome']}; output pruned; session_read turn:{turn_id}]"
                     for row in conn.execute("SELECT tool,outcome FROM turn_tool_events WHERE turn_id=? ORDER BY id", (turn_id,)))

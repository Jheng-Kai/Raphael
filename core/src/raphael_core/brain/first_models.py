"""Preserve existing choices and fill vacant feature settings on connection."""

import json

SETTINGS = {"answer": "agent_model", "quick": "quick_model", "cleanup": "cleanup_model", "stt": "stt_cloud_model"}
LEGACY = {"agent_model": "openai/gpt-6-luna", "cleanup_model": "openai/gpt-6-luna",
          "stt_cloud_model": "elevenlabs/scribe-v2"}


def migrate(conn, enabled, keys):
    marker = "models.explicit.v1"
    if conn.execute("SELECT 1 FROM settings WHERE key=?", (marker,)).fetchone():
        return
    keep = enabled and keys.filled()
    with conn:
        if conn.execute("INSERT OR IGNORE INTO settings VALUES (?, 'true')", (marker,)).rowcount and keep:
            conn.executemany("INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)",
                             [(key, json.dumps(value)) for key, value in LEGACY.items()])


def recommendations(rows):
    text = [row for row in rows if row.get("text_eligible", True) and not row.get("stt") and not row.get("generation_only")]
    result = {}
    if text:
        answer = next((r for r in text if r.get("is_default")), text[0])
        fast_rows = [row for row in text if row.get("is_fast") or any(
            word in row["id"].lower() for word in ("mini", "flash", "haiku", "lite", "luna", "fast")
        )]

        def price(row):
            prices = (row.get("price_in"), row.get("price_out"))
            return sum(prices) if None not in prices else float("inf")

        fast = min(fast_rows or text, key=price)
        result.update(answer=answer["id"], quick=fast["id"], cleanup=fast["id"])
    speech = next((r for r in rows if r.get("stt")), None)
    if speech:
        result["stt"] = speech["id"]
    return result

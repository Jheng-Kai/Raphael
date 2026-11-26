"""Schema 101: Raphael (member 0) stops being a slime.

Until this step member 0 was three things at once: Raphael, the app's guide; the first slime the owner named, dressed
and gave a job (kept in settings, not in a row); and the default chief of staff. From here on member 0 is Raphael
alone, with its own fixed name and look, and the quick ask. What the owner made of member 0 becomes a normal slime:

- If member 0 was customized (a profile, a tool list, a routine, a pin), a NEW `members` row (id N) takes its name,
  role, personality, instructions, picture, tools, model, notify and draft settings, pin and computer choice, and every
  row of its own moves to N: its standard conversations with their turns, tasks, cards, pages and unread marks, its
  routines, skills and commands, its place in rooms and the messages it wrote there, its memory, summary, spend and
  calendar entries. The quick conversation, with its turns, stays with 0. If nobody else was the chief, N is.
- Raphael returns to its factory settings: the profile, tool list, pin, notify and draft settings are reset.
- A member 0 that was never customized has nothing to move: Raphael stays alone and no empty slime is made.
- Whoever the chief is, the chair is never Raphael's: with no member flagged, the first visible slime is.

The step is idempotent (`settings.raphael_split` records that it ran and which row took over, which also tells the
files step, `members/raphael_files.py`, what to move on disk) and runs in the one transaction of its schema step.
A database migrated here cannot be opened by an older build.
"""

import json
import sqlite3

SPLIT_KEY = "raphael_split"
PROFILE_KEYS = ("name", "role", "personality", "instructions", "avatar")
FIRST_SLIME = "slime:blue-plain"
# The name of a slime made from a member 0 that never had one of its own (or kept one of Raphael's).
FALLBACK_NAMES = {"zh": "小史萊姆", "ja": "スライム", "ko": "슬라임"}
RAPHAEL_NAMES = {"拉斐爾", "raphael", "ラファエル", "拉斐尔", "라파엘", "рафаэль", "ราฟาเอล"}

# Rows that belong to member 0 whatever conversation they are in: (table, column).
_PLAIN = (
    ("routines", "member_id"), ("member_skills", "member_id"), ("member_commands", "member_id"),
    ("member_template_cards", "member_id"), ("conversation_summaries", "member_id"), ("spend", "member_id"),
    ("room_members", "member_id"), ("room_member_cursor", "member_id"), ("room_exchange_turns", "member_id"),
    ("room_cli_sessions", "member_id"), ("room_messages", "member_id"), ("room_messages", "reply_to_member"),
    ("room_reply_intents", "recipient_id"), ("computer_grants", "member_id"), ("computer_seats", "member_id"),
    ("calendar_events", "added_by"), ("email_drafts", "author_id"), ("email_drafts", "holder_id"),
    ("worker_tasks", "from_member_id"),
)
# Rows of a conversation: they stay with 0 when the conversation is the quick one.
_BY_CONVERSATION = (
    "agent_turns", "agent_inbox", "pages", "permission_cards", "connect_cards", "connection_proposals",
    "secret_cards", "handback_cards", "voice_calls", "member_unread",
)
# Rows of a turn: they stay with 0 when the turn is a quick one.
_BY_TURN = (("owner_questions", "turn_id"), ("computer_suggestions", "turn_id"), ("messaging_pairing_cards", "turn_id"))


def _has(conn: sqlite3.Connection, table: str, column: str | None = None) -> bool:
    if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone() is None:
        return False
    return column is None or any(row[1] == column for row in conn.execute(f"PRAGMA table_info({table})"))


def _settings(conn: sqlite3.Connection) -> dict:
    values = {}
    for key, raw in conn.execute("SELECT key, value FROM settings"):
        try:
            values[key] = json.loads(raw)
        except (TypeError, ValueError):
            pass
    return values


def _put(conn: sqlite3.Connection, key: str, value) -> None:
    conn.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                 (key, json.dumps(value, ensure_ascii=False)))


def _customized(conn: sqlite3.Connection, settings: dict) -> bool:
    profile = settings.get("first_bot_profile")
    if isinstance(profile, dict) and any(isinstance(profile.get(key), str) and profile[key].strip() for key in PROFILE_KEYS):
        return True
    if settings.get("raphael_tools") is not None or settings.get("chief_pinned") is True:
        return True
    return conn.execute("SELECT 1 FROM routines WHERE member_id = 0 LIMIT 1").fetchone() is not None


def _name(conn: sqlite3.Connection, wanted, settings: dict) -> str:
    name = " ".join(wanted.split()) if isinstance(wanted, str) else ""
    if not name or name.casefold() in RAPHAEL_NAMES:
        languages = settings.get("languages")
        first = languages[0] if isinstance(languages, list) and languages and isinstance(languages[0], str) else ""
        name = FALLBACK_NAMES.get(first.split("-")[0], "Slime")
    taken = {row[0].casefold() for row in conn.execute("SELECT name FROM members")}
    candidate, number = name, 1
    while candidate.casefold() in taken:
        number += 1
        candidate = f"{name} {number}"
    return candidate


def _create_slime(conn: sqlite3.Connection, settings: dict) -> int:
    profile = settings.get("first_bot_profile") if isinstance(settings.get("first_bot_profile"), dict) else {}
    text = lambda key: profile.get(key) if isinstance(profile.get(key), str) else ""  # noqa: E731
    avatar = text("avatar") if text("avatar").startswith("slime:") else FIRST_SLIME
    tools = settings.get("raphael_tools")
    model = settings.get("agent_model")
    mode = settings.get("raphael_computer_mode")
    (position,) = conn.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM members").fetchone()
    created = conn.execute("SELECT COALESCE(MIN(created_at_ms), 0) FROM agent_turns WHERE member_id = 0").fetchone()[0]
    cursor = conn.execute(
        "INSERT INTO members (name, role, instructions, avatar, group_id, model, position, created_at_ms, tools, personality,"
        " notify, pinned, draft_first, computer_mode) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (_name(conn, text("name"), settings), text("role"), text("instructions"), avatar,
         model.strip() if isinstance(model, str) else "", position, created or 1,
         json.dumps(tools, ensure_ascii=False) if isinstance(tools, list) else None, text("personality"),
         int(bool(settings.get("raphael_notify"))), int(settings.get("chief_pinned") is True),
         0 if settings.get("raphael_draft_first") is False else 1, mode if mode in ("host", "docker") else "host"),
    )
    return int(cursor.lastrowid)


def _move(conn: sqlite3.Connection, slime: int) -> None:
    quick = [row[0] for row in conn.execute("SELECT id FROM conversations WHERE kind = 'quick'")]
    quick_sql = ",".join(str(int(cid)) for cid in quick) or "NULL"
    quick_turns = f"(SELECT id FROM agent_turns WHERE conversation_id IN ({quick_sql}))"
    # Conversations first: a turn's scope trigger wants its conversation to belong to the member it names.
    conn.execute("UPDATE conversations SET member_id = ? WHERE member_id = 0 AND kind = 'standard'", (slime,))
    for table in _BY_CONVERSATION:
        if not _has(conn, table, "member_id"):
            continue
        by = "conversation_id" if _has(conn, table, "conversation_id") else None
        keep = f" AND COALESCE({by}, -1) NOT IN ({quick_sql})" if by else ""
        conn.execute(f"UPDATE {table} SET member_id = ? WHERE member_id = 0{keep}", (slime,))
    conn.execute(f"UPDATE agent_turns SET peer_id = ? WHERE peer_id = 0 AND id NOT IN {quick_turns}", (slime,))
    conn.execute(f"UPDATE worker_tasks SET member_id = ? WHERE member_id = 0 AND COALESCE(turn_id, -1) NOT IN {quick_turns}", (slime,))
    conn.execute(
        f"UPDATE worker_questions SET member_id = ? WHERE member_id = 0 AND task_id NOT IN"
        f" (SELECT id FROM worker_tasks WHERE turn_id IN {quick_turns})", (slime,))
    for table, column in _BY_TURN:
        if _has(conn, table, "member_id"):
            conn.execute(f"UPDATE {table} SET member_id = ? WHERE member_id = 0 AND COALESCE({column}, -1) NOT IN {quick_turns}", (slime,))
    # What the slime's bot says and hears is the slime's own account now (`messaging.service.member_account`).
    for table in ("agent_turns", "worker_tasks"):
        for platform in ("telegram", "slack", "discord"):
            conn.execute(f"UPDATE {table} SET session_id = ? || session_id WHERE member_id = ? AND session_id LIKE ?",
                         (f"member:{slime}:", slime, f"{platform}:%"))
    conn.execute("UPDATE messaging_pairing_cards SET account = 'member:' || member_id || ':' || account"
                 " WHERE member_id = ? AND account IN ('telegram', 'slack', 'discord')", (slime,))
    # A message written as a reply in a room is checked against its thread when its writer changes: the relabel keeps every
    # pair of writers apart, so the check is lifted for the one statement and put back as it was.
    trigger = conn.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='room_message_scope_update'").fetchone()
    if trigger:
        conn.execute("DROP TRIGGER room_message_scope_update")
    for table, column in _PLAIN:
        if _has(conn, table, column):
            conn.execute(f"UPDATE {table} SET {column} = ? WHERE {column} = 0", (slime,))
    if trigger:
        conn.execute(trigger[0])
    for room, roles, responder in conn.execute("SELECT id, roles, default_responder FROM rooms").fetchall():
        try:
            parsed = json.loads(roles)
        except (TypeError, ValueError):
            parsed = {}
        if isinstance(parsed, dict) and "0" in parsed:
            parsed[str(slime)] = parsed.pop("0")
            conn.execute("UPDATE rooms SET roles = ? WHERE id = ?", (json.dumps(parsed, ensure_ascii=False), room))
        if responder == "member:0":
            conn.execute("UPDATE rooms SET default_responder = ? WHERE id = ?", (f"member:{slime}", room))
    # Memory: its entries, its indexed logs and the marks of what was folded in.
    conn.execute("UPDATE OR IGNORE memory_entry_metadata SET scope = ? WHERE scope = 'member:0'", (f"member:{slime}",))
    conn.execute("UPDATE OR IGNORE memory_search_documents SET member_id = ? WHERE member_id = 0", (slime,))
    for key, value in conn.execute("SELECT key, value FROM memory_state").fetchall():
        moved = None
        if key == "reflected_through":
            moved = f"reflected_through:{slime}"
        elif key.startswith("skills:0:"):
            moved = f"skills:{slime}:" + key[len("skills:0:"):]
        elif key.startswith("summary_fragment:0:"):
            moved = f"summary_fragment:{slime}:" + key[len("summary_fragment:0:"):]
        if moved:
            conn.execute("INSERT OR REPLACE INTO memory_state (key, value) VALUES (?, ?)", (moved, value))
            conn.execute("DELETE FROM memory_state WHERE key = ?", (key,))
    # What the vault lets a member use stays usable by the slime (Raphael, the keeper, keeps its own access).
    for entry, members in conn.execute("SELECT id, members FROM vault_entries").fetchall():
        try:
            allowed = json.loads(members)
        except (TypeError, ValueError):
            continue
        if isinstance(allowed, list) and 0 in allowed and slime not in allowed:
            conn.execute("UPDATE vault_entries SET members = ? WHERE id = ?", (json.dumps([*allowed, slime]), entry))


def _leave_rooms(conn: sqlite3.Connection) -> None:
    """Raphael, never a slime, does not sit in a group chat: where it did as the chief, the chief takes its seat."""
    chief = conn.execute("SELECT id FROM members WHERE primary_contact = 1").fetchone()
    if chief is None:
        return
    rooms = [row[0] for row in conn.execute("SELECT room_id FROM room_members WHERE member_id = 0")]
    for room in rooms:
        conn.execute("INSERT OR IGNORE INTO room_members (room_id, member_id) VALUES (?, ?)", (room, chief[0]))
    conn.execute("DELETE FROM room_members WHERE member_id = 0")


def separate(conn: sqlite3.Connection) -> None:
    settings = _settings(conn)
    with conn:
        if SPLIT_KEY not in settings and _customized(conn, settings):
            slime = _create_slime(conn, settings)
            _move(conn, slime)
            # The work folder the owner chose for member 0 is the slime's.
            folders = settings.get("member_work_folder")
            if isinstance(folders, dict) and "0" in folders:
                folders[str(slime)] = folders.pop("0")
                _put(conn, "member_work_folder", folders)
            # Raphael is back to its factory settings.
            for key, default in (("first_bot_profile", {}), ("chief_pinned", False), ("raphael_draft_first", True),
                                 ("raphael_computer_mode", "host"), ("raphael_tools", None), ("raphael_notify", False)):
                _put(conn, key, default)
            _put(conn, SPLIT_KEY, {"slime": slime})
            # Nobody else was the chief: the slime that was Raphael is.
            if conn.execute("SELECT 1 FROM members WHERE primary_contact = 1").fetchone() is None:
                conn.execute("UPDATE members SET primary_contact = 1 WHERE id = ?", (slime,))
        # The chair is never Raphael's: with a visible slime and nobody flagged, the first one is the chief.
        if conn.execute("SELECT 1 FROM members WHERE primary_contact = 1").fetchone() is None:
            row = conn.execute("SELECT id FROM members WHERE hidden = 0 ORDER BY pinned DESC, position, id LIMIT 1").fetchone()
            if row is not None:
                conn.execute("UPDATE members SET primary_contact = 1 WHERE id = ?", (row[0],))
        _leave_rooms(conn)
        conn.execute("PRAGMA user_version = 101")

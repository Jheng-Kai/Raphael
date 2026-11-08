"""The brain's SQLite database: opening it and keeping its schema current.

One connection is shared by all the stores. sqlite3 lets only the thread that opened a connection
use it, so open it on the thread that runs the brain's handlers.
"""

import json
import sqlite3
from collections.abc import Callable
from pathlib import Path

from .mishearing import may_become_rule
from .room_scope import migrate as _migrate_room_scope
from .textnorm import replacement_key

# A migration is one transaction that also sets user_version, so a failure cannot leave half a
# schema behind with the version still saying "empty". One that has to look at the data is a
# function (v3, v4) instead of a script.
_MIGRATION_V1 = """
BEGIN;
CREATE TABLE history (id INTEGER PRIMARY KEY, created_at_ms INTEGER NOT NULL, kind TEXT NOT NULL,
  raw_text TEXT NOT NULL, text TEXT NOT NULL, cleaned INTEGER NOT NULL, fallback_reason TEXT,
  target_app TEXT, audio_seconds REAL NOT NULL, stt_ms INTEGER NOT NULL, llm_ms INTEGER NOT NULL,
  model TEXT, cost_usd REAL NOT NULL DEFAULT 0);
CREATE INDEX history_created ON history(created_at_ms);
CREATE TABLE dictionary (id INTEGER PRIMARY KEY, word TEXT NOT NULL UNIQUE,
  misheard TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL DEFAULT 'manual',
  created_at_ms INTEGER NOT NULL);
CREATE TABLE dismissed_suggestions (word TEXT PRIMARY KEY);
CREATE TABLE spend (id INTEGER PRIMARY KEY, created_at_ms INTEGER NOT NULL, purpose TEXT NOT NULL,
  model TEXT, cost_usd REAL NOT NULL, prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
PRAGMA user_version = 1;
COMMIT;
"""

# v2: which speech-to-text heard each dictation (a cloud model's slug or a local engine's name,
# several joined with "+" when the cloud fell back for part of it); NULL for older rows.
_MIGRATION_V2 = """
BEGIN;
ALTER TABLE history ADD COLUMN stt TEXT;
PRAGMA user_version = 2;
COMMIT;
"""


def _adopt_learned_evidence(conn: sqlite3.Connection) -> None:
    """Create `dictionary_evidence` and sort the learned forms into rules and hints.

    A pair learned from a correction used to become a replacement rule at once. Now it is a rule
    only when its form is distinctive, the two sound alike (`mishearing.may_become_rule`) and the
    pair has been seen twice; until then the form is a hint. So here the forms of the learned
    entries (source "learned") that fail that test stop being rules and become hints, pending
    evidence: they are not deleted, and the word stays. The forms that pass stay rules, and are
    recorded as learned (status "rule") so that a correction by the user can still undo them. What
    the user typed (the manual and suggested entries, forms included) is left alone.

    Runs inside the caller's transaction and is safe to run twice.
    """
    conn.execute(
        "CREATE TABLE IF NOT EXISTS dictionary_evidence (word_key TEXT NOT NULL,"
        " form_key TEXT NOT NULL, form TEXT NOT NULL, count INTEGER NOT NULL, status TEXT NOT NULL,"
        " updated_at_ms INTEGER NOT NULL, PRIMARY KEY (word_key, form_key))"
    )
    entries = conn.execute(
        "SELECT id, word, misheard, created_at_ms FROM dictionary WHERE source = 'learned'"
    ).fetchall()
    for entry_id, word, misheard, created_at_ms in entries:
        try:
            forms = json.loads(misheard)
        except ValueError:
            continue
        if not isinstance(forms, list) or not all(isinstance(form, str) for form in forms):
            continue
        kept: list[str] = []
        for form in forms:
            is_rule = may_become_rule(word, form)
            if is_rule:
                kept.append(form)
            conn.execute(
                "INSERT OR IGNORE INTO dictionary_evidence"
                " (word_key, form_key, form, count, status, updated_at_ms)"
                " VALUES (?, ?, ?, 1, ?, ?)",
                (
                    replacement_key(word),
                    replacement_key(form),
                    form,
                    "rule" if is_rule else "pending",
                    created_at_ms,
                ),
            )
        if kept != forms:
            conn.execute(
                "UPDATE dictionary SET misheard = ? WHERE id = ?",
                (json.dumps(kept, ensure_ascii=False), entry_id),
            )


def _migrate_v3(conn: sqlite3.Connection) -> None:
    """v3: the evidence behind the pairs the brain learns from corrections (see above).

    Like the scripts above, one transaction with the version.
    """
    conn.execute("BEGIN")
    _adopt_learned_evidence(conn)
    conn.execute("PRAGMA user_version = 3")
    conn.execute("COMMIT")


def _migrate_v4(conn: sqlite3.Connection) -> None:
    """v4: make sure the v3 evidence exists, whichever v3 a database went through.

    An unreleased task-runner build also numbered its own schema v3 (`assistant_runs` and
    `budget_requests`, left in place and unused here). A database that reached v3 that way never
    got `dictionary_evidence`, so it is made here; for one that did, this changes nothing.
    """
    conn.execute("BEGIN")
    exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'dictionary_evidence'"
    ).fetchone()
    if not exists:
        _adopt_learned_evidence(conn)
    conn.execute("PRAGMA user_version = 4")
    conn.execute("COMMIT")


# v5: what the voice assistant was asked and what it answered, one row for each turn
# (raphael_core.agent.history). `status` is "done", "confirm" (waiting for a yes or a no),
# "denied", "expired" or "error"; `detail` is the longer text of an answer, if it had one.
_MIGRATION_V5 = """
BEGIN;
CREATE TABLE agent_turns (id INTEGER PRIMARY KEY, created_at_ms INTEGER NOT NULL,
  session_id TEXT NOT NULL, question TEXT NOT NULL, route TEXT NOT NULL, prefix TEXT NOT NULL,
  text TEXT NOT NULL, detail TEXT, status TEXT NOT NULL, cost_usd REAL NOT NULL DEFAULT 0);
CREATE INDEX agent_turns_created ON agent_turns(created_at_ms);
PRAGMA user_version = 5;
COMMIT;
"""

# v6: once the table of iCal calendars for a Today card on Home. The feature was removed, and a
# version number is never reused (a database may already be at 6), so v6 stays and makes nothing.
_MIGRATION_V6 = """
BEGIN;
PRAGMA user_version = 6;
COMMIT;
"""

# v7: drops the calendars table that v6 once made. A new database never has it, hence IF EXISTS.
_MIGRATION_V7 = """
BEGIN;
DROP TABLE IF EXISTS calendars;
PRAGMA user_version = 7;
COMMIT;
"""

# v8: what the plugins' tools were asked to do (raphael_core.integrations.audit), one row for
# each call: when, which server and tool, at which tier, who approved ("auto", "user" or
# "none") and how it ended. It holds no arguments and no results.
_MIGRATION_V8 = """
BEGIN;
CREATE TABLE tool_audit (id INTEGER PRIMARY KEY, at_ms INTEGER NOT NULL, server TEXT NOT NULL,
  tool TEXT NOT NULL, tier TEXT, approver TEXT NOT NULL, outcome TEXT NOT NULL);
CREATE INDEX tool_audit_at ON tool_audit(at_ms);
PRAGMA user_version = 8;
COMMIT;
"""

# v9: the background worker (raphael_core.background). `worker_tasks` is one row for each task:
# what was handed over (`text`, which is what the user said, so it is cleared with the assistant's
# history), how it stands (`state`: queued, running, done, failed, limit, cancelled or
# interrupted) and the report it ended with. `worker_steps` is one row for each model call and each
# tool call of a task: which tool, at which tier, how it ended and what it cost; never an
# argument or a result. `tool_audit.task_id` ties a tool call to the task that made it.
_MIGRATION_V9 = """
BEGIN;
ALTER TABLE tool_audit ADD COLUMN task_id INTEGER;
CREATE TABLE worker_tasks (id INTEGER PRIMARY KEY, created_at_ms INTEGER NOT NULL,
  started_at_ms INTEGER, finished_at_ms INTEGER, state TEXT NOT NULL, session_id TEXT NOT NULL,
  turn_id INTEGER, language TEXT NOT NULL, text TEXT NOT NULL, report_prefix TEXT,
  report_text TEXT, report_detail TEXT, reason TEXT, model_calls INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0);
CREATE INDEX worker_tasks_created ON worker_tasks(created_at_ms);
CREATE TABLE worker_steps (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL, n INTEGER NOT NULL,
  at_ms INTEGER NOT NULL, kind TEXT NOT NULL, tool TEXT, server TEXT, tier TEXT,
  outcome TEXT NOT NULL, cost_usd REAL NOT NULL DEFAULT 0, ms INTEGER NOT NULL DEFAULT 0);
CREATE INDEX worker_steps_task ON worker_steps(task_id, n);
PRAGMA user_version = 9;
COMMIT;
"""

# v10: what opening anything taught Raphael (raphael_core.agent.targets), one row for each name
# of a web page that opened: the name as it was said (`name_key`, short, in lower case) and the
# address it opened. Never what was said around it. It is cleared with the assistant's history
# and pruned by `last_used_ms`.
_MIGRATION_V10 = """
BEGIN;
CREATE TABLE open_targets (name_key TEXT PRIMARY KEY, url TEXT NOT NULL,
  uses INTEGER NOT NULL DEFAULT 1, last_used_ms INTEGER NOT NULL);
CREATE INDEX open_targets_used ON open_targets(last_used_ms);
PRAGMA user_version = 10;
COMMIT;
"""

# v11: what the conversation view shows of a turn. `agent_turns.source` is where the request came
# from ("voice", or a chat app such as "telegram") and `model` the model that answered, if one did.
# `agent_steps` is one row for each thing the fast tier did for a turn (a lookup, a plugin's tool, a
# command for this computer): which tool of which server, how it ended, how long it took and, when
# it failed, a short classified reason (`agent.steps.REASONS`). `worker_steps.reason` is the same
# for the background worker. Like the audit, never an argument or a result, nor an error message,
# which a service may write with what it was given in it.
_MIGRATION_V11 = """
BEGIN;
ALTER TABLE agent_turns ADD COLUMN source TEXT NOT NULL DEFAULT 'voice';
ALTER TABLE agent_turns ADD COLUMN model TEXT;
ALTER TABLE worker_steps ADD COLUMN reason TEXT;
CREATE TABLE agent_steps (id INTEGER PRIMARY KEY, turn_id INTEGER NOT NULL, n INTEGER NOT NULL,
  at_ms INTEGER NOT NULL, kind TEXT NOT NULL, tool TEXT NOT NULL, server TEXT,
  outcome TEXT NOT NULL, ms INTEGER NOT NULL DEFAULT 0, reason TEXT);
CREATE INDEX agent_steps_turn ON agent_steps(turn_id, n);
PRAGMA user_version = 11;
COMMIT;
"""

# v12: `worker_tasks.announced` is 0 for the report of a task that was interrupted and has not been
# said yet (it is said once, when the app next says hello), and `rerun_of` the task a rerun started
# again.
_MIGRATION_V12 = """
BEGIN;
ALTER TABLE worker_tasks ADD COLUMN announced INTEGER NOT NULL DEFAULT 1;
ALTER TABLE worker_tasks ADD COLUMN rerun_of INTEGER;
PRAGMA user_version = 12;
COMMIT;
"""

def create_turn_search(conn: sqlite3.Connection) -> None:
    """Create `agent_turns_fts`, the search over the assistant's turns, if it is not there.

    It is an FTS5 table of two columns, `pairs` and `chars`, made in Python from the question and
    the answer of each turn (`memory.terms.index_terms`), its rowid the turn's id. If this SQLite has
    no FTS5 it is a plain table of the same columns instead, and the search reads it with LIKE
    (`AgentHistory.search` tells the two apart by the table's SQL). Python's own SQLite has had FTS5
    since 3.9; the plain table is for a build that left it out."""
    try:
        conn.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS agent_turns_fts USING fts5(pairs, chars,"
            " tokenize = 'unicode61 remove_diacritics 0')"
        )
    except sqlite3.OperationalError:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS agent_turns_fts (rowid INTEGER PRIMARY KEY,"
            " pairs TEXT NOT NULL, chars TEXT NOT NULL)"
        )


def _migrate_v13(conn: sqlite3.Connection) -> None:
    """v13: one continuous conversation with Raphael, and what it is searched by.

    - `agent_summary` is the rolling summary of the conversation (`memory.conversation`): one row,
      its text and the last turn it covers. The turns after it are the ones the model reads as
      they were said.
    - `memory_state` holds the few numbers the memory keeps between runs (the last turn the
      reflection pass read, when the memory was last consolidated), by name.
    - `agent_turns_fts` is the search over the turns (`create_turn_search`), filled here with the
      turns there already are.

    Like the others, one transaction with the version.
    """
    from ..memory.terms import index_terms  # the brain must not need the memory to import

    conn.execute("BEGIN")
    conn.execute(
        "CREATE TABLE agent_summary (id INTEGER PRIMARY KEY CHECK (id = 1), text TEXT NOT NULL,"
        " through_turn_id INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL)"
    )
    conn.execute("CREATE TABLE memory_state (key TEXT PRIMARY KEY, value INTEGER NOT NULL)")
    create_turn_search(conn)
    rows = conn.execute("SELECT id, question, text, detail FROM agent_turns").fetchall()
    for turn_id, question, text, detail in rows:
        terms = index_terms(question, text, detail)
        conn.execute(
            "INSERT INTO agent_turns_fts (rowid, pairs, chars) VALUES (?, ?, ?)",
            (turn_id, terms.pairs, terms.chars),
        )
    conn.execute("PRAGMA user_version = 13")
    conn.execute("COMMIT")


# v14: what the tools of the services left in a turn. `agent_turns.attachments` is the files the
# owner handed Raphael with the request, as JSON (`[{"name", "mime"}]`, so the conversation view can
# show which), or NULL: never a byte of them, which stay in memory for the turn. `agent_steps.detail`
# and `worker_steps.detail` say which service a step used (the search engine of a web search, the
# reader of a page, "image" or "pdf" for a file read), as one word of a fixed list: never what it
# was given.
_MIGRATION_V14 = """
BEGIN;
ALTER TABLE agent_turns ADD COLUMN attachments TEXT;
ALTER TABLE agent_steps ADD COLUMN detail TEXT;
ALTER TABLE worker_steps ADD COLUMN detail TEXT;
PRAGMA user_version = 14;
COMMIT;
"""


# v15: the members of the owner's team (raphael_core.members), each with a conversation of its own.
#
# - `agent_turns.member_id` is whose thread a turn is in: 0 for Raphael (every turn there was until
#   now), else the id of a row of `members`. `agent_turns.peer_id` is, for an exchange between two
#   of them (`route` "exchange": one asked the other through `ask_member`), the other one.
# - `worker_tasks.member_id` is whose task it is (0: Raphael's), and `worker_tasks.routine_id` the
#   routine that started it, if one did.
# - `conversation_summaries` is the rolling summary of each conversation, one row a member, Raphael's
#   as member 0; it takes the place of `agent_summary`, whose one row becomes Raphael's.
# - `member_groups` are the groups of the member column: a name, a place, and the places their
#   members look for progress (`sources`, JSON: `[{kind, ref}]`, GitHub or Notion).
# - `members` are the members themselves. `avatar` is "", "preset:<stem>" or "file:<name>" (a copy
#   in the app's local folder, never the path it came from); `model` "" is the answer model; `tools`
#   JSON is the tools and connections it may use, NULL for every one that is on.
# - `routines` are what a member does on a schedule (`schedule` JSON), with when it last ran and
#   when it runs next.
# - `member_unread` holds the members (Raphael too, as 0) whose thread has news the owner has not
#   seen.
#
# The members and the safety rules (v16) were built side by side, and each first took the number 15.
# A database can therefore be at 15 with either of them, so neither migration assumes what the other
# made: each part is applied only where it is missing (`_add_members`, `_add_safety`), v15 applies
# the members, and v16 applies both, which for a database that went through this v15 adds only the
# safety rules, and for one that took the other v15 adds only the members.
_MEMBERS_TABLES = (
    "CREATE TABLE IF NOT EXISTS member_groups (id INTEGER PRIMARY KEY AUTOINCREMENT,"
    " name TEXT NOT NULL, position INTEGER NOT NULL, sources TEXT NOT NULL DEFAULT '[]')",
    "CREATE TABLE IF NOT EXISTS members (id INTEGER PRIMARY KEY AUTOINCREMENT,"
    " name TEXT NOT NULL UNIQUE COLLATE NOCASE, role TEXT NOT NULL DEFAULT '',"
    " instructions TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '', group_id INTEGER,"
    " model TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL, created_at_ms INTEGER NOT NULL,"
    " tools TEXT)",
    "CREATE TABLE IF NOT EXISTS routines (id INTEGER PRIMARY KEY AUTOINCREMENT,"
    " member_id INTEGER NOT NULL, title TEXT NOT NULL, prompt TEXT NOT NULL,"
    " schedule TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, last_run_ms INTEGER,"
    " next_run_ms INTEGER, created_at_ms INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS routines_member ON routines(member_id)",
    "CREATE TABLE IF NOT EXISTS member_unread (member_id INTEGER PRIMARY KEY)",
)

# v16: the owner's safety rules, and the questions the background waits on.
#
# - `safety_rules` is one row for each rule (`agent.safety`): the owner's own words for an action
#   (one line, at most 80 characters), what Raphael does when an action falls under it (`ask`,
#   `allow` or `deny`) and its place in the list. `safety_state` says, by the key "seeded", that the
#   three rules of the first run were put there once (they are not put back when deleted).
# - `worker_questions` is one row for each question a background task asked the owner
#   (`background.service`): the task, the member whose thread it shows in (0 is Raphael), its
#   prefix and its line as the card says it, the tier it was asked at, when it was asked and when it
#   runs out (24 hours later), the task's time that was left when it paused, and how it ended
#   (`waiting`, `approved`, `denied`, `expired`, `cancelled`). The line names the service and the
#   tool and shows the start of what it is given, as a question of the fast tier does in the
#   history; never the whole of it. The questions go with their tasks.
_SAFETY_TABLES = (
    "CREATE TABLE IF NOT EXISTS safety_rules (id INTEGER PRIMARY KEY, action TEXT NOT NULL,"
    " verdict TEXT NOT NULL, position INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS safety_state (key TEXT PRIMARY KEY, value INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS worker_questions (id TEXT PRIMARY KEY, task_id INTEGER NOT NULL,"
    " member_id INTEGER NOT NULL DEFAULT 0, prefix TEXT NOT NULL, text TEXT NOT NULL, tier TEXT,"
    " created_at_ms INTEGER NOT NULL, expires_at_ms INTEGER NOT NULL, remaining_s REAL NOT NULL,"
    " state TEXT NOT NULL DEFAULT 'waiting', answered_at_ms INTEGER)",
    "CREATE INDEX IF NOT EXISTS worker_questions_task ON worker_questions(task_id)",
)


def _has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    """Whether `table` has a column named `column`."""
    return any(row[1] == column for row in conn.execute(f"PRAGMA table_info({table})"))


def _has_table(conn: sqlite3.Connection, table: str) -> bool:
    """Whether a table named `table` exists."""
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
    ).fetchone()
    return row is not None


def _add_members(conn: sqlite3.Connection) -> None:
    """Add the members' part of the schema (see v15) where it is missing; safe to run twice.

    Runs inside the caller's transaction. `agent_summary`'s one row becomes Raphael's row of
    `conversation_summaries` only while `agent_summary` is still there, so a second run moves
    nothing."""
    for table, column, decl in (
        ("agent_turns", "member_id", "INTEGER NOT NULL DEFAULT 0"),
        ("agent_turns", "peer_id", "INTEGER"),
        ("worker_tasks", "member_id", "INTEGER NOT NULL DEFAULT 0"),
        ("worker_tasks", "routine_id", "INTEGER"),
    ):
        if not _has_column(conn, table, column):
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")
    conn.execute("CREATE INDEX IF NOT EXISTS agent_turns_member ON agent_turns(member_id, id)")
    conn.execute(
        "CREATE TABLE IF NOT EXISTS conversation_summaries (member_id INTEGER PRIMARY KEY,"
        " text TEXT NOT NULL, through_turn_id INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL)"
    )
    if _has_table(conn, "agent_summary"):
        conn.execute(
            "INSERT OR IGNORE INTO conversation_summaries"
            " (member_id, text, through_turn_id, updated_at_ms)"
            " SELECT 0, text, through_turn_id, updated_at_ms FROM agent_summary"
        )
        conn.execute("DROP TABLE agent_summary")
    for statement in _MEMBERS_TABLES:
        conn.execute(statement)


def _add_safety(conn: sqlite3.Connection) -> None:
    """Add the safety rules' part of the schema (see v16) where it is missing; safe to run twice.

    Runs inside the caller's transaction."""
    for statement in _SAFETY_TABLES:
        conn.execute(statement)


def _migrate_v15(conn: sqlite3.Connection) -> None:
    """v15: the members of the owner's team (see the notes above `_MEMBERS_TABLES`).

    Like the others, one transaction with the version."""
    conn.execute("BEGIN")
    _add_members(conn)
    conn.execute("PRAGMA user_version = 15")
    conn.execute("COMMIT")


def _migrate_v16(conn: sqlite3.Connection) -> None:
    """v16: the owner's safety rules and the background's questions (see `_SAFETY_TABLES`).

    It also applies the members' part where it is missing, for a database that took the safety
    rules' own v15 before the two were numbered apart. One transaction with the version."""
    conn.execute("BEGIN")
    _add_members(conn)
    _add_safety(conn)
    conn.execute("PRAGMA user_version = 16")
    conn.execute("COMMIT")


def _migrate_v20(conn: sqlite3.Connection) -> None:
    from dataclasses import asdict
    from .stats_recovery import estimate_recovery

    conn.execute("BEGIN")
    conn.execute(
        "CREATE TABLE dictation_daily (day TEXT PRIMARY KEY NOT NULL,"
        " dictations INTEGER NOT NULL DEFAULT 0, words INTEGER NOT NULL DEFAULT 0,"
        " audio_seconds REAL NOT NULL DEFAULT 0, processing_ms INTEGER NOT NULL DEFAULT 0,"
        " estimated INTEGER NOT NULL DEFAULT 0, estimated_words INTEGER NOT NULL DEFAULT 0,"
        " estimated_dictations INTEGER NOT NULL DEFAULT 0)"
    )
    plan = estimate_recovery(conn)
    conn.executemany(
        "INSERT INTO dictation_daily (day, dictations, words, audio_seconds, processing_ms,"
        " estimated, estimated_words, estimated_dictations) VALUES"
        " (:day, :dictations, :words, :audio_seconds, :processing_ms,"
        " :estimated, :estimated_words, :estimated_dictations)",
        [asdict(day) for day in plan.days.values()],
    )
    conn.execute("PRAGMA user_version = 20")
    conn.commit()


_MIGRATIONS: dict[int, str | Callable[[sqlite3.Connection], None]] = {
    1: _MIGRATION_V1,
    2: _MIGRATION_V2,
    3: _migrate_v3,
    4: _migrate_v4,
    5: _MIGRATION_V5,
    6: _MIGRATION_V6,
    7: _MIGRATION_V7,
    8: _MIGRATION_V8,
    9: _MIGRATION_V9,
    10: _MIGRATION_V10,
    11: _MIGRATION_V11,
    12: _MIGRATION_V12,
    13: _migrate_v13,
    14: _MIGRATION_V14,
    15: _migrate_v15,
    16: _migrate_v16,
    17: """
BEGIN;
CREATE TABLE agent_messages (
    turn_id INTEGER NOT NULL REFERENCES agent_turns(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('progress', 'reply', 'event')),
    text TEXT NOT NULL,
    at_ms INTEGER NOT NULL,
    PRIMARY KEY (turn_id, seq)
);
PRAGMA user_version = 17;
COMMIT;
""",
    18: """
BEGIN;
ALTER TABLE agent_messages RENAME TO agent_messages_v17;
CREATE TABLE agent_messages (
    turn_id INTEGER NOT NULL REFERENCES agent_turns(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('progress', 'reply', 'event', 'thinking', 'media')),
    text TEXT NOT NULL,
    at_ms INTEGER NOT NULL,
    PRIMARY KEY (turn_id, seq)
);
INSERT INTO agent_messages SELECT * FROM agent_messages_v17;
DROP TABLE agent_messages_v17;
PRAGMA user_version = 18;
COMMIT;
""",
    19: """
BEGIN;
ALTER TABLE members ADD COLUMN personality TEXT NOT NULL DEFAULT '';
PRAGMA user_version = 19;
COMMIT;
""",
    20: _migrate_v20,
    21: """
BEGIN;
ALTER TABLE agent_turns ADD COLUMN quote TEXT;
PRAGMA user_version = 21;
COMMIT;
""",
    22: """
BEGIN;
ALTER TABLE members ADD COLUMN blurb TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN reply_style TEXT NOT NULL DEFAULT 'full' CHECK (reply_style IN ('full', 'conversational'));
ALTER TABLE members ADD COLUMN voice TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN read_aloud INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN notify INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN ask_before_members INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
CREATE TABLE member_skills (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER NOT NULL,
  name TEXT NOT NULL, description TEXT NOT NULL, source TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE(member_id, name));
CREATE INDEX member_skills_member ON member_skills(member_id);
CREATE TABLE member_commands (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE, description TEXT NOT NULL, template TEXT NOT NULL,
  UNIQUE(member_id, name));
CREATE INDEX member_commands_member ON member_commands(member_id);
PRAGMA user_version = 22;
COMMIT;
""",
}
_MIGRATIONS[23] = """
BEGIN;
CREATE TABLE routine_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    started INTEGER NOT NULL,
    scheduled INTEGER,
    finished INTEGER,
    status TEXT NOT NULL,
    turn_id INTEGER REFERENCES agent_turns(id) ON DELETE SET NULL,
    summary TEXT NOT NULL DEFAULT '',
    cost REAL NOT NULL DEFAULT 0
);
CREATE INDEX routine_runs_routine ON routine_runs(routine_id, id);
CREATE TABLE rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    group_id INTEGER REFERENCES member_groups(id) ON DELETE SET NULL,
    created INTEGER NOT NULL,
    is_team INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX rooms_team ON rooms(is_team) WHERE is_team = 1;
CREATE TABLE room_members (
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL,
    PRIMARY KEY(room_id, member_id)
);
CREATE TABLE room_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    member_id INTEGER,
    text TEXT NOT NULL,
    created INTEGER NOT NULL,
    request_id TEXT,
    attachments TEXT,
    reply_to INTEGER REFERENCES room_messages(id) ON DELETE CASCADE,
    turn_id INTEGER REFERENCES agent_turns(id) ON DELETE SET NULL,
    UNIQUE(room_id, request_id),
    UNIQUE(reply_to, member_id)
);
CREATE INDEX room_messages_room ON room_messages(room_id, id);
PRAGMA user_version = 23;
COMMIT;
"""
_MIGRATIONS[24] = """
BEGIN;
CREATE TABLE conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX conversations_member ON conversations(member_id, updated_at_ms DESC);
CREATE UNIQUE INDEX conversations_default ON conversations(member_id) WHERE is_default = 1;
INSERT INTO conversations (member_id, title, created_at_ms, updated_at_ms, is_default)
SELECT m.id,
       COALESCE((SELECT substr(trim(replace(replace(replace(question, char(10), ' '), char(13), ' '), char(9), ' ')), 1, 80) FROM agent_turns WHERE member_id = m.id ORDER BY id LIMIT 1), ''),
       COALESCE((SELECT MIN(created_at_ms) FROM agent_turns WHERE member_id = m.id), CAST(strftime('%s', 'now') AS INTEGER) * 1000),
       COALESCE((SELECT MAX(created_at_ms) FROM agent_turns WHERE member_id = m.id), CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1
FROM (SELECT 0 AS id UNION SELECT id FROM members UNION SELECT member_id FROM agent_turns) m;
ALTER TABLE agent_turns ADD COLUMN conversation_id INTEGER REFERENCES conversations(id);
UPDATE agent_turns SET conversation_id = (SELECT id FROM conversations WHERE member_id = agent_turns.member_id AND is_default = 1);
CREATE INDEX agent_turns_conversation ON agent_turns(conversation_id, id);
CREATE TABLE conversation_context_summaries (
    conversation_id INTEGER PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    through_turn_id INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
);
CREATE TABLE agent_conversation_cli_sessions (
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    brain TEXT NOT NULL,
    session_id TEXT NOT NULL,
    PRIMARY KEY(conversation_id, brain)
);
CREATE TRIGGER delete_member_conversations AFTER DELETE ON members
BEGIN
    DELETE FROM conversation_context_summaries WHERE conversation_id IN (SELECT id FROM conversations WHERE member_id = OLD.id);
    DELETE FROM agent_conversation_cli_sessions WHERE conversation_id IN (SELECT id FROM conversations WHERE member_id = OLD.id);
    DELETE FROM conversations WHERE member_id = OLD.id;
END;
CREATE TABLE subscription_quotas (
    provider TEXT PRIMARY KEY NOT NULL,
    reset_at_ms INTEGER,
    updated_at_ms INTEGER NOT NULL
);
PRAGMA user_version = 24;
COMMIT;
"""
_MIGRATIONS[25] = """
BEGIN;
CREATE TABLE run_metrics (kind TEXT NOT NULL CHECK(kind IN ('turn','task')), run_id INTEGER NOT NULL,
  started_at_ms INTEGER NOT NULL, finished_at_ms INTEGER, tokens INTEGER NOT NULL DEFAULT 0,
  ai_steps INTEGER NOT NULL DEFAULT 0, model_spans TEXT NOT NULL DEFAULT '[]', PRIMARY KEY(kind,run_id));
CREATE TRIGGER clear_turn_metrics AFTER DELETE ON agent_turns BEGIN
  DELETE FROM run_metrics WHERE kind='turn' AND run_id=OLD.id;
END;
CREATE TRIGGER clear_task_metrics AFTER DELETE ON worker_tasks BEGIN
  DELETE FROM run_metrics WHERE kind='task' AND run_id=OLD.id;
END;
PRAGMA user_version = 25;
COMMIT;
"""
_MIGRATIONS[26] = """
BEGIN;
CREATE TABLE subscription_allowances (
    provider TEXT NOT NULL,
    period TEXT NOT NULL,
    remaining_percent REAL,
    resets_at INTEGER,
    status TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY(provider, period)
);
PRAGMA user_version = 26;
COMMIT;
"""
_MIGRATIONS[27] = """
BEGIN;
ALTER TABLE room_messages ADD COLUMN reply_to_member INTEGER;
ALTER TABLE room_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'message' CHECK(kind IN ('message','wrapup'));
ALTER TABLE room_messages ADD COLUMN origin_message_id INTEGER REFERENCES room_messages(id) ON DELETE CASCADE;
ALTER TABLE room_messages ADD COLUMN exchange_settled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN default_responder TEXT NOT NULL DEFAULT 'auto';
CREATE TABLE room_exchanges (
    origin_message_id INTEGER PRIMARY KEY REFERENCES room_messages(id) ON DELETE CASCADE,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK(state IN ('queued','running','done','stopped')),
    language TEXT NOT NULL,
    pending TEXT,
    active_turn INTEGER REFERENCES agent_turns(id) ON DELETE SET NULL,
    turns_taken INTEGER NOT NULL DEFAULT 0,
    spoken TEXT NOT NULL DEFAULT '[]',
    hops INTEGER NOT NULL DEFAULT 0,
    chime_ins INTEGER NOT NULL DEFAULT 0,
    cost REAL NOT NULL DEFAULT 0,
    stop_requested INTEGER NOT NULL DEFAULT 0,
    wrapup_sent INTEGER NOT NULL DEFAULT 0,
    reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX room_exchanges_room ON room_exchanges(room_id, origin_message_id);
PRAGMA user_version = 27;
COMMIT;
"""
_MIGRATIONS[28] = """
BEGIN;
ALTER TABLE conversations ADD COLUMN kind TEXT NOT NULL DEFAULT 'standard'
    CHECK(kind IN ('standard', 'quick'));
CREATE UNIQUE INDEX one_quick_conversation ON conversations(kind) WHERE kind = 'quick';
CREATE TRIGGER quick_owner_insert BEFORE INSERT ON conversations
WHEN NEW.kind = 'quick' AND (NEW.member_id != 0 OR NEW.is_default != 0)
BEGIN SELECT RAISE(ABORT, 'quick conversations belong to Raphael'); END;
CREATE TRIGGER quick_owner_update BEFORE UPDATE ON conversations
WHEN NEW.kind = 'quick' AND (NEW.member_id != 0 OR NEW.is_default != 0)
BEGIN SELECT RAISE(ABORT, 'quick conversations belong to Raphael'); END;
PRAGMA user_version = 28;
COMMIT;
"""
_MIGRATIONS[29] = _migrate_room_scope
_MIGRATIONS[30] = """
BEGIN;
ALTER TABLE rooms ADD COLUMN roles TEXT NOT NULL DEFAULT '{}';
ALTER TABLE room_exchanges ADD COLUMN routing TEXT NOT NULL DEFAULT '{}';
CREATE TABLE room_reply_intents (
    id INTEGER PRIMARY KEY,
    origin_message_id INTEGER NOT NULL REFERENCES room_exchanges(origin_message_id) ON DELETE CASCADE,
    source_message_id INTEGER NOT NULL REFERENCES room_messages(id) ON DELETE CASCADE,
    recipient_id INTEGER NOT NULL,
    recipient_name TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','done','blocked')),
    reason TEXT NOT NULL DEFAULT '',
    turn_id INTEGER REFERENCES agent_turns(id) ON DELETE SET NULL,
    UNIQUE(origin_message_id, source_message_id, recipient_id)
);
INSERT OR IGNORE INTO room_reply_intents
    (origin_message_id, source_message_id, recipient_id, recipient_name, state, turn_id)
SELECT e.origin_message_id, m.reply_to, m.member_id, COALESCE(p.name, 'Raphael'), 'running', m.turn_id
FROM room_exchanges e JOIN room_messages m ON m.turn_id=e.active_turn
LEFT JOIN members p ON p.id=m.member_id
WHERE e.state IN ('queued','running') AND m.reply_to IS NOT NULL AND m.kind='message';
INSERT OR IGNORE INTO room_reply_intents
    (origin_message_id, source_message_id, recipient_id, recipient_name)
SELECT e.origin_message_id, COALESCE(json_extract(q.value,'$.reply_to'),e.origin_message_id),
       json_extract(q.value,'$.member'), COALESCE(p.name,'Raphael')
FROM room_exchanges e, json_each(CASE WHEN json_valid(e.pending) THEN e.pending ELSE '[]' END) q
LEFT JOIN members p ON p.id=json_extract(q.value,'$.member')
WHERE e.state IN ('queued','running') AND json_type(q.value,'$.member')='integer'
  AND EXISTS(SELECT 1 FROM room_messages s WHERE s.id=COALESCE(json_extract(q.value,'$.reply_to'),e.origin_message_id)
             AND s.room_id=e.room_id AND s.member_id IS NOT json_extract(q.value,'$.member'));
PRAGMA user_version = 30;
COMMIT;
"""
_MIGRATIONS[31] = """
BEGIN;
ALTER TABLE worker_tasks ADD COLUMN parent_task_id INTEGER;
ALTER TABLE worker_tasks ADD COLUMN root_task_id INTEGER;
ALTER TABLE worker_tasks ADD COLUMN stage_id TEXT;
ALTER TABLE worker_tasks ADD COLUMN from_member_id INTEGER;
ALTER TABLE worker_tasks ADD COLUMN source_turn_id INTEGER;
ALTER TABLE worker_tasks ADD COLUMN model_ref TEXT;
ALTER TABLE worker_tasks ADD COLUMN mode TEXT;
ALTER TABLE worker_tasks ADD COLUMN done_when TEXT NOT NULL DEFAULT '';
ALTER TABLE worker_tasks ADD COLUMN idempotency_key TEXT;
ALTER TABLE worker_tasks ADD COLUMN ready_at_ms INTEGER;
ALTER TABLE worker_tasks ADD COLUMN dispatch_policy TEXT NOT NULL DEFAULT 'immediate';
ALTER TABLE worker_tasks ADD COLUMN schedule_provenance TEXT NOT NULL DEFAULT '{}';
ALTER TABLE worker_tasks ADD COLUMN continuation TEXT;
CREATE UNIQUE INDEX worker_handoff_key ON worker_tasks(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX worker_task_parent ON worker_tasks(parent_task_id, state);
CREATE TABLE task_executions (
    id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES worker_tasks(id) ON DELETE CASCADE,
    attempt INTEGER NOT NULL, state TEXT NOT NULL, effective_model TEXT,
    started_at_ms INTEGER NOT NULL, ended_at_ms INTEGER, outcome TEXT,
    UNIQUE(task_id, attempt)
);
CREATE UNIQUE INDEX task_one_execution ON task_executions(task_id) WHERE state='running';
CREATE TABLE task_outbox (
    event_id TEXT PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES worker_tasks(id) ON DELETE CASCADE,
    type TEXT NOT NULL, destination_turn_id INTEGER NOT NULL, room_id INTEGER, thread_id INTEGER,
    created_at_ms INTEGER NOT NULL, delivered_at_ms INTEGER, disposition TEXT
);
CREATE TABLE task_inbox (
    event_id TEXT PRIMARY KEY REFERENCES task_outbox(event_id) ON DELETE CASCADE,
    parent_task_id INTEGER REFERENCES worker_tasks(id) ON DELETE CASCADE,
    consumed_at_ms INTEGER
);
CREATE TABLE task_evidence (
    id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES worker_tasks(id) ON DELETE CASCADE,
    tool_call_id TEXT NOT NULL, kind TEXT NOT NULL, uri TEXT NOT NULL, digest TEXT NOT NULL,
    mime TEXT NOT NULL, scope TEXT NOT NULL, verified_at_ms INTEGER NOT NULL, verdict TEXT NOT NULL,
    UNIQUE(task_id, tool_call_id, uri)
);
PRAGMA user_version = 31;
COMMIT;
"""
_MIGRATIONS[32] = """
BEGIN;
ALTER TABLE worker_tasks ADD COLUMN generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE task_evidence ADD COLUMN workspace TEXT;
CREATE TABLE task_stage_owners (
    scope_key TEXT NOT NULL, stage_id TEXT NOT NULL, owner_task_id INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued', reason TEXT NOT NULL DEFAULT '',
    PRIMARY KEY(scope_key, stage_id)
);
PRAGMA user_version = 32;
COMMIT;
"""
# v33: a member may reply to one message more than once (a second meeting round, several reply
# intents, a hand-off result), so the first group chat's UNIQUE(reply_to, member_id) goes. The
# table is rebuilt as v29 made it otherwise; deduplication stays with request_id and the
# exchange's own state. The sequence is carried over so a deleted message's id is never reused.
_MIGRATIONS[33] = """
BEGIN;
CREATE TABLE room_messages_v33 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    member_id INTEGER, text TEXT NOT NULL, created INTEGER NOT NULL,
    request_id TEXT, attachments TEXT, reply_to INTEGER,
    turn_id INTEGER REFERENCES agent_turns(id) ON DELETE SET NULL,
    reply_to_member INTEGER,
    kind TEXT NOT NULL DEFAULT 'message' CHECK(kind IN ('message','wrapup')),
    origin_message_id INTEGER, exchange_settled INTEGER NOT NULL DEFAULT 0,
    thread_id INTEGER REFERENCES room_threads(id),
    UNIQUE(room_id,request_id)
);
INSERT INTO room_messages_v33 SELECT * FROM room_messages;
UPDATE sqlite_sequence SET seq=MAX(seq,(SELECT seq FROM sqlite_sequence WHERE name='room_messages'))
WHERE name='room_messages_v33' AND EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='room_messages');
DROP TABLE room_messages;
ALTER TABLE room_messages_v33 RENAME TO room_messages;
CREATE INDEX room_messages_room ON room_messages(room_id,id);
CREATE TRIGGER room_message_thread AFTER INSERT ON room_messages WHEN NEW.thread_id IS NULL BEGIN
    UPDATE room_messages SET thread_id=(SELECT id FROM room_threads WHERE room_id=NEW.room_id ORDER BY id LIMIT 1) WHERE id=NEW.id;
END;
CREATE TRIGGER room_message_scope_insert BEFORE INSERT ON room_messages
WHEN NEW.thread_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM room_threads WHERE id=NEW.thread_id AND room_id=NEW.room_id)
BEGIN SELECT RAISE(ABORT,'cross-scope room thread'); END;
CREATE TRIGGER room_reply_insert BEFORE INSERT ON room_messages WHEN NEW.reply_to IS NOT NULL
AND NOT EXISTS(SELECT 1 FROM room_messages s WHERE s.id=NEW.reply_to AND s.room_id=NEW.room_id
    AND (NEW.thread_id IS NULL OR s.thread_id=NEW.thread_id) AND s.member_id IS NOT NEW.member_id)
BEGIN SELECT RAISE(ABORT,'invalid room reply'); END;
CREATE TRIGGER room_message_scope_update BEFORE UPDATE OF room_id, thread_id, reply_to, member_id ON room_messages
WHEN NOT EXISTS(SELECT 1 FROM room_threads WHERE id=NEW.thread_id AND room_id=NEW.room_id)
OR (NEW.reply_to IS NOT NULL AND NOT EXISTS(SELECT 1 FROM room_messages s WHERE s.id=NEW.reply_to
    AND s.room_id=NEW.room_id AND s.thread_id=NEW.thread_id AND s.member_id IS NOT NEW.member_id))
BEGIN SELECT RAISE(ABORT,'invalid room message scope or reply'); END;
PRAGMA user_version = 33;
COMMIT;
"""
# A room's parts open one meeting: the owner's next message after they are saved, not every message after.
_MIGRATIONS[34] = """
BEGIN;
ALTER TABLE rooms ADD COLUMN meeting_pending INTEGER NOT NULL DEFAULT 0;
PRAGMA user_version = 34;
COMMIT;
"""
# An exchange remembers that it is a meeting: the room keeps its moderator after one, and later work is handed off.
_MIGRATIONS[35] = """
BEGIN;
ALTER TABLE room_exchanges ADD COLUMN meeting INTEGER NOT NULL DEFAULT 0;
PRAGMA user_version = 35;
COMMIT;
"""
# A chat's connector cards (`connectors.cards`): the app a turn's task waits for, how its sign-in
# stands, and the one resume of that task. `done` holds digests of what the task already did,
# never arguments.
_MIGRATIONS[36] = """
BEGIN;
CREATE TABLE connect_cards (
    id TEXT PRIMARY KEY,
    turn_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    conversation_id INTEGER,
    app TEXT NOT NULL,
    language TEXT NOT NULL,
    reconnect INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL CHECK(state IN ('pending','authorizing','connected','failed','cancelled','expired')),
    error TEXT NOT NULL DEFAULT '',
    tool_count INTEGER,
    done TEXT NOT NULL DEFAULT '[]',
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL,
    resumed_at_ms INTEGER,
    UNIQUE(turn_id, app)
);
PRAGMA user_version = 36;
COMMIT;
"""
# The two cards that pause a chat's task for the owner and resume it once: a secret the task needs
# (`connectors.secret_cards`) and the owner's turn at the computer (`computer.handback`). A card names
# the connection and the secret it declares, and the app of the window; no row ever holds a value
# the owner typed or anything seen on a screen. `done` holds digests of what the task already did.
_MIGRATIONS[37] = """
BEGIN;
CREATE TABLE secret_cards (
    id TEXT PRIMARY KEY,
    turn_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    conversation_id INTEGER,
    server_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('env','header')),
    secret TEXT NOT NULL,
    name TEXT NOT NULL,
    language TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('pending','failed','saved','resuming','resumed','cancelled','expired')),
    error TEXT NOT NULL DEFAULT '',
    attempts INTEGER NOT NULL DEFAULT 0,
    done TEXT NOT NULL DEFAULT '[]',
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL,
    resumed_at_ms INTEGER,
    UNIQUE(turn_id, server_id, kind, secret)
);
CREATE TABLE handback_cards (
    id TEXT PRIMARY KEY,
    turn_id INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    conversation_id INTEGER,
    run_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    app TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('control','returning','done','stopped','expired','failed')),
    error TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    done TEXT NOT NULL DEFAULT '[]',
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL,
    returned_at_ms INTEGER,
    UNIQUE(turn_id, seq)
);
CREATE TRIGGER clear_secret_cards AFTER DELETE ON agent_turns BEGIN
  DELETE FROM secret_cards WHERE turn_id=OLD.id;
END;
CREATE TRIGGER clear_handback_cards AFTER DELETE ON agent_turns BEGIN
  DELETE FROM handback_cards WHERE turn_id=OLD.id;
END;
PRAGMA user_version = 37;
COMMIT;
"""
# The owner's approval and the mail they send from a chat (`agent.permissions`, `agent.drafts`).
# - A narrow rule of Always (`safety_rules.scope`) covers one tool; the rules in the owner's words keep "".
# - A permission card is the owner's yes or no to one action in a typed private chat, bound to the
#   digest of that action (`policy.action_digest`). It names the service and the tool and says the
#   action in plain words; it keeps no argument beyond that line.
# - An email draft is an artifact the owner edits in a chat and sends once: its head holds the current
#   version, `email_draft_versions` every version with the digest that a send is bound to. A draft is
#   shown on the turn of the chat that holds it (`turn_id`); one handed to a colleague moves there.
# - `members.draft_first`: the member writes mail as a draft for the owner to send, not as a send.
_MIGRATIONS[38] = """
BEGIN;
ALTER TABLE safety_rules ADD COLUMN scope TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN draft_first INTEGER NOT NULL DEFAULT 1;
CREATE TABLE permission_cards (
    id TEXT PRIMARY KEY,
    turn_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    conversation_id INTEGER,
    source TEXT NOT NULL CHECK(source IN ('ask','run')),
    kind TEXT NOT NULL CHECK(kind IN ('tool','app','step')),
    service TEXT NOT NULL DEFAULT '',
    tool TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    digest TEXT NOT NULL,
    always INTEGER NOT NULL DEFAULT 0,
    language TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('pending','allowed','always','denied','expired','cancelled')),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL
);
CREATE INDEX permission_cards_by_turn ON permission_cards(turn_id);
CREATE TABLE email_drafts (
    id TEXT PRIMARY KEY,
    author_id INTEGER NOT NULL,
    holder_id INTEGER NOT NULL,
    conversation_id INTEGER,
    turn_id INTEGER NOT NULL,
    origin_turn_id INTEGER NOT NULL,
    language TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('draft','sending','sent','failed','discarded')),
    version INTEGER NOT NULL,
    digest TEXT NOT NULL,
    send_via TEXT NOT NULL DEFAULT '',
    to_addr TEXT NOT NULL DEFAULT '',
    cc_addr TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    offer_to INTEGER,
    offer_state TEXT NOT NULL DEFAULT '' CHECK(offer_state IN ('','pending','declined')),
    error TEXT NOT NULL DEFAULT '',
    sent_digest TEXT NOT NULL DEFAULT '',
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    sent_at_ms INTEGER
);
CREATE INDEX email_drafts_by_turn ON email_drafts(turn_id);
CREATE INDEX email_drafts_by_origin ON email_drafts(origin_turn_id);
CREATE TABLE email_draft_versions (
    draft_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    digest TEXT NOT NULL,
    send_via TEXT NOT NULL DEFAULT '',
    to_addr TEXT NOT NULL DEFAULT '',
    cc_addr TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    by_owner INTEGER NOT NULL DEFAULT 0,
    at_ms INTEGER NOT NULL,
    PRIMARY KEY(draft_id, version)
);
CREATE TRIGGER clear_permission_cards AFTER DELETE ON agent_turns BEGIN
  DELETE FROM permission_cards WHERE turn_id=OLD.id;
END;
CREATE TRIGGER clear_email_drafts AFTER DELETE ON agent_turns BEGIN
  DELETE FROM email_draft_versions WHERE draft_id IN
    (SELECT id FROM email_drafts WHERE turn_id=OLD.id OR origin_turn_id=OLD.id);
  DELETE FROM email_drafts WHERE turn_id=OLD.id OR origin_turn_id=OLD.id;
END;
PRAGMA user_version = 38;
COMMIT;
"""
# The owner's primary contact (`members.set_primary`, `agent.team_context`): the one member whose row carries the flag,
# and Raphael (member 0, who is no row) while none does. The unique index keeps it to one, and a member that is deleted
# stops being it with its row.
_MIGRATIONS[39] = """
BEGIN;
ALTER TABLE members ADD COLUMN primary_contact INTEGER NOT NULL DEFAULT 0 CHECK (primary_contact IN (0, 1));
CREATE UNIQUE INDEX one_primary_contact ON members(primary_contact) WHERE primary_contact = 1;
PRAGMA user_version = 39;
COMMIT;
"""
from .conversation_cleanup import migrate as _conversation_cleanup

_MIGRATIONS[40] = _conversation_cleanup
_MIGRATIONS[41] = """
BEGIN;
DROP TRIGGER room_chief_required;
CREATE TRIGGER room_chief_required BEFORE DELETE ON room_members
WHEN OLD.member_id=COALESCE((SELECT id FROM members WHERE primary_contact=1),0)
AND EXISTS(SELECT 1 FROM rooms WHERE id=OLD.room_id AND is_team=0)
BEGIN SELECT RAISE(ABORT,'The chief cannot leave a room'); END;
PRAGMA user_version = 41;
COMMIT;
"""
_MIGRATIONS[42] = """
BEGIN;
ALTER TABLE connect_cards ADD COLUMN app_name TEXT NOT NULL DEFAULT '';
ALTER TABLE connect_cards ADD COLUMN provider TEXT NOT NULL DEFAULT 'google';
PRAGMA user_version = 42;
COMMIT;
"""
_MIGRATIONS[43] = """
BEGIN;
ALTER TABLE connect_cards ADD COLUMN app_logo TEXT NOT NULL DEFAULT '';
PRAGMA user_version = 43;
COMMIT;
"""
_MIGRATIONS[44] = """
BEGIN;
ALTER TABLE rooms ADD COLUMN read_message_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
PRAGMA user_version = 44;
COMMIT;
"""
_MIGRATIONS[45] = """
BEGIN;
CREATE TABLE computer_grants (
    member_id INTEGER PRIMARY KEY,
    granted INTEGER NOT NULL CHECK(granted IN (0, 1)),
    updated_at_ms INTEGER NOT NULL
);
CREATE TRIGGER clear_computer_grant AFTER DELETE ON members BEGIN
  DELETE FROM computer_grants WHERE member_id=OLD.id;
END;
PRAGMA user_version = 45;
COMMIT;
"""
_MIGRATIONS[46] = """
BEGIN;
CREATE TABLE pages (
    id TEXT PRIMARY KEY,
    turn_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    conversation_id INTEGER,
    title TEXT NOT NULL,
    html TEXT NOT NULL,
    fallback TEXT NOT NULL,
    height INTEGER NOT NULL,
    rev INTEGER NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('html', 'mcp')),
    server TEXT,
    tool TEXT,
    tool_input TEXT NOT NULL,
    tool_result TEXT NOT NULL,
    network TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
);
CREATE INDEX pages_by_turn ON pages(turn_id);
CREATE TABLE page_revisions (
    page_id TEXT NOT NULL,
    rev INTEGER NOT NULL,
    title TEXT NOT NULL,
    html TEXT NOT NULL,
    at_ms INTEGER NOT NULL,
    PRIMARY KEY(page_id, rev)
);
CREATE TRIGGER clear_page_revisions AFTER DELETE ON pages BEGIN
  DELETE FROM page_revisions WHERE page_id=OLD.id;
END;
CREATE TRIGGER clear_turn_pages AFTER DELETE ON agent_turns BEGIN
  DELETE FROM pages WHERE turn_id=OLD.id;
END;
CREATE TRIGGER clear_conversation_pages AFTER DELETE ON conversations BEGIN
  DELETE FROM pages WHERE conversation_id=OLD.id;
END;
CREATE TRIGGER clear_member_pages AFTER DELETE ON members BEGIN
  DELETE FROM pages WHERE member_id=OLD.id;
END;
PRAGMA user_version = 46;
COMMIT;
"""
# One model answers for every member, chosen in one place: what the composer used to save per member goes.
_MIGRATIONS[47] = """
BEGIN;
UPDATE members SET model = '';
PRAGMA user_version = 47;
COMMIT;
"""
# The app's own calendar (`own_calendar`): a timed event is two instants, an all-day one two local dates, the last included.
_MIGRATIONS[48] = """
BEGIN;
CREATE TABLE calendar_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  start_ms INTEGER,
  end_ms INTEGER,
  start_date TEXT,
  end_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  added_by INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX calendar_events_timed ON calendar_events(start_ms);
CREATE INDEX calendar_events_all_day ON calendar_events(start_date);
PRAGMA user_version = 48;
COMMIT;
"""

_MIGRATIONS[49] = """
BEGIN;
CREATE TABLE owner_questions (
    id TEXT PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES worker_tasks(id) ON DELETE CASCADE,
    turn_id INTEGER NOT NULL REFERENCES agent_turns(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    card_id TEXT NOT NULL DEFAULT '',
    payload TEXT NOT NULL,
    result TEXT,
    created_at_ms INTEGER NOT NULL
);
CREATE UNIQUE INDEX owner_question_wait ON owner_questions(task_id) WHERE result IS NULL;
CREATE INDEX owner_question_turn ON owner_questions(turn_id);
CREATE TRIGGER clear_turn_owner_questions AFTER DELETE ON agent_turns BEGIN
  DELETE FROM owner_questions WHERE turn_id=OLD.id;
END;
CREATE TRIGGER clear_task_owner_questions AFTER DELETE ON worker_tasks BEGIN
  DELETE FROM owner_questions WHERE task_id=OLD.id;
END;
PRAGMA user_version = 49;
COMMIT;
"""

_MIGRATIONS[50] = """
BEGIN;
ALTER TABLE routines ADD COLUMN when_json TEXT;
ALTER TABLE routines ADD COLUMN app_name TEXT NOT NULL DEFAULT '';
ALTER TABLE routines ADD COLUMN last_checked_ms INTEGER;
ALTER TABLE routines ADD COLUMN last_error TEXT NOT NULL DEFAULT '';
ALTER TABLE routines ADD COLUMN poll_initialized INTEGER NOT NULL DEFAULT 0;
ALTER TABLE routines ADD COLUMN poll_failures INTEGER NOT NULL DEFAULT 0;
CREATE TABLE routine_receipts (
  routine_id INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  item TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL,
  PRIMARY KEY(routine_id,item_id)
);
CREATE TRIGGER clear_routine_receipts AFTER DELETE ON routines BEGIN
  DELETE FROM routine_receipts WHERE routine_id=OLD.id;
END;
PRAGMA user_version = 50;
COMMIT;
"""

# Each member answers on its own model again. Those migration 47 cleared keep what they answer on today, so that Raphael's
# next change moves none of them. The literal is the default of this version, for an owner who has never chosen one.
_MIGRATIONS[51] = """
BEGIN;
UPDATE members SET model = COALESCE((SELECT json_extract(value, '$') FROM settings WHERE key = 'agent_model'), 'openai/gpt-6-luna')
WHERE model = '';
PRAGMA user_version = 51;
COMMIT;
"""

# Login cards keep the existing secret-card flow and preserve all outstanding connection cards.
_MIGRATIONS[52] = """
BEGIN;
DROP TRIGGER clear_secret_cards;
ALTER TABLE secret_cards RENAME TO secret_cards_previous;
CREATE TABLE secret_cards (
    id TEXT PRIMARY KEY,
    turn_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    conversation_id INTEGER,
    server_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('env','header','login')),
    secret TEXT NOT NULL,
    name TEXT NOT NULL,
    language TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('pending','failed','saved','resuming','resumed','cancelled','expired')),
    error TEXT NOT NULL DEFAULT '',
    attempts INTEGER NOT NULL DEFAULT 0,
    done TEXT NOT NULL DEFAULT '[]',
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL,
    resumed_at_ms INTEGER,
    UNIQUE(turn_id, server_id, kind, secret)
);
INSERT INTO secret_cards SELECT * FROM secret_cards_previous;
DROP TABLE secret_cards_previous;
CREATE TRIGGER clear_secret_cards AFTER DELETE ON agent_turns BEGIN
  DELETE FROM secret_cards WHERE turn_id=OLD.id;
END;
CREATE TABLE computer_logins (
    member_id INTEGER NOT NULL,
    origin TEXT NOT NULL,
    reference TEXT NOT NULL UNIQUE,
    PRIMARY KEY(member_id, origin)
);
PRAGMA user_version = 52;
COMMIT;
"""

_MIGRATIONS[53] = """
BEGIN;
CREATE TABLE connection_proposals (
  id TEXT PRIMARY KEY,
  turn_id INTEGER NOT NULL REFERENCES agent_turns(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL,
  conversation_id INTEGER,
  language TEXT NOT NULL,
  server_id TEXT NOT NULL,
  fields TEXT NOT NULL,
  external INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  tested_digest TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  done TEXT NOT NULL DEFAULT '[]'
);
CREATE TRIGGER clear_connection_proposals AFTER DELETE ON agent_turns BEGIN
  DELETE FROM connection_proposals WHERE turn_id=OLD.id;
END;
PRAGMA user_version = 53;
COMMIT;
"""

def _merge_daily_windows(conn):
    import json
    import re
    from ..clock import wall_clock_ms
    from ..members.schedule import next_run, parse_schedule, ScheduleError

    groups = {}
    cursor = conn.execute("SELECT * FROM routines ORDER BY id")
    cursor.row_factory = sqlite3.Row
    for row in cursor.fetchall():
        try:
            schedule = parse_schedule(json.loads(row["schedule"]))
        except (ValueError, TypeError, ScheduleError):
            continue
        if schedule.kind != "daily" or schedule.start_date or schedule.until or schedule.max_runs or row["when_json"]:
            continue
        key = (row["member_id"], row["prompt"], row["app_name"], row["enabled"])
        groups.setdefault(key, []).append((row, schedule.time))
    with conn:
        for rows in groups.values():
            times = sorted(int(time[:2]) * 60 + int(time[3:]) for _, time in rows)
            if len(times) < 2:
                continue
            step = times[1] - times[0]
            if step <= 0 or step % 60 or any(b - a != step for a, b in zip(times, times[1:])):
                continue
            kept = rows[0][0]
            schedule = parse_schedule({"kind": "every", "hours": step // 60,
                                       "from": f"{times[0] // 60:02}:{times[0] % 60:02}",
                                       "to": f"{times[-1] // 60:02}:{times[-1] % 60:02}"})
            last = max((row["last_run_ms"] for row, _ in rows if row["last_run_ms"] is not None), default=None)
            title = re.sub(r"\s*[（(]\d{1,2}:\d{2}[）)]\s*$", "", kept["title"])
            conn.execute("UPDATE routines SET schedule=?,title=?,last_run_ms=?,next_run_ms=? WHERE id=?",
                         (json.dumps(schedule.to_json()), title, last, next_run(schedule, wall_clock_ms()) if kept["enabled"] else None, kept["id"]))
            for row, _ in rows[1:]:
                rid = row["id"]
                conn.execute("UPDATE routine_runs SET routine_id=? WHERE routine_id=?", (kept["id"], rid))
                conn.execute(
                    "INSERT INTO routine_receipts(routine_id,item_id,item,state) SELECT ?,item_id,item,state FROM routine_receipts WHERE routine_id=?"
                    " ON CONFLICT(routine_id,item_id) DO UPDATE SET item=excluded.item,state=excluded.state"
                    " WHERE (CASE excluded.state WHEN 'fired' THEN 2 WHEN 'pending' THEN 1 ELSE 0 END)"
                    " > (CASE routine_receipts.state WHEN 'fired' THEN 2 WHEN 'pending' THEN 1 ELSE 0 END)", (kept["id"], rid))
                conn.execute("DELETE FROM routine_receipts WHERE routine_id=?", (rid,))
                conn.execute("DELETE FROM routines WHERE id=?", (rid,))
        conn.execute("PRAGMA user_version = 54")


_MIGRATIONS[54] = _merge_daily_windows

_MIGRATIONS[55] = """
BEGIN;
ALTER TABLE routine_runs ADD COLUMN trigger_json TEXT NOT NULL DEFAULT '{}';
PRAGMA user_version = 55;
COMMIT;
"""

_MIGRATIONS[56] = """
BEGIN;
ALTER TABLE permission_cards ADD COLUMN message TEXT NOT NULL DEFAULT '{}';
PRAGMA user_version = 56;
COMMIT;
"""

_MIGRATIONS[57] = """
BEGIN;
ALTER TABLE member_unread ADD COLUMN unread_from INTEGER;
PRAGMA user_version = 57;
COMMIT;
"""

_MIGRATIONS[58] = """
BEGIN;
CREATE TABLE agent_inbox (
    turn_id INTEGER PRIMARY KEY REFERENCES agent_turns(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL,
    member_id INTEGER NOT NULL,
    conversation_id INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('queued','steering','started','terminal')),
    outcome TEXT,
    payload_json TEXT NOT NULL,
    boot_id TEXT,
    created_at_ms INTEGER NOT NULL,
    claimed_at_ms INTEGER,
    settled_at_ms INTEGER
);
CREATE UNIQUE INDEX agent_inbox_request ON agent_inbox(member_id, conversation_id, request_id) WHERE state!='terminal';
CREATE INDEX agent_inbox_scope ON agent_inbox(member_id, conversation_id, state, seq);
CREATE UNIQUE INDEX agent_inbox_started ON agent_inbox(member_id, conversation_id) WHERE state='started';
CREATE TRIGGER agent_inbox_delete AFTER DELETE ON agent_turns BEGIN
    DELETE FROM agent_inbox WHERE turn_id=OLD.id;
END;
PRAGMA user_version = 58;
COMMIT;
"""

_MIGRATIONS[59] = """
BEGIN;
ALTER TABLE worker_tasks ADD COLUMN requires_artifact INTEGER NOT NULL DEFAULT 0 CHECK (requires_artifact IN (0,1));
PRAGMA user_version = 59;
COMMIT;
"""

_ROOM_MEETING_SCHEMA = """
BEGIN;
CREATE TABLE room_messages_meeting (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    member_id INTEGER, text TEXT NOT NULL, created INTEGER NOT NULL,
    request_id TEXT, attachments TEXT, reply_to INTEGER,
    turn_id INTEGER REFERENCES agent_turns(id) ON DELETE SET NULL,
    reply_to_member INTEGER,
    kind TEXT NOT NULL DEFAULT 'message' CHECK(kind IN ('message','wrapup','report','decision')),
    origin_message_id INTEGER, exchange_settled INTEGER NOT NULL DEFAULT 0,
    thread_id INTEGER REFERENCES room_threads(id),
    UNIQUE(room_id,request_id)
);
INSERT INTO room_messages_meeting SELECT * FROM room_messages;
UPDATE sqlite_sequence SET seq=MAX(seq,(SELECT seq FROM sqlite_sequence WHERE name='room_messages'))
WHERE name='room_messages_meeting' AND EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='room_messages');
DROP TABLE room_messages;
ALTER TABLE room_messages_meeting RENAME TO room_messages;
CREATE INDEX room_messages_room ON room_messages(room_id,id);
CREATE TRIGGER room_message_thread AFTER INSERT ON room_messages WHEN NEW.thread_id IS NULL BEGIN
    UPDATE room_messages SET thread_id=(SELECT id FROM room_threads WHERE room_id=NEW.room_id ORDER BY id LIMIT 1) WHERE id=NEW.id;
END;
CREATE TRIGGER room_message_scope_insert BEFORE INSERT ON room_messages
WHEN NEW.thread_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM room_threads WHERE id=NEW.thread_id AND room_id=NEW.room_id)
BEGIN SELECT RAISE(ABORT,'cross-scope room thread'); END;
CREATE TRIGGER room_reply_insert BEFORE INSERT ON room_messages WHEN NEW.reply_to IS NOT NULL
AND NOT EXISTS(SELECT 1 FROM room_messages s WHERE s.id=NEW.reply_to AND s.room_id=NEW.room_id
    AND (NEW.thread_id IS NULL OR s.thread_id=NEW.thread_id) AND s.member_id IS NOT NEW.member_id)
BEGIN SELECT RAISE(ABORT,'invalid room reply'); END;
CREATE TRIGGER room_message_scope_update BEFORE UPDATE OF room_id, thread_id, reply_to, member_id ON room_messages
WHEN NOT EXISTS(SELECT 1 FROM room_threads WHERE id=NEW.thread_id AND room_id=NEW.room_id)
OR (NEW.reply_to IS NOT NULL AND NOT EXISTS(SELECT 1 FROM room_messages s WHERE s.id=NEW.reply_to
    AND s.room_id=NEW.room_id AND s.thread_id=NEW.thread_id AND s.member_id IS NOT NEW.member_id))
BEGIN SELECT RAISE(ABORT,'invalid room message scope or reply'); END;
ALTER TABLE worker_tasks ADD COLUMN report_room_id INTEGER;
ALTER TABLE worker_tasks ADD COLUMN report_thread_id INTEGER;
ALTER TABLE room_messages ADD COLUMN seen_through INTEGER;
ALTER TABLE room_messages ADD COLUMN report_task_id INTEGER;
ALTER TABLE room_reply_intents ADD COLUMN restart_count INTEGER NOT NULL DEFAULT 0;
CREATE TABLE room_exchange_turns (
    origin_message_id INTEGER NOT NULL REFERENCES room_exchanges(origin_message_id) ON DELETE CASCADE,
    turn_id INTEGER PRIMARY KEY REFERENCES agent_turns(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL,
    round INTEGER NOT NULL,
    seen_through INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'running'
);
INSERT INTO room_exchange_turns(origin_message_id,turn_id,member_id,round,seen_through)
SELECT e.origin_message_id,e.active_turn,t.member_id,e.chime_ins,e.origin_message_id
FROM room_exchanges e JOIN agent_turns t ON t.id=e.active_turn;
CREATE TABLE room_member_cursor (
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    thread_id INTEGER NOT NULL REFERENCES room_threads(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL,
    seen_message_id INTEGER NOT NULL,
    PRIMARY KEY(room_id,thread_id,member_id)
);
CREATE TABLE room_digest_requests (
    message_id INTEGER PRIMARY KEY REFERENCES room_messages(id) ON DELETE CASCADE
);
CREATE INDEX worker_report_room ON worker_tasks(report_room_id,report_thread_id);
PRAGMA user_version = 60;
COMMIT;
"""

def _meeting_migration(conn):
    # Rebuild the CHECK without cascading legacy messages into exchanges or intents.
    foreign_keys = conn.execute('PRAGMA foreign_keys').fetchone()[0]
    conn.execute('PRAGMA foreign_keys=OFF')
    try:
        conn.executescript(_ROOM_MEETING_SCHEMA)
    finally:
        if conn.in_transaction:
            conn.rollback()
        conn.execute(f'PRAGMA foreign_keys={foreign_keys}')


_MIGRATIONS[60] = _meeting_migration

_MIGRATIONS[61] = """
BEGIN;
CREATE TABLE member_skill_grants (
    member_id INTEGER NOT NULL,
    skill_id INTEGER NOT NULL REFERENCES member_skills(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
    PRIMARY KEY(member_id, skill_id)
);
CREATE TRIGGER delete_member_skill_grants AFTER DELETE ON members BEGIN
    DELETE FROM member_skill_grants WHERE member_id=OLD.id;
END;
CREATE TRIGGER delete_shared_skill_grants AFTER DELETE ON member_skills BEGIN
    DELETE FROM member_skill_grants WHERE skill_id=OLD.id;
END;
PRAGMA user_version = 61;
COMMIT;
"""

_MIGRATIONS[62] = """
BEGIN;
CREATE TABLE skill_marketplaces (
    repo TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    catalog TEXT NOT NULL
);
CREATE TABLE skill_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identity TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    source TEXT NOT NULL,
    description TEXT NOT NULL,
    folder TEXT NOT NULL,
    metadata TEXT NOT NULL
);
ALTER TABLE member_skills ADD COLUMN set_id INTEGER REFERENCES skill_sets(id) ON DELETE CASCADE;
ALTER TABLE member_skills ADD COLUMN set_key TEXT;
ALTER TABLE member_skills ADD COLUMN set_kind TEXT;
CREATE UNIQUE INDEX skill_set_key ON member_skills(set_id,set_key);
PRAGMA user_version = 62;
COMMIT;
"""

_MIGRATIONS[63] = """
BEGIN;
CREATE TABLE vault_entries (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('login','contact','card')),
    label TEXT NOT NULL,
    hint TEXT NOT NULL DEFAULT '',
    origin TEXT NOT NULL DEFAULT '',
    members TEXT NOT NULL,
    credential TEXT NOT NULL
);
CREATE TABLE computer_payment_holds (target TEXT PRIMARY KEY);
INSERT INTO vault_entries(id,kind,label,origin,members,credential)
SELECT reference,'login',origin,origin,json_array(member_id),'computer-login:' || reference FROM computer_logins;
PRAGMA user_version = 63;
COMMIT;
"""

_MIGRATIONS[64] = """
BEGIN;
ALTER TABLE room_threads ADD COLUMN parent_message_id INTEGER REFERENCES room_messages(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX room_thread_parent ON room_threads(parent_message_id) WHERE parent_message_id IS NOT NULL;
CREATE TABLE message_reactions (
    turn_id INTEGER NOT NULL REFERENCES agent_turns(id) ON DELETE CASCADE,
    message_key TEXT NOT NULL,
    emoji TEXT NOT NULL CHECK(emoji IN ('👍','❤','✓','?')),
    PRIMARY KEY(turn_id, message_key, emoji)
);
CREATE TABLE room_reactions (
    message_id INTEGER NOT NULL REFERENCES room_messages(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL CHECK(emoji IN ('👍','❤','✓','?')),
    PRIMARY KEY(message_id, emoji)
);
CREATE TRIGGER clear_message_reactions AFTER DELETE ON agent_turns BEGIN
    DELETE FROM message_reactions WHERE turn_id=OLD.id;
END;
CREATE TRIGGER clear_room_reactions AFTER DELETE ON room_messages BEGIN
    DELETE FROM room_reactions WHERE message_id=OLD.id;
    UPDATE room_threads SET parent_message_id=NULL WHERE parent_message_id=OLD.id;
END;
ALTER TABLE email_drafts ADD COLUMN kind TEXT NOT NULL DEFAULT 'email' CHECK(kind IN ('email','slack'));
ALTER TABLE members ADD COLUMN voice_memo INTEGER NOT NULL DEFAULT 0;
PRAGMA user_version = 64;
COMMIT;
"""

_MIGRATIONS[67] = """
BEGIN;
CREATE TABLE voice_calls (
    id TEXT PRIMARY KEY,
    member_id INTEGER NOT NULL,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    started_at_ms INTEGER NOT NULL,
    ended_at_ms INTEGER,
    summary_id INTEGER REFERENCES agent_turns(id) ON DELETE CASCADE,
    failure TEXT,
    rating TEXT CHECK(rating IN ('good','bad'))
);
CREATE TABLE voice_call_turns (
    call_id TEXT NOT NULL REFERENCES voice_calls(id) ON DELETE CASCADE,
    turn_id INTEGER NOT NULL UNIQUE REFERENCES agent_turns(id) ON DELETE CASCADE,
    PRIMARY KEY(call_id,turn_id)
);
CREATE TRIGGER clear_conversation_voice_calls AFTER DELETE ON conversations BEGIN
    DELETE FROM voice_calls WHERE conversation_id=OLD.id;
END;
CREATE TRIGGER clear_voice_call_turns AFTER DELETE ON voice_calls BEGIN
    DELETE FROM voice_call_turns WHERE call_id=OLD.id;
END;
CREATE TRIGGER clear_turn_voice_calls AFTER DELETE ON agent_turns BEGIN
    DELETE FROM voice_call_turns WHERE turn_id=OLD.id;
    DELETE FROM voice_calls WHERE summary_id=OLD.id;
END;
PRAGMA user_version = 67;
COMMIT;
"""

# Each member keeps one standard conversation; the quick conversation is independent.
_MIGRATIONS[68] = """
BEGIN;
CREATE TEMP TABLE conversation_fold AS
SELECT id AS source_id, member_id,
       FIRST_VALUE(id) OVER (
           PARTITION BY member_id ORDER BY is_default DESC, updated_at_ms DESC, id DESC
       ) AS target_id
FROM conversations WHERE kind = 'standard';

-- Prefer the target's admission, then the earliest admitted folded request.
CREATE TEMP TABLE conversation_fold_cancelled AS
SELECT turn_id FROM (
    SELECT i.turn_id, ROW_NUMBER() OVER (
        PARTITION BY i.member_id, f.target_id, i.request_id
        ORDER BY (f.source_id = f.target_id) DESC, i.turn_id
    ) AS position
    FROM agent_inbox i JOIN conversation_fold f ON f.source_id = i.conversation_id
    WHERE i.state != 'terminal'
) WHERE position > 1;
INSERT INTO conversation_fold_cancelled
SELECT turn_id FROM (
    SELECT i.turn_id, ROW_NUMBER() OVER (
        PARTITION BY i.member_id, f.target_id
        ORDER BY (f.source_id = f.target_id) DESC, i.turn_id
    ) AS position
    FROM agent_inbox i JOIN conversation_fold f ON f.source_id = i.conversation_id
    WHERE i.state = 'started' AND i.turn_id NOT IN (SELECT turn_id FROM conversation_fold_cancelled)
) WHERE position > 1;
UPDATE agent_turns SET status = 'denied'
WHERE id IN (SELECT turn_id FROM conversation_fold_cancelled);
UPDATE agent_inbox SET state = 'terminal', outcome = 'cancelled',
    settled_at_ms = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE turn_id IN (SELECT turn_id FROM conversation_fold_cancelled);

-- Per-conversation sequence numbers overlap; retain admission order in the merged FIFO.
CREATE TEMP TABLE conversation_fold_sequence AS
SELECT i.turn_id, ROW_NUMBER() OVER (PARTITION BY i.member_id, f.target_id ORDER BY i.turn_id) AS seq
FROM agent_inbox i JOIN conversation_fold f ON f.source_id = i.conversation_id
WHERE f.target_id IN (SELECT target_id FROM conversation_fold WHERE source_id != target_id);
UPDATE agent_inbox SET seq = (SELECT seq FROM conversation_fold_sequence s WHERE s.turn_id = agent_inbox.turn_id)
WHERE turn_id IN (SELECT turn_id FROM conversation_fold_sequence);

UPDATE agent_turns SET conversation_id = (SELECT target_id FROM conversation_fold WHERE source_id = conversation_id)
WHERE conversation_id IN (SELECT source_id FROM conversation_fold WHERE source_id != target_id);
UPDATE voice_calls SET conversation_id = (SELECT target_id FROM conversation_fold WHERE source_id = conversation_id)
WHERE conversation_id IN (SELECT source_id FROM conversation_fold WHERE source_id != target_id);
UPDATE connect_cards SET conversation_id = (SELECT target_id FROM conversation_fold WHERE source_id = conversation_id)
WHERE conversation_id IN (SELECT source_id FROM conversation_fold WHERE source_id != target_id);
UPDATE secret_cards SET conversation_id = (SELECT target_id FROM conversation_fold WHERE source_id = conversation_id)
WHERE conversation_id IN (SELECT source_id FROM conversation_fold WHERE source_id != target_id);
UPDATE handback_cards SET conversation_id = (SELECT target_id FROM conversation_fold WHERE source_id = conversation_id)
WHERE conversation_id IN (SELECT source_id FROM conversation_fold WHERE source_id != target_id);
UPDATE permission_cards SET conversation_id = (SELECT target_id FROM conversation_fold WHERE source_id = conversation_id)
WHERE conversation_id IN (SELECT source_id FROM conversation_fold WHERE source_id != target_id);
UPDATE email_drafts SET conversation_id = (SELECT target_id FROM conversation_fold WHERE source_id = conversation_id)
WHERE conversation_id IN (SELECT source_id FROM conversation_fold WHERE source_id != target_id);
UPDATE pages SET conversation_id = (SELECT target_id FROM conversation_fold WHERE source_id = conversation_id)
WHERE conversation_id IN (SELECT source_id FROM conversation_fold WHERE source_id != target_id);
UPDATE connection_proposals SET conversation_id = (SELECT target_id FROM conversation_fold WHERE source_id = conversation_id)
WHERE conversation_id IN (SELECT source_id FROM conversation_fold WHERE source_id != target_id);
UPDATE agent_inbox SET conversation_id = (SELECT target_id FROM conversation_fold WHERE source_id = conversation_id)
WHERE conversation_id IN (SELECT source_id FROM conversation_fold WHERE source_id != target_id);

DELETE FROM conversation_context_summaries
WHERE conversation_id IN (SELECT source_id FROM conversation_fold WHERE source_id != target_id);
DELETE FROM agent_conversation_cli_sessions
WHERE conversation_id IN (SELECT source_id FROM conversation_fold WHERE source_id != target_id);
UPDATE conversations SET is_default = 1, updated_at_ms = (
    SELECT MAX(c.updated_at_ms) FROM conversations c
    JOIN conversation_fold f ON f.source_id = c.id WHERE f.target_id = conversations.id
)
WHERE id IN (SELECT target_id FROM conversation_fold);
DELETE FROM conversations WHERE id IN (SELECT source_id FROM conversation_fold WHERE source_id != target_id);
CREATE UNIQUE INDEX one_standard_conversation ON conversations(member_id) WHERE kind = 'standard';
DROP TABLE conversation_fold_sequence;
DROP TABLE conversation_fold_cancelled;
DROP TABLE conversation_fold;
PRAGMA user_version = 68;
COMMIT;
"""

# Keep existing reactions and their parent cleanup semantics; validation belongs to set_reaction.
_MIGRATIONS[69] = """
BEGIN;
DROP TRIGGER clear_message_reactions;
DROP TRIGGER clear_room_reactions;
CREATE TABLE message_reactions_v69 (
    turn_id INTEGER NOT NULL REFERENCES agent_turns(id) ON DELETE CASCADE,
    message_key TEXT NOT NULL,
    emoji TEXT NOT NULL,
    PRIMARY KEY(turn_id, message_key, emoji)
);
INSERT INTO message_reactions_v69 SELECT turn_id,message_key,emoji FROM message_reactions;
DROP TABLE message_reactions;
ALTER TABLE message_reactions_v69 RENAME TO message_reactions;
CREATE TABLE room_reactions_v69 (
    message_id INTEGER NOT NULL REFERENCES room_messages(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    PRIMARY KEY(message_id, emoji)
);
INSERT INTO room_reactions_v69 SELECT message_id,emoji FROM room_reactions;
DROP TABLE room_reactions;
ALTER TABLE room_reactions_v69 RENAME TO room_reactions;
CREATE TRIGGER clear_message_reactions AFTER DELETE ON agent_turns BEGIN
    DELETE FROM message_reactions WHERE turn_id=OLD.id;
END;
CREATE TRIGGER clear_room_reactions AFTER DELETE ON room_messages BEGIN
    DELETE FROM room_reactions WHERE message_id=OLD.id;
    UPDATE room_threads SET parent_message_id=NULL WHERE parent_message_id=OLD.id;
END;
PRAGMA user_version = 69;
COMMIT;
"""

# Conversation cards retain only nonsecret account links and immutable recipe snapshots.
_MIGRATIONS[70] = """
BEGIN;
DROP TRIGGER clear_secret_cards;
ALTER TABLE secret_cards RENAME TO secret_cards_previous;
CREATE TABLE secret_cards (
    id TEXT PRIMARY KEY,
    turn_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    conversation_id INTEGER,
    server_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('env','header','login','messaging')),
    secret TEXT NOT NULL,
    name TEXT NOT NULL,
    language TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('pending','failed','saved','resuming','resumed','cancelled','expired')),
    error TEXT NOT NULL DEFAULT '',
    attempts INTEGER NOT NULL DEFAULT 0,
    done TEXT NOT NULL DEFAULT '[]',
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL,
    resumed_at_ms INTEGER,
    UNIQUE(turn_id, server_id, kind, secret)
);
INSERT INTO secret_cards SELECT * FROM secret_cards_previous;
DROP TABLE secret_cards_previous;
CREATE TRIGGER clear_secret_cards AFTER DELETE ON agent_turns BEGIN
  DELETE FROM secret_cards WHERE turn_id=OLD.id;
END;
CREATE TABLE messaging_card_accounts (
    account TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES secret_cards(id) ON DELETE CASCADE
);
CREATE TABLE messaging_pairing_cards (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES secret_cards(id) ON DELETE CASCADE,
    account TEXT NOT NULL,
    platform TEXT NOT NULL,
    member_id INTEGER NOT NULL,
    code TEXT NOT NULL,
    who TEXT NOT NULL,
    expires_at_ms INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('pending','approved','rejected','expired'))
);
CREATE TABLE member_template_cards (
    id TEXT PRIMARY KEY,
    turn_id INTEGER NOT NULL REFERENCES agent_turns(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL,
    template TEXT NOT NULL,
    findings TEXT NOT NULL,
    avatar TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('draft','saved','published')),
    url TEXT
);
CREATE TRIGGER clear_conversation_cards AFTER DELETE ON agent_turns BEGIN
    DELETE FROM messaging_pairing_cards WHERE card_id IN (SELECT id FROM secret_cards WHERE turn_id=OLD.id);
    DELETE FROM messaging_card_accounts WHERE card_id IN (SELECT id FROM secret_cards WHERE turn_id=OLD.id);
    DELETE FROM member_template_cards WHERE turn_id=OLD.id;
END;
CREATE TRIGGER clear_messaging_card_links AFTER DELETE ON secret_cards BEGIN
    DELETE FROM messaging_card_accounts WHERE card_id=OLD.id;
    DELETE FROM messaging_pairing_cards WHERE card_id=OLD.id;
END;
PRAGMA user_version = 70;
COMMIT;
"""

_MIGRATIONS[71] = """
BEGIN;
DROP TRIGGER clear_conversation_cards;
DROP TRIGGER clear_messaging_card_links;
ALTER TABLE messaging_card_accounts RENAME TO messaging_card_accounts_previous;
ALTER TABLE messaging_pairing_cards RENAME TO messaging_pairing_cards_previous;
CREATE TABLE messaging_card_accounts (
    account TEXT PRIMARY KEY,
    turn_id INTEGER NOT NULL REFERENCES agent_turns(id) ON DELETE CASCADE
);
INSERT INTO messaging_card_accounts
    SELECT a.account,c.turn_id FROM messaging_card_accounts_previous a JOIN secret_cards c ON c.id=a.card_id;
CREATE TABLE messaging_pairing_cards (
    id TEXT PRIMARY KEY,
    turn_id INTEGER NOT NULL REFERENCES agent_turns(id) ON DELETE CASCADE,
    account TEXT NOT NULL,
    platform TEXT NOT NULL,
    member_id INTEGER NOT NULL,
    code TEXT NOT NULL,
    who TEXT NOT NULL,
    expires_at_ms INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('pending','approved','rejected','expired'))
);
INSERT INTO messaging_pairing_cards
    SELECT p.id,c.turn_id,p.account,p.platform,p.member_id,p.code,p.who,p.expires_at_ms,p.state
    FROM messaging_pairing_cards_previous p JOIN secret_cards c ON c.id=p.card_id;
DROP TABLE messaging_card_accounts_previous;
DROP TABLE messaging_pairing_cards_previous;
CREATE TRIGGER clear_conversation_cards AFTER DELETE ON agent_turns BEGIN
    DELETE FROM messaging_pairing_cards WHERE turn_id=OLD.id;
    DELETE FROM messaging_card_accounts WHERE turn_id=OLD.id;
    DELETE FROM member_template_cards WHERE turn_id=OLD.id;
END;
PRAGMA user_version = 71;
COMMIT;
"""

# Gold YES/NO confirmations use the same durable decisions without duplicating the window card.
_MIGRATIONS[72] = """
BEGIN;
ALTER TABLE permission_cards ADD COLUMN context_only INTEGER NOT NULL DEFAULT 0 CHECK(context_only IN (0,1));
PRAGMA user_version = 72;
COMMIT;
"""

# Hermes-style private tool transcripts and one persistent recall index.
_MIGRATIONS[73] = """
BEGIN;
CREATE TABLE turn_tool_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    turn_id INTEGER NOT NULL REFERENCES agent_turns(id) ON DELETE CASCADE,
    call_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    redacted_args TEXT NOT NULL,
    redacted_result TEXT NOT NULL,
    outcome TEXT NOT NULL,
    external INTEGER NOT NULL DEFAULT 0 CHECK(external IN (0,1)),
    created_at_ms INTEGER NOT NULL,
    UNIQUE(turn_id,call_id)
);
CREATE INDEX turn_tool_events_by_turn ON turn_tool_events(turn_id,id);
CREATE TRIGGER clear_turn_tool_events AFTER DELETE ON agent_turns BEGIN
    DELETE FROM turn_tool_events WHERE turn_id=OLD.id;
END;
CREATE TABLE memory_search_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK(kind IN ('log','room')),
    source_key TEXT NOT NULL,
    member_id INTEGER NOT NULL DEFAULT -1,
    room_id INTEGER,
    body TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    UNIQUE(kind,source_key,member_id)
);
CREATE INDEX memory_search_documents_by_owner ON memory_search_documents(member_id,kind);
CREATE TRIGGER memory_document_insert AFTER INSERT ON memory_search_documents BEGIN
    INSERT INTO agent_turns_fts(rowid,pairs,chars)
        VALUES(-NEW.id,raphael_search_pairs(NEW.body),raphael_search_chars(NEW.body));
END;
CREATE TRIGGER memory_document_update AFTER UPDATE ON memory_search_documents BEGIN
    DELETE FROM agent_turns_fts WHERE rowid=-OLD.id;
    INSERT INTO agent_turns_fts(rowid,pairs,chars)
        VALUES(-NEW.id,raphael_search_pairs(NEW.body),raphael_search_chars(NEW.body));
END;
CREATE TRIGGER memory_document_delete AFTER DELETE ON memory_search_documents BEGIN
    DELETE FROM agent_turns_fts WHERE rowid=-OLD.id;
END;
CREATE TRIGGER memory_room_insert AFTER INSERT ON room_messages BEGIN
    INSERT INTO memory_search_documents(kind,source_key,room_id,body,updated_at_ms)
        VALUES('room',CAST(NEW.id AS TEXT),NEW.room_id,NEW.text,NEW.created);
END;
CREATE TRIGGER memory_room_update AFTER UPDATE OF text,room_id,created ON room_messages BEGIN
    UPDATE memory_search_documents SET body=NEW.text,room_id=NEW.room_id,updated_at_ms=NEW.created
        WHERE kind='room' AND source_key=CAST(NEW.id AS TEXT);
END;
CREATE TRIGGER memory_room_delete AFTER DELETE ON room_messages BEGIN
    DELETE FROM memory_search_documents WHERE kind='room' AND source_key=CAST(OLD.id AS TEXT);
END;
INSERT INTO memory_search_documents(kind,source_key,room_id,body,updated_at_ms)
    SELECT 'room',CAST(id AS TEXT),room_id,text,created FROM room_messages;
CREATE TABLE memory_entry_metadata (
    scope TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    until_date TEXT,
    created_at_ms INTEGER NOT NULL,
    last_recalled_at_ms INTEGER,
    PRIMARY KEY(scope,entry_id)
);
PRAGMA user_version = 73;
COMMIT;
"""

LATEST_VERSION = max(_MIGRATIONS)


def connect(path: Path | str) -> sqlite3.Connection:
    """Open the database at `path` (":memory:" works) with its schema in place.

    Rows come back as sqlite3.Row. A file database runs in WAL mode.
    """
    conn = sqlite3.connect(path)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        migrate(conn)
    except BaseException:
        conn.close()
        raise
    return conn


def migrate(conn: sqlite3.Connection) -> None:
    """Bring the schema up to LATEST_VERSION, one migration at a time from `user_version`.

    A database that is already current is left alone, so reopening a file is safe. Each migration
    is its own transaction: one that fails leaves the database at the version before it.
    """
    from ..memory.terms import index_terms
    conn.create_function("raphael_search_pairs", 1, lambda text: index_terms(text or "", "", "").pairs, deterministic=True)
    conn.create_function("raphael_search_chars", 1, lambda text: index_terms(text or "", "", "").chars, deterministic=True)
    (version,) = conn.execute("PRAGMA user_version").fetchone()
    for target in sorted(target for target in _MIGRATIONS if version < target <= LATEST_VERSION):
        step = _MIGRATIONS[target]
        try:
            if callable(step):
                step(conn)
            else:
                conn.executescript(step)
        except BaseException:
            conn.rollback()  # a failed statement leaves the script's transaction open
            raise

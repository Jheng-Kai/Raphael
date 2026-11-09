"""Fold historical standard conversations without losing delivered records."""

import sqlite3

import pytest

from raphael_core.agent.conversations import Conversations
from raphael_core.agent.history import AgentHistory
from raphael_core.brain import db


@pytest.fixture
def legacy(tmp_path, monkeypatch):
    with monkeypatch.context() as old:
        old.setattr(db, "LATEST_VERSION", 67)
        conn = db.connect(tmp_path / "legacy.db")
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 67
    conn.executemany("INSERT INTO members(id,name,position,created_at_ms) VALUES(?,?,?,1)", [(1, "Researcher", 0), (2, "Writer", 1)])
    conn.commit()
    yield conn
    conn.close()


def conversation(conn, member, updated, default=False, kind="standard"):
    return conn.execute(
        "INSERT INTO conversations(member_id,title,created_at_ms,updated_at_ms,is_default,kind)"
        " VALUES(?,'Historical',1,?,?,?)", (member, updated, int(default), kind),
    ).lastrowid


def turn(conn, member, cid, request, state=None):
    # Seed the historical schema without using the current turn writer.
    with conn:
        identifier = conn.execute(
            "INSERT INTO agent_turns(created_at_ms,session_id,question,route,prefix,text,status,member_id,conversation_id)"
            " VALUES(100,?,?,'answer','','Saved answer',?,?,?)",
            (request, request, "done" if state is None else state, member, cid),
        ).lastrowid
        AgentHistory(conn)._index(identifier, request, "Saved answer", None)
        Conversations(conn, now_ms=lambda: 100).touch(cid, request)
        if state:
            conn.execute(
                "INSERT INTO agent_inbox(turn_id,request_id,member_id,conversation_id,seq,state,payload_json,created_at_ms)"
                " SELECT ?,?,?,?,COALESCE(MAX(seq),0)+1,'queued',?,100 FROM agent_inbox WHERE member_id=? AND conversation_id=?",
                (identifier, request, member, cid, '{"text":"Queued","language":"en","source":"app"}', member, cid),
            )
    return identifier


def test_v68_moves_every_conversation_record_and_keeps_quick_and_target_context(legacy):
    conn = legacy
    # Members need not have a default yet; an updated-at tie is resolved by ID.
    target = conversation(conn, 1, 10, True)
    extra = [conversation(conn, 1, 30), conversation(conn, 1, 20)]
    chief = Conversations(conn).main()
    chief_extra = conversation(conn, 0, 50)
    quick = Conversations(conn).quick()
    fallback = [conversation(conn, 2, 20), conversation(conn, 2, 40), conversation(conn, 2, 40)]
    expected = {1: [], 0: []}
    for member, cid in [(1, extra[0]), (0, chief_extra), (1, target), (1, extra[1]), (0, chief)]:
        expected[member].append(turn(conn, member, cid, f"record-{cid}"))
    quick_turn = turn(conn, 0, quick, "Quick stays separate")
    quick_before = tuple(conn.execute("SELECT * FROM conversations WHERE id=?", (quick,)).fetchone())
    quick_turn_before = tuple(conn.execute("SELECT * FROM agent_turns WHERE id=?", (quick_turn,)).fetchone())
    child_turn = expected[1][0]
    common = dict(turn_id=child_turn, member_id=1, conversation_id=extra[0])
    records = {
        "connect_cards": dict(common, id="connect", app="notes", language="en", state="pending", created_at_ms=1, updated_at_ms=1, expires_at_ms=999),
        "secret_cards": dict(common, id="secret", server_id="notes", kind="env", secret="TOKEN", name="Token", language="en", state="pending", created_at_ms=1, updated_at_ms=1, expires_at_ms=999),
        "handback_cards": dict(common, id="handback", seq=1, run_id="run", reason="Sign in", language="en", state="control", created_at_ms=1, updated_at_ms=1, expires_at_ms=999),
        "permission_cards": dict(common, id="permission", source="ask", kind="tool", summary="Allow write", digest="digest", language="en", state="pending", created_at_ms=1, updated_at_ms=1, expires_at_ms=999),
        "email_drafts": dict(id="draft", author_id=1, holder_id=1, conversation_id=extra[0], turn_id=child_turn, origin_turn_id=child_turn, language="en", state="draft", version=1, digest="digest", created_at_ms=1, updated_at_ms=1),
        "pages": dict(common, id="page", title="Saved page", html="<p>Saved</p>", fallback="Saved", height=300, rev=1, source="html", tool_input="{}", tool_result="{}", network="[]", created_at_ms=1, updated_at_ms=1),
        "connection_proposals": dict(common, id="proposal", language="en", server_id="notes", fields="[]", state="pending"),
        "voice_calls": dict(id="call", member_id=1, conversation_id=extra[0], started_at_ms=1, summary_id=child_turn),
    }
    for table, values in records.items():
        conn.execute(f"INSERT INTO {table}({','.join(values)}) VALUES({','.join('?' for _ in values)})", tuple(values.values()))
    conn.execute("INSERT INTO voice_call_turns VALUES('call',?)", (child_turn,))
    conn.execute("INSERT INTO page_revisions VALUES('page',1,'Saved page','<p>Saved</p>',1)")
    conn.execute("INSERT INTO email_draft_versions(draft_id,version,digest,at_ms) VALUES('draft',1,'digest',1)")
    for cid in [target, *extra, chief, chief_extra, quick]:
        conn.execute("INSERT INTO conversation_context_summaries VALUES(?,'Keep only target',?,1)", (cid, child_turn))
        conn.execute("INSERT INTO agent_conversation_cli_sessions VALUES(?,'cli:codex',?)", (cid, f"native-{cid}"))
    queued = turn(conn, 1, extra[1], "Waiting request", "queued")
    expected[1].append(queued)
    for cid, updated in [(target, 10), (extra[0], 30), (extra[1], 20), (chief, 10), (chief_extra, 50)]:
        conn.execute("UPDATE conversations SET updated_at_ms=? WHERE id=?", (updated, cid))
    conn.commit()
    conn.execute("PRAGMA foreign_keys=ON")

    db.migrate(conn)

    assert conn.execute("PRAGMA user_version").fetchone()[0] == db.LATEST_VERSION
    for member, cid in [(1, target), (0, chief), (2, fallback[-1])]:
        standard = conn.execute("SELECT id,is_default FROM conversations WHERE member_id=? AND kind='standard'", (member,)).fetchall()
        assert [tuple(row) for row in standard] == [(cid, 1)]
        assert [row[0] for row in conn.execute("SELECT id FROM agent_turns WHERE conversation_id=? ORDER BY id", (cid,))] == expected.get(member, [])
    assert conn.execute("SELECT updated_at_ms FROM conversations WHERE id=?", (target,)).fetchone()[0] == 30
    assert conn.execute("SELECT updated_at_ms FROM conversations WHERE id=?", (chief,)).fetchone()[0] == 50
    for table in records:
        assert conn.execute(f"SELECT conversation_id FROM {table}").fetchone()[0] == target
    tables_with_conversations = {
        row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        if "conversation_id" in {column[1] for column in conn.execute(f"PRAGMA table_info({row[0]})")}
    }
    assert tables_with_conversations == set(records) | {"agent_turns", "agent_inbox", "conversation_context_summaries", "agent_conversation_cli_sessions"}
    assert tuple(conn.execute("SELECT conversation_id,state FROM agent_inbox WHERE turn_id=?", (queued,)).fetchone()) == (target, "queued")
    for table in ("voice_call_turns", "page_revisions", "email_draft_versions"):
        assert conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 1
    for table in ("conversation_context_summaries", "agent_conversation_cli_sessions"):
        assert {row[0] for row in conn.execute(f"SELECT conversation_id FROM {table}")} == {target, chief, quick}
    assert {tuple(row) for row in conn.execute("SELECT conversation_id,session_id FROM agent_conversation_cli_sessions")} == {(cid, f"native-{cid}") for cid in (target, chief, quick)}
    assert tuple(conn.execute("SELECT * FROM conversations WHERE id=?", (quick,)).fetchone()) == quick_before
    assert tuple(conn.execute("SELECT * FROM agent_turns WHERE id=?", (quick_turn,)).fetchone()) == (*quick_turn_before, None)
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    before = conn.total_changes
    db.migrate(conn)
    assert conn.total_changes == before


@pytest.mark.parametrize("target_started", [False, True])
def test_v68_inbox_collisions_keep_target_then_earliest_folded_work(legacy, target_started):
    conn = legacy
    target = conversation(conn, 1, 10, True)
    first = conversation(conn, 1, 20)
    second = conversation(conn, 1, 30)
    # The target's request wins even if the folded one was admitted first.
    duplicate = turn(conn, 1, first, "duplicate", "queued")
    kept = turn(conn, 1, target, "duplicate", "queued")
    started = turn(conn, 1, first, "started-one", "queued")
    collision = turn(conn, 1, second, "started-two", "queued")
    other_duplicate = turn(conn, 1, second, "duplicate", "queued")
    for tid in [started, collision] + ([kept] if target_started else []):
        conn.execute("UPDATE agent_inbox SET state='started' WHERE turn_id=?", (tid,))
        conn.execute("UPDATE agent_turns SET status='running' WHERE id=?", (tid,))
    conn.commit()
    db.migrate(conn)
    rows = {row["turn_id"]: dict(row) for row in conn.execute("SELECT * FROM agent_inbox")}
    assert rows[kept]["state"] == ("started" if target_started else "queued")
    assert rows[started]["state"] == ("terminal" if target_started else "started")
    for tid in [duplicate, collision, other_duplicate] + ([started] if target_started else []):
        assert rows[tid]["state"] == "terminal"
        assert rows[tid]["outcome"] == "cancelled"
        assert rows[tid]["settled_at_ms"] is not None
        assert conn.execute("SELECT status FROM agent_turns WHERE id=?", (tid,)).fetchone()[0] == "denied"
    assert {row["conversation_id"] for row in rows.values()} == {target}
    assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert [row[0] for row in conn.execute("SELECT turn_id FROM agent_inbox ORDER BY seq")] == sorted(rows)


def test_v68_is_atomic_if_cleanup_fails_after_records_move(legacy):
    conn = legacy
    target = conversation(conn, 1, 10, True)
    extra = conversation(conn, 1, 20)
    tid = turn(conn, 1, extra, "Saved")
    conn.executescript("CREATE TRIGGER refuse_fold BEFORE DELETE ON conversations WHEN OLD.member_id=1 BEGIN SELECT RAISE(ABORT,'test rollback'); END;")
    with pytest.raises(sqlite3.IntegrityError, match="test rollback"):
        db.migrate(conn)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 67
    assert conn.execute("SELECT conversation_id FROM agent_turns WHERE id=?", (tid,)).fetchone()[0] == extra
    assert conn.execute("SELECT COUNT(*) FROM conversations WHERE id IN (?,?)", (target, extra)).fetchone()[0] == 2
    assert conn.execute("SELECT name FROM sqlite_temp_master WHERE type='table'").fetchall() == []

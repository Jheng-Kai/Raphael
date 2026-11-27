"""Schema 102: Raphael keeps one conversation; its quick conversation is folded into its main one."""

import pytest

from raphael_core.agent.cli.loop import Sessions
from raphael_core.agent.conversations import Conversations
from raphael_core.brain import db, raphael_one


@pytest.fixture
def old(tmp_path, monkeypatch):
    with monkeypatch.context() as previous:
        previous.setattr(db, "LATEST_VERSION", 101)
        conn = db.connect(tmp_path / "old.db")
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 101
    yield conn
    conn.close()


def migrate(conn):
    db.migrate(conn)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == db.LATEST_VERSION >= 102


def conversation(conn, kind, *, title="", created=10, updated=20):
    """A conversation of Raphael's: a fresh database already has its main one, which is set to what is asked."""
    row = conn.execute("SELECT id FROM conversations WHERE member_id = 0 AND kind = 'standard'").fetchone()
    if kind == "standard" and row is not None:
        conn.execute("UPDATE conversations SET title = ?, created_at_ms = ?, updated_at_ms = ? WHERE id = ?", (title, created, updated, row[0]))
        return row[0]
    return conn.execute(
        "INSERT INTO conversations(member_id,title,created_at_ms,updated_at_ms,is_default,kind) VALUES (0,?,?,?,?,?)",
        (title, created, updated, int(kind == "standard"), kind)).lastrowid


def turn(conn, conversation_id, text="hello", status="done"):
    return conn.execute(
        "INSERT INTO agent_turns(created_at_ms,session_id,question,route,prefix,text,status,member_id,conversation_id,scope)"
        " VALUES(100,?,?,'answer','',?,?,0,?,'private')", (text, text, text, status, conversation_id)).lastrowid


def inbox(conn, turn_id, conversation_id, seq, state="queued", request="r"):
    conn.execute(
        "INSERT INTO agent_inbox(turn_id,request_id,member_id,conversation_id,seq,state,payload_json,created_at_ms)"
        " VALUES (?,?,0,?,?,?,'{}',1)", (turn_id, request, conversation_id, seq, state))


def seed(conn):
    main = conversation(conn, "standard", title="Plans", created=10, updated=50)
    quick = conversation(conn, "quick", title="Spoken", created=5, updated=90)
    ids = {"main": main, "quick": quick, "t_main": turn(conn, main, "typed"), "t_quick": turn(conn, quick, "spoken")}
    page = lambda t, c: conn.execute(  # noqa: E731
        "INSERT INTO pages(turn_id,member_id,conversation_id,title,html,fallback,height,rev,source,tool_input,tool_result,network,created_at_ms,updated_at_ms)"
        " VALUES (?,0,?,'p','<b/>','',100,1,'html','{}','{}','none',1,1)", (t, c))
    page(ids["t_quick"], quick)
    conn.execute(
        "INSERT INTO permission_cards(id,turn_id,member_id,conversation_id,source,kind,summary,digest,language,state,created_at_ms,updated_at_ms,expires_at_ms)"
        " VALUES ('perm',?,0,?,'ask','tool','s','d','en','pending',1,1,2)", (ids["t_quick"], quick))
    conn.execute(
        "INSERT INTO connect_cards(id,turn_id,member_id,conversation_id,app,language,state,created_at_ms,updated_at_ms,expires_at_ms)"
        " VALUES ('conn',?,0,?,'gmail','en','pending',1,1,2)", (ids["t_quick"], quick))
    conn.execute("INSERT INTO voice_calls(id,member_id,conversation_id,started_at_ms) VALUES ('call',0,?,1)", (quick,))
    conn.execute("INSERT INTO member_unread(member_id,conversation_id,unread_from) VALUES (0,?,?),(0,?,?)",
                 (main, ids["t_main"], quick, ids["t_quick"]))
    Sessions(conn)  # the CLI loop makes its own tables on first use
    for owner in (main, quick):
        conn.execute("INSERT INTO conversation_context_summaries(conversation_id,text,through_turn_id,updated_at_ms) VALUES (?,'folded',1,1)", (owner,))
        conn.execute("INSERT INTO agent_conversation_cli_sessions(conversation_id,brain,session_id) VALUES (?,'cli:x','thread')", (owner,))
        conn.execute("INSERT INTO agent_conversation_cli_contexts(conversation_id,brain,session_id,state) VALUES (?,'cli:x','thread','{}')", (owner,))
        conn.execute("INSERT INTO agent_cli_generations(conversation_id,generation) VALUES (?,3)", (owner,))
    conn.commit()
    return ids


def test_the_quick_conversation_is_folded_into_the_main_one_with_everything_it_held(old):
    ids = seed(old)
    migrate(old)
    main = ids["main"]
    assert [tuple(row) for row in old.execute("SELECT id, kind FROM conversations WHERE member_id = 0")] == [(main, "standard")]
    assert {row[0] for row in old.execute("SELECT conversation_id FROM agent_turns")} == {main}
    for table in ("pages", "permission_cards", "connect_cards", "voice_calls"):
        assert [row[0] for row in old.execute(f"SELECT conversation_id FROM {table}")] == [main], table
    assert [tuple(row) for row in old.execute("SELECT member_id, conversation_id, unread_from FROM member_unread")] == [(0, main, ids["t_main"])]
    # the turns keep their IDs, so the conversation reads in the order things were said
    assert [row[0] for row in old.execute("SELECT id FROM agent_turns WHERE conversation_id = ? ORDER BY id", (main,))] == [ids["t_main"], ids["t_quick"]]
    # the merged conversation is folded again from its turns
    assert old.execute("SELECT COUNT(*) FROM conversation_context_summaries").fetchone()[0] == 0
    assert old.execute("SELECT COUNT(*) FROM agent_conversation_cli_sessions").fetchone()[0] == 0
    assert old.execute("SELECT COUNT(*) FROM agent_conversation_cli_contexts").fetchone()[0] == 0
    # the generation of the merged conversation moves on and the quick one's goes with it
    assert [tuple(row) for row in old.execute("SELECT conversation_id, generation FROM agent_cli_generations")] == [(main, 4)]
    row = old.execute("SELECT title, created_at_ms, updated_at_ms, is_default FROM conversations WHERE id = ?", (main,)).fetchone()
    assert tuple(row) == ("Plans", 5, 90, 1)
    assert old.execute("PRAGMA foreign_key_check").fetchall() == []


def test_the_main_conversation_takes_the_quick_ones_title_when_it_has_none(old):
    main = conversation(old, "standard", title="")
    conversation(old, "quick", title="Spoken")
    migrate(old)
    assert old.execute("SELECT title FROM conversations WHERE id = ?", (main,)).fetchone()[0] == "Spoken"


def test_the_quick_conversation_becomes_the_main_one_when_raphael_has_none(old):
    old.execute("DELETE FROM conversations WHERE member_id = 0")  # its slime took the main one in schema 101
    quick = conversation(old, "quick", title="Spoken")
    said = turn(old, quick)
    old.execute("INSERT INTO conversation_context_summaries(conversation_id,text,through_turn_id,updated_at_ms) VALUES (?,'folded',?,1)", (quick, said))
    old.commit()
    migrate(old)
    assert [tuple(row) for row in old.execute("SELECT id, kind, is_default FROM conversations")] == [(quick, "standard", 1)]
    assert Conversations(old).main(0) == quick
    assert old.execute("SELECT conversation_id FROM agent_turns WHERE id = ?", (said,)).fetchone()[0] == quick
    assert old.execute("SELECT COUNT(*) FROM conversation_context_summaries").fetchone()[0] == 1  # nothing was merged: its summary holds


def test_the_inbox_goes_on_behind_the_main_conversations_and_a_clashing_request_is_cancelled(old):
    main, quick = conversation(old, "standard"), conversation(old, "quick")
    started, waiting, twin, quick_started, quick_waiting, settled = (turn(old, owner, status=s) for owner, s in (
        (main, "running"), (main, "queued"), (main, "queued"), (quick, "running"), (quick, "queued"), (quick, "done")))
    inbox(old, started, main, 1, "started", "a")
    inbox(old, waiting, main, 2, "queued", "b")
    inbox(old, twin, quick, 1, "queued", "b")           # the same request ID as a waiting one of the main conversation
    inbox(old, quick_started, quick, 2, "started", "c")  # a second started request in one conversation
    inbox(old, quick_waiting, quick, 3, "queued", "d")
    inbox(old, settled, quick, 4, "terminal", "e")
    old.commit()
    migrate(old)
    rows = {row["turn_id"]: row for row in old.execute("SELECT * FROM agent_inbox")}
    assert {row["conversation_id"] for row in rows.values()} == {main}
    assert [(rows[t]["state"], rows[t]["outcome"]) for t in (twin, quick_started)] == [("terminal", "cancelled")] * 2
    assert [old.execute("SELECT status FROM agent_turns WHERE id = ?", (t,)).fetchone()[0] for t in (twin, quick_started)] == ["denied", "denied"]
    assert rows[quick_waiting]["state"] == "queued" and rows[quick_waiting]["seq"] > rows[waiting]["seq"]
    assert rows[started]["state"] == "started" and old.execute("PRAGMA foreign_key_check").fetchall() == []


def test_nothing_changes_without_a_quick_conversation_and_it_runs_once(old):
    main = conversation(old, "standard", title="Plans")
    said = turn(old, main)
    old.commit()
    migrate(old)
    migrate(old)
    assert [row[0] for row in old.execute("SELECT id FROM agent_turns")] == [said]
    assert [tuple(row) for row in old.execute("SELECT id, title, kind FROM conversations")] == [(main, "Plans", "standard")]


def test_every_table_that_names_a_conversation_is_folded_or_dropped_on_purpose(old):
    """A new table with a conversation_id must be added to the step (or to the dropped ones), never forgotten."""
    Sessions(old)  # the tables the CLI loop makes on first use hold a conversation too
    named = set()
    for (table,) in old.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall():
        if any(column[1] == "conversation_id" for column in old.execute(f"PRAGMA table_info({table})")):
            named.add(table)
    handled = set(raphael_one._MOVED) | set(raphael_one._DROPPED) | {"agent_cli_generations", "member_unread"}
    assert named == handled

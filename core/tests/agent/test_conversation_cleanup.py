"""Deletion owns the complete delivered thread, while room audit stays in its room."""
import sqlite3

from raphael_core.agent.conversations import Conversations
from raphael_core.agent.history import AgentHistory
from raphael_core.agent.actions import action_scope
from raphael_core.brain import db
from raphael_core.background.tasks import TaskStore
from raphael_core.members.store import MemberStore
from .test_service import make_rig  # noqa: F401


def exchange(history, **overrides):
    return history.add(**{
        "session_id": "exchange", "question": "Colleague request", "route": "exchange",
        "source": "member", "prefix": "", "text": "Result", "status": "done", "peer_id": 0,
        **overrides,
    })


def test_an_exchange_appears_only_in_its_received_conversation(conn):
    history, conversations = AgentHistory(conn), Conversations(conn)
    first = conversations.main()
    other = conversations.quick()
    turn = exchange(history, conversation_id=other)
    assert history.get(turn).conversation_id == other
    assert history.list(conversation_id=first, exchanges=True) == []
    assert [item.id for item in history.list(conversation_id=other, exchanges=True)] == [turn]
    assert history.after(0, conversation_id=first, exchanges=True) == []


def test_a_delegated_work_turn_keeps_its_delivery_conversation(conn):
    member = MemberStore(conn).create_member(name="Writer", role="Writer")
    history, conversations, tasks = AgentHistory(conn), Conversations(conn), TaskStore(conn)
    source_id = history.add(session_id="source", question="Review this", route="answer", prefix="", text="", status="running")
    task_id, _ = tasks.accept_handoff(source=history.get(source_id), parent=None, assignee=member.id,
        model="fake/model", request="Review this", stage="review", mode="work", done_when="Reviewed", language="en")
    turn = history.get(tasks.get(task_id).turn_id)
    assert turn.conversation_id == conversations.main(member.id)
    # Work handed over stays with whoever does it.
    audit_id = tasks.exchange_turn_id(task_id)
    assert [t.id for t in history.list(member_id=member.id, conversation_id=turn.conversation_id, exchanges=True)] == [turn.id, audit_id]
    other = conversations.main()
    assert [t.id for t in history.list(member_id=0, conversation_id=other, exchanges=True)] == [source_id]
    conn.execute("DELETE FROM conversations WHERE id=?", (turn.conversation_id,))
    assert history.get(turn.id) is None and history.get(audit_id) is None
    assert tasks.get(task_id).turn_id is None


async def test_clearing_a_conversation_removes_its_exchanges_and_cards(make_rig):
    rig = make_rig()
    conversation = rig.service.conversations.main()
    turn = exchange(rig.history, conversation_id=conversation)
    rig.conn.execute("INSERT INTO connect_cards(id,turn_id,member_id,conversation_id,app,language,state,created_at_ms,updated_at_ms,expires_at_ms) VALUES('card',?,0,?,'notes','en','pending',1,1,2)", (turn, conversation))
    rig.conn.commit()
    await rig.call("conversations.clear", {"id": conversation})
    assert rig.history.get(turn) is None
    assert rig.conn.execute("SELECT COUNT(*) FROM connect_cards").fetchone()[0] == 0
    assert (await rig.call("agent.history.list"))["turns"] == []


async def test_quick_clear_removes_turns_summary_cards_and_cli_but_preserves_identity(make_rig):
    notices = []
    rig = make_rig(notify=lambda method, params: notices.append((method, params)))
    quick = rig.service.conversations.quick()
    formal = rig.service.conversations.main()
    rig.seed("Keep this", "Formal answer", conversation_id=formal)
    turn = rig.history.add(session_id="quick", question="Quick question", route="answer", prefix="", text="Answer", status="done", conversation_id=quick)
    rig.history.add_message(turn, "reply", "Saved answer")
    with action_scope(rig.history, turn, "en", "read_file", {"path": "/sample/cleared-note.md"}):
        pass
    blank_exchange = exchange(rig.history, conversation_id=quick, peer_id=None, question="", text="")
    rig.conn.execute("INSERT INTO conversation_context_summaries VALUES(?, 'Old summary', ?, 1)", (quick, turn))
    rig.service._cli_sessions.put(0, "cli:codex", "old-native-thread", quick)
    rig.conn.execute("INSERT INTO connect_cards(id,turn_id,member_id,conversation_id,app,language,state,created_at_ms,updated_at_ms,expires_at_ms) VALUES('quick-card',?,0,?,'notes','en','pending',1,1,2)", (turn, quick))
    rig.conn.commit()
    await rig.call("conversations.clear", {"id": quick})
    assert ("agent.turn", {"turn_id": 0, "member_id": 0}) in notices
    assert rig.service.conversations.quick() == quick
    assert rig.history.list(conversation_id=quick, exchanges=True) == []
    for table in ("conversation_context_summaries", "agent_conversation_cli_sessions", "connect_cards"):
        assert rig.conn.execute(f"SELECT COUNT(*) FROM {table} WHERE conversation_id=?", (quick,)).fetchone()[0] == 0
    assert rig.history.messages([turn]) == {}
    assert rig.history.get(blank_exchange) is None
    assert rig.history.list(conversation_id=formal)
    await rig.call("conversations.clear", {"id": quick})
    assert rig.service.conversations.quick() == quick


def test_member_cleanup_removes_exchanges_with_the_deleted_peer(conn):
    history = AgentHistory(conn)
    own = exchange(history, member_id=3, peer_id=0)
    peer = exchange(history, member_id=0, peer_id=3)
    assert history.clear_member(3) == 2
    assert history.get(own) is None and history.get(peer) is None


def test_v40_removes_fifty_ambiguous_rows_and_orphan_members_but_keeps_rooms(tmp_path):
    path = tmp_path / "owner-copy.db"
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    for version in range(1, 40):
        step = db._MIGRATIONS[version]
        step(conn) if callable(step) else conn.executescript(step)
    conn.execute("INSERT INTO members(id,name,role,avatar,instructions,model,position,created_at_ms) VALUES(1,'Survivor','','','','',0,1)")
    conn.execute("INSERT INTO rooms(id,name,created,is_team) VALUES(1,'Room',1,0)")
    for n in range(50):
        member = [0, 1, 3, 4, 6, 7, 8, 9][n % 8]
        scope = ["exchange", "quarantine"][n % 2]
        conn.execute("INSERT INTO agent_turns(id,created_at_ms,session_id,question,route,prefix,text,status,source,member_id,peer_id,scope) VALUES(?,1,'old','','exchange','','','done','member',?,0,?)", (n+1, member, scope))
    conn.execute("INSERT INTO agent_turns(id,created_at_ms,session_id,question,route,prefix,text,status,source,member_id,scope,room_id,thread_id) VALUES(51,1,'room','Room question','room','','Room answer','done','room',3,'room',1,1)")
    conn.commit(); conn.close()
    with db.connect(path) as migrated:
        assert migrated.execute("PRAGMA user_version").fetchone()[0] >= 40
        assert [r[0] for r in migrated.execute("SELECT id FROM agent_turns")] == [51]
        db.migrate(migrated)
        assert migrated.execute("SELECT COUNT(*) FROM agent_turns").fetchone()[0] == 1
        assert AgentHistory(migrated).list(conversation_id=Conversations(migrated).main(), exchanges=True) == []

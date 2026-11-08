"""The additive memory schema preserves old turns and shares their existing FTS index."""

from raphael_core.agent.history import AgentHistory
from raphael_core.brain import db


def test_v73_upgrades_and_reopens_existing_history_and_room_documents(tmp_path, monkeypatch):
    path = tmp_path / 'raphael.db'
    with monkeypatch.context() as before:
        before.setattr(db, 'LATEST_VERSION', 72)
        conn = db.connect(path)
        history = AgentHistory(conn)
        identifier = history.add(session_id='synthetic', question='amber memory', prefix='', text='kept', route='chat', status='done')
        with conn:
            room = conn.execute("INSERT INTO rooms(name,created) VALUES('Synthetic',0)").lastrowid
            conn.execute("INSERT INTO room_messages(room_id,text,created) VALUES(?,'既有會議',0)", (room,))
        conn.close()
    conn = db.connect(path)
    try:
        assert conn.execute('PRAGMA user_version').fetchone()[0] == db.LATEST_VERSION
        assert AgentHistory(conn).get(identifier).text == 'kept'
        assert AgentHistory(conn).search('amber')
        assert conn.execute("SELECT count(*) FROM memory_search_documents WHERE kind='room'").fetchone()[0] == 1
        assert not conn.execute('SELECT 1 FROM turn_tool_events').fetchone()
        db.migrate(conn)
        assert conn.execute("SELECT count(*) FROM memory_search_documents WHERE kind='room'").fetchone()[0] == 1
        assert conn.execute("SELECT count(*) FROM sqlite_master WHERE name='agent_turns_fts'").fetchone()[0] == 1
    finally:
        conn.close()

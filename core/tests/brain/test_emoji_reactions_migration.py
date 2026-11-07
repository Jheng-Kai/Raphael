"""Migration 69 removes only the old emoji CHECK and preserves every reaction."""
import sqlite3

import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.brain import db


@pytest.fixture
def legacy(tmp_path, monkeypatch):
    path = tmp_path / 'emoji-v68.db'
    with monkeypatch.context() as old:
        old.setattr(db, 'LATEST_VERSION', 68)
        conn = db.connect(path)
    # This regression isolates migration 69; later migrations may add unrelated tables.
    monkeypatch.setattr(db, "LATEST_VERSION", 69)
    turn = AgentHistory(conn).add(session_id='old', question='Owner', route='answer', prefix='', text='Reply', status='done')
    with conn:
        room = conn.execute("INSERT INTO rooms(name,created) VALUES('Old room',1)").lastrowid
        thread = conn.execute('INSERT INTO room_threads(room_id,created) VALUES(?,1)', (room,)).lastrowid
        message = conn.execute("INSERT INTO room_messages(room_id,thread_id,text,created) VALUES(?,?,'Old reply',1)", (room, thread)).lastrowid
        side = conn.execute('INSERT INTO room_threads(room_id,created,parent_message_id) VALUES(?,1,?)', (room, message)).lastrowid
        for emoji in ('👍', '❤', '✓', '?'):
            for key in ('owner', 'reply'):
                conn.execute('INSERT INTO message_reactions VALUES(?,?,?)', (turn, key, emoji))
            conn.execute('INSERT INTO room_reactions VALUES(?,?)', (message, emoji))
    conn.execute('PRAGMA foreign_keys=ON')
    yield conn, path, turn, message, side
    conn.close()


def stored(conn):
    return {table: [tuple(row) for row in conn.execute(f'SELECT * FROM {table} ORDER BY 1,2')]
            for table in ('message_reactions', 'room_reactions')}


def test_v69_keeps_all_old_reactions_accepts_new_emoji_and_preserves_schema_and_cleanup(legacy):
    conn, path, turn, message, side = legacy
    before = stored(conn)
    schema = [tuple(row) for row in conn.execute(
        "SELECT type,name,sql FROM sqlite_master WHERE name NOT IN ('message_reactions','room_reactions') ORDER BY type,name")]
    assert conn.execute('PRAGMA user_version').fetchone()[0] == 68
    db.migrate(conn)
    assert conn.execute('PRAGMA user_version').fetchone()[0] == 69
    assert stored(conn) == before
    assert [tuple(row) for row in conn.execute(
        "SELECT type,name,sql FROM sqlite_master WHERE name NOT IN ('message_reactions','room_reactions') ORDER BY type,name")] == schema
    for table in before:
        sql = conn.execute('SELECT sql FROM sqlite_master WHERE name=?', (table,)).fetchone()[0]
        assert 'CHECK' not in sql and 'NOT NULL' in sql and 'PRIMARY KEY' in sql and 'ON DELETE CASCADE' in sql
    with conn:
        conn.execute('INSERT INTO message_reactions VALUES(?,?,?)', (turn, 'reply', '🎉'))
        conn.execute('INSERT INTO room_reactions VALUES(?,?)', (message, '👨‍👩‍👧'))
    for sql, values in [('INSERT INTO message_reactions VALUES(?,?,?)', (turn, 'reply', '🎉')),
                        ('INSERT INTO room_reactions VALUES(?,?)', (message, '👨‍👩‍👧')),
                        ('INSERT INTO message_reactions VALUES(?,?,?)', (turn, 'reply', None)),
                        ('INSERT INTO room_reactions VALUES(?,?)', (message, None))]:
        with pytest.raises(sqlite3.IntegrityError):
            with conn:
                conn.execute(sql, values)
    assert conn.execute('PRAGMA foreign_key_check').fetchall() == []
    changes = conn.total_changes
    db.migrate(conn)
    assert conn.total_changes == changes
    reopened = db.connect(path)
    assert stored(reopened) == stored(conn)
    reopened.close()
    with conn:
        conn.execute('DELETE FROM agent_turns WHERE id=?', (turn,))
        conn.execute('DELETE FROM room_messages WHERE id=?', (message,))
    assert stored(conn) == {'message_reactions': [], 'room_reactions': []}
    assert conn.execute('SELECT parent_message_id FROM room_threads WHERE id=?', (side,)).fetchone()[0] is None


def test_v69_failure_rolls_back_both_tables_and_cleanup_triggers(legacy):
    conn, _, _, _, _ = legacy
    before = stored(conn)
    schema = [tuple(row) for row in conn.execute('SELECT type,name,sql FROM sqlite_master ORDER BY type,name')]
    conn.set_authorizer(lambda action, name, *args: sqlite3.SQLITE_DENY
                        if action == sqlite3.SQLITE_DROP_TABLE and name == 'room_reactions' else sqlite3.SQLITE_OK)
    try:
        with pytest.raises(sqlite3.DatabaseError, match='not authorized'):
            db.migrate(conn)
    finally:
        conn.set_authorizer(None)
    assert conn.execute('PRAGMA user_version').fetchone()[0] == 68
    assert stored(conn) == before
    assert [tuple(row) for row in conn.execute('SELECT type,name,sql FROM sqlite_master ORDER BY type,name')] == schema

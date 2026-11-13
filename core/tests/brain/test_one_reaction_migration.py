"""Migration 82 keeps the newest of the several emoji a message carried, and the primary key allows one."""
import sqlite3

import pytest

from raphael_core.brain import db


@pytest.fixture
def legacy(tmp_path, monkeypatch):
    path = tmp_path / 'reactions-v81.db'
    with monkeypatch.context() as old:
        old.setattr(db, 'LATEST_VERSION', 81)
        conn = db.connect(path)
    monkeypatch.setattr(db, 'LATEST_VERSION', 82)
    with conn:
        turn = conn.execute("INSERT INTO agent_turns(created_at_ms,session_id,question,route,prefix,text,status)"
                            " VALUES(1,'old','Owner','answer','','Reply','done')").lastrowid
        other = conn.execute("INSERT INTO agent_turns(created_at_ms,session_id,question,route,prefix,text,status)"
                             " VALUES(1,'other','Owner','answer','','Reply','done')").lastrowid
        room = conn.execute("INSERT INTO rooms(name,created) VALUES('Old room',1)").lastrowid
        thread = conn.execute('INSERT INTO room_threads(room_id,created) VALUES(?,1)', (room,)).lastrowid
        message = conn.execute("INSERT INTO room_messages(room_id,thread_id,text,created) VALUES(?,?,'Old reply',1)", (room, thread)).lastrowid
        for emoji in ('😂', '👍', '❤', '🎉'):
            conn.execute('INSERT INTO message_reactions VALUES(?,?,?)', (turn, 'reply', emoji))
            conn.execute('INSERT INTO room_reactions VALUES(?,?)', (message, emoji))
        conn.execute('INSERT INTO message_reactions VALUES(?,?,?)', (turn, 'owner', '✓'))
        conn.execute('INSERT INTO message_reactions VALUES(?,?,?)', (other, 'reply', '👎'))
    conn.execute('PRAGMA foreign_keys=ON')
    yield conn, path, turn, other, message
    conn.close()


def stored(conn):
    return ([tuple(row) for row in conn.execute('SELECT * FROM message_reactions ORDER BY 1,2')],
            [tuple(row) for row in conn.execute('SELECT * FROM room_reactions ORDER BY 1')])


def test_v82_keeps_the_newest_emoji_of_each_message_and_allows_one(legacy):
    conn, path, turn, other, message = legacy
    assert conn.execute('PRAGMA user_version').fetchone()[0] == 81
    db.migrate(conn)
    assert conn.execute('PRAGMA user_version').fetchone()[0] == 82
    assert stored(conn) == ([(turn, 'owner', '✓'), (turn, 'reply', '🎉'), (other, 'reply', '👎')], [(message, '🎉')])
    for sql, values in [('INSERT INTO message_reactions VALUES(?,?,?)', (turn, 'reply', '😂')),
                        ('INSERT INTO room_reactions VALUES(?,?)', (message, '😂')),
                        ('INSERT INTO message_reactions VALUES(?,?,?)', (turn, 'reply', None))]:
        with pytest.raises(sqlite3.IntegrityError), conn:
            conn.execute(sql, values)
    assert conn.execute('PRAGMA foreign_key_check').fetchall() == []
    changes = conn.total_changes
    db.migrate(conn)
    assert conn.total_changes == changes
    reopened = db.connect(path)
    assert stored(reopened) == stored(conn)
    reopened.close()


def test_v82_asks_go_with_the_message_or_turn_they_name_and_no_other(legacy):
    conn, _, turn, other, message = legacy
    db.migrate(conn)
    with conn:
        conn.executemany('INSERT INTO reaction_asks VALUES(?,?)', [('turn', f'{turn}:reply'), ('turn', f'{other}:reply'),
                                                                   ('room', str(message)), ('room', '9999')])
        conn.execute('DELETE FROM agent_turns WHERE id=?', (turn,))
    assert [tuple(row) for row in conn.execute('SELECT kind,ref FROM reaction_asks ORDER BY 1,2')] == [
        ('room', str(message)), ('room', '9999'), ('turn', f'{other}:reply')]
    with conn:
        conn.execute('DELETE FROM room_messages WHERE id=?', (message,))
    assert [tuple(row) for row in conn.execute('SELECT kind,ref FROM reaction_asks ORDER BY 1,2')] == [
        ('room', '9999'), ('turn', f'{other}:reply')]
    assert stored(conn) == ([(other, 'reply', '👎')], [])


def test_v82_failure_rolls_back_every_table_and_trigger(legacy):
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
    assert conn.execute('PRAGMA user_version').fetchone()[0] == 81
    assert stored(conn) == before
    assert [tuple(row) for row in conn.execute('SELECT type,name,sql FROM sqlite_master ORDER BY type,name')] == schema

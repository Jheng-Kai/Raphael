"""Migration 83: what was analysed is recorded per message and emoji, so that another emoji on the same message is a new
reaction while the same one given again is not."""
import sqlite3

import pytest

from raphael_core.brain import db


@pytest.fixture
def legacy(tmp_path, monkeypatch):
    path = tmp_path / 'reactions-v82.db'
    with monkeypatch.context() as old:
        old.setattr(db, 'LATEST_VERSION', 82)
        conn = db.connect(path)
    monkeypatch.setattr(db, 'LATEST_VERSION', 83)
    with conn:
        turn = conn.execute("INSERT INTO agent_turns(created_at_ms,session_id,question,route,prefix,text,status)"
                            " VALUES(1,'old','Owner','answer','','Reply','done')").lastrowid
        other = conn.execute("INSERT INTO agent_turns(created_at_ms,session_id,question,route,prefix,text,status)"
                             " VALUES(1,'other','Owner','answer','','Reply','done')").lastrowid
        room = conn.execute("INSERT INTO rooms(name,created) VALUES('Old room',1)").lastrowid
        thread = conn.execute('INSERT INTO room_threads(room_id,created) VALUES(?,1)', (room,)).lastrowid
        message = conn.execute("INSERT INTO room_messages(room_id,thread_id,text,created) VALUES(?,?,'Old reply',1)", (room, thread)).lastrowid
        conn.executemany('INSERT INTO reaction_asks VALUES(?,?)', [('turn', f'{turn}:reply'), ('turn', f'{other}:reply'), ('room', str(message))])
    conn.execute('PRAGMA foreign_keys=ON')
    yield conn, path, turn, other, message
    conn.close()


def stored(conn):
    return [tuple(row) for row in conn.execute('SELECT kind,ref,emoji FROM reaction_asks ORDER BY 1,2,3')]


def test_v83_keeps_what_was_asked_as_a_thumbs_down_and_keys_it_by_emoji_too(legacy):
    conn, path, turn, other, message = legacy
    assert conn.execute('PRAGMA user_version').fetchone()[0] == 82
    db.migrate(conn)
    assert conn.execute('PRAGMA user_version').fetchone()[0] == 83
    assert stored(conn) == sorted([('room', str(message), '👎'), ('turn', f'{turn}:reply', '👎'), ('turn', f'{other}:reply', '👎')])
    with conn:
        conn.execute("INSERT INTO reaction_asks VALUES('turn',?,'👍')", (f'{turn}:reply',))
    with pytest.raises(sqlite3.IntegrityError), conn:
        conn.execute("INSERT INTO reaction_asks VALUES('turn',?,'👍')", (f'{turn}:reply',))
    with pytest.raises(sqlite3.IntegrityError), conn:
        conn.execute("INSERT INTO reaction_asks VALUES('turn',?,NULL)", (f'{turn}:reply',))
    changes = conn.total_changes
    db.migrate(conn)
    assert conn.total_changes == changes
    reopened = db.connect(path)
    assert stored(reopened) == stored(conn)
    reopened.close()


def test_v83_every_emoji_of_a_message_goes_with_the_turn_or_message_it_names_and_no_other(legacy):
    conn, _, turn, other, message = legacy
    db.migrate(conn)
    with conn:
        conn.executemany('INSERT INTO reaction_asks VALUES(?,?,?)', [('turn', f'{turn}:reply', '👍'), ('room', str(message), '🎉'),
                                                                   ('room', '9999', '👍')])
        conn.execute('DELETE FROM agent_turns WHERE id=?', (turn,))
    assert stored(conn) == sorted([('room', '9999', '👍'), ('room', str(message), '🎉'), ('room', str(message), '👎'),
                                   ('turn', f'{other}:reply', '👎')])
    with conn:
        conn.execute('DELETE FROM room_messages WHERE id=?', (message,))
    assert stored(conn) == sorted([('room', '9999', '👍'), ('turn', f'{other}:reply', '👎')])


def test_v83_failure_rolls_back_the_table_and_the_triggers(legacy):
    conn, _, _, _, _ = legacy
    before = [tuple(row) for row in conn.execute('SELECT kind,ref FROM reaction_asks ORDER BY 1,2')]
    schema = [tuple(row) for row in conn.execute('SELECT type,name,sql FROM sqlite_master ORDER BY type,name')]
    conn.set_authorizer(lambda action, name, *args: sqlite3.SQLITE_DENY
                        if action == sqlite3.SQLITE_DROP_TABLE and name == 'reaction_asks' else sqlite3.SQLITE_OK)
    try:
        with pytest.raises(sqlite3.DatabaseError, match='not authorized'):
            db.migrate(conn)
    finally:
        conn.set_authorizer(None)
    assert conn.execute('PRAGMA user_version').fetchone()[0] == 82
    assert [tuple(row) for row in conn.execute('SELECT kind,ref FROM reaction_asks ORDER BY 1,2')] == before
    assert [tuple(row) for row in conn.execute('SELECT type,name,sql FROM sqlite_master ORDER BY type,name')] == schema

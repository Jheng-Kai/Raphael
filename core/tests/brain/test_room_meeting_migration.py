"""Upgrading meetings retains legacy messages, intents and active-turn state."""
import sqlite3

import pytest

from raphael_core.brain import db


@pytest.mark.parametrize('foreign_keys',[False,True])
def test_meeting_migration_preserves_legacy_rows_and_scope_guards(monkeypatch,foreign_keys):
    with monkeypatch.context() as patch:
        patch.setattr(db,'LATEST_VERSION',59)
        conn=db.connect(':memory:')
    with conn:
        room=conn.execute("INSERT INTO rooms(name,created) VALUES ('Legacy',1)").lastrowid
        thread=conn.execute('SELECT id FROM room_threads WHERE room_id=?',(room,)).fetchone()[0]
        message=conn.execute("INSERT INTO room_messages(room_id,thread_id,text,created,request_id) VALUES (?,?,'Legacy agenda',1,'legacy')",(room,thread)).lastrowid
        conn.execute("INSERT INTO room_exchanges(origin_message_id,room_id,state,language,pending) VALUES (?,?,'queued','en','[]')",(message,room))
        conn.execute("INSERT INTO room_reply_intents(origin_message_id,source_message_id,recipient_id,recipient_name) VALUES (?,?,0,'Raphael')",(message,message))
    before=dict(conn.execute('SELECT * FROM room_messages').fetchone())
    conn.execute(f'PRAGMA foreign_keys={int(foreign_keys)}')
    db.migrate(conn)
    after=dict(conn.execute('SELECT * FROM room_messages WHERE id=?',(message,)).fetchone())
    assert all(after[key]==value for key,value in before.items())
    assert conn.execute('SELECT COUNT(*) FROM room_exchanges').fetchone()[0]==1
    assert conn.execute('SELECT COUNT(*) FROM room_reply_intents').fetchone()[0]==1
    assert conn.execute('PRAGMA foreign_keys').fetchone()[0]==int(foreign_keys)
    with conn:
        conn.execute("INSERT INTO room_messages(room_id,thread_id,member_id,text,created,kind) VALUES (?,?,0,'Decision',2,'decision')",(room,thread))
    with pytest.raises(sqlite3.IntegrityError,match='cross-scope'):
        conn.execute("INSERT INTO room_messages(room_id,thread_id,text,created) VALUES (?,99999,'Invalid',3)",(room,))
    conn.rollback()
    db.migrate(conn)
    assert conn.execute('SELECT COUNT(*) FROM room_messages').fetchone()[0]==2
    conn.close()

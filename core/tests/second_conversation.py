"""A second conversation for Raphael, for the tests of what keeps conversations apart.

Raphael has one conversation and no build makes another. The conversation machinery still holds several for a
member (a named conversation, a thread's rows), so a test of that machinery needs a second one: the only
second row the schema allows is the legacy 'quick' one, which a database made before schema 102 had.
"""

import sqlite3


def another_conversation(conn: sqlite3.Connection) -> int:
    conn.execute("INSERT OR IGNORE INTO conversations(member_id,title,created_at_ms,updated_at_ms,is_default,kind)"
                 " VALUES (0,'',1,1,0,'quick')")
    conn.commit()
    return conn.execute("SELECT id FROM conversations WHERE kind = 'quick'").fetchone()[0]

"""Trigger snapshots extend run history without rewriting saved routines."""

import sqlite3

from raphael_core.brain import db


def test_v55_leaves_existing_routines_and_runs_intact(tmp_path):
    path = tmp_path / "sample.db"
    conn = sqlite3.connect(path)
    for version in range(1, 55):
        step = db._MIGRATIONS[version]
        step(conn) if callable(step) else conn.executescript(step)
    conn.execute("INSERT INTO routines(member_id,title,prompt,schedule,enabled,created_at_ms,next_run_ms) VALUES(0,'Sample','Review','{\"kind\":\"every\",\"hours\":3}',1,1,900)")
    conn.execute("INSERT INTO routine_runs(routine_id,started,status) VALUES(1,2,'done')")
    conn.commit()
    cursor = conn.execute("SELECT * FROM routines")
    before = cursor.fetchall()
    saved = ",".join(column[0] for column in cursor.description)  # later migrations add columns; the saved ones stay as they were
    conn.close()
    upgraded = db.connect(path)
    assert [tuple(row) for row in upgraded.execute(f"SELECT {saved} FROM routines")] == before
    assert tuple(upgraded.execute("SELECT routine_id,started,status,trigger_json FROM routine_runs").fetchone()) == (1,2,"done","{}")
    db.migrate(upgraded)
    assert [tuple(row) for row in upgraded.execute(f"SELECT {saved} FROM routines")] == before
    upgraded.close()

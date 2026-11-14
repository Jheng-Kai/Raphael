"""Migration 84: a routine's precheck, the hash it last saw and when a run was last skipped (R-ROUTINE-10)."""

from raphael_core.brain import db


def test_a_database_from_before_the_precheck_gets_its_columns_and_keeps_its_routines(tmp_path, monkeypatch):
    with monkeypatch.context() as old:
        old.setattr(db, "LATEST_VERSION", 83)
        conn = db.connect(tmp_path / "before.db")
    with conn:
        conn.execute("INSERT INTO routines (member_id, title, prompt, schedule, created_at_ms) VALUES (1, 'Morning', 'Look', '{}', 1)")
    assert "precheck_json" not in {row[1] for row in conn.execute("PRAGMA table_info(routines)")}
    db.migrate(conn)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == db.LATEST_VERSION
    assert {"precheck_json", "precheck_hash", "last_skipped_ms"} <= {row[1] for row in conn.execute("PRAGMA table_info(routines)")}
    assert tuple(conn.execute("SELECT title, precheck_json, precheck_hash, last_skipped_ms FROM routines").fetchone()) == ("Morning", None, None, None)
    conn.close()

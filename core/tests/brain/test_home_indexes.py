"""Home's metadata indexes upgrade existing history without rewriting its payloads."""

from raphael_core.brain import db


def test_v78_adds_completion_indexes_and_preserves_existing_history(tmp_path, monkeypatch):
    with monkeypatch.context() as legacy:
        legacy.setattr(db, "LATEST_VERSION", 77)
        conn = db.connect(tmp_path / "history.sqlite")
    try:
        with conn:
            conn.execute("INSERT INTO agent_turns(id,created_at_ms,session_id,question,route,prefix,text,status)"
                         " VALUES(1,100,'synthetic','Keep','answer','','Original report','done')")
            conn.execute("INSERT INTO worker_tasks(created_at_ms,state,session_id,turn_id,language,text,report_text)"
                         " VALUES(100,'done','synthetic',1,'en','Keep','Original worker report')")
        before = [tuple(row) for row in conn.execute("SELECT * FROM worker_tasks")]
        db.migrate(conn)
        db.migrate(conn)
        assert conn.execute("PRAGMA user_version").fetchone()[0] >= 78
        assert [tuple(row) for row in conn.execute("SELECT * FROM worker_tasks")] == before
        assert conn.execute("SELECT text FROM agent_turns WHERE id=1").fetchone()[0] == "Original report"
        indexes = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")}
        assert {"routine_runs_turn", "routine_runs_home_finished", "worker_tasks_home_finished", "agent_turns_home_status"} <= indexes
        assert list(conn.execute("PRAGMA foreign_key_check")) == []
    finally:
        conn.close()

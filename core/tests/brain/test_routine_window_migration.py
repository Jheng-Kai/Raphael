"""One historical rhythm keeps its runs and receipts on one routine."""

import json
import sqlite3
from datetime import datetime

import pytest

from raphael_core.brain import db


@pytest.mark.parametrize("previous_version", [51, 53])
def test_six_daily_rows_merge_without_losing_history_and_migration_is_idempotent(tmp_path, monkeypatch, previous_version):
    monkeypatch.setattr("raphael_core.clock.wall_clock_ms", lambda: int(datetime(2026, 10, 24, 10).timestamp() * 1000))
    with monkeypatch.context() as old:
        old.setattr(db, "LATEST_VERSION", previous_version)
        conn = db.connect(tmp_path / "calendar.db")
    assert conn.execute("PRAGMA user_version").fetchone()[0] == previous_version
    def add(member, prompt, times, **extra):
        ids = []
        for time in times:
            ids.append(conn.execute("INSERT INTO routines(member_id,title,prompt,schedule,enabled,created_at_ms,last_run_ms) VALUES(?,?,?,?,1,1,?)",
                (member, f"Review ({time})", prompt, json.dumps({"kind": "daily", "time": time, **extra}), len(ids) + 1)).lastrowid)
        return ids
    merged = add(1, "Review samples", ["08:00", "11:00", "14:00", "17:00", "20:00", "23:00"])
    uneven = add(1, "Uneven", ["08:00", "11:00", "15:00"])
    different = add(1, "Other prompt", ["10:00"])
    other = add(2, "Review samples", ["08:00", "11:00"])
    bounded = add(1, "Bounded", ["08:00", "11:00"], max_runs=5)
    for rid in merged:
        conn.execute("INSERT INTO routine_runs(routine_id,started,status) VALUES(?,1,'done')", (rid,))
        conn.execute("INSERT INTO routine_receipts(routine_id,item_id,item,state) VALUES(?,?,?,'pending')", (rid, f"item-{rid}", "sample"))
        conn.execute("INSERT INTO routine_receipts(routine_id,item_id,state) VALUES(?,'duplicate','seen')", (rid,))
    conn.commit()
    conn.execute("UPDATE routine_receipts SET state='fired' WHERE routine_id=? AND item_id='duplicate'", (merged[-1],))
    conn.commit()
    conn.row_factory = None
    db.migrate(conn)
    conn.row_factory = sqlite3.Row
    assert conn.execute("PRAGMA user_version").fetchone()[0] == db.LATEST_VERSION
    assert {"computer_logins", "connection_proposals"} <= {
        row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    kept = conn.execute("SELECT * FROM routines WHERE id=?", (merged[0],)).fetchone()
    assert json.loads(kept["schedule"]) == {"kind": "every", "hours": 3, "from": "08:00", "to": "23:00"}
    assert kept["title"] == "Review" and kept["last_run_ms"] == 6
    assert kept["next_run_ms"] == int(datetime(2026, 10, 24, 11).timestamp() * 1000)
    assert conn.execute("SELECT COUNT(*) FROM routine_runs WHERE routine_id=?", (merged[0],)).fetchone()[0] == 6
    assert conn.execute("SELECT COUNT(*) FROM routine_receipts WHERE routine_id=?", (merged[0],)).fetchone()[0] == 7
    assert conn.execute("SELECT state FROM routine_receipts WHERE routine_id=? AND item_id='duplicate'", (merged[0],)).fetchone()[0] == "fired"
    ids = {row[0] for row in conn.execute("SELECT id FROM routines")}
    assert set(uneven + different + bounded + [other[0], merged[0]]) == ids
    before = conn.total_changes
    db.migrate(conn)
    assert conn.total_changes == before
    conn.close()

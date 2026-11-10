"""Owner-sized offline Home timings, query plans and bounded aggregation work."""

import cProfile
import json
from statistics import median
from time import perf_counter

import pytest

from raphael_core.app import App
from raphael_core.home_digest import _ended


@pytest.fixture
async def owner_home(tmp_path, monkeypatch):
    app = App(data_dir=tmp_path, fake_llm=True)
    monkeypatch.setattr(app.memory, "may_spend", lambda member_id=0: False)
    monkeypatch.setattr("raphael_core.home_digest.selected_available", lambda *args: False)
    # No executable discovery or provider calls on the developer's own accounts.
    app.agent._cli_brains.commands = {}
    app.agent._cli_brains.environ = {}
    conn = app._conn
    now = app.home.now_ms()
    with conn:
        for number in range(12):
            conn.execute("INSERT INTO members(name,role,personality,instructions,avatar,position,created_at_ms) VALUES(?,?,?,?,?,?,?)",
                         (f"Member {number}", "Research", "Patient", "Use evidence", "slime:blue", number, now))
        mids = [row[0] for row in conn.execute("SELECT id FROM members")]
        conn.executemany("INSERT INTO agent_turns(id,created_at_ms,session_id,question,route,prefix,text,status,member_id,source)"
                         " VALUES(?,?,?,?,?,?,?,?,?,?)",
                         [(n, now - (4000 - n) * 1000, "synthetic", f"Task {n}", "answer", "", "Result " * 600,
                           "error" if n % 17 == 0 else "done", mids[n % 12], "app") for n in range(1, 4001)])
        conn.executemany("INSERT INTO worker_tasks(created_at_ms,finished_at_ms,state,session_id,turn_id,language,text,report_text,member_id)"
                         " VALUES(?,?,?,?,?,?,?,?,?)",
                         [(now - n * 1000, now - n * 500, "failed" if n % 17 == 0 else "done", "synthetic", n, "en",
                           f"Task {n}", "R" * 22400, mids[n % 12]) for n in range(1, 623)])
        # Linked routine runs exercise both NOT EXISTS anti-joins, including old history.
        for mid in mids:
            conn.execute("INSERT INTO routines(member_id,title,prompt,schedule,enabled,created_at_ms,next_run_ms) VALUES(?,?,?,?,?,?,?)",
                         (mid, "Review", "Review notes", '{"kind":"daily","time":"09:00"}', 0, now, None))
        routines = [row[0] for row in conn.execute("SELECT id FROM routines")]
        conn.executemany("INSERT INTO routine_runs(routine_id,started,finished,status,turn_id) VALUES(?,?,?,?,?)",
                         [(routines[n % 12], now - n * 1000, now - n * 500, "done", n) for n in range(623, 1823)])
        conn.executemany("INSERT INTO run_metrics(kind,run_id,started_at_ms,finished_at_ms) VALUES('turn',?,?,?)",
                         [(n, now - n * 1000, now - n * 500) for n in range(1, 4001)])
    try:
        yield app
    finally:
        await app.aclose()


async def test_owner_sized_overview_cost(owner_home):
    app = owner_home
    statements, elapsed = [], []
    for _ in range(5):
        statements.clear()
        app._conn.set_trace_callback(statements.append)
        began = perf_counter()
        try:
            value = await app.call("home.overview")
        finally:
            app._conn.set_trace_callback(None)
        elapsed.append((perf_counter() - began) * 1000)
    query_count = len(statements)
    plans, ended_statements = {}, []
    app._conn.set_trace_callback(ended_statements.append)
    began = perf_counter()
    try:
        for ok in (True, False):
            list(_ended(app._conn, 0, app.home.now_ms() + 1, ok=ok))
    finally:
        app._conn.set_trace_callback(None)
    ended_ms = (perf_counter() - began) * 1000
    for number, sql in enumerate(ended_statements):
        plans[number] = [row[3] for row in app._conn.execute("EXPLAIN QUERY PLAN " + sql)]
    print("HOME_COST " + json.dumps({"turns": 4000, "tasks": 622, "report_bytes": 622 * 22400, "routine_runs": 1200,
        "overview_ms": [round(ms, 2) for ms in elapsed], "median_ms": round(median(elapsed), 2),
        "queries": query_count, "ended_ms": round(ended_ms, 2), "plans": plans}, sort_keys=True))
    assert len(value["activity"]["days"]) == 14
    assert all("report_text" not in sql and ".*" not in sql for sql in ended_statements)
    assert not any(step.startswith("SCAN ") for plan in plans.values() for step in plan)
    # A deterministic work bound; elapsed timings above are evidence, not a flaky pass condition.
    assert query_count <= 100


async def test_one_request_enters_home_read_once_without_a_gather_resumption(owner_home):
    profile = cProfile.Profile()
    profile.enable()
    try:
        await owner_home.call("home.overview")
    finally:
        profile.disable()
    calls = [entry.callcount for entry in profile.getstats() if not isinstance(entry.code, str)
             and entry.code.co_name == "read" and entry.code.co_filename.endswith("home.py")]
    assert calls == [1]


async def test_home_and_composer_discovery_share_one_resolution_per_cli(owner_home, monkeypatch):
    from raphael_core.agent.cli import discovery

    brains = owner_home.agent._cli_brains
    brains.commands = None
    calls = []
    monkeypatch.setattr(discovery.shutil, "which", lambda name, **kw: calls.append(name))
    await owner_home.call("home.overview")
    await owner_home.call("brains.cli")
    await owner_home.call("home.overview")
    assert sorted(calls) == ["agy", "claude", "codex"]

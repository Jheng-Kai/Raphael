"""Short rhythms and monthly dates use the ordinary routine engine."""

from datetime import datetime, timezone

import pytest

from raphael_core.members.schedule import parse_schedule, next_run


def stamp(value):
    return int(datetime.fromisoformat(value).replace(tzinfo=timezone.utc).timestamp() * 1000)


@pytest.mark.parametrize("date,expected", [("2026-01-31T08:00", "2026-02-28T08:00"), ("2028-01-31T08:00", "2028-02-29T08:00"), ("2026-02-28T08:00", "2026-03-31T08:00")])
def test_monthly_clamps_without_drifting(date, expected):
    plan = parse_schedule({"kind": "monthly", "day": 31, "time": "08:00"})
    assert plan.to_json() == {"kind": "monthly", "day": 31, "time": "08:00"}
    assert next_run(plan, stamp(date), tz=timezone.utc) == stamp(expected)


@pytest.mark.parametrize("minutes", [5, 10, 15, 30])
def test_minutes_keep_the_daily_window(minutes):
    plan = parse_schedule({"kind": "every", "minutes": minutes, "from": "08:00", "to": "09:00"})
    assert plan.to_json()["minutes"] == minutes and "hours" not in plan.to_json()
    assert next_run(plan, stamp("2026-02-28T08:00"), tz=timezone.utc) == stamp(f"2026-02-28T08:{minutes:02}")
    assert next_run(plan, stamp("2026-02-28T09:00"), tz=timezone.utc) == stamp("2026-03-01T08:00")


@pytest.mark.parametrize("interval", [{"hours": 1}, {"minutes": 5}])
@pytest.mark.parametrize("state", ["queued", "running", "waiting"])
async def test_a_live_member_skips_the_slot_without_queuing_or_losing_last_run(rig, interval, state):
    routine = (await rig.call("routines.create", {"member_id": 0, "title": "Sample rhythm", "prompt": "Check samples", "schedule": {"kind": "every", **interval}}))["routine"]
    rig.wall.now = routine["next_run"]
    assert rig.service.tick() == [routine["id"]]

    started = rig.wall.now
    rig.conn.execute("UPDATE worker_tasks SET state=?", (state,))
    rig.wall.now += interval.get("minutes", 60) * 60000
    assert rig.service.tick() == []
    assert len(rig.background.submitted) == 1
    row = rig.service.store.routine(routine["id"])
    assert row.last_run_ms == started and row.next_run_ms > rig.wall.now
    rig.background.store.finish(rig.background.attached[0][0], "done", prefix="", text="Completed", detail=None, reason=None)
    rig.wall.now = row.next_run_ms
    assert rig.service.tick() == [routine["id"]]


async def test_a_run_keeps_its_trigger_when_the_routine_is_edited(rig):
    import json
    routine = (await rig.call("routines.create", {"member_id":0,"title":"Sample","prompt":"Review","schedule":{"kind":"every","minutes":5}}))["routine"]
    rig.wall.now = routine["next_run"]
    rig.service.tick()
    await rig.call("routines.update", {"id":routine["id"],"schedule":{"kind":"daily","time":"09:00"}})
    snapshot = json.loads(rig.conn.execute("SELECT trigger_json FROM routine_runs WHERE routine_id=?", (routine["id"],)).fetchone()[0])
    assert snapshot["schedule"] == {"kind":"every","minutes":5}
    assert "prompt" not in snapshot


async def test_older_runs_keep_a_readable_routine_link(rig):
    from raphael_core.members.store import run_triggers
    routine = (await rig.call("routines.create", {"member_id":0,"title":"Sample","prompt":"Review","schedule":{"kind":"daily","time":"09:00"}}))["routine"]
    turn = rig.service._history.add(session_id="sample-old-run",question="Sample",route="routine",prefix="",text="Completed",status="done",source="routine")
    rig.conn.execute("INSERT INTO routine_runs(routine_id,started,status,turn_id) VALUES(?,1,'done',?)", (routine["id"],turn))
    rig.conn.commit()
    assert run_triggers(rig.conn, [turn])[turn]["schedule"] == {"kind":"daily","time":"09:00"}


async def test_members_and_window_read_the_same_unverified_catalogue(rig):
    window = await rig.call("routines.list", {"member_id":0})
    member = await rig.service.routine_tool(0,"routine_list",{})
    assert window["events"] == member["events"] == []
    assert "secret" not in str(window)


async def test_a_waiting_routine_skips_only_its_own_next_slot(rig):
    async def create(title):
        return (await rig.call("routines.create", {"member_id":0,"title":title,"prompt":"Review","schedule":{"kind":"every","minutes":5}}))["routine"]
    first = await create("First")
    rig.wall.now = first["next_run"]
    assert rig.service.tick() == [first["id"]]
    rig.conn.execute("UPDATE worker_tasks SET state='waiting'")
    second = await create("Second")
    rig.wall.now = second["next_run"]
    assert rig.service.tick() == [second["id"]]
    assert [task["routine_id"] for task in rig.background.submitted] == [first["id"], second["id"]]

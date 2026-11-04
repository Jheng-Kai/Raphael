"""Admission is shared by scheduled, event and webhook runs, without model calls."""
import pytest

from raphael_core.brain.settings import SettingsStore
from raphael_core.members.service import OWNER_ABSENCE_MS
from raphael_core.protocol import RpcError


async def make(rig, member=0):
    return (await rig.call("routines.create", {"member_id": member, "title": "Report", "prompt": "Summarize", "schedule": {"kind": "every", "minutes": 5}}))["routine"]


def history(conn, routine, now, count):
    with conn:
        conn.executemany("INSERT INTO routine_runs(routine_id,started,status) VALUES(?,?,'done')", [(routine, now)] * count)


async def test_exact_fifty_routines_per_member_including_paused(rig):
    for _ in range(50):
        await make(rig)
    with pytest.raises(RpcError, match="50 routines"):
        await make(rig)
    other = (await rig.call("members.create", {"name": "Other"}))["member"]["id"]
    assert (await make(rig, other))["member_id"] == other


async def test_member_cap_blocks_before_turn_or_task_then_expires(rig, conn):
    item = await make(rig)
    history(conn, item["id"], rig.wall.now, 200)
    routine = rig.service.store.routine(item["id"])
    assert rig.service._run(routine) is None
    assert not rig.background.submitted
    assert "200" in rig.service.store.routine(routine.id).last_error
    rig.wall.now += 3_600_000
    assert rig.service._run(routine) is not None
    assert rig.service.store.routine(routine.id).last_error == ""


async def test_team_cap_spans_members_using_persisted_history(rig, conn):
    first = await make(rig)
    other = (await rig.call("members.create", {"name": "Other"}))["member"]["id"]
    second = await make(rig, other)
    history(conn, first["id"], rig.wall.now, 150)
    history(conn, second["id"], rig.wall.now, 150)
    assert not rig.service.admit_routine(rig.service.store.routine(second["id"]))
    assert "300" in rig.service.store.routine(second["id"]).last_error


async def test_deleting_routines_does_not_reset_the_hourly_admission_window(rig):
    first = await make(rig)
    assert rig.service._run(rig.service.store.routine(first["id"])) is not None
    settings = SettingsStore(rig.conn)
    receipt = settings.get("routine_run_window")[0]
    settings.set("routine_run_window", [receipt] * 200)
    await rig.call("routines.delete", {"id": first["id"]})
    second = await make(rig)
    assert rig.service._run(rig.service.store.routine(second["id"])) is None
    assert "200" in rig.service.store.routine(second["id"]).last_error


async def test_rate_limited_schedule_retries_without_claiming_it_ran(rig, conn):
    item = await make(rig)
    rig.wall.now += 300_000
    history(conn, item["id"], rig.wall.now, 200)
    assert rig.service.tick() == []
    routine = rig.service.store.routine(item["id"])
    assert routine.last_run_ms is None
    assert routine.next_run_ms == rig.wall.now + 60_000
    assert "200" in routine.last_error


async def test_history_returns_twenty_newest_but_total_still_counts_all_runs(rig, conn):
    item = await make(rig)
    history(conn, item["id"], rig.wall.now, 25)
    result = await rig.call("routines.runs", {"routine_id": item["id"]})
    assert result["total"] == 25
    assert len(result["runs"]) == 20
    assert [row["id"] for row in result["runs"]] == list(range(25, 5, -1))


async def test_absence_pauses_before_returning_owner_refresh_and_requires_explicit_resume(rig):
    item = await make(rig)
    rig.wall.now += OWNER_ABSENCE_MS
    await rig.call("members.viewing", {"id": 0})
    paused = rig.service.store.routine(item["id"])
    assert not paused.enabled and paused.next_run_ms is None
    assert "30" in paused.last_error
    assert rig.service._run(paused) is None
    await rig.call("routines.update", {"id": paused.id, "enabled": True})
    assert rig.service.store.routine(paused.id).enabled
    assert rig.service.store.routine(paused.id).last_error == ""
    assert SettingsStore(rig.conn).get("routine_owner_seen_ms") == rig.wall.now


async def test_activity_report_does_not_change_viewed_member_or_mark_private_work_read(rig):
    other = (await rig.call("members.create", {"name": "Other"}))["member"]["id"]
    await rig.call("members.viewing", {"id": other})
    rig.wall.now += 60_000
    await rig.call("members.viewing", {"activity_only": True})
    assert rig.service._viewing == other
    assert SettingsStore(rig.conn).get("routine_owner_seen_ms") == rig.wall.now

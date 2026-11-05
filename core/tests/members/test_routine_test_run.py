"""Manual tests share production admission, worker delivery and accounting, with fakes only."""
from datetime import datetime, timezone

import pytest

from raphael_core.brain.settings import SettingsStore
from raphael_core.members.schedule import next_run, parse_schedule


async def make(rig, **fields):
    return (await rig.call("routines.create", {"member_id": 0, "title": "Sample report", "prompt": "Read only synthetic notes", "schedule": {"kind": "daily", "time": "08:00"}, **fields}))["routine"]


async def test_manual_run_delivers_instruction_without_moving_schedule_and_records_cost(rig):
    member = (await rig.call("members.create", {"name": "Sample"}))["member"]["id"]
    routine = await make(rig, member_id=member)
    result = await rig.call("routines.run", {"id": routine["id"]})
    task = rig.background.submitted[0]
    assert task["text"] == routine["prompt"] and task["member_id"] == member
    turn = rig.service._history.get(result["turn_id"])
    assert turn.member_id == member and turn.conversation_id is not None and turn.scope == "private"
    assert rig.service.store.routine(routine["id"]).next_run_ms == routine["next_run"]
    rig.service._history.resolve(turn.id, prefix="", text="Synthetic result", status="done", cost_usd=0.013)
    rig.service.turn_arrived(turn.id)
    run = (await rig.call("routines.runs", {"routine_id": routine["id"]}))["runs"][0]
    assert run["id"] == result["run_id"] and run["status"] == "done"
    assert run["cost"] == 0.013 and run["summary"] == "Synthetic result" and run["finished"] is not None
    assert SettingsStore(rig.conn).get("routine_run_window") == [[member, rig.wall.now]]


async def test_manual_run_can_test_a_paused_routine_without_enabling_it(rig):
    routine = await make(rig, enabled=False)
    assert (await rig.call("routines.run", {"id": routine["id"]}))["run_id"]
    stored = rig.service.store.routine(routine["id"])
    assert not stored.enabled and stored.next_run_ms is None


async def test_manual_overlap_refuses_with_words_and_does_not_submit_twice(rig):
    routine = await make(rig)
    await rig.call("routines.run", {"id": routine["id"]})
    result = await rig.call("routines.run", {"id": routine["id"]})
    assert result["status"] == "refused" and "等候" in result["reason"]
    assert len(rig.background.submitted) == 1


@pytest.mark.parametrize("member_count,other_count,reason", [(200, 0, "200"), (100, 200, "300")])
async def test_manual_run_uses_hourly_member_and_team_caps(rig, member_count, other_count, reason):
    routine = await make(rig)
    rig.service._settings.set("routine_run_window", [[0, rig.wall.now]] * member_count + [[42, rig.wall.now]] * other_count)
    result = await rig.call("routines.run", {"id": routine["id"]})
    assert result["status"] == "refused" and reason in result["reason"]
    assert not rig.background.submitted


async def test_worker_refusal_is_a_finished_run_with_a_readable_reason_and_admission_receipt(rig):
    routine = await make(rig)
    rig.background.refuse = "budget"
    result = await rig.call("routines.run", {"id": routine["id"]})
    run = (await rig.call("routines.runs", {"routine_id": routine["id"]}))["runs"][0]
    assert result["run_id"] == run["id"] and run["status"] == "error"
    assert run["summary"] and run["finished"] is not None
    assert len(rig.service._settings.get("routine_run_window")) == 1


async def test_saved_zone_survives_setting_changes_reopen_and_computer_zone_changes(rig):
    rig.service.observe_timezone("Asia/Taipei")
    first = await make(rig)
    assert first["schedule"]["timezone"] == "Asia/Taipei"
    rig.service._settings.set("routine_timezone", "America/New_York")
    second = await make(rig)
    assert second["schedule"]["timezone"] == "America/New_York"
    rig.service.observe_timezone("Europe/London")
    updated = (await rig.call("routines.update", {"id": first["id"], "schedule": {"kind": "daily", "time": "09:00"}}))["routine"]
    assert updated["schedule"]["timezone"] == "Asia/Taipei"
    rig.service._settings.set("routine_timezone", "")
    third = await make(rig)
    assert third["schedule"]["timezone"] == "Europe/London"
    rig.service._settings = SettingsStore(rig.conn)
    assert rig.service.store.routine(second["id"]).schedule.timezone == "America/New_York"


def ms(iso):
    return int(datetime.fromisoformat(iso).timestamp() * 1000)


@pytest.mark.parametrize("before,expected", [
    ("2026-03-07T13:00:00+00:00", "2026-03-08T12:00:00+00:00"),
    ("2026-10-31T12:00:00+00:00", "2026-11-01T13:00:00+00:00"),
])
def test_saved_zone_keeps_eight_am_across_both_dst_changes(before, expected):
    plan = parse_schedule({"kind": "daily", "time": "08:00", "timezone": "America/New_York"})
    assert next_run(plan, ms(before), tz=timezone.utc) == ms(expected)


def test_dst_gap_is_skipped_and_fold_is_not_run_twice():
    gap = parse_schedule({"kind": "daily", "time": "02:30", "timezone": "America/New_York"})
    assert next_run(gap, ms("2026-03-07T07:30:00+00:00")) == ms("2026-03-09T06:30:00+00:00")
    fold = parse_schedule({"kind": "daily", "time": "01:30", "timezone": "America/New_York"})
    assert next_run(fold, ms("2026-11-01T05:30:00+00:00")) == ms("2026-11-02T06:30:00+00:00")


@pytest.mark.parametrize("fields,before,expected", [
    ({"kind": "weekly", "days": [0]}, "2026-03-01T07:30:00+00:00", "2026-03-15T06:30:00+00:00"),
    ({"kind": "monthly", "day": 8}, "2026-02-08T07:30:00+00:00", "2026-04-08T06:30:00+00:00"),
    ({"kind": "every", "minutes": 5, "from": "02:00", "to": "02:30"}, "2026-03-07T07:30:00+00:00", "2026-03-09T06:00:00+00:00"),
])
def test_dst_gap_skips_the_whole_occurrence_for_sparse_schedules(fields, before, expected):
    plan = parse_schedule({**fields, "time": "02:30", "timezone": "America/New_York"})
    assert next_run(plan, ms(before)) == ms(expected)


@pytest.mark.parametrize("value", ["Mars/Olympus", "../UTC", 123])
def test_settings_and_schedule_refuse_invalid_zones(value):
    # Parameter validation is the same at storage and schedule boundaries.
    with pytest.raises(ValueError, match="IANA"):
        parse_schedule({"kind": "daily", "time": "08:00", "timezone": value})


async def test_setting_refuses_unknown_zone(rig):
    with pytest.raises(ValueError, match="IANA"):
        rig.service._settings.set("routine_timezone", "Mars/Olympus")


async def test_owner_viewing_pins_legacy_zone_once_before_a_later_computer_zone_change(rig):
    routine = await make(rig)
    await rig.call("members.viewing", {"id": 0, "tz": "Asia/Taipei"})
    original_due = rig.service.store.routine(routine["id"]).next_run_ms
    await rig.call("members.viewing", {"activity_only": True, "tz": "Europe/London"})
    saved = rig.service.store.routine(routine["id"])
    assert saved.schedule.timezone == "Asia/Taipei" and saved.next_run_ms == original_due
    assert (await make(rig))["schedule"]["timezone"] == "Europe/London"

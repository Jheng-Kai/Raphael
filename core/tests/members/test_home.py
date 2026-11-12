"""The calendar's projection (`home.overview`) aggregates existing records without changing read state or storage."""

import pytest
import asyncio
import json

from raphael_core.agent.history import AgentHistory
from raphael_core.home import HomeOverview
from raphael_core.protocol import INVALID_PARAMS, RpcError


@pytest.fixture
async def home(rig):
    service = HomeOverview(rig.conn, rig.rpc, rig.service, now_ms=rig.wall, tz=rig.service._tz)
    service.register()
    yield service


def add(rig, member=0, **kwargs):
    return AgentHistory(rig.conn, rig.wall).add(
        session_id="home-test", question="Review this", route="answer", prefix="", text="A report\nwith details",
        member_id=member, **{"status": "done", **kwargs},
    )


async def test_empty_overview_has_no_connector_and_asks_no_other_service(home, rig):
    before = rig.conn.total_changes
    value = await rig.call("home.overview")
    assert value["today"] == value["reports"] == value["calendar"] == []
    # What only Home read is gone (2026-11-12): no usage, dictation, report, health, activity or model-written line.
    assert not {"usage", "dictation", "report", "today_plan", "health", "activity"} & value.keys()
    assert rig.conn.total_changes == before


async def test_home_projection_matches_the_full_member_view_without_reading_it(home, rig, monkeypatch):
    member = (await rig.call("members.create", {"name": "Research", "avatar": "slime:blue"}))["member"]["id"]
    rig.service._settings.set("first_bot_profile", {"name": "Morning"})
    add(rig, member)
    rig.service.store.mark_unread(member)
    actual = await rig.call("home.overview", {"ui_language": "ja"})

    async def full(params):
        return {row["id"]: row for row in (await rig.call("members.list", params))["members"]}

    monkeypatch.setattr(home, "_people", full)
    assert await rig.call("home.overview", {"ui_language": "ja"}) == actual


@pytest.mark.parametrize("kind", ["routine", "calendar", "meeting", "skill_learned"])
@pytest.mark.parametrize("action", ["created", "updated"])
async def test_home_and_sidebar_do_not_read_receipt_transport_as_a_report(home, rig, kind, action):
    member = (await rig.call("members.create", {"name": "Sample colleague"}))["member"]["id"]
    turn_id = add(rig, member)
    history = rig.service._history
    raw = json.dumps({"type": kind, "action": action, "id": 987654321, "name": "Sample orchard"})
    history.add_message(turn_id, "event", raw)
    value = await rig.call("home.overview")
    rows = (await rig.call("members.list"))["members"]
    assert next(row for row in rows if row["id"] == member)["preview"] == "A report with details"
    public = json.dumps(value, ensure_ascii=False)
    assert "987654321" not in public and raw not in public


async def test_five_minute_rhythm_marks_every_day_of_the_month_grid(home, rig):
    await rig.call("routines.create", {"member_id":0,"title":"Sample rhythm","prompt":"Review samples","schedule":{"kind":"every","minutes":5}})
    value = await rig.call("home.overview")
    bars = [item for item in value["calendar_items"] if item.get("rhythm")]
    assert len(bars) == 42
    assert len({item["at_ms"] for item in bars}) == 42


async def test_home_draws_one_rhythm_per_day_with_timed_failure_and_waiting_exceptions(home, rig):
    from datetime import datetime
    routine = (await rig.call("routines.create", {"member_id": 0, "title": "Sample review", "prompt": "Review samples",
        "schedule": {"kind": "every", "hours": 3, "from": "08:00", "to": "23:00"}}))["routine"]
    day = datetime.fromtimestamp(rig.wall()/1000, rig.service._tz).replace(hour=0, minute=0, second=0, microsecond=0)
    for hour, status in [(8, "done"), (11, "error"), (14, "confirm")]:
        at = int(day.replace(hour=hour).timestamp()*1000)
        rig.conn.execute("INSERT INTO routine_runs(routine_id,scheduled,started,status) VALUES(?,?,?,?)", (routine["id"],at,at,status))
    rig.conn.commit()
    value = await rig.call("home.overview")
    key = day.date().isoformat()
    items = [item for item in value["calendar_items"] if datetime.fromtimestamp(item["at_ms"]/1000, rig.service._tz).date().isoformat()==key]
    assert len([item for item in items if item.get("rhythm")]) == 1
    assert [item.get("run_status") for item in items if not item.get("rhythm")] == ["error", "confirm"]
    assert value["calendar_counts"][key] == 3


async def test_pending_questions_of_one_conversation_and_latest_unread_report(home, rig):
    member = (await rig.call("members.create", {"name": "Research"}))["member"]["id"]
    older = add(rig, member)
    newest = add(rig, member)
    rig.service.store.mark_unread(member)
    first = add(rig, member, status="confirm")
    second = add(rig, member, status="confirm")
    value = await rig.call("home.overview")
    assert [r["turn_id"] for r in value["reports"]] == [newest]
    assert older != newest
    assert {r["turn_id"] for r in value["today"] if r["kind"] == "question"} == {first, second}
    assert len(value["today"]) == value["counts"]["today"] == 2
    assert {r["id"] for r in value["today"]}.isdisjoint(r["id"] for r in value["reports"])
    assert value["reports"][0]["summary"] == "A report with details"
    assert member in rig.service.store.unread()
    await rig.call("members.read", {"id": member})
    assert (await rig.call("home.overview"))["reports"] == []


async def test_routine_occurrences_are_ordered_include_today_and_respect_disabled(home, rig):
    for title, time, enabled in [("Later", "17:00", True), ("Earlier", "09:00", True), ("Off", "10:00", False)]:
        await rig.call("routines.create", {"member_id": 0, "title": title, "prompt": "Report", "schedule": {"kind": "daily", "time": time}, "enabled": enabled})
    value = await rig.call("home.overview")
    assert [r["title"] for r in value["today"]] == ["Earlier", "Later"]
    assert len(value["calendar"]) == 14
    assert [r["at_ms"] for r in value["calendar"]] == sorted(r["at_ms"] for r in value["calendar"])
    assert all(r["title"] != "Off" for r in value["calendar"])


async def test_limits_are_applied_after_ordering(home, rig):
    for n in range(15):
        mid = (await rig.call("members.create", {"name": f"Member {n}"}))["member"]["id"]
        add(rig, mid)
        rig.service.store.mark_unread(mid)
        rig.wall.now += 1
    value = await rig.call("home.overview")
    assert len(value["reports"]) == 8
    assert value["today"] == []
    assert value["counts"]["today"] == 0
    assert value["counts"]["reports"] == 15
    assert value["reports"][0]["member_id"] == 15


async def test_today_keeps_all_pending_questions_after_ordering(home, rig):
    turns = []
    for _ in range(15):
        turns.append(add(rig, status="confirm"))
        rig.wall.now += 1
    value = await rig.call("home.overview")
    assert [item["turn_id"] for item in value["today"]] == turns
    assert value["counts"]["today"] == 15
    assert value["reports"] == []


async def test_calendar_seam_and_invalid_timezone(home, rig):
    async def events(start, end):
        return [{"id": "private-event", "kind": "event", "title": "Planning", "summary": "", "at_ms": rig.wall.now + 1000, "member_id": 0, "name": "Raphael", "avatar": "", "turn_id": None, "conversation_id": None, "routine_id": None}]
    home.calendar_events = events
    assert (await rig.call("home.overview", {"refresh": True}))["calendar"][0]["title"] == "Planning"
    with pytest.raises(RpcError) as caught:
        await rig.call("home.overview", {"tz": "invalid/timezone"})
    assert caught.value.code == INVALID_PARAMS


async def test_browser_timezone_is_remembered_without_storage_or_default_zone_changes(home, rig):
    before = rig.conn.total_changes
    default_zone = home.tz
    assert home.timezone_name is None
    await rig.call("home.overview", {"tz": "Asia/Taipei"})
    await rig.call("home.overview")
    assert home.timezone_name == "Asia/Taipei"
    assert home.tz is default_zone
    assert rig.conn.total_changes == before


async def test_occurrences_stop_at_maximum_runs_and_calendar_is_bounded(home, rig):
    await rig.call("routines.create", {"member_id": 0, "title": "One remaining", "prompt": "Report",
                                      "schedule": {"kind": "daily", "time": "09:00", "max_runs": 1}})
    limited = await rig.call("home.overview")
    assert len(limited["calendar"]) == 1
    await rig.call("routines.create", {"member_id": 0, "title": "Hourly", "prompt": "Report",
                                      "schedule": {"kind": "every", "hours": 1}})
    assert len((await rig.call("home.overview"))["calendar"]) == 24


async def test_month_marks_routines_and_events_beyond_the_week_without_changing_records(home, rig):
    from datetime import datetime
    zone = rig.service._tz
    await rig.call("routines.create", {"member_id": 0, "title": "Daily", "prompt": "Report",
                                      "schedule": {"kind": "daily", "time": "09:00"}})
    requested = []
    event_at = int(datetime(2026, 10, 31, 12, tzinfo=zone).timestamp() * 1000)

    async def events(start, end):
        requested.append((start, end))
        return [{"kind": "event", "at_ms": event_at, "title": "Month end"}]

    home.calendar_events = events
    before = rig.conn.total_changes
    value = await rig.call("home.overview", {"refresh": True})
    assert len(value["calendar_days"]) == 42
    assert "2026-10-01" in value["calendar_days"]
    assert "2026-10-31" in value["calendar_days"]
    assert all(item["at_ms"] < event_at for item in value["calendar"])
    assert value["calendar_events"][0]["title"] == "Month end"
    assert len(value["calendar"]) == 7
    assert datetime.fromtimestamp(requested[0][0] / 1000, zone).date().isoformat() == "2026-09-28"
    assert datetime.fromtimestamp(requested[0][1] / 1000, zone).date().isoformat() == "2026-11-09"
    assert rig.conn.total_changes == before


async def test_changing_month_requests_that_grid_and_rejects_invalid_keys(home, rig):
    from datetime import datetime
    ranges = []
    async def events(start, end):
        ranges.append((start, end))
        return []
    home.calendar_events = events
    await rig.call("home.overview", {"month": "2026-12", "refresh": True})
    assert datetime.fromtimestamp(ranges[0][0] / 1000, rig.service._tz).date().isoformat() == "2026-11-30"
    assert datetime.fromtimestamp(ranges[0][1] / 1000, rig.service._tz).date().isoformat() == "2027-01-11"
    for value in [None, 202612, "2026-13", "2026-2", "bad"]:
        with pytest.raises(RpcError) as caught:
            await rig.call("home.overview", {"month": value})
        assert caught.value.code == INVALID_PARAMS


async def test_month_agenda_keeps_three_earliest_items_and_full_daily_counts(home, rig):
    for hour in range(8, 12):
        await rig.call("routines.create", {"member_id": 0, "title": "Daily review", "prompt": "Report",
                                          "schedule": {"kind": "daily", "time": f"{hour:02}:00"}})
    value = await rig.call("home.overview")
    assert len(value["calendar_counts"]) == 42
    assert set(value["calendar_counts"].values()) == {4}
    assert len(value["calendar_items"]) == 42 * 3
    for key in value["calendar_counts"]:
        from datetime import datetime
        items = [item for item in value["calendar_items"] if datetime.fromtimestamp(item["at_ms"] / 1000, rig.service._tz).date().isoformat() == key]
        assert len(items) == 3
        assert [item["at_ms"] for item in items] == sorted(item["at_ms"] for item in items)


async def test_worker_question_keeps_its_conversation_and_connector_failure_is_isolated(home, rig):
    turn = add(rig)
    task = rig.background.submit(session_id="question", text="Work", language="en", model="")
    rig.conn.execute("UPDATE worker_tasks SET state='waiting', turn_id=? WHERE id=?", (turn, task))
    rig.conn.execute("INSERT INTO worker_questions (id,task_id,member_id,prefix,text,created_at_ms,expires_at_ms,remaining_s) VALUES ('q',?,0,'','Approve this',?,?,60)",
                     (task, rig.wall.now, rig.wall.now + 60000))

    async def unavailable(start, end):
        raise ConnectionError("Calendar unavailable")

    home.calendar_events = unavailable
    value = await rig.call("home.overview", {"refresh": True})
    assert value["today"][0]["turn_id"] == turn
    assert value["today"][0]["conversation_id"] is not None
    assert value["calendar"] == []


async def test_today_includes_every_event_and_high_frequency_routine_in_time_order(home, rig):
    from datetime import datetime
    day = datetime.fromtimestamp(rig.wall.now / 1000, rig.service._tz).replace(hour=0, minute=0, second=0, microsecond=0)
    start = int(day.timestamp() * 1000)
    await rig.call("routines.create", {"member_id": 0, "title": "Frequent", "prompt": "Check", "schedule": {"kind": "every", "minutes": 5}})
    async def events(first, last):
        return [{"id": f"event:{n}", "kind": "event", "title": f"Meeting {n}", "at_ms": start + n * 1_000,
                 "end_ms": start + n * 1_000 + 500, "member_id": 0} for n in range(20)]
    home.calendar_events = events
    value = await rig.call("home.overview", {"refresh": True})
    assert len([item for item in value["today"] if item["kind"] == "event"]) == 20
    assert len([item for item in value["today"] if item["kind"] == "routine"]) == 288
    assert value["counts"]["today"] == len(value["today"])
    assert [item["at_ms"] for item in value["today"]] == sorted(item["at_ms"] for item in value["today"])


async def test_durable_owner_question_is_in_today(home, rig):
    from raphael_core.agent.owner_questions import OwnerQuestions
    turn = add(rig, status="running")
    task = rig.background.submit(session_id="owner", text="Research", language="en", model="")
    rig.conn.execute("UPDATE worker_tasks SET state='waiting',turn_id=? WHERE id=?", (turn, task))
    question = OwnerQuestions(rig.conn, now_ms=rig.wall).open(rig.background.store.get(task), "ask_owner", {"question": "Which source should I use?"})
    value = await rig.call("home.overview")
    assert value["today"][0]["id"] == f"question:owner:{question['id']}"
    assert value["today"][0]["title"] == "Which source should I use?"


async def test_today_remains_today_when_the_window_requests_another_month(home, rig):
    meeting = {"id": "meeting", "kind": "event", "title": "Today", "at_ms": rig.wall.now, "member_id": 0}
    async def events(start, end):
        return [meeting] if start <= meeting["at_ms"] < end else []
    home.calendar_events = events
    value = await rig.call("home.overview", {"month": "2026-12", "refresh": True})
    assert value["calendar_events"] == []
    assert value["today"] == [meeting]


async def test_today_keeps_recorded_runs_of_a_paused_or_exhausted_routine(home, rig):
    routine = (await rig.call("routines.create", {"member_id": 0, "title": "Completed review", "prompt": "Review", "enabled": False,
               "schedule": {"kind": "daily", "time": "09:00", "max_runs": 1}}))["routine"]
    rig.conn.execute("INSERT INTO routine_runs(routine_id,started,scheduled,finished,status) VALUES(?,?,?,?,'done')",
                     (routine["id"], rig.wall.now, rig.wall.now, rig.wall.now))
    value = await rig.call("home.overview")
    assert [item["routine_id"] for item in value["today"]] == [routine["id"]]

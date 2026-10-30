"""The home RPC aggregates existing records without changing read state or storage."""

import pytest
import asyncio

from raphael_core.agent.history import AgentHistory
from raphael_core.home import HomeOverview
from raphael_core.protocol import INVALID_PARAMS, RpcError


@pytest.fixture
def home(rig):
    async def status(_):
        return {"spend": {"month_usd": 4, "limit_usd": 20, "daily": [0] * 14}, "openrouter": {"state": "no_key"}}

    async def stats(_):
        return {"all": {"words": 30, "audio_seconds": 10}, "time_saved_seconds": 20, "speed_wpm": 180,
                "by_day": [{"date": f"2026-10-{d:02d}", "dictations": 1, "words": d} for d in range(11, 25)]}

    async def allowances(_):
        return {"brains": [{"id": "codex", "name": "Codex", "windows": []}]}

    for name, handler in [("status.get", status), ("stats.summary", stats), ("usage.allowances", allowances)]:
        rig.rpc.register(name, handler)
    service = HomeOverview(rig.conn, rig.rpc, rig.service, now_ms=rig.wall, tz=rig.service._tz)
    service.register()
    return service


def add(rig, member=0, **kwargs):
    return AgentHistory(rig.conn, rig.wall).add(
        session_id="home-test", question="Review this", route="answer", prefix="", text="A report\nwith details",
        member_id=member, **{"status": "done", **kwargs},
    )


async def test_empty_overview_preserves_service_numbers_and_has_no_connector(home, rig):
    before = rig.conn.total_changes
    value = await rig.call("home.overview")
    assert value["today"] == value["reports"] == value["calendar"] == []
    assert value["usage"]["month_usd"] == 4
    assert len(value["usage"]["daily"]) == 14
    assert value["usage"]["allowances"]["brains"][0]["id"] == "codex"
    assert value["dictation"]["words"] == 30
    assert value["dictation"]["daily"] == list(range(11, 25))
    assert value["report"]["openrouter"]["state"] == "no_key"
    assert rig.conn.total_changes == before


async def test_local_home_does_not_wait_for_live_allowances_or_calendar(home, rig, monkeypatch):
    calls = []
    async def allowances(params):
        calls.append(params)
        if params.get("refresh", True):
            await asyncio.sleep(2)
        return {"brains": [{"id": "codex", "name": "Codex", "windows": []}]}
    async def calendar(start, end):
        await asyncio.sleep(2)
        return []
    monkeypatch.setitem(rig.rpc._handlers, "usage.allowances", allowances)
    home.calendar_events = calendar
    value = await asyncio.wait_for(rig.call("home.overview"), .2)
    assert value["usage"]["allowances"]["brains"][0]["id"] == "codex"
    assert calls == [{"refresh": False}]


async def test_pending_in_different_conversations_and_latest_unread_report(home, rig):
    member = (await rig.call("members.create", {"name": "Research"}))["member"]["id"]
    older = add(rig, member)
    newest = add(rig, member)
    rig.service.store.mark_unread(member)
    first = add(rig, member, status="confirm")
    from raphael_core.agent.conversations import Conversations
    conversation = Conversations(rig.conn, rig.wall).create(member)["id"]
    second = add(rig, member, status="confirm", conversation_id=conversation)
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


async def test_today_limits_pending_questions_after_ordering(home, rig):
    turns = []
    for _ in range(15):
        turns.append(add(rig, status="confirm"))
        rig.wall.now += 1
    value = await rig.call("home.overview")
    assert [item["turn_id"] for item in value["today"]] == turns[:12]
    assert value["counts"]["today"] == 15
    assert value["reports"] == []


async def test_calendar_seam_and_invalid_timezone(home, rig):
    async def events(start, end):
        return [{"id": "private-event", "kind": "event", "title": "Planning", "summary": "", "at_ms": rig.wall.now + 1000, "member_id": 0, "name": "Raphael", "avatar_url": None, "turn_id": None, "conversation_id": None, "routine_id": None}]
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
    await rig.call("routines.create", {"member_id": 0, "title": "Hourly", "prompt": "Report",
                                      "schedule": {"kind": "every", "hours": 1}})
    value = await rig.call("home.overview")
    assert len(value["calendar_counts"]) == 42
    assert set(value["calendar_counts"].values()) == {24}
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

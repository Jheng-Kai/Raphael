"""The home RPC aggregates existing records without changing read state or storage."""

import pytest
import asyncio
import json

from raphael_core.agent.history import AgentHistory
from raphael_core.home import HomeOverview
from raphael_core.protocol import INVALID_PARAMS, RpcError


@pytest.fixture
async def home(rig, monkeypatch):
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
    monkeypatch.setattr(rig.memory, "may_spend", lambda member_id=0: False)
    yield service
    await service.aclose()


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


async def test_home_refresh_inside_five_minute_ttl_starts_no_cli_process(home, rig, monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from raphael_core.agent.cli import allowances

    children = []
    def child(*args, **kwargs):
        process = SimpleNamespace(stdout=SimpleNamespace(readline=AsyncMock(side_effect=[
            b'{"id":1,"result":{}}\n', b'{"id":2,"result":{"rateLimits":{}}}\n',
        ])))
        value = SimpleNamespace(start=AsyncMock(), send=AsyncMock(), kill=AsyncMock(), process=process)
        children.append(value)
        return value
    monkeypatch.setattr(allowances, "Child", child)
    brains = SimpleNamespace(command=lambda name: ["codex"] if name == "codex" else None,
                             logged_in=lambda name: True, environ={})
    quotas = SimpleNamespace(allowances=lambda name: [], list=lambda: [])
    async def read(params):
        if not params.get("refresh", True):
            return allowances.cached_allowances(brains, quotas)
        return await allowances.read_allowances(brains)
    monkeypatch.setitem(rig.rpc._handlers, "usage.allowances", read)
    await rig.call("home.overview", {"refresh": True})
    assert len(children) == 1
    children[0].start.assert_awaited_once()
    rig.wall.now += 299_999
    await rig.call("home.overview", {"refresh": True})
    assert len(children) == 1
    rig.wall.now += 1
    await rig.call("home.overview", {"refresh": True})
    assert len(children) == 2
    children[1].start.assert_awaited_once()


async def test_concurrent_home_allowance_refreshes_share_the_pending_read(home, rig, monkeypatch):
    started, release = asyncio.Event(), asyncio.Event()
    calls = []
    async def read(params):
        calls.append(params)
        started.set()
        await release.wait()
        return {"brains": []}
    monkeypatch.setitem(rig.rpc._handlers, "usage.allowances", read)
    first = asyncio.create_task(home._allowances(True))
    await started.wait()
    second = asyncio.create_task(home._allowances(True))
    await asyncio.sleep(0)
    release.set()
    assert await first == await second == {"brains": []}
    assert calls == [{}]


async def test_activity_counts_work_on_the_local_day_it_finished(home, rig):
    from datetime import datetime
    def at(value):
        return int(datetime.fromisoformat(value).timestamp() * 1000)
    # This long-running turn began the day before, then finished at the local midnight that starts yesterday.
    rig.wall.now = at("2026-11-06T23:00:00+08:00")
    old = add(rig)
    rig.conn.execute("INSERT INTO run_metrics(kind,run_id,started_at_ms,finished_at_ms) VALUES('turn',?,?,?)",
                     (old, rig.wall.now, at("2026-11-07T00:00:00+08:00")))
    rig.wall.now = at("2026-11-07T23:59:59+08:00")
    add(rig, source="telegram")
    rig.wall.now = at("2026-11-08T00:00:00+08:00")
    add(rig)
    rig.wall.now = at("2026-11-08T00:05:00+08:00")
    days = {day["date"]: day for day in (await rig.call("home.overview", {"tz": "Asia/Taipei"}))["activity"]["days"]}
    assert (days["2026-11-06"]["work"], days["2026-11-07"]["work"], days["2026-11-07"]["messages"], days["2026-11-08"]["work"]) == (0, 1, 1, 1)


async def test_no_model_returns_structured_only_without_writes(home, rig):
    add(rig, status="confirm")
    before = rig.conn.total_changes
    value = await rig.call("home.overview")
    assert value["today_plan"]["narrative"] is None
    assert value["today_plan"]["state"] == "unavailable"
    assert value["today_plan"]["reason"] == "model_unavailable"
    assert "yesterday" not in value and "members" not in value
    assert value["today_plan"]["items"][0]["kind"] == "question"
    assert rig.conn.total_changes == before
    assert home.narratives.tasks == {}


@pytest.fixture
def narrative_model(rig, monkeypatch):
    from types import SimpleNamespace
    calls = []
    class FakeModel:
        async def complete_json(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(data={"narrative": "The team finished its work."}, model=kwargs["model"], cost_usd=0,
                                   prompt_tokens=0, completion_tokens=0, latency_ms=0)
    monkeypatch.setattr(rig.memory, "_base_client", FakeModel())
    monkeypatch.setattr(rig.memory, "may_spend", lambda member_id=0: True)
    return calls


async def test_daily_narratives_are_single_flight_cached_and_survive_restart(home, rig, narrative_model):
    from raphael_core.home_digest import DailyNarratives
    first = await rig.call("home.overview")
    assert first["today_plan"]["state"] == "pending"
    again = await rig.call("home.overview")
    assert again["today_plan"]["state"] in ("pending", "ready")
    await asyncio.gather(*list(home.narratives.tasks.values()))
    ready = await rig.call("home.overview")
    assert ready["today_plan"]["narrative"] == "The team finished its work."
    assert len(narrative_model) == 1
    assert all(call["model"] == rig.memory._model(0) and call["fallbacks"] == [] for call in narrative_model)
    assert all("zh-TW" in call["system"] for call in narrative_model)
    home.narratives = DailyNarratives(rig.conn, rig.service, rig.wall)
    assert (await rig.call("home.overview"))["today_plan"]["narrative"] == ready["today_plan"]["narrative"]
    assert len(narrative_model) == 1
    rig.wall.now += 86_400_000
    assert (await rig.call("home.overview"))["today_plan"]["state"] == "pending"
    await asyncio.gather(*list(home.narratives.tasks.values()))
    assert len(narrative_model) == 2


async def test_overview_never_waits_for_narrative_and_shutdown_cancels_it(home, rig, narrative_model, monkeypatch):
    started, hold = asyncio.Event(), asyncio.Event()
    async def slow(**kwargs):
        started.set()
        await hold.wait()
    monkeypatch.setattr(rig.memory._base_client, "complete_json", slow)
    value = await asyncio.wait_for(rig.call("home.overview"), .2)
    assert value["today_plan"]["state"] == "pending"
    await started.wait()
    tasks = list(home.narratives.tasks.values())
    await home.aclose()
    assert all(task.cancelled() for task in tasks)
    assert not home.narratives.tasks


async def test_failed_model_returns_reason_and_never_retries_or_falls_back(home, rig, narrative_model, monkeypatch):
    calls = []
    async def fail(**kwargs):
        calls.append(kwargs)
        raise RuntimeError("Private provider text")
    monkeypatch.setattr(rig.memory._base_client, "complete_json", fail)
    await rig.call("home.overview")
    await asyncio.gather(*list(home.narratives.tasks.values()))
    value = await rig.call("home.overview")
    assert value["today_plan"]["reason"] == "generation_failed"
    assert value["today_plan"]["narrative"] is None
    assert len(calls) == 1 and all(call["fallbacks"] == [] for call in calls)
    assert "Private provider text" not in json.dumps(value)


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


async def test_today_plan_lists_work_that_has_not_finished(home, rig):
    add(rig, status="confirm")
    task = rig.background.submit(session_id="busy", text="Review the mail\nPrivate details", language="en", model="")
    rig.conn.execute("UPDATE worker_tasks SET state='running' WHERE id=?", (task,))
    value = await rig.call("home.overview")
    assert any(item["kind"] == "unfinished" and item["title"].startswith("Review the mail") for item in value["today_plan"]["items"])


async def test_health_mirrors_only_existing_self_check_observations(home, rig):
    calls = []
    def diagnostics(speaker, turn):
        calls.append((speaker.id, turn))
        return {"keys_present": {"OpenRouter": None, "Composio": False},
                "brains": [{"id": "codex", "installed": True, "signed_in": True},
                           {"id": "claude", "installed": True, "signed_in": False}],
                "connections": [{"id": "github", "name": "GitHub", "source": "composio", "state": "ready"},
                                {"id": "broken", "name": "Weather", "state": "error"}],
                "memory": {"status": "ok"}}
    rig.background.diagnostics = diagnostics
    checks = (await rig.call("home.overview"))["health"]["checks"]
    assert calls == [(0, None)]
    assert [check["id"] for check in checks] == ["key:OpenRouter", "key:Composio", "brain:codex", "brain:claude", "connection:github", "connection:broken", "memory"]
    assert [check["status"] for check in checks] == ["warn", "warn", "ok", "warn", "ok", "error", "ok"]
    assert all(check["detail"] for check in checks if check["status"] != "ok")
    assert not any(check["id"] in ("core", "storage", "backup", "computer") for check in checks)


async def test_a_delegated_turn_counts_on_the_day_its_task_finishes(home, rig):
    now = rig.wall.now
    rig.wall.now -= 86_400_000
    turn = add(rig)
    task = rig.background.submit(session_id="long", text="Long project", language="en", model="")
    rig.conn.execute("UPDATE worker_tasks SET turn_id=?,state='done',finished_at_ms=? WHERE id=?", (turn, now, task))
    rig.wall.now = now
    days = (await rig.call("home.overview"))["activity"]["days"]
    assert (days[-2]["work"], days[-1]["work"]) == (0, 1)


async def test_durable_owner_question_is_in_today_and_today_plan(home, rig):
    from raphael_core.agent.owner_questions import OwnerQuestions
    turn = add(rig, status="running")
    task = rig.background.submit(session_id="owner", text="Research", language="en", model="")
    rig.conn.execute("UPDATE worker_tasks SET state='waiting',turn_id=? WHERE id=?", (turn, task))
    question = OwnerQuestions(rig.conn, now_ms=rig.wall).open(rig.background.store.get(task), "ask_owner", {"question": "Which source should I use?"})
    value = await rig.call("home.overview")
    assert value["today"][0]["id"] == f"question:owner:{question['id']}"
    assert value["today"][0]["title"] == "Which source should I use?"
    assert any(item["kind"] == "question" for item in value["today_plan"]["items"])


async def test_today_remains_today_when_the_window_requests_another_month(home, rig):
    meeting = {"id": "meeting", "kind": "event", "title": "Today", "at_ms": rig.wall.now, "member_id": 0}
    async def events(start, end):
        return [meeting] if start <= meeting["at_ms"] < end else []
    home.calendar_events = events
    value = await rig.call("home.overview", {"month": "2026-12", "refresh": True})
    assert value["calendar_events"] == []
    assert value["today"] == [meeting]


async def test_selected_api_model_never_uses_auxiliary_or_openrouter_availability(home, rig, monkeypatch):
    from types import SimpleNamespace
    from raphael_core.brain.providers.registry import ProviderRouter
    checked = []
    def available(reference):
        checked.append(reference)
        return False
    monkeypatch.setattr(rig.memory, "_base_client", ProviderRouter(SimpleNamespace(available=available), None, "memory"))
    rig.service._settings.set("agent_model", "@chosen:owner-model")
    value = await rig.call("home.overview")
    assert value["today_plan"]["model"] == "@chosen:owner-model"
    assert value["today_plan"]["reason"] == "model_unavailable"
    assert checked == ["@chosen:owner-model"]
    assert not home.narratives.tasks


async def test_selected_cli_model_is_used_with_no_api_fallback(home, rig, monkeypatch):
    from types import SimpleNamespace
    calls = []
    class FakeCliLoop:
        def __init__(self, **kwargs):
            calls.append(kwargs)
            self.failure = None
        async def run(self):
            return SimpleNamespace(status="done", final='{"narrative":"Today the team will review the mail."}')
        async def aclose(self):
            pass
    rig.service._settings.set("agent_model", "cli:codex:owner-model")
    monkeypatch.setattr(rig.memory, "_cli_brains", SimpleNamespace(available=lambda name: name == "codex"))
    monkeypatch.setattr("raphael_core.agent.cli.loop.CliLoop", FakeCliLoop)
    await rig.call("home.overview")
    await asyncio.gather(*list(home.narratives.tasks.values()))
    value = await rig.call("home.overview")
    assert value["today_plan"]["narrative"] == "Today the team will review the mail."
    assert len(calls) == 1
    assert all(call["model"] == "cli:codex:owner-model" and call["no_tools"] and call["tools"] == [] for call in calls)


async def test_plan_waits_for_shared_calendar_read_in_background_only(home, rig, narrative_model):
    from types import SimpleNamespace
    from datetime import datetime, UTC
    from raphael_core.home import ConnectedCalendar
    started, release = asyncio.Event(), asyncio.Event()
    calls = []
    async def connectors(_):
        return {"connectors": [{"id": "google", "status": "ACTIVE", "enabled_tools": ["calendar_list_events"]}]}
    async def events(tool, args):
        calls.append(args)
        started.set()
        await release.wait()
        return {"items": [{"id": "meeting", "summary": "Planning", "start": {"dateTime": datetime.fromtimestamp(rig.wall.now / 1000, UTC).isoformat()}}]}
    rig.rpc.register("connectors.status", connectors)
    calendar = ConnectedCalendar(rig.rpc, SimpleNamespace(call_google=events), now_ms=rig.wall)
    home.calendar_events = calendar
    try:
        pending = await asyncio.wait_for(rig.call("home.overview"), .2)
        assert pending["today_plan"]["state"] == "pending"
        await started.wait()
        assert len(calls) == 1
        release.set()
        await asyncio.gather(*list(home.narratives.tasks.values()))
        ready = (await rig.call("home.overview"))["today_plan"]
        assert ready["state"] == "ready"
        assert [item["title"] for item in ready["items"] if item["kind"] == "event"] == ["Planning"]
        assert len(calls) == 1
    finally:
        await calendar.aclose()


async def test_today_keeps_recorded_runs_of_a_paused_or_exhausted_routine(home, rig):
    routine = (await rig.call("routines.create", {"member_id": 0, "title": "Completed review", "prompt": "Review", "enabled": False,
               "schedule": {"kind": "daily", "time": "09:00", "max_runs": 1}}))["routine"]
    rig.conn.execute("INSERT INTO routine_runs(routine_id,started,scheduled,finished,status) VALUES(?,?,?,?,'done')",
                     (routine["id"], rig.wall.now, rig.wall.now, rig.wall.now))
    value = await rig.call("home.overview")
    assert [item["routine_id"] for item in value["today"]] == [routine["id"]]


async def test_health_does_not_require_sign_in_for_a_keyless_local_model(home, rig):
    rig.background.diagnostics = lambda speaker, turn: {
        "brains": [{"id": "local", "kind": "ollama", "has_key": False, "enabled": True, "status": "ok"}],
        "memory": {"status": "ok"}}
    checks = (await rig.call("home.overview"))["health"]["checks"]
    assert checks[0]["id"] == "brain:local"
    assert checks[0]["status"] == "ok" and checks[0]["detail"] is None


def _local(value):
    from datetime import datetime
    return int(datetime.fromisoformat(value).timestamp() * 1000)


async def test_activity_has_fourteen_local_days_ending_today_with_midnight_edges(home, rig):
    rig.wall.now = _local("2026-11-07T23:59:59+08:00")
    late = add(rig)
    rig.wall.now = _local("2026-11-08T00:00:00+08:00")
    midnight = add(rig, source="telegram")
    rig.wall.now = _local("2026-10-25T23:00:00+08:00")
    add(rig)  # the day before the fourteen
    rig.wall.now = _local("2026-11-08T09:00:00+08:00")
    days = (await rig.call("home.overview", {"tz": "Asia/Taipei"}))["activity"]["days"]
    assert [day["date"] for day in days][:1] + [day["date"] for day in days][-2:] == ["2026-10-26", "2026-11-07", "2026-11-08"]
    assert len(days) == 14
    assert days[-2]["work"] == 1 and days[-2]["messages"] == 0
    assert days[-1]["messages"] == 1 and days[-1]["work"] == 0
    assert sum(day["work"] + day["messages"] for day in days) == 2
    assert all(day == {"date": day["date"], "work": 0, "routines_ok": 0, "routines_failed": 0, "messages": 0, "failed": 0}
               for day in days[:-2])
    assert late and midnight


async def test_activity_counts_linked_work_once_and_each_failure_once(home, rig):
    routine = (await rig.call("routines.create", {"member_id": 0, "title": "Inbox", "prompt": "Check Gmail",
              "schedule": {"kind": "daily", "time": "09:00"}}))["routine"]
    now = rig.wall.now
    # A routine run, its task and its turn are one routine done.
    turn = add(rig)
    task = rig.background.submit(session_id="run", text="Inbox", language="en", model="", routine_id=routine["id"])
    rig.conn.execute("UPDATE worker_tasks SET state='done',turn_id=?,finished_at_ms=? WHERE id=?", (turn, now, task))
    rig.conn.execute("INSERT INTO routine_runs(routine_id,started,finished,status,turn_id) VALUES(?,?,?,'done',?)",
                     (routine["id"], now, now, turn))
    # A run that went wrong, with its failed turn: one routine failed, not also a failed turn.
    broken = add(rig, status="error")
    rig.conn.execute("INSERT INTO routine_runs(routine_id,started,finished,status,turn_id) VALUES(?,?,?,'error',?)",
                     (routine["id"], now, now, broken))
    # A task that hit a limit, with its turn in error: one failure.
    limited = add(rig, status="error")
    stopped = rig.background.submit(session_id="limit", text="Long job", language="en", model="")
    rig.conn.execute("UPDATE worker_tasks SET state='limit',turn_id=?,finished_at_ms=? WHERE id=?", (limited, now, stopped))
    # A turn the owner cancelled is his decision, not a failure.
    add(rig, status="cancelled")
    value = (await rig.call("home.overview"))["activity"]
    assert {key: value["days"][-1][key] for key in ("work", "routines_ok", "routines_failed", "messages", "failed")} == \
        {"work": 0, "routines_ok": 1, "routines_failed": 1, "messages": 0, "failed": 1}
    assert value["today"]["routines_done"] == 1 and value["today"]["routines_failed"] == 1
    assert value["today"]["questions"] == 0


async def test_activity_follows_a_twenty_five_hour_local_dst_day(home, rig):
    rig.wall.now = _local("2026-11-01T23:30:00-05:00")
    add(rig)
    rig.wall.now = _local("2026-11-02T00:05:00-05:00")
    days = (await rig.call("home.overview", {"tz": "America/New_York"}))["activity"]["days"]
    assert days[-2]["date"] == "2026-11-01" and days[-2]["work"] == 1
    assert days[-1]["date"] == "2026-11-02" and days[-1]["work"] == 0


async def test_activity_today_counts_routines_due_events_and_questions(home, rig):
    await rig.call("routines.create", {"member_id": 0, "title": "Hourly", "prompt": "Check",
                   "schedule": {"kind": "every", "hours": 1}})
    add(rig, status="confirm")
    value = await rig.call("home.overview")
    today = value["activity"]["today"]
    assert today["routines_due"] == sum(item["kind"] == "routine" for item in value["today"]) > 0
    assert today["questions"] == 1
    assert today["events"] == 0

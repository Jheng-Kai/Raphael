"""Tests for the scheduler of the routines: what runs when, at most once, and what a run leaves in
its thread."""

import asyncio
import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.members.service import CATCH_UP_MS, TICK_S

HOUR = 3_600_000


async def make(rig, member_id=None, schedule=None, **fields):
    if member_id is None:
        member_id = (await rig.call("members.create", {"name": "A", "model": "own/model"}))["member"]["id"]
    params = {
        "member_id": member_id, "title": "晨報", "prompt": "PRIVATE-PROMPT 看今天的進度",
        "schedule": schedule or {"kind": "daily", "time": "09:00"}, **fields,
    }  # fmt: skip
    return (await rig.call("routines.create", params))["routine"]


async def test_a_due_routine_runs_once_as_a_task_of_its_member_and_is_moved_on_first(rig, conn):
    routine = await make(rig)
    member_id = routine["member_id"]
    assert rig.service.tick() == []  # 08:59: not yet
    rig.wall.now += 60_000
    assert rig.service.tick() == [routine["id"]]
    assert rig.service.tick() == []  # already moved to tomorrow: it runs at most once
    (task,) = rig.background.submitted
    assert task == {
        "session_id": f"routine:{routine['id']}", "text": "PRIVATE-PROMPT 看今天的進度",
        # A routine uses its member's selected brain.
        "language": "zh-TW", "model": "own/model", "member_id": member_id, "routine_id": routine["id"],
    }  # fmt: skip
    moved = rig.service.store.routine(routine["id"])
    assert moved.last_run_ms == rig.wall.now
    assert moved.next_run_ms == rig.wall.now + 24 * HOUR
    # The run is a turn of the member's thread, with the routine's title, completed by the task.
    (turn,) = AgentHistory(conn).list(member_id=member_id)
    assert (turn.route, turn.source, turn.question, turn.status) == ("routine", "routine", "晨報", "running")
    (attached,) = rig.background.attached
    assert attached[1] == turn.id
    assert ("agent.turn", {"turn_id": turn.id, "member_id": member_id}) in rig.notes
    listed = {m["id"]: m for m in (await rig.call("members.list"))["members"]}
    assert listed[member_id]["unread"] and listed[member_id]["preview"] == "晨報"


async def test_raphael_has_routines_too_run_on_the_answer_model(rig, conn):
    routine = await make(rig, member_id=0, schedule={"kind": "every", "hours": 2})
    rig.wall.now += 2 * HOUR
    assert rig.service.tick() == [routine["id"]]
    (task,) = rig.background.submitted
    assert task["member_id"] == 0 and task["model"]  # the answer model, from the settings


async def test_an_unfinished_routine_run_exposes_its_real_owner_question_status(rig, conn):
    routine = await make(rig, member_id=0)
    turn = AgentHistory(conn).add(session_id="sample-question", question="Review samples", route="routine", prefix="", text="Choose a sample", status="confirm", member_id=0)
    conn.execute("INSERT INTO routine_runs(routine_id,started,status,turn_id) VALUES(?,1,'running',?)", (routine["id"],turn))
    conn.commit()
    result = await rig.call("routines.runs", {"routine_id":routine["id"]})
    assert result["runs"][0]["status"] == "confirm"
    assert result["runs"][0]["finished"] is None


@pytest.mark.parametrize("kind", ["ask_owner", "permission", "children"])
async def test_routine_waiting_status_comes_from_its_real_background_question_store(rig, conn, kind):
    from raphael_core.agent.owner_questions import OwnerQuestions
    from raphael_core.background.tasks import Question
    from raphael_core.home import HomeOverview
    routine = await make(rig, member_id=0, schedule={"kind":"every", "hours":3, "from":"08:00", "to":"23:00"})
    rig.wall.now = routine["next_run"]
    rig.service.tick()
    store = rig.background.store
    task_id, turn_id = rig.background.attached[0]
    store.set_state(task_id, "waiting")
    questions = OwnerQuestions(conn)
    if kind == "ask_owner":
        card = questions.open(store.get(task_id), "ask_owner", {"question":"Choose a sample", "options":[], "free_text":True})
    elif kind == "permission":
        store.add_question(Question("sample-permission", task_id, 0, "", "Allow sample read", "T2", rig.wall.now, rig.wall.now+60000, 60, "waiting"))
    assert AgentHistory(conn).get(turn_id).status == "running"
    result = await rig.call("routines.runs", {"routine_id":routine["id"]})
    assert result["runs"][0]["status"] == ("running" if kind == "children" else "confirm")
    home = HomeOverview(conn, rig.rpc, rig.service, now_ms=rig.wall, tz=rig.service._tz)
    async def status(_): return {"spend":{"month_usd":0,"limit_usd":0,"daily":[]}}
    async def stats(_): return {"all":{"words":0,"audio_seconds":0},"time_saved_seconds":0}
    async def allowances(_): return {}
    rig.rpc.register("status.get", status)
    rig.rpc.register("stats.summary", stats)
    rig.rpc.register("usage.allowances", allowances)
    overview = await home.read({})
    exceptions = [item for item in overview["calendar_items"] if item.get("run_status") == "confirm"]
    assert bool(exceptions) == (kind != "children")
    if kind == "ask_owner":
        questions.settle(card["id"], {"state":"answered", "answer":"Sample A"})
    elif kind == "permission":
        store.close_question("sample-permission", "approved")
    assert (await rig.call("routines.runs", {"routine_id":routine["id"]}))["runs"][0]["status"] == "running"


async def test_a_routine_missed_while_the_core_was_off_runs_once_within_twelve_hours(rig):
    hourly = await make(rig, schedule={"kind": "every", "hours": 1})
    rig.wall.now += 5 * HOUR  # missed five times
    assert rig.service.tick() == [hourly["id"]]  # once, not five times
    assert rig.service.store.routine(hourly["id"]).next_run_ms == rig.wall.now + HOUR
    assert len(rig.background.submitted) == 1


async def test_a_routine_missed_longer_ago_is_not_run_only_moved_on(rig):
    daily = await make(rig)
    rig.wall.now += 60_000 + CATCH_UP_MS + 60_000  # due at nine, now past nine in the evening
    assert rig.service.tick() == []
    assert rig.background.submitted == []
    moved = rig.service.store.routine(daily["id"])
    assert moved.last_run_ms is None and moved.next_run_ms > rig.wall.now


async def test_a_routine_that_is_off_never_runs(rig):
    await make(rig, enabled=False)
    rig.wall.now += 2 * HOUR
    assert rig.service.tick() == []


async def test_a_run_the_worker_cannot_take_ends_its_turn_with_the_reason(rig, conn):
    routine = await make(rig)
    rig.background.refuse = "worker_busy"
    rig.wall.now += 60_000
    assert rig.service.tick() == [routine["id"]]
    (turn,) = AgentHistory(conn).list(member_id=routine["member_id"])
    assert (turn.status, turn.text) == ("error", "背景任務已滿。請稍後再試。")
    # It was moved on all the same: it does not run again until it is due again.
    assert rig.service.tick() == []


async def test_the_scheduler_ticks_while_the_core_runs_and_stops_with_it(rig, monkeypatch):
    routine = await make(rig)
    rig.wall.now += 60_000
    rig.service._tick_s = 0.01
    rig.service.start()
    rig.service.start()  # once is enough
    for _ in range(100):
        if rig.background.submitted:
            break
        await asyncio.sleep(0.01)
    assert [t["routine_id"] for t in rig.background.submitted] == [routine["id"]]
    await rig.service.aclose()
    assert TICK_S == 30.0

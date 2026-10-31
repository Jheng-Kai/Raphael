"""A routine that runs by itself at 09:00 can add what it finds to today, on an API brain or a subscription CLI."""

import json
from datetime import timezone

from members.conftest import QuietModel
from raphael_core.agent.cli.loop import CliLoop
from raphael_core.brain.secrets import MemoryKeyStore
from raphael_core.brain.settings import SettingsStore
from raphael_core.members.service import MembersService
from raphael_core.memory.service import MemoryService
from raphael_core.worker.loop import Outcome
from .conftest import call, turn, until
from .test_room_cli import Brains

ADD = {"title": "回覆客戶信", "start": "2026-10-21T16:00", "notes": "來自今天的信件"}


def events(conn):
    return [dict(row) for row in conn.execute("SELECT * FROM calendar_events")]


async def team_of(rig, conn, tmp_path):
    memory = MemoryService(conn, tmp_path / "memory", QuietModel(), MemoryKeyStore(), quiet_s=3600, start_delay_s=3600)
    members = MembersService(conn, tmp_path, background=rig.service, memory=memory, now_ms=rig.wall, tz=timezone.utc)
    memory.member_exists = members.member_exists

    async def unused(*args, **kwargs):
        raise AssertionError("no team tool is needed")

    rig.service.use_memory(memory)
    rig.service.use_team(members, unused)
    return members, memory


async def test_a_routines_run_adds_what_it_found_to_today(make_rig, conn, tmp_path):
    rig = make_rig()
    members, memory = await team_of(rig, conn, tmp_path)
    secretary = members.store.create_member(name="秘書長", role="行政")
    routine = members.store.create_routine(member_id=secretary.id, title="每日信件", prompt="看今天的信，把要做的事加到今天的行程。",
                                            schedule={"kind": "daily", "time": "09:00"}, next_run_ms=rig.wall.now)
    rig.client.replies += [turn("", calls=[call("calendar_add", ADD)]),
                           turn(json.dumps({"prefix": "告", "text": "已加到今天的行程。", "detail": ""}))]
    try:
        assert members.tick() == [routine.id]
        task = rig.changes()[-1]["task_id"]
        await until(lambda: rig.task(task).state not in ("queued", "running"))
        assert rig.task(task).state == "done"
        offered = {tool["function"]["name"] for tool in rig.client.chat_calls[0]["tools"]}
        assert {"calendar_list", "calendar_add", "calendar_update", "calendar_delete"} <= offered
        [event] = events(conn)
        assert event["title"] == "回覆客戶信" and event["added_by"] == secretary.id and event["notes"] == "來自今天的信件"
        assert ("calendar.changed", {}) in rig.notifications
        [step] = [step for step in rig.service._store.steps(task) if step.kind == "tool"]
        assert step.tool == "calendar_add" and step.outcome == "ok"
    finally:
        await members.aclose()
        await memory.aclose()


async def test_a_task_on_a_subscription_brain_reaches_the_same_calendar(make_rig, conn, tmp_path, monkeypatch):
    rig = make_rig()
    members, memory = await team_of(rig, conn, tmp_path)
    secretary = members.store.create_member(name="秘書長", role="行政", model="cli:codex")
    rig.service.use_cli(Brains(tmp_path))
    results = []

    async def work(loop):
        assert "calendar_add" in {item["function"]["name"] for item in loop.tools}
        results.append(await loop._tool("add", "calendar_add", ADD))
        loop._queue.put_nowait(Outcome("done", final="已加到今天的行程。"))

    monkeypatch.setattr(CliLoop, "_work", work)
    try:
        task = rig.service.submit(session_id="routine:1", text="看信", language="zh-TW", model="cli:codex", member_id=secretary.id)
        await until(lambda: rig.task(task).state in ("done", "failed"))
        assert rig.task(task).state == "done" and results[0].ok
        [event] = events(conn)
        assert event["added_by"] == secretary.id
    finally:
        await members.aclose()
        await memory.aclose()


async def test_under_ask_first_a_task_waits_for_the_owners_yes_before_it_writes(make_rig, conn, tmp_path):
    rig = make_rig()
    SettingsStore(conn).set("action_mode", "ask")
    members, memory = await team_of(rig, conn, tmp_path)
    secretary = members.store.create_member(name="秘書長", role="行政")
    rig.client.replies += [turn("", calls=[call("calendar_add", ADD)]),
                           turn(json.dumps({"prefix": "告", "text": "已加到今天的行程。", "detail": ""}))]
    try:
        task = rig.service.submit(session_id="routine:1", text="看信", language="zh-TW", model="fake/model", member_id=secretary.id)
        await until(lambda: rig.task(task).state == "waiting")
        assert events(conn) == []
        [question] = rig.service.waiting_questions()
        assert rig.service.answer(task, question["id"], True) == "approved"
        await until(lambda: rig.task(task).state == "done")
        assert len(events(conn)) == 1
    finally:
        await members.aclose()
        await memory.aclose()

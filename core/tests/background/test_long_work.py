"""Hours-long delegated work: stall detection instead of a clock, a summary at every ceiling, a money cap
for paid models, members working at the same time, and results the parent can trust."""

import asyncio
import hashlib
import os

import pytest

from raphael_core.agent.speaker import RAPHAEL, Speaker
from raphael_core.background import service as service_module
from raphael_core.background.run import RunLimits
from raphael_core.brain.settings import SettingsStore
from raphael_core.integrations.client import CallOutcome
from raphael_core.worker import loop as worker_loop

from .conftest import call, report, turn, until, use
from .test_handoff import args, setup, team_of, unused
from .test_run import MESSAGES
from .test_run import Rig as RunRig
from .test_run import stop_of

SUMMARY = "Done: A. Not done: B. Next: C."


def looking(n, cost=0.0):
    return turn("", [call("local_time", {"n": n}, f"c{n}")], cost=cost)


# --- one run: the stall deadline, the money cap and the summary call -------------------------------


async def test_every_reply_and_every_tool_moves_the_stall_deadline(conn, plugins):
    rig = RunRig(conn, plugins)
    rig.client.replies = [turn("a"), turn("b"), turn("c")]
    for n in range(3):
        rig.clock.now += 1500  # never silent for as long as the stall time
        await rig.chat()
    rig.clock.now += 1500
    await rig.tool("local_time")
    rig.clock.now += 1500
    await rig.tool("local_time", call_id="c2")
    rig.clock.now += 1801
    assert await stop_of(rig.chat()) == ("limit_time", None)
    await rig.meteo.http.aclose()


async def test_a_tool_in_flight_is_no_stall_for_a_reply_with_a_short_window(conn, plugins):
    """Live, a reply in a group that asked a colleague (ask_member) could be ended as stalled: the colleague's
    whole turn took longer than the reply's own 180 seconds of silence."""
    rig = RunRig(conn, plugins)
    rig.run.limits = RunLimits(seconds=180)
    rig.run.tool_seconds = 1800  # a task's own window, as the service gives a reply
    rig.run.touch()
    left, call_tool = [], rig.run._tool

    async def slow(name, arguments, call_id=""):
        left.append(rig.run.remaining_s())
        rig.clock.now += 600  # the tool is out for ten minutes
        left.append(rig.run.remaining_s())
        return await call_tool(name, arguments, call_id)

    rig.run._tool = slow
    await rig.tool("local_time")
    assert left == [1800, 1200]
    # Back from the tool, the reply's own short window watches the model's silence again.
    assert rig.run.remaining_s() == 180
    rig.clock.now += 181
    assert await stop_of(rig.chat()) == ("limit_time", None)
    # Out of time, a call does not bring the reply back: it is refused, as any step is.
    assert await stop_of(rig.tool("local_time", call_id="late")) == ("limit_time", None)
    # A task whose window is already as long gets nothing more.
    rig.run.limits, rig.run.tool_seconds = RunLimits(), 1800
    rig.run._tool = call_tool
    rig.run.touch()
    await rig.tool("local_time", call_id="c2")
    assert rig.run.remaining_s() == 1800
    await rig.meteo.http.aclose()


def wrap_up():
    """The conversation the worker sends for the one call after a ceiling."""
    return [*MESSAGES, {"role": "user", "content": worker_loop.WRAP_UP}]


async def test_a_stopped_task_may_still_make_one_model_call_without_tools(conn, plugins):
    rig = RunRig(conn, plugins)
    rig.run.limits = RunLimits(model_calls=1)
    rig.client.replies = [turn("a"), turn(SUMMARY)]
    await rig.chat()
    assert await stop_of(rig.chat()) == ("limit_model", None)
    assert (await rig.chat(wrap_up()))["content"] == SUMMARY
    assert rig.client.chat_calls[-1]["tools"] == []
    assert await stop_of(rig.chat(wrap_up())) == ("limit_model", None)
    rig.run.cancel()
    assert await stop_of(rig.chat(wrap_up())) == ("cancelled", None)
    await rig.meteo.http.aclose()


async def test_the_money_cap_stops_a_paid_task_and_leaves_room_for_the_summary(conn, plugins):
    rig = RunRig(conn, plugins, cost_cap=lambda: 0.2)
    rig.client.replies = [turn("a", cost=0.15), turn("b", cost=0.15), turn(SUMMARY, cost=0.15)]
    await rig.chat()
    await rig.chat()
    assert await stop_of(rig.chat()) == ("limit_cost", None)
    assert (await rig.chat(wrap_up()))["content"] == SUMMARY
    await rig.meteo.http.aclose()


async def test_a_free_model_is_never_held_to_the_money_cap(conn, plugins):
    rig = RunRig(conn, plugins, cost_cap=lambda: 0.2)
    rig.client.replies = [turn("x", cost=0.0) for _ in range(5)]
    for _ in range(5):
        await rig.chat()
    await rig.meteo.http.aclose()


# --- a task through the service ---------------------------------------------------------------------


async def test_a_task_ended_by_a_ceiling_keeps_the_summary_as_its_result(make_rig):
    rig = make_rig(limits=RunLimits(model_calls=2))
    rig.client.replies = [looking(0), looking(1), turn(SUMMARY)]
    task_id = rig.submit()
    [done] = await rig.wait_for_reports()
    assert done["state"] == "limit" and SUMMARY in done["text"]
    assert rig.task(task_id).reason == "limit_model" and SUMMARY in rig.task(task_id).report_text
    assert rig.client.chat_calls[-1]["tools"] == []


async def test_a_summary_that_cannot_be_had_still_ends_with_the_fixed_line(make_rig):
    rig = make_rig(limits=RunLimits(model_calls=1))
    rig.client.replies = [looking(0)]
    rig.submit()
    [done] = await rig.wait_for_reports()
    assert done["state"] == "limit" and done["text"]


async def test_work_goes_on_past_the_old_ceilings(make_rig):
    rig = make_rig()
    rig.client.replies = [looking(n) for n in range(90)] + [report("Finished", cost=0.0)]
    rig.submit()
    [done] = await rig.wait_for_reports(timeout=60)
    assert done["state"] == "done" and done["text"] == "Finished"


async def test_the_money_cap_ends_a_paid_task_with_a_summary(make_rig, conn):
    SettingsStore(conn).set("worker_cost_cap_usd", 0.10)
    rig = make_rig()
    rig.client.replies = [looking(0, cost=0.11), turn(SUMMARY)]
    task_id = rig.submit()
    [done] = await rig.wait_for_reports()
    assert done["state"] == "limit" and rig.task(task_id).reason == "limit_cost" and SUMMARY in done["text"]


async def test_a_subscription_runs_on_whatever_the_cap_is(make_rig, conn):
    SettingsStore(conn).set("worker_cost_cap_usd", 0.10)
    rig = make_rig()
    rig.client.replies = [looking(n) for n in range(6)] + [report("fine", cost=0.0)]
    rig.submit()
    [done] = await rig.wait_for_reports()
    assert done["state"] == "done"


# --- members at the same time -----------------------------------------------------------------------


def members(rig, count):
    crew = [Speaker(id=10 + n, name=f"Member{n}", tools=frozenset()) for n in range(count)]
    rig.service.use_team(team_of(*crew), unused)
    return crew


def hand_over(rig, member, text="work"):
    return rig.service.submit(session_id=f"s{member.id}", text=text, language="en", model="fake/model", member_id=member.id)


async def test_members_work_at_the_same_time(make_rig):
    rig = make_rig()
    first, second = members(rig, 2)
    arrived = []
    both = asyncio.Event()

    async def meet(**kwargs):
        arrived.append(1)
        if len(arrived) == 2:
            both.set()
        await asyncio.wait_for(both.wait(), 3)  # a service that works one task at a time never gets here twice
        return report("done")

    rig.client.replies = [meet, meet]
    ids = [hand_over(rig, first), hand_over(rig, second)]
    await until(lambda: all(rig.task(i).state == "done" for i in ids), timeout=10)


async def test_one_member_works_on_one_task_at_a_time(make_rig):
    rig = make_rig()
    [only] = members(rig, 1)
    inside, peak = [], [0]

    async def slow(**kwargs):
        inside.append(1)
        peak[0] = max(peak[0], len(inside))
        await asyncio.sleep(0.05)
        inside.pop()
        return report("done")

    rig.client.replies = [slow, slow, slow]
    ids = [hand_over(rig, only, f"work {n}") for n in range(3)]
    await until(lambda: all(rig.task(i).state == "done" for i in ids), timeout=10)
    assert peak[0] == 1


async def test_more_tasks_than_places_wait_in_the_queue_and_none_is_refused(make_rig):
    rig = make_rig()
    crew = members(rig, 8)
    inside, peak = [], [0]

    async def slow(**kwargs):
        inside.append(1)
        peak[0] = max(peak[0], len(inside))
        await asyncio.sleep(0.05)
        inside.pop()
        return report("done")

    rig.client.replies = [slow] * 8
    ids = [hand_over(rig, member) for member in crew]
    await until(lambda: all(rig.task(i).state == "done" for i in ids), timeout=20)
    assert 1 < peak[0] <= service_module.MAX_PARALLEL


async def test_stopping_with_no_task_named_stops_every_task_that_runs(make_rig):
    rig = make_rig()
    first, second = members(rig, 2)
    started = []

    async def hold(**kwargs):
        started.append(1)
        await asyncio.sleep(30)

    rig.client.replies = [hold, hold]
    ids = [hand_over(rig, first), hand_over(rig, second)]
    await until(lambda: len(started) == 2, timeout=10)
    assert (await rig.rpc.call("worker.cancel", {}))["cancelled"] is True
    await until(lambda: all(rig.task(i).state == "cancelled" for i in ids), timeout=10)
    await until(lambda: rig.service.running is False, timeout=10)


async def test_cancelling_a_rooms_replies_leaves_its_assigned_work_running(make_rig):
    rig = make_rig()
    target, source = setup(rig)
    started = asyncio.Event()

    async def hold(**kwargs):
        started.set()
        await asyncio.sleep(30)

    rig.client.replies.append(hold)
    task_id = rig.service.handoff(RAPHAEL, args(target), source_turn_id=source.id, language="en").data["task_id"]
    await asyncio.wait_for(started.wait(), 5)
    await rig.service.cancel_room(source.room_id, work=False)
    assert rig.task(task_id).state == "running"
    await rig.service.cancel_room(source.room_id)
    await until(lambda: rig.task(task_id).state == "cancelled", timeout=10)


# --- the evidence of a task that was to make a file --------------------------------------------------


def workspace_writing(rig, monkeypatch, directory, *, writes=True):
    rig.service.use_workspaces(lambda member: directory)

    async def work(server, name, arguments, **kwargs):
        if writes:
            (directory / "office.html").write_text("<!doctype html><p>3D office</p>", encoding="utf8")
        return CallOutcome("wrote it", False)

    monkeypatch.setattr(rig.plugins.hub._connector, "call_tool", work)


async def make_office(rig, source, target, done_when="office.html exists in the workspace and opens", *, requires_artifact=True):
    await rig.plugins.connect(look="T1")
    rig.client.replies.extend([turn(calls=[use("Notes__look", {"topic": "office"})]), report("office.html is written")])
    receipt = rig.service.handoff(RAPHAEL, args(target, request="Build office.html", done_when=done_when, requires_artifact=requires_artifact),
                                  source_turn_id=source.id, language="en")
    task_id = receipt.data["task_id"]
    await until(lambda: rig.task(task_id).state in ("done", "failed"), timeout=10)
    return task_id


async def test_a_file_the_task_wrote_is_its_evidence_and_lets_it_finish(make_rig, tmp_path, monkeypatch):
    rig = make_rig()
    target, source = setup(rig)
    workspace_writing(rig, monkeypatch, tmp_path)
    task_id = await make_office(rig, source, target)
    assert rig.task(task_id).state == "done", rig.task(task_id).reason
    [artifact] = [e for e in rig.service._store.evidence(task_id) if e["kind"] == "artifact"]
    assert artifact["uri"] == "office.html"
    assert artifact["digest"] == hashlib.sha256((tmp_path / "office.html").read_bytes()).hexdigest()


async def test_a_claim_without_the_file_still_fails_honestly(make_rig, tmp_path, monkeypatch):
    rig = make_rig()
    target, source = setup(rig)
    workspace_writing(rig, monkeypatch, tmp_path, writes=False)
    task_id = await make_office(rig, source, target)
    assert rig.task(task_id).state == "failed" and rig.task(task_id).reason == "missing_artifact"


@pytest.mark.parametrize("offset_ms", [-1001, -1000, -789])
async def test_workspace_artifacts_allow_whole_second_timestamp_rounding(make_rig, tmp_path, monkeypatch, offset_ms):
    rig = make_rig()
    rig.wall.now += 789
    target, source = setup(rig)
    old = tmp_path / "office.html"
    old.write_text("<p>old</p>", encoding="utf8")
    modified = (rig.wall() + offset_ms) / 1000
    os.utime(old, (modified, modified))
    workspace_writing(rig, monkeypatch, tmp_path, writes=False)
    task_id = await make_office(rig, source, target)
    assert rig.task(task_id).state == ("failed" if offset_ms < -1000 else "done")
    assert rig.task(task_id).reason == ("missing_artifact" if offset_ms < -1000 else None)


@pytest.mark.parametrize("requires_artifact", [False, True])
async def test_workspace_absence_does_not_override_the_explicit_artifact_requirement(make_rig, tmp_path, monkeypatch, requires_artifact):
    rig = make_rig()
    target, source = setup(rig)
    workspace_writing(rig, monkeypatch, tmp_path, writes=False)
    rig.service.use_workspaces(lambda member: None)
    task_id = await make_office(rig, source, target, done_when="A file with the report", requires_artifact=requires_artifact)
    assert rig.task(task_id).state == ("failed" if requires_artifact else "done")
    assert rig.task(task_id).reason == ("missing_artifact" if requires_artifact else None)


# --- what comes back to the parent -------------------------------------------------------------------


async def test_child_results_say_completed_error_or_cancelled(make_rig, conn):
    rig = make_rig()
    store = rig.service._store
    parent = store.create(session_id="p", language="en", text="parent")

    def child(state, text, reason=None):
        task = store.create(session_id="c", language="en", text="child")
        with conn:
            conn.execute("UPDATE worker_tasks SET parent_task_id=? WHERE id=?", (parent, task))
        store.finish(task, state, prefix="", text=text, detail=None, reason=reason)

    child("done", "Wrote /home/cua/workspace/office.html")
    child("limit", "Done A. Not done B.", "limit_time")
    child("failed", "", "missing_artifact")
    child("cancelled", "", "cancelled")
    child("done", "")
    results = rig.service._child_results(parent)
    assert [r["state"] for r in results] == ["completed", "error", "error", "cancelled", "completed"]
    assert results[1]["reason"] == "limit_time" and results[1]["result"] == "Done A. Not done B."
    assert results[4]["result"] == "Completed without a text response."


async def test_the_parent_is_told_to_check_handles_and_not_to_take_a_colleagues_word(make_rig):
    rig = make_rig()
    target, source = setup(rig, room=False)
    seen = {}

    def resumed(**kwargs):
        seen["last"] = kwargs["messages"][-1]["content"]
        return report("ok")

    def asked(**kwargs):
        seen["system"] = kwargs["messages"][0]["content"]
        return report("written to /home/cua/workspace/office.html")

    rig.client.replies.extend([turn(calls=[call("handoff", args(target, mode="consult"))]), asked, resumed])
    parent = rig.service.submit(session_id="parent", text="delegate", language="en", model="fake/model")
    rig.service.attach_turn(parent, source.id)
    await until(lambda: rig.task(parent).state in ("done", "failed"), timeout=10)
    assert '"state": "completed"' in seen["last"] and "claim" in seen["last"] and "evidence" in seen["last"]
    assert "absolute path" in seen["system"] and "URL" in seen["system"]

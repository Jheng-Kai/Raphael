"""A member's own background work is never queued for ever (R-PUMP-01).

The owner's 蜜莉姆 and 工程師 stayed "working" for hours: each conversation turn that handed work to its own member waited for
a child that never began. The cause was start-up. The service is built before the event loop runs, and `use_team` puts back
what the last run left queued: a task carried out then was parked on a loop that never runs, so it never started or ended,
and held its member's place (and one of the three places) for ever.
"""

import asyncio
from dataclasses import replace

import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.background import service as service_module
from raphael_core.members.store import MemberStore
from .conftest import NOW_MS, Rig, report, until
from .test_handoff import args, setup, team_of, unused

HOUR_MS = 60 * 60 * 1000
# Work done in the words themselves counts as work (`TaskStore.completion_reason`): long enough not to be a promise or a line.
JOB = "The completed review documents the design, verified behavior and remaining acceptance boundaries. " * 5


def own_work(rig, target, *, stage="own-work", asked="Do the long job."):
    """What the owner's conversation does when a member hands work to itself: a turn that is still running hands it on, then
    ends answered, and waits as a task for it. The parent waits (`waiting`), the child is queued."""
    history = AgentHistory(rig.conn, rig.wall)
    source = history.get(history.add(session_id=f"turn-{stage}", question=asked, route="answer", prefix="", text="",
                                     status="running", member_id=target.id))
    receipt = rig.service.handoff(target, args(target, stage_id=stage, request=asked), source_turn_id=source.id, language="en")
    assert receipt.ok, receipt.error
    history.resolve(source.id, prefix="", text="On it.", status="done")
    rig.service.settle_asker(source.id, answered=True)
    child = rig.task(receipt.data["task_id"])
    parent = rig.task(child.parent_task_id)
    assert (parent.state, child.state) == ("waiting", "queued")
    return parent.id, child.id


def left_by_the_last_run(conn, plugins, monkeypatch, *, queued_at_ms=NOW_MS, stages=("own-work",)):
    """The database of an app that ended while a member's own work was queued behind a waiting turn."""
    first = Rig(conn, plugins)
    monkeypatch.setattr(first.service, "_ensure_pump", lambda: None)  # it was given no place before the app ended
    first.wall.now = queued_at_ms
    target, _ = setup(first, room=False)
    ids = [own_work(first, target, stage=stage) for stage in stages]
    return target, ids


def restart(conn, plugins, target):
    """The next run: the service is built, and `use_team` puts the queued work back, before the loop runs (`__main__.main`).
    A loop that never runs is what `asyncio.ensure_future` falls back on there."""
    nowhere = asyncio.new_event_loop()
    asyncio.set_event_loop(nowhere)
    try:
        second = Rig(conn, plugins)
        second.service.use_team(team_of(target), unused)
        return second, nowhere
    except BaseException:
        asyncio.set_event_loop(None)
        nowhere.close()
        raise


def test_start_up_parks_nothing_on_a_loop_that_never_runs(conn, plugins, monkeypatch):
    target, [(parent, child)] = left_by_the_last_run(conn, plugins, monkeypatch)
    second, nowhere = restart(conn, plugins, target)
    try:
        # Nothing was carried out before the loop ran: no place is held, and the child still waits for its turn.
        assert not second.service._active
        assert list(second.service._queue) == [child]
        assert second.task(child).state == "queued"
    finally:
        asyncio.set_event_loop(None)
        nowhere.close()

    async def go():
        second.client.replies.extend([report(JOB), report(JOB)])
        second.service.start()
        await until(lambda: second.task(parent).state == "done")
        assert second.task(child).state == "done" and not second.service._active
        # The member is not held for ever: later work of its own starts and ends as well.
        second.client.replies.extend([report(JOB), report(JOB)])
        again_parent, again_child = own_work_started(second, target, "again")
        await until(lambda: second.task(again_parent).state == "done" and second.task(again_child).state == "done")
        await until(lambda: not second.service._active)
        await second.close()

    asyncio.run(go())


def test_work_queued_before_the_loop_runs_one_after_the_other_for_one_member(conn, plugins, monkeypatch):
    """Two stages of one member queue behind each other and both end."""
    target, ids = left_by_the_last_run(conn, plugins, monkeypatch, stages=("one", "two"))
    second, nowhere = restart(conn, plugins, target)
    try:
        assert not second.service._active
    finally:
        asyncio.set_event_loop(None)
        nowhere.close()

    async def go():
        second.client.replies.extend([report(JOB)] * 8)
        second.service.start()
        await until(lambda: all(second.task(i).state == "done" for pair in ids for i in pair), timeout=10)
        await until(lambda: not second.service._active)
        await second.close()

    asyncio.run(go())


@pytest.mark.parametrize("waited_ms,kept", [(10 * 60 * 1000, True), (3 * HOUR_MS, False)])
def test_a_hand_off_that_waited_for_hours_ends_with_its_reason_and_wakes_its_parent(conn, plugins, monkeypatch, waited_ms, kept):
    """What the owner's own stuck rows come to at the next start: a child that never began and is hours old is not started
    unseen. It ends `stale_queue` with a report, and its waiting parent hears it and answers; a young one is put back."""
    target, [(parent, child)] = left_by_the_last_run(conn, plugins, monkeypatch, queued_at_ms=NOW_MS - waited_ms)
    second, nowhere = restart(conn, plugins, target)
    try:
        assert (second.task(child).state == "queued") is kept
    finally:
        asyncio.set_event_loop(None)
        nowhere.close()

    async def go():
        second.client.replies.extend([report(JOB), report(JOB)] if kept else [report(JOB)])
        second.service.start()
        await until(lambda: second.task(parent).state == "done")
        ended = second.task(child)
        if kept:
            assert ended.state == "done"
        else:
            assert ended.state == "interrupted" and ended.reason == "stale_queue"
            assert ended.report_text and ended.finished_at_ms is not None
            assert second.conn.execute("SELECT status FROM agent_turns WHERE id=?", (ended.turn_id,)).fetchone()[0] == "error"
            assert second.conn.execute("SELECT state FROM task_stage_owners WHERE owner_task_id=?", (child,)).fetchone()[0] == "blocked"
            assert len(second.client.chat_calls) == 1  # only the parent's answer, no work of the child
        await until(lambda: not second.service._active)
        assert not second.service._queue
        await second.close()

    asyncio.run(go())


async def test_waiting_turns_hold_no_place_their_children_need(make_rig):
    """Three members each wait (as a turn) for their own queued work, and a fourth has plain work: every place is free for them,
    because a task that waits for its children is carried out by no one and counts for nothing."""
    rig = make_rig()
    first, _ = setup(rig, room=False)
    people = [first]
    for name in ("Editor", "Designer", "Analyst"):
        member = MemberStore(rig.conn).create_member(name=name, role=name)
        people.append(replace(first, id=member.id, name=name))
    rig.service.use_team(team_of(*people), unused)
    rig.client.replies.extend([report(JOB)] * 12)
    parents = []
    for person in people[:3]:
        parents.append(own_work_started(rig, person))
    plain = rig.service.submit(session_id="plain", text="A short question.", language="en", model="fake/model",
                               member_id=people[3].id)
    await until(lambda: all(rig.task(i).state == "done" for pair in parents for i in pair) and rig.task(plain).state == "done",
                timeout=10)
    await until(lambda: not rig.service._active)
    assert not rig.service._queue
    assert service_module.MAX_PARALLEL == 3


def own_work_started(rig, target, stage=None):
    """`own_work` with the pump running: the child begins as soon as it has a place, so the parent may already be waiting
    or woken; the ids are what the test follows."""
    stage = stage or f"own-{target.id}"
    history = AgentHistory(rig.conn, rig.wall)
    source = history.get(history.add(session_id=f"turn-{stage}-{target.id}", question="Long job.", route="answer", prefix="",
                                     text="", status="running", member_id=target.id))
    receipt = rig.service.handoff(target, args(target, stage_id=stage, request="Long job."),
                                  source_turn_id=source.id, language="en")
    assert receipt.ok, receipt.error
    history.resolve(source.id, prefix="", text="On it.", status="done")
    rig.service.settle_asker(source.id, answered=True)
    child = rig.task(receipt.data["task_id"])
    return child.parent_task_id, child.id


async def test_a_pump_asked_before_any_loop_runs_does_not_start_anything(make_rig, monkeypatch):
    rig = make_rig()
    first, _ = setup(rig, room=False)
    with monkeypatch.context() as held:
        held.setattr(rig.service, "_ensure_pump", lambda: None)
        parent, child = own_work(rig, first)

    def no_loop():
        raise RuntimeError("no running event loop")

    with monkeypatch.context() as nowhere:
        nowhere.setattr(service_module.asyncio, "get_running_loop", no_loop)
        rig.service._ensure_pump()
        assert not rig.service._active and list(rig.service._queue) == [child]
    rig.client.replies.extend([report(JOB), report(JOB)])
    rig.service.start()
    await until(lambda: rig.task(parent).state == "done")

"""The composer's Stop ends what it shows in every state a task can be in, and says nothing (R-PUMP-02, R-STOP-01).

A task the owner sees as working is `queued` (in the queue, or given a place a moment ago), `running` (being started, or in a
run), or `waiting` (for the owner's yes, for the owner's answer, or for its colleagues). Each of them ends `cancelled` on one
`worker.cancel`, whose answer says so; a second press answers harmlessly and changes nothing.
"""

import asyncio

from .conftest import report, until

JOB = "The completed review documents the design, verified behavior and remaining acceptance boundaries. " * 5


async def test_a_task_stopped_while_it_is_being_started_ends_and_never_runs(make_rig, monkeypatch):
    """Starting a task can take seconds before its run exists (the member's computer is seated, files are read): it is
    `running` and carried, and Stop then used to answer `cancelled: false` and let it run on to the end as if never pressed."""
    rig = make_rig()
    seating, release = asyncio.Event(), asyncio.Event()

    async def seat(member_id=0):
        seating.set()
        await release.wait()

    monkeypatch.setattr(rig.plugins.hub, "prepare", seat, raising=False)
    rig.client.replies = [report(JOB)]
    task_id = rig.submit()
    await asyncio.wait_for(seating.wait(), 5)
    assert rig.task(task_id).state == "running" and task_id in rig.service._active and task_id not in rig.service._runs

    assert await rig.rpc.call("worker.cancel", {"task_id": task_id}) == {"cancelled": True}
    release.set()
    await until(lambda: rig.task(task_id).state == "cancelled")
    await until(lambda: not rig.service._active)
    assert rig.client.chat_calls == []  # it never went on to its model
    ended = rig.task(task_id)
    assert ended.report_text == "" and rig.reports() == []  # a stop asked for says nothing (R-STOP-01)
    # A second press finds nothing to stop and changes nothing.
    assert await rig.rpc.call("worker.cancel", {"task_id": task_id}) == {"cancelled": False}
    assert rig.task(task_id).state == "cancelled"


async def test_a_turn_that_ends_without_its_answer_ends_the_work_it_handed_on_that_waits_for_the_owner(make_rig, plugins, calls):
    """A conversation turn that handed work on and then failed, or was refused, ends that work with it. A piece that waited for
    the owner's yes used to stay waiting with its card open: a later yes was taken (`approved`) and its call made for work
    whose turn had ended."""
    from raphael_core.agent.history import AgentHistory
    from raphael_core.agent.speaker import RAPHAEL
    from .conftest import ARGUMENT, Clock, turn, use
    from .test_handoff import args, setup
    from .test_questions import questions

    rig = make_rig(clock=Clock(5000.0))
    await plugins.connect(note="T2")
    writer, source = setup(rig, room=False)
    rig.client.replies = [turn("Noting.", [use("Notes__note", {"text": ARGUMENT}, "c1")]), report(JOB)]
    child = rig.service.handoff(RAPHAEL, args(writer), source_turn_id=source.id, language="en").data["task_id"]
    await until(lambda: rig.task(child).state == "waiting")
    asked = questions(rig)[-1]

    AgentHistory(rig.conn, rig.wall).resolve(source.id, prefix="", text="", status="error")
    rig.service.settle_asker(source.id, answered=False)
    await until(lambda: rig.task(child).state == "cancelled")
    assert questions(rig)[-1] == {**questions(rig)[-1], "question_id": asked["question_id"], "state": "cancelled"}
    answer = {"task_id": child, "question_id": asked["question_id"], "approved": True}
    assert await rig.rpc.call("background.answer", answer) == {"status": "cancelled"}
    assert calls == [] and rig.reports() == []
    assert rig.task(child).report_text == ""  # a stop says nothing (R-STOP-01)

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

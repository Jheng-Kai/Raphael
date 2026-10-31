"""Activity follows real worker RPC callbacks, including a reused worker peer."""

from .conftest import call, report, turn, until


def states(rig, member=0):
    return [data["state"] for method, data in rig.notifications
            if method == "member.activity" and data["member_id"] == member]


async def test_worker_reports_activity_on_every_task_in_a_reused_peer(make_rig):
    rig = make_rig()
    for index in range(2):
        rig.client.replies = [turn("Checking", [call("local_time", {}, "time")]), report("Finished.")]
        task = rig.submit(session=f"activity-{index}")
        await until(lambda: rig.task(task).state == "done")
        await until(lambda: not rig.service.activity.running)
    assert states(rig) == ["thinking", "working", "thinking", "done", "idle"] * 2


async def test_background_approval_is_idle_then_tracks_approved_tool(make_rig):
    rig = make_rig()
    await rig.plugins.connect(look="T2")
    rig.client.replies = [turn("Checking", [call("Notes__look", {"topic": "test"}, "look")]), report("Finished.")]
    task = rig.submit()
    await until(lambda: rig.task(task).state == "waiting")
    await until(lambda: not rig.service.activity.running)
    assert states(rig)[-1] == "idle" and "done" not in states(rig)
    [question] = rig.service.waiting_questions()
    rig.service.answer(task, question["id"], True)
    await until(lambda: rig.task(task).state == "done")
    await until(lambda: not rig.service.activity.running)
    assert states(rig)[-5:] == ["thinking", "working", "thinking", "done", "idle"]

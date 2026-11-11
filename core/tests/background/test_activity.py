"""Activity follows real worker RPC callbacks, including a reused worker peer."""

from .conftest import call, report, turn, until, use


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
    assert states(rig) == ["waiting", "thinking", "working", "thinking", "done", "idle"] * 2


async def test_background_approval_is_blocked_then_tracks_approved_tool(make_rig):
    rig = make_rig()
    await rig.plugins.connect(look="T2")
    rig.client.replies = [turn("Checking", [use("Notes__look", {"topic": "test"}, "look")]), report("Finished.")]
    task = rig.submit()
    await until(lambda: rig.task(task).state == "waiting")
    await until(lambda: not rig.service.activity.running)
    assert states(rig)[-1] == "blocked" and "done" not in states(rig)
    [question] = rig.service.waiting_questions()
    rig.service.answer(task, question["id"], True)
    await until(lambda: rig.task(task).state == "done")
    await until(lambda: not rig.service.activity.running)
    assert states(rig)[-5:] == ["thinking", "working", "thinking", "done", "idle"]


async def test_public_waiting_label_follows_the_real_dependency_task(make_rig):
    from raphael_core.members.store import MemberStore

    rig = make_rig()
    colleague = MemberStore(rig.conn).create_member(name="Sample colleague", role="Research")
    parent = rig.service._store.create(session_id="sample-parent", language="en", text="Sample work")
    child = rig.service._store.create(session_id="sample-child", language="en", text="Private task arguments", member_id=colleague.id)
    with rig.conn:
        rig.conn.execute("UPDATE worker_tasks SET state='waiting' WHERE id=?", (parent,))
        rig.conn.execute("UPDATE worker_tasks SET parent_task_id=?, scope='exchange' WHERE id=?", (parent, child))
    rig.service.activity.language = lambda: "en"
    rig.service._changed(parent, "waiting")
    assert rig.service.activity.state(0) == "waiting"
    assert rig.service.activity.state(colleague.id) == "waiting"
    assert rig.service.activity.label(0) == "Waiting for Sample colleague’s result"
    assert rig.notifications[-2] == ("member.activity", {"member_id": 0, "state": "waiting", "label": "Waiting for Sample colleague’s result"})


async def test_batched_activity_preserves_owner_waits_and_colleague_labels(make_rig):
    from raphael_core.members.store import MemberStore

    rig = make_rig()
    colleague = MemberStore(rig.conn).create_member(name='Colleague', role='Research')
    store = rig.service._store
    parent = store.create(session_id='parent', language='en', text='Parent')
    child = store.create(session_id='child', language='en', text='Child', member_id=colleague.id)
    with rig.conn:
        rig.conn.execute("UPDATE worker_tasks SET state='waiting' WHERE id=?", (parent,))
        rig.conn.execute('UPDATE worker_tasks SET parent_task_id=? WHERE id=?', (parent, child))
    expected = {member: rig.service._activity_tasks(member) for member in (0, colleague.id, 999)}
    actual = rig.service._activity_tasks_by_member([0, colleague.id, 999])
    assert {member: actual.get(member, []) for member in expected} == expected
    assert actual[0][0]['waiting_for'] == colleague.name
    for member, tasks in expected.items():
        assert rig.service.activity.describe(member, tasks=actual.get(member, [])) == rig.service.activity.describe(member)
    store.attach_turn(child, 1)
    question = rig.service.owner_questions.open(store.get(child), 'ask_owner', {'question': 'Synthetic choice'})
    assert question['state'] == 'asked'
    assert rig.service._activity_tasks_by_member([colleague.id])[colleague.id][0]['waiting_owner'] == 1

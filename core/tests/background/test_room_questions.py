"""A member's question waits where it was asked: a room's turn in the room, not on the member's page (R-AG-34)."""
from .test_questions import note_then_report, paused


async def in_a_room(rig, plugins, conn):
    """A task that paused for the owner's yes, as a room's turn does."""
    await plugins.connect(note="T2")
    note_then_report(rig)
    task_id = rig.submit()
    asked = await paused(rig, task_id)
    with conn:
        room = conn.execute("INSERT INTO rooms(name, created) VALUES('Plans', 1)").lastrowid
        conn.execute("UPDATE worker_tasks SET room_id=? WHERE id=?", (room, task_id))
    return room, asked


async def test_side_thread_questions_and_stop_stay_in_their_thread(make_rig, plugins, conn):
    rig = make_rig()
    room, asked = await in_a_room(rig, plugins, conn)
    main = conn.execute('SELECT id FROM room_threads WHERE room_id=?', (room,)).fetchone()[0]
    with conn:
        root = conn.execute('INSERT INTO room_messages(room_id,thread_id,text,created) VALUES(?,?,?,1)', (room,main,'Synthetic root')).lastrowid
        side = conn.execute('INSERT INTO room_threads(room_id,created,parent_message_id) VALUES(?,1,?)', (room,root)).lastrowid
        conn.execute('UPDATE worker_tasks SET thread_id=? WHERE id=?', (side,asked['task_id']))
    assert (await rig.rpc.call('background.questions.list', {'room_id':room}))['questions'] == []
    assert (await rig.rpc.call('background.questions.list', {'room_id':room,'thread_id':side}))['questions'][0]['id'] == asked['question_id']
    task = rig.service._store.create(session_id='main-pending',language='en',text='Main room work')
    with conn:
        conn.execute("UPDATE worker_tasks SET scope='room',room_id=?,thread_id=? WHERE id=?", (room,main,task))
    await rig.service.cancel_room(room, thread_id=side)
    assert rig.task(task).state == 'queued'
    assert rig.task(asked['task_id']).state == 'cancelled'


async def test_a_question_of_a_rooms_turn_waits_in_the_room_and_not_on_the_members_page(make_rig, plugins, conn):
    rig = make_rig()
    room, asked = await in_a_room(rig, plugins, conn)
    listed = (await rig.rpc.call("background.questions.list", {"room_id": room}))["questions"]
    assert [q["id"] for q in listed] == [asked["question_id"]] and listed[0]["room_id"] == room
    assert (await rig.rpc.call("background.questions.list", {"member_id": 0}))["questions"] == []
    assert (await rig.rpc.call("background.questions.list", {"room_id": room + 1}))["questions"] == []


async def test_the_room_is_what_waits_not_the_member(make_rig, plugins, conn):
    rig = make_rig()
    room, _ = await in_a_room(rig, plugins, conn)
    assert rig.service.waiting_rooms() == {room}
    assert rig.service.waiting_members() == set()


async def test_a_private_question_still_waits_on_the_members_page(make_rig, plugins):
    rig = make_rig()
    await plugins.connect(note="T2")
    note_then_report(rig)
    asked = await paused(rig, rig.submit())
    assert [q["id"] for q in (await rig.rpc.call("background.questions.list", {"member_id": 0}))["questions"]] == [asked["question_id"]]
    assert rig.service.waiting_members() == {0} and rig.service.waiting_rooms() == set()


async def test_everyone_who_waits_is_listed_for_the_reminder(make_rig, plugins, conn):
    rig = make_rig()
    room, asked = await in_a_room(rig, plugins, conn)
    assert (await rig.rpc.call("background.waiting.list"))["waiting"] == [
        {"id": asked["question_id"], "member_id": 0, "room_id": room, "member_name": ""}]

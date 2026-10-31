import asyncio

from raphael_core.agent.history import AgentHistory
from .conftest import report, until


async def test_a_background_turn_receives_the_addition_in_its_loop_messages(make_rig, conn):
    rig = make_rig()
    started, release = asyncio.Event(), asyncio.Event()

    async def finishing(**kwargs):
        started.set()
        await release.wait()
        return report("Old answer")

    rig.client.replies = [finishing, report("Answer with the owner's condition")]
    history = AgentHistory(conn)
    turn_id = history.add(session_id="s1", question="Work", route="delegate", prefix="", text="Working", status="running", cost_usd=0)
    task_id = rig.submit()
    rig.service.attach_turn(task_id, turn_id)
    await asyncio.wait_for(started.wait(), 2)
    conversation_id = history.get(turn_id).conversation_id
    assert not await rig.service.steer(1, conversation_id, "Wrong member")
    assert await rig.service.steer(0, conversation_id, "Include this condition")
    release.set()
    await rig.wait_for_reports()
    assert rig.client.chat_calls[-1]["messages"][-1] == {"role": "user", "content": "Include this condition"}
    assert not await rig.service.steer(0, conversation_id, "After completion")


async def test_room_input_reaches_only_the_active_room_thread(make_rig, conn):
    rig = make_rig()
    with conn:
        room = conn.execute("INSERT INTO rooms(name,created) VALUES ('Room',1)").lastrowid
    thread = conn.execute("SELECT id FROM room_threads WHERE room_id=?", (room,)).fetchone()[0]
    history = AgentHistory(conn)
    turn_id = history.add(session_id="room:1:1:0", question="Work", route="room", prefix="", text="", status="running",
                          source="room", scope="room", room_id=room, thread_id=thread)
    started, release = asyncio.Event(), asyncio.Event()

    async def working(**kwargs):
        started.set()
        await release.wait()
        return report("Old answer")

    rig.client.replies = [working, report("Answer including prices")]
    task_id = rig.submit()
    rig.service.attach_turn(task_id, turn_id)
    await asyncio.wait_for(started.wait(), 2)
    assert not await rig.service.steer_room(room, thread + 1, "Wrong thread", [])
    assert not await rig.service.steer_room(room, thread, "Wrong member", [999])
    assert await rig.service.steer_room(room, thread, "Include the prices", [])
    release.set()
    await until(lambda: rig.task(task_id).state == "done")
    assert rig.client.chat_calls[-1]["messages"][-1] == {"role": "user", "content": "Include the prices"}
    assert not await rig.service.steer_room(room, thread, "After completion", [])

from .test_rooms import rooms, create  # noqa: F401


async def test_a_room_addition_keeps_the_active_exchange_and_its_tool_work(rig, rooms):
    room = await create(rig, [0])
    await rig.call("rooms.send", {"room_id": room["id"], "text": "Start the report", "request_id": "first"})
    original = rooms._exchanges.latest(room["id"])
    submitted = len(rig.background.submitted)
    accepted = []

    async def steer(room_id, thread_id, text, recipients):
        accepted.append((room_id, thread_id, text, recipients))
        return True

    rig.background.steer_room = steer
    reply = await rig.call("rooms.send", {"room_id": room["id"], "text": "Include the prices", "request_id": "addition"})
    assert accepted and accepted[0][2] == "Include the prices"
    assert rooms._exchanges.latest(room["id"])["origin_message_id"] == original["origin_message_id"]
    assert len(rig.background.submitted) == submitted
    message = rig.conn.execute("SELECT text,member_id FROM room_messages WHERE id=?", (reply["message_id"],)).fetchone()
    assert tuple(message) == ("Include the prices", None)

from .test_rooms import rooms, create  # noqa: F401


async def test_an_owner_interjection_is_a_real_owner_message_on_a_new_snapshot(rig, rooms):
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
    assert not accepted
    assert rooms._exchanges.latest(room["id"])["origin_message_id"] != original["origin_message_id"]
    assert len(rig.background.submitted) == submitted + 1
    message = rig.conn.execute("SELECT text,member_id FROM room_messages WHERE id=?", (reply["message_id"],)).fetchone()
    assert tuple(message) == ("Include the prices", None)


async def test_writing_in_a_room_closes_the_question_cards_waiting_in_that_thread(rig, rooms):
    from types import SimpleNamespace
    room = await create(rig, [0])
    closed = []
    rig.background.owner_questions = SimpleNamespace(close_for_message=lambda **found: closed.append(found))
    await rig.call("rooms.send", {"room_id": room["id"], "text": "Let us talk first", "request_id": "talk"})
    [found] = closed
    assert found["said"] == "Let us talk first" and found["room_id"] == room["id"] and found["thread_id"] is not None

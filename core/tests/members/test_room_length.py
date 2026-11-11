"""Length is never an error in a room (owner, 2026-11-09 to 11-11: 97 replies of one meeting failed for it). What a reply
is given follows the model's window: whole messages, newest first; a message that must be there and alone does not fit
is left out and says so, and the reply goes on."""
import json
import logging

from raphael_core.members.exchanges import bounded_transcript
from .test_exchanges import exchange, finish, history, send, team  # noqa: F401


def message(identifier, size, **fields):
    return {"id": identifier, "member_id": 3, "name": "Bob", "role": "CTO", "text": "字" * size, "attachments": [], **fields}


def test_a_required_message_that_alone_outgrows_the_window_is_left_out_with_its_size(caplog):
    source = {"id": 1, "member_id": None, "name": "Owner", "role": "Owner", "text": "Please answer this.", "attachments": []}
    report = message(2, 100_000)
    newest = message(3, 40)
    with caplog.at_level(logging.WARNING):
        shown, folded = bounded_transcript([source, report, newest], required=(2,), chars=2000, byte_limit=2000, hard=6000)
    assert [item["id"] for item in shown] == [1, 2, 3] and folded == 0
    left = shown[1]
    assert left["left_out"] and "100000 characters long" in left["text"] and "字" not in left["text"]
    assert shown[0] == source and shown[2] == newest  # the others go on, whole
    assert "message=2" in caplog.text


def test_the_required_messages_fill_up_to_the_hard_bound_newest_first():
    older, newest = message(1, 900), message(2, 900)
    shown, _ = bounded_transcript([older, newest], required=(1,), chars=100, byte_limit=100, hard=6500)
    assert [item for item in shown if not item.get("left_out")] == [older, newest]
    shown, _ = bounded_transcript([older, newest], required=(1,), chars=100, byte_limit=100, hard=4000)
    assert shown[1] == newest and shown[0]["left_out"]  # the newest has the room; the older required one says it was left out


def test_without_a_hard_bound_nothing_required_is_ever_left_out():
    huge = message(1, 50_000)
    shown, _ = bounded_transcript([huge], chars=2000, byte_limit=2000)
    assert shown == [huge]


async def test_a_small_window_leaves_out_a_message_that_cannot_be_read_and_the_reply_goes_on(rig, exchange):
    room, ids = await team(rig)
    rig.background.model_window = lambda model: 3000
    await send(rig, room, "@Alice please read " + "字" * 6000)
    prompt = rig.background.submitted[-1]["text"]
    assert "left out because it does not fit here" in prompt and "字" * 100 not in prompt
    assert rig.background.submitted[-1]["member_id"] == ids[0]  # the reply is asked all the same


async def test_the_usual_window_carries_the_whole_message(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, "@Alice please read " + "字" * 6000)
    prompt = rig.background.submitted[-1]["text"]
    assert "字" * 6000 in prompt and "left out" not in prompt
    json.dumps(prompt)

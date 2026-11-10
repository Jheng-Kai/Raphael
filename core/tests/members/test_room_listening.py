"""A group is people reading the same messages: each decides for itself, in a turn of its own, and nothing hands out the
floor or sums up. (Who speaks first and who may pass: test_room_turns.py.)"""
from raphael_core.members.exchanges import MAX_ROUNDS
from .test_exchanges import exchange, team, send, finish, history  # noqa: F401


def test_meeting_definitions_never_impose_rounds_or_a_fixed_raphael():
    from raphael_core.agent.team import team_tool, worker_definition
    for text in (team_tool("room_meeting").description,
                 worker_definition("room_meeting")["function"]["description"]):
        assert "include Raphael (0)" not in text
        assert "two rounds" not in text and "Raphael concludes" not in text
        assert "Everyone reads every message" in text
        assert "decides" in text and "no fixed rounds" in text


async def test_room_roles_do_not_dispatch_rounds_or_an_automatic_conclusion(rig, exchange):
    from raphael_core.agent.team import roster_prompt
    room, ids = await team(rig)
    await rig.call("rooms.update", {"room_id": room["id"], "roles": {str(ids[0]): "moderator", str(ids[1]): "con"}})
    source = exchange._history.add(session_id="meeting",question="Meet",route="answer",prefix="",text="",status="running",member_id=rig.service.primary_id())
    await exchange.meeting({"member_ids": [0, *ids], "agenda": "Discuss the release",
                            "roles": {str(ids[0]): "moderator", str(ids[1]): "con"}}, "en", source)
    assert [row["member_id"] for row in rig.background.submitted] == [0]
    prompt = rig.background.submitted[-1]["text"].split("TeamContextSnapshot")[0]
    assert "Room-only roles" in prompt and "Everyone reads every message" in prompt
    assert "two rounds" not in prompt and "chief concludes" not in prompt
    assert "no fixed rounds" in prompt and "no automatic conclusion" in prompt
    for member_id in (0, *ids):
        roster = roster_prompt(rig.service, rig.service.speaker(member_id), "en")
        assert "coordinates room conclusions" not in roster
        assert "no automatic conclusion" in roster
    await finish(rig, exchange, "Test first.")
    await finish(rig, exchange, "(pass)")
    await finish(rig, exchange, "(pass)")
    assert (await history(rig, room))["exchange"]["state"] == "done"
    assert len(rig.background.submitted) == 3
    assert rig.service.speaker(ids[0]).role == "PM"


async def test_legacy_planned_rounds_grant_no_turns_but_keep_explicit_addresses(rig, exchange):
    import json
    room, ids = await team(rig)
    await send(rig, room, "@Alice @Bob review")
    with rig.conn:
        rig.conn.execute("UPDATE room_exchanges SET meeting=1,pending=?", (json.dumps([
            {"member": ids[0], "round": 2, "handoff": False, "reply_to": None, "reply_to_member": None}]),))
    await finish(rig, exchange, "Reviewed.")
    assert [row["member_id"] for row in rig.background.submitted] == ids
    await finish(rig, exchange, "Agreed.")
    assert (await history(rig, room))["exchange"]["state"] == "done"
    assert len(rig.background.submitted) == 2


async def test_meeting_requires_the_current_chief_without_adding_raphael(rig, exchange):
    room, ids = await team(rig)
    await rig.call("members.set_primary", {"id": ids[1]})
    source = exchange._history.add(session_id="meeting",question="Meet",route="answer",prefix="",text="",status="running",member_id=rig.service.primary_id())
    result = await exchange.meeting({"member_ids": ids, "agenda": "Review the release", "roles": {}}, "en", source)
    assert result["member_ids"] == ids
    assert [row["member_id"] for row in rig.background.submitted] == [ids[0]]
    await finish(rig, exchange, "Ready.")
    await finish(rig, exchange, "(pass)")
    assert len(rig.background.submitted) == 2


async def test_each_member_reads_the_whole_room_in_its_own_turn(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, "Morning everyone")
    await finish(rig, exchange, "Morning. Two reviews today.")
    alice = next(row for row in rig.background.submitted if row["member_id"] == ids[0])
    assert f'"self_id": {ids[0]}' in alice["text"] and '"name": "Bob"' in alice["text"]
    assert "Morning everyone" in alice["text"] and "Two reviews today." in alice["text"]


async def test_a_discussion_ends_by_itself_with_no_wrap_up(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, "Ship today?")
    await finish(rig, exchange, "Yes")
    await finish(rig, exchange, "After the test")
    await finish(rig, exchange, "(pass)")
    result = await history(rig, room)
    assert result["exchange"]["state"] == "done"
    assert all(m["kind"] == "message" for m in result["messages"])


async def test_talk_among_themselves_is_bounded_but_an_address_is_not(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, "Debate this")
    await finish(rig, exchange, "@Alice what do you think?")
    for _ in range(12):
        if (await history(rig, room))["exchange"]["state"] in ("done", "stopped"):
            break
        await finish(rig, exchange, "@Bob and @Raphael, your view?")
    result = await history(rig, room)
    assert result["exchange"]["state"] in ("done", "stopped") and result["exchange"]["chime_ins"] <= MAX_ROUNDS


async def test_no_turn_is_told_a_template_to_fill(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, "Where are we?")
    prompt = rig.background.submitted[-1]["text"].split("TeamContextSnapshot")[0]
    assert "###" not in prompt and "1-4 sentences" not in prompt and "@mention the right lead" not in prompt
    assert "frame the question" not in prompt


async def test_a_reply_nobody_was_asked_for_does_not_claim_to_answer_anyone(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, "Morning")
    await finish(rig, exchange, "Morning.")
    await finish(rig, exchange, "Morning, all.")
    await finish(rig, exchange, "(pass)")
    alice = next(m for m in (await history(rig, room))["messages"] if m["member_id"] == ids[0])
    assert alice["reply_to"] is None and alice["reply_to_member"] is None

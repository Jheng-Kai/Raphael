"""A group is people reading the same messages: each decides for itself, and nothing hands out the floor or sums up."""
from raphael_core.members.exchanges import MAX_ROUNDS
from .test_exchanges import exchange, team, send, finish, history, Decision  # noqa: F401


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
    exchange._exchanges.decision = Decision("Bob", Bob=.9)
    await exchange.meeting({"member_ids": [0, *ids], "agenda": "Discuss the release",
                            "roles": {str(ids[0]): "moderator", str(ids[1]): "con"}}, "en", 47)
    assert [row["member_id"] for row in rig.background.submitted] == [ids[1]]
    prompt = rig.background.submitted[-1]["text"].split("TeamContextSnapshot")[0]
    assert "Room-only roles" in prompt and "Everyone reads every message" in prompt
    assert "two rounds" not in prompt and "chief concludes" not in prompt
    assert "no fixed rounds" in prompt and "no automatic conclusion" in prompt
    for member_id in (0, *ids):
        roster = roster_prompt(rig.service, rig.service.speaker(member_id), "en")
        assert "coordinates room conclusions" not in roster
        assert "no automatic conclusion" in roster
    await finish(rig, exchange, "Test first.")
    assert (await history(rig, room))["exchange"]["state"] == "done"
    assert len(rig.background.submitted) == 1
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
    exchange._exchanges.decision = Decision("Alice")
    result = await exchange.meeting({"member_ids": ids, "agenda": "Review the release", "roles": {}}, "en", 48)
    assert result["member_ids"] == ids
    assert [row["member_id"] for row in rig.background.submitted] == [ids[0]]
    await finish(rig, exchange, "Ready.")
    assert len(rig.background.submitted) == 1


async def test_everyone_reads_and_those_who_care_most_speak_first(rig, exchange):
    room, ids = await team(rig)
    decision = Decision("Alice", "Bob", Alice=.2, Bob=.9)
    exchange._exchanges.decision = decision
    await send(rig, room, "What should we do about the launch?")
    assert sorted(call["member"]["name"] for call in decision.calls) == ["Alice", "Bob", "Raphael"]
    assert rig.background.submitted[-1]["member_id"] == ids[1]
    await finish(rig, exchange, "Test first")
    assert rig.background.submitted[-1]["member_id"] == ids[0]
    assert "Test first" in rig.background.submitted[-1]["text"]


async def test_each_decision_reads_the_whole_room_as_that_member(rig, exchange):
    room, ids = await team(rig)
    decision = Decision()
    exchange._exchanges.decision = decision
    await send(rig, room, "Morning everyone")
    alice = next(call for call in decision.calls if call["member"]["name"] == "Alice")
    assert alice["member"]["role"] == "PM"
    assert [one["name"] for one in alice["colleagues"]] == ["Raphael", "Bob"]
    assert [m["text"] for m in alice["transcript"]] == ["Morning everyone"]


async def test_an_acknowledgement_gets_silence_and_no_summary(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, "OK")
    result = await history(rig, room)
    assert not rig.background.submitted
    assert result["exchange"]["state"] == "done" and result["exchange"]["turns_taken"] == 0
    assert [m["member_id"] for m in result["messages"]] == [None]


async def test_a_request_no_one_took_falls_to_the_chief_who_is_told_so(rig, exchange):
    room, ids = await team(rig)
    class ChiefOnSecondLook(Decision):
        async def room_listener(self, **kwargs):
            self.calls.append(kwargs)
            return {"speak": bool(kwargs.get("unanswered")), "urgency": 1, "reason": "fixture"}
    exchange._exchanges.decision = ChiefOnSecondLook()
    await send(rig, room, "Who can check the budget?")
    assert rig.background.submitted[-1]["member_id"] == 0
    assert "No one else took the owner's last message" in rig.background.submitted[-1]["text"]


async def test_a_discussion_ends_by_itself_with_no_wrap_up(rig, exchange):
    room, ids = await team(rig)
    exchange._exchanges.decision = Decision("Alice", "Bob")
    await send(rig, room, "Ship today?")
    await finish(rig, exchange, "Yes")
    await finish(rig, exchange, "After the test")
    result = await history(rig, room)
    assert result["exchange"]["state"] == "done"
    assert all(m["kind"] == "message" for m in result["messages"])


async def test_talk_among_themselves_is_bounded_but_an_address_is_not(rig, exchange):
    room, ids = await team(rig)
    class Eager(Decision):
        async def room_listener(self, **kwargs):
            self.calls.append(kwargs)
            return {"speak": True, "urgency": 1, "reason": "fixture"}
    exchange._exchanges.decision = Eager()
    await send(rig, room, "Debate this")
    for _ in range(12):
        if (await history(rig, room))["exchange"]["state"] == "done":
            break
        await finish(rig, exchange, "My view")
    result = await history(rig, room)
    assert result["exchange"]["state"] == "done" and result["exchange"]["chime_ins"] <= MAX_ROUNDS


async def test_a_cli_brain_reads_an_owners_message_in_a_turn_it_may_pass_but_not_every_colleagues(rig, exchange):
    room, ids = await team(rig)
    await rig.call("members.update", {"id": ids[0], "model": "cli:codex:x"})
    decision = Decision("Bob")
    exchange._exchanges.decision = decision
    await send(rig, room, "Thoughts?")
    assert not any(call["member"]["name"] == "Alice" for call in decision.calls)
    assert [s["member_id"] for s in rig.background.submitted] == [ids[1]]
    await finish(rig, exchange, "Mine are these")
    assert rig.background.submitted[-1]["member_id"] == ids[0]
    assert "Say exactly (pass)" in rig.background.submitted[-1]["text"]
    await finish(rig, exchange, "(pass)")
    assert (await history(rig, room))["exchange"]["state"] == "done"
    assert len(rig.background.submitted) == 2


async def test_no_turn_is_told_a_template_to_fill(rig, exchange):
    room, ids = await team(rig)
    exchange._exchanges.decision = Decision("Raphael")
    await send(rig, room, "Where are we?")
    prompt = rig.background.submitted[-1]["text"].split("TeamContextSnapshot")[0]
    assert "###" not in prompt and "1-4 sentences" not in prompt and "@mention the right lead" not in prompt
    assert "frame the question" not in prompt


async def test_a_reply_nobody_was_asked_for_does_not_claim_to_answer_anyone(rig, exchange):
    room, ids = await team(rig)
    exchange._exchanges.decision = Decision("Alice")
    await send(rig, room, "Morning")
    alice = next(m for m in (await history(rig, room))["messages"] if m["member_id"] == ids[0])
    assert alice["reply_to"] is None and alice["reply_to_member"] is None

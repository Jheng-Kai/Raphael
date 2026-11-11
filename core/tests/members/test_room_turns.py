"""A group has no separate listener (Hermes, gateway/hosted_room_discussion.py): an address is answered, a message that
names no one goes to the room's default responder first, and everyone else reads that answer in a turn of their own and
speaks or passes. A member the owner addresses may not pass. A reply that fails is a status line in the room, never words
in a member's or the chief's mouth."""
import json
import logging

import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.members.rooms import RoomsService
from .test_exchanges import exchange, team, send, finish, history, Decision  # noqa: F401


def speakers(rig):
    return [row["member_id"] for row in rig.background.submitted]


def words(row):
    """What a speech turn is told, before the room's data."""
    return row["text"].split("TeamContextSnapshot")[0]


def spoken(result):
    return [(m["member_id"], m["text"]) for m in result["messages"] if m["member_id"] is not None]


async def end(rig, exchange, state, reason, text="The reply did not finish.", detail=None):
    """The running speech turn that started first ends as `state` for `reason`, as the background ends one."""
    task_id, turn = next((task, turn) for task, turn in rig.background.attached if AgentHistory(rig.conn).get(turn).status == "running")
    AgentHistory(rig.conn).resolve(turn, prefix="", text=text, detail=detail, status="error")
    rig.background.store.finish(task_id, state, prefix="", text=text, detail=detail, reason=reason)
    exchange.turn_arrived(turn)
    await exchange.wait_idle()


async def test_a_message_that_names_no_one_starts_one_turn_per_member_and_asks_no_one_first(rig, exchange):
    room, ids = await team(rig)
    asked = Decision("Alice", "Bob")
    exchange._exchanges.decision = asked
    await send(rig, room, "What should we do about the launch?")
    # The room's default responder, the chief here, answers first, and no one was asked anything before.
    assert not asked.calls and speakers(rig) == [0]
    await finish(rig, exchange, "Test it with ten customers first.")
    # Then each colleague reads that answer in a turn of its own.
    assert speakers(rig) == [0, *ids]
    assert all("Test it with ten customers first." in row["text"] for row in rig.background.submitted[1:])
    await finish(rig, exchange, "(pass)")
    await finish(rig, exchange, "I can run the customer calls.")
    result = await history(rig, room)
    assert result["exchange"]["state"] == "done"
    assert spoken(result) == [(0, "Test it with ten customers first."), (ids[1], "I can run the customer calls.")]
    # One model call for each member for the whole message, where the listener first asked every member.
    assert len(rig.background.submitted) + len(asked.calls) == 3


async def test_the_default_responder_is_told_to_answer_and_the_others_that_they_may_pass(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, "Morning, what is on today?")
    lead = words(rig.background.submitted[0])
    assert "names no one" in lead and "exactly (pass) only when it needs no reply at all" in lead
    await finish(rig, exchange, "Two reviews and the launch call.")
    for row in rig.background.submitted[1:]:
        assert "Otherwise reply with exactly (pass)" in words(row)
        assert "names no one" not in words(row) and "addressed you directly" not in words(row)


async def test_a_saved_default_responder_answers_first_and_everyone_else_may_follow(rig, exchange):
    room, ids = await team(rig, default_responder=f"member:{2}")
    await send(rig, room, "Who has the numbers?")
    assert speakers(rig) == [ids[1]]
    await finish(rig, exchange, "I do; they are in the sheet.")
    assert speakers(rig) == [ids[1], 0, ids[0]]


async def test_an_everyone_room_has_everyone_answer_at_once(rig, exchange):
    room, ids = await team(rig, default_responder="everyone")
    await send(rig, room, "Status, please")
    assert speakers(rig) == [0, *ids]
    assert all("names no one" in words(row) for row in rig.background.submitted)
    snapshots = [row["seen_through"] for row in (await history(rig, room))["exchange"]["active_turns"]]
    assert len(set(snapshots)) == 1


async def test_thanks_get_silence_when_everyone_passes(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, "OK, thanks")
    for _ in range(3):
        await finish(rig, exchange, "(pass)")
    result = await history(rig, room)
    assert result["exchange"]["state"] == "done" and not spoken(result)
    assert not result["exchange"]["reply_intents"]
    assert len(rig.background.submitted) == 3


@pytest.mark.parametrize("passed", ["(pass)", "（pass）", "Pass.", "**(pass)**", "`(pass)`", "*pass*", "(PASS)\n"])
async def test_a_colleague_who_passes_leaves_nothing_in_the_group(rig, exchange, passed):
    room, ids = await team(rig)
    await send(rig, room, "Ship on Friday?")
    await finish(rig, exchange, "Yes, if QA signs off.")
    await finish(rig, exchange, passed)
    await finish(rig, exchange, passed)
    result = await history(rig, room)
    assert spoken(result) == [(0, "Yes, if QA signs off.")]
    [view] = (await rig.call("rooms.list", {}))["rooms"]
    assert view["preview"] == "Yes, if QA signs off."
    # What a colleague reads next has no pass in it either.
    await send(rig, room, "@Alice and the date?", "two")
    assert "pass" not in json.dumps(rig.background.submitted[-1]["text"].split("New room messages")[-1]).lower()


async def test_a_pass_after_words_keeps_only_the_words(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, "@Alice review")
    await finish(rig, exchange, "Looks fine to me. **(pass)**")
    assert spoken(await history(rig, room)) == [(ids[0], "Looks fine to me.")]


async def test_a_pass_is_not_counted_as_a_reply_in_a_side_thread(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, "@Alice draft the note")
    await finish(rig, exchange, "Draft attached.")
    parent = next(m for m in (await history(rig, room))["messages"] if m["member_id"] == ids[0])
    thread = (await rig.call("rooms.thread_open", {"room_id": room["id"], "message_id": parent["id"]}))["thread_id"]
    await send(rig, room, "Anyone?", "side", thread_id=thread)
    for _ in range(3):
        await finish(rig, exchange, "Pass.")
    parent = next(m for m in (await history(rig, room))["messages"] if m["id"] == parent["id"])
    assert parent["reply_count"] == 1


async def test_a_member_the_owner_addresses_answers_and_may_not_pass(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, "@Alice where is the budget sheet?")
    assert speakers(rig) == [ids[0]]
    told = words(rig.background.submitted[0])
    assert "The owner addressed you directly" in told and "Do not reply (pass)" in told
    assert "Otherwise reply with exactly (pass)" not in told and "Say exactly (pass)" not in told
    await finish(rig, exchange, "In the finance folder, updated this morning.")
    assert spoken(await history(rig, room)) == [(ids[0], "In the finance folder, updated this morning.")]


async def test_an_addressed_member_who_passes_anyway_leaves_a_status_line_not_silence(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, "@Alice where is the budget sheet?")
    await finish(rig, exchange, "(pass)")
    result = await history(rig, room)
    assert [(i["recipient_id"], i["state"], i["reason"]) for i in result["exchange"]["reply_intents"]] == [
        (ids[0], "blocked", "no_reply")]
    assert not spoken(result) and not [m for m in result["messages"] if m["kind"] == "wrapup"]


async def test_replying_to_a_member_addresses_it_as_an_at_does(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, "@Bob check the logo")
    await finish(rig, exchange, "The logo is fine.")
    bob = next(m for m in (await history(rig, room))["messages"] if m["member_id"] == ids[1])
    await send(rig, room, "Which file?", "two", reply_to=bob["id"])
    assert rig.background.submitted[-1]["member_id"] == ids[1]
    assert "The owner addressed you directly" in words(rig.background.submitted[-1])


async def test_everyone_the_owner_addresses_answers(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, "@everyone report")
    assert speakers(rig) == [0, *ids]
    assert all("The owner addressed you directly" in words(row) for row in rig.background.submitted)


async def test_a_colleague_a_member_addresses_may_still_pass(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, "@Alice plan the launch")
    await finish(rig, exchange, "Draft is ready. @Bob anything to add?")
    assert rig.background.submitted[-1]["member_id"] == ids[1]
    told = words(rig.background.submitted[-1])
    assert "Otherwise reply with exactly (pass)" in told and "addressed you directly" not in told
    await finish(rig, exchange, "(pass)")
    result = await history(rig, room)
    assert result["exchange"]["state"] == "done"
    assert [i["state"] for i in result["exchange"]["reply_intents"]] == ["done", "done"]


async def test_a_reply_that_fails_is_a_status_line_and_no_one_speaks_for_it(rig, exchange, caplog):
    room, ids = await team(rig)
    await send(rig, room, "@Alice and @Bob answer")
    with caplog.at_level(logging.WARNING, logger="raphael_core.members.exchanges"):
        await end(rig, exchange, "failed", "cli_rate_limited", text="Codex CLI is rate-limited right now.",
                  detail="PRIVATE_STDERR 429 from the provider")
    await finish(rig, exchange, "Ready")
    result = await history(rig, room)
    assert [(i["recipient_id"], i["state"], i["reason"]) for i in result["exchange"]["reply_intents"]] == [
        (ids[0], "blocked", "cli_rate_limited"), (ids[1], "done", "")]
    # No bubble in Alice's name, and no wrap-up in the chief's.
    assert spoken(result) == [(ids[1], "Ready")]
    assert "PRIVATE_STDERR" not in json.dumps(result) and "rate-limited right now" not in json.dumps(result)
    # Why it failed goes to the log, by its kind.
    assert any("cli_rate_limited" in record.getMessage() for record in caplog.records)


async def test_a_lead_reply_that_fails_is_a_status_line_and_the_others_still_read_the_message(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, "Plans for today?")
    await end(rig, exchange, "failed", "worker", text="An error occurred.")
    assert speakers(rig) == [0, *ids]
    await finish(rig, exchange, "Two reviews, then the launch call.")
    await finish(rig, exchange, "(pass)")
    result = await history(rig, room)
    assert [(i["recipient_id"], i["state"], i["reason"]) for i in result["exchange"]["reply_intents"]] == [(0, "blocked", "worker")]
    assert spoken(result) == [(ids[0], "Two reviews, then the launch call.")]
    assert result["exchange"]["state"] == "stopped"
    assert not [m for m in result["messages"] if m["kind"] == "wrapup"]


async def test_a_reply_that_stops_making_progress_says_so(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, "@Alice summarize the thread")
    await end(rig, exchange, "limit", "limit_time", text="The task stopped: no progress.")
    [intent] = (await history(rig, room))["exchange"]["reply_intents"]
    assert (intent["state"], intent["reason"]) == ("blocked", "stalled")


async def test_speech_a_restart_cut_off_is_a_status_line_and_is_not_run_again(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, "Plans for today?")
    await exchange.aclose()
    restored = RoomsService(rig.conn, members=rig.service, background=rig.background)
    restored.start()
    await restored.wait_idle()
    result = await restored._messages({"room_id": room["id"]})
    assert [(i["recipient_id"], i["state"], i["reason"]) for i in result["exchange"]["reply_intents"]] == [(0, "blocked", "restart")]
    assert not spoken(result) and not [m for m in result["messages"] if m["kind"] == "wrapup"]
    assert len(rig.background.submitted) == 1
    await restored.aclose()


async def test_a_budget_stop_before_anyone_spoke_still_says_who_did_not_answer(rig, exchange):
    room, ids = await team(rig)
    exchange._settings.set("monthly_limit_usd", 1.0)
    exchange._exchanges.spend.is_over = lambda limit: True
    await send(rig, room, "Plans for today?")
    result = await history(rig, room)
    assert not rig.background.submitted
    assert [(i["recipient_id"], i["state"], i["reason"]) for i in result["exchange"]["reply_intents"]] == [(0, "blocked", "cost")]
    assert not [m for m in result["messages"] if m["kind"] == "wrapup"]

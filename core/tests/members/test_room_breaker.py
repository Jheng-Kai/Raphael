"""A room thread stops a spiral by itself (owner, 2026-11-11: a meeting ran 330 member turns in 70 minutes, 97 of them
failing for length, and nothing stopped it). After BREAKER_FAILURES replies in a row that failed for one cause the room
stops asking its members, says so once in the owner's language, and stays stopped until the owner writes there again."""
import json

import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.members.exchanges import BREAKER_FAILURES
from raphael_core.members.rooms import _BREAKER_WORDS
from raphael_core.ui_languages import LANGUAGES
from .test_exchanges import exchange, finish, history, meeting_source, send  # noqa: F401
from .test_room_turns import end


async def crowd(rig, count=5):
    """A room of the chief and `count` members, and a meeting there: every one speaks in turn."""
    ids = [(await rig.call("members.create", {"name": name, "role": "Engineer"}))["member"]["id"]
           for name in ("Alice", "Bob", "Cara", "Dan", "Eve")[:count]]
    room = (await rig.call("rooms.create", {"name": "Spiral", "member_ids": [0, *ids]}))["room"]
    return room, ids


async def meet(rig, exchange, room, ids):
    return await exchange.meeting({"room_id": room["id"], "agenda": "Plan the launch.", "roles": {}}, "en", meeting_source(rig, "plan"))


def notices(rig):
    return [row[0] for row in rig.conn.execute("SELECT text FROM room_messages WHERE kind='wrapup' ORDER BY id")]


async def test_a_run_of_overflows_stops_the_room_and_it_says_so_once(rig, exchange):
    room, ids = await crowd(rig)
    await meet(rig, exchange, room, ids)
    for _ in range(BREAKER_FAILURES):
        await end(rig, exchange, "failed", "cli_context_overflow")
    assert len(rig.background.submitted) == BREAKER_FAILURES  # the fourth member was never asked
    latest = exchange._exchanges.latest(room["id"])
    assert latest["state"] == "stopped" and latest["reason"] == "circuit_open"
    said = notices(rig)
    assert len(said) == 1 and "3 replies in a row failed because they were longer than the model can read" in said[0]
    assert "write here again" in said[0]
    # Nothing that arrives later asks anyone again, or says it again: a report's digest, a drive.
    await exchange._exchanges.drive(room["id"])
    exchange._exchanges.digest(room["id"], latest["origin_message_id"], "en")
    await exchange.wait_idle()
    assert len(rig.background.submitted) == BREAKER_FAILURES and len(notices(rig)) == 1


async def test_it_stays_stopped_across_a_restart_and_ends_when_the_owner_writes_again(rig, exchange):
    room, ids = await crowd(rig)
    await meet(rig, exchange, room, ids)
    for _ in range(BREAKER_FAILURES):
        await end(rig, exchange, "failed", "cli_context_overflow")
    from raphael_core.members.rooms import RoomsService
    restored = RoomsService(rig.conn, members=rig.service, background=rig.background)
    restored.start()
    await restored.wait_idle()
    assert len(rig.background.submitted) == BREAKER_FAILURES and len(notices(rig)) == 1
    await restored.aclose()
    await send(rig, room, "@Alice please try again", "again")
    assert len(rig.background.submitted) == BREAKER_FAILURES + 1


async def test_a_pass_is_no_progress_and_does_not_hide_a_run_of_failures(rig, exchange):
    room, ids = await crowd(rig)
    await meet(rig, exchange, room, ids)
    await end(rig, exchange, "failed", "cli_context_overflow")
    await finish(rig, exchange, "(pass)")
    await end(rig, exchange, "failed", "cli_context_overflow")
    assert len(rig.background.submitted) == 4 and not notices(rig)  # two failures and a pass: asked on
    await end(rig, exchange, "failed", "cli_context_overflow")
    assert len(rig.background.submitted) == 4 and len(notices(rig)) == 1


async def test_a_reply_that_said_something_ends_the_run(rig, exchange):
    room, ids = await crowd(rig)
    await meet(rig, exchange, room, ids)
    await end(rig, exchange, "failed", "cli_context_overflow")
    await end(rig, exchange, "failed", "cli_context_overflow")
    await finish(rig, exchange, "I can take the launch checklist.")
    await end(rig, exchange, "failed", "cli_context_overflow")
    await end(rig, exchange, "failed", "cli_context_overflow")
    assert len(rig.background.submitted) == 6 and not notices(rig)


async def test_failures_of_different_causes_do_not_add_up(rig, exchange):
    room, ids = await crowd(rig)
    await meet(rig, exchange, room, ids)
    await end(rig, exchange, "failed", "cli_context_overflow")
    await end(rig, exchange, "failed", "cli_rate_limited")
    await end(rig, exchange, "failed", "cli_context_overflow")
    assert not notices(rig) and len(rig.background.submitted) == 4


async def test_a_run_of_provider_failures_says_so_in_the_owners_language(rig, exchange):
    room, ids = await crowd(rig)
    result = await exchange.meeting({"room_id": room["id"], "agenda": "Plan the launch.", "roles": {}}, "zh-TW", meeting_source(rig, "zh"))
    for _ in range(BREAKER_FAILURES):
        await end(rig, exchange, "failed", "cli_quota")
    [said] = notices(rig)
    assert "連續 3 次回覆因模型或服務出問題而沒有完成" in said and "再在這裡寫一則訊息" in said
    assert result["state"]


async def refuse_or_take(rig, exchange, taken):
    """The reply that runs says something and hands off: the hand-off's step ends as `taken` says."""
    turn = next(turn for _, turn in rig.background.attached if AgentHistory(rig.conn).get(turn).status == "running")
    with rig.conn:
        rig.conn.execute("INSERT INTO agent_steps(turn_id,n,at_ms,kind,tool,server,outcome,ms,reason) VALUES (?,?,?,?,?,?,?,?,?)",
                         (turn, 1, 1, "tool", "handoff", "Raphael", "ok" if taken else "error", 5, None if taken else "error"))
    await finish(rig, exchange, "Starting it now.")


async def test_refused_hand_offs_in_a_row_stop_the_room_too(rig, exchange):
    room, ids = await crowd(rig)
    await meet(rig, exchange, room, ids)
    for _ in range(BREAKER_FAILURES):
        await refuse_or_take(rig, exchange, False)
    assert len(notices(rig)) == 1 and "3 hand-offs in a row were refused" in notices(rig)[0]
    assert len(rig.background.submitted) == BREAKER_FAILURES


async def test_a_hand_off_that_was_taken_is_progress(rig, exchange):
    room, ids = await crowd(rig)
    await meet(rig, exchange, room, ids)
    for taken in (False, True, False, False):
        await refuse_or_take(rig, exchange, taken)
    assert not notices(rig) and len(rig.background.submitted) == 5


def test_the_words_exist_in_every_interface_language():
    assert sorted(_BREAKER_WORDS) == sorted(LANGUAGES)
    for language, words in _BREAKER_WORDS.items():
        assert set(words) == {"frame", "overflow", "provider", "handoff"}, language
        for key, text in words.items():
            assert text.strip(), (language, key)
        assert "{cause}" in words["frame"] and all("{n}" in words[key] for key in ("overflow", "provider", "handoff")), language

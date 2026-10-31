"""Tests for a model that stops short: it says what it will do and does not, is cut off by the output limit,
or goes round and round in its own words."""

import json

import pytest

from raphael_core.worker.loop import BAD_ARGUMENTS, CUT_OFF, Call, Stop, Turn
from raphael_core.worker.repetition_guard import (
    REPETITION_LOOP_INTERRUPTED,
    is_repetition_dominated,
    is_runaway_repetition,
)

from .test_loop import FakeHost, ask, report, run

LOOP = "I will check that again. " * 800  # 20,000 characters of one sentence


def nudges(conversation):
    return [m for m in conversation if m["role"] == "user" and "Continue now" in str(m["content"])]


# --- said it would, and did not -------------------------------------------------------------------------


async def test_a_reply_that_ends_on_what_it_will_do_next_is_asked_once_more_to_go_on():
    host = FakeHost([Turn("I found the notes. Let me now read the calendar."), Turn("", [ask("Notes__look", {"topic": "cal"})]), report()])
    outcome = await run(host)
    assert outcome.status == "done" and len(host.tool_calls) == 1
    assert len(nudges(host.conversations[1])) == 1
    assert host.conversations[1][-2]["role"] == "assistant" and host.conversations[1][-1]["role"] == "user"
    assert "Continue now" in host.conversations[1][-1]["content"]


async def test_the_nudge_comes_twice_at_most_in_a_turn():
    host = FakeHost([Turn("Let me now check the files.")] * 3)
    outcome = await run(host)
    assert outcome.status == "done" and outcome.final == "Let me now check the files."
    assert outcome.model_calls == 3 and len(nudges(host.conversations[2])) == 2


@pytest.mark.parametrize(
    "reply",
    [
        json.dumps({"prefix": "告", "text": "I will now check the files.", "detail": ""}),
        json.dumps({"thinking": "The calendar is next.", "progress": "I am looking at your calendar."}),
        "讓我先查一下你的行事曆。",
        "好的，接下來我會去讀取檔案。",
        "これから予定を確認します。",
    ],
)
async def test_a_stated_intent_is_found_in_the_words_the_owner_would_read(reply):
    host = FakeHost([Turn(reply), report()])
    await run(host)
    assert len(nudges(host.conversations[1])) == 1


@pytest.mark.parametrize(
    "reply",
    [
        json.dumps({"prefix": "告", "text": "The meeting is at three.", "detail": "Room 4."}),
        "Let me know if you want more.",
        "I will now be quiet. The answer is 42.",
        "好的，行事曆已經整理好了。",
        "x" * 500 + " Let me now",
    ],
)
async def test_an_answer_is_not_mistaken_for_an_intent(reply):
    host = FakeHost([Turn(reply)])
    outcome = await run(host)
    assert outcome.status == "done" and outcome.model_calls == 1


async def test_with_no_tools_to_offer_there_is_nothing_to_go_on_with():
    host = FakeHost([Turn("Let me now check the files.")])
    outcome = await run(host, tools=[])
    assert outcome.status == "done" and outcome.model_calls == 1


# --- cut off by the output limit ---------------------------------------------------------------------------


async def test_a_text_that_was_cut_off_is_continued_and_the_pieces_are_one_reply():
    host = FakeHost([Turn('{"prefix": "告", "text": "The first half', finish_reason="length"), Turn(' and the second.", "detail": ""}')])
    outcome = await run(host)
    assert outcome.status == "done"
    assert json.loads(outcome.final) == {"prefix": "告", "text": "The first half and the second.", "detail": ""}
    second = host.conversations[1]
    assert second[-2]["role"] == "assistant" and second[-2]["content"].endswith("The first half")
    assert second[-1]["role"] == "user" and "cut off" in second[-1]["content"]


async def test_a_text_that_is_cut_off_every_time_is_not_asked_for_for_ever():
    host = FakeHost([Turn(f"part {n} ", finish_reason="length") for n in range(10)])
    outcome = await run(host)
    assert outcome.status == "done" and outcome.model_calls == 5
    assert outcome.final == "part 0 part 1 part 2 part 3 part 4 "


@pytest.mark.parametrize("arguments", [None, {}])
async def test_a_call_cut_off_in_its_arguments_is_asked_again_with_more_room_and_never_reported_as_bad(arguments):
    cut = Turn("", [Call("c1", "Notes__look", arguments, '{"topic": "te')], finish_reason="length")
    host = FakeHost([cut, Turn("", [ask("Notes__look", {"topic": "tea"}, "c2")]), report()])
    outcome = await run(host)
    assert outcome.status == "done" and host.rooms == [1, 2, 1]
    assert [call[2] for call in host.tool_calls] == [{"topic": "tea"}]
    assert "c1" not in json.dumps(host.conversations[1]) and "c1" not in json.dumps(host.conversations[2])
    assert BAD_ARGUMENTS not in json.dumps(host.conversations[2])


async def test_a_call_still_cut_off_after_more_room_is_told_it_was_cut_and_what_to_do():
    cut = lambda n: Turn("", [Call(f"c{n}", "Notes__look", None, '{"topic": "te')], finish_reason="length")  # noqa: E731
    host = FakeHost([cut(1), cut(2), report()])
    outcome = await run(host)
    assert outcome.status == "done" and host.tool_calls == []
    told = host.conversations[2][-1]["content"]
    assert CUT_OFF in told and BAD_ARGUMENTS not in told


async def test_a_provider_that_takes_no_more_room_leaves_the_call_to_be_told_it_was_cut():
    cut = Turn("", [Call("c1", "Notes__look", None, '{"topic": "te')], finish_reason="length")
    host = FakeHost([cut, Stop("failed", "invalid_request"), report()])
    outcome = await run(host)
    assert outcome.status == "done"
    assert CUT_OFF in host.conversations[2][-1]["content"]


async def test_a_limit_or_a_cancel_while_asking_for_more_room_still_ends_the_task():
    cut = Turn("", [Call("c1", "Notes__look", None, '{"topic": "te')], finish_reason="length")
    outcome = await run(FakeHost([cut, Stop("limit_cost")]))
    assert (outcome.status, outcome.kind) == ("stopped", "limit_cost")


# --- going round in its own words ---------------------------------------------------------------------------


async def test_a_reply_that_loops_on_its_own_words_is_dropped_and_never_goes_back_to_the_model():
    host = FakeHost([Turn(LOOP), report("Fine.")])
    outcome = await run(host)
    assert outcome.status == "done" and json.loads(outcome.final)["text"] == "Fine."
    second = json.dumps(host.conversations[1])
    assert "I will check that again." not in second and REPETITION_LOOP_INTERRUPTED in second


async def test_a_reply_cut_off_in_a_loop_is_dropped_too():
    host = FakeHost([Turn("again and again, " * 60, finish_reason="length"), report("Fine.")])
    outcome = await run(host)
    assert outcome.status == "done"
    assert "again and again" not in json.dumps(host.conversations[1])


async def test_a_model_that_keeps_looping_ends_the_turn_with_a_failure():
    host = FakeHost([Turn(LOOP)] * 3)
    outcome = await run(host)
    assert (outcome.status, outcome.kind, outcome.detail) == ("stopped", "failed", "repetition")
    assert outcome.model_calls == 3


async def test_a_long_answer_that_was_asked_to_be_repetitive_is_kept():
    rows = "\n".join(f"row {n}: same same same same same same" for n in range(300))
    host = FakeHost([Turn(rows)])
    outcome = await run(host)
    assert outcome.status == "done" and outcome.final == rows


def test_repetition_is_told_from_a_short_truncation_and_from_distinct_rows():
    assert not is_repetition_dominated("ok " * 20)
    assert is_repetition_dominated("same sentence goes here, ok. " * 40)
    rows = "\n".join(f"INSERT INTO t VALUES ({n}, 'value number {n}');" for n in range(200))
    assert not is_runaway_repetition(rows)
    assert is_runaway_repetition(LOOP)

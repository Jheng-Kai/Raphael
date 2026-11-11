"""Length is never an error in a memory pass or a fold (owner, 2026-11-09 to 11-11, when 17 passes and 5 folds failed
for it): a call whose input is more than the model reads is made again with less, whole turns newest first; an item that
alone is more is skipped and said so; the watermark always moves; and a fold that cannot be written by a model is
covered without one, so that a failed call never blocks the conversation."""

import logging

import pytest

from raphael_core.agent.cli.context import fresh_budget, window_of
from raphael_core.agent.ledger import Ledger
from raphael_core.brain.openrouter import OpenRouterError
from raphael_core.brain.secrets import MemoryKeyStore
from raphael_core.brain.spend import SpendTracker
from raphael_core.memory.conversation import FOLD_FALLBACK_AFTER, FOLD_PAUSES_S, LEFT_OUT, Conversation
from raphael_core.memory.reflection import REFLECTION_CHARS, Reflector, reflection_limit
from raphael_core.memory.service import MemoryService

from .conftest import FakeModel, add_turn

TOO_LONG = OpenRouterError(400, "context_overflow", "This model's maximum context length is 8192 tokens")


@pytest.fixture
def memory(conn, tmp_path, clock):
    keys = MemoryKeyStore()
    keys.set("sk-or-v1-test")
    return MemoryService(conn, tmp_path / "memory", FakeModel(), keys, now_ms=clock.ms, clock=clock.mono, now=clock.now,
                         quiet_s=3600.0, start_delay_s=3600.0)


@pytest.fixture
def conversation(conn, clock):
    made = Conversation(conn, FakeModel(), now_ms=clock.ms, clock=clock.mono)
    made.context_window = 200  # a small window makes a short conversation due for a fold
    return made


def ledger(conn, clock):
    return Ledger(SpendTracker(conn, clock.ms), "memory")


def too_long_above(limit):
    """A model that refuses what is longer than `limit` characters and answers an empty list to the rest."""
    def answer(**kwargs):
        if len(kwargs["user"]) > limit:
            raise TOO_LONG
        return {"actions": []}
    return answer


async def reflect(memory, history, model, conn, clock):
    return await Reflector(model).reflect(
        memory.own(0), memory.shared, history.after(0), today=clock.now().date(), model="m", ledger=ledger(conn, clock),
        apply=lambda edits: memory.apply_edits(edits, 0, unattended=True))


async def test_a_pass_given_too_much_is_asked_again_with_the_newest_turns_whole(memory, history, conn, clock):
    for n in range(8):
        add_turn(history, f"第 {n} 句 " + "字" * 400)
    model = FakeModel(*([too_long_above(1500)] * 5))
    applied = await reflect(memory, history, model, conn, clock)
    assert not applied.failed and not applied.skipped and not applied.overflow
    sizes = [len(call["user"]) for call in model.calls]
    assert sizes == sorted(sizes, reverse=True) and sizes[-1] <= 1500 < sizes[0]
    last = model.calls[-1]["user"]
    assert "第 7 句" in last and "第 0 句" not in last  # the newest, and each of them whole


async def test_a_turn_that_alone_is_more_than_the_model_reads_is_skipped_not_failed(memory, history, conn, clock, caplog):
    add_turn(history, "older " + "字" * 100)
    add_turn(history, "newest " + "字" * 100)
    model = FakeModel(*([too_long_above(10)] * 4))
    with caplog.at_level(logging.WARNING):
        applied = await reflect(memory, history, model, conn, clock)
    assert applied.skipped == 1 and not applied.failed
    assert "skipped a turn" in caplog.text


async def test_the_watermark_moves_past_a_skipped_turn(memory, history, conn, clock):
    add_turn(history, "newest " + "字" * 100)
    memory._model = lambda member_id=0: "m"
    memory._brain = lambda member_id: FakeModel(*([too_long_above(10)] * 4))
    await memory.reflect(0)
    assert memory.reflected_through(0) == history.after(0)[-1].id
    assert memory.health()["consecutive_failures"] == 0


async def test_a_model_that_fails_for_another_reason_still_leaves_the_turns_for_the_next_pass(memory, history, conn, clock):
    add_turn(history, "newest")
    memory._brain = lambda member_id: FakeModel(OpenRouterError(503, "server", "down"))
    applied = await memory.reflect(0)
    assert applied.failed and memory.reflected_through(0) == 0


async def test_a_file_that_alone_is_more_than_the_model_reads_is_not_tidied_today_and_is_not_a_failure(memory, conn, clock, caplog):
    memory.own(0).apply([{"action": "add", "target": "memory", "content": "事實 " + "字" * 600}], unattended=True)
    with caplog.at_level(logging.WARNING):
        applied = await Reflector(FakeModel(TOO_LONG)).consolidate(
            memory.own(0), today=clock.now().date(), model="m", ledger=ledger(conn, clock),
            apply=lambda edits: memory.apply_edits(edits, 0, unattended=True))
    assert applied.skipped == 1 and not applied.failed
    assert "skipped a file" in caplog.text


def test_what_one_pass_reads_follows_the_models_window():
    assert reflection_limit(1_000_000) == REFLECTION_CHARS
    small = reflection_limit(8_000)
    assert small < REFLECTION_CHARS
    assert small <= fresh_budget(8_000)[1]
    assert reflection_limit(None) == REFLECTION_CHARS  # the default window is the usual bound


def test_a_window_is_the_catalogs_then_the_clis_then_the_default():
    assert window_of("cli:claude:opus") == 200_000
    assert window_of("cli:codex:gpt-6") == 64_000
    assert window_of("no/such-model-anywhere") == 64_000


# --- the fold -----------------------------------------------------------------------------------------


def seed(history, count, text="好。"):
    return [add_turn(history, f"第 {n} 句", text) for n in range(count)]


async def test_a_fold_given_too_much_is_made_again_with_less_of_it(conversation, history, conn, clock):
    seed(history, 31, "字" * 800)
    conversation._client.replies.extend([TOO_LONG, TOO_LONG, {"summary": "Ongoing:\n- 短一點"}])
    assert await conversation.fold("m", ledger(conn, clock)) is True
    sizes = [len(call["user"]) for call in conversation._client.calls]
    assert len(sizes) == 3 and sizes[0] > sizes[1] > sizes[2]
    assert conversation.summary().text == "Ongoing:\n- 短一點" and conversation.summary().through_turn_id > 0


async def test_a_fold_that_is_too_long_for_every_share_is_covered_without_a_model(conversation, history, conn, clock, caplog):
    ids = seed(history, 31)
    conversation._save("Ongoing:\n- 舊的摘要", 0)
    conversation._client.replies.extend([TOO_LONG] * 4)
    with caplog.at_level(logging.WARNING):
        assert await conversation.fold("m", ledger(conn, clock)) is True
    summary = conversation.summary()
    assert summary.through_turn_id > 0 and "舊的摘要" in summary.text
    assert summary.text.splitlines()[0].startswith(LEFT_OUT)
    assert "without a model" in caplog.text
    assert len(conversation.context().turns) > 0  # the recent turns are still there


async def test_folds_that_fail_again_and_again_are_covered_without_a_model_on_the_last_try(conversation, history, conn, clock):
    seed(history, 31)
    conversation._client.replies.extend([OpenRouterError(503, "server", "down")] * FOLD_FALLBACK_AFTER)
    results = []
    for pause in FOLD_PAUSES_S:
        results.append(await conversation.fold("m", ledger(conn, clock)))
        assert conversation.summary().through_turn_id == 0 or len(results) == FOLD_FALLBACK_AFTER
        clock.advance(seconds=pause + 1)
    assert results == [False, False, True]
    assert conversation.summary().through_turn_id > 0 and conversation.summary().text.startswith(LEFT_OUT)
    assert conversation._failures == 0


async def test_a_second_fallback_keeps_one_note_not_two(conversation, history, conn, clock):
    seed(history, 31)
    conversation._client.replies.extend([TOO_LONG] * 4)
    await conversation.fold("m", ledger(conn, clock))
    seed(history, 31)
    conversation._client.replies.extend([TOO_LONG] * 4)
    await conversation.fold("m", ledger(conn, clock))
    assert conversation.summary().text.count(LEFT_OUT) == 1


async def test_the_summariser_is_budgeted_by_its_own_window(conversation, history, conn, clock):
    seed(history, 31, "字" * 900)
    conversation.summary_window = lambda model: 6_000
    conversation._client.replies.append({"summary": "ok"})
    assert await conversation.fold("m", ledger(conn, clock)) is True
    small = len(conversation._client.calls[0]["user"])
    conversation._save("", 0)
    conversation._save_fragment(0, 0)
    conversation.summary_window = lambda model: 1_000_000
    conversation._client.replies.append({"summary": "ok"})
    assert await conversation.fold("m", ledger(conn, clock)) is True
    assert small < len(conversation._client.calls[1]["user"])

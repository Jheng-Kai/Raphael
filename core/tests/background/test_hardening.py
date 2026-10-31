"""Tests for the gaps a review found in the gate between a running task and the world: calls that
come together, a conversation grown too long, replies that say nothing of their cost."""

import asyncio

import pytest

from raphael_core.background.run import estimate_cost
from raphael_core.brain.openrouter import OpenRouterError
from raphael_core.protocol import WORKER_STOPPED, RpcError

from .test_run import rig, stop_of  # noqa: F401  (rig is the fixture)
from .conftest import turn


async def test_parallel_model_calls_are_all_accounted_for_without_a_cost_cap(rig):
    gate = asyncio.Event()

    async def costly(**kwargs):
        await gate.wait()
        return turn("x", cost=0.10)

    rig.client.replies = [costly] * 15
    tasks = [asyncio.ensure_future(rig.chat()) for _ in range(15)]
    await asyncio.sleep(0.05)
    gate.set()
    results = await asyncio.gather(*tasks, return_exceptions=True)
    assert rig.run.ledger.total == pytest.approx(1.50)
    assert len(rig.client.chat_calls) == 15
    assert all(not isinstance(r, RpcError) for r in results)


async def test_parallel_searches_wait_for_each_other_too(rig):
    rig.client.search_cost = 0.15
    results = await asyncio.gather(
        *[rig.tool("web_search", {"query": f"q{n}"}) for n in range(6)], return_exceptions=True
    )
    assert rig.run.ledger.total == pytest.approx(0.90)
    assert all(not isinstance(r, RpcError) for r in results)


async def test_a_call_waiting_for_its_turn_is_not_cut_off_by_cancelling(rig, calls):
    await rig.plugins.connect(slow="T0", look="T0")
    rig.resnap()
    first = asyncio.ensure_future(rig.tool("Notes__slow", call_id="a"))
    await asyncio.sleep(0.1)
    waiting = asyncio.ensure_future(rig.tool("Notes__look", {"topic": "x"}, call_id="b"))
    await asyncio.sleep(0.05)
    rig.run.cancel()
    assert await stop_of(first) == ("cancelled", None)
    assert await stop_of(waiting) == ("cancelled", None)
    assert calls == ["slow"]  # the one that waited never started
    assert rig.run.call_cut_off is True


async def test_cancelling_during_a_model_call_leaves_a_waiting_plugin_call_not_cut_off(rig, calls):
    await rig.plugins.connect(look="T0")
    rig.resnap()
    started = asyncio.Event()

    async def slow(**kwargs):
        started.set()
        await asyncio.sleep(30)

    rig.client.replies = [slow]
    chat = asyncio.ensure_future(rig.chat())
    await asyncio.wait_for(started.wait(), 2)
    tool = asyncio.ensure_future(rig.tool("Notes__look", {"topic": "x"}))
    await asyncio.sleep(0.05)
    rig.run.cancel()
    assert await stop_of(chat) == ("cancelled", None)
    assert await stop_of(tool) == ("cancelled", None)
    assert rig.run.call_cut_off is False and calls == []


@pytest.mark.parametrize(
    "messages", [[{"role": "user", "content": "x"}] * 300, [{"role": "user", "content": "x" * 700_000}]]
)
async def test_a_long_conversation_goes_to_the_model_the_window_is_what_bounds_it(rig, messages):
    rig.client.replies = [turn("Going on.")]
    assert (await rig.chat(messages))["content"] == "Going on."
    assert rig.client.chat_calls[0]["messages"] == messages


async def test_a_conversation_over_the_window_is_told_as_an_overflow_for_the_worker_to_shrink(rig):
    rig.client.replies = [OpenRouterError(400, "bad_request", "This endpoint's maximum context length is 20000 tokens.")]
    with pytest.raises(RpcError) as error:
        await rig.chat()
    assert error.value.code == WORKER_STOPPED
    assert error.value.data == {"stop": "failed", "detail": "context_overflow", "window": 20_000}
    # It is not a failure the owner sees, or a refusal: the worker sends it again.
    assert [step.outcome for step in rig.store.steps(rig.task_id) if step.kind == "model"] == []


async def test_a_reply_too_long_for_the_model_is_asked_for_again_with_less(rig):
    rig.client.replies = [OpenRouterError(400, "bad_request", "max_tokens: 2000 > 1024, which is the maximum allowed number of output tokens"), turn("Going on.")]
    assert (await rig.chat())["content"] == "Going on."
    assert [call["max_tokens"] for call in rig.client.chat_calls] == [2000, 1024 - 64]
    assert rig.client.chat_calls[0]["messages"] == rig.client.chat_calls[1]["messages"]
    rig.client.replies = [turn("Still less.")]
    await rig.chat()
    assert rig.client.chat_calls[-1]["max_tokens"] == 1024 - 64


async def test_a_summary_is_written_by_the_tasks_own_model_and_paid_into_its_ledger(rig):
    rig.client.search_text = "## Goal\nThe checkpoint."
    reply = await rig.run.summarize({"task_id": rig.task_id, "system": "SUMMARISE", "user": "ROUNDS", "max_tokens": 2000})
    assert reply == {"text": "## Goal\nThe checkpoint."}
    call = rig.client.text_calls[0]
    assert (call["system"], call["user"], call["max_tokens"], call["model"]) == ("SUMMARISE", "ROUNDS", 2000, "fake/model")
    assert call["reasoning_effort"] == "none" and call["timeout_s"] > 30
    assert rig.run.ledger.total > 0
    assert rig.run.model_calls == 0  # it is the run's upkeep, and no step of the task


async def test_a_summary_of_a_task_that_was_stopped_is_not_written(rig):
    rig.run.cancel()
    assert await stop_of(rig.run.summarize({"task_id": rig.task_id, "system": "S", "user": "U", "max_tokens": 2000})) == ("cancelled", None)
    assert rig.client.text_calls == []


async def test_a_reply_without_usage_is_charged_an_estimate_not_nothing(rig):
    rig.client.replies = [turn("x", cost=0.0, usage_known=False)]
    await rig.chat()
    assert rig.run.ledger.total >= 0.02  # the floor for a model whose price is not known
    rows = rig.conn.execute("SELECT cost_usd FROM spend").fetchall()
    assert [r[0] for r in rows] == [rig.run.ledger.total]


async def test_a_reply_that_says_it_cost_nothing_costs_nothing(rig):
    rig.client.replies = [turn("x", cost=0.0)]
    await rig.chat()
    assert rig.run.ledger.total == 0.0


def test_the_estimate_uses_the_price_of_a_known_model_and_the_size_of_the_request():
    small = estimate_cost("anthropic/claude-haiku-5.5", 1_000)
    big = estimate_cost("anthropic/claude-haiku-5.5", 400_000)
    assert 0 < small < big
    assert estimate_cost("some/unknown-model", 1_000) == 0.02


async def test_a_call_that_timed_out_or_was_cancelled_is_charged_its_estimate(rig, monkeypatch):
    import raphael_core.background.run as module

    monkeypatch.setattr(module, "CHAT_TIMEOUT_S", 0.05)
    monkeypatch.setattr("raphael_core.failures.RETRY_WAITS", (0, 0, 0))

    async def slow(**kwargs):
        await asyncio.sleep(30)

    rig.client.replies = [slow] * 4
    await stop_of(rig.chat())
    assert rig.run.ledger.total >= 0.08
    before = rig.run.ledger.total
    started = asyncio.Event()

    async def slow_again(**kwargs):
        started.set()
        await asyncio.sleep(30)

    monkeypatch.setattr(module, "CHAT_TIMEOUT_S", 60.0)
    rig.client.replies = [slow_again]
    waiting = asyncio.ensure_future(rig.chat())
    await asyncio.wait_for(started.wait(), 2)
    rig.run.cancel()
    await stop_of(waiting)
    assert rig.run.ledger.total >= before + 0.02

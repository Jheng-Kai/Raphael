"""A task's model call that fails is asked again for as long as the task has time, wherever the task has got to: asking
again repeats nothing, since the tools run only after a reply. The wait is the one the provider asked for, the owner is
told once, and what waiting cannot mend ends the task."""

import asyncio
import sys

import pytest

from raphael_core.background.run import RunLimits
from raphael_core.brain.openrouter import OpenRouterError
from raphael_core.retry_utils import MODEL_SILENCE_S

from .conftest import turn
from .test_run import MESSAGES, Rig, rig, stop_of  # noqa: F401


@pytest.fixture
def sleeps(monkeypatch):
    """The waits before a failed call is made again, noted and not waited; any other sleep is a real one."""
    waited = []
    real = asyncio.sleep

    def sleep(seconds, *args):
        if sys._getframe(1).f_globals.get("__name__") == "raphael_core.background.run":
            waited.append(seconds)
            return real(0)
        return real(seconds, *args)

    monkeypatch.setattr(asyncio, "sleep", sleep)
    return waited


@pytest.fixture
def no_waits(monkeypatch):
    monkeypatch.setattr("raphael_core.failures.RETRY_WAITS", (0.0, 0.0, 0.0))
    monkeypatch.setattr("raphael_core.failures.PATIENT_WAITS", (0.0,))


def asking(kind, status, seconds, message="slow down"):
    error = OpenRouterError(status, kind, message)
    error.retry_after = seconds
    return error


async def test_a_task_that_has_done_something_asks_again_after_a_failed_call(rig, no_waits):
    await rig.tool("local_time")
    rig.client.replies = [OpenRouterError(503, "server", "down"), OpenRouterError(429, "rate_limit", "x")] * 3 + [turn("Done.")]
    reply = await rig.chat()
    assert reply["content"] == "Done." and len(rig.client.chat_calls) == 7
    # It is the same call each time: nothing the task knew or did is lost.
    assert all(call["messages"] == MESSAGES for call in rig.client.chat_calls)


async def test_a_task_that_has_done_nothing_gives_up_after_the_quick_waits(rig, no_waits):
    rig.client.replies = [OpenRouterError(503, "server", "down")] * 5
    assert await stop_of(rig.chat()) == ("failed", "error")
    assert len(rig.client.chat_calls) == 4


async def test_the_wait_the_provider_asks_for_is_waited_and_the_owner_is_told_once(conn, plugins, sleeps):
    lines = []
    rig = Rig(conn, plugins, progress=lines.append)
    try:
        await rig.tool("local_time")
        rig.client.replies = [asking("rate_limit", 429, 45.0), asking("rate_limit", 429, 45.0), turn("Done.")]
        await rig.chat()
        assert sleeps == [pytest.approx(45.0, abs=0.5)] * 2
        assert len(lines) == 1 and "about 45 s" in lines[0] and "fake/model" not in lines[0]
    finally:
        await rig.meteo.http.aclose()


async def test_a_wait_longer_than_the_task_has_left_ends_it_instead_of_sleeping_through_it(conn, plugins, sleeps):
    rig = Rig(conn, plugins, limits=RunLimits(seconds=30))
    try:
        rig.client.replies = [asking("rate_limit", 429, 100.0), turn("Never.")]
        assert (await stop_of(rig.chat()))[0] == "failed"
        assert sleeps == [] and len(rig.client.chat_calls) == 1
    finally:
        await rig.meteo.http.aclose()


@pytest.mark.parametrize(
    ("error", "detail"),
    [
        (asking("usage_limit", 429, 4 * 3600, "The usage limit has been reached"), "usage_limit"),
        (OpenRouterError(402, "credits", "no credit"), "credits"),
        (OpenRouterError(400, "context_overflow", "maximum context length"), "context_overflow"),
        (OpenRouterError(413, "payload_too_large", "too big"), "payload_too_large"),
        (OpenRouterError(400, "content_policy", "flagged"), "content_policy"),
    ],
)
async def test_what_waiting_cannot_mend_ends_the_task_at_once_with_its_kind(rig, sleeps, no_waits, error, detail):
    await rig.tool("local_time")
    rig.client.replies = [error, turn("Never.")]
    assert await stop_of(rig.chat()) == ("failed", detail)
    assert len(rig.client.chat_calls) == 1 and sleeps == []


async def test_a_model_is_given_the_silence_a_thought_may_have_not_a_minute(rig):
    rig.client.replies = [turn("x")]
    await rig.chat()
    assert rig.client.chat_calls[0]["timeout_s"] == MODEL_SILENCE_S


async def test_a_call_that_timed_out_is_charged_its_estimate_each_time(rig, no_waits):
    rig.client.replies = [OpenRouterError(0, "timeout", "quiet")] * 4
    await stop_of(rig.chat())
    assert rig.run.ledger.total >= 0.08

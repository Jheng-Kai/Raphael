"""What a turn does when a model call fails: it asks again as long as the provider's answer is a wait, the wait is the one
the provider asked for, the owner hears of it once and is told when a limit resets, and a failure that waiting cannot
mend ends the turn at once."""

import asyncio
import json
import sys
import time
from types import SimpleNamespace

import pytest

from raphael_core.agent import narration
from raphael_core.agent.cli import loop as cli
from raphael_core.agent.cli.drivers import Event
from raphael_core.brain.openrouter import OpenRouterError
from .conftest import decision
from .test_service import make_rig  # noqa: F401
from .test_narration import chat, typed

FINAL = json.dumps({"prefix": "Answer", "text": "Done.", "detail": ""})


WAITERS = ("raphael_core.agent.narration", "raphael_core.background.run", "raphael_core.agent.cli.loop")


@pytest.fixture
def sleeps(monkeypatch):
    """The waits before a failed call is made again, noted and not waited; any other sleep is a real one."""
    waited = []
    real = asyncio.sleep

    def sleep(seconds, *args):
        if sys._getframe(1).f_globals.get("__name__") in WAITERS:
            waited.append(seconds)
            return real(0)
        return real(seconds, *args)

    monkeypatch.setattr(asyncio, "sleep", sleep)
    return waited


def asking(kind, status, seconds, message="slow down"):
    error = OpenRouterError(status, kind, message)
    error.retry_after = seconds
    return error


def said(turn, *words):
    return [m["text"] for m in turn["messages"] if m["kind"] == "progress" and all(word in m["text"] for word in words)]


async def test_a_wait_the_provider_asks_for_is_waited_even_before_anything_was_done(make_rig, client, sleeps):
    rig = make_rig()
    client.decisions.append(decision("answer"))
    client.chats = [asking("rate_limit", 429, 45.0), chat(FINAL)]
    assert (await typed(rig))["text"] == "Done."
    assert sleeps == [pytest.approx(45.0, abs=0.5)]
    [turn] = await rig.turns()
    assert len(said(turn, "about 45 s")) == 1


async def test_the_owner_is_told_once_of_a_long_wait_and_not_again_of_the_next(make_rig, client, sleeps):
    rig = make_rig()
    client.decisions.append(decision("answer"))
    client.chats = [chat("I will check the time.", ("local_time", {})),
                    *[asking("overloaded", 529, 100.0 + n, "busy") for n in range(3)], chat(FINAL)]
    assert (await typed(rig))["text"] == "Done."
    assert [round(wait) for wait in sleeps] == [100, 101, 102]
    [turn] = await rig.turns()
    assert len(said(turn, "try")) == 1


async def test_after_work_the_waits_are_the_patient_ones_and_longer_than_the_providers_when_it_asks_for_less(
    make_rig, client, sleeps, monkeypatch
):
    monkeypatch.setattr(narration, "RETRY_WAITS", (1.0,))
    rig = make_rig()
    client.decisions.append(decision("answer"))
    client.chats = [chat("I will check the time.", ("local_time", {})),
                    *[asking("server", 503, 2.0) for _ in range(3)], chat(FINAL)]
    await typed(rig)
    assert sleeps[0] == pytest.approx(2.0, abs=0.5)  # the provider asked for more than the first step of the schedule
    assert 30 <= sleeps[1] <= 36 and 60 <= sleeps[2] <= 72  # and for less than the patient ones, which are kept


@pytest.mark.parametrize("language", ["en", "zh-TW", "ja"])
async def test_a_usage_limit_ends_the_turn_at_once_and_says_when_it_resets(make_rig, client, sleeps, language):
    rig = make_rig()
    client.decisions.append(decision("answer"))
    client.chats = [chat("I will check the time.", ("local_time", {})),
                    asking("usage_limit", 429, 5 * 3600, "The usage limit has been reached")]
    before = time.time()
    result = await rig.call("agent.ask", {"session_id": "live", "text": "Check the time", "ui_language": language, "source": "app"})
    after = time.time()
    assert len(client.chat_calls) == 2 and sleeps == []
    assert any(time.strftime("%H:%M", time.localtime(then + 5 * 3600)) in result["text"] for then in (before, after))
    assert (await rig.turns())[0]["status"] == "error"


async def test_credits_that_ran_out_are_not_waited_for(make_rig, client, sleeps):
    rig = make_rig()
    client.decisions.append(decision("answer"))
    client.chats = [chat("I will check the time.", ("local_time", {})),
                    OpenRouterError(429, "rate_limit", "You exceeded your current quota, please check your plan and billing details.")]
    await typed(rig)
    assert len(client.chat_calls) == 2 and sleeps == []


async def test_a_conversation_that_does_not_fit_is_not_asked_again_and_is_not_called_a_refusal(make_rig, client, sleeps):
    rig = make_rig()
    client.decisions.append(decision("answer"))
    client.chats = [OpenRouterError(400, "bad_request", "This model's maximum context length is 8192 tokens. Please reduce the length of the messages.")]
    result = await typed(rig)
    assert len(client.chat_calls) == 1 and sleeps == []
    assert "new conversation" in result["text"] and "declined" not in result["text"]


# --- a CLI brain ---------------------------------------------------------------------------------------------------


def cli_loop(monkeypatch, tmp_path, runs, **options):
    plays = iter(runs)

    class FakeDriver:
        def __init__(self, *args, **kwargs):
            pass

        async def interrupt(self):
            pass

        async def run(self, **kwargs):
            for event in next(plays):
                yield event

    monkeypatch.setattr(cli, "Driver", FakeDriver)
    lines = []
    loop = cli.CliLoop(
        brains=SimpleNamespace(environ={}, home=tmp_path, command=lambda name: ["fake"], available=lambda name, command=None: True),
        sessions=SimpleNamespace(locks={}, get=lambda *args: None, put=lambda *args: None, conversations=SimpleNamespace(resolve=lambda member, conversation: conversation)),
        member_id=5, model="cli:codex:fake", ledger=SimpleNamespace(add=lambda **kwargs: None), language="en", plain=True,
        system="", user="", tools=[], progress=lines.append, thinking=lambda text: None,
        event=lambda text: None, execute=None, conversation_id=7, **options)
    return loop, lines


async def test_a_cli_turn_waits_as_long_as_the_provider_said_and_says_so_once(monkeypatch, tmp_path, sleeps):
    limited = [Event("error", "rate_limited", {"kind": "rate_limit", "reason": "Too many requests. Retry after 45 seconds."})]
    loop, lines = cli_loop(monkeypatch, tmp_path, [limited, limited, [Event("final", "Finished.")]])
    await loop._work()
    assert loop.failure is None and loop._queue.get_nowait().final == "Finished."
    assert [round(wait) for wait in sleeps] == [45, 45]
    assert lines == ["Codex CLI is rate-limited; retrying in 45 s."]


async def test_a_colleagues_question_is_answered_while_the_member_is_at_work(monkeypatch, tmp_path, sleeps):
    # Live: a member asked Raphael where a file was, while Raphael worked, and the owner's chat said a turn was under way.
    answered = [Event("final", "It is in the team folder.")]
    loop, _ = cli_loop(monkeypatch, tmp_path, [answered, answered], resume_session=False)
    async with loop.sessions.locks.setdefault((5, 7), asyncio.Lock()):
        await loop._work()
        assert loop.failure is None and loop._queue.get_nowait().final == "It is in the team folder."
        own, _ = cli_loop(monkeypatch, tmp_path, [answered])
        own.sessions = loop.sessions
        await own._work()
        assert own.failure == "busy"


async def test_a_cli_usage_limit_is_not_run_again_and_says_when_it_resets(monkeypatch, tmp_path, sleeps):
    reset = time.time() + 2 * 3600
    exhausted = [Event("error", "usage_limit", {"kind": "usage_limit", "reason": "Usage limit reached", "resets_at": reset})]
    loop, lines = cli_loop(monkeypatch, tmp_path, [exhausted, [Event("final", "Never.")]])
    await loop._work()
    assert loop.failure == "usage_limit" and sleeps == []
    assert time.strftime("%H:%M", time.localtime(reset)) in loop._queue.get_nowait().final

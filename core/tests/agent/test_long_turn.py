"""A turn works for as long as the job takes: no clock or count ends it, a failed model call is made again, and the
owner is the one who stops it."""

import asyncio
import json
from types import SimpleNamespace

import pytest

from raphael_core.agent import narration
from raphael_core.agent.cli import loop as cli
from raphael_core.agent.cli.drivers import Event
from raphael_core.background.run import estimate_cost
from raphael_core.brain.openrouter import ChatToolCall, ChatTurn, OpenRouterError
from .conftest import decision
from .test_service import make_rig  # noqa: F401
from .test_narration import chat, typed

HOURS = 3600.0
FINAL = json.dumps({"prefix": "Answer", "text": "Done.", "detail": ""})


@pytest.fixture
def skip_time(monkeypatch):
    """A long wait passes at once, and any deadline within it fires as it would; short waits for real work stay real."""

    def install():
        loop = asyncio.get_running_loop()
        skipped = [0.0]
        real_time, real_select = loop.time, loop._selector.select

        def select(timeout=None):
            if timeout is None or timeout <= 30:
                return real_select(timeout)
            events = real_select(0)
            if not events:
                skipped[0] += timeout
            return events

        monkeypatch.setattr(loop, "time", lambda: real_time() + skipped[0])
        monkeypatch.setattr(loop._selector, "select", select)

    return install


@pytest.fixture
def no_waits(monkeypatch):
    monkeypatch.setattr(narration, "RETRY_WAITS", (0.0, 0.0, 0.0))
    monkeypatch.setattr(narration, "PATIENT_WAITS", (0.0,))


async def test_a_model_may_think_for_hours(make_rig, client, skip_time):
    rig = make_rig()
    client.decisions.append(decision("answer"))

    async def thinks(**kwargs):
        await asyncio.sleep(2 * HOURS)
        return chat(FINAL)

    client.chats = [thinks]
    skip_time()
    result = await typed(rig)
    assert result["text"] == "Done."
    assert (await rig.turns())[0]["status"] == "done"


async def test_a_job_goes_on_past_any_count_of_steps(make_rig, client):
    rig = make_rig()
    client.decisions.append(decision("answer"))
    rounds = [chat("I will go on.", *[("local_time", {"step": f"{n}-{m}"}) for m in range(3)]) for n in range(85)]
    client.chats = [*rounds, chat(FINAL)]
    result = await typed(rig)
    assert result["text"] == "Done."
    assert len(client.chat_calls) == 86


async def test_a_failed_call_after_work_is_made_again_and_the_work_goes_on(make_rig, client, no_waits):
    rig = make_rig()
    client.decisions.append(decision("answer"))
    client.chats = [
        chat("I will check the time.", ("local_time", {})),
        OpenRouterError(0, "timeout", "no answer"), OpenRouterError(503, "server", "down"),
        chat(FINAL),
    ]
    result = await typed(rig)
    assert result["text"] == "Done."
    assert (await rig.turns())[0]["status"] == "done"
    # The call made again is the same call: nothing the turn knew or did is lost, and no tool runs twice.
    assert client.chat_calls[1]["messages"] == client.chat_calls[3]["messages"]


async def test_work_under_way_keeps_trying_for_as_long_as_it_takes_and_says_so_once(make_rig, client, no_waits):
    rig = make_rig()
    client.decisions.append(decision("answer"))
    client.chats = [
        chat("I will check the time.", ("local_time", {})),
        *[OpenRouterError(429, "rate_limit", "slow down") for _ in range(12)],
        chat(FINAL),
    ]
    result = await typed(rig)
    assert result["text"] == "Done."
    [turn] = await rig.turns()
    said = [m["text"] for m in turn["messages"] if m["kind"] == "progress" and "try" in m["text"]]
    assert len(said) == 1


async def test_a_question_nothing_was_done_for_still_says_so_in_seconds(make_rig, client, no_waits):
    rig = make_rig()
    client.decisions.append(decision("answer"))
    client.chats = [OpenRouterError(503, "server", "down") for _ in range(4)]
    await typed(rig)
    assert (await rig.turns())[0]["status"] == "error"
    assert len(client.chat_calls) == 4


async def test_the_owner_can_stop_a_turn_waiting_to_try_again(make_rig, client, monkeypatch):
    monkeypatch.setattr(narration, "RETRY_WAITS", (0.0,))
    monkeypatch.setattr(narration, "PATIENT_WAITS", (HOURS,))
    rig = make_rig()
    client.decisions.append(decision("answer"))
    client.chats = [
        chat("I will check the time.", ("local_time", {})),
        OpenRouterError(503, "server", "down"), OpenRouterError(503, "server", "down"),
    ]
    task = asyncio.create_task(typed(rig))
    async with asyncio.timeout(5):
        while len(client.chat_calls) < 3:
            await asyncio.sleep(0.01)
    await asyncio.sleep(0.01)
    await rig.call("agent.cancel", {"session_id": "live"})
    await asyncio.wait_for(task, 5)
    assert (await rig.turns())[0]["status"] == "denied"


def test_a_call_given_up_on_costs_nothing_on_the_owners_plan():
    assert estimate_cost("@chatgpt:gpt-6-sol?effort=max", 5000) == 0


async def test_a_cli_brain_may_work_for_hours(monkeypatch, tmp_path, skip_time):
    class FakeDriver:
        def __init__(self, *args, **kwargs):
            pass

        async def interrupt(self):
            pass

        async def run(self, **kwargs):
            await asyncio.sleep(2 * HOURS)
            yield Event("final", "Finished.")

    monkeypatch.setattr(cli, "Driver", FakeDriver)
    loop = cli.CliLoop(
        brains=SimpleNamespace(environ={}, home=tmp_path, command=lambda name: ["fake"], available=lambda name, command=None: True),
        sessions=SimpleNamespace(locks={}, get=lambda *args: None, put=lambda *args: None, conversations=SimpleNamespace(resolve=lambda member, conversation: conversation)),
        member_id=5, model="cli:codex:fake", ledger=SimpleNamespace(add=lambda **kwargs: None), language="en", plain=True,
        system="", user="", tools=[], progress=lambda text: None, thinking=lambda text: None,
        event=lambda text: None, execute=None, conversation_id=7)
    skip_time()
    await loop._work()
    assert loop.failure is None
    assert loop._queue.get_nowait().final == "Finished."


async def test_a_call_repeated_with_the_same_result_is_noted_to_the_model_and_still_made(make_rig, client):
    rig = make_rig()
    client.decisions.append(decision("answer"))
    client.chats = [chat("I will check the time.", ("local_time", {})) for _ in range(3)] + [chat(FINAL)]
    result = await typed(rig)
    assert result["text"] == "Done."
    results = [m["content"] for m in client.chat_calls[3]["messages"] if m["role"] == "tool"]
    assert len(results) == 3 and ["harness_note" in text for text in results] == [False, False, True]


async def test_a_cli_brain_that_repeats_a_call_is_noted_after_the_result_and_never_refused():
    from raphael_core.worker.loop import ToolOutcome

    ran = []

    async def execute(identifier, name, args):
        ran.append(args)
        return ToolOutcome(True, None, "same")

    loop = cli.CliLoop(
        brains=SimpleNamespace(environ={}, home=None, command=lambda name: ["fake"], available=lambda name, command=None: True),
        sessions=SimpleNamespace(locks={}, get=lambda *args: None, put=lambda *args: None, conversations=SimpleNamespace(resolve=lambda member, conversation: conversation)),
        member_id=5, model="cli:codex:fake", ledger=SimpleNamespace(add=lambda **kwargs: None), language="en", plain=True,
        system="", user="", tools=[], progress=lambda text: None, thinking=lambda text: None,
        event=lambda text: None, execute=execute, conversation_id=7)
    shown = [await loop._tool(str(n), "Notes__look", {"topic": "tea"}) for n in range(3)]
    assert len(ran) == 3 and all(outcome.ok for outcome in shown)
    assert ["harness_note" in outcome.content for outcome in shown] == [False, False, True]


async def test_a_call_cut_off_by_the_output_limit_is_asked_again_with_more_room(make_rig, client):
    rig = make_rig()
    client.decisions.append(decision("answer"))
    cut = ChatTurn("I will write it.", [ChatToolCall("0", "local_time", None, '{"city": "Ta')], "fake/model", 0.3, 10, 10, 1,
                   finish_reason="length")
    client.chats = [cut, chat("I will check the time.", ("local_time", {})), chat(FINAL)]
    result = await typed(rig)
    assert result["text"] == "Done."
    first, second, third = (sent["max_tokens"] for sent in client.chat_calls)
    assert first == 8192 and second == 2 * first and third == first
    assert "not a JSON object" not in json.dumps(client.chat_calls[2]["messages"])

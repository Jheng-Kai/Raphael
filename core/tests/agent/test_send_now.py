"""「立即送出」 and a message said while a Claude Code or Antigravity turn works (R-QUEUE-02, R-QUEUE-05, R-BATCH-01)."""

import asyncio
import base64
from types import SimpleNamespace

import pytest

from raphael_core.agent.cli import loop as cli
from raphael_core.agent.cli.drivers import Event
from raphael_core.brain.settings import SettingsStore
from raphael_core.protocol import RpcError
from raphael_core.worker.loop import ToolOutcome

from .test_service import make_rig, until  # noqa: F401
from .test_narration import chat, typed

FILE = {"name": "example.txt", "mime": "text/plain", "data": base64.b64encode(b"example").decode()}


def cli_rig(make_rig, monkeypatch, tmp_path, brain, *, reads=False, block=1):
    """A fake CLI whose turn number `block` waits for `release` and then calls one tool (when `reads`), and whose turns each
    answer once. Its first turn opens native session one."""
    rig = make_rig()
    state = SimpleNamespace(rig=rig, calls=[], results=[], interrupted=[], started=asyncio.Event(), release=asyncio.Event())

    class Driver:
        def __init__(self, *args, **kwargs):
            pass

        async def interrupt(self):
            state.interrupted.append(True)

        async def run(self, **kwargs):
            state.calls.append(kwargs)
            number = len(state.calls)
            if number == 1:
                yield Event("session", "native-1")
            if number == block:
                loop = next(iter(rig.service._owner_loops.values()))

                async def execute(identifier, name, arguments):
                    return ToolOutcome(True, content="12:00")
                loop.execute = execute
                state.started.set()
                await state.release.wait()
                if reads:
                    state.results.append(await loop._tool("t1", "local_time", {}))
            yield Event("final", f"Answer {number}")

    monkeypatch.setattr(cli, "Driver", Driver)
    rig.service._cli_brains.home = tmp_path
    monkeypatch.setattr(rig.service._cli_brains, "command", lambda name: ["fake"])
    monkeypatch.setattr(rig.service._cli_brains, "available", lambda *a, **k: True)
    SettingsStore(rig.conn).set("agent_model", f"cli:{brain}:fake")
    return rig, state


async def ask_with_file(rig, session, text):
    return await asyncio.wait_for(rig.call("agent.ask", {"session_id": session, "source": "app", "text": text,
                                                         "ui_language": "en", "attachments": [FILE]}), .5)


async def send_now(rig, queued, session):
    return await rig.call("agent.history.send_now", {"session_id": session, "member_id": 0, "turn_id": queued["turn_id"]})


def status_of(turns, question):
    return next(turn["status"] for turn in turns if turn["question"] == question)


@pytest.mark.parametrize("brain", ["claude", "gemini"])
async def test_a_message_said_mid_turn_reaches_the_model_with_its_next_tool_result(make_rig, monkeypatch, tmp_path, brain):
    rig, state = cli_rig(make_rig, monkeypatch, tmp_path, brain, reads=True)
    first = asyncio.create_task(typed(rig, "Request A"))
    await asyncio.wait_for(state.started.wait(), 2)
    said = await asyncio.wait_for(typed(rig, "Request B, I also want to sign in"), .5)
    assert said["steered"] is True
    state.release.set()
    assert (await first)["text"] == "Answer 1"
    await until(lambda: not rig.service._drains)
    [result] = state.results
    assert cli.OWNER_NOW in result.content and "Request B, I also want to sign in" in result.content
    assert result.content.index("12:00") < result.content.index(cli.OWNER_NOW)  # the tool's own result comes first
    assert len(state.calls) == 1  # no second turn: the model read it at its next step
    row = rig.service._inbox.get(said["turn_id"])
    assert (row["state"], row["outcome"]) == ("terminal", "steered")
    turn = rig.service.turn(said["turn_id"])
    assert (turn.status, turn.route) == ("done", "owner_input")


async def test_a_message_the_turn_never_read_starts_the_next_turn_once(make_rig, monkeypatch, tmp_path):
    rig, state = cli_rig(make_rig, monkeypatch, tmp_path, "claude")
    first = asyncio.create_task(typed(rig, "Request A"))
    await asyncio.wait_for(state.started.wait(), 2)
    said = await asyncio.wait_for(typed(rig, "Request B"), .5)
    assert said["steered"] is True  # no tool follows, so nothing carries it
    state.release.set()
    await first
    await until(lambda: len(state.calls) == 2 and not rig.service._drains)
    assert "Request B" in state.calls[1]["user"]
    assert rig.service._inbox.get(said["turn_id"])["outcome"] == "completed"
    turn = rig.service.turn(said["turn_id"])
    assert (turn.status, turn.route) == ("done", "answer")


async def test_a_message_withdrawn_while_steering_is_never_read(make_rig, monkeypatch, tmp_path):
    rig, state = cli_rig(make_rig, monkeypatch, tmp_path, "claude", reads=True)
    first = asyncio.create_task(typed(rig, "Request A"))
    await asyncio.wait_for(state.started.wait(), 2)
    said = await asyncio.wait_for(typed(rig, "Withdraw this"), .5)
    loop = next(iter(rig.service._owner_loops.values()))
    assert loop.owner_input.pending
    turn = rig.service.turn(said["turn_id"])
    await rig.call("agent.history.retract", {"session_id": turn.session_id, "turn_id": turn.id})
    assert not loop.owner_input.pending and not loop.owner_input.leftover()
    state.release.set()
    await first
    await until(lambda: not rig.service._drains)
    assert cli.OWNER_NOW not in state.results[0].content and "Withdraw this" not in state.results[0].content
    assert len(state.calls) == 1
    assert rig.service._inbox.get(said["turn_id"])["outcome"] == "cancelled"
    assert not any(message["content"] == "Withdraw this" for message in loop.tool_messages)


@pytest.mark.parametrize("brain", ["claude", "gemini", "codex"])
async def test_send_now_ends_the_running_turn_and_starts_the_message_as_its_own(make_rig, monkeypatch, tmp_path, brain):
    rig, state = cli_rig(make_rig, monkeypatch, tmp_path, brain, block=2)
    await typed(rig, "Warm up")  # an earlier answer, so that there is a native session to go on from
    first = asyncio.create_task(typed(rig, "Request A"))
    await asyncio.wait_for(state.started.wait(), 2)
    queued = await ask_with_file(rig, "with-file", "Request B")
    assert queued["status"] == "queued"  # a file never steers
    assert (await send_now(rig, queued, "with-file")) == {"sent": True, "stopped": True}
    await asyncio.gather(first, return_exceptions=True)
    await until(lambda: len(state.calls) == 3 and not rig.service._drains)
    assert "Request B" in state.calls[2]["user"]
    assert state.interrupted  # the child was told to stop (Codex: turn/interrupt; the others are ended)
    if brain != "codex":
        assert state.calls[2]["session"] == "native-1"  # the next turn resumes the stored native session
    turns = await rig.turns()
    assert status_of(turns, "Request A") == "cancelled" and status_of(turns, "Request B") == "done"
    assert rig.service._inbox.get(next(t for t in turns if t["question"] == "Request A")["id"])["outcome"] == "cancelled"
    assert rig.service._inbox.get(queued["turn_id"])["outcome"] == "completed"
    # The memory that would block the next request is not left behind.
    assert not rig.service._was_cancelled(next(t for t in turns if t["question"] == "Request A")["session_id"])


async def test_send_now_goes_ahead_of_the_messages_queued_before_it(make_rig, monkeypatch, tmp_path):
    rig, state = cli_rig(make_rig, monkeypatch, tmp_path, "claude")
    first = asyncio.create_task(typed(rig, "Request A"))
    await asyncio.wait_for(state.started.wait(), 2)
    await ask_with_file(rig, "file-b", "Request B")
    third = await ask_with_file(rig, "file-c", "Request C")
    await send_now(rig, third, "file-c")
    await asyncio.gather(first, return_exceptions=True)
    await until(lambda: len(state.calls) == 3 and not rig.service._drains)
    assert "Request C" in state.calls[1]["user"] and "Request B" in state.calls[2]["user"]


async def test_send_now_takes_back_a_message_the_model_has_not_read(make_rig, monkeypatch, tmp_path):
    rig, state = cli_rig(make_rig, monkeypatch, tmp_path, "claude", reads=True)
    first = asyncio.create_task(typed(rig, "Request A"))
    await asyncio.wait_for(state.started.wait(), 2)
    said = await asyncio.wait_for(typed(rig, "Request B"), .5)
    loop = next(iter(rig.service._owner_loops.values()))
    assert loop.owner_input.pending
    assert (await send_now(rig, said, "live-2"))["sent"] is True
    assert not loop.owner_input.pending
    await asyncio.gather(first, return_exceptions=True)
    await until(lambda: len(state.calls) == 2 and not rig.service._drains)
    assert state.results == []  # the first turn ended before its tool answered: nothing was read twice
    assert "Request B" in state.calls[1]["user"]


async def test_send_now_after_the_message_started_or_was_read_does_nothing(make_rig, monkeypatch, tmp_path):
    rig, state = cli_rig(make_rig, monkeypatch, tmp_path, "claude", reads=True)
    first = asyncio.create_task(typed(rig, "Request A"))
    await asyncio.wait_for(state.started.wait(), 2)
    said = await asyncio.wait_for(typed(rig, "Request B"), .5)
    state.release.set()
    await first
    await until(lambda: not rig.service._drains)
    assert await send_now(rig, said, "live-2") == {"sent": False}
    assert len(state.calls) == 1


async def test_send_now_names_a_message_of_this_conversation(make_rig, monkeypatch, tmp_path):
    rig, state = cli_rig(make_rig, monkeypatch, tmp_path, "claude")
    first = asyncio.create_task(typed(rig, "Request A"))
    await asyncio.wait_for(state.started.wait(), 2)
    queued = await ask_with_file(rig, "with-file", "Request B")
    with pytest.raises(RpcError):
        await rig.call("agent.history.send_now", {"session_id": "other", "member_id": 0, "turn_id": queued["turn_id"]})
    with pytest.raises(RpcError):
        await rig.call("agent.history.send_now", {"session_id": "with-file", "member_id": 0, "turn_id": 9999})
    assert not state.interrupted
    state.release.set()
    await first
    await until(lambda: not rig.service._drains)


async def test_send_now_cancels_an_api_turn_and_the_message_runs_next(make_rig, client):
    rig = make_rig()
    started = asyncio.Event()

    async def slow(**kwargs):
        started.set()
        await asyncio.Event().wait()

    client.chats = [slow, chat("Answer to B")]
    first = asyncio.create_task(typed(rig, "Request A"))
    await asyncio.wait_for(started.wait(), 2)
    queued = await ask_with_file(rig, "with-file", "Request B")
    assert (await send_now(rig, queued, "with-file"))["sent"] is True
    await asyncio.gather(first, return_exceptions=True)
    await until(lambda: rig.service.turn(queued["turn_id"]).status == "done" and not rig.service._drains)
    assert "Request B" in str(client.chat_calls[-1]["messages"])
    assert status_of(await rig.turns(), "Request A") == "cancelled"

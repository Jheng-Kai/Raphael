"""Words the owner sent while a member worked, that the member's model never read, are never left behind (R-QUEUE-10).
However that work ends they come back as a turn of their own, ahead of what was queued after them; what a model read is
settled the moment it reads it, so a core that died runs only the unread words again, once; and 「立即送出」 on any waiting
message ends in that message being read."""

import asyncio
import json
import re
from types import SimpleNamespace

import pytest

from raphael_core.agent.cli import loop as cli
from raphael_core.agent.cli.drivers import Event
from raphael_core.agent.service import _Ask
from raphael_core.brain.settings import SettingsStore
from raphael_core.worker.loop import ToolOutcome

from .test_service import make_rig, until  # noqa: F401
from .test_narration import chat, typed, use
from .test_plugins import plugins, calls  # noqa: F401
from .test_send_now import ask_with_file


def answer(text):
    return chat(json.dumps({"prefix": "", "text": text, "detail": ""}))


def settled(rig, turn_id):
    """Whether a message is done with. A steered message's turn reads as done too, so the inbox says."""
    return rig.service._inbox.get(turn_id)["state"] == "terminal"


def question(call):
    """The request a CLI turn was started for: the last question of its prompt (the earlier ones are its context)."""
    return re.findall(r"<question>\n(.*?)\n</question>", call["user"], re.S)[-1]


def use_fake_cli(rig, monkeypatch, tmp_path):
    rig.service._cli_brains.home = tmp_path
    monkeypatch.setattr(rig.service._cli_brains, "command", lambda name: ["fake"])
    monkeypatch.setattr(rig.service._cli_brains, "available", lambda *a, **k: True)
    SettingsStore(rig.conn).set("agent_model", "cli:claude:fake")


def working_cli(make_rig, monkeypatch, tmp_path, way="answered", rig=None):
    """A fake Claude Code whose first turn is at work (`started`) until `release`, then ends `way` without calling another
    tool of Raphael's: what the owner says meanwhile stays unread. Every later turn answers at once."""
    rig = rig or make_rig()
    state = SimpleNamespace(calls=[], started=asyncio.Event(), release=asyncio.Event())

    class Driver:
        def __init__(self, *args, **kwargs):
            pass

        async def interrupt(self):
            pass

        async def run(self, **kwargs):
            state.calls.append(kwargs)
            if len(state.calls) > 1:
                yield Event("final", f"Answer {len(state.calls)}")
                return
            loop = next(iter(rig.service._owner_loops.values()))
            if way == "handed off":
                async def handoff(identifier, name, arguments):
                    return ToolOutcome(True, "handoff", json.dumps({"task_id": 1, "state": "queued"}))
                loop.execute = handoff
                await loop._tool("h1", "handoff", {"member_id": 1, "request": "Draft the poster", "stage_id": "poster",
                                                   "done_when": "A draft exists"})
            state.started.set()
            await state.release.wait()
            if way == "asked the owner":
                await loop._tool("q1", "ask_owner", {"question": "Which day?", "options": ["Monday", "Tuesday"]})
            elif way == "failed":
                yield Event("error", "invalid_request", data={"reason": "The request was refused"})
            else:
                yield Event("final", "Answer 1")

    monkeypatch.setattr(cli, "Driver", Driver)
    use_fake_cli(rig, monkeypatch, tmp_path)
    return rig, state


@pytest.mark.parametrize("way", ["answered", "handed off", "cancelled", "failed"])
async def test_unread_words_become_their_own_turn_however_the_work_ends(make_rig, monkeypatch, tmp_path, way):
    rig, state = working_cli(make_rig, monkeypatch, tmp_path, way)
    first = asyncio.create_task(typed(rig, "Request A"))
    await asyncio.wait_for(state.started.wait(), 2)
    said = await asyncio.wait_for(typed(rig, "Request B"), .5)
    assert said["steered"] is True
    queued = await ask_with_file(rig, "with-file", "Request C")
    assert queued["status"] == "queued"  # a file never steers: it waits behind what was said before it
    if way == "cancelled":
        await rig.call("agent.cancel", {"session_id": "live"})
    else:
        state.release.set()
    await asyncio.gather(first, return_exceptions=True)
    await until(lambda: len(state.calls) == 3 and not rig.service._drains)
    assert [question(call) for call in state.calls] == ["Request A", "Request B", "Request C"]
    for turn_id in (said["turn_id"], queued["turn_id"]):
        assert rig.service._inbox.get(turn_id)["outcome"] == "completed"
    turn = rig.service.turn(said["turn_id"])
    assert (turn.status, turn.route, turn.text) == ("done", "answer", "Answer 2")


async def test_unread_words_become_their_own_turn_when_the_owner_says_no_to_the_card_the_work_waits_on(make_rig, plugins, calls, client):
    await plugins.connect(note="T2")
    rig = make_rig(plugins=plugins.hub)
    asking, release = asyncio.Event(), asyncio.Event()

    async def save(**kwargs):
        asking.set()
        await release.wait()
        return chat("I will save the example.", use("Notes__note", {"text": "example"}))

    client.chats = [save, answer("Answer to B")]
    first = asyncio.create_task(typed(rig, "Save an example"))
    await asyncio.wait_for(asking.wait(), 2)
    said = await asyncio.wait_for(typed(rig, "Request B"), .5)
    assert said["steered"] is True
    release.set()
    asked = await first
    assert asked["status"] == "confirm"
    # While the card waits the words stay with the work: a yes would go on with them.
    assert rig.service._inbox.get(said["turn_id"])["state"] == "steering"
    await rig.confirm(asked["confirm"]["id"], approved=False)
    await until(lambda: settled(rig, said["turn_id"]) and not rig.service._drains)
    assert calls == []
    assert "Request B" in str(client.chat_calls[-1]["messages"])
    assert rig.service._inbox.get(said["turn_id"])["outcome"] == "completed"
    assert rig.service.turn(said["turn_id"]).text == "Answer to B"


async def test_read_words_are_settled_as_they_are_read_and_a_restart_runs_only_the_unread_ones_once(make_rig, monkeypatch, tmp_path):
    rig = make_rig()
    state = SimpleNamespace(calls=[], started=asyncio.Event(), read=asyncio.Event(), was_read=asyncio.Event(),
                            release=asyncio.Event(), results=[])

    class Driver:
        def __init__(self, *args, **kwargs):
            pass

        async def interrupt(self):
            pass

        async def run(self, **kwargs):
            state.calls.append(kwargs)
            if len(state.calls) > 1:
                yield Event("final", f"Answer {len(state.calls)}")
                return
            loop = next(iter(rig.service._owner_loops.values()))

            async def execute(identifier, name, arguments):
                return ToolOutcome(True, content="12:00")
            loop.execute = execute
            state.started.set()
            await state.read.wait()
            state.results.append(await loop._tool("t1", "local_time", {}))
            state.was_read.set()
            await state.release.wait()
            yield Event("final", "Answer 1")

    monkeypatch.setattr(cli, "Driver", Driver)
    use_fake_cli(rig, monkeypatch, tmp_path)
    first = asyncio.create_task(typed(rig, "Request A"))
    try:
        await asyncio.wait_for(state.started.wait(), 2)
        read = await asyncio.wait_for(typed(rig, "Request R"), .5)
        state.read.set()
        await asyncio.wait_for(state.was_read.wait(), 2)
        assert "Request R" in state.results[0].content
        # The work still runs, and what its model read is settled already: a core that dies now cannot run it again.
        assert (rig.service._inbox.get(read["turn_id"])["state"], rig.service._inbox.get(read["turn_id"])["outcome"]) == ("terminal", "steered")
        unread = await asyncio.wait_for(typed(rig, "Request U"), .5)
        assert unread["steered"] is True
        # The core dies with the work under way; the next one opens the same database.
        restarted = make_rig()
        use_fake_cli(restarted, monkeypatch, tmp_path)
        row = restarted.service._inbox.get(unread["turn_id"])
        assert row["state"] == "queued"
        assert (restarted.service.turn(unread["turn_id"]).status, restarted.service.turn(unread["turn_id"]).route) == ("queued", "answer")
        assert restarted.service._inbox.get(read["turn_id"])["outcome"] == "steered"
        restarted.service.start()
        await until(lambda: settled(restarted, unread["turn_id"]) and not restarted.service._drains)
        assert [question(call) for call in state.calls] == ["Request A", "Request U"]
        assert restarted.service._inbox.get(unread["turn_id"])["outcome"] == "completed"
    finally:
        state.read.set()
        state.release.set()
        await asyncio.gather(first, return_exceptions=True)


def left_steering(rig, session, text):
    """A message handed to work that has ended without reading it or giving it back: the row the inbox kept for it."""
    conversation = rig.service.conversations.main(0)
    ask = _Ask(session_id=session, text=text, language="en", source="app", conversation_id=conversation)
    row, _ = rig.service._inbox.admit(ask, dict(text=text, language="en", source="app", attachments=[]))
    rig.service._inbox.transfer(row["turn_id"])
    return row["turn_id"]


async def test_send_now_reads_a_message_that_no_work_holds_any_more(make_rig, client):
    rig = make_rig()
    client.chats = [answer("Answer to the left message")]
    left = left_steering(rig, "left", "Left with ended work")
    sent = await rig.call("agent.history.send_now", {"session_id": "left", "member_id": 0, "turn_id": left})
    assert sent == {"sent": True, "stopped": False}
    await until(lambda: settled(rig, left) and not rig.service._drains)
    assert rig.service._inbox.get(left)["outcome"] == "completed"
    assert rig.service.turn(left).text == "Answer to the left message"
    assert "Left with ended work" in str(client.chat_calls[0]["messages"])


async def test_send_now_behind_a_message_left_with_ended_work_takes_both_in_order(make_rig, client):
    rig = make_rig()
    client.chats = [answer("Answer to the left message"), answer("Answer to the next message")]
    left = left_steering(rig, "left", "Left with ended work")
    conversation = rig.service.conversations.main(0)
    ask = _Ask(session_id="next", text="The next message", language="en", source="app", conversation_id=conversation)
    queued, _ = rig.service._inbox.admit(ask, dict(text=ask.text, language="en", source="app", attachments=[]))
    sent = await rig.call("agent.history.send_now", {"session_id": "next", "member_id": 0, "turn_id": queued["turn_id"]})
    assert sent == {"sent": True, "stopped": False}
    await until(lambda: settled(rig, queued["turn_id"]) and not rig.service._drains)
    assert "Left with ended work" in str(client.chat_calls[0]["messages"])
    assert "The next message" in str(client.chat_calls[1]["messages"])
    assert [rig.service._inbox.get(turn_id)["outcome"] for turn_id in (left, queued["turn_id"])] == ["completed", "completed"]


async def test_a_new_message_behind_one_left_with_ended_work_runs_right_after_it(make_rig, client):
    rig = make_rig()
    client.chats = [answer("Answer to the left message"), answer("Answer to the next message")]
    left = left_steering(rig, "left", "Left with ended work")
    queued = await asyncio.wait_for(typed(rig, "The next message"), 2)
    assert queued["status"] == "queued"
    await until(lambda: settled(rig, queued["turn_id"]) and not rig.service._drains)
    assert rig.service.turn(left).text == "Answer to the left message"
    assert rig.service.turn(queued["turn_id"]).text == "Answer to the next message"

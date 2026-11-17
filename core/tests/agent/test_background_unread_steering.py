"""Words the owner sent while a member's background task worked are settled the moment the task's model reads them, and come
back to their conversation as a turn of their own when the task stops running without reading them, however it stops
(R-QUEUE-11). The task runs in a real worker joined to the host by two queues (background/conftest.py), or as a Claude Code
turn whose driver is a fake; the conversation is the real agent service's, with its real inbox."""

import asyncio
from types import SimpleNamespace

import pytest

from raphael_core.agent.cli import loop as cli
from raphael_core.agent.cli.drivers import Event
from raphael_core.brain.openrouter import OpenRouterError
from raphael_core.worker.loop import ToolOutcome

from .test_service import make_rig  # noqa: F401
from .test_narration import typed
from .test_owner_questions import wired  # noqa: F401
from .test_unread_steering import answer, settled
from background.conftest import call, plugins, report, turn, until, use  # noqa: F401


def start_task(agent, background, model="fake/model"):
    """A task of Raphael's under way in the owner's conversation with him, as a hand-over starts one."""
    origin = agent.history.add(session_id="work", question="Plan the visit", route="delegate", prefix="", text="",
                               status="running", source="app", conversation_id=agent.service.conversations.main())
    task_id = background.service.submit(session_id="work", text="Plan the visit", language="en", model=model)
    background.service.attach_turn(task_id, origin)
    return origin, task_id


def api_task(background, way):
    """The task's model is thinking (`started`) until `release`; then the task ends `way`, its model never given what the
    owner wrote meanwhile."""
    state = SimpleNamespace(started=asyncio.Event(), release=asyncio.Event())

    async def thinking(**kwargs):
        state.started.set()
        await state.release.wait()
        if way == "failed":
            raise OpenRouterError(400, "bad_request", "The request was refused")
        return turn("I need your date.", [call("ask_owner", {"question": "Which day?", "options": ["Monday", "Tuesday"]}, "q1")])

    background.client.replies = [thinking]
    return state


def cli_task(agent, background, monkeypatch, tmp_path, *, reads=False, way="answered"):
    """A Claude Code task at work (`started`) until `release`. One that `reads` then calls a tool of Raphael's, whose result
    carries what the owner wrote meanwhile (`results`), and works on until `finish`; any other ends with its answer and no
    further call, so that its model never reads those words (one "handed off" handed work to a colleague first)."""
    state = SimpleNamespace(started=asyncio.Event(), release=asyncio.Event(), finish=asyncio.Event(), results=[])

    class Driver:
        def __init__(self, *args, **kwargs):
            pass

        async def interrupt(self):
            pass

        async def run(self, **kwargs):
            loop = next(iter(background.service._cli_loops.values()))
            if way == "handed off" and not state.started.is_set():
                async def handoff(identifier, name, arguments):
                    return ToolOutcome(True, "handoff", '{"task_id": 99, "state": "queued"}')
                loop.execute = handoff
                await loop._tool("h1", "handoff", {"member_id": 1, "request": "Draft the poster", "stage_id": "poster",
                                                   "done_when": "A draft exists"})
            state.started.set()
            await state.release.wait()
            if reads:
                async def execute(identifier, name, arguments):
                    return ToolOutcome(True, content="12:00")
                loop.execute = execute
                state.results.append(await loop._tool("t1", "local_time", {}))
                await state.finish.wait()
            yield Event("final", "The visit is planned.")

    monkeypatch.setattr(cli, "Driver", Driver)
    # The task's own model is the CLI; the conversation keeps its API model, which answers what the task gives back.
    brains = agent.service._cli_brains
    brains.home = tmp_path
    monkeypatch.setattr(brains, "command", lambda name: ["fake"])
    monkeypatch.setattr(brains, "available", lambda *a, **k: True)
    background.service.use_cli(brains)
    return state


@pytest.mark.parametrize(("brain", "way"), [("api", "failed"), ("api", "stopped"), ("api", "asked the owner"),
                                            ("api", "worker gone"), ("cli", "answered"), ("cli", "stopped"),
                                            ("cli", "handed off")])
async def test_words_a_background_task_never_read_become_their_own_turn(wired, client, monkeypatch, tmp_path, brain, way):
    agent, background = wired
    state = api_task(background, way) if brain == "api" else cli_task(agent, background, monkeypatch, tmp_path, way=way)
    origin, task_id = start_task(agent, background, "fake/model" if brain == "api" else "cli:claude:fake")
    await asyncio.wait_for(state.started.wait(), 5)
    client.chats = [answer("Answer to B")]
    said = await asyncio.wait_for(typed(agent, "Request B"), 2)
    assert said["steered"] is True
    # Handed to the task, not read yet: held for it, and not settled.
    assert agent.service._inbox.get(said["turn_id"])["state"] == "steering"
    if way == "stopped":
        await background.rpc.call("worker.cancel", {"task_id": task_id})
    elif way == "worker gone":
        background.links.last.kill()
    state.release.set()
    await until(lambda: settled(agent, said["turn_id"]) and not agent.service._drains)
    if way != "handed off":  # a task that handed work off goes on once its colleague's answer is in
        assert background.task(task_id).state != "running"
    # Answered once, as a turn of its own; the task's model never had it.
    assert agent.service._inbox.get(said["turn_id"])["outcome"] == "completed"
    reply = agent.service.turn(said["turn_id"])
    assert (reply.status, reply.route, reply.text) == ("done", "answer", "Answer to B")
    assert len(client.chat_calls) == 1 and "Request B" in str(client.chat_calls[0]["messages"])
    assert "Request B" not in str(background.client.chat_calls)
    assert not background.service.words_held()
    if way == "asked the owner":
        # The task waits for its answer, and its card still does.
        assert [question["state"] for question in background.service.owner_questions.for_turn(origin)] == ["asked"]


@pytest.mark.parametrize("brain", ["api", "cli"])
async def test_words_a_background_task_reads_are_settled_once_and_a_restart_never_runs_them(wired, make_rig, client, monkeypatch,
                                                                                           tmp_path, brain):
    agent, background = wired
    if brain == "api":
        state = SimpleNamespace(started=asyncio.Event(), release=asyncio.Event(), finish=asyncio.Event(), read=asyncio.Event())

        async def thinking(**kwargs):
            state.started.set()
            await state.release.wait()
            return turn("Checking the time.", [call("local_time", {}, "t1")])

        async def reading(**kwargs):
            state.read.set()
            await state.finish.wait()
            return report("The visit is planned for noon.")

        background.client.replies = [thinking, reading]
    else:
        state = cli_task(agent, background, monkeypatch, tmp_path, reads=True)
    origin, task_id = start_task(agent, background, "fake/model" if brain == "api" else "cli:claude:fake")
    try:
        await asyncio.wait_for(state.started.wait(), 5)
        said = await asyncio.wait_for(typed(agent, "Request R"), 2)
        assert said["steered"] is True
        state.release.set()
        if brain == "api":
            await asyncio.wait_for(state.read.wait(), 5)
            assert "Request R" in str(background.client.chat_calls[1]["messages"])
        else:
            await until(lambda: state.results)
            assert "Request R" in state.results[0].content
        # The task still runs, and what its model read is settled already: a core that dies now cannot run it again.
        row = agent.service._inbox.get(said["turn_id"])
        assert (row["state"], row["outcome"]) == ("terminal", "steered")
        restarted = make_rig()
        assert restarted.service._inbox.get(said["turn_id"])["outcome"] == "steered"
        assert restarted.service.turn(said["turn_id"]).route == "owner_input"
        restarted.service.start()
        assert not restarted.service._drains
    finally:
        state.release.set()
        state.finish.set()
    await until(lambda: background.task(task_id).state == "done")
    await until(lambda: not agent.service._drains)
    # The task's end gives nothing back: the words were read, once, and never became a turn of their own.
    assert agent.service._inbox.get(said["turn_id"])["outcome"] == "steered"
    assert agent.service.turn(said["turn_id"]).route == "owner_input"
    assert client.chat_calls == []


async def test_a_task_waiting_for_a_yes_keeps_the_words_and_reads_them_when_it_goes_on(wired, client, plugins):
    agent, background = wired
    await plugins.connect(note="T2")
    started, release = asyncio.Event(), asyncio.Event()

    async def thinking(**kwargs):
        started.set()
        await release.wait()
        return turn("Noting it.", [use("Notes__note", {"text": "The visit"}, "c1")])

    background.client.replies = [thinking, report("Noted, for Monday.")]
    origin, task_id = start_task(agent, background)
    await asyncio.wait_for(started.wait(), 5)
    said = await asyncio.wait_for(typed(agent, "Make it Monday"), 2)
    assert said["steered"] is True
    release.set()
    await until(lambda: background.task(task_id).state == "waiting")
    # The task waits for the owner's yes and holds the words for when it goes on: they are not run, and they keep nothing
    # else of the conversation waiting.
    assert agent.service._inbox.get(said["turn_id"])["state"] == "steering"
    assert background.service.words_held() == {said["turn_id"]}
    client.chats = [answer("Answer to the other question")]
    other = await asyncio.wait_for(typed(agent, "Something else"), 5)
    assert other["text"] == "Answer to the other question"
    [question] = [params for method, params in background.notifications if method == "background.question"]
    await background.rpc.call("background.answer", {"task_id": task_id, "question_id": question["question_id"], "approved": True})
    await until(lambda: background.task(task_id).state == "done")
    # It went on with the words given to its model, which settled them then, once.
    assert "Make it Monday" in str(background.client.chat_calls[1]["messages"])
    assert agent.service._inbox.get(said["turn_id"])["outcome"] == "steered"
    assert agent.service.turn(said["turn_id"]).route == "owner_input"
    assert len(client.chat_calls) == 1 and not background.service.words_held()


async def test_send_now_takes_words_back_from_the_background_task_that_holds_them(wired, client):
    agent, background = wired
    started, release = asyncio.Event(), asyncio.Event()

    async def thinking(**kwargs):
        started.set()
        await release.wait()
        return report("The visit is planned.")

    background.client.replies = [thinking]
    origin, task_id = start_task(agent, background)
    await asyncio.wait_for(started.wait(), 5)
    client.chats = [answer("Answer to B")]
    said = await asyncio.wait_for(typed(agent, "Request B"), 2)
    assert said["steered"] is True
    sent = await agent.call("agent.history.send_now", {"session_id": "live", "member_id": 0, "turn_id": said["turn_id"]})
    assert sent == {"sent": True, "stopped": False}
    await until(lambda: settled(agent, said["turn_id"]) and not agent.service._drains)
    release.set()
    await until(lambda: background.task(task_id).state == "done")
    # Answered now as a turn of its own, and never by the task, which went on without it.
    assert agent.service._inbox.get(said["turn_id"])["outcome"] == "completed"
    assert agent.service.turn(said["turn_id"]).text == "Answer to B"
    assert "Request B" not in str(background.client.chat_calls)

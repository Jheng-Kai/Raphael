"""A task in a member's private conversation tells the owner how it goes (R-PROGRESS-01).

The owner's data, 2026-11-14: a hand-off task of 37 minutes and 71 calls on Claude Code wrote 142 steps and not one
message until he stopped it. Two minutes into a task with no message, then five minutes after the last, the next tool
result asks for a two-sentence update, and what the member writes next reaches the owner as a message through the task's
`_reply`, on an API brain and on a CLI brain. A routine (its owner reads only its last message) is asked for nothing.
"""

import json

import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.background.run import TaskRun
from raphael_core.messaging.words import plain_replies
from .conftest import Clock, call, report, turn, until

ASKED = "since you last told the owner anything"
UPDATE = "Two notes are read. Next I compare them with the plan."


def bodies(rig, turn_id):
    return plain_replies([row[0] for row in rig.conn.execute(
        "SELECT text FROM agent_messages WHERE turn_id=? AND kind='reply' ORDER BY seq", (turn_id,))])


def progress(rig):
    return [params["text"] for method, params in rig.notifications if method == "worker.progress"]


def kept_results(rig, turn_id):
    return " ".join(row[0] or "" for row in rig.conn.execute(
        "SELECT redacted_result FROM turn_tool_events WHERE turn_id=?", (turn_id,)))


def minutes(text):
    return int(text.split("It has been ", 1)[1].split(" minutes", 1)[0])


@pytest.mark.parametrize("routine", [False, True])
async def test_an_api_task_is_asked_for_a_word_and_its_update_reaches_the_owner(make_rig, monkeypatch, routine):
    clock = Clock()
    rig = make_rig(clock=clock)
    history = AgentHistory(rig.conn)
    turn_id = history.add(session_id="long", question="Read the notes", route="routine" if routine else "delegate",
                          prefix="", text="", status="running")
    # Each step takes this long, while the model waits for it.
    seconds = [60, 60, 30, 100, 100, 100]
    original = TaskRun.tool

    async def slow(run, params):
        clock.now += seconds.pop(0)
        return await original(run, params)

    monkeypatch.setattr(TaskRun, "tool", slow)
    told = []

    def step(number, content):
        def answer(**kwargs):
            last = kwargs["messages"][-1]
            told.append(last["content"] if last.get("role") == "tool" else "")
            return turn(content, [call("local_time", {"n": number}, f"call-{number}")])
        return answer

    def final(**kwargs):
        told.append(kwargs["messages"][-1]["content"])
        return report("The comparison is done.", prefix="Notice")

    rig.client.replies = [step(0, "I will read the notes one by one."), step(1, "The first note is read."),
                          step(2, UPDATE), step(3, "Comparing them."), step(4, "Still comparing."),
                          step(5, "Almost there."), final]
    routine_id = None
    if routine:
        from raphael_core.members.store import MemberStore
        routine_id = MemberStore(rig.conn, rig.wall).create_routine(
            member_id=0, title="Notes", prompt="Read the notes", schedule={"kind": "every", "hours": 1},
            next_run_ms=rig.wall.now).id
    task_id = rig.service.submit(session_id="long", language="en", text="Read the notes", model="fake/model",
                                 routine_id=routine_id)
    rig.service.attach_turn(task_id, turn_id)
    await until(lambda: rig.task(task_id).state in ("done", "failed"), timeout=15)
    assert rig.task(task_id).state == "done"
    if routine:
        assert not any(ASKED in text for text in told)
        assert bodies(rig, turn_id) == ["The comparison is done."]
        return
    # Results at 60, 120 (asked), 150, 250, 350 and 450 s (asked: five minutes after the update at 120).
    assert [ASKED in text for text in told] == [False, False, True, False, False, False, True]
    assert minutes(told[2]) == 2 and minutes(told[6]) == 5
    assert bodies(rig, turn_id) == [UPDATE, "The comparison is done."]
    assert any("first note" in line for line in progress(rig)) and any("Still comparing" in line for line in progress(rig))
    assert not any("compare them" in line for line in progress(rig))
    assert kept_results(rig, turn_id) and ASKED not in kept_results(rig, turn_id)


@pytest.mark.parametrize("brain", ["claude", "codex"])
async def test_a_cli_task_is_asked_for_a_word_and_its_update_reaches_reply(make_rig, monkeypatch, tmp_path, brain):
    from raphael_core.agent.cli.discovery import CliBrains
    from raphael_core.agent.cli.drivers import Driver, Event

    clock = Clock()
    rig = make_rig(clock=clock)
    brains = CliBrains(home=tmp_path, environ={})
    monkeypatch.setattr(brains, "command", lambda name: ["fake"])
    monkeypatch.setattr(brains, "available", lambda *args, **kwargs: True)
    rig.service.use_cli(brains)
    history = AgentHistory(rig.conn)
    turn_id = history.add(session_id="cli", question="Read the notes", route="delegate", prefix="", text="",
                          status="running")
    steps = [("I will read the notes one by one.", 70), ("The first note is read.", 70), (UPDATE, 30)]
    results = []
    task = {}

    async def run(driver, **kwargs):
        loop = rig.service._cli_loops[task["id"]]
        for index, (speech, seconds) in enumerate(steps):
            yield Event("text_delta", speech)
            yield Event("message", speech, data={"id": f"said-{index}"})
            yield Event("tool_start", data={"id": str(index), "name": "local_time"})
            clock.now += seconds
            results.append((await loop._tool(f"call-{index}", "local_time", {"n": index})).content)
            yield Event("tool_end", data={"id": str(index), "ok": True})
        yield Event("message", "The comparison is done.", data={"id": "answer", "final": True})
        yield Event("final", "The comparison is done.")

    monkeypatch.setattr(Driver, "run", run)
    task["id"] = rig.service.submit(session_id="cli", language="en", text="Read the notes", model=f"cli:{brain}:fake")
    rig.service.attach_turn(task["id"], turn_id)
    try:
        await until(lambda: rig.task(task["id"]).state in ("done", "failed"), timeout=15)
        assert rig.task(task["id"]).state == "done"
        assert [ASKED in text for text in results] == [False, True, False]
        assert bodies(rig, turn_id) == [UPDATE, "The comparison is done."]
        assert any("first note" in line for line in progress(rig))
        assert not any("compare them" in line for line in progress(rig))
        assert kept_results(rig, turn_id) and ASKED not in kept_results(rig, turn_id)
    finally:
        await brains.aclose()

"""Background and routine replies use the existing live turn/message notifications."""

import json

import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.messaging.words import plain_replies
from .conftest import call, turn


def bodies(rig, turn_id):
    return plain_replies([row[0] for row in rig.conn.execute(
        "SELECT text FROM agent_messages WHERE turn_id=? AND kind='reply' ORDER BY seq", (turn_id,))])


@pytest.mark.parametrize("routine", [False, True])
async def test_background_replies_arrive_before_each_tool_and_do_not_repeat_at_the_end(make_rig, routine):
    rig = make_rig()
    history = AgentHistory(rig.conn)
    turn_id = history.add(session_id="live", question="Prepare it", route="routine" if routine else "delegate",
                          prefix="", text="", status="running")
    words = ["I will prepare the template.", "I found one reusable memory.", "The template is ready."]
    seen = []
    states = []
    original = rig.service._notify
    def notify(method, data):
        original(method, data)
        if method == "agent.turn" and data["turn_id"] == turn_id:
            current = bodies(rig, turn_id)
            if current and (not seen or seen[-1] != current):
                states.append(history.get(turn_id).status)
                seen.append(current)
    rig.service._notify = notify
    async def second(**kwargs):
        assert bodies(rig, turn_id) == words[:1]
        return turn(words[1], [call("local_time", {}, "two")])
    async def final(**kwargs):
        assert bodies(rig, turn_id) == words[:2]
        return turn(json.dumps({"prefix": "Notice", "messages": words, "detail": "Receipt"}))
    rig.client.replies = [turn(words[0], [call("local_time", {}, "one")]), second, final]
    from raphael_core.members.store import MemberStore
    routine_id = MemberStore(rig.conn, rig.wall).create_routine(
        member_id=0, title="Prepare", prompt="Prepare it", schedule={"kind": "every", "hours": 1},
        next_run_ms=rig.wall.now).id if routine else None
    task_id = rig.service.submit(session_id="live", language="en", text="Prepare it", model="fake/model", routine_id=routine_id)
    rig.service.attach_turn(task_id, turn_id)
    from .conftest import until
    await until(lambda: rig.task(task_id).state in ("done", "failed"), timeout=15)
    assert rig.task(task_id).state == "done"
    assert bodies(rig, turn_id) == words
    assert seen == [words[:1], words[:2], words]
    assert states == ["running"] * 3
    assert rig.task(task_id).report_text == "\n\n".join(words)
    assert rig.service.final_words(task_id) == words


async def test_a_failed_tool_keeps_the_first_message(make_rig, monkeypatch):
    rig = make_rig()
    history = AgentHistory(rig.conn)
    turn_id = history.add(session_id="fail", question="Check", route="delegate", prefix="", text="", status="running")
    async def fail(run, params):
        assert bodies(rig, turn_id) == ["I will check it."]
        return {"ok": False, "kind": "tool_broken", "content": "RAW PRIVATE TOOL FAILURE"}
    from raphael_core.background.run import TaskRun
    monkeypatch.setattr(TaskRun, "tool", fail)
    rig.client.replies = [turn("I will check it.", [call("local_time", {}, "one")]), turn("The check failed.")]
    task_id = rig.service.submit(session_id="fail", language="en", text="Check", model="fake/model")
    rig.service.attach_turn(task_id, turn_id)
    await rig.wait_for_reports(timeout=15)
    assert bodies(rig, turn_id)[0] == "I will check it."
    assert "RAW PRIVATE TOOL FAILURE" not in " ".join(bodies(rig, turn_id))


@pytest.mark.parametrize("brain", ["codex", "claude", "gemini"])
async def test_background_cli_publishes_each_complete_message(make_rig, monkeypatch, tmp_path, brain):
    from raphael_core.agent.cli.discovery import CliBrains
    from raphael_core.agent.cli.drivers import Driver, Event
    from .conftest import until
    rig = make_rig()
    brains = CliBrains(home=tmp_path, environ={})
    monkeypatch.setattr(brains, "command", lambda name: ["fake"])
    monkeypatch.setattr(brains, "available", lambda *args, **kwargs: True)
    rig.service.use_cli(brains)
    history = AgentHistory(rig.conn)
    turn_id = history.add(session_id="cli", question="Prepare", route="delegate", prefix="", text="", status="running")
    words = ["I will prepare it.", "I found the reusable part.", "It is ready."]
    async def run(driver, **kwargs):
        for index, word in enumerate(words):
            yield Event("text_delta", word)
            yield Event("message", word, data={"id": str(index)})
            assert bodies(rig, turn_id) == words[:index + 1]
            assert history.get(turn_id).status == "running"
            if index < 2:
                yield Event("tool_start", data={"id": str(index), "name": "local_time"})
                yield Event("tool_end", data={"id": str(index), "ok": True})
        yield Event("final", words[-1])
    monkeypatch.setattr(Driver, "run", run)
    task_id = rig.service.submit(session_id="cli", language="en", text="Prepare", model=f"cli:{brain}:fake")
    rig.service.attach_turn(task_id, turn_id)
    try:
        await until(lambda: rig.task(task_id).state in ("done", "failed"), timeout=15)
        assert rig.task(task_id).state == "done"
        assert bodies(rig, turn_id) == words
    finally:
        await brains.aclose()


@pytest.mark.parametrize("reason", ["cancelled", "invalidated", "cleared"])
async def test_a_late_background_reply_cannot_revive_a_stopped_generation(make_rig, reason):
    from raphael_core.agent.answers import Reply
    rig = make_rig()
    history = AgentHistory(rig.conn)
    turn_id = history.add(session_id="late", question="Check", route="delegate", prefix="", text="", status="running")
    task_id = rig.service.submit(session_id="late", language="en", text="Check", model="fake/model")
    rig.service.attach_turn(task_id, turn_id)
    task = rig.task(task_id)
    rig.service._reply(task, Reply("Notice", "Already sent.", None))
    assert bodies(rig, turn_id) == ["Already sent."]
    if reason == "cancelled":
        await rig.service.cancel_session("late")
    elif reason == "invalidated":
        rig.service._store.invalidate_tree(task_id)
    else:
        history.delete(turn_id)
    rig.service._reply(task, Reply("Notice", "LATE", None))
    assert "LATE" not in " ".join(bodies(rig, turn_id))

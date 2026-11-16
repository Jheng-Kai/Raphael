"""What a member says while a task works is in the language the owner writes (R-LANG-05).

A turn of the owner's conversation held its member's notes between tool calls to the owner's language; the task a turn
hands on to its member's own background work did not, on an API brain or on a CLI brain, so the notes of a task reached a
Chinese owner in English."""

import json

import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.messaging.words import plain_replies
from .conftest import Clock, call, report, turn, until

ENGLISH = "I will read the notes one by one."
CHINESE = "我先把筆記一份一份讀過"


def progress(rig):
    return [params["text"] for method, params in rig.notifications if method == "worker.progress"]


def spoken(rig, turn_id):
    return plain_replies([row[0] for row in rig.conn.execute(
        "SELECT text FROM agent_messages WHERE turn_id=? AND kind='reply' ORDER BY seq", (turn_id,))])


def owner_turn(rig, question):
    return AgentHistory(rig.conn).add(session_id="long", question=question, route="delegate", prefix="", text="",
                                      status="running", source="app")


@pytest.mark.parametrize("question,hidden,shown", [
    ("幫我把筆記讀過一遍，再告訴我重點", ENGLISH, CHINESE),
    ("Read the notes one by one and tell me the gist", CHINESE, ENGLISH),
])
async def test_an_api_tasks_notes_in_another_language_are_not_shown_and_its_report_is(make_rig, question, hidden, shown):
    rig = make_rig(clock=Clock())
    turn_id = owner_turn(rig, question)
    rig.client.replies = [
        lambda **kwargs: turn(hidden, [call("local_time", {"n": 0}, "call-0")]),
        lambda **kwargs: turn(shown, [call("local_time", {"n": 1}, "call-1")]),
        lambda **kwargs: report("The notes are read.", prefix="Notice"),
    ]
    task_id = rig.service.submit(session_id="long", language="en", text=question, model="fake/model")
    rig.service.attach_turn(task_id, turn_id)
    await until(lambda: rig.task(task_id).state in ("done", "failed"), timeout=15)
    assert rig.task(task_id).state == "done"
    assert any(shown in line for line in progress(rig)) and not any(hidden in line for line in progress(rig))
    assert spoken(rig, turn_id)[-1] == "The notes are read."  # the report is never held back


async def test_a_task_of_a_conversation_whose_language_is_not_known_holds_nothing_back(make_rig):
    rig = make_rig(clock=Clock())
    turn_id = owner_turn(rig, "ok")
    rig.client.replies = [lambda **kwargs: turn(ENGLISH, [call("local_time", {"n": 0}, "call-0")]),
                          lambda **kwargs: report("Done.", prefix="Notice")]
    task_id = rig.service.submit(session_id="long", language="en", text="ok", model="fake/model")
    rig.service.attach_turn(task_id, turn_id)
    await until(lambda: rig.task(task_id).state in ("done", "failed"), timeout=15)
    assert any(ENGLISH in line for line in progress(rig))


async def test_a_cli_tasks_notes_are_held_to_the_owners_language_too(make_rig, monkeypatch, tmp_path):
    from raphael_core.agent.cli.discovery import CliBrains
    from raphael_core.agent.cli.drivers import Driver, Event

    rig = make_rig(clock=Clock())
    brains = CliBrains(home=tmp_path, environ={})
    monkeypatch.setattr(brains, "command", lambda name: ["fake"])
    monkeypatch.setattr(brains, "available", lambda *args, **kwargs: True)
    rig.service.use_cli(brains)
    question = "幫我把筆記讀過一遍，再告訴我重點"
    turn_id = owner_turn(rig, question)
    task = {}

    async def run(driver, **kwargs):
        loop = rig.service._cli_loops[task["id"]]
        assert loop.owner_language == "zh-TW"
        for index, speech in enumerate((ENGLISH, CHINESE)):
            yield Event("text_delta", speech)
            yield Event("message", speech, data={"id": f"said-{index}"})
            yield Event("tool_start", data={"id": str(index), "name": "local_time"})
            await loop._tool(f"call-{index}", "local_time", {"n": index})
            yield Event("tool_end", data={"id": str(index), "ok": True})
        yield Event("message", "筆記讀完了。", data={"id": "answer", "final": True})
        yield Event("final", "筆記讀完了。")

    monkeypatch.setattr(Driver, "run", run)
    task["id"] = rig.service.submit(session_id="long", language="en", text=question, model="cli:claude:fake")
    rig.service.attach_turn(task["id"], turn_id)
    await until(lambda: rig.task(task["id"]).state in ("done", "failed"), timeout=15)
    assert rig.task(task["id"]).state == "done"
    shown = progress(rig) + spoken(rig, turn_id)
    assert not any("notes one by one" in line for line in shown) and any(CHINESE in line for line in shown)
    assert spoken(rig, turn_id)[-1] == "筆記讀完了。"

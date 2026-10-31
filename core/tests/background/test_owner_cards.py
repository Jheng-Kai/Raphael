"""Owner questions use the real worker loop with fake models and durable waits."""
from dataclasses import replace

import pytest

from raphael_core.background.snapshot import take_snapshot
from raphael_core.agent.history import AgentHistory
from raphael_core.agent.tools import ToolResult

from .conftest import call, report, turn, until


def test_background_offers_owner_cards_without_desktop_tools():
    names = set(take_snapshot(None, "help").refs)
    assert {"ask_owner", "connect_app", "request_secret", "email_draft", "show_page", "update_page", "routine_list", "routine_create"} <= names
    assert not names & {"computer", "open", "copy_text", "launch_app"}


@pytest.mark.parametrize("routine", [False, True])
@pytest.mark.parametrize("answer", ["Tuesday", None])
async def test_question_wait_releases_slot_and_resumes_once(make_rig, routine, answer):
    rig = make_rig()
    assert hasattr(rig.service, "owner_questions")
    history = AgentHistory(rig.conn, rig.wall)
    turn_id = history.add(session_id="s1", question="Schedule it", route="routine" if routine else "delegate",
                          prefix="", text="", status="running", source="routine" if routine else "app")
    rig.client.replies = [turn("Which day?", [call("ask_owner", {"question": "Which day?", "options": ["Monday", "Tuesday"]}, "ask1")])]
    task_id = rig.service.submit(session_id="s1", text="Schedule it", language="en", model="fake/model", routine_id=1 if routine else None)
    rig.service.attach_turn(task_id, turn_id)
    await until(lambda: rig.task(task_id).state == "waiting")
    await until(lambda: task_id not in rig.service._active)
    [question] = rig.service.owner_questions.for_turn(turn_id)
    assert question["task_id"] == task_id
    assert rig.task(task_id).continuation
    assert rig.service.waiting_members() == {0}
    # Another job can use the same member's slot while the owner decides.
    rig.client.replies = [report("Other work done.")]
    rig.submit("Other work")
    await rig.wait_for_reports()
    rig.client.replies = [report("Answered." if answer else "Cancelled; no guess made.")]
    params = {"id": question["id"], "answer": answer}
    await rig.rpc.call("owner_questions.answer", params)
    await until(lambda: rig.task(task_id).state == "done")
    result = rig.client.chat_calls[-1]["messages"][-1]
    assert result["role"] == "tool" and result["tool_call_id"] == "ask1"
    assert (answer or "cancelled") in result["content"]
    count = len(rig.client.chat_calls)
    await rig.rpc.call("owner_questions.answer", params)
    assert len(rig.client.chat_calls) == count


async def test_restart_keeps_question_and_never_runs_until_answered(make_rig):
    rig = make_rig()
    assert hasattr(rig.service, "owner_questions")
    history = AgentHistory(rig.conn, rig.wall)
    origin = history.add(session_id="s1", question="Choose", route="delegate", prefix="", text="", status="running")
    rig.client.replies = [turn("Your choice?", [call("ask_owner", {"question": "Which?"}, "a")])]
    task_id = rig.submit()
    rig.service.attach_turn(task_id, origin)
    await until(lambda: rig.task(task_id).state == "waiting")
    await rig.service.aclose()
    restarted = make_rig()
    assert restarted.task(task_id).state == "waiting"
    restarted.service.recover_owner_waits()
    assert restarted.task(task_id).state == "waiting" and not restarted.client.chat_calls
    [question] = restarted.service.owner_questions.for_turn(origin)
    restarted.client.replies = [report("Continued after restart.")]
    await restarted.rpc.call("owner_questions.answer", {"id": question["id"], "answer": "Blue"})
    await restarted.wait_for_reports()
    assert "Blue" in restarted.client.chat_calls[-1]["messages"][-1]["content"]


@pytest.mark.parametrize("name", ["connect_app", "request_secret", "email_draft", "show_page"])
async def test_existing_background_card_waits_for_its_real_outcome(make_rig, name):
    rig = make_rig()
    assert hasattr(rig.service, "use_owner_tools")
    origin = AgentHistory(rig.conn, rig.wall).add(session_id="s1", question="Do it", route="delegate", prefix="", text="", status="running")
    shown = []

    async def owner_tool(task, tool, args):
        shown.append((task.turn_id, task.member_id, tool))
        return ToolResult(tool, True, {"owner_card": {"kind": tool, "id": "existing-card"}})

    rig.service.use_owner_tools(owner_tool)
    rig.client.replies = [turn("Please finish the card.", [call(name, {}, "card1")])]
    task_id = rig.submit()
    rig.service.attach_turn(task_id, origin)
    await until(lambda: rig.task(task_id).state == "waiting")
    assert shown == [(origin, 0, name)]
    [wait] = rig.service.owner_questions.for_turn(origin)
    rig.client.replies = [report("The owner finished.")]
    rig.service.owner_questions.settle(wait["id"], {"state": "completed"})
    await rig.wait_for_reports()
    assert "completed" in rig.client.chat_calls[-1]["messages"][-1]["content"]


async def test_room_consultation_never_reads_private_turns(make_rig):
    rig = make_rig()
    AgentHistory(rig.conn, rig.wall).add(session_id="private", question="A private fact", route="answer",
                                      prefix="", text="Private answer", status="done")
    rig.client.replies = [report("Finished.")]
    task_id = rig.submit()
    task = replace(rig.task(task_id), scope="room", mode="consult")
    assert rig.service._context(task) == []
    await rig.wait_for_reports()


async def test_room_question_is_projected_before_task_finishes(make_rig):
    from .test_handoff import setup, args
    from raphael_core.agent.speaker import RAPHAEL
    rig = make_rig()
    target, source = setup(rig)
    rig.client.replies = [turn("Owner decision needed.", [call("ask_owner", {"question": "Which day?"}, "room-q")])]
    accepted = rig.service.handoff(RAPHAEL, args(target, mode="consult"), source_turn_id=source.id, language="en")
    task_id = accepted.data["task_id"]
    await until(lambda: rig.task(task_id).state == "waiting")
    task = rig.task(task_id)
    row = rig.conn.execute("SELECT * FROM room_messages WHERE turn_id=?", (task.turn_id,)).fetchone()
    assert row is not None and row["room_id"] == source.room_id and row["member_id"] == target.id
    [question] = rig.service.owner_questions.for_turn(task.turn_id)
    rig.client.replies = [report("Tuesday confirmed.")]
    await rig.rpc.call("owner_questions.answer", {"id": question["id"], "answer": "Tuesday"})
    await until(lambda: rig.task(task_id).state == "done")
    rows = rig.conn.execute("SELECT * FROM room_messages WHERE turn_id=?", (task.turn_id,)).fetchall()
    assert len(rows) == 1 and rows[0]["text"] == "Tuesday confirmed."


async def test_only_one_pending_question_and_stop_never_resumes_it(make_rig):
    rig = make_rig()
    origin = AgentHistory(rig.conn).add(session_id="s1", question="Choose", route="delegate", prefix="", text="", status="running")
    rig.client.replies = [turn("Choose.", [call("ask_owner", {"question": "Which?"}, "a")])]
    task_id = rig.submit()
    rig.service.attach_turn(task_id, origin)
    await until(lambda: rig.task(task_id).state == "waiting")
    [first] = rig.service.owner_questions.for_turn(origin)
    second = rig.service.owner_questions.open(rig.task(task_id), "ask_owner", {"question": "Another?"})
    assert second["id"] == first["id"]
    await rig.service._cancel({"task_id": task_id})
    assert rig.task(task_id).state == "cancelled"
    assert rig.service.owner_questions.get(first["id"])["state"] == "cancelled"
    await rig.rpc.call("owner_questions.answer", {"id": first["id"], "answer": "late"})
    assert rig.task(task_id).state == "cancelled" and len(rig.client.chat_calls) == 1


@pytest.mark.parametrize("remove", ["task", "turn"])
async def test_deleting_task_or_turn_removes_its_question_payload(make_rig, remove):
    rig = make_rig()
    origin = AgentHistory(rig.conn).add(session_id="s1", question="Choose", route="delegate", prefix="", text="", status="running")
    rig.client.replies = [turn("Choose.", [call("ask_owner", {"question": "Owner-only detail"}, "a")])]
    task_id = rig.submit()
    rig.service.attach_turn(task_id, origin)
    await until(lambda: rig.task(task_id).state == "waiting")
    [question] = rig.service.owner_questions.for_turn(origin)
    if remove == "task":
        rig.service._store.delete(task_id)
    else:
        AgentHistory(rig.conn).delete(origin)
    assert rig.service.owner_questions.get(question["id"]) is None

"""Tests for a task that was interrupted (told once, in the conversation view too), the rerun of a task
that did not finish, and the cost one task may spend (a setting)."""

import asyncio
import json

import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.agent.persona import phrase
from raphael_core.background.run import RunLimits
from raphael_core.background.service import _prompts
from raphael_core.background.tasks import Refused
from raphael_core.brain.settings import SettingsStore
from raphael_core.protocol import INVALID_PARAMS, NOT_FOUND, RpcError

from .conftest import ARGUMENT, TASK_TEXT, call, report, turn, until, use


def hand_over(rig, conn, *, language="en", source="voice", text=TASK_TEXT):
    """A task and the turn of the history that handed it over, as the fast tier would write them."""
    history = AgentHistory(conn, rig.wall)
    turn_id = history.add(
        session_id="s1", question=text, route="delegate", prefix="Understood",
        text=phrase(language, "handoff"), status="done", source=source,
    )  # fmt: skip
    task_id = rig.submit(text, language=language)
    rig.service.attach_turn(task_id, turn_id)
    return task_id, turn_id, history


# --- interrupted tasks are told ---------------------------------------------------------------------


@pytest.mark.parametrize("ending", ["the app closed", "the core was killed"])
async def test_a_room_hand_off_the_end_of_the_core_cut_off_is_told_in_the_room_once(make_rig, ending):
    """A member's work for a room was under way when the core ended. Killed, the next start told the room it was interrupted;
    closed the ordinary way, it wrote no result, and the room never heard of the work again."""
    from raphael_core.agent.speaker import RAPHAEL
    from .test_handoff import args, setup, team_of, unused

    rig = make_rig()
    target, source = setup(rig)
    started = asyncio.Event()

    async def slow(**kwargs):
        started.set()
        await asyncio.sleep(30)

    rig.client.replies.append(slow)
    task_id = rig.service.handoff(RAPHAEL, args(target, mode="consult"), source_turn_id=source.id, language="en").data["task_id"]
    await asyncio.wait_for(started.wait(), 5)
    if ending == "the app closed":
        await rig.service.aclose()
    else:
        rig.service._closing = True  # nothing more is written: the rows stay as the process left them
    later = make_rig()
    later.service.use_team(team_of(target), unused)
    assert later.task(task_id).state == "interrupted"
    told = rig.conn.execute("SELECT member_id, text FROM room_messages WHERE request_id=?", (f"handoff-{task_id}",)).fetchall()
    assert [tuple(row) for row in told] == [(target.id, phrase("en", "worker_interrupted", steps="0"))]
    later.service._deliver_handoffs()
    assert rig.conn.execute("SELECT COUNT(*) FROM room_messages WHERE request_id=?", (f"handoff-{task_id}",)).fetchone()[0] == 1




async def test_restart_closes_legacy_queued_and_interrupted_turns(make_rig, conn):
    first = make_rig()
    queued, queued_turn, history = hand_over(first, conn)
    lost, lost_turn, _ = hand_over(first, conn)
    history.resolve(lost_turn, prefix="", text="", status="running")
    first.service._store.finish_interrupted(lost, prefix="", text="", reason="restart")
    first.service._queue.clear()
    second = make_rig()
    assert second.task(queued).state == "interrupted" and second.task(queued).reason == "restart"
    for turn in (queued_turn, lost_turn):
        assert history.get(turn).status == "error" and "interrupted" in history.get(turn).text


async def test_a_lost_worker_closes_its_task_with_a_reason(make_rig, conn, monkeypatch):
    rig = make_rig()
    blocked = asyncio.Event()
    async def lost(task, files):
        rig.service._store.start(task.id)
        await blocked.wait()
    monkeypatch.setattr(rig.service, "_execute", lost)
    task, turn, history = hand_over(rig, conn)
    await until(lambda: rig.task(task).state == "running")
    rig.service._active[task][0].cancel()
    await until(lambda: rig.task(task).state == "interrupted")
    assert rig.task(task).reason == "worker_lost" and history.get(turn).status == "error"


async def test_tasks_left_unfinished_get_a_report_and_their_turn_is_completed(make_rig, conn):
    first = make_rig()
    running, running_turn, history = hand_over(first, conn, language="zh-TW")
    queued, _, _ = hand_over(first, conn, language="en")
    first.service._store.start(running)
    first.service._store.add_step(running, kind="model", outcome="ok")
    first.service._store.add_step(running, kind="tool", outcome="ok", tool="look", server="Notes")
    first.service._queue.clear()
    second = make_rig()  # the next run of the core
    task = second.task(running)
    assert (task.state, task.reason, task.announced) == ("interrupted", "restart", 0)
    assert task.report_prefix == "告"
    assert task.report_text == phrase("zh-TW", "worker_interrupted", steps="1")
    assert second.task(queued).report_text == phrase("en", "worker_interrupted", steps="0")
    turn_row = history.get(running_turn)
    assert turn_row.text == task.report_text and turn_row.prefix == "告"
    assert turn_row.status == "error" and turn_row.text != phrase("zh-TW", "handoff")
    assert second.notifications == []  # said only once the app has said hello


@pytest.mark.parametrize("enabled", [False, True])
async def test_only_the_newest_interrupted_report_is_said_and_only_once(make_rig, conn, enabled):
    first = make_rig()
    older, _, _ = hand_over(first, conn)
    newer, _, _ = hand_over(first, conn)
    first.service._queue.clear()
    second = make_rig()
    SettingsStore(conn).set("raphael_notify", enabled)
    second.service.announce_pending()
    assert second.reports() == [
        {
            "task_id": newer,
            "state": "interrupted",
            "notify": enabled,
            "prefix": "Notice",
            "text": phrase("en", "worker_interrupted", steps="0"),
        }
    ]
    assert second.task(older).announced == 1 and second.task(newer).announced == 1
    second.service.announce_pending()
    assert len(second.reports()) == 1  # not again
    third = make_rig()
    third.service.announce_pending()
    assert third.reports() == []


async def test_closing_the_core_tells_the_task_that_ran_and_the_one_that_waited(
    make_rig, conn, calls
):
    rig = make_rig()
    await rig.plugins.connect(slow="T0")
    rig.client.replies = [turn("", [use("Notes__slow", {}, "c1")])]
    running, running_turn, history = hand_over(rig, conn, language="ja")
    waiting, waiting_turn, _ = hand_over(rig, conn, language="ja")
    await until(lambda: "slow" in calls)
    await asyncio.wait_for(rig.service.aclose(), 10)
    for task_id in (running, waiting):
        task = rig.task(task_id)
        assert task.state == "interrupted" and task.announced == 0
        assert task.report_prefix == "告" and task.report_text
    assert rig.task(running).reason == "closing"
    assert rig.task(running).report_text == phrase("ja", "worker_interrupted", steps="1")
    assert history.get(running_turn).text == rig.task(running).report_text
    assert history.get(waiting_turn).status == "error"
    assert rig.reports() == []
    # the next run says the newest
    after = make_rig()
    after.service.announce_pending()
    assert [r["task_id"] for r in after.reports()] == [waiting]


# --- rerun --------------------------------------------------------------------------------------------


def finish(rig, task_id, state, reason=None):
    rig.service._store.finish(task_id, state, prefix="告", text="x", detail=None, reason=reason)


@pytest.mark.parametrize("state", ["interrupted", "cancelled", "limit", "failed"])
async def test_a_task_that_did_not_finish_can_be_run_again(make_rig, conn, state):
    rig = make_rig()
    rig.service._closing = True  # the first task is not started: it ends the way the test says
    old, old_turn, history = hand_over(rig, conn, source="telegram")
    rig.service._queue.clear()
    rig.service._closing = False
    finish(rig, old, state, "x")
    rig.client.replies = [report("Second time.")]
    result = await rig.rpc.call("worker.rerun", {"task_id": old})
    new = result["task_id"]
    assert new != old and rig.task(new).rerun_of == old
    [done] = await rig.wait_for_reports()
    assert (done["task_id"], done["text"]) == (new, "Second time.")
    new_turn = rig.task(new).turn_id
    assert new_turn and new_turn != old_turn
    turn_row = history.get(new_turn)
    assert (turn_row.route, turn_row.source, turn_row.question, turn_row.session_id) == (
        "delegate", "telegram", TASK_TEXT, "s1",
    )  # fmt: skip
    assert turn_row.text == "Second time."  # completed by the report like any other
    assert rig.task(new).text == TASK_TEXT and rig.task(new).session_id == "s1"


@pytest.mark.parametrize("state", ["interrupted", "cancelled", "limit", "failed"])
async def test_the_failed_message_of_a_task_leaves_the_history_when_it_is_run_again(make_rig, conn, state):
    """The retry icon under a failed hand-off left the failure where it was and drew the new attempt below it: the message
    of the attempt it replaces is taken out of the stored history, and told as when a turn is deleted."""
    rig = make_rig()
    rig.service._closing = True
    old, old_turn, history = hand_over(rig, conn)
    rig.service._queue.clear()
    rig.service._closing = False
    finish(rig, old, state, "x")
    rig.client.replies = [report("Second time.")]
    rig.notifications.clear()
    new = (await rig.rpc.call("worker.rerun", {"task_id": old}))["task_id"]
    assert history.get(old_turn) is None
    assert ("agent.turn", {"turn_id": old_turn, "member_id": 0, "failure": None}) in rig.notifications
    await rig.wait_for_reports()
    assert history.get(rig.task(new).turn_id).text == "Second time."
    assert [row[0] for row in conn.execute("SELECT id FROM agent_turns WHERE session_id='s1'")] == [rig.task(new).turn_id]


async def test_a_task_run_again_keeps_everything_the_owner_sent(make_rig, conn):
    """The new attempt's turn repeated `old.text`, the expanded instruction, with no quote and no files, and once the old turn
    was gone the conversation could not find the file again: it carries the message as it was sent."""
    from raphael_core.agent.attachment_inputs import earlier_files

    rig = make_rig()
    history = AgentHistory(conn, rig.wall)
    quote = {"text": "the total is wrong", "author": "Raphael"}
    files = [{"name": "invoice.pdf", "mime": "application/pdf", "id": "stored-invoice", "size": 12}]
    rig.service._closing = True
    turn_id = history.add(session_id="s1", question="/review this file", route="delegate", prefix="Understood", text=phrase("en", "handoff"),
                          status="done", source="app", quote=quote, attachments=files)
    old = rig.submit("Review the attached file and list what is wrong.")
    rig.service.attach_turn(old, turn_id)
    rig.service._queue.clear()
    rig.service._closing = False
    finish(rig, old, "failed", "x")
    rig.client.replies = [report("Again.")]
    new = (await rig.rpc.call("worker.rerun", {"task_id": old}))["task_id"]
    row = history.get(rig.task(new).turn_id)
    assert (row.question, row.quote, row.attachments) == ("/review this file", quote, files)
    assert earlier_files([row], []) == [{"name": "invoice.pdf", "mime": "application/pdf", "id": "stored-invoice"}]
    await rig.wait_for_reports()


async def test_the_worker_of_a_rerun_receives_the_files_of_the_original_hand_off(make_rig, conn, tmp_path):
    """Only the screen showed the file again: the new task was handed no attachment, and with the old turn gone nothing else
    held it, so the worker could not see the file the owner attached."""
    from raphael_core.services.attachment_store import AttachmentStore
    from raphael_core.services.attachments import checked

    rig = make_rig()
    store = AttachmentStore(tmp_path / "attachments")
    rig.service.use_attachment_store(store)
    history = AgentHistory(conn, rig.wall)
    saved = store.save(checked("invoice.txt", "text/plain", b"INVOICE-TOTAL-4242"))
    rig.service._closing = True
    turn_id = history.add(session_id="s1", question="review invoice.txt", route="delegate", prefix="Understood", text=phrase("en", "handoff"),
                          status="done", source="app", attachments=[saved.metadata()])
    old = rig.submit("review invoice.txt")
    rig.service.attach_turn(old, turn_id)
    rig.service._queue.clear()
    rig.service._closing = False
    finish(rig, old, "failed", "x")
    rig.client.replies = [report("Reviewed.")]
    await rig.rpc.call("worker.rerun", {"task_id": old})
    await rig.wait_for_reports()
    assert "INVOICE-TOTAL-4242" in rig.client.chat_calls[0]["messages"][1]["content"]


async def test_a_rerun_waiting_for_its_files_starts_nothing_once_the_history_was_cleared(make_rig, conn):
    rig = make_rig()
    rig.service._closing = True
    old, old_turn, history = hand_over(rig, conn)
    rig.service._queue.clear()
    rig.service._closing = False
    finish(rig, old, "failed", "x")
    reading, release = asyncio.Event(), asyncio.Event()

    async def slow_read(origin):
        reading.set()
        await release.wait()
        return []

    rig.service._original_files = slow_read
    rig.client.replies = [report("Should never run.")]
    asked = asyncio.ensure_future(rig.service._rerun({"task_id": old}))
    await asyncio.wait_for(reading.wait(), 5)
    history.delete(old_turn)  # what a clear of the history and the tasks leaves
    rig.service._store.delete(old)
    release.set()
    with pytest.raises(RpcError) as error:
        await asked
    assert error.value.code == NOT_FOUND
    assert conn.execute("SELECT COUNT(*) FROM worker_tasks").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM agent_turns").fetchone()[0] == 0
    assert rig.client.chat_calls == []


async def test_a_rerun_waiting_for_its_files_starts_nothing_for_a_new_task_that_took_the_old_ids(make_rig, conn):
    """Once the rows were cleared a new task and turn can get the old ids again: they are another message's, not the one asked for."""
    rig = make_rig()
    rig.service._closing = True
    old, old_turn, history = hand_over(rig, conn)
    rig.service._queue.clear()
    finish(rig, old, "failed", "x")
    reading, release = asyncio.Event(), asyncio.Event()

    async def slow_read(origin):
        reading.set()
        await release.wait()
        return []

    rig.service._original_files = slow_read
    rig.client.replies = [report("Should never run.")]
    asked = asyncio.ensure_future(rig.service._rerun({"task_id": old}))
    await asyncio.wait_for(reading.wait(), 5)
    history.delete(old_turn)
    rig.service._store.delete(old)
    reused_turn = history.add(session_id="s2", question="another message", route="delegate", prefix="Understood", text=phrase("en", "handoff"),
                              status="done", source="voice")
    reused = rig.submit("another task")
    rig.service.attach_turn(reused, reused_turn)
    rig.service._queue.clear()
    finish(rig, reused, "failed", "x")
    assert (reused, reused_turn) == (old, old_turn), "the ids were handed out again"
    rig.service._closing = False
    release.set()
    with pytest.raises(RpcError) as error:
        await asked
    assert error.value.code == NOT_FOUND
    assert conn.execute("SELECT COUNT(*) FROM worker_tasks WHERE rerun_of IS NOT NULL").fetchone()[0] == 0
    assert rig.client.chat_calls == []


async def test_a_second_request_to_run_a_failed_task_again_starts_nothing(make_rig, conn):
    rig = make_rig()
    rig.service._closing = True
    old, old_turn, history = hand_over(rig, conn)
    rig.service._queue.clear()
    rig.service._closing = False
    finish(rig, old, "failed", "x")
    rig.client.replies = [report("Once.")]
    first = (await rig.rpc.call("worker.rerun", {"task_id": old}))["task_id"]
    with pytest.raises(RpcError) as error:
        await rig.rpc.call("worker.rerun", {"task_id": old})
    assert error.value.code == INVALID_PARAMS
    assert [row[0] for row in conn.execute("SELECT id FROM worker_tasks WHERE rerun_of=?", (old,))] == [first]
    assert [row[0] for row in conn.execute("SELECT id FROM agent_turns WHERE session_id='s1'")] == [rig.task(first).turn_id]
    await rig.wait_for_reports()


async def test_a_refused_rerun_keeps_the_failure_it_would_have_replaced(make_rig, conn):
    rig = make_rig()
    rig.service._closing = True
    old, old_turn, history = hand_over(rig, conn)
    rig.service._queue.clear()
    rig.service._closing = False
    finish(rig, old, "failed", "x")
    original = rig.service.submit

    def refuse(**_):
        raise Refused("worker_disabled")

    rig.service.submit = refuse
    with pytest.raises(RpcError):
        await rig.rpc.call("worker.rerun", {"task_id": old})
    rig.service.submit = original
    assert history.get(old_turn) is not None


@pytest.mark.parametrize("state", ["done", "queued", "running"])
async def test_a_task_that_finished_or_is_not_over_cannot_be_run_again(make_rig, conn, state):
    rig = make_rig()
    old = rig.submit()
    rig.service._queue.clear()
    if state == "done":
        finish(rig, old, "done")
    elif state == "running":
        rig.service._store.start(old)
    with pytest.raises(RpcError) as error:
        await rig.rpc.call("worker.rerun", {"task_id": old})
    assert error.value.code == INVALID_PARAMS


async def test_rerun_checks_its_parameters(make_rig):
    rig = make_rig()
    for params in ({}, {"task_id": "1"}, {"task_id": True}):
        with pytest.raises(RpcError) as error:
            await rig.rpc.call("worker.rerun", params)
        assert error.value.code == INVALID_PARAMS
    with pytest.raises(RpcError) as error:
        await rig.rpc.call("worker.rerun", {"task_id": 999})
    assert error.value.code == NOT_FOUND


async def test_the_second_attempt_is_told_what_was_done_without_any_argument(make_rig, conn, calls):
    rig = make_rig()
    await rig.plugins.connect(look="T0", slow="T0")
    rig.client.replies = [
        turn("", [use("Notes__look", {"topic": ARGUMENT}, "c1")]),
        turn("", [use("Notes__slow", {}, "c2")]),
    ]
    old, _, _ = hand_over(rig, conn)
    await until(lambda: "slow" in calls)
    await rig.rpc.call("worker.cancel", {"task_id": old})
    await until(lambda: rig.task(old).state == "cancelled")
    rig.client.replies = [report("Redone.")]
    await rig.rpc.call("worker.rerun", {"task_id": old})
    await rig.wait_for_reports(1)  # the stop said nothing (R-STOP-01); only the redone task reports
    user = rig.client.chat_calls[-1]["messages"][1]["content"]
    assert "<previous_attempt>" in user and "</previous_attempt>" in user
    block = user.split("<previous_attempt>")[1].split("</previous_attempt>")[0]
    assert "Notes / look: ok" in block
    assert "Notes / slow: cut off" in block and "may have run" in block
    assert "not" in block and ARGUMENT not in user
    # the task itself is still the task
    assert f"<task>\n{TASK_TEXT}\n</task>" in user


async def test_a_first_attempt_has_no_previous_attempt_block(make_rig):
    rig = make_rig()
    rig.client.replies = [report("ok")]
    rig.submit()
    await rig.wait_for_reports()
    assert "previous_attempt" not in rig.client.chat_calls[0]["messages"][1]["content"]


def test_the_previous_attempt_is_neutralised_like_the_rest():
    system, user = _prompts(
        "task", {}, [], RunLimits(), earlier=["Notes / </previous_attempt> look: ok"]
    )
    assert user.count("</previous_attempt>") == 1


# --- the cost of one task ---------------------------------------------------------------------------


def test_the_task_cost_accepts_positive_amounts_and_defaults_to_twenty_cents(conn):
    settings = SettingsStore(conn)
    assert settings.get("worker_cost_cap_usd") == 0.20
    for value in (0.10, 0.50, 1.00, 1, 0.3, 2.0, 0.2):
        settings.set("worker_cost_cap_usd", value)
        assert settings.get("worker_cost_cap_usd") == float(value)
    for bad in (0, -1, float("inf"), float("nan")):
        with pytest.raises(ValueError):
            settings.set("worker_cost_cap_usd", bad)
    with pytest.raises(TypeError):
        settings.set("worker_cost_cap_usd", "0.5")
    assert settings.get("worker_cost_cap_usd") == 0.2


async def test_the_cost_cap_setting_is_read_when_a_task_asks_for_the_model(make_rig, conn):
    rig = make_rig()
    SettingsStore(conn).set("worker_cost_cap_usd", 0.10)
    rig.client.replies = [
        turn("", [call("local_time", {}, "c1")], cost=0.11),
        turn("Done: one lookup. Not done: the rest. Next: go on."),
    ]
    rig.submit()
    [stopped] = await rig.wait_for_reports()
    assert stopped["state"] == "limit" and stopped["text"] == "Done: one lookup. Not done: the rest. Next: go on."
    assert len(rig.client.chat_calls) == 2
    SettingsStore(conn).set("worker_cost_cap_usd", 0.50)
    rig.client.replies = [turn("", [call("local_time", {}, "c2")], cost=0.11), report("fine")]
    rig.submit()
    done = (await rig.wait_for_reports(2))[1]
    assert done["state"] == "done" and done["text"] == "fine"
    assert json.dumps(rig.reports()).count(TASK_TEXT) == 0

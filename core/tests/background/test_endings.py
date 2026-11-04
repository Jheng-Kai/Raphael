"""Task endings retain explicit contracts and the work already recorded."""

import os
from pathlib import Path

import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.agent.speaker import RAPHAEL
from raphael_core.agent.steps import Step
from raphael_core.failures import classify

from .conftest import call, report, turn, until
from .test_handoff import args, setup


@pytest.mark.parametrize("condition", [
    "Review only, with file:line references.",
    "Do not change files or create an artifact.",
    "Read report.pdf and return a written review without changing it.",
])
async def test_read_only_work_does_not_infer_artifacts(make_rig, tmp_path, condition):
    rig = make_rig()
    rig.service._workspace_of = lambda member: tmp_path
    target, source = setup(rig)
    rig.client.replies.extend([turn(calls=[call("local_time", {})]), report("Review complete.")])
    receipt = rig.service.handoff(RAPHAEL, args(target, done_when=condition),
                                  source_turn_id=source.id, language="en")
    await until(lambda: rig.task(receipt.data["task_id"]).state in ("done", "failed"))
    assert rig.task(receipt.data["task_id"]).state == "done"


async def test_required_artifact_fails_even_without_workspace_or_receipts(make_rig):
    rig = make_rig()
    target, source = setup(rig)
    receipt = rig.service.handoff(RAPHAEL, args(target, requires_artifact=True),
                                  source_turn_id=source.id, language="en")
    assert receipt.ok
    task = rig.task(receipt.data["task_id"])
    assert task.requires_artifact
    assert rig.service._store.completion_reason(task, verifiable=False, said="Reviewed. " * 50) == "missing_artifact"


@pytest.mark.parametrize("location", ["condition", "report"])
@pytest.mark.parametrize("quoted", [False, True])
@pytest.mark.parametrize("filename", ["owner-output.md", "owner output.pdf", "README"])
async def test_named_owner_path_is_verified_from_bytes(make_rig, tmp_path, location, quoted, filename):
    rig = make_rig()
    target, source = setup(rig)
    folder = tmp_path / "Owner output"
    folder.mkdir()
    output = folder / filename
    output.write_text("Synthetic completed work", encoding="utf8")
    named = f'"{output}"' if quoted else f'{output} as requested.'
    condition = f'Save {named}' if location == "condition" else "Save the report at the named absolute path."
    rig.client.replies.append(report(f'Saved {named}'))
    receipt = rig.service.handoff(RAPHAEL, args(target, done_when=condition, requires_artifact=True),
                                  source_turn_id=source.id, language="en")
    assert receipt.ok
    await until(lambda: rig.task(receipt.data["task_id"]).state in ("done", "failed"))
    task = rig.task(receipt.data["task_id"])
    assert task.state == "done"
    assert rig.service._store.evidence(task.id)[0]["digest"]


@pytest.mark.parametrize("location", ["condition", "report"])
@pytest.mark.parametrize("workspace", [False, True])
@pytest.mark.parametrize("offset_ms", [-1001, -1000, -789, 0])
async def test_named_owner_path_uses_the_task_timestamp_grace(make_rig, tmp_path, location, workspace, offset_ms):
    rig = make_rig()
    rig.wall.now += 789
    target, source = setup(rig)
    output = tmp_path / "artifact.txt"
    output.write_text("Synthetic completed work", encoding="utf8")
    modified = (rig.wall() + offset_ms) / 1000
    os.utime(output, (modified, modified))
    rig.service.use_workspaces(lambda member: tmp_path if workspace else None)
    condition = f'Save "{output}"' if location == "condition" else "Save the report."
    rig.client.replies.append(report(f'Saved "{output}"'))
    receipt = rig.service.handoff(RAPHAEL, args(target, done_when=condition, requires_artifact=True),
                                  source_turn_id=source.id, language="en")
    task_id = receipt.data["task_id"]
    await until(lambda: rig.task(task_id).state in ("done", "failed"))
    task = rig.task(task_id)
    assert task.state == ("failed" if offset_ms < -1000 else "done")
    assert task.reason == ("missing_artifact" if offset_ms < -1000 else None)
    assert bool(rig.service._store.evidence(task_id)) == (offset_ms >= -1000)


@pytest.mark.parametrize("workspace", [False, True])
@pytest.mark.parametrize("oversized", [False, True])
async def test_named_owner_path_size_is_checked_before_reading(make_rig, tmp_path, monkeypatch, workspace, oversized):
    rig = make_rig()
    target, source = setup(rig)
    output = tmp_path / "artifact.txt"
    output.write_text("Synthetic completed work", encoding="utf8")
    rig.service.use_workspaces(lambda member: tmp_path if workspace else None)
    original_stat, original_read = Path.stat, Path.read_bytes
    reads = []

    def stat(path, *args, **kwargs):
        info = original_stat(path, *args, **kwargs)
        if path == output:
            fields = list(info)
            fields[6] = 64 * 1024 * 1024 + int(oversized)
            return os.stat_result(fields)
        return info

    def read(path):
        if path == output:
            reads.append(path)
        return original_read(path)

    monkeypatch.setattr(Path, "stat", stat)
    monkeypatch.setattr(Path, "read_bytes", read)
    rig.client.replies.append(report(f'Saved "{output}"'))
    receipt = rig.service.handoff(RAPHAEL, args(target, requires_artifact=True), source_turn_id=source.id, language="en")
    task_id = receipt.data["task_id"]
    await until(lambda: rig.task(task_id).state in ("done", "failed"))
    assert bool(reads) == (not oversized)
    assert rig.task(task_id).state == ("failed" if oversized else "done")
    assert rig.task(task_id).reason == ("missing_artifact" if oversized else None)


@pytest.mark.parametrize("mode", ["work", "consult"])
async def test_required_file_missing_at_completion_is_a_named_failure(make_rig, mode):
    rig = make_rig()
    target, source = setup(rig)
    rig.client.replies.append(report("A file was promised but does not exist."))
    receipt = rig.service.handoff(RAPHAEL, args(target, mode=mode, requires_artifact=True), source_turn_id=source.id, language="en")
    await until(lambda: rig.task(receipt.data["task_id"]).state in ("done", "failed"))
    assert rig.task(receipt.data["task_id"]).reason == "missing_artifact"


@pytest.mark.parametrize("value", [1, "true", None])
async def test_artifact_flag_rejects_non_booleans(make_rig, value):
    rig = make_rig()
    target, source = setup(rig)
    assert rig.service.handoff(RAPHAEL, args(target, requires_artifact=value), source_turn_id=source.id, language="en").error == "bad_arguments"


async def test_rerun_keeps_the_explicit_artifact_contract(make_rig):
    rig = make_rig()
    target, source = setup(rig)
    receipt = rig.service.handoff(RAPHAEL, args(target, requires_artifact=True, done_when="Save report.pdf"),
                                  source_turn_id=source.id, language="en")
    store = rig.service._store
    retry = store.get(store.create(session_id="retry", language="en", text="Finish", rerun_of=receipt.data["task_id"]))
    assert retry.requires_artifact and retry.done_when == "Save report.pdf" and retry.mode == "work"
    assert store.completion_reason(retry, said="Finished. " * 50) == "missing_artifact"


def test_blocked_steps_always_store_a_reason(conn):
    history = AgentHistory(conn)
    turn_id = history.add(session_id="synthetic", question="Review", route="answer", prefix="", text="", status="done")
    history.add_steps(turn_id, [Step("tool", tool, "Sample", "blocked", 0)
                                for tool in ("memory_update", "COMPOSIO_SEARCH_TOOLS")])
    assert all(step.reason for step in history.steps([turn_id])[turn_id])
    from raphael_core.background.tasks import TaskStore
    store = TaskStore(conn)
    task_id = store.create(session_id="synthetic", language="en", text="Review")
    store.add_step(task_id, kind="tool", outcome="blocked", tool="memory_update")
    pending = store.add_step(task_id, kind="tool", outcome="in_progress", tool="COMPOSIO_SEARCH_TOOLS")
    store.update_step(pending, outcome="blocked")
    assert all(step.reason for step in store.steps(task_id))


def test_codex_character_limit_is_context_overflow():
    assert classify("Input exceeds the maximum length of 1048576 characters", record=False).kind == "context_overflow"


@pytest.mark.parametrize("message_only", [False, True])
async def test_waiting_tree_cancel_keeps_reply_counts_and_cancelled_status(make_rig, message_only):
    rig = make_rig()
    task_id = rig.service._store.create(session_id="synthetic", language="en", text="Review")
    history = AgentHistory(rig.conn)
    turn_id = history.add(session_id="synthetic", question="Review", route="answer", prefix="", text="Findings already delivered.", status="running", cost_usd=0.25)
    if message_only:
        history.resolve(turn_id, prefix="", text="", status="running")
        history.add_message(turn_id, "reply", "Findings already delivered.")
    rig.service._store.attach_turn(task_id, turn_id)
    rig.service._store.start(task_id)
    rig.service._store.progress(task_id, model_calls=3, tool_calls=7, cost_usd=0.25)
    rig.service._store.pause_for_children(task_id, {"owner_wait": True})
    assert (await rig.service._cancel({"task_id": task_id}))["cancelled"]
    task, saved = rig.task(task_id), history.get(turn_id)
    assert (task.model_calls, task.tool_calls, task.cost_usd) == (3, 7, 0.25)
    assert saved.status == "cancelled"
    assert saved.cost_usd == 0.25
    stop_note = "The task was stopped. Tool calls made: 7."
    assert task.report_text == stop_note
    assert saved.text == "Findings already delivered.\n\n" + stop_note
    messages = history.messages([turn_id])[turn_id]
    assert sum(message['text'].count("Findings already delivered.") for message in messages) == 1
    reports = [data for method, data in rig.notifications if method == "worker.report"]
    assert reports[-1]["text"] == stop_note


@pytest.mark.parametrize("has_reply", [False, True])
async def test_cancelled_delegate_keeps_real_replies_without_the_handoff_acknowledgement(make_rig, has_reply):
    rig = make_rig()
    task_id = rig.service._store.create(session_id="synthetic", language="en", text="Review")
    history = AgentHistory(rig.conn)
    turn_id = history.add(session_id="synthetic", question="Review", route="delegate", prefix="",
                          text="Handed to the background.", status="running")
    if has_reply:
        history.add_message(turn_id, "reply", "Findings already delivered.")
    rig.service._store.attach_turn(task_id, turn_id)
    rig.service._store.start(task_id)
    rig.service._store.pause_for_children(task_id, {"owner_wait": True})
    assert (await rig.service._cancel({"task_id": task_id}))["cancelled"]
    stop_note = "The task was stopped. Tool calls made: 0."
    assert rig.task(task_id).report_text == stop_note
    saved = history.get(turn_id)
    assert saved.status == "cancelled"
    assert saved.text == ("Findings already delivered.\n\n" if has_reply else "") + stop_note
    messages = history.messages([turn_id])[turn_id]
    assert [message["text"] for message in messages] == (["Findings already delivered."] if has_reply else []) + [stop_note]


async def test_conversation_handoff_persists_source_counters_before_tree_stop(make_rig):
    from raphael_core.brain.runs import save_metrics
    rig = make_rig()
    target, source = setup(rig, room=False)
    receipt = rig.service.handoff(RAPHAEL, args(target), source_turn_id=source.id, language="en")
    parent_id = rig.task(receipt.data["task_id"]).parent_task_id
    history = AgentHistory(rig.conn)
    history.add_steps(source.id, [Step("tool", "local_time", "Raphael", "ok", 20)] * 4)
    history.resolve(source.id, prefix="", text="Initial findings.", status="done", cost_usd=0.2)
    save_metrics(rig.conn, "turn", source.id, 1, 2, [{"tokens": 0}] * 3)
    rig.service.settle_asker(source.id, answered=True)
    assert (rig.task(parent_id).model_calls, rig.task(parent_id).tool_calls) == (3, 4)
    await rig.service._cancel({"task_id": parent_id})
    assert "4" in history.get(source.id).text
    changed = [data for method, data in rig.notifications if method == "worker.changed" and data["task_id"] == parent_id]
    assert changed[-1]["tool_calls"] == 4


async def test_artifact_flag_is_shared_by_tool_schemas_and_receipt_identity(make_rig):
    from raphael_core.agent.team import team_tool, worker_definition
    schema = team_tool("handoff").schema
    assert schema == worker_definition("handoff")["function"]["parameters"]
    assert schema["properties"]["requires_artifact"]["type"] == "boolean"
    assert schema["properties"]["requires_artifact"]["default"] is False
    rig = make_rig()
    target, source = setup(rig)
    first = rig.service.handoff(RAPHAEL, args(target, requires_artifact=True), source_turn_id=source.id, language="en")
    again = rig.service.handoff(RAPHAEL, args(target, requires_artifact=True), source_turn_id=source.id, language="en")
    changed = rig.service.handoff(RAPHAEL, args(target), source_turn_id=source.id, language="en")
    assert again.data["duplicate"] and first.data["task_id"] == again.data["task_id"]
    assert changed.error == "stage_conflict"


@pytest.mark.parametrize("kind", ["usage_limit", "context_overflow", "tool_broken", "model_error", "expired"])
async def test_failed_task_retains_specific_failure_kind(make_rig, kind):
    from types import SimpleNamespace
    rig = make_rig()
    task_id = rig.service._store.create(session_id="synthetic", language="en", text="Review")
    rig.service._store.start(task_id)
    run = SimpleNamespace(tool_calls=2, model_calls=1, cancelled=False, timed_out=False, generation=0,
                          ledger=SimpleNamespace(total=0, calls=[], model=None), model_failure=None)
    rig.service._conclude_run(rig.task(task_id), run, {"status": "stopped", "kind": "failed", "detail": kind})
    assert rig.task(task_id).reason == kind
    assert rig.task(task_id).report_text != "An error occurred during processing. Please try again."

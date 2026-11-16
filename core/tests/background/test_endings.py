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
    named = f'"{output}"' if quoted else f'{output} as requested.'
    condition = f'Save {named}' if location == "condition" else "Save the report at the named absolute path."
    def saved(**kwargs):
        output.write_text("Synthetic completed work", encoding="utf8")
        return report(f'Saved {named}')
    rig.client.replies.append(saved)
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
    modified = (rig.wall() + offset_ms) / 1000
    rig.service.use_workspaces(lambda member: tmp_path if workspace else None)
    condition = f'Save "{output}"' if location == "condition" else "Save the report."
    def saved(**kwargs):
        output.write_text("Synthetic completed work", encoding="utf8")
        os.utime(output, (modified, modified))
        return report(f'Saved "{output}"')
    rig.client.replies.append(saved)
    receipt = rig.service.handoff(RAPHAEL, args(target, done_when=condition, requires_artifact=True),
                                  source_turn_id=source.id, language="en")
    task_id = receipt.data["task_id"]
    await until(lambda: rig.task(task_id).state in ("done", "failed"))
    task = rig.task(task_id)
    assert task.state == ("failed" if offset_ms < -1000 else "done")
    assert task.reason == ("missing_artifact" if offset_ms < -1000 else None)
    assert bool(rig.service._store.evidence(task_id)) == (offset_ms >= -1000)


@pytest.mark.parametrize("workspace", [False, True])
@pytest.mark.parametrize("size", [50 * 1024 * 1024 - 1, 50 * 1024 * 1024, 50 * 1024 * 1024 + 1, 64 * 1024 * 1024])
async def test_named_owner_path_size_is_checked_before_reading(make_rig, tmp_path, monkeypatch, workspace, size):
    rig = make_rig()
    target, source = setup(rig)
    output = tmp_path / "artifact.txt"
    output.write_text("Synthetic completed work", encoding="utf8")
    rig.service.use_workspaces(lambda member: tmp_path if workspace else None)
    oversized = size > 50 * 1024 * 1024
    original_stat, original_open = Path.stat, Path.open
    reads = []

    def stat(path, *args, **kwargs):
        info = original_stat(path, *args, **kwargs)
        if path == output:
            fields = list(info)
            fields[6] = size
            return os.stat_result(fields)
        return info

    def open_file(path, mode="r", *args, **kwargs):
        if path == output and mode == "rb":
            reads.append(path)
        return original_open(path, mode, *args, **kwargs)

    monkeypatch.setattr(Path, "stat", stat)
    monkeypatch.setattr(Path, "open", open_file)
    rig.client.replies.append(report(f'Saved "{output}"'))
    receipt = rig.service.handoff(RAPHAEL, args(target, requires_artifact=True), source_turn_id=source.id, language="en")
    task_id = receipt.data["task_id"]
    await until(lambda: rig.task(task_id).state in ("done", "failed"))
    assert bool(reads) == (not oversized)
    assert rig.task(task_id).state == ("failed" if oversized else "done")
    assert rig.task(task_id).reason == ("missing_artifact" if oversized else None)
    assert bool(rig.service._store.evidence(task_id)) == (not oversized)


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
    # A stop that was asked for adds no line of its own (R-STOP-01): what was already said stays as it was.
    assert task.report_text == ""
    assert saved.text == "Findings already delivered."
    messages = history.messages([turn_id])[turn_id]
    assert sum(message['text'].count("Findings already delivered.") for message in messages) == 1
    assert not any("stopped" in message['text'] for message in messages)
    assert not [data for method, data in rig.notifications if method == "worker.report"]


@pytest.mark.parametrize("state, detail, expected", [
    ("done", "the long report", ["First message", "Second message"]),
    ("limit", "everything it had done and what is left", ["First message", "Second message"]),
])
async def test_a_conclusion_keeps_its_whole_words_for_the_chat(make_rig, state, detail, expected):
    rig = make_rig()
    task_id = rig.service._store.create(session_id="telegram:1", language="en", text="Review")
    rig.service._conclude(rig.task(task_id), None, state, "", "short line…", detail, None,
                          replies=["First message", "Second message"])
    assert rig.service.final_words(task_id) == expected
    assert rig.service.final_words(task_id) == []  # read once


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
    assert rig.task(task_id).report_text == ""
    saved = history.get(turn_id)
    assert saved.status == "cancelled"
    assert saved.text == ("Findings already delivered." if has_reply else "")
    messages = history.messages([turn_id]).get(turn_id, [])
    assert [message["text"] for message in messages] == (["Findings already delivered."] if has_reply else [])


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
    # The stop says nothing, so the turn keeps its own words; the counters stay on the task (R-STOP-01).
    assert history.get(source.id).text == "Initial findings."
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


def _team_rig(rig, tmp_path):
    """A member's own folder and its team's shared folder, as the computer binds them from this PC."""
    workspace, team = tmp_path / "workspace", tmp_path / "team"
    workspace.mkdir()
    team.mkdir()
    rig.service.use_workspaces(lambda member: [workspace, team])
    return workspace, team


def _fresh(rig, path, ahead=0):
    """Make `path` as new as this task, `ahead` seconds newer."""
    moment = rig.wall() / 1000 + ahead
    os.utime(path, (moment, moment))


async def _finish(rig, target, source, **options):
    receipt = rig.service.handoff(RAPHAEL, args(target, requires_artifact=True, **options),
                                  source_turn_id=source.id, language="en")
    task_id = receipt.data["task_id"]
    await until(lambda: rig.task(task_id).state in ("done", "failed"))
    return rig.task(task_id)


async def test_work_file_named_by_its_computer_path_counts_when_the_browser_profile_is_newer(make_rig, tmp_path, monkeypatch):
    """A member wrote benchmark-report.md in the team folder and said so; the newest files of
    its own folder were browser caches this PC cannot read, which took every place of the verified ones, so the work failed."""
    from raphael_core.background import tasks
    rig = make_rig()
    target, source = setup(rig)
    workspace, team = _team_rig(rig, tmp_path)
    digest = tasks._artifact_digest
    def readable(path):
        if "cache" in path.parts:
            raise PermissionError(path)
        return digest(path)
    monkeypatch.setattr(tasks, "_artifact_digest", readable)
    def saved(**kwargs):
        (workspace / "cache").mkdir()
        for number in range(30):
            noise = workspace / "cache" / f"data_{number}"
            noise.write_text("cache", encoding="utf8")
            _fresh(rig, noise, ahead=5)
        folder = team / "projects" / "research"
        folder.mkdir(parents=True)
        (folder / "benchmark-report.md").write_text("# Benchmark", encoding="utf8")
        _fresh(rig, folder / "benchmark-report.md")
        return report("Report is in /home/cua/team/projects/research/benchmark-report.md")
    rig.client.replies.append(saved)
    task = await _finish(rig, target, source, done_when="benchmark-report.md exists with sources")
    assert (task.state, task.reason) == ("done", None)
    assert [item["uri"] for item in rig.service._store.evidence(task.id) if item["kind"] == "artifact"] == [
        "projects/research/benchmark-report.md"]


async def test_work_file_named_in_the_condition_fails_when_only_other_files_are_new(make_rig, tmp_path):
    """A file the condition names (here a .md) is the one that must exist; any other new file is not it."""
    rig = make_rig()
    target, source = setup(rig)
    workspace, team = _team_rig(rig, tmp_path)
    def saved(**kwargs):
        (team / "notes.txt").write_text("other", encoding="utf8")
        _fresh(rig, team / "notes.txt")
        return report("Done.")
    rig.client.replies.append(saved)
    task = await _finish(rig, target, source, done_when="plan.md exists")
    assert (task.state, task.reason) == ("failed", "missing_artifact")


async def test_the_team_folder_is_searched_even_when_the_member_folder_is_large(make_rig, tmp_path, monkeypatch):
    """The scan budget is each folder's own: a member folder that uses it up never hides the team folder."""
    from raphael_core.background import service
    monkeypatch.setattr(service, "ARTIFACT_SCAN", 5)
    rig = make_rig()
    target, source = setup(rig)
    workspace, team = _team_rig(rig, tmp_path)
    def saved(**kwargs):
        for folder in range(4):
            (workspace / f"part{folder}").mkdir()
            for number in range(3):
                (workspace / f"part{folder}" / f"file{number}.txt").write_text("x", encoding="utf8")
        (team / "projects").mkdir()
        (team / "projects" / "plan.txt").write_text("Plan", encoding="utf8")
        _fresh(rig, team / "projects" / "plan.txt")
        return report("Done.")
    rig.client.replies.append(saved)
    task = await _finish(rig, target, source, done_when="plan.txt exists")
    assert (task.state, task.reason) == ("done", None)


async def test_the_browser_profile_is_never_taken_for_the_work(make_rig, tmp_path):
    """Chrome's caches change all the time; a task that left no file does not pass on them."""
    rig = make_rig()
    target, source = setup(rig)
    workspace, team = _team_rig(rig, tmp_path)
    def saved(**kwargs):
        (workspace / ".browser-profiles" / "driver").mkdir(parents=True)
        (workspace / ".browser-profiles" / "driver" / "Cookies").write_text("x", encoding="utf8")
        _fresh(rig, workspace / ".browser-profiles" / "driver" / "Cookies")
        return report("Done.")
    rig.client.replies.append(saved)
    task = await _finish(rig, target, source, done_when="the summary is saved")
    assert (task.state, task.reason) == ("failed", "missing_artifact")


@pytest.mark.parametrize("text, names", [
    ("Report is in /home/cua/team/projects/x/a.md", ["projects/x/a.md"]),
    ("完整報告在 /home/cua/team/projects/x/a.md。另外有 5 件事", ["projects/x/a.md"]),
    ("saved to '/home/cua/workspace/out/b.pdf'), then", ["out/b.pdf"]),
    ("/home/cua/team/../etc/passwd and /home/cua/team/", []),
    ("/home/cua/other/c.md", []),
])
def test_files_named_by_their_path_in_the_computer(text, names):
    from raphael_core.background.outcomes import computer_files
    found = [item.as_posix() for item in computer_files(text)]
    assert set(names) <= set(found) and not any(".." in item for item in found)


# --- a file that is there but cannot be read is not a missing file ---------------------------------------------------------


@pytest.mark.parametrize("language", ["en", "zh-TW", "ja", "de", "th"])
async def test_a_folder_in_the_place_of_the_named_file_is_there_but_unreadable_not_missing(make_rig, tmp_path, language):
    from raphael_core.agent.persona import phrase
    rig = make_rig()
    target, source = setup(rig)
    output = tmp_path / "report.md"
    def saved(**kwargs):
        output.mkdir()
        return report(f'Saved "{output}"')
    rig.client.replies.append(saved)
    receipt = rig.service.handoff(RAPHAEL, args(target, done_when=f'Save "{output}"', requires_artifact=True),
                                  source_turn_id=source.id, language=language)
    task_id = receipt.data["task_id"]
    await until(lambda: rig.task(task_id).state in ("done", "failed"))
    task = rig.task(task_id)
    assert (task.state, task.reason) == ("failed", "artifact_unreadable")
    assert task.report_text == phrase(language, "work_file_unreadable") != phrase(language, "work_file_missing")


async def test_a_file_another_program_holds_is_there_but_unreadable_not_missing(make_rig, tmp_path, lock_file):
    rig = make_rig()
    target, source = setup(rig)
    output = tmp_path / "report.md"
    def saved(**kwargs):
        output.write_text("The finished report", encoding="utf8")
        lock_file(output)
        return report(f'Saved "{output}"')
    rig.client.replies.append(saved)
    task = await _finish(rig, target, source, done_when=f'Save "{output}"')
    assert (task.state, task.reason) == ("failed", "artifact_unreadable")
    assert not [item for item in rig.service._store.evidence(task.id) if item["kind"] == "artifact"]


async def test_a_file_of_the_members_folder_that_cannot_be_read_is_not_missing(make_rig, tmp_path, lock_file):
    rig = make_rig()
    target, source = setup(rig)
    workspace, team = _team_rig(rig, tmp_path)
    def saved(**kwargs):
        (team / "plan.md").write_text("The plan", encoding="utf8")
        _fresh(rig, team / "plan.md")
        lock_file(team / "plan.md")
        return report("Done.")
    rig.client.replies.append(saved)
    task = await _finish(rig, target, source, done_when="plan.md exists")
    assert (task.state, task.reason) == ("failed", "artifact_unreadable")


async def test_a_folder_of_the_named_files_name_in_the_members_folder_is_unreadable_not_missing(make_rig, tmp_path):
    rig = make_rig()
    target, source = setup(rig)
    workspace, team = _team_rig(rig, tmp_path)
    def saved(**kwargs):
        (workspace / "out" / "plan.md").mkdir(parents=True)
        return report("Done.")
    rig.client.replies.append(saved)
    task = await _finish(rig, target, source, done_when="plan.md exists")
    assert (task.state, task.reason) == ("failed", "artifact_unreadable")


async def test_a_file_that_was_never_made_is_still_missing(make_rig, tmp_path):
    rig = make_rig()
    target, source = setup(rig)
    workspace, team = _team_rig(rig, tmp_path)
    rig.client.replies.append(report("Done."))
    task = await _finish(rig, target, source, done_when="plan.md exists")
    assert (task.state, task.reason) == ("failed", "missing_artifact")


async def test_a_folder_that_is_no_file_the_condition_names_is_never_taken_for_it(make_rig, tmp_path):
    """The condition gives the folder in which the file is to be; that folder is not the unreadable file."""
    rig = make_rig()
    target, source = setup(rig)
    folder = tmp_path / "My Documents"
    folder.mkdir()
    rig.client.replies.append(report("Done."))
    task = await _finish(rig, target, source, done_when=f'Save report.md in "{folder}" folder')
    assert (task.state, task.reason) == ("failed", "missing_artifact")


async def test_a_file_that_was_held_a_moment_ago_and_is_free_now_counts(make_rig, tmp_path):
    """Each look at the files starts afresh: what was found unreadable before does not stay against the task."""
    rig = make_rig()
    target, source = setup(rig)
    output = tmp_path / "report.md"
    receipt = rig.service.handoff(RAPHAEL, args(target, done_when=f'Save "{output}"', requires_artifact=True),
                                  source_turn_id=source.id, language="en")
    task = rig.task(receipt.data["task_id"])
    store = rig.service._store
    store.note_unreadable(task.id, output)
    assert store.completion_reason(task) == "artifact_unreadable"
    output.write_text("The finished report", encoding="utf8")
    assert rig.service._record_artifacts(task, 0)
    assert store.completion_reason(task, said="Saved it. " * 30) is None


async def test_a_receipt_whose_file_cannot_be_read_when_the_work_is_judged_is_unreadable(make_rig, tmp_path, lock_file):
    rig = make_rig()
    target, source = setup(rig)
    output = tmp_path / "report.md"
    receipt = rig.service.handoff(RAPHAEL, args(target, done_when=f'Save "{output}"', requires_artifact=True),
                                  source_turn_id=source.id, language="en")
    task = rig.task(receipt.data["task_id"])
    output.write_text("The finished report", encoding="utf8")
    store = rig.service._store
    store.verify_artifact(task.id, "artifact", output, workspace=tmp_path, mime="text/plain")
    assert store.completion_reason(task) is None
    lock_file(output)
    assert store.completion_reason(task) == "artifact_unreadable"


async def test_a_receipt_whose_file_is_gone_when_the_work_is_judged_is_missing(make_rig, tmp_path):
    rig = make_rig()
    target, source = setup(rig)
    output = tmp_path / "report.md"
    receipt = rig.service.handoff(RAPHAEL, args(target, done_when=f'Save "{output}"', requires_artifact=True),
                                  source_turn_id=source.id, language="en")
    task = rig.task(receipt.data["task_id"])
    output.write_text("The finished report", encoding="utf8")
    rig.service._store.verify_artifact(task.id, "artifact", output, workspace=tmp_path, mime="text/plain")
    output.unlink()
    assert rig.service._store.completion_reason(task) == "missing_artifact"


def test_what_a_read_failure_says_of_the_file():
    from raphael_core.background.outcomes import exists_unreadable
    here = Path(__file__)
    assert exists_unreadable(here, PermissionError())
    assert exists_unreadable(here.parent, ValueError("artifact_outside_workspace")), "a folder of that name"
    assert not exists_unreadable(here.parent / "gone.md", FileNotFoundError())
    assert not exists_unreadable(here, ValueError("artifact_size")), "too large is no read failure"
    assert not exists_unreadable(here.parent / "gone.md", PermissionError()), "nothing is there to be unreadable"

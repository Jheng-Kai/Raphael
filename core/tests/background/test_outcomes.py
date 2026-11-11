"""Edited-file evidence, one terminal recovery and bounded worker diagnostics."""

import hashlib
import os

import pytest

from raphael_core.agent.speaker import RAPHAEL
from raphael_core.agent.cli.discovery import CliBrains
from raphael_core.agent.cli.drivers import Event
from .conftest import call, report, turn, until
from .test_handoff import args, setup


async def test_handoff_existing_absolute_file_uses_changed_digest_even_with_old_mtime(make_rig, tmp_path):
    rig = make_rig()
    target, source = setup(rig)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    rig.service.use_workspaces(lambda member: workspace)
    path = tmp_path / "existing report.md"
    path.write_text("Before the edit", encoding="utf-8")
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    async def edited(**kwargs):
        path.write_text("After the edit", encoding="utf-8")
        os.utime(path, (1, 1))
        return report("Updated the named repository file.")
    rig.client.replies = [edited]
    receipt = rig.service.handoff(RAPHAEL, args(target, request=f'Edit "{path}"',
        done_when=f'Update "{path}"', requires_artifact=True), source_turn_id=source.id, language="en")
    assert receipt.ok
    await until(lambda: rig.task(receipt.data["task_id"]).state in ("done", "failed"))
    task = rig.task(receipt.data["task_id"])
    assert task.state == "done" and task.reason is None
    evidence = rig.service._store.evidence(task.id)
    assert any(row["kind"] == "file_before" and row["digest"] == before for row in evidence)
    assert any(row["kind"] == "artifact" and row["digest"] == hashlib.sha256(path.read_bytes()).hexdigest() for row in evidence)


async def test_unchanged_existing_file_does_not_count_as_an_edit(make_rig, tmp_path):
    rig = make_rig()
    target, source = setup(rig)
    path = tmp_path / "unchanged.md"
    path.write_text("Unchanged", encoding="utf-8")
    rig.client.replies = [report("Sample sentence that must not become a failure detail.")]
    receipt = rig.service.handoff(RAPHAEL, args(target, request=f'Edit "{path}"', done_when=f'Update "{path}"',
        requires_artifact=True), source_turn_id=source.id, language="en")
    await until(lambda: rig.task(receipt.data["task_id"]).state in ("done", "failed"))
    task = rig.task(receipt.data["task_id"])
    assert task.state == "failed" and task.reason == "missing_artifact"
    assert "Sample sentence" not in (task.report_text or "") + (task.report_detail or "")


async def test_duplicate_handoff_keeps_the_original_file_baseline(make_rig, tmp_path):
    rig = make_rig()
    target, source = setup(rig)
    path = tmp_path / "existing.md"
    path.write_text("Original", encoding="utf-8")
    request = args(target, request=f'Edit "{path}"', done_when=f'Update "{path}"', requires_artifact=True)
    first = rig.service.handoff(RAPHAEL, request, source_turn_id=source.id, language="en")
    path.write_text("Changed", encoding="utf-8")
    again = rig.service.handoff(RAPHAEL, request, source_turn_id=source.id, language="en")
    assert again.ok and again.data["duplicate"] and again.data["task_id"] == first.data["task_id"]
    before = [row for row in rig.service._store.evidence(first.data["task_id"]) if row["kind"] == "file_before"]
    assert len(before) == 1 and before[0]["digest"] == hashlib.sha256(b"Original").hexdigest()


@pytest.mark.parametrize("other_file", [False, True])
async def test_unhashable_existing_file_is_noted_without_waiving_another_required_file(make_rig, tmp_path, monkeypatch, other_file):
    from raphael_core.background import tasks
    monkeypatch.setattr(tasks, "MAX_ARTIFACT_BYTES", 8)
    rig = make_rig()
    target, source = setup(rig)
    path = tmp_path / "large.md"
    path.write_text("Exceeds the synthetic bound", encoding="utf-8")
    done = f'Update "{path}"'
    if other_file:
        other = tmp_path / "small.md"
        other.write_text("Before", encoding="utf-8")
        done += f' and "{other}"'
    rig.client.replies = [report("The written findings and limitations are recorded here. " * 8)]
    receipt = rig.service.handoff(RAPHAEL, args(target, request=f'Edit "{path}"', done_when=done,
        requires_artifact=True), source_turn_id=source.id, language="en")
    assert receipt.ok and "remains unverified" in receipt.data["artifact_note"]
    await until(lambda: rig.task(receipt.data["task_id"]).state in ("done", "failed"))
    task = rig.task(receipt.data["task_id"])
    if other_file:
        assert task.state == "failed" and task.reason == "missing_artifact"
    else:
        assert task.state == "done" and "remains unverified" in task.report_detail


@pytest.mark.parametrize("second", ["Completed the check.", ""])
@pytest.mark.parametrize("envelope", ["empty", "json", "fenced", "object"])
async def test_empty_final_gets_one_toolless_nudge_then_public_missing_terminal(make_rig, second, envelope):
    rig = make_rig()
    empty = {"empty": turn(""), "json": report(""), "fenced": turn('```json\n{"text":""}\n```'), "object": turn("{}")}[envelope]
    rig.client.replies = [turn(calls=[call("local_time", {})]), empty, turn(second)]
    task_id = rig.submit()
    await rig.wait_for_reports()
    task = rig.task(task_id)
    assert len(rig.client.chat_calls) == 3
    final_call = rig.client.chat_calls[-1]
    assert final_call["tools"] == []
    assert "final report" in final_call["messages"][-1]["content"]
    assert task.state == ("done" if second else "failed")
    assert task.reason == (None if second else "missing_terminal")


async def test_worker_exception_stores_our_frame_and_type_without_values(make_rig, monkeypatch):
    rig = make_rig()
    async def broken(*args):
        raise AttributeError("private-value-must-not-be-stored")
    monkeypatch.setattr(rig.service, "_execute", broken)
    task_id = rig.submit()
    await rig.wait_for_reports()
    task = rig.task(task_id)
    assert task.reason == "worker_AttributeError"
    assert "AttributeError" in task.report_detail and "background/service.py:" in task.report_detail
    assert "private-value" not in task.report_detail


@pytest.mark.parametrize("brain", ["codex", "claude", "gemini"])
@pytest.mark.parametrize("second", ["Completed the check.", "", "error", "eof", "exception"])
@pytest.mark.parametrize("session", [None, "same-task-session"])
async def test_cli_empty_final_nudges_same_session_once_without_tools(make_rig, monkeypatch, tmp_path, brain, second, session):
    rig = make_rig()
    brains = CliBrains(home=tmp_path, environ={}, commands={brain: ["never-spawn"]})
    monkeypatch.setattr(brains, "available", lambda *args, **kwargs: True)
    calls = []
    async def run(driver, **kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            if session:
                yield Event("session", session)
            yield Event("tool_start", data={"id": "read", "name": "local_read"})
            yield Event("tool_end", data={"id": "read", "ok": True})
            yield Event("final", "")
        else:
            assert len(calls) == 2
            assert kwargs["session"] == session
            assert kwargs["no_tools"] is True
            assert "final report" in kwargs["user"]
            assert "local_read" in kwargs["user"] and "completed" in kwargs["user"]
            assert await kwargs["permission"]({"tool_name": "Bash"}) == "deny"
            if second == "error":
                yield Event("error", "network")
            elif second == "eof":
                raise EOFError("synthetic stopped report")
            elif second == "exception":
                raise RuntimeError("synthetic report exception")
            else:
                yield Event("final", second)
    monkeypatch.setattr("raphael_core.agent.cli.loop.Driver.run", run)
    rig.service.use_cli(brains)
    task_id = rig.service.submit(session_id="empty-cli", text="Check the file", language="en", model="cli:" + brain)
    await until(lambda: rig.task(task_id).state in ("done", "failed"))
    assert len(calls) == 2
    task = rig.task(task_id)
    completed = second == "Completed the check."
    assert task.state == ("done" if completed else "failed")
    assert task.reason == (None if completed else "missing_terminal")
    assert rig.client.chat_calls == []

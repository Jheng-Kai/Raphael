"""Assigned work is private owner-facing history; only a short audit reaches its requester."""

import json
from dataclasses import replace

import pytest

from raphael_core.agent.cli.loop import CliLoop
from raphael_core.agent.history import AgentHistory
from raphael_core.agent.service import AgentService
from raphael_core.agent.speaker import RAPHAEL
from raphael_core.brain.settings import SettingsStore
from raphael_core.worker.loop import Outcome
from .conftest import call, report, turn, until, use
from .test_handoff import args, setup, team_of


@pytest.mark.parametrize("brain", ["api", "cli"])
async def test_work_has_private_replies_steps_and_a_separate_ordered_exchange(make_rig, monkeypatch, brain):
    rig = make_rig()
    model = "cli:codex:fake" if brain == "cli" else "fake/model"
    SettingsStore(rig.conn).set("agent_model", model)
    target, source = setup(rig, room=False, model=model)
    target = replace(target, personality="OWNER-FACING-PERSONA")
    rig.service.use_team(team_of(target), lambda *a, **k: None)
    history = AgentHistory(rig.conn, rig.wall)
    history.add(session_id="chief-secret", question="CHIEF-THREAD-SECRET", route="answer",
                prefix="", text="Chief context", status="done")
    history.add(session_id="own-context", question="MEMBER-OWN-CONTEXT", route="answer",
                prefix="", text="Own context", status="done", member_id=target.id)
    await rig.plugins.connect(look="T1")
    opening = "I received the brief and will put the checked result here for you."
    full = "I checked the requested source.\n\nPRIVATE-WORK-BODY: " + "The detailed findings belong here. " * 20
    captured = []
    if brain == "api":
        def first(**kwargs):
            captured.append(str(kwargs["messages"]))
            return turn(json.dumps({"messages": [opening]}), [use("Notes__look", {"topic": "source"})])
        rig.client.replies.extend([first, report(full)])
    else:
        rig.service.use_cli(object())
        async def work(loop):
            captured.append(loop.system + loop.user)
            loop._publish(opening, final=True)
            assert (await loop._tool("check", "Notes__look", {"topic": "source"})).ok
            loop._queue.put_nowait(Outcome("done", final=full))
        monkeypatch.setattr(CliLoop, "_work", work)
    receipt = rig.service.handoff(RAPHAEL, args(target), source_turn_id=source.id, language="en")
    assert receipt.ok, receipt.error
    task_id = receipt.data["task_id"]
    await until(lambda: rig.task(task_id).state in ("done", "failed"))
    task = rig.task(task_id)
    assert task.state == "done", task.reason
    work = history.get(task.turn_id)
    audit = history.get(rig.service._store.exchange_turn_id(task_id))
    assert audit.id < work.id and audit.created_at_ms < work.created_at_ms
    assert (work.scope, work.source, work.route, work.member_id, work.question) == (
        "private", "worker", "worker", target.id, "")
    assert audit.scope == "exchange" and audit.source == "member" and audit.peer_id == 0
    assert audit.question == args(target)["request"] and audit.source_turn_id == source.id
    replies = [m["text"] for m in history.messages([work.id])[work.id] if m["kind"] == "reply"]
    assert opening in replies and any("PRIVATE-WORK-BODY" in text for text in replies)
    assert "MEMBER-OWN-CONTEXT" in captured[0] and "CHIEF-THREAD-SECRET" not in captured[0]
    assert "OWNER-FACING-PERSONA" in captured[0] and "the language the owner writes in" in captured[0]
    assert any(s.tool == "look" and s.outcome == "ok" for s in rig.service._store.steps(task_id))
    [view] = rig.service.handoff_views(source_turn_id=source.id)
    assert view["exchange_turn_id"] == audit.id and view["work_turn_id"] == work.id
    assert view["brief_at_ms"] < view["work_created_at_ms"] < view["report_at_ms"]
    assert view["report_at_ms"] > max(m["at_ms"] for m in history.messages([work.id])[work.id])
    assert "PRIVATE-WORK-BODY" not in str(view)
    assert view["work_location"]["conversation_id"] == work.conversation_id
    assert "PRIVATE-WORK-BODY" not in audit.text and len(audit.text) <= 240
    assert len(history.messages([audit.id])[audit.id]) == 1
    assert {work.id, audit.id}.issubset({t.id for t in history.list(20, member_id=target.id, exchanges=True)})
    chief = history.recent(20, member_id=0)
    assert "PRIVATE-WORK-BODY" not in str(chief)
    assert ("agent.turn", {"turn_id": work.id, "member_id": target.id}) in rig.notifications
    assert ("agent.turn", {"turn_id": source.id, "member_id": 0}) in rig.notifications
    assert ("agent.turn", {"turn_id": audit.id, "member_id": target.id}) in rig.notifications
    before = history.messages([audit.id])[audit.id]
    rig.service._deliver_handoffs()
    assert history.messages([audit.id])[audit.id] == before
    # The window gets the report anchor without depending on the worker's lifetime.
    agent = object.__new__(AgentService)
    agent._conn, agent._history = rig.conn, history
    order = agent._exchange_order(audit)
    assert order["report_at_ms"] == view["report_at_ms"] and order["work_turn_id"] == work.id
    # Task rows can be removed and their SQLite IDs reused; retained history keeps its own link.
    rig.service._store.delete(task_id)
    rig.service._store.create(session_id="later", language="en", text="Unrelated work")
    assert agent._exchange_order(audit) == order


async def test_parent_receives_only_summary_location_and_evidence(make_rig):
    rig = make_rig()
    target, source = setup(rig, room=False)
    receipt = rig.service.handoff(RAPHAEL, args(target), source_turn_id=source.id, language="en")
    task = rig.task(receipt.data["task_id"])
    rig.client.replies.append(report("The review is complete.\n\nPRIVATE-REPORT-DETAIL " + "findings " * 50))
    await until(lambda: rig.task(task.id).state in ("done", "failed"))
    [result] = rig.service._child_results(task.parent_task_id)
    assert result["result"] == "The review is complete."
    assert "PRIVATE-REPORT-DETAIL" not in str(result)
    assert result["work_location"]["work_turn_id"] == task.turn_id
    assert result["state"] == "completed"


@pytest.mark.parametrize("model,provider", [("fake/model", "openrouter"), ("@chatgpt:gpt-6-sol", "chatgpt"),
                                           ("cli:codex:sample", "cli:codex")])
async def test_failed_work_rerun_preserves_private_thread_and_creates_new_audit(make_rig, monkeypatch, model, provider):
    rig = make_rig()
    target, source = setup(rig, model=model, room=False)
    monkeypatch.setattr(rig.service, "_ensure_pump", lambda: None)
    first = rig.service.handoff(RAPHAEL, args(target), source_turn_id=source.id, language="en")
    old = rig.task(first.data["task_id"])
    rig.service._conclude(old, None, "failed", "", "Could not check the source.", None, "network")
    rig.service._deliver_handoffs()
    new_id = (await rig.service._rerun({"task_id": old.id}))["task_id"]
    new = rig.task(new_id)
    history = AgentHistory(rig.conn)
    assert history.get(old.turn_id).failure == {"kind": "network", "provider": provider, "resets_at": None}
    terminal = [data for method, data in rig.notifications if method == "agent.turn" and data.get("failure")]
    assert terminal[-1]["failure"] == history.get(old.turn_id).failure
    work = history.get(new.turn_id)
    assert work.failure is None
    audit = history.get(rig.service._store.exchange_turn_id(new_id))
    assert (work.scope, work.question, work.route, work.source) == ("private", "", "worker", "worker")
    assert work.conversation_id == history.get(old.turn_id).conversation_id
    assert new.source_turn_id == source.id and audit.id < work.id
    assert audit.created_at_ms < work.created_at_ms and audit.question == old.text


async def test_private_work_marks_the_member_unread_but_the_exchange_does_not(make_rig, tmp_path):
    from members.conftest import Rig as MembersRig
    rig = make_rig()
    target, source = setup(rig, room=False)
    members = MembersRig(rig.conn, tmp_path)
    try:
        rig.client.replies.append(report("The requested review is ready. " + "Reviewed findings. " * 20))
        receipt = rig.service.handoff(RAPHAEL, args(target), source_turn_id=source.id, language="en")
        await until(lambda: rig.task(receipt.data["task_id"]).state in ("done", "failed"))
        task = rig.task(receipt.data["task_id"])
        members.service.turn_arrived(task.turn_id)
        assert target.id in members.service.store.unread()
        members.service.store.mark_read(target.id)
        members.service.turn_arrived(rig.service._store.exchange_turn_id(task.id))
        assert target.id not in members.service.store.unread()
    finally:
        await members.close()

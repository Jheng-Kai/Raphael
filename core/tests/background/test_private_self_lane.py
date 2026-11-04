"""Long work starts in the speaker's existing private conversation, on its selected brain."""

import json
from dataclasses import replace

import pytest

from raphael_core.agent.cli.loop import CliLoop
from raphael_core.agent.conversations import Conversations
from raphael_core.agent.history import AgentHistory
from raphael_core.agent.speaker import RAPHAEL, Speaker
from raphael_core.agent.capabilities import COORDINATION_TOOLS, SHARED_CAPABILITIES
from raphael_core.brain.settings import SettingsStore
from raphael_core.worker.loop import Outcome
from .conftest import report, until
from .test_handoff import args, setup, team_of, unused


@pytest.mark.parametrize("brain", ["api", "cli"])
@pytest.mark.parametrize("routine", [False, True])
async def test_production_workers_offer_every_speaker_the_same_abilities(make_rig, monkeypatch, brain, routine):
    rig = make_rig()
    ordinary, _ = setup(rig, room=False)
    from raphael_core.members.store import MemberStore
    primary = MemberStore(rig.conn).create_member(name="Teacher", role="Teacher")
    model = "cli:codex:test" if brain == "cli" else "fake/model"
    people = [replace(RAPHAEL, capabilities=frozenset(), instructions="OWNER-WORK-CONTRACT"),
              replace(ordinary, model=model), Speaker(id=primary.id, name="Teacher", role="Teacher", capabilities=frozenset({"chief"}))]
    rig.service.use_team(team_of(*people), unused)
    captured = []
    if brain == "cli":
        rig.service.use_cli(object())
        async def work(loop):
            captured.append((loop.system, loop.tools))
            loop._queue.put_nowait(Outcome("done", final="Ready."))
        monkeypatch.setattr(CliLoop, "_work", work)
    else:
        def work(**kwargs):
            captured.append((kwargs["messages"][0]["content"], kwargs["tools"]))
            return report("Ready.")
        rig.client.replies.extend([work] * 3)
    for speaker in people:
        routine_id = MemberStore(rig.conn).create_routine(member_id=speaker.id, title="Daily parity",
            prompt="Explain your abilities.", schedule={"kind": "daily", "time": "08:00"},
            next_run_ms=rig.wall()).id if routine else None
        task_id = rig.service.submit(session_id=f"parity-{speaker.id}", text="Explain your abilities.",
                                     language="en", model=model, member_id=speaker.id, routine_id=routine_id)
        await until(lambda: rig.task(task_id).state in ("done", "failed"))
        assert rig.task(task_id).state == "done"
    offers = []
    for index, (system, tools) in enumerate(captured):
        assert system.count(SHARED_CAPABILITIES) == 1
        assert ("room_meeting" in {item["function"]["name"] for item in tools}) == (index == 2)
        offers.append({item["function"]["name"]: item["function"] for item in tools
                       if item["function"]["name"] not in COORDINATION_TOOLS})
    assert offers[0] == offers[1] == offers[2]
    assert "OWNER-WORK-CONTRACT" in captured[0][0]


@pytest.mark.parametrize("who", [0, 1])
@pytest.mark.parametrize("brain", ["api", "cli"])
async def test_self_lane_returns_to_the_same_named_conversation_once(make_rig, monkeypatch, who, brain):
    rig = make_rig()
    model = "cli:codex:test" if brain == "cli" else "fake/model"
    SettingsStore(rig.conn).set("agent_model", model)
    target, _ = setup(rig, room=False, model=model)
    speaker = target if who else replace(RAPHAEL, model=model)
    conversations = Conversations(rig.conn, rig.wall)
    main = conversations.main(who)
    named = conversations.create(who)["id"]
    history = AgentHistory(rig.conn, rig.wall)
    source = history.get(history.add(session_id="private-long-work", question="Write a detailed review.",
        route="answer", prefix="", text="", status="running", member_id=who, conversation_id=named))
    history.add(session_id="context", question="PRIVATE-NAMED-CONTEXT", route="answer", prefix="",
                text="Named context.", status="done", member_id=who, conversation_id=named)
    history.add(session_id="other", question="OTHER-CONVERSATION-SECRET", route="answer", prefix="",
                text="Other context.", status="done", member_id=who, conversation_id=main)
    seen = []
    written = "The completed review documents the design, verified behavior and remaining acceptance boundaries. " * 5
    if brain == "api":
        def worker(**kwargs):
            seen.append(str(kwargs["messages"]))
            return report(written)
        rig.client.replies.extend([worker, report("The review is complete.")])
    else:
        rig.service.use_cli(object())
        async def work(loop):
            seen.append(loop.user)
            loop._queue.put_nowait(Outcome("done", final=written))
        monkeypatch.setattr(CliLoop, "_work", work)
    receipt = rig.service.handoff(speaker, args(speaker, request="Write the review now."),
                                 source_turn_id=source.id, language="en")
    assert receipt.ok, receipt.error
    duplicate = rig.service.handoff(speaker, args(speaker, request="Write the review now."),
                                   source_turn_id=source.id, language="en")
    assert duplicate.ok and duplicate.data["duplicate"]
    task = rig.task(receipt.data["task_id"])
    private = history.get(task.turn_id)
    assert task.scope == private.scope == "private" and private.conversation_id == named
    assert task.model_ref == model and task.report_room_id is None
    assert rig.service.handoff(speaker, args(speaker, stage_id="recursive"),
        source_turn_id=private.id, language="en").error == "self_handoff"
    history.resolve(source.id, prefix="", text="The review is running.", status="done")
    rig.service.settle_asker(source.id, answered=True)
    await until(lambda: rig.task(task.id).state in ("done", "failed"))
    await until(lambda: rig.task(task.parent_task_id).state in ("done", "failed"))
    assert rig.task(task.id).state == "done"
    assert rig.task(task.parent_task_id).state == "done"
    assert "PRIVATE-NAMED-CONTEXT" in seen[0] and "OTHER-CONVERSATION-SECRET" not in seen[0]
    rig.service._deliver_handoffs()
    assert rig.conn.execute("SELECT COUNT(*) FROM task_executions WHERE task_id=?", (task.id,)).fetchone()[0] == 1
    assert json.loads(rig.task(task.id).schedule_provenance)["authorization"] == "immediate_only"


@pytest.mark.parametrize("who", [0, 1])
async def test_stopping_the_foreground_turn_cancels_its_self_lane(make_rig, monkeypatch, who):
    rig = make_rig()
    target, source = setup(rig, room=False)
    speaker = target if who else RAPHAEL
    history = AgentHistory(rig.conn, rig.wall)
    if who:
        source = history.get(history.add(session_id="self-cancel", question="Long work", route="answer",
            prefix="", text="", status="running", member_id=who))
    monkeypatch.setattr(rig.service, "_ensure_pump", lambda: None)
    receipt = rig.service.handoff(speaker, args(speaker), source_turn_id=source.id, language="en")
    assert receipt.ok
    rig.service.settle_asker(source.id, answered=False)
    assert rig.task(receipt.data["task_id"]).state == "cancelled"
    assert not rig.client.chat_calls


@pytest.mark.parametrize("who", [0, 1])
async def test_private_chat_can_move_video_into_its_own_real_worker_lane(make_rig, monkeypatch, who):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from agent.conftest import FakeActions
    from agent.test_service import Rig as AgentRig
    from raphael_core.agent.gate import ToolGate
    from raphael_core.services.generation_tools import GenerationTools
    from .conftest import call, turn

    rig = make_rig()
    target, _ = setup(rig, room=False)
    SettingsStore(rig.conn).set("agent_model", "fake/model")
    SettingsStore(rig.conn).set("video_model", "@chosen:movie")
    generation = SimpleNamespace(providers=SimpleNamespace(media_choices=lambda kind:
        [{"reference": "@chosen:movie", "media": ["video"]}] if kind == "video" else []),
        make=AsyncMock(return_value={"model": "@chosen:movie", "cost_usd": 0, "id": "synthetic-video"}))
    # Production places the per-member computer adapter between integrations and media.
    monkeypatch.setattr(rig.plugins.hub, "offered_for", lambda member: rig.plugins.hub.offered(), raising=False)
    tools = GenerationTools(rig.plugins.hub, generation, rig.conn)
    rig.service._gate = ToolGate(tools, conn=rig.conn, now_ms=rig.wall)
    agent = AgentRig(rig.conn, rig.client, FakeActions(), background=rig.service,
                     team=rig.service._team, plugins=tools)
    pump = rig.service._ensure_pump
    monkeypatch.setattr(rig.service, "_ensure_pump", lambda: None)
    speaker = target if who else RAPHAEL
    rig.client.replies.extend([
        turn(calls=[call("handoff", args(speaker, request="Generate the requested video now."))]),
        report("The video is being prepared."),
        turn(calls=[call("media__video_generate", {"prompt": "Office"})]),
        report("The requested video was generated."),
        report("The video is ready."),
    ])
    try:
        foreground = await agent.call("agent.ask", {"session_id": "chat-video", "text": "Generate an office video.",
            "source": "app", "member_id": who, "ui_language": "en"})
        assert foreground["status"] == "done"
        task = rig.service._store.handoffs(foreground["turn_id"])[0]
        assert generation.make.await_count == 0
        monkeypatch.setattr(rig.service, "_ensure_pump", pump)
        pump()
        await until(lambda: rig.task(task.id).state in ("done", "failed"))
        await until(lambda: rig.task(task.parent_task_id).state in ("done", "failed"))
        assert rig.task(task.id).state == rig.task(task.parent_task_id).state == "done", (
            rig.task(task.id).reason, rig.task(task.id).report_text,
            rig.task(task.parent_task_id).reason, generation.make.await_count,
            [message for captured in rig.client.chat_calls for message in captured["messages"] if message["role"] == "tool"])
        assert generation.make.await_count == 1
        assert task.member_id == who and task.scope == "private"
        assert agent.history.get(task.turn_id).conversation_id == agent.history.get(foreground["turn_id"]).conversation_id
        assert "background_required" not in str(rig.client.chat_calls)
    finally:
        await agent.aclose()


async def test_raphael_keeps_the_full_report_and_derives_the_overlay_caption(make_rig):
    rig = make_rig()
    written = ("The completed review preserves each finding, supporting detail and next step. " * 5).strip()
    rig.client.replies.append(report(written))
    task_id = rig.submit(language="en")
    await until(lambda: rig.task(task_id).state == "done")
    task = rig.task(task_id)
    assert task.report_detail == written
    assert task.report_text != written and written.startswith(task.report_text.rstrip("…"))
    assert rig.reports()[0]["text"] == task.report_text

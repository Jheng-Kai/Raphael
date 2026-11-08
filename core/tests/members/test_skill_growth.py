"""Growing skills remain private, bounded, revisioned and silent on reads."""

import json

import pytest
from raphael_core.agent.steps import Step
from raphael_core.agent.conversations import Conversations
from raphael_core.brain.openrouter import Completion

from raphael_core.bots.homes import HomeError
from raphael_core.protocol import RpcError

DOCUMENT = "---\nname: research-summary\ndescription: Summarize research with checked sources\n---\n" + "\n".join(
    f"## {section}\nCheck the sources." for section in ("When to use", "Procedure", "Pitfalls", "Verification"))


async def test_member_learns_updates_and_undoes_without_read_notifications(rig):
    member = (await rig.call("members.create", {"name": "Ada"}))["member"]["id"]
    cap = rig.service.capabilities
    learned = cap.manage_skill(member, {"text": DOCUMENT, "provenance": "learned"})
    assert learned["provenance"] == "learned" and learned["learned_at"]
    assert learned["revision"]
    notes = list(rig.notes)
    assert (await rig.call("members.skills.list", {"member_id": member}))["skills"] == [learned]
    assert (await rig.call("members.skills.read", {"member_id": member, "id": learned["id"]}))["text"] == DOCUMENT
    assert rig.notes == notes
    changed = cap.manage_skill(member, {"id": learned["id"], "text": DOCUMENT.replace("Check the", "Verify the"),
                                        "expected_hash": learned["revision"]})
    with pytest.raises(HomeError):
        cap.manage_skill(member, {"id": learned["id"], "text": DOCUMENT, "expected_hash": learned["revision"]})
    with pytest.raises(RpcError, match="skill changed"):
        await rig.call("members.skills.update", {"member_id": member, "id": learned["id"], "text": DOCUMENT,
                                                 "expected_hash": learned["revision"]})
    assert cap.document(member, learned["id"])[1] != DOCUMENT
    cap.undo_skills(member, cap.undo_revision(member))
    assert cap.document(member, learned["id"])[1] == DOCUMENT
    cap.delete_skill(member, learned["id"])
    cap.undo_skills(member, cap.undo_revision(member))
    assert cap.document(member, learned["id"])[1] == DOCUMENT
    other = (await rig.call("members.create", {"name": "Other"}))["member"]["id"]
    assert rig.service.skill_read(other, learned["name"]) is None


async def test_generated_skill_requires_sections_and_bounded_safe_references(rig):
    cap = rig.service.capabilities
    with pytest.raises(ValueError):
        cap.manage_skill(0, {"text": DOCUMENT.replace("## Pitfalls", "## Other")})
    with pytest.raises(ValueError):
        cap.manage_skill(0, {"text": DOCUMENT, "references": {"../../SOUL.md": "bad"}})
    assert cap.skills(0) == []
    skill = cap.manage_skill(0, {"text": DOCUMENT, "references": {"sources.md": "Owner workflow"}})
    assert "Owner workflow" in cap.read_skill(0, skill["name"])


async def test_learning_distinguishes_creation_content_and_reference_updates_from_identical_writes(rig):
    member = (await rig.call("members.create", {"name": "Ada"}))["member"]["id"]
    service = rig.service
    turn = service._history.add(session_id="skills", question="Learn", route="answer", prefix="", text="", status="running", member_id=member)
    def events():
        return [json.loads(m["text"]) for m in service._history.messages([turn])[turn] if m["kind"] == "event"]
    skill = service.learn_skill(member, {"text": DOCUMENT, "references": {"sources.md": "Check one source"}}, turn)
    assert events() == [{"type": "skill_learned", "name": "research-summary", "action": "created"}]
    updated = DOCUMENT.replace("Check the", "Verify the")
    skill = service.learn_skill(member, {"id": skill["id"], "expected_hash": skill["revision"], "text": updated}, turn)
    assert [e["action"] for e in events()] == ["created", "updated"]
    skill = service.learn_skill(member, {"id": skill["id"], "expected_hash": skill["revision"], "text": updated}, turn)
    assert len(events()) == 2
    skill = service.learn_skill(member, {"id": skill["id"], "expected_hash": skill["revision"], "text": updated,
                                        "references": {"sources.md": "Check two sources"}}, turn)
    assert [e["action"] for e in events()] == ["created", "updated", "updated"]
    service.learn_skill(member, {"id": skill["id"], "expected_hash": skill["revision"], "text": updated,
                                 "references": {"sources.md": "Check two sources"}}, turn)
    assert len(events()) == 3


async def test_newline_normalization_and_learning_provenance_alone_do_not_make_a_skill_event(rig):
    cap = rig.service.capabilities
    skill = cap.keep_skill(0, "owner/repository", DOCUMENT.replace("\n", "\r\n"))
    turn = rig.service._history.add(session_id="skills", question="Keep", route="answer", prefix="", text="", status="running")
    learned = rig.service.learn_skill(0, {"id": skill["id"], "expected_hash": skill["revision"], "text": DOCUMENT}, turn)
    assert learned["provenance"] == "learned"
    assert not rig.service._history.messages([turn]).get(turn)


async def test_learning_an_imported_skill_preserves_source_and_undo_restores_crlf(rig):
    cap = rig.service.capabilities
    original = DOCUMENT.replace("\n", "\r\n")
    skill = cap.keep_skill(0, "owner/repository", original)
    learned = cap.manage_skill(0, {"id": skill["id"], "expected_hash": skill["revision"], "text": DOCUMENT + "\nNew reusable check."})
    assert learned["source"] == "owner/repository" and learned["provenance"] == "learned"
    assert learned["learned_at"]
    cap.undo_skills(0, cap.undo_revision(0))
    assert cap._path(0, skill["id"]).read_bytes() == original.encode("utf-8")
    assert cap.skills(0)[0]["provenance"] == "imported"


async def test_undo_never_overwrites_an_unjournaled_document_edit(rig):
    cap = rig.service.capabilities
    skill = cap.manage_skill(0, {"text": DOCUMENT})
    revision = cap.undo_revision(0)
    path = cap._path(0, skill["id"])
    path.write_text("External edit", encoding="utf-8")
    with pytest.raises(HomeError, match="changed"):
        cap.undo_skills(0, revision)
    assert path.read_text(encoding="utf-8") == "External edit"


async def test_review_counts_thread_tools_uses_member_brain_and_reuses_skill(rig):
    member = (await rig.call("members.create", {"name": "Ada", "model": "test/member"}))["member"]["id"]
    history = rig.service._history
    conversation = Conversations(rig.conn).main(member)
    def turn(count):
        return history.add(session_id="skills", question="Summarize checked research", route="answer", prefix="", text="Checked summary", status="done", member_id=member, conversation_id=conversation,
                           steps=[Step("tool", "local_time", "Raphael", "ok", 0) for _ in range(count)])
    calls = []
    changes = [{"text": DOCUMENT}]
    class Brain:
        async def complete_json(self, **kwargs):
            calls.append(kwargs)
            return Completion(data={"changes": changes}, model=kwargs["model"], cost_usd=0, prompt_tokens=0, completion_tokens=0, latency_ms=0)
    rig.memory._base_client = Brain()
    turn(9)
    reviewer = rig.memory.skill_review
    assert not reviewer.due()
    last = turn(1)
    assert reviewer.due()
    await reviewer.run_due()
    assert len(calls) == 1 and calls[0]["model"] == "test/member"
    assert "No tools" in calls[0]["system"]
    assert not reviewer.due()
    skill = rig.service.enabled_skills(member)[0]
    assert rig.service.skill_read(member, skill["name"]) == DOCUMENT
    messages = history.messages([last])[last]
    assert any('"type": "skill_learned"' in m["text"] for m in messages)
    assert [json.loads(m["text"])["action"] for m in messages if m["kind"] == "event"] == ["created"]
    updated = DOCUMENT.replace("Check the", "Verify the")
    for text, actions in ((updated, ["updated"]), (updated, [])):
        changes[:] = [{"id": skill["id"], "text": text}]
        last = turn(10)
        await reviewer.run_due()
        messages = history.messages([last]).get(last, [])
        assert [json.loads(m["text"])["action"] for m in messages if m["kind"] == "event"] == actions
        assert not reviewer.due()


async def test_review_pauses_after_three_failures_and_recovers_after_restart(rig, monkeypatch):
    history = rig.service._history
    history.add(session_id="skills", question="Work", route="answer", prefix="", text="Done", status="done",
                conversation_id=Conversations(rig.conn).main(0), steps=[Step("tool", "local_time", "Raphael", "ok", 0) for _ in range(10)])
    reviewer = rig.memory.skill_review
    for _ in range(3):
        assert reviewer.due()
        await reviewer.run_due()
    assert not reviewer.due()
    from raphael_core.members.skill_review import SkillReview
    assert not SkillReview(rig.service, rig.memory).due()
    assert rig.memory.health()["status"] == "attention"
    later = rig.memory._now_ms() + 6 * 3600_000 + 1
    monkeypatch.setattr(rig.memory, "_now_ms", lambda: later)
    recovered = SkillReview(rig.service, rig.memory)
    assert recovered.due()
    class Brain:
        async def complete_json(self, **kwargs):
            return Completion(data={"changes": [{"text": DOCUMENT}]}, model=kwargs["model"], cost_usd=0,
                              prompt_tokens=0, completion_tokens=0, latency_ms=0)
    rig.memory._base_client = Brain()
    await recovered.run_due()
    assert not recovered.due() and rig.memory.health()["status"] == "ok"


@pytest.mark.parametrize("reference", ["@chatgpt:gpt-6-luna?effort=high", "cli:claude", "cli:codex", "cli:gemini"])
async def test_subscription_skill_review_writes_using_real_memory_brain(rig, monkeypatch, reference):
    import json
    from raphael_core.agent.cli.loop import CliLoop
    from raphael_core.brain.openrouter import TextCompletion
    from raphael_core.brain.providers.chatgpt import ChatGPTProvider
    from raphael_core.worker.loop import Outcome

    member = (await rig.call("members.create", {"name": "Sub writer", "model": reference}))["member"]["id"]
    rig.service._history.add(session_id="skills", question="Check research sources", route="answer", prefix="", text="Checked sources", status="done",
        member_id=member, conversation_id=Conversations(rig.conn).main(member),
        steps=[Step("tool", "local_time", "Raphael", "ok", 0) for _ in range(10)])
    class Brains:
        def available(self, name):
            return True
    rig.memory._cli_brains = Brains()
    plan = json.dumps({"changes": [{"text": DOCUMENT}]})
    async def answer(loop):
        loop._queue.put_nowait(Outcome("done", final=plan))
    monkeypatch.setattr(CliLoop, "_work", answer)
    provider = ChatGPTProvider(None)
    async def chat(**kwargs):
        return TextCompletion(plan, kwargs["model"], 0, 0, 0, 0, [])
    monkeypatch.setattr(provider, "chat_text", chat)
    rig.memory._base_client = provider
    await rig.memory.skill_review.run_due()
    assert len(rig.service.enabled_skills(member)) == 1
    assert not rig.memory.skill_review.due()

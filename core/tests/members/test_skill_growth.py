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


# Skill learning follows Hermes Agent's nudge (R-SKILL-09, R-SKILL-10): real work counts, a review is rare, and a skill is not a diary.
# 
# Owner, 2026-11-11: "他現在一直建立 skills，我覺得可能不太好…參考一下 Hermes agents，然後把他們的邏輯行為拿過來".

import logging

HOURS = 3600_000


def skill_document(name="research-summary", description="Summarize research with checked sources", body="Check the sources."):
    return f"---\nname: {name}\ndescription: {description}\n---\n" + "\n".join(
        f"## {section}\n{body}" for section in ("When to use", "Procedure", "Pitfalls", "Verification"))


OTHER = skill_document("invoice-filing", "Sort scanned invoices into the monthly folders", "File each invoice.")


def work(count, tool="web_search"):
    return [Step("tool", tool, "Raphael", "ok", 0) for _ in range(count)]


class Desk:
    """A member with a thread, the turns it had, and a memory whose brain answers with `changes`."""

    def __init__(self, rig, member):
        self.rig, self.member = rig, member
        self.conversation = Conversations(rig.conn).main(member)
        self.history = rig.service._history
        self.changes = []
        self.calls = []
        desk = self

        class Brain:
            async def complete_json(self, **kwargs):
                desk.calls.append(kwargs)
                return Completion(data={"changes": desk.changes}, model=kwargs["model"], cost_usd=0, prompt_tokens=0, completion_tokens=0, latency_ms=0)
        rig.memory._base_client = Brain()
        self.clock = [rig.memory._now_ms()]
        rig.memory._now_ms = lambda: self.clock[0]

    def turn(self, steps=0, *, status="done", route="answer", source="voice", tool="web_search", member=None):
        return self.history.add(
            session_id="skills", question="Summarize checked research", route=route, prefix="", text="Checked summary", status=status,
            source=source, member_id=self.member if member is None else member, conversation_id=self.conversation,
            steps=work(steps, tool) if isinstance(steps, int) else steps)

    def due(self):
        """Whether a review of this member is due (`review.due()` is for the whole team)."""
        return self.review.pending(self.member) is not None

    def wait(self, hours):
        self.clock[0] += int(hours * HOURS)

    @property
    def review(self):
        return self.rig.memory.skill_review

    async def run(self):
        await self.review.run_due()

    def events(self, turn):
        return [json.loads(m["text"])["action"] for m in self.history.messages([turn]).get(turn, []) if m["kind"] == "event"]


async def desk_for(rig, name="Ada"):
    member = (await rig.call("members.create", {"name": name, "model": "test/member"}))["member"]["id"]
    return Desk(rig, member)


async def test_twelve_chat_turns_without_work_never_start_a_review(rig):
    desk = await desk_for(rig)
    for _ in range(12):
        desk.turn(0)
    assert not desk.review.due()
    # Reading skills, memory, the time or the team is not work either, however often it happens.
    for tool in ("skill_read", "skills_list", "memory_update", "memory_log", "session_search", "local_time", "self_check", "team_overview"):
        desk.turn(5, tool=tool)
    assert not desk.review.due() and not desk.calls


async def test_review_counts_real_work_across_turns_uses_the_member_brain_and_logs(rig, caplog):
    desk = await desk_for(rig)
    desk.changes = [{"text": skill_document()}]
    desk.turn(4)
    desk.turn(5)
    assert not desk.review.due()
    last = desk.turn(1)
    assert desk.review.due()
    caplog.set_level(logging.INFO, logger="raphael_core.members.service")
    await desk.run()
    assert len(desk.calls) == 1 and desk.calls[0]["model"] == "test/member"
    assert "No tools" in desk.calls[0]["system"] and "Be ACTIVE" not in desk.calls[0]["system"]
    assert not desk.review.due()
    skill = rig.service.enabled_skills(desk.member)[0]
    assert rig.service.skill_read(desk.member, skill["name"]) == skill_document()
    assert desk.events(last) == ["created"]
    # Counted from the log without reading a skill: the member, the name, created or updated, where it came from.
    assert f"Skill created: member={desk.member} skill=research-summary source=review" in caplog.text
    assert "Check the sources" not in caplog.text


async def test_a_review_is_six_hours_after_the_last_and_nothing_is_saved_by_default(rig):
    desk = await desk_for(rig)
    desk.turn(10)
    await desk.run()
    assert len(desk.calls) == 1 and rig.service.enabled_skills(desk.member) == []  # an empty answer is the usual one
    desk.turn(10)
    assert not desk.review.due()
    desk.wait(6 - 0.01)
    assert not desk.review.due()
    desk.wait(0.02)
    assert desk.review.due()
    await desk.run()
    assert len(desk.calls) == 2


async def test_skill_manage_restarts_the_count(rig):
    desk = await desk_for(rig)
    desk.turn(9)
    desk.turn(work(3) + [Step("tool", "skill_manage", "Raphael", "ok", 0)])
    desk.turn(5)
    assert not desk.review.due()
    desk.turn(5)
    assert desk.review.due()


async def test_routine_exchange_and_interrupted_turns_never_start_a_review(rig):
    routine = await desk_for(rig, "Routine")
    for _ in range(3):
        routine.turn(4, route="routine", source="routine")
    assert not routine.due()
    exchange = await desk_for(rig, "Exchange")
    for _ in range(3):
        exchange.turn(4, route="exchange", source="member")
    assert not exchange.due()
    # Work was done, but the turn that just ended did not finish normally, or is a routine's or a colleague's.
    for status in ("cancelled", "error", "running"):
        stopped = await desk_for(rig, status)
        stopped.turn(12)
        assert stopped.due()
        stopped.turn(0, status=status)
        assert not stopped.due(), status
        stopped.turn(0)  # the next turn that finishes normally decides
        assert stopped.due(), status
    ran = await desk_for(rig, "Ran")
    ran.turn(12)
    ran.turn(0, route="routine", source="routine")
    assert not ran.due()
    ran.turn(0)
    assert ran.due()


async def test_one_new_skill_a_day_and_changes_are_not_capped(rig, monkeypatch):
    desk = await desk_for(rig)
    desk.changes = [{"text": skill_document()}]
    desk.turn(10)
    await desk.run()
    [first] = rig.service.enabled_skills(desk.member)
    # A second, different new skill the same day is left out; the review did not fail.
    desk.wait(7)
    desk.changes = [{"text": OTHER}]
    desk.turn(10)
    await desk.run()
    assert [s["name"] for s in rig.service.enabled_skills(desk.member)] == ["research-summary"]
    assert rig.memory._state(desk.review._key(desk.member, "failures")) == 0
    # A change to the skill it has is never capped.
    desk.wait(7)
    desk.changes = [{"id": first["id"], "text": skill_document(body="Verify the sources.")}]
    desk.turn(10)
    last = desk.turn(0)
    await desk.run()
    assert desk.events(last) == ["updated"]
    # A new day: the window has passed.
    import raphael_core.members.skills as skills
    monkeypatch.setattr(skills, "NEW_SKILL_WINDOW", skills.timedelta(seconds=-1))
    desk.wait(7)
    desk.changes = [{"text": OTHER}]
    desk.turn(10)
    await desk.run()
    assert sorted(s["name"] for s in rig.service.enabled_skills(desk.member)) == ["invoice-filing", "research-summary"]


async def test_the_tool_also_refuses_a_second_new_skill_in_a_day_and_a_near_duplicate(rig):
    desk = await desk_for(rig)
    service = rig.service
    service.learn_skill(desk.member, {"text": skill_document()})
    with pytest.raises(HomeError, match="similar skill already exists.*research-summary"):
        service.learn_skill(desk.member, {"text": skill_document("research-summary-notes", "Summarise research with sources checked")})
    with pytest.raises(HomeError, match="already learned in the last day"):
        service.learn_skill(desk.member, {"text": OTHER})
    # The owner's own skill and an imported one are not held back.
    service.learn_skill(desk.member, {"text": OTHER, "provenance": "owner"})


async def test_a_new_skill_near_an_existing_one_becomes_a_change_to_it(rig):
    desk = await desk_for(rig)
    desk.changes = [{"text": skill_document()}]
    desk.turn(10)
    await desk.run()
    desk.wait(7)
    near = skill_document("research-summary-guide", "Summarize research with checked sources and links", "Check the sources and the links.")
    desk.changes = [{"text": near}]
    desk.turn(10)
    last = desk.turn(0)
    await desk.run()
    skills = rig.service.enabled_skills(desk.member)
    assert [s["name"] for s in skills] == ["research-summary"]  # one skill, its name kept
    assert "and the links" in rig.service.skill_read(desk.member, "research-summary")
    assert desk.events(last) == ["updated"]


async def test_the_review_sees_every_skill_and_may_update_one_whose_text_did_not_fit(rig, monkeypatch):
    import raphael_core.members.skill_review as review
    desk = await desk_for(rig)
    cap = rig.service.capabilities
    old = cap.manage_skill(desk.member, {"text": skill_document(body="x" * 300)})
    cap.manage_skill(desk.member, {"text": OTHER, "provenance": "owner"})
    monkeypatch.setattr(review, "BODY_BUDGET", 100)  # no document fits
    desk.changes = [{"id": old["id"], "text": skill_document(body="Verify the sources.")}]
    desk.turn(10)
    await desk.run()
    payload = json.loads(desk.calls[0]["user"])
    assert {s["name"] for s in payload["skills"]} == {"research-summary", "invoice-filing"}
    assert all(s["description"] and s["body_included"] is False for s in payload["skills"]) and payload["complete_documents"] == []
    assert payload["new_skill_allowed"] is False
    assert "Verify the sources." in rig.service.skill_read(desk.member, "research-summary")


async def test_the_review_prompt_is_hermes_discipline_without_its_eagerness():
    from raphael_core.members.skill_review import NUDGE_INTERVAL, SYSTEM
    assert NUDGE_INTERVAL == 10
    assert "default answer is no change" in SYSTEM and 'return {"changes": []}' in SYSTEM
    assert "Be ACTIVE" not in SYSTEM and "most sessions" not in SYSTEM
    for rule in ("Update the skill that was used", "Update another existing skill", "Only when no listed skill covers the class",
                 "never a ticket, an error text", "claims that a tool or feature", "one-off task"):
        assert rule in SYSTEM


def test_near_names_and_descriptions_are_found_without_a_model():
    from raphael_core.members.skill_names import similar_skill
    existing = [{"name": "taichung-weather", "description": "Look up the weather in Taichung"},
                {"name": "invoice-filing", "description": "Sort scanned invoices into the monthly folders"}]
    assert similar_skill("taichung-weather-guide", "x", existing)["name"] == "taichung-weather"  # a generic word does not make a name
    assert similar_skill("weathers", "x", existing)["name"] == "taichung-weather"  # one word of two, stemmed
    assert similar_skill("filing-invoices", "x", existing)["name"] == "invoice-filing"
    assert similar_skill("rain-lookup", "Look up the weather in Taichung quickly", existing)["name"] == "taichung-weather"  # the description
    assert similar_skill("rain-lookup", "查詢台中天氣預報", [{"name": "tw", "description": "查詢台中天氣預報資料"}])["name"] == "tw"
    assert similar_skill("git-rebase", "Rebase a branch", existing) is None
    assert similar_skill("email-draft", "Draft the reply", [{"name": "email-triage", "description": "Sort the inbox by sender"}]) is None


async def test_review_pauses_after_three_failures_and_recovers_after_restart(rig):
    desk = await desk_for(rig)
    from raphael_core.members.skill_review import SkillReview
    class Failing:
        async def complete_json(self, **kwargs):
            raise AssertionError("the memory's model failed")
    rig.memory._base_client = Failing()
    for attempt in range(3):
        if attempt:
            desk.wait(6.01)
        desk.turn(10)
        assert desk.review.due()
        await desk.run()
    desk.turn(10)
    assert not desk.review.due()  # three failures: paused for six hours more
    assert not SkillReview(rig.service, rig.memory).due()
    assert rig.memory.health()["status"] == "attention"
    desk.wait(6.01)
    recovered = SkillReview(rig.service, rig.memory)
    assert recovered.due()
    desk.changes = [{"text": skill_document()}]
    class Brain:
        async def complete_json(self, **kwargs):
            return Completion(data={"changes": desk.changes}, model=kwargs["model"], cost_usd=0,
                              prompt_tokens=0, completion_tokens=0, latency_ms=0)
    rig.memory._base_client = Brain()
    await recovered.run_due()
    assert not recovered.due() and rig.memory.health()["status"] == "ok"


async def test_marks_kept_per_conversation_by_the_earlier_version_are_carried_over(rig):
    desk = await desk_for(rig)
    member, memory = desk.member, rig.memory
    memory._set_state(f"skills:{member}:7:through", 5)
    memory._set_state(f"skills:{member}:7:failures", 7)
    memory._set_state(f"skills:{member}:7:retry_at", 10**15)
    assert memory.health()["status"] == "attention"
    from raphael_core.members.skill_review import SkillReview
    SkillReview(rig.service, memory)
    assert memory._state(f"skills:{member}:through") == 5
    assert memory.health()["status"] == "ok"  # the old failure marks no longer keep it at "attention"
    assert rig.conn.execute("SELECT key FROM memory_state WHERE key LIKE 'skills:%:%:%'").fetchall() == []


@pytest.mark.parametrize("reference", ["@chatgpt:gpt-6-luna?effort=high", "cli:claude", "cli:codex", "cli:gemini"])
async def test_subscription_skill_review_writes_using_real_memory_brain(rig, monkeypatch, reference):
    import json
    from raphael_core.agent.cli.loop import CliLoop
    from raphael_core.brain.openrouter import TextCompletion
    from raphael_core.brain.providers.chatgpt import ChatGPTProvider
    from raphael_core.worker.loop import Outcome

    member = (await rig.call("members.create", {"name": "Sub writer", "model": reference}))["member"]["id"]
    rig.service._history.add(session_id="skills", question="Check research sources", route="answer", prefix="", text="Checked sources", status="done",
        member_id=member, conversation_id=Conversations(rig.conn).main(member), steps=work(10))
    class Brains:
        def available(self, name):
            return True
    rig.memory._cli_brains = Brains()
    plan = json.dumps({"changes": [{"text": skill_document()}]})
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

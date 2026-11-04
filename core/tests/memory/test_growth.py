"""Memory growth contracts: privacy, silent reads and bounded recall."""

import pytest

from raphael_core.agent.conversations import Conversations
from raphael_core.agent.harness_tools import DEFINITIONS
from raphael_core.brain.secrets import MemoryKeyStore
from raphael_core.memory.service import MemoryService

from .conftest import FakeModel, add_turn


@pytest.fixture
async def growing(conn, tmp_path, clock):
    events = []
    service = MemoryService(conn, tmp_path / "memory", FakeModel(), MemoryKeyStore(),
                            now=clock.now, now_ms=clock.ms,
                            notify=lambda *event: events.append(event))
    assert events == []  # lazy reads and service construction never announce a change
    yield service, events
    await service.aclose()


def test_new_tools_use_the_shared_harness_registry():
    assert {"memory_update", "memory_log", "session_search", "session_read"} <= DEFINITIONS.keys()


async def test_a_daily_log_is_private_searchable_and_reads_never_notify(growing):
    memory, events = growing
    assert memory.log_memory(2, {"body": "Review uses amber."}).ok
    assert events
    events.clear()
    for _ in range(3):
        assert "amber" not in str(memory.snapshot(2))  # a log is never in the prompt
        assert memory.session_search(2, "amber").data["hits"]
        assert "amber" in memory.recall(2, "amber")
        hit = memory.session_search(2, "amber").data["hits"][0]["id"]
        assert memory.session_read(2, hit).ok
        assert not memory.session_search(3, "amber").data["hits"]
        assert not memory.session_read(3, hit).ok
    assert events == []


async def test_a_log_written_after_outside_content_is_marked_and_read_back_as_untrusted(growing):
    memory, _ = growing
    assert memory.log_memory(2, {"body": "The page says the review passed."}, untrusted=True).ok
    found = memory.session_search(2, "review")
    assert found.untrusted and "（待確認）" in found.data["hits"][0]["text"]
    assert memory.recall_result(2, "review")[1] is True
    assert memory.log_memory(3, {"body": "The review passed."}).ok
    assert not memory.session_search(3, "review").untrusted


async def test_recall_finds_turn_one_at_turn_twenty_five_without_other_members(growing, history):
    memory, events = growing
    first = add_turn(history, "The project passphrase is marigold.")
    for n in range(23):
        add_turn(history, f"Unrelated step {n}.")
    history.add(session_id="other", member_id=2, question="marigold private-violet", prefix="", text="secret", route="chat", status="done")
    events.clear()
    recall = memory.recall(0, "project passphrase")
    assert "marigold" in recall and "private-violet" not in recall
    assert len(recall) <= 6000
    assert not memory.session_read(2, f"turn:{first}").ok
    assert events == []


async def test_quick_context_keeps_complete_conversation_below_half_window(growing, history):
    memory, _ = growing
    for n in range(24):
        add_turn(history, f"step {n}")
    context = memory.conversation.context(quick=True, context_window=32000)
    assert len(context.turns) == 24


async def test_room_reads_exclude_own_private_facts_and_tool_body_is_bounded(growing, history):
    memory, events = growing
    assert not memory.log_memory(1, {"body": "x" * 1001}).ok
    assert memory.log_memory(1, {"body": "Private heliotrope."}).ok
    history.add(session_id="s", member_id=1, question="Private heliotrope", prefix="", text="Private result", route="chat", status="done")
    log = memory.session_search(1, "heliotrope").data["hits"]
    assert any(hit["id"].startswith("own:") for hit in log)
    events.clear()
    assert not memory.session_search(1, "heliotrope", private=False).data["hits"]
    assert not memory.session_read(1, next(hit["id"] for hit in log if hit["id"].startswith("own:")), private=False).ok
    assert memory.recall_result(1, "heliotrope", private=False)[0] == ""
    assert not events


async def test_recall_stays_in_current_thread_while_explicit_search_can_find_own_other_threads(growing, history, conn):
    memory, events = growing
    conversations = Conversations(conn)
    formal, quick = conversations.main(), conversations.quick()
    history.add(session_id="formal", member_id=0, conversation_id=formal, question="Formal amber code", prefix="", text="Amber", route="chat", status="done")
    events.clear()
    assert memory.recall_result(0, "amber", conversation_id=quick)[0] == ""
    assert "amber" in memory.recall_result(0, "amber", conversation_id=formal)[0]
    assert memory.session_search(0, "amber").data["hits"]
    assert not events


async def test_room_search_and_read_recheck_membership(growing, conn):
    memory, events = growing
    with conn:
        room = conn.execute("INSERT INTO rooms(name,created) VALUES ('Review',0)").lastrowid
        conn.execute("INSERT INTO room_members(room_id,member_id) VALUES (?,2)", (room,))
        identifier = conn.execute("INSERT INTO room_messages(room_id,text,created) VALUES (?,'Room heliotrope',0)", (room,)).lastrowid
    events.clear()
    assert memory.session_read(2, f"room:{identifier}").ok
    assert memory.session_search(2, "heliotrope").data["hits"]
    assert not memory.session_read(3, f"room:{identifier}").ok
    with conn:
        conn.execute("DELETE FROM room_members WHERE room_id=? AND member_id=2", (room,))
    assert not memory.session_read(2, f"room:{identifier}").ok
    assert not memory.session_search(2, "heliotrope").data["hits"]
    assert not events


async def test_private_capture_uses_member_brain_confidence_and_deduplication(growing, conn, history):
    from raphael_core.members.store import MemberStore
    memory, _ = growing
    member = MemberStore(conn).create_member(name="Alice", model="@local:memory")
    action = {"target": "memory", "action": "add", "content": "The member completed the review.", "old_text": "", "confidence": 0.9}
    model = FakeModel({"actions": [action, {**action, "content": "A guess about something.", "confidence": 0.5}]}, {"actions": [action]})
    memory._base_client = model
    history.add(session_id="s", member_id=member.id, question="Review the project.", prefix="", text="Review complete.", route="chat", status="done")
    applied = await memory.reflect(member.id)
    assert applied.written == ["memory"]
    assert memory.own(member.id).read().strip() == "The member completed the review." and memory.shared.read() == ""
    assert model.calls[0]["model"] == "@local:memory" and model.calls[0]["fallbacks"] == []
    history.add(session_id="s", member_id=member.id, question="Review again.", prefix="", text="Same result.", route="chat", status="done")
    await memory.reflect(member.id)
    assert memory.own(member.id).read().strip() == "The member completed the review."


async def test_cli_capture_uses_toolless_subscription_loop(growing, monkeypatch):
    from types import SimpleNamespace
    from raphael_core.memory.brain import MemoryBrain
    from raphael_core.agent.cli import loop as cli
    # Import the background adapter before replacing its production loop source;
    # otherwise its module-level alias would retain this test's fake afterward.
    from raphael_core.background.cli import RoomCliSessions
    memory, _ = growing
    calls = []
    class FakeLoop:
        def __init__(self, **kwargs):
            calls.append(kwargs)
        async def run(self):
            return SimpleNamespace(kind="done", final='{"actions": []}')
        async def aclose(self):
            pass
    monkeypatch.setattr(cli, "CliLoop", FakeLoop)
    memory._cli_brains = object()
    result = await MemoryBrain(memory, 2).complete_json(model="cli:codex", system="Capture", user="Own turns", schema={"type": "object"})
    assert result.data == {"actions": []} and result.cost_usd == 0
    assert calls[0]["tools"] == [] and calls[0]["member_id"] == 2
    assert calls[0]["brains"] is memory._cli_brains and calls[0]["resume_session"] is False


async def test_first_bots_cli_brain_handles_background_consolidation_without_api(growing, monkeypatch):
    from types import SimpleNamespace
    from raphael_core.agent.cli import loop as cli

    memory, _ = growing
    memory._settings.set("agent_model", "cli:codex")
    memory._keys.set("api-key-that-must-not-be-used")
    memory.own(0).edit_document("\n\n".join(f"Build {n} of the project uses the amber pipeline here" for n in range(40)), None)
    calls = []

    class Brains:
        def available(self, name):
            return name == "codex"

    class Loop:
        def __init__(self, **kwargs):
            calls.append(kwargs)
        async def run(self):
            return SimpleNamespace(kind="done", final='{"actions": []}')
        async def aclose(self):
            pass

    async def forbidden(**kwargs):
        pytest.fail("Background memory called the API instead of the first Bot's CLI")

    memory._cli_brains = Brains()
    monkeypatch.setattr(cli, "CliLoop", Loop)
    monkeypatch.setattr(memory._base_client, "complete_json", forbidden)
    assert not (await memory.consolidate()).failed
    assert calls and all(call["model"] == "cli:codex" and call["tools"] == [] for call in calls)


@pytest.mark.parametrize("kind, final", [("error", ""), ("done", "not JSON"), ("done", "```json")])
async def test_cli_memory_failure_is_not_reported_as_an_openrouter_call(growing, monkeypatch, kind, final):
    from types import SimpleNamespace
    from raphael_core.agent.cli import loop as cli
    from raphael_core.memory.brain import MemoryBrain, MemoryBrainError

    memory, _ = growing

    class Loop:
        def __init__(self, **kwargs):
            assert kwargs["tools"] == [] and kwargs["resume_session"] is False
        async def run(self):
            return SimpleNamespace(kind=kind, final=final)
        async def aclose(self):
            pass

    async def forbidden(**kwargs):
        pytest.fail("A CLI failure fell back to the API")

    monkeypatch.setattr(cli, "CliLoop", Loop)
    monkeypatch.setattr(memory._base_client, "complete_json", forbidden)
    with pytest.raises(MemoryBrainError):
        await MemoryBrain(memory, 1).complete_json(model="cli:codex", system="Tidy", user="Private notes", schema={})


async def test_owner_fact_and_web_fact_in_one_batch_have_separate_trust(growing):
    memory, _ = growing
    result = memory.update_memory(2, {"target": "memory", "operations": [
        {"action": "add", "content": "The owner prefers concise answers."},
        {"action": "add", "content": "The observatory opens in December."},
    ]}, untrusted=True, owner_text="I prefer concise answers. Please check the observatory website.")
    assert result.ok
    assert memory.own(2).entries() == ["The owner prefers concise answers.", "（待確認）The observatory opens in December."]


async def test_searching_own_clean_history_does_not_taint_the_next_note(growing, history):
    memory, _ = growing
    add_turn(history, "I prefer amber notebooks.", "Understood.")
    found = memory.session_search(0, "notebooks")
    assert found.ok and not found.untrusted
    assert not memory.session_read(0, found.data["hits"][0]["id"]).untrusted


async def test_a_done_cli_failure_keeps_its_kind_and_never_parses_the_owner_message(growing, monkeypatch):
    from types import SimpleNamespace
    from raphael_core.agent.cli import loop as cli
    from raphael_core.memory.brain import MemoryBrain, MemoryBrainError
    from raphael_core.failures import Failure

    memory, _ = growing
    class Loop:
        failure = "usage_limit"
        failure_reason = Failure("usage_limit", "synthetic private provider text")
        def __init__(self, **kwargs):
            pass
        async def run(self):
            return SimpleNamespace(kind="done", final="A friendly quota message, not JSON")
        async def aclose(self):
            pass
    monkeypatch.setattr(cli, "CliLoop", Loop)
    with pytest.raises(MemoryBrainError) as caught:
        await MemoryBrain(memory, 1).complete_json(model="cli:claude", system="Tidy", user="Own turns", schema={})
    assert caught.value.kind == "usage_limit"
    assert "private" not in str(caught.value)


def test_every_memory_writer_includes_the_same_doctrine():
    from raphael_core.agent.persona import _MEMORY_EDITS
    from raphael_core.memory.doctrine import DOCTRINE
    from raphael_core.memory.growth import DEFINITIONS
    from raphael_core.memory.reflection import _REFLECT_SYSTEM, _CONSOLIDATE_SYSTEM
    from raphael_core.members.skill_review import SYSTEM

    for prompt in (_MEMORY_EDITS, DEFINITIONS["memory_update"]["description"], _REFLECT_SYSTEM, _CONSOLIDATE_SYSTEM, SYSTEM):
        assert DOCTRINE in prompt
        assert "negative capability claims" in prompt
        assert "Task lessons and reusable procedures belong in skills" in prompt
        assert "decisions and work outcomes" not in prompt


@pytest.mark.parametrize("owner_text", ["I do not prefer concise answers.", "A web page says I prefer concise answers.", "Please read the attachment."])
async def test_unrelated_or_negated_owner_words_cannot_confirm_a_note(growing, owner_text):
    memory, _ = growing
    result = memory.update_memory(2, {"operations": [{"action": "add", "content": "The owner prefers concise answers."}]},
                                  untrusted=True, owner_text=owner_text)
    assert result.ok and memory.own(2).entries() == ["（待確認）The owner prefers concise answers."]


async def test_a_model_cannot_confirm_an_existing_claim_without_the_owners_words(growing):
    memory, _ = growing
    claim = "The owner prefers amber notebooks."
    args = {"operations": [{"action": "add", "content": claim}]}
    assert memory.update_memory(2, args, untrusted=True).ok
    assert memory.update_memory(2, args).ok
    assert memory.own(2).entries() == ["（待確認）" + claim]
    assert not memory.update_memory(2, {"operations": [{"action": "replace", "old_text": "（待確認）" + claim, "content": claim}]}).ok
    assert memory.own(2).entries() == ["（待確認）" + claim]
    assert memory.update_memory(2, args, untrusted=True, owner_text="I prefer amber notebooks.").ok
    assert memory.own(2).entries() == [claim]


async def test_moving_a_claim_to_shared_memory_does_not_confirm_it(growing):
    memory, _ = growing
    claim = "The owner prefers amber notebooks."
    operations = [{"action": "add", "content": claim}]
    assert memory.update_memory(2, {"operations": operations}, untrusted=True).ok
    assert memory.update_memory(2, {"target": "user", "operations": operations}).ok
    assert memory.shared.entries()[0].startswith("（待確認）" + claim)


async def test_removing_then_adding_a_claim_in_one_batch_does_not_confirm_it(growing):
    memory, _ = growing
    claim = "The owner prefers amber notebooks."
    assert memory.update_memory(2, {"operations": [{"action": "add", "content": claim}]}, untrusted=True).ok
    assert memory.update_memory(2, {"operations": [
        {"action": "remove", "old_text": claim}, {"action": "add", "content": claim}]}).ok
    assert memory.own(2).entries() == ["（待確認）" + claim]

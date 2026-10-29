"""Memory growth contracts: privacy, silent reads, bounded recall and owner review."""

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


async def test_autonomous_write_is_private_and_reads_never_notify(growing):
    memory, events = growing
    result = memory.update_memory(2, {"op": "add", "name": "reference-review", "body": "Review uses amber.",
                                      "space": "shared"})
    assert result.ok
    assert memory.store_for(2).get("reference-review")
    assert not memory.shared.all()
    assert events
    events.clear()
    for _ in range(3):
        assert "amber" in str(memory.index(2))
        assert memory.session_search(2, "amber").data["hits"]
        assert "amber" in memory.recall(2, "amber")
        assert memory.session_read(2, "own:memory/reference-review.md").ok
        assert not memory.session_search(3, "amber").data["hits"]
        assert not memory.session_read(3, "own:memory/reference-review.md").ok
    assert events == []


async def test_untrusted_write_waits_outside_home_for_owner(growing):
    memory, _ = growing
    result = memory.update_memory(2, {"op": "add", "name": "reference-web", "body": "The result is amber."}, untrusted=True)
    assert result.ok and result.data["pending"]
    assert memory.store_for(2).all() == []
    assert "amber" not in str(memory.index(2)) + memory.recall(2, "amber")
    pending = result.data["pending"]
    assert not memory.session_read(3, "own:" + pending).ok
    assert memory.resolve_pending(2, pending, approve=True).ok
    assert memory.store_for(2).get("reference-web")


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


async def test_prompt_keeps_memory_bodies_and_topic_index_is_bounded(growing):
    memory, _ = growing
    for n in range(45):
        assert memory.update_memory(0, {"op": "add", "name": f"reference-topic-{n}", "body": f"Distinct topic {n}." + "\nA useful detail." * 12}).ok
    index = memory.index(0)
    assert "Distinct topic 44" in str(index)
    assert len(index.topics) <= 2000 and len(index.topics.splitlines()) <= 40
    document = memory.homes.path(0, "MEMORY.md").read_text(encoding="utf-8")
    assert len(document.splitlines()) <= 200 and len(document.encode("utf-8")) <= 24000
    assert memory.session_read(0, "own:memory/archive.md").ok
    assert "Distinct topic 0" in memory.recall(0, "Distinct topic 0")


def test_production_capture_requires_reported_confidence():
    from raphael_core.memory.reflection import parse_actions
    assert parse_actions({"actions": [{"op": "ADD", "name": "reference-missing", "body": "A fact"}]}, require_confidence=True) == []


async def test_replacement_expiry_and_pending_conflicts(growing):
    memory, _ = growing
    args = {"op": "add", "name": "reference-state", "body": "First result."}
    assert memory.update_memory(1, args).ok
    hashed = memory.session_read(1, "own:memory/reference-state.md").data["hash"]
    pending = memory.update_memory(1, {**args, "op": "replace", "body": "Second result.", "expected_hash": hashed}, untrusted=True).data["pending"]
    assert memory.resolve_pending(1, pending, approve=True).ok
    assert memory.store_for(1).get("reference-state").body == "Second result."
    pending = memory.update_memory(1, {**args, "op": "remove"}, untrusted=True).data["pending"]
    proposal = next(item for item in memory.pending(1) if item["name"] == pending)
    assert memory._pending_view(proposal)["body"] == "Second result."
    assert memory.update_memory(1, {**args, "op": "supersede", "body": "Third result."}).ok
    assert memory.resolve_pending(1, pending, approve=True).error == "changed"
    assert memory.store_for(1).get("reference-state").body == "Third result."
    assert memory.update_memory(1, {"op": "add", "name": "reference-expired", "body": "Expired fact.", "until": "2020-01-01"}).ok
    assert "Expired fact" not in str(memory.index(1)) + memory.recall(1, "Expired fact")


async def test_room_reads_exclude_own_private_facts_and_tool_body_is_bounded(growing, history):
    memory, events = growing
    assert not memory.update_memory(1, {"op": "add", "name": "reference-long", "body": "x" * 1001}).ok
    assert memory.update_memory(1, {"op": "add", "name": "reference-private", "body": "Private heliotrope."}).ok
    history.add(session_id="s", member_id=1, question="Private heliotrope", prefix="", text="Private result", route="chat", status="done")
    events.clear()
    assert not memory.session_search(1, "heliotrope", private=False).data["hits"]
    assert not memory.session_read(1, "own:memory/reference-private.md", private=False).ok
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
    action = {"op": "ADD", "name": "reference-progress", "type": "reference", "description": "Review result",
              "body": "The member completed the review.", "origin": "inferred", "space": "shared", "confidence": 0.9}
    model = FakeModel({"actions": [action, {**action, "name": "reference-low", "confidence": 0.5}]}, {"actions": [action]})
    memory._base_client = model
    history.add(session_id="s", member_id=member.id, question="Review the project.", prefix="", text="Review complete.", route="chat", status="done")
    applied = await memory.reflect(member.id)
    assert applied.written == ["reference-progress"]
    assert memory.store_for(member.id).get("reference-progress") and memory.shared.all() == []
    assert model.calls[0]["model"] == "@local:memory" and model.calls[0]["fallbacks"] == []
    history.add(session_id="s", member_id=member.id, question="Review again.", prefix="", text="Same result.", route="chat", status="done")
    assert not (await memory.reflect(member.id)).written


async def test_external_capture_is_pending_and_owner_can_reject_it(growing, history):
    from raphael_core.agent.history import Step
    memory, _ = growing
    memory._base_client = FakeModel({"actions": [{"op": "ADD", "name": "reference-result", "type": "reference",
        "description": "Review result", "body": "The report is ready.", "origin": "inferred", "confidence": 0.9}]})
    identifier = add_turn(history, "Read the report.", "The report is ready.")
    history.add_steps(identifier, [Step(kind="tool", tool="web_read", server="Raphael", outcome="ok", ms=1)])
    assert not (await memory.reflect()).written
    assert not memory.store.all()
    pending = memory.pending(0)
    assert len(pending) == 1
    assert memory.resolve_pending(0, pending[0]["name"], approve=False).ok
    assert memory.pending(0) == [] and memory.store.all() == []


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


async def test_daily_tidy_can_split_a_single_mixed_topic(growing):
    from raphael_core.memory.reflection import Reflector
    memory, _ = growing
    store = memory.store_for(1)
    assert memory.update_memory(1, {"op": "add", "name": "reference-mixed", "body": "Build uses amber. Review uses violet."}).ok
    model = FakeModel({"actions": [
        {"op": "ADD", "name": "reference-build", "type": "reference", "description": "Build colour",
         "body": "Build uses amber.", "origin": "inferred", "confidence": 0.9},
        {"op": "ADD", "name": "reference-review", "type": "reference", "description": "Review colour",
         "body": "Review uses violet.", "origin": "inferred", "confidence": 0.9},
        {"op": "DELETE", "name": "reference-mixed", "confidence": 0.9},
    ]})
    result = await Reflector(model).consolidate(store, model="fake/brain", ledger=memory.ledger(), split=True)
    assert set(result.written) == {"reference-build", "reference-review"}
    assert store.get("reference-mixed") is None
    assert {note.body for note in store.all()} == {"Build uses amber.", "Review uses violet."}


async def test_daily_split_keeps_source_when_a_replacement_is_refused(growing):
    from raphael_core.memory.reflection import Reflector
    memory, _ = growing
    store = memory.store_for(1)
    assert memory.update_memory(1, {"op": "add", "name": "reference-mixed", "body": "Build uses amber. Review uses violet."}).ok
    model = FakeModel({"actions": [
        {"op": "ADD", "name": "reference-build", "type": "reference", "description": "Build colour",
         "body": "x" * 1201, "origin": "inferred", "confidence": 0.9},
        {"op": "DELETE", "name": "reference-mixed", "confidence": 0.9},
    ]})
    result = await Reflector(model).consolidate(store, model="fake/brain", ledger=memory.ledger(), split=True)
    assert result.refused
    assert store.get("reference-mixed").body == "Build uses amber. Review uses violet."

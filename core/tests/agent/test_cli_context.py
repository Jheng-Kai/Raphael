"""Overflow recovery and native session deltas preserve synthetic owner requests."""

import json
from types import SimpleNamespace

import pytest

from raphael_core.agent.cli.context import FRESH_CONTEXT_CHARS, context_tokens, fresh_user, line_hashes, resumed_user, section_delta
from raphael_core.agent.cli.drivers import Driver, Event
from raphael_core.agent.cli.loop import CliLoop, RECOVER, Sessions
from raphael_core.background.cli import RoomCliSessions

from agent.test_cli_recovery import recovery_rig


async def recorded_error_packets(driver, **kwargs):
    """Replay provider-shaped errors through the real parser, without launching a model."""
    if driver.name == "claude":
        packet = {"type": "assistant", "isApiErrorMessage": True, "message": {"model": "<synthetic>",
            "content": [{"type": "text", "text": "Prompt is too long"}]}}
    elif driver.name == "gemini":
        packet = {"event": "step_update", "step_update": {"step_type": "agent_response", "state": "ERROR",
            "text": "Prompt is too long"}}
    else:
        packet = {"method": "item/completed", "params": {"item": {"type": "agentMessage", "status": "failed",
            "text": "Prompt is too long"}}}

    async def read():
        return packet

    async def send(_):
        pass

    driver._read = read
    driver.child = SimpleNamespace(process=None, stderr_tail=b"", send=send)
    stream = driver._claude() if driver.name == "claude" else driver._antigravity() if driver.name == "gemini" else driver._rpc(
        "Synthetic question", "Persona", "http://127.0.0.1:1/mcp", "fake", None, None)
    async for event in stream:
        yield event


def test_fresh_context_keeps_question_and_file_names_before_a_12k_tail():
    owner = "Compare these files. Do not edit any member."
    files = [SimpleNamespace(name="outline.pdf", mime="application/pdf"),
             SimpleNamespace(name="diagram.png", mime="image/png")]
    prompt = fresh_user(owner, files, ["Use the second version."], RECOVER, "Saved receipt 17.",
        turns=[(1, "Old context. " * 2000), (2, "Most recent context.")],
        sections={"Memory": "tail" * 3000})
    assert prompt.startswith(f"<question>\n{owner}\n</question>")
    assert all(text in prompt for text in ("outline.pdf", "diagram.png", "Use the second version.",
                                          RECOVER, "Saved receipt 17.", "Most recent context."))
    assert len(prompt) <= FRESH_CONTEXT_CHARS


def test_fresh_context_never_silently_truncates_a_large_owner_request():
    with pytest.raises(ValueError, match="context_overflow"):
        fresh_user("x" * FRESH_CONTEXT_CHARS, (), (), RECOVER, "records")


def test_compacted_context_respects_utf8_budget_with_complete_request():
    prompt = fresh_user("Keep this request", (), (), RECOVER, "records",
        turns=[(1, "\u754c" * 4000), (2, "Recent context")], byte_limit=1200)
    assert "Keep this request" in prompt and "Recent context" in prompt
    assert len(prompt.encode("utf-8")) <= 1200


def test_context_diffs_include_deletions_and_new_lines_without_old_roster():
    old = "First member\nRemoved member\nUnchanged member"
    diff = section_delta("Team", "Renamed member\nUnchanged member", line_hashes(old))
    assert "[0:2]" in diff and "Renamed member" in diff
    assert "Removed member" not in diff and "Unchanged member" not in diff
    assert section_delta("Team", old, line_hashes(old)) == ""


def test_resumed_context_includes_only_unseen_turns_and_changed_memory():
    prompt = resumed_user("Current question", {"Memory": "New memory"},
        [(3, "Already delivered"), (4, "New owner turn and answer")],
        {"turn": 3, "sections": {"Memory": line_hashes("Old memory")}})
    assert "Already delivered" not in prompt and "New owner turn and answer" in prompt
    assert "New memory" in prompt and "Old memory" not in prompt


@pytest.mark.parametrize("brain", ["claude", "codex", "gemini"])
@pytest.mark.parametrize("fails_again", [False, True])
async def test_overflow_keeps_explicit_owner_request_after_action(monkeypatch, tmp_path, brain, fails_again):
    published = []

    async def play(loop, attempt):
        if attempt == 1:
            await loop._tool("save", "save_draft", {})
        if attempt == 1 or fails_again:
            yield Event("error", "context_overflow")
        else:
            yield Event("final", "Compared the files.")

    rig = recovery_rig(monkeypatch, tmp_path, play, brain=brain, reply=published.append,
        owner_text="Compare outline.pdf; do not edit the team.",
        attachments=[SimpleNamespace(name="outline.pdf", mime="application/pdf", is_image=False)])
    rig.loop.sessions.put(5, rig.loop.model, "old", 7)
    rig.loop.user = "<question>Compare outline.pdf; do not edit the team.</question>" + "z" * 12000
    result = await rig.loop.run()
    assert len(rig.calls) == 2 and len(rig.effects) == 1
    assert rig.calls[0]["session"] == "old" and rig.calls[1]["session"] is None
    assert "<question>\nCompare outline.pdf; do not edit the team.\n</question>" in rig.calls[1]["user"]
    assert '"name": "outline.pdf"' in rig.calls[1]["user"]
    assert "Saved receipt 17" in rig.calls[1]["user"]
    assert not any("Prompt is too long" in reply.text for reply in published)
    if fails_again:
        assert not published and rig.loop.failure == "context_overflow"
        assert "Prompt is too long" not in result.final
    else:
        assert [reply.text for reply in published] == ["Compared the files."]


@pytest.mark.parametrize("brain", ["claude", "codex", "gemini"])
async def test_sixty_native_turns_submit_flat_deltas_and_fresh_gets_full_context(monkeypatch, tmp_path, brain):
    sessions = RoomCliSessions()
    calls = []

    class FakeDriver:
        def __init__(self, *args, **kwargs):
            pass

        async def run(self, **kwargs):
            calls.append(kwargs)
            yield Event("session", "same-native-session")
            yield Event("usage", data={"input_tokens": 1000, "context_window": 1000000})
            yield Event("final", "Complete.")

        async def interrupt(self):
            pass

    monkeypatch.setattr("raphael_core.agent.cli.loop.Driver", FakeDriver)
    history = []
    for index in range(60):
        current = f"<question>Request {index:02d}</question>"
        full = "\n".join(text for _, text in history) + "\n" + current
        loop = CliLoop(brains=SimpleNamespace(environ={}, home=tmp_path, command=lambda _: ["fake"],
            available=lambda *args, **kwargs: True), sessions=sessions, member_id=5, conversation_id=7,
            model=f"cli:{brain}:fake", ledger=SimpleNamespace(add=lambda **kwargs: None), language="en", plain=True,
            system="Persona", user=full, owner_text=f"Request {index:02d}", resume_user=current,
            context_turns=history[:], turn_id=index + 1, context_sections={"Team": "Team snapshot", "Memory": "Memory snapshot"},
            tools=[], progress=lambda _: None, thinking=lambda _: None, event=lambda _: None, execute=None)
        assert (await loop.run()).final == "Complete."
        history.append((index + 1, f"Earlier question {index:02d} and its answer. " + "h" * 200))
    assert calls[0]["session"] is None
    assert all(call["session"] == "same-native-session" for call in calls[1:])
    assert len({len(call["user"]) for call in calls[1:]}) == 1
    assert all("Earlier question" not in call["user"] for call in calls[1:])
    assert all("Team snapshot" not in call["user"] and "Memory snapshot" not in call["user"] for call in calls[1:])
    # A separate native session still receives the entire available history.
    sessions.forget(5, f"cli:{brain}:fake", 7)
    loop.task = None
    loop._session = None
    loop._context_state = {}
    loop.user = full
    loop.owner_input.closed = False
    await loop.run()
    assert calls[-1]["session"] is None
    assert "Earlier question 00" in calls[-1]["user"] and "Earlier question 58" in calls[-1]["user"]


@pytest.mark.parametrize("brain", ["claude", "codex", "gemini"])
async def test_measured_near_limit_compacts_before_starting_provider(monkeypatch, tmp_path, brain):
    async def play(loop, attempt):
        yield Event("session", "new-session")
        yield Event("final", "Done.")

    rig = recovery_rig(monkeypatch, tmp_path, play, brain=brain, owner_text="Keep this request.",
        resume_user="<question>Keep this request.</question>", context_turns=[(4, "Most recent task.")], turn_id=5)
    sessions = rig.loop.sessions
    sessions.put(5, rig.loop.model, "full-session", 7)
    sessions.put_context(5, rig.loop.model, "full-session", {"turn": 4, "tokens": 7800, "window": 10000}, 7)
    await rig.loop.run()
    assert len(rig.calls) == 1 and rig.calls[0]["session"] is None
    assert "Keep this request." in rig.calls[0]["user"] and "Most recent task." in rig.calls[0]["user"]
    assert sessions.get_context(5, rig.loop.model, "new-session", 7)["window"] == 10000


def test_native_context_state_survives_restart_and_is_scoped_and_deleted(conn):
    sessions = Sessions(conn)
    conversation = sessions.conversations.main(0)
    sessions.put(0, "cli:claude", "native", conversation)
    state = {"turn": 12, "sections": {"Memory": line_hashes("Synthetic memory")}, "tokens": 10}
    sessions.put_context(0, "cli:claude", "native", state, conversation)
    restarted = Sessions(conn)
    assert restarted.get_context(0, "cli:claude", "native", conversation) == state
    assert restarted.get_context(1, "cli:claude", "native", conversation) is None
    assert restarted.get_context(0, "cli:claude", "other", conversation) is None
    assert "Synthetic memory" not in conn.execute("SELECT state FROM agent_conversation_cli_contexts").fetchone()[0]
    restarted.forget(0, "cli:claude", conversation)
    assert not conn.execute("SELECT * FROM agent_conversation_cli_contexts").fetchall()


@pytest.mark.parametrize("flag", ["model", "isApiErrorMessage"])
async def test_recorded_claude_synthetic_packet_is_an_error_not_an_answer(monkeypatch, flag):
    # Protocol shape from the audit, with synthetic text and no owner conversation data.
    assistant = {"type": "assistant", "message": {"role": "assistant", "model": "claude",
        "content": [{"type": "text", "text": "Prompt is too long"}], "stop_reason": "end_turn"}}
    if flag == "model":
        assistant["message"]["model"] = "<synthetic>"
    else:
        assistant[flag] = True
    packets = iter([assistant, {"type": "result", "is_error": True, "result": "Prompt is too long"}])
    driver = Driver("claude", ["unused"])

    async def read():
        return next(packets)

    monkeypatch.setattr(driver, "_read", read)
    events = [event async for event in driver._claude()]
    assert not any(event.kind in ("message", "text_delta", "final") for event in events)
    assert events[-1].kind == "error" and events[-1].text == "context_overflow"


@pytest.mark.parametrize("brain", ["claude", "codex", "gemini"])
async def test_later_failure_keeps_a_real_message_already_published(monkeypatch, tmp_path, brain):
    published = []

    async def play(loop, attempt):
        if attempt == 1:
            yield Event("text_delta", "A complete real reply.")
            yield Event("message", "A complete real reply.", {"final": True})
        assert [reply.text for reply in published] == ["A complete real reply."]
        yield Event("error", "context_overflow")

    rig = recovery_rig(monkeypatch, tmp_path, play, brain=brain, reply=published.append)
    await rig.loop.run()
    assert [reply.text for reply in published] == ["A complete real reply."]
    assert rig.loop.failure == "context_overflow"


def test_context_usage_counts_cached_native_history():
    assert context_tokens({"input_tokens": 10, "cache_read_input_tokens": 80, "cache_creation_input_tokens": 20}) == 110
    assert context_tokens({"context_tokens": 500, "inputTokens": 20}) == 500


@pytest.mark.parametrize("brain", ["claude", "codex", "gemini"])
async def test_successful_messages_publish_once_as_they_complete(monkeypatch, tmp_path, brain):
    published = []

    async def play(loop, attempt):
        yield Event("message", "First answer.", {"id": "one", "final": True})
        yield Event("message", "Second answer.", {"id": "two", "final": True})
        assert [reply.text for reply in published] == ["First answer.", "Second answer."]
        yield Event("final", "Second answer.")

    rig = recovery_rig(monkeypatch, tmp_path, play, brain=brain, reply=published.append)
    await rig.loop.run()
    assert [reply.text for reply in published] == ["First answer.", "Second answer."]


@pytest.mark.parametrize("brain", ["codex", "gemini"])
async def test_other_native_drivers_filter_error_assistant_packets(monkeypatch, brain):
    driver = Driver(brain, ["unused"])
    if brain == "gemini":
        packet = {"event": "step_update", "step_update": {"step_type": "agent_response", "state": "ERROR",
            "text": "Prompt is too long"}}
        stream = driver._antigravity()
    else:
        packet = {"method": "item/completed", "params": {"item": {"type": "agentMessage",
            "status": "failed", "text": "Prompt is too long"}}}
        driver.child = SimpleNamespace(send=lambda _: None)

        async def send(_):
            pass

        driver.child.send = send
        stream = driver._rpc("Question", "Persona", "http://127.0.0.1:1", "fake", None, None)

    async def read():
        return packet

    monkeypatch.setattr(driver, "_read", read)
    events = [event async for event in stream]
    assert [event.kind for event in events] == ["error"]
    assert events[0].text == "context_overflow"

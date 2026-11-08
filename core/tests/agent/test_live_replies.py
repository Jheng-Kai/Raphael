"""Complete public replies reach the existing history/notification path before completion."""

import json

import pytest

from raphael_core.agent.cli import loop as cli
from raphael_core.agent.cli.drivers import Event
from raphael_core.messaging.words import plain_replies
from .test_service import make_rig  # noqa: F401
from .test_memory_turns import memory  # noqa: F401
from .test_narration import chat, typed


def replies(rig):
    return [row[0] for row in rig.conn.execute("SELECT text FROM agent_messages WHERE kind='reply' ORDER BY turn_id,seq")]


def bodies(rig):
    return plain_replies(replies(rig))


@pytest.mark.parametrize("envelope", [False, True])
async def test_three_replies_are_stored_and_notified_around_two_tools(make_rig, client, envelope):
    snapshots = []
    states = []
    rig = None
    def notify(method, data):
        if rig and method == "agent.turn":
            current = bodies(rig)
            if current and (not snapshots or snapshots[-1] != current):
                states.append(rig.history.get(data["turn_id"]).status)
                snapshots.append(current)
    rig = make_rig(notify=notify)
    words = ["I will prepare the template.", "One reusable memory belongs in it.", "The template is ready."]
    def content(index):
        return json.dumps({"messages": [words[index]], "thinking": "Public choice.", "progress": "Checking."}) if envelope else words[index]
    async def second(**kwargs):
        assert bodies(rig) == words[:1] and snapshots == [words[:1]]
        return chat(content(1), ("local_time", {}))
    async def final(**kwargs):
        assert bodies(rig) == words[:2] and snapshots == [words[:1], words[:2]]
        return chat(json.dumps({"prefix": "Answer", "messages": words, "detail": "Receipt only"}))
    client.chats = [chat(content(0), ("local_time", {})), second, final]
    await typed(rig)
    assert bodies(rig) == words
    assert snapshots == [words[:1], words[:2], words]
    assert states == ["running"] * 3
    assert rig.history.latest_by_member()[0].status == "done"
    assert all("Receipt" not in message for message in replies(rig))


async def test_a_model_failure_keeps_the_already_published_reply(make_rig, client):
    from raphael_core.brain.openrouter import OpenRouterError
    rig = make_rig()
    client.chats = [chat("I will check the saved setup.", ("local_time", {})), OpenRouterError(401, "auth", "Fake sign-in failure")]
    await typed(rig)
    assert bodies(rig)[0] == "I will check the saved setup."
    assert rig.history.latest_by_member()[0].status == "error"


@pytest.mark.parametrize("brain", ["codex", "claude", "gemini"])
async def test_cli_messages_are_live_and_the_terminal_echo_is_not_added_again(make_rig, monkeypatch, tmp_path, brain):
    notes = []
    rig = make_rig(notify=lambda method, data: notes.append(method))
    rig.settings.set("agent_model", f"cli:{brain}:fake")
    monkeypatch.setattr(rig.service._cli_brains, "command", lambda name: ["fake"])
    monkeypatch.setattr(rig.service._cli_brains, "available", lambda *args, **kwargs: True)
    words = ["I will prepare it.", "I found the reusable part.", "It is ready."]
    class FakeDriver:
        actual_model = None
        def __init__(self, *args, **kwargs):
            pass
        async def run(self, **kwargs):
            for index, word in enumerate(words):
                yield Event("text_delta", word[:4])
                assert bodies(rig) == words[:index]
                yield Event("text_delta", word[4:])
                before = notes.count("agent.turn")
                yield Event("message", word, data={"id": str(index)})
                assert notes.count("agent.turn") == before + 1
                assert bodies(rig) == words[:index + 1]
                if index < 2:
                    yield Event("tool_start", data={"id": str(index), "name": "local_time"})
                    yield Event("tool_end", data={"id": str(index), "ok": True})
            yield Event("final", words[-1])
    monkeypatch.setattr(cli, "Driver", FakeDriver)
    await typed(rig)
    assert bodies(rig) == words


async def test_only_explicit_public_reply_fields_are_published(make_rig, client):
    rig = make_rig()
    client.chats = [chat(json.dumps({"thinking": "Public explanation.", "progress": "Checking.",
                                    "reasoning": "PRIVATE", "tool_output": "RAW"}), ("local_time", {})),
                    chat(json.dumps({"text": "Complete.", "detail": "Receipt"}))]
    await typed(rig)
    assert bodies(rig) == ["Complete."]
    assert all("PRIVATE" not in text and "RAW" not in text for text in replies(rig))


@pytest.mark.parametrize("brain", ["api", "codex", "claude", "gemini"])
async def test_each_message_uses_owner_script_without_rewriting_code_or_japanese(make_rig, client, monkeypatch, brain):
    rig = make_rig()
    rig.settings.set("languages", ["zh-TW"])
    original = ["这个软件已检查。", "日本の学校へ行きます。", '```python\nprint("这个软件")\n```']
    expected = ["這個軟體已檢查。", original[1], original[2]]
    if brain == "api":
        async def final(**kwargs):
            assert bodies(rig) == expected
            return chat("Done.")
        client.chats = [chat(json.dumps({"messages": original}), ("local_time", {})), final]
    else:
        rig.settings.set("agent_model", f"cli:{brain}:fake")
        monkeypatch.setattr(rig.service._cli_brains, "command", lambda name: ["fake"])
        monkeypatch.setattr(rig.service._cli_brains, "available", lambda *args, **kwargs: True)
        async def run(driver, **kwargs):
            for index, word in enumerate(original):
                yield Event("message", word, data={"id": str(index)})
                assert bodies(rig) == expected[:index + 1]
            yield Event("final", "Done.")
        monkeypatch.setattr(cli.Driver, "run", run)
    await typed(rig)
    assert bodies(rig) == [*expected, "Done."]


async def test_a_completed_or_cleared_turn_cannot_receive_a_late_reply(make_rig):
    from raphael_core.agent.answers import Reply
    from raphael_core.agent.service import _Ask
    rig = make_rig()
    turn_id = rig.history.add(session_id="late", question="Stop", route="answer", prefix="", text="Stopped", status="cancelled")
    ask = _Ask(session_id="late", text="Stop", language="en", turn_id=turn_id)
    rig.service._publish_reply(ask, Reply("Answer", "LATE", None))
    assert replies(rig) == []
    rig.history.delete(turn_id)
    rig.service._publish_reply(ask, Reply("Answer", "LATE", None))
    assert replies(rig) == [] and rig.history.get(turn_id) is None


def test_terminal_echo_deduplication_keeps_order_and_intentional_repetition():
    from raphael_core.agent.answers import pending_replies
    assert pending_replies(["First", "Second"], ["First", "Second", "Third"]) == ["Third"]
    assert pending_replies(["First", "Second"], ["First\n\nSecond\n\nThird"]) == ["Third"]
    assert pending_replies(["First", "Second"], ["First\n\nSecond"]) == []
    assert pending_replies(["Same", "Different"], ["Same", "New"]) == ["Same", "New"]
    assert pending_replies(["《Answer. First》"], ["《Answer. First\n\nLast》"]) == ["《Answer. Last》"]
    assert pending_replies(["《Answer. First", "Second》"], ["First", "Second", "Third"]) == ["Third"]


@pytest.mark.parametrize("brain", ["codex", "claude", "gemini"])
async def test_explicit_cli_separator_is_live_and_a_literal_code_marker_stays_whole(make_rig, monkeypatch, brain):
    rig = make_rig()
    rig.settings.set("agent_model", f"cli:{brain}:fake")
    monkeypatch.setattr(rig.service._cli_brains, "command", lambda name: ["fake"])
    monkeypatch.setattr(rig.service._cli_brains, "available", lambda *args, **kwargs: True)
    first = '```text\n<<<next message>>>\n```\nThe literal marker is code.'
    combined = first + "\n<<<next message>>>\nSecond."
    async def run(driver, **kwargs):
        yield Event("text_delta", first + "\n")
        assert bodies(rig) == []
        yield Event("text_delta", "<<<next message>>>\n")
        assert bodies(rig) == [first]
        yield Event("text_delta", "Second.")
        assert bodies(rig) == [first]
        yield Event("message", combined, data={"id": "complete"})
        assert bodies(rig) == [first, "Second."]
        yield Event("final", combined)
    monkeypatch.setattr(cli.Driver, "run", run)
    await typed(rig)
    assert bodies(rig) == [first, "Second."]


async def test_structured_final_messages_are_stored_individually_once(make_rig, client):
    from .conftest import completion, decision
    snapshots = []
    rig = make_rig(notify=lambda method, data: snapshots.append(bodies(rig)) if method == "agent.turn" else None)
    words = ["First.", "Second.", "Third."]
    client.decisions.append(decision("chat"))
    client.replies.append(completion({"prefix": "Answer", "messages": words}))
    await rig.ask("Explain", language="en")
    assert bodies(rig) == words
    assert [current for previous, current in zip([[], *snapshots], snapshots) if previous != current] == [words[:1], words[:2], words]


async def test_structured_reply_before_a_lookup_is_not_held_for_the_final_json(make_rig, client, memory):
    from .conftest import completion, decision
    rig = make_rig(memory=memory)
    first, last = "I will check the earlier conversation.", "The review is ready."
    async def finish(**kwargs):
        assert bodies(rig) == [first]
        assert rig.history.latest_by_member()[0].status == "running"
        return completion({"messages": [first, last]})
    client.decisions.append(decision("chat"))
    client.replies = [completion({"text": first, "need": {"search": "earlier"}}), finish]
    try:
        await rig.ask("Check our earlier discussion", language="en")
        assert bodies(rig) == [first, last]
    finally:
        await memory.aclose()

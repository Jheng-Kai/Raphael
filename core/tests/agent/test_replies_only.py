"""Routine narration stays progress; explicit owner messages remain live."""

import json

import pytest

from raphael_core.agent.answers import public_reply
from raphael_core.agent.cli import loop as cli
from raphael_core.agent.cli.drivers import Event
from .test_service import make_rig  # noqa: F401
from .test_narration import chat, typed
from .test_live_replies import bodies
from .test_memory_turns import memory  # noqa: F401


async def test_five_narrated_tool_rounds_write_no_reply_before_a_real_message(make_rig, client):
    rig = make_rig()
    async def narration(**kwargs):
        assert bodies(rig) == []
        return chat("Checking another source and routing around a file error.", ("local_time", {}))
    async def important(**kwargs):
        assert bodies(rig) == []
        return chat(json.dumps({"progress": "Checking.", "messages": ["The source confirms the deadline."]}), ("local_time", {}))
    async def final(**kwargs):
        assert bodies(rig) == ["The source confirms the deadline."]
        return chat("The complete result.")
    client.chats = [narration] * 5 + [important, final]
    await typed(rig)
    assert bodies(rig) == ["The source confirms the deadline.", "The complete result."]
    assert rig.conn.execute("SELECT COUNT(*) FROM agent_messages WHERE kind='progress'").fetchone()[0] >= 5


@pytest.mark.parametrize("brain", ["codex", "claude", "gemini"])
async def test_cli_completed_narration_stays_progress_and_final_is_written_once(make_rig, monkeypatch, brain):
    rig = make_rig()
    rig.settings.set("agent_model", f"cli:{brain}:fake")
    monkeypatch.setattr(rig.service._cli_brains, "command", lambda name: ["fake"])
    monkeypatch.setattr(rig.service._cli_brains, "available", lambda *args, **kwargs: True)
    async def run(driver, **kwargs):
        assert "Never narrate steps" in kwargs["system"]
        for index in range(5):
            text = f"Checking source {index}."
            yield Event("text_delta", text)
            yield Event("message", text, data={"id": str(index)})
            assert bodies(rig) == []
            yield Event("tool_start", data={"id": str(index), "name": "local_time"})
            yield Event("tool_end", data={"id": str(index), "ok": True})
            assert bodies(rig) == []
        yield Event("message", "The result.", data={"id": "answer", "final": True})
        assert bodies(rig) == ["The result."]
        yield Event("final", "The result.")
    monkeypatch.setattr(cli.Driver, "run", run)
    await typed(rig)
    assert bodies(rig) == ["The result."]


@pytest.mark.parametrize("content", ["Checking.", '{"text":"Checking."}', '{"progress":"Checking."}', '{"messages":[],"text":"Checking."}'])
def test_tool_narration_is_not_an_explicit_message(content):
    assert public_reply(content, "en", explicit=True) is None


def test_explicit_message_cannot_publish_other_envelope_fields():
    reply = public_reply('{"messages":["Important."],"text":"Retrying.","detail":"Receipt"}', "en", explicit=True)
    assert reply.text == "Important." and reply.detail is None


@pytest.mark.parametrize("messages", [None, [], [""], [None]])
async def test_structured_lookup_narration_stays_progress(make_rig, client, memory, messages):
    from .conftest import completion, decision
    rig = make_rig(memory=memory)
    async def final(**kwargs):
        assert bodies(rig) == []
        assert rig.conn.execute("SELECT 1 FROM agent_messages WHERE kind='progress'").fetchone()
        assert "Never narrate steps" in kwargs["system"]
        return completion({"text": "The result."})
    client.decisions.append(decision("chat"))
    client.replies = [completion({"text": "Checking earlier messages.", "need": {"search": "earlier"},
                                  **({"messages": messages} if messages is not None else {})}), final]
    try:
        await rig.ask("Check the earlier discussion", language="en")
        assert bodies(rig) == ["The result."]
    finally:
        await memory.aclose()


async def test_structured_lookup_can_explicitly_finish_an_interim_message(make_rig, client, memory):
    from .conftest import completion, decision
    rig = make_rig(memory=memory)
    async def final(**kwargs):
        assert bodies(rig) == ["The deadline is confirmed."]
        return completion({"text": "The final result."})
    client.decisions.append(decision("chat"))
    client.replies = [completion({"text": "The deadline is confirmed.\n<<<next message>>>\n", "need": {"search": "earlier"}}), final]
    try:
        await rig.ask("Check the earlier discussion", language="en")
        assert bodies(rig) == ["The deadline is confirmed.", "The final result."]
    finally:
        await memory.aclose()


@pytest.mark.parametrize("streamed", [False, True])
async def test_claude_end_turn_marks_a_native_final_message(streamed):
    from raphael_core.agent.cli.drivers import Driver
    packets = []
    if streamed:
        packets.extend([
            {"type": "stream_event", "event": {"delta": {"type": "text_delta", "text": "The result."}}},
            {"type": "stream_event", "event": {"type": "content_block_stop"}},
        ])
    packets.extend([
        {"type": "assistant", "message": {"id": "answer", "stop_reason": "end_turn", "content": [{"type": "text", "text": "The result."}]}},
        {"type": "result", "subtype": "success", "result": "The result."},
    ])
    driver = Driver("claude", [])
    async def read():
        return packets.pop(0)
    driver._read = read
    events = [event async for event in driver._claude()]
    assert [event.text for event in events if event.kind == "message" and event.data.get("final")] == ["The result."]
    assert events[-1].kind == "final" and events[-1].text == "The result."

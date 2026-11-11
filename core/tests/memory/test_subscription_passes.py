"""Real memory adapters consume subscription results, never API fallback."""

import asyncio
import json

import pytest

from .conftest import add_turn
from .test_service import memory, model, keys, PLAN  # noqa: F401
from raphael_core.agent.cli.loop import CliLoop
from raphael_core.brain.openrouter import TextCompletion
from raphael_core.brain.providers.chatgpt import ChatGPTProvider
from raphael_core.memory.brain import MemoryBrain, MemoryBrainError
from raphael_core.worker.loop import Outcome


@pytest.mark.parametrize("wrap", [lambda s: s, lambda s: "The edits are:\n" + s + "\nDone.", lambda s: "```json\n" + s + "\n```"])
async def test_chatgpt_schema_reflection_writes_and_advances_watermark(memory, history, monkeypatch, wrap):
    provider = ChatGPTProvider(None)
    calls = []
    async def answer(**kwargs):
        calls.append(kwargs)
        return TextCompletion(wrap(json.dumps(PLAN)), kwargs["model"], 0, 0, 0, 0, [])
    monkeypatch.setattr(provider, "chat_text", answer)
    memory._base_client = provider
    memory._settings.set("agent_model", "@chatgpt:gpt-6-luna?effort=high")
    turn = add_turn(history, "Remember that I prefer amber notebooks.")
    result = await memory.reflect()
    assert not result.failed and len(result.written) == 1
    assert memory.reflected_through() == turn
    assert memory.own(0).entries()
    assert calls[0]["model"].startswith("@chatgpt:")


@pytest.mark.parametrize("brain", ["codex", "claude", "gemini"])
async def test_real_cli_loop_done_status_is_memory_success(memory, history, monkeypatch, brain):
    async def answer(loop):
        assert loop.tools == [] and loop.no_tools and loop.structured
        assert "JSON matching this schema" in loop.system
        loop._queue.put_nowait(Outcome("done", final=json.dumps(PLAN)))
    monkeypatch.setattr(CliLoop, "_work", answer)
    memory._settings.set("agent_model", "cli:" + brain)
    memory._cli_brains = object()
    turn = add_turn(history, "Remember the amber notebook preference.")
    result = await memory.reflect()
    assert not result.failed and len(result.written) == 1
    assert memory.reflected_through() == turn


async def test_real_memory_brain_timeout_keeps_watermark_and_reports_cause(memory, history, monkeypatch, caplog):
    provider = ChatGPTProvider(None)
    async def timeout(**kwargs):
        raise TimeoutError()
    monkeypatch.setattr(provider, "chat_text", timeout)
    memory._base_client = provider
    memory._settings.set("agent_model", "@chatgpt:gpt-6-luna?effort=high")
    add_turn(history, "Remember amber notebooks.")
    assert (await memory.reflect()).failed
    assert memory.reflected_through() == 0
    assert "kind=timeout" in caplog.text
    memory._record_failure()
    memory._record_failure()
    assert memory.health()["status"] == "attention"
    memory._recovered()
    assert memory.health()["status"] == "ok"


async def test_cli_timeout_is_classified_and_closed(memory, monkeypatch):
    async def hang(loop):
        await asyncio.Event().wait()
    monkeypatch.setattr(CliLoop, "_work", hang)
    memory._cli_brains = object()
    with pytest.raises(MemoryBrainError) as error:
        await MemoryBrain(memory, 0).complete_json(model="cli:codex", system="", user="", schema={}, timeout_s=.01)
    assert error.value.kind == "timeout"


@pytest.mark.parametrize("reference", ["@chatgpt:gpt-6-luna?effort=high", "cli:claude", "cli:codex", "cli:gemini"])
async def test_subscription_consolidation_writes(memory, monkeypatch, reference):
    original = "\n\n".join(f"Build {n} uses the amber notebook pipeline with stable paths" for n in range(40))
    memory.own(0).edit_document(original, None)
    old = memory.own(0).entries()[0]
    plan = {"actions": [{"target": "memory", "action": "replace", "content": "Build zero uses the amber pipeline.",
                        "old_text": old, "confidence": 1.0}]}
    memory._settings.set("agent_model", reference)
    class Brains:
        def available(self, name):
            return True
    memory._cli_brains = Brains()
    async def answer(loop):
        loop._queue.put_nowait(Outcome("done", final=json.dumps(plan)))
    monkeypatch.setattr(CliLoop, "_work", answer)
    provider = ChatGPTProvider(None)
    async def chat(**kwargs):
        return TextCompletion(json.dumps(plan), kwargs["model"], 0, 0, 0, 0, [])
    monkeypatch.setattr(provider, "chat_text", chat)
    memory._base_client = provider
    result = await memory.consolidate()
    assert not result.failed and result.written == ["memory"]
    assert "Build zero uses the amber pipeline." in memory.own(0).read()

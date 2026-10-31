"""Chosen conversation models, undivided budgets and truthful failure/provenance, offline."""
import json

import pytest

from raphael_core.agent.narration import MODEL_SILENCE_S
from raphael_core.brain.openrouter import ChatTurn, Completion, OpenRouterError
from raphael_core.brain.providers.registry import ProviderRegistry, ProviderRouter
from raphael_core.brain.secrets import MemoryKeyStore
from .test_service import Rig


class Provider:
    def __init__(self, failure=None):
        self.failure = failure
        self.calls = []

    async def chat_tools(self, **kwargs):
        self.calls.append(kwargs)
        if self.failure:
            raise OpenRouterError(0, self.failure, "Synthetic failure")
        return ChatTurn(json.dumps({"messages": ["The chosen model answered."]}), [], "actual/answered-model", 0.1, 10, 10, 1)

    async def complete_json(self, **kwargs):
        self.calls.append(kwargs)
        if kwargs["model"] == "chosen":
            raise OpenRouterError(0, "timeout", "Synthetic timeout")
        return Completion({}, kwargs["model"], 0.1, 1, 1, 1)

    async def aclose(self):
        pass


def routed(conn, monkeypatch, provider):
    keys = MemoryKeyStore()
    keys.set("synthetic-key")
    registry = ProviderRegistry(conn, provider, keys)
    monkeypatch.setattr(registry, "client", lambda pid: provider)
    return registry, ProviderRouter(registry, provider)


@pytest.mark.parametrize("saved", [False, True])
@pytest.mark.parametrize("language", ["en", "zh-TW", "ja"])
async def test_timed_out_turn_stays_on_the_chosen_model_and_reports_it(conn, actions, monkeypatch, language, saved):
    provider = Provider("timeout")
    monkeypatch.setattr("raphael_core.agent.narration.RETRY_WAITS", (0.0, 0.0, 0.0))
    registry, router = routed(conn, monkeypatch, provider)
    chosen = "openai/owner-chosen-model"
    registry.settings.set("agent_model", chosen)
    if saved:
        # There is no fallback control in the UI; stale hidden settings confer no consent.
        registry.settings.set("agent_fallbacks", ["unasked/backup-one", "unasked/backup-two"])
    rig = Rig(conn, router, actions)
    try:
        result = await rig.call("agent.ask", {"session_id": "chosen", "text": "Hello", "ui_language": language, "source": "app"})
        assert result["status"] == "done" and chosen in result["text"]  # RPC completion; persisted status is error.
        assert {"en": "Try again", "zh-TW": "再試", "ja": "試"}[language] in result["text"]
        assert len(provider.calls) == 4
        assert all(call["model"] == chosen and call["fallbacks"] == [] and call["timeout_s"] == MODEL_SILENCE_S for call in provider.calls)
        [turn] = await rig.turns()
        assert turn["status"] == "error" and turn["text"] == result["text"]
        assert all("unasked/" not in call["model"] for call in provider.calls)
    finally:
        await rig.aclose()


@pytest.mark.parametrize("failure", ["auth", "bad_request"])
async def test_failed_turn_names_its_chosen_model_without_using_another(conn, actions, monkeypatch, failure):
    provider = Provider(failure)
    registry, router = routed(conn, monkeypatch, provider)
    registry.settings.set("agent_model", "openai/owner-chosen-model")
    rig = Rig(conn, router, actions)
    try:
        result = await rig.call("agent.ask", {"session_id": "failure", "text": "Hello", "ui_language": "en", "source": "app"})
        assert "openai/owner-chosen-model" in result["text"]
        assert (await rig.turns())[0]["status"] == "error"
        assert len(provider.calls) == 1
    finally:
        await rig.aclose()


async def test_turn_records_the_model_that_actually_answered(conn, actions, monkeypatch):
    registry, router = routed(conn, monkeypatch, Provider())
    registry.settings.set("agent_model", "openai/owner-chosen-model")
    rig = Rig(conn, router, actions)
    try:
        result = await rig.call("agent.ask", {"session_id": "actual", "text": "Hello", "ui_language": "en", "source": "app"})
        assert result["status"] == "done"
        [turn] = await rig.turns()
        assert turn["model"] == "actual/answered-model"
    finally:
        await rig.aclose()


async def test_registry_ignores_implicit_conversation_chain_and_keeps_full_budget(conn, monkeypatch):
    provider = Provider()
    registry, router = routed(conn, monkeypatch, provider)
    with pytest.raises(OpenRouterError):
        await router.complete_json(model="chosen", fallbacks=["implicit-a", "implicit-b"], timeout_s=60,
                                   system="s", user="u", schema={}, schema_name="reply", max_tokens=20)
    assert len(provider.calls) == 1 and provider.calls[0]["timeout_s"] == 60
    assert provider.calls[0]["fallbacks"] == []


async def test_cleanup_explicit_fallback_keeps_each_full_budget_and_actual_model(conn, monkeypatch):
    provider = Provider()
    registry, router = routed(conn, monkeypatch, provider)
    registry.settings.set("cleanup_fallbacks", ["saved-backup"])
    result = await router.for_purpose("cleanup").complete_json(model="chosen", fallbacks=[], timeout_s=60,
        system="s", user="u", schema={}, schema_name="reply", max_tokens=20)
    assert [call["model"] for call in provider.calls] == ["chosen", "saved-backup"]
    assert [call["timeout_s"] for call in provider.calls] == [60, 60]
    assert result.model == "saved-backup"

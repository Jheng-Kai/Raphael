"""Synthetic foreground spending guards and native CLI input measurements."""

import json
from dataclasses import replace

import pytest

from raphael_core.agent import service as agent_module
from raphael_core.agent.cli import loop as cli
from raphael_core.agent.cli.drivers import Event
from raphael_core.agent.persona import monthly_budget_notice
from raphael_core.agent.speaker import RAPHAEL
from raphael_core.memory.conversation import DEFAULT_CONTEXT_WINDOW
from raphael_core.memory.terms import estimate_tokens
from raphael_core.ui_languages import LANGUAGES
from .test_memory_turns import memory  # noqa: F401
from .test_narration import chat
from .test_plugin_model import llm
from .test_service import make_rig  # noqa: F401


def spent(rig):
    rig.spend.record(purpose="cleanup", model="synthetic", cost_usd=.02, prompt_tokens=1, completion_tokens=1)


@pytest.mark.parametrize("source", ["app", "telegram", "slack", "discord", "voice"])
async def test_monthly_cap_blocks_every_foreground_source_before_any_paid_call(make_rig, client, source):
    rig = make_rig(owner_language=lambda: "en")
    rig.settings.set("monthly_limit_usd", .01)
    spent(rig)
    result = await rig.call("agent.ask", {"session_id": "limited", "text": "Explain this synthetic example",
        "ui_language": "en", "source": source, **({"destination": "quick"} if source == "voice" else {})})
    assert result["prefix"] == "Negative" and rig.history.get(result["turn_id"]).status == "error"
    assert "monthly spending limit of US$0.01" in result["text"]
    assert "Settings > Models & usage" in result["text"]
    assert client.calls == 0 and not client.chat_calls
    assert rig.service._over_budget(.01)


async def test_raising_monthly_cap_allows_the_same_foreground_request(make_rig, client):
    rig = make_rig()
    spent(rig)
    rig.settings.set("monthly_limit_usd", .01)
    params = {"session_id": "limited", "text": "Explain this synthetic example", "ui_language": "en", "source": "app"}
    assert (await rig.call("agent.ask", params))["prefix"] == "Negative"
    rig.settings.set("monthly_limit_usd", 10)
    client.chats.append(chat("Synthetic example explained."))
    result = await rig.call("agent.ask", {**params, "session_id": "allowed"})
    assert result["status"] == "done" and result["text"] == "Synthetic example explained."
    assert len(client.chat_calls) == 1 and not rig.service._over_budget(10)


@pytest.mark.parametrize("language", LANGUAGES)
async def test_monthly_cap_notice_uses_every_supported_interface_language(make_rig, language):
    rig = make_rig()
    rig.settings.set("monthly_limit_usd", .01)
    spent(rig)
    result = await rig.call("agent.ask", {"session_id": "localized", "text": "Explain this synthetic example",
        "ui_language": language, "source": "app"})
    assert result["text"] == monthly_budget_notice(language, .01)
    assert "US$0.01" in result["text"] and "{limit}" not in result["text"]
    if language != "en":
        assert result["text"] != monthly_budget_notice("en", .01)


def fake_cli(monkeypatch, rig, calls, *, overflow=None):
    monkeypatch.setattr(rig.service._cli_brains, "command", lambda name: ["never-spawn"])
    monkeypatch.setattr(rig.service._cli_brains, "available", lambda *args, **kwargs: True)
    monkeypatch.setattr(rig.service._background, "forget_member", lambda member: None, raising=False)

    async def run(driver, **kwargs):
        calls.append(kwargs)
        if overflow and overflow[0]:
            overflow[0] = False
            yield Event("error", "context_overflow")
            return
        yield Event("session", kwargs["session"] or f"synthetic-native-{len(calls)}")
        yield Event("usage", data={"input_tokens": 1000, "context_window": 1000000})
        yield Event("final", "Synthetic answer. " + "The planned review preserves the recorded scope and schedule. " * 8)

    monkeypatch.setattr(cli.Driver, "run", run)


@pytest.mark.parametrize("brain", ["claude", "codex", "gemini"])
async def test_subscription_cli_turn_is_not_blocked_by_paid_monthly_cap(make_rig, monkeypatch, client, brain):
    rig = make_rig()
    rig.settings.set("monthly_limit_usd", .01)
    rig.settings.set("agent_model", "cli:" + brain)
    spent(rig)
    calls = []
    fake_cli(monkeypatch, rig, calls)
    result = await rig.call("agent.ask", {"session_id": "subscription", "text": "Explain this synthetic example",
        "ui_language": "en", "source": "app"})
    assert result["status"] == "done" and len(calls) == 1
    assert client.calls == 0 and not client.chat_calls


async def test_unknown_model_window_never_inherits_the_previous_models_window(make_rig):
    known = replace(llm("synthetic/large"), context_length=1000000)
    rig = make_rig(models=lambda: [known])
    conversation_id = rig.service.conversations.main(0)
    conversation = rig.service._conversation_of(0, conversation_id)
    rig.settings.set("agent_model", known.id)
    rig.service._memory_context(RAPHAEL, conversation_id)
    assert conversation.context_window == 1000000
    for unknown in ("synthetic/unknown", "cli:codex:unknown"):
        rig.settings.set("agent_model", unknown)
        rig.service._memory_context(RAPHAEL, conversation_id)
        assert conversation.context_window == DEFAULT_CONTEXT_WINDOW


async def test_ten_turn_cli_measurement_uses_the_same_synthetic_conversation_before_and_after(
    make_rig, memory, monkeypatch,
):
    rig = make_rig(memory=memory)
    monkeypatch.setattr(memory, "after_turn", lambda *args: None)
    rig.settings.set("agent_model", "cli:codex")
    assert memory.update_memory(0, {"target": "memory", "operations": [{"action": "add", "content": "Synthetic private note: the test project is named Cedar."}]}).ok
    assert memory.update_memory(0, {"target": "user", "operations": [{"action": "add", "content": "Synthetic shared note: use metric measurements."}]}).ok
    roster = "SYNTHETIC_ROSTER\nMember Cedar handles synthetic review tasks."
    monkeypatch.setattr(agent_module, "roster_prompt", lambda *args: roster)
    monkeypatch.setattr(agent_module, "background_block", lambda *args: "SYNTHETIC_BACKGROUND_RESULT")
    monkeypatch.setattr(rig.service, "_recall", lambda ask, context=None: "SYNTHETIC_RECALL")
    calls = []
    fake_cli(monkeypatch, rig, calls)
    rows = {}
    for mode in ("forced_fresh", "resumed"):
        if mode == "resumed":
            await rig.call("agent.history.clear", {"member_id": 0})
        start = len(calls)
        for index in range(10):
            if mode == "forced_fresh":
                rig.service._cli_sessions.clear()
            question = f"Synthetic request {index:02d}. " + "Compare the planned review scope and preserve the recorded constraints. " * 5
            result = await rig.call("agent.ask", {"session_id": f"{mode}-{index}", "text": question,
                "ui_language": "en", "source": "app", "quote": {"text": "SYNTHETIC_QUOTE", "author": "Synthetic author"}})
            assert result["status"] == "done"
        selected = calls[start:]
        assert len(selected) == 10
        if mode == "forced_fresh":
            assert all(call["session"] is None for call in selected)
        else:
            assert selected[0]["session"] is None and all(call["session"] for call in selected[1:])
            for call in selected[1:]:
                assert "Synthetic request 00." not in call["user"]
                assert "SYNTHETIC_ROSTER" not in call["user"] + call["system"]
                assert "Synthetic private note" not in call["user"] + call["system"]
        for call in selected:
            assert all(text in call["user"] for text in ("SYNTHETIC_RECALL", "SYNTHETIC_BACKGROUND_RESULT", "SYNTHETIC_QUOTE"))
            assert "SYNTHETIC_ROSTER" not in call["system"]
            assert call["user"].count("SYNTHETIC_ROSTER") <= 1
        rows[mode] = [{"bytes": len((call["system"] + call["user"]).encode("utf-8")),
                       "estimated_tokens": estimate_tokens(call["system"] + call["user"]),
                       "user_bytes": len(call["user"].encode("utf-8"))} for call in selected]
    assert sum(row["bytes"] for row in rows["resumed"]) < sum(row["bytes"] for row in rows["forced_fresh"])
    print("CLI_TEN_TURN_MEASUREMENT=" + json.dumps(rows, sort_keys=True))


@pytest.mark.parametrize("restart", ["model", "brain", "overflow", "cleared"])
async def test_cli_restart_carries_context_and_current_inputs_without_resurrecting_cleared_turns(
    make_rig, monkeypatch, restart,
):
    rig = make_rig()
    rig.settings.set("agent_model", "cli:codex")
    monkeypatch.setattr(agent_module, "roster_prompt", lambda *args: "SYNTHETIC_RESTART_ROSTER")
    monkeypatch.setattr(rig.service, "_recall", lambda ask, context=None: "SYNTHETIC_RESTART_RECALL")
    calls, overflow = [], [False]
    fake_cli(monkeypatch, rig, calls, overflow=overflow)
    params = {"session_id": "first", "text": "SYNTHETIC_PRIOR_QUESTION", "source": "app", "ui_language": "en"}
    assert (await rig.call("agent.ask", params))["status"] == "done"
    rig.service._conversation_of(0, rig.service.conversations.main(0))._save("SYNTHETIC_ROLLING_SUMMARY", 0)
    if restart in ("model", "brain"):
        rig.settings.set("agent_model", "cli:codex:another" if restart == "model" else "cli:gemini")
    elif restart == "cleared":
        await rig.call("agent.history.clear", {"member_id": 0})
    else:
        overflow[0] = True
    result = await rig.call("agent.ask", {**params, "session_id": "next", "text": "SYNTHETIC_CURRENT_QUESTION",
        "quote": {"text": "SYNTHETIC_RESTART_QUOTE", "author": "Synthetic author"}})
    assert result["status"] == "done" and calls[-1]["session"] is None
    assert all(text in calls[-1]["user"] for text in ("SYNTHETIC_CURRENT_QUESTION", "SYNTHETIC_RESTART_QUOTE", "SYNTHETIC_RESTART_RECALL", "SYNTHETIC_RESTART_ROSTER"))
    assert ("SYNTHETIC_PRIOR_QUESTION" in calls[-1]["user"]) == (restart != "cleared")
    assert ("SYNTHETIC_ROLLING_SUMMARY" in calls[-1]["user"]) == (restart != "cleared")


@pytest.mark.parametrize("other_model", ["cli:codex:another", "cli:gemini", "synthetic/api"])
async def test_returning_to_a_checkpointed_model_resumes_with_only_intervening_context(
    make_rig, monkeypatch, client, other_model,
):
    rig = make_rig()
    calls = []
    fake_cli(monkeypatch, rig, calls)
    params = {"session_id": "model-switch", "source": "app", "ui_language": "en"}
    rig.settings.set("agent_model", "cli:codex")
    await rig.call("agent.ask", {**params, "text": "SYNTHETIC_ORIGINAL_MODEL_QUESTION"})
    rig.settings.set("agent_model", other_model)
    client.chats.append(chat("Synthetic intervening answer."))
    await rig.call("agent.ask", {**params, "text": "SYNTHETIC_INTERVENING_QUESTION"})
    rig.settings.set("agent_model", "cli:codex")
    result = await rig.call("agent.ask", {**params, "text": "SYNTHETIC_RETURN_QUESTION"})
    assert result["status"] == "done" and calls[-1]["session"] == "synthetic-native-1"
    assert "SYNTHETIC_INTERVENING_QUESTION" in calls[-1]["user"]
    assert "SYNTHETIC_ORIGINAL_MODEL_QUESTION" not in calls[-1]["user"]


async def test_resumed_cli_receives_only_memory_and_roster_edits(make_rig, memory, monkeypatch):
    rig = make_rig(memory=memory)
    monkeypatch.setattr(memory, "after_turn", lambda *args: None)
    rig.settings.set("agent_model", "cli:codex")
    roster = ["SYNTHETIC_STABLE_ROSTER\nSYNTHETIC_OLD_ROLE"]
    monkeypatch.setattr(agent_module, "roster_prompt", lambda *args: roster[0])
    calls = []
    fake_cli(monkeypatch, rig, calls)
    params = {"session_id": "edits", "source": "app", "ui_language": "en"}
    await rig.call("agent.ask", {**params, "text": "Synthetic first question"})
    roster[0] = "SYNTHETIC_STABLE_ROSTER\nSYNTHETIC_NEW_ROLE"
    assert memory.update_memory(0, {"target": "memory", "operations": [
        {"action": "add", "content": "SYNTHETIC_NEW_MEMORY_NOTE"}]}).ok
    await rig.call("agent.ask", {**params, "text": "Synthetic next question"})
    changed = calls[-1]["user"]
    assert calls[-1]["session"]
    assert "Team changed" in changed and "Memory changed" in changed
    assert "SYNTHETIC_NEW_ROLE" in changed and "SYNTHETIC_NEW_MEMORY_NOTE" in changed
    assert "SYNTHETIC_STABLE_ROSTER" not in changed and "SYNTHETIC_OLD_ROLE" not in changed
    await rig.call("agent.ask", {**params, "text": "Synthetic unchanged question"})
    assert "Team changed" not in calls[-1]["user"] and "Memory changed" not in calls[-1]["user"]


async def test_returning_cli_receives_newly_folded_intervening_context_only_once(make_rig, monkeypatch):
    rig = make_rig()
    calls = []
    fake_cli(monkeypatch, rig, calls)
    params = {"session_id": "folded-model-switch", "source": "app", "ui_language": "en"}
    rig.settings.set("agent_model", "cli:codex")
    await rig.call("agent.ask", {**params, "text": "SYNTHETIC_ORIGINAL_QUESTION"})
    rig.settings.set("agent_model", "cli:gemini")
    for text in ("SYNTHETIC_OPENING_QUESTION", "SYNTHETIC_FOLDED_QUESTION", "SYNTHETIC_RECENT_QUESTION"):
        result = await rig.call("agent.ask", {**params, "text": text})
        if text == "SYNTHETIC_FOLDED_QUESTION":
            through = result["turn_id"]
    conversation = rig.service._conversation_of(0, rig.service.conversations.main(0))
    conversation._save("SYNTHETIC_NEWLY_FOLDED_FACT", through)
    assert all(turn.question != "SYNTHETIC_FOLDED_QUESTION" for turn in conversation.context().turns)
    rig.settings.set("agent_model", "cli:codex")
    result = await rig.call("agent.ask", {**params, "text": "SYNTHETIC_RETURN_QUESTION"})
    assert result["status"] == "done" and calls[-1]["session"] == "synthetic-native-1"
    assert "SYNTHETIC_NEWLY_FOLDED_FACT" in calls[-1]["user"]
    assert "SYNTHETIC_RECENT_QUESTION" in calls[-1]["user"]
    assert "SYNTHETIC_ORIGINAL_QUESTION" not in calls[-1]["user"]
    await rig.call("agent.ask", {**params, "text": "SYNTHETIC_FOLLOWUP_QUESTION"})
    assert "SYNTHETIC_NEWLY_FOLDED_FACT" not in calls[-1]["user"]
    conversation._save("SYNTHETIC_ALREADY_READ_FOLD", result["turn_id"])
    await rig.call("agent.ask", {**params, "text": "SYNTHETIC_ORDINARY_FOLD_FOLLOWUP"})
    assert "SYNTHETIC_ALREADY_READ_FOLD" not in calls[-1]["user"]

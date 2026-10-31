"""Regression contracts for failures that a member can diagnose without provider calls."""

from raphael_core.agent.quota import Quotas, parse_quota
import asyncio
import json
import re
from pathlib import Path
from types import SimpleNamespace

import pytest

from raphael_core.failures import KINDS, Failure, RECENT, classify, redact
from .test_service import make_rig  # noqa: F401
from .test_narration import chat, typed


@pytest.mark.parametrize("language,name", [("zh-TW", "拉斐爾"), ("ja", "ラファエル"), ("en", "Raphael")])
@pytest.mark.parametrize("kind", sorted(KINDS))
def test_owner_failure_copy_never_exposes_machine_diagnostics(kind, language, name):
    from raphael_core.failures import _OWNER_MESSAGES
    assert set(_OWNER_MESSAGES[language]) == KINDS
    failure = Failure(kind, "not_configured; raw provider reason")
    text = failure.sentence(name, language)
    assert name in text and failure.reason not in text
    assert not re.search(r"[A-Za-z]+_[A-Za-z_]+|[（(]" + re.escape(kind) + r"[）)]|;", text)
    assert text.endswith("." if language == "en" else "。")
    if language != "en":
        assert not re.search(r"[A-Za-z]|[,:.!?]", text)
    assert failure.wire() == {"kind": kind, "reason": failure.reason}


@pytest.mark.parametrize("language,name", [("zh-TW", "拉斐爾"), ("ja", "ラファエル"), ("en", "Raphael")])
@pytest.mark.parametrize("member", [False, True])
def test_failed_reply_names_its_speaking_member(make_rig, monkeypatch, language, name, member):
    from raphael_core.agent.failure import AgentFailure
    from raphael_core.agent.service import _Ask
    from raphael_core.agent.speaker import Speaker
    rig = make_rig()
    speaker = Speaker(id=7, name="小晴") if member else Speaker()
    ask = _Ask("failed-member", "Hello", language, speaker=speaker)
    monkeypatch.setattr(rig.service, "_finish", lambda ask, route, which, text, ledger, **kwargs: text)
    diagnostic = Failure("auth_expired", "not_configured")
    text = rig.service._failed(ask, "answer", AgentFailure("auth", diagnostic=diagnostic), None)
    assert text == diagnostic.sentence(speaker.name if member else name, language)
    if member:
        assert not any(chief in text for chief in ("Raphael", "拉斐爾", "ラファエル"))


def test_native_fake_reply_reads_the_wire_but_does_not_use_failure_copy(monkeypatch):
    from raphael_core.native_journeys import native_diagnosis
    monkeypatch.setenv("RAPHAEL_TEST_NATIVE", "1")
    monkeypatch.setattr(Failure, "sentence", lambda *args: pytest.fail("The fake brain must write its own reply"))
    task = '[native-diagnosis] card_failure {"kind": "auth_expired", "reason": "not_configured"}'
    messages = [{"role": "user", "content": task}]
    assert native_diagnosis(messages, {"self_check"}, 0) == ("self_check", {})
    action, text = native_diagnosis(messages, {"self_check"}, 1)
    assert action == "reply" and "Gmail 還沒登入" in text and "我已檢查設定" in text
    assert "auth_expired" not in text and "not_configured" not in text and ";" not in text
    messages[0]["content"] = task.replace("not_configured", "another_reason")
    with pytest.raises(ValueError, match="different connection failure"):
        native_diagnosis(messages, {"self_check"}, 1)


def test_full_codex_plan_with_credits_does_not_block_the_october_28_turn(conn):
    # Synthetic protocol fixture recreates the reported state; no original October 28 packet is available.
    now = 1793199240000
    packet = {"method": "account/rateLimits/updated", "params": {"rateLimits": {
        "limitId": "codex", "primary": {"usedPercent": 100, "windowDurationMins": 300,
                                           "resetsAt": now // 1000 + 3600},
        "credits": {"hasCredits": True, "unlimited": False, "balance": "12.50"}}}}
    parsed = parse_quota(packet, now)
    assert parsed["exhausted"] is False
    assert parsed["credits"]["has_credits"] is True
    store = Quotas(conn, lambda: now)
    store.record("codex", parsed)
    assert store.list() == []
    assert store.allowances("codex")[0]["remaining_percent"] == 0


async def test_full_codex_window_with_credits_completes_a_turn(make_rig, monkeypatch):
    from raphael_core.agent.cli.drivers import Driver
    from raphael_core.agent.cli.discovery import CliBrains
    from raphael_core.agent.quota import wall_clock_ms
    rig = make_rig()
    rig.service._settings.set("agent_model", "cli:codex")
    monkeypatch.setattr(CliBrains, "command", lambda *args: ["fake-codex"])
    monkeypatch.setattr(CliBrains, "available", lambda *args, **kwargs: True)
    async def fake_run(driver, **kwargs):
        driver._observe_quota({"method": "account/rateLimits/updated", "params": {"rateLimits": {
            "primary": {"usedPercent": 100, "windowDurationMins": 300, "resetsAt": wall_clock_ms() // 1000 + 3600},
            "credits": {"hasCredits": True, "unlimited": False, "balance": "12.50"}}}})
        assert not driver.exhausted
        yield driver._event("final", "Completed with available credits.")
    monkeypatch.setattr(Driver, "run", fake_run)
    result = await typed(rig)
    assert result["text"] == "Completed with available credits."
    assert rig.service.quotas.list() == []
    assert rig.service.quotas.allowances("codex")[0]["remaining_percent"] == 0


def test_background_brains_also_offer_diagnostics():
    from raphael_core.background.snapshot import take_snapshot
    from raphael_core.agent.policy import Tier
    snapshot = take_snapshot(None)
    assert snapshot.refs["self_check"].tier == snapshot.refs["raphael_help"].tier == Tier.T0


def test_failure_continuation_never_claims_connection_or_secret_success(make_rig):
    from raphael_core.agent.history import Turn
    rig = make_rig()
    # Even a later successful owner action must not rewrite the earlier failure's event line.
    rig.service._cards = SimpleNamespace(views=lambda ids: {1: [{"app": "gmail", "name": "Gmail", "logo": "", "state": "connected"}]})
    rig.service._secret_cards = SimpleNamespace(views=lambda ids: {1: [{"name": "Weather", "state": "saved"}]})
    turn = Turn(2, 1000, "failure-1", "Continue", "answer", "", "auth_expired", None,
                "done", source="connector", source_turn_id=1)
    view = rig.service._turn_views([turn])[0]
    assert "resumed_apps" not in view and "resumed_secrets" not in view
    turn.session_id = "connect-1"
    view = rig.service._turn_views([turn])[0]
    assert view["resumed_apps"] == ["gmail"] and view["resumed_secrets"] == ["Weather"]
    assert view["resumed_app_names"] == ["Gmail"] and view["resumed_app_logos"] == [""]


async def test_late_card_failure_does_not_restart_a_cancelled_request(make_rig, client):
    rig = make_rig()
    turn_id = rig.history.add(session_id="cancelled-source", question="Read Gmail", route="answer",
                              prefix="", text="Stopped", status="done", source="app")
    rig.service._cards = SimpleNamespace(cards_of=lambda turn: [SimpleNamespace(language="en")])
    rig.service._cancelled["cancelled-source"] = rig.clock()
    assert (await rig.service.failure_turn(turn_id, Failure("auth_expired", "not_configured"))).ok
    assert not client.chat_calls and len(rig.history.for_session("cancelled-source")) == 1


def test_self_check_does_not_prune_or_write_runtime_state(make_rig):
    from raphael_core.agent.self_check import snapshot
    from raphael_core.agent.speaker import RAPHAEL
    rig = make_rig()
    conn = rig.service._conn
    with conn:
        conn.execute("INSERT INTO subscription_quotas VALUES ('codex',1,1)")
    before = conn.total_changes
    data = snapshot(rig.service, SimpleNamespace(speaker=RAPHAEL, conversation_id=None))
    assert conn.total_changes == before
    assert any(brain["id"] == "codex" and brain["blocked"] is None for brain in data["brains"])


@pytest.mark.parametrize("source", ["vault", "resume"])
async def test_secret_card_failures_return_without_the_submitted_value(tmp_path, conn, source):
    from test_secret_cards import Rig, Outcome
    rig = Rig(tmp_path, conn)
    await rig.connection()
    (card,) = rig.show("Weather")
    failures = []
    async def failed(turn_id, failure):
        failures.append((turn_id, failure.wire()))
    rig.cards.failure = failed
    if source == "vault":
        rig.vault.fail = RuntimeError(rig.key)
    else:
        rig.resume.outcomes = [Outcome(False)]
    await rig.save(card)
    assert len(failures) == 1 and failures[0][0] == rig.turn
    assert rig.key not in json.dumps(failures)


@pytest.mark.parametrize("raises", [False, True])
async def test_connected_card_returns_a_failed_resume_to_the_turn(tmp_path, conn, raises):
    from test_connect_cards import Rig
    from raphael_core.evaluate.google_fixture import GoogleFixture
    fixture = GoogleFixture("resume-failure")
    rig = Rig(tmp_path, conn, fixture)
    await rig.configure()
    failures = []

    async def resume(turn_id):
        if raises:
            raise TimeoutError("Continuation timed out")
        return SimpleNamespace(ok=False)

    async def failed(turn_id, failure):
        failures.append((turn_id, failure.kind))

    rig.cards.resume, rig.cards.failure = resume, failed
    await rig.connect(rig.card())
    assert failures == [(rig.turn, "timeout" if raises else "tool_broken")]


async def test_cancelled_secret_resume_never_starts_a_diagnostic_turn(tmp_path, conn):
    from test_secret_cards import Rig
    rig = Rig(tmp_path, conn)
    await rig.connection()
    (card,) = rig.show("Weather")
    started, failures = asyncio.Event(), []
    async def resume(*args):
        started.set()
        await asyncio.Event().wait()
    async def failed(*args):
        failures.append(args)
    rig.cards.resume, rig.cards.failure = resume, failed
    await rig.router.call("integrations.card_save", {"id": card.id, "value": rig.key})
    await started.wait()
    await rig.cards.aclose()
    assert failures == []


async def test_failed_card_returns_the_reason_to_its_member(tmp_path, conn):
    from test_connect_cards import Rig
    from raphael_core.evaluate.google_fixture import GoogleFixture
    rig = Rig(tmp_path, conn, GoogleFixture("n0nce"))
    failures = []

    async def failed(turn_id, failure):
        failures.append((turn_id, failure.kind))
    rig.cards.failure = failed
    await rig.connect(rig.card())
    assert failures == [(rig.turn, "auth_expired")]


@pytest.mark.parametrize("value,kind", [
    ({"error": {"message": "Not enough credits", "code": "insufficient_credits"}}, "credits"),
    ({"error": {"message": "Usage limit reached", "code": "usageLimitExceeded"}}, "usage_limit"),
    ({"error": {"message": "too many requests", "status": 429}}, "rate_limit"),
    ({"error": {"message": "model busy", "codex_error_info": "server_overloaded"}}, "overloaded"),
    ({"status": 503, "message": "Provider unavailable"}, "server"),
    ("refresh token expired", "auth_expired"), ("connection reset", "network"),
    ("toolkit_not_allowed", "permission_denied"), ("gone", "not_found"),
    ("invalid tool schema", "tool_broken"), (TimeoutError(), "timeout"),
    ("policy violation", "refused"), ("unexpected exit", "unknown"),
])
def test_every_brain_and_tool_uses_the_same_taxonomy(value, kind):
    assert classify(value).kind == kind
    assert kind in KINDS


def test_diagnostics_redact_keys_tokens_emails_and_profile_paths(caplog):
    text = r'HTTP 503 token=hidden secret="private value" Bearer short-token sk-test-secret lt_secret refresh_token alice@example.com C:\Users\Alice\private.json'
    failure = classify(text)
    assert failure.kind == "server"
    assert all(value not in failure.reason + caplog.text for value in (
        "hidden", "private value", "short-token", "sk-test-secret", "lt_secret", "refresh_token", "Bearer ", "alice@example.com", "Alice"))
    assert "503" in failure.reason
    assert "Alice" not in redact(repr(PermissionError(r'C:\Users\Alice\private.json')))
    assert len(classify("x" * 2000).reason) <= 240


@pytest.mark.parametrize("credits,blocked", [
    ({"hasCredits": True, "unlimited": False, "balance": "4.50"}, False),
    ({"hasCredits": False, "unlimited": True, "balance": None}, False),
    ({"hasCredits": False, "unlimited": False, "balance": "0"}, True),
    ({"hasCredits": False, "unlimited": False, "balance": "7"}, True),
    ({"hasCredits": "true", "balance": "NaN"}, True),
])
def test_credit_entitlement_is_explicit_and_keeps_home_usage(conn, credits, blocked):
    now = 1793199240000
    packet = {"rateLimits": {"primary": {"usedPercent": 100, "windowDurationMins": 300,
                                        "resetsAt": now // 1000 + 30}, "credits": credits}}
    parsed = parse_quota(packet, now)
    assert parsed["exhausted"] is blocked
    store = Quotas(conn, lambda: now)
    store.record("codex", parsed)
    store.record("codex", {"exhausted": False})
    assert bool(store.list()) is blocked
    assert store.allowances("codex")[0]["remaining_percent"] == 0


def test_transient_429_never_marks_a_subscription_exhausted():
    assert parse_quota({"error": {"message": "Too many requests", "httpStatusCode": 429}}, 1793199240000) is None
    assert parse_quota({"error": {"code": "rate_limit_exceeded"}}, 1793199240000) is None


def test_explicit_usage_denial_wins_over_cached_credit_entitlement(conn):
    now = 1793199240000
    data = parse_quota({"error": {"code": "usageLimitExceeded", "message": "Usage limit reached"},
                        "rateLimits": {"primary": {"usedPercent": 100, "windowDurationMins": 300,
                                                    "resetsAt": now // 1000 + 30},
                                       "credits": {"hasCredits": True, "balance": "12.50"}}}, now)
    store = Quotas(conn, lambda: now)
    store.record("codex", data)
    assert store.list() == [{"provider": "codex", "reset_at_ms": now + 30000}]


async def test_self_check_and_help_are_t0_and_never_return_key_values(make_rig, client, monkeypatch):
    from raphael_core.agent.harness_tools import TIERS, definitions_for
    from raphael_core.agent.policy import Tier
    rig = make_rig()
    rig.service._keys.set("opaque-secret-value")
    client.chats = [chat("Checking.", ("self_check", {}), ("raphael_help", {})), chat('{"text":"Checked."}')]
    result = await typed(rig)
    assert result["text"] == "Checked."
    messages = json.dumps(client.chat_calls[-1]["messages"])
    assert "opaque-secret-value" not in messages
    assert any('"OpenRouter": true' in message.get("content", "") for message in client.chat_calls[-1]["messages"])
    for member in (0, 1):
        from raphael_core.agent.speaker import Speaker
        assert {"self_check", "raphael_help"} <= dict(definitions_for(Speaker(id=member))).keys()
    assert TIERS["self_check"] == TIERS["raphael_help"] == Tier.T0


def test_reference_names_and_prompt_doctrine_follow_real_code():
    from raphael_core.agent.self_check import REFERENCES, PANES, SAFE_SETTINGS, ABOUT_INDEX, DOCTRINE
    from raphael_core.agent.persona import system_prompt, member_system_prompt, cli_system_prompt
    from raphael_core.brain.settings import DEFAULTS
    core = Path(__file__).resolve().parents[2]
    for relative, names in REFERENCES.items():
        source = (core / "src/raphael_core" / relative).read_text(encoding="utf-8")
        for name in names:
            assert name in source, (relative, name)
    types = (core.parent / "app/src/main/types.ts").read_text(encoding="utf-8")
    for pane in PANES:
        assert f'"{pane}"' in types
    assert set(SAFE_SETTINGS) <= DEFAULTS.keys()
    for prompt in (system_prompt("en", "answer"), member_system_prompt("en", "answer", name="Peer", role="Help", instructions=""), cli_system_prompt("en")):
        assert DOCTRINE in prompt and ABOUT_INDEX in prompt


async def test_api_corrective_round_is_bounded_and_never_follows_an_owner_denial():
    from raphael_core.worker.loop import Call, Turn, ToolOutcome, run_task
    tools = [{"type": "function", "function": {"name": "read", "parameters": {"type": "object"}}}]
    for kind, expected in (("network", 3), ("denied", 2)):
        calls = []

        async def model(messages, tools):
            calls.append(list(messages))
            return Turn("I cannot continue.", [Call("read", "read", {})] if len(calls) == 1 else [])

        async def tool(*args):
            return ToolOutcome(False, kind)
        outcome = await run_task(SimpleNamespace(chat=model, tool=tool), system="", user="", tools=tools, corrective_rounds=1)
        assert outcome.status == "done" and len(calls) == expected


async def test_repeated_kind_blocks_the_tool_even_with_different_arguments():
    from raphael_core.worker.loop import Call, Turn, ToolOutcome, run_task
    tools = [{"type": "function", "function": {"name": "read", "parameters": {"type": "object"}}}]
    attempts, messages_seen = [], []

    async def model(messages, tools):
        messages_seen.append(list(messages))
        n = len(messages_seen)
        return Turn("Report.", [Call(str(n), "read", {"query": n})] if n <= 3 else [])

    async def tool(identifier, name, arguments):
        attempts.append(arguments)
        return ToolOutcome(False, "network")
    await run_task(SimpleNamespace(chat=model, tool=tool), system="", user="", tools=tools)
    assert len(attempts) == 2
    assert "different approach" in messages_seen[-1][-1]["content"]


def test_confirmed_failures_count_across_api_pauses():
    from raphael_core.agent.narration import NarratedLoop
    from raphael_core.failures import RepeatFailures
    from raphael_core.worker.loop import ToolOutcome
    loop = object.__new__(NarratedLoop)
    loop.failure_guard = RepeatFailures()
    for number in range(2):
        loop.waiting_call = str(number)
        loop.messages = [{"role": "assistant", "tool_calls": [{"id": str(number),
                         "function": {"name": "read", "arguments": json.dumps({"query": number})}}]}]
        loop.continue_with(ToolOutcome(False, "network", "Connection reset"))
        assert loop.failure_guard.blocked("read") is (number == 1)


async def test_transient_api_retry_is_three_times_and_after_work_it_goes_on_without_running_a_tool_again(make_rig, client, monkeypatch):
    from raphael_core.brain.openrouter import OpenRouterError
    sleeps = []

    async def sleep(seconds):
        sleeps.append(seconds)
    monkeypatch.setattr("raphael_core.agent.narration.asyncio.sleep", sleep)
    rig = make_rig()
    client.chats = [OpenRouterError(503, "server", "Temporarily unavailable")] * 3 + [chat('{"text":"Recovered."}')]
    assert (await typed(rig))["text"] == "Recovered."
    assert sleeps == [1, 3, 8]
    sleeps.clear()
    client.chat_calls.clear()
    client.chats = [chat("Checking.", ("local_time", {})), *[OpenRouterError(503, "server", "Temporarily unavailable")] * 5, chat('{"text":"Recovered."}')]
    assert (await typed(rig))["text"] == "Recovered."
    assert sleeps == [1, 3, 8, 30, 60]
    assert client.chat_calls[1]["messages"] == client.chat_calls[-1]["messages"]

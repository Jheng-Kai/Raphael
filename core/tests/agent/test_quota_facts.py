"""What Raphael may say about a quota: only what self_check's quota facts say, per provider, and a member's failure has its
own cause. Synthetic turns and readings; no provider is asked."""

import json
from types import SimpleNamespace

from raphael_core.agent.history import AgentHistory
from raphael_core.agent.quota import Quotas
from raphael_core.agent.self_check import ABOUT_INDEX, QUOTA_RULE, quota_facts

NOW = 1_800_000_000_000  # ms
HOUR = 3_600_000


def service(conn):
    people = {1: SimpleNamespace(name="Alice"), 2: SimpleNamespace(name="Bob"), 0: SimpleNamespace(name="")}
    return SimpleNamespace(_conn=conn, quotas=Quotas(conn, lambda: NOW), _speaker=people.get)


def turn(conn, at, *, member=1, model="@chatgpt:gpt-test", failure=None):
    history = AgentHistory(conn, lambda: at)
    return history.add(session_id=f"s{at}-{member}", question="Q", route="answer", prefix="", text="", member_id=member, model=model,
                       status="error" if failure else "done", failure=failure)


def fact(facts, provider):
    return next(item for item in facts["providers"] if item["provider"] == provider)


def test_a_window_that_the_subscription_reported_spent_is_used_up_until_it_resets(conn):
    reset = NOW // 1000 + 2 * 3600
    store = Quotas(conn, lambda: NOW)
    store.record("codex", {"exhausted": True, "reset_at_ms": reset * 1000, "windows": [
        {"period": "weekly", "remaining_percent": 0, "resets_at": reset, "status": "rejected"},
        {"period": "fiveHour", "remaining_percent": 80, "resets_at": reset - 100, "status": "allowed"}]})
    facts = quota_facts(service(conn), now_ms=NOW)
    codex = fact(facts, "codex")
    assert (codex["state"], codex["used_up_until"], codex["basis"]) == ("used_up", reset, "reading")
    assert [w["used_up"] for w in codex["windows"]] == [False, True]
    # A provider nobody has read says so, and is not used up.
    assert (fact(facts, "claude")["state"], fact(facts, "claude")["used_up_until"]) == ("not_reported", None)
    assert facts["rule"] == QUOTA_RULE


def test_a_reading_that_a_later_successful_turn_contradicts_is_not_used_up(conn):
    reset = NOW // 1000 + 3600
    store = Quotas(conn, lambda: NOW - HOUR)
    store.record("codex", {"exhausted": True, "reset_at_ms": reset * 1000, "windows": [
        {"period": "weekly", "remaining_percent": 0, "resets_at": reset, "status": "rejected"}]})
    turn(conn, NOW - 1000, model="cli:codex:gpt-test")
    codex = fact(quota_facts(service(conn), now_ms=NOW), "codex")
    assert codex["state"] == "available" and codex["used_up_until"] is None and "succeeded" in codex["basis"]


def test_chatgpt_is_used_up_only_by_its_own_failure_and_only_until_a_later_turn_works(conn):
    spent = {"kind": "usage_limit", "provider": "chatgpt", "resets_at": NOW // 1000 + 7200}
    turn(conn, NOW - 5000, member=1, failure=spent)
    facts = quota_facts(service(conn), now_ms=NOW)
    chatgpt = fact(facts, "chatgpt")
    assert (chatgpt["state"], chatgpt["used_up_until"], chatgpt["basis"]) == ("used_up", spent["resets_at"], "the latest turn on it")
    [failure] = facts["member_failures"]
    assert failure["member"] == "Alice" and failure["kind"] == "usage_limit" and failure["used_up_until"] == spent["resets_at"]
    # A routine of another member ran fine afterwards: the plan is not used up.
    turn(conn, NOW - 1000, member=2)
    facts = quota_facts(service(conn), now_ms=NOW)
    assert fact(facts, "chatgpt")["state"] == "available" and fact(facts, "chatgpt")["used_up_until"] is None


def test_chatgpt_members_that_run_fine_are_available_and_nothing_is_called_used_up(conn):
    turn(conn, NOW - 3000, member=1)
    turn(conn, NOW - 2000, member=2)
    facts = quota_facts(service(conn), now_ms=NOW)
    assert fact(facts, "chatgpt")["state"] == "available" and facts["member_failures"] == []
    assert not [item for item in facts["providers"] if item["state"] == "used_up"]


def test_a_members_failure_has_its_real_cause_and_a_rate_limit_is_no_used_up_quota(conn):
    turn(conn, NOW - 4000, member=1, failure={"kind": "rate_limit", "provider": "chatgpt", "resets_at": None})
    turn(conn, NOW - 3000, member=2, failure={"kind": "auth_expired", "provider": "openrouter", "resets_at": None})
    turn(conn, NOW - 2000, member=0, failure={"kind": "usage_limit", "provider": "cli:claude", "resets_at": NOW // 1000 - 60})
    facts = quota_facts(service(conn), now_ms=NOW)
    by_member = {item["member"]: item for item in facts["member_failures"]}
    assert set(by_member) == {"Alice", "Bob", "Raphael"}
    assert by_member["Alice"]["kind"] == "rate_limit" and by_member["Alice"]["used_up_until"] is None
    assert "too many requests" in by_member["Alice"]["cause"]
    assert "signed out" in by_member["Bob"]["cause"] or "key" in by_member["Bob"]["cause"]
    assert fact(facts, "chatgpt")["state"] == "not_reported"
    # Claude's limit ended a minute ago: it is not used up now.
    assert fact(facts, "claude")["state"] != "used_up"
    json.dumps(facts)  # plain data, ready for the model


def test_the_instruction_says_a_quota_is_used_up_only_when_the_result_says_so():
    assert "used_up" in QUOTA_RULE and "not_reported" in QUOTA_RULE and "member_failures" in QUOTA_RULE
    assert "only when self_check's quota says used_up" in ABOUT_INDEX

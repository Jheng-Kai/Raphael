"""Provider diagnostics become bounded quota metadata, never public diagnostic text."""

from datetime import datetime, timezone
import pytest
from .test_service import make_rig  # noqa: F401

from raphael_core.agent.quota import Quotas, parse_quota

NOW = int(datetime(2026, 10, 24, 4, tzinfo=timezone.utc).timestamp() * 1000)


@pytest.mark.parametrize(("status", "utilization", "remaining", "exhausted"), [
    ("allowed", None, None, False),
    ("allowed_warning", .83, 17, False),
    ("rejected", 1, 0, True),
])
def test_claude_rate_limit_events_are_not_errors(status, utilization, remaining, exhausted):
    info = {"status": status, "resetsAt": NOW // 1000 + 3600, "rateLimitType": "five_hour"}
    if utilization is not None:
        info["utilization"] = utilization
    data = parse_quota({"type": "rate_limit_event", "rate_limit_info": info, "session_id": "private"}, NOW)
    assert data == {"exhausted": exhausted, "reset_at_ms": NOW + 3600000 if exhausted else None,
                    "windows": [{"period": "fiveHour", "remaining_percent": remaining,
                                 "resets_at": NOW // 1000 + 3600, "status": status}]}


async def test_real_run_events_persist_allowance_windows_without_private_text(conn, tmp_path, monkeypatch):
    import json
    import sys
    from raphael_core.agent.cli.drivers import Driver

    monkeypatch.setattr("raphael_core.agent.cli.drivers.wall_clock_ms", lambda: NOW)
    script = tmp_path / "claude.py"
    packets = [
        {"type": "rate_limit_event", "session_id": "PRIVATE", "rate_limit_info": {
            "status": "allowed_warning", "rateLimitType": "five_hour", "utilization": .83,
            "resetsAt": NOW // 1000 + 3600, "diagnostic": "PRIVATE"}},
        {"type": "rate_limit_event", "rate_limit_info": {
            "status": "allowed", "rateLimitType": "seven_day", "resetsAt": NOW // 1000 + 7200}},
        {"type": "result", "subtype": "success", "result": "Answer"},
    ]
    script.write_text("import sys\nsys.stdin.readline()\n" + "\n".join(f"print({json.dumps(packet)!r}, flush=True)" for packet in packets), encoding="utf-8")
    store = Quotas(conn, lambda: NOW)
    driver = Driver("claude", [sys.executable, str(script)], quota=store.record)
    events = [event async for event in driver.run(user="Question", system="Persona", endpoint="http://127.0.0.1:1/mcp",
                                                 token="ephemeral", permission=None)]
    assert events[-1].kind == "final"
    assert store.list() == []
    assert Quotas(conn, lambda: NOW + 1000).allowances("claude") == [
        {"period": "fiveHour", "remaining_percent": 17, "resets_at": NOW // 1000 + 3600,
         "status": "allowed_warning", "updated_at_ms": NOW},
        {"period": "weekly", "remaining_percent": None, "resets_at": NOW // 1000 + 7200,
         "status": "allowed", "updated_at_ms": NOW},
    ]


def test_codex_rate_limit_windows_use_the_latest_exhausted_reset():
    assert parse_quota({"rateLimits": {"primary": {"usedPercent": 100, "resetsAt": NOW // 1000 + 3600},
                                       "secondary": {"usedPercent": 100, "resetsAt": NOW // 1000 + 7200}}}, NOW) == {
        "exhausted": True, "reset_at_ms": NOW + 7200000,
    }


def test_codex_run_windows_keep_remaining_values_for_query_failure():
    data = parse_quota({"method": "account/rateLimits/updated", "params": {"rateLimits": {
        "primary": {"usedPercent": 24, "windowDurationMins": 300, "resetsAt": NOW // 1000 + 3600}}}}, NOW)
    assert data["windows"] == [{"period": "fiveHour", "remaining_percent": 76,
                                "resets_at": NOW // 1000 + 3600, "status": "allowed"}]


def test_claude_and_agy_diagnostics_keep_only_reset_metadata():
    assert parse_quota({"error": "Usage limit reached. Resets at 2026-10-24T13:58:00+08:00"}, NOW) == {
        "exhausted": True, "reset_at_ms": NOW + 7080000,
    }
    assert parse_quota({"error": "RESOURCE_EXHAUSTED quota, retry in 30 minutes"}, NOW)["reset_at_ms"] == NOW + 1800000
    assert parse_quota({"error": "network timeout"}, NOW) is None


def test_quota_persists_expires_and_clears_on_recovery(conn):
    now = [NOW]
    events = []
    store = Quotas(conn, lambda: now[0], lambda method, params: events.append((method, params)))
    store.record("codex", {"exhausted": True, "reset_at_ms": NOW + 1000})
    assert Quotas(conn, lambda: now[0]).list() == [{"provider": "codex", "reset_at_ms": NOW + 1000}]
    now[0] += 1000
    assert store.list() == []
    store.record("claude", {"exhausted": True, "reset_at_ms": None})
    store.record("claude", {"exhausted": False, "reset_at_ms": None})
    assert store.list() == []
    assert events[-1][0] == "quota.changed"


def test_recording_an_unchanged_quota_does_not_notify(conn):
    # Reading usage records live windows; a change event on every read made Home and Usage reload forever.
    now = [NOW]
    events = []
    store = Quotas(conn, lambda: now[0], lambda method, params: events.append(method))
    live = {"windows": [{"period": "fiveHour", "remaining_percent": 40, "resets_at": NOW // 1000 + 3600, "status": "allowed"}],
            "credits": {"has_credits": True, "unlimited": False, "balance": 5.0}, "exhausted": False}
    store.record("codex", live)
    now[0] += 5000
    store.record("codex", live)
    assert events == ["quota.changed"]
    store.record("codex", {**live, "windows": [{**live["windows"][0], "remaining_percent": 0, "status": "rejected"}]})
    assert events == ["quota.changed", "quota.changed"]


def _window(remaining, resets_at, period="fiveHour", status="allowed"):
    return {"windows": [{"period": period, "remaining_percent": remaining, "resets_at": resets_at, "status": status}],
            "exhausted": False}


def test_a_window_nine_tenths_used_warns_the_owner_once(conn):
    events = []
    store = Quotas(conn, lambda: NOW, lambda method, params: events.append((method, params)))
    reset = NOW // 1000 + 3 * 3600
    for remaining in (40, 11):
        store.record("codex", _window(remaining, reset))
    assert [method for method, _ in events] == ["quota.changed", "quota.changed"]
    store.record("codex", _window(10, reset))
    warned = ("quota.warning", {"provider": "codex", "period": "fiveHour", "remaining_percent": 10, "resets_at": reset})
    assert events[-1] == warned
    # Lower readings of the same window, also with the reset a second off (it is derived from "resets in N s"), and
    # the usage page's own reads, tell nothing more.
    store.record("codex", _window(8, reset))
    store.record("codex", _window(3, reset + 2))
    store.record("codex", _window(2, reset), notify=False)
    assert [event for event in events if event[0] == "quota.warning"] == [warned]


def test_the_warning_stays_told_after_a_restart_and_comes_back_after_a_reset(conn):
    events = []
    now = [NOW]

    def told():
        return [params for method, params in events if method == "quota.warning"]

    reset = NOW // 1000 + 3600
    Quotas(conn, lambda: now[0], lambda method, params: events.append((method, params))).record("claude", parse_quota(
        {"type": "rate_limit_event", "rate_limit_info": {"status": "allowed_warning", "rateLimitType": "seven_day",
                                                         "utilization": .93, "resetsAt": reset}}, NOW))
    assert told() == [{"provider": "claude", "period": "weekly", "remaining_percent": 7, "resets_at": reset}]
    restarted = Quotas(conn, lambda: now[0], lambda method, params: events.append((method, params)))
    restarted.record("claude", _window(5, reset, "weekly"))
    assert len(told()) == 1
    now[0] = (reset + 60) * 1000
    following = reset + 7 * 86400
    restarted.record("claude", _window(100, following, "weekly"))
    restarted.record("claude", _window(9, following, "weekly", "allowed_warning"))
    assert told()[1:] == [{"provider": "claude", "period": "weekly", "remaining_percent": 9, "resets_at": following}]
    assert conn.execute("SELECT value FROM settings WHERE key = 'quota_warned'").fetchone()[0] == f'{{"claude/weekly": {following}}}'


def test_spent_stale_blocked_or_unheard_windows_tell_nothing(conn):
    events = []
    store = Quotas(conn, lambda: NOW, lambda method, params: events.append(method))
    reset = NOW // 1000 + 3600
    store.record("codex", _window(0, reset, status="rejected"))  # spent: the exhausted line says so
    store.record("claude", _window(4, NOW // 1000 - 60))  # a report of a window already over
    for period, remaining, status in (("weekly", 0, "rejected"), ("fiveHour", 6, "allowed")):
        store.record("gemini", _window(remaining, reset, period, status))  # blocked by its other window
    assert "quota.warning" not in events
    # A reading no one could hear is not marked as told: the next reading with a listener tells it.
    Quotas(conn, lambda: NOW).record("claude", _window(5, reset))
    store.record("claude", _window(5, reset))
    assert events.count("quota.warning") == 1


def test_a_window_read_without_its_reset_is_told_once_and_the_next_window_again(conn):
    events = []
    now = [NOW]
    store = Quotas(conn, lambda: now[0], lambda method, params: events.append(params))
    store.record("codex", _window(9, None))
    reset = NOW // 1000 + 3600
    store.record("codex", _window(8, reset))  # the same window, its reset read later
    store.record("codex", _window(7, None))
    assert [event for event in events if event] == [{"provider": "codex", "period": "fiveHour", "remaining_percent": 9, "resets_at": None}]
    now[0] = (reset + 60) * 1000
    store.record("codex", _window(6, reset + 5 * 3600))
    assert [event["resets_at"] for event in events if event] == [None, reset + 5 * 3600]


def test_healthy_short_window_and_success_do_not_clear_rejected_weekly_window(conn):
    store = Quotas(conn, lambda: NOW)
    for period, status in (("seven_day", "rejected"), ("five_hour", "allowed")):
        store.record("claude", parse_quota({"type": "rate_limit_event", "rate_limit_info": {
            "status": status, "rateLimitType": period, "resetsAt": NOW // 1000 + 3600}}, NOW))
    store.record("claude", {"exhausted": False})
    assert store.list() == [{"provider": "claude", "reset_at_ms": NOW + 3600000}]
    store.record("claude", parse_quota({"type": "rate_limit_event", "rate_limit_info": {
        "status": "allowed", "rateLimitType": "seven_day"}}, NOW))
    assert store.list() == []


@pytest.mark.parametrize("value", [True, -1, 2, float("nan"), float("inf"), "0.5"])
def test_invalid_claude_utilization_is_unknown(value):
    data = parse_quota({"type": "rate_limit_event", "rate_limit_info": {
        "status": "allowed", "rateLimitType": "five_hour", "utilization": value}}, NOW)
    assert data["windows"][0]["remaining_percent"] is None


def test_unknown_or_overage_events_do_not_claim_subscription_exhaustion():
    for info in ({"status": "rejected", "rateLimitType": "overage"}, {}, None):
        assert parse_quota({"type": "rate_limit_event", "rate_limit_info": info}, NOW) is None


@pytest.mark.parametrize(("provider", "packet"), [
    ("codex", {"method": "account/rateLimits/updated", "params": {"rateLimits": {"primary": {"usedPercent": 100, "resetsAt": NOW // 1000 + 3600}}}}),
    ("claude", {"type": "result", "is_error": True, "subtype": "error_during_execution", "result": "Usage limit reached; retry in 1 hour"}),
    ("gemini", {"event": "result", "result": {"status": "ERROR", "error": "RESOURCE_EXHAUSTED; retry in 1 hour"}}),
])
async def test_cli_ingress_records_only_quota_metadata(monkeypatch, provider, packet):
    import asyncio
    import json
    from types import SimpleNamespace
    from raphael_core.agent.cli.drivers import Driver

    monkeypatch.setattr("raphael_core.agent.cli.drivers.wall_clock_ms", lambda: NOW)
    recorded = []
    driver = Driver(provider, ["fake"], quota=lambda *value: recorded.append(value))
    stream = asyncio.StreamReader()
    stream.feed_data(json.dumps(packet).encode() + b"\n")
    driver.child = SimpleNamespace(process=SimpleNamespace(stdout=stream))
    assert await driver._read() == packet
    assert recorded == [(provider, {"exhausted": True, "reset_at_ms": NOW + 3600000})]
    assert driver.exhausted


def test_native_resume_ids_are_isolated_and_legacy_sessions_go_only_to_main(conn):
    from raphael_core.agent.cli.loop import Sessions
    from raphael_core.agent.conversations import Conversations
    conversations = Conversations(conn)
    main = conversations.main(0)
    Sessions(conn)
    with conn:
        conn.execute("INSERT INTO agent_cli_sessions VALUES (?, ?, ?)", (0, "cli:codex", "old-session"))
    sessions = Sessions(conn)
    other = conversations.quick()
    assert sessions.get(0, "cli:codex", main) == "old-session"
    assert sessions.get(0, "cli:codex", other) is None
    sessions.put(0, "cli:codex", "new-session", other)
    assert sessions.get(0, "cli:codex", main) == "old-session"
    assert sessions.get(0, "cli:codex", other) == "new-session"
    assert sessions.get(0, "cli:codex") == "old-session"
    assert conn.execute("SELECT count(*) FROM agent_cli_sessions").fetchone()[0] == 0


def test_late_native_session_cannot_restore_a_deleted_conversation(conn):
    from raphael_core.agent.cli.loop import Sessions
    sessions = Sessions(conn)
    conversation = sessions.conversations.main()
    with conn:
        conn.execute("DELETE FROM conversations WHERE id=?", (conversation,))
    sessions.put(0, "cli:codex", "late-session", conversation)
    assert sessions.get(0, "cli:codex", conversation) is None


def test_native_sessions_reject_another_members_conversation(conn):
    from raphael_core.agent.cli.loop import Sessions
    sessions = Sessions(conn)
    conversation = sessions.conversations.main()
    sessions.put(1, "cli:codex", "wrong-member", conversation)
    assert sessions.get(0, "cli:codex", conversation) is None
    sessions.put(0, "cli:codex", "right-member", conversation)
    assert sessions.get(1, "cli:codex", conversation) is None


async def test_usage_allowances_include_persisted_exhaustion_without_provider_prose(make_rig, monkeypatch):
    rig = make_rig()
    async def allowances(_brains):
        return {"brains": [{"id":"codex", "name":"Codex CLI", "windows":[]}]}
    monkeypatch.setattr("raphael_core.agent.cli.allowances.read_allowances", allowances)
    rig.service.quotas.record("claude", {"exhausted":True})
    result = await rig.call("usage.allowances", {})
    assert result["quotas"] == [{"provider":"claude", "reset_at_ms":None}]
    assert result["brains"][0]["id"] == "codex"


async def test_usage_allowances_prefers_live_then_timestamped_reports(make_rig, monkeypatch):
    rig = make_rig()
    async def allowances(_brains):
        return {"brains": [{"id": name, "name": label, "windows": windows} for name, label, windows in [
            ("codex", "Codex", [{"period": "fiveHour", "remaining_percent": 76, "resets_at": None}]),
            ("claude", "Claude", []), ("gemini", "Antigravity", []),
        ]]}
    monkeypatch.setattr("raphael_core.agent.cli.allowances.read_allowances", allowances)
    rig.service.quotas.record("claude", parse_quota({"type": "rate_limit_event", "rate_limit_info": {
        "status": "allowed", "rateLimitType": "seven_day", "utilization": .4}}, NOW))
    result = await rig.call("usage.allowances", {})
    assert [row["source"] for row in result["brains"]] == ["live", "reported", "unavailable"]
    assert result["brains"][1]["windows"][0]["remaining_percent"] == 60
    assert result["brains"][1]["windows"][0]["updated_at_ms"] > 0


async def test_allowance_reads_persist_windows_without_credits_and_tell_readers_only_a_real_change(make_rig, monkeypatch):
    from raphael_core.agent.cli.discovery import CliBrains
    monkeypatch.setattr(CliBrains, "command", lambda *args: ["never-spawn"])
    monkeypatch.setattr(CliBrains, "logged_in", lambda *args: True)
    rig = make_rig()
    notifications = []
    rig.service.quotas.notify = lambda *args: notifications.append(args)
    async def live(_):
        return {"brains": [{"id": "codex", "name": "Codex", "windows": [{"period": "fiveHour", "remaining_percent": 65, "resets_at": None}]}]}
    monkeypatch.setattr("raphael_core.agent.cli.allowances.read_allowances", live)
    await rig.call("usage.allowances")
    assert rig.service.quotas.allowances("codex")[0]["remaining_percent"] == 65
    async def forbidden(_):
        raise AssertionError("A cached read must not touch the CLI")
    monkeypatch.setattr("raphael_core.agent.cli.allowances.read_allowances", forbidden)
    cached = await rig.call("usage.allowances", {"refresh": False})
    assert cached["brains"][0]["windows"][0]["remaining_percent"] == 65
    # The first read changed what is stored, so the readers are told once; a cached read tells nothing.
    assert notifications == [("quota.changed", {})]


async def test_a_usage_read_at_ninety_percent_warns_once_and_changes_no_model(make_rig, monkeypatch):
    from raphael_core.agent.cli.discovery import CliBrains
    monkeypatch.setattr(CliBrains, "command", lambda *args: ["never-spawn"])
    monkeypatch.setattr(CliBrains, "logged_in", lambda *args: True)
    rig = make_rig()
    notifications = []
    rig.service.quotas.notify = lambda *args: notifications.append(args)
    reset = rig.service.quotas.now_ms() // 1000 + 3600

    def models():
        return ([tuple(row) for row in rig.conn.execute("SELECT id, model FROM members ORDER BY id")],
                [tuple(row) for row in rig.conn.execute("SELECT key, value FROM settings WHERE key != 'quota_warned' ORDER BY key")])

    before = models()

    async def live(_):
        return {"brains": [{"id": "codex", "name": "Codex", "windows": [{"period": "weekly", "remaining_percent": 6, "resets_at": reset}]}]}
    monkeypatch.setattr("raphael_core.agent.cli.allowances.read_allowances", live)
    await rig.call("usage.allowances")
    await rig.call("usage.allowances")
    # The first read changed the stored window (one quota.changed) and the owner is told once; the second found the
    # same numbers and moves nothing, and no model or setting moves.
    assert notifications == [("quota.changed", {}),
                             ("quota.warning", {"provider": "codex", "period": "weekly", "remaining_percent": 6, "resets_at": reset})]
    assert models() == before


def _live_codex(*windows, credits=None):
    row = {"id": "codex", "name": "Codex", "windows": list(windows)}
    if credits:
        row["credits"] = credits
    return {"brains": [row]}


def _signed_in_codex(monkeypatch, make_rig):
    from raphael_core.agent.cli.discovery import CliBrains
    monkeypatch.setattr(CliBrains, "command", lambda *args: ["never-spawn"])
    monkeypatch.setattr(CliBrains, "logged_in", lambda *args: True)
    rig = make_rig()
    heard = []
    rig.service.quotas.notify = lambda *args: heard.append(args)
    return rig, heard


async def test_a_live_read_that_finds_a_higher_number_replaces_the_stored_one_and_tells_every_reader(make_rig, monkeypatch):
    # The owner used a reset voucher: the stored 4% must become 29% at the next read, in the card and for the other readers.
    rig, heard = _signed_in_codex(monkeypatch, make_rig)
    reset = rig.service.quotas.now_ms() // 1000 + 5 * 86400
    rig.service.quotas.record("codex", _window(4, reset, "weekly"), notify=False)
    heard.clear()

    async def live(_brains):
        return _live_codex({"period": "weekly", "remaining_percent": 29, "resets_at": reset})
    monkeypatch.setattr("raphael_core.agent.cli.allowances.read_allowances", live)
    result = await rig.call("usage.allowances")
    assert result["brains"][0]["windows"][0]["remaining_percent"] == 29
    assert rig.service.quotas.allowances("codex")[0]["remaining_percent"] == 29
    assert ("quota.changed", {}) in heard
    assert (await rig.call("usage.allowances", {"refresh": False}))["brains"][0]["windows"][0]["remaining_percent"] == 29


async def test_a_live_read_drops_the_windows_the_provider_no_longer_reports(make_rig, monkeypatch):
    # A stale spent 5-hour row would keep the subscription blocked after a reset removed that window.
    rig, heard = _signed_in_codex(monkeypatch, make_rig)
    quotas = rig.service.quotas
    reset = quotas.now_ms() // 1000 + 3600
    quotas.record("codex", _window(0, reset, "fiveHour", "rejected"))
    assert quotas.list() == [{"provider": "codex", "reset_at_ms": reset * 1000}]

    async def live(_brains):
        return _live_codex({"period": "weekly", "remaining_percent": 29, "resets_at": reset + 86400})
    monkeypatch.setattr("raphael_core.agent.cli.allowances.read_allowances", live)
    result = await rig.call("usage.allowances")
    assert [w["period"] for w in quotas.allowances("codex")] == ["weekly"]
    assert result["quotas"] == [] and quotas.list() == []


async def test_a_failed_or_empty_live_read_keeps_the_last_known_numbers_and_says_nothing(make_rig, monkeypatch):
    rig, heard = _signed_in_codex(monkeypatch, make_rig)
    quotas = rig.service.quotas
    reset = quotas.now_ms() // 1000 + 86400
    quotas.record("codex", _window(29, reset, "weekly"), notify=False)
    heard.clear()

    async def empty(_brains):
        return _live_codex()
    monkeypatch.setattr("raphael_core.agent.cli.allowances.read_allowances", empty)
    result = await rig.call("usage.allowances")
    assert result["brains"][0]["windows"][0]["remaining_percent"] == 29 and result["brains"][0]["source"] == "reported"

    async def broken(_brains):
        raise OSError("app-server vanished")
    monkeypatch.setattr("raphael_core.agent.cli.allowances.read_allowances", broken)
    result = await rig.call("usage.allowances")
    assert result["brains"][0]["windows"][0]["remaining_percent"] == 29
    assert quotas.allowances("codex")[0]["remaining_percent"] == 29
    assert heard == []


async def test_openings_that_overlap_share_one_live_read_and_the_next_one_reads_again(make_rig, monkeypatch):
    import asyncio
    rig, _ = _signed_in_codex(monkeypatch, make_rig)
    started, release = 0, asyncio.Event()

    async def live(_brains):
        nonlocal started
        started += 1
        await release.wait()
        return _live_codex({"period": "weekly", "remaining_percent": 100 - started, "resets_at": None})
    monkeypatch.setattr("raphael_core.agent.cli.allowances.read_allowances", live)
    first, second = asyncio.ensure_future(rig.call("usage.allowances")), asyncio.ensure_future(rig.call("usage.allowances"))
    await asyncio.sleep(0.05)
    assert started == 1
    release.set()
    answers = await asyncio.gather(first, second)
    assert answers[0] == answers[1] and answers[0] is not answers[1]
    await rig.call("usage.allowances")
    assert started == 2


def test_a_window_read_again_far_above_its_last_tenth_was_reset_and_is_told_again(conn):
    events = []
    store = Quotas(conn, lambda: NOW, lambda method, params: events.append((method, params)))
    reset = NOW // 1000 + 3600
    store.record("claude", _window(4, reset, "weekly"))
    voucher = reset  # a reset that keeps the window's end is still a new allowance
    store.record("claude", _window(29, voucher, "weekly"))
    store.record("claude", _window(8, voucher, "weekly"))
    assert [params["remaining_percent"] for method, params in events if method == "quota.warning"] == [4, 8]
    # A rounding wobble just above the line is the same window: no second telling.
    store.record("claude", _window(12, voucher, "weekly"))
    store.record("claude", _window(9, voucher, "weekly"))
    assert [params["remaining_percent"] for method, params in events if method == "quota.warning"] == [4, 8]

"""A subscription CLI that cannot take a turn is told by its true cause, not by one sentence for every cause (owner, 2026-11-11).

The outputs below are the shapes the three CLIs print when a session ran out, when none was ever made and when an
unrelated thing failed. Nothing here starts a real CLI, reads a credential or signs in.
"""
import asyncio
import json
import sys
import time

import pytest

from raphael_core.agent.cli import discovery as discovery_module
from raphael_core.agent.cli.discovery import CliBrains
from raphael_core.agent.cli.drivers import Driver
from raphael_core.agent.failure import public_failure, turn_failure
from raphael_core.failures import CAUSES, Failure, classify, sign_in_cause
from raphael_core.ui_languages import LANGUAGES

EXPIRED = [
    # Claude Code: the OAuth session cannot be renewed, so the API answers 401 and the result packet says so.
    ("claude", {"error": 'Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error",'
                         '"message":"OAuth token has expired. Please obtain a new token or refresh your existing token."}} · Please run /login',
                "status": 401}),
    ("claude", {"error": "Invalid API key · Please run /login"}),
    ("claude", {"error": "API Error: 401 Invalid authentication credentials", "status": 401}),
    # Codex: its refresh token was used elsewhere, revoked or has run out.
    ("codex", {"message": "Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.",
               "codexErrorInfo": "unauthorized"}),
    ("codex", "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header"),
    ("codex", {"message": "Your access token could not be refreshed because your refresh token has expired. Please log out and sign in again."}),
    # Antigravity.
    ("gemini", "Authentication failed: your session has expired. Please sign in again."),
]
SIGNED_OUT = [
    ("claude", {"error": "Not logged in · Please run /login"}),
    ("claude", "Not logged in"),
    ("codex", "Not logged in. Run `codex login` to sign in."),
    ("gemini", "You are not signed in."),
]
OTHER = [
    ("claude", {"error": "Prompt is too long"}, "context_overflow"),
    ("claude", {"error": "Claude AI usage limit reached|1760000000"}, "usage_limit"),
    ("claude", {"error": "API Error: 529 Overloaded"}, "overloaded"),
    ("codex", "stream error: connection reset", "network"),
    ("gemini", "request timed out", "timeout"),
    ("claude", {"error": "CLI exited with code 1"}, "unknown"),
]


@pytest.mark.parametrize("brain,packet", EXPIRED)
def test_a_session_that_ran_out_is_expired(brain, packet):
    failure = classify(Driver(brain, ["fake"])._event("error", packet).data)
    assert (failure.kind, failure.cause) == ("auth_expired", "expired")
    assert not failure.transient, "asking again with the same refused session cannot work"


@pytest.mark.parametrize("brain,packet", SIGNED_OUT)
def test_a_cli_that_says_it_is_not_logged_in_is_signed_out(brain, packet):
    failure = classify(Driver(brain, ["fake"])._event("error", packet).data)
    assert (failure.kind, failure.cause) == ("auth_expired", "signed_out")


@pytest.mark.parametrize("brain,packet,kind", OTHER)
def test_any_other_failure_stays_what_it_was_and_has_no_cause(brain, packet, kind):
    failure = classify(Driver(brain, ["fake"])._event("error", packet).data)
    assert failure.kind == kind and failure.cause is None


def test_the_stderr_tail_can_say_what_the_result_packet_does_not():
    from types import SimpleNamespace
    driver = Driver("claude", ["fake"])
    driver.child = SimpleNamespace(stderr_tail=b"Not logged in\n")
    event = driver._event("error", {"error": "API Error: 401", "status": 401})
    assert classify(event.data).cause == "signed_out"


def test_the_sentence_names_the_tool_and_one_cause_in_every_language():
    seen = set()
    for language in LANGUAGES:
        for cause, kind in (("expired", "auth_expired"), ("signed_out", "auth_expired"), ("not_installed", "unknown")):
            text = Failure(kind, "x", cause=cause).sentence("Claude Code", language)
            assert "Claude Code" in text and "{" not in text
            seen.add((language, cause, text))
        assert len({text for lang, _, text in seen if lang == language}) == 3, language
    assert Failure("auth_expired", "x", cause="expired").sentence("Claude Code", "zh-TW") == "Claude Code 的登入已過期。"
    assert Failure("auth_expired", "x", cause="signed_out").sentence("Claude Code", "zh-TW") == "Claude Code 還沒登入。"
    assert Failure("unknown", "x", cause="not_installed").sentence("Claude Code", "zh-TW") == "Claude Code 還沒安裝。"
    assert Failure("auth_expired", "x", cause="expired").sentence("Codex", "en") == "Codex's sign-in has expired."
    for language in LANGUAGES:
        for cause in CAUSES:
            text = Failure("auth_expired", "x", cause=cause).sentence("Claude Code", language)
            # R-TEXT-01..04: no code, no raw output, no setup path spelled out where a button stands.
            assert "auth_expired" not in text and "/login" not in text and "›" not in text and ">" not in text, text


def test_a_cause_belongs_only_to_the_failure_it_explains():
    assert classify({"kind": "usage_limit", "message": "limit", "cause": "expired"}).cause is None
    assert classify({"kind": "auth_expired", "message": "x", "cause": "not_installed"}).cause is None
    assert classify({"kind": "auth_expired", "message": "x", "cause": "made up"}).cause is None
    assert classify({"kind": "auth_expired", "message": "x", "cause": "signed_out"}).cause == "signed_out"
    assert sign_in_cause("usage_limit", "Not logged in") is None


def test_a_cause_reaches_the_turn_only_from_a_subscription_cli_and_without_the_reason():
    failure = Failure("auth_expired", "PRIVATE reason", cause="expired", detail="PRIVATE detail")
    assert turn_failure("auth_expired", "cli:claude:sonnet", failure) == {
        "kind": "auth_expired", "provider": "cli:claude", "resets_at": None, "cause": "expired"}
    assert turn_failure("auth_expired", "cli:claude", Failure("unknown", "x", cause="not_installed"))["cause"] == "not_installed"
    # An API brain's turn never carries it, and a stored value with nothing known about it loses it.
    assert "cause" not in turn_failure("auth_expired", "openai/gpt-6-luna", failure)
    assert "cause" not in turn_failure("auth_expired", "cli:claude", Failure("auth_expired", "x"))
    assert public_failure({"kind": "auth_expired", "provider": "cli:codex", "resets_at": None, "cause": "other"}) == {
        "kind": "auth_expired", "provider": "cli:codex", "resets_at": None}
    assert "PRIVATE" not in json.dumps(turn_failure("auth_expired", "cli:claude", failure))


EXPIRED_CLAUDE = '''import json, sys
json.loads(sys.stdin.readline())
print(json.dumps({"type":"result", "subtype":"success", "is_error":True, "api_error_status":401,
    "result":"Failed to authenticate. API Error: 401 OAuth token has expired. Please obtain a new token or refresh your existing token. Please run /login"}), flush=True)
'''


async def test_a_real_claude_start_with_an_expired_session_ends_in_the_expired_cause(tmp_path):
    script = tmp_path / "expired.py"
    script.write_text(EXPIRED_CLAUDE, encoding="utf-8")
    driver = Driver("claude", [sys.executable, str(script)], environ={})
    events = [event async for event in driver.run(user="Synthetic question", system="Synthetic system", endpoint="http://127.0.0.1:1/mcp",
                                                  token="synthetic-token", permission=None)]
    [error] = [event for event in events if event.kind == "error"]
    assert error.text == "auth_expired" and error.data["cause"] == "expired"
    assert "synthetic-token" not in json.dumps(error.data)


async def test_a_signed_in_login_that_the_owner_finishes_is_noticed_from_the_process(tmp_path, monkeypatch):
    """The sign-in is the CLI's own console; Raphael learns that it ended, and how, from the process alone."""
    from raphael_core.agent.cli import discovery
    from .test_cli_brains import SignInProcess

    if discovery.os.name != "nt":
        pytest.skip("Windows visible console contract")
    # A login file exists, as it does after a sign-in that ran out: the plain call only connects it again.
    (tmp_path / ".claude").mkdir()
    (tmp_path / ".claude" / ".credentials.json").write_text("{}", encoding="utf-8")
    started, events, made = [], [], []
    monkeypatch.setattr(discovery.subprocess, "Popen", lambda *args, **kwargs: started.append(args[0]) or made.append(SignInProcess()) or made[-1])
    brains = CliBrains(home=tmp_path, environ={}, commands={"claude": ["claude.exe"]}, notify=lambda *event: events.append(event))
    try:
        assert brains.login("claude") == {"started": False, "reconnected": True} and started == []
        assert brains.login("claude", again=True) == {"started": True}
        assert started == [["claude.exe", "auth", "login"]]
        assert brains.login("claude", again=True) == {"started": True, "running": True} and len(started) == 1, "never two consoles"
        row = next(item for item in (await brains.list())["clis"] if item["id"] == "claude")
        assert row["signing_in"] is True and row["login_result"] is None
        made[0].finish(0)
        await _until(lambda: not brains._signing_in("claude") and brains._signed.get("claude"))
        row = next(item for item in (await brains.list())["clis"] if item["id"] == "claude")
        assert (row["signing_in"], row["login_result"]) == (False, "done")
        assert ("brains.changed", {}) in events
    finally:
        await brains.aclose()


async def test_a_console_the_owner_closes_is_a_stopped_sign_in_and_a_cancel_is_not(tmp_path, monkeypatch):
    from raphael_core.agent.cli import discovery
    from .test_cli_brains import SignInProcess

    if discovery.os.name != "nt":
        pytest.skip("Windows visible console contract")
    made = []
    monkeypatch.setattr(discovery.subprocess, "Popen", lambda *args, **kwargs: made.append(SignInProcess()) or made[-1])
    brains = CliBrains(home=tmp_path, environ={}, commands={"codex": ["codex.exe"]})
    brains.login("codex", again=True)
    made[0].finish(1)  # the window was closed before the sign-in finished
    await _until(lambda: brains._signed.get("codex"))
    assert brains._signed["codex"] == "stopped" and not brains._signing_in("codex")
    # The next press starts a new one and forgets the last result.
    brains.login("codex", again=True)
    assert brains._signed.get("codex") is None and brains._signing_in("codex")
    assert brains.cancel_login("codex") == {"cancelled": True} and made[1].stopped
    await _until(lambda: "codex" not in brains._signing)
    assert brains._signed.get("codex") is None, "a cancel is no failure to tell"
    # Cancelling when nothing runs is harmless.
    assert brains.cancel_login("codex") == {"cancelled": True}


def test_a_refused_sign_in_is_remembered_until_something_says_it_is_back(tmp_path):
    """R-CLI-SIGNIN-03: what a routine that starts next is told; nothing here reads what a credential file holds."""
    now = [100.0]
    folder = tmp_path / ".claude"
    folder.mkdir()
    credentials = folder / ".credentials.json"
    credentials.write_text("{}")
    brains = CliBrains(home=tmp_path, environ={}, commands={"claude": ["claude.exe"]}, clock=lambda: now[0])
    assert brains.sign_in_missing("claude") is None
    brains.sign_in_lost("claude", "expired")
    assert brains.sign_in_missing("claude") == "expired" and brains.sign_in_missing("codex") is None
    brains.sign_in_lost("claude", "other")  # only the two causes of a sign-in are kept
    assert brains.sign_in_missing("claude") == "expired"
    brains.sign_in_back("claude")  # a run was answered, or a sign-in finished
    assert brains.sign_in_missing("claude") is None
    brains.sign_in_lost("claude", "signed_out")
    assert brains.sign_in_missing("claude") == "signed_out"
    stamp = credentials.stat().st_mtime_ns
    import os
    os.utime(credentials, ns=(stamp, stamp + 1_000_000_000))  # signed in anywhere else
    assert brains.sign_in_missing("claude") is None
    brains.sign_in_lost("claude", "expired")
    now[0] += discovery_module.SIGNIN_LOST_S - 1
    assert brains.sign_in_missing("claude") == "expired"
    now[0] += 2  # after half an hour the CLI is asked itself again
    assert brains.sign_in_missing("claude") is None


async def test_a_sign_in_that_finished_in_the_apps_own_console_clears_the_refusal(tmp_path, monkeypatch):
    from raphael_core.agent.cli import discovery
    from .test_cli_brains import SignInProcess

    if discovery.os.name != "nt":
        pytest.skip("Windows visible console contract")
    made = []
    monkeypatch.setattr(discovery.subprocess, "Popen", lambda *args, **kwargs: made.append(SignInProcess()) or made[-1])
    brains = CliBrains(home=tmp_path, environ={}, commands={"claude": ["claude.exe"]})
    brains.sign_in_lost("claude", "expired")
    brains.login("claude", again=True)
    made[0].finish(1)  # closed before it finished: still refused
    await _until(lambda: brains._signed.get("claude"))
    assert brains.sign_in_missing("claude") == "expired"
    brains.login("claude", again=True)
    made[1].finish(0)
    await _until(lambda: brains._signed.get("claude") == "done")
    assert brains.sign_in_missing("claude") is None


async def _until(condition, seconds=5):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if condition():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("the sign-in was not noticed")

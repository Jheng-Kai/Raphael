"""A subscription CLI that cannot take a turn is told by its true cause, not by one sentence for every cause.

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
    ("gemini", "Authentication expired. Please log back in."),
]
SIGNED_OUT = [
    ("claude", {"error": "Not logged in · Please run /login"}),
    ("claude", "Not logged in"),
    ("codex", "Not logged in. Run `codex login` to sign in."),
    ("gemini", "You are not signed in."),
    # What agy 1.5 says when it finds no sign-in where it keeps one (live, a Mac run with a private home).
    ("gemini", "error getting token source: You are not logged into Antigravity."),
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


def _claude_credentials(tmp_path):
    folder = tmp_path / ".claude"
    folder.mkdir(exist_ok=True)
    credentials = folder / ".credentials.json"
    credentials.write_text("{}")
    return credentials


def _signed_in_elsewhere(credentials):
    import os
    stamp = credentials.stat().st_mtime_ns
    os.utime(credentials, ns=(stamp, stamp + 1_000_000_000))


async def _claude_row(brains):
    return next(item for item in (await brains.list())["clis"] if item["id"] == "claude")


async def test_the_row_says_which_sign_in_is_lost_until_something_says_it_is_back(tmp_path):
    """R-CLI-SIGNIN-06: the notice stays after the routine gate's half hour, and a sign-in done anywhere ends it."""
    now = [100.0]
    credentials = _claude_credentials(tmp_path)
    brains = CliBrains(home=tmp_path, environ={}, commands={}, clock=lambda: now[0])
    try:
        assert (await _claude_row(brains))["sign_in_lost"] is None
        brains.sign_in_lost("claude", "expired")
        assert (await _claude_row(brains))["sign_in_lost"] == "expired"
        brains.sign_in_lost("claude", "signed_out")
        assert (await _claude_row(brains))["sign_in_lost"] == "signed_out"
        now[0] += discovery_module.SIGNIN_LOST_S + 1
        assert brains.sign_in_missing("claude") is None, "the gate asks the CLI itself again"
        row = await _claude_row(brains)
        assert row["sign_in_lost"] == "signed_out" and next(i for i in (await brains.list())["clis"] if i["id"] == "codex")["sign_in_lost"] is None
        brains.sign_in_lost("claude", "expired")  # refused again: refreshed
        assert (await _claude_row(brains))["sign_in_lost"] == "expired"
        _signed_in_elsewhere(credentials)
        await brains.check_lost()
        assert (await _claude_row(brains))["sign_in_lost"] is None and brains.sign_in_cause("claude") is None
    finally:
        await brains.aclose()


async def test_a_run_that_was_answered_ends_the_notice_and_a_credential_change_seen_by_the_gate_too(tmp_path):
    credentials = _claude_credentials(tmp_path)
    brains = CliBrains(home=tmp_path, environ={}, commands={})
    try:
        brains.sign_in_lost("claude", "expired")
        brains.sign_in_back("claude")
        assert (await _claude_row(brains))["sign_in_lost"] is None
        brains.sign_in_lost("claude", "expired")
        _signed_in_elsewhere(credentials)
        assert brains.sign_in_missing("claude") is None
        assert (await _claude_row(brains))["sign_in_lost"] is None
    finally:
        await brains.aclose()


def test_the_app_is_told_when_a_sign_in_becomes_lost_and_when_it_is_back_and_not_at_every_refused_run(tmp_path):
    events, back = [], []
    brains = CliBrains(home=tmp_path, environ={}, commands={}, notify=lambda *event: events.append(event))
    brains.on_back.append(back.append)
    brains.sign_in_back("claude")  # an answered run of a CLI that was never lost says nothing
    assert events == [] and back == []
    brains.sign_in_lost("claude", "expired")
    assert events == [("brains.changed", {})]
    brains.sign_in_lost("claude", "expired")  # refused again: refreshed, not told again
    brains.sign_in_lost("claude", "other")
    assert events == [("brains.changed", {})]
    brains.sign_in_lost("claude", "signed_out")  # another cause is another row
    assert len(events) == 2
    brains.sign_in_back("claude")
    assert len(events) == 3 and back == ["claude"]
    brains.sign_in_back("claude")
    assert len(events) == 3 and back == ["claude"], "an answered run after it was back says nothing"


def test_a_callback_that_fails_never_reaches_the_cli_path(tmp_path):
    seen = []

    def broken(name):
        seen.append(name)
        raise RuntimeError("PRIVATE cleanup failure")

    brains = CliBrains(home=tmp_path, environ={}, commands={})
    brains.on_back.extend([broken, seen.append])
    brains.sign_in_lost("claude", "expired")
    brains.sign_in_back("claude")
    assert seen == ["claude", "claude"], "the next callback still runs"


async def test_nothing_looks_at_the_credentials_while_no_sign_in_is_lost(tmp_path, monkeypatch):
    """R-CLI-SIGNIN-06: about every 10 s off the loop while one is lost; no look at all otherwise."""
    import threading
    monkeypatch.setattr(discovery_module, "SIGNIN_WATCH_S", 0.01)
    credentials = _claude_credentials(tmp_path)
    brains = CliBrains(home=tmp_path, environ={}, commands={})
    looks = []
    real = brains._credential_stamp
    brains._credential_stamp = lambda name: looks.append((name, threading.get_ident())) or real(name)
    main = threading.get_ident()
    try:
        await brains.list()
        await asyncio.sleep(0.1)
        assert looks == [] and brains._lost_watch is None
        brains.sign_in_lost("claude", "expired")
        assert brains._lost_watch is not None
        looks.clear()  # the one look that records the refusal's own stamp
        await asyncio.sleep(0.1)
        assert looks and {name for name, _ in looks} == {"claude"} and all(thread != main for _, thread in looks), "off the event loop"
        _signed_in_elsewhere(credentials)
        await _until(lambda: brains.sign_in_cause("claude") is None)
        await _until(lambda: brains._lost_watch is None)
        looks.clear()
        await asyncio.sleep(0.1)
        assert looks == [], "it stops when nothing is lost"
    finally:
        await brains.aclose()


async def test_a_sign_in_done_outside_the_app_shows_within_seconds_while_the_app_is_used(tmp_path, monkeypatch):
    """R-CLI-SIGNIN-09: while the app is used, a CLI that is installed but not signed in has its credentials looked at every
    few seconds off the loop, so a sign-in in the owner's own terminal shows at once; a signed-in CLI is not looked at."""
    import threading
    monkeypatch.setattr(discovery_module, "SIGNED_OUT_WATCH_S", 0.01)
    events = []
    brains = CliBrains(home=tmp_path, environ={}, commands={"codex": ["codex.exe"]},
                       notify=lambda *event: events.append(event))
    looks = []
    real = brains._credential_stamp
    brains._credential_stamp = lambda name: looks.append((name, threading.get_ident())) or real(name)
    main = threading.get_ident()
    try:
        listed = await brains.list()
        assert next(item for item in listed["clis"] if item["id"] == "codex")["logged_in"] is False
        await _until(lambda: len(looks) >= 2)
        assert {name for name, _ in looks} == {"codex"}, "only the installed CLI that is not signed in"
        assert all(thread != main for _, thread in looks), "off the event loop"
        (tmp_path / ".codex").mkdir()
        (tmp_path / ".codex" / "auth.json").write_text("{}")
        await _until(lambda: ("brains.changed", {}) in events)
        assert next(item for item in brains._previous["clis"] if item["id"] == "codex")["logged_in"] is True
        await asyncio.sleep(0.05)
        looks.clear()
        await asyncio.sleep(0.1)
        assert looks == [], "a signed-in CLI is not looked at"
    finally:
        await brains.aclose()


async def test_a_cli_not_signed_in_is_no_longer_looked_at_once_the_app_is_left(tmp_path, monkeypatch):
    monkeypatch.setattr(discovery_module, "SIGNED_OUT_WATCH_S", 0.01)
    monkeypatch.setattr(discovery_module, "SIGNED_OUT_WATCH_FOR_S", 0.05)
    brains = CliBrains(home=tmp_path, environ={}, commands={"codex": ["codex.exe"]})
    try:
        await brains.list()
        assert brains._watcher is not None
        brains._last_used -= 600  # left for longer than the minute's read is kept up
        await _until(lambda: brains._watcher is None)
    finally:
        await brains.aclose()


async def test_a_sign_in_that_finished_in_the_apps_console_cleans_up_even_with_no_record(tmp_path, monkeypatch):
    from raphael_core.agent.cli import discovery
    from .test_cli_brains import SignInProcess

    if discovery.os.name != "nt":
        pytest.skip("Windows visible console contract")
    made, back = [], []
    monkeypatch.setattr(discovery.subprocess, "Popen", lambda *args, **kwargs: made.append(SignInProcess()) or made[-1])
    brains = CliBrains(home=tmp_path, environ={}, commands={"claude": ["claude.exe"]})
    brains.on_back.append(back.append)
    try:
        brains.login("claude", again=True)
        made[0].finish(1)  # closed before it finished: nothing is back
        await _until(lambda: brains._signed.get("claude") == "stopped")
        assert back == []
        brains.login("claude", again=True)  # a restart forgot the refusal: no record is held
        made[1].finish(0)
        await _until(lambda: brains._signed.get("claude") == "done")
        assert back == ["claude"] and brains.sign_in_cause("claude") is None
    finally:
        await brains.aclose()


def test_claude_codes_sign_in_in_the_mac_keychain_is_a_sign_in(tmp_path):
    """R-CLI-SIGNIN-04: on a Mac Claude Code keeps its sign-in in the Keychain, not in a file; whether the item is there
    is all that is asked, and a look stands for KEYCHAIN_TTL_S."""
    now = [100.0]
    item = ["mdat 1"]
    looks = []
    def keychain():
        looks.append(now[0])
        return item[0]
    brains = CliBrains(home=tmp_path, environ={}, commands={"claude": ["claude"]}, clock=lambda: now[0], keychain=keychain)
    assert brains.logged_in("claude") is True and brains.available("claude")
    assert brains.logged_in("claude") is True and len(looks) == 1  # the look stands
    item[0] = None  # `claude auth logout` removed it
    now[0] += discovery_module.KEYCHAIN_TTL_S
    assert brains.logged_in("claude") is None and not brains.available("claude")
    # The Keychain is Claude Code's alone: the other CLIs keep files.
    item[0] = "mdat 2"
    assert brains.logged_in("codex") is False


def test_a_sign_in_done_anywhere_on_a_mac_moves_the_keychain_stamp(tmp_path):
    """R-CLI-SIGNIN-03 on a Mac: the refusal ends when Claude Code's Keychain item changes (its date, never its secret)."""
    item = ["mdat 1"]
    brains = CliBrains(home=tmp_path, environ={}, commands={"claude": ["claude"]}, keychain=lambda: item[0])
    brains.sign_in_lost("claude", "expired")
    assert brains.sign_in_missing("claude") == "expired"
    item[0] = "mdat 2"
    assert brains.sign_in_missing("claude") is None


def test_only_the_owners_own_home_on_a_mac_asks_the_keychain(tmp_path, monkeypatch):
    monkeypatch.setattr(discovery_module.sys, "platform", "darwin")
    assert discovery_module.owners_keychain(tmp_path) is None
    assert discovery_module.owners_keychain(None) is discovery_module.keychain_stamp
    monkeypatch.setattr(discovery_module.sys, "platform", "win32")
    assert discovery_module.owners_keychain(None) is None


def test_the_keychain_is_asked_for_attributes_alone(monkeypatch):
    calls = []
    class Found:
        returncode = 0
        stdout = 'keychain: "/Users/x/Library/Keychains/login.keychain-db"\n    "mdat"<timedate>=0x3230  "20261115120000Z\\000"\n'
    monkeypatch.setattr(discovery_module.subprocess, "run", lambda args, **kwargs: calls.append(args) or Found())
    assert "20261115120000Z" in discovery_module.keychain_stamp()
    assert calls == [["/usr/bin/security", "find-generic-password", "-s", "Claude Code-credentials"]]
    assert not {"-g", "-w"} & set(calls[0])
    class Missing:
        returncode = 44
        stdout = ""
    monkeypatch.setattr(discovery_module.subprocess, "run", lambda args, **kwargs: Missing())
    assert discovery_module.keychain_stamp() is None


@pytest.mark.parametrize("stamp", ['"mdat"<timedate>=0x3230  "20261125114948Z\\000"', 133_000_000],
                         ids=["mac-keychain", "windows-credential-manager"])
def test_antigravitys_sign_in_in_the_systems_store_is_a_sign_in(tmp_path, stamp):
    """R-CLI-SIGNIN-05 (#283): Antigravity CLI 1.5 keeps its Google sign-in in the system's store, the Keychain on a Mac and
    Credential Manager on Windows, never in ~/.gemini; the item being there is the sign-in, a look stands for KEYCHAIN_TTL_S,
    and its date moves the credential stamp. The same on both: a signed-in agy reads 未登入 on neither."""
    now = [100.0]
    item = [stamp]
    looks = []
    def credentials():
        looks.append(now[0])
        return item[0]
    brains = CliBrains(home=tmp_path, environ={}, commands={"gemini": ["agy"]}, clock=lambda: now[0], credentials=credentials)
    assert brains.logged_in("gemini") is True and brains.available("gemini")
    assert brains.logged_in("gemini") is True and len(looks) == 1  # the look stands
    brains.sign_in_lost("gemini", "expired")
    assert brains.sign_in_missing("gemini") == "expired"
    item[0] = f"{stamp} again"  # signed in again in a terminal
    assert brains.sign_in_missing("gemini") is None
    item[0] = None  # signed out
    now[0] += discovery_module.KEYCHAIN_TTL_S
    assert brains.logged_in("gemini") is False and not brains.available("gemini")
    # The store holds Antigravity's sign-in alone here: the other CLIs keep files.
    item[0] = stamp
    assert brains.logged_in("codex") is False


def test_only_the_owners_own_home_asks_the_systems_store_for_antigravity(tmp_path, monkeypatch):
    """R-CLI-SIGNIN-05: the Keychain on a Mac, Credential Manager on Windows, and nothing for a home that is not the owner's."""
    monkeypatch.setattr(discovery_module.sys, "platform", "win32")
    assert discovery_module.owners_credentials(tmp_path) is None
    assert discovery_module.owners_credentials(None) is discovery_module.credential_stamp
    monkeypatch.setattr(discovery_module.sys, "platform", "darwin")
    assert discovery_module.owners_credentials(tmp_path) is None
    assert discovery_module.owners_credentials(None) is discovery_module.antigravity_keychain_stamp
    assert discovery_module.credential_stamp() is None  # Credential Manager is asked only on Windows
    monkeypatch.setattr(discovery_module.sys, "platform", "linux")
    assert discovery_module.owners_credentials(None) is None


def test_the_keychain_is_asked_for_antigravitys_item_by_its_service_and_account_alone(monkeypatch):
    """R-CLI-SIGNIN-05: agy's item is the password item of service `gemini` and account `antigravity`; its attributes alone
    are asked for, never its secret (no `-g` or `-w`)."""
    calls = []
    class Found:
        returncode = 0
        stdout = '    "acct"<blob>="antigravity"\n    "mdat"<timedate>=0x3230  "20261125114948Z\\000"\n    "svce"<blob>="gemini"\n'
    monkeypatch.setattr(discovery_module.subprocess, "run", lambda args, **kwargs: calls.append(args) or Found())
    assert "20261125114948Z" in discovery_module.antigravity_keychain_stamp()
    assert calls == [["/usr/bin/security", "find-generic-password", "-s", "gemini", "-a", "antigravity"]]
    assert not {"-g", "-w"} & set(calls[0])


@pytest.mark.skipif(sys.platform != "darwin", reason="the Keychain is a Mac's")
def test_the_keychain_without_the_item_says_none():
    """Asking for an item nobody wrote finds nothing; only attributes are ever asked for, never a secret."""
    assert discovery_module.keychain_stamp("raphael-test-no-such-item", "nobody") is None


@pytest.mark.skipif(sys.platform != "win32", reason="Credential Manager is Windows'")
def test_credential_manager_without_the_item_says_none():
    """Asking for a target nobody wrote lists nothing; only attributes are ever listed, never a secret."""
    assert discovery_module.credential_stamp("raphael-test-no-such-credential*") is None

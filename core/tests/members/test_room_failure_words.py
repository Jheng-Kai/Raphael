"""Why a member's reply in a group did not finish, in words: each failure the owner can act on has its own
(owner, 2026-11-09). Live, a brain that had only run out of credits, or needed a sign-in, was "an error occurred"."""

import sqlite3
from types import SimpleNamespace

import pytest

from raphael_core.failures import KINDS
from raphael_core.members.exchanges import RoomExchanges
from raphael_core.members.rooms import _UNFINISHED_WORDS, unfinished_kind
from raphael_core.ui_languages import LANGUAGES


@pytest.mark.parametrize("reason,words", [
    ("credits", "credits"), ("cli_credits", "credits"),
    ("usage_limit", "quota"), ("cli_quota", "quota"),
    ("rate_limit", "rate_limit"), ("cli_rate_limited", "rate_limit"),
    # A CLI signs in on the owner's computer; an API brain needs its sign-in or key in Settings.
    ("cli_login", "login"), ("cli_missing", "login"), ("cli_auth_expired", "login"),
    ("auth_expired", "sign_in"), ("chatgpt_scope", "sign_in"), ("chatgpt_plan_unavailable", "sign_in"),
    # What asking again did not mend.
    ("overloaded", "unavailable"), ("server", "unavailable"), ("network", "unavailable"), ("chatgpt_unavailable", "unavailable"),
    ("cli_overloaded", "unavailable"), ("cli_server", "unavailable"), ("cli_network", "unavailable"),
    ("cli_cli_stopped", "unavailable"), ("cli_timeout", "unavailable"), ("stalled", "unavailable"), ("no_reply", "unavailable"),
    ("refused", "refused"), ("content_policy", "refused"), ("cli_refused", "refused"),
    ("context_overflow", "context_overflow"), ("cli_context_overflow", "context_overflow"),
    ("cost", "budget"), ("reply_budget", "reply_cap"), ("revoked", "removed"), ("restart", "restart"),
    # A cause nobody can name stays an error.
    ("worker", "error"), ("cli_error", "error"), ("cli_tool_broken", "error"), ("unknown", "error"), ("", "error"), (None, "error"),
])
def test_each_reason_a_reply_did_not_finish_for_has_its_words(reason, words):
    assert unfinished_kind(reason) == words


def test_every_closed_kind_is_named_or_is_an_error_on_purpose():
    unnamed = {kind for kind in KINDS if unfinished_kind(kind) == "error"}
    assert unnamed == {"permission_denied", "not_found", "tool_broken", "invalid_request", "payload_too_large", "unknown"}


def test_the_words_exist_in_every_interface_language():
    keys = set(_UNFINISHED_WORDS["en"])
    assert {"credits", "sign_in", "refused", "unavailable", "error"} <= keys
    for language in LANGUAGES:
        assert set(_UNFINISHED_WORDS[language]) == keys and all(_UNFINISHED_WORDS[language].values()), language
    assert _UNFINISHED_WORDS["zh-TW"]["credits"] == "服務點數已用完"
    assert _UNFINISHED_WORDS["zh-CN"]["sign_in"] == "需要登录或设置密钥"


@pytest.mark.parametrize("reason,named", [
    ("credits", "credits"), ("auth_expired", "auth_expired"), ("overloaded", "overloaded"), ("rate_limit", "rate_limit"),
    ("cli_quota", "cli_quota"), ("timeout", "stalled"), ("limit_time", "stalled"), ("unknown", "worker"), ("anything else", "worker"),
    (None, "worker"),
])
def test_a_room_names_the_kind_its_reply_failed_with(reason, named):
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE worker_tasks(id INTEGER PRIMARY KEY, turn_id INTEGER, reason TEXT)")
    conn.execute("INSERT INTO worker_tasks(turn_id, reason) VALUES (7, ?)", (reason,))
    assert RoomExchanges.failure(SimpleNamespace(conn=conn), 7) == named
    assert RoomExchanges.failure(SimpleNamespace(conn=conn), 8) == "worker"  # no task at all

"""Why a connection card did not connect: every way an attempt can fail is a named cause, on the card
and, as the same data, in what the member is told. Each test runs the real card flow (the card
store, the connector RPCs and the HTTP boundary) against a fake transport; nothing reaches a network."""

import asyncio
import json

import httpx
import pytest

from raphael_core.connectors.cards import CAUSES, SETUP
from raphael_core.evaluate.google_fixture import GoogleFixture

from test_connect_cards import Rig
from test_connectors import Platform

KEY = "ak_test_key_value"


class Faulty:
    """The fake Composio platform, with the requests `fault` picks answered wrongly."""

    def __init__(self, fault, statuses=None):
        self.platform, self.fault, self.seen = Platform(statuses), fault, []

    def __call__(self, request):
        self.seen.append(request.url.path)
        answer = self.fault(request)
        if isinstance(answer, Exception):
            raise answer
        return answer if answer is not None else self.platform(request)


def rig_with(tmp_path, conn, fault=None, *, statuses=None, browser=None, key=KEY):
    fake = Faulty(fault or (lambda request: None), statuses)

    async def opened(url):
        pass
    rig = Rig(tmp_path, conn, GoogleFixture("n0nce"), transport=httpx.MockTransport(fake), browser=browser or opened)
    if key:
        rig.vault.set("connectors:composio:key", key)
    rig.told = []

    async def told(turn_id, failure):
        rig.told.append(failure)
    rig.cards.failure = told
    return rig, fake


async def fails(rig, app="gmail"):
    result, card = await rig.connect(rig.card(app))
    assert result["started"] and card.state == "failed", (card.state, card.error)
    return card, card.view()


def path_is(path):
    return lambda request: request.url.path.endswith(path)


def answer(path, response):
    return lambda request: response if path_is(path)(request) else None


def assert_told(rig, cause):
    """The member got the same cause, as data it can explain: the cause's name and what happened, never a bare 'unknown'."""
    assert len(rig.told) == 1
    wire = rig.told[0].wire()
    assert f"cause {cause}:" in wire["reason"]
    # What the owner puts right is told in the owner's places and words (`_missing`); the rest by the cause's own sentence.
    assert cause in SETUP or CAUSES[cause].said in wire["reason"]
    assert (wire["kind"] == "unknown") == (cause == "unknown")


# --- the cause that was hidden: nothing was sent at all -----------------------------------------------------


async def test_a_connection_that_waits_for_another_is_named_busy_and_sends_nothing(tmp_path, conn):
    rig, fake = rig_with(tmp_path, conn)
    async with rig.connectors._lock:  # the Connections page, or an earlier sign-in, still holds the connector
        card, view = await fails(rig)
    assert (card.error, view["error"], view["retry"]) == ("busy", "busy", True)
    assert fake.seen == [] and rig.fixture.opened == 0
    assert_told(rig, "busy")
    # Once the other work is over, the same card connects: pressing again is right, and the card said why.
    _, card = await rig.connect(card)
    assert card.state == "connected" and rig.resumed == [rig.turn]


async def test_a_vault_that_cannot_be_read_is_named_and_sends_nothing(tmp_path, conn):
    rig, fake = rig_with(tmp_path, conn)

    def locked(name):
        raise OSError("keyring locked: " + KEY)
    rig.vault.get = locked
    card, view = await fails(rig)
    assert (view["error"], view["retry"]) == ("vault", True) and fake.seen == []
    assert_told(rig, "vault")
    assert KEY not in json.dumps([view, rig.told[0].wire()])


# --- the causes of the service and of this PC ------------------------------------------------------------


@pytest.mark.parametrize("name,fault,retry", [
    ("network", lambda request: httpx.ConnectError("no route to host"), True),
    ("no_answer", lambda request: httpx.ReadTimeout("slow"), True),
    ("service_down", answer("/toolkits/gmail", httpx.Response(503, json={"error": {"message": "maintenance"}})), True),
    ("rate_limit", answer("/toolkits/gmail", httpx.Response(429, json={})), True),
    ("key_refused", answer("/toolkits/gmail", httpx.Response(401, json={"error": {"message": "bad key"}})), False),
    ("refused", answer("/toolkits/gmail", httpx.Response(400, json={"error": {"message": "This project may not add Gmail"}})), False),
    ("not_found", answer("/toolkits/gmail", httpx.Response(404, json={})), False),
    ("bad_response", answer("/toolkits/gmail", httpx.Response(200, text="<html>maintenance</html>")), True),
    ("address", answer("/link", httpx.Response(201, json={"connected_account_id": "ca_test", "redirect_url": "https://sign-in.example.test/x"})), True),
    ("not_allowed", answer("/link", httpx.Response(400, json={"error": {"slug": "ToolRouterV2_ToolkitNotAllowed", "message": "no"}})), False),
])
async def test_each_failure_of_the_service_is_a_named_cause_with_its_retry(tmp_path, conn, name, fault, retry):
    rig, fake = rig_with(tmp_path, conn, fault)
    card, view = await fails(rig)
    assert (card.cause, view["error"], view["retry"]) == (name, name, retry)
    assert not rig.resumed
    assert_told(rig, name)
    assert KEY not in json.dumps([view, rig.told[0].wire(), [list(row) for row in conn.execute("SELECT * FROM connect_cards")]])


async def test_the_services_own_short_message_is_on_the_card_when_it_refuses(tmp_path, conn):
    rig, _ = rig_with(tmp_path, conn, answer("/toolkits/gmail", httpx.Response(
        400, json={"error": {"message": "This project may not add Gmail. Contact owner@example.com https://composio.dev/x"}})))
    card, view = await fails(rig)
    assert view["error"] == "refused" and "This project may not add Gmail" in view["detail"]
    assert "owner@example.com" not in view["detail"] and "https://" not in view["detail"]
    assert len(view["detail"]) <= 140
    # It survives a restart of the window: the card is read back from the database.
    assert rig.cards.views([rig.turn])[rig.turn][0]["detail"] == view["detail"]
    assert "This project may not add Gmail" in rig.told[0].wire()["reason"]


async def test_a_sign_in_the_service_ended_is_named(tmp_path, conn):
    rig, _ = rig_with(tmp_path, conn, statuses=["INITIATED", "FAILED"])
    card, view = await fails(rig)
    assert (view["error"], view["retry"]) == ("signin_failed", True)
    assert_told(rig, "signin_failed")


async def test_a_sign_in_that_is_not_finished_in_time_is_a_timeout(tmp_path, conn):
    rig, _ = rig_with(tmp_path, conn, statuses=["INITIATED"])
    rig.connectors.poll_timeout = 0
    card, view = await fails(rig)
    assert (view["error"], view["retry"]) == ("timeout", True)
    assert_told(rig, "timeout")


async def test_a_browser_that_cannot_be_opened_is_named(tmp_path, conn):
    async def no_browser(url):
        raise RuntimeError("no default browser: " + url)
    rig, _ = rig_with(tmp_path, conn, browser=no_browser)
    card, view = await fails(rig)
    assert (view["error"], view["retry"]) == ("browser", True)
    assert_told(rig, "browser")
    assert "connect.composio.dev" not in json.dumps([view, rig.told[0].wire()])  # a sign-in link is never shown


async def test_a_sign_in_cut_short_by_another_part_of_raphael_is_named_interrupted(tmp_path, conn):
    rig = Rig(tmp_path, conn, GoogleFixture("n0nce", mode="hold"))
    await rig.configure()
    rig.told = []

    async def told(turn_id, failure):
        rig.told.append(failure)
    rig.cards.failure = told
    card = rig.card()
    await rig.router.call("integrations.card_connect", {"id": card.id})
    while not rig.fixture.opened:
        await asyncio.sleep(0.01)
    assert rig.connectors.cancel_connect()
    await rig.cards.idle()
    card = rig.cards.store.get(card.id)
    assert (card.state, card.cause) == ("failed", "interrupted")


# --- what only this flow can say -----------------------------------------------------------------------


class Scripted:
    """A router whose `connectors.connect` answers what a connector could answer, for the words the real ones rarely say."""

    def __init__(self, router, outcome):
        self.router, self.outcome = router, outcome

    async def call(self, method, params):
        if method != "connectors.connect":
            return await self.router.call(method, params)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


@pytest.mark.parametrize("outcome,cause,retry", [
    ({"ok": False, "error": "state"}, "state", True),
    ({"ok": False, "error": "missing_scopes"}, "scope", True),
    ({"ok": False, "error": "mcp_unavailable"}, "mcp_unavailable", False),
    ({"ok": False, "error": "http_error", "http_status": 502}, "service_down", True),
    ({"ok": False, "error": "http_error", "http_status": 418}, "refused", False),
    ({"ok": False, "error": "protocol"}, "bad_response", True),
    ({"ok": False, "error": "timeout", "stage": "request"}, "no_answer", True),
    ({"connected": False, "error": "revoked"}, "signin_failed", True),
    ({"connected": False, "error": "expired"}, "timeout", True),
    ({"connected": False, "error": "cancelled"}, "interrupted", True),
])
async def test_the_providers_other_words_map_to_the_same_causes(tmp_path, conn, outcome, cause, retry):
    rig, _ = rig_with(tmp_path, conn)
    rig.cards._router = Scripted(rig.router, outcome)
    card, view = await fails(rig)
    assert (view["error"], view["retry"]) == (cause, retry)
    assert_told(rig, cause)


async def test_a_failure_the_code_cannot_name_says_so_and_keeps_the_short_reason(tmp_path, conn):
    rig, _ = rig_with(tmp_path, conn)
    rig.cards._router = Scripted(rig.router, {"ok": False, "error": "gremlin: {\"x\": 1}", "http_status": 599})
    card, view = await fails(rig)
    assert (view["error"], view["retry"]) == ("unknown", True)
    # Short and technical, never JSON, a trace or the provider's text.
    assert view["detail"] == "gremlin x 1 · HTTP 599" and "{" not in view["detail"]
    assert_told(rig, "unknown")
    assert "gremlin" in rig.told[0].wire()["detail"]


async def test_an_unexpected_exception_is_unknown_with_its_class_only(tmp_path, conn):
    rig, _ = rig_with(tmp_path, conn)
    rig.cards._router = Scripted(rig.router, RuntimeError("boom " + KEY + " Traceback (most recent call last)"))
    card, view = await fails(rig)
    assert (view["error"], view["detail"]) == ("unknown", "RuntimeError")
    assert KEY not in json.dumps([view, rig.told[0].wire()]) and "Traceback" not in json.dumps(view)


async def test_every_cause_has_a_sentence_for_the_member_and_a_retry_flag():
    assert CAUSES and all(cause.said and isinstance(cause.retry, bool) and cause.name == name for name, cause in CAUSES.items())
    # The old words keep their names.
    for name in ("denied", "timeout", "scope", "state", "not_configured", "needs_composio_key", "needs_key", "needs_own_app",
                 "key_rejected", "interrupted", "mcp_unavailable", "invalid_request"):
        assert name in CAUSES


# --- Google's own sign-in -------------------------------------------------------------------------------


async def own_google_rig(tmp_path, conn, **fixture_args):
    fixture = GoogleFixture("n0nce", **fixture_args)
    rig = Rig(tmp_path, conn, fixture)
    rig.told = []

    async def told(turn_id, failure):
        rig.told.append(failure)
    rig.cards.failure = told
    await rig.router.call("connectors.google.configure", {"client_id": "guardian-desktop.apps.googleusercontent.invalid", "client_secret": "client-secret-xyz"})
    return rig


@pytest.mark.parametrize("fixture_args,cause,retry", [
    ({"mode": "deny"}, "denied", True),
    ({"token": "invalid_client"}, "client_rejected", False),
    ({"token": "invalid_grant"}, "signin_expired", True),
    ({"token": "no_refresh"}, "no_refresh", True),
    ({"api": "disabled"}, "api_disabled", True),
    ({"scopes": "calendar-only"}, "scope", True),
])
async def test_google_sign_in_failures_are_named(tmp_path, conn, fixture_args, cause, retry):
    rig = await own_google_rig(tmp_path, conn, **fixture_args)
    card, view = await fails(rig)
    assert (view["error"], view["retry"]) == (cause, retry)
    assert not rig.resumed
    assert_told(rig, cause)
    assert "client-secret-xyz" not in json.dumps([view, rig.told[0].wire()])

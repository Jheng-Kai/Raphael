"""The owner's own Google, set up in the conversation: a card that walks the Google Cloud steps, takes the Client ID and
Client secret, signs in on a loopback address with PKCE and says which account connected. Google's servers and the
owner in the browser are the fixture's; what only a real Google client can prove is listed in the report of this change."""

import json
import logging

import pytest

from raphael_core.agent.service import Resumption
from raphael_core.connectors.apps import OWN_GOOGLE
from raphael_core.connectors.google import LOOPBACK, scopes_for
from raphael_core.evaluate.google_fixture import ACCOUNT, CLIENT_ID, GoogleFixture
from raphael_core.integrations.vault import MemoryVault

from test_connect_cards import Rig

SECRET = "GOCSPX-never-shown-again-0123456789"
FIELDS = {"client_id": CLIENT_ID, "client_secret": SECRET}


def make(tmp_path, conn, **fixture_args):
    rig = Rig(tmp_path, conn, GoogleFixture("n0nce", secret=SECRET, **fixture_args))
    rig.told = []

    async def told(turn_id, failure):
        rig.told.append(failure)
    rig.cards.failure = told
    return rig


def own(rig):
    return rig.cards.show(turn_id=rig.turn, member_id=0, conversation_id=None, app=OWN_GOOGLE, language="zh-TW")


async def press(rig, card, fields=None):
    params = {"id": card.id, **({"fields": fields} if fields is not None else {})}
    result = await rig.router.call("integrations.card_connect", params)
    await rig.cards.idle()
    return result, rig.cards.store.get(card.id)


async def test_the_member_finds_the_owners_own_google_by_its_id(tmp_path, conn):
    rig = make(tmp_path, conn)
    assert await rig.cards.resolve("google") is OWN_GOOGLE
    found = (await rig.cards.find("google"))["apps"]
    assert {"id": "google", "name": "Google", "provider": "own_google", "connected": False, "needs": "own_google"} in found
    # Gmail and Calendar stay the Composio (or configured Google) apps they were.
    assert (await rig.cards.resolve("gmail")).provider == "google"


async def test_the_card_shows_the_steps_data_the_fields_and_asks_nothing_it_keeps(tmp_path, conn):
    rig = make(tmp_path, conn)
    card = own(rig)
    view = rig.cards.view(card)
    assert (view["needs"], view["state"], view["error"]) == ("own_google", "pending", None)
    assert [(f["name"], f["secret"], f["required"]) for f in view["fields"]] == [("client_id", False, True), ("client_secret", True, True)]
    # The exact address and scopes the owner copies into Google Cloud.
    assert view["google"] == {"redirect": LOOPBACK, "scopes": scopes_for("write", "write"), "configured": False}
    assert LOOPBACK == "http://127.0.0.1"
    guide = await rig.cards.setup_guide(OWN_GOOGLE)
    assert guide["redirect"] == LOOPBACK and guide["scopes"] == view["google"]["scopes"] and len(guide["steps"]) >= 6
    assert "never into chat" in guide["note"]
    # Nothing was written: no vault entry, no connection, no browser.
    assert rig.vault.get("connectors:google:client_id") is None and "google" not in rig.connectors.store.connectors


async def test_the_fields_become_a_signed_in_account_and_the_secret_is_kept_only_in_the_vault(tmp_path, conn, caplog):
    caplog.set_level(logging.DEBUG)
    rig = make(tmp_path, conn)
    card = own(rig)
    started, card = await press(rig, card, FIELDS)
    assert started["started"]
    assert (card.state, card.cause, card.resumed) == ("connected", "", True) and rig.resumed == [rig.turn]
    # The vault holds the three secrets the connection needs; the secret is not in any other place.
    assert rig.vault.get("connectors:google:client_id") == CLIENT_ID
    assert rig.vault.get("connectors:google:client_secret") == SECRET and rig.vault.get("connectors:google:refresh_token")
    # The sign-in was the loopback one with PKCE and a state, against the owner's client.
    [sign_in] = rig.fixture.sign_ins
    assert sign_in == {**sign_in, "authorization_endpoint": True, "client": True, "pkce": True, "state_present": True, "loopback": True}
    view = rig.cards.view(card)
    assert (view["state"], view["account"], view["tool_count"]) == ("connected", ACCOUNT, len(rig.cards.ready_tools(OWN_GOOGLE)))
    assert view["tool_count"] > 0
    # Everything the window, the database, the logs and the files hold of it.
    seen = json.dumps(rig.events) + json.dumps(view) + caplog.text + json.dumps([list(row) for row in conn.execute("SELECT * FROM connect_cards")])
    seen += "".join(path.read_text(errors="ignore") for path in tmp_path.rglob("*.json"))
    assert fixture_secrets(rig) and not any(secret in seen for secret in fixture_secrets(rig))
    # Pressing again neither signs in nor resumes a second time.
    again, card = await press(rig, card)
    assert not again["started"] and rig.resumed == [rig.turn] and rig.fixture.opened == 1


def fixture_secrets(rig):
    return {*rig.fixture.secrets, SECRET}


async def test_a_card_whose_client_is_kept_asks_only_for_the_sign_in(tmp_path, conn):
    rig = make(tmp_path, conn, mode="deny")
    _, card = await press(rig, own(rig), FIELDS)
    assert (card.state, card.cause) == ("failed", "denied")
    view = rig.cards.view(card)
    # The client is kept, so the card shows no fields: one button signs in again.
    assert view["google"]["configured"] and view["retry"] and view["fix"] is None
    rig.fixture.mode = "approve"
    _, card = await press(rig, card)  # no fields given
    assert card.state == "connected" and rig.resumed == [rig.turn]


async def test_nothing_entered_names_what_is_missing_and_opens_no_browser(tmp_path, conn):
    rig = make(tmp_path, conn)
    card = own(rig)
    for fields in (None, {}, {"client_id": CLIENT_ID}, {"client_id": "has space", "client_secret": SECRET},
                   {"client_id": CLIENT_ID, "client_secret": SECRET, "x": "y"}):
        _, card = await press(rig, card, fields)
        assert (card.state, card.cause) == ("failed", "needs_own_google")
        assert rig.cards.view(card)["fix"] == "form" and not rig.cards.view(card)["google"]["configured"]
    assert rig.fixture.opened == 0 and rig.vault.get("connectors:google:client_id") is None and not rig.resumed
    assert "never ask for the values in chat" in rig.told[0].wire()["reason"]


async def test_a_client_google_refuses_is_asked_for_again_and_a_new_one_connects(tmp_path, conn):
    rig = make(tmp_path, conn)
    _, card = await press(rig, own(rig), {"client_id": CLIENT_ID, "client_secret": "the-wrong-secret"})
    assert (card.state, card.cause) == ("failed", "client_rejected")
    view = rig.cards.view(card)
    assert (view["retry"], view["fix"], view["google"]["configured"]) == (False, "form", False)
    _, card = await press(rig, card, FIELDS)
    assert card.state == "connected" and rig.vault.get("connectors:google:client_secret") == SECRET


async def test_the_secret_never_reaches_a_model_or_a_log_when_google_refuses(tmp_path, conn, caplog):
    caplog.set_level(logging.DEBUG)
    rig = make(tmp_path, conn, token="invalid_client")
    card = own(rig)
    guide = json.dumps(await rig.cards.setup_guide(OWN_GOOGLE))
    _, card = await press(rig, card, FIELDS)
    assert card.cause == "client_rejected"
    [failure] = rig.told
    # What the model is given: the card's guide, the member's note after the failure, the failure itself.
    prompt = guide + json.dumps(failure.wire()) + Resumption(rig.turn, (), frozenset(), failure=failure).note() + json.dumps(rig.cards.view(card))
    assert SECRET not in prompt + caplog.text and CLIENT_ID not in prompt + caplog.text
    assert "client_rejected" in prompt


async def test_the_connection_refreshes_from_the_vault_after_the_access_token_runs_out(tmp_path, conn):
    rig = make(tmp_path, conn)
    _, card = await press(rig, own(rig), FIELDS)
    assert card.state == "connected"
    rig.connectors.google.forget_access()
    found = await rig.connectors.call_google("gmail_search", {"q": "n0nce"})
    assert found["messages"] and rig.fixture.reads() == ["gmail_search"]
    # A refresh token Google no longer knows is a sign-in to repeat, never a silent success.
    rig.fixture.expire_access()
    rig.connectors.google.forget_access()
    with pytest.raises(Exception):
        await rig.connectors.call_google("gmail_search", {"q": "n0nce"})


async def test_an_expired_own_google_offers_the_sign_in_again_with_no_new_fields(tmp_path, conn):
    rig = make(tmp_path, conn)
    _, card = await press(rig, own(rig), FIELDS)
    rig.fixture.expire_access()
    rig.connectors.google.forget_access()
    with pytest.raises(Exception):
        await rig.connectors.call_google("gmail_search", {"q": "n0nce"})
    assert rig.connectors.store.connectors["google"].status == "EXPIRED"
    from raphael_core.agent.history import AgentHistory
    turn = AgentHistory(conn).add(session_id="again", question="再讀一次信", route="answer", prefix="", text="", status="running", source="app", member_id=0)
    card = rig.cards.show(turn_id=turn, member_id=0, conversation_id=None, app=OWN_GOOGLE, language="zh-TW")
    assert card.reconnect and rig.cards.view(card)["google"]["configured"]
    _, card = await press(rig, card)
    assert (card.state, card.reconnect) == ("connected", True)


async def test_a_gmail_card_without_composio_points_the_member_to_the_owners_own_google(tmp_path, conn):
    rig = make(tmp_path, conn)
    card = rig.card("gmail")
    _, card = await press(rig, card)
    assert card.cause == "needs_composio_key"
    assert "connect_app with the id google" in rig.told[0].wire()["reason"]

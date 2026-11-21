"""Where the tools behind the secret card and the computer card may be used: a private chat typed at this
computer, and nowhere else. A room, an exchange between members, a quick question, a spoken request and a
message from a phone never get a card, and a connection the owner does not have has none to fill."""

import asyncio
import json

import httpx
import pytest

from raphael_core.agent import service as agent_service
from raphael_core.agent.harness_tools import HarnessToolError
from raphael_core.agent.ledger import Ledger
from raphael_core.agent.service import RESUMED, TYPED, _Ask
from raphael_core.background.tasks import TaskStore
from raphael_core.connectors.apps import SERVER_APPS
from raphael_core.connectors.composio import KEY
from raphael_core.evaluate.guardian import Budget
from raphael_core.evaluate.guardian_driver import RpcDriver
from raphael_core.evaluate.secret_fixture import SERVER_NAME, SecretServer
from raphael_core.integrations.config import ServerConfig
from raphael_core.management import OWNER_ONLY
from raphael_core.protocol import INVALID_PARAMS, RpcError

from test_guardian import FakeBrains
from test_guardian_scenarios import FakeClient


@pytest.fixture
async def driver(tmp_path):
    driver = RpcDriver(tmp_path, "fake/model", FakeClient([]), Budget(10), brains=FakeBrains(tmp_path))
    driver.app.integrations._config.add(SecretServer(driver.nonce).config())
    yield driver
    await driver.aclose()


def ask_of(driver, **fields):
    turn = driver.app.agent._history.add(session_id="s", question="q", route="answer", prefix="", text="", status="running",
                                         source="app", member_id=0)
    return _Ask(session_id="s", text="q", language="zh-TW", source=TYPED, turn_id=turn, **fields)


def rows(driver, table):
    return driver.app._conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]


@pytest.mark.parametrize("kind, initial", [
    ("connect", "pending"), ("connect", "failed"), ("connect", "authorizing"),
    ("secret", "pending"), ("secret", "failed"), ("handback", "control"),
])
async def test_the_owner_closes_a_waiting_card_and_its_question_without_resuming_the_card(driver, monkeypatch, kind, initial):
    app = driver.app
    ask = ask_of(driver)
    common = dict(turn_id=ask.turn_id, member_id=0, conversation_id=None, language="en")
    stopped = []
    if kind == "connect":
        cards = app.cards
        card = cards.show(**common, app=SERVER_APPS["n8n"])
        if initial == "failed":
            cards.store.move(card.id, "authorizing")
            cards.store.move(card.id, "failed", error="interrupted")
        if initial == "authorizing":
            started = asyncio.Event()

            async def sign_in(*_):
                started.set()
                try:
                    await asyncio.Future()
                finally:
                    stopped.append(card.id)

            monkeypatch.setattr(cards, "ready_tools", lambda _: [])
            monkeypatch.setattr(cards, "_connect_server", sign_in)
            await app.call("integrations.card_connect", {"id": card.id})
            await asyncio.wait_for(started.wait(), 3)
    elif kind == "secret":
        cards = app.secret_cards
        card = cards.store.open(**common, server_id="DEMO_KEY", name="Demo", kind="key", secret="key")
        if initial == "failed":
            cards.store.move(card.id, "failed", error="invalid")
    else:
        cards = app.handbacks
        card = cards.store.open(**common, run_id="example-run", reason="sign_in", app="Browser")
        monkeypatch.setattr(cards._computer, "stop_run", lambda run_id, _: stopped.append(run_id))

    tasks = TaskStore(app._conn)
    task_id = tasks.create(session_id="waiting-task", language="en", text="Wait for the card", member_id=0)
    tasks.attach_turn(task_id, ask.turn_id)
    questions = app.background.owner_questions
    question = questions.open(tasks.get(task_id), "connect_app", {}, card.id)
    unrelated = tasks.create(session_id="other-task", language="en", text="Other question", member_id=0)
    tasks.attach_turn(unrelated, ask.turn_id)
    other_question = questions.open(tasks.get(unrelated), "connect_app", {}, "other-card")
    changes = []
    monkeypatch.setattr(cards, "_notify", lambda method, params: changes.append((method, params)))

    async def unexpected_resume(*_):
        pytest.fail("Closing the card resumed its original turn")

    monkeypatch.setattr(cards, "resume", unexpected_resume)
    assert "integrations.card_close" in OWNER_ONLY
    assert await app.call("integrations.card_close", {"id": card.id}) == {"closed": True}
    await cards.idle()
    assert cards.store.get(card.id).state == "cancelled"
    assert changes == [("agent.turn", {"turn_id": ask.turn_id, "member_id": 0})]
    assert questions.get(question["id"])["result"] == {"state": "cancelled"}
    assert questions.get(other_question["id"])["result"] is None
    assert stopped == ([card.id] if initial == "authorizing" else ["example-run"] if kind == "handback" else [])
    assert await app.call("integrations.card_close", {"id": card.id}) == {"closed": False}
    with pytest.raises(RpcError) as error:
        await app.call("integrations.card_close", {"id": "unknown"})
    assert error.value.code == INVALID_PARAMS


@pytest.mark.parametrize("fields", [{"scope": "room"}, {"scope": "exchange"}, {"quick": True},
                                     {"source": "voice", "quick": True}, {"source": "telegram"}, {"peer": 1}])
async def test_catalog_cards_keep_private_typed_chat_gates_before_catalog_access(driver, fields, monkeypatch):
    ask = ask_of(driver)
    for name, value in fields.items():
        setattr(ask, name, value)
    async def unexpected(_):
        pytest.fail("A refused card read the catalog")
    monkeypatch.setattr(driver.app.cards, "resolve", unexpected)
    with pytest.raises(HarnessToolError, match="private_chat_only"):
        await driver.app.agent._show_card(ask, {"app": "spotify"})
    assert rows(driver, "connect_cards") == 0


@pytest.mark.parametrize("fields", [
    {"scope": "room", "room_id": 1},
    {"scope": "exchange", "peer": 1},
    {"quick": True},
    {"source": "voice", "quick": True},
    {"source": "telegram"},
    {"source": "member"},
])
async def test_a_secret_card_is_never_shown_outside_a_private_typed_chat(driver, fields):
    ask = ask_of(driver)
    for name, value in fields.items():
        setattr(ask, name, value)
    with pytest.raises(HarnessToolError, match="private_chat_only"):
        driver.app.agent._show_secret(ask, {"connection": SERVER_NAME})
    assert rows(driver, "secret_cards") == 0 and ask.waiting_secrets == []


@pytest.mark.parametrize("source", [TYPED, RESUMED, "voice"])
async def test_a_secret_card_is_shown_in_a_private_typed_chat_and_in_the_chat_a_task_resumed_in(driver, source):
    ask = ask_of(driver)
    ask.source = source
    shown = driver.app.agent._show_secret(ask, {"connection": SERVER_NAME})
    assert shown["card"] == "shown" and shown["secrets"] == "Authorization" and ask.waiting_secrets == [SERVER_NAME]
    assert rows(driver, "secret_cards") == 1
    # The model is told the names it gave and nothing of the vault or the key.
    assert "gsk-" not in str(shown) and "vault" in shown["note"]


async def test_a_secret_card_names_only_a_connection_the_owner_has_and_a_secret_it_declares(driver):
    agent = driver.app.agent
    for arguments, kind in (({"connection": "nothing"}, "unknown_connection"), ({"connection": ""}, None),
                            ({"connection": SERVER_NAME, "secret": "Cookie"}, "unknown_secret"),
                            ({"connection": "connectors:composio:key"}, "unknown_connection"),
                            ({"connection": 5}, None)):
        ask = ask_of(driver)
        with pytest.raises((HarnessToolError, ValueError)) as raised:
            agent._show_secret(ask, arguments)
        assert kind is None or str(raised.value) == kind
    # A connection whose secret is in the vault already has no card.
    driver.app.vault.set("guardian-weather:header:Authorization", "kept")
    ask = ask_of(driver)
    assert agent._show_secret(ask, {"connection": SERVER_NAME})["missing"] == 0
    assert rows(driver, "secret_cards") == 0 and ask.waiting_secrets == []


async def test_a_value_that_is_no_secret_gets_no_key_card_and_the_member_is_told_to_ask_in_chat(driver):
    """#281: a user name, an e-mail or a site is no secret. No card is shown, and the member asks the owner in the conversation."""
    for name in ("JIRA_USERNAME", "SMTP_USER", "JIRA_EMAIL", "ATLASSIAN_SITE"):
        ask = ask_of(driver)
        shown = driver.app.agent._show_secret(ask, {"key": name, "purpose": "the Jira user"})
        assert shown["card"] == "not_shown" and "ask the owner" in shown["note"] and ask.waiting_secrets == []
    assert rows(driver, "secret_cards") == 0
    shown = driver.app.agent._show_secret(ask_of(driver), {"key": "JIRA_API_TOKEN", "purpose": "the Jira API"})
    assert shown["card"] == "shown" and rows(driver, "secret_cards") == 1


async def test_a_managed_connection_gets_no_secret_card(driver):
    driver.app.integrations._config.add(ServerConfig("google", "Google (private)", "http", url="https://example.invalid/mcp",
                                                    managed_by="google", headers=["x-api-key"]))
    with pytest.raises(HarnessToolError, match="unknown_connection"):
        driver.app.agent._show_secret(ask_of(driver), {"connection": "Google (private)"})


async def test_a_local_calendar_request_does_not_ask_for_a_composio_key(driver):
    ask = ask_of(driver)
    ask.text = "Show my calendar"
    with pytest.raises(HarnessToolError, match="^own_calendar$"):
        await driver.app.agent._show_card(ask, {"app": "googlecalendar"})
    assert rows(driver, "connect_cards") == rows(driver, "secret_cards") == 0


async def test_the_composio_key_card_keeps_the_key_private_and_continues_connecting_the_requested_app(driver, monkeypatch):
    app, value = driver.app, "ak-private-card-test"
    slug = "example-service"

    def composio(request):
        assert request.headers["x-api-key"] == value
        if request.url.path.endswith("/toolkits"):
            return httpx.Response(200, json={"items": [{"slug": slug, "name": "Example Service"}]})
        assert request.url.path.endswith("/toolkits/categories")
        return httpx.Response(200, json={"items": []})

    transport = httpx.MockTransport(composio)
    monkeypatch.setattr(app.connectors, "_transport", transport)
    monkeypatch.setattr(app.connectors.composio.http, "transport", transport)
    driver.transport.client.turns = iter([
        ("", [("connect_app", {"app": slug})]),
        ("", [("request_secret", {"connection": "composio"})]),
        ("請把金鑰貼到卡片。", []),
        ("", [("connect_app", {"app": slug})]),
        ("請用卡片連接應用程式。", []),
    ])
    first = await driver.ask("幫我連接 Example Service", intent=f"connect-app:{slug}")
    failed_call = driver.transport.client.requests[1]["messages"][-1]
    assert failed_call["role"] == "tool" and 'request_secret with connection: "composio"' in failed_call["content"]
    (card,) = app.secret_cards.cards_of(first["turn_id"])
    assert card.kind == "composio"
    assert card.view() == {"id": card.id, "name": "Composio", "secret": "API key", "state": "pending",
                           "error": None, "expires_at_ms": card.expires_at_ms, "resumed": False, "composio": True}
    assert rows(driver, "secret_cards") == 1 and rows(driver, "connect_cards") == 0
    assert (await app.call("connectors.status", {"refresh": False}))["composio_configured"] is False
    saved = await app.call("integrations.card_save", {"id": card.id, "value": value})
    assert saved["saved"] is True and app.vault.get(KEY) == value
    await app.secret_cards.idle()
    assert app.secret_cards.store.get(card.id).state == "resumed"
    assert rows(driver, "connect_cards") == 1
    assert any(f'Call connect_app again with app "{slug}"' in (message.get("content") or "")
               for request in driver.transport.client.requests for message in request["messages"])
    assert (await app.call("connectors.status", {"refresh": False}))["composio_configured"] is True
    again = app.agent._show_secret(ask_of(driver), {"connection": "composio"})
    assert set(again) == {"connection", "saved", "note"} and again["connection"] == "composio" and again["saved"] is True
    assert rows(driver, "secret_cards") == 1
    assert (await app.call("integrations.card_save", {"id": card.id, "value": value}))["saved"] is False
    stored = "\n".join(app._conn.iterdump())
    assert value not in stored + json.dumps([saved, again, driver.events]) + "".join(driver.transport.sent) + driver.log.text


async def test_a_composio_key_refused_by_the_provider_fails_the_card_without_echoing_the_key(driver, monkeypatch):
    app, value = driver.app, "ak-refused-card-test"
    monkeypatch.setattr(app.connectors, "_transport", httpx.MockTransport(
        lambda request: httpx.Response(401, json={"message": f"Refused {value}"})))
    ask = ask_of(driver)
    app.agent._show_secret(ask, {"connection": "composio"})
    (card,) = app.secret_cards.cards_of(ask.turn_id)
    driver.transport.client.turns = iter([("請檢查金鑰，再試一次。", [])])
    result = await app.call("integrations.card_save", {"id": card.id, "value": value})
    await app.secret_cards.idle()
    assert result["saved"] is False and result["card"]["state"] == "failed" and result["card"]["error"] == "key_refused"
    assert (await app.call("connectors.status", {"refresh": False}))["composio_configured"] is False
    assert value not in str(result) + "".join(driver.transport.sent) + driver.log.text


async def test_stopping_the_composio_card_during_validation_leaves_the_vault_empty(driver, monkeypatch):
    started, release = asyncio.Event(), asyncio.Event()

    async def composio(request):
        started.set()
        await release.wait()
        return httpx.Response(200, json={"items": []})

    app = driver.app
    monkeypatch.setattr(app.connectors, "_transport", httpx.MockTransport(composio))
    ask = ask_of(driver)
    app.agent._show_secret(ask, {"connection": "composio"})
    (card,) = app.secret_cards.cards_of(ask.turn_id)
    async with asyncio.TaskGroup() as tasks:
        save = tasks.create_task(app.call("integrations.card_save", {"id": card.id, "value": "ak-stopped-card-test"}))
        await asyncio.wait_for(started.wait(), 2)
        app.secret_cards.cancel_session(ask.session_id)
        release.set()
    assert save.result()["saved"] is False and save.result()["card"]["state"] == "cancelled"
    assert app.vault.get(KEY) is None


@pytest.mark.parametrize("fields,expected", [
    ({}, None),
    ({"source": RESUMED}, None),
    ({"source": "voice"}, None),
    ({"source": "voice", "quick": True}, False),
    ({"source": "telegram"}, None),
    ({"quick": True}, False),
    ({"peer": 1, "scope": "exchange"}, None),
    ({"scope": "room", "room_id": 1}, None),
])
async def test_the_run_on_the_owners_desktop_is_made_for_a_quick_question_alone_and_never_pauses_for_a_card(driver, monkeypatch, fields, expected):
    # R-PC-01: the desktop is a quick question's alone, and a quick question shows no card, so the run never hands the computer back.
    agent = driver.app.agent
    seen = {}

    class Stop(Exception):
        pass

    class Recorder:
        def __init__(self, **kwargs):
            seen.update(kwargs)
            raise Stop

    monkeypatch.setattr(agent_service, "ComputerRun", Recorder)
    ask = ask_of(driver)
    for name, value in fields.items():
        setattr(ask, name, value)
    ask.ledger = Ledger(agent._spend)
    if expected is None:
        # Any other turn cannot operate this computer at all.
        result = await agent._operate(ask, agent._read_settings(), ask.ledger, narration=object(), request="x")
        assert result["status"] == "done" and not seen
        return
    with pytest.raises(Stop):
        await agent._operate(ask, agent._read_settings(), ask.ledger, narration=object(), request="x")
    assert seen["handback"] is expected
    # A run without a narrated turn around it (the spoken route) never pauses either.
    seen.clear()
    with pytest.raises(Stop):
        await agent._operate(ask, agent._read_settings(), ask.ledger, request="x")
    assert seen["handback"] is False


async def test_a_card_for_a_key_in_the_members_computer_names_a_variable_and_never_shows_a_value(driver):
    agent = driver.app.agent
    ask = ask_of(driver)
    shown = agent._show_secret(ask, {"key": "OPENROUTER_API_KEY", "purpose": "the price script"})
    assert shown["card"] == "shown" and ask.waiting_secrets == ["OPENROUTER_API_KEY"] and "vm_exec keys" in shown["note"]
    assert rows(driver, "secret_cards") == 1 and ask.owner_card_ids
    (card,) = driver.app.secret_cards.cards_of(ask.turn_id)
    assert (card.kind, card.server_id, card.name) == ("key", "OPENROUTER_API_KEY", "the price script")
    # Once saved, asking again shows no card and says how to use it.
    driver.app.login_vault.put_key(0, "OPENROUTER_API_KEY", "the price script", "sk-test-" + "k" * 24)
    again = agent._show_secret(ask_of(driver), {"key": "OPENROUTER_API_KEY", "purpose": "the price script"})
    assert again["saved"] is True and "sk-test" not in str(again) and rows(driver, "secret_cards") == 1
    replacement = agent._show_secret(ask_of(driver), {"key": "OPENROUTER_API_KEY", "purpose": "the price script", "replace": True})
    assert replacement["card"] == "shown" and "replaces the current key" in replacement["note"]
    assert "sk-test" not in str(replacement) and rows(driver, "secret_cards") == 2


@pytest.mark.parametrize("arguments", [
    {"key": "PATH", "purpose": "x"}, {"key": "bad name", "purpose": "x"}, {"key": "OK_KEY"}, {"key": "OK_KEY", "purpose": "a\nb"},
    {"key": "OK_KEY", "purpose": "x", "connection": SERVER_NAME}, {"key": "OK_KEY", "purpose": "x", "site": "https://example.com"}, {"key": 5},
    {"connection": SERVER_NAME, "replace": True}, {"key": "OK_KEY", "purpose": "x", "replace": "true"},
])
async def test_a_key_card_asks_for_exactly_one_thing_by_a_valid_name(driver, arguments):
    ask = ask_of(driver)
    with pytest.raises((HarnessToolError, ValueError)):
        driver.app.agent._show_secret(ask, arguments)
    assert rows(driver, "secret_cards") == 0 and ask.waiting_secrets == []


@pytest.mark.parametrize("fields", [{"scope": "room", "room_id": 1}, {"scope": "exchange", "peer": 1}, {"quick": True}, {"source": "telegram"}])
async def test_a_key_card_is_never_shown_outside_a_private_typed_chat(driver, fields):
    ask = ask_of(driver)
    for name, value in fields.items():
        setattr(ask, name, value)
    with pytest.raises(HarnessToolError, match="private_chat_only"):
        driver.app.agent._show_secret(ask, {"key": "OPENROUTER_API_KEY", "purpose": "the price script"})
    assert rows(driver, "secret_cards") == 0

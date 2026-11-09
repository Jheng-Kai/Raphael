"""Own-server cards use the owner's form and the real hub, with in-process MCP only."""

import json

import pytest

from raphael_core.connectors.cards import MOVES, ConnectorCards
from raphael_core.connectors.service import ConnectorsService
from raphael_core.integrations.service import IntegrationsService
from raphael_core.router import Router

from agent.conftest import client, actions  # noqa: F401
from agent.test_service import make_rig  # noqa: F401
from agent.test_narration import chat, typed

TOKEN = "synthetic-n8n-private-token"
ADDRESS = "https://flows.example.invalid/mcp-server/http"


async def test_n8n_conversation_card_keeps_fields_out_of_the_model_and_retries(
    tmp_path, conn, vault, connector, servers, make_rig, client, caplog,
):
    hub = IntegrationsService(conn, tmp_path, vault, connector=connector)
    router = Router()
    hub.register(router)
    connectors = ConnectorsService(tmp_path, vault, hub)
    events, failures, resumed = [], [], []
    cards = ConnectorCards(conn, router, connectors, notify=lambda m, p: events.append((m, p)))
    cards.register(router)
    agent = make_rig(plugins=hub)
    agent.service._cards = cards
    async def failed(turn, failure):
        failures.append(failure)
        return await agent.service.failure_turn(turn, failure)
    async def resume(turn):
        resumed.append(turn)
        return await agent.service.resume_turn(turn)
    cards.failure, cards.resume = failed, resume
    client.chats = [chat("", ("connect_app", {"app": "n8n"})), chat("Open n8n settings; paste the address and token into the card.")]
    asked = await typed(agent, "Help me connect n8n")
    [card] = cards.cards_of(asked["turn_id"])
    view = cards.view(card)
    assert view["needs"] == "own_server"
    assert [(f["name"], f["secret"], f["required"]) for f in view["fields"]] == [("url", False, True), ("token", True, True)]
    assert not hub._config.servers()  # A model call only shows a card.
    calls = []
    real_call = router.call
    async def record(method, params=None):
        calls.append((method, params))
        return await real_call(method, params)
    router.call = record
    client.chats = [chat("Could not connect to n8n. Check the address and token in the card, then try again.")]
    await router.call("integrations.card_connect", {"id": card.id, "fields": {"url": ADDRESS, "token": TOKEN}})
    await cards.idle()  # No fake server yet: a real list-tools failure.
    failed_card = cards.store.get(card.id)
    assert failed_card.state == "failed"
    assert "Try again" in cards.view(failed_card)["error_message"]
    assert "card" in failures[-1].reason and "n8n" in failures[-1].reason
    assert "Check the address" in str(agent.conn.execute("SELECT text FROM agent_turns ORDER BY id DESC LIMIT 1").fetchone()[0])
    assert not hub.offered() and not resumed
    servers.add("n8n")
    client.chats = [chat("n8n is connected and its workflows are available.")]
    await router.call("integrations.card_connect", {"id": card.id, "fields": {"url": ADDRESS, "token": TOKEN}})
    await cards.idle()
    connected = cards.store.get(card.id)
    assert connected.state == "connected" and connected.tool_count > 0
    assert resumed == [card.turn_id] and len(hub._config.servers()) == 1
    assert {m for m, _ in calls} >= {"integrations.add", "integrations.update", "integrations.test", "integrations.refresh", "integrations.set_enabled"}
    added = next(p for m, p in calls if m == "integrations.add")
    assert added["url"] == ADDRESS and added["headers"] == [{"name": "Authorization", "value": "Bearer " + TOKEN}]
    assert all(TOKEN not in json.dumps(p) for m, p in calls if m not in {"integrations.card_connect", "integrations.add", "integrations.update"})
    assert servers.opened[-1][2] == {"Authorization": "Bearer " + TOKEN}
    client.chats = [chat("The access token lets Raphael use only the workflows you expose. Keep it in the secure card.")]
    await typed(agent, "What is the access token for?")
    guide = str(client.chat_calls)
    assert "where to find it" in guide and "one step at a time" in guide
    assert "n8n Settings" in guide
    exposed = json.dumps(events) + str(client.chat_calls) + str(failures) + caplog.text
    exposed += json.dumps(cards.views([card.turn_id])) + str(agent.service._turn_views([agent.history.get(card.turn_id)]))
    exposed += str([tuple(row) for row in conn.execute("SELECT * FROM connect_cards")])
    assert TOKEN not in exposed and ADDRESS not in exposed
    assert TOKEN not in (tmp_path / "integrations.json").read_text()
    await cards.aclose()


@pytest.mark.parametrize("kind", ["auth", "timeout", "exception", "empty", "refresh"])
async def test_n8n_failures_are_plain_retryable_and_never_echo_the_form(tmp_path, conn, vault, connector, servers, kind, caplog):
    from raphael_core.agent.history import AgentHistory
    from raphael_core.integrations.client import McpFailure
    hub = IntegrationsService(conn, tmp_path, vault, connector=connector)
    router = Router()
    hub.register(router)
    cards = ConnectorCards(conn, router, ConnectorsService(tmp_path, vault, hub))
    cards.register(router)
    turn = AgentHistory(conn).add(session_id="synthetic", question="Connect n8n", route="answer", prefix="", text="", status="running", source="app")
    card = cards.show(turn_id=turn, member_id=0, conversation_id=None, app=await cards.resolve("n8n"), language="en")
    attempts = []
    async def broken(server):
        attempts.append(server.id)
        if kind == "empty":
            return []
        if kind == "exception":
            raise RuntimeError(TOKEN + ADDRESS)
        if kind == "refresh" and len(attempts) == 1:
            from raphael_core.integrations.config import tool_record
            return [tool_record("sample", "Sample", {})]
        raise McpFailure(kind if kind != "refresh" else "timeout")
    connector.list_tools = broken
    await router.call("integrations.card_connect", {"id": card.id, "fields": {"url": ADDRESS, "token": TOKEN}})
    await cards.idle()
    ended = cards.store.get(card.id)
    assert ended.state == "failed" and "authorizing" in MOVES[ended.state]
    message = cards.view(ended)["error_message"]
    assert "n8n" in message and "card" in message and "Try again" in message
    if kind == "auth":
        assert "did not accept" in message
    assert not hub.offered() and not hub._config.servers()[0].enabled
    assert TOKEN not in message + caplog.text and ADDRESS not in message + caplog.text
    await cards.aclose()


async def test_n8n_card_rejects_missing_or_extra_fields_without_adding(tmp_path, conn, vault, connector):
    from raphael_core.agent.history import AgentHistory
    hub = IntegrationsService(conn, tmp_path, vault, connector=connector)
    router = Router()
    hub.register(router)
    cards = ConnectorCards(conn, router, ConnectorsService(tmp_path, vault, hub))
    cards.register(router)
    turn = AgentHistory(conn).add(session_id="synthetic", question="Connect n8n", route="answer", prefix="", text="", status="running", source="app")
    app = await cards.resolve("n8n")
    assert app is not None
    assert (await cards.find("n8n"))["apps"][0]["needs"] == "own_server"
    card = cards.show(turn_id=turn, member_id=0, conversation_id=None, app=app, language="en")
    for fields in (None, {"url": ADDRESS}, {"url": ADDRESS, "token": TOKEN, "extra": "x"}, {"url": "bad", "token": TOKEN}):
        await router.call("integrations.card_connect", {"id": card.id, "fields": fields})
        await cards.idle()
        assert cards.store.get(card.id).state == "failed"
        assert not hub._config.servers()
    await cards.aclose()

"""Conversation connection changes use the production hub and synthetic servers only."""

import json
from types import SimpleNamespace

import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.agent.plugins import PluginTool
from raphael_core.agent.policy import Tier
from raphael_core.background.snapshot import take_snapshot
from agent.conftest import client, actions  # noqa: F401
from agent.test_service import make_rig  # noqa: F401
from agent.test_narration import chat, typed


@pytest.mark.parametrize("interactive", [False, True])
def test_running_offer_removes_revoked_tools_and_discovers_new_ones(interactive):
    first = PluginTool("mcp:sample/read", "sample", "read", "Read sample", {"type": "object"}, Tier.T1)
    second = PluginTool("mcp:sample/write", "sample", "write", "Write sample", {"type": "object"}, Tier.T1)
    current = [first]
    hub = SimpleNamespace(offered=lambda: list(current))
    snapshot = take_snapshot(hub, interactive=interactive)
    assert "sample__read" in {d["function"]["name"] for d in snapshot.definitions}
    current[:] = [second]
    snapshot.refresh_plugins(hub, 0)
    assert "sample__read" not in {d["function"]["name"] for d in snapshot.definitions}
    assert "sample__read" not in snapshot.refs
    assert "sample__write" in {d["function"]["name"] for d in snapshot.definitions}
    assert not snapshot.find("Read sample")[0]


def test_refresh_never_reassigns_a_revoked_alias_to_another_connection():
    first = PluginTool("mcp:first/read", "Sample.one", "read", "First", {"type": "object"}, Tier.T1)
    second = PluginTool("mcp:second/read", "Sample_one", "read", "Second", {"type": "object"}, Tier.T1)
    current = [first, second]
    hub = SimpleNamespace(offered=lambda: list(current))
    snapshot = take_snapshot(hub)
    aliases = {ref.key: alias for alias, ref in snapshot.refs.items() if ref.kind == "mcp"}
    current[:] = [second]
    snapshot.refresh_plugins(hub, 0)
    assert aliases[first.key] not in snapshot.refs
    assert snapshot.refs[aliases[second.key]].key == second.key
    current[:] = [first, second]
    snapshot.refresh_plugins(hub, 0)
    assert snapshot.refs[aliases[first.key]].key == first.key


async def test_custom_proposal_tests_before_enabling_and_invalidates_an_edited_digest(tmp_path, conn, vault, connector, servers):
    from raphael_core.integrations.proposals import ConnectionProposals
    from raphael_core.integrations.service import IntegrationsService
    from raphael_core.protocol import RpcError

    hub = IntegrationsService(conn, tmp_path, vault, connector=connector)
    servers.add("Sample")
    turn = AgentHistory(conn).add(session_id="sample", question="Use sample", route="answer", prefix="", text="", status="running", source="app")
    proposals = ConnectionProposals(conn, hub)
    draft = await proposals.propose(turn_id=turn, member_id=0, conversation_id=None, language="en",
        fields={"name": "Sample", "transport": "http", "url": "https://example.invalid/mcp"})
    assert not hub.offered() and not servers.opened
    with pytest.raises(RpcError):
        await proposals.act({"id": draft["id"], "revision": draft["revision"], "operation": "enable"})
    tested = (await proposals.act({"id": draft["id"], "revision": draft["revision"], "operation": "test"}))["proposal"]
    assert tested["state"] == "tested" and tested["groups"] and not hub.offered()
    edited = (await proposals.act({"id": draft["id"], "revision": draft["revision"], "operation": "edit",
        "fields": {**draft["fields"], "url": "https://example.invalid/revised"}}))["proposal"]
    assert edited["state"] == "draft" and not edited["groups"]
    with pytest.raises(RpcError):
        await proposals.act({"id": draft["id"], "revision": tested["revision"], "operation": "enable"})
    tested = (await proposals.act({"id": draft["id"], "revision": edited["revision"], "operation": "test"}))["proposal"]
    enabled = await proposals.act({"id": draft["id"], "revision": tested["revision"], "operation": "enable"})
    assert enabled["proposal"]["state"] == "enabled" and hub.offered()
    assert not servers.by_name["Sample"] is None


async def test_proposal_secret_names_use_existing_secret_cards_without_model_values(tmp_path, conn, vault, connector):
    from raphael_core.integrations.proposals import ConnectionProposals
    from raphael_core.integrations.service import IntegrationsService
    from raphael_core.connectors.secret_cards import SecretCards

    hub = IntegrationsService(conn, tmp_path, vault, connector=connector)
    keys = SecretCards(conn, hub)
    turn = AgentHistory(conn).add(session_id="sample", question="Use sample", route="answer", prefix="", text="", status="running", source="app")
    proposals = ConnectionProposals(conn, hub, secret_cards=keys)
    draft = await proposals.propose(turn_id=turn, member_id=0, conversation_id=None, language="en",
        fields={"name": "Sample", "transport": "http", "url": "https://example.invalid/mcp", "headers": ["Authorization"]})
    (card,) = keys.cards_of(turn)
    assert card.secret == "Authorization" and not hub.offered()
    secret = "sample-private-value"
    await keys._save({"id": card.id, "value": secret})
    everything = json.dumps([proposals.views([turn]), keys.views([turn]), list(map(list, conn.execute("SELECT * FROM connection_proposals")))])
    assert secret not in everything and "Bearer " + secret not in everything
    assert draft["fields"]["headers"] == ["Authorization"]


@pytest.fixture
def chat_rig(tmp_path, conn, vault, connector, servers, make_rig):
    from raphael_core.integrations.service import IntegrationsService
    from raphael_core.connectors.secret_cards import SecretCards
    hub = IntegrationsService(conn, tmp_path, vault, connector=connector)
    servers.add("Sample")
    keys = SecretCards(conn, hub)
    from raphael_core.members.service import MembersService
    team = MembersService(conn, tmp_path, background=SimpleNamespace())
    rig = make_rig(plugins=hub, secret_cards=keys, team=team)
    team.register(rig.rpc)
    hub.register(rig.rpc)
    keys.register(rig.rpc)
    return rig, hub, keys


async def test_model_adds_custom_mcp_and_uses_its_tools_after_owner_enables(chat_rig, client):
    rig, hub, keys = chat_rig
    client.chats = [chat("Review the card.", ("add_mcp_server", {"name": "Sample", "transport": "http", "url": "https://example.invalid/mcp"})), chat("The card is ready.")]
    await typed(rig, "Connect Sample and look up a sample")
    [turn] = await rig.turns()
    [card] = turn["connection_proposals"]
    assert card["state"] == "draft" and not hub.offered()
    tested = await rig.call("integrations.proposal", {"id": card["id"], "revision": 1, "operation": "test"})
    assert tested["proposal"]["state"] == "tested"
    client.chats = [chat("Read sample.", ("Sample__look", {"topic": "sample"})), chat("Read complete.")]
    await rig.call("integrations.proposal", {"id": card["id"], "revision": 1, "operation": "enable"})
    await asyncio_sleep_for_resume(rig)
    assert any(any(d["function"]["name"] == "Sample__look" for d in call["tools"]) for call in client.chat_calls)
    assert next(turn for turn in await rig.turns() if turn["source"] == "connector")["text"] == "Read complete."


async def asyncio_sleep_for_resume(rig):
    import asyncio
    tasks = rig.service._connection_proposals._tasks
    if tasks:
        await asyncio.wait_for(asyncio.gather(*list(tasks)), timeout=5)


@pytest.mark.parametrize("operation", ["disable", "tool_disable", "disconnect"])
async def test_chat_revocation_changes_next_model_offer_and_refuses_an_old_alias(chat_rig, client, operation):
    rig, hub, keys = chat_rig
    await hub._add({"name": "Sample", "transport": "http", "url": "https://example.invalid/mcp"})
    server = hub._config.servers()[0]
    await hub._refresh({"id": server.id})
    await hub._set_enabled({"id": server.id, "enabled": True})
    rig.settings.set("action_mode", "bypass")
    async def after(**kwargs):
        names = {d["function"]["name"] for d in kwargs["tools"]}
        assert "Sample__look" not in names, kwargs["messages"]
        return chat("Old cached call.", ("Sample__look", {"topic": "sample"}))
    client.chats = [chat("Change access.", ("manage_connection", {"connection": server.id, "operation": operation, "tool": "look"})), after, chat("Access was revoked."), chat("Access was revoked.")]
    result = await typed(rig, "Turn off Sample access")
    if operation == "disconnect":
        assert result["status"] == "confirm" and hub.offered()
        result = await rig.confirm(result["confirm"]["id"])
    assert result["text"] == "Access was revoked."
    assert not next((t for t in hub.offered() if t.name == "look"), None)
    assert "no longer enabled" in str(client.chat_calls[-1]["messages"])


@pytest.mark.parametrize("mode,choice,opens", [("ask", None, False), ("ask", "deny", False), ("ask", "once", True), ("bypass", None, True)])
async def test_stdio_test_has_the_local_command_gate(chat_rig, servers, mode, choice, opens):
    rig, hub, keys = chat_rig
    rig.settings.set("action_mode", mode)
    turn = rig.history.add(session_id="local-sample", question="Connect sample", route="answer", prefix="", text="", status="done", source="app")
    proposals = rig.service._connection_proposals
    draft = await proposals.propose(turn_id=turn, member_id=0, conversation_id=None, language="en",
        fields={"name": "Sample", "transport": "stdio", "command": "sample-mcp", "args": ["--stdio"]})
    params = {"id": draft["id"], "revision": 1, "operation": "test"}
    initial = (await proposals.act(params))["proposal"]
    if choice:
        assert initial["state"] == "approval" and not servers.opened
        await proposals.act({**params, "local_choice": choice})
    assert bool(servers.opened) == opens and not hub.offered()


@pytest.mark.parametrize("blocked", ["local_never", "secret_store", "forbidden"])
async def test_allow_all_still_refuses_forbidden_or_disabled_local_tests(chat_rig, servers, blocked):
    from raphael_core.agent.safety import DENY, Screening
    rig, hub, keys = chat_rig
    rig.settings.set("action_mode", "bypass")
    if blocked == "local_never":
        rig.settings.set("local_commands_mode", "never")
    if blocked == "forbidden":
        async def deny(*args, **kwargs):
            return Screening(DENY)
        rig.service._gate._safety = SimpleNamespace(screen=deny)
    turn = rig.history.add(session_id="blocked", question="Connect sample", route="answer", prefix="", text="", status="done", source="app")
    proposals = rig.service._connection_proposals
    draft = await proposals.propose(turn_id=turn, member_id=0, conversation_id=None, language="en",
        fields={"name": "Sample", "transport": "stdio", "command": "cmdkey" if blocked == "secret_store" else "sample-mcp"})
    from raphael_core.protocol import RpcError
    if blocked == "forbidden":
        with pytest.raises(RpcError):
            await proposals.act({"id": draft["id"], "revision": 1, "operation": "test"})
    else:
        result = await proposals.act({"id": draft["id"], "revision": 1, "operation": "test"})
        assert result["proposal"]["error"] == "local_disabled"
    assert not servers.opened and not hub.offered()


@pytest.mark.parametrize("operation", ["enable", "tool_enable"])
async def test_chat_enabling_restores_the_next_model_offer(chat_rig, client, operation):
    rig, hub, keys = chat_rig
    await hub._add({"name": "Sample", "transport": "http", "url": "https://example.invalid/mcp"})
    server = hub._config.servers()[0]
    await hub._refresh({"id": server.id})
    if operation == "tool_enable":
        await hub._set_enabled({"id": server.id, "enabled": True})
        await hub._set_tool_enabled({"id": server.id, "tool": "look", "enabled": False})
    rig.settings.set("action_mode", "bypass")
    async def after(**kwargs):
        assert "Sample__look" in {item["function"]["name"] for item in kwargs["tools"]}
        return chat("Use it.", ("Sample__look", {"topic": "sample"}))
    client.chats = [chat("Enable.", ("manage_connection", {"connection": server.id, "operation": operation, "tool": "look"})), after, chat("Read complete.")]
    assert (await typed(rig, "Enable sample and read"))["text"] == "Read complete."


async def test_saving_a_proposal_secret_waits_for_test_and_owner_enable(chat_rig, client):
    rig, hub, keys = chat_rig
    client.chats = [chat("Review.", ("add_mcp_server", {"name": "Sample", "transport": "http", "url": "https://example.invalid/mcp", "headers": ["Authorization"]})), chat("Review the card.")]
    await typed(rig, "Connect Sample")
    [turn] = await rig.turns()
    [card] = keys.cards_of(turn["id"])
    await keys._save({"id": card.id, "value": "sample-private-value"})
    await keys.idle()
    assert keys.store.get(card.id).state == "saved"
    assert not hub.offered()
    proposal = turn["connection_proposals"][0]
    await rig.call("integrations.proposal", {"id": proposal["id"], "revision": 1, "operation": "test"})
    client.chats = [chat("Done.")]
    await rig.call("integrations.proposal", {"id": proposal["id"], "revision": 1, "operation": "enable"})
    await asyncio_sleep_for_resume(rig)
    assert keys.store.get(card.id).state == "resumed"
    assert len([turn for turn in await rig.turns() if turn["source"] == "connector"]) == 1


async def test_allow_all_does_not_claim_resumption_when_discovery_fails_after_secret_save(chat_rig):
    rig, hub, keys = chat_rig
    rig.settings.set("action_mode", "bypass")
    turn = rig.history.add(session_id="failed-test", question="Connect", route="answer", prefix="", text="", status="done", source="app")
    proposals = rig.service._connection_proposals
    card = await proposals.propose(turn_id=turn, member_id=0, conversation_id=None, language="en",
        fields={"name": "Sample", "transport": "http", "url": "https://example.invalid/mcp", "headers": ["Authorization"]})
    async def fail(server):
        raise RuntimeError("Synthetic discovery failure")
    hub._connector.list_tools = fail
    [secret] = keys.cards_of(turn)
    await keys._save({"id": secret.id, "value": "sample-private-value"})
    await keys.idle()
    assert proposals.views([turn])[turn][0]["state"] == "draft" and not hub.offered()
    assert keys.store.get(secret.id).state == "saved"


async def test_multiple_proposals_wait_without_a_resume_error_then_continue_once(chat_rig, client, servers):
    rig, hub, keys = chat_rig
    servers.add("Other")
    turn = rig.history.add(session_id="two-servers", question="Connect both", route="answer", prefix="", text="", status="done", source="app")
    proposals = rig.service._connection_proposals
    cards = [await proposals.propose(turn_id=turn, member_id=0, conversation_id=None, language="en",
        fields={"name": name, "transport": "http", "url": "https://example.invalid/mcp"}) for name in ("Sample", "Other")]
    for card in cards:
        await proposals.act({"id": card["id"], "revision": 1, "operation": "test"})
    await proposals.act({"id": cards[0]["id"], "revision": 1, "operation": "enable"})
    await asyncio_sleep_for_resume(rig)
    assert not client.chat_calls
    assert proposals.views([turn])[turn][0]["error"] is None

    async def after(**kwargs):
        assert {"Sample__look", "Other__look"} <= {item["function"]["name"] for item in kwargs["tools"]}
        return chat("Both connected.")
    client.chats = [after]
    await proposals.act({"id": cards[1]["id"], "revision": 1, "operation": "enable"})
    await asyncio_sleep_for_resume(rig)
    assert len(client.chat_calls) == 1
    assert all(card["error"] is None for card in proposals.views([turn])[turn])


async def test_editing_secret_slots_replaces_obsolete_cards(chat_rig):
    rig, hub, keys = chat_rig
    turn = rig.history.add(session_id="edit", question="Connect", route="answer", prefix="", text="", status="done", source="app")
    proposals = rig.service._connection_proposals
    fields = {"name": "Sample", "transport": "http", "url": "https://example.invalid/mcp", "headers": ["Authorization"]}
    card = await proposals.propose(turn_id=turn, member_id=0, conversation_id=None, language="en", fields=fields)
    original = keys.cards_of(turn)[0]
    removed = (await proposals.act({"id": card["id"], "revision": 1, "operation": "edit", "fields": {**fields, "headers": []}}))["proposal"]
    await proposals.act({"id": card["id"], "revision": removed["revision"], "operation": "edit", "fields": fields})
    [replacement] = keys.cards_of(turn)
    assert replacement.id != original.id and replacement.state == "pending"


async def test_renaming_the_proposal_updates_its_existing_secret_card(chat_rig):
    rig, hub, keys = chat_rig
    turn = rig.history.add(session_id="rename", question="Connect", route="answer", prefix="", text="", status="done", source="app")
    proposals = rig.service._connection_proposals
    fields = {"name": "Sample", "transport": "http", "url": "https://example.invalid/mcp", "headers": ["Authorization"]}
    card = await proposals.propose(turn_id=turn, member_id=0, conversation_id=None, language="en", fields=fields)
    original = keys.cards_of(turn)[0]
    await proposals.act({"id": card["id"], "revision": 1, "operation": "edit", "fields": {**fields, "name": "Sample MCP"}})
    [secret] = keys.cards_of(turn)
    assert secret.id == original.id and secret.name == "Sample MCP" and secret.state == "pending"


async def test_stop_persists_a_disabled_proposal_and_cancels_its_secret_card(chat_rig):
    rig, hub, keys = chat_rig
    turn = rig.history.add(session_id="stopped", question="Connect", route="answer", prefix="", text="", status="done", source="app")
    proposals = rig.service._connection_proposals
    card = await proposals.propose(turn_id=turn, member_id=0, conversation_id=None, language="en",
        fields={"name": "Sample", "transport": "http", "url": "https://example.invalid/mcp", "headers": ["Authorization"]})
    await proposals.act({"id": card["id"], "revision": 1, "operation": "cancel"})
    assert keys.cards_of(turn)[0].state == "cancelled"
    assert not hub._config.servers()


async def test_stop_while_testing_rejects_a_late_discovery(chat_rig):
    import asyncio
    rig, hub, keys = chat_rig
    proposals = rig.service._connection_proposals
    turn = rig.history.add(session_id="stop-test", question="Connect", route="answer", prefix="", text="", status="done", source="app")
    card = await proposals.propose(turn_id=turn, member_id=0, conversation_id=None, language="en",
        fields={"name": "Sample", "transport": "http", "url": "https://example.invalid/mcp"})
    began, finish = asyncio.Event(), asyncio.Event()
    async def discover(server):
        began.set()
        await finish.wait()
        return []
    hub._connector.list_tools = discover
    task = asyncio.create_task(proposals.act({"id": card["id"], "revision": 1, "operation": "test"}))
    await began.wait()
    proposals.cancel_session("stop-test")
    finish.set()
    await task
    assert proposals.views([turn])[turn][0]["state"] == "cancelled"
    assert not hub.offered()


@pytest.mark.parametrize("external", [False, True])
async def test_stdio_reuses_always_allowed_commands_but_external_content_still_asks(chat_rig, external):
    rig, hub, keys = chat_rig
    rig.settings.set("local_commands_mode", "always")
    turn = rig.history.add(session_id="always", question="Connect", route="answer", prefix="", text="", status="done", source="app")
    proposals = rig.service._connection_proposals
    card = await proposals.propose(turn_id=turn, member_id=0, conversation_id=None, language="en", external=external,
        fields={"name": "Sample", "transport": "stdio", "command": "sample-mcp"})
    tested = (await proposals.act({"id": card["id"], "revision": 1, "operation": "test"}))["proposal"]
    assert tested["state"] == ("approval" if external else "tested")


async def test_chat_reconnect_of_a_local_server_waits_before_launching_it(chat_rig, client, servers):
    rig, hub, keys = chat_rig
    rig.settings.set("action_mode", "ask")
    await hub._add({"name": "Sample", "transport": "stdio", "command": "sample-mcp"})
    server = hub._config.servers()[0]
    await hub._refresh({"id": server.id})
    await hub._set_enabled({"id": server.id, "enabled": True})
    opened = len(servers.opened)
    client.chats = [chat("Reconnect.", ("manage_connection", {"connection": server.id, "operation": "reconnect"})), chat("Review the card.")]
    asked = await typed(rig, "Reconnect Sample")
    assert asked["status"] == "confirm" and len(servers.opened) == opened
    await rig.confirm(asked["confirm"]["id"])
    [turn] = await rig.turns()
    [card] = turn["connection_proposals"]
    assert not hub.offered() and len(servers.opened) == opened
    reply = await rig.call("integrations.proposal", {"id": card["id"], "revision": 1, "operation": "test"})
    assert reply["proposal"]["state"] == "approval" and len(servers.opened) == opened


async def test_stop_during_the_enable_rule_check_never_enables_the_connection(chat_rig):
    import asyncio
    from raphael_core.protocol import RpcError
    rig, hub, keys = chat_rig
    proposals = rig.service._connection_proposals
    turn = rig.history.add(session_id="stop-enable", question="Connect", route="answer", prefix="", text="", status="done", source="app")
    card = await proposals.propose(turn_id=turn, member_id=0, conversation_id=None, language="en",
        fields={"name": "Sample", "transport": "http", "url": "https://example.invalid/mcp"})
    await proposals.act({"id": card["id"], "revision": 1, "operation": "test"})
    began, finish = asyncio.Event(), asyncio.Event()
    async def screen(row, operation):
        began.set()
        await finish.wait()
    proposals._screen = screen
    task = asyncio.create_task(proposals.act({"id": card["id"], "revision": 1, "operation": "enable"}))
    await began.wait()
    proposals.cancel_session("stop-enable")
    finish.set()
    with pytest.raises(RpcError):
        await task
    assert not hub.offered()

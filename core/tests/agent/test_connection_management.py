"""API and authenticated CLI MCP manage connections through the same production services."""

import pytest

from .test_service import make_rig  # noqa: F401
from .test_narration import chat, typed
from .test_service import until
from background.conftest import Rig as BackgroundRig, plugins, call, turn, report  # noqa: F401
from raphael_core.connectors.secret_cards import SecretCards


@pytest.fixture
async def wired_connections(conn, plugins, make_rig):
    background = BackgroundRig(conn, plugins)
    keys = SecretCards(conn, plugins.hub)
    agent = make_rig(background=background.service, plugins=plugins.hub, gate=background.gate, secret_cards=keys)
    agent.settings.set("worker_cost_cap_usd", 1.0)
    background.service.use_owner_tools(agent.service.background_owner_tool)
    yield agent, background
    await background.close()


async def test_disconnect_waits_in_private_chat_until_the_owner_says_yes(wired_connections, client, plugins):
    agent, background = wired_connections
    server = await plugins.connect(look="T1")
    agent.settings.set("action_mode", "ask")
    client.chats = [chat("Disconnect.", ("manage_connection", {"connection": server, "operation": "disconnect"})), chat("Disconnected.")]
    asked = await typed(agent, "Disconnect sample")
    assert asked["status"] == "confirm" and plugins.hub.offered()
    await agent.confirm(asked["confirm"]["id"])
    assert not plugins.hub.offered()


@pytest.mark.parametrize("mode", ["ask", "bypass"])
async def test_background_connection_change_uses_the_same_approval_and_current_offers(wired_connections, plugins, mode):
    agent, background = wired_connections
    server = await plugins.connect(look="T1")
    agent.settings.set("action_mode", mode)
    background.client.replies = [turn("Disable.", [call("manage_connection", {"connection": server, "operation": "disable"})]), report("Disabled.")]
    identifier = background.submit("Turn off sample")
    origin = agent.history.add(session_id="sample-background", question="Turn off sample", route="delegate", prefix="", text="", status="running", source="app",
        conversation_id=agent.service.conversations.main())
    background.service.attach_turn(identifier, origin)
    await until(lambda: background.task(identifier).state in ("waiting", "done", "failed"))
    if mode == "ask":
        assert background.task(identifier).state == "waiting" and plugins.hub.offered()
        [question] = background.service.waiting_questions()
        background.service.answer(identifier, question["id"], True)
    await until(lambda: background.task(identifier).state in ("done", "failed"))
    assert background.task(identifier).state == "done"
    assert not plugins.hub.offered()
    assert "Notes__look" not in {item["function"]["name"] for item in background.client.chat_calls[-1]["tools"]}


async def test_cli_lists_and_calls_use_current_grants(wired_connections, plugins, tmp_path, monkeypatch):
    import httpx
    from raphael_core.agent.cli.discovery import CliBrains
    from raphael_core.agent.cli.drivers import Driver, Event

    agent, background = wired_connections
    server = await plugins.connect(look="T1")
    agent.settings.set("action_mode", "bypass")
    (tmp_path / ".codex").mkdir()
    (tmp_path / ".codex/auth.json").touch()
    agent.service._cli_brains = CliBrains(home=tmp_path, environ={}, commands={"codex": ["fake"]})
    agent.settings.set("agent_model", "cli:codex:test")
    attempts = []

    async def run(driver, **kwargs):
        attempt = len(attempts)
        attempts.append(attempt)
        async with httpx.AsyncClient(headers={"Authorization": "Bearer " + kwargs["token"]}, trust_env=False) as http:
            async def rpc(method, **params):
                return (await http.post(kwargs["endpoint"], json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params})).json()
            names = lambda response: {item["name"] for item in response["result"]["tools"]}
            if attempt == 0:
                assert "Notes__look" in names(await rpc("tools/list"))
                assert not (await rpc("tools/call", name="manage_connection", arguments={"connection": server, "operation": "disable"}))["result"]["isError"]
            elif attempt == 1:
                assert "Notes__look" not in names(await rpc("tools/list"))
                stale = await rpc("tools/call", name="Notes__look", arguments={"topic": "sample"})
                assert "error" in stale or stale["result"]["isError"]
                assert not (await rpc("tools/call", name="manage_connection", arguments={"connection": server, "operation": "enable"}))["result"]["isError"]
            else:
                assert "Notes__look" in names(await rpc("tools/list"))
                assert not (await rpc("tools/call", name="Notes__look", arguments={"topic": "sample"}))["result"]["isError"]
        yield Event("final", "Sample read.")

    monkeypatch.setattr(Driver, "run", run)
    assert (await typed(agent, "Manage sample and read"))["status"] == "done"
    assert attempts == [0, 1, 2]


async def test_background_cli_refreshes_and_reloads_after_connection_changes(wired_connections, plugins, monkeypatch):
    from raphael_core.agent.cli.loop import CliLoop
    from raphael_core.worker.loop import Outcome

    agent, background = wired_connections
    server = await plugins.connect(look="T1")
    agent.settings.set("action_mode", "bypass")
    background.service.use_cli(object())
    async def work(loop):
        names = lambda: {item["function"]["name"] for item in loop.tools}
        assert "Notes__look" in names()
        assert (await loop._tool("disable", "manage_connection", {"connection": server, "operation": "disable"})).ok
        assert "Notes__look" not in names() and loop.catalog_changed
        loop.catalog_changed = False
        stale = await loop._tool("stale", "Notes__look", {"topic": "sample"})
        assert not stale.ok and "no longer enabled or connected" in stale.content
        assert (await loop._tool("enable", "manage_connection", {"connection": server, "operation": "enable"})).ok
        assert "Notes__look" in names() and loop.catalog_changed
        loop._queue.put_nowait(Outcome("done", final="Sample done."))
    monkeypatch.setattr(CliLoop, "_work", work)
    identifier = background.submit("Manage sample", model="cli:codex:test")
    origin = agent.history.add(session_id="cli-background", question="Manage sample", route="delegate", prefix="", text="", status="running", source="app", conversation_id=agent.service.conversations.main())
    background.service.attach_turn(identifier, origin)
    await until(lambda: background.task(identifier).state in ("done", "failed"))
    assert background.task(identifier).state == "done"


@pytest.mark.parametrize("mode", ["ask", "bypass"])
async def test_background_mcp_secret_then_test_enable_resumes_the_same_task(wired_connections, plugins, mode):
    from background.conftest import fake_server
    agent, background = wired_connections
    agent.settings.set("action_mode", mode)
    plugins.servers.by_name["Sample"] = fake_server.build()
    fields = {"name": "Sample", "transport": "http", "url": "https://example.invalid/mcp", "headers": ["Authorization"]}
    async def after(**kwargs):
        assert "Sample__look" in {item["function"]["name"] for item in kwargs["tools"]}
        assert "sample-private-value" not in str(kwargs)
        return report("Connected.")
    background.client.replies = [turn("Connect.", [call("add_mcp_server", fields)]), after]
    identifier = background.submit("Connect Sample and continue")
    origin = agent.history.add(session_id="mcp-background", question="Connect Sample and continue", route="delegate", prefix="", text="", status="running", source="app", conversation_id=agent.service.conversations.main())
    background.service.attach_turn(identifier, origin)
    await until(lambda: background.task(identifier).state in ("waiting", "done", "failed"))
    assert background.task(identifier).state == "waiting"
    keys = agent.service._secret_cards
    [secret] = keys.cards_of(origin)
    await keys._save({"id": secret.id, "value": "sample-private-value"})
    await keys.idle()
    proposals = agent.service._connection_proposals
    if mode == "ask":
        [card] = proposals.views([origin])[origin]
        assert card["state"] == "draft" and not plugins.hub.offered()
        await proposals.act({"id": card["id"], "revision": 1, "operation": "test"})
        await proposals.act({"id": card["id"], "revision": 1, "operation": "enable"})
        if proposals._tasks:
            import asyncio
            await asyncio.gather(*list(proposals._tasks))
    await until(lambda: background.task(identifier).state in ("done", "failed"))
    assert background.task(identifier).state == "done"
    calls = len(agent.client.chat_calls)
    await agent.service.resume_turn(origin)
    assert len(agent.client.chat_calls) == calls


@pytest.mark.parametrize("operation", ["disable", "enable", "tool_disable", "tool_enable", "disconnect"])
async def test_managed_app_changes_use_the_existing_connector_policy(make_rig, client, tmp_path, conn, operation):
    from test_connectors import connected
    from raphael_core.connectors.service import COMPOSIO_SERVER, META_EXECUTE
    _, managed, hub, _, _ = await connected(tmp_path, conn)
    entry = managed.store.connectors["composio:gmail"]
    if operation == "enable":
        await managed.set_tools({"id": entry.id, "enabled": False})
    if operation == "tool_enable":
        await managed.set_tools({"id": entry.id, "disabled_tools": ["GMAIL_FETCH_EMAILS"]})
    rig = make_rig(plugins=hub, secret_cards=SecretCards(conn, hub))
    rig.settings.set("action_mode", "bypass")
    client.chats = [chat("Change.", ("manage_connection", {"connection": entry.id, "operation": operation, "tool": "GMAIL_FETCH_EMAILS"})), chat("Changed.")]
    assert (await typed(rig, "Change sample app access"))["text"] == "Changed."
    allowed = managed.allow_call(COMPOSIO_SERVER, META_EXECUTE, {"tools": [{"tool_slug": "GMAIL_FETCH_EMAILS", "arguments": {}}]}, "auto")
    assert allowed == (operation in ("enable", "tool_enable"))

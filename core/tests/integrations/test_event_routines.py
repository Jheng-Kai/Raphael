"""Event reads use the production Composio hub and gate, with a fake HTTP transport."""

import json

import httpx

from raphael_core.agent.gate import ToolGate
from raphael_core.connectors.store import Connector
from raphael_core.members.events import POLL_MS
from members.conftest import Rig
from test_connectors import Platform, connected


async def test_composio_event_uses_named_app_grants_and_never_calls_a_write(tmp_path, conn):
    platform = Platform(["ACTIVE"])
    items = [{"id": "old", "sender": "client@example.com"}]
    reads = []

    def respond(request):
        if request.url.host == "app.composio.dev" and request.method == "POST":
            packet = json.loads(request.content)
            if packet.get("method") == "tools/call":
                reads.append(packet["params"])
                return httpx.Response(200, json={"jsonrpc": "2.0", "id": packet["id"], "result": {
                    "content": [], "structuredContent": {"results": [{"data": {"messages": items}}]}}})
        return platform(request)

    router, connectors, hub, vault, _ = await connected(tmp_path, conn, fake=respond)
    rig = Rig(conn, tmp_path / "members")
    try:
        rig.service._connections = hub.connections
        rig.service.use_event_tools(ToolGate(hub, conn=conn))
        when = {"app": "composio:gmail", "event": {"tool": "mcp:connectors_composio/COMPOSIO_MULTI_EXECUTE_TOOL",
                "arguments": {"tools": [{"tool_slug": "GMAIL_FETCH_EMAILS", "arguments": {}}]},
                "items": "results.0.data.messages", "id": "id"}, "filter": {"field": "sender", "equals": "client@example.com"}}
        routine = (await rig.call("routines.create", {"member_id": 0, "title": "Client mail", "prompt": "Prepare a draft", "when": when}))["routine"]
        await rig.service.poll_events()
        assert len(reads) == 1 and not rig.background.submitted
        items.append({"id": "new", "sender": "client@example.com"})
        rig.wall.now += POLL_MS
        await rig.service.poll_events()
        assert len(reads) == 2 and len(rig.background.submitted) == 1
        assert reads[0]["arguments"] == when["event"]["arguments"]
        assert hub.event_tool_belongs("composio:gmail", when["event"]["tool"], when["event"]["arguments"])
        connectors.store.connectors["composio:slack"] = Connector("composio:slack", "composio", status="ACTIVE", enabled_tools=["SLACK_FETCH_MESSAGES"])
        assert not hub.event_tool_belongs("composio:slack", when["event"]["tool"], when["event"]["arguments"])
        await router.call("connectors.set_tools", {"id": "composio:gmail", "disabled_tools": ["GMAIL_FETCH_EMAILS"]})
        rig.wall.now += POLL_MS
        await rig.service.poll_events()
        assert len(reads) == 2
        assert not rig.service.store.routine(routine["id"]).enabled
    finally:
        await rig.close()

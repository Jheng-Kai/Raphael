"""Event reads use the production Composio hub and gate, with a fake HTTP transport."""

import json
import asyncio

import httpx
import pytest

from raphael_core.agent.gate import ToolGate
from raphael_core.connectors.store import Connector
from raphael_core.members.events import POLL_MS
from members.conftest import Rig
from test_connectors import Platform, connected


@pytest.fixture
async def cold_calendar(tmp_path, conn):
    platform = Platform(["ACTIVE"])
    state = {"loads": 0, "reads": 0, "fail": False, "hint": "readOnlyHint", "items": [{"id": "old"}]}

    def respond(request):
        if request.url.path.endswith("/tools") and request.url.params.get("toolkit_slug") == "googlecalendar":
            state["loads"] += 1
            if state["fail"]:
                return httpx.Response(503)
            return httpx.Response(200, json={"items": [] if state["hint"] == "gone" else [
                {"slug": "GOOGLECALENDAR_EVENTS_LIST", "tags": [state["hint"]]}]})
        if request.url.host == "app.composio.dev" and request.method == "POST":
            packet = json.loads(request.content)
            if packet.get("method") == "tools/call":
                state["reads"] += 1
                return httpx.Response(200, json={"jsonrpc": "2.0", "id": packet["id"], "result": {
                    "structuredContent": {"successful": True, "data": {"error_count": 0, "results": [
                        {"response": {"successful": True, "data": {"items": state["items"]}}}]}}}})
        return platform(request)

    _, connectors, hub, _, _ = await connected(tmp_path, conn, fake=respond)
    entry = Connector("composio:googlecalendar", "composio", status="ACTIVE", enabled_tools=["GOOGLECALENDAR_EVENTS_LIST"])
    connectors.store.connectors[entry.id] = entry
    rig = Rig(conn, tmp_path / "members")
    rig.service._connections = hub.connections
    rig.service.use_event_tools(ToolGate(hub, conn=conn))
    when = {"app": entry.id, "event": {"tool": "mcp:connectors_composio/COMPOSIO_MULTI_EXECUTE_TOOL",
            "arguments": {"tools": [{"tool_slug": "GOOGLECALENDAR_EVENTS_LIST", "arguments": {"calendarId": "primary"}}]},
            "items": "data.results.0.response.data.items", "id": "id"}, "filter": {"field": "", "equals": ""}}
    try:
        yield rig, connectors, state, when
    finally:
        await rig.close()


async def test_calendar_pick_loads_cold_catalog_and_reuses_it(cold_calendar):
    rig, connectors, state, _ = cold_calendar
    assert "composio:googlecalendar" not in connectors._tool_catalog
    result = await rig.call("routines.list", {"member_id": 0, "event": "calendar-event"})
    assert "when" in result
    assert result["when"]["event"]["items"] == "data.results.0.response.data.items"
    assert state["reads"] == 1 and state["loads"] == 2
    assert "when" in await rig.call("routines.list", {"member_id": 0, "event": "calendar-event"})
    assert state["reads"] == 2 and state["loads"] == 2


async def test_calendar_pick_catalog_failure_can_be_retried(cold_calendar):
    rig, _, state, _ = cold_calendar
    state["fail"] = True
    assert "event_error" in await rig.call("routines.list", {"member_id": 0, "event": "calendar-event"})
    assert state["loads"] > 0 and state["reads"] == 0
    assert rig.conn.execute("SELECT count(*) FROM agent_turns").fetchone()[0] == 0
    state["fail"] = False
    assert "when" in await rig.call("routines.list", {"member_id": 0, "event": "calendar-event"})


async def test_calendar_poll_after_restart_loads_before_judging(cold_calendar):
    rig, connectors, state, when = cold_calendar
    routine = (await rig.call("routines.create", {"member_id": 0, "title": "Calendar items", "prompt": "Review changes", "when": when}))["routine"]
    await rig.service.poll_events()
    current = rig.service.store.routine(routine["id"])
    assert current.enabled and current.poll_initialized
    connectors._tool_catalog.clear()
    connectors._important.clear()
    rig.service.use_event_tools(ToolGate(connectors.hub, conn=rig.conn))
    state["items"].append({"id": "new"})
    rig.wall.now += POLL_MS
    await rig.service.poll_events()
    assert rig.service.store.routine(routine["id"]).enabled
    assert state["loads"] == 4 and state["reads"] == 2
    assert len(rig.background.submitted) == 1
    assert rig.conn.execute("SELECT count(*) FROM agent_turns WHERE status='error'").fetchone()[0] == 0


async def test_catalog_startup_failure_backs_off_without_stopping_then_recovers(cold_calendar):
    rig, _, state, when = cold_calendar
    state["fail"] = True
    routine = (await rig.call("routines.create", {"member_id": 0, "title": "Calendar items", "prompt": "Review changes", "when": when}))["routine"]
    await rig.service.poll_events()
    current = rig.service.store.routine(routine["id"])
    assert current.enabled and not current.poll_initialized and current.poll_failures == 1
    assert current.next_run_ms == rig.wall.now + POLL_MS * 2
    assert rig.conn.execute("SELECT count(*) FROM agent_turns").fetchone()[0] == 0
    assert state["loads"] > 0 and state["reads"] == 0
    attempts = state["loads"]
    await rig.service.poll_events()
    assert state["loads"] == attempts
    state["fail"] = False
    rig.wall.now = current.next_run_ms
    await rig.service.poll_events()
    current = rig.service.store.routine(routine["id"])
    assert current.enabled and current.poll_initialized and current.poll_failures == 0 and not current.last_error
    assert state["reads"] == 1 and not rig.background.submitted


@pytest.mark.parametrize("hint", ["createHint", "gone"])
async def test_loaded_write_or_missing_tool_stops_with_existing_message(cold_calendar, hint):
    from raphael_core.members.events import failure_message
    rig, _, state, when = cold_calendar
    state["hint"] = hint
    routine = (await rig.call("routines.create", {"member_id": 0, "title": "Calendar items", "prompt": "Review changes", "when": when}))["routine"]
    await rig.service.poll_events()
    current = rig.service.store.routine(routine["id"])
    assert state["loads"] == 2 and state["reads"] == 0
    assert not current.enabled
    name = next(c["name"] for c in rig.service._connections() if c["id"] == when["app"])
    assert current.last_error == failure_message("zh-TW", name, stop=True)
    assert rig.conn.execute("SELECT count(*) FROM agent_turns WHERE status='error'").fetchone()[0] == 1


@pytest.mark.parametrize("action", ["pick", "poll"])
async def test_catalog_load_and_read_share_one_deadline(cold_calendar, monkeypatch, action):
    rig, connectors, state, when = cold_calendar
    bounds = []
    original_wait = asyncio.wait_for

    async def bounded(awaitable, timeout):
        bounds.append(timeout)
        return await original_wait(awaitable, timeout=0.03)

    async def slow_catalog(entry):
        await asyncio.sleep(0.02)
        connectors._tool_catalog[entry.id] = [{"slug": "GOOGLECALENDAR_EVENTS_LIST", "tags": ["readOnlyHint"]}]

    async def slow_read(*args, **kwargs):
        await asyncio.sleep(0.02)
        pytest.fail("the shared deadline must cancel the read")

    monkeypatch.setattr(connectors, "ensure_tools", slow_catalog, raising=False)
    monkeypatch.setattr(rig.service._events.gate, "call_plugin", slow_read)
    monkeypatch.setattr(asyncio, "wait_for", bounded)
    if action == "pick":
        result = await rig.call("routines.list", {"member_id": 0, "event": "calendar-event"})
        assert "event_error" in result
    else:
        routine = (await rig.call("routines.create", {"member_id": 0, "title": "Calendar items", "prompt": "Review changes", "when": when}))["routine"]
        await rig.service.poll_events()
        current = rig.service.store.routine(routine["id"])
        assert current.enabled and current.poll_failures == 1
        assert rig.conn.execute("SELECT count(*) FROM agent_turns").fetchone()[0] == 0
        assert not rig.service._events.lock.locked()
    assert bounds == [60]


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

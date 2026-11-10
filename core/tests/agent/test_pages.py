"""Conversation pages: production harness, persistence, HTTP isolation and gated MCP apps.

Only in-process MCP fixtures and a loopback test listener are used. No provider calls.
"""

import asyncio
import json
import re
from urllib.parse import urlsplit

import pytest
from mcp.server.mcpserver import MCPServer

from raphael_core.agent.harness_tools import definitions_for, tool
from raphael_core.agent.history import AgentHistory
from raphael_core.agent.pages import HTML_BYTES, MCP_MIME, PageError, PageHost, PageStore, domains
from raphael_core.agent.permissions import PermissionCards
from raphael_core.agent.policy import Tier
from raphael_core.agent.speaker import RAPHAEL
from raphael_core.brain.db import connect
from raphael_core.protocol import RpcError

from .test_narration import chat, typed, use
from .test_plugins import plugins, calls  # noqa: F401
from .test_service import make_rig  # noqa: F401


def stored(conn, **overrides):
    conversation = conn.execute("SELECT id FROM conversations LIMIT 1").fetchone()
    conversation_id = overrides.get("conversation_id", conversation[0] if conversation else None)
    turn = AgentHistory(conn).add(session_id="page", question="show", route="answer", prefix="", text="shown",
                                  status="done", source="app", conversation_id=conversation_id)
    values = dict(turn_id=turn, member_id=0, conversation_id=conversation_id, title="Product", html="<button>Choose</button>")
    values.update(overrides)
    return PageStore(conn).write(**values)


def test_page_tools_are_t0_and_shared_by_brains():
    definitions = dict(definitions_for(RAPHAEL))
    for name in ("show_page", "update_page"):
        assert tool(name).tier == Tier.T0
        description = definitions[name]["description"]
        assert "window.raphael.send" in description and "--accent" in description


async def test_harness_stores_page_on_turn_updates_in_place_and_notifies(make_rig, client):
    notices = []
    rig = make_rig(notify=lambda method, data: notices.append((method, data)))
    client.chats = [chat("", ("show_page", {"title": "Calculator", "html": "<input type=number>", "fallback_text": "Enter a number"})),
                    chat('{"text":"Ready."}')]
    await typed(rig)
    [turn] = await rig.turns()
    [page] = turn["pages"]
    assert page == {"id": page["id"], "title": "Calculator", "rev": 1, "height": 320,
                    "source": "html", "server": None, "fallback": "Enter a number", "kind": "page"}
    assert ("agent.turn", {"turn_id": turn["id"], "member_id": 0}) in notices
    assert any(page["id"] in message.get("content", "") for message in client.chat_calls[-1]["messages"] if message["role"] == "tool")
    client.chats = [chat("Updating.", use("update_page", {"page_id": page["id"], "html": "<button>Done</button>", "title": "Done"})),
                    chat('{"text":"Updated."}')]
    await rig.call("agent.ask", {"session_id": "update", "text": "Change it", "ui_language": "en", "source": "app"})
    rows = await rig.turns()
    assert rows[0]["pages"] == []
    assert rows[1]["pages"][0] == {**page, "title": "Done", "rev": 2}
    assert rig.service.pages.store.get(page["id"])["html"] == "<button>Done</button>"


@pytest.mark.parametrize("field,value,kind", [
    ("html", "界" * (HTML_BYTES // 3 + 1), "too_large"),
    ("title", "password is hunter", "secret"),
    ("html", '<input value="password is hunter">', "secret"),
    ("html", "password is &#104;unter", "secret"),
    ("fallback_text", "password is hunter", "secret"),
], ids=["utf8-limit", "title-secret", "html-secret", "encoded-secret", "fallback-secret"])
def test_refusals_leave_no_page_or_revision(conn, field, value, kind):
    with pytest.raises(PageError) as error:
        stored(conn, **{field: value})
    assert error.value.kind == kind
    assert conn.execute("SELECT COUNT(*) FROM pages").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM page_revisions").fetchone()[0] == 0


def test_updates_keep_only_ten_revisions_and_refuse_secrets_atomically(conn):
    page = stored(conn)
    store = PageStore(conn)
    for rev in range(2, 17):
        updated = store.update(page["id"], f"<p>Revision {rev}</p>")
        assert updated["id"] == page["id"] and updated["rev"] == rev
    assert [row[0] for row in conn.execute("SELECT rev FROM page_revisions ORDER BY rev")] == list(range(7, 17))
    with pytest.raises(PageError):
        store.update(page["id"], "password is hunter")
    assert store.get(page["id"])["rev"] == 16


@pytest.mark.parametrize("delete", ["turn", "conversation", "member"])
def test_deletion_cascades_to_page_and_revisions(conn, delete):
    if delete == "member":
        conn.execute("INSERT INTO members (name, position, created_at_ms) VALUES ('Synthetic member', 0, 1)")
        member = conn.execute("SELECT id FROM members WHERE name='Synthetic member'").fetchone()[0]
        turn = AgentHistory(conn).add(session_id="m", question="q", route="answer", prefix="", text="", status="done", member_id=member)
        conversation_id = AgentHistory(conn).get(turn).conversation_id
        page = PageStore(conn).write(turn_id=turn, member_id=member, conversation_id=conversation_id, title="Member", html="Hello")
        conn.execute("DELETE FROM members WHERE id=?", (member,))
    else:
        from raphael_core.agent.conversations import Conversations
        Conversations(conn).main()
        page = stored(conn)
        table, key = ("agent_turns", "turn_id") if delete == "turn" else ("conversations", "conversation_id")
        conn.execute(f"DELETE FROM {table} WHERE id=?", (page[key],))
    assert PageStore(conn).get(page["id"]) is None
    assert conn.execute("SELECT COUNT(*) FROM page_revisions").fetchone()[0] == 0


async def fetch(url, *, host=None, path=None):
    parsed = urlsplit(url)
    reader, writer = await asyncio.open_connection(parsed.hostname, parsed.port)
    target = path or parsed.path + "?" + parsed.query
    writer.write(f"GET {target} HTTP/1.1\r\nHost: {host or parsed.netloc}\r\n\r\n".encode())
    await writer.drain()
    response = (await reader.read()).decode()
    writer.close()
    await writer.wait_closed()
    return response


async def test_host_headers_tokens_host_validation_theme_and_deleted_pages(conn):
    page = stored(conn, html='<!DOCTYPE html><html><head><title>Own</title></head><body><script>window.loaded=1</script></body></html>')
    host = PageHost(PageStore(conn))
    try:
        url = await host.url(page["id"], "dark")
        assert page["id"] not in url
        response = await fetch(url)
        assert response.startswith("HTTP/1.1 200")
        headers, body = response.split("\r\n\r\n", 1)
        for value in ("sandbox allow-scripts allow-forms", "default-src 'none'", "connect-src 'none'",
                      "form-action 'none'", "base-uri 'none'", "frame-src 'none'", "Cache-Control: no-store",
                      "Referrer-Policy: no-referrer", "https://cdn.jsdelivr.net"):
            assert value in headers
        assert "allow-same-origin" not in headers and "unsafe-eval" not in headers
        assert "window.raphael" in body and "ResizeObserver" in body and "--bg:#18181b" in body
        assert "window.loaded=1" in body
        assert (await fetch(url, host="attacker.example")).startswith("HTTP/1.1 403")
        assert (await fetch(url, path="/p/wrong")).startswith("HTTP/1.1 404")
        assert (await fetch(url, path="/p/" + page["id"])).startswith("HTTP/1.1 404")
        conn.execute("DELETE FROM pages WHERE id=?", (page["id"],))
        assert (await fetch(url)).startswith("HTTP/1.1 404")
    finally:
        await host.aclose()


async def test_restart_preserves_page_and_rotates_token(tmp_path):
    conn = connect(tmp_path / "pages.sqlite")
    page = stored(conn)
    host = PageHost(PageStore(conn))
    old = await host.url(page["id"], "light")
    await host.aclose()
    conn.close()
    conn = connect(tmp_path / "pages.sqlite")
    host = PageHost(PageStore(conn))
    try:
        new = await host.url(page["id"], "light")
        assert urlsplit(new).path != urlsplit(old).path
        assert (await fetch(new)).startswith("HTTP/1.1 200")
        assert (await fetch(new, path=urlsplit(old).path)).startswith("HTTP/1.1 404")
    finally:
        await host.aclose()
        conn.close()


def test_csp_domains_are_https_bounded_and_cannot_inject_directives():
    assert domains(["https://cdn.example", "https://cdn.example/", "http://cdn.example", "https://*.example",
                    "https://cdn.example/x", "https://a.example; script-src *", "https://127.0.0.1", "https://a.local"]) == ["https://cdn.example"]
    assert len(domains([f"https://cdn{i}.example" for i in range(40)])) == 16


async def app_server(plugins):
    server = MCPServer("Shop")
    calls = []

    @server.tool(meta={"ui": {"resourceUri": "ui://shop/product"}})
    def product(query: str) -> str:
        return "Product: " + query

    @server.tool(meta={"ui": {"visibility": ["app"]}})
    def buy(quantity: int) -> str:
        calls.append(quantity)
        return "Ordered"

    @server.tool(meta={"ui": {"visibility": ["model"]}})
    def private_tool() -> str:
        pytest.fail("An app called a model-only tool")

    @server.resource("ui://shop/product", mime_type=MCP_MIME,
                     meta={"ui": {"csp": {"connectDomains": ["https://api.example", "http://unsafe.example"],
                                            "resourceDomains": ["https://cdn.example", "https://*.example"]}}})
    def view() -> str:
        return '<button onclick="window.raphael.send(\'Buy this\')">Buy</button>'

    plugins.servers.by_name["Shop"] = server
    added = await plugins.rpc.call("integrations.add", {"name": "Shop", "transport": "stdio", "command": "unused"})
    server_id = added["server"]["id"]
    await plugins.rpc.call("integrations.set_enabled", {"id": server_id, "enabled": True})
    await plugins.rpc.call("integrations.refresh", {"id": server_id})
    plugins.hub.strict["buy"] = Tier.T2
    return server_id, calls, server


async def test_mcp_resource_yields_page_and_calls_use_permission_card_gate_and_audit(make_rig, plugins, conn, client):
    server_id, bought, _server = await app_server(plugins)
    permissions = PermissionCards(conn)
    rig = make_rig(plugins=plugins.hub, permissions=permissions)
    client.chats = [chat("Finding.", use("Shop__product", {"query": "Tea"})), chat('{"text":"Choose an item."}')]
    await typed(rig, "Find tea")
    [turn] = await rig.turns()
    [page] = turn["pages"]
    offered = {item["function"]["name"] for item in client.chat_calls[0]["tools"]}
    assert {"show_page", "update_page"} <= offered
    assert page["source"] == "mcp" and page["server"] == server_id
    opened = await rig.call("pages.open", {"id": page["id"], "theme": "light"})
    assert opened["tool_input"] == {"query": "Tea"}
    assert opened["tool_result"]["content"][0]["text"] == "Product: Tea"
    response = await fetch(opened["url"])
    assert "connect-src https://api.example" in response and "https://cdn.example" in response
    assert "unsafe.example" not in response and "https://*.example" not in response
    assert any("owner can see" in message.get("content", "") for message in client.chat_calls[-1]["messages"] if message["role"] == "tool")
    assert not any(t.name == "buy" for t in plugins.hub.offered())
    before = len(client.chat_calls)
    asked = await rig.call("pages.tool_call", {"id": page["id"], "tool": "buy", "arguments": {"quantity": 2}})
    assert asked["status"] == "confirm" and bought == []
    card = permissions.views([asked["turn_id"]])[asked["turn_id"]][0]
    assert card["tool"] == "buy"
    done = await rig.call("agent.confirm", {"id": asked["confirm"]["id"], "approved": True, "digest": asked["confirm"]["digest"]})
    assert done["ok"] and bought == [2] and len(client.chat_calls) == before
    assert done["tool_result"]["content"][0]["text"] == "Ordered"
    assert any(row[1] == "buy" and row[3] == "user" and row[4] == "ok" for row in plugins.audit())
    denied = await rig.call("pages.tool_call", {"id": page["id"], "tool": "buy", "arguments": {"quantity": 3}})
    await rig.confirm(denied["confirm"]["id"], False)
    assert bought == [2]
    pending = await rig.call("pages.tool_call", {"id": page["id"], "tool": "buy", "arguments": {"quantity": 4}})
    plugins.hub._failure[server_id] = "auth"
    with pytest.raises(RpcError) as error:
        await rig.call("pages.tool_call", {"id": page["id"], "tool": "buy"})
    assert error.value.data["kind"] == "server_disconnected"
    changed = await rig.call("agent.confirm", {"id": pending["confirm"]["id"], "approved": True,
                                               "digest": pending["confirm"]["digest"]})
    assert changed["error"] == "server_disconnected" and bought == [2]
    plugins.hub._failure.clear()
    for tool_name in ("private_tool", "foreign_tool", "mcp:other/buy", "Other__buy"):
        with pytest.raises(RpcError):
            await rig.call("pages.tool_call", {"id": page["id"], "tool": tool_name, "arguments": {}})
    plugins.hub._config.get(server_id).enabled = False
    with pytest.raises(RpcError) as error:
        await rig.call("pages.tool_call", {"id": page["id"], "tool": "buy", "arguments": {}})
    assert error.value.data["kind"] == "server_disabled"
    assert (await fetch((await rig.call("pages.open", {"id": page["id"]}))["url"])).startswith("HTTP/1.1 200")
    plugins.hub._config.remove(server_id)
    with pytest.raises(RpcError) as error:
        await rig.call("pages.tool_call", {"id": page["id"], "tool": "buy"})
    assert error.value.data["kind"] == "server_removed"


async def test_pages_open_reports_typed_gone_error(make_rig):
    rig = make_rig()
    with pytest.raises(RpcError) as error:
        await rig.call("pages.open", {"id": "missing", "theme": "light"})
    assert error.value.code == 1005 and error.value.data == {"kind": "page_gone"}


async def test_update_cannot_replace_a_page_from_another_conversation(make_rig, client):
    rig = make_rig()
    page = stored(rig.conn, conversation_id=rig.service.conversations.quick())
    other = rig.service.conversations.main()
    client.chats = [chat("Updating.", use("update_page", {"page_id": page["id"], "html": "Changed"})),
                    chat('{"text":"Please choose a page in this conversation."}')]
    await rig.call("agent.ask", {"session_id": "foreign", "text": "Change the page", "source": "app",
                                "ui_language": "en", "conversation_id": other})
    assert rig.service.pages.store.get(page["id"])["rev"] == 1


def test_mcp_visibility_changes_the_cached_fingerprint_and_survives_reload(tmp_path):
    from raphael_core.integrations.config import ConfigStore, ServerConfig, tool_record
    before = tool_record("view", "View", {}, meta={"ui": {"visibility": ["model", "app"]}})
    after = tool_record("view", "View", {}, meta={"ui": {"visibility": ["model"]}})
    assert before.fingerprint != after.fingerprint
    config = ConfigStore(tmp_path)
    config.add(ServerConfig("synthetic", "Example", "stdio", tools=[after]))
    config.save()
    assert ConfigStore(tmp_path).get("synthetic").tool("view").ui == {"visibility": ["model"]}


async def test_app_visibility_is_rechecked_on_server_at_execution(make_rig, plugins, conn):
    server_id, bought, server = await app_server(plugins)
    rig = make_rig(plugins=plugins.hub, permissions=PermissionCards(conn))
    page = stored(conn, source="mcp", server=server_id, tool="product")
    # The saved tool cache still permits apps, while the server now refuses them.
    server.remove_tool("buy")

    @server.tool(name="buy", meta={"ui": {"visibility": ["model"]}})
    def changed_buy(quantity: int) -> str:
        bought.append(quantity)
        return "This call must never happen"

    asked = await rig.call("pages.tool_call", {"id": page["id"], "tool": "buy", "arguments": {"quantity": 9}})
    result = await rig.call("agent.confirm", {"id": asked["confirm"]["id"], "approved": True,
                                             "digest": asked["confirm"]["digest"]})
    assert bought == []
    assert result["error"] == "tool_not_visible"
    assert not plugins.hub._failure


# --- report pages (agent/report_page.py) ----------------------------------------------------------

REPORT = {"sections": [
    {"kind": "findings", "title": "Findings", "callout": "Two things wait for you.",
     "items": [{"title": "Timeline", "text": "Ready since Monday.", "status": "pending", "label": "Ready"},
               {"title": "Prices", "status": "blocked"}]},
    {"kind": "table", "title": "Overview", "columns": ["Member", "Part"],
     "rows": [{"cells": ["Raphael", "Hands out work"], "group": "Core", "member_id": 0, "status": "running"},
              {"cells": ["Mira", "Research"], "group": "Projects"}]},
    {"kind": "team", "title": "Who works with whom",
     "nodes": [{"id": "o", "owner": True}, {"id": "r", "member_id": 0, "note": "Hands out work"}, {"id": "x", "name": "Clients"}],
     "edges": [{"from": "o", "to": "r", "label": "Asks"}, {"from": "x", "to": "r"}],
     "notes": [{"label": "Gap", "text": "Nobody answers client mail."}]},
    {"kind": "text", "title": "Next", "text": "Nothing else is on record."},
]}


def _tool_reply(client):
    return next(message["content"] for message in client.chat_calls[-1]["messages"] if message["role"] == "tool")


def test_report_is_offered_beside_html_and_its_statuses_match_the_checker():
    from raphael_core.agent.harness_tools import REPORT as SCHEMA
    from raphael_core.agent.report_page import KINDS, STATUSES
    definitions = dict(definitions_for(RAPHAEL))
    for name, required in (("show_page", ["title"]), ("update_page", ["page_id"])):
        parameters = definitions[name]["parameters"]
        assert parameters["required"] == required and {"report", "html"} <= set(parameters["properties"])
    assert "report" in definitions["show_page"]["description"].split(".")[0]
    item = SCHEMA["properties"]["sections"]["items"]["properties"]
    assert item["kind"]["enum"] == list(KINDS)
    assert item["items"]["items"]["properties"]["status"]["enum"] == list(STATUSES)


async def test_a_report_is_kept_as_checked_content_and_opens_without_a_frame(make_rig, client):
    rig = make_rig()
    client.chats = [chat("", ("show_page", {"title": "Team report", "report": REPORT})), chat('{"text":"Here it is."}')]
    await typed(rig)
    [turn] = await rig.turns()
    [page] = turn["pages"]
    assert page["kind"] == "report" and page["title"] == "Team report" and page["fallback"].startswith("Team report\nTwo things")
    kept = rig.service.pages.store.get(page["id"])
    report = kept["tool_input"]["report"]
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", report["as_of"])
    assert [section["kind"] for section in report["sections"]] == ["findings", "table", "team", "text"]
    assert report["sections"][0]["items"][1] == {"title": "Prices", "status": "blocked"}
    assert "<h1>Team report</h1>" in kept["html"] and "Owner → " in kept["html"]
    assert "link card" in _tool_reply(client)
    opened = await rig.call("pages.open", {"id": page["id"], "theme": "dark"})
    assert opened["kind"] == "report" and opened["report"] == report and "url" not in opened
    assert rig.service.pages.host.server is None


async def test_report_update_replaces_its_content_and_html_makes_it_a_page_again(make_rig, client):
    rig = make_rig()
    client.chats = [chat("", ("show_page", {"title": "Team report", "report": REPORT})), chat('{"text":"Here it is."}')]
    await typed(rig)
    [page] = (await rig.turns())[0]["pages"]
    smaller = {"sections": [{"kind": "text", "text": "Only this is on record."}]}
    client.chats = [chat("", ("update_page", {"page_id": page["id"], "report": smaller})), chat('{"text":"Updated."}')]
    await rig.call("agent.ask", {"session_id": "update", "text": "Shorter", "ui_language": "en", "source": "app"})
    kept = rig.service.pages.store.get(page["id"])
    assert kept["rev"] == 2 and kept["title"] == "Team report" and kept["tool_input"]["report"]["sections"] == smaller["sections"]
    client.chats = [chat("", ("update_page", {"page_id": page["id"], "html": "<p>Plain</p>"})), chat('{"text":"Plain now."}')]
    await rig.call("agent.ask", {"session_id": "plain", "text": "Plain", "ui_language": "en", "source": "app"})
    kept = rig.service.pages.store.get(page["id"])
    assert kept["rev"] == 3 and kept["tool_input"] == {} and kept["html"] == "<p>Plain</p>"
    assert (await rig.turns())[-1]["pages"][0]["kind"] == "page"


def _broken(path, value):
    report = json.loads(json.dumps(REPORT))
    target = report
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    return report


@pytest.mark.parametrize("report,words", [
    (_broken(["sections", 1, "rows", 0, "member_id"], 42), "rows[0].member_id is not a member"),
    (_broken(["sections", 0, "kind"], "chart"), "sections[0].kind must be one of findings, table, team, text"),
    (_broken(["sections", 1, "rows", 0, "cells"], ["only one"]), "one value for each of the 2 columns"),
    (_broken(["sections", 2, "edges", 0, "to"], "nobody"), "edges[0] must join two different node ids"),
    (_broken(["sections", 2, "nodes", 1, "owner"], True), "nodes[1] needs exactly one of member_id, owner or name"),
    (_broken(["sections", 0, "items", 0, "status"], "late"), "status must be one of running"),
    (_broken(["sections", 0, "items", 0, "label"], "much too long a label"), "label exceeds 12 characters"),
    (_broken(["sections", 0, "callout"], "password is hunter"), "callout contains a secret"),
    ({"sections": [{"kind": "text", "text": "x"}] * 9}, "sections has more than 8 entries"),
    ({"sections": []}, "sections needs at least 1"),
], ids=["unknown-member", "unknown-kind", "cells", "edge", "two-identities", "status", "label", "secret", "sections", "empty"])
async def test_a_report_that_breaks_the_format_is_refused_with_what_to_fix(make_rig, client, report, words):
    rig = make_rig()
    client.chats = [chat("", ("show_page", {"title": "Team report", "report": report})), chat('{"text":"I could not."}')]
    await typed(rig)
    assert (await rig.turns())[0]["pages"] == []
    assert rig.conn.execute("SELECT COUNT(*) FROM pages").fetchone()[0] == 0
    reply = _tool_reply(client)
    assert words in reply and "hunter" not in reply


def test_a_report_time_never_reads_as_a_card_number():
    from raphael_core.agent.report_page import checked_report
    from raphael_core.memory.scan import _luhn, find_secret
    # One millisecond time in ten passes the Luhn check; the kept content is scanned for secrets as a whole.
    at = next(ms for ms in range(1794240000000, 1794240000100) if _luhn(str(ms)))
    kept = checked_report(REPORT, exists=lambda member_id: member_id == 0, as_of_ms=at)
    assert find_secret(json.dumps({"report": kept})) is None and kept["as_of"] == "2026-11-09T16:00:00Z"


@pytest.mark.parametrize("arguments", [{"title": "Both", "html": "<p>x</p>", "report": REPORT}, {"title": "Neither"}],
                         ids=["both", "neither"])
async def test_a_page_is_either_html_or_a_report(make_rig, client, arguments):
    rig = make_rig()
    client.chats = [chat("", ("show_page", arguments)), chat('{"text":"I could not."}')]
    await typed(rig)
    assert rig.conn.execute("SELECT COUNT(*) FROM pages").fetchone()[0] == 0
    assert "Give either html or report" in _tool_reply(client)

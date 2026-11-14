"""Conversation pages: production harness, persistence, HTTP isolation and gated MCP apps.

Only in-process MCP fixtures and a loopback test listener are used. No provider calls.
"""

import asyncio
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from mcp.server.mcpserver import MCPServer

from raphael_core.agent.harness_tools import definitions_for, tool
from raphael_core.agent.history import AgentHistory
from raphael_core.agent.pages import HTML_BYTES, MCP_MIME, PageError, PageHost, PageStore, domains, page_csp, page_file
from raphael_core.agent.permissions import PermissionCards
from raphael_core.agent.policy import Tier
from raphael_core.agent.report_page import FILE_POLICY, file_name
from raphael_core.agent.speaker import RAPHAEL
from raphael_core.brain.db import connect
from raphael_core.protocol import INVALID_PARAMS, RpcError

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
    # show_page carries the page's rules; update_page, always offered beside it, points to them instead of repeating them.
    assert "window.raphael.send" in definitions["show_page"]["description"] and "--accent" in definitions["show_page"]["description"]
    assert "show_page's rules" in definitions["update_page"]["description"]


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


PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="


@pytest.mark.parametrize("html", [
    # The links on the daily overview Raphael could not show on 2026-11-14.
    "<button onclick=\"window.raphael.open('https://www.accuweather.com/zh/tw/taichung-city/315040/weather-forecast/315040')\">Source</button>",
    "<a href='https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Announces-CEO-Transition/'>NVIDIA</a>",
    f'<img alt="dot" src="data:image/png;base64,{PNG}">',
    '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js" '
    'integrity="sha384-9nhczxUqK87bcKHh20fSQcTGD4qq5GhayNYSYWqwBkINBhOfQLg/P5HG5lF1urn4" crossorigin="anonymous"></script>',
    "<script>new Chart(c, {data: {labels: ['09', '12'], datasets: [{data: [1794240000006, 1794240000106]}]}})</script>",
], ids=["weather-link", "news-link", "picture", "library", "times"])
def test_ordinary_links_pictures_libraries_and_numbers_are_not_secrets(conn, html):
    assert stored(conn, html=html)["html"] == html


@pytest.mark.parametrize("html", [
    "<a href='https://api.example.com/v1/Q7x9Lm2Pz8Rt4Kw6Vb3Nc5Jd1Hf0Gs7Ya2Ue/forecast'>x</a>",
    '<object data="data:text/plain;base64,cGFzc3dvcmQgaXMgaHVudGVy"></object>',  # "password is hunter"
    "<p>sk-or-v1-8f3a9c0d2b7e4f1a6c5d8e9f0a1b2c3d</p>",
], ids=["key-in-a-link", "secret-in-an-embedded-text", "token"])
def test_a_secret_in_a_link_or_an_embedded_text_is_still_refused(conn, html):
    with pytest.raises(PageError) as error:
        stored(conn, html=html)
    assert error.value.kind == "secret"


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
        assert "window.raphael" in body and "ResizeObserver" in body and "--bg:#0a0a0a" in body
        # The app's own theme words, the chart colours of its dark theme among them, and its face.
        assert "--surface:#161616" in body and "--chart-1:#3987e5" in body and "--chart-8:#e66767" in body
        assert "font-family:var(--font)" in body and '--font:"Inter"' in body
        assert "window.loaded=1" in body
        # The page tells the window where the owner is reading, and goes back there when the window asks (a page changed while open).
        assert "post('scroll'" in body and "'scroll-to'" in body and "event.source === parent" in body and "post('escape'" in body
        assert (await fetch(url, host="attacker.example")).startswith("HTTP/1.1 403")
        assert (await fetch(url, path="/p/wrong")).startswith("HTTP/1.1 404")
        assert (await fetch(url, path="/p/" + page["id"])).startswith("HTTP/1.1 404")
        conn.execute("DELETE FROM pages WHERE id=?", (page["id"],))
        assert (await fetch(url)).startswith("HTTP/1.1 404")
    finally:
        await host.aclose()


def test_a_page_the_member_writes_gets_the_apps_base_style_under_its_own_rules(conn):
    """R-PAGE-06: the pages came out uneven because the app gave a page only its colours. Its base style comes first and
    speaks at the lowest specificity, so a rule the page writes for the same thing wins; a plugin's page is left alone."""
    from raphael_core.agent.page_style import BASE
    from raphael_core.agent.pages import document
    page = stored(conn, html="<style>h1{font-size:20px}</style><h1>Mine</h1>")
    written = document(page, "dark")
    assert BASE in written and written.index(BASE) < written.index("<h1>Mine</h1>")
    # The page's own style is after the base, and the theme's words are before it: the base reads them.
    assert written.index("--bg:#0a0a0a") < written.index(BASE) < written.index("<style>h1{font-size:20px}")
    assert BASE not in document({**page, "source": "mcp"}, "dark")


def test_the_base_style_is_all_low_specificity_theme_words_and_loads_nothing():
    from raphael_core.agent.page_style import BASE
    from raphael_core.agent.pages import FONT, THEME
    # Every selector stands in :where() (a pseudo-element follows it), so no rule of the base outranks a page's own.
    rules = re.sub(r"@(?:media|supports)[^{]*\{", "", BASE)
    def top_level(text):
        depth, part = 0, ""
        for char in text:
            depth += (char == "(") - (char == ")")
            if char == "," and not depth:
                yield part
                part = ""
            else:
                part += char
        yield part
    selectors = [part for chunk in rules.split("}") if "{" in chunk for part in top_level(chunk.split("{")[0])]
    assert selectors and all(part.strip().startswith(":where(") for part in selectors), [p for p in selectors if not p.strip().startswith(":where(")]
    # It speaks in the theme's words, the face and its own tone; nothing else is read by name.
    words = set(THEME["light"]) | {"font", "tone", "pg-max", "pg-gutter"}
    assert set(re.findall(r"var\(--([\w-]+)", BASE)) <= words
    assert THEME["light"].keys() == THEME["dark"].keys() and FONT
    # The page's policy loads nothing it names: no address, no import, no picture, no font file.
    assert not re.search(r"url\(|@import|@font-face|https?:|//", BASE, re.I)
    # The measures the owner named (his Grok Bot picture): a 32 px title, a table with hairlines, right-aligned figures.
    assert ":where(h1){margin-top:0;font-size:32px" in BASE and "line-height:1.6" in BASE
    assert ":where(.num){text-align:end" in BASE and "overflow-x:auto" in BASE


def test_the_classes_the_tool_names_are_in_the_base_style():
    from raphael_core.agent.harness_tools import DEFINITIONS, SHOW_PAGE
    from raphael_core.agent.page_style import BASE
    told = re.search(r"styled by the app \(([^)]*)\)", DEFINITIONS[SHOW_PAGE]["description"])[1]
    classes = re.findall(r"\.([a-z]+)", told)
    assert set(classes) == {"callout", "info", "warn", "ok", "toc", "chips", "cards", "kpis", "num"}
    for name in classes:
        assert f".{name}" in BASE, name


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


def prompt_of(client):
    return "\n".join(str(message.get("content", "")) for message in client.chat_calls[-1]["messages"])


async def shown_page(rig, client, **arguments):
    """A first turn in which the member shows a page; the page's row."""
    client.chats = [chat("", ("show_page", {"title": "Calculator", "html": "<input type=number>", **arguments})), chat('{"text":"Ready."}')]
    await typed(rig)
    [turn] = await rig.turns()
    return rig.service.pages.store.get(turn["pages"][0]["id"])


async def test_a_member_reads_the_id_of_a_page_it_showed_in_an_earlier_turn(make_rig, client):
    """The owner's 2026-11-11 report: asked to change a page, the member sent a new one. Its later turn read only the
    page's title and revision, never the id update_page needs, so it could not name the page it had made."""
    rig = make_rig()
    page = await shown_page(rig, client)
    client.chats = [chat('{"text":"Which one?"}')]
    await typed(rig, "Make the box wider")
    assert f"page_id={page['id']}" in prompt_of(client)


async def test_a_page_the_owner_has_open_is_what_here_and_this_mean_in_their_next_message(make_rig, client):
    rig = make_rig()
    page = await shown_page(rig, client)
    assert await rig.call("pages.viewing", {"id": page["id"]}) == {"viewing": page["id"]}
    client.chats = [chat('{"text":"Wider."}')]
    await typed(rig, "Change this part")
    prompt = prompt_of(client)
    line = next(line for line in prompt.splitlines() if "the owner is looking at now" in line)
    assert f"page_id={page['id']}" in line and '"Calculator"' in line and "update_page" in line
    # Put away, the page is not mentioned in the next message.
    await rig.call("pages.viewing", {"id": None})
    client.chats = [chat('{"text":"Ok."}')]
    await typed(rig, "And now?")
    assert "the owner is looking at now" not in prompt_of(client)


async def test_a_page_open_in_another_conversation_or_of_another_member_is_not_told(make_rig, client):
    rig = make_rig()
    elsewhere = stored(rig.conn, conversation_id=rig.service.conversations.quick())
    await rig.call("pages.viewing", {"id": elsewhere["id"]})
    client.chats = [chat('{"text":"Ok."}')]
    await typed(rig, "Change this")
    assert "the owner is looking at now" not in prompt_of(client)


async def test_a_page_that_is_gone_cannot_be_open(make_rig):
    rig = make_rig()
    with pytest.raises(RpcError) as error:
        await rig.call("pages.viewing", {"id": "missing"})
    assert error.value.code == 1005
    with pytest.raises(RpcError) as error:
        await rig.call("pages.viewing", {"id": 5})
    assert error.value.code == INVALID_PARAMS


async def test_a_refused_update_names_the_pages_of_this_conversation_so_the_member_can_try_again(make_rig, client):
    rig = make_rig()
    page = await shown_page(rig, client)
    client.chats = [chat("Updating.", ("update_page", {"page_id": "Calculator", "html": "<b>Wider</b>"})), chat('{"text":"Ok."}')]
    await typed(rig, "Make the box wider")
    refused = next(message["content"] for message in client.chat_calls[-1]["messages"] if message["role"] == "tool")
    assert page["id"] in refused and '"Calculator"' in refused
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
    (_broken(["sections", 0, "kind"], "map"), "sections[0].kind must be one of findings, table, team, text, stats, chart"),
    (_broken(["sections", 1, "rows", 0, "cells"], ["only one"]), "one value for each of the 2 columns"),
    (_broken(["sections", 2, "edges", 0, "to"], "nobody"), "edges[0] must join two different node ids"),
    (_broken(["sections", 2, "nodes", 1, "owner"], True), "nodes[1] needs exactly one of member_id, owner or name"),
    (_broken(["sections", 0, "items", 0, "status"], "late"), "status must be one of running"),
    (_broken(["sections", 0, "items", 0, "label"], "much too long a label"), "label exceeds 12 characters"),
    (_broken(["sections", 0, "callout"], "password is hunter"), "callout contains a secret"),
    ({"sections": [{"kind": "text", "text": "x"}] * 13}, "sections has more than 12 entries"),
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


# The owner's daily overview (2026-11-14): weather, investments, projects by status and owner, members; two halves side by side.
DASHBOARD = {"sections": [
    {"kind": "stats", "title": "Today", "tiles": [
        {"name": "Taichung", "value": "29", "unit": "°C", "note": "Storms after noon", "trend": [24, 26, 29, 27]},
        {"name": "TAIEX", "value": "23,412", "delta": "+1.35%", "trend": [22900, 23100, 23412]},
        {"name": "Rain", "value": "90", "unit": "%", "status": "waiting", "label": "Umbrella"}]},
    {"kind": "chart", "title": "Projects", "span": "half", "type": "stacked", "labels": ["To do", "Waiting", "Done"],
     "series": [{"name": "Claude", "values": [4, 7, 63]}, {"name": "Raphael", "member_id": 0, "values": [4, 1, 0]}], "unit": "tasks"},
    {"kind": "chart", "title": "Temperature", "span": "half", "type": "line", "labels": ["09", "12", "15", "18"],
     "series": [{"values": [24, 28, None, 25]}], "unit": "°C", "note": "Open-Meteo"},
    {"kind": "chart", "title": "Share", "type": "donut", "labels": ["Done", "Waiting"], "series": [{"values": [92, 22]}]},
]}


def test_a_dashboard_keeps_its_figures_charts_and_halves():
    from raphael_core.agent.report_page import checked_report, report_fallback, report_html
    kept = checked_report(DASHBOARD, exists=lambda member_id: member_id == 0, as_of_ms=1794240000000)
    stats, projects, temperature, share = kept["sections"]
    assert stats["tiles"][1] == {"name": "TAIEX", "value": "23,412", "delta": "+1.35%", "trend": [22900, 23100, 23412]}
    assert stats["tiles"][2]["status"] == "waiting" and stats["tiles"][2]["label"] == "Umbrella"
    assert projects == {"kind": "chart", "title": "Projects", "span": "half", "type": "stacked", "labels": ["To do", "Waiting", "Done"],
                        "series": [{"values": [4, 7, 63], "name": "Claude"}, {"values": [4, 1, 0], "name": "Raphael", "member_id": 0}],
                        "unit": "tasks"}
    assert temperature["series"] == [{"values": [24, 28, None, 25]}] and temperature["note"] == "Open-Meteo"
    assert share["type"] == "donut" and "span" not in share
    html = report_html("Daily overview", kept, lambda member_id: "Raphael")
    assert "<th>Claude</th><th>Raphael</th>" in html and "<td>Done</td><td>63</td><td>0</td>" in html
    assert "<li>TAIEX: <b>23,412</b> +1.35%</li>" in html
    assert report_fallback("Daily overview", kept).split("\n")[1] == "Taichung 29°C · TAIEX 23,412 · Rain 90%"


def _chart(**changes):
    return {"sections": [{"kind": "chart", "type": "bar", "labels": ["a", "b"], "series": [{"values": [1, 2]}], **changes}]}


@pytest.mark.parametrize("report,words", [
    (_chart(type="radar"), "type must be one of line, area, bar, stacked, hbar, pie, donut"),
    (_chart(series=[{"values": [1]}]), "values must have one number for each of the 2 labels"),
    (_chart(series=[{"values": [1, "2"]}]), "values[1] must be a number"),
    (_chart(series=[{"values": [1, True]}]), "values[1] must be a number"),
    (_chart(series=[{"values": [1, None]}]), "values[1] must be a number"),
    (_chart(type="stacked", series=[{"values": [1, -2]}]), "values[1] is below zero"),
    (_chart(type="pie", series=[{"values": [0, 0]}]), "add up to nothing"),
    (_chart(type="pie", series=[{"values": [1, 2]}, {"values": [1, 2]}]), "series has more than 1 entries"),
    (_chart(series=[{"values": [1, 2]}, {"values": [3, 4]}]), "series[0].name must be text"),
    (_chart(type="line", series=[{"values": [None, None]}]), "series has no values"),
    (_chart(series=[{"values": [1, 2], "member_id": 42}]), "member_id is not a member"),
    (_chart(labels=["a"] * 25, series=[{"values": [1] * 25}]), "labels must be 1 to 24 names"),
    (_chart(span="third"), "span must be half"),
    ({"sections": [{"kind": "stats", "tiles": [{"name": "Rain"}]}]}, "tiles[0].value must be text"),
    ({"sections": [{"kind": "stats", "tiles": [{"name": "Rain", "value": "9", "trend": [1]}]}]}, "trend must be 2 to 24 numbers"),
    ({"sections": [{"kind": "stats", "tiles": []}]}, "tiles needs at least 1"),
], ids=["type", "length", "text", "boolean", "gap-in-bars", "negative-part", "empty-whole", "two-wholes", "unnamed", "all-gaps",
        "member", "labels", "span", "tile-value", "trend", "no-tiles"])
def test_a_chart_or_tiles_that_break_the_format_are_refused_with_what_to_fix(report, words):
    from raphael_core.agent.report_page import checked_report
    with pytest.raises(PageError) as refused:
        checked_report(report, exists=lambda member_id: member_id == 0, as_of_ms=1794240000000)
    assert words in str(refused.value)


# The owner's Tokyo list on Grok Bot (2026-11-14): a summary line, a note with an icon, a dropdown over a table whose last column is links.
DOCUMENT = {"summary": "46 spots, 39 restaurants: pick with the filters.", "sections": [
    {"kind": "callout", "tone": "info", "heading": "Note", "text": "Staying in Otsuka. Prices are only what the sources give."},
    {"kind": "table", "title": "Spots", "filter": "Area", "columns": ["Name", "Area", "Price", "Link"],
     "rows": [{"cells": ["Senso-ji", "Asakusa", "-", {"text": "Map", "url": "https://www.google.com/maps/search/?api=1&query=%E6%B7%BA%E8%8D%89%E5%AF%BA"}],
               "group": "Classic"},
              {"cells": ["Skytree", "Oshiage", "NT$ 700", {"text": "Site", "url": "https://www.tokyo-skytree.jp/cn_t/"}], "group": "View"}]},
]}


def test_a_summary_a_callout_link_cells_and_a_filter_are_kept_and_drawn_in_the_plain_rendition():
    from raphael_core.agent.report_page import checked_report, report_fallback, report_html
    kept = checked_report(DOCUMENT, exists=lambda member_id: False, as_of_ms=1794240000000)
    assert kept["summary"] == DOCUMENT["summary"]
    assert kept["sections"][0] == {"kind": "callout", "tone": "info", "heading": "Note", "text": DOCUMENT["sections"][0]["text"]}
    table = kept["sections"][1]
    assert table["filter"] == "Area" and table["rows"][0]["cells"][3] == {"text": "Map", "url": DOCUMENT["sections"][1]["rows"][0]["cells"][3]["url"]}
    html = report_html("Tokyo", kept, lambda member_id: "")
    assert html.startswith("<h1>Tokyo</h1>\n<p>46 spots") and "<p><b>Note</b> Staying in Otsuka" in html
    assert '<td><a href="https://www.tokyo-skytree.jp/cn_t/">Site</a></td>' in html and "&amp;query=" in html
    assert report_fallback("Tokyo", kept).split("\n")[:3] == ["Tokyo", DOCUMENT["summary"], DOCUMENT["sections"][0]["text"]]
    # Without a summary the page keeps saying when its data is from and that it states recorded facts only (R-PAGE-01).
    assert "summary" not in checked_report(REPORT, exists=lambda member_id: member_id == 0, as_of_ms=1794240000000)
    # A callout's tone is info unless the member says warn or ok.
    plain = checked_report({"sections": [{"kind": "callout", "text": "Heads up"}]}, exists=lambda member_id: False, as_of_ms=1794240000000)
    assert plain["sections"][0] == {"kind": "callout", "tone": "info", "text": "Heads up"}


def _table(rows=None, **changes):
    return {"sections": [{"kind": "table", "columns": ["Name", "Area"], "rows": rows or [{"cells": ["a", "x"]}, {"cells": ["b", "y"]}], **changes}]}


def _link(url):
    return _table([{"cells": ["a", {"text": "Map", "url": url}]}])


@pytest.mark.parametrize("report,words", [
    (_link("http://example.com/map"), "cells[1].url must be a plain https link"),
    (_link("javascript:alert(1)"), "cells[1].url must be a plain https link"),
    (_link("https://user:pass@example.com/"), "cells[1].url must be a plain https link"),
    (_link("https:///nowhere"), "cells[1].url must be a plain https link"),
    (_link("https://example.com/a b"), "cells[1].url must be a plain https link"),
    (_link("https://example.com/" + "a" * 2100), "cells[1].url exceeds 2048 characters"),
    (_link("https://api.example.com/v1/Q7x9Lm2Pz8Rt4Kw6Vb3Nc5Jd1Hf0Gs7Ya2Ue/forecast"), "url contains a secret"),
    (_table([{"cells": ["a", {"url": "https://example.com/"}]}]), "cells[1].text must be text"),
    (_table([{"cells": ["a", {"text": "Map"}]}]), "cells[1].url must be an https link"),
    (_table([{"cells": ["a", "x" * 161]}]), "cells[1] exceeds 160 characters"),
    (_table([{"cells": ["a", "x"]}] * 101), "rows has more than 100 entries"),
    (_table(filter="Colour"), "filter must be the name of one column: Name, Area"),
    (_table([{"cells": [f"n{n}", f"area{n}"]} for n in range(25)], filter="Area"), "filter column Area has 25 different values"),
    ({"summary": "x" * 161, "sections": [{"kind": "text", "text": "x"}]}, "report.summary exceeds 160 characters"),
    ({"summary": "the password is hunter2", "sections": [{"kind": "text", "text": "x"}]}, "report.summary contains a secret"),
    ({"sections": [{"kind": "callout", "tone": "danger", "text": "x"}]}, "tone must be one of info, warn, ok"),
    ({"sections": [{"kind": "callout", "tone": "ok"}]}, "text must be text"),
    ({"sections": [{"kind": "callout", "text": "x" * 601}]}, "text exceeds 600 characters"),
], ids=["http", "script", "password", "no-host", "space", "long-link", "key-in-link", "link-no-text", "link-no-url", "long-cell", "rows",
        "filter-unknown", "filter-many", "long-summary", "secret-summary", "tone", "callout-no-text", "long-callout"])
def test_a_link_cell_filter_summary_or_callout_that_breaks_the_format_is_refused_with_what_to_fix(report, words):
    from raphael_core.agent.report_page import checked_report
    with pytest.raises(PageError) as refused:
        checked_report(report, exists=lambda member_id: False, as_of_ms=1794240000000)
    assert words in str(refused.value) and "hunter2" not in str(refused.value)


def test_a_hundred_rows_of_a_hundred_and_sixty_characters_and_every_ordinary_link_are_kept():
    from raphael_core.agent.report_page import checked_report
    rows = [{"cells": [f"Place {n} " + "あ" * 140, {"text": "地圖", "url": f"https://www.google.com/maps/search/?api=1&query=Tokyo+Place+{n}"}]}
            for n in range(100)]
    kept = checked_report({"sections": [{"kind": "table", "columns": ["Name", "Link"], "rows": rows}]},
                          exists=lambda member_id: False, as_of_ms=1794240000000)
    assert len(kept["sections"][0]["rows"]) == 100
    assert kept["sections"][0]["rows"][0]["cells"][0].endswith("あ" * 140) and len(kept["sections"][0]["rows"][0]["cells"][0]) == 148


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


# --- a report shared as a file (report_page.checked_file, pages.export) -------------------------------

FILE_HEAD = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
             f'<meta http-equiv="Content-Security-Policy" content="{FILE_POLICY}">'
             '<meta name="viewport" content="width=device-width, initial-scale=1">')
# What the app's drawing makes (app/src/main/report-page.ts `reportFile`): each kind of section, the team and an icon.
DRAWING = (
    '<header class="rp-head"><h1 class="rp-title">Team report</h1><p class="rp-sub">Data as of 2026/11/10 09:30</p></header>'
    '<nav class="rp-toc" aria-label="Contents"><span class="rp-toc-h">Contents</span><a href="#rp-s0" data-report-goto="rp-s0">Findings</a></nav>'
    '<div class="rp-body"><section class="rp-sec" id="rp-s0" data-kind="findings"><h2 class="rp-h2">Findings</h2>'
    '<div class="rp-callout"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/>'
    '<path d="M12 16v-4"/></svg><p>Two things wait &lt;script&gt;</p></div><ul class="rp-items has-status"><li>'
    '<span class="rp-item-st"><span class="rp-st" data-tone="warn">Ready</span></span><div class="rp-item-t"><b>Timeline</b>'
    '<span>Since Monday</span></div></li></ul></section><section class="rp-sec" id="rp-s1" data-kind="table">'
    '<div class="rp-table-box"><table class="rp-table"><thead><tr><th scope="col">Member</th></tr></thead><tbody>'
    '<tr data-group="g0"><td data-col="Member"><span><span class="rp-dot" style="--rp-c:#1f9fe8"></span>Raphael</span></td>'
    '</tr></tbody></table></div></section><section class="rp-sec" id="rp-s2" data-kind="team">'
    '<div class="rp-team" data-report-team="2" role="img" aria-label="Owner → Raphael: Asks"><div class="rp-team-at" data-at="0">'
    '<div class="rp-team-draw" style="width:300px;height:200px"><svg class="rp-lines" width="300" height="200" viewBox="0 0 300 200" '
    'aria-hidden="true"><defs><marker id="rp-arrow-1" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" '
    'orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 Z"/></marker></defs><path d="M10 10 L10 50" marker-end="url(#rp-arrow-1)"/>'
    '</svg><div class="rp-node" data-node="o" style="left:44px;top:0px;width:212px;--rp-c:var(--text-3)"><b>Owner</b><small>asks</small>'
    '</div><span class="rp-lab" style="left:150px;top:90px">Asks</span></div></div></div><dl class="rp-notes"><div><dt>Gap</dt>'
    '<dd>Nobody</dd></div></dl></section></div>')


def _file(drawing=DRAWING, *, style=":root{--content:#fff}.rp-items > li{padding:0}", head=FILE_HEAD):
    return f'{head}<title>Team report</title><style>{style}</style></head><body><article class="rp-doc">{drawing}</article></body></html>'


async def _shown_report(rig, client):
    client.chats = [chat("", ("show_page", {"title": "Team report", "report": REPORT})), chat('{"text":"Here it is."}')]
    await typed(rig)
    return (await rig.turns())[0]["pages"][0]["id"]


async def test_a_shared_report_is_saved_as_its_file_in_the_output_folder_else_downloads_never_over_a_file(make_rig, client, tmp_path):
    rig = make_rig()
    page = await _shown_report(rig, client)
    downloads = tmp_path / "Downloads"
    saved = await rig.call("pages.export", {"id": page, "html": _file(), "downloads": str(downloads)})
    assert saved == {"path": str(downloads / "Team report.html"), "place": "downloads", "folder": "Downloads"}
    assert (downloads / "Team report.html").read_bytes() == _file().encode("utf-8")
    again = await rig.call("pages.export", {"id": page, "html": _file(), "downloads": str(downloads)})
    assert again["path"] == str(downloads / "Team report (2).html") and len(list(downloads.iterdir())) == 2

    # The owner's output folder first, made if it is gone; one that takes nothing leaves the file in Downloads.
    rig.settings.set("owner_output_folder", str(tmp_path / "Out" / "Reports"))
    chosen = await rig.call("pages.export", {"id": page, "html": _file(), "downloads": str(downloads)})
    assert chosen == {"path": str(tmp_path / "Out" / "Reports" / "Team report.html"), "place": "output", "folder": "Reports"}
    (tmp_path / "taken").write_text("a file, not a folder")
    rig.settings.set("owner_output_folder", str(tmp_path / "taken" / "Reports"))
    fallen = await rig.call("pages.export", {"id": page, "html": _file(), "downloads": str(downloads)})
    assert fallen["place"] == "downloads" and fallen["path"] == str(downloads / "Team report (3).html")


@pytest.mark.parametrize("html", [
    _file(head=FILE_HEAD.replace("default-src 'none'", "default-src *")),
    _file(head=FILE_HEAD.replace('<meta name="viewport" content="width=device-width, initial-scale=1">', "")),
    "<p>Team report</p>",
    _file(DRAWING + "<script>alert(1)</script>"),
    _file(DRAWING + '<div onclick="alert(1)">x</div>'),
    _file(DRAWING + '<svg><path d="M0 0" onload="alert(1)"/></svg>'),
    _file(DRAWING + '<a href="http://example.com/">away</a>'),
    _file(DRAWING + '<a href="javascript:alert(1)">away</a>'),
    _file(DRAWING + '<a href="https://user:pass@example.com/">away</a>'),
    _file(DRAWING + '<a href="https://example.com/" target="_blank">away</a>'),
    _file(DRAWING + '<meta http-equiv="refresh" content="0;url=https://example.com/">'),
    _file(DRAWING + '<img src="https://example.com/x.png">'),
    _file(DRAWING + "<!-- a comment -->"),
    _file(style="</style><script>alert(1)</script><style>"),
    _file(DRAWING + "<style>body{}</style>"),
    _file(DRAWING + "<p>" + "x" * (2 * 1024 * 1024) + "</p>"),
    "",
    None,
], ids=["policy", "no-viewport", "no-head", "script", "handler", "svg-handler", "http-link", "script-link", "password-link", "target",
        "refresh", "image", "comment",
        "style-markup", "two-styles", "too-large", "empty", "missing"])
async def test_a_report_file_where_anything_could_run_or_load_is_refused_and_nothing_written(make_rig, client, tmp_path, html):
    rig = make_rig()
    page = await _shown_report(rig, client)
    with pytest.raises(RpcError) as error:
        await rig.call("pages.export", {"id": page, "html": html, "downloads": str(tmp_path)})
    assert error.value.code == INVALID_PARAMS
    assert list(tmp_path.iterdir()) == []


async def test_a_table_link_goes_into_the_file_as_an_https_link_and_nothing_else_leaves_the_page(make_rig, client, tmp_path):
    rig = make_rig()
    page = await _shown_report(rig, client)
    link = '<a class="rp-link" href="https://www.google.com/maps/search/?api=1&amp;query=%E6%B7%BA%E8%8D%89%E5%AF%BA" rel="noopener noreferrer">地圖</a>'
    saved = await rig.call("pages.export", {"id": page, "html": _file(DRAWING + link), "downloads": str(tmp_path)})
    assert "query=%E6%B7%BA" in (tmp_path / "Team report.html").read_text("utf-8") and saved["place"] == "downloads"


async def test_a_page_the_core_cannot_find_or_a_plugins_page_is_not_saved_as_a_file(make_rig, tmp_path):
    rig = make_rig()
    plugin = stored(rig.conn, source="mcp", server="demo", tool="show")
    with pytest.raises(RpcError) as error:
        await rig.call("pages.export", {"id": plugin["id"], "html": _file(), "downloads": str(tmp_path)})
    assert error.value.data == {"kind": "not_shareable"}
    with pytest.raises(RpcError) as error:
        await rig.call("pages.export", {"id": "missing", "html": _file(), "downloads": str(tmp_path)})
    assert error.value.data == {"kind": "page_gone"}
    assert list(tmp_path.iterdir()) == []


# --- an HTML page shared as a file (pages.page_file, pages.export; R-PAGE-08) ----------------------------

def _page_file(**overrides):
    return page_file({"title": "Product", "html": "<button>Choose</button>", "source": "html", "network": {}, **overrides})


def test_an_html_page_file_is_the_page_without_the_window_helper_under_the_pages_own_policy():
    text = _page_file(html="<h1>Hello</h1><script>document.title = 'x'</script>")
    # The page itself, and the theme words every page has, in both themes.
    assert "<h1>Hello</h1><script>document.title = 'x'</script>" in text and "<title>Product</title>" in text
    assert "--bg:#ffffff" in text and "@media (prefers-color-scheme:dark){:root{--bg:#0a0a0a" in text
    # Nothing that speaks to the window: the helper is not in the file.
    assert "parent.postMessage" not in text and "window.raphael" not in text
    # The page's policy stands first in its head: the same sources, no connection, no form, no frame; no sandbox (a header's).
    head = text.index("<meta http-equiv=\"Content-Security-Policy\"")
    assert head < text.index("<title>") < text.index("<h1>")
    policy = re.search(r'content="([^"]+)"', text[head:])[1].replace("&#x27;", "'")
    assert policy == "; ".join(part for part in page_csp({"source": "html", "network": {}}).split("; ") if not part.startswith("sandbox"))
    for wanted in ("default-src 'none'", "connect-src 'none'", "form-action 'none'", "frame-src 'none'", "base-uri 'none'"):
        assert wanted in policy
    assert "sandbox" not in policy and "https://cdnjs.cloudflare.com" in policy
    assert text.index('<meta charset="utf-8">') < head


async def test_a_shared_html_page_is_saved_from_what_is_stored_never_from_text_the_window_gives(make_rig, tmp_path):
    rig = make_rig()
    page = stored(rig.conn, title="Tokyo: a/b", html="<h1>Tokyo</h1>")
    downloads = tmp_path / "Downloads"
    saved = await rig.call("pages.export", {"id": page["id"], "html": "<script>alert(1)</script>", "downloads": str(downloads)})
    assert saved == {"path": str(downloads / "Tokyo a b.html"), "place": "downloads", "folder": "Downloads"}
    written = (downloads / "Tokyo a b.html").read_text("utf-8")
    assert "<h1>Tokyo</h1>" in written and "alert(1)" not in written and "parent.postMessage" not in written
    # With no `html` at all, as the window sends it for a page, and again: never over another file.
    again = await rig.call("pages.export", {"id": page["id"], "downloads": str(downloads)})
    assert again["path"] == str(downloads / "Tokyo a b (2).html")
    # The owner's output folder first.
    rig.settings.set("owner_output_folder", str(tmp_path / "Out"))
    chosen = await rig.call("pages.export", {"id": page["id"], "downloads": str(downloads)})
    assert chosen == {"path": str(tmp_path / "Out" / "Tokyo a b.html"), "place": "output", "folder": "Out"}


async def test_a_changed_page_is_shared_as_it_is_now_and_a_secret_in_it_still_stops_the_file(make_rig, tmp_path):
    rig = make_rig()
    page = stored(rig.conn, html="<p>first</p>")
    PageStore(rig.conn).update(page["id"], "<p>second</p>")
    saved = await rig.call("pages.export", {"id": page["id"], "downloads": str(tmp_path)})
    assert "<p>second</p>" in Path(saved["path"]).read_text(encoding="utf-8")
    # A page that the scanner would not take is not written as a file either, even if it got into the store.
    rig.conn.execute("UPDATE pages SET html=? WHERE id=?", ("<p>sk-ant-api03-" + "a1B2c3D4" * 8 + "</p>", page["id"]))
    with pytest.raises(RpcError) as error:
        await rig.call("pages.export", {"id": page["id"], "downloads": str(tmp_path)})
    assert error.value.code == INVALID_PARAMS and len(list(tmp_path.iterdir())) == 1


@pytest.mark.parametrize("title,name", [
    ("Team report", "Team report"),
    ('Q4: a/b\\c *now*? "x" <y> | z', "Q4 a b c now x y z"),
    ("週報 · 11/10", "週報 · 11 10"),
    ("Ends with dots...", "Ends with dots"),
    ("CON", "CON_"),
    ("aux.txt", "aux.txt_"),
    ("?:*", "report"),
    ("x" * 90, "x" * 80),
], ids=["plain", "reserved-characters", "chinese", "dots", "device", "device-extension", "nothing-left", "long"])
def test_a_report_file_is_named_after_its_page_as_windows_takes_a_name(title, name):
    assert file_name(title) == name

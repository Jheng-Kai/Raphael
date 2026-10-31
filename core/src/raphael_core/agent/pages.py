"""Durable conversation pages and their ephemeral, isolated loopback host.

The CSP and document preamble handling adapt OpenMausBot (Apache-2.0);
see THIRD_PARTY_NOTICES.md. No page is served from the application's origin.
"""

import asyncio
import html as html_lib
import ipaddress
import json
import re
import secrets
from urllib.parse import parse_qs, urlsplit

from ..clock import wall_clock_ms
from ..memory.scan import find_secret
from ..protocol import NOT_FOUND, RpcError, invalid_params

HTML_BYTES = 256 * 1024
MCP_MIME = "text/html;profile=mcp-app"
CDNS = ("https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net", "https://unpkg.com")


class PageError(Exception):
    """A value-free refusal suitable for a model or an RPC caller."""

    def __init__(self, kind, message):
        super().__init__(message)
        self.kind = kind


def checked_text(value, name, limit, *, required=False):
    if not isinstance(value, str) or (required and not value.strip()):
        raise PageError("bad_arguments", f"{name} must be nonempty text")
    if len(value.encode("utf-8")) > limit:
        raise PageError("too_large", f"{name} exceeds {limit} UTF-8 bytes; shorten it and try again")
    # Decode character references too, so HTML cannot disguise a secret from the existing scanner.
    if find_secret(value) or find_secret(html_lib.unescape(value)):
        raise PageError("secret", f"{name} contains a secret; remove credentials and try again")
    return value


def domains(values):
    """Keep at most sixteen explicit public HTTPS origins; no CSP patterns or local networks."""
    kept = []
    if not isinstance(values, list):
        return kept
    for value in values[:64]:
        if not isinstance(value, str) or len(value) > 300 or re.search(r"[\s*'\";,\\]", value):
            continue
        try:
            url = urlsplit(value)
            host = url.hostname or ""
            if (url.scheme != "https" or url.username is not None or url.password is not None
                    or url.path not in ("", "/") or url.query or url.fragment
                    or not re.fullmatch(r"[a-zA-Z0-9.-]+", host) or "." not in host
                    or host.lower().endswith((".localhost", ".local", ".internal"))):
                continue
            try:
                if not ipaddress.ip_address(host).is_global:
                    continue
            except ValueError:
                pass
            port = url.port
            origin = f"https://{host.lower()}" + (f":{port}" if port and port != 443 else "")
        except ValueError:
            continue
        if origin not in kept:
            kept.append(origin)
        if len(kept) == 16:
            break
    return kept


def page_csp(page):
    network = page["network"]
    resources = network.get("resources", []) if page["source"] == "mcp" else list(CDNS)
    sources = " ".join(resources)
    connect = " ".join(network.get("connect", [])) if page["source"] == "mcp" else ""
    connect_source = connect or "'none'"
    fonts = "" if page["source"] == "mcp" else " https://fonts.gstatic.com"
    styles = "" if page["source"] == "mcp" else " https://fonts.googleapis.com"
    return "; ".join((
        "sandbox allow-scripts allow-forms", "default-src 'none'",
        f"script-src 'unsafe-inline' {sources}".strip(),
        f"style-src 'unsafe-inline' {sources}{styles}".strip(),
        f"font-src data: {sources}{fonts}".strip(), f"img-src data: blob: {sources}".strip(),
        (f"media-src data: blob: {sources}".strip() if page["source"] == "mcp" else "media-src data: blob:"),
        f"connect-src {connect_source}",
        "form-action 'none'", "base-uri 'none'", "frame-src 'none'", "object-src 'none'",
        "worker-src 'none'", "manifest-src 'none'",
    ))


_HELPER = """<script>
(() => {
  const post = (type, data) => parent.postMessage({raphaelPage: 1, type, ...data}, '*');
  window.raphael = Object.freeze({
    send(text) { if (typeof text === 'string' && text.trim() && text.length <= 4000) post('send', {text}); },
    open(url) { try { const u = new URL(url); if (u.protocol === 'https:' && !u.username && !u.password && u.href.length <= 2048) post('open', {url:u.href}); } catch {} }
  });
  addEventListener('DOMContentLoaded', () => {
    let previous = 0;
    const report = () => { const box = document.body.getBoundingClientRect(), style = getComputedStyle(document.body);
      const height = Math.max(80, Math.min(2400, Math.ceil(box.height + parseFloat(style.marginTop) + parseFloat(style.marginBottom))));
      if (height !== previous) { previous = height; post('height', {height}); } };
    new ResizeObserver(report).observe(document.body); report();
  }, {once:true});
})();
</script>"""


def document(page, theme):
    """Prepend host styles/helper to a fragment or a full document, after its preamble."""
    content = page["html"]
    while True:
        before = content
        content = content.lstrip("\ufeff \r\n\t")
        if content.startswith("<!--"):
            end = content.find("-->", 4)
            content = "" if end < 0 else content[end + 3:]
        elif re.match(r"^<[!?]", content):
            end = content.find(">")
            content = "" if end < 0 else content[end + 1:]
        if content == before:
            break
    colors = ("#18181b", "#fafafa", "#a1a1aa", "#3f3f46", "#a78bfa") if theme == "dark" else (
        "#ffffff", "#18181b", "#71717a", "#e4e4e7", "#7c3aed")
    variables = ";".join(f"--{key}:{value}" for key, value in zip(("bg", "fg", "muted", "line", "accent"), colors))
    return ('<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
            f"<title>{html_lib.escape(page['title'])}</title><style>:root{{{variables};color-scheme:{theme}}}"
            "body{background:var(--bg);color:var(--fg);font-family:system-ui,sans-serif}</style>" + _HELPER + content)


class PageStore:
    def __init__(self, conn, now_ms=wall_clock_ms):
        self.conn, self.now_ms = conn, now_ms

    def get(self, page_id):
        row = self.conn.execute("SELECT * FROM pages WHERE id=?", (page_id,)).fetchone()
        if row is None:
            return None
        page = dict(row)
        for key in ("network", "tool_input", "tool_result"):
            page[key] = json.loads(page[key])
        return page

    def write(self, *, turn_id, member_id, conversation_id, title, html, fallback_text="", height=320,
              source="html", server=None, tool=None, tool_input=None, tool_result=None, network=None):
        title = checked_text(title, "title", 320, required=True)
        if len(title) > 80:
            raise PageError("too_large", "title exceeds 80 characters; shorten it and try again")
        html = checked_text(html, "html", HTML_BYTES, required=True)
        fallback_text = checked_text(fallback_text, "fallback_text", 6000)
        if len(fallback_text) > 1500:
            raise PageError("too_large", "fallback_text exceeds 1500 characters")
        if type(height) is not int:
            raise PageError("bad_arguments", "height must be a whole number")
        height = max(80, min(2400, height))
        network = network if isinstance(network, dict) else {}
        network = {"connect": domains(network.get("connectDomains", [])),
                   "resources": domains(network.get("resourceDomains", []))}
        inputs, result = json.dumps(tool_input or {}, ensure_ascii=False), json.dumps(tool_result or {}, ensure_ascii=False)
        checked_text(inputs, "tool_input", 64 * 1024)
        checked_text(result, "tool_result", 256 * 1024)
        # The turn is authoritative; tools cannot attach a page to someone else's conversation.
        turn = self.conn.execute("SELECT member_id, conversation_id FROM agent_turns WHERE id=?", (turn_id,)).fetchone()
        if turn is None or turn["member_id"] != member_id or turn["conversation_id"] != conversation_id:
            raise PageError("gone", "The page's conversation is gone")
        page_id, now = secrets.token_urlsafe(24), self.now_ms()
        with self.conn:
            self.conn.execute(
                "INSERT INTO pages (id, turn_id, member_id, conversation_id, title, html, fallback, height, rev, source,"
                " server, tool, tool_input, tool_result, network, created_at_ms, updated_at_ms)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)",
                (page_id, turn_id, member_id, conversation_id, title, html, fallback_text, height, source, server, tool,
                 inputs, result, json.dumps(network), now, now))
            self._revision(page_id)
        return self.get(page_id)

    def update(self, page_id, html, title=None):
        page = self.get(page_id)
        if page is None:
            raise PageError("gone", "The page is gone; use show_page to create another")
        html = checked_text(html, "html", HTML_BYTES, required=True)
        title = page["title"] if title is None else checked_text(title, "title", 320, required=True)
        if len(title) > 80:
            raise PageError("too_large", "title exceeds 80 characters; shorten it and try again")
        with self.conn:
            self.conn.execute("UPDATE pages SET html=?, title=?, rev=rev+1, updated_at_ms=? WHERE id=?",
                              (html, title, self.now_ms(), page_id))
            self._revision(page_id)
        return self.get(page_id)

    def _revision(self, page_id):
        self.conn.execute("INSERT INTO page_revisions (page_id, rev, title, html, at_ms)"
                          " SELECT id, rev, title, html, updated_at_ms FROM pages WHERE id=?", (page_id,))
        self.conn.execute("DELETE FROM page_revisions WHERE page_id=? AND rev <="
                          " (SELECT rev-10 FROM pages WHERE id=?)", (page_id, page_id))

    def shown_in(self, turn_ids):
        found = {}
        ids = list(dict.fromkeys(turn_ids))
        for start in range(0, len(ids), 500):
            chunk = ids[start:start + 500]
            for row in self.conn.execute(f"SELECT id, turn_id FROM pages WHERE turn_id IN ({','.join('?' for _ in chunk)})"
                                         " ORDER BY created_at_ms, rowid", chunk):
                found.setdefault(row["turn_id"], []).append(card(self.get(row["id"])))
        return found


def card(page):
    return {key: page[key] for key in ("id", "title", "rev", "height", "source", "server", "fallback")}


class PageHost:
    """One host per core; bearer tokens exist only in memory and are never page ids."""

    def __init__(self, store):
        self.store, self.server = store, None
        self.tokens = {}
        self.lock = asyncio.Lock()
        self.clients = set()

    async def url(self, page_id, theme):
        async with self.lock:
            if self.server is None:
                self.server = await asyncio.start_server(self._serve, "127.0.0.1", 0, limit=8192)
            token = self.tokens.setdefault(page_id, secrets.token_urlsafe(32))
            port = self.server.sockets[0].getsockname()[1]
        return f"http://127.0.0.1:{port}/p/{token}?theme={theme}"

    async def aclose(self):
        async with self.lock:
            if self.server is not None:
                self.server.close()
                await self.server.wait_closed()
                self.server = None
            self.tokens.clear()
        for writer in list(self.clients):
            writer.close()

    async def _serve(self, reader, writer):
        self.clients.add(writer)
        try:
            async with asyncio.timeout(5):
                request = (await reader.readuntil(b"\r\n\r\n")).decode("ascii")
                lines = request.split("\r\n")
                method, target, version = lines[0].split(" ")
                headers = [line.split(":", 1) for line in lines[1:] if line]
                hosts = [value.strip() for name, value in headers if name.lower() == "host"]
                port = writer.get_extra_info("sockname")[1]
                status, body, csp = 404, b"Not found", "default-src 'none'; sandbox"
                if hosts != [f"127.0.0.1:{port}"]:
                    status, body = 403, b"Forbidden"
                elif method == "GET" and version in ("HTTP/1.0", "HTTP/1.1"):
                    url = urlsplit(target)
                    token = url.path.removeprefix("/p/") if url.path.startswith("/p/") else ""
                    page_id = next((key for key, value in self.tokens.items() if secrets.compare_digest(value, token)), None)
                    page = self.store.get(page_id) if page_id else None
                    if page is not None and not url.scheme and not url.netloc:
                        theme = parse_qs(url.query).get("theme", ["light"])[0]
                        theme = "dark" if theme == "dark" else "light"
                        status, body, csp = 200, document(page, theme).encode("utf-8"), page_csp(page)
                response = (f"HTTP/1.1 {status} { {200:'OK', 403:'Forbidden', 404:'Not Found'}[status]}\r\n"
                            "Content-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\n"
                            "Referrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\n"
                            f"Content-Security-Policy: {csp}\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n")
                writer.write(response.encode("ascii") + body)
                await writer.drain()
        except (TimeoutError, ValueError, UnicodeError, ConnectionError, asyncio.IncompleteReadError, asyncio.LimitOverrunError):
            pass
        finally:
            self.clients.discard(writer)
            writer.close()
            try:
                await writer.wait_closed()
            except ConnectionError:
                pass


class Pages:
    def __init__(self, conn, *, notify=None, now_ms=wall_clock_ms):
        self.store = PageStore(conn, now_ms)
        self.host = PageHost(self.store)
        self.notify, self.tool_call = notify, None

    def register(self, router):
        router.register("pages.open", self.open)
        router.register("pages.tool_call", self.call)

    def changed(self, page):
        if self.notify is not None:
            self.notify("agent.turn", {"turn_id": page["turn_id"], "member_id": page["member_id"]})

    def of(self, params):
        page_id = params.get("id")
        page = self.store.get(page_id) if isinstance(page_id, str) else None
        if page is None:
            raise RpcError(NOT_FOUND, "The page is gone", {"kind": "page_gone"})
        return page

    async def open(self, params):
        page = self.of(params)
        theme = params.get("theme", "light")
        if theme not in ("dark", "light"):
            raise invalid_params("theme must be dark or light")
        result = card(page)
        result.pop("fallback")
        result.pop("id")
        result["url"] = await self.host.url(page["id"], theme)
        if page["source"] == "mcp":
            result.update(tool_input=page["tool_input"], tool_result=page["tool_result"], tool=page["tool"])
        return result

    async def call(self, params):
        page = self.of(params)
        if page["source"] != "mcp" or self.tool_call is None:
            raise RpcError(NOT_FOUND, "This page has no plugin server", {"kind": "not_mcp"})
        return await self.tool_call(page, params)

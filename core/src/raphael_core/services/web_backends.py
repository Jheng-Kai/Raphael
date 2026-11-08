"""Explicit web routes with bounded provider protocols.

Adapted from NousResearch/hermes-agent (MIT); see core/packaging/licenses.

Public routes have separate ids; an authentication or quota failure never changes
the route. Calls use web's shared throttle, response bound and turn deadline.
"""

import json
import re
from html.parser import HTMLParser
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

from .backend_http import need_key
from .common import ServiceError

MCP_URLS = {"exa-free": "https://mcp.exa.ai/mcp", "parallel-free": "https://search.parallel.ai/mcp"}
MCP_SESSION_ID = uuid4().hex


async def _mcp(service, tool, arguments, call):
    raw = await call("POST", MCP_URLS[service], json={"jsonrpc": "2.0", "id": 1,
        "method": "tools/call", "params": {"name": tool, "arguments": arguments}},
        headers={"Accept": "application/json, text/event-stream", "User-Agent": "Raphael"}, response_mode="text")
    try:
        if raw.lstrip().startswith("{"):
            envelope = json.loads(raw)
        else:
            envelopes = [json.loads(line[5:].strip()) for line in raw.splitlines() if line.startswith("data:") and line[5:].strip() != "[DONE]"]
            envelope = next(row for row in envelopes if row.get("id") == 1)
        result = envelope["result"]
        if envelope.get("error") or result.get("isError"):
            raise ValueError
        text = "\n".join(part["text"] for part in result["content"] if part.get("type") == "text")
        if not text.strip():
            raise ValueError
        return text
    except (ValueError, KeyError, TypeError, StopIteration):
        raise ServiceError("bad_response", service=service) from None


def _object(value, service):
    if not isinstance(value, dict) or value.get("error") or value.get("success") is False:
        raise ServiceError("bad_response", service=service)
    return value


def _json_text(text, service):
    try:
        return _object(json.loads(text), service)
    except ValueError:
        raise ServiceError("bad_response", service=service) from None


class _DuckResults(HTMLParser):
    def __init__(self):
        super().__init__()
        self.items, self.current, self.field = [], None, ""

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get("class", "").split()
        if tag == "a" and "result__a" in classes:
            url = attrs.get("href", "")
            if "duckduckgo.com/l/" in url or url.startswith("/l/"):
                url = parse_qs(urlsplit(url).query).get("uddg", [""])[0]
            self.current = {"url": url, "title": "", "snippet": ""}
            self.items.append(self.current)
            self.field = "title"
        elif "result__snippet" in classes:
            self.field = "snippet"

    def handle_data(self, data):
        if self.current is not None and self.field:
            self.current[self.field] += data

    def handle_endtag(self, tag):
        if tag in ("a", "td", "div"):
            self.field = ""


def _firecrawl_base(address):
    from .fetch import checked_url
    if not address:
        raise ServiceError("not_configured", service="firecrawl-selfhosted")
    parsed = checked_url(address)
    if parsed.query or parsed.fragment:
        raise ServiceError("bad_url", service="firecrawl-selfhosted")
    return str(parsed).rstrip("/")


async def search(service, query, *, key, call, firecrawl_url=""):
    from .web import _results, _plain, SNIPPET_CHARS
    answer = None
    if service == "ddgs":
        raw = await call("POST", "https://html.duckduckgo.com/html/", data={"q": query}, response_mode="text")
        parser = _DuckResults()
        parser.feed(raw)
        if not parser.items and ("anomaly" in raw or "challenge" in raw.lower()):
            raise ServiceError("rate_limit", service=service)
        if not parser.items and "no results" not in raw.lower() and "no-results" not in raw.lower():
            raise ServiceError("bad_response", service=service)
        items = parser.items
    elif service in MCP_URLS:
        exa = service == "exa-free"
        text = await _mcp(service, "web_search_exa" if exa else "web_search",
            {"query": query, "numResults": 5} if exa else {"objective": query, "search_queries": [query], "session_id": MCP_SESSION_ID}, call)
        if exa:
            items = []
            for block in re.split(r"\n---+\n|(?=^Title:)", text, flags=re.MULTILINE):
                url = re.search(r"^URL:\s*(.+)$", block, re.MULTILINE)
                title = re.search(r"^Title:\s*(.+)$", block, re.MULTILINE)
                if url:
                    items.append({"url": url[1].strip(), "title": title[1] if title else "", "snippet": block.split("Highlights:", 1)[-1]})
            if not items:
                raise ServiceError("bad_response", service=service)
        else:
            items = _json_text(text, service).get("results")
    elif service in ("keenable", "keenable-free"):
        headers = {"X-Keenable-Title": "Raphael"}
        if service == "keenable":
            headers["Authorization"] = f"Bearer {need_key(service, key)}"
        body = _object(await call("POST", "https://api.keenable.ai/v1/search" + ("/public" if service.endswith("-free") else ""),
            headers=headers, json={"query": query, "max_results": 5}), service)
        items = body.get("results")
    elif service in ("tavily-free", "firecrawl", "firecrawl-free", "firecrawl-selfhosted", "parallel", "perplexity"):
        headers = {}
        if not service.endswith("-free") and service != "firecrawl-selfhosted":
            headers = {("x-api-key" if service == "parallel" else "Authorization"): need_key(service, key) if service == "parallel" else f"Bearer {need_key(service, key)}"}
        if service == "tavily-free":
            url, payload = "https://api.tavily.com/search", {"query": query, "max_results": 5, "include_answer": True}
        elif service.startswith("firecrawl"):
            base = _firecrawl_base(firecrawl_url) if service == "firecrawl-selfhosted" else "https://api.firecrawl.dev"
            url, payload = base + "/v2/search", {"query": query, "limit": 5}
            if service == "firecrawl-selfhosted" and key:
                headers["Authorization"] = f"Bearer {key}"
        elif service == "parallel":
            url, payload = "https://api.parallel.ai/v1/search", {"objective": query, "search_queries": [query]}
        else:
            url, payload = "https://api.perplexity.ai/search", {"query": query, "max_results": 5, "search_context_size": "low"}
        body = _object(await call("POST", url, headers=headers, json=payload), service)
        items = body.get("results", body.get("data"))
        if isinstance(items, dict):
            items = items.get("web")
        answer = body.get("answer")
    elif service == "xai":
        return await x_search(query, key=key, call=call, web=True)
    else:
        raise ServiceError("not_configured", service=service)
    if not isinstance(items, list):
        raise ServiceError("bad_response", service=service)
    results = _results(items, "title", "url", lambda row: row.get("snippet") or row.get("content") or row.get("description") or " ".join(s for s in row.get("excerpts", []) if isinstance(s, str)))
    found = {"results": results, "sources": [{"title": r["title"], "url": r["url"]} for r in results]}
    if isinstance(answer, str) and answer.strip():
        found["answer"] = _plain(answer, SNIPPET_CHARS * 2)
    return found


async def read(service, address, *, key, call, firecrawl_url=""):
    from .web import _page
    if service in MCP_URLS:
        text = await _mcp(service, "web_fetch_exa" if service == "exa-free" else "web_fetch",
            {"urls": [address]} if service == "exa-free" else {"urls": [address], "objective": "Full page content", "session_id": MCP_SESSION_ID}, call)
        if service == "exa-free":
            return _page("", text)
        body = _json_text(text, service)
    elif service in ("keenable", "keenable-free"):
        headers = {"X-Keenable-Title": "Raphael"}
        if service == "keenable":
            headers["Authorization"] = f"Bearer {need_key(service, key)}"
        body = _object(await call("GET", "https://api.keenable.ai/v1/fetch" + ("/public" if service.endswith("-free") else ""), params={"url": address}, headers=headers), service)
        return _page(body.get("title"), body.get("content"))
    elif service in ("firecrawl-free", "firecrawl-selfhosted"):
        base = _firecrawl_base(firecrawl_url) if service == "firecrawl-selfhosted" else "https://api.firecrawl.dev"
        headers = {"Authorization": f"Bearer {key}"} if service == "firecrawl-selfhosted" and key else {}
        body = _object(await call("POST", base + "/v2/scrape", json={"url": address, "formats": ["markdown"]}, headers=headers), service)
        data = _object(body.get("data"), service)
        return _page((data.get("metadata") or {}).get("title"), data.get("markdown"))
    elif service in ("exa", "parallel", "tavily-free", "perplexity"):
        if service == "exa":
            url, payload, headers = "https://api.exa.ai/contents", {"ids": [address], "text": True}, {"x-api-key": need_key(service, key)}
        elif service == "parallel":
            url, payload, headers = "https://api.parallel.ai/v1/extract", {"urls": [address], "objective": "Full page content"}, {"x-api-key": need_key(service, key)}
        elif service == "tavily-free":
            url, payload, headers = "https://api.tavily.com/extract", {"urls": [address], "include_images": False}, {}
        else:
            url, payload, headers = "https://api.perplexity.ai/sdk/content/snippets", {"query": address, "urls": [address], "max_tokens": 8000, "max_tokens_per_page": 8000}, {"Authorization": f"Bearer {need_key(service, key)}"}
        body = _object(await call("POST", url, json=payload, headers=headers), service)
    else:
        raise ServiceError("not_configured", service=service)
    items = body.get("results")
    if not isinstance(items, list) or not items:
        raise ServiceError("not_found", service=service)
    item = next((row for row in items if isinstance(row, dict) and row.get("url") == address), None)
    if item is None:
        raise ServiceError("not_found", service=service)
    item = _object(item, service)
    return _page(item.get("title"), item.get("full_content") or item.get("text") or item.get("raw_content") or item.get("content") or item.get("snippet") or "\n\n".join(s for s in item.get("excerpts", []) if isinstance(s, str)))


async def x_search(query, *, key, call, web=False, model=""):
    """One explicitly selected xAI Responses search, including bounded citations."""
    from .web import _results, _plain
    data = _object(await call("POST", "https://api.x.ai/v1/responses", headers={"Authorization": f"Bearer {need_key('xai', key)}"},
        json={"model": model or ("grok-build-0.1" if web else "grok-4.5"), "input": query, "tools": [{"type": "web_search" if web else "x_search"}]}), "xai")
    texts, sources = [], []
    for row in data.get("output", []):
        if not isinstance(row, dict):
            continue
        for part in row.get("content", []):
            if not isinstance(part, dict):
                continue
            if isinstance(part.get("text"), str):
                texts.append(part["text"])
            for annotation in part.get("annotations", []):
                if isinstance(annotation, dict) and annotation.get("type") == "url_citation":
                    sources.append({"title": annotation.get("title", ""), "url": annotation.get("url"), "snippet": ""})
    if not texts:
        raise ServiceError("bad_response", service="xai")
    results = _results(sources, "title", "url", lambda row: "")
    return {"answer": _plain("\n".join(texts), 800), "results": results, "sources": [{"title": r["title"], "url": r["url"]} for r in results]}

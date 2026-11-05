"""The web: a search, and the reading of a page, each by the service the owner chose.

A search (`search`) is the `web_search_service` setting's: Brave, Tavily, Exa or the owner's own
SearXNG. ("openrouter", the default, is not one of these: it is the answer model with OpenRouter's
`web` plugin, which `agent.tools.Tools.web_search` calls as it always did.) It gives back

    {results: [{title, url, snippet}], sources: [{title, url}], answer?: str}

at most SEARCH_RESULTS results, each snippet at most SNIPPET_CHARS; `answer` is Tavily's own short
answer, when it gives one. The answer model words Raphael's answer from them.

Reading a page (`read`) is the `web_read_service` setting's: "builtin" fetches it from this
computer (`fetch.PageFetcher`, which goes only to public addresses) and turns its HTML into text
here (`html.html_to_text`), at no cost; a PDF it is led to is read as a PDF (`pdf`); Jina, Firecrawl
and Tavily read it on their own servers. It gives back `{title, text, truncated}`, the text held to
PAGE_BUDGET (`common.fit`): a task is shown as much of it as its model's window can hold.

The services' own addresses and the shapes of their answers are theirs (as of 2026-10); a key is
sent the way each documents, in a header. What comes back is untrusted: it is data for the model,
which is told never to follow what it says. A failure is a `ServiceError` of a kind, never with a
message. Nothing here logs a query, an address, a key or a result.
"""

import asyncio
import math
import re
import time
from collections.abc import Awaitable, Callable
from email.utils import parsedate_to_datetime
from typing import Any
from weakref import WeakKeyDictionary

import httpx

from .attachments import PDF_TYPE, checked
from .common import ServiceError, fit
from .fetch import PageFetcher, checked_url, decoded
from .html import html_to_text

SEARCH_RESULTS = 5
SNIPPET_CHARS = 400
TITLE_CHARS = 200
PAGE_BUDGET = 50_000
# A service's answer may take this long, each stage of the request.
SERVICE_TIMEOUT_S = 12.0
# Include the queue and retries in the existing tool budget. Brave's one request per
# second needs a little margin; use that conservative pace for each search service.
SEARCH_TIMEOUT_S = 12.0
SEARCH_INTERVAL_S = 1.1
SEARCH_ATTEMPTS = 2
SEARCH_RETRY_WAIT_S = 8.0
# The services that read a page for Raphael may take longer: they fetch it first.
READ_TIMEOUT_S = 25.0

BRAVE_URL = "https://api.search.brave.com/res/v1/web/search"
TAVILY_SEARCH_URL = "https://api.tavily.com/search"
TAVILY_EXTRACT_URL = "https://api.tavily.com/extract"
EXA_URL = "https://api.exa.ai/search"
JINA_URL = "https://r.jina.ai/"
FIRECRAWL_URL = "https://api.firecrawl.dev/v2/scrape"

_TAGS = re.compile(r"<[^>]{0,200}>")

# A PDF's bytes -> its `{pages, text, truncated}` (`pdf.read_pdf`, text layer only).
PdfReader = Callable[[Any], Awaitable[dict]]


class _SearchGate:
    def __init__(self):
        self.lock = asyncio.Lock()
        self.next_at = 0.0


# The core's event loop shares these across hubs, members and turns. Weak keys keep
# a closed embedded/test loop's locks from being reused by a different loop.
_SEARCH_GATES: WeakKeyDictionary = WeakKeyDictionary()


def _retry_after(value: str | None) -> float:
    try:
        delay = float(value)
    except (TypeError, ValueError):
        try:
            delay = parsedate_to_datetime(value).timestamp() - time.time()
        except (TypeError, ValueError, OverflowError):
            return SEARCH_INTERVAL_S
    return max(0.0, delay) if math.isfinite(delay) else SEARCH_INTERVAL_S


class _RateLimited(ServiceError):
    def __init__(self, retry_after: str | None):
        super().__init__("rate_limit")
        self.delay = _retry_after(retry_after)


async def _search_call(service: str, http: httpx.AsyncClient, method: str, url: str, *, deadline: float, **kwargs: Any) -> Any:
    loop = asyncio.get_running_loop()
    gates = _SEARCH_GATES.setdefault(loop, {})
    gate = gates.setdefault(service, _SearchGate())
    async with gate.lock:
        for attempt in range(SEARCH_ATTEMPTS):
            now = loop.time()
            wait_s = max(0.0, gate.next_at - now)
            budget = min(SEARCH_RETRY_WAIT_S, max(0.0, deadline - now - .01))
            wait_until = now + min(wait_s, budget)
            # Event-loop timers can wake early on Windows; keep the provider's deadline.
            while (remaining := wait_until - loop.time()) > 0:
                await asyncio.sleep(remaining)
            # A cooldown equal to the budget must not read as longer: on Windows the clock ticks every
            # ~15 ms, so (t + wait) - t can exceed wait by a rounding error and skip a due retry.
            if wait_s - budget > 1e-6:
                # Do not send before the provider's cooldown, even when it exceeds this turn's budget.
                raise _RateLimited(str(wait_s - budget))
            gate.next_at = loop.time() + SEARCH_INTERVAL_S
            try:
                return await _call(http, method, url, **kwargs)
            except _RateLimited as error:
                gate.next_at = max(gate.next_at, loop.time() + error.delay)
                if attempt == SEARCH_ATTEMPTS - 1:
                    raise


def _plain(value: Any, limit: int) -> str:
    """A text of a service's answer as one line of plain words, at most `limit` characters: the
    tags some services put round the words searched for are taken out."""
    if not isinstance(value, str):
        return ""
    words = " ".join(_TAGS.sub("", value).split())
    return words if len(words) <= limit else words[: limit - 1].rstrip() + "…"


def _results(items: Any, title: str, url: str, snippet: Callable[[dict], Any]) -> list[dict]:
    """The results of a service's list `items`, read with its names for the title and the address
    and its way to the snippet: those with an http(s) address, each address once."""
    found: list[dict] = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        address = item.get(url)
        if not isinstance(address, str) or not address.lower().startswith(("http://", "https://")):
            continue
        if any(result["url"] == address for result in found):
            continue
        found.append(
            {
                "title": _plain(item.get(title), TITLE_CHARS),
                "url": address,
                "snippet": _plain(snippet(item), SNIPPET_CHARS),
            }
        )
        if len(found) == SEARCH_RESULTS:
            break
    return found


def _status_error(status: int) -> ServiceError:
    if status in (401, 403):
        return ServiceError("auth")
    if status == 402:
        return ServiceError("credits")
    if status == 429:
        return ServiceError("rate_limit")
    return ServiceError("http_error")


async def _call(
    http: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    timeout_s: float = SERVICE_TIMEOUT_S,
    **kwargs: Any,
) -> Any:
    """One request to a service: its JSON, or ServiceError of the kind of the failure."""
    try:
        response = await http.request(method, url, timeout=timeout_s, **kwargs)
    except httpx.TimeoutException:
        raise ServiceError("timeout") from None
    except (httpx.TransportError, httpx.DecodingError):
        raise ServiceError("network") from None
    if response.status_code == 429:
        raise _RateLimited(response.headers.get("Retry-After"))
    if not response.is_success:
        raise _status_error(response.status_code)
    try:
        return response.json()
    except ValueError:
        raise ServiceError("bad_response") from None


def _need(key: str | None) -> str:
    if not key:
        raise ServiceError("missing_secret")
    return key


# --- the search -----------------------------------------------------------------------------------


async def search(
    service: str,
    query: str,
    *,
    http: httpx.AsyncClient,
    key: str | None = None,
    searxng_url: str = "",
) -> dict:
    """What `service` finds for `query` (see the module). ServiceError of a kind."""
    deadline = asyncio.get_running_loop().time() + SEARCH_TIMEOUT_S
    try:
        async with asyncio.timeout_at(deadline):
            return await _search(service, query, http=http, key=key, searxng_url=searxng_url, deadline=deadline)
    except TimeoutError:
        raise ServiceError("timeout") from None


async def _search(service: str, query: str, *, http: httpx.AsyncClient, key: str | None, searxng_url: str, deadline: float) -> dict:
    if service == "brave":
        body = await _search_call(
            service, http, "GET", BRAVE_URL, deadline=deadline,
            params={"q": query, "count": SEARCH_RESULTS},
            headers={"X-Subscription-Token": _need(key), "Accept": "application/json"},
        )  # fmt: skip
        web = body.get("web") if isinstance(body, dict) else None
        items = web.get("results") if isinstance(web, dict) else None
        results = _results(items, "title", "url", lambda item: item.get("description"))
        answer = None
    elif service == "tavily":
        body = await _search_call(
            service, http, "POST", TAVILY_SEARCH_URL, deadline=deadline,
            json={"query": query, "max_results": SEARCH_RESULTS, "include_answer": True},
            headers={"Authorization": f"Bearer {_need(key)}"},
        )  # fmt: skip
        items = body.get("results") if isinstance(body, dict) else None
        results = _results(items, "title", "url", lambda item: item.get("content"))
        answer = body.get("answer") if isinstance(body, dict) else None
    elif service == "exa":
        body = await _search_call(
            service, http, "POST", EXA_URL, deadline=deadline,
            json={
                "query": query,
                "numResults": SEARCH_RESULTS,
                "contents": {"text": {"maxCharacters": SNIPPET_CHARS}},
            },
            headers={"x-api-key": _need(key)},
        )  # fmt: skip
        items = body.get("results") if isinstance(body, dict) else None

        def exa_snippet(item: dict) -> Any:
            highlights = item.get("highlights")
            if isinstance(highlights, list) and highlights:
                return " ".join(h for h in highlights if isinstance(h, str))
            return item.get("text")

        results = _results(items, "title", "url", exa_snippet)
        answer = None
    elif service == "searxng":
        if not searxng_url:
            raise ServiceError("not_configured")
        base = searxng_url.rstrip("/")
        body = await _search_call(service, http, "GET", f"{base}/search", deadline=deadline, params={"q": query, "format": "json"})
        items = body.get("results") if isinstance(body, dict) else None
        results = _results(items, "title", "url", lambda item: item.get("content"))
        answer = None
    else:
        raise ServiceError("not_configured")
    if not isinstance(body, dict):
        raise ServiceError("bad_response")
    found: dict[str, Any] = {
        "results": results,
        "sources": [{"title": r["title"], "url": r["url"]} for r in results],
    }
    if isinstance(answer, str) and answer.strip():
        found["answer"] = _plain(answer, SNIPPET_CHARS * 2)
    return found


# --- reading a page -------------------------------------------------------------------------------


def needs_rendered_read(page):
    text = page.get("text", "")
    lower = text.lower()
    return len(text.strip()) < 600 or any(marker in lower for marker in (
        "enable javascript", "javascript is required", "accept all cookies", "reject all cookies",
        "consent preferences", "before you continue", "同意 cookie", "接受所有 cookie", "すべての cookie"))


def _page(title: Any, text: Any) -> dict:
    if not isinstance(text, str) or not text.strip():
        raise ServiceError("bad_response")
    kept, cut = fit(text.strip(), PAGE_BUDGET)
    return {"title": _plain(title, TITLE_CHARS), "text": kept, "truncated": cut}


async def read(
    service: str,
    url: str,
    *,
    http: httpx.AsyncClient,
    fetcher: PageFetcher,
    read_pdf: PdfReader,
    key: str | None = None,
) -> dict:
    """The page at `url`, read by `service` (see the module). ServiceError of a kind; an address
    that is not http or https with a host is "bad_url" whoever reads it."""
    address = str(checked_url(url))
    if service == "builtin":
        fetched = await fetcher.fetch(address)
        if fetched.content_type == PDF_TYPE:
            try:
                document = checked("page.pdf", PDF_TYPE, fetched.body)
            except ValueError:
                raise ServiceError("bad_pdf") from None
            found = await read_pdf(document)
            return {"title": "", "text": found["text"], "truncated": found["truncated"]}
        text = decoded(fetched)
        if fetched.content_type == "text/html":
            title, text = html_to_text(text)
        else:
            title = ""
        return _page(title, text)
    if service == "jina":
        headers = {"Accept": "application/json"}
        if key:
            headers["Authorization"] = f"Bearer {key}"
        body = await _call(http, "GET", JINA_URL + address, headers=headers, timeout_s=READ_TIMEOUT_S)
        data = body.get("data") if isinstance(body, dict) else None
        if not isinstance(data, dict):
            raise ServiceError("bad_response")
        return _page(data.get("title"), data.get("content"))
    if service == "firecrawl":
        body = await _call(
            http, "POST", FIRECRAWL_URL,
            json={"url": address, "formats": ["markdown"], "onlyMainContent": True},
            headers={"Authorization": f"Bearer {_need(key)}"},
            timeout_s=READ_TIMEOUT_S,
        )  # fmt: skip
        data = body.get("data") if isinstance(body, dict) else None
        if not isinstance(data, dict):
            raise ServiceError("bad_response")
        metadata = data.get("metadata")
        title = metadata.get("title") if isinstance(metadata, dict) else None
        return _page(title, data.get("markdown"))
    if service == "tavily":
        body = await _call(
            http, "POST", TAVILY_EXTRACT_URL,
            json={"urls": [address]},
            headers={"Authorization": f"Bearer {_need(key)}"},
            timeout_s=READ_TIMEOUT_S,
        )  # fmt: skip
        items = body.get("results") if isinstance(body, dict) else None
        first = items[0] if isinstance(items, list) and items else None
        if not isinstance(first, dict):
            raise ServiceError("not_found")
        return _page(first.get("title"), first.get("raw_content"))
    raise ServiceError("not_configured")

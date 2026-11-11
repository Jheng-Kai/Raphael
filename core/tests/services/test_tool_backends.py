"""Every new service is visible without credentials and uses only its own route."""

import asyncio
import base64
import io
import json
import sys
import wave
from types import SimpleNamespace

import httpx
import pytest

from raphael_core.services import backends, browser_sessions, web
from raphael_core.services.attachment_store import AttachmentStore
from raphael_core.services.common import ServiceError
from raphael_core.services.generation import Generation
from raphael_core.services.hub import ServiceHub
from raphael_core.services.keys import KEYED_SERVICES, memory_keys
from raphael_core.services.speech_backends import STT_IDS, transcribe

KEY = "fake-service-secret"
URL = "https://example.com/article"
PNG = b"\x89PNG\r\n\x1a\n" + bytes(16)
VIDEO = b"\x00\x00\x00\x18ftypmp42" + bytes(16)


def wav():
    out = io.BytesIO()
    with wave.open(out, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(24000)
        audio.writeframes(bytes(480))
    return out.getvalue()


async def test_extended_rpc_is_opt_in_and_never_hides_unconfigured_backends(conn):
    from raphael_core.router import Router
    hub = ServiceHub(conn, object(), memory_keys())
    rpc = Router()
    hub.register(rpc)
    status = await rpc.call("services.status", {"include_backends": True})
    assert status["backend_schema"] == 1
    for category, rows in backends.GROUPS.items():
        for row in rows:
            view = next(item for item in status[category]["options"] if item["id"] == row.id)
            assert view["name"] == row.name
            assert view["description_id"] == f"tool_backend.{category}.{row.id}"
            assert view["has_key"] is False
            assert view["needs_key"] is (bool(row.key_service) and not row.key_optional)
            assert view["integration"] == ("ready" if row.integration == "settings_required" and view["selection_supported"] else row.integration)
    for service in KEYED_SERVICES:
        assert await rpc.call("services.set_key", {"service": service, "key": KEY}) == {"ok": True}
    encoded = json.dumps(await rpc.call("services.status", {"include_backends": True}))
    assert KEY not in encoded
    for service in KEYED_SERVICES:
        assert await rpc.call("services.clear_key", {"service": service}) == {"ok": True}
    await hub.aclose()


SEARCH_IDS = [r.id for r in backends.SEARCH if r.integration != "oauth_required" and r.id != "firecrawl-selfhosted"]
READ_IDS = [r.id for r in backends.READ if r.id != "firecrawl-selfhosted" and r.integration != "oauth_required"]


def web_reply(service, request, reading=False):
    body = json.loads(request.content) if request.content and "json" in request.headers.get("content-type", "") else {}
    item = {"title": "Article", "url": URL, "snippet": "Words", "content": "Words", "text": "Words", "full_content": "Words", "excerpts": ["Words"]}
    if service == "ddgs":
        assert request.url.host == "html.duckduckgo.com" and b"q=needle" in request.content
        return httpx.Response(200, text=f'<a class="result__a" href="{URL}">Article</a><a class="result__snippet">Words</a>')
    if service in ("exa-free", "parallel-free"):
        assert request.url.host == ("mcp.exa.ai" if service == "exa-free" else "search.parallel.ai")
        assert body["method"] == "tools/call"
        expected = ("web_fetch_exa" if reading else "web_search_exa") if service == "exa-free" else ("web_fetch" if reading else "web_search")
        assert body["params"]["name"] == expected
        if service == "exa-free":
            text = "# Article\nWords" if reading else f"Title: Article\nURL: {URL}\nHighlights:\nWords"
        else:
            text = json.dumps({"results": [item]})
        envelope = {"jsonrpc": "2.0", "id": 1, "result": {"content": [{"type": "text", "text": text}]}}
        return httpx.Response(200, text="event: message\ndata: " + json.dumps(envelope) + "\n\n", headers={"content-type": "text/event-stream"})
    hosts = {"keenable": "api.keenable.ai", "tavily": "api.tavily.com", "firecrawl": "api.firecrawl.dev", "parallel": "api.parallel.ai", "perplexity": "api.perplexity.ai", "exa": "api.exa.ai", "xai": "api.x.ai"}
    base = service.removesuffix("-free")
    assert request.url.host == hosts[base]
    if service.endswith("-free"):
        assert "authorization" not in request.headers and "x-api-key" not in request.headers
    else:
        assert KEY in (request.headers.get("authorization", "") + request.headers.get("x-api-key", ""))
    if base == "xai":
        assert request.url.path == "/v1/responses" and body["tools"] == [{"type": "web_search"}]
        assert body["input"] == "needle"
        return httpx.Response(200, json={"output": [{"content": [{"text": "Words", "annotations": [{"type": "url_citation", "title": "Article", "url": URL}]}]}]})
    if base == "keenable":
        assert request.url.path.endswith("/public") == service.endswith("-free")
        assert request.headers["X-Keenable-Title"] == "Raphael"
        if reading:
            assert request.url.params["url"] == URL
            return httpx.Response(200, json=item)
    elif base == "firecrawl":
        assert request.url.path == ("/v2/scrape" if reading else "/v2/search")
        if reading:
            assert body["url"] == URL
            return httpx.Response(200, json={"data": {"markdown": "Words", "metadata": {"title": "Article"}}})
        return httpx.Response(200, json={"data": {"web": [item]}})
    elif base == "parallel":
        assert request.url.path == ("/v1/extract" if reading else "/v1/search")
        assert body["urls"] == [URL] if reading else body["search_queries"] == ["needle"]
    elif base == "tavily" and reading:
        assert body["urls"] == [URL]
        item["raw_content"] = "Words"
    elif base == "exa":
        assert request.url.path == "/contents" and body["ids"] == [URL]
    elif base == "perplexity":
        if reading:
            assert request.url.path == "/sdk/content/snippets" and body["urls"] == [URL]
        else:
            assert body["search_context_size"] == "low"
    return httpx.Response(200, json={"results": [item]})


@pytest.mark.parametrize("service", SEARCH_IDS)
async def test_each_search_route_is_selected_and_called(service):
    seen = []
    def respond(req):
        seen.append(req)
        return web_reply(service, req)
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        found = await web.search(service, "needle", http=http, key=KEY)
    assert found["results"][0]["url"] == URL
    assert len(seen) == 1


@pytest.mark.parametrize("service", READ_IDS)
async def test_each_extract_route_is_selected_and_called(service):
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req: web_reply(service, req, True))) as http:
        found = await web.read(service, URL, http=http, fetcher=None, read_pdf=None, key=KEY)
    assert "Words" in found["text"]


@pytest.mark.parametrize("service", SEARCH_IDS)
async def test_search_failure_stays_with_selected_provider(service):
    seen = []
    def refuse(req):
        seen.append(req)
        return httpx.Response(401, text=KEY)
    async with httpx.AsyncClient(transport=httpx.MockTransport(refuse)) as http:
        with pytest.raises(ServiceError) as error:
            await web.search(service, "needle", http=http, key=KEY)
    assert error.value.kind == "auth" and error.value.service == service
    assert KEY not in str(error.value) and len(seen) == 1


@pytest.mark.parametrize("service", ("openai-native", "nous", "unknown"))
async def test_unsupported_identity_never_borrows_an_api_key(service):
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req: pytest.fail("No request allowed"))) as http:
        with pytest.raises(ServiceError) as error:
            await web.search(service, "needle", http=http, key=KEY)
    assert error.value.service == service and error.value.kind == "not_configured"


@pytest.mark.parametrize("service", [service for service in STT_IDS if service != "whisper"])
@pytest.mark.parametrize("failure", (False, True))
async def test_cloud_transcription_protocol_and_failure(service, failure):
    seen = []
    def respond(req):
        seen.append(req)
        assert b'audio.wav' in req.content and b"audio/wav" in req.content
        if service == "elevenlabs":
            assert req.url.path == "/v1/speech-to-text" and req.headers["xi-api-key"] == KEY
            assert b'name="model_id"' in req.content
        elif service == "xai":
            assert req.url.path == "/v1/stt" and b"owner-model" in req.content
        else:
            assert req.url.path.endswith("/audio/transcriptions") and b"owner-model" in req.content
        return httpx.Response(403 if failure else 200, json={"text": "Transcript"})
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        if failure:
            with pytest.raises(ServiceError) as error:
                await transcribe(service, wav(), "en", http=http, key=KEY, model="owner-model")
            assert error.value.service == service and error.value.kind == "auth"
        else:
            assert await transcribe(service, wav(), "en", http=http, key=KEY, model="owner-model") == "Transcript"
    assert len(seen) == 1


async def test_whisper_is_local_only_and_preserves_selected_model(monkeypatch, tmp_path):
    class Whisper:
        def __init__(self, model, **kwargs):
            assert model == str(tmp_path) and kwargs["local_files_only"] is True
        def transcribe(self, audio, **kwargs):
            return iter([SimpleNamespace(text="Local words")]), None
    monkeypatch.setitem(sys.modules, "faster_whisper", SimpleNamespace(WhisperModel=Whisper))
    assert await transcribe("whisper", wav(), http=None, model=str(tmp_path)) == "Local words"
    monkeypatch.setitem(sys.modules, "faster_whisper", None)
    with pytest.raises(ServiceError) as error:
        await transcribe("whisper", wav(), http=None, model=str(tmp_path))
    assert error.value.service == "whisper" and error.value.kind == "needs_install"


@pytest.mark.parametrize("service", ("browserbase", "browser-use", "firecrawl"))
@pytest.mark.parametrize("failure", (False, True))
async def test_browser_session_protocol_and_provider_failures(service, failure):
    seen = []
    def respond(req):
        seen.append(req)
        if failure:
            return httpx.Response(401)
        if len(seen) == 1:
            return httpx.Response(200, json={"id": "session-id", "cdpUrl": "wss://browser.example/cdp?token=private"})
        body = json.loads(req.content) if req.content else {}
        assert req.method == {"browserbase": "POST", "browser-use": "PATCH", "firecrawl": "DELETE"}[service]
        assert req.url.path.endswith("/session-id")
        if service == "browserbase":
            assert body == {"projectId": "project", "status": "REQUEST_RELEASE"}
        return httpx.Response(204)
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        if failure:
            with pytest.raises(ServiceError) as error:
                await browser_sessions.create(service, http=http, key=KEY, project="project")
            assert error.value.service == service and error.value.kind == "auth"
        else:
            session = await browser_sessions.create(service, http=http, key=KEY, project="project")
            assert "private" not in repr(session)
            await browser_sessions.release(session, http=http, key=KEY, project="project")


MEDIA = (("image", "fal", "fal-ai/flux/schnell"), ("video", "fal", "fal-ai/wan/text-to-video"),
         ("image", "krea", "krea-3"), ("image", "deepinfra", "owner/image"),
         ("image", "meta-ai", "muse-image-1.0"), ("video", "deepinfra", "owner/video"),
         ("video", "openrouter", "owner/video"))


@pytest.mark.parametrize("kind,service,model", MEDIA)
@pytest.mark.parametrize("failure", (False, True))
async def test_media_uses_explicit_model_existing_store_and_provider_failure(kind, service, model, failure, tmp_path):
    seen = []
    def respond(req):
        seen.append(req)
        if failure:
            return httpx.Response(403, text=KEY)
        if service == "fal":
            if req.method == "POST":
                assert req.headers["authorization"] == f"Key {KEY}" and req.url.path == "/" + model
                return httpx.Response(200, json={"request_id": "job", "status_url": "https://queue.fal.run/fal-ai/flux/requests/job/status", "response_url": "https://queue.fal.run/fal-ai/flux/requests/job"})
            if req.url.path.endswith("/status"):
                return httpx.Response(200, json={"status": "COMPLETED"})
            return httpx.Response(200, json={"images": [{"url": URL}], "video": {"url": URL}})
        if service == "krea":
            if req.method == "POST":
                assert req.url.path == "/generate/image/krea/krea-3"
                return httpx.Response(200, json={"job_id": "job"})
            return httpx.Response(200, json={"status": "completed", "result": {"urls": [URL]}})
        if kind == "image":
            assert json.loads(req.content)["model"] == model
            return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(PNG).decode()}]})
        if req.url.path.endswith("/content"):
            return httpx.Response(200, content=VIDEO)
        if req.method == "POST":
            assert model.encode() in req.content
        return httpx.Response(200, json={"id": "job", "status": "completed"})
    class Fetcher:
        async def fetch(self, url):
            assert url == URL
            return SimpleNamespace(body=PNG if kind == "image" else VIDEO, content_type="image/png" if kind == "image" else "video/mp4")
    keys = memory_keys()
    keys.set(backends.credential_service(service), KEY)
    providers = SimpleNamespace(media_choices=lambda kind: [])
    generation = Generation(providers, AttachmentStore(tmp_path), keys=keys, transport=httpx.MockTransport(respond), fetcher=Fetcher())
    generation.poll_seconds = 0
    reference = f"@service:{service}/{model}"
    try:
        assert generation.media_choices(kind, reference)[0]["reference"] == reference
        if failure:
            with pytest.raises(ServiceError) as error:
                await generation.make(kind, {"prompt": "Poster"}, selected_model=reference)
            assert error.value.kind == "auth" and error.value.service == service
            assert len(seen) == 1 and not list(tmp_path.glob("**/*.png"))
        else:
            result = await generation.make(kind, {"prompt": "Poster"}, selected_model=reference)
            assert result["model"] == reference and result["cost_usd"] is None
            assert generation.store.path(result["attachment"]["id"]).read_bytes() == (PNG if kind == "image" else VIDEO)
    finally:
        await generation.aclose()

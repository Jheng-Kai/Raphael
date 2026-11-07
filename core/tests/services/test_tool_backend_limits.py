"""Backend bounds, cancellation and integration gaps are observable offline."""

import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest

from raphael_core.services import backend_http, backends, browser_sessions, web
from raphael_core.services.attachment_store import AttachmentStore
from raphael_core.services.common import ServiceError
from raphael_core.services.generation import Generation
from raphael_core.services.hub import ServiceHub
from raphael_core.services.keys import memory_keys
from raphael_core.services.speech_backends import transcribe


@pytest.mark.parametrize("reading", (False, True))
@pytest.mark.parametrize("failure", (False, True))
async def test_self_hosted_firecrawl_never_uses_the_cloud_or_its_key(reading, failure):
    seen = []
    def respond(req):
        seen.append(req)
        assert req.url.host == "localhost" and req.url.port == 3002
        assert "authorization" not in req.headers
        assert req.url.path == ("/v2/scrape" if reading else "/v2/search")
        if failure:
            return httpx.Response(403)
        return httpx.Response(200, json={"data": {"markdown": "Page words", "metadata": {"title": "Title"}}} if reading else {"data": {"web": []}})
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        async def run(url):
            if reading:
                return await web.read("firecrawl-selfhosted", "https://example.com", http=http, fetcher=None, read_pdf=None, firecrawl_url=url)
            return await web.search("firecrawl-selfhosted", "words", http=http, firecrawl_url=url)
        if failure:
            with pytest.raises(ServiceError) as error:
                await run("http://localhost:3002")
            assert error.value.service == "firecrawl-selfhosted" and error.value.kind == "auth"
        else:
            assert await run("http://localhost:3002")
        with pytest.raises(ServiceError) as error:
            await run("")
        assert error.value.kind == "not_configured" and error.value.service == "firecrawl-selfhosted"
    assert len(seen) == 1


@pytest.mark.parametrize("service", [row.id for row in backends.READ if row.integration != "oauth_required" and row.id not in ("firecrawl", "firecrawl-selfhosted")])
async def test_reader_failure_retains_provider_and_does_not_fall_back(service):
    seen = []
    def refuse(req):
        seen.append(req)
        return httpx.Response(401, text="private upstream details")
    async with httpx.AsyncClient(transport=httpx.MockTransport(refuse)) as http:
        with pytest.raises(ServiceError) as error:
            await web.read(service, "https://example.com/", key="fake", http=http, fetcher=None, read_pdf=None)
    assert error.value.service == service and error.value.kind == "auth"
    assert "private" not in str(error.value) and len(seen) == 1


@pytest.mark.parametrize("service", ("openai", "groq", "xai", "elevenlabs", "mistral", "deepinfra"))
@pytest.mark.parametrize("failure", ("missing_secret", "bad_response"))
async def test_transcription_errors_are_attributed_before_delivery(service, failure):
    seen = []
    def respond(req):
        seen.append(req)
        return httpx.Response(200, json={"not_text": "private"})
    audio = b"RIFF" + bytes(4) + b"WAVE" + bytes(20)
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        with pytest.raises(ServiceError) as error:
            await transcribe(service, audio, http=http, key="fake" if failure == "bad_response" else None, model="chosen-model")
    assert error.value.service == service and error.value.kind == failure
    assert len(seen) == (1 if failure == "bad_response" else 0)


async def test_http_adapter_bounds_streams_refuses_redirects_and_redacts_errors():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req: httpx.Response(200, content=b"a" * 100))) as http:
        with pytest.raises(ServiceError) as error:
            await backend_http.request(http, "chosen", "GET", "https://example.com", limit=10)
        assert error.value.kind == "too_large" and error.value.service == "chosen"
    seen = []
    def redirect(req):
        seen.append(req)
        return httpx.Response(302, headers={"location": "https://elsewhere.example/key"})
    async with httpx.AsyncClient(transport=httpx.MockTransport(redirect), follow_redirects=True) as http:
        with pytest.raises(ServiceError) as error:
            await backend_http.request(http, "chosen", "POST", "https://example.com", headers={"Authorization": "Bearer private"})
    assert error.value.kind == "http_error" and len(seen) == 1
    assert str(error.value) == "http_error"


async def test_drip_response_has_a_total_deadline_and_closes():
    closed = []
    class Drip(httpx.AsyncByteStream):
        async def __aiter__(self):
            while True:
                await asyncio.sleep(.01)
                yield b"x"
        async def aclose(self):
            closed.append(True)
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req: httpx.Response(200, stream=Drip()))) as http:
        with pytest.raises(ServiceError) as error:
            await backend_http.request(http, "chosen", "GET", "https://example.com", timeout=.05)
    assert error.value.kind == "timeout" and closed


@pytest.mark.parametrize("service", ("fal", "deepinfra", "openrouter", "krea"))
async def test_media_stop_never_publishes_and_cancels_remote_when_supported(service, tmp_path):
    seen, polling = [], asyncio.Event()
    def respond(req):
        seen.append(req)
        if req.method in ("DELETE", "PUT"):
            return httpx.Response(200, json={"ok": True})
        if service == "fal":
            if req.method == "POST":
                return httpx.Response(200, json={"request_id": "job", "status_url": "https://queue.fal.run/fal-ai/model/requests/job/status", "response_url": "https://queue.fal.run/fal-ai/model/requests/job"})
            polling.set()
            return httpx.Response(200, json={"status": "IN_PROGRESS"})
        if service == "krea":
            if req.method == "POST":
                return httpx.Response(200, json={"job_id": "job"})
            polling.set()
            return httpx.Response(200, json={"status": "processing"})
        if req.method == "GET":
            polling.set()
        return httpx.Response(200, json={"id": "job", "status": "in_progress"})
    keys = memory_keys()
    keys.set(backends.credential_service(service), "fake")
    generation = Generation(SimpleNamespace(media_choices=lambda kind: []), AttachmentStore(tmp_path), keys=keys, transport=httpx.MockTransport(respond))
    generation.poll_seconds = .01
    model, kind = ("krea-3", "image") if service == "krea" else ("fal-ai/model" if service == "fal" else "owner/model", "video")
    task = asyncio.create_task(generation.make(kind, {"prompt": "Poster"}, selected_model=f"@service:{service}/{model}"))
    try:
        await asyncio.wait_for(polling.wait(), 2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert not [path for path in tmp_path.rglob("*") if path.is_file()]
        if service != "krea":
            assert seen[-1].method == ("PUT" if service == "fal" else "DELETE")
    finally:
        if not task.done():
            task.cancel()
        await generation.aclose()


async def test_queue_cannot_send_credentials_to_a_returned_foreign_url(tmp_path):
    seen = []
    def respond(req):
        seen.append(req)
        return httpx.Response(200, json={"request_id": "job", "status_url": "https://attacker.example/requests/job/status", "response_url": "https://attacker.example/requests/job"})
    keys = memory_keys()
    keys.set("fal", "fake")
    generation = Generation(SimpleNamespace(media_choices=lambda kind: []), AttachmentStore(tmp_path), keys=keys, transport=httpx.MockTransport(respond))
    try:
        with pytest.raises(ServiceError) as error:
            await generation.make("image", {"prompt": "Poster"}, selected_model="@service:fal/fal-ai/model")
        assert error.value.kind == "bad_response" and error.value.service == "fal" and len(seen) == 1
    finally:
        await generation.aclose()


async def test_hub_reads_the_explicit_choice_each_call_without_a_second_store(conn):
    seen = []
    def respond(req):
        seen.append(req)
        return httpx.Response(200, json={"results": []})
    hub = ServiceHub(conn, object(), memory_keys(), transport=httpx.MockTransport(respond))
    # Emulate the settings owner's enum extension at the public SettingsStore seam.
    selected = {"web_search_service": "keenable-free"}
    original_get = hub._settings.get
    hub._settings.get = lambda key: selected[key] if key in selected else original_get(key)
    try:
        assert (await hub.search("words"))[0] == "keenable-free"
        assert "authorization" not in seen[0].headers
        selected["web_search_service"] = "keenable"
        with pytest.raises(ServiceError) as error:
            await hub.search("words")
        assert error.value.service == "keenable" and error.value.kind == "missing_secret"
        assert len(seen) == 1
    finally:
        await hub.aclose()


async def test_x_search_remains_an_explicit_provider_and_uses_x_not_web(conn):
    def respond(req):
        body = json.loads(req.content)
        assert body["tools"] == [{"type": "x_search"}] and body["model"] == "grok-4.5"
        return httpx.Response(200, json={"output": [{"content": [{"text": "Public posts"}]}]})
    keys = memory_keys()
    keys.set("xai", "fake")
    hub = ServiceHub(conn, object(), keys, transport=httpx.MockTransport(respond))
    try:
        assert (await hub.x_search("words"))["answer"] == "Public posts"
    finally:
        await hub.aclose()


@pytest.mark.parametrize("service", [row.id for row in backends.SEARCH if row.integration != "oauth_required" and row.id != "firecrawl-selfhosted"])
async def test_malformed_search_bodies_are_provider_failures(service):
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req: httpx.Response(200, json=[None]))) as http:
        with pytest.raises(ServiceError) as error:
            await web.search(service, "words", http=http, key="fake")
    assert error.value.service == service and error.value.kind == "bad_response"


async def test_media_service_reference_is_persisted_by_existing_settings_and_tool_gate(conn, tmp_path):
    from raphael_core.brain.settings import SettingsStore
    from raphael_core.services.generation_tools import GenerationTools
    reference = "@service:meta-ai/muse-image-1.0"
    SettingsStore(conn).set("image_model", reference)
    generation = Generation(SimpleNamespace(media_choices=lambda kind: []), AttachmentStore(tmp_path), keys=memory_keys())
    tools = GenerationTools(SimpleNamespace(offered_for=lambda member: []), generation, conn)
    assert tools.offered_for(0)[0].schema["properties"]["model"]["enum"] == [reference]
    result = await tools.call(tools.offered_for(0)[0].key, {"prompt": "Poster"}, approver="user")
    assert not result.ok and result.kind == "missing_secret" and "meta-ai" in result.text
    assert not [path for path in tmp_path.rglob("*") if path.is_file()]
    await generation.aclose()

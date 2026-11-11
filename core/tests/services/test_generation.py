"""Media tools use configured capabilities and deliver bounded attachment receipts."""

import asyncio
import base64
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from raphael_core.services.attachment_store import AttachmentStore
from raphael_core.services.attachments import Attachment

PNG = b"\x89PNG\r\n\x1a\n" + bytes(16)


def registry(rows, handler):
    from raphael_core.brain.providers.clients import CompatibleProvider
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = CompatibleProvider("openai", "https://chosen.example/v1", lambda: "fake", http=client)
    return SimpleNamespace(media_choices=lambda kind: [r for r in rows if kind in r["media"]],
                           resolve=lambda ref: ("chosen", ref.split(":", 1)[1]),
                           client=lambda pid: provider, config=lambda pid: {"kind": "openai"}), client


@pytest.mark.parametrize('kind', ['image', 'video'])
async def test_discovery_is_not_owner_consent_to_another_model_or_bill(tmp_path, kind):
    from raphael_core.services.generation import Generation
    from raphael_core.services.common import ServiceError
    providers, http = registry([{'reference': '@chosen:paid', 'media': [kind]}],
                               lambda request: pytest.fail('An unchosen model must never be called'))
    service = Generation(providers, AttachmentStore(tmp_path))
    try:
        with pytest.raises(ServiceError, match='not_configured'):
            await service.make(kind, {'prompt': 'Office', 'model': '@chosen:paid'}, selected_model='cli:codex:owner')
        with pytest.raises(ServiceError, match='not_configured'):
            await service.make(kind, {'prompt': 'Office', 'model': '@chosen:paid'}, selected_model='@chosen:chat')
        providers.media_choices = lambda kind: [{'reference': '@chosen:owner', 'media': [kind]},
                                                {'reference': '@chosen:paid', 'media': [kind]}]
        with pytest.raises(ServiceError, match='bad_arguments'):
            await service.make(kind, {'prompt': 'Office', 'model': '@chosen:paid'}, selected_model='@chosen:owner')
    finally:
        await http.aclose()


async def test_model_tool_table_names_only_the_explicit_media_choice(conn):
    from raphael_core.brain.settings import SettingsStore
    from raphael_core.services.generation_tools import GenerationTools
    SettingsStore(conn).set('agent_model', '@chosen:chat')
    service = SimpleNamespace(providers=SimpleNamespace(media_choices=lambda kind: [
        {'reference': '@chosen:paid', 'media': ['image'], 'image_input': True}]), make=AsyncMock())
    tools = GenerationTools(SimpleNamespace(offered_for=lambda member: []), service, conn)
    offered = tools.offered_for(0)
    assert '@chosen:paid' not in json.dumps([tool.schema for tool in offered])
    result = await tools.call(offered[0].key, {'prompt': 'Office', 'model': '@chosen:paid'}, approver='user')
    assert not result.ok
    service.make.assert_not_awaited()
    SettingsStore(conn).set('image_model', '@chosen:paid')
    assert tools.offered_for(0)[0].schema == tools.offered_for(7)[0].schema
    assert tools.offered_for(7)[0].schema['properties']['model']['enum'] == ['@chosen:paid']


async def test_image_generation_and_edit_use_chosen_model_bytes_and_existing_store(tmp_path):
    from raphael_core.services.generation import Generation
    seen = []
    def respond(request):
        seen.append(request)
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(PNG).decode()}]})
    rows = [{"reference": "@chosen:picture", "media": ["image"], "image_input": True}]
    providers, http = registry(rows, respond)
    store = AttachmentStore(tmp_path)
    source = store.save(Attachment("source.png", "image/png", PNG))
    generation = Generation(providers, store)
    try:
        receipt = await generation.make("image", {"model": "@chosen:picture", "prompt": "Office poster"}, selected_model="@chosen:picture?effort=high")
        assert store.path(receipt["attachment"]["id"]).read_bytes() == PNG
        assert json.loads(seen[0].content)["model"] == "picture"
        assert seen[0].url.path == "/v1/images/generations"
        await generation.make("image", {"model": "@chosen:picture", "prompt": "Change the title", "images": [source.stored_id]}, selected_model="@chosen:picture")
        assert seen[1].url.path == "/v1/images/edits"
        assert PNG in seen[1].content and b"Change the title" in seen[1].content
    finally:
        await generation.aclose()
        await http.aclose()


async def test_missing_capability_and_unselected_models_never_call_provider(tmp_path):
    from raphael_core.services.generation import Generation
    from raphael_core.services.common import ServiceError
    providers, http = registry([], lambda request: pytest.fail("No configured capability may call"))
    service = Generation(providers, AttachmentStore(tmp_path))
    try:
        with pytest.raises(ServiceError, match="not_configured"):
            await service.make("image", {"prompt": "Poster"}, selected_model="@chosen:picture")
        providers.media_choices = lambda kind: [{"reference": "@chosen:picture", "media": ["image"]}]
        for model in (None, "@unconfigured:paid"):
            with pytest.raises(ServiceError, match="bad_arguments"):
                await service.make("image", {"prompt": "Poster", "model": model}, selected_model="@chosen:picture")
    finally:
        await service.aclose()
        await http.aclose()


async def test_video_poll_progress_and_cancel_stop_before_attachment(tmp_path):
    from raphael_core.services.generation import Generation
    polling = asyncio.Event()
    requests = []
    async def respond(request):
        requests.append(request.method)
        if request.method == "POST":
            return httpx.Response(200, json={"id": "job-1", "status": "queued"})
        polling.set()
        await asyncio.Event().wait()
    providers, http = registry([{"reference": "@chosen:movie", "media": ["video"]}], respond)
    store = AttachmentStore(tmp_path)
    service = Generation(providers, store)
    progress = []
    task = asyncio.create_task(service.make("video", {"model": "@chosen:movie", "prompt": "Pan across the office"}, selected_model="@chosen:movie", progress=progress.append))
    try:
        await asyncio.wait_for(polling.wait(), 3)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert progress and "POST" in requests
        assert not list(store.root.glob("*.mp4"))
    finally:
        await service.aclose()
        await http.aclose()


def test_model_metadata_keeps_media_out_of_chat_choices():
    from raphael_core.brain.providers.clients import model_info
    row = model_info({"id": "poster", "architecture": {"input_modalities": ["text", "image"], "output_modalities": ["image"]}}, kind="openrouter")
    assert row["media"] == ["image"] and row["image_input"]
    assert row["generation_only"]


async def test_shared_tools_offer_missing_repair_and_require_background_video(tmp_path, conn):
    from raphael_core.services.generation_tools import GenerationTools
    from raphael_core.agent.policy import Tier
    from raphael_core.services.common import ServiceError
    delegate = SimpleNamespace(offered_for=lambda member: [], offered=lambda: [])
    service = SimpleNamespace(providers=SimpleNamespace(media_choices=lambda kind: []),
                              make=AsyncMock(side_effect=ServiceError("not_configured")))
    from raphael_core.brain.settings import SettingsStore
    SettingsStore(conn).set('video_model', '@chosen:movie')
    tools = GenerationTools(delegate, service, conn)
    offered = tools.offered_for(7)
    assert {t.name for t in offered} == {"image_generate", "video_generate"}
    result = await tools.call(offered[0].key, {"prompt": "Office"}, approver="auto")
    assert not result.ok and result.kind == "not_configured"
    result = await tools.call(offered[1].key, {"prompt": "Office"}, approver="auto")
    assert result.kind == "not_configured"
    assert [entry.outcome for entry in tools.audit.recent()] == ['error', 'error']
    service.providers.media_choices = lambda kind: [{"reference":"@chosen:movie","media":["video"]}]
    result = await tools.call(offered[1].key, {"prompt":"Office","model":"@chosen:movie"}, approver="auto")
    assert result.kind == "background_required"
    assert tools.tier_of(offered[0].key) == Tier.T1


async def test_video_completed_content_is_bounded_and_delivered(tmp_path):
    from raphael_core.services.generation import Generation
    from raphael_core.services.common import ServiceError
    movie = b'\x00\x00\x00\x18ftypisom' + bytes(20)
    paths = []
    def respond(request):
        paths.append(request.url.path)
        if request.method == 'POST':
            assert b'Pan across the office' in request.content
            return httpx.Response(200, json={'id':'job-2','status':'queued'})
        if request.url.path.endswith('/content'):
            return httpx.Response(200, content=movie)
        return httpx.Response(200, json={'id':'job-2','status':'completed','progress':100})
    providers, http = registry([{'reference':'@chosen:movie','media':['video']}], respond)
    store = AttachmentStore(tmp_path)
    service = Generation(providers, store)
    service.poll_seconds = 0
    try:
        result = await service.make('video', {'model':'@chosen:movie','prompt':'Pan across the office'}, selected_model='@chosen:movie')
        assert store.path(result['attachment']['id']).read_bytes() == movie
        assert paths == ['/v1/videos','/v1/videos/job-2','/v1/videos/job-2/content']
        with pytest.raises(ServiceError, match='protocol'):
            service._bytes(b'not a video', 'video/mp4', 'video')
    finally:
        await http.aclose()


def test_missing_media_has_localized_repair_metadata():
    from raphael_core.agent.steps import Step, step_view
    for tool, requirement in [('image_generate','image_generation'),('video_generate','video_generation')]:
        step = Step(kind='tool',tool=tool,server='media',outcome='error',reason='not_configured',ms=0,at_ms=0)
        assert step_view(step)['missing'] == {'resource':'image' if tool == 'image_generate' else 'video','requirement':requirement,'state':'missing','repair':'models'}


async def test_video_url_download_is_public_bounded_and_never_gets_provider_auth(tmp_path):
    from raphael_core.services.generation import Generation
    from raphael_core.services.fetch import PageFetcher
    movie = b'\x00\x00\x00\x18ftypisom' + bytes(20)
    def download(request):
        assert 'authorization' not in request.headers
        return httpx.Response(200, content=movie, headers={'content-type':'video/mp4'})
    async def public(host, port):
        return ['93.184.216.34']
    fetcher=PageFetcher(media=True,media_types=('video/mp4',),transport=httpx.MockTransport(download),resolver=public,max_bytes=100)
    service=Generation(None,AttachmentStore(tmp_path),fetcher=fetcher)
    result=await service._asset('https://cdn.example/movie.mp4','video')
    assert result.mime == 'video/mp4' and result.data == movie
    from raphael_core.services.common import ServiceError
    with pytest.raises(ServiceError, match='blocked_address'):
        await service._asset('http://127.0.0.1/private.mp4','video')


@pytest.mark.parametrize('kind', ['google','openrouter','xai'])
async def test_image_wire_formats_keep_references_and_selected_model(tmp_path, kind):
    from raphael_core.services.generation import Generation
    from raphael_core.brain.providers.clients import CompatibleProvider
    seen=[]
    encoded=base64.b64encode(PNG).decode()
    def respond(request):
        seen.append(request)
        body=json.loads(request.content)
        if kind == 'google':
            assert request.url.path.endswith('/v1beta/models/picture:generateContent')
            assert request.headers['x-goog-api-key'] == 'fake' and 'authorization' not in request.headers
            assert body['contents'][0]['parts'][1]['inlineData']['data'] == encoded
            return httpx.Response(200,json={'candidates':[{'content':{'parts':[{'inlineData':{'mimeType':'image/png','data':encoded}}]}}]})
        if kind == 'openrouter':
            assert body['modalities'] == ['image','text'] and body['model'] == 'picture'
            assert body['messages'][0]['content'][1]['image_url']['url'].endswith(encoded)
            return httpx.Response(200,json={'choices':[{'message':{'images':[{'image_url':{'url':'data:image/png;base64,'+encoded}}]}}]})
        assert request.url.path.endswith('/images/edits') and body['image']['url'].endswith(encoded)
        return httpx.Response(200,json={'data':[{'b64_json':encoded}]})
    http=httpx.AsyncClient(transport=httpx.MockTransport(respond))
    provider=CompatibleProvider(kind,'https://chosen.example',lambda:'fake',http=http)
    store=AttachmentStore(tmp_path)
    source=store.save(Attachment('source.png','image/png',PNG))
    service=Generation(None,store)
    try:
        result=await service._image(provider,'picture','Edit this image',[source])
        assert result.data == PNG and len(seen) == 1
    finally:
        await http.aclose()


async def test_google_text_only_response_is_a_protocol_failure_without_a_file(tmp_path):
    from raphael_core.services.generation import Generation
    from raphael_core.services.common import ServiceError
    from raphael_core.brain.providers.clients import CompatibleProvider
    http = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(
        200, json={'candidates': [{'content': {'parts': [{'text': 'No image returned'}]}}]})))
    provider = CompatibleProvider('google', 'https://chosen.example/v1beta/openai', lambda: 'fake', http=http)
    providers = SimpleNamespace(media_choices=lambda kind: [{'reference': '@chosen:picture', 'media': ['image']}],
        resolve=lambda reference: ('chosen', 'picture'), config=lambda pid: {'kind': 'google'}, client=lambda pid: provider)
    store = AttachmentStore(tmp_path)
    try:
        with pytest.raises(ServiceError, match='protocol'):
            await Generation(providers, store).make('image', {'prompt': 'Office'}, selected_model='@chosen:picture')
        assert not store.root.exists()
    finally:
        await http.aclose()


@pytest.mark.parametrize('status,error,expected', [
    (400, {'code': 'content_policy_violation'}, 'content_policy'),
    (429, {'code': 'insufficient_quota'}, 'credits'),
    (429, {}, 'rate_limit'), (401, {}, 'auth'), (500, {}, 'http_error'),
])
async def test_avatar_provider_refusals_keep_safe_codes_and_make_one_request(tmp_path, status, error, expected):
    from raphael_core.services.generation import Generation
    from raphael_core.services.common import ServiceError
    requests = []
    def respond(request):
        requests.append(request)
        return httpx.Response(status, json={'error': {**error, 'message': 'secret provider content'}})
    providers, http = registry([{'reference': '@chosen:picture', 'media': ['image']}], respond)
    generation = Generation(providers, AttachmentStore(tmp_path))
    try:
        with pytest.raises(ServiceError) as caught:
            await generation.make('image', {'prompt': 'A square avatar', 'square': True}, selected_model='@chosen:picture')
        assert caught.value.kind == expected and str(caught.value) == expected
        assert len(requests) == 1
        assert not generation.store.root.exists()
    finally:
        await generation.aclose()
        await http.aclose()


@pytest.mark.parametrize('kind', ['openai', 'google', 'openrouter', 'xai'])
async def test_avatar_requests_one_square_image_on_each_compatible_provider(kind):
    from raphael_core.services.generation import Generation
    from raphael_core.brain.providers.clients import CompatibleProvider
    encoded = base64.b64encode(PNG).decode()
    requests = []
    def respond(request):
        body = json.loads(request.content)
        requests.append(body)
        if kind == 'google':
            assert body['generationConfig']['imageConfig'] == {'aspectRatio': '1:1'}
            return httpx.Response(200, json={'candidates': [{'content': {'parts': [{'inlineData': {'mimeType': 'image/png', 'data': encoded}}]}}]})
        if kind == 'openrouter':
            assert body['image_config'] == {'aspect_ratio': '1:1'}
            return httpx.Response(200, json={'choices': [{'message': {'images': [{'image_url': {'url': 'data:image/png;base64,' + encoded}}]}}]})
        assert body['n'] == 1
        assert body.get('aspect_ratio') == '1:1' if kind == 'xai' else body['size'] == '1024x1024'
        return httpx.Response(200, json={'data': [{'b64_json': encoded}]})
    http = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    provider = CompatibleProvider(kind, 'https://chosen.example/v1beta/openai' if kind == 'google' else 'https://chosen.example', lambda: 'fake', http=http)
    try:
        assert (await Generation(None, None)._image(provider, 'picture', 'Avatar', [], square=True)).data == PNG
        assert len(requests) == 1
    finally:
        await http.aclose()


@pytest.mark.parametrize('kind,payload', [
    ('google', {'promptFeedback': {'blockReason': 'SAFETY'}}),
    ('google', {'candidates': [{'finishReason': 'IMAGE_SAFETY'}]}),
    ('openrouter', {'choices': [{'message': {'refusal': 'Provider private refusal'}}]}),
])
async def test_success_status_safety_refusals_are_not_protocol_errors(kind, payload):
    from raphael_core.services.generation import Generation
    from raphael_core.services.common import ServiceError
    from raphael_core.brain.providers.clients import CompatibleProvider
    http = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=payload)))
    provider = CompatibleProvider(kind, 'https://chosen.example/v1beta/openai', lambda: 'fake', http=http)
    try:
        with pytest.raises(ServiceError, match='content_policy'):
            await Generation(None, None)._image(provider, 'picture', 'Avatar', [], square=True)
    finally:
        await http.aclose()

"""One owner press generates one unapplied candidate, never a provider fallback."""

import asyncio
import base64
import json
import logging

import httpx
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from raphael_core.protocol import BUSY, NOT_CONFIGURED, RpcError
from raphael_core.services.common import ServiceError

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==')


def backend(rig, *, reference='@chosen:picture', mime='image/png', raw=PNG):
    providers = SimpleNamespace(resolve=lambda ref: ('chosen', 'picture'),
                                config=lambda pid: {'kind': 'openai', 'enabled': True},
                                view=lambda pid: {'has_key': True})
    service = SimpleNamespace(providers=providers,
        media_choices=lambda kind, selected: [{'reference': reference}],
        make=AsyncMock(return_value={'attachment': {'id': 'candidate', 'mime': mime}, 'model': reference}),
        store=SimpleNamespace(path=lambda key: SimpleNamespace(stat=lambda: SimpleNamespace(st_size=len(raw)), read_bytes=lambda: raw)))
    rig.rpc.generation = service
    rig.service._settings.set('image_model', reference)
    return service


async def test_candidate_uses_owner_model_profile_and_words_without_applying_it(rig):
    member = (await rig.call('members.create', {'name': 'Moss', 'role': 'Gardener', 'greet': False}))['member']
    service = backend(rig)
    result = await rig.call('members.avatar_generate', {'member_id': member['id'], 'prompt': 'A green fox'})
    assert result == {'model': '@chosen:picture', 'candidate': {'name': 'avatar.png', 'mime': 'image/png',
        'data': base64.b64encode(PNG).decode(), 'crop': {'x': 0.5, 'y': 0.5, 'zoom': 1}}}
    service.make.assert_awaited_once()
    args, kwargs = service.make.call_args
    assert args[0] == 'image' and args[1]['square'] is True
    assert all(word in args[1]['prompt'] for word in ('Moss', 'Gardener', 'A green fox', 'round avatar', 'plain background'))
    assert kwargs['selected_model'] == '@chosen:picture'
    assert rig.service.store.member(member['id']).avatar == ''
    assert not rig.service._avatars.exists()
    applied = await rig.call('members.set_avatar', {'id': member['id'], **{k: result['candidate'][k] for k in ('name', 'mime', 'data')}})
    assert applied['member']['avatar_url'].endswith(result['candidate']['data'])


@pytest.mark.parametrize('state', ['unset', 'unavailable', 'disabled', 'no-service'])
async def test_missing_model_has_exact_settings_target_and_never_calls(rig, state):
    service = backend(rig)
    if state == 'unset':
        rig.service._settings.set('image_model', '')
    elif state == 'unavailable':
        service.media_choices = lambda *args: []
    elif state == 'disabled':
        service.providers.config = lambda pid: {'enabled': False}
    else:
        rig.rpc.generation = None
    with pytest.raises(RpcError) as caught:
        await rig.call('members.avatar_generate', {'member_id': 0, 'prompt': 'A fox'})
    assert caught.value.code == NOT_CONFIGURED
    if state == 'no-service':
        assert caught.value.data['kind'] == 'catalog_unavailable'
        assert 'target' not in caught.value.data
    else:
        assert caught.value.data['kind'] == 'image_model_missing'
        assert caught.value.data['target'] == {'pane': 'models', 'field': 'image-model'}
        assert caught.value.data['missing'] == {'resource': 'image', 'requirement': 'image_generation', 'state': 'missing', 'repair': 'models'}
    service.make.assert_not_awaited()


@pytest.mark.parametrize('provider,kind', [('chosen', 'missing_secret'), ('chatgpt', 'auth_expired')])
async def test_missing_provider_credentials_keep_shared_missing_shape(rig, provider, kind):
    service = backend(rig, reference=f'@{provider}:picture')
    service.providers.resolve = lambda ref: (provider, 'picture')
    service.providers.view = lambda pid: {'has_key': False}
    with pytest.raises(RpcError) as caught:
        await rig.call('members.avatar_generate', {'member_id': 0, 'prompt': 'A fox'})
    assert caught.value.data['kind'] == kind
    assert caught.value.data['missing']['resource'] == provider
    assert caught.value.data['target'] == {'pane': 'models', 'field': 'provider', 'id': provider}
    service.make.assert_not_awaited()


@pytest.mark.parametrize('kind', ['missing_secret', 'auth', 'content_policy', 'credits', 'rate_limit', 'network', 'timeout'])
async def test_service_refusal_keeps_code_and_never_retries_or_switches(rig, caplog, kind):
    service = backend(rig, reference='@service:fal/portrait')
    service.make.side_effect = ServiceError(kind, service='fal')
    with pytest.raises(RpcError) as caught:
        await rig.call('members.avatar_generate', {'member_id': 0, 'prompt': 'A fox'})
    assert caught.value.data['kind'] == kind and caught.value.data['service'] == 'fal'
    assert caught.value.data['reason'] == f'Avatar generation did not finish ({kind}).'
    if kind in ('missing_secret', 'auth'):
        assert caught.value.data['target'] == {'pane': 'models', 'field': 'service', 'id': 'fal'}
    service.make.assert_awaited_once()
    assert not rig.service.avatar_generation.inflight
    records = [row for row in caplog.records if row.name == 'raphael_core.members.avatar_generation']
    assert len(records) == 1 and records[0].levelno == logging.WARNING
    assert all(word in records[0].getMessage() for word in (f'kind={kind}', '@service:fal/portrait', 'member_id=0'))
    assert 'A fox' not in records[0].getMessage() and not records[0].exc_info


async def test_inflight_is_per_member_and_cancellation_releases_the_claim(rig):
    service = backend(rig)
    entered = asyncio.Event()
    async def pending(*args, **kwargs):
        entered.set()
        await asyncio.Event().wait()
    service.make.side_effect = pending
    task = asyncio.create_task(rig.call('members.avatar_generate', {'member_id': 0, 'prompt': 'A fox'}))
    await asyncio.wait_for(entered.wait(), 2)
    with pytest.raises(RpcError) as caught:
        await rig.call('members.avatar_generate', {'member_id': 0, 'prompt': 'Another fox'})
    assert caught.value.code == BUSY and caught.value.data['kind'] == 'busy'
    service.make.assert_awaited_once()
    other = (await rig.call('members.create', {'name': 'Other', 'greet': False}))['member']
    service.make.side_effect = None
    assert (await rig.call('members.avatar_generate', {'member_id': other['id'], 'prompt': 'A cat'}))['candidate']
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    service.make.side_effect = None
    assert (await rig.call('members.avatar_generate', {'member_id': 0, 'prompt': 'A fox'}))['candidate']


@pytest.mark.parametrize('params', [{'member_id': 999, 'prompt': 'x'}, {'member_id': True, 'prompt': 'x'},
                                  {'member_id': 0, 'prompt': ''}, {'member_id': 0, 'prompt': 'x' * 8001}])
async def test_bad_arguments_never_reach_backend(rig, params):
    service = backend(rig)
    with pytest.raises(RpcError) as caught:
        await rig.call('members.avatar_generate', params)
    assert caught.value.code == -32602
    service.make.assert_not_awaited()


@pytest.mark.parametrize('mime,raw,kind', [('image/gif', b'GIF89a', 'unsupported_type'),
                                       ('image/png', b'broken', 'bad_response'),
                                       ('image/png', b'x' * (10 * 1024 * 1024 + 1), 'too_large')], ids=['gif', 'invalid', 'oversize'])
async def test_unusable_candidate_is_a_visible_failure(rig, mime, raw, kind):
    service = backend(rig, mime=mime, raw=raw)
    with pytest.raises(RpcError) as caught:
        await rig.call('members.avatar_generate', {'member_id': 0, 'prompt': 'A fox'})
    assert caught.value.data['kind'] == kind
    service.make.assert_awaited_once()


@pytest.mark.parametrize('mime,raw,name', [
    ('image/png', PNG[:16] + (4).to_bytes(4, 'big') + (3).to_bytes(4, 'big') + PNG[24:], 'avatar.png'),
    ('image/jpeg', b'\xff\xd8\xff\xe0' + b'fake JPEG bytes', 'avatar.jpg'),
], ids=['four-by-three', 'jpeg'])
async def test_non_square_and_jpeg_candidates_use_the_existing_save_path(rig, mime, raw, name):
    member = (await rig.call('members.create', {'name': 'Moss', 'greet': False}))['member']
    service = backend(rig, mime=mime, raw=raw)
    result = await rig.call('members.avatar_generate', {'member_id': member['id'], 'prompt': 'A fox'})
    assert result['candidate']['name'] == name and result['candidate']['mime'] == mime
    assert base64.b64decode(result['candidate']['data']) == raw
    assert rig.service.store.member(member['id']).avatar == ''
    saved = await rig.call('members.set_avatar', {'id': member['id'], **{
        key: result['candidate'][key] for key in ('name', 'mime', 'data')}})
    assert saved['member']['avatar_url'] == f'data:{mime};base64,' + base64.b64encode(raw).decode()
    service.make.assert_awaited_once()


async def test_webp_candidate(rig):
    raw = b'RIFF' + bytes(4) + b'WEBPVP8X' + bytes(8) + (31).to_bytes(3, 'little') * 2
    backend(rig, mime='image/webp', raw=raw)
    result = await rig.call('members.avatar_generate', {'member_id': 0, 'prompt': 'A fox'})
    assert result['candidate']['name'] == 'avatar.webp'
    assert base64.b64decode(result['candidate']['data']) == raw


@pytest.mark.parametrize('kind', ['network', 'timeout', 'catalog_unavailable'])
async def test_catalog_failure_is_not_a_missing_model_and_is_logged_safely(rig, caplog, kind):
    reference = 'black-forest-labs/flux-3-image'
    service = backend(rig, reference=reference)
    def unreadable(*args):
        error = ServiceError(kind)
        error.args = ('private provider text',)
        raise error
    service.media_choices = unreadable
    caplog.set_level(logging.INFO, logger='raphael_core.members.avatar_generation')
    with pytest.raises(RpcError) as caught:
        await rig.call('members.avatar_generate', {'member_id': 0, 'prompt': 'private owner prompt'})
    assert caught.value.data['kind'] == kind and 'target' not in caught.value.data
    service.make.assert_not_awaited()
    records = [row for row in caplog.records if row.name == 'raphael_core.members.avatar_generation']
    assert len(records) == 1 and records[0].levelno == logging.WARNING
    assert all(word in records[0].getMessage() for word in (kind, reference, 'member_id=0'))
    assert 'private' not in records[0].getMessage() and not records[0].exc_info


async def test_success_log_has_model_mime_and_size_without_owner_words(rig, caplog):
    reference = 'black-forest-labs/flux-3-image'
    backend(rig, reference=reference)
    caplog.set_level(logging.INFO, logger='raphael_core.members.avatar_generation')
    result = await rig.call('members.avatar_generate', {'member_id': 0, 'prompt': 'private owner prompt'})
    assert result['model'] == reference
    records = [row for row in caplog.records if row.name == 'raphael_core.members.avatar_generation']
    assert len(records) == 1 and records[0].levelno == logging.INFO
    assert all(word in records[0].getMessage() for word in (reference, 'image/png', str(len(PNG)), 'member_id=0'))
    assert 'private' not in records[0].getMessage()


def openrouter_backend(rig, tmp_path, response, *, catalog_error=None, image_model=True, cached=False):
    from raphael_core.brain.providers.registry import ProviderRegistry
    from raphael_core.brain.secrets import MemoryKeyStore
    from raphael_core.services.attachment_store import AttachmentStore
    from raphael_core.services.generation import Generation
    reference = 'black-forest-labs/flux-3-image'
    requests = []
    def respond(request):
        requests.append(request)
        return response
    http = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    keys = MemoryKeyStore()
    keys.set('fake-key')
    rows = [{'id': reference, 'architecture': {'output_modalities': ['image'] if image_model else ['text']}}]
    client = SimpleNamespace(_key_provider=keys.get, _client=lambda: http,
                             models=AsyncMock(return_value=rows, side_effect=catalog_error))
    providers = ProviderRegistry(rig.conn, client, keys)
    if cached:
        providers.remember_openrouter_media(rows)
    generation = Generation(providers, AttachmentStore(tmp_path))
    rig.rpc.generation = generation
    rig.service._settings.set('image_model', reference)
    return generation, providers, client, http, requests


@pytest.mark.parametrize('cached', [False, True], ids=['cold-catalog', 'cached-catalog'])
@pytest.mark.parametrize('reference', ['black-forest-labs/flux-3-image', '@openrouter:black-forest-labs/flux-3-image'])
async def test_real_registry_and_generation_resolve_the_owner_model_like_the_member_tool(rig, tmp_path, cached, reference):
    from raphael_core.services.generation_tools import GenerationTools
    raw = b'\xff\xd8\xff\xe0fake JPEG bytes'
    encoded = base64.b64encode(raw).decode()
    generation, providers, client, http, requests = openrouter_backend(rig, tmp_path, httpx.Response(200, json={
        'choices': [{'message': {'images': [{'image_url': {'url': 'data:image/jpeg;base64,' + encoded}}]}}]}), cached=cached)
    rig.service._settings.set('image_model', reference)
    try:
        result = await rig.call('members.avatar_generate', {'member_id': 0, 'prompt': 'A fox'})
        assert result['model'] == 'black-forest-labs/flux-3-image'
        assert result['candidate']['mime'] == 'image/jpeg' and result['candidate']['data'] == encoded
        assert len(requests) == 1 and requests[0].url.path == '/api/v1/chat/completions'
        body = json.loads(requests[0].content)
        assert body['model'] == result['model'] and body['modalities'] == ['image']
        assert body['image_config'] == {'aspect_ratio': '1:1'}
        assert client.models.await_count == (0 if cached else 1)
        assert providers.resolve(result['model']) == ('openrouter', result['model'])
        tools = GenerationTools(SimpleNamespace(offered_for=lambda member: []), generation, rig.conn)
        assert tools.choices_for('image', reference)[0]['reference'] == result['model']
    finally:
        await generation.aclose()
        await providers.aclose()
        await http.aclose()


@pytest.mark.parametrize('failure,expected', [
    ('offline', 'network'), ('timeout', 'timeout'), ('error', 'catalog_unavailable'),
    ('http-network', 'network'), ('http-timeout', 'timeout'), ('malformed', 'catalog_unavailable'),
    ('auth', 'auth'),
    ('unexpected', 'catalog_unavailable'),
])
async def test_cold_catalog_errors_are_visible_without_a_paid_request(rig, tmp_path, caplog, failure, expected):
    from raphael_core.brain.openrouter import OpenRouterError
    error = {'http-network': httpx.ConnectError('private provider text'),
             'http-timeout': httpx.ReadTimeout('private provider text'),
             'malformed': ValueError('private provider text'),
             'unexpected': RuntimeError('private provider text')}.get(failure)
    error = error or OpenRouterError(0, failure, 'private provider text')
    generation, providers, client, http, requests = openrouter_backend(rig, tmp_path, httpx.Response(500), catalog_error=error)
    caplog.set_level(logging.INFO, logger='raphael_core.members.avatar_generation')
    try:
        with pytest.raises(RpcError) as caught:
            await rig.call('members.avatar_generate', {'member_id': 0, 'prompt': 'private owner prompt'})
        assert caught.value.data['kind'] == expected
        if expected == 'auth':
            assert caught.value.data['target'] == {'pane': 'models', 'field': 'provider', 'id': 'openrouter'}
        else:
            assert 'target' not in caught.value.data
        client.models.assert_awaited_once()
        assert not requests and not generation.store.root.exists()
        assert 'black-forest-labs/flux-3-image' in caplog.text and 'member_id=0' in caplog.text
        assert f'kind={expected}' in caplog.text and 'private' not in caplog.text
    finally:
        await generation.aclose()
        await providers.aclose()
        await http.aclose()


@pytest.mark.parametrize('removed', [False, True], ids=['non-image', 'removed'])
async def test_successful_catalog_proves_non_image_or_removed_model_is_missing(rig, tmp_path, removed):
    generation, providers, client, http, requests = openrouter_backend(rig, tmp_path, httpx.Response(500), image_model=False)
    if removed:
        client.models.return_value = []
    try:
        with pytest.raises(RpcError) as caught:
            await rig.call('members.avatar_generate', {'member_id': 0, 'prompt': 'A fox'})
        assert caught.value.data['kind'] == 'image_model_missing'
        client.models.assert_awaited_once()
        assert not requests
    finally:
        await generation.aclose()
        await providers.aclose()
        await http.aclose()


@pytest.mark.parametrize('payload,expected', [
    ({'choices': []}, 'protocol'),
    ({'choices': [{'message': {'refusal': 'private provider refusal'}}]}, 'content_policy'),
    ({'choices': [{'message': {'images': [{'image_url': {'url': 'data:image/jpeg;base64,YmFk'}}]}}]}, 'protocol'),
])
async def test_failures_after_the_provider_call_are_logged_once_without_provider_text(rig, tmp_path, caplog, payload, expected):
    generation, providers, client, http, requests = openrouter_backend(rig, tmp_path, httpx.Response(200, json=payload), cached=True)
    caplog.set_level(logging.INFO, logger='raphael_core.members.avatar_generation')
    try:
        with pytest.raises(RpcError) as caught:
            await rig.call('members.avatar_generate', {'member_id': 0, 'prompt': 'private owner prompt'})
        assert caught.value.data['kind'] == expected and len(requests) == 1
        records = [row for row in caplog.records if row.name == 'raphael_core.members.avatar_generation']
        assert len(records) == 1 and records[0].levelno == logging.WARNING
        assert all(value in records[0].getMessage() for value in (f'kind={expected}', 'black-forest-labs/flux-3-image', 'member_id=0'))
        assert 'private' not in records[0].getMessage() and not records[0].exc_info
    finally:
        await generation.aclose()
        await providers.aclose()
        await http.aclose()

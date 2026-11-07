"""One owner press generates one unapplied candidate, never a provider fallback."""

import asyncio
import base64
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
async def test_service_refusal_keeps_code_and_never_retries_or_switches(rig, kind):
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


@pytest.mark.parametrize('mime,raw,kind', [('image/jpeg', b'jpeg', 'unsupported_type'),
                                       ('image/png', b'broken', 'bad_response'),
                                       ('image/png', b'x' * (10 * 1024 * 1024 + 1), 'too_large')], ids=['jpeg', 'invalid', 'oversize'])
async def test_unusable_candidate_is_a_visible_failure(rig, mime, raw, kind):
    service = backend(rig, mime=mime, raw=raw)
    with pytest.raises(RpcError) as caught:
        await rig.call('members.avatar_generate', {'member_id': 0, 'prompt': 'A fox'})
    assert caught.value.data['kind'] == kind
    service.make.assert_awaited_once()


async def test_non_square_output_is_refused_without_another_generation(rig):
    service = backend(rig, raw=PNG[:16] + (2).to_bytes(4, 'big') + PNG[20:])
    with pytest.raises(RpcError) as caught:
        await rig.call('members.avatar_generate', {'member_id': 0, 'prompt': 'A fox'})
    assert caught.value.data['kind'] == 'bad_response'
    service.make.assert_awaited_once()


async def test_webp_candidate(rig):
    raw = b'RIFF' + bytes(4) + b'WEBPVP8X' + bytes(8) + (31).to_bytes(3, 'little') * 2
    backend(rig, mime='image/webp', raw=raw)
    result = await rig.call('members.avatar_generate', {'member_id': 0, 'prompt': 'A fox'})
    assert result['candidate']['name'] == 'avatar.webp'
    assert base64.b64decode(result['candidate']['data']) == raw

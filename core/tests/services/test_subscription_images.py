"""Subscription-only images, bounded session output and shared catalog/delivery contracts."""

import asyncio
import base64
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from raphael_core.agent.cli.discovery import CliBrains
from raphael_core.agent.cli.images import CodexImages, REFERENCE, environment
from raphael_core.agent.ledger import Ledger
from raphael_core.brain.openrouter import OpenRouterClient, OpenRouterError
from raphael_core.brain.providers.chatgpt import ChatGPTProvider
from raphael_core.brain.providers.registry import ProviderRegistry
from raphael_core.brain.secrets import MemoryKeyStore
from raphael_core.brain.service import Brain
from raphael_core.brain.spend import SpendTracker
from raphael_core.services.attachment_store import AttachmentStore
from raphael_core.services.common import ServiceError
from raphael_core.services.generation import Generation
from raphael_core.services.generation_tools import GenerationTools

PNG = b'\x89PNG\r\n\x1a\n' + bytes(16)
THREAD = '11111111-1111-4111-8111-111111111111'


class Input:
    def __init__(self):
        self.raw = b''

    def write(self, raw):
        self.raw += raw

    async def drain(self):
        pass

    def close(self):
        pass


class Children:
    def __init__(self, home, state='success'):
        self.home, self.state, self.made = home, state, []

    def __call__(self, command, *, environ=None, cwd=None):
        status = 'status' in command
        stdout = asyncio.StreamReader()
        packets = [{'type': 'thread.started', 'thread_id': THREAD}]
        if self.state == 'refusal':
            packets.append({'type': 'item.completed', 'item': {'type': 'agent_message', 'text': 'IMAGE_GENERATION_REFUSED'}})
        elif self.state == 'quota':
            packets.append({'type': 'turn.failed', 'error': {'message': 'usage limit reached'}})
        packets.append({'type': 'turn.completed', 'usage': {'input_tokens': 12, 'output_tokens': 8}})
        if not status and self.state != 'timeout':
            stdout.feed_data(('\n'.join(json.dumps(p) for p in packets) + '\n').encode())
        if status or self.state != 'timeout':
            stdout.feed_eof()
        process = SimpleNamespace(stdout=stdout, stdin=Input(), returncode=0, wait=AsyncMock(return_value=0))
        child = SimpleNamespace(process=process, command=command, environ=environ, cwd=cwd,
                                stderr_tail=b'Logged in using ChatGPT' if status and self.state != 'signed-out' else b'',
                                kill=AsyncMock())
        async def start():
            child._stderr = asyncio.create_task(asyncio.sleep(0))
            if not status and self.state in ('success', 'oversize', 'invalid', 'multiple'):
                folder = self.home / '.codex' / 'generated_images' / THREAD
                folder.mkdir(parents=True, exist_ok=True)
                raw = PNG if self.state != 'invalid' else b'not an image'
                (folder / 'exec.png').write_bytes(raw if self.state != 'oversize' else PNG + bytes(10 * 1024 * 1024))
                if self.state == 'multiple':
                    (folder / 'another.png').write_bytes(PNG)
        child.start = start
        self.made.append(child)
        return child


def backend(tmp_path, state='success'):
    brains = CliBrains(home=tmp_path, environ={'PATH': '', 'OPENAI_API_KEY': 'fake-secret',
        'OPENAI_BASE_URL': 'https://forbidden.example', 'ACCESS_TOKEN': 'fake-token'}, commands={'codex': ['fake-codex']})
    brains.logged_in = lambda name: state != 'signed-out'
    children = Children(tmp_path, state)
    return CodexImages(brains=brains, child=children), children


async def test_codex_success_reads_only_its_thread_and_never_copies_credentials(tmp_path):
    service, children = backend(tmp_path)
    other = tmp_path / '.codex' / 'generated_images' / 'another-session'
    other.mkdir(parents=True)
    (other / 'private.png').write_bytes(PNG + b'wrong')
    charged = []
    result = await service.generate('A fox', square=True, charge=charged.append)
    assert result.mime == 'image/png' and result.data == PNG
    assert charged == [{}, {'input_tokens': 12, 'output_tokens': 8}]
    turn = children.made[-1]
    assert 'exec' in turn.command and '--ignore-user-config' in turn.command and '--ignore-rules' in turn.command
    assert 'features.image_generation=true' in turn.command and 'features.shell_tool=false' in turn.command
    assert 'features.code_mode_host=true' in turn.command and 'forced_login_method="chatgpt"' in turn.command
    assert '1:1' in turn.process.stdin.raw.decode()
    assert turn.environ == {'PATH': ''}
    assert not Path(turn.cwd).exists()
    assert all(child.kill.await_count == 1 for child in children.made)


@pytest.mark.parametrize('state,kind', [('signed-out', 'auth_expired'), ('refusal', 'content_policy'),
    ('timeout', 'timeout'), ('non-image', 'bad_response'), ('invalid', 'bad_response'),
    ('oversize', 'too_large'), ('multiple', 'bad_response'), ('quota', 'usage_limit')])
async def test_codex_failures_never_fallback_or_publish(tmp_path, state, kind):
    service, children = backend(tmp_path, state)
    service.timeout_seconds = .03
    with pytest.raises(ServiceError) as caught:
        await service.generate('One image')
    assert caught.value.kind == kind and caught.value.service == 'codex'
    assert len(children.made) == (0 if state == 'signed-out' else 2)
    assert not service.choices() if state == 'signed-out' else True
    assert all(child.kill.await_count == 1 for child in children.made)


async def test_codex_stop_kills_own_child_and_releases_turn(tmp_path):
    service, children = backend(tmp_path, 'timeout')
    task = asyncio.create_task(service.generate('One image'))
    while len(children.made) < 2:
        await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert children.made[-1].kill.await_count == 1
    assert not Path(children.made[-1].cwd).exists()
    assert not service._lock.locked()


async def test_catalog_requires_subscription_login_not_a_key_or_file_alone(conn, tmp_path):
    subscription, children = backend(tmp_path)
    children.state = 'signed-out'
    assert await subscription.refresh() is False
    assert subscription.choices() == []
    children.state = 'success'
    assert await subscription.refresh() is True
    keys = MemoryKeyStore()
    client = OpenRouterClient(lambda: None)
    registry = ProviderRegistry(conn, client, keys, credential=lambda pid: MemoryKeyStore())
    service = Generation(registry, AttachmentStore(tmp_path), subscription_images=subscription)
    brain = Brain(conn, client, keys, providers=registry)
    brain._pricing.catalog = AsyncMock(return_value=([], None, 'builtin'))
    try:
        view = await brain._models_catalog({})
        assert [row['id'] for row in view['image']] == [REFERENCE]
        # model-picker.ts removes cli: IDs before constructing non-answer sources.
        assert REFERENCE == '@codex:gpt-image-2' and not view['image'][0]['id'].startswith('cli:')
        row = view['image'][0]
        assert row['name'] == 'Codex (subscription)' and row['provider_id'] == 'codex'
        assert row['billing_source'] == 'subscription' and row['free'] is False
        assert row['input_per_mtok'] is None and row['per_image'] is None
        assert not any(r['id'].startswith('@chatgpt:') for r in view['image'])
        subscription.brains._set_disconnected('codex', True)
        assert service.media_choices('image') == []
        assert (await brain._models_catalog({}))['image'] == []
    finally:
        await service.aclose()
        await registry.aclose()
        await client.aclose()


async def test_member_tool_and_ledger_record_subscription_not_a_price(conn, tmp_path):
    subscription, _ = backend(tmp_path)
    providers = SimpleNamespace(media_choices=lambda kind: [])
    service = Generation(providers, AttachmentStore(tmp_path), subscription_images=subscription)
    from raphael_core.brain.settings import SettingsStore
    SettingsStore(conn).set('image_model', REFERENCE)
    tools = GenerationTools(SimpleNamespace(offered_for=lambda member: []), service, conn)
    result = await tools.call('mcp:media/image_generate', {'prompt': 'A fox'}, approver='user')
    assert result.ok is True
    assert result.billing == {'model': REFERENCE, 'cost_usd': None, 'billing_source': 'subscription'}
    assert json.loads(result.text)['attachment']['mime'] == 'image/png'
    rows = list(conn.execute('SELECT purpose,model,cost_usd,prompt_tokens,completion_tokens FROM spend'))
    assert [tuple(row) for row in rows] == [('image', REFERENCE, 0, 12, 8)]
    ledger = Ledger(SpendTracker(conn))
    ledger.include_media(result.billing)
    assert ledger.total == 0 and ledger.calls[-1]['cost_usd'] is None
    assert ledger.calls[-1]['outcome'] == 'subscription'
    assert len(list(conn.execute('SELECT * FROM spend'))) == 1


async def test_signed_out_member_tool_has_existing_repair_shape(conn, tmp_path):
    subscription, children = backend(tmp_path, 'signed-out')
    service = Generation(SimpleNamespace(media_choices=lambda kind: []), AttachmentStore(tmp_path), subscription_images=subscription)
    from raphael_core.brain.settings import SettingsStore
    SettingsStore(conn).set('image_model', REFERENCE)
    tools = GenerationTools(SimpleNamespace(offered_for=lambda member: []), service, conn)
    result = await tools.call('mcp:media/image_generate', {'prompt': 'A fox'}, approver='user')
    assert result.kind == 'auth_expired'
    assert json.loads(result.text)['missing'] == {'resource': 'codex', 'requirement': 'cli', 'state': 'missing', 'repair': 'models'}
    assert not children.made and not list(conn.execute('SELECT * FROM spend'))


@pytest.mark.parametrize('state,kind', [('success', None), ('signed-out', 'auth_expired'),
    ('refusal', 'content_policy'), ('timeout', 'timeout'), ('non-image', 'bad_response'),
    ('unsupported', 'invalid_request')])
async def test_chatgpt_responses_image_contract_without_codex_or_api_fallback(state, kind):
    requests = []
    async def handle(request):
        requests.append(request)
        if state == 'timeout':
            raise httpx.ReadTimeout('synthetic')
        if state == 'unsupported':
            return httpx.Response(400, json={'error': {'code': 'subscription_sharing_unsupported_capability', 'param': 'tools'}})
        items = [{'type': 'image_generation_call', 'status': 'completed', 'result': base64.b64encode(PNG).decode()}]
        if state == 'refusal':
            items = [{'type': 'message', 'content': [{'type': 'refusal', 'refusal': 'private refusal'}]}]
        if state == 'non-image':
            items = [{'type': 'message', 'content': [{'type': 'output_text', 'text': 'No image'}]}]
        packets = [{'type': 'response.output_item.done', 'item': item} for item in items]
        packets.append({'type': 'response.completed', 'response': {'status': 'completed', 'output': []}})
        return httpx.Response(200, content=''.join('data: ' + json.dumps(p) + '\n\n' for p in packets))
    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as http:
        auth = SimpleNamespace(access_token=AsyncMock(return_value='synthetic'), session=lambda: 1,
                               check_session=lambda session: None, http=lambda: http)
        if state == 'signed-out':
            auth.access_token.side_effect = OpenRouterError(0, 'auth_expired', 'synthetic')
        provider = ChatGPTProvider(auth)
        if kind:
            with pytest.raises(OpenRouterError) as caught:
                await provider.generate_image(model='chosen', prompt='A fox', square=True)
            assert caught.value.kind == kind
        else:
            result = await provider.generate_image(model='chosen', prompt='A fox', square=True)
            assert result.data == PNG
        assert len(requests) == (0 if state == 'signed-out' else 1)
        if requests:
            body = json.loads(requests[0].content)
            assert body['model'] == 'chosen' and body['stream'] is True
            assert body['tool_choice'] == {'type': 'image_generation'}
            assert body['tools'] == [{'type': 'image_generation', 'size': '1024x1024', 'output_format': 'png'}]
            assert str(requests[0].url) == 'https://api.openai.com/v1/responses'


def test_environment_removes_key_and_endpoint_overrides():
    assert environment({'OPENAI_API_KEY': 'x', 'OPENAI_BASE_URL': 'x', 'OTHER_ACCESS_TOKEN': 'x',
                        'RAPHAEL_ENDPOINT': 'https://openrouter.ai', 'CODEX_HOME': 'safe'}) == {'CODEX_HOME': 'safe'}


async def test_usage_analytics_preserves_codex_image_subscription_identity(conn):
    from raphael_core.brain.usage import UsageAnalytics

    now = 1800000000000
    conn.execute("INSERT INTO agent_turns(id,created_at_ms,session_id,question,route,prefix,text,status,cost_usd,model) VALUES(1,?,'s','Draw','answer','','ok','done',0,?)", (now, REFERENCE))
    result = await UsageAnalytics(conn, lambda: now).read({'range': '7d', 'tz': 'UTC'})
    model = result['members'][0]['models'][0]
    assert model['model'] == REFERENCE and model['cost_usd'] is None

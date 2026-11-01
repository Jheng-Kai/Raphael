"""Explicit media settings, never the conversational brain, authorize the separate API bill."""

import base64
import json
from types import SimpleNamespace

import httpx
import pytest

from raphael_core.brain.settings import SettingsStore
from raphael_core.services.attachment_store import AttachmentStore
from raphael_core.services.generation import Generation
from raphael_core.services.generation_tools import GenerationTools
from services.test_generation import PNG, registry


@pytest.mark.parametrize('brain', ['cli:codex:owner', '@chosen:chat', '@chosen:picture'])
async def test_unset_drawing_never_borrows_any_brain_or_calls_http(conn, tmp_path, brain):
    SettingsStore(conn).set('agent_model', brain)
    providers, http = registry([{'reference': '@chosen:picture', 'media': ['image']}],
                               lambda request: pytest.fail('Unset drawing must make no paid call'))
    try:
        tools = GenerationTools(SimpleNamespace(offered_for=lambda member: []), Generation(providers, AttachmentStore(tmp_path)), conn)
        result = await tools.call('mcp:media/image_generate', {'prompt': 'Office'}, approver='auto')
        assert not result.ok and result.kind == 'not_configured'
        assert 'drawing model' in result.text and 'paid API' in result.text
        assert conn.execute("SELECT count(*) FROM spend WHERE purpose='image'").fetchone()[0] == 0
    finally:
        await http.aclose()


@pytest.mark.parametrize('brain', ['cli:codex:owner', '@chosen:chat'])
async def test_explicit_drawing_model_is_called_once_and_billed_despite_brain_changes(conn, tmp_path, brain):
    settings = SettingsStore(conn)
    settings.set('agent_model', brain)
    settings.set('image_model', '@chosen:picture')
    seen = []
    def respond(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={'data': [{'b64_json': base64.b64encode(PNG).decode()}],
                                        'usage': {'cost': 0.042, 'prompt_tokens': 10, 'completion_tokens': 20}})
    providers, http = registry([{'reference': '@chosen:picture', 'media': ['image']}], respond)
    try:
        tools = GenerationTools(SimpleNamespace(offered_for=lambda member: []), Generation(providers, AttachmentStore(tmp_path)), conn)
        result = await tools.call('mcp:media/image_generate', {'prompt': 'Office'}, approver='auto')
        assert result.ok
        assert [row['model'] for row in seen] == ['picture']
        receipt = json.loads(result.text)
        assert receipt['model'] == '@chosen:picture' and receipt['cost_usd'] == .042
        spend = conn.execute("SELECT model,cost_usd FROM spend WHERE purpose='image'").fetchall()
        assert [tuple(row) for row in spend] == [('@chosen:picture', .042)]
        settings.set('agent_model', '@other:brain')
        assert 'picture' in json.dumps([tool.schema for tool in tools.offered_for(0)])
        again = await tools.call('mcp:media/image_generate', {'prompt': 'Another office'}, approver='auto')
        assert again.ok and [row['model'] for row in seen] == ['picture', 'picture']
        spend = conn.execute("SELECT model,cost_usd FROM spend WHERE purpose='image'").fetchall()
        assert [tuple(row) for row in spend] == [('@chosen:picture', .042), ('@chosen:picture', .042)]
    finally:
        await http.aclose()


async def test_removed_media_provider_never_falls_back(conn, tmp_path):
    SettingsStore(conn).set('image_model', '@gone:picture')
    providers, http = registry([{'reference': '@other:picture', 'media': ['image']}],
                               lambda request: pytest.fail('Never substitute another provider'))
    try:
        tools = GenerationTools(SimpleNamespace(offered_for=lambda member: []), Generation(providers, AttachmentStore(tmp_path)), conn)
        result = await tools.call('mcp:media/image_generate', {'prompt': 'Office'}, approver='auto')
        assert not result.ok and result.kind == 'not_configured'
    finally:
        await http.aclose()


async def test_catalog_offers_generation_only_models_and_preserves_media_prices(conn):
    from raphael_core.brain.openrouter import OpenRouterClient
    from raphael_core.brain.providers.registry import ProviderRegistry, ProviderRouter
    from raphael_core.brain.secrets import MemoryKeyStore
    from raphael_core.brain.service import Brain
    from raphael_core.router import Router
    keys = MemoryKeyStore()
    keys.set('fake')
    raw = {'id': 'test/image-only', 'name': 'Image only',
           'architecture': {'input_modalities': ['text', 'image'], 'output_modalities': ['image']},
           'pricing': {'prompt': '0.000002', 'image_output': '0.00003', 'per_image': '0.04', 'request': '0.05'}}
    def respond(request):
        assert request.url.path == '/api/v1/models' and request.url.params['output_modalities'] == 'all'
        return httpx.Response(200, json={'data': [raw]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        legacy = OpenRouterClient(keys.get, http=http)
        providers = ProviderRegistry(conn, legacy, keys, credential=lambda pid: keys, http=http)
        brain = Brain(conn, ProviderRouter(providers, legacy), keys, providers=providers)
        router = Router()
        brain.register(router)
        view = await router.call('models.catalog')
        assert 'test/image-only' not in [row['id'] for row in view['llm']]
        row = next(row for row in view['image'] if row['id'] == 'test/image-only')
        assert row['per_image'] == .04 and row['per_request'] == .05 and row['image_output_per_mtok'] == 30
        assert view['video'] == []
        assert SettingsStore(conn).get('image_model') == SettingsStore(conn).get('video_model') == ''
        await providers.aclose()


async def test_a_paid_text_only_image_response_is_still_billed_without_a_file(conn, tmp_path):
    SettingsStore(conn).set('image_model', '@chosen:picture')
    providers, http = registry([{'reference': '@chosen:picture', 'media': ['image']}],
                               lambda request: httpx.Response(200, json={'data': [], 'usage': {'cost': .015}}))
    try:
        tools = GenerationTools(SimpleNamespace(offered_for=lambda member: []), Generation(providers, AttachmentStore(tmp_path)), conn)
        result = await tools.call('mcp:media/image_generate', {'prompt': 'Office'}, approver='auto')
        assert not result.ok and result.kind == 'protocol'
        assert result.billing == {'model': '@chosen:picture', 'cost_usd': .015}
        assert not (tmp_path / 'attachments').exists()
        row = conn.execute("SELECT model,cost_usd FROM spend WHERE purpose='image'").fetchone()
        assert tuple(row) == ('@chosen:picture', .015)
    finally:
        await http.aclose()


def test_zero_request_fee_does_not_hide_image_token_cost_or_make_unknown_usage_free():
    from raphael_core.services.generation import media_cost
    rates = {'per_request': 0, 'price_in': 2, 'price_out': 12, 'image_output_per_mtok': 30}
    assert media_cost({}, rates)['cost_usd'] is None
    assert media_cost({'usage': {'prompt_tokens': 1000, 'completion_tokens': 2000,
                                'output_tokens_details': {'image_tokens': 1000}}}, rates)['cost_usd'] == .044
    assert media_cost({'usage': {'prompt_tokens': 1000, 'completion_tokens': 2000}}, rates)['cost_usd'] is None


def test_media_spend_remains_named_in_the_usage_bill(conn):
    from raphael_core.brain.spend import SpendTracker
    spend = SpendTracker(conn)
    for purpose, model, cost in [('image', '@chosen:picture', .042), ('video', '@chosen:movie', .12)]:
        spend.record(purpose=purpose, model=model, cost_usd=cost, prompt_tokens=0, completion_tokens=0)
    bill = spend.bill('all')
    amounts = {row['purpose']: row['cost_usd'] for row in bill['purposes']}
    assert amounts['image'] == .042 and amounts['video'] == .12
    assert 'other' not in amounts
    assert bill['cost_usd'] == pytest.approx(.162)


async def test_image_only_model_requests_only_its_declared_output(conn, tmp_path):
    from raphael_core.brain.openrouter import OpenRouterClient
    from raphael_core.brain.providers.registry import ProviderRegistry
    from raphael_core.brain.secrets import MemoryKeyStore
    keys = MemoryKeyStore()
    keys.set('fake')
    SettingsStore(conn).set('image_model', 'test/image-only')
    seen = []
    def respond(request):
        seen.append(json.loads(request.content))
        assert request.url.path == '/api/v1/chat/completions'
        assert seen[-1]['model'] == 'test/image-only' and seen[-1]['modalities'] == ['image']
        return httpx.Response(200, json={'choices': [{'message': {'images': [{'image_url': {
            'url': 'data:image/png;base64,' + base64.b64encode(PNG).decode()}}]}}], 'usage': {'cost': .04}})
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        legacy = OpenRouterClient(keys.get, http=http)
        providers = ProviderRegistry(conn, legacy, keys, credential=lambda pid: keys, http=http)
        providers.remember_openrouter_media([{'id': 'test/image-only', 'architecture': {
            'input_modalities': ['text'], 'output_modalities': ['image']}}])
        tools = GenerationTools(SimpleNamespace(offered_for=lambda member: []), Generation(providers, AttachmentStore(tmp_path)), conn)
        result = await tools.call('mcp:media/image_generate', {'prompt': 'Office'}, approver='auto')
        assert result.ok and len(seen) == 1
        assert result.billing == {'model': 'test/image-only', 'cost_usd': .04}
        await providers.aclose()

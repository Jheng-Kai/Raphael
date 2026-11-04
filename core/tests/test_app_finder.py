"""Catalog discovery and non-Google cards use real stores, policy and mocked provider HTTP."""
import json

import httpx
import pytest

from raphael_core.agent.harness_tools import DEFINITIONS, TIERS
from raphael_core.agent.policy import Tier
from raphael_core.connectors.cards import ConnectorCards
from raphael_core.connectors.finder import group_of, search_text
from raphael_core.evaluate.google_fixture import GoogleFixture
from test_connect_cards import Rig
from test_connectors import Platform


class CatalogPlatform(Platform):
    def __call__(self, request):
        path = request.url.path
        if path.endswith('/toolkits/categories'):
            return httpx.Response(200, json={"items": []})
        if path.endswith('/toolkits/spotify'):
            return httpx.Response(200, json={"slug": "spotify", "composio_managed_auth_schemes": ["oauth2"]})
        response = super().__call__(request)
        body = response.text.replace('gmail', 'spotify').replace('Gmail', 'Spotify').replace('GMAIL_', 'SPOTIFY_')
        if path.endswith('/toolkits'):
            value = json.loads(body)
            value['items'][0]['meta'] = {"description": "Listen to music playlists", "categories": ["media"], "logo": "https://logos.composio.dev/api/spotify"}
            body = json.dumps(value)
        return httpx.Response(response.status_code, text=body, headers={"content-type": "application/json"})


async def test_find_searches_shared_aliases_and_catalog_description_without_connecting(tmp_path, conn):
    platform = CatalogPlatform()
    rig = Rig(tmp_path, conn, GoogleFixture('nonce'), transport=httpx.MockTransport(platform))
    rig.vault.set('connectors:composio:key', 'ak_fixture')
    assert (await rig.cards.find('music playlists')) == {"apps": [{"id": "spotify", "name": "Spotify", "provider": "composio", "connected": False}]}
    assert (await rig.cards.find('行事曆'))['apps'][0]['id'] == 'googlecalendar'
    assert all(request.method == 'GET' for request in platform.requests)
    assert not rig.cards.cards_of(rig.turn) and not rig.resumed
    assert await rig.cards.resolve('unlisted-app') is None
    assert TIERS['find_app'] == TIERS['connect_app'] == Tier.T0
    assert 'enum' not in DEFINITIONS['connect_app']['parameters']['properties']['app']


@pytest.mark.parametrize('member', [0, 7])
async def test_any_catalog_card_retains_name_on_restart_uses_composio_not_private_google_and_resumes_once(tmp_path, conn, member):
    opened = []
    async def browser(url):
        opened.append(url)
    rig = Rig(tmp_path, conn, GoogleFixture('nonce'), transport=httpx.MockTransport(CatalogPlatform()), browser=browser)
    rig.vault.set('connectors:composio:key', 'ak_fixture')
    await rig.configure()
    app = await rig.cards.resolve('spotify')
    card = rig.cards.show(turn_id=rig.turn, member_id=member, conversation_id=None, app=app, language='en')
    assert card.view()['name'] == 'Spotify' and card.state == 'pending' and not rig.resumed
    restored = ConnectorCards(conn, rig.router, rig.connectors).store.get(card.id)
    assert restored.name == 'Spotify' and restored.provider == 'composio'
    assert restored.app_logo == app.logo == 'https://logos.composio.dev/api/spotify'
    assert restored.view()['logo'] == app.logo
    start, connected = await rig.connect(card)
    assert start['card']['state'] == 'authorizing'
    assert connected.state == 'connected' and len(opened) == 1 and rig.resumed == [rig.turn]
    await rig.connect(connected)
    assert rig.resumed == [rig.turn] and len(opened) == 1
    assert (await rig.cards.find('spotify'))['apps'][0]['connected']
    assert not rig.fixture.sign_ins


def test_search_vocabulary_and_groups_are_public_and_broad():
    assert 'gdrive' in search_text('googledrive', 'Google Drive', '')
    assert group_of(['customer support']) == 'sales'
    assert group_of(['unfamiliar provider category']) == 'other'


@pytest.mark.parametrize('member_chat', [False, True])
async def test_native_catalog_script_reaches_real_discovery_and_card_through_agent_rpc(tmp_path, monkeypatch, member_chat):
    from raphael_core.app import EchoClient
    from raphael_core.evaluate.guardian import Budget
    from raphael_core.evaluate.guardian_driver import RpcDriver
    from raphael_core.integrations.vault import CredentialVault

    monkeypatch.setenv('RAPHAEL_TEST_NATIVE', '1')
    monkeypatch.setenv('RAPHAEL_TEST_NATIVE_CATALOG', '1')
    monkeypatch.setattr(CredentialVault, 'get', lambda _, name: 'ak_fixture' if name == 'connectors:composio:key' else None)
    driver = RpcDriver(tmp_path, 'fake/echo', EchoClient(), Budget(10))
    try:
        platform = CatalogPlatform()
        driver.app.connectors.composio.http.transport = httpx.MockTransport(platform)
        member = (await driver.app.call('members.create', {'name': 'NativeConnector', 'role': 'Catalog audit'}))['member']['id'] if member_chat else 0
        await driver.ask('Find and connect Spotify. Do not read account data. [native-connect:spotify]', member=member)
        cards = driver.app._conn.execute('SELECT * FROM connect_cards').fetchall()
        assert len(cards) == 1 and cards[0]['app'] == 'spotify' and cards[0]['state'] == 'pending'
        assert cards[0]['member_id'] == member and cards[0]['resumed_at_ms'] is None
        steps = driver.app._conn.execute('SELECT tool,outcome FROM agent_steps WHERE turn_id=? ORDER BY n', (cards[0]['turn_id'],)).fetchall()
        assert [tuple(row) for row in steps] == [('find_app', 'ok'), ('connect_app', 'ok')]
        assert all(request.method == 'GET' for request in platform.requests)
        assert not driver.recorder.receipts
        history = driver.app.agent._history
        resumed = history.add(session_id='resumed', question='Continue', route='answer', prefix='', text='Done',
                              status='done', source='connector', member_id=member, source_turn_id=cards[0]['turn_id'])
        view = driver.app.agent._turn_views([history.get(resumed)])[0]
        assert not any(key in view for key in ('resumed_apps', 'resumed_app_names', 'resumed_app_logos'))
        store = driver.app.cards.store
        assert store.move(cards[0]['id'], 'authorizing').state == 'authorizing'
        assert store.move(cards[0]['id'], 'connected', tool_count=1).state == 'connected'
        view = driver.app.agent._turn_views([history.get(resumed)])[0]
        assert view['resumed_apps'] == ['spotify'] and view['resumed_app_names'] == ['Spotify']
        assert view['resumed_app_logos'] == [cards[0]['app_logo']]
    finally:
        await driver.aclose()

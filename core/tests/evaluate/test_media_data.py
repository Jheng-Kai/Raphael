"""The same configured media tools reach API, CLI MCP and routine artifacts."""

import base64
import asyncio
import json
from unittest.mock import AsyncMock
from types import SimpleNamespace

import httpx
import pytest

from p15a_brains import Stage
from background.conftest import Links, until
from raphael_core.background.host import WorkerHost
from raphael_core.brain.providers.clients import CompatibleProvider
from raphael_core.brain.settings import SettingsStore

PNG = b"\x89PNG\r\n\x1a\n" + bytes(16)
MP4 = b"\x00\x00\x00\x18ftypisom" + bytes(20)


@pytest.mark.parametrize('brain', ['A', 'C'])
async def test_member_image_and_routine_video_deliver_real_store_receipts(tmp_path, monkeypatch, brain):
    def act(user, tools, results):
        if not results:
            video = "movie" in str(user).lower()
            return "", [("media__video_generate" if video else "media__image_generate", {"prompt": "Office"})]
        return "MEDIA-READY" if 'attachment' in results[-1] else str(results[-1]), []
    owner = Stage(tmp_path, monkeypatch, brain, act)
    seen = []
    def respond(request):
        seen.append(request.url.path)
        if request.url.path.endswith(('/images/generations', '/images/edits')):
            return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(PNG).decode()}], "usage": {"cost": .042}})
        if request.url.path.endswith('/videos'):
            return httpx.Response(200, json={"id": "video-1", "status": "completed", "progress": 100, "usage": {"cost": .12}})
        return httpx.Response(200, content=MP4, headers={"Content-Type": "video/mp4"})
    http = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    provider = CompatibleProvider("openai", "https://chosen.example/v1", lambda: "fake", http=http)
    try:
        app = owner.app
        SettingsStore(app._conn).set('image_model', '@chosen:picture')
        SettingsStore(app._conn).set('video_model', '@chosen:movie')
        app.background._host = WorkerHost(connect=Links(), grace_s=.1)
        app.generation.providers = SimpleNamespace(
            media_choices=lambda kind: [{"reference": "@chosen:picture" if kind == 'image' else '@chosen:movie', "media": [kind], "image_input": True}],
            resolve=lambda reference: ('chosen', reference.split(':')[1]), config=lambda pid: {'kind': 'openai'}, client=lambda pid: provider)
        member = (await app.call("members.create", {"name": "Designer"}))["member"]["id"]
        result = await owner.driver.ask("Make an office picture", member=member, session="picture")
        assert result["status"] == "done" and "MEDIA-READY" in result["text"]
        rows = app._conn.execute("SELECT id FROM agent_turns WHERE member_id=?", (member,)).fetchall()
        from raphael_core.agent.history import AgentHistory
        messages = AgentHistory(app._conn).messages([row[0] for row in rows])
        assert any(json.loads(message['text']).get('attachment', {}).get('mime') == 'image/png'
                   for group in messages.values() for message in group if message['kind'] == 'media')
        assert '/v1/images/generations' in seen
        assert seen.count('/v1/images/generations') == 1
        steps = AgentHistory(app._conn).steps([row[0] for row in rows])
        bill = next(json.loads(step.detail) for group in steps.values() for step in group if step.server == 'media')
        assert bill == {'model': '@chosen:picture', 'cost_usd': .042}
        assert app._conn.execute('SELECT cost_usd FROM agent_turns WHERE id=?', (result['turn_id'],)).fetchone()[0] >= .042
        assert any('media__image_generate' in offered and 'media__video_generate' in offered for offered in owner.offered)
        picture = next(app.attachment_store.root.glob('*.png')).name
        owner.act = lambda user, tools, results: ('EDIT-READY', []) if results else ('', [
            ('media__image_generate', {'prompt': 'Change the title', 'images': [picture]})])
        owner.client.act = owner.act
        edited = await owner.driver.ask('Edit that office picture', member=member, session='edit-picture')
        assert edited['status'] == 'done' and '/v1/images/edits' in seen
        owner.act = act
        owner.client.act = act
        routine = (await app.call("routines.create", {"member_id":member, "title":"Office movie", "prompt":"Make office movie", "schedule":{"kind":"daily","time":"09:00"}}))["routine"]
        task_id = app.members._run(app.members.store.routine(routine['id']))
        await until(lambda: app.background.task(task_id).state in ('done', 'failed', 'cancelled'))
        task = app.background.task(task_id)
        assert task.state == 'done', (task.reason, task.report_text)
        assert '/v1/videos/video-1/content' in seen
        assert list(app.attachment_store.root.glob('*.mp4'))
        media = [m for m in AgentHistory(app._conn).messages([task.turn_id])[task.turn_id] if m['kind'] == 'media']
        assert any(json.loads(m['text']).get('attachment', {}).get('mime') == 'video/mp4' for m in media)
        spend = app._conn.execute("SELECT purpose,model,cost_usd FROM spend WHERE purpose IN ('image','video') ORDER BY id").fetchall()
        assert [tuple(row) for row in spend] == [('image', '@chosen:picture', .042), ('image', '@chosen:picture', .042), ('video', '@chosen:movie', .12)]
        video_steps = app.background._store.steps(task_id)
        assert any(step.server == 'media' and json.loads(step.detail)['model'] == '@chosen:movie' for step in video_steps)
        assert task.cost_usd >= .12
    finally:
        await http.aclose()
        await owner.aclose()


@pytest.mark.parametrize('brain', ['A', 'C'])
async def test_named_dataset_returns_tables_between_member_turns_and_routine(tmp_path, monkeypatch, brain):
    def act(user, tools, results):
        if not results:
            tool = next((name for name in tools if name.endswith('__dataset')), 'missing_dataset')
            return '', [(tool, {'action':'query','dataset':'sales','sql':'SELECT sum(total) AS total FROM data'})]
        return 'DATA-36' if '36' in results[-1] else str(results[-1]), []
    owner = Stage(tmp_path, monkeypatch, brain, act)
    try:
        app = owner.app
        app.background._host = WorkerHost(connect=Links(), grace_s=.1)
        member = (await app.call('members.create', {'name':'Analyst'}))['member']['id']
        app.vm.enabled = True
        app.vm.desktop = None
        monkeypatch.setattr(app.vm, 'start', AsyncMock())
        # This rig's two seams (start, execute) are a computer of the member's own. A new data folder's computer is
        # the shared one, whose first use asks the engine whether a screen is empty: CI has no Docker to ask. The
        # dataset on a shared computer is test_shared_datasets.py's and the acceptance run's.
        app.vm.settings.set('computer_vm_mode', 'per-bot')
        execute = AsyncMock(return_value={'exit_code':0,'output':json.dumps({'dataset':'sales','columns':['total'],'rows':[[36]]})})
        monkeypatch.setattr(app.vm, 'execute', execute)
        for session in ('first-data', 'continued-data'):
            result = await owner.driver.ask('Query the saved sales dataset', member=member, session=session)
            assert result['status'] == 'done' and 'DATA-36' in result['text']
        routine = (await app.call('routines.create', {'member_id':member,'title':'Sales','prompt':'Query saved sales dataset','schedule':{'kind':'daily','time':'09:00'}}))['routine']
        task_id = app.members._run(app.members.store.routine(routine['id']))
        await until(lambda: app.background.task(task_id).state in ('done','failed','cancelled'))
        assert app.background.task(task_id).state == 'done'
        assert 'DATA-36' in app.background.task(task_id).report_text
        assert execute.await_count == 3
        assert all(call.args[0] == app.vm.target(member) and '.raphael-data' in call.args[1] for call in execute.await_args_list)
    finally:
        await owner.aclose()


async def test_stopping_a_video_task_cancels_the_provider_and_never_publishes(tmp_path, monkeypatch):
    polling = asyncio.Event()
    deleted = asyncio.Event()
    def act(user, tools, results):
        if not results:
            return '', [('media__video_generate', {'prompt':'Office'})]
        return 'Finished', []
    owner = Stage(tmp_path, monkeypatch, 'A', act)
    async def respond(request):
        if request.method == 'POST':
            return httpx.Response(200, json={'id':'cancel-1','status':'queued'})
        if request.method == 'DELETE':
            deleted.set()
            return httpx.Response(200, json={'deleted':True})
        polling.set()
        await asyncio.Event().wait()
    http = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    provider = CompatibleProvider('openai','https://chosen.example/v1',lambda:'fake',http=http)
    try:
        app = owner.app
        SettingsStore(app._conn).set('video_model', 'fake/model')
        app.background._host = WorkerHost(connect=Links(), grace_s=.1)
        app.generation.providers = SimpleNamespace(
            media_choices=lambda kind: [{'reference': 'fake/model', 'media': ['video']}],
            resolve=lambda reference: ('chosen', reference), config=lambda pid: {'kind': 'openai'}, client=lambda pid: provider)
        member=(await app.call('members.create',{'name':'Video'}))['member']['id']
        routine=(await app.call('routines.create',{'member_id':member,'title':'Movie','prompt':'Make a movie','schedule':{'kind':'daily','time':'09:00'}}))['routine']
        task_id=app.members._run(app.members.store.routine(routine['id']))
        await asyncio.wait_for(polling.wait(), 10)
        await app.call('worker.cancel', {'task_id':task_id})
        await asyncio.wait_for(deleted.wait(), 10)
        await until(lambda: app.background.task(task_id).state == 'cancelled')
        assert not list(app.attachment_store.root.glob('*.mp4'))
    finally:
        await http.aclose()
        await owner.aclose()


@pytest.mark.parametrize('brain',['A','C'])
async def test_missing_media_is_a_visible_chat_notice_before_any_provider_call(tmp_path, monkeypatch, brain):
    def act(user, tools, results):
        return ('Set up images', []) if results else ('', [('media__image_generate', {'prompt':'Office'})])
    owner=Stage(tmp_path,monkeypatch,brain,act)
    try:
        app=owner.app
        result=await owner.driver.ask('Make an office picture',member=0,session='missing-media')
        assert result['status'] == 'done'
        from raphael_core.agent.history import AgentHistory
        ids=[row[0] for row in app._conn.execute('SELECT id FROM agent_turns')]
        messages=AgentHistory(app._conn).messages(ids)
        notices=[json.loads(message['text'])['missing'] for group in messages.values() for message in group
                 if message['kind'] == 'media' and 'missing' in json.loads(message['text'])]
        assert any(item['requirement'] == 'image_generation' and item['repair'] == 'models' for item in notices)
        assert not app.attachment_store.root.exists()
    finally:
        await owner.aclose()


@pytest.mark.parametrize('brain', ['A', 'C'])
@pytest.mark.parametrize('tool', ['image_generate', 'video_generate', 'dataset'])
@pytest.mark.parametrize('forbidden', [False, True])
async def test_allow_all_tools_keep_rules_and_the_selected_brain(tmp_path, monkeypatch, brain, tool, forbidden):
    from raphael_core.agent.safety import DENY
    from raphael_core.brain.settings import SettingsStore
    from raphael_core.services.attachments import Attachment
    def act(user, tools, results):
        if results:
            return str(results[-1]), []
        name = next((name for name in tools if name.endswith('__' + tool)), 'media__' + tool)
        args = {'action': 'query', 'dataset': 'sales', 'sql': 'SELECT 36'} if tool == 'dataset' else {'prompt': 'Office'}
        return '', [(name, args)]
    owner = Stage(tmp_path, monkeypatch, brain, act)
    try:
        app = owner.app
        SettingsStore(app._conn).set('action_mode', 'bypass')
        SettingsStore(app._conn).set('image_model', 'fake/model')
        SettingsStore(app._conn).set('video_model', 'fake/model')
        app.background._host = WorkerHost(connect=Links(), grace_s=.1)
        member = (await app.call('members.create', {'name': 'Maker'}))['member']['id']
        app.vm.enabled, app.vm.desktop = True, None
        monkeypatch.setattr(app.vm, 'start', AsyncMock())
        # This rig's two seams (start, execute) are a computer of the member's own. A new data folder's computer is
        # the shared one, whose first use asks the engine whether a screen is empty: CI has no Docker to ask. The
        # dataset on a shared computer is test_shared_datasets.py's and the acceptance run's.
        app.vm.settings.set('computer_vm_mode', 'per-bot')
        execute = AsyncMock(return_value={'exit_code': 0, 'output': '{"columns":["total"],"rows":[[36]]}'})
        monkeypatch.setattr(app.vm, 'execute', execute)
        provider = object()
        app.generation.providers = SimpleNamespace(
            media_choices=lambda kind: [{'reference': 'fake/model', 'media': [kind]}],
            resolve=lambda reference: ('chosen', reference), config=lambda pid: {'kind': 'openai'}, client=lambda pid: provider)
        image = AsyncMock(return_value=Attachment('office.png', 'image/png', PNG))
        video = AsyncMock(return_value=Attachment('office.mp4', 'video/mp4', MP4))
        monkeypatch.setattr(app.generation, '_image', image)
        monkeypatch.setattr(app.generation, '_video', video)
        if forbidden:
            app.safety_rules.create('Do not make media or work on datasets', DENY)
            monkeypatch.setattr(app.gate.safety.judge, 'matching', AsyncMock(return_value=frozenset({1})))
        if tool != 'video_generate':
            await owner.driver.ask('Make it', member=member, session='bypass-work')
        routine = (await app.call('routines.create', {'member_id': member, 'title': 'Make it', 'prompt': 'Make it',
                   'schedule': {'kind': 'daily', 'time': '09:00'}}))['routine']
        task_id = app.members._run(app.members.store.routine(routine['id']))
        await until(lambda: app.background.task(task_id).state in ('done', 'failed', 'cancelled', 'waiting'))
        task = app.background.task(task_id)
        if forbidden:
            # R-ROUTINE-05: a run whose one needed step the owner's rule refused did not do its work, so it is failed, not done.
            assert (task.state, task.reason) == ('failed', 'routine_refused'), (task.state, task.reason, task.report_text)
            assert 'safety rule' in task.report_text
        else:
            assert task.state == 'done', (task.state, task.reason, task.report_text)
        assert app._conn.execute('SELECT count(*) FROM owner_questions').fetchone()[0] == 0
        expected = 0 if forbidden else 1 if tool == 'video_generate' else 2
        assert (execute if tool == 'dataset' else image if tool == 'image_generate' else video).await_count == expected
        assert app._conn.execute('SELECT count(*) FROM computer_grants').fetchone()[0] == 0
    finally:
        await owner.aclose()

import asyncio
from types import SimpleNamespace

import pytest

from raphael_core.agent.service import _Ask
from raphael_core.services.attachment_store import AttachmentStore
from raphael_core.services.attachments import Attachment

from .test_service import make_rig, until  # noqa: F401
from .test_narration import chat, typed
from .test_inbox import blocked_cli


async def test_restart_drains_queued_with_attachments_but_never_replays_started(make_rig, client, tmp_path):
    store = AttachmentStore(tmp_path)
    rig = make_rig(attachment_store=store)
    conversation = rig.service.conversations.main(0)
    def admit(session, text, files=()):
        ask = _Ask(session_id=session, text=text, language='en', source='app', conversation_id=conversation, attachments=list(files))
        return rig.service._inbox.admit(ask, dict(text=text,language='en',source='app',attachments=[a.metadata() for a in files]))[0]
    started = admit('lost', 'Do not replay')
    rig.service._inbox.claim((0, conversation))
    saved = store.save(Attachment('sample.txt', 'text/plain', b'example'))
    queued = admit('queued', 'Read the stored example', [saved])
    await rig.service.aclose()
    restarted = make_rig(attachment_store=store)
    assert restarted.service.turn(started['turn_id']).status == 'expired'
    assert restarted.service._inbox.get(started['turn_id'])['outcome'] == 'lost'
    client.chats = [chat('Recovered queued request')]
    restarted.service.start()
    await until(lambda: restarted.service.turn(queued['turn_id']).status == 'done')
    assert len(client.chat_calls) == 1
    assert 'Read the stored example' in str(client.chat_calls[0]['messages'])
    assert restarted.service._inbox.get(queued['turn_id'])['outcome'] == 'completed'


async def test_claim_then_cancel_never_reaches_the_model_or_start_side_effects(make_rig, client, monkeypatch):
    rig = make_rig()
    entered, release = asyncio.Event(), asyncio.Event()
    restore = rig.service._restore_queued_ask
    async def paused(row):
        ask = await restore(row)
        entered.set()
        await release.wait()
        return ask
    monkeypatch.setattr(rig.service, '_restore_queued_ask', paused)
    pending = asyncio.create_task(typed(rig, 'Withdraw after claim'))
    await entered.wait()
    await rig.call('agent.cancel', {'session_id':'live'})
    release.set()
    await pending
    assert not client.chat_calls
    assert rig.service._inbox.find(0, rig.service.conversations.main(0), 'live')['outcome'] == 'cancelled'
    assert rig.service._history.for_session('live')[0].status == 'denied'


async def test_attachment_and_text_behind_it_keep_fifo_order(make_rig, monkeypatch, tmp_path):
    rig, first, release, calls = await blocked_cli(make_rig, monkeypatch, tmp_path)
    try:
        b = await typed(rig, 'Second')
        await rig.service.ask('file-third', 'Third with file', 'en', 'app', attachments=[Attachment('sample.txt','text/plain',b'example')])
        c = await typed(rig, 'Fourth')
        assert b['status'] == c['status'] == 'queued'
        release.set()
        await first
        await until(lambda: len(calls) == 4 and not rig.service._drains)
        assert all(text in call['user'] for text,call in zip(['Second','Third with file','Fourth'],calls[1:]))
    finally:
        release.set()
        await asyncio.gather(first, return_exceptions=True)


async def test_duplicate_request_reuses_queued_and_completed_turn(make_rig, client):
    rig = make_rig()
    client.chats = [chat('Only answer')]
    params = dict(session_id='deduplicated',text='Question',ui_language='en',source='app')
    first = await rig.service.ask(**params)
    second = await rig.service.ask(**params)
    assert second == first
    assert len(client.chat_calls) == 1
    assert len(rig.service._history.list()) == 1


async def test_queued_and_steered_messages_have_no_card_or_computer_side_effects(make_rig, client, monkeypatch):
    rig = make_rig()
    starts, denied = [], []
    computer = SimpleNamespace(stop_scope=lambda *a,**k: starts.append(a), stop_session=lambda *a:None, aclose=lambda:asyncio.sleep(0))
    rig.service._computer = computer
    monkeypatch.setattr(rig.service._confirmations, 'cancel_where', lambda predicate: denied.append(predicate) or [])
    entered, release = asyncio.Event(), asyncio.Event()
    async def slow(**kwargs):
        entered.set()
        await release.wait()
        return chat('Done with additions')
    client.chats = [slow, chat('Read addition'), chat('File answer')]
    first = asyncio.create_task(typed(rig, 'First'))
    await entered.wait()
    assert len(starts) == len(denied) == 1
    assert (await typed(rig, 'Steered'))['steered']
    assert (await rig.service.ask('queued-file','File request','en','app',attachments=[Attachment('sample.txt','text/plain',b'example')]))['status'] == 'queued'
    assert len(starts) == len(denied) == 1
    release.set()
    await first
    await until(lambda: not rig.service._drains)
    assert len(starts) == len(denied) == 2
    assert all(scope[:2] == (0, rig.service.conversations.main(0)) for scope in starts)


def test_computer_scope_ownership_protects_other_members():
    from raphael_core.computer.run import ComputerRuns
    runs = ComputerRuns(SimpleNamespace())
    stopped = []
    runs.active = SimpleNamespace(member_id=4,conversation_id=12,done=False,owner_has_control=False,stop=stopped.append)
    runs.stop_scope(3,12,'replaced')
    runs.stop_scope(4,13,'replaced')
    assert stopped == []
    runs.stop_scope(4,12,'replaced')
    assert stopped == ['replaced']


@pytest.mark.parametrize('method,params', [
    ('conversations.clear', {'id': 1}),
    ('agent.history.clear', {'member_id': 0}),
])
async def test_clearing_running_conversation_removes_queued_rows_without_draining(make_rig, monkeypatch, tmp_path, method, params):
    rig, first, release, calls = await blocked_cli(make_rig, monkeypatch, tmp_path)
    await typed(rig, 'Queued draft to clear')
    rig.service._background.forget_member = lambda member: None
    try:
        if method == 'conversations.clear':
            params = {'id': rig.service.conversations.main(0)}
        await rig.call(method, params)
        release.set()
        await asyncio.gather(first, return_exceptions=True)
        assert rig.conn.execute('SELECT COUNT(*) FROM agent_inbox').fetchone()[0] == 0
        assert not rig.service._drains
        assert len(calls) == 1
    finally:
        release.set()
        await asyncio.gather(first, return_exceptions=True)

import asyncio
import json
import sqlite3
import threading
from types import SimpleNamespace

import pytest

from raphael_core.agent.service import _Ask
from raphael_core.members.store import MemberStore
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
    await until(lambda: restarted.service.turn(queued['turn_id']).status == 'done' and not restarted.service._drains)
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
    turn = rig.service._history.for_session('live')[0]
    assert rig.service._inbox.get(turn.id)['outcome'] == 'cancelled'
    assert rig.service._inbox.find(0, turn.conversation_id, 'live') is None
    assert rig.service._history.for_session('live')[0].status == 'cancelled'


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


async def test_same_session_answers_three_sequential_messages(make_rig, client):
    rig = make_rig()
    client.chats = [chat(f'Answer {n}') for n in range(3)]
    replies = []
    for n in range(3):
        replies.append(await rig.service.ask('same-session', f'Question {n}', 'en', 'app'))
    assert [reply['text'] for reply in replies] == [f'Answer {n}' for n in range(3)]
    assert len({reply['turn_id'] for reply in replies}) == 3
    assert len(client.chat_calls) == 3
    for n, call in enumerate(client.chat_calls):
        assert f'Question {n}' in str(call['messages'])
    assert len(rig.service._history.list()) == 3
    for reply in replies:
        assert 'result' not in json.loads(rig.service._inbox.get(reply['turn_id'])['payload_json'])


async def test_lost_request_can_be_sent_again_after_restart(make_rig, client):
    rig = make_rig()
    conversation = rig.service.conversations.main(0)
    ask = _Ask(session_id='retry-lost', text='Recover this request', language='en', source='app', conversation_id=conversation)
    lost, _ = rig.service._inbox.admit(ask, dict(text=ask.text, language='en', source='app', attachments=[]))
    rig.service._inbox.claim((0, conversation))
    await rig.service.aclose()
    restarted = make_rig()
    restarted.service.start()
    await asyncio.sleep(0)
    assert not client.chat_calls
    assert restarted.service._inbox.get(lost['turn_id'])['outcome'] == 'lost'
    client.chats = [chat('Recovered answer')]
    reply = await restarted.service.ask('retry-lost', ask.text, 'en', 'app')
    assert reply['text'] == 'Recovered answer'
    assert reply['turn_id'] != lost['turn_id']
    assert len(client.chat_calls) == 1
    assert restarted.service._inbox.get(lost['turn_id'])['outcome'] == 'lost'


async def test_failed_request_can_be_sent_again(make_rig, client):
    rig = make_rig()
    client.chats = [ValueError('Synthetic failure'), chat('Retry answer')]
    first = await rig.service.ask('retry-failed', 'Try this request', 'en', 'app')
    assert rig.service._inbox.get(first['turn_id'])['outcome'] == 'failed'
    reply = await rig.service.ask('retry-failed', 'Try this request again', 'en', 'app')
    assert reply['text'] == 'Retry answer'
    assert reply['turn_id'] != first['turn_id']
    assert len(client.chat_calls) == 2


async def test_cancelled_request_can_be_sent_again(make_rig, client):
    rig = make_rig()
    entered, release = asyncio.Event(), asyncio.Event()
    async def slow(**kwargs):
        entered.set()
        await release.wait()
        return chat('Unsent answer')
    client.chats = [slow, chat('Retry after cancel')]
    first = asyncio.create_task(rig.service.ask('retry-cancelled', 'Cancel this request', 'en', 'app'))
    try:
        await asyncio.wait_for(entered.wait(), 2)
        await rig.call('agent.cancel', {'session_id': 'retry-cancelled'})
        await first
        old = rig.service._history.for_session('retry-cancelled')[0]
        assert rig.service._inbox.get(old.id)['outcome'] == 'cancelled'
        reply = await rig.service.ask('retry-cancelled', 'Try after cancellation', 'en', 'app')
        assert reply['text'] == 'Retry after cancel'
        assert reply['turn_id'] != old.id
        assert len(client.chat_calls) == 2
    finally:
        release.set()
        await asyncio.gather(first, return_exceptions=True)


async def test_cancel_during_retry_attachment_save_still_prevents_delivery(make_rig, client, monkeypatch, tmp_path):
    store = AttachmentStore(tmp_path)
    rig = make_rig(attachment_store=store)
    client.chats = [chat('Original answer'), chat('Must not run')]
    await rig.service.ask('cancel-retry', 'Original request', 'en', 'app')
    entered, release = threading.Event(), threading.Event()
    save = store.save
    def paused(attachment):
        entered.set()
        assert release.wait(5)
        return save(attachment)
    monkeypatch.setattr(store, 'save', paused)
    retry = asyncio.create_task(rig.service.ask('cancel-retry', 'Retry with a file', 'en', 'app',
                                              attachments=[Attachment('sample.txt', 'text/plain', b'example')]))
    try:
        await until(entered.is_set)
        await rig.call('agent.cancel', {'session_id': 'cancel-retry'})
        release.set()
        reply = await retry
        assert reply['turn_id'] == 0
        assert len(client.chat_calls) == 1
        assert len(rig.service._history.for_session('cancel-retry')) == 1
    finally:
        release.set()
        await asyncio.gather(retry, return_exceptions=True)


@pytest.mark.parametrize('with_id', [True, False])
async def test_withdrawn_request_can_be_sent_again_at_the_back(make_rig, monkeypatch, tmp_path, with_id):
    rig, first, release, calls = await blocked_cli(make_rig, monkeypatch, tmp_path)
    try:
        params = dict(session_id='retry-withdrawn', text='Withdraw then retry', ui_language='en', source='app')
        withdrawn = await rig.service.ask(**params)
        await rig.call('agent.history.retract', {'session_id': params['session_id'], 'turn_id': withdrawn['turn_id']})
        ahead = await typed(rig, 'Already waiting')
        retried = await rig.service.ask(**params)
        assert retried['status'] == 'queued'
        assert retried['turn_id'] != withdrawn['turn_id']
        assert await rig.service.ask(**params) == retried
        await rig.call('agent.history.retract', {'session_id': params['session_id'], **({'turn_id': retried['turn_id']} if with_id else {})})
        assert rig.service._inbox.get(withdrawn['turn_id'])['outcome'] == 'cancelled'
        assert rig.service._inbox.get(retried['turn_id'])['outcome'] == 'cancelled'
        final = await rig.service.ask(**params)
        assert final['turn_id'] > ahead['turn_id']
        release.set()
        await first
        await until(lambda: not rig.service._drains)
        assert len(calls) == 3
        assert 'Already waiting' in calls[1]['user']
        assert params['text'] in calls[2]['user']
        assert rig.service.turn(final['turn_id']).text == 'Answer 3'
    finally:
        release.set()
        await asyncio.gather(first, return_exceptions=True)


async def test_duplicate_queued_request_admits_one_turn_and_calls_model_once(make_rig, monkeypatch, tmp_path):
    rig, first, release, calls = await blocked_cli(make_rig, monkeypatch, tmp_path)
    try:
        params = dict(session_id='duplicate-queued', text='Run once', ui_language='en', source='app')
        queued = await rig.service.ask(**params)
        assert queued['status'] == 'queued'
        assert await rig.service.ask(**params) == queued
        assert len(rig.service._history.for_session(params['session_id'])) == 1
        release.set()
        await first
        await until(lambda: not rig.service._drains)
        assert len(calls) == 2
        assert params['text'] in calls[1]['user']
        assert rig.service.turn(queued['turn_id']).text == 'Answer 2'
    finally:
        release.set()
        await asyncio.gather(first, return_exceptions=True)


@pytest.mark.parametrize('state', ['queued', 'steering', 'started'])
async def test_request_uniqueness_only_covers_inflight_rows(make_rig, client, state):
    rig = make_rig()
    conversation = rig.service.conversations.main(0)
    params = dict(session_id='reused', question='A request', route='answer', prefix='', text='', status='queued',
                  conversation_id=conversation, admission=json.dumps(dict(text='A request', language='en', source='app')))
    old = rig.service._history.add(**params)
    rig.service._inbox.settle(old, 'completed')
    current = rig.service._history.add(**params)
    with rig.conn:
        rig.conn.execute('UPDATE agent_inbox SET state=? WHERE turn_id=?', (state, current))
    assert rig.service._inbox.find(0, conversation, 'reused')['turn_id'] == current
    ask = _Ask(session_id='reused', text='Duplicate', language='en', source='app', conversation_id=conversation)
    row, admitted = rig.service._inbox.admit(ask, {})
    assert not admitted and row['turn_id'] == current
    assert await rig.service.ask('reused', 'Duplicate', 'en', 'app') == {'status': 'queued', 'turn_id': current}
    assert not client.chat_calls
    with pytest.raises(sqlite3.IntegrityError):
        rig.service._history.add(**params)


async def test_stop_selects_inflight_scope_instead_of_a_later_terminal_row(make_rig, monkeypatch, tmp_path):
    rig, first, release, calls = await blocked_cli(make_rig, monkeypatch, tmp_path)
    try:
        conversation = rig.service.conversations.main(0)
        queued = await typed(rig, 'Return this queued message')
        other = rig.service.conversations.quick()
        terminal = rig.service._history.add(
            session_id='live', question='Finished elsewhere', route='answer', prefix='', text='Old answer',
            status='done', source='app', conversation_id=other,
            admission=json.dumps(dict(text='Finished elsewhere', language='en', source='app')),
        )
        rig.service._inbox.settle(terminal, 'completed')
        other_ask = _Ask(session_id='other-queued', text='Keep waiting elsewhere', language='en', source='app', conversation_id=other)
        kept, _ = rig.service._inbox.admit(other_ask, dict(text=other_ask.text, language='en', source='app'))
        stopped = await rig.call('agent.history.stop', {'session_id': 'live'})
        assert [item['text'] for item in stopped['returned']] == ['Return this queued message']
        assert rig.service._inbox.get(queued['turn_id'])['outcome'] == 'cancelled'
        assert rig.service._inbox.get(kept['turn_id'])['state'] == 'queued'
        assert rig.service.turn(terminal).text == 'Old answer'
        assert rig.service._inbox.get(terminal)['outcome'] == 'completed'
        assert rig.service.turn(queued['turn_id']).conversation_id == conversation
        release.set()
        await first
        assert len(calls) == 1
    finally:
        release.set()
        await asyncio.gather(first, return_exceptions=True)


async def test_stop_ignores_terminal_history_owned_by_another_member(make_rig, client):
    rig = make_rig()
    conversation = rig.service.conversations.main(0)
    ask = _Ask(session_id='shared-session', text='Return my draft', language='en', source='app', conversation_id=conversation)
    queued, _ = rig.service._inbox.admit(ask, dict(text=ask.text, language='en', source='app'))
    member = MemberStore(rig.conn).create_member(name='Example')
    other = rig.service.conversations.main(member.id)
    terminal = rig.service._history.add(
        session_id=ask.session_id, question='Finished for another member', route='answer', prefix='', text='Kept answer',
        status='done', source='app', member_id=member.id, conversation_id=other,
        admission=json.dumps(dict(text='Finished for another member', language='en', source='app')),
    )
    rig.service._inbox.settle(terminal, 'completed')
    stopped = await rig.call('agent.history.stop', {'session_id': ask.session_id})
    assert [item['text'] for item in stopped['returned']] == [ask.text]
    assert rig.service._inbox.get(queued['turn_id'])['outcome'] == 'cancelled'
    assert rig.service._inbox.get(terminal)['outcome'] == 'completed'
    assert rig.service.turn(terminal).text == 'Kept answer'
    assert not client.chat_calls


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

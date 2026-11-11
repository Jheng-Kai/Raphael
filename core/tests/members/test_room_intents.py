"""Durable source/recipient contracts, admission slices and visible failure states."""
import json
import sqlite3

import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.members.rooms import RoomsService
from .test_exchanges import exchange, team, send, finish, history, meeting_source  # noqa: F401


async def test_each_member_decides_on_its_own_model_and_an_address_asks_no_one_else(rig, exchange):
    room, ids = await team(rig)
    await rig.call('members.update', {'id':ids[0], 'model':'@chatgpt:gpt-x?effort=high'})
    await rig.call('members.update', {'id':ids[1], 'model':'fake/api'})
    exchange._settings.set('agent_model', 'cli:codex:fixture')
    await send(rig, room, 'Review the sources')
    await finish(rig, exchange, 'Reviewed')
    assert [(s['member_id'], s['model']) for s in rig.background.submitted] == [
        (0, 'cli:codex:fixture'), (ids[0], '@chatgpt:gpt-x?effort=high'), (ids[1], 'fake/api')]
    await finish(rig, exchange, '(pass)')
    await finish(rig, exchange, '(pass)')
    await send(rig, room, '@Alice inspect', 'two')
    assert [s['member_id'] for s in rig.background.submitted[3:]] == [ids[0]]


async def test_a_spaced_address_still_hands_the_turn_to_that_colleague(rig, exchange):
    # Models often write 「@ 名字」; dropping the whole reply for it lost a moderator's opening live.
    room, ids = await team(rig)
    await send(rig, room, '@Alice open the review')
    await finish(rig, exchange, 'Opening. @ Bob please start')
    assert rig.background.submitted[-1]['member_id'] == ids[1]
    alice = next(m for m in (await history(rig, room))['messages'] if m['member_id'] == ids[0])
    assert (alice['status'], alice['text']) == ('done', 'Opening. @Bob please start')


async def three(rig):
    room, ids = await team(rig)
    carol = (await rig.call('members.create', {'name':'Carol', 'role':'QA'}))['member']['id']
    room = (await rig.call('rooms.create', {'name':'Review', 'member_ids':[0, *ids, carol]}))['room']
    return room, [*ids, carol]


async def test_two_colleagues_addressing_one_member_get_a_single_reply(rig, exchange):
    # Live, RD answered three times in a row: once per @ and once more for the planned turn.
    room, (alice, bob, carol) = await three(rig)
    await send(rig, room, '@Alice @Bob review the launch plan')
    await finish(rig, exchange, '@Carol please check the budget')
    await finish(rig, exchange, '@Carol please check the timing')
    assert rig.background.submitted[-1]['member_id'] == carol
    await finish(rig, exchange, 'Budget and timing both hold.')
    assert [s['member_id'] for s in rig.background.submitted].count(carol) == 1
    intents = (await history(rig, room))['exchange']['reply_intents']
    assert [i['state'] for i in intents if i['recipient_id'] == carol] == ['done', 'done']


async def test_a_member_who_just_answered_is_not_given_another_turn_by_its_role(rig, exchange):
    room, (alice, bob, carol) = await three(rig)
    await rig.call('rooms.update', {'room_id':room['id'], 'roles':{str(alice):'moderator'}})
    await send(rig, room, '@Alice plan the launch')
    await finish(rig, exchange, '@Bob what is your view?')
    assert rig.background.submitted[-1]['member_id'] == bob
    await finish(rig, exchange, 'I favour a small test first.')
    assert len(rig.background.submitted) == 2
    assert (await history(rig, room))['exchange']['state'] == 'done'


async def test_a_trailing_pass_is_not_shown(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, '@Alice review', ui_language='zh-TW')
    await finish(rig, exchange, '看起來沒問題。 (pass)')
    alice = next(m for m in (await history(rig, room))['messages'] if m['member_id'] == ids[0])
    assert alice['text'] == '看起來沒問題。'


async def test_source_replay_and_rename_cannot_extend_the_reply_budget(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, '@Alice start')
    for n in range(3):
        peer = 'Bob' if n % 2 == 0 else 'Alice'
        previous = rig.background.attached[-1][1]
        await finish(rig, exchange, '@' + peer + ' continue')
        count = len(rig.background.submitted)
        exchange.turn_arrived(previous)
        await exchange.wait_idle()
        assert len(rig.background.submitted) == count
    await rig.call('members.update', {'id':ids[0], 'name':'Anna'})
    assert len(rig.background.submitted) == 3
    result = await history(rig, room)
    assert (result['exchange']['state'], result['exchange']['reason']) == ('stopped', 'reply_budget')
    intents = result['exchange']['reply_intents']
    assert len({(i['source_message_id'], i['recipient_id']) for i in intents}) == len(intents)
    assert [i['state'] for i in intents] == ['done', 'done', 'done', 'blocked']
    assert all(m['reply_to_member'] != m['member_id'] for m in result['messages'] if m['reply_to'] is not None and m['member_id'] is not None)


@pytest.mark.parametrize('action,reason', [('stop','owner'), ('cost','cost'), ('remove','revoked')])
async def test_accepted_intents_become_named_blocks(rig, exchange, action, reason):
    room, ids = await team(rig)
    await send(rig, room, '@Alice and @Bob answer')
    if action == 'stop':
        await rig.call('rooms.stop', {'room_id':room['id']})
    elif action == 'remove':
        await rig.call('rooms.update', {'room_id':room['id'], 'member_ids':[0,ids[0]]})
    await finish(rig, exchange, 'Ready', cost=10 if action=='cost' else .001)
    await finish(rig, exchange, 'Ready')
    result = await history(rig, room)
    blocked = [i for i in result['exchange']['reply_intents'] if i['state']=='blocked']
    assert [(i['recipient_id'],i['reason']) for i in blocked] == ([(member,reason) for member in ids] if action=='stop' else [(ids[1],reason)] if action=='remove' else [])
    assert result['exchange']['state'] == 'stopped'
    summaries=[m for m in result['messages'] if m['kind']=='wrapup']
    if reason == 'owner':
        # The owner's Stop is closed in words; a failure is only its status lines.
        assert len(summaries)==1 and summaries[0]['member_id']==0 and result['messages'][-1]['kind']=='wrapup'
        assert summaries[0]['text'].split('\n')[0] == '已停止本次工作，已完成的動作保留。'
    else:
        assert not summaries
    await exchange._exchanges.drive(room['id'])
    assert len([m for m in (await history(rig,room))['messages'] if m['kind']=='wrapup'])==len(summaries)


LIMITED = 'Codex CLI 目前請求太頻繁而被限流，請稍後再試。'


async def fail(rig, exchange, reason='cli_rate_limited'):
    task_id, turn = next((task, turn) for task, turn in rig.background.attached if AgentHistory(rig.conn).get(turn).status == "running")
    AgentHistory(rig.conn).resolve(turn, prefix='', text=LIMITED, status='error')
    rig.background.store.finish(task_id, 'failed', prefix='', text=LIMITED, detail=None, reason=reason)
    exchange.turn_arrived(turn)
    await exchange.wait_idle()


def wrapups(result):
    return [m['text'] for m in result['messages'] if m['kind'] == 'wrapup']


async def test_a_failed_reply_blocks_only_its_intent_and_the_room_says_who_did_not_finish(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, '@Alice and @Bob answer')
    await fail(rig, exchange)
    assert [s['member_id'] for s in rig.background.submitted] == ids
    await finish(rig, exchange, 'Ready')
    result = await history(rig, room)
    # The blocked intent is the room's line for Alice; no one speaks for her and nothing sums it up.
    assert [(i['recipient_id'], i['state'], i['reason']) for i in result['exchange']['reply_intents']] == [
        (ids[0], 'blocked', 'cli_rate_limited'), (ids[1], 'done', '')]
    assert not wrapups(result)
    assert [(m['member_id'], m['text']) for m in result['messages'] if m['member_id'] is not None] == [(ids[1], 'Ready')]


async def test_a_failed_meeting_turn_is_named_and_owner_stop_still_stops_everyone(rig, exchange):
    room, ids = await team(rig)
    await rig.call('rooms.update', {'room_id':room['id'], 'roles':{str(ids[0]):'moderator', str(ids[1]):'con'}})
    await send(rig, room, '@Alice @Bob discuss the evidence')
    await fail(rig, exchange)
    assert [s['member_id'] for s in rig.background.submitted] == ids
    await rig.call('rooms.stop', {'room_id':room['id']})
    await finish(rig, exchange, 'Evidence reviewed')
    result = await history(rig, room)
    assert len(rig.background.submitted) == 2
    assert (result['exchange']['state'], result['exchange']['reason']) == ('stopped', 'owner')
    assert [(i['recipient_id'], i['reason']) for i in result['exchange']['reply_intents']] == [(ids[0], 'cli_rate_limited'), (ids[1], 'owner')]
    [text] = wrapups(result)
    assert text.split('\n')[:2] == ['已停止本次工作，已完成的動作保留。', 'Alice：請求太頻繁而被限流']


async def test_a_reply_cut_off_by_the_owners_stop_is_not_called_an_error(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, '@Alice and @Bob answer')
    await rig.call('rooms.stop', {'room_id':room['id']})
    for task_id, turn in rig.background.attached:
        AgentHistory(rig.conn).resolve(turn, prefix='', text='Stopped.', status='denied')
        rig.background.store.finish(task_id, 'cancelled', prefix='', text='Stopped.', detail=None, reason='cancelled')
        exchange.turn_arrived(turn)
    await exchange.wait_idle()
    result = await history(rig, room)
    assert [(i['recipient_id'], i['reason']) for i in result['exchange']['reply_intents']] == [(ids[0], 'owner'), (ids[1], 'owner')]
    [text] = wrapups(result)
    assert text.split('\n')[:2] == ['已停止本次工作，已完成的動作保留。', '沒有已驗證的交付成果。']


async def test_a_failed_exchange_names_a_rate_limit_without_claiming_an_owner_stop(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, '@Alice and @Bob answer')
    await fail(rig, exchange)
    await finish(rig, exchange, 'Ready')
    result = await history(rig, room)
    assert (result['exchange']['state'], result['exchange']['reason']) == ('stopped', 'blocked_intents')
    assert [i['reason'] for i in result['exchange']['reply_intents'] if i['state'] == 'blocked'] == ['cli_rate_limited']
    assert not wrapups(result) and '已停止本次工作' not in json.dumps(result, ensure_ascii=False)


async def test_restart_settles_completed_source_once_and_preserves_queued_intents(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, '@Alice start')
    turn = rig.background.attached[-1][1]
    AgentHistory(rig.conn).resolve(turn, prefix='', text='@Bob check', status='done')
    await exchange.aclose()
    restored = RoomsService(rig.conn, members=rig.service, background=rig.background)
    restored.start()
    await restored.wait_idle()
    assert [s['member_id'] for s in rig.background.submitted] == ids
    await restored._exchanges.drive(room['id'])
    assert len(rig.background.submitted) == 2
    await restored.aclose()


async def test_blocked_wrapup_publication_is_atomic_and_retriable(rig, exchange):
    room, ids = await team(rig)
    await send(rig,room,'@Alice inspect')
    rig.conn.execute("CREATE TRIGGER fail_wrapup BEFORE INSERT ON room_messages WHEN NEW.kind='wrapup' BEGIN SELECT RAISE(ABORT,'fixture publication failure'); END")
    await rig.call('rooms.stop', {'room_id':room['id']})
    with pytest.raises(sqlite3.IntegrityError,match='fixture publication failure'):
        await finish(rig,exchange,'No result')
    assert not rig.conn.execute("SELECT 1 FROM agent_turns WHERE session_id LIKE 'room-stop:%'").fetchone()
    rig.conn.execute('DROP TRIGGER fail_wrapup')
    await exchange._exchanges.drive(room['id'])
    result=await history(rig,room)
    assert result['messages'][-1]['member_id']==0 and result['messages'][-1]['kind']=='wrapup'
    assert 'No verified deliverables' in result['messages'][-1]['text'] or '沒有已驗證的交付成果' in result['messages'][-1]['text']


async def test_served_mentions_remain_visible_after_the_recipient_is_renamed(rig,exchange):
    room,ids=await team(rig)
    await send(rig,room,'@Alice begin')
    await finish(rig,exchange,'@Bob inspect')
    await finish(rig,exchange,'Delivered')
    await rig.call('members.update',{'id':ids[1],'name':'Robert'})
    result=await history(rig,room)
    assert any(m['text']=='@Bob inspect' and m['status']=='done' for m in result['messages'])


async def test_source_settlement_is_atomic_with_its_reply_intent(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, '@Alice start')
    active = rig.background.attached[-1][1]
    rig.conn.execute("CREATE TRIGGER fail_settlement BEFORE UPDATE OF state ON room_reply_intents "
                     "WHEN NEW.state='done' BEGIN SELECT RAISE(ABORT,'fixture interruption'); END")
    with pytest.raises(sqlite3.IntegrityError, match='fixture interruption'):
        await finish(rig, exchange, '@Bob check')
    assert exchange._exchanges.get(1).active_turn == active
    assert rig.conn.execute('SELECT exchange_settled FROM room_messages WHERE turn_id=?', (active,)).fetchone()[0] == 0
    rig.conn.execute('DROP TRIGGER fail_settlement')
    await exchange._exchanges.drive(room['id'])
    assert [s['member_id'] for s in rig.background.submitted] == ids
    assert rig.conn.execute("SELECT COUNT(*) FROM room_reply_intents WHERE state='done'").fetchone()[0] == 1


async def test_restart_names_interrupted_speech_and_reoffers_each_intent_once(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, '@Alice and @Bob start')
    await exchange.aclose()
    restored = RoomsService(rig.conn, members=rig.service, background=rig.background)
    restored.start()
    await restored.wait_idle()
    result = await restored._messages({'room_id':room['id']})
    assert all(i['state']=='running' and i['restart_count']==1 for i in result['exchange']['reply_intents'])
    assert len(rig.background.submitted) == 4
    assert not wrapups(result)
    await restored.aclose()


@pytest.mark.parametrize('foreign_keys', [False, True])
async def test_a_missing_worker_turn_blocks_its_accepted_intent(rig, exchange, foreign_keys):
    room, ids = await team(rig)
    await send(rig, room, '@Alice start')
    active = rig.background.attached[-1][1]
    await exchange.aclose()
    rig.conn.execute(f'PRAGMA foreign_keys={int(foreign_keys)}')
    with rig.conn:
        rig.conn.execute('DELETE FROM agent_turns WHERE id=?', (active,))
    intent = rig.conn.execute('SELECT * FROM room_reply_intents').fetchone()
    assert intent['turn_id'] == (None if foreign_keys else active)
    restored = RoomsService(rig.conn, members=rig.service, background=rig.background)
    restored.start()
    await restored.wait_idle()
    result = await restored._messages({'room_id':room['id']})
    assert result['exchange']['reply_intents'][0]['state'] == 'blocked'
    assert len(rig.background.submitted) == 1
    await restored.aclose()


async def test_a_named_moderator_has_no_scheduled_turns_or_conclusion(rig, exchange):
    room, ids = await team(rig)
    await rig.call('rooms.update', {'room_id':room['id'], 'roles':{str(ids[0]):'moderator',str(ids[1]):'con'}})
    await send(rig, room, 'Discuss the evidence')
    # The room's default responder answers first, not the moderator; the moderator then reads it like anyone else.
    assert [s['member_id'] for s in rig.background.submitted] == [0]
    await finish(rig, exchange, 'The evidence holds.')
    assert 'Otherwise reply with exactly (pass)' in rig.background.submitted[1]['text']
    await finish(rig, exchange, '(pass)')
    await finish(rig, exchange, 'Evidence reviewed')
    result = await history(rig, room)
    assert result['exchange']['state'] == 'done' and not [m for m in result['messages'] if m['kind'] == 'wrapup']
    assert len(rig.background.submitted) == 3
    assert rig.service.speaker(ids[0]).role == 'PM'


async def test_a_meeting_keeps_every_participant_before_explicit_followup_addresses(rig, exchange):
    room, (alice, bob, carol) = await three(rig)
    await exchange.meeting({'member_ids':[0,alice,bob,carol], 'agenda':'@Bob review the launch',
                            'roles':{str(alice):'moderator',str(bob):'pro',str(carol):'con'}}, 'en', meeting_source(rig, 47))
    assert [s['member_id'] for s in rig.background.submitted] == [0]
    await finish(rig, exchange, '(pass)')
    assert rig.background.submitted[-1]['member_id'] == alice
    await finish(rig, exchange, 'Evidence reviewed.')
    assert rig.background.submitted[-1]['member_id'] == bob
    await finish(rig, exchange, 'Test first. @Carol what do you think?')
    assert rig.background.submitted[-1]['member_id'] == carol
    await finish(rig, exchange, 'Agreed.')
    result = await history(rig, room)
    assert result['exchange']['state'] == 'done'
    assert [(m['member_id'],m['kind']) for m in result['messages'] if m['member_id'] is not None] == [
        (0,'message'),(alice,'message'),(bob,'message'),(carol,'message')]


async def test_a_meeting_with_no_one_speaking_has_no_automatic_open_or_close(rig, exchange):
    room, ids = await team(rig)
    await exchange.meeting({'member_ids':[0,*ids], 'agenda':'Thanks everyone',
                            'roles':{str(ids[0]):'moderator',str(ids[1]):'con'}}, 'en', meeting_source(rig, 48))
    for _ in [0,*ids]:
        await finish(rig, exchange, '(pass)')
    assert [s['member_id'] for s in rig.background.submitted] == [0,*ids]
    assert (await history(rig, room))['exchange']['state'] == 'done'


async def test_a_reused_meeting_keeps_only_the_roles_the_owner_requested(rig, exchange):
    room, ids = await team(rig)
    await rig.call('rooms.update', {'room_id':room['id'], 'roles':{str(ids[0]):'moderator'}})
    await exchange.meeting({'member_ids':[0,*ids], 'agenda':'Next release'}, 'en', meeting_source(rig, 49))
    assert (await rig.call('rooms.list'))['rooms'][0]['roles'] == {}
    assert rig.background.submitted[0]['member_id'] == 0


async def test_meeting_reuses_exact_members_and_has_one_agenda(rig, exchange):
    room, ids = await team(rig)
    args = {'member_ids':[0,*ids], 'agenda':'Review evidence'}
    first = await exchange.meeting(args, 'en', meeting_source(rig, 42))
    second = await exchange.meeting(args, 'en', meeting_source(rig, 42))
    assert first['room_id'] == second['room_id'] == room['id']
    assert second['duplicate']
    assert len([m for m in (await history(rig, room))['messages'] if m['text'] == 'Review evidence']) == 1
    assert len(rig.background.submitted) == 1


async def test_meeting_roles_accept_names_and_a_supporting_part(rig, exchange):
    # Live, a model keyed roles by name or gave a colleague a part outside the enum, and the meeting never opened.
    room, ids = await team(rig)
    result = await exchange.meeting({'member_ids':[0,*ids], 'agenda':'Plan the launch',
                                     'roles':{'Alice':'moderator', 'Bob':'social content'}}, 'en', meeting_source(rig, 43))
    assert result['room_id'] == room['id']
    roles = (await rig.call('rooms.list'))['rooms'][0]['roles']
    assert roles == {str(ids[0]):'moderator', str(ids[1]):'participant'}


@pytest.mark.parametrize('parts,expected', [
    ({'Alice':'主持人', 'Bob':'正方', 'Carol':'反方'}, ['moderator', 'pro', 'con']),
    ({'Alice':'Chair', 'Bob':'for', 'Carol':'against'}, ['moderator', 'pro', 'con']),
    ({'Alice':'社群內容補充', 'Bob':'content for the launch', 'Carol':'pro side'}, ['participant', 'participant', 'pro'])])
async def test_meeting_roles_understand_the_owners_words(rig, exchange, parts, expected):
    # Live, every part the model named fell outside the four words, so the meeting lost its moderator.
    room, ids = await three(rig)
    await exchange.meeting({'member_ids':[0,*ids], 'agenda':'Plan the launch', 'roles':parts}, 'zh-TW', meeting_source(rig, 44))
    roles = next(r for r in (await rig.call('rooms.list'))['rooms'] if r['id'] == room['id'])['roles']
    assert [roles[str(i)] for i in ids] == expected


async def test_snapshot_schema_is_current_and_secret_free(rig):
    first = rig.service.team_context(0, 'en')
    assert first['count'] == len(first['members']) == 1 and first['self_id'] == 0
    assert first['primary_id'] == first['chief_id'] == 0
    member = (await rig.call('members.create', {'name':'Alice', 'role':'Researcher'}))['member']
    second = rig.service.team_context(member['id'], 'en')
    assert second['count'] == 2 and second['revision'] != first['revision']
    rig.service._connections = lambda: [{'id':'one','name':'Mail','enabled':True,'status':'error','error':'auth','token':'never-public'}]
    third = rig.service.team_context(member['id'], 'en')
    assert third['apps'][0]['state'] == 'needs_sign_in'
    assert 'never-public' not in json.dumps(third)
    await rig.call('members.update', {'id':member['id'], 'name':'Renamed'})
    assert rig.service.team_context(0, 'en')['revision'] != third['revision']
    rig.service._connections = lambda: []
    assert not rig.service.team_context(0, 'en')['apps']


async def test_quotes_code_and_plain_names_do_not_create_intents(rig, exchange):
    room, ids = await team(rig)
    assert exchange._targets(room, 'Alice; `@Bob`; ```\n@Alice\n```\n> @Bob\n"@Alice" jo@Bob.com') == []


@pytest.mark.parametrize('action', ['stop','interjection'])
async def test_a_newer_owner_message_or_stop_leaves_no_one_still_to_read_the_old_one(rig, exchange, action):
    room, ids = await team(rig)
    await send(rig, room, 'Choose a lead')
    assert [s['member_id'] for s in rig.background.submitted] == [0]
    if action == 'stop':
        await rig.call('rooms.stop', {'room_id':room['id']})
    else:
        await send(rig, room, '@Bob latest question', 'two')
    await finish(rig, exchange, 'Alice should lead.')
    assert [s['member_id'] for s in rig.background.submitted] == ([0] if action=='stop' else [0, ids[1]])


async def test_reply_target_and_other_explicit_mentions_are_both_accepted(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, '@Alice check')
    await finish(rig, exchange, 'Ready')
    source = next(m for m in (await history(rig, room))['messages'] if m['member_id']==ids[0])
    await send(rig, room, '@Bob also check', 'two', reply_to=source['id'])
    assert [i['recipient_id'] for i in (await history(rig, room))['exchange']['reply_intents']] == ids

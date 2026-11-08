"""Owner meeting corrections, listener failures and publication retain every member's words."""
import json

from .test_exchanges import exchange, team, send, finish, history, meeting_source, Decision  # noqa: F401


async def test_a_failed_cli_listener_is_logged_retried_and_reported_without_being_heard(rig, exchange, caplog):
    room, ids = await team(rig)
    await rig.call('members.update', {'id':ids[0], 'model':'cli:claude:fixture?effort=high'})
    attempts = []
    async def broken(**kwargs):
        attempts.append(kwargs)
        raise ValueError('private diagnostic must never appear')
    rig.background.room_listener = broken
    exchange._exchanges.decision = Decision('Bob')
    await send(rig, room, 'Review the release', ui_language='en')
    assert len(attempts) == 2 and all(item['model'].endswith('?effort=high') for item in attempts)
    assert [row['member_id'] for row in rig.background.submitted] == [ids[1]]
    routing = (await history(rig, room))['exchange']['routing']
    failed = next(one for one in routing['listened'] if one['member'] == ids[0])
    assert not failed['speak'] and failed['failure'] == 'ValueError'
    assert failed['failures'] == ['ValueError', 'ValueError']
    assert caplog.text.count('kind=ValueError') == 2 and 'private diagnostic' not in caplog.text
    await finish(rig, exchange, 'Reviewed.')
    result = await history(rig, room)
    assert result['exchange']['state'] == 'stopped'
    assert 'Alice: unavailable (ValueError)' in result['messages'][-1]['text']


async def test_all_failed_listeners_are_not_counted_as_heard_or_given_fallback_speech(rig, exchange):
    room, _ = await team(rig)
    class Broken(Decision):
        async def room_listener(self, **kwargs):
            self.calls.append(kwargs)
            raise ConnectionError('private endpoint')
    decision = exchange._exchanges.decision = Broken()
    await send(rig, room, 'Review this', ui_language='en')
    assert len(decision.calls) == 6 and not rig.background.submitted
    result = await history(rig, room)
    assert result['exchange']['routing']['fallback'] == 'unavailable'
    assert result['exchange']['state'] == 'stopped'
    assert 'unavailable (ConnectionError)' in result['messages'][-1]['text']


async def test_a_listener_retries_once_and_keeps_the_failure_on_success(rig, exchange):
    room, ids = await team(rig)
    await rig.call('members.update', {'id':ids[0], 'model':'cli:codex:fixture'})
    calls = []
    async def flaky(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            raise TimeoutError()
        return {'speak':True,'urgency':1}
    rig.background.room_listener = flaky
    await send(rig, room, 'Review this')
    heard = next(one for one in (await history(rig, room))['exchange']['routing']['listened'] if one['member'] == ids[0])
    assert heard['failure'] == '' and heard['failures'] == ['timeout'] and len(calls) == 2
    assert rig.background.submitted[-1]['member_id'] == ids[0]


async def test_every_meeting_participant_gets_a_turn_and_corrections_wake_them_again(rig, exchange):
    room, ids = await team(rig)
    source = meeting_source(rig, 'all')
    result = await exchange.meeting({'room_id':room['id'],'agenda':'Review this release'}, 'en', source)
    assert result['state'] == 'running'
    assert [row['member_id'] for row in rig.background.submitted] == [0]
    # A repeated tool call cannot reset the queue or replay the first member.
    await exchange.meeting({'room_id':room['id'],'agenda':'Review this release'}, 'en', source)
    for expected in [*ids]:
        await finish(rig, exchange, '(pass)')
        assert rig.background.submitted[-1]['member_id'] == expected
    await finish(rig, exchange, 'The release needs one correction. (pass)')
    state = await history(rig, room)
    assert state['exchange']['state'] == 'done' and state['meeting']['state'] == 'done'
    assert rig.service.team_context(0, 'en')['meetings'][0]['state'] == 'done'
    assert state['messages'][-1]['text'] == 'The release needs one correction.'
    assert [row['member_id'] for row in rig.background.submitted] == [0,*ids]
    await send(rig, room, 'Correction: the release is tomorrow', key='correction')
    assert rig.background.submitted[-1]['member_id'] == 0
    for _ in [0,*ids]:
        await finish(rig, exchange, '(pass)')
    assert [row['member_id'] for row in rig.background.submitted] == [0,*ids,0,*ids]
    assert (await history(rig, room))['meeting']['state'] == 'done'


async def test_compact_overview_keeps_twelve_members_under_the_smallest_result_guard(rig):
    from raphael_core.worker.guards import wrap_untrusted, MIN_RESULT_CHARS
    for i in range(11):
        await rig.call('members.create', {'name':f'Member{i}', 'role':'Release reviewer'})
    result = await rig.service.admin_tool(0, 'team_overview', {})
    assert len(result['members']) == 12
    shown = wrap_untrusted('team_overview', json.dumps(result, ensure_ascii=False), ok=True, limit=MIN_RESULT_CHARS)
    assert 'cut_short' not in shown
    for row in result['members']:
        assert {'id','name','role','model','skills_count','commands_count','routines_count'} <= row.keys()
        assert row['name'] in shown and 'tools' not in row
    detail = await rig.service.admin_tool(0, 'team_overview', {'member_id':1})
    assert len(detail['members']) == 1 and detail['members'][0]['id'] == 1
    assert {'brain','tools','computer','routines'} <= detail['members'][0].keys()

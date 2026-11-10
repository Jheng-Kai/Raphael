"""Owner meeting corrections and publication retain every member's words."""
import json

from .test_exchanges import exchange, team, send, finish, history, meeting_source  # noqa: F401


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


async def test_an_addressed_meeting_followup_only_schedules_its_recipient(rig, exchange):
    room, ids = await team(rig)
    await exchange.meeting({'room_id':room['id'], 'agenda':'Review this release'}, 'en', meeting_source(rig, 'addressed'))
    for _ in [0, *ids]:
        await finish(rig, exchange, '(pass)')
    before = len(rig.background.submitted)
    await send(rig, room, '@Alice Execute your assigned work now', key='execute')
    assert [row['member_id'] for row in rig.background.submitted[before:]] == [ids[0]]
    await finish(rig, exchange, 'Started it in my own conversation.')
    assert len(rig.background.submitted) == before + 1
    assert (await history(rig, room))['exchange']['state'] == 'done'


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

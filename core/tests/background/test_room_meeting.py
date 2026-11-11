"""Meetings speak concurrently; work and approvals belong to private conversations."""
import asyncio
import json

import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.agent.speaker import RAPHAEL
from raphael_core.agent.tools import ToolResult
from raphael_core.background.service import ROOM_PARALLEL
from raphael_core.members.rooms import RoomsService
from raphael_core.members.service import MembersService
from .conftest import call, report, turn, until
from .test_handoff import args, setup


@pytest.fixture
async def meeting(make_rig, conn, tmp_path):
    rig = make_rig()
    members = MembersService(conn,tmp_path,background=rig.service,now_ms=rig.wall)
    alice = members.store.create_member(name='Alice',role='Engineer')
    rooms = RoomsService(conn,members=members,background=rig.service)
    rooms.register(rig.rpc)
    async def team_tool(speaker,name,arguments,**kwargs):
        if name == 'room_post':
            return ToolResult(name,True,rooms.post(speaker.id,arguments,kwargs['source_turn_id']))
        return ToolResult(name,True,{'answer':'A private colleague answer.'})
    rig.service.use_team(members,team_tool)
    notify = rig.service._notify
    def arrived(method,params):
        notify(method,params)
        if method == 'agent.turn':
            rooms.turn_arrived(params['turn_id'])
    rig.service._notify = arrived
    room = (await rooms._create({'name':'Meeting','member_ids':[0,alice.id]}))['room']
    try:
        yield rig,members,rooms,room,alice
    finally:
        await rooms.aclose()
        await members.aclose()


async def test_self_lane_reads_private_context_and_reports_a_short_card_once(meeting):
    rig,members,rooms,room,alice = meeting
    history = AgentHistory(rig.conn)
    history.add(session_id='old',question='PRIVATE-CONTEXT',route='answer',prefix='',text='Known privately.',status='done')
    request = {'member_id':0,'stage_id':'review','request':'Review this in private.','done_when':'A written review; no file required.'}
    written = 'The review confirms the sequence and documents its evidence and remaining limits. ' * 12
    rig.client.replies.extend([turn(calls=[call('handoff',request)]),report(written)])
    await rooms._send({'room_id':room['id'],'text':'@Raphael review','request_id':'self','ui_language':'en'})
    await until(lambda:rig.conn.execute("SELECT 1 FROM room_messages WHERE kind='report'").fetchone())
    task = rig.service._store.get(rig.conn.execute("SELECT id FROM worker_tasks WHERE mode='work'").fetchone()[0])
    private = history.get(task.turn_id)
    assert task.scope == private.scope == 'private' and private.conversation_id is not None
    assert task.room_id is None and private.room_id is None and task.report_room_id == room['id']
    assert task.parent_task_id is None and task.quiet
    assert 'PRIVATE-CONTEXT' in str(rig.client.chat_calls[1]['messages'])
    assert {t['function']['name'] for t in rig.client.chat_calls[0]['tools']} == {'handoff','room_post','ask_member','work_status'}
    response = await rooms._messages({'room_id':room['id']})
    card = next(m for m in response['messages'] if m['kind']=='report')
    assert card['member_id']==0 and card['status']=='done' and len(card['text'])<=600
    assert 'turn' not in card and card['report']['work_turn_id']==private.id
    rig.service._deliver_handoffs()
    await rooms.wait_idle()
    assert rig.conn.execute("SELECT COUNT(*) FROM room_messages WHERE kind='report'").fetchone()[0]==1
    assert rig.conn.execute('SELECT COUNT(*) FROM room_digest_requests WHERE message_id=?',(card['id'],)).fetchone()[0]==1
    assert not rig.service.waiting_questions()


async def test_status_board_keeps_running_work_ahead_of_queued_followups(meeting,monkeypatch):
    rig,members,rooms,room,alice=meeting
    monkeypatch.setattr(rig.service,'_ensure_pump',lambda:None)
    await rooms._send({'room_id':room['id'],'text':'@Raphael review','request_id':'board-priority'})
    source=rig.conn.execute("SELECT id FROM agent_turns WHERE scope='room'").fetchone()[0]
    request={'member_id':0,'stage_id':'current','request':'Review privately.','done_when':'A written review.'}
    first=rig.service.handoff(RAPHAEL,request,source_turn_id=source,language='en').data['task_id']
    rig.service._store.start(first)
    rig.service.handoff(RAPHAEL,{**request,'stage_id':'later'},source_turn_id=source,language='en')
    [row]=rooms.speech_context(room['id'],rig.task(first).report_thread_id)['board']
    assert row['title']=='Review privately.' and row['state']=='running' and row['stage_id']=='current'


async def test_speech_reads_work_status_through_the_shared_worker_without_starting_work(meeting):
    rig,members,rooms,room,alice=meeting
    rig.client.replies.extend([turn(calls=[call('work_status',{})]),report('No work has started yet.')])
    await rooms._send({'room_id':room['id'],'text':'@Alice check status','request_id':'read-status'})
    await until(lambda:rooms._exchanges.latest(room['id'])['state']=='done')
    assert len(rig.client.chat_calls)==2
    result=rig.client.chat_calls[1]['messages'][-1]['content']
    assert 'board' in result and 'decisions' in result
    assert not rig.conn.execute('SELECT 1 FROM worker_tasks WHERE mode IS NOT NULL').fetchone()
    assert not rig.service.waiting_questions()


async def test_all_speech_slots_run_while_the_same_member_has_private_work(meeting,monkeypatch):
    rig,members,rooms,room,alice=meeting
    started=[]
    release=asyncio.Event()
    async def hold(task,files=()):
        rig.service._store.start(task.id)
        started.append((task.id,task.scope,task.member_id))
        await release.wait()
    monkeypatch.setattr(rig.service,'_execute',hold)
    work=rig.service.submit(session_id='private',text='Work',language='en',model='fake/model')
    carol=members.store.create_member(name='Carol',role='Reviewer')
    for member in (alice.id,carol.id):
        rig.service.submit(session_id=f'private-{member}',text='Work',language='en',model='fake/model',member_id=member)
    await rooms._send({'room_id':room['id'],'text':'@everyone views','request_id':'all'})
    await until(lambda:len(started)==ROOM_PARALLEL+3)
    assert started[0]==(work,'private',0)
    assert {member for _,scope,member in started if scope=='room'}=={0,alice.id}
    assert {member for _,scope,member in started if scope=='private'}=={0,alice.id,carol.id}
    snapshots=rooms._exchanges.latest(room['id'])['active_turns']
    assert len(snapshots)==2 and len({r['seen_through'] for r in snapshots})==1
    await rooms._stop({'room_id':room['id']})
    release.set()


async def test_private_lane_approval_never_projects_a_card_into_the_meeting(meeting):
    rig,members,rooms,room,alice=meeting
    await rig.plugins.connect(look='T2')
    request={'member_id':0,'stage_id':'private-approval','request':'Check the connected source privately.',
             'done_when':'A tool receipt and written check.'}
    rig.client.replies.extend([turn(calls=[call('handoff',request)]),turn(calls=[call('use_tool',{'name':'Notes__look','arguments':{'topic':'review'}})])])
    await rooms._send({'room_id':room['id'],'text':'@Raphael check the source','request_id':'approval'})
    await until(lambda:bool(rig.service.waiting_questions()))
    [question]=rig.service.waiting_questions()
    lane=rig.task(question['task_id'])
    assert lane.scope=='private' and AgentHistory(rig.conn).get(lane.turn_id).scope=='private'
    result=await rooms._messages({'room_id':room['id']})
    assert result['pending_questions']==[]
    assert result['board'][0]['waiting_owner']==1
    assert all(not message.get('turn',{}).get('owner_question') for message in result['messages'])
    await rig.service.cancel_room(room['id'])


async def test_explicit_retry_keeps_the_private_lanes_report_destination(make_rig,monkeypatch):
    rig=make_rig()
    target,source=setup(rig)
    monkeypatch.setattr(rig.service,'_ensure_pump',lambda:None)
    identifier=rig.service.handoff(RAPHAEL,args(target),source_turn_id=source.id,language='en').data['task_id']
    rig.service._store.finish(identifier,'interrupted',prefix='',text='Interrupted.',detail=None,reason='restart')
    rerun=await rig.service._rerun({'task_id':identifier})
    task=rig.task(rerun['task_id'])
    assert task.scope=='private' and task.report_room_id==source.room_id and task.report_thread_id==source.thread_id
    assert task.stage_id=='draft' and task.source_turn_id==source.id and task.parent_task_id is None


async def test_speech_deadline_does_not_kill_the_private_workers_host(meeting,monkeypatch):
    from raphael_core.background.run import RunLimits
    rig,members,rooms,room,alice=meeting
    entered=asyncio.Event()
    async def private(**kwargs):
        entered.set()
        await asyncio.Event().wait()
    rig.client.replies.extend([private,private,report('The reply did not finish.')])
    work=rig.service.submit(session_id='held-private',text='Private work',language='en',model='fake/model')
    await entered.wait()
    rig.service._limits=RunLimits(seconds=.05)
    await rooms._send({'room_id':room['id'],'text':'@Alice speak','request_id':'deadline'})
    await until(lambda:rig.conn.execute("SELECT 1 FROM worker_tasks WHERE scope='room' AND state='limit'").fetchone())
    assert rig.task(work).state=='running'
    assert all(not link.killed for link in rig.links.made)
    await rig.service._cancel({'task_id':work})


async def test_speech_stopped_while_waiting_for_its_pool_never_starts(meeting):
    rig,members,rooms,room,alice=meeting
    for _ in range(ROOM_PARALLEL):
        await rig.service._room_slots.acquire()
    try:
        await rooms._send({'room_id':room['id'],'text':'@Alice review','request_id':'stop-before-admission'})
        await asyncio.sleep(0)
        await rooms._stop({'room_id':room['id']})
    finally:
        for _ in range(ROOM_PARALLEL):
            rig.service._room_slots.release()
    await until(lambda:not rig.service._active)
    assert not rig.client.chat_calls
    assert rig.conn.execute("SELECT state FROM worker_tasks WHERE scope='room'").fetchone()[0]=='cancelled'


async def test_stop_invalidates_all_room_lanes_before_any_transport_cancel(make_rig,monkeypatch):
    rig=make_rig()
    target,source=setup(rig)
    monkeypatch.setattr(rig.service,'_ensure_pump',lambda:None)
    first=rig.service.handoff(RAPHAEL,args(target,stage_id='one'),source_turn_id=source.id,language='en').data['task_id']
    second=rig.service.handoff(RAPHAEL,args(target,stage_id='two'),source_turn_id=source.id,language='en').data['task_id']
    seen=[]
    async def cancel(params):
        assert all(rig.task(identifier).generation>0 for identifier in (first,second))
        seen.append(params['task_id'])
        return {'cancelled':True}
    monkeypatch.setattr(rig.service,'_cancel',cancel)
    await rig.service.cancel_room(source.room_id)
    assert set(seen)=={first,second}


async def test_cancelled_lane_reports_without_starting_a_digest(meeting,monkeypatch):
    rig,members,rooms,room,alice = meeting
    thread=rig.conn.execute('SELECT id FROM room_threads WHERE room_id=?',(room['id'],)).fetchone()[0]
    source=AgentHistory(rig.conn).add(session_id='cancelled-lane',question='Discuss next steps',route='room',
        prefix='',text='',status='running',scope='room',room_id=room['id'],thread_id=thread)
    monkeypatch.setattr(rig.service,'_ensure_pump',lambda:None)
    task_id = rig.service.handoff(RAPHAEL,args(alice),source_turn_id=source,language='en').data['task_id']
    requested=[]
    settled=[]
    monkeypatch.setattr(rooms._exchanges,'digest',lambda *args:requested.append(args))
    monkeypatch.setattr(rooms._exchanges,'schedule',lambda room_id:settled.append(room_id))
    rig.service._store.finish(task_id,'cancelled',prefix='',text='Stopped.',detail=None,reason='cancelled')
    rig.service._deliver_handoffs()
    assert not requested
    assert settled == [room['id']]
    assert rig.conn.execute("SELECT kind FROM room_messages WHERE report_task_id=?",(task_id,)).fetchone()[0]=='report'


async def test_a_stage_keeps_one_owner_across_different_speech_snapshots(make_rig,monkeypatch):
    rig=make_rig()
    target,source=setup(rig)
    monkeypatch.setattr(rig.service,'_ensure_pump',lambda:None)
    first=rig.service.handoff(RAPHAEL,args(target,stage_id='one-stage'),source_turn_id=source.id,language='en')
    other=AgentHistory(rig.conn).add(session_id='new-snapshot',question='Check the stage',route='room',source='room',
        prefix='',text='',status='running',member_id=target.id,scope='room',room_id=source.room_id,thread_id=source.thread_id)
    refused=rig.service.handoff(target,args(target,member_id=0,stage_id='one-stage'),source_turn_id=other,language='en')
    assert first.ok and not refused.ok and refused.error=='stage_conflict'
    assert rig.conn.execute("SELECT COUNT(*) FROM worker_tasks WHERE mode='work'").fetchone()[0]==1
    owned=rig.service.handoff(RAPHAEL,args(target,member_id=0,stage_id='chief-stage'),source_turn_id=source.id,language='en')
    assert owned.ok
    lane=rig.task(first.data['task_id'])
    rig.service._store.start(lane.id)
    refused=rig.service.handoff(target,args(target,member_id=0,stage_id='chief-stage'),source_turn_id=lane.turn_id,language='en')
    assert not refused.ok and refused.error=='stage_conflict'


async def test_cli_members_choose_silence_on_their_own_brain(meeting,monkeypatch):
    from raphael_core.agent.cli.loop import CliLoop
    from raphael_core.worker.loop import Outcome
    rig,members,rooms,room,alice=meeting
    members.store.update_member(alice.id,model='cli:claude:fixture')
    rig.service.use_cli(object())
    observed=[]
    async def choose(loop):
        observed.append(loop)
        loop._queue.put_nowait(Outcome('done',final='(pass)'))
    monkeypatch.setattr(CliLoop,'_work',choose)
    # Raphael, the room's default responder, passes on thanks; Alice then reads that in a speech turn of her own.
    rig.client.replies.append(report('(pass)'))
    await rooms._send({'room_id':room['id'],'text':'Thanks','request_id':'quiet'})
    await until(lambda:rooms._exchanges.latest(room['id'])['state'] in ('done','stopped'))
    assert len(observed)==1 and observed[0].model=='cli:claude:fixture'
    assert observed[0].speech_only and observed[0].structured is None
    assert len(rig.client.chat_calls)==1
    assert rooms._exchanges.latest(room['id'])['state']=='done'
    assert not [m for m in (await rooms._messages({'room_id':room['id']}))['messages'] if m['member_id'] is not None]


async def test_a_reply_with_pass_suffix_is_saved_as_words_in_the_room_and_turn(meeting):
    rig, members, rooms, room, alice = meeting
    rig.client.replies.append(report('The source confirms the release date. (pass)'))
    await rooms._send({'room_id':room['id'],'text':'@Alice review','request_id':'suffix','ui_language':'en'})
    await until(lambda: rig.conn.execute("SELECT 1 FROM agent_turns WHERE scope='room' AND status='done'").fetchone())
    await rooms.wait_idle()
    row = rig.conn.execute('SELECT * FROM room_messages WHERE member_id=?', (alice.id,)).fetchone()
    saved = AgentHistory(rig.conn).get(row['turn_id'])
    assert row['text'] == saved.text == 'The source confirms the release date.'
    assert (await rooms._messages({'room_id':room['id']}))['messages'][-1]['text'] == saved.text



@pytest.mark.parametrize('language', ['zh-TW', 'en'])
async def test_a_stopped_rooms_wrap_up_names_work_by_title_and_never_by_code(meeting, monkeypatch, language):
    from raphael_core.background.handback import internal_ids
    rig,members,rooms,room,alice=meeting
    monkeypatch.setattr(rig.service,'_ensure_pump',lambda:None)
    await rooms._send({'room_id':room['id'],'text':'@Raphael review','request_id':'wrap','ui_language':language})
    source=rig.conn.execute("SELECT id FROM agent_turns WHERE scope='room'").fetchone()[0]
    request={'member_id':alice.id,'stage_id':'S2-03','request':'S2-03: Review the Q3 report. Check every table.','done_when':'A written review.'}
    task_id=rig.service.handoff(RAPHAEL,request,source_turn_id=source,language=language).data['task_id']
    await rooms._stop({'room_id':room['id']})
    await rooms.wait_idle()
    [wrapup]=[m for m in (await rooms._messages({'room_id':room['id']}))['messages'] if m['kind']=='wrapup']
    text=wrapup['text']
    assert 'Alice / Review the Q3 report.' in text
    assert 'S2-03' not in text and f'{task_id}' not in text.replace('Q3', '') and not internal_ids(text)


async def test_the_board_and_work_status_name_work_by_title_and_hand_over_no_numbers(meeting,monkeypatch):
    from raphael_core.agent.tools import ToolResult
    rig,members,rooms,room,alice=meeting
    monkeypatch.setattr(rig.service,'_ensure_pump',lambda:None)
    await rooms._send({'room_id':room['id'],'text':'@Raphael review','request_id':'titles'})
    source=rig.conn.execute("SELECT id FROM agent_turns WHERE scope='room'").fetchone()[0]
    request={'member_id':alice.id,'stage_id':'S2-03','request':'Review the Q3 report. Check every table.','done_when':'A written review.'}
    receipt=rig.service.handoff(RAPHAEL,request,source_turn_id=source,language='en')
    assert receipt.data['title']=='Review the Q3 report.' and receipt.data['member_name']=='Alice'
    shown=json.loads(json.dumps(receipt.shown))
    assert 'task_id' not in shown and 'work_turn_id' not in shown and 'root_task_id' not in shown
    assert shown['title']=='Review the Q3 report.' and shown['member_id']==alice.id
    board=rooms.speech_context(room['id'],rig.task(receipt.data['task_id']).report_thread_id)
    [row]=board['board']
    assert row['title']=='Review the Q3 report.' and row['stage_id']=='S2-03'
    assert not {'task_id','work_turn_id','conversation_id'} & set(row)
    status=ToolResult('work_status',True,board)
    assert 'task_id' not in json.dumps(status.shown)


def test_what_a_parent_is_told_of_delegated_work_names_it_and_hides_the_numbers():
    from raphael_core.background.service import HANDOFF_RESULTS_NOTE, _results_message
    message=_results_message([{'title':'Review the Q3 report.','member_name':'Alice','member_id':3,'state':'completed',
                               'work_location':{'member_id':3,'conversation_id':41,'work_turn_id':90},'exchange_turn_id':89,'evidence':[]}])
    assert 'Review the Q3 report.' in message and 'Alice' in message
    for number in ('conversation_id','work_turn_id','exchange_turn_id','task_id'):
        assert number not in message
    assert 'never said to the owner' in HANDOFF_RESULTS_NOTE and 'title' in HANDOFF_RESULTS_NOTE

"""Meeting cursors, attributed posts and restart close-out on synthetic data."""
from raphael_core.agent.history import AgentHistory
from raphael_core.members.rooms import RoomsService
from .test_exchanges import exchange, team, send, finish, history, Decision, meeting_source  # noqa: F401


async def test_speech_cursor_sends_only_new_messages_with_the_board(rig,exchange):
    room,ids=await team(rig)
    await send(rig,room,'@Alice OLD-QUESTION')
    await finish(rig,exchange,'OLD-ANSWER')
    await send(rig,room,'@Alice NEW-QUESTION','next')
    prompt=rig.background.submitted[-1]['text']
    assert 'NEW-QUESTION' in prompt and 'OLD-QUESTION' not in prompt
    assert 'OLD-ANSWER' in prompt  # The previous answer arrived after her prior snapshot.
    assert 'Status board and pinned decisions' in prompt
    assert rig.conn.execute('SELECT seen_message_id FROM room_member_cursor').fetchone()[0]==1


async def test_member_posts_and_chief_decisions_never_impersonate_owner_or_interrupt(rig,exchange):
    room,ids=await team(rig)
    await send(rig,room,'@Alice review')
    source=exchange._history.add(session_id='chief',question='Decision',route='answer',prefix='',text='',status='running')
    post=exchange.post(0,{'room_id':room['id'],'text':'Use one stage owner.','kind':'decision'},source)
    duplicate=exchange.post(0,{'room_id':room['id'],'text':'Use one stage owner.','kind':'decision'},source)
    assert duplicate['duplicate'] and duplicate['message_id']==post['message_id']
    message=rig.conn.execute('SELECT member_id,kind FROM room_messages WHERE id=?',(post['message_id'],)).fetchone()
    assert tuple(message)==(0,'decision')
    assert exchange._exchanges.get(1).reason==''
    result=await history(rig,room)
    assert result['decisions'][0]['text']=='Use one stage owner.'
    await exchange.wait_idle()
    assert rig.conn.execute('SELECT COUNT(*) FROM room_digest_requests').fetchone()[0]==1


async def test_startup_closes_interrupted_speech_and_reoffers_its_address_once(rig,exchange):
    room,ids=await team(rig)
    await send(rig,room,'@Alice review')
    task,turn=rig.background.attached[-1]
    AgentHistory(rig.conn).resolve(turn,prefix='',text='Interrupted.',status='error')
    rig.background.store.finish(task,'interrupted',prefix='',text='Interrupted.',detail=None,reason='restart')
    restored=RoomsService(rig.conn,members=rig.service,background=rig.background)
    restored.start()
    await restored.wait_idle()
    assert rig.conn.execute("SELECT COUNT(*) FROM room_messages WHERE kind='wrapup'").fetchone()[0]==1
    assert len(rig.background.submitted)==2
    assert rig.conn.execute('SELECT restart_count FROM room_reply_intents').fetchone()[0]==1
    task,turn=rig.background.attached[-1]
    AgentHistory(rig.conn).resolve(turn,prefix='',text='Interrupted again.',status='error')
    rig.background.store.finish(task,'interrupted',prefix='',text='Interrupted.',detail=None,reason='restart')
    again=RoomsService(rig.conn,members=rig.service,background=rig.background)
    again.start()
    await again.wait_idle()
    assert len(rig.background.submitted)==2
    assert rig.conn.execute('SELECT state FROM room_reply_intents').fetchone()[0]=='blocked'
    await restored.aclose()
    await again.aclose()


async def test_a_digest_cannot_extend_itself_by_reposting(rig,exchange):
    room,ids=await team(rig)
    exchange._exchanges.decision=Decision('Alice')
    source=exchange._history.add(session_id='private-review',question='Review',route='answer',prefix='',text='',status='running')
    exchange.post(0,{'room_id':room['id'],'text':'A new finding.'},source)
    await exchange.wait_idle()
    speech=rig.background.attached[-1][1]
    exchange.post(ids[0],{'room_id':room['id'],'text':'Acknowledged with a follow-up question.'},speech)
    await exchange.wait_idle()
    assert rig.conn.execute('SELECT COUNT(*) FROM room_digest_requests').fetchone()[0]==1
    assert rig.conn.execute("SELECT COUNT(*) FROM room_messages WHERE request_id LIKE 'post_%'").fetchone()[0]==2


async def test_chief_targets_an_existing_superset_room_without_faking_owner_input(rig,exchange):
    room,ids=await team(rig)
    result=await exchange.meeting({'room_id':room['id'],'agenda':'Review the release.','roles':{}},
                                  'en',meeting_source(rig,'target-existing'))
    assert result['room_id']==room['id'] and result['member_ids']==[0,*ids]
    messages=(await history(rig,room))['messages']
    assert len(messages)==1 and messages[0]['member_id']==0
    assert not rig.conn.execute('SELECT 1 FROM room_exchanges WHERE reason=\'interjection\'').fetchone()

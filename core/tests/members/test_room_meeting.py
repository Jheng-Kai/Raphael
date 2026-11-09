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
    await finish(rig,exchange,'(pass)')
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
    assert sum(m['text']=='Review the release.' for m in messages)==1 and messages[0]['member_id']==0
    assert all(m['author_kind']=='member' for m in messages)
    assert not rig.conn.execute('SELECT 1 FROM room_exchanges WHERE reason=\'interjection\'').fetchone()


def test_room_context_preserves_the_source_and_unicode_messages_without_partial_records():
    import json
    from raphael_core.members.exchanges import bounded_transcript
    source = {"id": 1, "text": "The exact question to answer", "attachments": [{"name": "plan.pdf"}]}
    huge = {"id": 2, "text": "合成舊記錄" * 5000}
    recent = {"id": 3, "text": "最新記錄" * 160}
    current = {"id": 4, "text": "Reply to message 1"}
    messages, folded = bounded_transcript([source, huge, recent, current], required=(1,), chars=2200, byte_limit=2200)
    assert messages == [source, recent, current] and folded == 1
    assert len(json.dumps(messages, ensure_ascii=False).encode("utf-8")) <= 2200
    # A giant current request is mandatory: the CLI reports it instead of changing its meaning.
    messages, folded = bounded_transcript([source, huge], chars=2200, byte_limit=2200)
    assert huge in messages and messages[-1]["text"] == huge["text"]


async def test_listener_overflow_uses_the_shared_sentence_in_the_requested_language(rig, exchange):
    from raphael_core.failures import Failure
    room, ids = await team(rig)
    rig.service.store.update_member(ids[0], model="cli:claude")
    await send(rig, room, "@Alice Review the next step")
    origin = exchange._exchanges.latest(room["id"])["origin_message_id"]
    with rig.conn:
        rig.conn.execute("UPDATE room_reply_intents SET state='blocked',reason='listener_context_overflow' WHERE origin_message_id=?", (origin,))
    for language in ("zh-TW", "en", "ja", "fr"):
        assert exchange._unfinished(origin, language) == [("Alice", Failure("context_overflow", "context_overflow").sentence("Claude Code", language))]

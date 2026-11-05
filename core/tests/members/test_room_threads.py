"""Side thread context includes its root and excludes room and sibling discussions."""
import pytest
from raphael_core.protocol import RpcError
from .test_rooms import rooms, create  # noqa: F401


async def test_thread_context_isolated_and_reactions_are_not_owner_answers(rig, rooms):
    room = await create(rig, [0])
    main = rooms._thread(room)
    with rig.conn:
        ids = []
        for text in ('Original result', 'Unrelated main message', 'Sibling result'):
            ids.append(rig.conn.execute('INSERT INTO room_messages(room_id,thread_id,text,created) VALUES(?,?,?,1)', (room['id'],main,text)).lastrowid)
    thread = (await rig.call('rooms.thread_open', {'room_id':room['id'],'message_id':ids[0]}))['thread_id']
    assert thread == (await rig.call('rooms.thread_open', {'room_id':room['id'],'message_id':ids[0]}))['thread_id']
    sibling = (await rig.call('rooms.thread_open', {'room_id':room['id'],'message_id':ids[2]}))['thread_id']
    with rig.conn:
        child = rig.conn.execute('INSERT INTO room_messages(room_id,thread_id,text,created) VALUES(?,?,?,2)', (room['id'],thread,'Thread reply')).lastrowid
        rig.conn.execute('INSERT INTO room_messages(room_id,thread_id,text,created) VALUES(?,?,?,2)', (room['id'],sibling,'Sibling secret'))
    await rig.call('rooms.react', {'room_id':room['id'],'message_id':ids[0],'emoji':'✓','active':True})
    context = rooms._exchanges.transcript(room,thread,since=child)
    assert [message['text'] for message in context] == ['Original result']
    context = rooms._exchanges.transcript(room,thread)
    assert [message['text'] for message in context] == ['Original result','Thread reply']
    assert context[0]['reactions'] == ['✓']
    assert 'never approval' in context[0]['reaction_note']
    main_view = await rig.call('rooms.messages', {'room_id':room['id']})
    assert [message['id'] for message in main_view['messages']] == ids
    assert main_view['messages'][0]['reply_count'] == 1
    side = await rig.call('rooms.messages', {'room_id':room['id'],'thread_id':thread})
    assert side['parent']['id'] == ids[0] and [message['id'] for message in side['messages']] == [child]
    with pytest.raises(RpcError):
        await rig.call('rooms.thread_open', {'room_id':room['id'],'message_id':child})
    with rig.conn:
        rig.conn.execute('DELETE FROM room_messages WHERE id=?', (ids[0],))
    assert rig.conn.execute('SELECT COUNT(*) FROM room_reactions').fetchone()[0] == 0
    assert rig.conn.execute('SELECT parent_message_id FROM room_threads WHERE id=?', (thread,)).fetchone()[0] is None


async def test_thread_and_reaction_cannot_cross_room_boundaries(rig, rooms):
    first = await create(rig,[0])
    second = await create(rig,first['member_ids'])
    with rig.conn:
        message = rig.conn.execute('INSERT INTO room_messages(room_id,thread_id,text,created) VALUES(?,?,?,1)', (first['id'],rooms._thread(first),'Private root')).lastrowid
    thread = (await rig.call('rooms.thread_open', {'room_id':first['id'],'message_id':message}))['thread_id']
    for method,params in [('rooms.messages',{'thread_id':thread}),('rooms.react',{'message_id':message,'emoji':'👍','active':True}),('rooms.thread_open',{'message_id':message})]:
        with pytest.raises(RpcError):
            await rig.call(method, {'room_id':second['id'],**params})


async def test_member_voice_memo_setting_defaults_off_and_persists_independently(rig):
    member = (await rig.call('members.create', {'name':'Memo speaker'}))['member']
    assert member['voice_memo'] is False and member['read_aloud'] is False
    await rig.call('members.update', {'id':member['id'],'voice_memo':True})
    stored = rig.service.store.member(member['id'])
    assert stored.voice_memo and not stored.read_aloud
    with pytest.raises(RpcError):
        await rig.call('members.update', {'id':member['id'],'voice_memo':'true'})


async def test_stopping_a_side_thread_leaves_the_main_exchange_running(rig, rooms, monkeypatch):
    room = await create(rig, [0])
    main = rooms._thread(room)
    with rig.conn:
        root = rig.conn.execute('INSERT INTO room_messages(room_id,thread_id,text,created) VALUES(?,?,?,1)', (room['id'],main,'Root')).lastrowid
    thread = (await rig.call('rooms.thread_open', {'room_id':room['id'],'message_id':root}))['thread_id']
    with rig.conn:
        side = rig.conn.execute('INSERT INTO room_messages(room_id,thread_id,text,created) VALUES(?,?,?,2)', (room['id'],thread,'Reply')).lastrowid
        for origin in (root, side):
            rig.conn.execute("INSERT INTO room_exchanges(origin_message_id,room_id,state,language) VALUES(?,?,'running','en')", (origin,room['id']))
    async def idle(room_id):
        pass
    monkeypatch.setattr(rooms._exchanges, 'drive', idle)
    await rig.call('rooms.stop', {'room_id':room['id'],'thread_id':thread})
    assert rooms._exchanges.get(side).stop_requested
    assert not rooms._exchanges.get(root).stop_requested

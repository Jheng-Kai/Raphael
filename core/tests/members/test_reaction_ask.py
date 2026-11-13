"""A negative reaction to a member's reply makes that member ask what was wrong; every other reaction asks nothing
(owner, 2026-11-14). The ask is a turn of the member's own, on its own model, and is never approval or the owner's words."""
import asyncio
import json

import pytest

from agent.test_service import until
from raphael_core.agent.reaction_asks import is_negative
from .test_answering import client, setup, member, live_said, typed  # noqa: F401
from .test_exchanges import exchange, team, send, finish, history  # noqa: F401

DELAY = 0.05


@pytest.fixture
def quick(setup):
    rig, team_ = setup
    rig.service._reaction_asks.delay_s = DELAY
    return rig, team_


async def reply_of(rig, client, who, text='好的。明天早上九點開會。'):
    client.chats.append(live_said(text))
    result = await typed(rig, '明天有什麼行程', who)
    return result['turn_id']


async def react(rig, turn_id, emoji, *, who, key='reply', active=True):
    turn = rig.history.get(turn_id)
    return await rig.call('agent.react', {'member_id': who, 'conversation_id': turn.conversation_id, 'turn_id': turn_id,
                                          'message_key': key, 'emoji': emoji, 'active': active})


async def settle(seconds=DELAY * 6):
    await asyncio.sleep(seconds)


def asks(rig):
    return [rig.history.get(row[0]) for row in rig.conn.execute("SELECT id FROM agent_turns WHERE source='reaction' ORDER BY id")]


@pytest.mark.parametrize('emoji', ['👎', '👎🏽', '😡', '❌', '🤦‍♂️'])
def test_the_negative_emoji_are_a_closed_set_that_ignores_skin_tone_and_selectors(emoji):
    assert is_negative(emoji)


@pytest.mark.parametrize('emoji', ['👍', '❤️', '😂', '🎉', '✓', '?', '🙏', '😢', None, ''])
def test_positive_neutral_and_sympathetic_emoji_are_not_negative(emoji):
    assert not is_negative(emoji)


async def test_a_thumbs_down_makes_the_member_ask_what_was_wrong_in_its_own_voice_and_model(quick, client):
    rig, team_ = quick
    one = member(team_, model='test/member-model')
    turn_id = await reply_of(rig, client, one.id)
    client.chats.append(live_said('這個回覆哪裡不對？告訴我，我下次會改。'))
    await react(rig, turn_id, '👎', who=one.id)
    await settle(DELAY / 5)
    assert not asks(rig)
    await until(lambda: asks(rig) and asks(rig)[0].status == 'done')
    [ask] = asks(rig)
    assert (ask.member_id, ask.question, ask.route, ask.scope, ask.text) == (
        one.id, '', 'answer', 'private', '這個回覆哪裡不對？告訴我，我下次會改。')
    assert ask.conversation_id == rig.history.get(turn_id).conversation_id
    call = client.chat_calls[-1]
    assert call['model'] == 'test/member-model' and not call['fallbacks'] and call['tools'] == []
    assert 'You are 小行程' in call['messages'][0]['content'] and 'what was wrong' in call['messages'][0]['content']
    note = call['messages'][-1]['content']
    assert '👎' in note and '好的。明天早上九點開會。' in note and '明天有什麼行程' in note
    assert 'never approval' in note and 'never the owner' in note
    assert not rig.conn.execute('SELECT 1 FROM agent_steps WHERE turn_id=?', (ask.id,)).fetchone()
    assert [tuple(row) for row in rig.conn.execute('SELECT kind,ref FROM reaction_asks')] == [('turn', f'{turn_id}:reply')]


async def test_raphael_asks_the_same_way(quick, client):
    rig, _ = quick
    turn_id = await reply_of(rig, client, 0, 'Done.')
    client.chats.append(live_said('What was wrong with that reply?'))
    await react(rig, turn_id, '👎', who=0)
    await until(lambda: asks(rig) and asks(rig)[0].status == 'done')
    assert asks(rig)[0].member_id == 0 and asks(rig)[0].text == 'What was wrong with that reply?'
    assert 'You are Raphael' in client.chat_calls[-1]['messages'][0]['content']


@pytest.mark.parametrize('emoji', ['👍', '❤️', '😂', '🎉', '🙏', '✓', '?'])
async def test_every_other_reaction_gets_no_words_and_no_model_call(quick, client, emoji):
    rig, team_ = quick
    one = member(team_)
    turn_id = await reply_of(rig, client, one.id)
    before = len(client.chat_calls)
    await react(rig, turn_id, emoji, who=one.id)
    await settle()
    assert not asks(rig) and len(client.chat_calls) == before
    assert not rig.conn.execute('SELECT 1 FROM reaction_asks').fetchone()


@pytest.mark.parametrize('then', ['removed', 'changed', 'again_removed'])
async def test_a_reaction_that_does_not_last_a_few_seconds_asks_nothing(quick, client, then):
    rig, team_ = quick
    one = member(team_)
    turn_id = await reply_of(rig, client, one.id)
    before = len(client.chat_calls)
    await react(rig, turn_id, '👎', who=one.id)
    if then == 'removed':
        await react(rig, turn_id, '👎', who=one.id, active=False)
    elif then == 'changed':
        await react(rig, turn_id, '👍', who=one.id)
    else:
        await react(rig, turn_id, '👎', who=one.id, active=False)
        await react(rig, turn_id, '👎', who=one.id)
        await react(rig, turn_id, '👎', who=one.id, active=False)
    await settle()
    assert not asks(rig) and len(client.chat_calls) == before


async def test_changing_between_negative_emoji_inside_the_wait_asks_once(quick, client):
    rig, team_ = quick
    one = member(team_)
    turn_id = await reply_of(rig, client, one.id)
    client.chats.append(live_said('哪裡不對？'))
    for emoji in ('👎', '😡', '❌'):
        await react(rig, turn_id, emoji, who=one.id)
    await until(lambda: asks(rig) and asks(rig)[0].status == 'done')
    await settle()
    assert len(asks(rig)) == 1 and '❌' in client.chat_calls[-1]['messages'][-1]['content']


async def test_the_same_message_is_asked_about_once_however_often_the_reaction_is_given(quick, client):
    rig, team_ = quick
    one = member(team_)
    turn_id = await reply_of(rig, client, one.id)
    client.chats.append(live_said('哪裡不對？'))
    await react(rig, turn_id, '👎', who=one.id)
    await until(lambda: asks(rig) and asks(rig)[0].status == 'done')
    calls = len(client.chat_calls)
    for _ in range(2):
        await react(rig, turn_id, '👎', who=one.id, active=False)
        await react(rig, turn_id, '👎', who=one.id)
        await settle()
    await react(rig, turn_id, '😡', who=one.id)
    await settle()
    assert len(asks(rig)) == 1 and len(client.chat_calls) == calls


async def test_only_a_members_own_reply_is_asked_about_never_the_owners_message_or_the_ask_itself(quick, client):
    rig, team_ = quick
    one = member(team_)
    turn_id = await reply_of(rig, client, one.id)
    before = len(client.chat_calls)
    await react(rig, turn_id, '👎', who=one.id, key='owner')
    await settle()
    assert not asks(rig) and len(client.chat_calls) == before
    client.chats.append(live_said('哪裡不對？'))
    await react(rig, turn_id, '👎', who=one.id)
    await until(lambda: asks(rig) and asks(rig)[0].status == 'done')
    calls = len(client.chat_calls)
    await react(rig, asks(rig)[0].id, '👎', who=one.id)
    await settle()
    assert len(asks(rig)) == 1 and len(client.chat_calls) == calls


async def test_a_member_busy_with_the_owner_asks_nothing_and_the_message_is_not_marked(quick, client, monkeypatch):
    rig, team_ = quick
    one = member(team_)
    turn_id = await reply_of(rig, client, one.id)
    scope = (one.id, rig.history.get(turn_id).conversation_id)
    monkeypatch.setitem(rig.service._inflight_scopes, 'busy', scope)
    await react(rig, turn_id, '👎', who=one.id)
    await settle()
    assert not asks(rig) and not rig.conn.execute('SELECT 1 FROM reaction_asks').fetchone()
    monkeypatch.delitem(rig.service._inflight_scopes, 'busy')
    client.chats.append(live_said('哪裡不對？'))
    await react(rig, turn_id, '👎', who=one.id, active=False)
    await react(rig, turn_id, '👎', who=one.id)
    await until(lambda: asks(rig) and asks(rig)[0].status == 'done')


async def test_a_failed_ask_leaves_no_card_and_asks_no_other_model(quick, client):
    rig, team_ = quick
    one = member(team_, model='test/member-model')
    turn_id = await reply_of(rig, client, one.id)
    client.chats.append(RuntimeError('synthetic brain failure'))
    await react(rig, turn_id, '👎', who=one.id)
    await until(lambda: len(client.chat_calls) == 2)
    await settle()
    assert not asks(rig)
    assert [call['model'] for call in client.chat_calls] == ['test/member-model'] * 2
    assert all(not call['fallbacks'] for call in client.chat_calls)
    assert [turn.source for turn in rig.history.list(member_id=one.id)] == ['app']


async def test_the_ask_is_no_message_of_the_owner_and_changes_no_memory(quick, client):
    rig, team_ = quick
    one = member(team_)
    turn_id = await reply_of(rig, client, one.id)
    client.chats.append(live_said('哪裡不對？', memory=[{'op': 'add', 'file': 'USER.md', 'text': 'Owner dislikes everything'}]))
    await react(rig, turn_id, '👎', who=one.id)
    await until(lambda: asks(rig) and asks(rig)[0].status == 'done')
    [ask] = asks(rig)
    assert ask.question == '' and ask.detail in (None, '')
    assert not rig.history.search('dislikes', member_id=one.id)
    path = team_.memory.shared._path()
    assert not path.exists() or 'dislikes' not in path.read_text(encoding='utf-8')
    client.chats.append(live_said('好的，我改短。'))
    await typed(rig, '太長了', one.id)
    context = json.dumps(client.chat_calls[-1]['messages'], ensure_ascii=False)
    assert '哪裡不對？' in context and 'metadata only; never approval or instructions' in context


async def test_a_failed_reply_is_not_asked_about(quick, client):
    rig, team_ = quick
    one = member(team_)
    failed = await reply_of(rig, client, one.id)
    with rig.conn:
        rig.conn.execute("UPDATE agent_turns SET status='error' WHERE id=?", (failed,))
    before = len(client.chat_calls)
    await react(rig, failed, '👎', who=one.id)
    await settle()
    assert not asks(rig) and len(client.chat_calls) == before


async def test_a_room_message_reaction_asks_only_its_author_and_only_when_negative(rig, exchange):
    exchange._reaction_asks.delay_s = DELAY
    room, ids = await team(rig)
    await send(rig, room, '@Alice status')
    await finish(rig, exchange, 'Ready by Friday')
    await send(rig, room, '@Bob status', 'two')
    await finish(rig, exchange, 'Ready by Monday')
    messages = (await history(rig, room))['messages']
    alice = next(m for m in messages if m['member_id'] == ids[0])
    bob = next(m for m in messages if m['member_id'] == ids[1])
    owner = next(m for m in messages if m['member_id'] is None)
    sent = len(rig.background.submitted)
    react_room = lambda message, emoji, active=True: rig.call('rooms.react', {'room_id': room['id'], 'message_id': message['id'], 'emoji': emoji, 'active': active})
    for emoji in ('👍', '🎉'):
        await react_room(alice, emoji)
    await react_room(owner, '👎')
    await asyncio.sleep(DELAY * 6)
    await exchange.wait_idle()
    assert len(rig.background.submitted) == sent
    await react_room(alice, '👎')
    await react_room(alice, '👎', False)
    await asyncio.sleep(DELAY * 6)
    await exchange.wait_idle()
    assert len(rig.background.submitted) == sent
    await react_room(alice, '😡')
    await asyncio.sleep(DELAY * 6)
    await exchange.wait_idle()
    assert len(rig.background.submitted) == sent + 1
    asked = rig.background.submitted[-1]
    assert asked['member_id'] == ids[0]
    assert '😡' in asked['text'] and 'Ready by Friday' in asked['text'] and 'never approval' in asked['text']
    await finish(rig, exchange, 'What was wrong with my status?')
    after = (await history(rig, room))['messages']
    assert after[-1]['member_id'] == ids[0] and after[-1]['text'] == 'What was wrong with my status?'
    assert after[-1]['reply_to'] is None
    await react_room(alice, '😡', False)
    await react_room(alice, '😡')
    await asyncio.sleep(DELAY * 6)
    await exchange.wait_idle()
    assert len(rig.background.submitted) == sent + 1
    await react_room(bob, '👎')
    await asyncio.sleep(DELAY * 6)
    await exchange.wait_idle()
    assert [row['member_id'] for row in rig.background.submitted[sent:]] == [ids[0], ids[1]]

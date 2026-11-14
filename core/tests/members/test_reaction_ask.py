"""Every reaction of the owner's to a member's reply is analysed at once by that member, on its own model, and the member
decides whether to say something or nothing (owner, 2026-11-14, after Grok Bot). The analysis is a turn of the member's
own: never approval, never the owner's words, and nothing of it is left when no words are needed."""
import asyncio
import json

import pytest

from agent.test_service import until
from raphael_core.agent.history import AgentHistory
from .test_answering import client, setup, member, live_said, typed  # noqa: F401
from .test_exchanges import exchange, team, send, finish, history  # noqa: F401


def held(gate, answer):
    """A model that keeps its answer until the test lets it go: the analysis is under way meanwhile."""
    async def reply(**_):
        await gate.wait()
        return answer
    return reply


async def say(rig, text, who, session):
    return await rig.call('agent.ask', {'session_id': session, 'text': text, 'ui_language': 'zh-TW', 'source': 'app', 'member_id': who})


async def reply_of(rig, client, who, text='好的。明天早上九點開會。', session='s1'):
    client.chats.append(live_said(text))
    return (await say(rig, '明天有什麼行程', who, session))['turn_id']


async def react(rig, turn_id, emoji, *, who, key='reply', active=True):
    turn = rig.history.get(turn_id)
    return await rig.call('agent.react', {'member_id': who, 'conversation_id': turn.conversation_id, 'turn_id': turn_id,
                                          'message_key': key, 'emoji': emoji, 'active': active})


async def settle(seconds=0.1):
    await asyncio.sleep(seconds)


def asks(rig):
    return [rig.history.get(row[0]) for row in rig.conn.execute("SELECT id FROM agent_turns WHERE source='reaction' ORDER BY id")]


def records(rig):
    return [tuple(row) for row in rig.conn.execute('SELECT kind,ref,emoji FROM reaction_asks ORDER BY ref,emoji')]


def said_nothing(rig, who):
    """What the member's thread holds: the owner's questions and its replies, and nothing that was made of a reaction."""
    return [turn.source for turn in rig.history.list(member_id=who)]


# --- every reaction is analysed at once ------------------------------------------------------------------------


@pytest.mark.parametrize('emoji', ['👍', '❤️', '😂', '🎉', '🙏', '✓', '?', '👎', '😡', '🤔'])
async def test_every_reaction_starts_the_members_own_analysis_at_once(setup, client, emoji):
    rig, team_ = setup
    one = member(team_, model='test/member-model')
    turn_id = await reply_of(rig, client, one.id)
    calls, gate = len(client.chat_calls), asyncio.Event()
    client.chats.append(held(gate, live_said('(pass)')))
    await react(rig, turn_id, emoji, who=one.id)
    # No wait: the turn is there, running, before the model has been heard from (it shows as the member's usual presence).
    [ask] = asks(rig)
    assert (ask.status, ask.member_id, ask.question, ask.text, ask.scope) == ('running', one.id, '', '', 'private')
    assert ask.conversation_id == rig.history.get(turn_id).conversation_id
    await until(lambda: len(client.chat_calls) == calls + 1)
    call = client.chat_calls[-1]
    assert call['model'] == 'test/member-model' and not call['fallbacks'] and call['tools'] == []
    assert emoji in call['messages'][-1]['content']
    gate.set()
    await until(lambda: not asks(rig))


async def test_a_member_that_needs_no_words_leaves_no_message_no_card_and_no_failure(setup, client):
    rig, team_ = setup
    one = member(team_)
    turn_id = await reply_of(rig, client, one.id)
    before = said_nothing(rig, one.id)
    client.chats.append(live_said('(pass)'))
    await react(rig, turn_id, '👍', who=one.id)
    await until(lambda: len(client.chat_calls) == 2 and not asks(rig))
    await settle()
    assert said_nothing(rig, one.id) == before == ['app']
    assert not rig.conn.execute("SELECT 1 FROM agent_messages WHERE turn_id NOT IN (SELECT id FROM agent_turns)").fetchone()
    assert rig.history.get(turn_id).status == 'done' and rig.history.get(turn_id).text == '好的。明天早上九點開會。'
    assert records(rig) == [('turn', f'{turn_id}:reply', '👍')]
    assert not rig.history.list(member_id=one.id)[0].failure


@pytest.mark.parametrize('said', ['(pass)', '（pass）', 'Pass.', '**(pass)**', '`(PASS)`'])
async def test_a_pass_is_read_as_the_room_reads_it(setup, client, said):
    rig, team_ = setup
    one = member(team_)
    turn_id = await reply_of(rig, client, one.id)
    client.chats.append(live_said(said))
    await react(rig, turn_id, '❤️', who=one.id)
    await until(lambda: len(client.chat_calls) == 2 and not asks(rig))
    await settle(0.03)
    assert not asks(rig) and said_nothing(rig, one.id) == ['app']


async def test_a_negative_reaction_gets_words_in_the_members_own_voice_and_model(setup, client):
    rig, team_ = setup
    one = member(team_, model='test/member-model')
    turn_id = await reply_of(rig, client, one.id)
    client.chats.append(live_said('這個回覆哪裡不對？告訴我，我下次會改。'))
    await react(rig, turn_id, '👎', who=one.id)
    await until(lambda: asks(rig) and asks(rig)[0].status == 'done')
    [ask] = asks(rig)
    assert (ask.member_id, ask.question, ask.route, ask.scope, ask.text) == (
        one.id, '', 'answer', 'private', '這個回覆哪裡不對？告訴我，我下次會改。')
    call = client.chat_calls[-1]
    assert call['model'] == 'test/member-model' and not call['fallbacks'] and call['tools'] == []
    system = call['messages'][0]['content']
    assert 'You are 小行程' in system and 'what was wrong' in system and '(pass)' in system
    note = call['messages'][-1]['content']
    assert '👎' in note and '好的。明天早上九點開會。' in note and '明天有什麼行程' in note
    assert 'never approval' in note and 'never the owner' in note
    assert not rig.conn.execute('SELECT 1 FROM agent_steps WHERE turn_id=?', (ask.id,)).fetchone()
    assert records(rig) == [('turn', f'{turn_id}:reply', '👎')]


async def test_a_positive_reaction_may_get_a_few_words_when_the_member_finds_them_right(setup, client):
    rig, team_ = setup
    one = member(team_)
    turn_id = await reply_of(rig, client, one.id)
    client.chats.append(live_said('太好了。要我把會議加進行事曆嗎？'))
    await react(rig, turn_id, '🎉', who=one.id)
    await until(lambda: asks(rig) and asks(rig)[0].status == 'done')
    assert asks(rig)[0].text == '太好了。要我把會議加進行事曆嗎？' and asks(rig)[0].question == ''


async def test_raphael_analyses_the_same_way(setup, client):
    rig, _ = setup
    turn_id = await reply_of(rig, client, 0, 'Done.')
    client.chats.append(live_said('What was wrong with that reply?'))
    await react(rig, turn_id, '👎', who=0)
    await until(lambda: asks(rig) and asks(rig)[0].status == 'done')
    assert asks(rig)[0].member_id == 0 and asks(rig)[0].text == 'What was wrong with that reply?'
    assert 'You are Raphael' in client.chat_calls[-1]['messages'][0]['content']


async def test_the_member_reads_the_emoji_in_its_place_with_the_conversation_around_it_as_data(setup, client):
    rig, team_ = setup
    one = member(team_)
    await reply_of(rig, client, one.id, '先前的回覆。', 'before')
    turn_id = await reply_of(rig, client, one.id, '這次的回覆。', 'now')
    client.chats.append(live_said('(pass)'))
    await react(rig, turn_id, '👍', who=one.id)
    await until(lambda: len(client.chat_calls) == 3)
    note = client.chat_calls[-1]['messages'][-1]['content']
    assert '這次的回覆。' in note and '先前的回覆。' in note and '<tool_result untrusted="true"' in note
    assert note.index('先前的回覆。') > note.index('這次的回覆。')


# --- a reaction taken back, or changed, ends the analysis and leaves nothing -------------------------------------


async def test_a_reaction_taken_back_while_it_is_analysed_ends_the_turn_and_leaves_nothing(setup, client):
    rig, team_ = setup
    one = member(team_)
    turn_id = await reply_of(rig, client, one.id)
    gate = asyncio.Event()
    client.chats.append(held(gate, live_said('哪裡不對？')))
    await react(rig, turn_id, '👎', who=one.id)
    assert len(asks(rig)) == 1
    await until(lambda: len(client.chat_calls) == 2)
    await react(rig, turn_id, '👎', who=one.id, active=False)
    assert not asks(rig)
    gate.set()
    await settle()
    assert not asks(rig) and said_nothing(rig, one.id) == ['app'] and records(rig) == []
    # It was never analysed: the same emoji given again is.
    client.chats.append(live_said('哪裡不對？'))
    await react(rig, turn_id, '👎', who=one.id)
    await until(lambda: asks(rig) and asks(rig)[0].status == 'done')
    assert len(client.chat_calls) == 3


async def test_a_reaction_changed_while_it_is_analysed_ends_that_turn_and_starts_one_for_the_new_emoji(setup, client):
    rig, team_ = setup
    one = member(team_)
    turn_id = await reply_of(rig, client, one.id)
    gate = asyncio.Event()
    client.chats.append(held(gate, live_said('(pass)')))
    await react(rig, turn_id, '👍', who=one.id)
    await until(lambda: len(client.chat_calls) == 2)
    [first] = asks(rig)
    client.chats.append(live_said('哪裡不對？'))
    await react(rig, turn_id, '👎', who=one.id)
    # The first is gone at once, and one for the new emoji is under way in its place.
    [ask] = asks(rig)
    assert ask.session_id != first.session_id and ask.status == 'running'
    await until(lambda: asks(rig) and asks(rig)[0].status == 'done')
    gate.set()
    await settle()
    [ask] = asks(rig)
    assert ask.text == '哪裡不對？' and '👎' in client.chat_calls[-1]['messages'][-1]['content']
    assert records(rig) == [('turn', f'{turn_id}:reply', '👎')]
    assert said_nothing(rig, one.id).count('reaction') == 1


async def test_the_owner_writing_ends_an_analysis_that_is_under_way_and_is_answered_first(setup, client):
    rig, team_ = setup
    one = member(team_)
    turn_id = await reply_of(rig, client, one.id)
    gate = asyncio.Event()
    client.chats.append(held(gate, live_said('哪裡不對？')))
    await react(rig, turn_id, '👎', who=one.id)
    await until(lambda: len(client.chat_calls) == 2)
    client.chats.append(live_said('好的，我改短。'))
    answer = await asyncio.wait_for(say(rig, '太長了', one.id, 'next'), 5)
    assert answer['text'] == '好的，我改短。'
    assert not asks(rig) and records(rig) == []
    gate.set()
    await settle()
    assert not asks(rig)


# --- once per message and emoji ----------------------------------------------------------------------------------


async def test_a_reaction_is_analysed_once_per_message_and_emoji(setup, client):
    rig, team_ = setup
    one = member(team_)
    turn_id = await reply_of(rig, client, one.id)
    client.chats.extend([live_said('(pass)'), live_said('哪裡不對？')])
    await react(rig, turn_id, '👍', who=one.id)
    await until(lambda: len(client.chat_calls) == 2 and not asks(rig))
    calls = len(client.chat_calls)
    for _ in range(2):
        await react(rig, turn_id, '👍', who=one.id, active=False)
        await react(rig, turn_id, '👍', who=one.id)
    await settle()
    assert len(client.chat_calls) == calls and not asks(rig)
    # Another emoji is another reaction, and is analysed; the first one still is not analysed again.
    await react(rig, turn_id, '👎', who=one.id)
    await until(lambda: asks(rig) and asks(rig)[0].status == 'done')
    calls = len(client.chat_calls)
    await react(rig, turn_id, '👍', who=one.id)
    await settle()
    assert len(client.chat_calls) == calls and len(asks(rig)) == 1
    assert records(rig) == [('turn', f'{turn_id}:reply', '👍'), ('turn', f'{turn_id}:reply', '👎')]


async def test_each_message_of_the_member_is_analysed_on_its_own(setup, client):
    rig, team_ = setup
    one = member(team_)
    first = await reply_of(rig, client, one.id, '一。', 'a')
    second = await reply_of(rig, client, one.id, '二。', 'b')
    client.chats.extend([live_said('(pass)'), live_said('(pass)')])
    await react(rig, first, '👍', who=one.id)
    await until(lambda: len(client.chat_calls) == 3 and not asks(rig))
    await react(rig, second, '👍', who=one.id)
    await until(lambda: len(client.chat_calls) == 4 and not asks(rig))
    assert [row[1] for row in records(rig)] == sorted([f'{first}:reply', f'{second}:reply'])


# --- who is never analysed, and when --------------------------------------------------------------------------------


async def test_only_a_members_own_reply_is_analysed_never_the_owners_message_or_the_analysis_itself(setup, client):
    rig, team_ = setup
    one = member(team_)
    turn_id = await reply_of(rig, client, one.id)
    before = len(client.chat_calls)
    await react(rig, turn_id, '👎', who=one.id, key='owner')
    await settle()
    assert not asks(rig) and len(client.chat_calls) == before and records(rig) == []
    client.chats.append(live_said('太好了。要我再整理一份嗎？'))
    await react(rig, turn_id, '👍', who=one.id)
    await until(lambda: asks(rig) and asks(rig)[0].status == 'done')
    calls = len(client.chat_calls)
    await react(rig, asks(rig)[0].id, '👎', who=one.id)
    await settle()
    assert len(asks(rig)) == 1 and len(client.chat_calls) == calls and records(rig) == [('turn', f'{turn_id}:reply', '👍')]


async def test_a_quick_conversation_is_never_analysed(setup, client):
    rig, _ = setup
    quick = rig.service.conversations.quick()
    turn_id = rig.history.add(session_id='quick-1', question='幾點？', route='answer', prefix='答', text='九點。', status='done',
                              member_id=0, conversation_id=quick)
    assert rig.service._ask_about_reaction('turn', (turn_id, 'reply'), '👎') is False
    assert not asks(rig) and not client.chat_calls


async def test_a_failed_reply_is_not_analysed(setup, client):
    rig, team_ = setup
    one = member(team_)
    failed = await reply_of(rig, client, one.id)
    with rig.conn:
        rig.conn.execute("UPDATE agent_turns SET status='error' WHERE id=?", (failed,))
    before = len(client.chat_calls)
    await react(rig, failed, '👎', who=one.id)
    await settle()
    assert not asks(rig) and len(client.chat_calls) == before and records(rig) == []


async def test_a_member_busy_with_the_owner_starts_nothing_and_the_reaction_is_not_recorded(setup, client, monkeypatch):
    rig, team_ = setup
    one = member(team_)
    turn_id = await reply_of(rig, client, one.id)
    scope = (one.id, rig.history.get(turn_id).conversation_id)
    monkeypatch.setitem(rig.service._inflight_scopes, 'busy', scope)
    before = len(client.chat_calls)
    await react(rig, turn_id, '👍', who=one.id)
    await settle()
    assert not asks(rig) and len(client.chat_calls) == before and records(rig) == []
    monkeypatch.delitem(rig.service._inflight_scopes, 'busy')
    client.chats.append(live_said('(pass)'))
    await react(rig, turn_id, '👍', who=one.id, active=False)
    await react(rig, turn_id, '👍', who=one.id)
    await until(lambda: len(client.chat_calls) == before + 1)


async def test_analyses_of_reactions_do_not_hold_each_other_up(setup, client):
    rig, team_ = setup
    one = member(team_)
    first = await reply_of(rig, client, one.id, '一。', 'a')
    second = await reply_of(rig, client, one.id, '二。', 'b')
    gate = asyncio.Event()
    client.chats.extend([held(gate, live_said('(pass)')), live_said('(pass)')])
    await react(rig, first, '👍', who=one.id)
    await until(lambda: len(client.chat_calls) == 3)
    await react(rig, second, '👎', who=one.id)
    # Both are thought about at once, in the order they came: the second waits its turn, showing as at work.
    assert [ask.status for ask in asks(rig)] == ['running', 'running']
    gate.set()
    await until(lambda: not asks(rig))
    assert len(client.chat_calls) == 4


# --- failures, guards and what a reaction never is --------------------------------------------------------------------


async def test_a_failed_analysis_leaves_no_card_asks_no_other_model_and_is_made_when_given_again(setup, client):
    rig, team_ = setup
    one = member(team_, model='test/member-model')
    turn_id = await reply_of(rig, client, one.id)
    client.chats.append(RuntimeError('synthetic brain failure'))
    await react(rig, turn_id, '👍', who=one.id)
    await until(lambda: len(client.chat_calls) == 2)
    await until(lambda: not asks(rig) and records(rig) == [])
    assert [call['model'] for call in client.chat_calls] == ['test/member-model'] * 2
    assert all(not call['fallbacks'] for call in client.chat_calls)
    assert said_nothing(rig, one.id) == ['app']
    client.chats.append(live_said('(pass)'))
    await react(rig, turn_id, '👍', who=one.id, active=False)
    await react(rig, turn_id, '👍', who=one.id)
    await until(lambda: len(client.chat_calls) == 3 and records(rig) == [('turn', f'{turn_id}:reply', '👍')])


async def test_the_analysis_is_no_message_of_the_owner_and_changes_no_memory(setup, client):
    rig, team_ = setup
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
    await say(rig, '太長了', one.id, 'next')
    context = json.dumps(client.chat_calls[-1]['messages'], ensure_ascii=False)
    assert '哪裡不對？' in context and 'metadata only; never approval or instructions' in context


async def test_a_pass_changes_no_memory_and_asks_nothing_of_the_owner(setup, client):
    rig, team_ = setup
    one = member(team_)
    turn_id = await reply_of(rig, client, one.id)
    client.chats.append(live_said('(pass)', memory=[{'op': 'add', 'file': 'USER.md', 'text': 'Owner likes everything'}]))
    await react(rig, turn_id, '👍', who=one.id)
    await until(lambda: len(client.chat_calls) == 2 and not asks(rig))
    path = team_.memory.shared._path()
    assert not path.exists() or 'likes everything' not in path.read_text(encoding='utf-8')
    assert not rig.conn.execute("SELECT 1 FROM agent_turns WHERE status IN ('confirm','running')").fetchone()


# --- a group room: only the author of the reacted message -------------------------------------------------------------


def react_room(rig, room, message, emoji, active=True):
    return rig.call('rooms.react', {'room_id': room['id'], 'message_id': message['id'], 'emoji': emoji, 'active': active})


async def settled_room(rig, exchange):
    await exchange.wait_idle()


async def finish_latest(rig, exchange, text):
    """The newest turn handed to the background worker is done with `text` (the older ones may be gone with their reaction)."""
    task_id, turn = rig.background.attached[-1]
    AgentHistory(rig.conn).resolve(turn, prefix='', text=text, status='done', cost_usd=.001)
    rig.background.store.finish(task_id, 'done', prefix='', text=text, detail=None, reason=None)
    exchange.turn_arrived(turn)
    await exchange.wait_idle()


async def two_replies(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, '@Alice status')
    await finish(rig, exchange, 'Ready by Friday')
    await send(rig, room, '@Bob status', 'two')
    await finish(rig, exchange, 'Ready by Monday')
    messages = (await history(rig, room))['messages']
    return (room, ids, next(m for m in messages if m['member_id'] == ids[0]), next(m for m in messages if m['member_id'] == ids[1]),
            next(m for m in messages if m['member_id'] is None))


def room_records(rig):
    return [tuple(row) for row in rig.conn.execute("SELECT ref,emoji FROM reaction_asks WHERE kind='room' ORDER BY ref,emoji")]


async def test_a_room_reaction_is_analysed_at_once_by_its_author_only_and_a_pass_leaves_nothing(rig, exchange):
    room, ids, alice, bob, owner = await two_replies(rig, exchange)
    sent = len(rig.background.submitted)
    before = [m['id'] for m in (await history(rig, room))['messages']]
    await react_room(rig, room, owner, '👎')
    await settled_room(rig, exchange)
    assert len(rig.background.submitted) == sent and room_records(rig) == []
    await react_room(rig, room, alice, '👍')
    await settled_room(rig, exchange)
    assert len(rig.background.submitted) == sent + 1
    asked = rig.background.submitted[-1]
    assert asked['member_id'] == ids[0] and '👍' in asked['text'] and 'Ready by Friday' in asked['text'] and 'never approval' in asked['text']
    assert '(pass)' in asked['text']
    # While it thinks the room shows the member at work, as for any message (a running message of its author).
    thinking = (await history(rig, room))['messages'][-1]
    assert thinking['member_id'] == ids[0] and thinking['status'] == 'running'
    await finish_latest(rig, exchange, '(pass)')
    after = (await history(rig, room))['messages']
    assert [m['id'] for m in after] == before and all(m['text'] != '(pass)' for m in after)
    assert not rig.conn.execute("SELECT 1 FROM room_exchanges WHERE origin_message_id=?", (alice['id'],)).fetchone()
    assert not rig.conn.execute("SELECT 1 FROM room_reply_intents WHERE source_message_id=?", (alice['id'],)).fetchone()
    assert room_records(rig) == [(str(alice['id']), '👍')]


async def test_a_room_reaction_is_analysed_once_per_message_and_emoji_and_words_stay_in_the_thread(rig, exchange):
    room, ids, alice, bob, owner = await two_replies(rig, exchange)
    await react_room(rig, room, alice, '👍')
    await settled_room(rig, exchange)
    await finish_latest(rig, exchange, '(pass)')
    sent = len(rig.background.submitted)
    await react_room(rig, room, alice, '👍', False)
    await react_room(rig, room, alice, '👍')
    await settled_room(rig, exchange)
    assert len(rig.background.submitted) == sent
    await react_room(rig, room, alice, '😡')
    await settled_room(rig, exchange)
    assert len(rig.background.submitted) == sent + 1 and '😡' in rig.background.submitted[-1]['text']
    await finish_latest(rig, exchange, 'What was wrong with my status?')
    after = (await history(rig, room))['messages']
    assert after[-1]['member_id'] == ids[0] and after[-1]['text'] == 'What was wrong with my status?' and after[-1]['reply_to'] is None
    await react_room(rig, room, alice, '👍')
    await settled_room(rig, exchange)
    assert len(rig.background.submitted) == sent + 1
    await react_room(rig, room, bob, '👎')
    await settled_room(rig, exchange)
    assert [row['member_id'] for row in rig.background.submitted[sent:]] == [ids[0], ids[1]]


async def test_a_room_reaction_taken_back_or_changed_while_analysed_ends_the_turn_and_leaves_nothing(rig, exchange):
    room, ids, alice, bob, owner = await two_replies(rig, exchange)
    messages = [m['id'] for m in (await history(rig, room))['messages']]
    sent = len(rig.background.submitted)
    await react_room(rig, room, alice, '👍')
    await settled_room(rig, exchange)
    assert len(rig.background.submitted) == sent + 1
    session = rig.background.submitted[-1]['session_id']
    await react_room(rig, room, alice, '👍', False)
    assert rig.background.cancelled == [session]
    assert [m['id'] for m in (await history(rig, room))['messages']] == messages
    assert not rig.conn.execute("SELECT 1 FROM room_exchanges WHERE origin_message_id=?", (alice['id'],)).fetchone()
    assert not rig.conn.execute("SELECT 1 FROM agent_turns WHERE session_id=?", (session,)).fetchone()
    assert room_records(rig) == []
    await react_room(rig, room, alice, '👍')
    await settled_room(rig, exchange)
    assert len(rig.background.submitted) == sent + 2
    await react_room(rig, room, alice, '👎')
    await settled_room(rig, exchange)
    assert len(rig.background.submitted) == sent + 3 and '👎' in rig.background.submitted[-1]['text']
    assert rig.background.cancelled[-1] == rig.background.submitted[-2]['session_id']
    await finish_latest(rig, exchange, 'What was wrong?')
    assert (await history(rig, room))['messages'][-1]['text'] == 'What was wrong?'
    assert room_records(rig) == [(str(alice['id']), '👎')]


async def test_a_room_that_is_being_discussed_starts_no_analysis_and_does_not_record_the_reaction(rig, exchange):
    room, ids, alice, bob, owner = await two_replies(rig, exchange)
    await send(rig, room, '@Bob next', 'three')
    sent = len(rig.background.submitted)
    await react_room(rig, room, alice, '👍')
    await settled_room(rig, exchange)
    assert len(rig.background.submitted) == sent and room_records(rig) == []


async def test_what_a_member_says_about_a_reaction_is_no_discussion_of_the_room(rig, exchange):
    room, ids, alice, bob, owner = await two_replies(rig, exchange)
    discussion = (await history(rig, room))['exchange']['origin_message_id']
    await react_room(rig, room, alice, '👍')
    await settled_room(rig, exchange)
    assert (await history(rig, room))['exchange']['origin_message_id'] == discussion
    assert not exchange._exchanges.discussing(room['id'], alice['thread_id'])
    await react_room(rig, room, bob, '👍')
    await settled_room(rig, exchange)
    assert len(rig.background.submitted) == 4 and exchange._exchanges.latest(room['id'])['origin_message_id'] == discussion


async def test_a_failed_room_analysis_leaves_no_status_line_and_is_made_when_given_again(rig, exchange):
    room, ids, alice, bob, owner = await two_replies(rig, exchange)
    await react_room(rig, room, alice, '👍')
    await settled_room(rig, exchange)
    task_id, turn = rig.background.attached[-1]
    AgentHistory(rig.conn).resolve(turn, prefix='', text='', status='error')
    rig.background.store.finish(task_id, 'failed', prefix='', text='', detail=None, reason='worker')
    exchange.turn_arrived(turn)
    await settled_room(rig, exchange)
    result = await history(rig, room)
    assert all(not item['reason'] or item['state'] != 'blocked' for item in result['exchange']['reply_intents'])
    assert not rig.conn.execute("SELECT 1 FROM room_reply_intents WHERE state='blocked'").fetchone()
    assert room_records(rig) == [] and not rig.conn.execute("SELECT 1 FROM room_exchanges WHERE origin_message_id=?", (alice['id'],)).fetchone()
    sent = len(rig.background.submitted)
    await react_room(rig, room, alice, '👍', False)
    await react_room(rig, room, alice, '👍')
    await settled_room(rig, exchange)
    assert len(rig.background.submitted) == sent + 1

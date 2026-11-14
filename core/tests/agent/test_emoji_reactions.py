"""Private and room message reactions share Unicode and per-message admission rules."""
import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.agent.reactions import set_reaction
from raphael_core.protocol import INVALID_PARAMS, RpcError


@pytest.fixture(params=['private', 'room'])
def message(conn, request):
    if request.param == 'room':
        with conn:
            room = conn.execute("INSERT INTO rooms(name,created) VALUES('Synthetic',1)").lastrowid
            thread = conn.execute('INSERT INTO room_threads(room_id,created) VALUES(?,1)', (room,)).lastrowid
            identifier = conn.execute("INSERT INTO room_messages(room_id,thread_id,text,created) VALUES(?,?,'Reply',1)", (room, thread)).lastrowid
        return {'message_id': identifier}, 'room_reactions'
    identifier = AgentHistory(conn).add(session_id='emoji', question='Owner', route='answer', prefix='', text='Reply', status='done')
    return {'turn_id': identifier}, 'message_reactions'


def test_single_emoji_sequences_and_legacy_removal_reject_text_and_multiple_graphemes(conn, message):
    scope, table = message
    for emoji in ('🎉', '👍🏽', '👨‍👩‍👧', '🇹🇼', '1️⃣', '❤️', '🏴\U000e0067\U000e0062\U000e0065\U000e006e\U000e0067\U000e007f'):
        set_reaction(conn, {'message_key': 'reply', 'emoji': emoji, 'active': True}, **scope)
        assert conn.execute(f'SELECT 1 FROM {table} WHERE emoji=?', (emoji,)).fetchone()
        assert conn.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] == 1
    for emoji in ('ab', '👍👍', ' ', '🎉' * 40, '🏽', '\u200d', '1', '🇹', '🎉\u200d', 'A\ufe0f', '🎉🏽'):
        with pytest.raises(RpcError, match='reaction requires a supported emoji and boolean active') as caught:
            set_reaction(conn, {'message_key': 'reply', 'emoji': emoji, 'active': True}, **scope)
        assert caught.value.code == INVALID_PARAMS
    for emoji in ('✓', '?'):
        set_reaction(conn, {'message_key': 'reply', 'emoji': emoji, 'active': True}, **scope)
        set_reaction(conn, {'message_key': 'reply', 'emoji': emoji, 'active': False}, **scope)
        assert not conn.execute(f'SELECT 1 FROM {table} WHERE emoji=?', (emoji,)).fetchone()


def shown(conn, table):
    return [row[0] for row in conn.execute(f'SELECT emoji FROM {table}')]


def test_a_message_carries_one_reaction_choosing_another_replaces_it_and_the_same_again_takes_it_back(conn, message):
    scope, table = message
    react = lambda emoji, active=True: set_reaction(conn, {'message_key': 'reply', 'emoji': emoji, 'active': active}, **scope)
    assert react('👍') == '👍' and shown(conn, table) == ['👍']
    assert react('👍') == '👍' and shown(conn, table) == ['👍']
    assert react('😂') == '😂' and shown(conn, table) == ['😂']
    assert react('👍', False) == '😂' and shown(conn, table) == ['😂']
    assert react('😂', False) is None and shown(conn, table) == []
    assert react('🎉', False) is None and shown(conn, table) == []
    assert react('🎉') == '🎉' and react('❤️') == '❤️'
    assert shown(conn, table) == ['❤️']
    if 'turn_id' in scope:
        set_reaction(conn, {'message_key': 'owner', 'emoji': '👍', 'active': True}, **scope)
        assert [tuple(row) for row in conn.execute('SELECT message_key,emoji FROM message_reactions ORDER BY message_key')] == [('owner', '👍'), ('reply', '❤️')]


def test_the_primary_key_refuses_a_second_reaction_whatever_wrote_it(conn, message):
    import sqlite3
    scope, table = message
    set_reaction(conn, {'message_key': 'reply', 'emoji': '👍', 'active': True}, **scope)
    with pytest.raises(sqlite3.IntegrityError), conn:
        if 'turn_id' in scope:
            conn.execute('INSERT INTO message_reactions VALUES(?,?,?)', (scope['turn_id'], 'reply', '😂'))
        else:
            conn.execute('INSERT INTO room_reactions VALUES(?,?)', (scope['message_id'], '😂'))


def test_unicode_17_additions_are_emoji_but_unassigned_neighbors_are_not(conn, message):
    scope, table = message
    for code in (0x1F6D8, 0x1FA8A, 0x1FA8E, 0x1FAC8, 0x1FACD, 0x1FAEA, 0x1FAEF):
        emoji = chr(code)
        set_reaction(conn, {'message_key': 'reply', 'emoji': emoji, 'active': True}, **scope)
        assert conn.execute(f'SELECT 1 FROM {table} WHERE emoji=?', (emoji,)).fetchone()
    for code in (0x1F6D9, 0x1FA8B, 0x1FAC7, 0x1FAC9, 0x1FAEB):
        with pytest.raises(RpcError):
            set_reaction(conn, {'message_key': 'reply', 'emoji': chr(code), 'active': True}, **scope)


def test_a_picture_the_member_sent_takes_a_reaction_as_its_replies_do_and_a_work_line_does_not(conn):
    # A picture a member sends is a message of its own (owner, 2026-11-14, R-UI-156): its media message takes the owner's
    # reaction by its number, as a reply does; a line of work (progress, an event) is still no message to react to.
    history = AgentHistory(conn)
    turn_id = history.add(session_id='picture', question='Draw two offices', route='answer', prefix='', text='Here they are.', status='done')
    picture = '{"attachment": {"id": "' + 'b' * 32 + '.png", "name": "office.png", "mime": "image/png"}}'
    history.add_message(turn_id, 'media', picture)
    history.add_message(turn_id, 'progress', 'Drawing the second one')
    history.add_message(turn_id, 'reply', 'Here they are.')
    assert set_reaction(conn, {'message_key': '1', 'emoji': '❤️', 'active': True}, turn_id=turn_id) == '❤️'
    assert set_reaction(conn, {'message_key': '3', 'emoji': '👍', 'active': True}, turn_id=turn_id) == '👍'
    assert [tuple(row) for row in conn.execute('SELECT message_key,emoji FROM message_reactions ORDER BY message_key')] == [('1', '❤️'), ('3', '👍')]
    for key in ('2', '4'):
        with pytest.raises(RpcError, match='reaction must identify a message'):
            set_reaction(conn, {'message_key': key, 'emoji': '👍', 'active': True}, turn_id=turn_id)

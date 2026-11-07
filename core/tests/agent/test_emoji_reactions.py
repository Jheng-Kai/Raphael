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
    for emoji in ('ab', '👍👍', ' ', '🎉' * 40, '🏽', '\u200d', '1', '🇹', '🎉\u200d', 'A\ufe0f', '🎉🏽'):
        with pytest.raises(RpcError, match='reaction requires a supported emoji and boolean active') as caught:
            set_reaction(conn, {'message_key': 'reply', 'emoji': emoji, 'active': True}, **scope)
        assert caught.value.code == INVALID_PARAMS
    for emoji in ('✓', '?'):
        set_reaction(conn, {'message_key': 'reply', 'emoji': emoji, 'active': True}, **scope)
        set_reaction(conn, {'message_key': 'reply', 'emoji': emoji, 'active': False}, **scope)
        assert not conn.execute(f'SELECT 1 FROM {table} WHERE emoji=?', (emoji,)).fetchone()


def test_twenty_distinct_reactions_are_bounded_per_message_but_removal_and_idempotence_work(conn, message):
    scope, table = message
    emojis = list('😀😁😂😃😄😅😆😇😈😉😊😋😌😍😎😏😐😑😒😓😔')
    for emoji in emojis[:20]:
        set_reaction(conn, {'message_key': 'reply', 'emoji': emoji, 'active': True}, **scope)
    set_reaction(conn, {'message_key': 'reply', 'emoji': emojis[0], 'active': True}, **scope)
    with pytest.raises(RpcError) as caught:
        set_reaction(conn, {'message_key': 'reply', 'emoji': emojis[20], 'active': True}, **scope)
    assert caught.value.code == INVALID_PARAMS
    assert conn.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] == 20
    set_reaction(conn, {'message_key': 'reply', 'emoji': emojis[0], 'active': False}, **scope)
    set_reaction(conn, {'message_key': 'reply', 'emoji': emojis[20], 'active': True}, **scope)
    if 'turn_id' in scope:
        set_reaction(conn, {'message_key': 'owner', 'emoji': emojis[0], 'active': True}, **scope)


def test_unicode_17_additions_are_emoji_but_unassigned_neighbors_are_not(conn, message):
    scope, table = message
    for code in (0x1F6D8, 0x1FA8A, 0x1FA8E, 0x1FAC8, 0x1FACD, 0x1FAEA, 0x1FAEF):
        emoji = chr(code)
        set_reaction(conn, {'message_key': 'reply', 'emoji': emoji, 'active': True}, **scope)
        assert conn.execute(f'SELECT 1 FROM {table} WHERE emoji=?', (emoji,)).fetchone()
    for code in (0x1F6D9, 0x1FA8B, 0x1FAC7, 0x1FAC9, 0x1FAEB):
        with pytest.raises(RpcError):
            set_reaction(conn, {'message_key': 'reply', 'emoji': chr(code), 'active': True}, **scope)

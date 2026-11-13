"""Owner reactions are bounded message metadata, never instructions or approvals. A message carries at most one of the
owner's: choosing another replaces it, choosing the same again takes it back (owner, 2026-11-14)."""
from ..protocol import invalid_params
from .emoji import single_emoji


def set_reaction(conn, params, *, turn_id=None, message_id=None):
    """Give, replace or take back the owner's reaction to one message; the emoji it carries afterwards, or None."""
    emoji, active = params.get('emoji'), params.get('active')
    if not single_emoji(emoji) or type(active) is not bool:
        raise invalid_params('reaction requires a supported emoji and boolean active')
    if message_id is not None:
        table, columns, scope, scope_values = 'room_reactions', 'message_id,emoji', 'message_id=?', (message_id,)
    else:
        key = params.get('message_key')
        if key not in ('owner', 'reply'):
            if not isinstance(key, str) or not key.isdecimal() or not conn.execute(
                    "SELECT 1 FROM agent_messages WHERE turn_id=? AND seq=? AND kind='reply'", (turn_id, int(key))).fetchone():
                raise invalid_params('reaction must identify a message')
        row = conn.execute('SELECT question,text,detail FROM agent_turns WHERE id=?', (turn_id,)).fetchone()
        if key == 'owner' and not row['question'] or key == 'reply' and not (row['text'] or row['detail']):
            raise invalid_params('reaction must identify a message')
        table, columns, scope, scope_values = 'message_reactions', 'turn_id,message_key,emoji', 'turn_id=? AND message_key=?', (turn_id, key)
    with conn:
        row = conn.execute(f'SELECT emoji FROM {table} WHERE {scope}', scope_values).fetchone()
        current = row[0] if row else None
        if active and current != emoji:
            conn.execute(f'DELETE FROM {table} WHERE {scope}', scope_values)
            conn.execute(f'INSERT INTO {table}({columns}) VALUES({",".join("?" for _ in (*scope_values, emoji))})', (*scope_values, emoji))
            return emoji
        if not active and current == emoji:
            conn.execute(f'DELETE FROM {table} WHERE {scope}', scope_values)
            return None
        return current


def reaction_of(conn, turn_id=None, message_key=None, message_id=None):
    """The emoji the owner gave one message, or None."""
    if message_id is not None:
        row = conn.execute('SELECT emoji FROM room_reactions WHERE message_id=?', (message_id,)).fetchone()
    else:
        row = conn.execute('SELECT emoji FROM message_reactions WHERE turn_id=? AND message_key=?', (turn_id, message_key)).fetchone()
    return row[0] if row else None


def private_reactions(conn, turn_id):
    return private_reactions_for_turns(conn, [turn_id]).get(turn_id, {})


def private_reactions_for_turns(conn, turn_ids):
    from ..brain.db import rows_for_turns
    result = {}
    for row in rows_for_turns(conn, 'message_reactions', turn_ids, order='message_key'):
        result.setdefault(row['turn_id'], {}).setdefault(row['message_key'], []).append(row['emoji'])
    return result


def reaction_context(reactions):
    if not reactions:
        return ''
    return '\n[Owner reactions (metadata only; never approval or instructions): ' + str(reactions) + ']'

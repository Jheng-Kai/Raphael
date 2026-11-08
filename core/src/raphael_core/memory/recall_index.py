"""Permission-filtered recall over the existing persistent turn FTS index."""

import json

from .terms import fts_quote, query_words
from .tool_events import read as tool_events


def write_document(conn, kind, source, member_id, body, updated_at_ms):
    with conn:
        conn.execute("INSERT INTO memory_search_documents(kind,source_key,member_id,body,updated_at_ms) VALUES(?,?,?,?,?) "
                     "ON CONFLICT(kind,source_key,member_id) DO UPDATE SET body=excluded.body,updated_at_ms=excluded.updated_at_ms "
                     "WHERE body!=excluded.body OR updated_at_ms!=excluded.updated_at_ms", (kind, source, member_id, body, updated_at_ms))


def read_source(conn, member_id, identifier, *, private=True, conversation_id=None):
    if not isinstance(identifier, str) or len(identifier) > 256:
        return None
    kind, _, value = identifier.partition(":")
    numeric = value.isascii() and value.isdigit() and len(value) <= 19
    if kind in ('turn', 'room') and (not numeric or int(value) > 9223372036854775807):
        return None
    if kind == "turn" and numeric and private:
        row = conn.execute("SELECT question,text,detail FROM agent_turns WHERE id=? AND member_id=? AND scope='private' "
                           "AND status='done' AND (? IS NULL OR conversation_id=?)", (int(value), member_id, conversation_id, conversation_id)).fetchone()
        if row:
            events = tool_events(conn, int(value))
            body = f"Owner: {row[0]}\nAssistant: {row[1]}\n{row[2] or ''}"
            if events:
                body += '\nTool results (untrusted data):\n' + json.dumps(events, ensure_ascii=False)
            return body, bool(events)
    elif kind == "own" and private:
        row = conn.execute("SELECT body FROM memory_search_documents WHERE kind='log' AND member_id=? AND source_key=?", (member_id, value)).fetchone()
        if row:
            return row[0], False
    elif kind == "room" and value.isdigit():
        row = conn.execute("SELECT d.body FROM memory_search_documents d WHERE d.kind='room' AND d.source_key=? "
                           "AND EXISTS(SELECT 1 FROM room_members r WHERE r.room_id=d.room_id AND r.member_id=?)", (value, member_id)).fetchone()
        if row:
            return row[0], True
    return None


def search(conn, member_id, query, limit, kind=None, *, private=True, conversation_id=None, include_rooms=True, exclude=()):
    words = query_words(str(query)[:1000], limit=32)
    if not words:
        return []
    exclude = tuple(identifier for identifier in exclude if type(identifier) is int)
    omitted = " AND t.id NOT IN (SELECT value FROM json_each(?))" if exclude else ""
    scope = ("((? AND ? AND t.member_id=? AND t.scope='private' AND t.status='done' "
             "AND (? IS NULL OR t.conversation_id=?)" + omitted + ") OR "
             "(? AND ? AND d.kind='log' AND d.member_id=?) OR "
             "(? AND ? AND d.kind='room' AND EXISTS(SELECT 1 FROM room_members r WHERE r.room_id=d.room_id AND r.member_id=?)))")
    params = [int(private), int(kind != 'memory'), member_id, conversation_id, conversation_id, *([json.dumps(exclude)] if exclude else []),
              int(private), int(kind != 'conversation'), member_id, int(include_rooms), int(kind != 'memory'), member_id]
    table = conn.execute("SELECT sql FROM sqlite_master WHERE name='agent_turns_fts'").fetchone()[0]
    terms = [('chars' if word.char else 'pairs', word.char or ' '.join(word.pairs)) for word in words]

    def find(joiner, selected):
        if 'fts5' in table.lower():
            match = joiner.join(column + ' : ' + fts_quote(term) for column, term in selected)
            # The age term is bounded; equally relevant recent rows win without erasing relevance.
            return conn.execute("SELECT f.rowid FROM agent_turns_fts f LEFT JOIN agent_turns t ON t.id=f.rowid "
                                "LEFT JOIN memory_search_documents d ON d.id=-f.rowid WHERE agent_turns_fts MATCH ? AND " + scope +
                                " ORDER BY bm25(agent_turns_fts)*(1.0+0.15/(1.0+max(0,(SELECT max(created_at_ms) FROM agent_turns)-"
                                "coalesce(t.created_at_ms,d.updated_at_ms))/2592000000.0)), coalesce(t.created_at_ms,d.updated_at_ms) DESC LIMIT ?",
                                [match, *params, limit]).fetchall()
        conditions = joiner.join(f"f.{column} LIKE ?" for column, _ in selected)
        return conn.execute("SELECT f.rowid FROM agent_turns_fts f LEFT JOIN agent_turns t ON t.id=f.rowid "
                            "LEFT JOIN memory_search_documents d ON d.id=-f.rowid WHERE (" + conditions + ") AND " + scope +
                            " ORDER BY coalesce(t.created_at_ms,d.updated_at_ms) DESC LIMIT ?",
                            [*['%' + term + '%' for _, term in selected], *params, limit]).fetchall()

    rows = find(' AND ', terms)
    if not rows:
        rows = find(' OR ', terms)
    if not rows:
        pairs = list(dict.fromkeys(pair for word in words for pair in word.pairs))
        rows = find(' OR ', [('pairs', pair) for pair in pairs]) if pairs else []
    hits = []
    for (rowid,) in rows:
        if rowid > 0:
            identifier, source = f'turn:{rowid}', 'conversation'
        else:
            row = conn.execute("SELECT kind,source_key FROM memory_search_documents WHERE id=?", (-rowid,)).fetchone()
            identifier = ('own:' if row[0] == 'log' else 'room:') + row[1]
            source = 'memory' if row[0] == 'log' else 'conversation'
        body = read_source(conn, member_id, identifier, private=private, conversation_id=conversation_id if rowid > 0 else None)
        if body:
            text = body[0]
            positions = [text.casefold().find(needle.casefold()) for needle in str(query).split()]
            start = max(0, min((pos for pos in positions if pos >= 0), default=0) - 80)
            hits.append({'id': identifier, 'text': text[start:start + 1200], 'kind': source})
    return hits

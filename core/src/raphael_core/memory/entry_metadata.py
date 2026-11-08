"""Structured expiry and recall timestamps beside the living memory documents."""

import hashlib
import re
import threading
from datetime import date
from difflib import SequenceMatcher

LEGACY_UNTIL = re.compile(r"\s*\(until\s+(\d{4}-\d{2}-\d{2})\)", re.I)


def entry_id(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def checked_until(value):
    if value is None:
        return None
    if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
        raise ValueError('until must be an ISO date or null')
    return value


class EntryMetadata:
    def __init__(self, conn, scope, now_ms, owner_thread=None):
        self.conn, self.scope, self.now_ms = conn, scope, now_ms
        self._owner = owner_thread if owner_thread is not None else threading.get_ident()
        self._pending = []
        self._lock = threading.Lock()

    def _defer(self, method, *args):
        # File writers may run on worker threads; SQLite belongs to its creating thread.
        if threading.get_ident() != self._owner:
            with self._lock:
                self._pending.append((method, args))
            return True
        with self._lock:
            pending, self._pending = self._pending, []
        for name, values in pending:
            getattr(self, name)(*values)
        return False

    def sync(self, before, after):
        if self._defer('sync', list(before), list(after)):
            return
        known = {row['entry_id']: dict(row) for row in self.conn.execute(
            'SELECT * FROM memory_entry_metadata WHERE scope=?', (self.scope,))}
        used = set()
        remaining = {entry_id(text) for text in after}
        with self.conn:
            for text in after:
                key = entry_id(text)
                row = known.get(key)
                if row is None:
                    candidates = [(SequenceMatcher(None, old, text).ratio(), known[entry_id(old)])
                                  for old in before if entry_id(old) in known and entry_id(old) not in used
                                  and entry_id(old) not in remaining]
                    if candidates:
                        similarity, candidate = max(candidates, key=lambda item: item[0])
                        if similarity >= .60:
                            row = candidate
                if row:
                    used.add(row['entry_id'])
                self.conn.execute('INSERT OR IGNORE INTO memory_entry_metadata VALUES(?,?,?,?,?)',
                                  (self.scope, key, row['until_date'] if row else None,
                                   row['created_at_ms'] if row else self.now_ms(), row['last_recalled_at_ms'] if row else None))
            keys = {entry_id(text) for text in after}
            for key in known.keys() - keys:
                self.conn.execute('DELETE FROM memory_entry_metadata WHERE scope=? AND entry_id=?', (self.scope, key))

    def set_until(self, text, value):
        value = checked_until(value)
        if self._defer('set_until', text, value):
            return True
        with self.conn:
            cursor = self.conn.execute('UPDATE memory_entry_metadata SET until_date=? WHERE scope=? AND entry_id=? AND until_date IS NOT ?',
                                       (value, self.scope, entry_id(text), value))
        return cursor.rowcount > 0

    def recalled(self, entries):
        self.sync(entries, entries)
        with self.conn:
            self.conn.executemany('UPDATE memory_entry_metadata SET last_recalled_at_ms=? WHERE scope=? AND entry_id=?',
                                  [(self.now_ms(), self.scope, entry_id(text)) for text in entries])

    def stale(self, entries, today, max_unused_days):
        self.sync(entries, entries)
        rows = {row['entry_id']: row for row in self.conn.execute('SELECT * FROM memory_entry_metadata WHERE scope=?', (self.scope,))}
        cutoff = self.now_ms() - max_unused_days * 86400000
        return [text for text in entries if (row := rows[entry_id(text)]) and (
            row['until_date'] is not None and row['until_date'] < today.isoformat()
            or max_unused_days > 0 and (row['last_recalled_at_ms'] or row['created_at_ms']) < cutoff)]

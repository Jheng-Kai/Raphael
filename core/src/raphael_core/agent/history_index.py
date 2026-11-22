"""Repair the legacy receipt index once, using a connection owned by the worker."""

import asyncio
import logging
import sqlite3
import threading
from concurrent.futures import Future
from contextlib import closing

from .history import AgentHistory

logger = logging.getLogger(__name__)
_STATE_KEY = "event_index_public_receipts"


def repair(conn, stopping):
    if conn.execute("SELECT 1 FROM memory_state WHERE key=?", (_STATE_KEY,)).fetchone():
        return
    # Older indexes included transport keys. Current writes already index only public words.
    turns = conn.execute("SELECT DISTINCT turn_id FROM agent_messages WHERE kind='event'"
                         " AND ltrim(text) LIKE '{%'").fetchall()
    history = AgentHistory(conn)
    for (turn_id,) in turns:
        while True:
            if stopping():
                return
            try:
                with conn:
                    # In WAL mode this reads and builds terms without taking the writer lock.
                    # If a concurrent write invalidates the snapshot, read the current turn again.
                    conn.execute("BEGIN")
                    history.reindex(turn_id)
                break
            except sqlite3.OperationalError as error:
                if error.sqlite_errorcode not in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_BUSY_SNAPSHOT):
                    raise
    if not stopping():
        with conn:
            conn.execute("INSERT OR IGNORE INTO memory_state(key,value) VALUES (?,1)", (_STATE_KEY,))


class EventIndexRepair:
    def __init__(self, path):
        self.path = path
        self._ready = None

    def start(self, stopping):
        self._ready = Future()
        thread = threading.Thread(target=self._run, args=(stopping,), name="raphael-history-index", daemon=True)
        thread.start()
        return thread

    def _run(self, stopping):
        try:
            with closing(sqlite3.connect(self.path)) as conn:
                conn.row_factory = sqlite3.Row
                repair(conn, stopping)
        except Exception as error:
            logger.exception("Could not repair the history event index")
            self._ready.set_exception(error)
        else:
            self._ready.set_result(None)

    async def wait(self):
        if self._ready is not None:
            await asyncio.shield(asyncio.wrap_future(self._ready))

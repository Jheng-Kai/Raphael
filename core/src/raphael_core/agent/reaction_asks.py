"""What a reaction of the owner's asks of the member whose reply it was (owner, 2026-11-14, after Grok Bot).

Every reaction is analysed, at once: no wait and no list of emoji that count. The member's own model reads the emoji,
its reply and the recent conversation, all as data, and decides whether to say something (ask what was wrong, a few
words, the obvious next step) or nothing at all; a reaction that needs no words leaves no message and no card behind.
This module keeps what is common to a conversation and a group room:

- a reaction is analysed once per message and emoji, however often it is given again (`reaction_asks`);
- another reaction on the same message, or taking it back, ends the analysis that is under way for the first one and
  leaves nothing of it behind;
- an analysis that was ended, or that failed, was never made, so the same emoji given again is analysed.

A reaction is a signal, never approval and never the owner's words.
"""
import inspect
import logging
import sqlite3
from collections.abc import Callable
from typing import Literal

logger = logging.getLogger(__name__)

Kind = Literal['turn', 'room']


class ReactionAsks:
    """The once-only record of what was analysed, and the starting and ending of the analyses.

    `start(kind, ref, emoji)` starts the analysis of the reaction the message carries and says whether it did (a member
    busy with the owner starts none, and the reaction is then not recorded, so that it can still be analysed when it is
    given again). `cancel(kind, ref)` ends the analysis under way for that message, if any, leaves nothing of it behind
    and returns the emoji it was for (it may be a coroutine function)."""

    def __init__(self, conn: sqlite3.Connection, start: Callable[[str, tuple, str], bool],
                 cancel: Callable[[str, tuple], str | None]):
        self._conn, self._start, self._cancel = conn, start, cancel

    @staticmethod
    def _mark(kind: str, ref: tuple) -> str:
        return ':'.join(map(str, ref))

    async def changed(self, kind: Kind, ref: tuple, emoji: str | None) -> None:
        """The owner gave, changed or took back the reaction of one message: `emoji` is what it carries now."""
        marked = False
        try:
            ended = self._cancel(kind, ref)
            if inspect.isawaitable(ended):
                ended = await ended
            if ended:
                self.release(kind, ref, ended)
            if not emoji or self.asked(kind, ref, emoji):
                return
            with self._conn:
                self._conn.execute('INSERT INTO reaction_asks(kind,ref,emoji) VALUES(?,?,?)', (kind, self._mark(kind, ref), emoji))
            marked = True
            if not self._start(kind, ref, emoji):
                self.release(kind, ref, emoji)
        except Exception as error:  # a reaction's analysis must never fail the reaction, nor take the core down
            logger.warning('A reaction could not be analysed: %s', type(error).__name__)
            if marked:
                self.release(kind, ref, emoji)

    def release(self, kind: str, ref: tuple, emoji: str) -> None:
        """The analysis of this reaction did not happen (it was ended, or failed): it is analysed when given again."""
        try:
            with self._conn:
                self._conn.execute('DELETE FROM reaction_asks WHERE kind=? AND ref=? AND emoji=?', (kind, self._mark(kind, ref), emoji))
        except sqlite3.Error as error:
            logger.warning('A reaction record could not be released: %s', type(error).__name__)

    def asked(self, kind: str, ref: tuple, emoji: str) -> bool:
        return self._conn.execute('SELECT 1 FROM reaction_asks WHERE kind=? AND ref=? AND emoji=?',
                                  (kind, self._mark(kind, ref), emoji)).fetchone() is not None

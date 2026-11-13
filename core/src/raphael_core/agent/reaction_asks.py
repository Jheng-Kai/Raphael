"""What a reaction to a member's reply can ask of the member (owner, 2026-11-14, after Grok Bot).

Most reactions get no words: a 👍, ❤️, 😂 or 🎉 is kept as metadata and nothing answers it. A negative one makes the
member whose reply it was ask, once and briefly, what was wrong with that reply, so the owner can say what to improve.
The ask waits a few seconds, and only the reaction the message carries when they are over counts: one given and taken
back, or changed to another emoji, asks nothing. A message is asked about once, however often the reaction is given
again. A reaction is a signal, never approval and never the owner's words.
"""
import asyncio
import logging
import sqlite3
from collections.abc import Callable
from typing import Literal

logger = logging.getLogger(__name__)

# How long a negative reaction has to stand before the member asks about it.
ASK_DELAY_S = 4.0
# What is negative: thumbs down, a cross, an angry, unamused or rolling-eyed face, a facepalm and the pile. The first
# code point decides, so skin tones, genders and the text/emoji selector do not matter.
_NEGATIVE = frozenset(map(ord, '👎❌😠😡🤬😒🙄🤦💩'))

Kind = Literal['turn', 'room']


def is_negative(emoji) -> bool:
    return isinstance(emoji, str) and bool(emoji) and ord(emoji[0]) in _NEGATIVE


class ReactionAsks:
    """The waiting reactions, and the once-only record of what was asked. `current(kind, ref)` reads the emoji the message
    carries now; `start(kind, ref, emoji)` starts the ask and says whether it did (a member busy with the owner's own
    message starts none, and the message is then not marked, so a later reaction can still ask)."""

    def __init__(self, conn: sqlite3.Connection, current: Callable[[str, tuple], str | None],
                 start: Callable[[str, tuple, str], bool], *, delay_s: float = ASK_DELAY_S):
        self._conn, self._current, self._start, self.delay_s = conn, current, start, delay_s
        self._waiting: dict[tuple, asyncio.TimerHandle] = {}

    @staticmethod
    def _mark(kind: str, ref: tuple) -> str:
        return ':'.join(map(str, ref))

    def changed(self, kind: Kind, ref: tuple, emoji: str | None) -> None:
        """The owner gave, changed or took back the reaction of one message: `emoji` is what it carries now."""
        key = (kind, ref)
        if (waiting := self._waiting.pop(key, None)) is not None:
            waiting.cancel()
        if not is_negative(emoji):
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        self._waiting[key] = loop.call_later(self.delay_s, self._due, kind, ref, emoji)

    def _due(self, kind: str, ref: tuple, emoji: str) -> None:
        self._waiting.pop((kind, ref), None)
        try:
            if self._current(kind, ref) != emoji or self.asked(kind, ref):
                return
            with self._conn:
                self._conn.execute('INSERT INTO reaction_asks(kind,ref) VALUES(?,?)', (kind, self._mark(kind, ref)))
            if not self._start(kind, ref, emoji):
                with self._conn:
                    self._conn.execute('DELETE FROM reaction_asks WHERE kind=? AND ref=?', (kind, self._mark(kind, ref)))
        except Exception as error:  # a reaction's question must never take the core down
            logger.warning('A reaction could not be asked about: %s', type(error).__name__)

    def asked(self, kind: str, ref: tuple) -> bool:
        return self._conn.execute('SELECT 1 FROM reaction_asks WHERE kind=? AND ref=?', (kind, self._mark(kind, ref))).fetchone() is not None

    def close(self) -> None:
        for waiting in self._waiting.values():
            waiting.cancel()
        self._waiting.clear()

"""When a member at work owes the owner a word on how it goes (owner, 2026-11-14).

Owner: 「他現在又開始不講任何進度了…不然我其實不太知道它目前的進度，我可能會覺得它是不是當機了」. A task of 37 minutes
and 71 calls wrote 142 steps and not one message: whatever a member says while it works is progress in the folded work,
by design (agent/cli/loop.py `_release_held`), so long work said nothing the owner could read.

Each run that works where the owner reads it (a turn of the owner's own conversation, a task in a member's private
conversation, on any brain) keeps one `ProgressUpdates`: when the owner was last shown a message of the run (the opening
counts, a progress line does not). Past `FIRST_UPDATE_S` with no message, or `NEXT_UPDATE_S` since the last, the next
tool result carries `reminder()`, after the result and outside the data it wraps, never in the tool events that are
kept; and while the run is past that time what it says next is shown as a message, not folded into the work. A reminder
nobody answered is sent again only after another `NEXT_UPDATE_S`. A meeting's reply (its words are its post) and a
routine (the owner reads only its last message) keep none.
"""

import time
from collections.abc import Callable

# The first word owed after a run starts, then the most time between two (seconds).
FIRST_UPDATE_S = 120.0
NEXT_UPDATE_S = 300.0

REMINDER = ("It has been {minutes} minutes since you last told the owner anything. Before your next step, write them a "
            "two-sentence update in the language you use with them (what is done, what is next), in plain words, with "
            "no tool names.")
# What an API brain that narrates in a JSON object is told besides (agent/narration.py NARRATION_RULES).
IN_MESSAGES = " Put it in messages."


class ProgressUpdates:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self.restart()

    def restart(self) -> None:
        """The run starts (again, after a pause for the owner): nothing is owed yet."""
        self._since, self._told, self._reminded = self._clock(), False, None

    def shown(self) -> None:
        """The owner was shown a message of the run."""
        self._since, self._told, self._reminded = self._clock(), True, None

    def due(self) -> bool:
        """Whether the owner has gone too long without a message: what the run says now is one."""
        return self._clock() - self._since >= (NEXT_UPDATE_S if self._told else FIRST_UPDATE_S)

    def reminder(self, suffix: str = "") -> str:
        """The line for the tool result that comes back now, or "" when none is owed (or one was sent lately)."""
        now = self._clock()
        if not self.due() or self._reminded is not None and now - self._reminded < NEXT_UPDATE_S:
            return ""
        self._reminded = now
        return REMINDER.format(minutes=max(1, int((now - self._since) // 60))) + suffix

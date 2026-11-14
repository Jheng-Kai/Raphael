"""Notes to a model that repeats itself or keeps failing, and the end of a task nobody is in.

Adapted from NousResearch/hermes-agent (MIT); see core/packaging/licenses.

A call is judged by what came of it, never by its arguments alone: the tests run again after an edit, or a
log polled while it grows, are not repeats. A repeat is the same tool with the same arguments and the same
result, in a row, or the same few calls over and over. The answer is a note after the result; the call has
always been made. Only a task nobody is in (`hard_stop`) is ended, and only when the notes did not help.

Nothing here logs a tool name, an argument or a result.
"""

import hashlib
import re
from collections import deque
from dataclasses import dataclass

from .guards import canonical

# Tools whose failure is normal work: a red test run, a page that does not load. A run of different ones is
# diagnosis, not a loop.
FAILURE_TOLERANT = frozenset({"vm_exec", "web_read"})
# Tools that run a command, which failed when it exited non-zero (the tool itself worked).
COMMANDS = frozenset({"vm_exec"})
# Looking at the world changes nothing, so it is not progress for a call that failed.
READ_ONLY = frozenset({
    "web_search", "web_read", "read_attachment", "weather", "local_time", "memory_read", "history_search",
    "session_search", "session_read", "skill_read", "self_check", "raphael_help", "find_tools",
    "get_guide", "get_desktop_state", "get_window_state", "get_cursor_position", "list_apps", "list_windows",
    "clipboard_read", "verify_state", "get_browser_state",
})
# A call that failed because the service asked to wait is not a replay when it is tried again.
THROTTLED = frozenset({"rate_limit", "rate_limited", "overloaded"})
# The call was never made: the desktop is in use by someone else. Waiting for it is not a loop.
NOT_MADE = frozenset({"computer_busy"})

# The same call with the same result this many times in a row, or a cycle this many laps, gets a note.
NOTE_AT = 3
# Cycles of two to four calls are looked for, in the latest HISTORY calls.
CYCLE_PERIODS = range(2, 5)
HISTORY = 64
# A call that failed with the same arguments, or a tool that failed in a row.
EXACT_NOTE_AT = 2
SAME_TOOL_NOTE_AT = 3
# What ends a task nobody is in.
REPEAT_STOP_AT = 5
EXACT_STOP_AT = 5
SAME_TOOL_STOP_AT = 8

IDENTICAL = (
    "<harness_note>{count} identical calls in a row to {tool}, with the same arguments and the same result. "
    "Do not repeat it: change the arguments, use another tool, or go on with what you have.</harness_note>"
)
CYCLE = (
    "<harness_note>The last {laps} rounds repeated the same {period} calls (ending with {tool}) with the "
    "same arguments and the same results. Do not repeat them: change the arguments, use another tool, or go "
    "on with what you have.</harness_note>"
)
EXACT = (
    "<harness_note>{tool} has failed {count} times with the same arguments. This looks like a loop: read "
    "the error and change the approach instead of trying it unchanged.</harness_note>"
)
# Calls of different tools that failed one after another (R-PERSIST-04): web_read, then show_page, then a command is
# the usual way a model gives up, and no one tool's count sees it. Hermes's words: keep using tools, diagnose first.
STREAK_NOTE_AT = 3
STREAK = (
    "<harness_note>The last {count} calls failed ({tools}). Do not switch to text-only replies; keep using tools, "
    "but diagnose first: read each error, then try other arguments, another source or another tool.</harness_note>"
)

_EXIT_CODE = re.compile(r'^\s*\{\s*"exit_code":\s*(-?\d+)')


@dataclass(frozen=True)
class Verdict:
    """What the guardrails make of a call: `note` goes after its result, and `halt` ends a task nobody is in."""

    note: str = ""
    halt: bool = False


def _base(name: str) -> str:
    return name.rsplit("__", 1)[-1]


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", "surrogatepass")).hexdigest()


def failed(name: str, outcome) -> bool:
    """Whether a call counts as failed: the tool did not work, or the command it ran exited non-zero."""
    if not outcome.ok:
        return True
    if _base(name) in COMMANDS:
        found = _EXIT_CODE.match(outcome.content or "")  # first in the result, so a cut result still has it
        return bool(found) and int(found.group(1)) != 0
    return False


def _diagnose(name: str, count: int) -> str:
    text = (
        f"{name} has failed {count} times in a row. This looks like a loop. Do not give up on the tools and "
        "do not guess: diagnose first. Read the latest error or output and check what you assumed. "
    )
    if _base(name) in COMMANDS:
        text += (
            "Run a small command to look around, such as `pwd && ls -la`, then try an absolute path, a "
            "simpler command or another directory."
        )
    else:
        text += (
            "Then try different arguments, a narrower query or path, or another tool that can make progress. "
            "When no way within your reach is left, say exactly what blocks it instead of repeating "
            "the same failing path."
        )
    return f"<harness_note>{text}</harness_note>"


class ToolGuardrails:
    """Watches the calls of one turn or task. `after_call` is told each call once it is made."""

    def __init__(self, *, hard_stop: bool = False) -> None:
        self._hard = hard_stop
        self._exact: dict[tuple[str, str], int] = {}  # a call -> its failures with the same arguments
        self._changed: dict[tuple[str, str], bool] = {}  # a failed call -> something changed since
        self._same: dict[str, int] = {}  # a tool -> its failures in a row
        self._last: tuple[tuple[str, str], str] | None = None
        self._run = 0
        self._history: deque[tuple[tuple[str, str], str]] = deque(maxlen=HISTORY)
        self._streak: list[str] = []  # the tools of the calls that failed one after another, of any tool

    def after_call(self, name: str, arguments, outcome) -> Verdict:
        """The note to put after the result of a call that was made, and whether the task must end."""
        if outcome.kind in NOT_MADE:
            return Verdict()
        call = (name, _digest(canonical(arguments)))
        notes: list[str] = []
        bad = failed(name, outcome)
        halt = self._failures(name, call, bad, outcome.kind in THROTTLED, notes)
        self._across(name, bad, notes)
        # A screen is not words: a call that returns one never makes a streak.
        halt = self._repeats(name, call, None if outcome.blocks else outcome.content or "", notes) or halt
        return Verdict("\n\n".join(notes), halt and self._hard)

    def _failures(self, name: str, call, bad: bool, throttled: bool, notes: list[str]) -> bool:
        if not bad:
            self._exact.pop(call, None)
            self._same.pop(name, None)
            # A change since a call failed makes the next try of it a new experiment (edit, run again).
            if _base(name) not in READ_ONLY:
                self._changed.update(dict.fromkeys(self._exact, True))
                self._same.clear()
            return False
        if self._changed.pop(call, False):
            self._exact.pop(call, None)
        exact = self._exact.get(call, 0)
        if not throttled:
            exact = self._exact[call] = exact + 1
        same = self._same[name] = self._same.get(name, 0) + 1
        if exact >= EXACT_STOP_AT or (_base(name) not in FAILURE_TOLERANT and same >= SAME_TOOL_STOP_AT):
            return True
        if not throttled and exact >= EXACT_NOTE_AT:
            notes.append(EXACT.format(tool=name, count=exact))
        elif same >= SAME_TOOL_NOTE_AT:
            notes.append(_diagnose(name, same))
        return False

    def _across(self, name: str, bad: bool, notes: list[str]) -> None:
        """A note when calls of more than one tool have failed one after another, every STREAK_NOTE_AT of them, unless a
        note of this call already says it. Never a reason to end a task: varied failures are diagnosis."""
        if not bad:
            self._streak.clear()
            return
        self._streak.append(name)
        tools = list(dict.fromkeys(self._streak))
        if not notes and len(tools) > 1 and len(self._streak) % STREAK_NOTE_AT == 0:
            notes.append(STREAK.format(count=len(self._streak), tools=", ".join(tools[-STREAK_NOTE_AT * 2:])))

    def _repeats(self, name: str, call, result: str | None, notes: list[str]) -> bool:
        if result is None:
            self._last, self._run = None, 0
            self._history.clear()
            return False
        key = (call, _digest(result))
        self._run = self._run + 1 if key == self._last else 1
        self._last = key
        self._history.append(key)
        if self._run >= NOTE_AT:
            notes.append(IDENTICAL.format(count=self._run, tool=name))
            return self._run >= REPEAT_STOP_AT
        if cycle := self._cycle():
            period, laps = cycle
            notes.append(CYCLE.format(laps=laps, period=period, tool=name))
            return laps >= REPEAT_STOP_AT
        return False

    def _cycle(self) -> tuple[int, int] | None:
        """The (period, laps) of the smallest repeating cycle that ends the latest call, if its laps reach
        `NOTE_AT`. A cycle of one call is the streak's."""
        history, size = self._history, len(self._history)
        for period in CYCLE_PERIODS:
            if size < period * NOTE_AT:
                continue
            laps = 1
            while (base := size - period * (laps + 1)) >= 0 and all(
                history[base + i] == history[size - period + i] for i in range(period)
            ):
                laps += 1
            if laps >= NOTE_AT:
                return period, laps
        return None

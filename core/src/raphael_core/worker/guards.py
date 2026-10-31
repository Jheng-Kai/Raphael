"""What stands between a tool's result and the model: marking it as data, cutting it down, and
refusing a call that only repeats one.

A tool's result is text that nobody vetted: a web page, a note, a mail. Whatever it says, it is data
for the task and never an instruction, and the model is told so twice: in the system prompt, and by
the tags every result is wrapped in. A result that carries the closing tag of the wrapper, or the
opening tag of the task, would end the data early and speak as the user: those tags are
neutralized inside it first. A result is cut to what the model's window can hold, keeping its
beginning and its end, and says how to read the rest. What becomes of a result once the conversation
outgrows the window is `context`'s.

Nothing here logs a tool name, an argument or a result.
"""

import json
import re
from collections.abc import Mapping
from typing import Any

# The most of a result the model is shown, in characters. Most tools here have no pages to turn, so
# one read should hold a long page or a source file: 50,000 characters is between OpenHands' 30,000
# and Hermes' 100,000 (which spills the rest to a file). That is about 13,000 tokens of English, and
# at most about 50,000 of Chinese, so a smaller window gets a smaller limit (`result_limit`).
MAX_RESULT_CHARS = 50_000
# Hermes' scale for a window: one result may take 15% of it, at three characters a token, with a floor.
RESULT_WINDOW_SHARE = 0.15
CHARS_PER_TOKEN = 3
MIN_RESULT_CHARS = 8_000
# A skill import is already bounded to 128 KiB. Keep its complete Markdown (including JSON
# escaping) when the dedicated reader returns it, while retaining the untrusted-data wrapper.
MAX_SKILL_RESULT_CHARS = 2 * 128 * 1024 + 1000
HEAD_SHARE = 0.65
CUT_MARK = (
    "\n[... {skipped} characters left out of the middle. To read them, call the tool again for that part: an "
    "offset or a page if it takes one, or a line range or a search in a shell ...]\n"
)
# The most the arguments of one call may come to, as JSON, in characters. (The core refuses more
# too: `raphael_core.agent.plugins.MAX_ARGUMENT_CHARS`, which a test keeps the same.)
MAX_ARGUMENT_CHARS = 16000
# The same call, with the same arguments, is refused the third time in a row.
REPEAT_LIMIT = 3

# The tags the prompts are built from. A text that holds one is changed so that it does not close,
# or open, what it is inside of.
_TAGS = re.compile(r"<(/?)\s*(tool_result|task|question|conversation|previous_attempt|background_tasks|context_summary|checkpoint_so_far|rounds)\b", re.IGNORECASE)


def neutralize(text: str) -> str:
    """`text` with the tags of the prompts made harmless: the `<` of each becomes `＜`."""
    return _TAGS.sub(lambda found: f"＜{found.group(1)}{found.group(2)}", text)


def head_tail_split(text: str, limit: int = MAX_RESULT_CHARS) -> tuple[str, bool]:
    """`text` cut to about `limit` characters, keeping its head and its tail with a mark between,
    and whether anything was left out."""
    if len(text) <= limit:
        return text, False
    skipped = len(text) - limit
    mark = CUT_MARK.format(skipped=skipped)
    room = max(limit - len(mark), 0)
    head = int(room * HEAD_SHARE)
    tail = room - head
    return text[:head] + mark + (text[len(text) - tail :] if tail else ""), True


def result_limit(tool: str, window: int | None = None) -> int:
    """The most of a result of `tool` the model is shown, with a window of `window` tokens if it is known."""
    if tool == "skill_read":
        return MAX_SKILL_RESULT_CHARS
    if window is None:
        return MAX_RESULT_CHARS
    return max(MIN_RESULT_CHARS, min(int(window * RESULT_WINDOW_SHARE * CHARS_PER_TOKEN), MAX_RESULT_CHARS))


def wrap_untrusted(tool: str, text: str, *, ok: bool, limit: int | None = None) -> str:
    """A tool's result as the model reads it: cut, neutralized and inside tags that say it is data
    from outside, never to be obeyed. Inline attachments can supply their own budget;
    ordinary tool results retain their default limits."""
    if limit is None:
        limit = result_limit(tool)
    shown, cut = head_tail_split(neutralize(text), limit)
    status = "ok" if ok else "error"
    note = " cut_short=true" if cut else ""
    return (
        f'<tool_result untrusted="true" tool="{_attribute(tool)}" status="{status}"{note}>\n'
        f"{shown}\n</tool_result>"
    )


def _attribute(value: str) -> str:
    return re.sub(r'[^A-Za-z0-9_.:-]', "_", value)[:80]


def canonical(arguments: Mapping[str, Any]) -> str:
    """The arguments of a call as one text, the same for the same arguments."""
    return json.dumps(arguments, sort_keys=True, ensure_ascii=False, default=str)


# Calls that fail one after another: after STEER_AT the model is told to change its approach, and
# after STOP_AT the task stops instead of spending its limits on the same wall.
STEER_AT = 5
STOP_AT = 8
STEER_NOTE = (
    "<harness_note>Several tool calls in a row have failed. Do not retry the same approach: use a "
    "different tool or source, or stop and report plainly what could not be done.</harness_note>"
)


class FailureGuard:
    """Counts the calls that failed one after another (any tool); a call that works starts the count
    again. `failed()` says what to do after a failure: "steer" once when the count reaches
    `steer_at`, "stop" when it reaches `stop_at`, otherwise None."""

    def __init__(self, steer_at: int = STEER_AT, stop_at: int = STOP_AT) -> None:
        self._steer_at, self._stop_at = steer_at, stop_at
        self._row = 0
        self._steered = False

    def succeeded(self) -> None:
        self._row = 0
        self._steered = False

    def failed(self) -> str | None:
        self._row += 1
        if self._row >= self._stop_at:
            return "stop"
        if self._row >= self._steer_at and not self._steered:
            self._steered = True
            return "steer"
        return None


class RepeatGuard:
    """Refuses a call that is the same as the two right before it: nothing happened in between, so
    it cannot tell the model anything it does not know. The same call after other work is new: the
    tests again after an edit."""

    def __init__(self, limit: int = REPEAT_LIMIT) -> None:
        self._limit = limit
        self._last: tuple[str, str] | None = None
        self._row = 0

    def allows(self, name: str, arguments: Mapping[str, Any]) -> bool:
        """Count the call, and say whether it may be made."""
        key = (name, canonical(arguments))
        self._row = self._row + 1 if key == self._last else 1
        self._last = key
        return self._row < self._limit

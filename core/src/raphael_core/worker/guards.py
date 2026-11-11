# Adapted from NousResearch/hermes-agent (MIT); see core/packaging/licenses.
"""What stands between a tool's result and the model: marking it as data and cutting it down.

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

# Bound large tool results while retaining long pages and source files.
# Smaller model windows receive a lower limit through result_limit.
MAX_RESULT_CHARS = 50_000
# Scale each result to the model window, with a minimum readable allowance.
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
# too: `raphael_core.agent.plugins.MAX_ARGUMENT_CHARS`, which a test keeps the same.) Not higher:
# `vm_exec` takes a command of 16,000 characters at most (`computer.vm.LocalVm.execute`), which is also about
# half of the 32,767 a Windows command line holds for the `docker exec` that carries it, the other half
# being room for quoting. A larger file is written in parts.
MAX_ARGUMENT_CHARS = 16000

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

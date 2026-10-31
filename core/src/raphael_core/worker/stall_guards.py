"""A model that stops short: it says what it will do and makes no call, or the output limit cuts its reply off.

Adapted from NousResearch/hermes-agent agent/agent_runtime_helpers.py @ c419cf7c (MIT): how the end of a reply
is read for an announced next step. The notes follow agent/conversation_loop.py @ c419cf7c (MIT). Hermes reads
English only; the Chinese and Japanese endings are Raphael's own. Not taken over: the checks for a reply that
is a mere fragment and for Codex acknowledgements.

A false alarm costs one more model call that sends the same answer again, so the nudges are few and bounded.
"""

import json
import re

# The finish reason of a reply that the output limit cut off.
LENGTH = "length"
# How often a turn is told to go on after a reply that only says what it will do; how often a text cut off by
# the limit is continued; how often a reply that went round in circles is asked for again.
MAX_NUDGES = 2
MAX_PIECES = 4
MAX_LOOPS = 2

CONTINUE_NOW = (
    "<harness_note>Continue now. Make the tool calls the task needs, and send your final answer only "
    "after the task is done.</harness_note>"
)
CONTINUE_TEXT = (
    "<harness_note>Your last reply was cut off by the output limit. Continue exactly where it stopped, "
    "without repeating what you wrote.</harness_note>"
)
LOOPED = (
    "<harness_note>Your last reply went round in circles and was dropped. Do not repeat yourself: go on "
    "with the task from where it stands.</harness_note>"
)

# Only the tail of a reply that announces the next step counts, so "I will" in the middle of a sentence never
# does. A longer reply is an answer, not a dangling "let me".
_MAX_CHARS = 400
_INTENT = re.compile(
    r"(?:\blet me now\b|\bi(?:['’])?ll now\b|\bi will now\b|\bnow i(?:['’]ll| will)\b|\bnext[,:] i\b"
    r"|讓我(?:先|來|現在|接著|馬上|立刻)|我(?:現在|馬上|立刻|接著)(?:就)?(?:來|去|會|將|開始)"
    r"|接下來(?:我)?(?:會|將|要|來)|現在(?:就)?(?:來|開始)"
    r"|(?:これから|次に)[^。！？\n]{0,40}(?:します|いたします|いきます|みます))"
    r"[^.!?。！？\n]{0,100}[.:：…。]?\s*$",
    re.IGNORECASE,
)


def trailing_continue_intent(text: str) -> bool:
    """Whether `text` is a short reply that ends on an announced next step."""
    text = (text or "").strip()
    return bool(text) and len(text) <= _MAX_CHARS and bool(_INTENT.search(text[-160:]))


def _spoken(content: str) -> tuple[str, bool]:
    """The words of a reply that the owner would read, and whether it holds a progress line and nothing
    else (the form of a reply between tool rounds)."""
    try:
        data = json.loads(content)
    except ValueError:
        return content, False
    if not isinstance(data, dict):
        return content, False
    messages = data.get("messages")
    last = messages[-1] if isinstance(messages, list) and messages else data.get("text")
    if isinstance(last, str) and last.strip():
        return last, False
    progress = data.get("progress")
    return "", isinstance(progress, str) and bool(progress.strip())


def stalled(content: str) -> bool:
    """Whether a reply that made no call ends on what it will do next, or says nothing but progress."""
    said, progress_only = _spoken(content)
    return progress_only or trailing_continue_intent(said)

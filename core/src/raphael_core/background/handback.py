"""A work hand-off's words to whoever handed it over (owner, 2026-11-09: 「這邊是兩個史萊姆在溝通才對」).

The member who takes on work does it in its own conversation and speaks to the owner there. It ends its
final reply with `<handback>…</handback>`, written to the colleague who asked, or, for its own background
work, to the place the work came from. The block is taken out of what the owner reads and kept as the
task's hand-back: the member-to-member view, the asker's side, a room's report line and a parent task all
read only that, as Grok Bot's hand-off shows a member's reply to its colleague apart from what it told the
owner (bots/research/grokbot/handoff-2026-11-08).
"""

import re

_BLOCK = re.compile(r"<handback>\s*(.*?)\s*</handback>", re.S | re.I)
# An unclosed block at the end of a reply: the words after the tag are still the hand-back.
_OPEN = re.compile(r"<handback>\s*(.*)\Z", re.S | re.I)
# A tag left over from a block closed in a later reply never reaches the owner.
_STRAY = re.compile(r"</?handback>", re.I)
LIMIT = 600


def split(text: str) -> tuple[str, str]:
    """`text` without its hand-back blocks, and the last block's words (one line, at most LIMIT
    characters; "" when there is none)."""
    if not text:
        return text, ""
    found = _BLOCK.findall(text)
    cleaned = _BLOCK.sub("", text)
    if tail := _OPEN.search(cleaned):
        found.append(tail.group(1))
        cleaned = cleaned[:tail.start()]
    cleaned = _STRAY.sub("", cleaned)
    words = " ".join(found[-1].split()) if found else ""
    return cleaned.strip(), words if len(words) <= LIMIT else words[:LIMIT - 3] + "..."


def _salutation(owner: str) -> re.Pattern[str] | None:
    names = [name for name in {owner.strip(), "主人", "Owner", "owner"} if name]
    if not names:
        return None
    return re.compile(r"^(?:" + "|".join(re.escape(name) for name in sorted(names, key=len, reverse=True)) + r")\s*[，,:：、]\s*")


def unaddressed(text: str, owner: str = "") -> str:
    """`text` without a greeting to the owner at its start: words shown between two members never
    open by addressing the owner, even when the model wrote one."""
    pattern = _salutation(owner)
    return pattern.sub("", text, count=1) if pattern and text else text


def fallback(report: str, owner: str = "") -> str:
    """For a report written before hand-backs existed, or one that left the block out: its first
    sentence, without a greeting to the owner at its start, so a colleague is not shown words
    addressed to someone else. At most 240 characters."""
    text = " ".join((report or "").split())
    first = unaddressed(re.split(r"(?<=[.!?。！？])\s+|(?<=[。！？])", text, maxsplit=1)[0], owner)
    return first if len(first) <= 240 else first[:237] + "..."


TITLE_CHARS = 40
# A label a member put in front of a request ("S2-03:", "[T4]", "12."): the system's numbering, not a name of the work.
_LABEL = re.compile(r"^(?:[\[(]\s*(?:[A-Za-z]{1,6}[-_ ]?)?\d+(?:[-._]\d+)*\s*[\])]\s*[:：.\-–—]?|(?:[A-Za-z]{1,6}[-_ ]?)?\d+(?:[-._]\d+)*\s*[:：.)\-–—])\s*")
# What the owner must never be told as the name of work: a stage code ("S2-03", "T-12", "P1-2"), a task number
# ("task 12", "任務 12") or the word stage_id itself.
_INTERNAL_ID = re.compile(
    r"(?<![A-Za-z0-9])[A-Z]{1,3}\d{0,2}-\d{1,3}(?![A-Za-z0-9])"
    r"|(?i:(?<![a-z])(?:task|stage)[ _#-]?(?:id|number|no\.?)?\s*[#:]?\s*\d+(?!\d)|stage_id)"
    r"|(?:任務|任务|タスク)\s*[#＃]?\d+")


def title(request: str) -> str:
    """The name the owner is shown for work handed on: the first sentence of what was asked, without a numbering label
    in front of it, cut short (at most TITLE_CHARS characters). The member's own stage_id is a key for the system, never
    a name."""
    line = " ".join(((request or "").strip().splitlines() or [""])[0].split())
    line = _LABEL.sub("", line, count=1)
    first = re.split(r"(?<=[.!?。！？;；])\s*", line, maxsplit=1)[0] or line
    return first if len(first) <= TITLE_CHARS else first[:TITLE_CHARS - 1].rstrip() + "…"


def internal_ids(text: str) -> list[str]:
    """The stage codes and task numbers in `text`: what the core's own words (a room's wrap-up, a hand-off's line) must
    not hold."""
    return [match.group(0) for match in _INTERNAL_ID.finditer(text or "")]

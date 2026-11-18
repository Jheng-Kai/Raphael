"""A called tool's answer made to fit what a model reads, instead of being cut at a character count (R-TOOL-06).

A mail search with full bodies answered with the HTML of every message: the first message's style sheet filled the
50,000 characters a model reads and every later message was lost, so the member could only say the answer was cut.

An answer over its limit is read as JSON where it is JSON, also JSON held inside a string of it, and also when a few
words of the harness follow it. HTML inside becomes the text a reader sees, and long encoded data is named and left out.
If it is still too long, the longest list keeps its first whole items, and a note beside it says how many were left out
and how to get them: fewer at a time, or the next page. If one value is still too long, the longest string is cut by
`cut` (its head and tail where the caller asks for that). What is not JSON is read as text, HTML as its text, and cut by
`cut` when still too long. An answer within its limit is never touched.
"""

import json
import re
from collections.abc import Callable

from .html import html_to_text

_HTML = re.compile(r"<(?:!doctype|html|head|body|div|table|tr|td|p|span|br|style|meta|a|img|font|center)\b", re.I)
_ENCODED = re.compile(r"[A-Za-z0-9+/=_-]{2000,}")
_INSIDE = object()


def _looks_html(text: str) -> bool:
    return len(text) > 200 and len(_HTML.findall(text[:20000])) >= 3


def _as_text(html: str) -> str:
    title, text = html_to_text(html)
    return "\n".join(part for part in (title, text) if part)


def _cut(text: str, limit: int) -> str:
    """The start of `text` and how much was left out, the note counted in `limit`."""
    keep = max(0, limit - len(f"… [{len(text)} more characters left out]"))
    return text[:keep] + f"… [{len(text) - keep} more characters left out]"


class _Nested:
    """JSON that a value held as a string: read and shortened as JSON, written back as a string."""

    __slots__ = ("value",)

    def __init__(self, value) -> None:
        self.value = value


def _default(value):
    if isinstance(value, _Nested):
        return json.dumps(value.value, ensure_ascii=False, default=_default)
    raise TypeError(type(value).__name__)


def _dump(value) -> str:
    return json.dumps(value, ensure_ascii=False, default=_default)


def _children(value):
    if isinstance(value, dict):
        return value.items()
    if isinstance(value, list):
        return enumerate(value)
    if isinstance(value, _Nested):
        return [(_INSIDE, value.value)]
    return ()


def _at(value, path):
    for key in path:
        value = value.value if key is _INSIDE else value[key]
    return value


class _Reader:
    """Reads a value whole: HTML as its text, encoded data left out, JSON in a string as JSON."""

    def __init__(self) -> None:
        self.lost = False

    def value(self, value):
        if isinstance(value, list):
            return [self.value(item) for item in value]
        if isinstance(value, dict):
            return {key: self.value(item) for key, item in value.items()}
        if not isinstance(value, str):
            return value
        stripped = value.strip()
        if stripped[:1] in ("{", "[") and len(stripped) > 1:
            try:
                inner = json.loads(stripped)
            except ValueError:
                inner = None
            if isinstance(inner, (dict, list)):
                return _Nested(self.value(inner))
        if _looks_html(value):
            return _as_text(value)
        if len(stripped) >= 2000 and _ENCODED.fullmatch(stripped):
            self.lost = True
            return f"[{len(stripped)} characters of encoded data left out]"
        return value


def _longest(value, wanted, done, path=()):
    """The (length, path) of the longest value for which `wanted` holds and that is not in `done`, or None."""
    best = (len(_dump(value)), path) if wanted(value) and id(value) not in done else None
    for key, child in _children(value):
        found = _longest(child, wanted, done, (*path, key))
        if found and (best is None or found[0] > best[0]):
            best = found
    return best


def _note(left: int, total: int) -> str:
    return f"{left} of {total} items left out to fit: ask for fewer at a time, or for the next page"


def _shorten_lists(value, limit: int):
    """`value` with items of its longest lists left out until its JSON fits `limit`, each such list noted beside it (or,
    in a list, as its last item). A list is shortened once, keeping the most first items that fit, found by halving."""
    done: set[int] = set()
    while len(_dump(value)) > limit:
        found = _longest(value, lambda item: isinstance(item, list) and len(item) > 1, done)
        if found is None:
            break
        path = found[1]
        items = _at(value, path)
        original, total = list(items), len(items)
        parent = _at(value, path[:-1]) if path else None
        keyed = isinstance(parent, dict) and path[-1] is not _INSIDE

        def place(keep: int) -> None:
            note = _note(total - keep, total)
            items[:] = original[:keep] + ([] if keyed else [note])
            if keyed:
                parent[f"{path[-1]}_left_out"] = note

        low, high, best = 1, total - 1, 1
        while low <= high:
            middle = (low + high) // 2
            place(middle)
            if len(_dump(value)) <= limit:
                best, low = middle, middle + 1
            else:
                high = middle - 1
        place(best)
        done.add(id(items))
    return value


def _shorten_strings(value, limit: int, cut: Callable[[str, int], str]) -> None:
    """Cuts the longest strings of `value` by `cut` until its JSON fits `limit`: each once, to the most characters that
    fit, found by halving (the JSON of a string is longer than the string where it escapes)."""
    done: set[int] = set()
    while len(_dump(value)) > limit:
        found = _longest(value, lambda item: isinstance(item, str) and len(item) > 200, done)
        if found is None or not found[1]:
            return
        path = found[1]
        parent, key = _at(value, path[:-1]), path[-1]
        text = parent[key]
        low, high, best = 0, len(text) - 1, 0
        while low <= high:
            middle = (low + high) // 2
            parent[key] = cut(text, middle)
            if len(_dump(value)) <= limit:
                best, low = middle, middle + 1
            else:
                high = middle - 1
        parent[key] = cut(text, best)
        done.add(id(parent[key]))


def _leading_json(text: str):
    """The JSON object or list `text` starts with and the few words after it (a note the harness added), or (None, "")."""
    if text[:1] not in ("{", "["):
        return None, ""
    try:
        value, end = json.JSONDecoder().raw_decode(text)
    except ValueError:
        return None, ""
    rest = text[end:]
    return (value, rest) if isinstance(value, (dict, list)) and len(rest) <= 2000 else (None, "")


def fit(text: str, limit: int, cut: Callable[[str, int], str] = _cut) -> tuple[str, bool]:
    """`text` within `limit` characters, and whether anything of it was left out. `cut` shortens a text that is still too
    long once read: by default its start and how much was left out."""
    if len(text) <= limit:
        return text, False
    stripped = text.strip()
    value, rest = _leading_json(stripped)
    if value is not None:
        room = limit - len(rest)
        reader = _Reader()
        value = reader.value(value)
        if len(_dump(value)) <= room:
            return _dump(value) + rest, reader.lost
        value = _shorten_lists(value, room)
        _shorten_strings(value, room, cut)
        shown = _dump(value)
        return (shown + rest, True) if len(shown) <= room else (cut(shown + rest, limit), True)
    if _looks_html(text):
        text = _as_text(text)
        if len(text) <= limit:
            return text, False
    return cut(text, limit), True

"""A member's memory: living Markdown files that keep being edited, never a pile of notes.

Adapted from NousResearch/hermes-agent (MIT); see core/packaging/licenses.

    bots/<id>/SOUL.md     who the member is, written by the core from its details (`bots.homes.soul`)
    bots/<id>/MEMORY.md   what the member has learned; no other member reads it (`<name> 的記憶`)
    shared/USER.md        who the owner is, one file every member reads and writes (`共同記憶`)

A file is a list of entries, a blank line between them, so that it reads as a document in any editor
and the owner can edit it whole. An entry may run over several lines. Any paragraph is an entry,
and a rewrite keeps every word whoever wrote the file.

The model edits by `add`, `replace` and `remove`, in one atomic batch (`MemoryFile.apply`):

- `add` keeps one line for one fact: the same words (whatever the spacing, the punctuation, the case)
  are not added again, a fact that says more takes the place of the shorter one, and another wording of
  an entry is refused with the entry, for the model to `replace` it.
- `replace` changes the span `old_text` inside the one entry that holds it; the rest of the entry stays.
  To rewrite an entry, its whole text is the span.
- `remove` deletes the entry `old_text` is part of.

A file has a limit, in characters, and a batch that would pass it is refused with a note that says by
how much and shows the entries, so that the model frees the room and adds in one batch: the limit is
checked on the batch's result alone. A file over its limit (the owner's own edit, a migration) keeps
every word and may only shrink until it is back under it. Failed attempts are counted through a turn:
past MAX_FAILURES_PER_TURN the model is told to stop and answer, since a failed save must never hold up
the reply.

Every write holds the file's lock, reads the file again, and replaces it atomically through
`bots.homes.BotHomes` (allowlisted paths, secrets masked, a revision journal outside the homes), so two
members writing at once lose nothing, in one process or several.

Outside content does not enter silently. Whatever is written is scanned (`scan.refusal`, at the write
and again when a turn reads the file, where a line that fails is replaced by a [BLOCKED] note and stays
in the file for the owner to see). Outside claims carry a mark (`UNCONFIRMED`); close restatements of
the owner's current request need none, even beside outside claims in the same batch. Outside claims
never change confirmed entries. Only matching owner words or the owner document editor remove a mark.

Nothing here logs an entry.
"""

from raphael_core.ui_words import ui_word, with_ui_words
import difflib
import hashlib
import logging
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date

from . import scan
from .terms import normalized, parts, tokens

logger = logging.getLogger(__name__)

MEMORY_CHAR_LIMIT = 2200
USER_CHAR_LIMIT = 1375
ENTRY_DELIMITER = "\n\n"
# Failed attempts in one turn before the model is told to stop trying and answer.
MAX_FAILURES_PER_TURN = 3
# How alike two wordings are, by the characters and words they share, to be one fact (`relation`).
NEAR = 0.85
# Below this, two texts are too short to tell anything from what they share.
_MIN_MARKS = 6
_MIN_PARTS = 4
# A word that turns what follows it around: 不喜歡茶 does not say 喜歡茶.
_NEGATIONS = frozenset(("不", "沒", "未", "無", "非", "別", "not", "no", "never"))
# A pass nobody watches may not take a file below this share of what it held (nor empty it).
_UNATTENDED_KEEPS = 0.5

_BLANK_LINE = re.compile(r"\n[ \t]*(?:\n[ \t]*)+")
# Whom the owner told a shared entry to, and when, as the host stamps it at the entry's end.
_TOLD = re.compile(r" — [^\n—]{1,60} · \d{4}-\d{2}-\d{2}$")

# The mark of an entry nobody confirmed, in the language of the owner's screen.
UNCONFIRMED = with_ui_words({"zh-TW": "（待確認）", "ja": "（未確認）", "en": "(unconfirmed) "})
_UNCONFIRMED_MARKS = tuple(UNCONFIRMED.values())


def is_unconfirmed(entry: str) -> bool:
    """Whether the entry carries the mark of what came from outside and nobody confirmed."""
    return entry.startswith(_UNCONFIRMED_MARKS)


def without_mark(entry: str) -> str:
    for mark in _UNCONFIRMED_MARKS:
        if entry.startswith(mark):
            return entry[len(mark):]
    return entry


def owner_stated(content: str, owner_text: str) -> bool:
    """Recognize close restatements without granting model-supplied provenance authority.

    Exact clauses preserve negation; fuzzy token overlap could turn 'not red' into 'red'.
    Unmatched paraphrases conservatively keep their unconfirmed mark.
    """
    def clause(text):
        text = text.casefold().strip()
        text = re.sub(r"^(?:please\s+)?remember(?:\s+that)?\s+|^(?:請)?(?:記住|記得)", "", text)
        text = re.sub(r"^(?:the (?:owner|user)|i|my)\b\s*|^(?:使用者|主人|我)(?:的)?", "", text)
        text = re.sub(r"\b(prefers|likes|lives|uses)\b", lambda match: match[0][:-1], text)
        return " ".join(text.split()).strip(" .!?。！？")

    note = clause(_TOLD.sub("", without_mark(content)))
    return bool(note and owner_text and any(note == clause(part) for part in re.split(r"[.!?;。！？；\n]+", owner_text)))


def owner_replaced(old_text: str, content: str, owner_text: str) -> bool:
    """Whether the owner's own words in this private turn say the change a `replace` makes.

    A correction like 仁愛路 -> 信愛路 is said as the new street, never as the whole entry, so
    `owner_stated` cannot see it. Here every span the replace writes (and every span it takes out) has
    to stand in the owner's words (a span replaced by another needs only the new one), with up to two
    neighbouring characters for context. Words the owner
    never said, such as an instruction from a web page, never pass, so a model cannot rewrite a
    confirmed entry from outside content."""
    said = " ".join(owner_text.casefold().split())
    if not said or not old_text.strip() or not content.strip():
        return False
    old_text, content = old_text.casefold(), content.casefold()

    def stood(span: str, before: str, after: str) -> bool:
        if not span.strip():
            return True
        return any(len((variant := before[len(before) - k:] + span if side == "before" else span + after[:k]).strip()) >= 2
                   and variant in said for k in (0, 1, 2) for side in ("before", "after"))

    matcher = difflib.SequenceMatcher(None, old_text, content, autojunk=False)
    changed = False
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        changed = True
        if j2 > j1 and not stood(content[j1:j2], content[:j1], content[j2:]):
            return False
        # What is taken out without a word in its place has to be something the owner named.
        if j2 == j1 and not stood(old_text[i1:i2], old_text[:i1], old_text[i2:]):
            return False
    return changed


def told_stamp(name: str, day: str) -> str:
    """What a shared entry ends with: the member the owner told it to, and the day."""
    return f" — {' '.join(name.split())[:60]} · {day}"


def _fold(entry: str) -> str:
    """The entry as it is compared: its words, without its mark, its stamp, spacing or punctuation."""
    return "".join(char for char in normalized(_TOLD.sub("", without_mark(entry))) if char.isalnum())


def _holds(longer: Sequence[str], shorter: Sequence[str]) -> bool:
    """Whether `shorter` runs unbroken through `longer`, and no negation stands before it."""
    size = len(shorter)
    return size >= _MIN_PARTS and any(
        list(longer[start:start + size]) == list(shorter) and (start == 0 or longer[start - 1] not in _NEGATIONS)
        for start in range(len(longer) - size + 1))


def relation(new: str, old: str, near: float = NEAR) -> str | None:
    """What the text `new` is to the entry `old`: "same", "inside" (it says less), "wider" (it says
    more), "near" (another wording: nearly the same characters and words in any order), or None."""
    if _fold(new) == _fold(old):
        return "same"
    a, b = parts(_TOLD.sub("", without_mark(new))), parts(_TOLD.sub("", without_mark(old)))
    if _holds(b, a):
        return "inside"
    if _holds(a, b):
        return "wider"
    x, y = set(a), set(b)
    if min(len(x), len(y)) >= _MIN_MARKS and len(x & y) / len(x | y) >= near:
        return "near"
    return None


def parse_entries(raw: str) -> list[str]:
    """The entries of a file: stripped, each once, in order."""
    text = raw.replace("\r\n", "\n").replace("\r", "\n")
    return list(dict.fromkeys(entry for entry in (part.strip() for part in _BLANK_LINE.split(text)) if entry))


def render_entries(entries: Sequence[str]) -> str:
    return ENTRY_DELIMITER.join(entries) + "\n" if entries else ""


def clean_entry(text: str) -> str:
    """Text as one entry: no blank line inside it, so that it stays one."""
    return _BLANK_LINE.sub("\n", text.replace("\r\n", "\n").replace("\r", "\n")).strip()


# Typography a model re-types differently from the stored entry: every quote/backtick -> "'",
# every dash/minus -> "-". Plus whitespace runs (re-wrapped lines, NBSP) -> one space.
_MATCH_FOLD = str.maketrans({**dict.fromkeys("\"`‘’‚‛“”„‟", "'"),
                             **dict.fromkeys("‐‑‒–—―−", "-")})


def _normalize_for_match(text: str) -> str:
    return " ".join(str(text).replace("\\n", " ").translate(_MATCH_FOLD).split())


def _substring_matches(entries: Sequence[str], old_text: str) -> list[int]:
    """Indices of entries containing `old_text`: byte-exact first, else typography-folded."""
    if exact := [i for i, entry in enumerate(entries) if old_text in entry]:
        return exact
    needle = _normalize_for_match(old_text)
    if not any(char.isalnum() for char in needle):  # punctuation/space alone would select a whole entry
        return []
    return [i for i, entry in enumerate(entries) if needle in _normalize_for_match(entry)]


def _find_unique_match(entries: Sequence[str], old_text: str) -> tuple[int | None, bool]:
    """`(index, ambiguous)` for the entries matching `old_text`. A whole-entry match wins, so a short
    entry stays addressable when its text is inside a longer one."""
    matches = [i for i, entry in enumerate(entries) if entry == old_text] or _substring_matches(entries, old_text)
    if len(matches) > 1:
        return None, True
    return (matches[0] if matches else None), False


def _closest(entries: Sequence[str], old_text: str) -> list[str]:
    """The entries sharing the most terms with `old_text`: a stale old_text still shares most of them."""
    wanted = set(tokens(old_text))
    if not wanted:
        return []
    scored = sorted(((len(wanted & set(tokens(entry))) / len(wanted), i) for i, entry in enumerate(entries)),
                    key=lambda pair: (-pair[0], pair[1]))
    return [entries[i] for score, i in scored[:3] if score >= 0.3]


def _span_occurrences(text: str, span: str) -> int:
    """Occurrences of `span` in `text`, overlapping ones included: '00' occurs twice in '1000'."""
    return sum(text.startswith(span, i) for i in range(len(text) - len(span) + 1))


def _listed(title: str, entries: Sequence[str]) -> str:
    return f"\n{title}:\n" + "\n".join(f"- {entry}" for entry in entries) if entries else ""


def _refusal(*texts: str) -> tuple[str, str] | None:
    """Why text may not enter the memory, as a kind and a sentence the model can act on. Neither
    holds the text."""
    refused = scan.refusal(*texts)
    if refused is None:
        return None
    kind = refused.split(":", 1)[0]
    return kind, ("A memory must never hold a password, a key, a token, a code or a card number."
                  if kind == "secret" else
                  "A memory must be a plain fact, not instructions, commands or links that send data away. "
                  "It enters your prompt in every later turn. Nothing was written.")


class Refused(Exception):
    """One operation of a batch may not be applied: nothing of the batch is."""

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind


class MemoryFile:
    """One living file: the member's MEMORY.md, or with no member the owner's shared USER.md."""

    def __init__(self, homes, member_id: int | None, *, on_change: Callable[[], None] | None = None, conn=None, now_ms=None, owner_thread=None) -> None:
        self.homes = homes
        self.member_id = member_id
        self.name = "USER.md" if member_id is None else "MEMORY.md"
        self.target = "user" if member_id is None else "memory"
        self.limit = USER_CHAR_LIMIT if member_id is None else MEMORY_CHAR_LIMIT
        self._on_change = on_change
        self._failures = 0
        # Counts the clears, so that a pass that read the file before one applies nothing after it.
        self.clears = 0
        from .entry_metadata import EntryMetadata
        from ..clock import wall_clock_ms
        self.metadata = EntryMetadata(conn, 'shared' if member_id is None else f'member:{member_id}', now_ms or wall_clock_ms, owner_thread) if conn is not None else None

    # --- reading -----------------------------------------------------------------------------------

    def _path(self):
        if self.member_id is None:
            return self.homes.safe(self.homes.root / "shared" / self.name)
        return self.homes.path(self.member_id, self.name)

    def _raw(self) -> str:
        """The file's text; "" when there is none. OSError or UnicodeError when it cannot be read: a
        write must then refuse, since saving from an assumed-empty view would wipe the file. The BOM a
        Windows editor leaves is no part of the first entry."""
        path = self._path()
        return path.read_text(encoding="utf-8-sig") if path.exists() else ""

    def read(self) -> str:
        """The live file, "" when it cannot be read."""
        try:
            return self._raw()
        except (OSError, ValueError) as exc:  # a file that is not text, or a linked path
            logger.warning("Could not read a memory file: %s", type(exc).__name__)
            return ""

    def entries(self) -> list[str]:
        entries = parse_entries(self.read())
        if self.metadata is not None:
            from .entry_metadata import LEGACY_UNTIL, checked_until
            with self.homes.locked(self.member_id):
                entries = parse_entries(self._raw())
                migrated = []
                expiry = []
                for entry in entries:
                    found = LEGACY_UNTIL.search(entry)
                    if found:
                        try:
                            until = checked_until(found[1])
                        except ValueError:
                            logger.warning('Memory expiry migration retained an invalid date')
                        else:
                            plain = LEGACY_UNTIL.sub('', entry).strip()
                            if plain:
                                migrated.append(plain)
                                expiry.append((plain, until))
                                continue
                    migrated.append(entry)
                self.metadata.sync(entries, migrated)
                for text, until in expiry:
                    self.metadata.set_until(text, until)
                # Store expiry first: a crash may repeat migration, but cannot erase the date.
                if migrated != entries:
                    self._persist(migrated)
                entries = migrated
        return entries

    def revision(self) -> str:
        """A mark of the file as it is now, for an edit made from a copy of it."""
        return hashlib.sha256(self.read().encode("utf-8")).hexdigest()

    def chars(self) -> int:
        return len(ENTRY_DELIMITER.join(self.entries()))

    def fill(self) -> float:
        return self.chars() / self.limit

    def usage(self) -> str:
        return self._usage(self.chars())

    def _usage(self, used: int) -> str:
        return f"{min(999, used * 100 // self.limit)}% — {used:,}/{self.limit:,} chars"

    def prompt_text(self) -> str:
        """The file as a turn reads it. A line that fails the scan (it reached the file by hand) is a
        note in the prompt alone: the file keeps it, for the owner to see and remove."""
        return ENTRY_DELIMITER.join(self._sanitized(entry) for entry in self.entries())

    def _sanitized(self, entry: str) -> str:
        if scan.refusal(entry) is None:
            return entry
        logger.warning("A memory entry was kept out of the prompt")
        return (f"[BLOCKED: an entry of {self.name} looks like instructions or holds a secret. It is not "
                "shown; the owner can remove it.]")

    # --- the turn's attempts -----------------------------------------------------------------------

    def reset_failures(self) -> None:
        self._failures = 0

    def _failed(self, kind: str, message: str) -> dict:
        """A refusal the model may retry, until it has tried enough for one turn."""
        self._failures += 1
        if self._failures > MAX_FAILURES_PER_TURN:
            return {"success": False, "done": True, "kind": "retry_cap", "error": (
                f"Memory edits failed {self._failures} times this turn. Stop retrying: leave the memory "
                "as it is and continue with your reply. The fact can be saved in a later turn.")}
        return {"success": False, "kind": kind, "error": message}

    # --- writing -----------------------------------------------------------------------------------

    def apply(self, operations: Sequence[dict], *, mark: str = "", told: str = "", unattended: bool = False, owner_text: str = "") -> dict:
        """Apply `operations` ({action: add|replace|remove, content?, old_text?}) to the live file, all
        or none, against the limit on their final result. `mark` is the mark of a turn that read
        outside content, `told` the stamp of a shared entry, and `unattended` a pass nobody watches,
        which may not empty the file or take most of it. The result is what the model is told."""
        ops = [dict(op) if isinstance(op, dict) else {} for op in operations]
        if self.metadata is not None:
            from .entry_metadata import checked_until
            try:
                for op in ops:
                    if 'until' in op:
                        checked_until(op['until'])
            except (ValueError, TypeError):
                return {'success': False, 'kind': 'bad_arguments', 'error': 'until must be an ISO date or null'}
        if not ops:
            return {"success": False, "kind": "bad_arguments", "error": "operations is empty."}
        for number, op in enumerate(ops, 1):
            if op.get("action") == "add" and (refused := _refusal(str(op.get("content") or ""))):
                return {"success": False, "kind": refused[0], "error": f"Operation {number}: {refused[1]}"}
        try:
            with self.homes.locked(self.member_id):
                try:
                    before = parse_entries(self._raw())
                except (OSError, ValueError):
                    return {"success": False, "kind": "read_failed", "error": (
                        f"{self.name} exists but could not be read right now. Writing from an empty view "
                        "would wipe it, so nothing was changed. Try again later.")}
                try:
                    working = self._walk(before, ops, mark=mark, told=told, owner_text=owner_text)
                except Refused as refused:
                    if refused.kind in ("secret", "injection"):
                        return {"success": False, "kind": refused.kind, "error": str(refused)}
                    return self._failed(refused.kind, str(refused))
                problem = self._final_check(before, working, ops, unattended)
                if problem is not None:
                    return self._failed(*problem)
                expiry = []
                for op in ops:
                    if 'until' not in op or not op.get('content') or op.get('action') == 'remove':
                        continue
                    matches = [entry for entry in working if str(op['content']) in entry]
                    if len(matches) != 1:
                        return self._failed('ambiguous', 'Expiry must identify one complete entry; use its full content.')
                    entry = matches[0]
                    if mark and not is_unconfirmed(entry) and not owner_stated(str(op['content']), owner_text):
                        return self._failed('unconfirmed_only', 'Outside content cannot change a confirmed entry expiry. Nothing was changed.')
                    expiry.append((entry, op['until']))
                changed = working != before
                if changed:
                    self._persist(working)
                if self.metadata is not None:
                    if not changed:
                        self.metadata.sync(before, working)
                    for entry, until in expiry:
                        changed = self.metadata.set_until(entry, until) or changed
        except (OSError, ValueError) as exc:
            logger.warning("Could not write a memory file: %s", type(exc).__name__)
            return {"success": False, "kind": "io", "error": f"{self.name} could not be written. Nothing was changed."}
        self._failures = 0
        if changed and self._on_change is not None:
            self._on_change()
        return {"success": True, "done": True, "target": self.target,
                "marked": any(is_unconfirmed(entry) and entry not in before for entry in working),
                "changed": changed, "usage": self._usage(len(ENTRY_DELIMITER.join(working))), "entry_count": len(working),
                "message": f"Applied {len(ops)} operation(s)." if changed else "Entry already exists (no duplicate added).",
                "note": "Write saved. This update is complete: do not repeat it."}

    def _walk(self, entries: Sequence[str], ops: Sequence[dict], *, mark: str, told: str, owner_text: str = "") -> list[str]:
        working = list(entries)
        for number, op in enumerate(ops, 1):
            action = op.get("action")
            content = str(op.get("content") or op.get("new_text") or "")
            old_text = str(op.get("old_text") or "")
            where = f"Operation {number} ({action or 'unknown'})"
            if action == "add":
                inherited = next((value for value in _UNCONFIRMED_MARKS if content.startswith(value)), "")
                if not inherited:
                    inherited = next((value for entry in entries if is_unconfirmed(entry) and relation(content, entry)
                                      in ("same", "inside", "wider", "near") for value in _UNCONFIRMED_MARKS if entry.startswith(value)), "")
                confirmed = owner_stated(content, owner_text)
                note_mark = "" if confirmed else mark or inherited
                self._add(working, clean_entry(content), where, mark=note_mark, told=told,
                          alone=len(ops) == 1, confirmed=confirmed)
            elif action in ("replace", "remove"):
                index, ambiguous = _find_unique_match(working, old_text)
                patched = working[index].replace(old_text, content, 1) if index is not None and not ambiguous else ""
                confirmed = action == "replace" and owner_stated(patched, owner_text)
                owner_edit = action == "replace" and not confirmed and owner_replaced(old_text, content, owner_text)
                self._edit(working, action, old_text, content, where, mark="" if confirmed else mark,
                           told=told, alone=len(ops) == 1, confirmed=confirmed, owner_edit=owner_edit)
            else:
                raise Refused("bad_arguments", f"{where}: unknown action. Use add, replace or remove.")
        return working

    def _add(self, working: list[str], content: str, where: str, *, mark: str, told: str, alone: bool, confirmed: bool = False) -> None:
        if not without_mark(content).strip():
            raise Refused("bad_arguments", f"{where}: content is required.")
        fresh = mark + _TOLD.sub("", without_mark(content)) + told
        for index, entry in enumerate(working):
            found = relation(content, entry)
            if found == "same":
                if is_unconfirmed(entry) and confirmed:
                    working[index] = fresh
                return
            if found == "inside":
                return
            if found == "wider" and (not mark or is_unconfirmed(entry)):
                if is_unconfirmed(entry) and not confirmed and not mark:
                    fresh = next(value for value in _UNCONFIRMED_MARKS if entry.startswith(value)) + fresh
                working[index] = fresh
                return
            if found == "near":
                raise Refused("similar", (
                    f"{where}: an entry already says nearly this, and one fact keeps one line. If the new text "
                    "changes or adds to it, retry with 'replace', old_text set to that entry; if it says the "
                    f"same, there is nothing to do.\nThe entry: {entry}"))
        working.append(fresh)

    def _edit(self, working: list[str], action: str, old_text: str, content: str, where: str, *, mark: str, told: str, alone: bool,
              confirmed: bool = False, owner_edit: bool = False) -> None:
        if not old_text.strip():
            raise Refused("missing_old_text", (
                f"{where}: old_text is required: a short unique part of the entry. Retry with old_text set "
                "to part of one of the entries below." + _listed("current_entries", working)))
        index, ambiguous = _find_unique_match(working, old_text if action == "replace" else old_text.strip())
        if ambiguous:
            raise Refused("ambiguous", f"{where}: '{old_text}' matched several entries. Include more of the one you mean.")
        if index is None:
            near = working if alone else _closest(working, old_text)
            raise Refused("no_match", (
                f"{where}: no entry matched '{old_text}'. Retry with old_text copied verbatim from the entry "
                "you mean; old_text comes from ONE entry." + _listed("current_entries" if alone else "closest_entries", near)))
        entry = working[index]
        # The owner's own correction in this private turn is not outside content, whatever else the turn read.
        if mark and not is_unconfirmed(entry) and not owner_edit:
            raise Refused("unconfirmed_only", (
                f"{where}: this turn read outside content, so it may add entries and edit the ones marked as "
                "unconfirmed, and never changes what the owner has confirmed, unless the owner's own message in this "
                "private conversation says the change (then retry with old_text and content as the owner put it). Nothing "
                "was changed; add it as a new entry if it is worth keeping, and the owner can confirm it."))
        if action == "remove":
            del working[index]
            return
        if not content.strip():
            raise Refused("bad_arguments", (
                f"{where}: content is required: the text that takes the place of old_text. To drop part of an "
                "entry, replace a longer span that holds it; 'remove' deletes the whole entry."))
        count = _span_occurrences(entry, old_text)
        if count > 1:
            raise Refused("ambiguous", f"{where}: '{old_text}' occurs {count} times in the entry, and replace edits one span. Include more of the text around it.")
        if count == 0:
            raise Refused("no_match", f"{where}: old_text is not an exact part of the entry. Retry with it copied verbatim.\nThe entry: {entry}")
        patched = clean_entry(entry.replace(old_text, content, 1))
        if confirmed:
            patched = without_mark(patched)
        elif is_unconfirmed(entry) and not is_unconfirmed(patched):
            patched = next(value for value in _UNCONFIRMED_MARKS if entry.startswith(value)) + patched
        if patched == entry:
            raise Refused("no_change", f"{where}: this leaves the entry as it is.")
        if refused := _refusal(patched):
            raise Refused(refused[0], f"{where}: {refused[1]}")
        if mark and not owner_edit and not is_unconfirmed(patched):
            patched = mark + patched
        if told:
            patched = _TOLD.sub("", patched) + told
        others = working[:index] + working[index + 1:]
        if any(_fold(other) == _fold(patched) for other in others):  # one fact keeps one line
            del working[index]
            return
        working[index] = patched

    def _final_check(self, before: Sequence[str], after: Sequence[str], ops: Sequence[dict], unattended: bool) -> tuple[str, str] | None:
        old_total = len(ENTRY_DELIMITER.join(before))
        new_total = len(ENTRY_DELIMITER.join(after))
        alone_removed = len(ops) == 1 and ops[0].get("action") == "remove"
        if before and not after and (unattended or not alone_removed):
            return "would_empty", (
                f"This would remove every entry of {self.name}. Merge entries into a shorter one instead of "
                "removing the last one. Nothing was changed.")
        if unattended and new_total < old_total * _UNATTENDED_KEEPS:
            return "too_much_removed", (
                f"This would take away more than half of {self.name}. Merge entries and keep their facts. "
                "Nothing was changed.")
        if new_total > self.limit and new_total > old_total:
            over = new_total - self.limit
            return "full", (
                f"{self.name} at {old_total:,}/{self.limit:,} chars; this would exceed the limit by {over:,} chars. "
                f"Retry as ONE 'operations' batch that removes or shortens (replace) stale entries from "
                f"current_entries below to free at least {over:,} chars AND makes this change: the limit is "
                "checked only on the batch's result. Merge what overlaps; drop what no longer matters."
                + _listed("current_entries", before))
        return None

    def _persist(self, entries: Sequence[str]) -> None:
        before = parse_entries(self._raw()) if self.metadata is not None else []
        text = render_entries(entries)
        if self.member_id is None:
            self.homes.shared_keep(self.name, text)
        else:
            self.homes.keep(self.member_id, self.name, text)
        if self.metadata is not None:
            self.metadata.sync(before, entries)

    def stale_entries(self, today: date, max_unused_days=90):
        return self.metadata.stale(self.entries(), today, max_unused_days) if self.metadata is not None else []

    def prune_stale(self, today: date, max_unused_days=90):
        entries = self.stale_entries(today, max_unused_days)
        if not entries:
            return None
        return self.apply([{'action': 'remove', 'old_text': entry} for entry in entries], unattended=True)

    def edit_document(self, text: str, revision: str | None) -> dict:
        """The owner's edit of the whole document, from the copy with `revision`. It refuses an edit
        from an old copy, since a member may have written meanwhile, and scans only what the edit adds:
        a line that failed the scan once must not keep the owner from saving the rest of the file."""
        try:
            with self.homes.locked(self.member_id):
                raw = self._raw()
                if revision is not None and hashlib.sha256(raw.encode("utf-8")).hexdigest() != revision:
                    return {"success": False, "kind": "changed", "error": "The memory changed while it was being edited."}
                known = {_fold(entry) for entry in parse_entries(raw)}
                entries = parse_entries(text)
                for entry in entries:
                    if _fold(entry) not in known and (refused := _refusal(entry)):
                        return {"success": False, "kind": refused[0], "error": refused[1]}
                changed = render_entries(entries) != raw
                if changed:
                    self._persist(entries)
        except (OSError, ValueError) as exc:
            logger.warning("Could not write a memory file: %s", type(exc).__name__)
            return {"success": False, "kind": "io", "error": "The memory could not be written."}
        if changed and self._on_change is not None:
            self._on_change()
        return {"success": True}

    def drop_said(self, contents: Sequence[str]) -> None:
        """Take away the entries that say what `contents` say: the other file holds them now."""
        folded = {_fold(content) for content in contents}
        changed = False
        try:
            with self.homes.locked(self.member_id):
                before = parse_entries(self._raw())
                after = [entry for entry in before if _fold(entry) not in folded]
                changed = after != before
                if changed:
                    self._persist(after)
        except (OSError, ValueError) as exc:  # the fact is kept in the other file all the same
            logger.warning("Could not write a memory file: %s", type(exc).__name__)
        if changed and self._on_change is not None:
            self._on_change()

    def clear(self) -> bool:
        """Empty the file; whether it held anything. The journal keeps what it held."""
        with self.homes.locked(self.member_id):
            held = bool(parse_entries(self._raw()))
            if held:
                self._persist([])
            self.clears += 1
        if held and self._on_change is not None:
            self._on_change()
        return held


@dataclass(frozen=True)
class MemorySnapshot:
    """The memory as one turn reads it, made once at the turn's start and never changed by what the turn
    writes: USER.md, which every member reads, then the member's own MEMORY.md, which changes more often
    (the start of the prompt stays the same for the provider's cache). `own` is None where no own file
    may be read: a room's turn, or work one member handed another."""

    shared: str = ""
    own: str | None = ""
    shared_usage: str = ""
    own_usage: str = ""

    def __bool__(self) -> bool:
        return bool(self.shared or self.own)

    def __str__(self) -> str:
        shared = f'<shared_memory file="USER.md" usage="{self.shared_usage}">\n{self.shared or "(empty)"}\n</shared_memory>'
        if self.own is None:
            return shared
        return f'{shared}\n<own_memory file="MEMORY.md" usage="{self.own_usage}">\n{self.own or "(empty)"}\n</own_memory>'

"""The move from one file a note to one living file a member, at the first start after it.

It looks for what the old store left, every start: the note files of `bots/<id>/memory/` and
`shared/memory/`, the documents made from them (`MEMORY.md`, `archive.md`, `shared/USER.md`,
`shared/team.md`) and the proposals of the review queue (`bot-state/<id>/pending/`). So there is no
marker to get wrong: once a folder holds none of these it is done, and a start that stopped half way
finishes the next time.

Nothing is lost. Everything is first copied, as it is, to `bot-state/<id>/notes-backup/`, outside the
homes. Then each note becomes one entry of its space's file, merged with what the file holds: the same
words, or words the file already says, are one entry; of two wordings the longer stays. A fact in the
shared file is not repeated in a member's own. A note past its date keeps its date in its words, since
it is the model's to remove and the store's old daily deletion is gone. A file over its limit stays
over it, every word, and the model is asked to consolidate it. A file that cannot be read stays where
it is, for the owner, with its copy in the backup.

What waited in the review queue was never approved, so it enters visibly: with the mark an entry from
outside carries (`store.UNCONFIRMED`), in the document the owner reads. A proposal that fails the scan
stays in the backup alone, and a proposal to delete a note deletes nothing.

Nothing here logs a note.
"""

import json
import hashlib
import logging
import re
import shutil
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from . import scan
from ..bots.homes import atomic, redact_secrets
from .store import UNCONFIRMED, clean_entry, parse_entries, relation, render_entries, told_stamp, without_mark
from .terms import marks

logger = logging.getLogger(__name__)

_TYPES = ("user", "preference", "person", "ongoing", "reference")
_ORDER = {kind: number for number, kind in enumerate(_TYPES)}
# How alike two old notes must be to be taken for one without a model to ask: a word changed in a long
# sentence may be another fact, so this is stricter than what a write is refused for.
_MERGE_NEAR = 0.95
# A title whose words are this much in its note's text says nothing the text does not.
_TITLE_SAID = 0.7
_DERIVED = ("MEMORY.md", "archive.md")
# A heading the old store gave a note in the documents it made from them.
_NOTE_HEADING = re.compile(rf"^## ((?:{'|'.join(_TYPES)})-[a-z0-9-]+)$", re.M)


@dataclass(frozen=True)
class _Note:
    name: str
    description: str
    kind: str
    body: str
    created: str
    updated: str
    expires: str | None
    member: int | None


def _field(fields: dict[str, str], key: str) -> str:
    value = fields.get(key, "")
    if value.startswith('"'):
        try:
            loaded = json.loads(value)
        except ValueError:
            return value.strip('"')
        return loaded if isinstance(loaded, str) else ""
    return value


def _parse(text: str, name: str) -> _Note:
    """The note in the text of a file. A file with no frontmatter is all body: it may be a topic someone
    wrote by hand, and a word of it is not to be lost."""
    lines = text.replace("\r\n", "\n").split("\n")
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None) if lines[0].strip() == "---" else None
    if end is None:
        return _Note(name, "", "", text.strip(), "", "", None, None)
    fields: dict[str, str] = {}
    for line in lines[1:end]:
        key, sep, value = line.partition(":")
        if sep:
            fields[key.strip()] = value.strip()
    member = fields.get("member", "")
    return _Note(name, " ".join(_field(fields, "description").split()), fields.get("type", ""),
                 "\n".join(lines[end + 1:]).strip(), fields.get("created", ""),
                 fields.get("updated", fields.get("created", "")), fields.get("expires") or None,
                 int(member) if member.isascii() and member.isdigit() else None)


def _entry_of(note: _Note) -> str:
    """A note as one entry: its text, with its title when the text does not say what the title says, and
    its date when it has one."""
    body = clean_entry(note.body)
    text = body or note.description
    title = marks(note.description)
    if body and title and len(title & marks(body)) / len(title) < _TITLE_SAID:
        text = f"{note.description}：{body}"
    return f"{text} (until {note.expires})" if note.expires else text


def _merged(entries: list[str], new: list[str]) -> list[str]:
    """`entries` with `new` added, one entry a fact."""
    kept = list(entries)
    for entry in new:
        for index, old in enumerate(kept):
            found = relation(entry, old, _MERGE_NEAR)
            if found in ("same", "inside"):
                break
            if found == "wider" or (found == "near" and len(entry) > len(old)):
                kept[index] = entry
                break
            if found == "near":
                break
        else:
            kept.append(entry)
    return kept


def _backup(path: Path, folder: Path) -> None:
    """A copy of `path` in `folder`, never over a different one."""
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / path.name
    data = path.read_bytes()
    number = 1
    while target.exists() and target.read_bytes() != data:
        target = folder / f"{path.stem}.{number}{path.suffix}"
        number += 1
    if not target.exists():
        shutil.copyfile(path, target)
        _retain_backups(folder, path.name, target, data)


def _retain_backups(folder, source, target, data):
    """Keep five versions per source; untracked, replaced and owner-edited files are never removed."""
    ledger = folder / ".raphael-backups.json"
    if ledger.is_symlink() or ledger.is_junction():
        raise OSError("backup_manifest")
    entries = json.loads(ledger.read_text(encoding="utf-8")) if ledger.exists() else []
    stat = target.stat()
    entries.append({"source": source, "name": target.name, "digest": hashlib.sha256(data).hexdigest(),
                    "identity": [stat.st_dev, stat.st_ino, stat.st_mtime_ns]})
    older = [entry for entry in entries if entry["source"] == source][:-5]
    for entry in older:
        candidate = folder / entry["name"]
        if candidate.parent != folder or candidate.is_symlink() or candidate.is_junction():
            continue
        if candidate.is_file():
            stat = candidate.stat()
            if ([stat.st_dev, stat.st_ino, stat.st_mtime_ns] != entry["identity"]
                    or hashlib.sha256(candidate.read_bytes()).hexdigest() != entry["digest"]):
                continue
            candidate.unlink()
    entries = [entry for entry in entries if entry not in older]
    atomic(ledger, json.dumps(entries, ensure_ascii=False).encode("utf-8"))


def _unlink(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError as exc:
        logger.warning("Could not remove a migrated memory file: %s", type(exc).__name__)


def _rescued(text: str, names: set[str]) -> list[str]:
    """What a document the old store made holds of a note whose file is gone."""
    parts = _NOTE_HEADING.split(text)
    entries = []
    for name, section in zip(parts[1::2], parts[2::2]):
        if name in names:
            continue
        lines = [line for line in section.strip().splitlines() if not re.match(r"^- \[[a-z]+\] .* → [a-z0-9-]+$", line)]
        if lines:
            entries.append(clean_entry("\n".join(lines)))
    return entries


class _Space:
    """What the old store left of one space: `documents` are the files it made from the notes."""

    def __init__(self, homes, member_id: int | None) -> None:
        self.homes, self.member_id = homes, member_id
        self.shared = member_id is None
        self.notes_dir = homes.root / "shared/memory" if self.shared else homes.home(member_id) / "memory"
        state = homes.root / "bot-state" / ("shared" if self.shared else str(member_id))
        self.backup_dir = state / "notes-backup"
        self.pending_dir = state / "pending"
        self.document = homes.root / "shared/USER.md" if self.shared else homes.home(member_id) / "MEMORY.md"
        self.team = homes.root / "shared/team.md" if self.shared else None

    def note_files(self) -> list[Path]:
        if not self.notes_dir.is_dir():
            return []
        return sorted(path for path in self.notes_dir.glob("*.md") if path.is_file() and path.name not in _DERIVED)

    def derived_files(self) -> list[Path]:
        return [self.notes_dir / name for name in _DERIVED if (self.notes_dir / name).is_file()]

    def pending_files(self) -> list[Path]:
        return sorted(self.pending_dir.glob("reference-pending-*.json")) if self.pending_dir.is_dir() else []

    def waiting(self) -> bool:
        return bool(self.note_files() or self.derived_files() or self.pending_files()
                    or (self.team is not None and self.team.exists()))

    def document_entries(self, note_names: set[str], backup: Callable[[Path], None]) -> list[str]:
        """What the file of this space already holds, without what the old store made it from."""
        entries: list[str] = []
        for path in (self.document, self.team):
            if path is None or not path.exists():
                continue
            backup(path)
            text = path.read_text(encoding="utf-8-sig")
            old = _NOTE_HEADING.search(text) is not None or text.startswith("# Raphael's memory (made from the files")
            entries += _rescued(text, note_names) if old else parse_entries(text)
        return entries


def _migrate_space(space: _Space, *, shared_entries: list[str], told: Callable[[int | None, str], str], mark: str) -> list[str]:
    homes = space.homes
    backup = lambda path: _backup(homes.safe(path), homes.safe(space.backup_dir))  # noqa: E731
    notes: list[_Note] = []
    readable: list[Path] = []
    for path in space.note_files():
        backup(path)
        try:
            notes.append(_parse(path.read_text(encoding="utf-8-sig"), path.stem))
            readable.append(path)
        except (OSError, UnicodeError):  # for the owner: it stays where it is, and in the backup
            logger.warning("A memory file could not be read and stays where it is")
    derived = space.derived_files()
    derived_names: set[str] = {note.name for note in notes}
    for path in derived:
        backup(path)
    living = space.document_entries(derived_names, backup)
    for path in derived:
        try:
            living += _rescued(path.read_text(encoding="utf-8-sig"), derived_names)
        except (OSError, UnicodeError):
            pass
    notes.sort(key=lambda note: (_ORDER.get(note.kind, len(_TYPES)), note.created, note.name))
    new = []
    for note in notes:
        entry = _entry_of(note)
        if entry and space.shared and note.member is not None:
            entry += told(note.member, note.updated[:10])
        if entry:
            new.append(entry)
    entries = _merged(living, new)
    if not space.shared:
        entries = [entry for entry in entries
                   if not any(relation(entry, known, _MERGE_NEAR) in ("same", "inside", "near") for known in shared_entries)]
    pending = space.pending_files()
    logs = []
    for path in pending:
        backup(path)
        try:
            item = json.loads(path.read_text(encoding="utf-8"))
            arguments = item["arguments"]
        except (OSError, ValueError, KeyError, TypeError):
            continue
        if arguments.get("op") == "remove":
            continue
        body = clean_entry(str(arguments.get("body") or ""))
        if not body or scan.refusal(body) is not None:
            continue
        if item.get("tool") == "memory_log":
            logs.append((item.get("created"), mark + body))
        elif not any(relation(body, entry, _MERGE_NEAR) in ("same", "inside") for entry in [*entries, *shared_entries]):
            entries.append(mark + without_mark(body))
    text = render_entries(list(dict.fromkeys(entries)))
    # Not through the bounded write: a word of an old store too big for it is still not to be lost, and the
    # backup above is its journal. The model is asked to consolidate a file over its limit.
    data = redact_secrets(text).encode("utf-8")
    if not space.document.exists() or space.document.read_bytes() != data:
        atomic(homes.safe(space.document), data)
    for created, line in logs:
        _log(homes, space.member_id, created, line)
    for path in [*readable, *derived, *pending, *([space.team] if space.team is not None and space.team.exists() else [])]:
        _unlink(path)
    for folder in (space.notes_dir, space.pending_dir):
        try:
            folder.rmdir()
        except OSError:  # it holds logs, or a file for the owner, or is not there
            pass
    return parse_entries(text)


def _safely(work: Callable[[], list[str]]) -> list[str] | None:
    """A space that cannot be moved now stays as it is, for the next start: the app starts anyway."""
    try:
        return work()
    except (OSError, ValueError) as exc:
        logger.warning("A memory folder could not be moved to its file: %s", type(exc).__name__)
        return None


def _log(homes, member_id: int, created, line: str) -> None:
    """A proposal for the daily log enters the log it was for, marked."""
    day = datetime.fromtimestamp(created / 1000).date().isoformat() if isinstance(created, int) and created > 86_400_000 else datetime.now().date().isoformat()
    relative = f"memory/log/{day}.md"
    path = homes.path(member_id, relative)
    old = path.read_text(encoding="utf-8") if path.exists() else ""
    if line not in old:
        homes.keep(member_id, relative, old + "\n" + line + "\n")


def migrate(homes, *, told_name: Callable[[int], str], language: str = "zh-TW") -> None:
    """Move whatever the old store left into the living files. Nothing to do costs a look at a few
    folders. The shared space goes first, so that a member's own does not repeat it."""
    mark = UNCONFIRMED.get(language, UNCONFIRMED["en"])

    def told(member: int | None, day: str) -> str:
        if member is None or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
            return ""
        return told_stamp(told_name(member), day)

    shared = _Space(homes, None)
    shared_entries = _safely(lambda: _migrate_space(shared, shared_entries=[], told=told, mark=mark)) if shared.waiting() else None
    members: set[int] = set()
    for base in (homes.root / "bots", homes.root / "bot-state"):
        if base.is_dir():
            members |= {int(path.name) for path in base.iterdir() if path.is_dir() and path.name.isdigit()}
    for member_id in sorted(members):
        space = _Space(homes, member_id)
        if not space.waiting():
            continue
        if shared_entries is None:
            shared_entries = _safely(lambda: parse_entries(shared.document.read_text(encoding="utf-8-sig")) if shared.document.exists() else []) or []
        _safely(lambda: _migrate_space(space, shared_entries=shared_entries, told=told, mark=mark))

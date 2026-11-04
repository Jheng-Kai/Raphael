"""Bounded bot homes. Only this allowlist is writable through bot document tools.

A home holds what a member is and has learned, as plain files: SOUL.md, written by the core alone from
the member's details, MEMORY.md, its skills and its daily logs. The owner's profile is one file for
every member, `shared/USER.md`. Skill metadata and the revision journal live outside the writable tree.
Migration is resumable: copy every file before removing any verified source file.

The lock around a read-modify-write of a memory file is adapted from NousResearch/hermes-agent
tools/memory_tool_store.py @ c419cf7c (MIT).
"""

import hashlib
import json
import os
import re
import secrets
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager, suppress
from datetime import datetime, date
from pathlib import Path, PurePosixPath

from ..memory import scan

try:
    import fcntl
except ImportError:
    fcntl = None
    import msvcrt

_LOCK = threading.RLock()
_PART = r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}"
_PATH = re.compile(rf"MEMORY\.md|memory/log/\d{{4}}-\d{{2}}-\d{{2}}\.md|skills/{_PART}/(?:SKILL\.md|references/(?:{_PART}/)*{_PART}\.(?:md|txt|json))")
MAX_BYTES = 128 * 1024
# How long a writer waits for another process to finish with a memory file.
_LOCK_WAIT_S = 30.0


def redact_secrets(text: str) -> str:
    """Preserve Markdown and ordinary facts, masking only credential-shaped content."""
    for pattern in (*scan._TOKEN_SHAPES, scan._SECRET_VALUE, scan._SECRET_GIVEN, scan._TAIWAN_ID, scan._IBAN):
        text = pattern.sub("[redacted]", text)
    text = scan._LONG_RUN.sub(lambda match: "[redacted]" if scan._looks_random(match[0]) else match[0], text)
    return scan._CARD.sub(lambda match: "[redacted]" if scan.find_secret(match[0]) else match[0], text)


class HomeError(ValueError):
    """A path, revision or bounded document was refused, without its contents."""


def digest(data: bytes | None) -> str | None:
    return None if data is None else hashlib.sha256(data).hexdigest()


def atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + secrets.token_hex(8) + ".part")
    try:
        with temporary.open("xb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        for attempt in range(40):
            try:
                os.replace(temporary, path)
                break
            except PermissionError:  # Windows: someone is reading the file this very moment
                if attempt == 39:
                    raise
                time.sleep(0.025)
    finally:
        temporary.unlink(missing_ok=True)


@contextmanager
def _file_lock(path: Path) -> Iterator[None]:
    """An exclusive lock on a file of its own, so that the document itself can be replaced atomically."""
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        if fcntl is not None:
            fcntl.flock(descriptor, fcntl.LOCK_EX)
        else:
            deadline = time.monotonic() + _LOCK_WAIT_S
            while True:
                try:
                    msvcrt.locking(descriptor, msvcrt.LK_NBLCK, 1)
                    break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise
                    time.sleep(0.02)
        try:
            yield
        finally:
            with suppress(OSError):
                if fcntl is not None:
                    fcntl.flock(descriptor, fcntl.LOCK_UN)
                else:
                    os.lseek(descriptor, 0, os.SEEK_SET)
                    msvcrt.locking(descriptor, msvcrt.LK_UNLCK, 1)
    finally:
        os.close(descriptor)


class BotHomes:
    def __init__(self, root: Path):
        self.root = root.resolve()

    def home(self, member_id: int) -> Path:
        if type(member_id) is not int or member_id < 0:
            raise HomeError("invalid member id")
        return self.root / "bots" / str(member_id)

    def state(self, member_id: int) -> Path:
        return self.root / "bot-state" / self.home(member_id).name

    def safe(self, path: Path) -> Path:
        if not path.resolve().is_relative_to(self.root):
            raise HomeError("path escapes data directory")
        for parent in (path, *path.parents):
            if parent == self.root:
                break
            if parent.is_symlink() or (hasattr(parent, "is_junction") and parent.is_junction()):
                raise HomeError("linked paths are not writable")
        return path

    def path(self, member_id: int, relative: str) -> Path:
        if not isinstance(relative, str) or not _PATH.fullmatch(relative):
            raise HomeError("document path is not allowed")
        if relative.startswith("memory/log/"):
            try:
                date.fromisoformat(PurePosixPath(relative).stem)
            except ValueError:
                raise HomeError("invalid log date") from None
        return self.safe(self.home(member_id) / relative)

    @contextmanager
    def locked(self, member_id: int | None) -> Iterator[None]:
        """One writer at a time for a member's MEMORY.md, or with no member the shared USER.md, across
        threads and processes. The lock file stays outside the home."""
        name = "shared/USER.md.lock" if member_id is None else f"{self.home(member_id).name}/MEMORY.md.lock"
        with _LOCK, _file_lock(self.safe(self.root / "bot-state" / name)):
            yield

    def _change(self, member_id: int, relative: str, data: bytes | None, expected_hash: str | None) -> str | None:
        path = self.path(member_id, relative)
        old = path.read_bytes() if path.exists() else None
        if digest(old) != expected_hash:
            raise HomeError("document changed; read it again before writing")
        if data == old:
            return digest(data)
        identifier = datetime.now().strftime("%Y%m%dT%H%M%S%f") + "-" + secrets.token_hex(6)
        journal = self.safe(self.state(member_id) / "journal" / f"{identifier}.json")
        entry = {"id": identifier, "path": relative, "before": None if old is None else old.decode("utf-8"),
                 "after_hash": digest(data), "before_hash": digest(old), "applied": False}
        atomic(journal, json.dumps(entry, ensure_ascii=False).encode("utf-8"))
        if data is None:
            path.unlink(missing_ok=True)
        else:
            atomic(path, data)
        entry["applied"] = True
        atomic(journal, json.dumps(entry, ensure_ascii=False).encode("utf-8"))
        return digest(data)

    def write(self, member_id: int, relative: str, text: str, *, expected_hash: str | None = None) -> str:
        if not isinstance(text, str) or "\x00" in text or len(text.encode("utf-8")) > MAX_BYTES:
            raise HomeError("document must be bounded UTF-8 text")
        data = redact_secrets(text).encode("utf-8")
        with _LOCK:
            return self._change(member_id, relative, data, expected_hash)

    def keep(self, member_id: int, relative: str, text: str) -> str:
        """Core store adapter: callers already validated a memory or owner import."""
        with _LOCK:
            path = self.path(member_id, relative)
            old = path.read_bytes() if path.exists() else None
            return self.write(member_id, relative, text, expected_hash=digest(old))

    def delete(self, member_id: int, relative: str, *, expected_hash: str | None) -> None:
        with _LOCK:
            self._change(member_id, relative, None, expected_hash)

    def journal(self, member_id: int) -> list[dict]:
        folder = self.safe(self.state(member_id) / "journal")
        return [json.loads(self.safe(path).read_text(encoding="utf-8")) for path in sorted(folder.glob("*.json"))]

    def revert(self, member_id: int, revision: str, *, expected_hash: str | None) -> str | None:
        with _LOCK:
            entry = next((item for item in self.journal(member_id) if item["id"] == revision), None)
            if entry is None:
                raise HomeError("revision does not exist")
            if "state" in entry:
                raise HomeError("state revisions must be restored through the core skill store")
            if expected_hash != entry["after_hash"]:
                raise HomeError("revision is no longer current")
            before = entry["before"]
            return self._change(member_id, entry["path"], None if before is None else before.encode("utf-8"), expected_hash)

    def soul(self, member_id: int, text: str) -> None:
        """Who the member is, as a plain file in its home. Core only: never a bot document operation,
        since no member may rewrite who it is."""
        with _LOCK:
            path = self.safe(self.home(member_id) / "SOUL.md")
            data = text.encode("utf-8")
            if not path.exists() or path.read_bytes() != data:
                atomic(path, data)

    def mirror(self, member_id: int, name: str, text: str) -> None:
        """Core-only mirrors. Never exposed as a bot document operation."""
        if name != "skills.json":
            raise HomeError("invalid state mirror")
        with _LOCK:
            path = self.safe(self.state(member_id) / name)
            data = text.encode("utf-8")
            if not path.exists() or path.read_bytes() != data:
                old = path.read_bytes() if path.exists() else None
                identifier = datetime.now().strftime("%Y%m%dT%H%M%S%f") + "-" + secrets.token_hex(6)
                journal = self.safe(self.state(member_id) / "journal" / f"{identifier}.json")
                entry = {"id": identifier, "state": name, "before": None if old is None else old.decode("utf-8"),
                         "before_hash": digest(old), "after_hash": digest(data), "applied": False}
                atomic(journal, json.dumps(entry, ensure_ascii=False).encode("utf-8"))
                atomic(path, data)
                entry["applied"] = True
                atomic(journal, json.dumps(entry, ensure_ascii=False).encode("utf-8"))

    def shared_keep(self, relative: str, text: str | None) -> None:
        """Owner/shared-room store boundary, never an arbitrary bot-home path."""
        if relative != "USER.md":
            raise HomeError("shared path is not allowed")
        with _LOCK:
            path = self.safe(self.root / "shared" / relative)
            old = path.read_bytes() if path.exists() else None
            data = None if text is None else redact_secrets(text).encode("utf-8")
            if data == old:
                return
            identifier = datetime.now().strftime("%Y%m%dT%H%M%S%f") + "-" + secrets.token_hex(6)
            journal = self.safe(self.root / "bot-state/shared/journal" / f"{identifier}.json")
            atomic(journal, json.dumps({"id": identifier, "path": relative,
                   "before": None if old is None else old.decode("utf-8"), "before_hash": digest(old),
                   "after_hash": digest(data), "applied": False}, ensure_ascii=False).encode("utf-8"))
            if data is None:
                path.unlink(missing_ok=True)
            else:
                atomic(path, data)
            entry = json.loads(journal.read_text(encoding="utf-8"))
            entry["applied"] = True
            atomic(journal, json.dumps(entry, ensure_ascii=False).encode("utf-8"))

    def shared_revert(self, revision: str, *, expected_hash: str | None) -> None:
        """Core-only shared undo with the same optimistic guard as private documents."""
        with _LOCK:
            folder = self.safe(self.root / "bot-state/shared/journal")
            entries = [json.loads(self.safe(path).read_text(encoding="utf-8")) for path in folder.glob("*.json")]
            entry = next((item for item in entries if item["id"] == revision and item.get("applied")), None)
            if entry is None:
                raise HomeError("shared revision does not exist")
            path = self.safe(self.root / "shared" / entry["path"])
            current = digest(path.read_bytes()) if path.exists() else None
            if current != expected_hash or expected_hash != entry["after_hash"]:
                raise HomeError("shared document changed; read it again before reverting")
            self.shared_keep(entry["path"], entry["before"])

    def migrate(self, legacy_memory: Path | None = None) -> None:
        with _LOCK:
            marker = self.safe(self.root / "bot-state/migration.json")
            if marker.exists():
                return
            memory = legacy_memory or self.root / "memory"
            moves = []
            for base, kind in ((memory, "memory"), (self.root / "member-skills", "skills")):
                if not base.exists():
                    continue
                self.safe(base)
                for source in sorted(base.rglob("*")):
                    self.safe(source)
                    if not source.is_file():
                        continue
                    parts = source.relative_to(base).parts
                    if kind == "skills":
                        if not parts[0].isdigit():
                            raise HomeError("invalid legacy skill owner")
                        target = self.home(int(parts[0])) / "skills" / Path(*parts[1:])
                        if len(parts) == 2 and source.suffix == ".md":
                            target = self.home(int(parts[0])) / "skills" / source.stem / "SKILL.md"
                    elif parts[0] == "shared":
                        target = self.root / "shared/memory" / Path(*parts[1:])
                    elif parts[0] == "members" and len(parts) >= 3 and parts[1].isdigit():
                        target = self.home(int(parts[1])) / "memory" / Path(*parts[2:])
                    else:
                        target = self.home(0) / ("MEMORY.md" if parts == ("MEMORY.md",) else "memory/" + "/".join(parts))
                    target = self.safe(target)
                    data = source.read_bytes()
                    if target.exists() and target.read_bytes() != data:
                        raise HomeError("migration destination contains a different document")
                    moves.append((source, target, data))
            for source, target, data in moves:
                if not target.exists():
                    atomic(target, data)
            for source, target, data in moves:
                if target.read_bytes() != data or source.read_bytes() != data:
                    raise HomeError("migration source changed")
                source.unlink()
            path = self.safe(self.root / "shared/USER.md")
            if not path.exists():
                atomic(path, b"")
            atomic(marker, json.dumps({"version": 1, "files": [{"from": str(s.relative_to(self.root)),
                   "to": str(t.relative_to(self.root)), "sha256": digest(data)} for s, t, data in moves]}, indent=2).encode())

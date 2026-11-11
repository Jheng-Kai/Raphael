"""Local skill packages and the shared view of the existing capability store.

Import is a bounded file copy. It never loads plugin configuration or runs code.
"""

import hashlib
import json
import os
import re
import stat
from pathlib import Path

from ..bots.homes import BotHomes, atomic
from .store import MemberError

SHARED = -1
MAX_PACKAGE_BYTES = 32 * 1024 * 1024
MAX_PACKAGE_FILES = 2000
MAX_DISCOVERY_ENTRIES = 20000
MAX_DISCOVERY_DEPTH = 12


class SkillHomes(BotHomes):
    def home(self, member_id):
        return self.root / "shared" if member_id == SHARED else super().home(member_id)


def roots(home):
    return [home / ".claude/skills", home / ".codex/skills", home / ".agents/skills",
            home / ".claude/plugins/cache", home / ".codex/plugins/cache"]


def linked(path):
    return path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction())


def package(folder):
    """Take one bounded snapshot, rejecting links, devices and ambiguous paths."""
    files = {}
    size = 0
    if any(linked(p) for p in (folder, *folder.parents)):
        raise MemberError("source", "linked skill packages are not supported")
    for directory, dirs, names in os.walk(folder, followlinks=False):
        for name in [*dirs, *names]:
            if linked(Path(directory) / name):
                raise MemberError("source", "linked skill packages are not supported")
        for name in sorted(names):
            path = Path(directory) / name
            if not path.is_file() or path.stat().st_size > MAX_PACKAGE_BYTES:
                raise MemberError("size", "skill package is too large")
            with path.open("rb") as stream:
                data = stream.read(MAX_PACKAGE_BYTES - size + 1)
            size += len(data)
            if size > MAX_PACKAGE_BYTES or len(files) >= MAX_PACKAGE_FILES:
                raise MemberError("size", "skill package is too large")
            files[path.relative_to(folder).as_posix()] = data
    if "SKILL.md" not in files:
        raise MemberError("source", "no SKILL.md in that folder")
    return files


def walk(folder, remaining, *, strict=False):
    """Bound directory enumeration and let discovery prune an entire skill subtree."""
    pending = [(folder, 0)]
    while pending:
        directory, depth = pending.pop()
        dirs, files = [], []
        with os.scandir(directory) as entries:
            for entry in entries:
                if remaining[0] <= 0:
                    raise MemberError("size", "local skill scan limit reached")
                remaining[0] -= 1
                path = Path(entry.path)
                if linked(path):
                    if strict:
                        raise MemberError("source", "linked skill packages are not supported")
                    continue
                if entry.is_dir(follow_symlinks=False):
                    if entry.name != "node_modules" and not entry.name.startswith("."):
                        dirs.append(path)
                else:
                    info = entry.stat(follow_symlinks=False)
                    if stat.S_ISREG(info.st_mode):
                        files.append((path, info))
                    elif strict:
                        raise MemberError("source", "skill packages contain only regular files")
        yield directory, dirs, files
        if depth < MAX_DISCOVERY_DEPTH:
            pending.extend((path, depth + 1) for path in sorted(dirs, reverse=True))
        elif strict and dirs:
            raise MemberError("size", "skill package nesting is too deep")


def fingerprint(folder, remaining=None):
    """Fingerprint visible package metadata without opening any file bodies."""
    digest = hashlib.sha256()
    files, size = [], 0
    for _, _, entries in walk(folder, remaining if remaining is not None else [MAX_DISCOVERY_ENTRIES], strict=True):
        for path, info in entries:
            size += info.st_size
            files.append((path.relative_to(folder).as_posix(), info.st_size, info.st_mtime_ns))
            if size > MAX_PACKAGE_BYTES or len(files) > MAX_PACKAGE_FILES:
                raise MemberError("size", "skill package is too large")
    for entry in sorted(files):
        digest.update(json.dumps(entry, ensure_ascii=False).encode() + b"\0")
    return digest.hexdigest()


def location(home, source):
    if not isinstance(source, str) or not source.startswith("local:") or not Path(source[6:]).is_absolute():
        raise MemberError("source", "choose an installed skill from the local source list")
    folder = Path(source[6:])
    if any(linked(path) for path in (folder, *folder.parents)):
        raise MemberError("source", "linked skill packages are not supported")
    folder = folder.resolve()
    for root in roots(home):
        if any(linked(path) for path in (root, *root.parents)):
            continue
        root = root.resolve()
        if folder.is_relative_to(root) and folder != root:
            relative = folder.relative_to(root).parts
            if not any(part == "node_modules" or part.startswith(".") for part in relative):
                return folder, root
    raise MemberError("source", "choose an installed skill from the local source list")


def identity(folder, root):
    relative = folder.relative_to(root).parts
    if root.name == "cache" and len(relative) >= 3:
        return (os.path.normcase(str(root)), *relative[:2], *relative[3:])
    return (os.path.normcase(str(folder)),)


def version_key(version):
    """SemVer precedence, accepting installed caches' legacy major.minor folders too."""
    match = re.fullmatch(r"v?(\d+)\.(\d+)(?:\.(\d+))?(?:-([\da-zA-Z.-]+))?(?:\+[\da-zA-Z.-]+)?", version)
    if not match:
        return (0, 0, 0, 0, False, ())
    prerelease = match[4]
    identifiers = tuple((0, int(part)) if part.isdigit() else (1, part)
                        for part in prerelease.split(".")) if prerelease else ()
    return (1, int(match[1]), int(match[2]), int(match[3] or 0), prerelease is None, identifiers)


def rank(folder, root):
    relative = folder.relative_to(root).parts
    version = root.joinpath(*relative[:3]) if root.name == "cache" and len(relative) >= 3 else folder
    return (version_key(version.name), version.stat().st_mtime_ns, str(folder))


def newest(folder, root):
    """Resolve this skill across sibling versions, never scan another plugin's files."""
    relative = folder.relative_to(root).parts
    if root.name != "cache" or len(relative) < 3:
        return folder
    candidates = []
    with os.scandir(root.joinpath(*relative[:2])) as entries:
        for number, entry in enumerate(entries):
            if number >= MAX_DISCOVERY_ENTRIES:
                raise MemberError("size", "local skill scan limit reached")
            if entry.name.startswith(".") or entry.name == "node_modules" or not entry.is_dir(follow_symlinks=False):
                continue
            candidate = Path(entry.path).joinpath(*relative[3:])
            if any(linked(path) for path in (candidate, *candidate.parents)):
                continue
            if (candidate / "SKILL.md").is_file():
                candidates.append(candidate)
    if not candidates:
        raise MemberError("source", "no installed version of that skill")
    return max(candidates, key=lambda path: rank(path, root))


def describe(folder, root, remaining=None, document=None):
    from .capabilities import MAX_SKILL_BYTES, skill_metadata

    stamp = fingerprint(folder, remaining)
    if document is None:
        with (folder / "SKILL.md").open("rb") as stream:
            document = stream.read(MAX_SKILL_BYTES + 1)
    if len(document) > MAX_SKILL_BYTES:
        raise MemberError("size", "skill document is too large")
    name, description = skill_metadata(document.decode("utf-8-sig"))
    relative = folder.relative_to(root).parts
    plugin = relative[1] if root.name == "cache" and len(relative) >= 3 else ""
    return {"source": "local:" + str(folder), "name": name, "description": description,
            "plugin": plugin, "fingerprint": stamp}


class SkillLibrary:
    def local_sources(self):
        result, ranks = {}, {}
        remaining = [MAX_DISCOVERY_ENTRIES]
        for root in roots(self.skill_home):
            if not root.is_dir() or any(linked(path) for path in (root, *root.parents)):
                continue
            root = root.resolve()
            try:
                for folder, dirs, files in walk(root, remaining):
                    if not any(path.name == "SKILL.md" for path, _ in files):
                        continue
                    dirs[:] = []
                    try:
                        key, precedence = identity(folder, root), rank(folder, root)
                        if key in ranks and precedence <= ranks[key]:
                            continue
                        candidate = describe(folder, root, remaining)
                    except (OSError, UnicodeError, MemberError):
                        continue
                    result[key], ranks[key] = candidate, precedence
            except (OSError, MemberError):
                pass
            if remaining[0] <= 0:
                break
        return sorted(result.values(), key=lambda item: item["source"])

    def import_local(self, member_id, source):
        folder, root = location(self.skill_home, source)
        folder = newest(folder, root)
        files = package(folder)
        if any(name.casefold() == ".raphael-source.json" for name in files):
            raise MemberError("source", "reserved skill metadata filename")
        text = files.pop("SKILL.md").decode("utf-8-sig")
        previous = None
        for skill in self.owned_skills(member_id):
            if skill["source"].startswith("local:"):
                try:
                    old_folder, old_root = location(self.skill_home, skill["source"])
                except MemberError:
                    continue
                if identity(old_folder, old_root) == identity(folder, root):
                    previous = skill
                    break
        from .capabilities import skill_metadata
        skill_metadata(text, writing=True, previous_name=previous["name"] if previous else None)
        candidate = describe(folder, root, document=text.encode("utf-8"))
        skill = (self.rewrite_skill(member_id, previous["id"], text) if previous else
                 self.keep_skill(member_id, candidate["source"], text))
        if previous:
            with self.conn:
                self.conn.execute("UPDATE member_skills SET source=? WHERE member_id=? AND id=?",
                                  (candidate["source"], member_id, skill["id"]))
        folder = self._path(member_id, skill["id"]).parent
        metadata = folder / ".raphael-source.json"
        old = json.loads(metadata.read_text(encoding="utf-8")) if metadata.exists() else {}
        for name in old.get("files", []):
            path = self.homes.safe(folder / name)
            if name not in files:
                path.unlink(missing_ok=True)
        for name, data in files.items():
            atomic(self.homes.safe(folder / name), data)
        atomic(metadata, json.dumps({**candidate, "files": list(files)}, ensure_ascii=False).encode())
        self._mirror(member_id)
        return self._skill(member_id, skill["id"])

    def source_details(self, member_id, identifier):
        row = self.conn.execute("SELECT k.set_id,k.set_kind,s.name,s.version FROM member_skills k JOIN skill_sets s ON s.id=k.set_id WHERE k.id=?", (identifier,)).fetchone()
        if row:
            return {"set_id": row["set_id"], "set_kind": row["set_kind"], "plugin": row["name"], "plugin_version": row["version"]}
        path = self._path(member_id, identifier).parent / ".raphael-source.json"
        if not path.exists():
            return {}
        info = json.loads(self.homes.safe(path).read_text(encoding="utf-8"))
        try:
            folder, root = location(self.skill_home, info["source"])
            changed = fingerprint(newest(folder, root)) != info["fingerprint"]
        except (OSError, MemberError):
            changed = None
        return {"source_changed": changed, **({"plugin": info["plugin"]} if info.get("plugin") else {})}

    def skill_owner(self, member_id, identifier):
        row = self.conn.execute("SELECT member_id FROM member_skills WHERE id=?", (identifier,)).fetchone()
        return SHARED if row and row[0] == SHARED else member_id

    def require_owned(self, member_id, identifier):
        if self.skill_owner(member_id, identifier) != member_id:
            raise MemberError("scope", "edit shared skills in the shared library")
        if self.conn.execute("SELECT set_id FROM member_skills WHERE id=? AND set_id IS NOT NULL", (identifier,)).fetchone():
            raise MemberError("scope", "update or remove this skill through its plugin set")

    def native_skills(self, member_id):
        return [{"name": s["slash_name"], "path": str(self._path(member_id, s["id"])),
                 **({"plugin_root": str(self.plugin_root(s["set_id"]))} if s.get("set_id") else {})}
                for s in self.skills(member_id) if s["enabled"]]

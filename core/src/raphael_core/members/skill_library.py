"""Local skill packages and the shared view of the existing capability store.

Import is a bounded file copy. It never loads plugin configuration or runs code.
"""

import asyncio
import hashlib
import json
import os
import re
import stat
from contextlib import suppress
from pathlib import Path

from ..bots.homes import BotHomes, HomeError, atomic
from .skill_errors import oversized_package, too_many_files
from .store import MemberError

SHARED = -1
# What an import may hold is bounded only by what would keep the app busy for good: an ordinary skill or plugin, assets and
# all, is far below each of these. Whatever crosses one is refused with the file, its size and the limit (skill_errors.py).
MAX_PACKAGE_BYTES = 256 * 1024 * 1024  # the files one import holds in memory
MAX_PACKAGE_FILES = 100_000  # the files one import holds
MAX_ARCHIVE_ENTRIES = 200_000  # the entries an archive may list, however few of them are taken
MAX_UPLOAD_BYTES = 128 * 1024 * 1024  # a file the window reads and sends (base64 in one message); the folder has none
MAX_SCAN_ENTRIES = 2_000_000  # what the walk of a picked folder looks at to find skills
MAX_DISCOVERY_DEPTH = 64  # folders below the one picked
# What the automatic list of installed skills and plugins scans (the owner picks nothing there).
MAX_DISCOVERY_ENTRIES = 20000
# Never part of a skill: what a tool, a run or an operating system leaves in a folder.
# What macOS leaves beside every file it archives or indexes is among it: Finder's `__MACOSX` folder and the `._name` files
# (AppleDouble, binary) of a ZIP or a tar made on a Mac, `.DS_Store`, and the folders of a volume.
JUNK_FOLDERS = frozenset({"node_modules", "__pycache__", "__macosx", ".git", ".appledouble", ".spotlight-v100", ".trashes",
                          ".fseventsd", ".temporaryitems"})
JUNK_FILES = frozenset({".ds_store", "thumbs.db", "desktop.ini", ".localized"})


def junk(path):
    """Whether a path (a name, or a `/` path) is such a leftover and so no part of a skill."""
    parts = path.replace("\\", "/").split("/")
    last = parts[-1].casefold()
    return (any(part.casefold() in JUNK_FOLDERS for part in parts[:-1]) or last in JUNK_FILES or last in JUNK_FOLDERS
            or last.startswith("._"))


class SkillHomes(BotHomes):
    def home(self, member_id):
        return self.root / "shared" if member_id == SHARED else super().home(member_id)


async def stage_files(write, *args, discard):
    """A cancelled caller cannot publish staged files, even if the writer is still running."""
    worker = asyncio.create_task(asyncio.to_thread(write, *args))
    try:
        return await asyncio.shield(worker)
    except asyncio.CancelledError:
        with suppress(Exception):
            staged = await worker
            await asyncio.to_thread(discard, staged)
        raise


def roots(home):
    return [home / ".claude/skills", home / ".codex/skills", home / ".agents/skills",
            home / ".claude/plugins/cache", home / ".codex/plugins/cache"]


def linked(path):
    return path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction())


def package(folder, *, installed=False, cached=False):
    """Take one bounded snapshot, copying only verified files and in-folder file aliases."""
    from .skill_sources import folder_snapshot

    try:
        files = folder_snapshot(folder, installed=installed, skill_links=True, cached=cached).finish()
    except OSError as error:
        raise MemberError("not_found", "skill files are unavailable") from error
    return files


def walk(folder, remaining, *, strict=False, hidden=False):
    """Bound directory enumeration and let discovery prune an entire skill subtree. A folder the owner picked is searched
    through its hidden folders too (`.claude/skills`), never through what `junk` names."""
    pending = [(folder, 0)]
    while pending:
        directory, depth = pending.pop()
        dirs, files = [], []
        with os.scandir(directory) as entries:
            for entry in entries:
                if remaining[0] <= 0:
                    raise MemberError("size", "this folder holds too many entries to search for skills: pick the folder "
                                      "of the skill itself", reason="scan")
                remaining[0] -= 1
                path = Path(entry.path)
                if linked(path):
                    if strict and path.is_symlink():
                        info = path.lstat()
                        files.append((path, info))
                    elif strict:
                        raise MemberError("source", "linked skill packages are not supported")
                    continue
                if entry.is_dir(follow_symlinks=False):
                    if not junk(entry.name) if hidden else entry.name != "node_modules" and not entry.name.startswith("."):
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
            if size > MAX_PACKAGE_BYTES:
                raise oversized_package(files[-1][0], size, MAX_PACKAGE_BYTES)
            if len(files) > MAX_PACKAGE_FILES:
                raise too_many_files(len(files), MAX_PACKAGE_FILES, files[-1][0])
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
        from .skill_errors import oversized_file
        raise oversized_file(f"{folder.name}/SKILL.md", len(document), MAX_SKILL_BYTES)
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

    def _local_candidate(self, source, skills):
        folder, root = location(self.skill_home, source)
        folder = newest(folder, root)
        files = package(folder)
        if any(name.casefold() == ".raphael-source.json" for name in files):
            raise MemberError("source", "reserved skill metadata filename")
        text = files["SKILL.md"].decode("utf-8-sig")
        previous = None
        for skill in skills:
            if skill["source"].startswith("local:"):
                try:
                    old_folder, old_root = location(self.skill_home, skill["source"])
                except MemberError:
                    continue
                if identity(old_folder, old_root) == identity(folder, root):
                    previous = skill
                    break
        from .capabilities import skill_metadata
        skill_metadata(text, writing=True, previous_name=previous["name"].rsplit(":", 1)[-1] if previous else None)
        candidate = describe(folder, root, document=text.encode("utf-8"))
        return candidate, files, previous, text

    def _local_import_snapshot(self, source, skills, root):
        try:
            folder, _ = location(self.skill_home, source)
        except MemberError:
            return None
        if not (folder / "SKILL.md").is_file():
            return None
        candidate, files, previous, _ = self._local_candidate(source, skills)
        preserved = {}
        if previous:
            folder = self.homes.safe(root / str(previous["id"]))
            old = self._package_info_at(folder / "SKILL.md")
            if folder.is_dir():
                preserved = {path: data for path, data in package(folder, installed=True).items()
                             if path != "SKILL.md" and path not in old.get("files", [])}
        return files, {"metadata": candidate, "previous": previous, "preserved": preserved}

    def import_local(self, member_id, source):
        candidate, files, previous, text = self._local_candidate(source, self.owned_skills(member_id))
        files.pop("SKILL.md")
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
        atomic(metadata, json.dumps({**candidate, "files": list(files),
               **({"skipped_links": files.skipped_links} if files.skipped_links else {})}, ensure_ascii=False).encode())
        self._mirror(member_id)
        return self._skill(member_id, skill["id"])

    def package_info(self, member_id, identifier):
        return self._package_info_at(self._path(member_id, identifier))

    def _package_info_at(self, path):
        try:
            metadata = self.homes.safe(path.parent / ".raphael-source.json")
            info = json.loads(metadata.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            return {}
        return info if isinstance(info, dict) else {}

    def source_details(self, path):
        info = self._package_info_at(path)
        skips = {"skipped_links": info["skipped_links"]} if info.get("skipped_links") else {}
        if "fingerprint" not in info:
            return skips
        try:
            folder, root = location(self.skill_home, info["source"])
            changed = fingerprint(newest(folder, root)) != info["fingerprint"]
        except (OSError, MemberError):
            changed = None
        return {"source_changed": changed, **skips, **({"plugin": info["plugin"]} if info.get("plugin") else {})}

    def skill_owner(self, member_id, identifier):
        row = self.conn.execute("SELECT member_id FROM member_skills WHERE id=?", (identifier,)).fetchone()
        return SHARED if row and row[0] == SHARED else member_id

    def require_owned(self, member_id, identifier):
        if self.skill_owner(member_id, identifier) != member_id:
            raise MemberError("scope", "edit shared skills in the shared library")
        if self.conn.execute("SELECT set_id FROM member_skills WHERE id=? AND set_id IS NOT NULL", (identifier,)).fetchone():
            raise MemberError("scope", "update or remove this skill through its plugin set")

    def native_skills(self, member_id):
        return self._native_skill_paths(self._native_skill_inputs(member_id))

    async def native_skills_async(self, member_id):
        while True:
            revision = self.skill_revision()
            skills = await asyncio.to_thread(self._native_skill_paths, self._native_skill_inputs(member_id))
            if revision == self.skill_revision():
                return skills

    def _native_skill_inputs(self, member_id):
        skills = [skill for skill in self.skills(member_id, details=False) if skill["enabled"]]
        return self._skill_detail_inputs(skills, member_id)

    def _native_skill_paths(self, inputs):
        result = []
        for _, skill, path, plugin in inputs:
            entry = {"name": skill["slash_name"]}
            try:
                entry["path"] = str(self.homes.safe(path))
                if plugin:
                    entry["plugin_root"] = str(self.homes.safe(plugin["root"]))
            except (HomeError, OSError):
                pass
            result.append(entry)
        return result

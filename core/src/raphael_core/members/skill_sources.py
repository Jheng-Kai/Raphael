"""Read bounded skill documents and attachment trees without extracting an archive."""

import base64
import binascii
import gzip
import io
import os
import stat
import struct
import tarfile
import zipfile
import zlib
from pathlib import Path, PureWindowsPath

from .capabilities import MAX_SKILL_BYTES
from .skill_library import MAX_DISCOVERY_DEPTH, MAX_DISCOVERY_ENTRIES, MAX_PACKAGE_BYTES, MAX_PACKAGE_FILES, linked, walk
from .skill_plugins import relative_path
from .store import MemberError


def invalid():
    return MemberError("archive", "invalid skill package")


def oversized():
    return MemberError("size", "skill package exceeds the size or entry limit")


class SkillFiles(dict):
    def __init__(self):
        super().__init__()
        self.skipped_links = []
        self.folder = ""


class Snapshot:
    def __init__(self, byte_limit=None, entry_limit=None):
        self.byte_limit = MAX_PACKAGE_BYTES if byte_limit is None else byte_limit
        self.entry_limit = MAX_PACKAGE_FILES if entry_limit is None else entry_limit
        self.paths = {}
        self.explicit = set()
        self.files = SkillFiles()
        self.links = {}
        self.size = 0

    def entry(self, name, directory, size):
        if size < 0:
            raise invalid()
        if len(self.explicit) >= self.entry_limit or size > self.byte_limit - self.size:
            raise oversized()
        try:
            name = relative_path(name)
        except MemberError:
            raise invalid() from None
        if len(name) > 4096:
            raise invalid()
        parts = name.split("/")
        if any(len(part) > 255 or PureWindowsPath(part).is_reserved() for part in parts):
            raise invalid()
        if any(p.casefold().startswith(".raphael") for p in parts):
            raise invalid()
        if parts[-1] == "SKILL.md" and size > MAX_SKILL_BYTES:
            raise oversized()
        key = name.casefold()
        if key in self.explicit or (directory and size):
            raise invalid()
        self.explicit.add(key)
        for index in range(len(parts)):
            prefix = "/".join(parts[:index + 1])
            expected = (prefix, index + 1 < len(parts) or directory)
            if self.paths.setdefault(prefix.casefold(), expected) != expected:
                raise invalid()
        self.size += size
        return name

    def read(self, key, stream, size):
        data = stream.read(size + 1)
        if len(data) != size:
            raise invalid()
        self.files[key] = data

    def finish(self):
        for key, target in self.links.items():
            parts = key.split("/")[:-1]
            if target and not any(char in target for char in ":\\\x00") and not target.startswith("/"):
                for part in target.split("/"):
                    if part == "..":
                        if not parts:
                            break
                        parts.pop()
                    elif part not in ("", "."):
                        parts.append(part)
                else:
                    data = self.files.get("/".join(parts))
                    if data is not None:
                        if len(data) > self.byte_limit - self.size or key.endswith("SKILL.md") and len(data) > MAX_SKILL_BYTES:
                            raise oversized()
                        self.files[key] = data
                        self.size += len(data)
                        continue
            self.files.skipped_links.append(key)
        if "SKILL.md" not in self.files:
            raise MemberError("not_found", "no readable SKILL.md found in the package")
        try:
            text = self.files["SKILL.md"].decode("utf-8-sig")
        except UnicodeError:
            raise MemberError("skill", "skill must be UTF-8 Markdown") from None
        if not text.strip() or "\x00" in text:
            raise MemberError("skill", "skill must be UTF-8 Markdown")
        return self.files


def skill_roots(names, wanted=None):
    roots = set()
    root_skill = False
    for name in names:
        name = name.removeprefix("./")
        if wanted is not None:
            if name == "SKILL.md":
                root_skill = True
                continue
            if not name.endswith(f"/{wanted}/SKILL.md") and name != f"{wanted}/SKILL.md":
                continue
        if name == "SKILL.md" or name.endswith("/SKILL.md"):
            try:
                clean = relative_path(name)
            except MemberError:
                raise invalid() from None
            roots.add(clean.removesuffix("SKILL.md"))
    if not roots and root_skill:
        return [""]
    if not roots:
        raise MemberError("not_found", "no SKILL.md found in the package")
    ordered = sorted(roots)
    if any(right.startswith(left) for left, right in zip(ordered, ordered[1:])):
        raise invalid()
    return ordered


def snapshot_entries(entries, read_entry, subpath, *, wanted=None):
    roots = ([relative_path(subpath) + "/" if subpath else ""] if subpath is not None
             else skill_roots((name for name, _ in entries), wanted))
    snapshots = {root.casefold(): Snapshot() for root in roots}
    if len(snapshots) != len(roots):
        raise invalid()
    allocated = count = 0
    for name, info in entries:
        normalized = name.removeprefix("./")
        parts = normalized.replace("\\", "/").split("/")
        for length in range(len(parts)):
            root = "/".join(parts[:length]) + "/" if length else ""
            snapshot = snapshots.get(root.casefold())
            if snapshot is None:
                continue
            if normalized in (".", "./") or normalized == root:
                break
            if root not in roots:
                raise invalid()
            # Validate the selected entry's full spelling before stripping the prefix.
            try:
                relative_path(name)
            except MemberError:
                raise invalid() from None
            snapshot.byte_limit = snapshot.size + MAX_PACKAGE_BYTES - allocated
            snapshot.entry_limit = len(snapshot.explicit) + MAX_PACKAGE_FILES - count
            previous = snapshot.size
            read_entry(snapshot, normalized[len(root):], info)
            allocated += snapshot.size - previous
            count += 1
            break
    result = []
    for root in roots:
        snapshot = snapshots[root.casefold()]
        snapshot.byte_limit = snapshot.size + MAX_PACKAGE_BYTES - allocated
        previous = snapshot.size
        files = snapshot.finish()
        files.folder = root
        result.append(files)
        allocated += snapshot.size - previous
    return result


def zip_entry(archive, snapshot, name, info):
    directory = info.is_dir()
    kind = stat.S_IFMT(info.external_attr >> 16)
    if (info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
            or info.flag_bits & 1 or info.external_attr & 0x400):
        raise invalid()
    if kind == stat.S_IFLNK and not directory:
        key = snapshot.entry(name, False, info.file_size)
        if info.file_size > 4096:
            raise oversized()
        with archive.open(info) as stream:
            snapshot.links[key] = stream.read(4097).decode("utf-8")
        return
    if kind not in (0, stat.S_IFDIR if directory else stat.S_IFREG):
        raise invalid()
    key = snapshot.entry(name, directory, info.file_size)
    if not directory:
        with archive.open(info) as stream:
            snapshot.read(key, stream, info.file_size)


def tar_entry(archive, snapshot, name, info):
    if info.issym():
        if len(info.linkname) > 4096:
            raise oversized()
        snapshot.links[snapshot.entry(name, False, info.size)] = info.linkname
        return
    if info.type not in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE) or info.sparse:
        raise invalid()
    key = snapshot.entry(name, info.isdir(), info.size)
    if not info.isdir():
        with archive.extractfile(info) as stream:
            snapshot.read(key, stream, info.size)


def checked_zip(data):
    # ZipFile builds every ZipInfo before returning. Count actual directory records
    # first so even an inconsistent end record cannot cause unbounded allocation.
    stream = io.BytesIO(data)
    end = zipfile._EndRecData(stream)
    if not end:
        raise invalid()
    stop = end[zipfile._ECD_LOCATION]
    position = stop - end[zipfile._ECD_SIZE]
    count = 0
    while position < stop:
        if position < 0 or data[position:position + 4] != zipfile.stringCentralDir or position + 46 > stop:
            raise invalid()
        count += 1
        if count > MAX_DISCOVERY_ENTRIES:
            raise oversized()
        lengths = struct.unpack_from("<HHH", data, position + 28)
        position += 46 + sum(lengths)
    if position != stop or count != end[zipfile._ECD_ENTRIES_TOTAL]:
        raise invalid()
    return zipfile.ZipFile(stream)


def read_archive(name, data, *, subpath=None, repository=False, wanted=None):
    if len(data) > MAX_PACKAGE_BYTES:
        raise oversized()
    name = name.lower()
    if name.endswith(".md"):
        if len(data) > MAX_SKILL_BYTES:
            raise oversized()
        return [{"SKILL.md": data}]
    try:
        if name.endswith(".zip"):
            with checked_zip(data) as archive:
                entries = [(info.orig_filename, info) for info in archive.infolist()]
                if repository:
                    wrappers = {name.split("/", 1)[0] for name, _ in entries}
                    if len(wrappers) != 1:
                        raise invalid()
                    entries = [(name.partition("/")[2], info) for name, info in entries if name.partition("/")[2]]
                    if subpath is None and wanted is None and any(
                            name == "SKILL.md" and stat.S_IFMT(info.external_attr >> 16) in (0, stat.S_IFREG)
                            for name, info in entries):
                        subpath = ""
                return snapshot_entries(entries, lambda snapshot, key, info: zip_entry(archive, snapshot, key, info),
                                        subpath, wanted=wanted)
        if name.endswith((".tgz", ".tar.gz")):
            # Bound decompression even for content outside the selected folders.
            limit = MAX_PACKAGE_BYTES + MAX_DISCOVERY_ENTRIES * 1536 + tarfile.RECORDSIZE
            with gzip.GzipFile(fileobj=io.BytesIO(data)) as compressed:
                raw = compressed.read(limit + 1)
            if len(raw) > limit:
                raise oversized()
            with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as archive:
                entries = []
                for info in archive:
                    if len(entries) >= MAX_DISCOVERY_ENTRIES:
                        raise oversized()
                    entries.append((info.name, info))
                return snapshot_entries(entries,
                    lambda snapshot, key, info: tar_entry(archive, snapshot, key, info), subpath)
    except (zipfile.BadZipFile, tarfile.TarError, OSError, EOFError, zlib.error, NotImplementedError, UnicodeError):
        raise invalid() from None
    raise MemberError("source", "choose a Markdown, ZIP or tar.gz file")


def uploaded(file):
    if not isinstance(file, dict) or set(file) != {"name", "data"}:
        raise MemberError("file", "file needs a name and base64 data")
    name, encoded = file["name"], file["data"]
    if not isinstance(name, str) or not name or any(c in name for c in "/\\:\x00") or not isinstance(encoded, str):
        raise MemberError("file", "invalid upload name or data")
    if len(encoded) > ((MAX_PACKAGE_BYTES + 2) // 3) * 4:
        raise oversized()
    try:
        data = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise MemberError("file", "invalid base64 file data") from None
    return read_archive(name, data), name


def local_path(source):
    path = Path(source[6:])
    if path.drive.startswith(("\\", "//")) or "\x00" in source:
        raise MemberError("source", "choose a file on this computer")
    if not path.is_absolute() or ".." in path.parts or any(linked(p) for p in (path, *path.parents)):
        raise MemberError("source", "choose an absolute, unlinked local path")
    return path


def local(source):
    path = local_path(source)
    if path.is_file():
        if path.stat().st_nlink > 1:
            raise invalid()
        with path.open("rb") as stream:
            return read_archive(path.name, stream.read(MAX_PACKAGE_BYTES + 1)), path.name
    if not path.is_dir():
        raise MemberError("source", "local skill source does not exist")
    remaining = [MAX_DISCOVERY_ENTRIES]
    folders = []
    try:
        for folder, dirs, _ in walk(path, remaining):
            if os.path.lexists(folder / "SKILL.md"):
                folders.append(folder)
                dirs.clear()
            elif len(folder.relative_to(path).parts) == MAX_DISCOVERY_DEPTH and dirs:
                raise oversized()
        if not folders:
            raise MemberError("not_found", "no SKILL.md found in the package")
        result, size, count = [], 0, 0
        for folder in sorted(folders):
            snapshot = folder_snapshot(folder, skill_links=True, byte_limit=MAX_PACKAGE_BYTES - size,
                                       entry_limit=MAX_PACKAGE_FILES - count)
            result.append(snapshot.finish())
            size += snapshot.size
            count += len(snapshot.explicit)
        return result, path.name
    except OSError:
        raise invalid() from None


def folder_snapshot(path, *, byte_limit=None, entry_limit=None, depth_limit=None, installed=False, skill_links=False):
    if any(linked(p) for p in (path, *path.parents)):
        raise invalid()
    snapshot = Snapshot(byte_limit, entry_limit)
    pending = [path]
    while pending:
        directory_path = pending.pop()
        if any(linked(p) for p in (directory_path, *directory_path.parents)):
            raise invalid()
        with os.scandir(directory_path) as entries:
            for entry in entries:
                child = Path(entry.path)
                if installed and directory_path == path and child.name == ".raphael-source.json":
                    continue
                # DirEntry.stat on Windows omits the hard-link count.
                info = child.stat(follow_symlinks=False)
                directory = stat.S_ISDIR(info.st_mode)
                relative = child.relative_to(path).as_posix()
                if skill_links and child.is_symlink():
                    target = child.readlink()
                    # Windows readlink returns an extended-length path for absolute file links.
                    if len(target.drive) == 6 and target.drive.startswith("\\\\?\\") and target.drive.endswith(":"):
                        target = Path(str(target)[4:])
                    if target.is_absolute() and target.is_relative_to(path) and ".." not in target.parts:
                        target = Path(os.path.relpath(target, child.parent))
                    snapshot.links[snapshot.entry(relative, False, 0)] = target.as_posix()
                    continue
                if linked(child) or not (directory or stat.S_ISREG(info.st_mode) and info.st_nlink == 1):
                    raise invalid()
                key = snapshot.entry(relative, directory, 0 if directory else info.st_size)
                if directory:
                    if depth_limit is not None and len(child.relative_to(path).parts) > depth_limit:
                        raise oversized()
                    pending.append(child)
                else:
                    with child.open("rb") as stream:
                        opened = os.fstat(stream.fileno())
                        if not os.path.samestat(info, opened) or opened.st_nlink != 1:
                            raise invalid()
                        snapshot.read(key, stream, info.st_size)
    return snapshot


def validate_files(files):
    snapshot = Snapshot()
    for name, data in files.items():
        key = snapshot.entry(name, False, len(data))
        snapshot.files[key] = data
    return snapshot.finish()

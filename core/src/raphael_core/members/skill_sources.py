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
from .skill_library import MAX_PACKAGE_BYTES, MAX_PACKAGE_FILES, linked
from .skill_plugins import relative_path
from .store import MemberError


def invalid():
    return MemberError("archive", "invalid skill package")


def oversized():
    return MemberError("size", "skill package exceeds the size or entry limit")


class Snapshot:
    def __init__(self, byte_limit=None, entry_limit=None):
        self.byte_limit = MAX_PACKAGE_BYTES if byte_limit is None else byte_limit
        self.entry_limit = MAX_PACKAGE_FILES if entry_limit is None else entry_limit
        self.paths = {}
        self.explicit = set()
        self.files = {}
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

    def skills(self):
        roots = [path.split("/")[:-1] for path in self.files if path.split("/")[-1] == "SKILL.md"]
        if not roots:
            raise MemberError("not_found", "no SKILL.md found in the package")
        result = []
        for root in sorted(roots):
            if any(other != root and root[:len(other)] == other for other in roots):
                raise invalid()
            prefix = "/".join(root) + "/" if root else ""
            result.append({name[len(prefix):]: data for name, data in self.files.items() if name.startswith(prefix)})
        return result


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
        if count > MAX_PACKAGE_FILES:
            raise oversized()
        lengths = struct.unpack_from("<HHH", data, position + 28)
        position += 46 + sum(lengths)
    if position != stop or count != end[zipfile._ECD_ENTRIES_TOTAL]:
        raise invalid()
    return zipfile.ZipFile(stream)


def read_archive(name, data):
    if len(data) > MAX_PACKAGE_BYTES:
        raise oversized()
    name = name.lower()
    if name.endswith(".md"):
        if len(data) > MAX_SKILL_BYTES:
            raise oversized()
        return [{"SKILL.md": data}]
    snapshot = Snapshot()
    try:
        if name.endswith(".zip"):
            with checked_zip(data) as archive:
                for info in archive.infolist():
                    directory = info.is_dir()
                    kind = stat.S_IFMT(info.external_attr >> 16)
                    if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                        raise invalid()
                    if kind not in (0, stat.S_IFDIR if directory else stat.S_IFREG) or info.flag_bits & 1 or info.external_attr & 0x400:
                        raise invalid()
                    key = snapshot.entry(info.orig_filename, directory, info.file_size)
                    if not directory:
                        with archive.open(info) as stream:
                            snapshot.read(key, stream, info.file_size)
        elif name.endswith((".tgz", ".tar.gz")):
            # Bound headers, padding and extended metadata before tarfile interprets them.
            limit = MAX_PACKAGE_BYTES + MAX_PACKAGE_FILES * 1536 + tarfile.RECORDSIZE
            with gzip.GzipFile(fileobj=io.BytesIO(data)) as compressed:
                raw = compressed.read(limit + 1)
            if len(raw) > limit:
                raise oversized()
            with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as archive:
                for count, info in enumerate(archive, start=1):
                    if count > MAX_PACKAGE_FILES:
                        raise oversized()
                    if info.type not in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE) or info.sparse:
                        raise invalid()
                    if info.isdir() and info.name == ".":
                        continue
                    key = snapshot.entry(info.name, info.isdir(), info.size)
                    if not info.isdir():
                        with archive.extractfile(info) as stream:
                            snapshot.read(key, stream, info.size)
        else:
            raise MemberError("source", "choose a Markdown, ZIP or tar.gz file")
    except (zipfile.BadZipFile, tarfile.TarError, OSError, EOFError, zlib.error, NotImplementedError, UnicodeError):
        raise invalid() from None
    return snapshot.skills()


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
    return folder_snapshot(path).skills(), path.name


def folder_snapshot(path, *, byte_limit=None, entry_limit=None, depth_limit=None):
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
                # DirEntry.stat on Windows omits the hard-link count.
                info = child.stat(follow_symlinks=False)
                directory = stat.S_ISDIR(info.st_mode)
                if linked(child) or not (directory or stat.S_ISREG(info.st_mode) and info.st_nlink == 1):
                    raise invalid()
                key = snapshot.entry(child.relative_to(path).as_posix(), directory, 0 if directory else info.st_size)
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

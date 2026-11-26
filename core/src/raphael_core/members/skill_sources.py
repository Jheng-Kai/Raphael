"""Read bounded skill documents and attachment trees without extracting an archive."""

import base64
import binascii
import gzip
import io
import os
import re
import stat
import struct
import tarfile
import threading
import zipfile
import zlib
from collections import OrderedDict
from contextlib import contextmanager
from pathlib import Path, PureWindowsPath

from .capabilities import MAX_SKILL_BYTES
from .skill_errors import (front_matter, no_skill, not_utf8, oversized_file, oversized_package, refused_entry, size_text,
                           too_many_files, unreadable_archive, unsafe_path)
from .skill_library import (MAX_ARCHIVE_ENTRIES, MAX_DISCOVERY_DEPTH, MAX_PACKAGE_BYTES, MAX_PACKAGE_FILES, MAX_SCAN_ENTRIES,
                            MAX_UPLOAD_BYTES, junk, linked, walk)
from .skill_plugins import relative_path
from .skill_references import DiskSource, MemorySource, attach_shared
from .store import MemberError


def invalid():
    return unreadable_archive()


class SkillFiles(dict):
    def __init__(self):
        super().__init__()
        self.skipped_links = []
        self.skipped_references = []
        self.folder = ""
        self.plugin_manifest = False


class Snapshot:
    def __init__(self, byte_limit=None, entry_limit=None):
        self.byte_limit = MAX_PACKAGE_BYTES if byte_limit is None else byte_limit
        self.entry_limit = MAX_PACKAGE_FILES if entry_limit is None else entry_limit
        self.paths = {}
        self.explicit = set()
        self.files = SkillFiles()
        self.links = {}
        self.size = 0
        # Where this skill's folder is in its source: what an error says of a file inside it names it from there.
        self.prefix = ""

    def entry(self, name, directory, size):
        shown = self.prefix + name
        if size < 0:
            raise unreadable_archive()
        if len(self.explicit) >= self.entry_limit:
            raise too_many_files(len(self.explicit) + 1, MAX_PACKAGE_FILES, shown)
        if size > self.byte_limit - self.size:
            used = MAX_PACKAGE_BYTES - (self.byte_limit - self.size)
            raise oversized_package(shown, used + size, MAX_PACKAGE_BYTES)
        try:
            name = relative_path(name)
        except MemberError:
            raise unsafe_path(shown) from None
        shown = self.prefix + name
        if len(name) > 4096:
            raise unsafe_path(shown)
        parts = name.split("/")
        if any(len(part) > 255 or PureWindowsPath(part).is_reserved() for part in parts):
            raise unsafe_path(shown)
        if any(p.casefold().startswith(".raphael") for p in parts):
            raise unsafe_path(shown)
        if parts[-1] == "SKILL.md" and size > MAX_SKILL_BYTES:
            raise oversized_file(shown, size, MAX_SKILL_BYTES)
        key = name.casefold()
        if key in self.explicit or (directory and size):
            raise refused_entry(shown, "named twice, or twice in letters of another case")
        self.explicit.add(key)
        for index in range(len(parts)):
            prefix = "/".join(parts[:index + 1])
            expected = (prefix, index + 1 < len(parts) or directory)
            if self.paths.setdefault(prefix.casefold(), expected) != expected:
                raise refused_entry(shown, "both a file and a folder")
        self.size += size
        return name

    def read(self, key, stream, size):
        data = stream.read(size + 1)
        if len(data) != size:
            raise refused_entry(self.prefix + key, "not the size its listing says")
        self.files[key] = data

    def finish(self, *, skill=True):
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
                        if key.endswith("SKILL.md") and len(data) > MAX_SKILL_BYTES:
                            raise oversized_file(self.prefix + key, len(data), MAX_SKILL_BYTES)
                        if len(data) > self.byte_limit - self.size:
                            used = MAX_PACKAGE_BYTES - (self.byte_limit - self.size)
                            raise oversized_package(self.prefix + key, used + len(data), MAX_PACKAGE_BYTES)
                        self.files[key] = data
                        self.size += len(data)
                        continue
            self.files.skipped_links.append(key)
        if not skill:
            return self.files
        if "SKILL.md" not in self.files:
            raise no_skill(self.prefix.rstrip("/"))
        shown = self.prefix + "SKILL.md"
        try:
            text = self.files["SKILL.md"].decode("utf-8-sig")
        except UnicodeError:
            raise not_utf8(shown) from None
        if not text.strip():
            raise front_matter("none", 1, shown)
        if "\x00" in text:
            raise not_utf8(shown)
        return self.files


def skill_roots(names):
    roots = set()
    for name in names:
        name = name.removeprefix("./")
        if name == "SKILL.md" or name.endswith("/SKILL.md"):
            try:
                clean = relative_path(name)
            except MemberError:
                raise unsafe_path(name) from None
            roots.add(clean.removesuffix("SKILL.md"))
    if not roots:
        raise no_skill()
    # A skill owns its whole folder: a SKILL.md inside it (a template, an example) is one of its files, not another skill.
    ordered = []
    for root in sorted(roots):
        if not ordered or not root.startswith(ordered[-1]):
            ordered.append(root)
    return ordered


PLUGIN_MANIFEST = ".claude-plugin/plugin.json"


def snapshot_entries(entries, read_entry, *, regular, member=None):
    """The skills of an archive's entries. `member` is `(describe, fetch)`: what an entry is (a size, `"linked"`, None for a
    folder) and its bytes, so that what a skill links to elsewhere in the archive comes with it."""
    entries = [(name, info) for name, info in entries if not junk(name.removeprefix("./"))]
    roots = skill_roots(name for name, _ in entries)
    snapshots = {root.casefold(): Snapshot() for root in roots}
    if len(snapshots) != len(roots):
        raise refused_entry(roots[0], "a folder named twice, or twice in letters of another case")
    for root, snapshot in zip(roots, snapshots.values()):
        snapshot.prefix = root
    manifests = {
        name.removeprefix("./").removesuffix(PLUGIN_MANIFEST)
        for name, info in entries
        if (name.removeprefix("./") == PLUGIN_MANIFEST or name.removeprefix("./").endswith("/" + PLUGIN_MANIFEST)) and regular(info)
    }
    sources = {}
    # An archive made of one folder (`my-skill/...`, `repo-main/...`) is that folder: a link does not climb out of it.
    tops = {name.removeprefix("./").split("/")[0] for name, _ in entries}
    wrapper = next(iter(tops)) + "/" if len(tops) == 1 and all("/" in name.removeprefix("./") for name, _ in entries) else ""
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
                raise refused_entry(normalized, "inside a folder spelled in two ways")
            # Validate the selected entry's full spelling before stripping the prefix.
            try:
                relative_path(name)
            except MemberError:
                raise unsafe_path(name) from None
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
        # Classify a whole import without reading or enabling its plugin configuration.
        prefix, plugin = "", None
        for part in root.split("/"):
            if prefix in manifests:
                files.plugin_manifest = True
                plugin = prefix
            prefix += part + "/"
        # What the skill links to elsewhere in its plugin, else in the archive, comes with it.
        base = plugin or (wrapper if root.startswith(wrapper) else "")
        if member is not None and root != base:
            if base not in sources:
                describe, fetch = member
                index = {name.removeprefix("./").rstrip("/"): info for name, info in entries
                         if name.removeprefix("./").startswith(base) and name.removeprefix("./").rstrip("/") != base.rstrip("/")}
                found = {name[len(base):]: describe(info) for name, info in index.items()}
                sources[base] = MemorySource({name: size for name, size in found.items() if size is not None},
                                             lambda path, base=base, index=index: fetch(index[base + path]))
            attach_shared(files, snapshot, root[len(base):].rstrip("/"), sources[base])
        result.append(files)
        allocated += snapshot.size - previous
    return result


def zip_entry(archive, snapshot, name, info):
    directory = info.is_dir()
    kind = stat.S_IFMT(info.external_attr >> 16)
    if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
        raise refused_entry(snapshot.prefix + name, "compressed in a way this import does not read")
    if info.flag_bits & 1:
        raise refused_entry(snapshot.prefix + name, "encrypted")
    if info.external_attr & 0x400:
        raise refused_entry(snapshot.prefix + name, "a special file")
    if kind == stat.S_IFLNK and not directory:
        key = snapshot.entry(name, False, info.file_size)
        if info.file_size > 4096:
            raise refused_entry(snapshot.prefix + name, "a link whose target is longer than a path can be")
        with archive.open(info) as stream:
            snapshot.links[key] = stream.read(4097).decode("utf-8")
        return
    if kind not in (0, stat.S_IFDIR if directory else stat.S_IFREG):
        raise refused_entry(snapshot.prefix + name, "a device or another file that is not a plain file")
    key = snapshot.entry(name, directory, info.file_size)
    if not directory:
        with archive.open(info) as stream:
            snapshot.read(key, stream, info.file_size)


def tar_entry(archive, snapshot, name, info):
    if info.issym():
        if len(info.linkname) > 4096:
            raise refused_entry(snapshot.prefix + name, "a link whose target is longer than a path can be")
        snapshot.links[snapshot.entry(name, False, info.size)] = info.linkname
        return
    if info.type not in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE) or info.sparse:
        raise refused_entry(snapshot.prefix + name, "a device or another file that is not a plain file")
    key = snapshot.entry(name, info.isdir(), info.size)
    if not info.isdir():
        with archive.extractfile(info) as stream:
            snapshot.read(key, stream, info.size)


def zip_member(archive):
    def describe(info):
        if info.is_dir():
            return None
        kind = stat.S_IFMT(info.external_attr >> 16)
        if kind == stat.S_IFLNK:
            return "linked"
        return info.file_size if kind in (0, stat.S_IFREG) else "unsupported"

    def fetch(info):
        data = archive.read(info)
        if len(data) != info.file_size:
            raise OSError("changed while it was read")
        return data

    return describe, fetch


def tar_member(archive):
    def describe(info):
        if info.isdir():
            return None
        return "linked" if info.issym() else info.size if info.isfile() else "unsupported"

    def fetch(info):
        with archive.extractfile(info) as stream:
            return stream.read()

    return describe, fetch


def checked_zip(data):
    # ZipFile builds every ZipInfo before returning. Count actual directory records
    # first so even an inconsistent end record cannot cause unbounded allocation.
    stream = io.BytesIO(data)
    end = zipfile._EndRecData(stream)
    if not end:
        raise unreadable_archive()
    stop = end[zipfile._ECD_LOCATION]
    position = stop - end[zipfile._ECD_SIZE]
    count = 0
    while position < stop:
        if position < 0 or data[position:position + 4] != zipfile.stringCentralDir or position + 46 > stop:
            raise unreadable_archive()
        count += 1
        if count > MAX_ARCHIVE_ENTRIES:
            raise too_many_files(count, MAX_ARCHIVE_ENTRIES)
        lengths = struct.unpack_from("<HHH", data, position + 28)
        position += 46 + sum(lengths)
    if position != stop or count != end[zipfile._ECD_ENTRIES_TOTAL]:
        raise unreadable_archive()
    return zipfile.ZipFile(stream)


def read_archive(name, data):
    if len(data) > MAX_PACKAGE_BYTES:
        raise oversized_package(name, len(data), MAX_PACKAGE_BYTES)
    name = name.lower()
    if name.endswith(".md"):
        if len(data) > MAX_SKILL_BYTES:
            raise oversized_file(name, len(data), MAX_SKILL_BYTES)
        return [{"SKILL.md": data}]
    try:
        if name.endswith(".zip"):
            with checked_zip(data) as archive:
                entries = [(info.orig_filename, info) for info in archive.infolist()]
                return snapshot_entries(entries, lambda snapshot, key, info: zip_entry(archive, snapshot, key, info),
                                        regular=lambda info: not info.is_dir() and
                                        stat.S_IFMT(info.external_attr >> 16) in (0, stat.S_IFREG),
                                        member=zip_member(archive))
        if name.endswith((".tgz", ".tar.gz")):
            # Bound decompression even for content outside the selected folders.
            limit = MAX_PACKAGE_BYTES + MAX_ARCHIVE_ENTRIES * 1536 + tarfile.RECORDSIZE
            with gzip.GzipFile(fileobj=io.BytesIO(data)) as compressed:
                raw = compressed.read(limit + 1)
            if len(raw) > limit:
                raise oversized_package(name, len(raw), limit)
            with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as archive:
                entries = []
                for info in archive:
                    if len(entries) >= MAX_ARCHIVE_ENTRIES:
                        raise too_many_files(len(entries) + 1, MAX_ARCHIVE_ENTRIES)
                    entries.append((info.name, info))
                return snapshot_entries(entries, lambda snapshot, key, info: tar_entry(archive, snapshot, key, info),
                                        regular=tarfile.TarInfo.isfile, member=tar_member(archive))
    except (zipfile.BadZipFile, tarfile.TarError, OSError, EOFError, zlib.error, NotImplementedError, UnicodeError):
        raise unreadable_archive() from None
    raise MemberError("source", "choose a Markdown, ZIP or tar.gz file", reason="file_type", file=name)


@contextmanager
def _open_archive(name, data):
    """The entries of a ZIP or tar.gz as `(entries, read_entry, regular)`, bounded as `read_archive` bounds them; None when the
    name is neither."""
    if len(data) > MAX_PACKAGE_BYTES:
        raise oversized_package(name, len(data), MAX_PACKAGE_BYTES)
    lower = name.lower()
    try:
        if lower.endswith(".zip"):
            with checked_zip(data) as archive:
                yield ([(info.orig_filename, info) for info in archive.infolist()],
                       lambda snapshot, key, info: zip_entry(archive, snapshot, key, info),
                       lambda info: not info.is_dir() and stat.S_IFMT(info.external_attr >> 16) in (0, stat.S_IFREG))
        elif lower.endswith((".tgz", ".tar.gz")):
            limit = MAX_PACKAGE_BYTES + MAX_ARCHIVE_ENTRIES * 1536 + tarfile.RECORDSIZE
            with gzip.GzipFile(fileobj=io.BytesIO(data)) as compressed:
                raw = compressed.read(limit + 1)
            if len(raw) > limit:
                raise oversized_package(name, len(raw), limit)
            with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as archive:
                entries = []
                for info in archive:
                    if len(entries) >= MAX_ARCHIVE_ENTRIES:
                        raise too_many_files(len(entries) + 1, MAX_ARCHIVE_ENTRIES)
                    entries.append((info.name, info))
                yield entries, lambda snapshot, key, info: tar_entry(archive, snapshot, key, info), tarfile.TarInfo.isfile
        else:
            yield None
    except (zipfile.BadZipFile, tarfile.TarError, OSError, EOFError, zlib.error, NotImplementedError, UnicodeError):
        raise unreadable_archive() from None


def _wrapper(names):
    """`top/` when every entry of an archive is inside one folder (`repo-main/...`): that folder is the source."""
    tops = {name.split("/")[0] for name in names}
    return next(iter(tops)) + "/" if len(tops) == 1 and all("/" in name for name in names) else ""


def archive_plugin(name, data):
    """The whole tree of an archive that is a plugin of any kind (skill_layouts.py), `{path: bytes}` from the plugin's own root,
    or None when it is not one. The names are looked at first: an archive that is no plugin is not read whole."""
    from .skill_layouts import is_plugin

    with _open_archive(name, data) as opened:
        if opened is None:
            return None
        entries, read_entry, regular = opened
        entries = [(entry, info) for entry, info in entries if not junk(entry.removeprefix("./"))]
        names = [entry.removeprefix("./").replace("\\", "/") for entry, _ in entries]
        wrapper = _wrapper([n for n in names if n not in (".", "")])
        if not is_plugin(n[len(wrapper):] for n, (_, info) in zip(names, entries) if n.startswith(wrapper) and regular(info)):
            return None
        snapshot = Snapshot()
        for entry, (original, info) in zip(names, entries):
            if entry in (".", "") or entry.rstrip("/") == wrapper.rstrip("/"):
                continue
            try:
                relative_path(original)
            except MemberError:
                raise unsafe_path(original) from None
            read_entry(snapshot, entry[len(wrapper):], info)
        return snapshot.finish(skill=False)


def plugin_of_archive(name, data, label=None):
    """The plugin an archive is (a `PluginTree`), or None when it is none: its whole tree is kept, every file. `label` names a
    plugin whose manifest does not (the archive's own name by default)."""
    from .skill_layouts import PluginTree, normalized

    tree = archive_plugin(name, data)
    label = label or re.sub(r"\.(?:zip|tar\.gz|tgz)$", "", name, flags=re.I)
    files = normalized(tree, label) if tree is not None else None
    return PluginTree(files, f"upload:{name}", f"upload:{name}", label) if files is not None else None


def uploaded(file, plugins=False):
    """The skills of an uploaded file; with `plugins`, a file that is a plugin of any kind is that plugin, whole."""
    data = uploaded_bytes(file)
    if plugins and (found := plugin_of_archive(file["name"], data)) is not None:
        return found, file["name"]
    return read_archive(file["name"], data), file["name"]


def tree_entries(files):
    """The files of a folder or several files dropped on the window, `[(path, bytes)]`: each `{path, data}` with the path
    below the dropped folder and its bytes in base64. What the window sends in all is as large as one file it sends."""
    if not isinstance(files, list) or not files or any(not isinstance(f, dict) or set(f) != {"path", "data"} for f in files):
        raise MemberError("file", "files needs a list of paths with base64 data")
    entries, total = [], 0
    for item in files:
        path, encoded = item["path"], item["data"]
        if not isinstance(path, str) or not isinstance(encoded, str):
            raise MemberError("file", "invalid upload name or data")
        try:
            path = relative_path(path.replace("\\", "/"))
        except MemberError:
            raise unsafe_path(str(item["path"])[:200]) from None
        total += len(encoded) // 4 * 3
        if total > MAX_UPLOAD_BYTES:
            raise MemberError("size", f"these files are over the {size_text(MAX_UPLOAD_BYTES)} the window sends: "
                              "pick their folder instead", reason="upload", file=path, size=total, limit=MAX_UPLOAD_BYTES)
        try:
            entries.append((path, base64.b64decode(encoded, validate=True)))
        except (ValueError, binascii.Error):
            raise MemberError("file", "invalid base64 file data") from None
    return entries


def uploaded_tree(files, plugins=False):
    """Dropped files as the archive they would have been: the skills in them are read as an archive's are, and with `plugins` a
    tree that is a plugin of any kind is that plugin, whole."""
    entries = tree_entries(files)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as out:
        for path, data in entries:
            out.writestr(path, data)
    tops = {path.split("/")[0] for path, _ in entries}
    name = tops.pop() if len(tops) == 1 and all("/" in path for path, _ in entries) else "dropped files"
    if plugins and (found := plugin_of_archive("dropped.zip", buffer.getvalue(), name)) is not None:
        return found, name
    return read_archive("dropped.zip", buffer.getvalue()), name


def uploaded_bytes(file):
    if not isinstance(file, dict) or set(file) != {"name", "data"}:
        raise MemberError("file", "file needs a name and base64 data")
    name, encoded = file["name"], file["data"]
    if not isinstance(name, str) or not name or any(c in name for c in "/\\:\x00") or not isinstance(encoded, str):
        raise MemberError("file", "invalid upload name or data")
    if len(encoded) > ((MAX_UPLOAD_BYTES + 2) // 3) * 4:
        size = len(encoded) // 4 * 3
        raise MemberError("size", f"{name} is {size_text(size)}, over the {size_text(MAX_UPLOAD_BYTES)} the window sends: "
                          "pick its folder instead", reason="upload", file=name, size=size, limit=MAX_UPLOAD_BYTES)
    try:
        data = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise MemberError("file", "invalid base64 file data") from None
    return data


def local_path(source):
    path = Path(source[6:])
    if path.drive.startswith(("\\", "//")) or "\x00" in source:
        raise MemberError("source", "choose a file on this computer", reason="path", file=source[6:])
    if not path.is_absolute() or ".." in path.parts:
        raise MemberError("source", f"{path} is not a full path on this computer", reason="path", file=str(path))
    # A folder the owner names may be reached through a link (a synced Documents folder, a junction): it is read where it
    # leads. A link inside it is never followed (R-SKILL-18).
    return Path(os.path.realpath(path))


def local(source, plugins=False):
    """The skills of a folder or file on this computer; with `plugins`, a folder or archive that is a plugin of any kind
    (skill_layouts.py) is that plugin, whole, as a `PluginTree`."""
    path = local_path(source)
    if path.is_file():
        if path.stat().st_nlink > 1:
            raise refused_entry(str(path), "a hard link")
        with path.open("rb") as stream:
            data = stream.read(MAX_PACKAGE_BYTES + 1)
        if plugins and (found := plugin_of_archive(path.name, data)) is not None:
            return found, path.name
        return read_archive(path.name, data), path.name
    if not path.exists():
        raise MemberError("not_found", f"{path} does not exist on this computer", reason="source", file=str(path))
    if not path.is_dir():
        raise MemberError("source", f"{path} is neither a folder nor a file", reason="path", file=str(path))
    if plugins:
        from .skill_layouts import PluginTree, folder_is_plugin, normalized
        from .skill_plugins import local_files

        if folder_is_plugin(path):
            files = normalized(local_files(path), path.name)
            if files is not None:
                return PluginTree(files, "local:" + str(path), "local:" + str(path), path.name), path.name
    remaining = [MAX_SCAN_ENTRIES]
    folders = []
    try:
        for folder, dirs, _ in walk(path, remaining, hidden=True):
            if os.path.lexists(folder / "SKILL.md"):
                folders.append(folder)
                dirs.clear()
            elif len(folder.relative_to(path).parts) == MAX_DISCOVERY_DEPTH and dirs:
                raise MemberError("size", f"{folder} is nested deeper than {MAX_DISCOVERY_DEPTH} folders", reason="depth",
                                  file=str(folder), limit=MAX_DISCOVERY_DEPTH)
        if not folders:
            raise no_skill(str(path))
        result, size, count = [], 0, 0
        for folder in sorted(folders):
            snapshot = folder_snapshot(folder, skill_links=True, byte_limit=MAX_PACKAGE_BYTES - size,
                                       entry_limit=MAX_PACKAGE_FILES - count,
                                       prefix=folder.relative_to(path).as_posix() + "/" if folder != path else "")
            files = snapshot.finish()
            # What the skill links to elsewhere in its plugin, else in the folder picked, comes with it.
            root = path
            for parent in (folder, *folder.parents):
                manifest = parent / PLUGIN_MANIFEST
                if not linked(manifest.parent) and not linked(manifest) and manifest.is_file():
                    files.plugin_manifest = True
                    root = parent
                    break
                if parent == path:
                    break
            if folder != root:
                attach_shared(files, snapshot, folder.relative_to(root).as_posix(), DiskSource(root))
            result.append(files)
            size += snapshot.size
            count += len(snapshot.explicit)
        return result, path.name
    except OSError as error:
        raise MemberError("source", f"{error.filename or path} could not be read: {error.strerror or error}",
                          reason="unreadable", file=str(error.filename or path)) from None


def _file_revision(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


def _read_files(entries):
    files = {}
    for key, child, revision in entries:
        size = revision[4]
        if any(linked(path) for path in (child, *child.parents)):
            raise invalid()
        with child.open("rb") as stream:
            opened = _file_revision(os.fstat(stream.fileno()))
            # Windows reports different creation times through stat and fstat.
            if opened[:-1] != revision[:-1]:
                raise invalid()
            data = stream.read(size + 1)
            if len(data) != size or _file_revision(os.fstat(stream.fileno())) != opened:
                raise invalid()
            files[key] = data
    return files


# Keep room for many small skills without retaining an unbounded set of file bodies.
_PACKAGE_CACHE_BYTES = 64 * 1024 * 1024
_PACKAGE_CACHE_ENTRIES = 64
_package_cache = OrderedDict()
_package_cache_lock = threading.Lock()


def _cached_files(path, entries, size):
    with _package_cache_lock:
        found = _package_cache.get(path)
        if found is not None and found[0] == entries:
            _package_cache.move_to_end(path)
            return found[1]
    files = _read_files(entries)
    with _package_cache_lock:
        _package_cache.pop(path, None)
        _package_cache[path] = (entries, files, size)
        total = sum(item[2] for item in _package_cache.values())
        while total > _PACKAGE_CACHE_BYTES or len(_package_cache) > _PACKAGE_CACHE_ENTRIES:
            _, (_, _, evicted_size) = _package_cache.popitem(last=False)
            total -= evicted_size
    return files


def folder_snapshot(path, *, byte_limit=None, entry_limit=None, depth_limit=None, installed=False, skill_links=False, cached=False,
                    prefix=""):
    if any(linked(p) for p in (path, *path.parents)):
        raise invalid()
    snapshot = Snapshot(byte_limit, entry_limit)
    snapshot.prefix = prefix
    regular = []
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
                relative = child.relative_to(path).as_posix()
                if not installed and junk(relative):
                    continue
                # DirEntry.stat on Windows omits the hard-link count.
                info = child.stat(follow_symlinks=False)
                directory = stat.S_ISDIR(info.st_mode)
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
                    raise refused_entry(prefix + relative, "a link, a device or a file with another name for the same data")
                key = snapshot.entry(relative, directory, 0 if directory else info.st_size)
                if directory:
                    if depth_limit is not None and len(child.relative_to(path).parts) > depth_limit:
                        raise MemberError("size", f"{prefix + relative} is nested deeper than {depth_limit} folders",
                                          reason="depth", file=prefix + relative, limit=depth_limit)
                    pending.append(child)
                else:
                    if cached:
                        regular.append((key, child, _file_revision(info)))
                    else:
                        with child.open("rb") as stream:
                            opened = os.fstat(stream.fileno())
                            if not os.path.samestat(info, opened) or opened.st_nlink != 1:
                                raise refused_entry(prefix + relative, "changed while it was read")
                            snapshot.read(key, stream, info.st_size)
    if cached:
        snapshot.files.update(_cached_files(path, tuple(regular), snapshot.size))
    return snapshot


def validate_files(files):
    snapshot = Snapshot()
    for name, data in files.items():
        key = snapshot.entry(name, False, len(data))
        snapshot.files[key] = data
    return snapshot.finish()

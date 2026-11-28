"""Files a skill links to outside its own folder.

A skill may say "read ../../actions/report.md". The library keeps one skill per folder, so the linked files of the
same source (the plugin, the repository, the folder or the archive it came in) are copied into that folder under
`_plugin/` and the skill document points there. The copy stays inside the source root, follows no links and shares
the package's size and file limits. What cannot be copied is named in `skipped_references`, never dropped without a word.

A skill may also name files beside its own folder without climbing to them: `actions/how.md` written in a document whose
folder has no `actions`, `actions/<name>.md`, or only "read the files of the actions folder". The Agent Skills format reads
those from the skill's own folder, so the files of the source that the words point to (at the skill's parent, its parent's
parent, up to the source's root) are placed in the skill's folder under the name the document gives them, where its own
files win. The folder of the plugin or the source stays the one place they are looked for; nothing is taken from outside it.

A source says what is at a path (`look`) and gives it (`read`): a folder on disk, an archive, a GitHub listing.
"""

import os
import posixpath
import re
import stat
from collections import deque
from pathlib import Path
from urllib.parse import quote, unquote

from .skill_library import junk, linked
from .store import MemberError

SHARED_FOLDER = "_plugin"
_MARKDOWN = (".md", ".markdown")
# A path that climbs out of the folder it is written in; every other path a skill names is inside its folder already.
_CLIMBING = re.compile(r"(?<![A-Za-z0-9_.%+~/@-])((?:\./)?(?:\.\./)+[\w@%+~.\-/]*)")
_INLINE = re.compile(r"\]\(\s*<?([^)\s>]+)")
_DEFINITION = re.compile(r"^ {0,3}\[[^\]\n]+\]:[ \t]*<?([^\s>]+)", re.M)
_NOT_A_PATH = re.compile(r"^(?:[a-z][a-z0-9+.-]*:|//|#|/)", re.I)
# A path written without climbing (`actions/how.md`, `./actions/`, `actions/<name>.md`): a name, then folders. Whether it names
# anything is decided by the source, so a `read/write` or an address is no harm.
_PLAIN = re.compile(r"(?<![A-Za-z0-9_./@~%:+\-])((?:\./)?[A-Za-z0-9_@][\w@%+~.\-]*(?:/[\w@%+~.\-<>{}\[\]*#?]*)+)")
_CUT = re.compile(r"[<>{}\[\]*#?]")
# What says that a word is a folder, in the languages the app speaks (and a few more): `the actions folder`, `actions 資料夾`.
_FOLDER_WORDS = ("folder", "directory", "dir ", "資料夾", "文件夾", "文件夹", "目錄", "目录", "フォルダ", "ディレクトリ", "폴더", "디렉터리",
                 "carpeta", "directorio", "dossier", "répertoire", "ordner", "verzeichnis", "pasta", "diretório", "cartella",
                 "папк", "каталог", "klasör", "dizin", "thư mục", "โฟลเดอร์", "مجلد", "फ़ोल्डर", "फोल्डर", "map ", "mappen")
# How many files of one folder a document's words may take with them, and how many bytes.
FOLDER_FILES = 2000
FOLDER_BYTES = 64 * 1024 * 1024


def _trim(token):
    """A sentence's full stop is not part of the path it ends."""
    core = token
    while core.endswith(".") and not core.endswith("/.."):
        core = core[:-1]
    return core, token[len(core):]


def _resolve(folder, target):
    """`("path", root-relative)` or `("outside", None)` for a link written in `folder`; None when it is no file path."""
    decoded = unquote(target.split("#", 1)[0].split("?", 1)[0])
    if not decoded or _NOT_A_PATH.match(decoded) or any(char in decoded for char in "\\:\x00"):
        return None
    path = posixpath.normpath(posixpath.join(folder, decoded))
    if path == ".." or path.startswith("../"):
        return "outside", None
    return "path", "" if path == "." else path


def _targets(text, *, links):
    """The paths a document names: those that climb out of its folder, and with `links` every Markdown link."""
    found = []
    if links:
        found += [match[1] for match in _INLINE.finditer(text)] + [match[1] for match in _DEFINITION.finditer(text)]
    found += [_trim(match[1])[0] for match in _CLIMBING.finditer(text)]
    return list(dict.fromkeys(found))


class DiskSource:
    """A folder on this computer: nothing under a link, nothing but plain files with one name."""

    def __init__(self, root):
        self.root = root

    def look(self, path):
        """None when nothing is there, a reason (`linked`, `folder`, `unsupported`, `unreadable`) when it cannot be taken,
        else the file's size."""
        target = self.root.joinpath(*path.split("/"))
        try:
            info = target.lstat()
            if any(linked(p) for p in (target, *target.parents)):
                return "linked"
        except (FileNotFoundError, NotADirectoryError):
            return None
        except OSError:
            return "unreadable"
        if stat.S_ISDIR(info.st_mode):
            return "folder"
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            return "unsupported"
        return info.st_size

    def read(self, path):
        target = self.root.joinpath(*path.split("/"))
        with target.open("rb") as stream:
            info = target.lstat()
            if not os.path.samestat(info, os.fstat(stream.fileno())):
                raise OSError("changed while it was read")
            data = stream.read(info.st_size + 1)
        if len(data) != info.st_size:
            raise OSError("changed while it was read")
        return data

    def dirs(self, path):
        """The names of the folders directly in `path` ("" is the root), none of them a link or a leftover."""
        try:
            with os.scandir(self.root.joinpath(*path.split("/")) if path else self.root) as entries:
                return sorted(entry.name for entry in entries if entry.is_dir(follow_symlinks=False) and not junk(entry.name)
                              and not linked(self.root / path / entry.name))
        except OSError:
            return []

    def children(self, path, cap):
        """The files below the folder `path` as root-relative paths, at most `cap`, never entering a link or a leftover."""
        found, pending = [], [path]
        while pending and len(found) < cap:
            folder = pending.pop()
            try:
                with os.scandir(self.root.joinpath(*folder.split("/"))) as entries:
                    for entry in sorted(entries, key=lambda item: item.name):
                        relative = f"{folder}/{entry.name}"
                        if junk(entry.name) or entry.is_symlink() or linked(Path(entry.path)):
                            continue
                        if entry.is_dir(follow_symlinks=False):
                            pending.append(relative)
                        else:
                            found.append(relative)
            except OSError:
                continue
        return found


class MemorySource:
    """The files of an archive or a listing: `files` maps a path to its size (or `"linked"`), `fetch` gives its bytes."""

    def __init__(self, files, fetch):
        self.files, self.fetch = files, fetch
        self.folders = {path.rpartition("/")[0] for path in files}
        self.folders |= {"/".join(folder.split("/")[:count]) for folder in self.folders for count in range(1, len(folder.split("/")))}

    def look(self, path):
        if path in self.files:
            return self.files[path]
        if path in self.folders:
            return "folder"
        for parent in ("/".join(path.split("/")[:count]) for count in range(1, len(path.split("/")))):
            if self.files.get(parent) == "linked":
                return "linked"
        return None

    def read(self, path):
        return self.fetch(path)

    def dirs(self, path):
        prefix = path + "/" if path else ""
        return sorted({folder[len(prefix):].split("/")[0] for folder in self.folders
                       if folder and folder.startswith(prefix) and folder != path and not junk(folder[len(prefix):])})

    def children(self, path, cap):
        found = []
        for name in sorted(self.files):
            if name.startswith(path + "/") and self.files[name] is not None:
                found.append(name)
                if len(found) >= cap:
                    break
        return found


class _Shared:
    def __init__(self, files, snapshot, inside, source):
        self.files, self.snapshot, self.source = files, snapshot, source
        self.inside = inside
        self.stored = {}
        self.skipped = {}
        # Where the source's own folders that the document's words point to are placed in the skill: `(path in the source,
        # path in the skill)`. Anything else the document reaches is copied under `_plugin/`.
        self.regions = []
        self.levels = []
        level = posixpath.dirname(inside)
        while True:
            self.levels.append(level)
            if not level:
                break
            level = posixpath.dirname(level)

    def name_of(self, path):
        """The name a file of the source has in the stored skill."""
        for root, shown in self.regions:
            if path == root or path.startswith(root + "/"):
                return shown + path[len(root):]
        return f"{SHARED_FOLDER}/{path}"

    def has(self, name):
        """Whether the skill holds this name already, as a file or as a folder."""
        return name.casefold() in self.snapshot.paths

    def in_skill(self, path):
        return path == self.inside or path.startswith(self.inside + "/")

    def skip(self, path, reason):
        self.skipped.setdefault((path, reason), {"path": path, "reason": reason})

    def offer(self, path):
        """Copy one plugin file beside the skill: True when it was copied now, False when it cannot be, None when
        nothing is there. A file copied before is neither."""
        key = path.casefold()
        if key in self.stored:
            return None
        snapshot = self.snapshot
        found = self.source.look(path)
        if found is None:
            return None
        name = self.name_of(path)
        if not name.startswith(SHARED_FOLDER + "/") and self.has(name):
            # The skill's own file of that name stays.
            return None
        if isinstance(found, str):
            self.skip(path, found)
            return False
        if found > snapshot.byte_limit - snapshot.size or len(snapshot.explicit) >= snapshot.entry_limit:
            self.skip(path, "too_large")
            return False
        try:
            data = self.source.read(path)
        except (FileNotFoundError, NotADirectoryError):
            return None
        except OSError:
            self.skip(path, "unreadable")
            return False
        try:
            name = snapshot.entry(name, False, len(data))
        except MemberError as error:
            self.skip(path, "too_large" if error.kind == "size" else "unsupported")
            return False
        snapshot.files[name] = data
        self.stored[key] = name
        return True

    def reach(self, folder, target, queue):
        found = _resolve(folder, target)
        if found is None:
            return
        kind, path = found
        if kind == "outside":
            self.skip(target.split("#", 1)[0], "outside_plugin")
        elif self.in_skill(path):
            # Its file is in the skill's folder, but a link written elsewhere in the plugin no longer finds it there.
            if folder != self.inside:
                self.skip(path, "inside_skill")
        elif path and not self.inside.startswith(path + "/"):
            if self.offer(path) and path.lower().endswith(_MARKDOWN):
                queue.append(path)

    def collect(self, text):
        """Copy every file the skill document links to, then the files those Markdown files link to in turn."""
        queue = deque()
        for target in _targets(text, links=False):
            self.reach(self.inside, target, queue)
        self.named(text, queue)
        while queue:
            path = queue.popleft()
            document = self.snapshot.files[self.stored[path.casefold()]].decode("utf-8", "replace")
            for target in _targets(document, links=True):
                self.reach(posixpath.dirname(path), target, queue)
        # A folder that is linked, with some of its files linked as well, is not a loss.
        for path, reason in list(self.skipped):
            if reason == "folder" and any(key.startswith(path.casefold() + "/") for key in self.stored):
                del self.skipped[path, reason]

    def mapped(self, path):
        """Where a root-relative path is in the stored skill, or None when the stored skill has nothing there."""
        if self.in_skill(path):
            relative = posixpath.relpath(path, self.inside)
            if relative == "." or relative in self.files or any(name.startswith(relative + "/") for name in self.files):
                return relative
            return None
        key = path.casefold()
        if key in self.stored:
            return self.stored[key]
        if any(name.casefold().startswith(self.name_of(path).casefold() + "/") for name in self.stored.values()):
            return self.name_of(path)
        return None

    def folder(self, path, queue):
        """Everything below a folder of the source that the document points to, within the bounds of one folder."""
        files = self.source.children(path, FOLDER_FILES + 1)
        if len(files) > FOLDER_FILES:
            self.skip(path, "too_large")
            return
        total = 0
        for file in files:
            size = self.source.look(file)
            total += size if isinstance(size, int) else 0
        if total > FOLDER_BYTES:
            self.skip(path, "too_large")
            return
        for file in files:
            if self.offer(file) and file.lower().endswith(_MARKDOWN):
                queue.append(file)

    def named(self, text, queue):
        """The files and folders the document names without climbing to them, found beside the skill's folder or above it in
        its source: `actions/how.md`, `actions/<name>.md`, and a folder the words call a folder (the actions folder)."""
        for token in dict.fromkeys(match[1] for match in _PLAIN.finditer(text)):
            trimmed = _trim(token)[0]
            written = unquote(_CUT.split(trimmed, 1)[0]).removeprefix("./")
            if not written or "\\" in written or ":" in written or ".." in written.split("/"):
                continue
            head = written.rstrip("/")
            # A name that ends in a slash, or that is cut at a template (`actions/<name>.md`), is a folder.
            folder = written.endswith("/") or (_CUT.search(trimmed) is not None and not posixpath.splitext(head)[1])
            if not head or (self.has(head) and not folder):
                continue
            for level in self.levels:
                path = posixpath.join(level, head) if level else head
                if self.in_skill(path) or self.inside.startswith(path + "/"):
                    break
                found = self.source.look(path)
                if found is None:
                    continue
                if found == "folder":
                    self.regions.append((path, head))
                    self.folder(path, queue)
                elif isinstance(found, str):
                    self.skip(path, found)
                elif not folder:
                    self.regions.append((path, head))
                    if self.offer(path) and path.lower().endswith(_MARKDOWN):
                        queue.append(path)
                break
        for level in self.levels:
            for name in self.source.dirs(level):
                path = posixpath.join(level, name) if level else name
                if (self.has(name) or self.in_skill(path) or self.inside.startswith(path + "/") or name.startswith(".")
                        or self.source.look(path + "/SKILL.md") is not None or not mentions(text, name)):
                    continue
                self.regions.append((path, name))
                self.folder(path, queue)

    def rewrite(self, text):
        """Point the links at the copies; the same path written again elsewhere in the text moves with them."""
        def move(match):
            core, tail = _trim(match[1])
            found = _resolve(self.inside, core)
            target = self.mapped(found[1]) if found and found[0] == "path" and found[1] else None
            if target is None:
                return match[0]
            if "%" in core:
                target = quote(target, safe="/")
            return target + ("/" if core.endswith("/") and not target.endswith("/") else "") + tail
        return _CLIMBING.sub(move, text)


def mentions(text, name):
    """Whether the words of a document call `name` a folder: `name/`, `` `name` `` or the name beside the word for a folder."""
    edge = re.compile(r"(?<![A-Za-z0-9_./@~-])" + re.escape(name) + r"(?![A-Za-z0-9_-])", re.I)
    for match in edge.finditer(text):
        before, after = text[match.start() - 1:match.start()], text[match.end():match.end() + 1]
        if after == "/" or (before == "`" and after == "`"):
            return True
        near = text[max(0, match.start() - 14):match.end() + 14].casefold()
        if any(word in near for word in _FOLDER_WORDS):
            return True
    return False


def attach_shared(files, snapshot, inside, source):
    """Add to a skill's `files` what its document links to elsewhere in its source (`source`, whose root holds the skill's
    folder `inside`, as a path from that root); `snapshot` holds the limits."""
    if not inside:
        return
    text = files["SKILL.md"].decode("utf-8-sig")
    shared = _Shared(files, snapshot, inside, source)
    if SHARED_FOLDER in snapshot.paths:
        # The skill's own folder uses the name already: nothing is copied, and every link outside it is said.
        for target in _targets(text, links=False):
            found = _resolve(shared.inside, target)
            if found and (found[0] == "outside" or not shared.in_skill(found[1])):
                shared.skip(found[1] or target, "name_taken" if found[0] == "path" else "outside_plugin")
        shared.named(text, deque())
    else:
        shared.collect(text)
        moved = shared.rewrite(text)
        if moved != text:
            snapshot.size += len(moved.encode("utf-8")) - len(files["SKILL.md"])
            files["SKILL.md"] = moved.encode("utf-8")
    files.skipped_references = list(shared.skipped.values())


_DOCUMENT_FILES = (".md", ".markdown", ".txt")


def named_files(text):
    """The files and folders a document sends the model to, which pasted text alone cannot bring: a link to a file, a path that
    climbs out of the skill's folder, a Markdown or text file written as a path (`actions/how.md`), a folder written as a
    template (`actions/<name>.md`). Code blocks are examples, not references. Each is as the document writes it."""
    body = re.sub(r"```.*?```|~~~.*?~~~", "", text, flags=re.S)
    found = []
    for target in _targets(body, links=True):
        if _resolve("", target) is not None:
            found.append(target.split("#", 1)[0] or target)
    for token in (match[1] for match in _PLAIN.finditer(body)):
        trimmed = _trim(token)[0]
        written = unquote(_CUT.split(trimmed, 1)[0]).removeprefix("./")
        head = written.rstrip("/")
        if not head or "\\" in written or ":" in written or ".." in written.split("/"):
            continue
        if _CUT.search(trimmed) is not None and not posixpath.splitext(head)[1] or head.lower().endswith(_DOCUMENT_FILES):
            found.append(written)
    return list(dict.fromkeys(found))

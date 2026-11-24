"""Files a plugin's skill links to outside its own folder.

A skill of a plugin may say "read ../../actions/report.md". The library keeps one skill per folder, so the
linked files of the same plugin are copied into that folder under `_plugin/` and the skill document points
there. The copy stays inside the plugin root, follows no links and shares the package's size and file limits.
What cannot be copied is named in `skipped_references`, never dropped without a word.
"""

import os
import posixpath
import re
import stat
from collections import deque
from urllib.parse import quote, unquote

from .skill_library import linked
from .store import MemberError

SHARED_FOLDER = "_plugin"
_MARKDOWN = (".md", ".markdown")
# A path that climbs out of the folder it is written in; every other path a skill names is inside its folder already.
_CLIMBING = re.compile(r"(?<![A-Za-z0-9_.%+~/@-])((?:\./)?(?:\.\./)+[\w@%+~.\-/]*)")
_INLINE = re.compile(r"\]\(\s*<?([^)\s>]+)")
_DEFINITION = re.compile(r"^ {0,3}\[[^\]\n]+\]:[ \t]*<?([^\s>]+)", re.M)
_NOT_A_PATH = re.compile(r"^(?:[a-z][a-z0-9+.-]*:|//|#|/)", re.I)


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


class _Shared:
    def __init__(self, files, snapshot, folder, root):
        self.files, self.snapshot, self.root = files, snapshot, root
        self.inside = folder.relative_to(root).as_posix()
        self.stored = {}
        self.skipped = {}

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
        target = self.root.joinpath(*path.split("/"))
        snapshot = self.snapshot
        try:
            info = target.lstat()
            if any(linked(p) for p in (target, *target.parents)):
                self.skip(path, "linked")
                return False
            if stat.S_ISDIR(info.st_mode):
                self.skip(path, "folder")
                return False
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                self.skip(path, "unsupported")
                return False
            if info.st_size > snapshot.byte_limit - snapshot.size or len(snapshot.explicit) >= snapshot.entry_limit:
                self.skip(path, "too_large")
                return False
            with target.open("rb") as stream:
                if not os.path.samestat(info, os.fstat(stream.fileno())):
                    raise OSError("changed while it was read")
                data = stream.read(info.st_size + 1)
            if len(data) != info.st_size:
                raise OSError("changed while it was read")
        except (FileNotFoundError, NotADirectoryError):
            return None
        except OSError:
            self.skip(path, "unreadable")
            return False
        try:
            name = snapshot.entry(f"{SHARED_FOLDER}/{path}", False, len(data))
        except MemberError as error:
            self.skip(path, "too_large" if error.kind == "size" else "unsupported")
            return False
        snapshot.files[name] = data
        self.stored[key] = path
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
        while queue:
            path = queue.popleft()
            document = self.snapshot.files[f"{SHARED_FOLDER}/{path}"].decode("utf-8", "replace")
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
            return f"{SHARED_FOLDER}/{self.stored[key]}"
        if any(name.startswith(key + "/") for name in self.stored):
            return f"{SHARED_FOLDER}/{path}"
        return None

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


def attach_shared(files, snapshot, folder, root):
    """Add to a skill's `files` what its document links to elsewhere in its plugin (`root`); `snapshot` holds the limits."""
    if folder == root:
        return
    text = files["SKILL.md"].decode("utf-8-sig")
    shared = _Shared(files, snapshot, folder, root)
    if SHARED_FOLDER in snapshot.paths:
        # The skill's own folder uses the name already: nothing is copied, and every link outside it is said.
        for target in _targets(text, links=False):
            found = _resolve(shared.inside, target)
            if found and (found[0] == "outside" or not shared.in_skill(found[1])):
                shared.skip(found[1] or target, "name_taken" if found[0] == "path" else "outside_plugin")
    else:
        shared.collect(text)
        moved = shared.rewrite(text)
        if moved != text:
            snapshot.size += len(moved.encode("utf-8")) - len(files["SKILL.md"])
            files["SKILL.md"] = moved.encode("utf-8")
    files.skipped_references = list(shared.skipped.values())

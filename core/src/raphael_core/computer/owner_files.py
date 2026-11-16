"""Members' file tools on the owner's own computer, the one Raphael runs on (R-PC-04, R-PC-05).

Owner, 2026-11-16: 「控制電腦只限快速提問…但是其他本地的檔案都要是可以看到的」, 「寫應該要可以限制資料夾位置 但是讀取理論上是整台
電腦」, 「排程跟 telegram slack 之類的都要可以」. As Claude Code: its Read, Glob and Grep reach the whole computer, and its
Write and Edit only the folders it was given. So every turn and every task, wherever it was asked from, may read, find and
search the owner's files; a write goes only into the folders the owner listed in Settings (and the output folder), and
asks as any other change does. Commands, the desktop and the fixed commands stay with a quick question (R-PC-01).

Unlike Claude Code, which a person drives at the keyboard, Raphael also takes messages from phones and rooms and reads web
pages, any of which may try to talk a member into reading a secret and sending it on. So the places that hold keys and
passwords are kept from these tools whatever is asked (`kept`): SSH and cloud keys, the keychain and Windows' credential
stores, browsers' profiles, password managers, `.env` files and private keys. Raphael's own data goes through the data
floor as it does for every tool.

The reads and the whole-file writes use the same helper as a member's own computer (`files_guest`), run here in a thread;
read_file and edit_file keep Claude Code's semantics through `file_tools.Files` (read before edit, refused when changed).
Glob and Grep walk the disk in Python, as ripgrep is not on the owner's computer.
"""

import asyncio
import bisect
import os
import re
import stat
import sys
import time
from pathlib import Path

from ..agent.plugins import PluginResult
from . import files_guest
from .file_tools import (GLOB_LIMIT, HEAD_LIMIT, QUOTE_CHARS, FileReads, Files, Refused, VmError, _paged, _refusal)

SERVER = "owner_files"
READS = frozenset({"read_file", "glob", "grep"})
WRITES = frozenset({"write_file", "edit_file"})
TOOLS = READS | WRITES

# How long a walk of the disk may take, and how much of a file a search reads.
WALK_SECONDS = 30
GREP_FILE_BYTES = 16 * 1024 * 1024
BINARY_PROBE = 8192

WHERE = ("the owner's own computer, the one Raphael runs on (not your own computer): path absolute, or from the owner's "
         "home (~)")
DEFINITIONS = {
    "read_file": {
        "description": f"Read a file on {WHERE}, as Claude Code's Read. Any file the owner's account can open, except "
                       "where keys and passwords are kept. Text comes as numbered lines (cat -n), 2000 from offset unless "
                       "limit says fewer; the result says where to go on. A picture comes back as an image, a PDF as the "
                       "text of its pages (pages, e.g. \"1-5\", at most 20 a call). Read a file before you edit or write it.",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string", "minLength": 1, "maxLength": 4096},
            "offset": {"type": "integer", "minimum": 1},
            "limit": {"type": "integer", "minimum": 1},
            "pages": {"type": "string", "pattern": "^[0-9]{1,5}(-[0-9]{1,5})?$"}},
            "required": ["path"], "additionalProperties": False}},
    "glob": {
        "description": f"Find files by name on {WHERE.replace('path absolute', 'path a folder, absolute')}, as Claude Code's "
                       "Glob: pattern such as **/*.pdf or Documents/**/*.{docx,xlsx} (one without / matches at any depth), "
                       "under path (the owner's home by default). Newest first, 100 at most. Skips app data, caches and "
                       "where keys are kept unless path is inside them; a narrow path is faster.",
        "parameters": {"type": "object", "properties": {
            "pattern": {"type": "string", "minLength": 1, "maxLength": 1000},
            "path": {"type": "string", "minLength": 1, "maxLength": 4096}},
            "required": ["pattern"], "additionalProperties": False}},
    "grep": {
        "description": f"Search file contents on {WHERE.replace('path absolute', 'path a file or folder, absolute')}, as "
                       "Claude Code's Grep: pattern is a regular expression, path a file or folder (the owner's home by "
                       "default); glob (e.g. *.{md,txt}) or type (e.g. py) picks files; ignore_case; multiline lets . match "
                       "newlines. output_mode: files_with_matches (default, newest first), content (matching lines; "
                       "line_numbers on by default; after, before or context lines) or count. head_limit (default 250, 0 "
                       "for all) and offset page the results. Text files only; a narrow path is faster.",
        "parameters": {"type": "object", "properties": {
            "pattern": {"type": "string", "minLength": 1, "maxLength": 4000},
            "path": {"type": "string", "minLength": 1, "maxLength": 4096},
            "glob": {"type": "string", "minLength": 1, "maxLength": 1000},
            "type": {"type": "string", "pattern": "^[A-Za-z0-9_+-]{1,40}$"},
            "output_mode": {"type": "string", "enum": ["files_with_matches", "content", "count"]},
            "ignore_case": {"type": "boolean"}, "line_numbers": {"type": "boolean"},
            "after": {"type": "integer", "minimum": 0, "maximum": 1000},
            "before": {"type": "integer", "minimum": 0, "maximum": 1000},
            "context": {"type": "integer", "minimum": 0, "maximum": 1000},
            "multiline": {"type": "boolean"},
            "head_limit": {"type": "integer", "minimum": 0}, "offset": {"type": "integer", "minimum": 0}},
            "required": ["pattern"], "additionalProperties": False}},
    "write_file": {
        "description": f"Write a whole file on {WHERE}, as Claude Code's Write, only inside the folders the owner lets "
                       "members write to (owner_context lists them); missing folders are made. A file that exists must "
                       "have been read with read_file first, and is refused if it changed since. Prefer edit_file for part "
                       "of a file.",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string", "minLength": 1, "maxLength": 4096},
            "content": {"type": "string"}},
            "required": ["path", "content"], "additionalProperties": False}},
    "edit_file": {
        "description": f"Replace exact text in a file on {WHERE}, as Claude Code's Edit, only inside the folders the owner "
                       "lets members write to. old_string must match the file exactly and appear once, unless replace_all "
                       "changes every occurrence. The file must have been read with read_file first, and the edit is "
                       "refused if it changed since.",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string", "minLength": 1, "maxLength": 4096},
            "old_string": {"type": "string"},
            "new_string": {"type": "string"},
            "replace_all": {"type": "boolean"}},
            "required": ["path", "old_string", "new_string"], "additionalProperties": False}},
}

KEPT_WORDS = ("This place holds keys or passwords (SSH or cloud keys, the keychain, a browser's profile, a password "
              "manager, a .env file or a private key), so it is kept from members' file tools. Tell the owner plainly; "
              "they can open it themselves.")
NOT_WRITABLE = ("Members may write only inside the folders the owner chose in Settings › General ({folders}). Save it there, "
                "or attach the file to your reply; tell the owner if it must go elsewhere.")
NO_FOLDERS = "no folder is chosen yet"
PROTECTED = "This is Raphael's own data, which members do not search."
MAC_PRIVATE = (" macOS keeps this place private: the owner can allow Raphael in System Settings › Privacy & Security › "
               "Files and Folders, or Full Disk Access for mail, messages and other apps' data.")

# A Keynote document is also *.key, so a private key is known here by its other names (.pem, id_rsa, .p12).
# Under the owner's home: where keys, passwords and browsers' sign-ins are kept, on a Mac, on Windows and on both.
_KEPT_IN_HOME = (
    ".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker", ".config/gcloud", ".config/gh", ".password-store", ".codex",
    ".claude/.credentials.json", ".netrc", ".git-credentials", ".npmrc", ".pypirc",
    "Library/Keychains", "Library/Cookies", "Library/Safari", "Library/Application Support/Google/Chrome",
    "Library/Application Support/Microsoft Edge", "Library/Application Support/BraveSoftware",
    "Library/Application Support/Arc", "Library/Application Support/Firefox", "Library/Application Support/1Password",
    "Library/Application Support/Bitwarden", "Library/Group Containers/2BUA8C4S2C.com.1password",
    "AppData/Local/Google/Chrome/User Data", "AppData/Local/Microsoft/Edge/User Data", "AppData/Local/BraveSoftware",
    "AppData/Roaming/Mozilla/Firefox", "AppData/Local/1Password", "AppData/Roaming/Bitwarden",
    "AppData/Roaming/Microsoft/Credentials", "AppData/Local/Microsoft/Credentials", "AppData/Roaming/Microsoft/Protect",
    "AppData/Roaming/Microsoft/Crypto", "AppData/Roaming/Microsoft/Vault", "AppData/Local/Microsoft/Vault",
)
_KEPT_SYSTEM = ("/etc/shadow", "/etc/master.passwd", "/etc/sudoers", "/private/etc/master.passwd", "/private/etc/sudoers",
                "/private/var/db/sudo", "/Library/Keychains")
_KEPT_NAME = re.compile(r"\.env(?:\.(?!example$|sample$|template$|dist$)[^.]+)*|id_(?:rsa|dsa|ecdsa|ed25519)"
                        r"|.+\.(?:pem|p12|pfx|kdbx|keychain|keychain-db|ppk|jks|keystore)", re.I)
# Folders a walk does not go into unless it starts inside them: app data and caches (large, and on a Mac each app's
# container asks the owner for access), version control and packages.
_HEAVY_IN_HOME = ("Library", "AppData", ".Trash", ".cache", ".npm", ".cargo", ".rustup", ".local/share/Trash")
_HEAVY_NAMES = {".git", "node_modules", "__pycache__", ".venv", "venv", ".tox", ".mypy_cache", ".pytest_cache"}
_HEAVY_SYSTEM = ("/System", "/private", "/dev", "/proc", "/sys", "/Volumes/.timemachine", "/cores")
_TYPES = {"py": "py pyi", "js": "js mjs cjs jsx", "ts": "ts tsx mts cts", "md": "md markdown", "txt": "txt",
          "json": "json jsonl", "yaml": "yaml yml", "html": "html htm", "css": "css scss", "rust": "rs", "go": "go",
          "java": "java", "c": "c h", "cpp": "cpp cc cxx hpp hh h", "cs": "cs", "swift": "swift", "kotlin": "kt kts",
          "ruby": "rb", "php": "php", "sh": "sh bash zsh", "sql": "sql", "csv": "csv tsv", "xml": "xml", "toml": "toml"}


def _key(path):
    """A path as these checks compare it: forward slashes, no trailing one, case folded (a Mac's and Windows' disks
    ignore case)."""
    return str(path).replace("\\", "/").rstrip("/").casefold()


def _under(path, root):
    path, root = _key(path), _key(root)
    return path == root or path.startswith(root + "/")


def _home():
    return Path.home()


def kept(path, home=None):
    """Whether `path` (resolved) is a place that holds keys or passwords."""
    home = home or _home()
    if any(_under(path, home / place) for place in _KEPT_IN_HOME):
        return True
    if any(_under(path, place) for place in _KEPT_SYSTEM):
        return True
    root = os.environ.get("SystemRoot")
    if root and _under(path, Path(root) / "System32" / "config"):
        return True
    return any(_KEPT_NAME.fullmatch(part) for part in Path(path).parts[-1:])


def place(path, home=None):
    """The owner's path, absolute and resolved through links (a link cannot lead a check astray): `~` and a relative
    path are taken from the owner's home."""
    if not isinstance(path, str) or "\x00" in path or not path.strip():
        raise VmError("bad_path")
    home = home or _home()
    text = path.strip()
    if text == "~" or text.startswith(("~/", "~\\")):
        text = str(home) + text[1:]
    candidate = Path(text)
    if not candidate.is_absolute():
        candidate = home / candidate
    return os.path.realpath(candidate)


def writable_folders(settings):
    """The folders members may write to: the ones the owner listed, and the output folder."""
    folders = [settings.get("owner_output_folder") or "", *(settings.get("owner_write_folders") or [])]
    return list(dict.fromkeys(folder for folder in folders if folder))


class HostIO:
    """`file_request` of a member's computer, answered on this computer by the same helper (`files_guest`)."""

    async def file_request(self, target, request, *, answer_bytes=0):
        path = request["path"]
        roots = []
        if os.name == "nt":
            # The helper speaks in forward slashes; under a drive (or a share) it walks one folder at a time.
            drive = os.path.splitdrive(path)[0].replace("\\", "/")
            path = path.replace("\\", "/")
            roots = [drive + "/"]
        return await asyncio.to_thread(files_guest.handle, {**request, "path": path, "roots": roots})


class OwnerFiles(Files):
    """read_file, write_file and edit_file of `file_tools.Files` on the owner's computer."""

    place = staticmethod(place)
    BINARY = "This file is not text, a picture or a PDF ({size:,} bytes), so read_file cannot show it."
    NOT_TEXT = "This file is not text in UTF-8 or UTF-16, so edit_file cannot change it in place."
    TOO_LARGE = "This file is {size:,} bytes; edit_file changes files of at most 10 MiB."
    PICTURE_TOO_LARGE = "This picture is {size:,} bytes; read_file shows pictures of at most 5 MiB."
    PDF_TOO_LARGE = "This PDF is {size:,} bytes; read_file reads PDFs of at most 20 MiB."

    def __init__(self, reads, run):
        async def nothing():
            return None
        super().__init__(HostIO(), None, reads, run, nothing)


def _glob_pattern(pattern):
    """A gitignore-style glob as a regular expression over a path relative to the folder searched: `**/` any folders,
    `*` and `?` within a name, `{a,b}` either. One without a slash matches at any depth."""
    if "/" not in pattern.strip("/"):
        pattern = "**/" + pattern.strip("/")
    out, index = [], 0
    while index < len(pattern):
        char = pattern[index]
        if pattern.startswith("**/", index):
            out.append("(?:.*/)?")
            index += 3
            continue
        if pattern.startswith("**", index):
            out.append(".*")
            index += 2
            continue
        if char == "*":
            out.append("[^/]*")
        elif char == "?":
            out.append("[^/]")
        elif char == "{":
            end = pattern.find("}", index)
            if end > index:
                out.append("(?:" + "|".join(re.escape(part) for part in pattern[index + 1:end].split(",")) + ")")
                index = end + 1
                continue
            out.append(re.escape(char))
        elif char == "[":
            end = pattern.find("]", index + 1)
            if end > index + 1:
                body = pattern[index + 1:end]
                out.append("[" + ("^" + body[1:] if body.startswith("!") else body) + "]")
                index = end + 1
                continue
            out.append(re.escape(char))
        else:
            out.append(re.escape(char))
        index += 1
    return re.compile("".join(out), re.I)


class Walk:
    """The files under a folder, newest first in the caller's hands: what a walk skips (app data, caches, packages and
    the places of keys, unless it starts inside them; Raphael's own data), and whether it was cut by time or by folders it
    could not open."""

    def __init__(self, base, protected, home=None):
        self.base, self.protected, self.home = base, protected, home or _home()
        self.deadline = time.monotonic() + WALK_SECONDS
        self.cut = self.denied = False

    def _refused(self, full, folder=False):
        """Whether an entry of the walk is kept from it, judged where it leads: a link or a junction inside a walked folder
        may point into a kept place or Raphael's own data, and `os.walk` descends into a Windows junction. Only links are
        resolved; a plain file stands in a folder that was judged on the way down."""
        linked = os.path.islink(full) or getattr(os.path, "isjunction", lambda path: False)(full)
        if not linked:
            return kept(full, self.home) or (folder and self.protected(full))
        real = os.path.realpath(full)
        return kept(full, self.home) or kept(real, self.home) or self.protected(real)

    def _skipped(self, folder, name):
        full = os.path.join(folder, name)
        if name in _HEAVY_NAMES and not _under(self.base, full):
            return True
        if self._refused(full, folder=True):
            return True
        heavy =[self.home / place for place in _HEAVY_IN_HOME] + [Path(place) for place in _HEAVY_SYSTEM]
        return any(_under(full, place) and not _under(self.base, place) for place in heavy)

    def files(self):
        if os.path.isfile(self.base):
            yield self.base
            return

        def refused(error):
            if isinstance(error, PermissionError):
                self.denied = True

        for folder, folders, names in os.walk(self.base, onerror=refused):
            folders[:] = [name for name in folders if not self._skipped(folder, name)]
            for name in names:
                if time.monotonic() > self.deadline:
                    self.cut = True
                    return
                full = os.path.join(folder, name)
                if not self._refused(full):
                    yield full

    def note(self):
        notes = []
        if self.cut:
            notes.append(f"(The search stopped after {WALK_SECONDS} seconds. Use a narrower path.)")
        if self.denied:
            notes.append("(Some folders could not be opened." + (MAC_PRIVATE if sys.platform == "darwin" else "") + ")")
        return "\n".join(notes)


def _mtime(path):
    try:
        return os.stat(path).st_mtime
    except OSError:
        return 0


def _shown(path):
    return path.replace("\\", "/") if os.name == "nt" else path


def glob_files(arguments, protected):
    base = place(arguments.get("path") or "~")
    if not os.path.exists(base):
        raise Refused("path_missing", f"Path does not exist: {_shown(base)}")
    if kept(base):
        raise Refused("kept", KEPT_WORDS)
    if protected(base):
        raise Refused("protected_data", PROTECTED)
    pattern = _glob_pattern(arguments["pattern"])
    walk = Walk(base, protected)
    found = [path for path in walk.files() if pattern.fullmatch(os.path.relpath(path, base).replace("\\", "/"))]
    found.sort(key=_mtime, reverse=True)
    if not found:
        return PluginResult(True, text="\n".join(["No files found", walk.note()]).strip())
    text = "\n".join(_shown(path) for path in found[:GLOB_LIMIT])
    if len(found) > GLOB_LIMIT:
        text += "\n(Results are truncated. Consider using a more specific path or pattern.)"
    return PluginResult(True, text="\n".join([text, walk.note()]).strip())


def _type_pattern(name):
    extensions = _TYPES.get(name.casefold(), name).split()
    return re.compile(r".*\.(?:" + "|".join(re.escape(extension) for extension in extensions) + ")", re.I)


def grep_files(arguments, protected):
    base = place(arguments.get("path") or "~")
    if not os.path.exists(base):
        raise Refused("path_missing", f"Path does not exist: {_shown(base)}")
    if kept(base):
        raise Refused("kept", KEPT_WORDS)
    if protected(base):
        raise Refused("protected_data", PROTECTED)
    flags = re.MULTILINE | (re.IGNORECASE if arguments.get("ignore_case") else 0) | (re.DOTALL if arguments.get("multiline") else 0)
    try:
        expression = re.compile(arguments["pattern"], flags)
    except re.error as error:
        raise Refused("bad_pattern", f"The pattern is not a valid regular expression: {str(error)[:QUOTE_CHARS]}") from None
    chosen = _glob_pattern(arguments["glob"]) if arguments.get("glob") else None
    typed = _type_pattern(arguments["type"]) if arguments.get("type") else None
    mode = arguments.get("output_mode", "files_with_matches")
    numbers = arguments.get("line_numbers", True)
    context = arguments.get("context")
    before = arguments["before"] if arguments.get("before") is not None else context or 0
    after = arguments["after"] if arguments.get("after") is not None else context or 0
    walk = Walk(base, protected)
    files, rows, counts = [], [], []
    for path in walk.files():
        relative = os.path.relpath(path, base).replace("\\", "/") if path != base else os.path.basename(path)
        if chosen and not chosen.fullmatch(relative) or typed and not typed.fullmatch(os.path.basename(path)):
            continue
        try:
            info = os.stat(path)
            if not stat.S_ISREG(info.st_mode) or info.st_size > GREP_FILE_BYTES:
                continue
            with open(path, "rb") as stream:
                data = stream.read()
        except OSError as error:
            walk.denied = walk.denied or isinstance(error, PermissionError)
            continue
        if b"\x00" in data[:BINARY_PROBE]:
            continue
        text = data.decode("utf-8", errors="replace")
        if mode == "files_with_matches":
            if expression.search(text):
                files.append(path)
            continue
        if mode == "count":
            count = sum(1 for _ in expression.finditer(text))
            if count:
                counts.append((path, count))
            continue
        lines = text.split("\n")
        ends = [match.start() for match in re.finditer("\n", text)]
        hits = sorted({bisect.bisect_left(ends, match.start()) for match in expression.finditer(text)})
        if not hits:
            continue
        shown, last = set(), None
        for hit in hits:
            for number in range(max(0, hit - before), min(len(lines), hit + after + 1)):
                if number in shown:
                    continue
                if last is not None and number > last + 1 and (before or after):
                    rows.append("--")
                shown.add(number)
                last = number
                mark = ":" if number == hit or number in hits else "-"
                line = lines[number].rstrip("\r")[:2000]
                rows.append(f"{_shown(path)}{mark}{number + 1}{mark}{line}" if numbers else f"{_shown(path)}{mark}{line}")
    offset, limit = arguments.get("offset", 0), arguments.get("head_limit", HEAD_LIMIT)
    note = walk.note()
    if mode == "files_with_matches":
        if not files:
            return PluginResult(True, text="\n".join(["No files found", note]).strip())
        files.sort(key=_mtime, reverse=True)
        page, more = _paged([_shown(path) for path in files], offset, limit, walk.cut)
        head = f"Found {len(files):,}{'+' if walk.cut else ''} file{'s' if len(files) != 1 else ''}"
        return PluginResult(True, text="\n".join([head, *page, *([more] if more else []), *([note] if note else [])]))
    if mode == "count":
        if not counts:
            return PluginResult(True, text="\n".join(["No matches found", note]).strip())
        page, more = _paged(sorted(counts), offset, limit, walk.cut)
        text = "\n".join(f"{_shown(path)}:{count}" for path, count in page)
        text += (f"\n\nFound {sum(count for _, count in counts):,} total occurrences across {len(counts):,} "
                 f"file{'s' if len(counts) != 1 else ''}.")
        return PluginResult(True, text="\n".join([text, *([more] if more else []), *([note] if note else [])]))
    if not rows:
        return PluginResult(True, text="\n".join(["No matches found", note]).strip())
    page, more = _paged(rows, offset, limit, walk.cut)
    return PluginResult(True, text="\n".join([*page, *([more] if more else []), *([note] if note else [])]))


def _denied_words(result):
    """A file the owner's account could not open: on a Mac, most often its privacy protection."""
    if result.kind == "permission_denied":
        return PluginResult(False, result.kind, "Permission denied: the owner's account cannot open this path."
                            + (MAC_PRIVATE if sys.platform == "darwin" else ""))
    return result


class OwnerFileTools:
    """The five tools, their tiers and kinds, and their calls."""

    def __init__(self, settings, data_floor):
        self.settings, self.data_floor = settings, data_floor
        self.reads = FileReads()

    def guard(self):
        """Whether a path is Raphael's own data, as a walk in another thread may ask it: the data floor without its
        database connection (which stays in this thread), and the folder of each database it has open."""
        from ..agent.data_floor import DataFloor
        floor = DataFloor(None, environ=self.data_floor.environ, core_root=self.data_floor.core_root)
        databases = []
        if self.data_floor.conn is not None:
            databases = [os.path.dirname(row[2]) for row in self.data_floor.conn.execute("PRAGMA database_list") if row[2]]

        def protected(path):
            try:
                return floor.protected(path) or any(_under(os.path.realpath(path), folder) for folder in databases)
            except (OSError, ValueError):
                return False
        return protected

    def writable(self, arguments):
        """Whether a write's path is inside a folder the owner lets members write to."""
        try:
            path = place(arguments.get("path"))
        except VmError:
            return False
        folders = []
        for folder in writable_folders(self.settings):
            try:
                folders.append(os.path.realpath(folder))
            except (OSError, ValueError):
                continue
        return any(_under(path, folder) for folder in folders) and not kept(path)

    async def call(self, name, arguments, *, approver, run):
        try:
            if name in WRITES:
                if not self.writable(arguments):
                    folders = writable_folders(self.settings)
                    return PluginResult(False, "not_writable", NOT_WRITABLE.format(
                        folders=", ".join(folders) if folders else NO_FOLDERS))
                if approver == "none":
                    return PluginResult(False, "approval_required", "This change needs the owner's approval in the app. "
                                        "Wait for that approval before trying it again.")
            path = arguments.get("path")
            if name != "glob" and name != "grep" or path:
                if kept(place(path or "~")):
                    return PluginResult(False, "kept", KEPT_WORDS)
            if name == "glob":
                return await asyncio.to_thread(glob_files, arguments, self.guard())
            if name == "grep":
                return await asyncio.to_thread(grep_files, arguments, self.guard())
            files = OwnerFiles(self.reads, run)
            result = await getattr(files, name)(arguments)
            return _denied_words(result)
        except Refused as error:
            return _refusal(error)
        except VmError as error:
            return PluginResult(False, str(error), "This path is not valid.")
        except OSError as error:
            return _denied_words(PluginResult(False, "permission_denied" if isinstance(error, PermissionError)
                                              else "file_unavailable", "The file could not be opened."))

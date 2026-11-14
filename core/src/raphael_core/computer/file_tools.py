"""A member's file tools on its own computer, as Claude Code's Edit and Write.

Owner, 2026-11-14: 「所有的 harness 都要統一 就是跟 claude 設計的一樣 或是參考 hermes agent」. A member changed its files
through `vm_exec` (`sed`, heredocs): nothing checked that the text it replaced was the text it had read, and a whole
file had to fit a 16,000-character command. These tools copy Claude Code's semantics and its words: an exact string
replaced, unique unless `replace_all`; a file read in this run before it is changed and refused when it changed since
(on a shared computer another member may have edited it; Hermes Agent's read-before-write guard is the same idea);
a whole file sent over stdin. Each takes the turn's file checkpoint first, so the card of changed files and its undo
see the change as they see a command's.
"""

import base64
import hashlib
import posixpath
from collections import OrderedDict

from ..agent.plugins import PluginResult
from .vm import GUEST, VmError

# The largest file edit_file changes in place: its text travels to the core and back.
MAX_EDIT_BYTES = 10 * 1024 * 1024
# A failure's words reach the model whole up to about this many characters; a long old_string is shown in part.
QUOTE_CHARS = 400
# How many runs (turns and tasks) keep what they read: a run that ended long ago has nothing to edit.
KEPT_RUNS = 64

WRITE_FILE = {
    "description": "Write a whole file in your computer, as Claude Code's Write: path absolute or relative to "
                   "/home/cua/workspace; missing folders are made. A file that exists must have been read with read_file "
                   "in this turn first, and is refused if it changed since. Prefer edit_file for part of a file. The "
                   "text is sent whole, so it may be far longer than a vm_exec command.",
    "parameters": {"type": "object", "properties": {
        "path": {"type": "string", "minLength": 1, "maxLength": 4096},
        "content": {"type": "string"}},
        "required": ["path", "content"], "additionalProperties": False}}
EDIT_FILE = {
    "description": "Replace exact text in a file in your computer, as Claude Code's Edit. old_string must match the file "
                   "exactly, indentation included and without read_file's line-number prefix, and appear once, unless "
                   "replace_all changes every occurrence. The file must have been read with read_file in this turn, and "
                   "the edit is refused if it changed since. Returns the edited lines, numbered.",
    "parameters": {"type": "object", "properties": {
        "path": {"type": "string", "minLength": 1, "maxLength": 4096},
        "old_string": {"type": "string"},
        "new_string": {"type": "string"},
        "replace_all": {"type": "boolean"}},
        "required": ["path", "old_string", "new_string"], "additionalProperties": False}}

DEFINITIONS = {"write_file": WRITE_FILE, "edit_file": EDIT_FILE}
FILE_READS = frozenset()
FILE_WRITES = frozenset({"write_file", "edit_file"})
FILE_TOOLS = FILE_READS | FILE_WRITES

# Claude Code's own words where it has them.
NOT_READ = "File has not been read yet. Read it first before writing to it."
CHANGED = ("File has been modified since read, either by another member, a program or the owner. Read it again before "
           "attempting to write it.")
MISSING = "File does not exist."
NOT_FOUND = "String to replace not found in file.\nString: {old}"
NOT_UNIQUE = ("Found {count} matches of the string to replace, but replace_all is false. To replace all occurrences, set "
              "replace_all to true. To replace only one occurrence, please provide more context to uniquely identify "
              "the instance.\nString: {old}")
SAME = "No changes to make: old_string and new_string are exactly the same."
EXISTS = "Cannot create new file - file already exists."
NOT_TEXT = ("This file is not text in UTF-8 or UTF-16, so edit_file cannot change it in place. Use vm_exec with a "
            "program that understands its format.")
TOO_LARGE = "This file is {size:,} bytes; edit_file changes files of at most 10 MiB. Use vm_exec for a larger one."
NOT_A_FILE = {"directory": "This path is a folder, not a file.",
              "link": "This path is a link. Use the path it points to.",
              "other": "This path is not a regular file."}
GUEST_ERRORS = {"EACCES": "permission_denied", "EPERM": "permission_denied", "ELOOP": "link", "ENOTDIR": "not_a_folder",
                "EISDIR": "not_a_file", "ENOSPC": "disk_full", "EROFS": "read_only", "EINVAL": "bad_path",
                "ENAMETOOLONG": "bad_path"}
GUEST_WORDS = {"permission_denied": "Permission denied: the computer's user cannot open this path.",
               "link": "A folder on this path is a link, which is not followed inside the workspace or the team folder.",
               "not_a_folder": "A part of this path is a file, not a folder.",
               "not_a_file": "This path is a folder, not a file.",
               "disk_full": "The disk is full.", "read_only": "This place is read-only.", "bad_path": "This path is not valid."}


def guest_path(path):
    """A member's path in its computer: absolute, or taken from /home/cua/workspace (and `~` from /home/cua), with `.`
    and `..` resolved. The same reach as `vm_exec`."""
    if not isinstance(path, str) or "\x00" in path or not path.strip():
        raise VmError("bad_path")
    path = path.strip()
    if path == "~" or path.startswith("~/"):
        path = "/home/cua" + path[1:]
    joined = path if path.startswith("/") else f"{GUEST}/{path}"
    return "/" + posixpath.normpath(joined).lstrip("/")


class FileReads:
    """What each run (a turn, a task) has read or written of each file: the sha256 it saw. A file is changed only over
    what its run last saw (Claude Code's read-before-edit, with a hash instead of a time: a bind mount's times are
    coarse)."""

    def __init__(self, runs=KEPT_RUNS):
        self.runs, self.limit = OrderedDict(), runs

    def seen(self, run, path):
        return self.runs.get(run, {}).get(path)

    def saw(self, run, path, digest):
        self.runs.setdefault(run, {})[path] = digest
        self.runs.move_to_end(run)
        while len(self.runs) > self.limit:
            self.runs.popitem(last=False)


# --- text in its own encoding ---------------------------------------------------------------------------------------

BOMS = ((b"\xef\xbb\xbf", "utf-8"), (b"\xff\xfe", "utf-16-le"), (b"\xfe\xff", "utf-16-be"))


def decoded(data):
    """The text of a file and how to write it back (its byte-order mark and encoding), or None for a file that is not
    UTF-8 or UTF-16 text."""
    for bom, encoding in BOMS:
        if data.startswith(bom):
            try:
                return data[len(bom):].decode(encoding), (bom, encoding)
            except UnicodeDecodeError:
                return None
    try:
        return data.decode("utf-8"), (b"", "utf-8")
    except UnicodeDecodeError:
        return None


def encoded(text, form):
    bom, encoding = form
    return bom + text.encode(encoding)


def numbered(text, first, last):
    """Lines `first`..`last` (1-based, inclusive) of `text`, as `cat -n` numbers them."""
    lines = text.split("\n")
    return "\n".join(f"{number:6}\t{lines[number - 1].rstrip(chr(13))}"
                     for number in range(max(1, first), min(len(lines), last) + 1))


def quoted(text):
    return text if len(text) <= QUOTE_CHARS else text[:QUOTE_CHARS] + f"… ({len(text):,} characters)"


class Refused(Exception):
    def __init__(self, kind, words):
        super().__init__(kind)
        self.kind, self.words = kind, words


def replaced(text, old, new, replace_all):
    """`text` with `old` replaced by `new`: the new text, how many were replaced, where the first replacement starts and
    the text put there. A file with CRLF line ends matches an old_string written with LF, and keeps its CRLF."""
    if old == new:
        raise Refused("no_change", SAME)
    count = text.count(old)
    if not count and "\r\n" in text and "\n" in old:
        old, new = (value.replace("\r\n", "\n").replace("\n", "\r\n") for value in (old, new))
        count = text.count(old)
    if not count:
        raise Refused("string_not_found", NOT_FOUND.format(old=quoted(old)))
    if count > 1 and not replace_all:
        raise Refused("string_not_unique", NOT_UNIQUE.format(count=count, old=quoted(old)))
    start = text.index(old)
    return text.replace(old, new) if replace_all else text.replace(old, new, 1), count if replace_all else 1, start, new


def _refusal(error):
    return PluginResult(False, error.kind, error.words)


def _guest_failure(answer):
    kind = GUEST_ERRORS.get(answer.get("error"), "file_unavailable")
    return PluginResult(False, kind, GUEST_WORDS.get(kind, "The file could not be opened."))


class Files:
    """The file tools of one computer call: `vm.file_request` to the guest, the run's read state and its checkpoint."""

    def __init__(self, vm, target, reads, run, checkpoint):
        self.vm, self.target, self.reads, self.run, self.checkpoint = vm, target, reads, run, checkpoint

    async def look(self, path, limit=0):
        return await self.vm.file_request(self.target, {"action": "read", "path": path, "limit": limit},
                                          answer_bytes=limit)

    def current(self, path, answer):
        """Refused unless this run read the file as it is now."""
        seen = self.reads.seen(self.run, path)
        if seen is None:
            raise Refused("not_read", NOT_READ)
        if seen != answer["sha256"]:
            raise Refused("changed_since_read", CHANGED)

    async def put(self, path, data, expected):
        await self.checkpoint()
        answer = await self.vm.file_request(self.target, {"action": "write", "path": path, "expected": expected,
                                                          "data": base64.b64encode(data).decode()})
        if answer.get("error") == "changed":
            raise Refused("changed_since_read", CHANGED)
        if answer.get("error") == "not_a_file":
            raise Refused("not_a_file", NOT_A_FILE.get(answer.get("kind"), NOT_A_FILE["other"]))
        if "error" in answer:
            return None, answer
        self.reads.saw(self.run, path, answer["sha256"])
        return answer, None

    async def write_file(self, arguments):
        path = guest_path(arguments["path"])
        data = arguments["content"].encode("utf-8")
        try:
            answer = await self.look(path)
            if "error" in answer:
                return _guest_failure(answer)
            if answer["exists"]:
                if answer["kind"] != "file":
                    raise Refused("not_a_file", NOT_A_FILE.get(answer["kind"], NOT_A_FILE["other"]))
                self.current(path, answer)
            written, failed = await self.put(path, data, answer.get("sha256") or "absent")
        except Refused as error:
            return _refusal(error)
        if failed:
            return _guest_failure(failed)
        lines = arguments["content"].count("\n") + (not arguments["content"].endswith("\n") and bool(arguments["content"]))
        if written["created"]:
            return PluginResult(True, text=f"File created successfully at: {path} ({lines:,} lines, {written['size']:,} bytes)")
        return PluginResult(True, text=f"The file {path} has been overwritten ({lines:,} lines, {written['size']:,} bytes).")

    async def edit_file(self, arguments):
        path = guest_path(arguments["path"])
        old, new, replace_all = arguments["old_string"], arguments["new_string"], arguments.get("replace_all", False)
        try:
            answer = await self.look(path, MAX_EDIT_BYTES)
            if "error" in answer:
                return _guest_failure(answer)
            if not answer["exists"]:
                if old:
                    near = answer.get("near") or []
                    return PluginResult(False, "file_missing", MISSING + (f" Names near it: {', '.join(near)}." if near else ""))
                # Claude Code's Edit makes a new file from an empty old_string.
                written, failed = await self.put(path, new.encode("utf-8"), "absent")
                return _guest_failure(failed) if failed else PluginResult(True, text=f"File created successfully at: {path}")
            if answer["kind"] != "file":
                raise Refused("not_a_file", NOT_A_FILE.get(answer["kind"], NOT_A_FILE["other"]))
            if answer["size"] > MAX_EDIT_BYTES:
                raise Refused("too_large", TOO_LARGE.format(size=answer["size"]))
            self.current(path, answer)
            data = base64.b64decode(answer["data"], validate=True)
            if hashlib.sha256(data).hexdigest() != answer["sha256"]:
                raise Refused("changed_since_read", CHANGED)  # It changed while it was read.
            text = decoded(data)
            if text is None:
                raise Refused("not_text", NOT_TEXT)
            text, form = text
            if not old:
                if text:
                    raise Refused("file_exists", EXISTS)
                changed, count, start, inserted = new, 1, 0, new
            else:
                changed, count, start, inserted = replaced(text, old, new, replace_all)
            written, failed = await self.put(path, encoded(changed, form), answer["sha256"])
        except Refused as error:
            return _refusal(error)
        if failed:
            return _guest_failure(failed)
        first = changed.count("\n", 0, start) + 1
        last = first + inserted.count("\n")
        what = f"{count} occurrences were replaced" if count > 1 else "Here is the edited part"
        return PluginResult(True, text=f"The file {path} has been updated. {what}; `cat -n` of the lines around the first "
                                       f"edit:\n{numbered(changed, first - 4, last + 4)}")


async def call(vm, target, name, arguments, reads, run, checkpoint):
    files = Files(vm, target, reads, run, checkpoint)
    if name == "write_file":
        return await files.write_file(arguments)
    if name == "edit_file":
        return await files.edit_file(arguments)
    raise VmError("tool_changed")

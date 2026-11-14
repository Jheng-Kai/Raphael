"""A member's file tools on its own computer, as Claude Code's Read, Edit, Write, Glob and Grep.

Owner, 2026-11-14: 「所有的 harness 都要統一 就是跟 claude 設計的一樣 或是參考 hermes agent」. A member changed its files
through `vm_exec` (`sed`, heredocs): nothing checked that the text it replaced was the text it had read, and a whole
file had to fit a 16,000-character command. These tools copy Claude Code's semantics and its words: an exact string
replaced, unique unless `replace_all`; a file read in this run before it is changed and refused when it changed since
(on a shared computer another member may have edited it; Hermes Agent's read-before-write guard is the same idea);
a whole file sent over stdin. Each takes the turn's file checkpoint first, so the card of changed files and its undo
see the change as they see a command's. Files are found and searched with ripgrep, which is in the computer image, with
Claude Code's options and output modes; a search that finds nothing is an answer, not a failure.
"""

import base64
import hashlib
import posixpath
import re
from contextvars import ContextVar
from collections import OrderedDict

from ..agent.plugins import PluginResult
from ..services.attachments import Attachment, sniff_ok
from ..services.file_reader import decoded as decoded_text
from ..services.lines import read_lines
from .vm import GUEST, VmError, exec_args

# How the model of the call that reads an image takes it: (whether it reads images itself, what describes them when it
# does not: the owner's vision service). Unset, a picture goes to the model as a computer's screenshot does.
SEE = ContextVar("computer_file_images", default=None)

# The largest file edit_file changes in place: its text travels to the core and back.
MAX_EDIT_BYTES = 10 * 1024 * 1024
# A failure's words reach the model whole up to about this many characters; a long old_string is shown in part.
QUOTE_CHARS = 400
# How many runs (turns and tasks) keep what they read: a run that ended long ago has nothing to edit.
KEPT_RUNS = 64
# What read_file takes from the computer in one read: the text from the line asked for on (the rest of the file is
# only counted), or a whole picture or PDF. A picture is held to what every model's API takes.
READ_BYTES = 2 * 1024 * 1024
IMAGE_BYTES = 5 * 1024 * 1024
PDF_BYTES = 20 * 1024 * 1024
PDF_PAGES = 20
IMAGES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"}
# Glob's and Grep's bounds, as Claude Code's: 100 files a glob, 250 entries a search page unless head_limit says.
GLOB_LIMIT = 100
HEAD_LIMIT = 250
# The most of ripgrep's answer read from the computer: a page is cut from it, the rest only counted.
SEARCH_CHARS = 2_000_000
SEARCH_SECONDS = 55
# Folders a search skips: the browser's profile, the core's checkpoints and job logs (size and noise, R-COMP-DISK-01),
# and git's own. Given after the member's glob, so they win (ripgrep lets the later glob decide).
SKIPPED = (".git", ".browser-profiles", ".raphael-checkpoints", ".raphael-jobs")

READ_FILE = {
    "description": "Read a file in your computer, as Claude Code's Read: path absolute or relative to /home/cua/workspace. "
                   "Text comes as numbered lines (cat -n: the number and a tab are not part of the line), 2000 from offset "
                   "(a line, from 1) unless limit says fewer; a line over 2000 characters is cut, and when there is more "
                   "the result says the offset to go on from. A picture comes back as an image; a PDF as the text of its "
                   "pages (pages, e.g. \"1-5\", at most 20 a call). Read a file before you edit_file or write_file it.",
    "parameters": {"type": "object", "properties": {
        "path": {"type": "string", "minLength": 1, "maxLength": 4096},
        "offset": {"type": "integer", "minimum": 1},
        "limit": {"type": "integer", "minimum": 1},
        "pages": {"type": "string", "pattern": "^[0-9]{1,5}(-[0-9]{1,5})?$"}},
        "required": ["path"], "additionalProperties": False}}
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

GLOB = {
    "description": "Find files in your computer by name, as Claude Code's Glob: pattern is a glob such as **/*.py or "
                   "src/**/*.{ts,tsx} (gitignore style: one without / matches at any depth), under path (a folder; the "
                   "workspace by default). Newest first, 100 at most. Lists hidden files; skips .gitignore'd ones, .git "
                   "and the computer's own .browser-profiles and .raphael-* folders.",
    "parameters": {"type": "object", "properties": {
        "pattern": {"type": "string", "minLength": 1, "maxLength": 1000},
        "path": {"type": "string", "minLength": 1, "maxLength": 4096}},
        "required": ["pattern"], "additionalProperties": False}}
_COUNT = {"type": "integer", "minimum": 0, "maximum": 1000}
GREP = {
    "description": "Search file contents in your computer with ripgrep, as Claude Code's Grep: pattern is a regular "
                   "expression (ripgrep syntax), path a file or folder (the workspace by default); glob (e.g. *.{ts,tsx}) "
                   "or type (e.g. py) picks files; ignore_case; multiline lets . match newlines. output_mode: "
                   "files_with_matches (default: paths, newest first), content (matching lines; line_numbers, on by "
                   "default; after, before or context lines around them) or count. head_limit (default 250, 0 for all) and "
                   "offset page the results. Skips what glob skips. Use it rather than grep or rg in vm_exec.",
    "parameters": {"type": "object", "properties": {
        "pattern": {"type": "string", "minLength": 1, "maxLength": 4000},
        "path": {"type": "string", "minLength": 1, "maxLength": 4096},
        "glob": {"type": "string", "minLength": 1, "maxLength": 1000},
        "type": {"type": "string", "pattern": "^[A-Za-z0-9_+-]{1,40}$"},
        "output_mode": {"type": "string", "enum": ["files_with_matches", "content", "count"]},
        # Claude Code's Grep names these -i, -n, -A, -B and -C. A name that starts with a dash is not one every model
        # provider takes in a tool's schema, and this list goes with every request of a member with a computer.
        "ignore_case": {"type": "boolean"}, "line_numbers": {"type": "boolean"},
        "after": _COUNT, "before": _COUNT, "context": _COUNT,
        "multiline": {"type": "boolean"},
        "head_limit": {"type": "integer", "minimum": 0}, "offset": {"type": "integer", "minimum": 0}},
        "required": ["pattern"], "additionalProperties": False}}

DEFINITIONS = {"read_file": READ_FILE, "write_file": WRITE_FILE, "edit_file": EDIT_FILE, "glob": GLOB, "grep": GREP}
FILE_READS = frozenset({"read_file", "glob", "grep"})
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
BINARY = ("This file is not text, a picture or a PDF ({size:,} bytes), so read_file cannot show it. Use vm_exec with a "
          "program that understands its format.")
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

    async def look(self, path, limit=0, line=1):
        return await self.vm.file_request(self.target, {"action": "read", "path": path, "limit": limit, "line": line},
                                          answer_bytes=limit)

    def _missing(self, answer):
        near = answer.get("near") or []
        return PluginResult(False, "file_missing", MISSING + (f" Names near it: {', '.join(near)}." if near else ""))

    async def read_file(self, arguments):
        """Claude Code's Read on a file of the computer. A read of a file, whole or a part, is what lets this run change
        it (`edit_file`, `write_file`): what it saw is the file's sha256."""
        path = guest_path(arguments["path"])
        extension = posixpath.splitext(path)[1].lower()
        whole = IMAGE_BYTES if extension in IMAGES else PDF_BYTES if extension == ".pdf" else 0
        offset = arguments.get("offset", 1)
        answer = await self.look(path, whole or READ_BYTES, 1 if whole else offset)
        if "error" in answer:
            return _guest_failure(answer)
        if not answer["exists"]:
            return self._missing(answer)
        if answer["kind"] == "directory":
            names = answer.get("names") or []
            return PluginResult(False, "not_a_file", "This path is a folder, not a file. Use glob to list it" +
                                (f"; its first names: {', '.join(names)}." if names else "."))
        if answer["kind"] != "file":
            return PluginResult(False, "not_a_file", NOT_A_FILE.get(answer["kind"], NOT_A_FILE["other"]))
        data = base64.b64decode(answer["data"], validate=True)
        mime = IMAGES.get(extension)
        if mime is None and answer.get("start_line", 1) == 1:
            mime = next((kind for kind in dict.fromkeys(IMAGES.values()) if sniff_ok(kind, data)), None)
            if (mime or data.startswith(b"%PDF-")) and answer.get("cut"):
                # A picture or a PDF with a name that did not say so: it is read whole, not from a line on.
                answer = await self.look(path, IMAGE_BYTES if mime else PDF_BYTES)
                if "error" in answer or answer.get("kind") != "file":
                    return PluginResult(False, "file_unavailable", "The file changed while it was read. Read it again.")
                data = base64.b64decode(answer["data"], validate=True)
        if mime and sniff_ok(mime, data):
            result = await self._picture(path, mime, data, answer)
        elif extension == ".pdf" or data.startswith(b"%PDF-"):
            result = await self._pdf(path, data, answer, arguments.get("pages"))
        else:
            result = self._text(data, answer, offset, arguments.get("limit"))
        if result.ok:
            self.reads.saw(self.run, path, answer["sha256"])
        return result

    def _text(self, data, answer, offset, limit):
        cut = answer.get("cut", False)
        if cut and b"\n" in data:
            data = data[:data.rindex(b"\n") + 1]  # the last line whole, or not at all
        found = decoded_text(data, partial=cut)
        if found is None:
            return PluginResult(False, "not_text", BINARY.format(size=answer["size"]))
        lines = read_lines(found[0], offset=offset, limit=limit, first=answer.get("start_line") or offset,
                           total=answer.get("total_lines"), partial=cut)
        body = lines["text"]
        if lines.get("note"):
            body = (body + "\n" if body else "") + lines["note"]
        return PluginResult(True, text=body)

    async def _picture(self, path, mime, data, answer):
        if answer["size"] > IMAGE_BYTES:
            return PluginResult(False, "too_large", f"This picture is {answer['size']:,} bytes; read_file shows pictures of "
                                                    "at most 5 MiB. Make a smaller copy with vm_exec and read that.")
        words = f"Picture {path} ({mime}, {answer['size']:,} bytes)."
        see = SEE.get()
        if see is not None and not see[0]():
            # A model that does not read images is told what the owner's vision service sees in it.
            ok, text, kind = await see[1]([Attachment(posixpath.basename(path), mime, data)])
            if not ok:
                return PluginResult(False, kind or "vision_unavailable",
                                    words + " Your model does not read pictures, and the picture reader could not read it.")
            return PluginResult(True, text=f"{words} What the picture reader sees in it:\n{text}")
        return PluginResult(True, text=words + " It is attached as an image.",
                            blocks=[{"type": "image", "data": base64.b64encode(data).decode(), "mimeType": mime}])

    async def _pdf(self, path, data, answer, pages):
        import asyncio
        from ..services.common import ServiceError
        from ..services.pdf import page_texts
        if answer["size"] > PDF_BYTES:
            return PluginResult(False, "too_large", f"This PDF is {answer['size']:,} bytes; read_file reads PDFs of at most "
                                                    "20 MiB. Use vm_exec (pdftotext, python3) for a larger one.")
        try:
            count, texts, unread = await asyncio.to_thread(page_texts, data)
        except ServiceError as error:
            words = {"encrypted": "This PDF is locked with a password."}.get(error.kind, "This PDF could not be read.")
            return PluginResult(False, "bad_pdf" if error.kind != "encrypted" else "encrypted", words)
        first, _, last = (pages or "1").partition("-")
        first = max(1, int(first))
        last = int(last) if last else (first if pages else max(1, min(count, PDF_PAGES)))
        if last < first or last - first + 1 > PDF_PAGES:
            return PluginResult(False, "bad_arguments", f"Give pages as a range of at most {PDF_PAGES}, such as \"1-20\".")
        chosen = [(number, text) for number, text in texts if first <= number <= last]
        parts = [f"[Page {number}]\n{text}" for number, text in chosen]
        missing = [number for number in unread if first <= number <= last]
        if missing:
            parts.append(f"[Pages with no text layer (scans) in this range: {', '.join(map(str, missing))}.]")
        if not parts:
            parts.append(f"[The PDF has {count} pages; there is no page {first}.]" if first > count else "[No text in these pages.]")
        if last < count:
            parts.append(f"[Pages {first}-{last} of {count} are shown. Read on with read_file (pages \"{last + 1}-"
                         f"{min(count, last + PDF_PAGES)}\").]")
        return PluginResult(True, text=f"PDF {path}, {count} pages.\n" + "\n\n".join(parts))

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
                    return self._missing(answer)
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


# --- glob and grep, on ripgrep --------------------------------------------------------------------------------------

# In the folder searched (or a file's own folder, with the file named alone), the folder said first, then ripgrep with
# its paths relative to it: a glob such as src/**/*.ts is matched from there, as Claude Code's are. 3 is a path that
# does not exist; ripgrep's own 1 is "nothing found" and 2 an error.
SEARCH = ('if [ -d "$1" ]; then cd "$1" || exit 3; shift; set -- "$@" .; '
          'elif [ -e "$1" ]; then cd "$(dirname "$1")" || exit 3; base=$(basename "$1"); shift; set -- "$@" -- "$base"; '
          'else exit 3; fi; printf "%s\\n" "$PWD"; '
          f'exec timeout --signal=TERM --kill-after=1 {SEARCH_SECONDS} rg "$@"')
_NUMBERED = re.compile(r"(\d+)([:-])")


def _skipping(chosen=None):
    globs = ["--glob", chosen] if chosen else []
    for name in SKIPPED:
        globs += ["--glob", "!" + name]
    return globs


def grep_flags(arguments):
    """Claude Code's Grep options as ripgrep's flags."""
    mode = arguments.get("output_mode", "files_with_matches")
    flags = ["--hidden", "--null", "--no-messages", "--color=never"]
    if arguments.get("ignore_case"):
        flags.append("--ignore-case")
    if arguments.get("multiline"):
        flags += ["--multiline", "--multiline-dotall"]
    if arguments.get("type"):
        flags += ["--type", arguments["type"]]
    if mode == "files_with_matches":
        flags += ["--files-with-matches", "--sortr=modified"]
    elif mode == "count":
        flags += ["--count-matches", "--with-filename", "--sort=path"]
    else:
        flags += ["--with-filename", "--no-heading", "--sort=path", "--max-columns=2000", "--max-columns-preview",
                  "--line-number" if arguments.get("line_numbers", True) else "--no-line-number"]
        for key, flag in (("after", "--after-context"), ("before", "--before-context")):
            if arguments.get(key) is not None:
                flags += [flag, str(arguments[key])]
        context = arguments.get("context")
        if context is not None:
            flags += ["--context", str(context)]
    return mode, [*flags, *_skipping(arguments.get("glob")), "--regexp", arguments["pattern"]]


def _absolute(base, relative):
    return posixpath.normpath(posixpath.join(base, relative))


def _paged(entries, offset, limit, cut):
    """A page of `entries` and the note that says where the next page starts, when there is one."""
    page = entries[offset:offset + limit] if limit else entries[offset:]
    end = offset + len(page)
    if end < len(entries) or cut and page:
        total = f"{len(entries):,}{'+' if cut else ''}"
        return page, f"[Showing results {offset + 1}-{end} of {total}. Call again with offset {end} for the next ones.]"
    return page, ""


class Search:
    """One ripgrep run in the computer: the folder it ran from and what it printed, the last piece dropped if cut."""

    def __init__(self, base, out, cut):
        self.base, self.out, self.cut = base, out, cut

    def items(self, separator):
        rows = self.out.split(separator)
        if rows and (self.cut or rows[-1] == ""):
            rows.pop()  # The empty end after the last separator, or a piece cut off in the middle.
        return [row for row in rows if row]


async def search(vm, target, path, flags):
    folder = guest_path(path or GUEST)
    result = await vm.run_for(target, exec_args(target, ["sh", "-c", SEARCH, "sh", folder, *flags]),
                              timeout=SEARCH_SECONDS + 5, limit=SEARCH_CHARS)
    if result.code == 3:
        raise Refused("path_missing", f"Path does not exist: {folder}")
    if result.code == 124:
        raise Refused("search_timeout", f"The search took longer than {SEARCH_SECONDS} seconds. Narrow path, glob or type.")
    base, _, out = result.stdout.partition("\n")
    if result.code not in (0, 1) and not out.strip("\0\n"):
        words = result.stderr.strip()[:QUOTE_CHARS] or f"ripgrep ended with code {result.code}."
        raise Refused("search_failed", words)
    return Search(base or folder, out if result.code != 1 else "", result.truncated)


async def glob_files(vm, target, arguments):
    try:
        found = await search(vm, target, arguments.get("path"), ["--files", "--hidden", "--null", "--sortr=modified",
                                                                  *_skipping(arguments["pattern"])])
    except Refused as error:
        return _refusal(error)
    files = [_absolute(found.base, row) for row in found.items("\0")]
    if not files:
        return PluginResult(True, text="No files found")
    text = "\n".join(files[:GLOB_LIMIT])
    if len(files) > GLOB_LIMIT or found.cut:
        text += "\n(Results are truncated. Consider using a more specific path or pattern.)"
    return PluginResult(True, text=text)


async def grep_files(vm, target, arguments):
    mode, flags = grep_flags(arguments)
    try:
        found = await search(vm, target, arguments.get("path"), flags)
    except Refused as error:
        return _refusal(error)
    offset, limit = arguments.get("offset", 0), arguments.get("head_limit", HEAD_LIMIT)
    if mode == "files_with_matches":
        files = [_absolute(found.base, row) for row in found.items("\0")]
        if not files:
            return PluginResult(True, text="No files found")
        page, note = _paged(files, offset, limit, found.cut)
        head = f"Found {len(files):,}{'+' if found.cut else ''} file{'s' if len(files) != 1 else ''}"
        return PluginResult(True, text="\n".join([head, *page, *([note] if note else [])]))
    rows = []
    for row in found.items("\n"):
        name, separator, rest = row.partition("\0")
        if not separator:
            if mode == "content":
                rows.append(row)  # ripgrep's "--" between groups of context
            continue
        where = _absolute(found.base, name)
        if mode == "count":
            rows.append((where, int(rest) if rest.isdigit() else 0))
            continue
        numbered = _NUMBERED.match(rest)
        rows.append(f"{where}{numbered.group(2) if numbered else ':'}{rest}")
    if not rows:
        return PluginResult(True, text="No matches found")
    page, note = _paged(rows, offset, limit, found.cut)
    if mode == "count":
        counted = rows
        text = "\n".join(f"{where}:{count}" for where, count in page)
        text += (f"\n\nFound {sum(count for _, count in counted):,} total occurrences across {len(counted):,} "
                 f"file{'s' if len(counted) != 1 else ''}.")
        return PluginResult(True, text=text + (f"\n{note}" if note else ""))
    return PluginResult(True, text="\n".join([*page, *([note] if note else [])]))


async def call(vm, target, name, arguments, reads, run, checkpoint):
    if name == "glob":
        return await glob_files(vm, target, arguments)
    if name == "grep":
        return await grep_files(vm, target, arguments)
    files = Files(vm, target, reads, run, checkpoint)
    if name == "read_file":
        return await files.read_file(arguments)
    if name == "write_file":
        return await files.write_file(arguments)
    if name == "edit_file":
        return await files.edit_file(arguments)
    raise VmError("tool_changed")

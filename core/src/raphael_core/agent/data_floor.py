"""Deterministic protection for app-owned paths at the untrusted tool boundary."""

import ntpath
import os
import re
import sys
from collections.abc import Mapping
from pathlib import Path
from urllib.parse import unquote, urlparse


# What a run is told to use in place of a command: the floor keeps commands and file tools off Raphael's own folders, and
# the tools meant for what a run needs there read it (owner, 2026-11-11: a routine could not read its page template or the log).
READ_INSTEAD = (" To read a skill's own files (a page template, data) use skill_read with its name and reference; "
                "to see the app's state, its log and recent failures use self_check.")
# What the model is told. The owner reads other words (`persona.PHRASES.protected_data`), never this sentence.
WRITE_REFUSAL = (
    "Commands, scripts and file tools cannot write Raphael's own data, database, credentials or core files. "
    "To change a skill use skill_manage; to change members, connections or settings use the member, connection or "
    "settings management tools instead (the owner approves their card). Do not try another command or path."
    + READ_INSTEAD
)
READ_CONSENT = ("Reading Raphael's own data requires the owner's consent for this call. Use management tools when possible."
                + READ_INSTEAD)
_ENV = re.compile(r"%([^%]+)%|\$\{(?:env:)?([\w]+)\}|\$(?:env:)?([\w]+)", re.I)
_DATABASE = re.compile(r"(?:^|[\\/\s'\"])raphael\.db(?:-(?:wal|shm))?(?=$|[\s'\";,)?])", re.I)
_PATH = re.compile(r"(?:[a-z]:[\\/]|\\\\|/mnt/[a-z]/)[^\s'\";,|<>]*", re.I)
_QUOTED = re.compile(r'"([^"\n]+)"|\x27([^\x27\n]+)\x27')
_READ_COMMANDS = frozenset({
    "get-content", "get-item", "get-childitem", "test-path", "resolve-path", "select-string",
    "cat", "type", "head", "tail", "ls", "dir", "pwd", "get-location", "select-object",
    "where-object", "sort-object", "format-list", "format-table", "out-string", "convertfrom-json",
})
# A command that changes something, or runs a program that could, as it is told apart when it names an attachment: the
# braces and parentheses of `if (Test-Path ...) { Get-Content ... }` are no sign of it (`LastWriteTime` is none either).
_CHANGES = re.compile(
    r"[>`]|::\s*(?:write|append|delete|move|copy|create|replace|open)|(?<![\w-])(?:-out(?:file)?|tee(?:-object)?|out-file|"
    r"(?:set|add|clear|remove|rename|move|copy|new)-(?:content|item|itemproperty)|invoke-(?:expression|webrequest|restmethod|command)|"
    r"iex|start-process|saps|rm|del|erase|rd|rmdir|mv|ren|cp|copy|move|ni|sc|ac|xcopy|robocopy|attrib|icacls|takeown|"
    r"python3?|py|node|powershell|pwsh|cmd|bash|sh|perl|ruby|php|java|dotnet|curl|wget|git|7z|tar|zip|certutil)(?![\w-])", re.I)
_ATTACHMENT_ID = re.compile(r"[a-f0-9]{32}\.[a-z0-9]{1,12}")
_WRITE = re.compile(r"write|append|delete|remove|rename|move|copy|create|save|upload|edit|patch|set[-_]?content|add[-_]?content|new[-_]?item|truncate", re.I)
_READ_TOOL = re.compile(r"read|list|stat|search|find|inspect|view|^(?:get|cat|head|tail)(?:[_-]|[A-Z])", re.I)


class DataFloor:
    def __init__(self, conn=None, *, environ=None, core_root=None):
        self.conn = conn
        self.environ = os.environ if environ is None else environ
        package = Path(__file__).resolve().parents[1]
        self.core_root = core_root or (package.parent.parent if package.parent.name == "src" else package)

    def expand(self, value):
        env = {key.casefold(): value for key, value in self.environ.items()}
        text = unquote(str(value)).strip()
        if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
            text = text[1:-1]
        for _ in range(4):
            expanded = _ENV.sub(lambda match: env.get(next(group for group in match.groups() if group).casefold(), match[0]), text)
            if expanded == text:
                break
            text = expanded
        home = env.get("userprofile") or env.get("home") or str(Path.home())
        text = re.sub(r"(?<![\w])~(?=[\\/]|$)", lambda _: home, text)
        text = re.sub(r"/mnt/([a-z])/", lambda match: match[1] + ":/", text, flags=re.I)
        return text

    def resolved(self, value, cwd=None):
        text = self.expand(value)
        if text.lower().startswith("file:"):
            parsed = urlparse(text)
            text = ("//" + parsed.netloc if parsed.netloc else "") + parsed.path
            if re.match(r"^/[a-z]:", text, re.I):
                text = text[1:]
        if not ntpath.isabs(text):
            text = ntpath.join(self.expand(cwd or "~"), text)
        try:
            text = os.path.realpath(text)
        except (OSError, ValueError, RuntimeError):
            pass
        return ntpath.normpath(text).casefold().rstrip("\\/")

    def _roots(self):
        env = {key.casefold(): value for key, value in self.environ.items()}
        roots = [self.core_root, ntpath.join(env.get("userprofile") or env.get("home") or str(Path.home()), ".raphael")]
        home = env.get('userprofile') or env.get('home') or str(Path.home())
        # Native CLI environments may omit APPDATA; both Windows app names still belong to Raphael.
        roots.extend(ntpath.join(home, 'AppData', 'Roaming', name) for name in ('Raphael', 'Raphael Dev'))
        roots.extend(env[key] for key in ("raphael_data_dir", "raphael_home") if env.get(key))
        if getattr(sys, "frozen", False):
            roots.extend([Path(sys.executable).parent, getattr(sys, "_MEIPASS", Path(sys.executable).parent)])
        return roots

    def attachment(self, value, cwd=None):
        """Whether `value` is one of the files the owner attached in a conversation: a stored copy directly in the
        `attachments` folder of Raphael's data folder, named by its opaque id. The sidecar, the other files of the
        folder and the folder itself are not (`services.attachment_store`)."""
        path = self.resolved(value, cwd)
        parent, name = ntpath.split(path)
        if not _ATTACHMENT_ID.fullmatch(name) or ntpath.basename(parent) != "attachments":
            return False
        root = ntpath.dirname(parent)
        return any(root == self.resolved(candidate) for candidate in self._roots())

    def protected(self, value, cwd=None):
        path = self.resolved(value, cwd)
        env = {key.casefold(): value for key, value in self.environ.items()}
        roots = self._roots()
        for root in roots:
            normalized = self.resolved(root)
            if path == normalized or path.startswith(normalized + "\\"):
                return True
        for key in ("appdata", "localappdata"):
            if not env.get(key):
                continue
            parent = self.resolved(env[key]) + "\\"
            if path.startswith(parent) and path[len(parent):].split("\\", 1)[0].startswith("raphael"):
                return True
        if self.conn is not None:
            for row in self.conn.execute("PRAGMA database_list"):
                if row[2]:
                    database = self.resolved(row[2])
                    parent = ntpath.dirname(database)
                    if (path in {self.resolved(row[2] + suffix) for suffix in ("", "-wal", "-shm")}
                            or ntpath.basename(database) == 'raphael.db' and (path == parent or path.startswith(parent + '\\'))):
                        return True
        return bool(_DATABASE.search(path))

    def _paths(self, text):
        expanded = self.expand(text)
        yield expanded
        for quoted in _QUOTED.finditer(expanded):
            yield next(group for group in quoted.groups() if group is not None)
        yield from (match[0] for match in _PATH.finditer(expanded))

    @staticmethod
    def _read_command(command):
        # Unknown programs and scripts with protected paths are treated as potentially writing.
        if re.search(r"[>`&(){}]|\b(?:-out(?:file)?|tee(?:-object)?)\b", command, re.I):
            return False
        pieces = [part.strip() for part in re.split(r"[;|\r\n]|&&|\|\|", command) if part.strip()]
        return bool(pieces) and all(
            re.split(r"\s+", piece.lstrip("& "), maxsplit=1)[0].strip("\"'").casefold() in _READ_COMMANDS
            for piece in pieces
        )

    def access(self, tool, arguments):
        """Return read, write, or None. Only explicit read operations can request consent."""
        if not isinstance(arguments, Mapping):
            return None
        if tool == "cli_permission":
            details = arguments.get("details")
            arguments = details if isinstance(details, Mapping) else arguments
            call = arguments.get("toolCall")
            call = call if isinstance(call, Mapping) else {}
            native = arguments.get("tool_input") or arguments.get("input") or call.get("rawInput") or arguments
            if not isinstance(native, Mapping):
                native = {"command": native}
            native = dict(native)
            command = native.get("command")
            if isinstance(command, list):
                # Native adapters use argv; shell wrappers carry the actual command last.
                native["command"] = (command[-1] if any(str(arg).lower() in {"-command", "-c", "/c"} for arg in command)
                                     else " ".join(map(str, command)))
            name = arguments.get("tool_name") or call.get("kind") or arguments.get("method") or "native_file_action"
            return self.access(name, native)
        command = next((arguments[key] for key in ("command", "script", "code", "cmd") if isinstance(arguments.get(key), str)), None)
        name = tool.rsplit("/", 1)[-1]
        file_tool = bool(command is not None or re.search(r"file|directory|folder|path|terminal|shell|exec|command|patch", name, re.I)
                         or set(arguments) & {"path", "file", "file_path", "filename", "directory", "cwd"})
        if not file_tool:
            return None
        cwd = arguments.get("cwd") or arguments.get("working_directory")
        def strings(value):
            if isinstance(value, str):
                yield value
            elif isinstance(value, Mapping):
                for key, item in value.items():
                    if isinstance(key, str) and ntpath.isabs(key):
                        yield key
                    if command is not None or key not in {"content", "text", "description"}:
                        yield from strings(item)
            elif isinstance(value, (tuple, list)):
                for item in value:
                    yield from strings(item)
        values = list(strings(arguments))
        hits = [candidate for value in values for candidate in self._paths(value) if self.protected(candidate, cwd)]
        if not hits:
            return None
        # The files the owner attached in a conversation are the owner's own, read by the member the owner gave them to
        # (owner, 2026-11-14: 「機密資訊鎖得太死了」); credentials and every other file of Raphael's folders stay closed.
        # (An unquoted match stops at the space of a folder name such as "Raphael Dev": it is that path's own front.)
        named = [self.expand(candidate) for candidate in hits if self.attachment(candidate, cwd)]
        attached = all(self.attachment(candidate, cwd) or any(path.startswith(self.expand(candidate) + " ") for path in named)
                       for candidate in hits)
        if command is not None:
            if self._read_command(self.expand(command)):
                return None if attached else "read"
            return None if attached and not _CHANGES.search(self.expand(command)) else "write"
        operation = str(arguments.get("operation", arguments.get("mode", "")))
        if _WRITE.search(name + " " + operation) or operation.casefold() in {"w", "a", "r+", "w+", "a+"}:
            return "write"
        if _READ_TOOL.search(name) or operation.casefold() in {"read", "r", "list", "stat"}:
            return None if attached else "read"
        return "write"

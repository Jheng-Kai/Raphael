"""The files a shell command writes by name (R-FILE-06), so that one aimed outside the member's work folder asks first.

This is a reading of the command's words, not a sandbox: a shell can write anywhere its account can, and no reading of a
command proves what a program it starts will do. It finds only what the command says outright: a redirection (`>`, `>>`,
`2>`, `*>`), the destination of the commands that write, move, copy, delete or make files and folders (Out-File,
Set-Content, Add-Content, New-Item, Copy-Item, Move-Item, Remove-Item, Rename-Item, mkdir, cp, mv, rm, del, ren, touch,
tee, chmod ...), a download's output file, an archive's destination, `git clone`'s folder, and `cd` before them. Each
target is judged where it really is (`work_area`): relative to the folder the command runs in, `..` and links followed. A
target it cannot read (a variable, a subexpression, `%VAR%`) counts as outside, so the owner is asked; a script or program
that does the writing (python x.py, npm install, a .ps1) names no target and passes.
"""

import os
import re

from ..work_area import PROJECT, PathRefused, inside, resolved

DEST, ALL, COPY = "dest", "all", "copy"
# What each command does to the paths it is given: DEST changes the one it names (-Path, -FilePath, -LiteralPath or its
# first argument), ALL changes every path it is given, COPY writes its destination (-Destination or its last argument).
WRITERS = {
    **dict.fromkeys(("out-file", "set-content", "add-content", "clear-content", "tee-object", "new-item", "export-csv",
                     "export-clixml", "sc", "ac", "clc", "ni", "start-transcript"), DEST),
    **dict.fromkeys(("tee", "touch", "mkdir", "md", "remove-item", "ri", "rm", "del", "erase", "rd", "rmdir", "rename-item",
                     "rni", "ren", "rename", "move-item", "mi", "mv", "move", "chmod", "chown", "chgrp", "truncate",
                     "icacls", "attrib", "takeown", "unlink", "shred"), ALL),
    **dict.fromkeys(("copy-item", "cpi", "cp", "copy", "xcopy", "robocopy", "install", "ln", "rsync"), COPY),
}
# Parameters whose value is a path that is written, wherever the command takes them.
PATH_PARAMS = {"path", "filepath", "literalpath", "destination", "outfile", "destinationpath", "lp", "pspath", "o",
               "output", "outputfile"}
# Parameters whose value is not a path, so that it is not taken for one.
VALUE_PARAMS = {"value", "encoding", "filter", "include", "exclude", "itemtype", "stream", "inputobject", "width",
                "delimiter", "credential", "type", "name", "headers", "uri", "body", "method", "contenttype", "useragent",
                "timeoutsec"}
SHELLS = {"powershell", "pwsh", "cmd", "bash", "sh", "zsh", "wsl", "ksh", "dash"}
SHELL_FLAGS = {"-c", "-command", "/c", "/k", "-lc", "-ic"}
CHANGE_DIRECTORY = {"cd", "chdir", "set-location", "sl", "pushd", "push-location"}
# cmd.exe's and robocopy's switches, which are not paths although they start with a slash.
SLASH_SWITCHES = {"/mir", "/purge", "/move", "/mov", "/xo", "/np", "/ndl", "/njh", "/njs", "/nfl", "/is", "/it", "/copy",
                  "/dcopy", "/mt", "/e", "/s", "/z", "/b", "/r", "/w", "/l"}
PREFIXES = {"sudo", "nohup", "time", "exec", "command", "call", "env", "start", "nice", "builtin"}
NOTHING = {"nul", "$null", "/dev/null", "null"}
DEPTH = 3


class Token:
    __slots__ = ("text", "dynamic", "redirect")

    def __init__(self, text, dynamic=False, redirect=False):
        self.text, self.dynamic, self.redirect = text, dynamic, redirect


def split(text, windows):
    """The command's segments (split at `;`, `|`, `&`, `&&`, `||`, line ends and braces), each a list of Tokens: words
    with their quotes taken off, and redirections as tokens of their own whose target is the next word. A word that holds
    a variable or a subexpression is `dynamic`."""
    segments, tokens, word = [], [], []
    state = {"dynamic": False, "quoted": False}

    def finish_word():
        if word or state["quoted"]:
            tokens.append(Token("".join(word), state["dynamic"]))
        word.clear()
        state.update(dynamic=False, quoted=False)

    def finish_segment():
        finish_word()
        if tokens:
            segments.append(tokens[:])
        tokens.clear()

    index, size = 0, len(text)
    while index < size:
        char = text[index]
        if char in "'\"":
            end, body = index + 1, []
            while end < size:
                piece = text[end]
                if piece == char:
                    if windows and end + 1 < size and text[end + 1] == char:  # '' and "" are one quote in PowerShell
                        body.append(char)
                        end += 2
                        continue
                    break
                if piece == ("`" if windows else "\\") and char == '"' and end + 1 < size:
                    body.append(text[end + 1])
                    end += 2
                    continue
                body.append(piece)
                end += 1
            inner = "".join(body)
            state["quoted"] = True
            state["dynamic"] = state["dynamic"] or (char == '"' and ("$" in inner or "`" in inner and not windows))
            word.append(inner)
            index = end + 1
            continue
        if char == ("`" if windows else "\\") and index + 1 < size:
            word.append(text[index + 1])
            index += 2
            continue
        if char == "#" and not word:
            while index < size and text[index] != "\n":
                index += 1
            continue
        if char == ">":
            fd = "".join(word)
            if re.fullmatch(r"\d*|\*|&", fd) and not state["quoted"]:
                word.clear()
            else:
                finish_word()
            index += 1
            if index < size and text[index] == ">":
                index += 1
            if index < size and text[index] == "|":
                index += 1
            if index < size and text[index] == "&" and index + 1 < size and (text[index + 1].isdigit() or text[index + 1] == "-"):
                index += 2  # 2>&1: a stream joined to another, no file
                continue
            tokens.append(Token(">", redirect=True))
            continue
        if char.isspace() and char != "\n":
            finish_word()
        elif char in "\n;|&{}":
            finish_segment()
        elif char in "()":
            if char == "(" and word and word[-1] in ("$", "@"):
                word.append(char)
                state["dynamic"] = True
            else:
                finish_word()
        else:
            if char == "$" and not text.startswith("$null", index):
                state["dynamic"] = True
            if char == "%" and windows and text.find("%", index + 1) > index + 1:
                state["dynamic"] = True
            word.append(char)
        index += 1
    finish_segment()
    return segments


def name_of(token):
    base = os.path.basename(token.replace("\\", "/")).lower()
    return base[:-4] if base.endswith(".exe") else base


def _options(arguments):
    """(the positional arguments, {parameter: value}) of a command's tokens, a parameter being a word that starts with `-`
    (or `/` for cmd's copy) and is not a number. A parameter takes the next word when it is one that names a path or a value."""
    positional, named, index = [], {}, 0
    while index < len(arguments):
        token = arguments[index]
        text = token.text
        if (text[:1] == "/" and not token.dynamic and (re.fullmatch(r"/[A-Za-z]", text) or text.lower().partition(":")[0] in SLASH_SWITCHES)):
            named.setdefault(text[1:].lower(), [])
        elif len(text) > 1 and text[0] == "-" and not text[1:].isdigit() and not token.redirect:
            key, colon, value = text.lstrip("-").lower().partition(":")
            if colon and value:
                named.setdefault(key, []).append(Token(value, token.dynamic))
            elif key in PATH_PARAMS or key in VALUE_PARAMS:
                if index + 1 < len(arguments) and not arguments[index + 1].redirect:
                    named.setdefault(key, []).append(arguments[index + 1])
                    index += 1
            else:
                named.setdefault(key, [])
        else:
            positional.append(token)
        index += 1
    return positional, named


def writes(command, cwd, roots, *, windows=None, home=None, depth=0):
    """The targets of `command` that are outside `roots`, as the words that named them ("<variable>" for one that cannot be
    read). `cwd` is the folder the command starts in (None: unknown, so a relative target is outside)."""
    return classify(command, cwd, lambda path: "inside" if inside(path, roots) else "outside",
                    windows=windows, home=home, depth=depth)[1]


def classify(command, cwd, reach, *, windows=None, home=None, depth=0):
    """(the targets of `command` in a project that is not the member's, the other targets outside its work folder), as the
    words that named them ("<variable>" for one that cannot be read). `reach` says where a resolved path is: "inside" the
    work folder, in a "project" that is not the member's, or "outside" (`work_area.reach`). `cwd` is the folder the command
    starts in (None: unknown, so a relative target is outside)."""
    windows = os.name == "nt" if windows is None else windows
    home = home or os.path.expanduser("~")
    outside, projects = [], []
    here = cwd

    def judge(token, folder):
        text = token.text
        if text.lower() in NOTHING:
            return
        if token.dynamic:
            outside.append(text or "<variable>")
            return
        if text in ("", "."):
            text = "."
        if text.startswith("~") and text not in ("~",) and not text.startswith(("~/", "~\\")):
            outside.append(text)  # another account's home: not read
            return
        prefix = 4 if text[:4] in ("\\\\?\\", "\\\\.\\") else 0  # the long and device prefixes hold a ? that is no pattern
        wild = re.search(r"[*?\[]", text[prefix:])
        if wild:  # a pattern is judged by the folder it names
            text = os.path.dirname(text[:prefix + wild.start()] + "x") or "."
        try:
            relative = not (os.path.isabs(text) or text.startswith(("~", "\\", "/")) or os.path.splitdrive(text)[0])
            if relative and folder is None:
                outside.append(text)
                return
            where = reach(resolved(text, folder, home))
            if where == PROJECT:
                projects.append(text)
            elif where != "inside":
                outside.append(text)
        except PathRefused:
            outside.append(text)

    for segment in split(command, windows):
        redirect = [index for index, token in enumerate(segment) if token.redirect]
        for index in redirect:
            if index + 1 < len(segment):
                judge(segment[index + 1], here)
            else:
                outside.append(">")
        words = [token for index, token in enumerate(segment)
                 if not token.redirect and index - 1 not in redirect]
        while words and (words[0].text.lower() in PREFIXES or re.fullmatch(r"[A-Za-z_]\w*=.*", words[0].text)
                         or words[0].text in ("&", ".")):
            words = words[1:]
        if not words:
            continue
        name = name_of(words[0].text)
        rest = words[1:]
        if name in CHANGE_DIRECTORY:
            positional, named = _options(rest)
            positional = [token for token in positional if token.text.lower() != "/d"]
            target = (named.get("path") or named.get("literalpath") or positional or [None])[0]
            if target is None or target.dynamic or target.text.startswith("-"):
                here = None
            else:
                try:
                    here = resolved(target.text, here, home) if here is not None or os.path.isabs(target.text) else None
                except PathRefused:
                    here = None
            continue
        if name in SHELLS and depth < DEPTH:
            for position, token in enumerate(rest[:-1]):
                if token.text.lower() in SHELL_FLAGS:
                    nested = classify(" ".join(item.text for item in rest[position + 1:]), here, reach,
                                      windows=windows, home=home, depth=depth + 1)
                    projects += nested[0]
                    outside += nested[1]
                    break
            continue
        positional, named = _options(rest)
        kind = WRITERS.get(name)
        found = []
        if kind == DEST:
            found = [*(named.get("filepath") or []), *(named.get("literalpath") or []), *(named.get("path") or [])]
            found = found or positional[:1]
            if name in ("new-item", "ni") and named.get("name"):
                folder = [token for token in found] or [Token(".")]
                found = [Token(os.path.join(folder[0].text, item.text), folder[0].dynamic or item.dynamic) for item in named["name"]]
        elif kind == ALL:
            found = [*positional, *(item for key in PATH_PARAMS for item in named.get(key, []))]
            if name in ("mkdir", "md") and named.get("name"):
                found += named["name"]
        elif kind == COPY:
            found = [*(named.get("destination") or [])] or (positional[-1:] if len(positional) > 1 else [Token(".")])
        elif name in ("invoke-webrequest", "iwr", "invoke-restmethod", "irm"):
            found = named.get("outfile") or []
        elif name in ("curl", "wget"):
            found = [*(named.get("o") or []), *(named.get("output") or [])]
            if name == "curl" and "O" in {token.text.lstrip("-") for token in rest}:
                found.append(Token("."))
        elif name == "expand-archive":
            found = named.get("destinationpath") or positional[1:2]
        elif name == "tar":
            found = [rest[at + 1] for at, token in enumerate(rest[:-1]) if token.text in ("-C", "--directory")]
        elif name == "git" and positional and positional[0].text == "clone":
            found = positional[2:3] or [Token(".")]
        elif name == "git" and positional and positional[0].text == "init":
            found = positional[1:2] or [Token(".")]
        elif name == "dd":
            found = [Token(token.text[3:], token.dynamic) for token in rest if token.text.startswith("of=")]
        elif name == "sed" and "i" in named:
            found = positional[1:]
        for token in found:
            judge(token, here)
    return projects, outside

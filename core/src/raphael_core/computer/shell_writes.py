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

import logging
import os
import re

from ..work_area import PROJECT, PathRefused, inside, resolved

logger = logging.getLogger(__name__)

DEST, ALL, COPY, RENAME = "dest", "all", "copy", "rename"
# What each command does to the paths it is given: DEST changes the one it names (-Path, -FilePath, -LiteralPath or its
# first argument), ALL changes every path it is given, COPY writes its destination (-Destination or its last argument).
WRITERS = {
    **dict.fromkeys(("out-file", "set-content", "add-content", "clear-content", "tee-object", "new-item", "export-csv",
                     "export-clixml", "sc", "ac", "clc", "ni", "start-transcript"), DEST),
    **dict.fromkeys(("tee", "touch", "mkdir", "md", "remove-item", "ri", "rm", "del", "erase", "rd", "rmdir",
                     "move-item", "mi", "mv", "move", "chmod", "chown", "chgrp", "truncate",
                     "icacls", "attrib", "takeown", "unlink", "shred"), ALL),
    # A rename changes the file it names and gives it a new name in the folder that file is in, wherever the command runs.
    **dict.fromkeys(("rename-item", "rni", "ren", "rename"), RENAME),
    **dict.fromkeys(("copy-item", "cpi", "cp", "copy", "xcopy", "robocopy", "install", "ln", "rsync"), COPY),
}
# Parameters whose value is a path that is written, wherever the command takes them.
PATH_PARAMS = {"path", "filepath", "literalpath", "destination", "outfile", "destinationpath", "lp", "pspath", "o",
               "output", "outputfile", "outputdirectory"}
# The parameters that name the file a cmdlet changes, under every name PowerShell gives them: -Path, -LiteralPath and its aliases
# -PSPath and -LP, and -FilePath (Out-File, Tee-Object).
SOURCE_PARAMS = ("filepath", "literalpath", "pspath", "lp", "path")
# Parameters whose value is not a path, so that it is not taken for one.
VALUE_PARAMS = {"newname", "value", "encoding", "filter", "include", "exclude", "itemtype", "stream", "inputobject", "width",
                "delimiter", "credential", "type", "name", "headers", "uri", "body", "method", "contenttype", "useragent",
                "timeoutsec"}
# Parameters that only name what a cmdlet reads: a name cut short to one of them is no target, whatever its value looks like.
READ_PARAMS = {"source", "infile", "container"}
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


def renamed(positional, named):
    """The paths a rename changes: the file it names, anything else it is given, and the new name. A new name that is only a
    name is in the folder of the file (PowerShell and cmd rename it there, whatever folder the command runs in); a name with a
    folder in it, or one that cannot be read, is judged as it is written, from the folder the command runs in."""
    paths = [item for key in SOURCE_PARAMS for item in named.get(key, [])]
    source, rest = (paths[:1], list(positional)) if paths else (positional[:1], list(positional[1:]))
    new, rest = (named["newname"][:1], rest) if named.get("newname") else (rest[:1], rest[1:])
    found = [*source, *rest]
    for token in new:
        text = token.text
        if source and not token.dynamic and "/" not in text and "\\" not in text:
            where = source[0].text
            found.append(Token(where[:max(where.rfind("/"), where.rfind("\\")) + 1] + text, source[0].dynamic))
        else:
            found.append(token)
    return found


def name_of(token):
    base = os.path.basename(token.replace("\\", "/")).lower()
    return base[:-4] if base.endswith(".exe") else base


def _path_like(value):
    """Whether the value of a parameter that nobody knows looks like a path written (a folder, a drive, `~`, `.`), and not an
    address or a plain word."""
    return bool(re.search(r"[\\/]|^[A-Za-z]:|^~|^\.", value)) and not re.match(r"[A-Za-z][A-Za-z0-9+.-]*://", value)


# The cmdlets of PowerShell that write, move, copy, delete or make files, and the aliases that are PowerShell's own (`cp`, `mv`, `rm`,
# `tee` and the like are unix tools too, and keep the reading they always had).
POWERSHELL = {"out-file", "set-content", "add-content", "clear-content", "tee-object", "new-item", "export-csv", "export-clixml",
              "start-transcript", "remove-item", "rename-item", "move-item", "copy-item", "expand-archive", "compress-archive",
              "invoke-webrequest", "invoke-restmethod", "start-bitstransfer", "copy-itemproperty",
              "sc", "ac", "clc", "ni", "ri", "rni", "mi", "cpi", "iwr", "irm", "ren", "del", "erase", "rd", "md"}
WEB = ("invoke-webrequest", "iwr", "invoke-restmethod", "irm")


def written(name):
    """The parameters of a PowerShell cmdlet whose values it changes, from what the reading of its kind takes (the one table):
    a copy, a download, an archive and a transfer write their destination and only read their source; a move, a rename and a
    delete change every path they are given; the cmdlets that put content somewhere write the path they are given."""
    if name in ("expand-archive", "compress-archive"):
        return {"destinationpath"}
    if name in WEB:
        return {"outfile"}
    if name in ("start-bitstransfer", "copy-itemproperty"):
        return {"destination"}
    kind = WRITERS.get(name)
    if kind == COPY:
        return {"destination"}
    if kind in (ALL, RENAME):
        return set(PATH_PARAMS)
    if kind == DEST:
        return {*SOURCE_PARAMS, "outputdirectory"}
    return set()


SED_LONG = ("binary", "debug", "expression", "file", "follow-symlinks", "in-place", "line-length", "null-data", "zero-terminated",
            "quiet", "silent", "regexp-extended", "separate", "sandbox", "unbuffered", "version", "help", "posix")


def sed_words(words, l_takes_argument=True):
    """(whether sed edits in place, whether its script comes from an option, the words that are not options, the suffixes of the
    in-place edit) as GNU sed reads its words (`-l` takes the next word as GNU's `-l N`; BSD's `-l` takes none, so the reading
    is made both ways, `l_takes_argument` and not): the options end at `--`; `-i` takes the rest of its word as the suffix (`-i.bak`, `-ie`), and may follow other
    letters (`-ni`); `-e` and `-f` (and `--expression`, `--file`, each cut short to a name that is only theirs) take the rest of
    their word, or the next word, as the script or the file of it, which is no operand and no flag; `--in-place[=SUFFIX]` is the
    long form. BSD's suffix word (`-i .bak`, `-i ''`) is left among the words, as it always was."""
    in_place = scripted = False
    operands, suffixes, index, options = [], [], 0, True
    while index < len(words):
        word = words[index]
        text = word.text
        index += 1
        if not options or len(text) < 2 or text[0] != "-":
            operands.append(word)
        elif text == "--":
            options = False
        elif text[1] == "-":
            name, equals, suffix = text[2:].partition("=")
            matches = [long for long in SED_LONG if name and long.startswith(name)]
            if len(matches) == 1:
                if matches[0] == "in-place":
                    in_place = True
                    suffixes.append(suffix)
                elif matches[0] in ("expression", "file"):
                    scripted = True
                    index += 0 if equals or index >= len(words) else 1
                elif matches[0] == "line-length":
                    index += 0 if equals or index >= len(words) else 1
        else:
            for position, letter in enumerate(text[1:], 1):
                if letter == "i":
                    in_place = True
                    suffixes.append(text[position + 1:])
                    break
                if letter == "l" and not l_takes_argument:
                    continue
                if letter in "efl":
                    scripted = scripted or letter != "l"
                    index += 0 if text[position + 1:] or index >= len(words) else 1
                    break
    return in_place, scripted, operands, suffixes


def powershell_paths(arguments, writes):
    """(the paths a cmdlet is given by a parameter written `-Name:value` (or `-Name: value`) and cut short to a beginning that is
    only of one of the parameters it `written`s, the paths it may be given by one that fits more than one or that nobody knows
    but whose value looks like a path). PowerShell binds a name cut short by its own parameters, which this does not know, so
    the second kind (-Fi is Filter and FilePath) is one more candidate and takes nothing away: the words the command always
    named stay judged. The first kind is the target, as a name written out is. A parameter that only reads (a source) and a name
    that is known (read as it always was) add nothing."""
    given, maybe, index = [], [], 0
    arguments = list(arguments)
    while index < len(arguments):
        token, text = arguments[index], arguments[index].text
        index += 1
        if len(text) < 2 or text[0] != "-" or text[1:].isdigit() or token.redirect:
            continue
        key, colon, value = text.lstrip("-").partition(":")
        key = key.lower()  # the value keeps its case: on a disk that tells cases apart it names another file
        if not colon or key in PATH_PARAMS or key in VALUE_PARAMS:
            continue
        if value:
            candidate = Token(value, token.dynamic)
        elif index < len(arguments) and not arguments[index].redirect:
            candidate = arguments[index]  # `-Name: value`
            index += 1
        else:
            continue
        paths = [name for name in PATH_PARAMS if name.startswith(key)] if len(key) >= 2 else []
        values = [name for name in (*VALUE_PARAMS, *READ_PARAMS) if name.startswith(key)] if len(key) >= 2 else []
        if paths and not values and all(name in writes for name in paths):
            given.append(candidate)
        elif any(name in writes for name in paths) or (not paths and not values and _path_like(candidate.text)):
            maybe.append(candidate)
    return given, maybe


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


def _classic_classify(command, cwd, reach, *, windows=None, home=None, depth=0):
    """The reading of a command that `classify` began with, as it was (9a542a3cc), kept whole and unchanged: everything the later
    readings add is in `_extra_classify`, and the answer is the union of the two, so a later change can never miss what this
    one finds. (The targets of `command` in a project that is not the member's, the other targets outside its work folder), as the
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
                    nested = _classic_classify(" ".join(item.text for item in rest[position + 1:]), here, reach,
                                      windows=windows, home=home, depth=depth + 1)
                    projects += nested[0]
                    outside += nested[1]
                    break
            continue
        positional, named = _options(rest)
        kind = WRITERS.get(name)
        found = []
        if kind == DEST:
            found = [item for key in SOURCE_PARAMS for item in named.get(key, [])]
            if name == "start-transcript":
                found += named.get("outputdirectory") or []
            found = found or positional[:1]
            if name in ("new-item", "ni") and named.get("name"):
                folder = [token for token in found] or [Token(".")]
                found = [Token(os.path.join(folder[0].text, item.text), folder[0].dynamic or item.dynamic) for item in named["name"]]
        elif kind == ALL:
            found = [*positional, *(item for key in PATH_PARAMS for item in named.get(key, []))]
            if name in ("mkdir", "md") and named.get("name"):
                found += named["name"]
        elif kind == RENAME:
            found = renamed(positional, named)
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


def _comma_pieces(arguments):
    """The pieces of the words of a PowerShell command that are an array written with commas (`-Path a, b`, `a,b`): each piece is a
    path it may be given, and the reading by words sees only the first. A value of a parameter that is a value is none."""
    pieces, open_array, skip = [], False, False
    for token in arguments:
        text = token.text
        if skip:
            skip = False
            continue
        value = text
        if len(text) > 1 and text[0] == "-" and not text[1:].isdigit():
            key, colon, tail = text.lstrip("-").partition(":")
            if key.lower() in VALUE_PARAMS:
                skip = not colon
                open_array = False
                continue
            if not (colon and tail):
                open_array = False
                continue
            value = tail
        if "," in value or open_array:
            pieces += [Token(piece.strip(), token.dynamic) for piece in value.split(",") if piece.strip()]
        open_array = value.endswith(",")
    return pieces


COPY_LIKE = ("copy-item", "cpi", "copy-itemproperty", "expand-archive", "compress-archive", "start-bitstransfer")
SOURCE_NAMES = ("path", "literalpath", "pspath", "lp", "filepath", "source")
DESTINATION_NAMES = ("destination", "destinationpath")


def _names(named, wanted):
    """Whether one of the names a parameter was written with is, or is the beginning of, one of the `wanted`."""
    return any(key in wanted or (len(key) >= 2 and any(name.startswith(key) for name in wanted)) for key in named)


def extra_targets(name, rest):
    """The words a command names as paths it writes that the reading by words (`_classic_classify`) does not take for them: the
    parameters of PowerShell written `-Name:value` or cut short, its arrays written with commas, a copy, an archive and a
    transfer whose source is given by name and whose destination is the lone word beside it, sed's edit in place however its
    options are written (and the directory of its backup), each only ever one more to judge."""
    positional, named = _options(rest)
    found = []
    if name in POWERSHELL:
        given, maybe = powershell_paths(rest, written(name))
        found += [*given, *maybe, *_comma_pieces(rest)]
        if name in COPY_LIKE:
            if _names(named, SOURCE_NAMES) and not _names(named, DESTINATION_NAMES):
                # `-LiteralPath src dest`: the word beside the source is where it goes (and, where a name the reading by words
                # does not know (-Source) leaves its value among the words, the last one is).
                found += [*positional[:1], *positional[-1:]]
            elif name in ("expand-archive", "compress-archive", "start-bitstransfer") and not _names(named, DESTINATION_NAMES):
                found += positional[1:2]
    elif name == "sed":
        for takes in (True, False):
            in_place, scripted, operands, suffixes = sed_words(rest, takes)
            if not in_place:
                continue
            files = [word for word in (operands if scripted else operands[1:]) if word.text]
            found += files
            for suffix in suffixes:
                # `-i'dir/*.bak'`: a backup is made where the template says, wherever the file is.
                if "/" in suffix or "\\" in suffix:
                    for word in files:
                        base = re.split(r"[\\/]", word.text)[-1]
                        backup = suffix.replace("*", base) if "*" in suffix else base + suffix
                        found.append(Token(backup, word.dynamic))
                        if not (os.path.isabs(backup) or os.path.splitdrive(backup)[0] or backup.startswith(("~", "/", "\\"))):
                            found.append(Token(word.text[:len(word.text) - len(base)] + backup, word.dynamic))  # or in the file's folder
    return found


def _extra_classify(command, cwd, reach, *, windows=None, home=None, depth=0):
    """(projects, outside) of the targets the additions find (`extra_targets`): the same reading of where the command runs, of a
    `cd` and of the shells it starts as `_classic_classify` has, and nothing that reading already finds is taken away by it."""
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
            outside.append(text)
            return
        prefix = 4 if text[:4] in ("\\\\?\\", "\\\\.\\") else 0
        wild = re.search(r"[*?\[]", text[prefix:])
        if wild:
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
        words = [token for index, token in enumerate(segment) if not token.redirect and index - 1 not in redirect]
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
                    nested = _extra_classify(" ".join(item.text for item in rest[position + 1:]), here, reach,
                                             windows=windows, home=home, depth=depth + 1)
                    projects += nested[0]
                    outside += nested[1]
                    break
            continue
        for token in extra_targets(name, rest):
            judge(token, here)
    return projects, outside


def classify(command, cwd, reach, *, windows=None, home=None, depth=0):
    """(the targets of `command` in a project that is not the member's, the other targets outside its work folder), as the words
    that named them ("<variable>" for one that cannot be read). `reach` says where a resolved path is: "inside" the work
    folder, in a "project" that is not the member's, or "outside" (`work_area.reach`). `cwd` is the folder the command starts
    in (None: unknown, so a relative target is outside).

    The answer is the union of two readings: the one by words that was always made (`_classic_classify`, unchanged), and the
    additions (`_extra_classify`). Whatever a reading finds stays found; the additions may judge more than the command writes
    (a word beside a named target is judged as it always was), never less. It is a best effort and no sandbox: what a program
    that a command starts writes is not seen."""
    options = dict(windows=windows, home=home, depth=depth)
    projects, outside = _classic_classify(command, cwd, reach, **options)
    try:
        more_projects, more_outside = _extra_classify(command, cwd, reach, **options)
    except Exception as exc:  # the additions never take away the reading that was always made
        logger.warning("The additional reading of a command failed: %s", type(exc).__name__)
        more_projects, more_outside = [], []
    return ([*projects, *(text for text in dict.fromkeys(more_projects) if text not in projects)],
            [*outside, *(text for text in dict.fromkeys(more_outside) if text not in outside)])

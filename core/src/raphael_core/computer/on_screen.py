"""Whether a command run on the owner's PC would show something on its screen (R-PC-06).

Commands run on the owner's PC hidden (R-PC-03), from every turn and task, with the owner's approval (R-PC-02). What a
member shows, a page, a program or a file, it shows on its own computer; only a quick question (Alt+Space) uses the
owner's screen. A model that picked the wrong computer may still try to open something there through a command:
`Start-Process`, `start`, `explorer`, `Invoke-Item`, a URL or a shortcut typed as the command, `open` on a Mac. Outside a
quick question such a command is refused in every permission mode, and the member is told to use its own computer.

This catches a model's mistake about which computer to use. It reads the command as words, it is no shell parser and it
does not stop someone set on getting round it: the approval card stays the gate of what runs.

Code is not a command: the body of a heredoc fed to an interpreter (`python3 - <<'EOF'`) or written to a file
(`cat > x.py <<'EOF'`) is a program's text or data, so a Python `open(p)` there is not the Mac's `open`. A heredoc fed to
a shell (`bash <<EOF`, `cat <<EOF | sh`) is still read as commands. A refusal names the fragment that triggered it.
"""

import re
import sys
from collections.abc import Iterator

# Programs whose work is to open something in a window: a program, a page, a file or a folder.
_OPENERS = frozenset({"start-process", "saps", "start", "invoke-item", "ii", "explorer", "xdg-open"})
# Programs that are a window: starting one shows it.
_WINDOWED = frozenset({
    "notepad", "notepad++", "mspaint", "calc", "write", "wordpad", "msedge", "chrome", "firefox", "brave", "opera",
    "iexplore", "control", "taskmgr", "mstsc", "regedit", "mmc", "winword", "excel", "powerpnt", "outlook", "onenote",
})
# Common console programs also use PowerShell's call operator when their paths are quoted.
_CONSOLE = re.compile(r"python(?:\d+(?:\.\d+)?)?|git|curl|node|npm|uv")
# Files a shell opens in their own program when one is typed as the command: shortcuts, consoles, documents, media.
_OPENED = (".lnk", ".url", ".appref-ms", ".msc", ".cpl", ".pdf", ".htm", ".html", ".txt", ".md", ".csv", ".doc", ".docx",
           ".xls", ".xlsx", ".ppt", ".pptx", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".svg", ".webp", ".mp3", ".mp4",
           ".mov", ".avi", ".mkv", ".wav")
# A scheme of two letters or more, so that a drive (C:) is none: https://, mailto:, ms-settings:.
_SCHEME = re.compile(r"[a-z][a-z0-9+.-]+:\S+", re.I)
_STRING = re.compile(r""" "(?:`.|[^"`])*" | '(?:''|[^'])*' """, re.X)
# The same through .NET or COM: Process.Start, ShellExecute, the shell's own objects.
_API = re.compile(r"\[(?:system\.)?diagnostics\.process\]::start\s*\(|\bshellexecute(?:ex)?\b|\bshell\.application\b"
                  r"|\bwscript\.shell\b", re.I)
# rundll32's ways to open a page or a file.
_RUNDLL = re.compile(r"\b(?:url|shell32|ieframe)\.dll\b|fileprotocolhandler|shellexec_rundll|openurl", re.I)
# A Mac's script that brings an app or a page to the front.
_APPLESCRIPT = re.compile(r"\b(?:activate|open location|launch)\b", re.I)
_WORD = re.compile(rf"{_STRING.pattern}|\S+", re.X)
_BOUNDARIES = re.compile(rf"{_STRING.pattern}|(?P<boundary>&&|[;&|(){{}}\r\n])", re.X)
_SHELLS = frozenset({"cmd", "powershell", "pwsh", "bash", "sh", "zsh"})
# What reads a heredoc as commands when it is the program, or a later part of the line, that receives it.
_RUNNERS = _SHELLS | {"dash", "ksh", "fish", "csh", "tcsh", "eval", "source", ".", "xargs", "ssh", "su"}
# What takes a heredoc as its own text: an interpreter reads a script, `cat` and `tee` write a file.
_INTERPRETER = re.compile(r"(?:pythonw?|py|pypy3?|node(?:js)?|deno|bun|ruby|perl|php|lua|rscript|julia)(?:\d+(?:\.\d+)*)?")
_SINKS = frozenset({"cat", "tee"})
# Words in front of a program that do not change what it is.
_WRAPPERS = frozenset({"sudo", "env", "exec", "command", "time", "nohup", "uv", "poetry", "pipenv", "run"})
# `<<TAG`, `<<-TAG`, `<<'TAG'`, `<<"TAG"`, `<<\TAG`, never a here-string (`<<<`).
_HEREDOC = re.compile(r"""(?<!<)<<(?!<)(?P<tab>-?)[ \t]*(?:'(?P<q1>[^'\r\n]+)'|"(?P<q2>[^"\r\n]+)"|(?P<esc>\\)?(?P<bare>[A-Za-z_]\w*))""")
# Where the statement a heredoc belongs to ends on its line.
_STATEMENT_END = re.compile(r";|&&|\r|\n")
_FRAGMENT = 80
# The flag after which a shell's own command follows: cmd /c, powershell -Command, sh -c.
_RUNS = frozenset({"/c", "/k", "/r", "-c", "-command", "-commandwithargs"})


def _parts(command: str) -> Iterator[tuple[str, bool]]:
    """Cut outside quotes at statement boundaries, preserving an explicit `&` invocation."""
    start, invoked = 0, False
    for match in _BOUNDARIES.finditer(command):
        if boundary := match["boundary"]:
            yield command[start:match.start()], invoked
            start, invoked = match.end(), boundary == "&"
    yield command[start:], invoked


def _program(word: str) -> str:
    """The program a word names: its file name, lower case, without `.exe`."""
    name = re.split(r"[\\/]", word)[-1].casefold()
    return name.removesuffix(".exe")


def _opens(part: str, mac: bool, invoked: bool, *, quoted_commands: bool) -> str:
    """The part of a statement that opens something, or an empty string."""
    tokens = iter(_WORD.finditer(part))
    for token in tokens:
        raw = token.group()
        if raw not in (".", "@", "call"):
            break
        invoked |= raw in (".", "call")
    else:
        return ""
    if raw[0] in "\"'" and not (invoked or quoted_commands):
        return ""
    first = raw.strip("\"'").lstrip("@")
    if first.startswith("$") or re.match(r"\w+=", first):
        return ""
    program = _program(first)
    if program in _SHELLS:
        # cmd /c start …, powershell -Command "Start-Process …": what the shell is told to run.
        for flag in tokens:
            if flag.group().strip("\"'").casefold() in _RUNS:
                payload = part[flag.end():].strip()
                if payload and payload[0] in "\"'" and payload.endswith(payload[0]) and _WORD.fullmatch(payload):
                    payload = payload[1:-1]
                return _launches(payload, mac, quoted_commands=program not in ("powershell", "pwsh"))
        return ""
    if program in _OPENERS or program in _WINDOWED or (mac and program == "open"):
        return part
    if program == "rundll32":
        return part if _RUNDLL.search(part) else ""
    if mac and program == "osascript":
        return part if _APPLESCRIPT.search(part) else ""
    return part if (_SCHEME.fullmatch(first) or first.casefold().endswith(_OPENED)
                    or invoked and first.casefold().endswith(".exe") and not _CONSOLE.fullmatch(program)) else ""


def _launches(command: str, mac: bool, *, quoted_commands: bool = False) -> str:
    def mask_string(match):
        # A quoted COM class is significant only as the argument of New-Object's -ComObject.
        if re.search(r"\bnew-object\s+-comobject\s*$", command[:match.start()], re.I):
            return match[0]
        return " "

    command = _without_script_bodies(command)  # also what a shell's `-c` payload holds
    if found := _API.search(_STRING.sub(mask_string, command)):
        return found[0]
    for part, invoked in _parts(command):
        if found := _opens(part, mac, invoked, quoted_commands=quoted_commands):
            return found
    return ""


def _blank_strings(text: str) -> str:
    return _STRING.sub(lambda match: " " * len(match[0]), text)


def _programs(text: str) -> list[str]:
    """The program of each statement of `text`."""
    programs = []
    for part, _ in _parts(text):
        for word in part.split():
            if word in (".", "@") or re.match(r"\w+=", word) or word.casefold() in _WRAPPERS:
                continue
            programs.append(_program(word))
            break
    return programs


def _receives(receiver: list[str], after: str) -> str:
    """What a heredoc is for, given its receiving program and the words after it in its statement: `data` (an
    interpreter's script, a file being written) or `commands` (a shell reads it, or what follows would run what the
    program prints)."""
    if not receiver or any(program in _RUNNERS for program in receiver + _programs(after)):
        return "commands"
    return "data" if _INTERPRETER.fullmatch(receiver[0]) or receiver[0] in _SINKS else "commands"


def _substitutions(body: str) -> list[str]:
    """The commands an unquoted heredoc's shell would run in its body: `$(…)` and backticks that are not escaped."""
    found, index = [], 0
    while index < len(body):
        char = body[index]
        if char == "\\":
            index += 2
        elif char == "`":
            end = body.find("`", index + 1)
            end = len(body) if end < 0 else end
            found.append(body[index + 1:end])
            index = end + 1
        elif body.startswith("$(", index):
            depth, end = 1, index + 2
            while end < len(body) and depth:
                depth += (body[end] == "(") - (body[end] == ")")
                end += 1
            found.append(body[index + 2:end - (1 if depth == 0 else 0)])
            index += 2  # a substitution inside another is read again
        else:
            index += 1
    return found


def _without_script_bodies(command: str) -> str:
    """`command` without the bodies of heredocs that hold a program's text instead of commands. A heredoc that never
    closes is left as it is: nothing is taken for data that a shell would not take for it."""
    lines = command.splitlines(keepends=True)
    kept, index = [], 0
    while index < len(lines):
        line = lines[index]
        kept.append(line)
        index += 1
        blanked = _blank_strings(line)
        markers = [m for m in _HEREDOC.finditer(line) if blanked.startswith("<<", m.start())]
        if not markers:
            continue
        receiver, previous = [], 0
        for number, marker in enumerate(markers):
            # Each heredoc has its own receiver: the words since the last one (or the line's start) and what follows in its
            # statement (a `| sh` would run what the program prints).
            receiver = _programs(blanked[previous:marker.start()])[-1:] or receiver
            rest = blanked[marker.end():markers[number + 1].start() if number + 1 < len(markers) else None]
            after = rest[:stop.start()] if (stop := _STATEMENT_END.search(rest)) else rest
            previous = marker.end()
            tag = marker["q1"] or marker["q2"] or marker["bare"]
            for end in range(index, len(lines)):
                closing = lines[end].rstrip("\r\n")
                if (closing.lstrip("\t") if marker["tab"] else closing) == tag:
                    break
            else:
                break
            if _receives(receiver, after) == "commands":
                kept.extend(lines[index:end + 1])
            elif not (marker["q1"] or marker["q2"] or marker["esc"]):
                # An unquoted delimiter: the shell runs the substitutions before the program sees its text.
                kept.extend(f"{command}\n" for command in _substitutions("".join(lines[index:end])))
            index = end + 1
    return "".join(kept)


def on_screen_fragment(command: str, platform: str = sys.platform) -> str:
    """The part of `command`, run on the owner's PC (`platform` is its `sys.platform`), that would show something on its
    screen, on one line and shortened for a refusal; an empty string when nothing would."""
    mac = platform == "darwin"
    found = _launches(command, mac, quoted_commands=mac)
    text = " ".join(re.sub(r"[\x00-\x1f\x7f]", " ", found).split())
    if not found:
        return ""
    return text[:_FRAGMENT].rstrip() + "…" if len(text) > _FRAGMENT else text or "?"


def launches_on_screen(command: str, platform: str = sys.platform) -> bool:
    """Whether `command`, run on the owner's PC (`platform` is its `sys.platform`), would show something on its screen:
    start a program with a window, or open a page, a file or a shortcut in its default program. A download (a URL inside
    curl or Invoke-WebRequest) shows nothing and is not one."""
    return bool(on_screen_fragment(command, platform))

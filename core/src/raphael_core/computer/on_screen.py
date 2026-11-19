"""Whether a command run on the owner's PC would show something on its screen (R-PC-06).

Commands run on the owner's PC hidden (R-PC-03), from every turn and task, with the owner's approval (R-PC-02). What a
member shows, a page, a program or a file, it shows on its own computer; only a quick question (Alt+Space) uses the
owner's screen. A model that picked the wrong computer may still try to open something there through a command:
`Start-Process`, `start`, `explorer`, `Invoke-Item`, a URL or a shortcut typed as the command, `open` on a Mac. Outside a
quick question such a command is refused in every permission mode, and the member is told to use its own computer.

This catches a model's mistake about which computer to use. It reads the command as words, it is no shell parser and it
does not stop someone set on getting round it: the approval card stays the gate of what runs.
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


def _opens(part: str, mac: bool, invoked: bool, *, quoted_commands: bool) -> bool:
    tokens = iter(_WORD.finditer(part))
    for token in tokens:
        raw = token.group()
        if raw not in (".", "@", "call"):
            break
        invoked |= raw in (".", "call")
    else:
        return False
    if raw[0] in "\"'" and not (invoked or quoted_commands):
        return False
    first = raw.strip("\"'").lstrip("@")
    if first.startswith("$") or re.match(r"\w+=", first):
        return False
    program = _program(first)
    if program in _SHELLS:
        # cmd /c start …, powershell -Command "Start-Process …": what the shell is told to run.
        for flag in tokens:
            if flag.group().strip("\"'").casefold() in _RUNS:
                payload = part[flag.end():].strip()
                if payload and payload[0] in "\"'" and payload.endswith(payload[0]) and _WORD.fullmatch(payload):
                    payload = payload[1:-1]
                return _launches(payload, mac, quoted_commands=program not in ("powershell", "pwsh"))
        return False
    if program in _OPENERS or program in _WINDOWED or (mac and program == "open"):
        return True
    if program == "rundll32":
        return bool(_RUNDLL.search(part))
    if mac and program == "osascript":
        return bool(_APPLESCRIPT.search(part))
    return (bool(_SCHEME.fullmatch(first)) or first.casefold().endswith(_OPENED)
            or invoked and first.casefold().endswith(".exe") and not _CONSOLE.fullmatch(program))


def _launches(command: str, mac: bool, *, quoted_commands: bool = False) -> bool:
    def mask_string(match):
        # A quoted COM class is significant only as the argument of New-Object's -ComObject.
        if re.search(r"\bnew-object\s+-comobject\s*$", command[:match.start()], re.I):
            return match[0]
        return " "

    return bool(_API.search(_STRING.sub(mask_string, command))) or any(
        _opens(part, mac, invoked, quoted_commands=quoted_commands) for part, invoked in _parts(command))


def launches_on_screen(command: str, platform: str = sys.platform) -> bool:
    """Whether `command`, run on the owner's PC (`platform` is its `sys.platform`), would show something on its screen:
    start a program with a window, or open a page, a file or a shortcut in its default program. A download (a URL inside
    curl or Invoke-WebRequest) shows nothing and is not one."""
    mac = platform == "darwin"
    return _launches(command, mac, quoted_commands=mac)

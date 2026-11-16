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

# Programs whose work is to open something in a window: a program, a page, a file or a folder.
_OPENERS = frozenset({"start-process", "saps", "start", "invoke-item", "ii", "explorer", "xdg-open"})
# Programs that are a window: starting one shows it.
_WINDOWED = frozenset({
    "notepad", "notepad++", "mspaint", "calc", "write", "wordpad", "msedge", "chrome", "firefox", "brave", "opera",
    "iexplore", "control", "taskmgr", "mstsc", "regedit", "mmc", "winword", "excel", "powerpnt", "outlook", "onenote",
})
# Files a shell opens in their own program when one is typed as the command: shortcuts, consoles, documents, media.
_OPENED = (".lnk", ".url", ".appref-ms", ".msc", ".cpl", ".pdf", ".htm", ".html", ".txt", ".md", ".csv", ".doc", ".docx",
           ".xls", ".xlsx", ".ppt", ".pptx", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".svg", ".webp", ".mp3", ".mp4",
           ".mov", ".avi", ".mkv", ".wav")
# A scheme of two letters or more, so that a drive (C:) is none: https://, mailto:, ms-settings:.
_SCHEME = re.compile(r"[a-z][a-z0-9+.-]+:", re.I)
# The same through .NET or COM: Process.Start, ShellExecute, the shell's own objects.
_API = re.compile(r"\[(?:system\.)?diagnostics\.process\]::start\s*\(|\bshellexecute(?:ex)?\b|\bshell\.application\b"
                  r"|\bwscript\.shell\b", re.I)
# rundll32's ways to open a page or a file.
_RUNDLL = re.compile(r"\b(?:url|shell32|ieframe)\.dll\b|fileprotocolhandler|shellexec_rundll|openurl", re.I)
# A Mac's script that brings an app or a page to the front.
_APPLESCRIPT = re.compile(r"\b(?:activate|open location|launch)\b", re.I)
_WORD = re.compile(r'"[^"]*"?|\'[^\']*\'?|\S+')
_SHELLS = frozenset({"cmd", "powershell", "pwsh", "bash", "sh", "zsh"})
# The flag after which a shell's own command follows: cmd /c, powershell -Command, sh -c.
_RUNS = frozenset({"/c", "/k", "/r", "-c", "-command", "-commandwithargs"})


def _parts(command: str) -> list[str]:
    """The command cut where another may begin, outside quotes: a new line, `;`, `&`, `|` and a block's brackets."""
    parts, start, quote = [], 0, ""
    for index, char in enumerate(command):
        if quote:
            quote = "" if char == quote else quote
        elif char in "\"'":
            quote = char
        elif char in ";&|(){}\r\n":
            parts.append(command[start:index])
            start = index + 1
    parts.append(command[start:])
    return parts


def _program(word: str) -> str:
    """The program a word names: its file name, lower case, without `.exe`."""
    name = re.split(r"[\\/]", word)[-1].casefold()
    return name.removesuffix(".exe")


def _opens(part: str, mac: bool) -> bool:
    words = [word.strip("\"'") for word in _WORD.findall(part)]
    while words and words[0] in (".", "@", "call"):
        words.pop(0)
    if not words:
        return False
    first = words[0].lstrip("@")
    program = _program(first)
    if program in _SHELLS:
        # cmd /c start …, powershell -Command "Start-Process …": what the shell is told to run.
        for index, word in enumerate(words[1:], 1):
            if word.casefold() in _RUNS:
                return _launches(" ".join(words[index + 1:]), mac)
        return False
    if program in _OPENERS or program in _WINDOWED or (mac and program == "open"):
        return True
    if program == "rundll32":
        return bool(_RUNDLL.search(part))
    if mac and program == "osascript":
        return bool(_APPLESCRIPT.search(part))
    return bool(_SCHEME.match(first)) or first.casefold().endswith(_OPENED)


def _launches(command: str, mac: bool) -> bool:
    return bool(_API.search(command)) or any(_opens(part, mac) for part in _parts(command))


def launches_on_screen(command: str, platform: str = sys.platform) -> bool:
    """Whether `command`, run on the owner's PC (`platform` is its `sys.platform`), would show something on its screen:
    start a program with a window, or open a page, a file or a shortcut in its default program. A download (a URL inside
    curl or Invoke-WebRequest) shows nothing and is not one."""
    return _launches(command, platform == "darwin")

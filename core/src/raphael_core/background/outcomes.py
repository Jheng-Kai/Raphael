"""Explicit file requirements and value-free worker diagnostics."""

import re
import traceback
from pathlib import Path, PurePosixPath


def named_files(text):
    """Yield absolute paths, including quoted paths and paths followed by prose."""
    seen = set()
    pattern = r'''(?i)[a-z]:[\\/][^\r\n<>"`|?*]+|(?<![\w:/])/[\w.][^\r\n<>"`|?*]+'''
    for match in re.finditer(pattern, text):
        named = match.group().strip().rstrip("' ).,;。")
        candidates = [named]
        candidates.extend(named[:found.end()] for found in re.finditer(r"\.[a-zA-Z0-9]{1,12}(?=[\s)\]}',;。]|$)", named))
        candidates.extend(named[:gap.start()] for gap in list(re.finditer(r"\s+", named))[-16:][::-1])
        for candidate in candidates:
            path = Path(candidate)
            if path.is_absolute() and str(path) not in seen:
                seen.add(str(path))
                yield path


def file_named_in(text, name):
    """Whether `text` names the file `name`: its whole name, whatever it holds (spaces, Chinese or Japanese characters), and not the
    end of a longer one. Prose in those languages has no spaces, so a name can stand right against the words around it."""
    text, name = text.lower(), name.lower()
    start = text.find(name) if name else -1
    while start != -1:
        before = text[start - 1] if start else " "
        after = text[start + len(name):start + len(name) + 2] + "  "
        longer = ((before.isascii() and (before.isalnum() or before in "_-."))
                  or (after[0].isascii() and (after[0].isalnum() or after[0] == "_"))
                  or (after[0] == "." and after[1].isascii() and after[1].isalnum()))
        if not longer:
            return True
        start = text.find(name, start + 1)
    return False


# A member names the files it made by the path they have inside its own computer: its folder or its team's shared folder.
COMPUTER_PATH = re.compile(r"""/home/cua/(?:workspace|team)/[^\s"'`<>|?*]+""")


def computer_files(text):
    """Yield, for each file `text` names by its path inside a member's computer, the path below its folder (the folder
    of the member or of its team: the caller knows where this PC keeps each). Prose may follow the name, so each place
    a file name could end is offered, the longest first."""
    seen = set()
    for match in COMPUTER_PATH.finditer(text):
        named = match.group().rstrip("' ).,;。")
        ends = [found.end() for found in re.finditer(r"\.[A-Za-z0-9]{1,12}(?![A-Za-z0-9_])", named)]
        for candidate in [named, *(named[:end] for end in reversed(ends))]:
            below = PurePosixPath(candidate).parts[4:]
            if below and ".." not in below and below not in seen:
                seen.add(below)
                yield PurePosixPath(*below)


def worker_trace(error):
    """Keep only our frame locations and exception type, never values or source text."""
    root = Path(__file__).resolve().parent.parent
    frames = []
    for frame in traceback.extract_tb(error.__traceback__):
        try:
            path = Path(frame.filename).resolve().relative_to(root)
        except (OSError, ValueError):
            continue
        frames.append(f"{path.as_posix()}:{frame.lineno}")
    return (type(error).__name__ + ": " + ", ".join(frames[-3:]))[:400]

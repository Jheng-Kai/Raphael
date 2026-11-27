"""Where a skill source that is a path on this computer points, whichever way it was written."""

import os
import re
from pathlib import Path

_DRIVE = re.compile(r"[A-Za-z]:([\\/]|$)")
_SCHEME = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*://")


def as_local(source):
    """`source` as `local:<path>` when it names a place on this computer: a Windows path (a drive with `\\` or `/`, a
    `\\\\server\\share`), a path from the home folder (`~`), an absolute path, a relative one that starts with `./` or `../`
    or has a Windows separator, or any relative path that exists. A link, `owner/repo` and what already is `local:` stay as
    they are, so the same string is never a path for one reader and a repository for another."""
    if not isinstance(source, str):
        return source
    text = source.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        text = text[1:-1].strip()
    if not text or text.startswith("local:") or _SCHEME.match(text) or "\x00" in text:
        return source
    if text.startswith("~") and text[1:2] in ("", "/", "\\"):
        return "local:" + str(Path(text).expanduser())
    path = _DRIVE.match(text) or text.startswith(("\\\\", "/", "./", "../", ".\\", "..\\")) or "\\" in text
    if path or os.path.exists(text):
        return "local:" + (text if _DRIVE.match(text) or text.startswith(("\\\\", "/")) else os.path.abspath(text))
    return source

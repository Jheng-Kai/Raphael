"""Where a member writes on the owner's PC without asking (R-FILE-06): its work folder, and nothing else.

A member works in one place. With a project chosen (`folders.choice`) that is the project, and only the project: its own
folder and the team's are outside it. With none chosen it is the member's own folder and the team folder. A tool that
writes, moves, deletes or creates a file outside that area never does it silently: the owner's yes on a card is asked in
every permission mode but 全部允許, whose name is that yes (the door's firm confirmation, `ToolGate.firm_confirmation`).

One kind of place outside is never written at all: a remembered project (`project_folders`) that is not the member's chosen
one. The owner chose a folder for each member, so another project is refused in every permission mode, 全部允許 included,
with or without a yes, from any turn or task; nothing asks for it, and the tool itself refuses (`reach`, `UNCHOSEN_WORDS`).

Every path is judged where it really is, never as it was written: absolute, `.` and `..` taken out, links and junctions
followed, Windows' long and device prefixes (a question mark or a dot after two slashes) reduced to the drive path they
name, a device namespace and a reserved device name refused, a drive-relative path (`C:x`) taken from that drive's folder. Being inside a
folder is a question of identity, not of spelling: a path is inside when it or one of its parents is that very folder on
the disk (the file's identity, as `os.path.samefile`), so another case, an 8.3 short name or a second way in make no
difference; a folder that is not made yet is compared by its resolved name.
"""

import os
import re
import sys

from .folders import choice, default_folders, path_key

_DRIVE = re.compile(r"^[A-Za-z]:(?:\\|$)")
_RESERVED = re.compile(r"^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\..*)?$", re.I)
_FOLDS = os.name == "nt" or sys.platform == "darwin"


class PathRefused(ValueError):
    """A path that can name no file of a work folder: empty, with a null, or in a device namespace."""


def _key(path):
    text = str(path).replace("\\", "/").rstrip("/")
    return text.casefold() if _FOLDS else text


def absolute(text, base=None, home=None):
    """`text` as one absolute, normalised path, links not followed. `~` is taken from `home`; a relative path from
    `base` (the current folder without it). Windows' long and device prefixes of a drive or share become the plain
    path; any other device namespace, and a reserved device name in any part (CON, NUL, COM1...), is PathRefused."""
    if not isinstance(text, str) or "\x00" in text or not text.strip():
        raise PathRefused("bad_path")
    text = text.strip()
    if home is not None and (text == "~" or text.startswith(("~/", "~\\"))):
        text = str(home) + text[1:]
    if os.name == "nt":
        text = text.replace("/", "\\")
        if text.startswith(("\\\\?\\", "\\\\.\\")):
            rest = text[4:]
            if _DRIVE.match(rest):
                text = rest
            elif rest[:4].lower() == "unc\\":
                text = "\\\\" + rest[4:]
            else:
                raise PathRefused("device_path")
        if any(_RESERVED.match(part) for part in text.split("\\")):
            raise PathRefused("device_name")
    try:
        return os.path.abspath(os.path.join(str(base), text) if base is not None else text)
    except (OSError, ValueError):
        raise PathRefused("bad_path") from None


def resolved(text, base=None, home=None):
    """`absolute`, then where the path really leads: links and junctions followed as far as they exist, the disk's own
    spelling of the parts that exist (8.3 names made long)."""
    path = absolute(text, base, home)
    try:
        return os.path.realpath(path)
    except (OSError, ValueError):
        raise PathRefused("bad_path") from None


def _identity(path):
    try:
        info = os.stat(path)
    except (OSError, ValueError):
        return None
    return (info.st_dev, info.st_ino) if info.st_ino else None


def _within(path, root):
    root = resolved(root)
    wanted = _identity(root)
    if wanted is None:
        # The folder is not made yet (or the disk gives no identity): its resolved name stands for it.
        here, there = _key(path), _key(root)
        return here == there or here.startswith(there + "/")
    here = path
    while True:
        if _identity(here) == wanted:
            return True
        parent = os.path.dirname(here)
        if parent == here:
            return False
        here = parent


def inside(path, roots):
    """Whether the resolved `path` is one of `roots` or under one."""
    try:
        return any(_within(path, root) for root in roots)
    except PathRefused:
        return False


def area(settings, member, folders=default_folders):
    """The folders `member` writes in without asking: the chosen project alone, else its own folder and the team's."""
    chosen = choice(settings, member) if settings is not None else None
    return [str(chosen)] if chosen else [str(folder) for folder in folders(member)]


# What the model is told when a write is refused because its path is in a project that is not chosen for it. One sentence for every
# tool that writes (the owner's file tools, the host computer's, the member's own computer's, a local command).
UNCHOSEN_WORDS = ("Nothing was written: this path is in one of the owner's projects that is not chosen for you, so it is never "
                  "written, in any permission mode and with or without a yes. Write in your work folder, or tell the owner "
                  "plainly that they can choose this project for you in the folder menu under the message box.")
INSIDE, PROJECT, OUTSIDE = "inside", "project", "outside"


def unchosen(settings, member):
    """The remembered projects that are not the project chosen for `member`: every one when none is chosen (or the chosen one
    is gone from the disk), none without settings."""
    if settings is None:
        return []
    chosen = choice(settings, member)
    chosen_key = path_key(chosen) if chosen else None
    return [str(folder) for folder in settings.get("project_folders") or [] if path_key(folder) != chosen_key]


def reach(settings, member, path, folders=default_folders):
    """Where a write at the resolved `path` lands for `member`: "inside" its work folder (`area`), in a remembered project
    that is not its own ("project": never written, whatever is said), or "outside" (anywhere else: the owner's yes). The work
    folder is decided first, so a project inside the chosen one is inside, and with none chosen a project that holds the
    member's own folder does not block it. A project that is not on the disk is compared by its resolved name."""
    if inside(path, area(settings, member, folders)):
        return INSIDE
    return PROJECT if inside(path, unchosen(settings, member)) else OUTSIDE


def shown(path, limit=150):
    """`path` for a card: whole, or with its middle left out when it is long, so that where it starts and the file it ends
    in are both in front of the owner."""
    text = str(path)
    return text if len(text) <= limit else text[:60] + "…" + text[-(limit - 61):]

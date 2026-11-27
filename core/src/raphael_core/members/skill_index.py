"""What a model is told of the files of a skill beyond its document, so it can reach them: the document first, then the other
files by name and size, read on demand. A script or a program is run by its path and never read; a binary is a name and a size.

The index is cheap: it looks at names, sizes and the first bytes of a file, never at a whole file, so a skill with large assets
costs no more to open than one without.
"""

import os
from pathlib import Path

# How many files a listing names and how many it looks at: a plugin of tens of thousands of files is told as its folders.
LISTED = 80
LOOKED = 5000
# Never listed: what the library writes beside a skill's own files.
HIDDEN = (".raphael-source.json", ".raphael-commands")
# The folders of a plugin that are entry points, in the order a model is told of them.
ENTRY_POINTS = ("commands", "agents", "hooks", "scripts", "bin")
_SKIPPED_FOLDERS = frozenset({"node_modules", "__pycache__", ".git", ".claude-plugin", ".codex-plugin", ".cursor-plugin"})


def size_of(size):
    for unit, limit in (("B", 1024), ("KB", 1024**2), ("MB", 1024**3)):
        if size < limit:
            return f"{size} B" if unit == "B" else f"{size * 1024 / limit:.1f} {unit}"
    return f"{size / 1024**3:.1f} GB"


def is_binary(path):
    """Whether a file is no text (a NUL or bytes that are no UTF-8 in its first kilobyte), judged from its start alone."""
    try:
        with open(path, "rb") as stream:
            head = stream.read(1024)
    except OSError:
        return False
    if b"\0" in head:
        return True
    try:
        head.decode("utf-8")
    except UnicodeDecodeError as error:
        # A multibyte character cut by the end of what was read is no sign of a binary.
        return error.start < len(head) - 4
    return False


def files_below(folder, *, skip=(), keep=None):
    """`(files, looked_at_all)`: the files under `folder` as `(path from it, size)`, sorted, never entering a link or a generated
    folder, and leaving out the paths of `skip` and the ones `keep` refuses."""
    folder = Path(folder)
    found, seen = [], 0
    pending = [folder]
    while pending:
        directory = pending.pop()
        try:
            with os.scandir(directory) as entries:
                for entry in sorted(entries, key=lambda item: item.name):
                    seen += 1
                    if seen > LOOKED:
                        return sorted(found), False
                    if entry.is_symlink() or entry.name in HIDDEN or entry.name in _SKIPPED_FOLDERS:
                        continue
                    relative = Path(entry.path).relative_to(folder).as_posix()
                    if entry.is_dir(follow_symlinks=False):
                        pending.append(Path(entry.path))
                    elif relative not in skip and (keep is None or keep(relative)):
                        found.append((relative, entry.stat(follow_symlinks=False).st_size))
        except OSError:
            continue
    return sorted(found), True


def listing(folder, files, whole, *, binary=True):
    lines = []
    for relative, size in files[:LISTED]:
        note = ", binary" if binary and is_binary(Path(folder) / relative) else ""
        lines.append(f"- {relative} ({size_of(size)}{note})")
    if len(files) > LISTED or not whole:
        lines.append(f"- and more: {'over ' if not whole else ''}{len(files)} files in all; list a folder with a command to see them")
    return lines


def skill_files(folder, inlined):
    """The lines naming the files of one skill's folder that its text did not carry (the ones `inlined` already are in it)."""
    files, whole = files_below(folder, skip={"SKILL.md", *inlined})
    return listing(folder, files, whole)


def plugin_entry_points(root, document=""):
    """The lines naming a plugin's entry points: its commands, agents, hooks, scripts and programs by file, and what else it holds by
    folder. The skills' own files are listed with each skill. A folder the skill's `document` points to (its actions, say) is named
    by file too, as the document sends the model to read them."""
    from .skill_references import mentions

    files, whole = files_below(Path(root))
    lines, rest = [], {}
    for relative, size in files:
        top = relative.split("/")[0] if "/" in relative else "."
        if top not in ENTRY_POINTS and top != "skills":
            rest.setdefault(top, []).append(size)
    pointed = [name for name in sorted(rest) if name != "." and document and mentions(document, name)]
    for name in (*ENTRY_POINTS, *pointed):
        group = [(relative, size) for relative, size in files if relative.split("/")[0] == name and "/" in relative]
        if group:
            lines.append(f"{name}:")
            lines += ["  " + line for line in listing(root, group, True)]
    for name, sizes in sorted(rest.items(), key=lambda item: (item[0] == ".", item[0])):
        if name in pointed:
            continue
        lines.append(f"{'files at the top' if name == '.' else name + '/'}: {len(sizes)} file{'s' if len(sizes) != 1 else ''}, {size_of(sum(sizes))}")
    if not whole:
        lines.append("and more files: the plugin holds too many to list")
    return lines

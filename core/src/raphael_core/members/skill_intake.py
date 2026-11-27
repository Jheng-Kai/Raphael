"""What the importer of Team skills takes in, and what it does not do itself (R-SKILL-26, R-SKILL-28).

The dialog imports directly only what follows the rules, with no model and no agent: a skill (a SKILL.md with front matter), a
pack of skills or a plugin of a layout the importer recognises, from a file, an archive, a folder, a GitHub address, or a Git
address fetched by the system's own git (skill_git.py). Whatever else is handed over (text, a web page, a document, a repository
or an archive or a folder of other material) is not made into a skill here: the window closes and Raphael's own conversation
takes it up, step by step with the owner. This module says what a pasted string is, which refusals mean "not a skill, a person
should look at it", and puts the material where Raphael reads it (below its own folder) with the facts the window needs to say it
in the owner's words.
"""

import asyncio
import re
import secrets
import shutil
import time
from pathlib import Path, PurePosixPath

from . import skill_git
from .skill_library import MAX_ARCHIVE_ENTRIES, MAX_PACKAGE_BYTES, MAX_SCAN_ENTRIES, junk, walk
from .skill_paths import as_local
from .skill_plugins import relative_path
from .store import MemberError

FOLDER = "skill-sources"
FILE_BYTES = 32 * 1024 * 1024
KEPT_DAYS = 14
_LINK = re.compile(r"(?:https?://\S+|www\.\S+|[\w.-]+/[\w.-]+(?:/[\w.\-~%]+)*/?)")
# A zip that is a document and not a folder of files: it is the file the owner handed over, never unpacked.
_DOCUMENTS = (".docx", ".pptx", ".xlsx", ".odt", ".ods", ".odp", ".epub", ".pages", ".numbers", ".key", ".jar", ".apk")

# The refusals of the direct import that mean "this is not in a skill's format" and not "this cannot be read": the document has no
# front matter, the source holds no SKILL.md, the address is a page and not a skill, the file is another kind of file.
_FORMAT = {("not_found", "no_skill"), ("source", "host"), ("source", "insecure"), ("source", "file_type"),
           ("source", "not_skill_file"), ("skill", "front_matter"), ("skill", "encoding")}


def kind_of(text):
    """What a pasted string is: `git` (a Git address: SSH, or https of a forge), `link` (a web address, `owner/repo`), `path`
    (a place on this computer) or `text`. A path or an address is never taken for the other, and neither for text."""
    one = text.strip() if isinstance(text, str) else ""
    if not one or "\n" in one or "\r" in one:
        return "text"
    try:
        if skill_git.address(one) is not None:
            return "git"
    except MemberError:
        return "git"
    if as_local(one).startswith("local:"):
        return "path" if not any(c.isspace() for c in one) or Path(one.strip("\"'")).exists() else "text"
    return "link" if _LINK.fullmatch(one) else "text"


def routed(params):
    """The request of the one box as the importer reads it: a pasted address or path is a source, any other text is text."""
    text = params.get("text")
    if set(params) - {"text", "access", "name"} or not isinstance(text, str):
        return params
    kind = kind_of(text)
    if kind == "text":
        return params
    one = text.strip()
    if kind == "git":
        where = skill_git.address(one)
        source = where.url
    else:
        source = as_local(one) if kind == "path" else ("https://" + one if one.startswith("www.") else one)
    return {**{k: v for k, v in params.items() if k != "text"}, "source": source}


def needs_agent(error):
    """Whether a refusal of the direct import says only that the material is no skill, so that Raphael looks at it with the owner."""
    return isinstance(error, MemberError) and (error.kind, error.detail.get("reason")) in _FORMAT


# --- where the material is put ---------------------------------------------------------------------------------------------


def folder_for(parent):
    """`parent/skill-sources`, made, with what is older than two weeks swept out of it."""
    root = Path(parent) / FOLDER
    root.mkdir(parents=True, exist_ok=True)
    cutoff = time.time() - KEPT_DAYS * 86400
    for child in root.iterdir():
        try:
            if child.is_dir() and not child.is_symlink() and child.stat().st_mtime < cutoff:
                shutil.rmtree(child, ignore_errors=True)
        except OSError:
            continue
    return root


def _label(text):
    cleaned = re.sub(r"[^\w.\- ]+", "-", PurePosixPath(str(text).replace("\\", "/")).name or "material", flags=re.UNICODE).strip(" .-")
    return (cleaned or "material")[:40]


def _new_folder(root, label):
    folder = root / f"{_label(label)}-{secrets.token_hex(3)}"
    folder.mkdir(parents=True)
    return folder


def _write(folder, entries):
    """Write `(path, bytes)` entries below `folder`; a path that leaves it, or one that cannot be a name, is left out."""
    written = 0
    for path, data in entries:
        try:
            clean = relative_path(path)
        except MemberError:
            continue
        target = folder / clean
        if folder.resolve() not in target.resolve().parents:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        written += 1
    return written


def unpacked(name, data):
    """`[(path, bytes)]` of an archive's files, without its single wrapping folder and without what a system leaves in it;
    None when it is no archive this importer opens. Each file and the whole are bounded."""
    from . import skill_sources

    if name.lower().endswith(_DOCUMENTS):
        return None
    try:
        with skill_sources._open_archive(name, data) as opened:
            if opened is None:
                return None
            entries, _, _, (describe, fetch) = opened
            kept = [(entry.removeprefix("./"), info) for entry, info in entries if not junk(entry.removeprefix("./"))]
            names = [entry for entry, _ in kept if entry not in (".", "")]
            tops = {entry.split("/")[0] for entry in names}
            wrapper = next(iter(tops)) + "/" if len(tops) == 1 and all("/" in entry for entry in names) else ""
            result, total = [], 0
            for entry, info in kept[:MAX_ARCHIVE_ENTRIES]:
                size = describe(info)
                if not isinstance(size, int) or size > FILE_BYTES or total + size > MAX_PACKAGE_BYTES:
                    continue
                path = entry[len(wrapper):] if entry.startswith(wrapper) else entry
                if path:
                    result.append((path, fetch(info)))
                    total += size
            return result
    except (MemberError, OSError, EOFError, ValueError):
        return None


def tree_of(path):
    """`[(relative path, bytes)]` of the files of a folder on this computer, bounded like an archive."""
    result, total = [], 0
    remaining = [MAX_SCAN_ENTRIES]
    for _, _, files in walk(path, remaining, hidden=True):
        for file, info in files:
            if info.st_size <= FILE_BYTES and total + info.st_size <= MAX_PACKAGE_BYTES and len(result) < MAX_ARCHIVE_ENTRIES:
                result.append((file.relative_to(path).as_posix(), file.read_bytes()))
                total += info.st_size
    return result


async def hand_over(params, parent, *, kept=None):
    """What the window needs to hand `params` to Raphael, which the direct import turned away: `{"kind", "label", ...}`.

    - `text`: pasted text that is no skill (the window sends it as its message, or as a file when it is long).
    - `file`: a file that is no archive of files (a PDF, a Word file, a note): the window attaches the file itself.
    - `link`: a web address; Raphael opens it with its own tools.
    - `path`: a file or a folder where it is on this computer, that Raphael reads there.
    - `folder`: material put where Raphael reads it: an archive's files, a dropped tree, a repository fetched by Git
      (with `address` when it was fetched). `kept` is the folder a Git address was fetched into already.
    """
    from . import skill_sources

    if "text" in params:
        return {"kind": "text", "label": "pasted text"}
    root = None

    def made(label):
        nonlocal root
        root = folder_for(parent)
        return _new_folder(root, label)

    if "file" in params:
        name = params["file"]["name"]
        data = await asyncio.to_thread(skill_sources.uploaded_bytes, params["file"])
        entries = await asyncio.to_thread(unpacked, name, data)
        if not entries:
            return {"kind": "file", "label": name}
        folder = made(re.sub(r"\.(zip|skill|tar\.gz|tgz|tar\.bz2|tar\.xz|tar)$", "", name, flags=re.I))
        await asyncio.to_thread(_write, folder, entries)
        return {"kind": "folder", "label": name, "path": str(folder)}
    if "files" in params:
        entries = await asyncio.to_thread(skill_sources.tree_entries, params["files"])
        tops = {path.split("/")[0] for path, _ in entries}
        wrapped = len(tops) == 1 and all("/" in path for path, _ in entries)
        label = tops.pop() if wrapped else "dropped files"
        if wrapped:
            entries = [(path.split("/", 1)[1], data) for path, data in entries]
        folder = made(label)
        await asyncio.to_thread(_write, folder, entries)
        return {"kind": "folder", "label": label, "path": str(folder)}
    source = params["source"].strip()
    if source.startswith("local:"):
        path = await asyncio.to_thread(skill_sources.local_path, source)
        if path.is_file():
            entries = await asyncio.to_thread(lambda: unpacked(path.name, path.read_bytes()) if path.stat().st_size <= MAX_PACKAGE_BYTES else None)
            if entries:
                folder = made(path.stem)
                await asyncio.to_thread(_write, folder, entries)
                return {"kind": "folder", "label": path.name, "path": str(folder)}
        return {"kind": "path", "label": path.name or str(path), "path": str(path)}
    if kept is not None:
        where = skill_git.address(source)
        return {"kind": "folder", "label": where.name, "path": str(kept), "address": where.url}
    # A GitHub repository that holds no skill is fetched too when git can (a link to a page is something to open, not to read here).
    from .skill_github import parse

    try:
        target = parse(source)
    except MemberError:
        target = None
    if target is not None and not target.file and not target.skill:
        where = skill_git.Address(f"https://github.com/{target.repo}.git", "github.com", target.repo.split("/")[1], "https")
        try:
            folder = await skill_git.fetch(where, await asyncio.to_thread(folder_for, parent))
            return {"kind": "folder", "label": target.repo, "path": str(folder), "address": f"https://github.com/{target.repo}"}
        except MemberError:
            pass
    return {"kind": "link", "label": source, "address": source if "://" in source else "https://" + source}

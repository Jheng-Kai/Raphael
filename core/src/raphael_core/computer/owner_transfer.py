"""What the owner hands a member's computer, and takes from it, through its screen: clipboard text and files.

The computer's VNC servers for a shared computer's screens (x0vncserver before TigerVNC 1.15) carry no clipboard, so text goes
through the computer's own driver (`clipboard_write`, `clipboard_read`) instead of the screen's cut text. A file goes into the
team folder, under its own name, never over a file that is there: the owner's drop and a member's own `copy_from_owner`
place it the same way (`hand_over`).
"""

import asyncio
import base64
import json
import os
import re
import secrets
import shutil
from pathlib import Path

from ..paths import local_storage_root
from .vm import SHARED, VmError

# The most characters of text the owner's paste or copy carries either way, the same bound as the paste's page.
CLIPBOARD_MAX = 1_000_000
# A computer on another machine has no folder on this PC: its file travels in one request over the engine.
REMOTE_FILE_MAX = 32 * 1024 * 1024
NAME_MAX = 200
# Names Windows keeps for devices, refused for a file in a folder that is also on this PC.
RESERVED = frozenset({"con", "prn", "aux", "nul", *(f"com{n}" for n in range(1, 10)), *(f"lpt{n}" for n in range(1, 10))})


def clipboard_text(result):
    """The plain text of the driver's `clipboard_read` answer: its structured content's `text`, or a text item of the answer
    that is a JSON object with a `text`. None when it holds no text."""
    if not isinstance(result, dict):
        return None
    found = [result.get("structuredContent")]
    for item in result.get("content") or []:
        if isinstance(item, dict) and item.get("type") == "text" and isinstance(item.get("text"), str):
            try:
                found.append(json.loads(item["text"]))
            except ValueError:
                pass
    for value in found:
        if isinstance(value, dict) and isinstance(value.get("text"), str):
            return value["text"]
    return None


def safe_name(name):
    """The name a dropped file gets in the team folder: its last part only, with no control characters and none that a
    Windows folder refuses, trimmed of the dots and spaces Windows drops, and short enough for any file system."""
    if type(name) is not str:
        raise ValueError("name")
    base = re.split(r"[\\/]", name)[-1]
    base = re.sub(r'[\x00-\x1f\x7f<>:"|?*]', "_", base).strip().rstrip(". ")
    stem, dot, suffix = base.rpartition(".")
    if len(base) > NAME_MAX:
        base = (stem[:NAME_MAX - len(suffix) - 1] + "." + suffix) if dot and stem and len(suffix) < 20 else base[:NAME_MAX]
    if not base or base in (".", "..") or base.split(".")[0].lower() in RESERVED:
        base = "_" + base if base not in ("", ".", "..") else "file"
    return base


def numbered(name):
    """`name`, then `name (2).ext`, `name (3).ext` and on: the names tried until one is free."""
    stem, dot, suffix = name.rpartition(".")
    if not dot or not stem:
        stem, suffix = name, ""
    yield name
    for number in range(2, 1000):
        yield f"{stem} ({number}){'.' + suffix if suffix else ''}"


def place_copy(source, root, name):
    """Copy the stored file `source` into the folder `root` under the first free name after `name`, and give that name. The
    copy is written beside it under a hidden name and then linked in, so nothing is replaced and no half file is ever seen
    under the real name. Blocking: run it in a thread."""
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    partial = root / f".raphael-{secrets.token_hex(6)}.part"
    try:
        with open(source, "rb") as reader, open(partial, "xb") as writer:
            shutil.copyfileobj(reader, writer, 1 << 20)
        for candidate in numbered(name):
            try:
                os.link(partial, root / candidate)
            except FileExistsError:
                continue
            return candidate
        raise OSError("no free name")
    finally:
        partial.unlink(missing_ok=True)


async def place_remote(vm, target, source, name):
    """A file for a computer on another machine, which has no folder on this PC: one write over the engine each name tried."""
    size = await asyncio.to_thread(lambda: Path(source).stat().st_size)
    if size > REMOTE_FILE_MAX:
        raise VmError("file_too_large")
    data = base64.b64encode(await asyncio.to_thread(Path(source).read_bytes)).decode("ascii")
    for candidate in numbered(name):
        answer = await vm.file_request(target, {"action": "write", "path": f"{SHARED}/{candidate}", "data": data, "expected": "absent"})
        if answer.get("error") == "changed":
            continue
        if "error" in answer:
            raise VmError("file_unavailable")
        return candidate
    raise VmError("file_unavailable")


async def hand_over(vm, target, source, name):
    """Copy the file `source` of this PC into `target`'s team folder under the first free name after `name`, and give that
    name: into the folder itself when it is on this PC, over the engine when the computer is on another machine."""
    if not target.remote and target.shared is not None:
        try:
            root = local_storage_root(target.shared)
        except ValueError:
            raise VmError("file_unavailable") from None
        return await asyncio.to_thread(place_copy, source, root, name)
    return await place_remote(vm, target, source, name)

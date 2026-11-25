"""Remembered work folders and the owner's Git controls."""

import asyncio
import hashlib
import os
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path, PurePosixPath, PureWindowsPath

from .protocol import RpcError, INTERNAL_ERROR, INVALID_PARAMS, invalid_params

GIT_SECONDS = 5
# A checkout writes every file that differs and may fetch large files (LFS), so it gets far longer than a read. A switch
# cut short by a read's limit had often already happened, and the owner was told it failed.
SWITCH_SECONDS = 120
SWITCH_SLOW = "Git did not finish switching branches in time"
SWITCH_FILTERS = "This repository runs its own Git filters. Switch branches in your own terminal."
# One switch at a time per repository: a second one started meanwhile would meet the first one's index lock. Per
# repository, because on Windows a Git killed at its limit can leave a child holding its pipes, and the thread waiting on
# them keeps its lock: that may hold up the same repository (whose index Git may still hold) but never another one.
_switching: dict[str, threading.Lock] = {}
_switching_guard = threading.Lock()


def _switch_lock(path):
    with _switching_guard:
        return _switching.setdefault(path_key(path), threading.Lock())
PROJECTS = "/home/cua/projects"
PROJECT_LIMIT = 50


def checked_path(value):
    if not isinstance(value, str):
        raise TypeError("A folder path must be text")
    value = value.strip()
    if (len(value) > 1000 or any(ord(char) < 32 for char in value)
            or not (PureWindowsPath(value).is_absolute() or PurePosixPath(value).is_absolute())):
        raise ValueError("A folder must be an absolute path without control characters")
    windows = PureWindowsPath(value)
    return str(windows if windows.is_absolute() else PurePosixPath(value))


def path_key(path):
    windows = PureWindowsPath(path)
    return str(windows).lower() if windows.is_absolute() else str(PurePosixPath(path))


def project_paths(paths, *, ignore_invalid=False):
    projects = {}
    for value in paths:
        try:
            path = checked_path(value)
        except (TypeError, ValueError):
            if ignore_invalid:
                continue
            raise
        projects.setdefault(path_key(path), path)
    return projects


def default_folders(member):
    from .paths import local_dir
    root = os.environ.get("RAPHAEL_DATA_DIR")
    if root:
        root = Path(root)
    else:
        try:
            root = local_dir()
        except RuntimeError:
            root = Path.home() / ".local" / "share" / "Raphael"
    key = hashlib.sha256(str(member).encode()).hexdigest()[:16]
    return root / "members" / "shared" / "members" / key, root / "team"


def choice(settings, member):
    chosen = settings.get("member_work_folder").get(str(member))
    if chosen:
        key = path_key(chosen)
        return next((path for path in settings.get("project_folders") if path_key(path) == key
                     and existing_folder(Path(path))), None)
    return None


def existing_folder(path):
    try:
        return path.is_dir()
    except OSError:
        return False


def work_folder(settings, member, folders=default_folders):
    return Path(choice(settings, member) or folders(member)[0])


def writable_folders(settings, member, folders=default_folders):
    return list(dict.fromkeys([*map(str, folders(member)), *(settings.get("project_folders") or [])]))


def project_names(projects, saved=None):
    """Reserve existing names before naming new projects, even for folders that are offline."""
    paths = project_paths(projects)
    aliases = {key: name for key, name in (saved or {}).items() if key in paths}
    used = set(aliases.values())
    for key, folder in paths.items():
        if key in aliases or folder.startswith("\\\\"):
            continue
        source = Path(folder)
        name = source.name or source.drive.rstrip(":\\/") or "root"
        if name == "..":
            try:
                name = source.resolve().name or "root"
            except (OSError, RuntimeError):
                continue
        alias = name
        if alias in used:
            digest = hashlib.sha256(key.encode()).hexdigest()[:8]
            alias = f"{name} ({digest})"
            while alias in used:
                alias += "_"
        aliases[key] = alias
        used.add(alias)
    return aliases


def project_mounts(projects, names=None):
    paths = project_paths(projects)
    names = project_names(paths.values()) if names is None else names
    mounts = []
    for key, folder in paths.items():
        # Docker Desktop cannot bind Windows network shares. Avoid probing them here.
        if folder.startswith("\\\\"):
            continue
        source = Path(folder)
        if key in names and source.is_absolute() and existing_folder(source):
            mounts.append((f"{PROJECTS}/{names[key]}", source))
    return tuple(mounts)


def head_branch(path):
    try:
        metadata = Path(path) / ".git"
        if metadata.is_file():
            with metadata.open(encoding="utf-8") as pointer:
                prefix, _, name = pointer.readline(4096).strip().partition(": ")
            if prefix != "gitdir":
                return ""
            metadata = metadata.parent / name
        with (metadata / "HEAD").open(encoding="utf-8") as head:
            line = head.readline(4096).strip()
        prefix = "ref: refs/heads/"
        return line[len(prefix):] if line.startswith(prefix) else ""
    except (OSError, ValueError):
        return ""


def _git(executable, path, deadline, *args):
    with tempfile.TemporaryDirectory(prefix="raphael-git-hooks-") as hooks:
        timeout = deadline - time.monotonic()
        if timeout <= 0:
            raise TimeoutError
        return subprocess.run([executable, "-c", f"core.hooksPath={hooks}", "-c", "core.fsmonitor=false",
                               "-C", str(path), *args], capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=timeout,
                              creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                              env={**os.environ, "GIT_TERMINAL_PROMPT": "0", "LC_ALL": "C"})


def info(path, deadline):
    folder = Path(path)
    exists = folder.is_dir()
    git = exists and (folder / ".git").exists()
    result = {"name": folder.name or path, "path": path, "exists": exists, "git": git, "branch": "", "branches": []}
    if not git:
        return result
    executable = shutil.which("git")
    if not executable:
        return {**result, "branch": head_branch(folder)}
    # One Git call lists the branches and marks the current one: `%(HEAD)` is `*` there and a space elsewhere (neither
    # can start a branch name). Starting Git can take a second on a busy PC, so every call saved counts.
    local = _git(executable, folder, deadline, "for-each-ref", "--format=%(HEAD)%(refname:short)", "refs/heads")
    if local.returncode:
        return {**result, "branch": head_branch(folder)}
    # Git ends each ref with a newline; a branch name may hold other line breaks (U+2028), so split on "\n" alone.
    lines = [line.removesuffix("\r") for line in local.stdout.split("\n")]
    lines = [line for line in lines if len(line) > 1]
    current = next((line[1:] for line in lines if line.startswith("*")), "")
    # A detached HEAD and a branch with no commit yet are marked nowhere; HEAD itself names the second.
    return {**result, "branch": current or head_branch(folder), "branches": [line[1:] for line in lines]}


def _switch(path, branch, deadline):
    executable = shutil.which("git")
    if executable is None:
        raise invalid_params("Git is unavailable")
    filters = _git(executable, path, deadline, "config", "--show-scope", "--name-only", "--get-regexp",
                   r"^filter\..*\.(clean|smudge|process)$")
    if filters.returncode not in (0, 1):
        raise invalid_params("Git could not read the repository's filters")
    if any(line.partition("\t")[0] in ("local", "worktree") for line in filters.stdout.splitlines()):
        raise invalid_params(SWITCH_FILTERS)
    result = _git(executable, path, deadline, "switch", "--", branch)
    if result.returncode:
        lines = (result.stderr.strip() or result.stdout.strip()).splitlines()
        error = next((line for line in lines if line.startswith(("error:", "fatal:"))), lines[0] if lines else "")
        raise RpcError(INVALID_PARAMS, error or "Git could not switch branches")
    try:
        return info(path, deadline)
    except (TimeoutError, subprocess.TimeoutExpired):
        # The switch already succeeded. Preserve its result even if listing refs takes too long.
        return {"name": Path(path).name or path, "path": path, "exists": True, "git": True,
                "branch": head_branch(path), "branches": []}


async def _in_thread(call, *args, seconds=None, slow="Git did not respond within five seconds", grace=0):
    # `grace` lets the thread's own deadline end a call first, so that the answer says what Git did rather than
    # leaving it running unseen.
    seconds = GIT_SECONDS if seconds is None else seconds
    try:
        return await asyncio.wait_for(asyncio.to_thread(call, *args, time.monotonic() + seconds), seconds + grace)
    except (TimeoutError, subprocess.TimeoutExpired):
        raise RpcError(INTERNAL_ERROR, slow) from None
    except OSError:
        raise RpcError(INTERNAL_ERROR, "The folder could not be read") from None


def rpc_path(params):
    try:
        return checked_path(params.get("path"))
    except (TypeError, ValueError) as error:
        raise invalid_params(str(error)) from None


async def folder_info(params):
    return await _in_thread(info, rpc_path(params))


async def switch_branch(settings, params):
    path = rpc_path(params)
    if not any(path_key(project) == path_key(path) for project in settings.get("project_folders")):
        raise invalid_params("This folder is not a remembered project")
    branch = params.get("branch")
    if not isinstance(branch, str) or not branch or len(branch) > 1000 or any(ord(char) < 32 for char in branch):
        raise invalid_params("Choose a local branch")
    # Require a local branch, avoiding Git's remote guessing and special previous-branch syntax.
    return await _in_thread(_switch_local, path, branch, seconds=SWITCH_SECONDS, slow=SWITCH_SLOW, grace=5)


def _switch_local(path, branch, deadline):
    lock = _switch_lock(path)
    if not lock.acquire(timeout=max(0.0, deadline - time.monotonic())):
        raise TimeoutError
    try:
        folder = info(path, deadline)
        if branch not in folder["branches"]:
            raise invalid_params("Choose an available local branch")
        return _switch(path, branch, deadline)
    finally:
        lock.release()

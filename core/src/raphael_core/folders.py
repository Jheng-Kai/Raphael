"""Remembered work folders and the owner's Git controls."""

import asyncio
import hashlib
import os
import shutil
import subprocess
import time
from pathlib import Path, PurePosixPath, PureWindowsPath

from .protocol import RpcError, INTERNAL_ERROR, INVALID_PARAMS, invalid_params

GIT_SECONDS = 5
PROJECTS = "/home/cua/projects"


def checked_path(value):
    if not isinstance(value, str):
        raise TypeError("A folder path must be text")
    value = value.strip()
    if (len(value) > 1000 or any(ord(char) < 32 for char in value)
            or not (PureWindowsPath(value).is_absolute() or PurePosixPath(value).is_absolute())):
        raise ValueError("A folder must be an absolute path without control characters")
    return value


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
    return chosen if chosen in settings.get("project_folders") else None


def work_folder(settings, member, folders=default_folders):
    return Path(choice(settings, member) or folders(member)[0])


def writable_folders(settings, member, folders=default_folders):
    return list(dict.fromkeys([*map(str, folders(member)), *(settings.get("project_folders") or [])]))


def project_mounts(projects):
    """Assign ordered guest names. A missing project keeps its name reserved."""
    names = set()
    mounts = []
    for folder in projects:
        source = Path(folder)
        if not source.is_absolute():
            continue
        try:
            named = source.resolve() if source.name == ".." else source
        except (OSError, RuntimeError):
            continue
        name = named.name or named.drive.rstrip(":\\/") or "root"
        guest = name
        number = 2
        while guest in names:
            guest = f"{name} ({number})"
            number += 1
        names.add(guest)
        try:
            if source.is_dir():
                mounts.append((f"{PROJECTS}/{guest}", source))
        except OSError:
            continue
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
    timeout = deadline - time.monotonic()
    if timeout <= 0:
        raise TimeoutError
    return subprocess.run([executable, "-C", str(path), *args], capture_output=True, text=True,
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
    current = _git(executable, folder, deadline, "branch", "--show-current")
    local = _git(executable, folder, deadline, "for-each-ref", "--format=%(refname:short)", "refs/heads")
    return {**result, "branch": current.stdout.strip() if current.returncode == 0 else head_branch(folder),
            "branches": local.stdout.splitlines() if local.returncode == 0 else []}


def _switch(path, branch, deadline):
    executable = shutil.which("git")
    if executable is None:
        raise invalid_params("Git is unavailable")
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


async def _in_thread(call, *args):
    try:
        return await asyncio.wait_for(asyncio.to_thread(call, *args, time.monotonic() + GIT_SECONDS), GIT_SECONDS)
    except (TimeoutError, subprocess.TimeoutExpired):
        raise RpcError(INTERNAL_ERROR, "Git did not respond within five seconds") from None
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
    if path not in settings.get("project_folders"):
        raise invalid_params("This folder is not a remembered project")
    branch = params.get("branch")
    if not isinstance(branch, str) or not branch or len(branch) > 1000 or any(ord(char) < 32 for char in branch):
        raise invalid_params("Choose a local branch")
    # Require a local branch, avoiding Git's remote guessing and special previous-branch syntax.
    return await _in_thread(_switch_local, path, branch)


def _switch_local(path, branch, deadline):
    folder = info(path, deadline)
    if branch not in folder["branches"]:
        raise invalid_params("Choose an available local branch")
    return _switch(path, branch, deadline)

"""The CLI tools' own records of the members' runs, and how long they are kept.

Claude Code keeps a folder of records for every working folder it ran in (`<config>/projects/<name>`), named after that
folder's path with each character that is not a letter or a digit made a `-`. Raphael runs it in folders of its own:
a member's workspace under `workspace_root` (`<member>/claude`, and `<member>/<conversation>/claude` before a member had
one), and a private folder in the system's temporary folder (`PRIVATE_PREFIX`) that is removed when the run ends.
Claude Code removes none of the folders those runs leave behind (about 1,200 on one PC in three weeks), and nothing
else did either.

`CliRecords` removes, at most once a day and never while that member has a run under way, what no conversation can
resume any more: a session (`<id>.jsonl` and its `<id>` folder) that no database of Raphael on this PC records and
that has not changed for `KEEP_S`, then a records folder left with nothing in it but an empty `memory` folder. Only a
folder whose name is exactly one of those shapes is looked at, so the owner's own projects never match. There is no
Recycle Bin helper in the core: what goes is deleted, and the log says how many, never which.
"""

import asyncio
import logging
import os
import re
import shutil
import sqlite3
import tempfile
import time
from collections import Counter
from contextlib import contextmanager
from pathlib import Path

from .native_diagnostics import directory as native_directory
from .process import PRIVATE_PREFIX

logger = logging.getLogger(__name__)

# A week: a session nobody can resume stays this long for a look at a recent run, as a computer keeps its background
# jobs' logs (`computer.vm.scratch_args`). A run lasts six hours at most (`computer.vm.BACKGROUND_S`), so nothing that old
# is still being written.
KEEP_S = 7 * 86_400
SWEEP_EVERY_S = 86_400
CHECK_EVERY_S = 3600
SESSION = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
# The tables that say which native session a conversation, a room thread or a member resumes (agent.cli.loop.Sessions,
# background.cli.RoomCliSessions).
SESSION_TABLES = ("agent_conversation_cli_sessions", "agent_cli_sessions", "room_cli_sessions")
# The data folders of the release and of a development build (app/src-tauri/src/identity.rs). Both run their members in
# the same workspaces, so a session either one records is kept.
IDENTITY_FOLDERS = ("Raphael", "Raphael Dev")
# Member id -> runs of that member's CLI under way in this core (`at_work`).
ACTIVE = Counter()


@contextmanager
def at_work(member_id):
    """Count a run of a member's CLI while it goes on: its records are not swept meanwhile."""
    ACTIVE[member_id] += 1
    try:
        yield
    finally:
        ACTIVE[member_id] -= 1
        if ACTIVE[member_id] <= 0:
            del ACTIVE[member_id]


def workspace_root(home):
    """Where the members' CLI workspaces are (agent.cli.loop): one folder per member under the owner's `.raphael`."""
    return native_directory("workspaces") or Path(home) / ".raphael" / "cli-workspaces"


def project_name(path):
    """The name of Claude Code's records folder for a working folder."""
    return re.sub(r"[^A-Za-z0-9]", "-", str(path))


def app_folders(projects, root, temp):
    """(folder, member id) of each records folder of Raphael's own runs: a member's workspace, or (member None) a run's
    private folder. A conversation part is a number, or words and numbers joined by dashes (`room-task-12`)."""
    member = re.compile(re.escape(project_name(root)) + r"-(\d+)-(?:[a-z]+(?:-[a-z]+)*-)?(?:\d+(?:-\d+)?-)?claude")
    # tempfile names a folder with eight of a-z, 0-9 and `_`; the name of its records folder has a `-` for the `_`.
    private = re.compile(re.escape(project_name(Path(temp) / PRIVATE_PREFIX)) + r"[a-z0-9-]{8}")
    try:
        folders = sorted(projects.iterdir())
    except OSError:
        return []
    found = []
    for folder in folders:
        if folder.is_symlink() or not folder.is_dir():
            continue
        if match := member.fullmatch(folder.name):
            found.append((folder, int(match[1])))
        elif private.fullmatch(folder.name):
            found.append((folder, None))
    return found


def recorded(conn):
    """The ids of every native session a conversation, room thread or member of this database resumes."""
    tables = {row[0] for row in conn.execute("SELECT lower(name) FROM main.sqlite_master WHERE type IN ('table', 'view')")}
    ids = set()
    for table in SESSION_TABLES:
        if table in tables:
            ids.update(row[0] for row in conn.execute(f"SELECT session_id FROM main.{table}"))
    return ids


def other_databases(data_dir):
    """The database of the other build on this PC, when there is one: its members run in the same workspaces."""
    data_dir = Path(data_dir)
    if data_dir.name not in IDENTITY_FOLDERS:
        return []
    paths = []
    for name in IDENTITY_FOLDERS:
        if name == data_dir.name:
            continue
        path = data_dir.parent / name / "raphael.db"
        try:
            path.lstat()
        except FileNotFoundError:
            continue
        paths.append(path)
    return paths


def recorded_elsewhere(paths):
    """The session ids the other databases record, read only; None when one of them cannot be read."""
    ids = set()
    for path in paths:
        try:
            conn = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True, timeout=2)
            try:
                ids |= recorded(conn)
            finally:
                conn.close()
        except sqlite3.Error:
            return None
    return ids


def _newest(path):
    """When anything in `path` last changed."""
    newest = path.lstat().st_mtime
    if path.is_dir() and not path.is_symlink():
        for folder, _, files in os.walk(path):
            for name in files:
                try:
                    newest = max(newest, os.lstat(os.path.join(folder, name)).st_mtime)
                except OSError:
                    pass
            newest = max(newest, os.lstat(folder).st_mtime)
    return newest


def sweep(projects, root, temp, keep, *, now, busy=lambda member: False, members=True, keep_s=KEEP_S):
    """Remove from the records folders of Raphael's runs what no conversation can resume (see the module). `keep` is
    the session ids a database records; `members` false leaves every member's folder alone (another database could not
    be read). Returns (sessions removed, folders removed)."""
    cutoff = now - keep_s
    sessions = folders = 0
    for folder, member in app_folders(projects, root, temp):
        if member is not None and (not members or busy(member)):
            continue
        if member is None and (Path(temp) / (PRIVATE_PREFIX + folder.name[-8:].replace("-", "_"))).exists():
            continue  # its run is still under way
        try:
            quiet = folder.lstat().st_mtime < cutoff
            entries = list(folder.iterdir())
        except OSError:
            continue
        removable, kept = [], False
        for entry in entries:
            stem = entry.name.removesuffix(".jsonl")
            if entry.is_symlink():
                kept = True
            elif SESSION.fullmatch(stem) and entry.is_dir() == (stem == entry.name):
                if stem in keep or _newest(entry) >= cutoff:
                    kept = True
                else:
                    removable.append(entry)
            elif entry.name == "memory" and entry.is_dir() and not any(entry.iterdir()):
                quiet = quiet and entry.lstat().st_mtime < cutoff
            else:
                kept = True  # anything else (a memory the member wrote, a file Claude Code added) stays
        for entry in removable:
            try:
                if entry.is_dir():
                    shutil.rmtree(entry)
                else:
                    entry.unlink()
                    sessions += 1
            except OSError:
                kept = True
        if not kept and quiet:
            try:
                if (folder / "memory").is_dir():
                    (folder / "memory").rmdir()
                folder.rmdir()
                folders += 1
            except OSError:
                pass  # something arrived meanwhile: the folder stays
    return sessions, folders


class CliRecords:
    """Runs `sweep` over Claude Code's records of the members' runs at most once a day (the time of the last one is the
    stamp file's), from the core's deferred start until it closes."""

    def __init__(self, conn, home, data_dir, *, claude_folder=None, clock=time.time, temp=None):
        self.conn, self.data_dir, self.clock = conn, Path(data_dir), clock
        self.home, self.temp = Path(home), temp
        self.projects = Path(claude_folder or self.home / ".claude") / "projects"
        self.stamp = self.data_dir / "cli-records-swept"
        self.task = None

    def due(self):
        try:
            return self.clock() - self.stamp.stat().st_mtime >= SWEEP_EVERY_S
        except OSError:
            return True

    async def sweep_once(self):
        """One sweep, when one is due: the database is read here, on its own thread, and the folders in another."""
        if not self.due():
            return None
        try:
            keep = recorded(self.conn)
        except sqlite3.Error as error:
            logger.warning("The members' CLI records were not swept (%s)", type(error).__name__)
            return None

        def work():
            elsewhere = recorded_elsewhere(other_databases(self.data_dir))
            if elsewhere is None:
                return None
            return sweep(self.projects, workspace_root(self.home), self.temp or tempfile.gettempdir(), keep | elsewhere,
                         now=self.clock(), busy=lambda member: ACTIVE.get(member, 0) > 0)
        removed = await asyncio.to_thread(work)
        if removed is None:
            logger.warning("The members' CLI records were not swept (another build's database could not be read)")
            return None
        self.stamp.touch()
        if any(removed):
            logger.info("Removed %d old CLI sessions and %d empty CLI record folders of the members' runs", *removed)
        return removed

    def start(self):
        if self.task is None:
            self.task = asyncio.create_task(self._run())

    async def _run(self):
        while True:
            try:
                await self.sweep_once()
            except Exception as error:
                logger.warning("The members' CLI records were not swept (%s)", type(error).__name__)
            await asyncio.sleep(CHECK_EVERY_S)

    async def aclose(self):
        if self.task is not None:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
            self.task = None

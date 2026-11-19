"""Claude Code's records of the members' runs, swept in temporary folders: never the records of whoever runs the tests."""

import os
import sqlite3
from contextlib import closing
from pathlib import PureWindowsPath

import pytest

from raphael_core.agent.cli import records
from raphael_core.agent.cli.records import CliRecords, app_folders, other_databases, project_name, recorded_elsewhere, sweep

DAY = 86_400
NOW = 1_800_000_000
OLD, FRESH = NOW - 8 * DAY, NOW - DAY
# The shapes of a Windows profile, only as names: nothing here is ever looked up on disk.
HOME = PureWindowsPath(r"C:\Users\owner")
ROOT = HOME / ".raphael" / "cli-workspaces"
TEMP = HOME / "AppData" / "Local" / "Temp"
SESSION, RECORDED, OTHER = ("0b6c2f1e-6d4a-4c1b-9a51-1f0e7d2c3b4a", "5e9d1c2b-3a4f-4e6d-8b7c-0a1b2c3d4e5f",
                            "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d")


def touch(path, when, text=""):
    path.parent.mkdir(parents=True, exist_ok=True)
    if text is not None:
        path.write_text(text, encoding="utf-8")
    os.utime(path, (when, when))


def folder(projects, working, *, sessions=(), memory=None, when=OLD):
    """A records folder for the working folder `working`: its sessions as (id, when), and its memory folder (None for
    an empty one, text for one with a note in it)."""
    where = projects / project_name(working)
    for session, changed in sessions:
        touch(where / f"{session}.jsonl", changed, "{}\n")
    (where / "memory").mkdir(parents=True, exist_ok=True)
    if memory is not None:
        touch(where / "memory" / "MEMORY.md", when, memory)
    os.utime(where / "memory", (when, when))
    os.utime(where, (when, when))
    return where


# Raphael's own runs, as the code names their working folders: a member's workspace (agent.cli.loop), with the
# conversation part every caller gives (a conversation's number, a room thread, a task, a memory pass) and the one an
# earlier layout left, and a run's private folder (agent.cli.process.PrivateFiles).
OWN = [(ROOT / "3" / "claude", 3), (ROOT / "12" / "7" / "claude", 12), (ROOT / "4" / "room-task-295" / "claude", 4),
       (ROOT / "1" / "room-1-2" / "claude", 1), (ROOT / "4" / "memory-4" / "claude", 4),
       (ROOT / "8" / "room-listen-8" / "claude", 8), (TEMP / "raphael-cli-ab_cd1e2", None), (TEMP / "raphael-cli-_x7k2pq9", None)]
# The owner's own projects, and the folders that only look alike.
NOT_OURS = [PureWindowsPath(r"D:\Documentation\github_repos\Raphael"), PureWindowsPath(r"D:\Documentation\github_repos\Raphael\.worktrees\y-image-workflow"),
            HOME, HOME / ".raphael", ROOT, ROOT / "models", ROOT / "claude", ROOT / "3" / "codex",
            TEMP / "claude" / "a80e" / "scratchpad" / "run" / ".raphael" / "cli-workspaces" / "3" / "claude",
            TEMP / "raphael-cli-toolongname", TEMP / "raphael-cli-abc", TEMP / "other" / "raphael-cli-ab_cd1e2",
            PureWindowsPath(r"D:\Projects\.raphael\cli-workspaces\3\claude")]


def test_only_the_records_of_raphaels_own_runs_match(tmp_path):
    projects = tmp_path / "projects"
    for working, _ in OWN:
        folder(projects, working)
    for working in NOT_OURS:
        folder(projects, working)
    found = {(path.name, member) for path, member in app_folders(projects, ROOT, TEMP)}
    assert found == {(project_name(working), member) for working, member in OWN}


def test_a_session_no_conversation_resumes_goes_after_a_week_and_every_other_stays(tmp_path):
    projects = tmp_path / "projects"
    where = folder(projects, ROOT / "3" / "claude", memory="- the member's own note",
                   sessions=[(SESSION, OLD), (RECORDED, OLD), (OTHER, FRESH)])
    touch(where / SESSION / "subagents" / "agent-1.jsonl", OLD, "{}\n")
    for part in (where / SESSION / "subagents", where / SESSION):
        os.utime(part, (OLD, OLD))
    touch(where / "notes.txt", OLD, "a file Claude Code may add")

    assert sweep(projects, ROOT, tmp_path / "Temp", {RECORDED}, now=NOW) == (1, 0)

    assert not (where / f"{SESSION}.jsonl").exists() and not (where / SESSION).exists()
    assert (where / f"{RECORDED}.jsonl").exists() and (where / f"{OTHER}.jsonl").exists()
    assert (where / "memory" / "MEMORY.md").exists() and (where / "notes.txt").exists()


def test_a_folder_left_with_an_empty_memory_goes_but_never_during_a_run_of_that_member(tmp_path):
    projects = tmp_path / "projects"
    idle = folder(projects, ROOT / "5" / "claude", sessions=[(SESSION, OLD)])
    working = folder(projects, ROOT / "6" / "claude", sessions=[(SESSION, OLD)])
    noted = folder(projects, ROOT / "7" / "claude", sessions=[(SESSION, OLD)], memory="kept")
    recent = folder(projects, ROOT / "9" / "4" / "claude", when=FRESH)

    assert sweep(projects, ROOT, tmp_path / "Temp", set(), now=NOW, busy=lambda member: member == 6) == (2, 1)

    assert not idle.exists()
    assert (working / f"{SESSION}.jsonl").exists()  # its run goes on: nothing of it is touched
    assert noted.exists() and (noted / "memory" / "MEMORY.md").exists() and not (noted / f"{SESSION}.jsonl").exists()
    assert recent.exists()


def test_a_private_run_folder_goes_unless_its_run_is_under_way(tmp_path):
    projects, temp = tmp_path / "projects", tmp_path / "Temp"
    gone = folder(projects, temp / "raphael-cli-ab_cd1e2")
    running = folder(projects, temp / "raphael-cli-_x7k2pq9")
    (temp / "raphael-cli-_x7k2pq9").mkdir(parents=True)  # the run's own folder is still there

    assert sweep(projects, ROOT, temp, set(), now=NOW) == (0, 1)

    assert not gone.exists() and running.exists()


def test_the_owners_own_projects_are_never_touched(tmp_path):
    projects = tmp_path / "projects"
    theirs = [folder(projects, working, sessions=[(SESSION, OLD)]) for working in NOT_OURS]
    before = sorted(str(path.relative_to(projects)) for path in projects.rglob("*"))

    assert sweep(projects, ROOT, TEMP, set(), now=NOW) == (0, 0)

    assert sorted(str(path.relative_to(projects)) for path in projects.rglob("*")) == before
    assert all((path / f"{SESSION}.jsonl").exists() for path in theirs)


def test_without_another_builds_sessions_the_members_folders_are_left_alone(tmp_path):
    projects = tmp_path / "projects"
    member = folder(projects, ROOT / "3" / "claude", sessions=[(SESSION, OLD)])
    private = folder(projects, tmp_path / "Temp" / "raphael-cli-ab_cd1e2")

    assert sweep(projects, ROOT, tmp_path / "Temp", set(), now=NOW, members=False) == (0, 1)

    assert (member / f"{SESSION}.jsonl").exists() and not private.exists()


def database(path, sessions, table="agent_conversation_cli_sessions"):
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute(f"CREATE TABLE {table} (session_id TEXT)")
    conn.executemany(f"INSERT INTO {table} VALUES (?)", [(session,) for session in sessions])
    conn.commit()
    conn.close()


def test_a_session_the_other_build_records_is_kept_and_an_unreadable_database_keeps_them_all(tmp_path):
    roaming = tmp_path / "Roaming"
    database(roaming / "Raphael" / "raphael.db", [RECORDED], table="room_cli_sessions")
    (roaming / "Raphael Dev").mkdir()
    assert other_databases(roaming / "Raphael Dev") == [roaming / "Raphael" / "raphael.db"]
    assert other_databases(tmp_path / "run") == []  # a run kept apart has no other build
    assert recorded_elsewhere(other_databases(roaming / "Raphael Dev")) == {RECORDED}
    (roaming / "Raphael" / "raphael.db").write_bytes(b"not a database" * 100)
    assert recorded_elsewhere(other_databases(roaming / "Raphael Dev")) is None


async def test_the_sweep_runs_at_most_once_a_day_and_reads_what_the_database_resumes(tmp_path, monkeypatch):
    data = tmp_path / "Roaming" / "Raphael Dev"
    data.mkdir(parents=True)
    monkeypatch.setattr(records, "native_directory", lambda name: None)
    projects = tmp_path / "claude" / "projects"
    where = folder(projects, ROOT / "3" / "claude", sessions=[(SESSION, OLD), (RECORDED, OLD)])
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE agent_conversation_cli_sessions (conversation_id INTEGER, brain TEXT, session_id TEXT)")
    conn.execute("INSERT INTO agent_conversation_cli_sessions VALUES (1, 'cli:claude:opus', ?)", (RECORDED,))
    clock = [NOW]
    # The owner's home only names the workspaces; the records are read from the test's own folder.
    sweeper = CliRecords(conn, HOME, data, clock=lambda: clock[0], temp=tmp_path / "Temp", claude_folder=tmp_path / "claude")

    assert await sweeper.sweep_once() == (1, 0)
    assert not (where / f"{SESSION}.jsonl").exists() and (where / f"{RECORDED}.jsonl").exists()
    os.utime(sweeper.stamp, (NOW, NOW))
    assert await sweeper.sweep_once() is None  # not again the same day
    clock[0] = NOW + DAY
    assert await sweeper.sweep_once() == (0, 0)


@pytest.mark.parametrize("unreadable", ["locked", "incomplete"])
async def test_a_failed_database_read_keeps_every_record_and_retries_the_same_day(tmp_path, monkeypatch, unreadable):
    roaming = tmp_path / "Roaming"
    current = roaming / "Raphael Dev" / "raphael.db"
    other = roaming / "Raphael" / "raphael.db"
    database(current, [RECORDED])
    database(other, [OTHER], table="room_cli_sessions")
    monkeypatch.setattr(records, "native_directory", lambda name: None)
    projects = tmp_path / "claude" / "projects"
    temp = tmp_path / "Temp"
    member = folder(projects, ROOT / "3" / "claude", sessions=[(SESSION, OLD), (RECORDED, OLD), (OTHER, OLD)])
    private = folder(projects, temp / "raphael-cli-ab_cd1e2", sessions=[(SESSION, OLD)])

    with closing(sqlite3.connect(current)) as conn, closing(sqlite3.connect(other)) as blocked:
        sweeper = CliRecords(conn, HOME, current.parent, clock=lambda: NOW, temp=temp, claude_folder=projects.parent)
        if unreadable == "locked":
            blocked.execute("BEGIN EXCLUSIVE")
        else:
            blocked.execute("ALTER TABLE room_cli_sessions RENAME COLUMN session_id TO old_id")
        assert await sweeper.sweep_once() is None
        assert not sweeper.stamp.exists()
        assert all((member / f"{session}.jsonl").exists() for session in (SESSION, RECORDED, OTHER))
        assert (private / f"{SESSION}.jsonl").exists()

        if unreadable == "locked":
            blocked.rollback()
        else:
            blocked.execute("ALTER TABLE room_cli_sessions RENAME COLUMN old_id TO session_id")
        assert await sweeper.sweep_once() == (2, 1)
        assert sweeper.stamp.exists()
        assert (member / f"{RECORDED}.jsonl").exists() and (member / f"{OTHER}.jsonl").exists()
        assert not (member / f"{SESSION}.jsonl").exists() and not private.exists()


def test_a_member_at_work_is_counted_until_its_run_ends():
    with records.at_work(41):
        with records.at_work(41):
            assert records.ACTIVE[41] == 2
        assert records.ACTIVE[41] == 1
    assert 41 not in records.ACTIVE


def test_the_records_folder_is_named_as_claude_code_names_it():
    assert project_name(PureWindowsPath(r"C:\Users\owner\.raphael\cli-workspaces\3\claude")) == "C--Users-owner--raphael-cli-workspaces-3-claude"
    assert project_name("/Users/owner/.raphael/cli-workspaces/3/claude") == "-Users-owner--raphael-cli-workspaces-3-claude"

"""Project migration and owner Git operations against isolated folders."""

import json
import shutil
import sqlite3
import subprocess
from pathlib import Path

import pytest

from raphael_core import folders
from raphael_core.brain import db
from raphael_core.brain.settings import SettingsStore
from raphael_core.protocol import RpcError


def test_migration_preserves_projects_and_members_choices_without_touching_files(tmp_path, monkeypatch):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    with monkeypatch.context() as old:
        old.setattr(db, "LATEST_VERSION", 98)
        db.migrate(conn)
    output, first, second = [str(tmp_path / name) for name in ("Deliveries", "First", "Second")]
    Path(output).mkdir()
    saved = Path(output) / "report.txt"
    saved.write_text("keep", encoding="utf-8")
    with conn:
        conn.executemany("INSERT INTO settings (key, value) VALUES (?, ?)", [
            ("owner_output_folder", json.dumps(output)),
            ("member_write_folders", json.dumps({"1": [first, output, ""], "3": [second, first], "5": []})),
        ])
    db.migrate(conn)
    db.migrate(conn)
    settings = SettingsStore(conn)
    assert settings.get("project_folders") == [output, first, second]
    assert settings.get("member_work_folder") == {"1": first, "3": second}
    assert folders.work_folder(settings, 5, lambda _: (tmp_path / "own", tmp_path / "team")) == tmp_path / "own"
    assert saved.read_text(encoding="utf-8") == "keep"
    assert list(tmp_path.iterdir()) == [Path(output)]

    settings.set("project_folders", [output, second])
    assert settings.get("member_work_folder") == {"3": second}
    with pytest.raises(ValueError, match="remembered project"):
        settings.set("member_work_folder", {"1": first})
    assert saved.is_file()
    conn.close()


def test_project_mount_name_cannot_be_a_parent_directory(tmp_path):
    project = tmp_path / "Project"
    (project / "child").mkdir(parents=True)
    source = project / "child" / ".."
    assert folders.project_mounts([str(source)]) == (("/home/cua/projects/Project", source),)


@pytest.mark.parametrize("old_members", ["null", "[]", "false", "not JSON"])
def test_project_migration_tolerates_invalid_old_settings(monkeypatch, old_members):
    with sqlite3.connect(":memory:") as conn:
        conn.row_factory = sqlite3.Row
        with monkeypatch.context() as old:
            old.setattr(db, "LATEST_VERSION", 98)
            db.migrate(conn)
        conn.executemany("INSERT INTO settings (key, value) VALUES (?, ?)", [
            ("owner_output_folder", '{"invalid": true}'), ("member_write_folders", old_members),
        ])
        db.migrate(conn)
        assert conn.execute("PRAGMA user_version").fetchone()[0] == db.LATEST_VERSION
        assert SettingsStore(conn).get("project_folders") == []
        assert SettingsStore(conn).get("member_work_folder") == {}
    conn.close()


def test_project_migration_skips_invalid_paths_in_old_member_lists(monkeypatch, tmp_path):
    path = str(tmp_path / "Repo")
    with sqlite3.connect(":memory:") as conn:
        conn.row_factory = sqlite3.Row
        with monkeypatch.context() as old:
            old.setattr(db, "LATEST_VERSION", 98)
            db.migrate(conn)
        conn.executemany("INSERT INTO settings (key, value) VALUES (?, ?)", [
            ("owner_output_folder", "42"),
            ("member_write_folders", json.dumps({"1": [None, 42, [], path + "/", {"path": path}], "2": path})),
        ])
        db.migrate(conn)
        assert SettingsStore(conn).get("project_folders") == [path]
        assert SettingsStore(conn).get("member_work_folder") == {"1": path}
    conn.close()


def test_unc_projects_are_skipped_before_the_filesystem_is_probed(monkeypatch):
    def unexpected_probe(path):
        pytest.fail(f"Probed the network path {path}")

    monkeypatch.setattr(folders, "existing_folder", unexpected_probe)
    assert folders.project_mounts([r"\\server\share\Repo", "//server/share/Other"]) == ()


@pytest.fixture
def repository(tmp_path, monkeypatch):
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(tmp_path / "gitconfig"))
    executable = shutil.which("git")
    assert executable is not None
    repo = tmp_path / "Repo"
    repo.mkdir()

    def git(*args):
        return subprocess.run([executable, "-C", str(repo), *args], capture_output=True, text=True, check=True)

    git("init", "-b", "main")
    git("config", "user.name", "Test Owner")
    git("config", "user.email", "test@example.invalid")
    git("config", "commit.gpgsign", "false")
    tracked = repo / "tracked.txt"
    tracked.write_text("main", encoding="utf-8")
    git("add", "tracked.txt")
    git("commit", "-m", "Main")
    git("switch", "-c", "draft")
    tracked.write_text("draft", encoding="utf-8")
    git("commit", "-am", "Draft")
    git("switch", "main")
    return repo


async def test_folder_info_uses_git_and_handles_plain_missing_and_no_cli(repository, monkeypatch):
    path = str(repository)
    assert await folders.folder_info({"path": path}) == {
        "name": "Repo", "path": path, "exists": True, "git": True, "branch": "main", "branches": ["draft", "main"],
    }
    plain = str(repository.parent)
    plain_info = await folders.folder_info({"path": plain})
    assert plain_info["exists"] and not plain_info["git"] and plain_info["branches"] == []
    missing = await folders.folder_info({"path": str(repository / "missing")})
    assert not missing["exists"] and not missing["git"]
    monkeypatch.setattr(folders.shutil, "which", lambda _: None)
    fallback = await folders.folder_info({"path": path})
    assert fallback["git"] and fallback["branch"] == "main" and fallback["branches"] == []


async def test_switch_branch_requires_a_project_and_preserves_gits_dirty_tree_error(conn, repository):
    settings = SettingsStore(conn)
    path = str(repository)
    params = {"path": path, "branch": "draft"}
    with pytest.raises(RpcError, match="not a remembered project"):
        await folders.switch_branch(settings, params)
    settings.set("project_folders", [path])
    switched = await folders.switch_branch(settings, params)
    assert switched["branch"] == "draft"
    assert switched["branches"] == ["draft", "main"]
    tracked = repository / "tracked.txt"
    tracked.write_text("uncommitted", encoding="utf-8")
    with pytest.raises(RpcError, match="error: Your local changes"):
        await folders.switch_branch(settings, {"path": path, "branch": "main"})
    assert tracked.read_text(encoding="utf-8") == "uncommitted"
    assert (await folders.folder_info({"path": path}))["branch"] == "draft"


async def test_switch_branch_ignores_checkout_hooks(conn, repository):
    settings = SettingsStore(conn)
    settings.set("project_folders", [str(repository)])
    hook = repository / ".git" / "hooks" / "post-checkout"
    hook.write_bytes(b"#!/bin/sh\nprintf checked > hook-ran.txt\n")
    hook.chmod(0o755)
    assert (await folders.switch_branch(settings, {"path": str(repository), "branch": "draft"}))["branch"] == "draft"
    assert not (repository / "hook-ran.txt").exists()


async def test_switch_branch_allows_filters_configured_outside_the_repository(conn, repository):
    settings = SettingsStore(conn)
    settings.set("project_folders", [str(repository)])
    subprocess.run(["git", "config", "--global", "filter.example.smudge", "unused"], check=True, capture_output=True)
    assert (await folders.switch_branch(settings, {"path": str(repository), "branch": "draft"}))["branch"] == "draft"


@pytest.mark.parametrize("driver", ["clean", "smudge", "process"])
async def test_switch_branch_refuses_repository_filters(conn, repository, driver):
    settings = SettingsStore(conn)
    settings.set("project_folders", [str(repository)])
    subprocess.run(["git", "-C", str(repository), "config", f"filter.example.{driver}", "unused"],
                   check=True, capture_output=True)
    with pytest.raises(RpcError, match="runs its own Git filters. Switch branches in your own terminal"):
        await folders.switch_branch(settings, {"path": str(repository), "branch": "draft"})
    assert folders.head_branch(repository) == "main"
    assert (repository / "tracked.txt").read_text(encoding="utf-8") == "main"


def _counting_git(monkeypatch, delay_on=None, delay=0.0):
    calls = []
    real = folders._git

    def git(executable, path, deadline, *args):
        calls.append(args[0])
        if args[0] == delay_on:
            import time
            time.sleep(delay)
        return real(executable, path, deadline, *args)

    monkeypatch.setattr(folders, "_git", git)
    return calls


async def test_folder_info_lists_and_marks_branches_with_one_git_call(repository, monkeypatch):
    calls = _counting_git(monkeypatch)
    found = await folders.folder_info({"path": str(repository)})
    assert (found["branch"], found["branches"], calls) == ("main", ["draft", "main"], ["for-each-ref"])
    subprocess.run(["git", "-C", str(repository), "switch", "--detach", "draft"], check=True, capture_output=True)
    assert (await folders.folder_info({"path": str(repository)}))["branch"] == ""
    subprocess.run(["git", "-C", str(repository), "switch", "--orphan", "fresh"], check=True, capture_output=True)
    unborn = await folders.folder_info({"path": str(repository)})
    assert unborn["branch"] == "fresh" and unborn["branches"] == ["draft", "main"]


async def test_a_switch_slower_than_a_read_still_answers_with_what_git_did(conn, repository, monkeypatch):
    # The owner's PC took seconds to start Git: a switch cut short by the five seconds of a read had often happened
    # already, and the app said it failed while the folder sat on the new branch.
    settings = SettingsStore(conn)
    settings.set("project_folders", [str(repository)])
    monkeypatch.setattr(folders, "GIT_SECONDS", 0.3)
    _counting_git(monkeypatch, delay_on="switch", delay=0.6)
    switched = await folders.switch_branch(settings, {"path": str(repository), "branch": "draft"})
    assert switched["branch"] == "draft" and folders.head_branch(repository) == "draft"


async def test_a_switch_past_its_own_limit_says_so_and_frees_the_next_switch(conn, repository, monkeypatch):
    settings = SettingsStore(conn)
    settings.set("project_folders", [str(repository)])
    monkeypatch.setattr(folders, "SWITCH_SECONDS", 0.3)
    _counting_git(monkeypatch, delay_on="switch", delay=0.6)
    with pytest.raises(RpcError, match=folders.SWITCH_SLOW):
        await folders.switch_branch(settings, {"path": str(repository), "branch": "draft"})
    assert folders.head_branch(repository) == "main"
    monkeypatch.setattr(folders, "SWITCH_SECONDS", 30)
    assert (await folders.switch_branch(settings, {"path": str(repository), "branch": "draft"}))["branch"] == "draft"


async def test_a_branch_name_with_a_unicode_line_break_stays_one_branch(repository):
    name = "feature review"
    subprocess.run(["git", "-C", str(repository), "branch", name], check=True, capture_output=True)
    found = await folders.folder_info({"path": str(repository)})
    assert found["branch"] == "main" and found["branches"] == ["draft", name, "main"]


async def test_a_switch_stuck_in_one_repository_never_holds_up_another(conn, repository, tmp_path, monkeypatch):
    # On Windows a Git killed at its limit can leave a child holding its pipes, and the waiting thread keeps its lock.
    other = tmp_path / "Other"
    shutil.copytree(repository, other)
    settings = SettingsStore(conn)
    settings.set("project_folders", [str(repository), str(other)])
    stuck = folders._switch_lock(str(repository))
    stuck.acquire()
    try:
        assert (await folders.switch_branch(settings, {"path": str(other), "branch": "draft"}))["branch"] == "draft"
        monkeypatch.setattr(folders, "SWITCH_SECONDS", 0.3)
        with pytest.raises(RpcError, match=folders.SWITCH_SLOW):
            await folders.switch_branch(settings, {"path": str(repository), "branch": "draft"})
    finally:
        stuck.release()

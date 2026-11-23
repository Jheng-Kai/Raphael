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

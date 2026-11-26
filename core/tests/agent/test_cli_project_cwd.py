"""A native CLI brain starts in the project chosen for its member (R-CLI-13), as Claude Code starts in the folder it is
given and so names it as its own working directory. Its private state stays in its private workspace, and nothing is written in
the project."""

import json
import sys

import pytest

from raphael_core.agent.cli.discovery import CliBrains
from raphael_core.agent.cli.drivers import Driver
from raphael_core.brain.settings import SettingsStore

from .test_cli_recovery import recovery_rig


def chosen(conn, tmp_path, member=5):
    project = tmp_path / "Repo"
    project.mkdir()
    settings = SettingsStore(conn)
    settings.set("project_folders", [str(project)])
    settings.set("member_work_folder", {str(member): str(project)})
    return settings, project


def test_the_brains_name_the_chosen_project_only_while_it_is_there(conn, tmp_path):
    settings, project = chosen(conn, tmp_path)
    brains = CliBrains(home=tmp_path, environ={}, settings=settings)
    assert brains.work_folder(5) == str(project)
    assert brains.work_folder(6) is None  # no project chosen for this member
    project.rmdir()
    assert brains.work_folder(5) is None
    assert CliBrains(home=tmp_path, environ={}).work_folder(5) is None


@pytest.mark.parametrize("brain", ["claude", "codex", "gemini"])
async def test_a_loop_hands_the_chosen_project_to_the_cli_and_keeps_its_private_workspace(monkeypatch, tmp_path, conn, brain):
    from raphael_core.agent.cli.drivers import Event

    async def play(loop, attempt):
        yield Event("final", "Done.")

    settings, project = chosen(conn, tmp_path)
    rig = recovery_rig(monkeypatch, tmp_path, play, brain=brain)
    rig.loop.brains.work_folder = CliBrains(home=tmp_path, environ={}, settings=settings).work_folder
    await rig.loop.run()
    assert rig.calls[0]["project"] == str(project)
    assert rig.calls[0]["cwd"] != str(project) and str(tmp_path) in rig.calls[0]["cwd"]
    rig = recovery_rig(monkeypatch, tmp_path, play, brain=brain, member_id=6)
    rig.loop.brains.work_folder = CliBrains(home=tmp_path, environ={}, settings=settings).work_folder
    await rig.loop.run()
    assert "project" not in rig.calls[0]  # no project chosen: the CLI starts where it always did


CLAUDE = '''import json, os, sys
open(sys.argv[1], "w").write(json.dumps({"cwd": os.getcwd(), "command": sys.argv[2:]}))
json.loads(sys.stdin.readline())
print(json.dumps({"type": "result", "subtype": "success", "is_error": False, "result": "ok"}), flush=True)
'''

CODEX = '''import json, os, sys
from pathlib import Path
def send(value): print(json.dumps(value), flush=True)
record = {"cwd": os.getcwd()}
for line in sys.stdin:
    msg = json.loads(line)
    if msg.get("method") == "initialize": send({"id": msg["id"], "result": {}})
    elif msg.get("method") == "thread/start":
        record["thread"] = msg["params"]
        send({"id": msg["id"], "result": {"thread": {"id": "t"}}})
    elif msg.get("method") == "turn/start":
        Path(sys.argv[1]).write_text(json.dumps(record), encoding="utf-8")
        send({"method": "item/completed", "params": {"item": {"type": "agentMessage", "text": "Done"}}})
        send({"method": "turn/completed", "params": {"turn": {"status": "completed"}}})
        break
'''

ANTIGRAVITY = '''import json, os, sys
open(sys.argv[1], "w").write(json.dumps({"cwd": os.getcwd(), "command": sys.argv[2:]}))
sys.stdin.readline()
'''


def folders(tmp_path):
    project, private = tmp_path / "Repo", tmp_path / "private"
    project.mkdir()
    private.mkdir()
    return project, private


async def run(driver, private, project=None):
    options = {"project": str(project)} if project else {}
    return [event async for event in driver.run(user="hi", system="persona", endpoint="http://127.0.0.1:1/mcp", token="t",
                                                permission=None, cwd=str(private), **options)]


async def test_claude_code_is_started_in_the_project(tmp_path):
    project, private = folders(tmp_path)
    record, script = tmp_path / "record.json", tmp_path / "claude.py"
    script.write_text(CLAUDE, encoding="utf-8")
    await run(Driver("claude", [sys.executable, str(script), str(record)]), private, project)
    assert json.loads(record.read_text(encoding="utf-8"))["cwd"] == str(project)
    assert list(project.iterdir()) == []  # nothing of the CLI's own is left in the owner's project
    await run(Driver("claude", [sys.executable, str(script), str(record)]), private)
    assert json.loads(record.read_text(encoding="utf-8"))["cwd"] == str(private)


async def test_codex_tells_its_thread_the_project_while_it_runs_in_its_private_workspace(tmp_path):
    project, private = folders(tmp_path)
    record, script = tmp_path / "record.json", tmp_path / "codex.py"
    script.write_text(CODEX, encoding="utf-8")
    driver = Driver("codex", [sys.executable, str(script), str(record)], environ={"USERPROFILE": str(tmp_path), "HOME": str(tmp_path)}, home=tmp_path)
    events = await run(driver, private, project)
    assert events[-1].kind == "final"
    seen = json.loads(record.read_text(encoding="utf-8"))
    assert seen["thread"]["cwd"] == str(project) and seen["cwd"] != str(project)
    assert seen["thread"]["sandbox"] == "read-only"
    assert list(project.iterdir()) == []


async def test_antigravity_is_started_in_the_project_with_its_private_folder_beside_the_workspace(tmp_path):
    project, private = folders(tmp_path)
    record, script = tmp_path / "record.json", tmp_path / "agy.py"
    script.write_text(ANTIGRAVITY, encoding="utf-8")
    await run(Driver("gemini", [sys.executable, str(script), str(record)]), private, project)
    seen = json.loads(record.read_text(encoding="utf-8"))
    assert seen["cwd"] == str(project)
    assert f"--gemini_dir={private / 'home' / '.gemini'}" in seen["command"]
    assert (private / "home" / ".gemini" / "GEMINI.md").is_file() and list(project.iterdir()) == []

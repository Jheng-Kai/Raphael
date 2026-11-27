"""A member with a chosen project works in it (R-COMP-PROJECT-04): the Docker computer's commands start in the project's mount and
its file tools take a relative path from there, as Claude Code does from its working directory. The member's own workspace is
still where it keeps notes and downloads, and a member with no project is where it always was."""

import json
from dataclasses import replace

from raphael_core.brain.settings import SettingsStore
from raphael_core.computer.vm import GUEST, LocalVm, Result
from raphael_core.computer.vm_tools import VmTools
from raphael_core.services.attachment_store import AttachmentStore

from .test_vm import Bridge, EmptyHub, Runtime, container


async def started(conn, tmp_path, monkeypatch, *, mounted=True):
    settings = SettingsStore(conn)
    settings.set("computer_vm_mode", "per-bot")
    runtime = Runtime()
    vm = LocalVm(tmp_path / "data", settings=settings, runner=runtime, clock=lambda: 0)
    project = tmp_path / "Repo"
    project.mkdir()
    settings.set("project_folders", [str(project)])
    settings.set("member_work_folder", {"0": str(project)})
    target = vm.target()
    target.workspace.mkdir(parents=True)
    runtime.raw = container(vm, target if mounted else replace(target, projects=()), runtime)

    async def create(created, zone):
        runtime.raw = container(vm, created, runtime)
        return Result(0)

    monkeypatch.setattr(vm, "create", create)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare()
    command = next(tool for tool in hub.offered() if tool.name == "vm_exec")
    return vm, hub, command, runtime, settings


async def test_the_first_command_of_a_fresh_turn_runs_in_the_project(conn, tmp_path, monkeypatch):
    vm, hub, command, runtime, settings = await started(conn, tmp_path, monkeypatch)
    assert (await hub.call(command.key, {"command": "pwd"}, approver="auto")).ok
    assert any(args[-1] == "cd -- /home/cua/projects/Repo && pwd" for args, _ in runtime.calls if args[0] == "exec")
    # The member's own workspace is still its own: a member with no project starts there, and what it saves goes there.
    settings.set("member_work_folder", {})
    runtime.calls.clear()
    assert (await hub.call(command.key, {"command": "pwd"}, approver="auto")).ok
    assert any(args[-1] == f"cd {GUEST} && pwd" for args, _ in runtime.calls if args[0] == "exec")


async def test_a_command_waits_in_the_workspace_and_says_so_while_the_project_is_not_mounted_yet(conn, tmp_path, monkeypatch):
    vm, hub, command, runtime, settings = await started(conn, tmp_path, monkeypatch, mounted=False)
    vm.busy = lambda key: True  # in use: the computer keeps the mounts it has (never stopped under a running task)
    result = await hub.call(command.key, {"command": "pwd"}, approver="auto")
    assert result.ok and "not mounted" in json.loads(result.text)["note"]
    assert any(args[-1] == f"cd {GUEST} && pwd" for args, _ in runtime.calls if args[0] == "exec")


async def test_a_relative_path_of_the_computers_file_tools_starts_in_the_project(conn, tmp_path, monkeypatch):
    vm, hub, command, runtime, settings = await started(conn, tmp_path, monkeypatch)
    target = vm.mounted_target(vm.target())
    assert hub.member_file_path(target, "README.md", 0) == "/home/cua/projects/Repo/README.md"
    assert hub.member_file_path(target, ".", 0) == "/home/cua/projects/Repo"  # a glob or grep that names no folder
    assert hub.member_file_path(target, "/home/cua/workspace/notes.txt", 0) == "/home/cua/workspace/notes.txt"
    assert hub.member_file_path(target, "~/downloads/a.pdf", 0) == "~/downloads/a.pdf"
    settings.set("member_work_folder", {})
    assert hub.member_file_path(target, "README.md", 0) == f"{GUEST}/README.md"

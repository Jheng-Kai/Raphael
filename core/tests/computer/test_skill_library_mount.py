"""The skill library is one folder, and the Docker computer mounts that very folder: a script of a skill runs there by its path."""

import csv
from dataclasses import replace

import pytest

from raphael_core.computer.vm import GUEST, SKILLS, LocalVm, Result, VmError, compatible, mounts_match, run_args, trust_args
from raphael_core.computer.vm_tools import VmTools
from raphael_core.members.skill_library import SkillHomes
from raphael_core.services.attachment_store import AttachmentStore
from .test_vm import Bridge, EmptyHub, Runtime, container, desktop, per_bot_desktop  # noqa: F401 (fixtures)


def mounts_of(args):
    return [next(csv.reader([args[index + 1]])) for index, arg in enumerate(args) if arg == "--mount"]


def test_the_computer_mounts_the_folder_the_library_keeps_its_skills_in_and_only_reads_it(tmp_path):
    vm = LocalVm(tmp_path)
    target = vm.target()
    held = SkillHomes(vm.machine).home(-1) / "skills"
    assert target.library == vm.library == held
    held.mkdir(parents=True)
    (held / "7" / "scripts").mkdir(parents=True)
    (held / "7" / "scripts" / "run.sh").write_text("echo hi", encoding="utf-8")
    mounts = mounts_of(run_args(target, vm.owner, "secret"))
    library = next(mount for mount in mounts if f"target={SKILLS}" in mount)
    assert library == ["type=bind", f"source={held}", f"target={SKILLS}", "readonly"]
    # The mount's source is the library's own folder: what the app writes there is what the computer reads, with no copy between.
    assert (held / "7" / "scripts" / "run.sh").read_text(encoding="utf-8") == "echo hi"
    assert mounts[0][2] == f"target={GUEST}"


def test_a_plugin_is_in_the_mounted_folder_too(tmp_path):
    vm = LocalVm(tmp_path)
    assert vm.library == SkillHomes(vm.machine).home(-1) / "skills"
    assert (vm.library.parent / "skill-sets") != vm.library  # plugins are no folder of their own


def test_the_mount_is_read_only_and_must_be_the_library(desktop):
    vm, target, runtime = desktop
    expected = container(vm, target, runtime)["Mounts"]
    assert any(mount["Destination"] == SKILLS and mount["RW"] is False for mount in expected)
    assert mounts_match(expected, expected, target)
    writable = [dict(mount, RW=True) if mount["Destination"] == SKILLS else mount for mount in expected]
    assert not mounts_match(writable, writable, target)
    elsewhere = [dict(mount, Source="/elsewhere") if mount["Destination"] == SKILLS else mount for mount in expected]
    assert not mounts_match(elsewhere, elsewhere, target)
    assert not mounts_match(expected[:-1], expected[:-1], target)


def test_a_computer_on_another_host_has_no_library_mount(tmp_path):
    vm = LocalVm(tmp_path)
    remote = vm.target_for("ssh://elsewhere", "abc")
    assert remote.library is None
    assert not any(f"target={SKILLS}" in mount for mount in mounts_of(run_args(remote, vm.owner, "secret")))


async def test_a_computer_made_before_the_library_was_mounted_is_made_again_only_when_idle(per_bot_desktop, monkeypatch):
    vm, target, runtime = per_bot_desktop
    old = replace(target, library=None)
    runtime.raw = container(vm, old, runtime)
    assert compatible(runtime.raw, replace(target, library=None), vm.owner, runtime.image_id)
    state = await vm.status(target)
    assert state["state"] == "running" and state["mounts_stale"]
    vm.active[target.key] = 1
    with pytest.raises(VmError, match="busy"):
        await vm.start(target)
    kept = await vm.running_project_mounts(target)
    assert kept is not None and kept.library is None
    vm.active.clear()

    async def create(created, zone):
        runtime.raw = container(vm, created, runtime)
        return Result(0)

    monkeypatch.setattr(vm, "create", create)
    runtime.calls.clear()
    await vm.start(target)
    assert [args[0] for args, _ in runtime.calls if args[0] in ("stop", "rm")] == ["stop", "rm"]
    assert (await vm.status(target)).get("mounts_stale") is None
    assert vm.mounted_target(target).library == target.library


async def test_no_file_is_copied_into_the_computer_to_give_it_the_library(per_bot_desktop):
    vm, target, runtime = per_bot_desktop
    runtime.raw = container(vm, target, runtime)
    runtime.calls.clear()
    assert (await vm.start(target))["ready"]
    # The one command that names the folder only tells git to trust it (trust_args); it writes nothing into the library.
    assert not [args for args, _ in runtime.calls if args[0] in ("cp", "exec") and args != trust_args(target)
                and (SKILLS in " ".join(args[1:]) or str(vm.library) in " ".join(args[1:]))]
    assert any(args == trust_args(target) and SKILLS in args for args, _ in runtime.calls)


async def test_a_member_on_docker_is_told_where_the_library_is_in_its_computer(per_bot_desktop, tmp_path):
    vm, target, runtime = per_bot_desktop
    runtime.raw = container(vm, target, runtime)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    assert hub.library_path(0) == SKILLS
    runtime.raw = container(vm, replace(target, library=None), runtime)
    await vm.status(target, probe=False)
    assert hub.library_path(0) is None  # the computer that exists does not have it yet: no path is promised
    vm.enabled = False
    assert hub.library_path(0) is None

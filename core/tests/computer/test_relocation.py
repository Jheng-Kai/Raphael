"""The computers' folders move from the data directory to the machine-local folder, with temporary folders and a fake engine."""

import asyncio
import json
import os
from types import SimpleNamespace

import pytest

from raphael_core.computer import vm as vm_module
from raphael_core.computer.vm import LABEL, LocalVm, Result, VmError


class Engine:
    """This PC's Docker as the move sees it: the computers of an owner, their state and what they bind."""

    def __init__(self):
        self.up = True
        self.containers = {}
        self.helpers = []
        self.refuse_rm = False
        self.calls = []

    def add(self, vm, key, *, running=False, owner=None, sources=None):
        target = vm.target_for("", key)
        name = target.name
        self.containers[name] = {
            "Name": "/" + name, "State": {"Running": running},
            "Config": {"Labels": {f"{LABEL}.owner": owner or vm.owner, f"{LABEL}.target": key}},
            "HostConfig": {"Mounts": [{"Type": "bind", "Source": str(source), "Target": "/x"}
                                      for source in (sources or [target.workspace, target.shared])]},
        }
        return name

    async def __call__(self, args, **kwargs):
        self.calls.append(list(args))
        if args[0] == "info":
            return Result(0, "linux") if self.up else Result(1)
        if args[:2] == ["ps", "-a"] and args[3].startswith("label="):
            owner = args[3].split("=", 2)[2]
            rows = [f"{name}\t{'running' if raw['State']['Running'] else 'exited'}" for name, raw in self.containers.items()
                    if raw["Config"]["Labels"][f"{LABEL}.owner"] == owner]
            return Result(0, "\n".join(rows))
        if args[:2] == ["ps", "-a"] and args[3].startswith("name="):
            return Result(0, "\n".join(self.helpers))
        if args[:2] == ["container", "inspect"]:
            raw = self.containers.get(args[2])
            return Result(0, json.dumps([raw])) if raw else Result(1)
        if args[0] == "rm":
            if self.refuse_rm:
                return Result(1)
            self.containers.pop(args[1], None)
            return Result(0)
        raise AssertionError(f"unexpected docker command {args}")


def earlier_install(tmp_path):
    """The data directory of an install made before the move: a member's home with a file, and the team folder."""
    data, local = tmp_path / "Roaming" / "Raphael Dev", tmp_path / "Local" / "Raphael Dev"
    (data / "vm-homes" / "a1b2c3d4e5f60718").mkdir(parents=True)
    (data / "vm-homes" / "a1b2c3d4e5f60718" / "notes.txt").write_text("kept", encoding="utf-8")
    (data / "vm-shared" / "projects").mkdir(parents=True)
    (data / "vm-shared" / "projects" / "plan.md").write_text("plan", encoding="utf-8")
    local.mkdir(parents=True)
    return data, local


def os_with(**changed):
    """The `os` the computers' module sees, with some of its functions replaced: nothing else in the test run is touched."""
    return SimpleNamespace(**{**{name: getattr(os, name) for name in dir(os) if not name.startswith("__")}, **changed})


def machine(data, local, engine):
    return LocalVm(data, runner=engine, clock=lambda: 0, machine_dir=local)


async def test_a_new_install_keeps_the_computers_folders_in_the_machine_local_folder(tmp_path):
    data, local = tmp_path / "Roaming" / "Raphael", tmp_path / "Local" / "Raphael"
    data.mkdir(parents=True)
    engine = Engine()
    vm = machine(data, local, engine)
    target = vm.target_for("", "a1b2c3d4e5f60718")
    assert target.workspace == local.resolve() / "vm-homes" / "a1b2c3d4e5f60718"
    assert target.shared == local.resolve() / "vm-shared"
    # The owner label stays the data directory's: the same computers stay this app's.
    assert vm.owner == LocalVm(data, runner=engine).owner
    assert await vm.relocate() == "nothing"
    assert engine.calls == []


async def test_an_earlier_install_moves_once_by_rename_and_its_stopped_computers_are_made_again(tmp_path):
    data, local = earlier_install(tmp_path)
    engine = Engine()
    vm = machine(data, local, engine)
    key = "a1b2c3d4e5f60718"
    assert vm.target_for("", key).workspace == data.resolve() / "vm-homes" / key  # used where it is until it moves
    mine = engine.add(vm, key)
    shared = engine.add(vm, "shared")
    foreign = engine.add(vm, "0011223344556677", owner="someone-else")
    before = os.stat(data / "vm-homes" / key / "notes.txt").st_ino

    assert await vm.relocate() == "moved"

    assert not (data / "vm-homes").exists() and not (data / "vm-shared").exists()
    moved = local / "vm-homes" / key / "notes.txt"
    assert moved.read_text(encoding="utf-8") == "kept" and (local / "vm-shared" / "projects" / "plan.md").exists()
    assert os.stat(moved).st_ino == before  # renamed in place, never copied
    # Both stopped computers that bound the old place are gone, to be made again at their next start; another
    # owner's computer is not even looked at.
    assert mine not in engine.containers and shared not in engine.containers and foreign in engine.containers
    assert ["rm", mine] in engine.calls and ["rm", shared] in engine.calls
    assert not any(call[:2] == ["container", "inspect"] and call[2] == foreign for call in engine.calls)
    target = vm.target_for("", key)
    assert target.workspace == local.resolve() / "vm-homes" / key and target.shared == local.resolve() / "vm-shared"
    engine.calls.clear()
    assert await machine(data, local, engine).relocate() == "nothing"  # the next start has nothing to move
    assert engine.calls == []


@pytest.mark.parametrize("hold", ["running", "carry", "engine", "preparing", "removal"])
async def test_the_move_waits_while_anything_could_still_use_the_old_folders(tmp_path, hold):
    data, local = earlier_install(tmp_path)
    engine = Engine()
    vm = machine(data, local, engine)
    key = "a1b2c3d4e5f60718"
    name = engine.add(vm, key, running=hold == "running")
    engine.add(vm, "shared")
    pending = None
    if hold == "carry":
        engine.helpers = [f"raphael-carry-{vm.owner}-{key}"]
    elif hold == "engine":
        engine.up = False
    elif hold == "preparing":
        pending = asyncio.get_running_loop().create_future()
        vm.preparing[key] = asyncio.ensure_future(pending)
    elif hold == "removal":
        engine.refuse_rm = True

    reason = await vm.relocate()

    assert reason == {"running": "running", "carry": "carry", "engine": "engine", "preparing": "busy", "removal": "remove"}[hold]
    assert (data / "vm-homes" / key / "notes.txt").read_text(encoding="utf-8") == "kept"
    assert (data / "vm-shared" / "projects" / "plan.md").exists()
    assert not (local / "vm-homes").exists() and not (local / "vm-shared").exists()
    assert vm.target_for("", key).workspace == data.resolve() / "vm-homes" / key
    if hold != "removal":
        assert name in engine.containers and not any(call[0] == "rm" for call in engine.calls)
    if pending is not None:
        pending.set_result(None)
        await vm.preparing[key]
        # The next start tries again and moves them.
        assert await machine(data, local, engine).relocate() == "moved"


async def test_a_folder_on_another_volume_stays_where_it_is(tmp_path, monkeypatch):
    data, local = earlier_install(tmp_path)
    engine = Engine()
    vm = machine(data, local, engine)
    real = os.stat

    def stat(path, *args, **kwargs):
        found = real(path, *args, **kwargs)
        if os.path.normcase(os.fspath(path)) == os.path.normcase(os.fspath(local.resolve())):
            return SimpleNamespace(st_dev=found.st_dev + 1, st_mode=found.st_mode)
        return found
    monkeypatch.setattr(vm_module, "os", os_with(stat=stat))

    assert await vm.relocate() == "volume"
    assert (data / "vm-homes").exists() and (data / "vm-shared").exists() and not (local / "vm-homes").exists()


async def test_a_rename_that_fails_half_way_uses_each_folder_where_it_is(tmp_path, monkeypatch):
    data, local = earlier_install(tmp_path)
    engine = Engine()
    vm = machine(data, local, engine)
    real = os.rename

    def rename(source, destination):
        if os.fspath(source).endswith("vm-shared"):
            raise PermissionError("in use")
        return real(source, destination)
    monkeypatch.setattr(vm_module, "os", os_with(rename=rename))

    assert await vm.relocate() == "rename"
    target = vm.target_for("", "a1b2c3d4e5f60718")
    assert target.workspace == local.resolve() / "vm-homes" / "a1b2c3d4e5f60718"
    assert target.shared == data.resolve() / "vm-shared"
    assert (target.workspace / "notes.txt").exists() and (target.shared / "projects" / "plan.md").exists()
    monkeypatch.undo()
    # The next start moves what is left.
    assert await machine(data, local, engine).relocate() == "moved"
    assert (local / "vm-shared" / "projects" / "plan.md").exists() and not (data / "vm-shared").exists()


async def test_a_target_taken_before_the_move_is_refused_and_the_old_place_is_not_made_again(tmp_path):
    data, local = earlier_install(tmp_path)
    engine = Engine()
    vm = machine(data, local, engine)
    stale = vm.target_for("", "a1b2c3d4e5f60718")
    assert await vm.relocate() == "moved"
    with pytest.raises(VmError, match="busy"):
        await vm.start(stale)
    assert not (data / "vm-homes").exists()
    vm.validate_storage(vm.target_for("", "a1b2c3d4e5f60718"))  # a fresh one is fine


async def test_a_folder_made_again_at_the_old_place_after_the_move_is_never_used(tmp_path):
    data, local = earlier_install(tmp_path)
    engine = Engine()
    assert await machine(data, local, engine).relocate() == "moved"
    (data / "vm-shared").mkdir()  # something wrote there with a path it took before the move
    vm = machine(data, local, engine)
    assert vm.target_for("", "shared").shared == local.resolve() / "vm-shared"
    assert await vm.relocate() == "nothing"
    assert (data / "vm-shared").exists()  # left as it is: never merged, never deleted


async def test_a_member_computer_is_erased_from_its_moved_home(tmp_path):
    data, local = earlier_install(tmp_path)
    engine = Engine()
    vm = machine(data, local, engine)
    assert await vm.relocate() == "moved"
    await vm.erase(vm.target_for("", "a1b2c3d4e5f60718"), engine=False)
    assert not (local / "vm-homes" / "a1b2c3d4e5f60718").exists()
    assert (local / "vm-shared" / "projects" / "plan.md").exists()


async def test_every_start_waits_for_a_move_under_way(tmp_path):
    data, local = earlier_install(tmp_path)
    engine = Engine()
    vm = machine(data, local, engine)
    gate = asyncio.Event()
    answered = engine.__call__

    async def slow(args, **kwargs):
        if args[0] == "info":
            await gate.wait()
        return await answered(args, **kwargs)
    vm.run = slow
    vm.relocate_soon()
    seated = asyncio.ensure_future(vm.seat(3))
    await asyncio.sleep(0)
    assert not seated.done()
    gate.set()
    target = await seated
    assert vm.relocation.result() == "moved"
    assert target.workspace.parent == local.resolve() / "vm-homes"

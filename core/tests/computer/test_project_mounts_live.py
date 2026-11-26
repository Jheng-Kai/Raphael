"""A project folder the owner adds or removes reaches the Docker computer by itself (R-COMP-PROJECT-03).

Docker cannot add a bind mount to a running container, so the computer is made again. These tests drive that decision on the
fake engine: a setting change makes an idle computer again at once, a computer in use keeps its mounts until it is idle
(and a running task is never stopped), and the existing locks keep two makings from racing."""

import asyncio
from types import SimpleNamespace

import pytest

from raphael_core.app import App
from raphael_core.brain.settings import SettingsStore
from raphael_core.computer.vm import LocalVm, Result

from .test_vm import Runtime, container



def mounted(runtime):
    return [mount["Destination"] for mount in runtime.raw["Mounts"] if mount["Destination"].startswith("/home/cua/projects/")]


def remade(runtime):
    return [args[0] for args, _ in runtime.calls if args[0] in ("stop", "rm")]


@pytest.fixture
def rig(conn, tmp_path, monkeypatch):
    """A per-member computer that is up with no project, on the fake engine; `create` makes it as the engine would."""
    monkeypatch.setattr("raphael_core.computer.vm.MOUNTS_RETRY_S", 0.01, raising=False)
    settings = SettingsStore(conn)
    settings.set("computer_vm_mode", "per-bot")
    runtime = Runtime()
    vm = LocalVm(tmp_path / "data", settings=settings, runner=runtime, clock=lambda: 0)
    target = vm.target()
    target.workspace.mkdir(parents=True)
    runtime.raw = container(vm, target, runtime)

    async def create(created, zone):
        runtime.raw = container(vm, created, runtime)
        return Result(0)

    monkeypatch.setattr(vm, "create", create)
    folders = []
    for name in ("Repo", "Other"):
        folder = tmp_path / name
        folder.mkdir()
        folders.append(str(folder))
    return SimpleNamespace(vm=vm, settings=settings, runtime=runtime, target=target, folders=folders)


async def settle(vm):
    await asyncio.wait_for(vm.mounts_task, 10)


async def test_adding_a_folder_through_the_settings_call_shows_it_in_an_idle_computer_at_once(tmp_path, monkeypatch):
    # The owner's whole path: the settings RPC the composer's folder menu calls, then nothing else.
    app = App(data_dir=tmp_path, fake_llm=True, load_kit=lambda: SimpleNamespace())
    try:
        vm, runtime = app.vm, Runtime()
        vm.enabled, vm.run, vm.real_transport, vm._desktop = True, runtime, False, None
        await app.call("settings.set", {"key": "computer_vm_mode", "value": "per-bot"})
        target = vm.target()
        target.workspace.mkdir(parents=True)
        runtime.raw = container(vm, target, runtime)

        async def create(created, zone):
            runtime.raw = container(vm, created, runtime)
            return Result(0)

        monkeypatch.setattr(vm, "create", create)
        project = tmp_path / "Repo"
        project.mkdir()
        await app.call("settings.set", {"key": "project_folders", "value": [str(project)]})
        for _ in range(100):  # nothing else is asked of the app: the owner just looks
            if mounted(runtime):
                break
            await asyncio.sleep(0.05)
        assert mounted(runtime) == ["/home/cua/projects/Repo"]
        assert runtime.raw["State"]["Running"] is True
    finally:
        await app.aclose()


async def test_a_folder_added_while_nothing_works_in_the_computer_is_there_at_once(rig):
    vm, settings, runtime = rig.vm, rig.settings, rig.runtime
    settings.set("project_folders", [rig.folders[0]])
    vm.refresh_mounts_soon()
    await settle(vm)
    assert mounted(runtime) == ["/home/cua/projects/Repo"]
    assert remade(runtime) == ["stop", "rm"]
    assert runtime.raw["State"]["Running"] is True and not vm.mounts_pending
    assert [mount["RW"] for mount in runtime.raw["Mounts"][-1:]] == [False]


@pytest.mark.parametrize("busy", ["lease", "call", "owner"])
async def test_a_folder_added_while_the_computer_is_in_use_waits_for_idle_and_never_stops_the_work(rig, busy):
    vm, settings, runtime, target = rig.vm, rig.settings, rig.runtime, rig.target
    if busy == "lease":
        vm.busy = lambda key: True
    elif busy == "call":
        vm.active[target.key] = 1
    else:
        vm.held.add(target.key)
    settings.set("project_folders", [rig.folders[0]])
    vm.refresh_mounts_soon()
    await asyncio.sleep(0.2)
    assert not vm.mounts_task.done() and vm.mounts_pending
    assert remade(runtime) == [] and mounted(runtime) == []
    vm.busy, vm.active, vm.held = (lambda key: False), {}, set()
    await settle(vm)
    assert mounted(runtime) == ["/home/cua/projects/Repo"] and remade(runtime) == ["stop", "rm"]
    assert not vm.mounts_pending


async def test_a_background_job_in_the_computer_is_work_too(rig):
    vm, settings, runtime = rig.vm, rig.settings, rig.runtime
    working = [True]
    vm.mount_busy = lambda target: working[0]
    settings.set("project_folders", [rig.folders[0]])
    vm.refresh_mounts_soon()
    await asyncio.sleep(0.2)
    assert remade(runtime) == []
    working[0] = False
    await settle(vm)
    assert mounted(runtime) == ["/home/cua/projects/Repo"]


async def test_a_folder_removed_leaves_the_computer_the_same_way(rig):
    vm, settings, runtime, target = rig.vm, rig.settings, rig.runtime, rig.target
    settings.set("project_folders", [rig.folders[0], rig.folders[1]])
    runtime.raw = container(vm, vm.target(), runtime)
    assert len(mounted(runtime)) == 2
    settings.set("project_folders", [rig.folders[1]])
    vm.busy = lambda key: True
    vm.refresh_mounts_soon()
    await asyncio.sleep(0.1)
    assert len(mounted(runtime)) == 2 and remade(runtime) == []
    vm.busy = lambda key: False
    await settle(vm)
    assert mounted(runtime) == ["/home/cua/projects/Other"]
    settings.set("project_folders", [])
    vm.refresh_mounts_soon()
    await settle(vm)
    assert mounted(runtime) == [] and remade(runtime) == ["stop", "rm"] * 2


async def test_a_computer_that_already_shows_the_folders_is_left_alone(rig):
    vm, settings, runtime = rig.vm, rig.settings, rig.runtime
    vm.refresh_mounts_soon()
    await settle(vm)
    assert remade(runtime) == [] and not vm.mounts_pending
    settings.set("project_folders", [rig.folders[0]])
    runtime.raw = container(vm, vm.target(), runtime)
    runtime.calls.clear()
    vm.refresh_mounts_soon()
    await settle(vm)
    assert remade(runtime) == []


async def test_a_sleeping_computer_is_not_woken_for_a_folder(rig):
    vm, settings, runtime = rig.vm, rig.settings, rig.runtime
    runtime.raw["State"]["Running"] = False
    settings.set("project_folders", [rig.folders[0]])
    vm.refresh_mounts_soon()
    await settle(vm)
    assert not any(args[0] in ("run", "start", "stop", "rm", "create") for args, _ in runtime.calls)
    # What the next call that needs it does anyway: it comes up with the folder.
    assert (await vm.start(vm.target()))["ready"]
    assert mounted(runtime) == ["/home/cua/projects/Repo"]


async def test_two_changes_in_a_row_end_with_the_last_set_and_one_task(rig):
    vm, settings, runtime = rig.vm, rig.settings, rig.runtime
    settings.set("project_folders", [rig.folders[0]])
    vm.refresh_mounts_soon()
    first = vm.mounts_task
    settings.set("project_folders", [rig.folders[0], rig.folders[1]])
    vm.refresh_mounts_soon()
    assert vm.mounts_task is first
    await settle(vm)
    assert sorted(mounted(runtime)) == ["/home/cua/projects/Other", "/home/cua/projects/Repo"]
    assert not vm.mounts_pending


async def test_the_making_again_and_a_members_start_never_race(rig):
    vm, settings, runtime = rig.vm, rig.settings, rig.runtime
    settings.set("project_folders", [rig.folders[0]])
    vm.refresh_mounts_soon()
    started = await asyncio.gather(vm.start(vm.target()), vm.start(vm.target()))
    await settle(vm)
    assert all(state["ready"] for state in started)
    assert remade(runtime) == ["stop", "rm"] and mounted(runtime) == ["/home/cua/projects/Repo"]


async def test_a_stopped_engine_leaves_it_pending_for_the_monitor_and_the_next_start(rig):
    vm, settings, runtime = rig.vm, rig.settings, rig.runtime
    runtime.up = False
    settings.set("project_folders", [rig.folders[0]])
    vm.refresh_mounts_soon()
    await settle(vm)
    assert vm.mounts_pending and mounted(runtime) == []
    runtime.up = True
    vm.refresh_mounts_soon()
    await settle(vm)
    assert not vm.mounts_pending and mounted(runtime) == ["/home/cua/projects/Repo"]

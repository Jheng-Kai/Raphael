"""How the member computer's image is built, kept and replaced, against a fake engine: no daemon, network or build."""

import asyncio
import json
import logging
from pathlib import Path

import pytest

from raphael_core.brain.settings import SettingsStore
from raphael_core.computer import vm as vm_module
from raphael_core.computer.lifecycle import maintain
from raphael_core.computer.viewer import DesktopViewer
from raphael_core.computer.vm import IMAGE, IMAGE_CLEAN_S, IMAGE_LABELS, LABEL, LocalVm, Result, VmError, build_args
from .test_vm import Runtime, container

CONTEXT = Path(vm_module.__file__).parent / "image"
CURRENT = "sha256:" + "c" * 64
COMPUTER = "e" * 64  # the container id of the test's own computer
# The current layer is the core's; NEWER is a layer after it (a build the owner may go back to).
LAYER = int(IMAGE_LABELS[f"{LABEL}.layer"])
V9, V11, V12, NEWER = (f"raphael/cua-local-vm:driver-0.37.0-v{layer}" for layer in (9, 11, 12, LAYER + 1))
ID9, ID11, ID12, ID_NEWER = ("sha256:" + digit * 64 for digit in "9ab4")


def labels(layer, **extra):
    return {**IMAGE_LABELS, f"{LABEL}.layer": str(layer), **extra}


class Engine(Runtime):
    """test_vm's fake engine with images and other containers: `images` maps a tag to (id, labels), `others` maps a
    container id (running or stopped, anyone's) to the image id it was made from."""

    def __init__(self):
        super().__init__()
        self.image_id = CURRENT
        self.images = {IMAGE: (CURRENT, labels(LAYER))}
        self.others = {}
        self.list_fails = self.ps_fails = self.rm_fails = self.ignore_filters = False

    def tagged(self, ident):
        return [tag for tag, (other, _) in self.images.items() if other == ident]

    def containers(self):
        return {**self.others, **({COMPUTER: self.raw["Image"]} if self.raw else {})}

    async def __call__(self, args, **kwargs):
        command = args[2:] if args[:1] == ["--host"] else args
        if command[:2] == ["image", "ls"]:
            self.calls.append((command, kwargs))
            if self.list_fails:
                return Result(1, "", "synthetic daemon refusal")
            filters = [command[index + 1] for index, part in enumerate(command) if part == "--filter"]
            label = next(item.removeprefix("label=") for item in filters if item.startswith("label="))
            reference = next(item.removeprefix("reference=") for item in filters if item.startswith("reference="))
            key, value = label.split("=", 1)
            shown = [tag for tag, (_, marks) in self.images.items()
                     if self.ignore_filters or marks.get(key) == value and tag.rsplit(":", 1)[0] == reference]
            return Result(0, "\n".join(shown) + "\n")
        if command[:2] == ["image", "inspect"]:
            self.calls.append((command, kwargs))
            found = [{"Id": self.images[name][0], "RepoTags": self.tagged(self.images[name][0]),
                      "Config": {"Labels": self.images[name][1]}} for name in command[2:] if name in self.images]
            return Result(0 if len(found) == len(command[2:]) else 1, json.dumps(found))
        if command[:2] == ["image", "rm"]:
            self.calls.append((command, kwargs))
            tag = command[-1]
            if self.rm_fails or tag not in self.images:
                return Result(1, "", "synthetic private engine output")
            ident = self.images[tag][0]
            # The engine itself refuses the last tag of an image a container uses unless forced.
            if ident in self.containers().values() and len(self.tagged(ident)) == 1:
                return Result(1, "", "conflict: unable to remove repository reference")
            del self.images[tag]
            return Result(0, f"Untagged: {tag}")
        if command[:2] == ["ps", "-a"] and "-q" in command:
            self.calls.append((command, kwargs))
            return Result(1) if self.ps_fails else Result(0, "\n".join(self.containers()) + "\n")
        if command[:3] == ["container", "inspect", "--format"]:
            self.calls.append((command, kwargs))
            known = self.containers()
            if any(ident not in known for ident in command[4:]):
                return Result(1)
            return Result(0, "\n".join(known[ident] for ident in command[4:]) + "\n")
        if command[:1] == ["build"]:
            self.calls.append((command, kwargs))
            self.images[IMAGE] = (CURRENT, labels(LAYER))
            return Result(0)
        return await super().__call__(args, **kwargs)

    def commands(self, *prefix):
        return [args for args, _ in self.calls if args[:len(prefix)] == list(prefix)]


@pytest.fixture
async def engine_vm(tmp_path, conn):
    settings = SettingsStore(conn)
    settings.set("computer_vm_mode", "per-bot")
    engine = Engine()
    vm = LocalVm(tmp_path, settings=settings, runner=engine, clock=lambda: 0)
    target = vm.target(1)
    engine.raw = container(vm, target, engine)
    engine.calls.clear()
    yield vm, target, engine
    await vm.aclose(stop=False)


def watch_builds(vm, target, engine):
    """The preparation's state at each build, as the panel reads it while the build runs."""
    seen = []

    async def run(args, **kwargs):
        if (args[2:] if args[:1] == ["--host"] else args)[:1] == ["build"]:
            seen.append(dict(vm.preparation[target.state_key]))
        return await engine(args, **kwargs)

    vm.run = run
    return seen


async def test_an_update_builds_from_the_newest_earlier_image_of_ours_and_says_it_is_an_update(engine_vm):
    vm, target, engine = engine_vm
    del engine.images[IMAGE]
    engine.images.update({V9: (ID9, labels(9)), V12: (ID12, labels(12)), V11: (ID11, labels(11)),
                          # Our label on another repository, and our repository without our label: neither is ours.
                          "someone/else:latest": ("sha256:" + "f" * 64, labels(99)),
                          "raphael/cua-local-vm:handmade": ("sha256:" + "d" * 64, {"maintainer": "someone"})})
    seen = watch_builds(vm, target, engine)
    assert (await vm.start(target))["ready"]
    assert engine.commands("build") == [build_args(CONTEXT, V12)]
    assert engine.commands("build")[0] == ["build", "--progress=plain", "--build-arg", "BUILDKIT_INLINE_CACHE=1",
                                           "--cache-from", V12, "--tag", IMAGE, str(CONTEXT)]
    assert seen and all(state["state"] == "building" and state.get("update") is True for state in seen)
    assert target.state_key not in vm.preparation and not vm.updating


async def test_a_first_build_names_no_cache_source_and_is_not_called_an_update(engine_vm):
    vm, target, engine = engine_vm
    del engine.images[IMAGE]
    seen = watch_builds(vm, target, engine)
    assert (await vm.start(target))["ready"]
    assert engine.commands("build") == [["build", "--progress=plain", "--build-arg", "BUILDKIT_INLINE_CACHE=1",
                                         "--tag", IMAGE, str(CONTEXT)]]
    assert seen and all("update" not in state for state in seen)


async def test_a_list_of_images_that_cannot_be_read_never_stops_the_build(engine_vm):
    vm, target, engine = engine_vm
    del engine.images[IMAGE]
    engine.images[V12] = (ID12, labels(12))
    engine.list_fails = True
    assert (await vm.start(target))["ready"]
    assert engine.commands("build") == [build_args(CONTEXT)]
    assert "--cache-from" not in engine.commands("build")[0]


async def test_the_old_computer_made_again_on_the_new_layer_is_part_of_the_update_and_frees_its_image(engine_vm):
    vm, target, engine = engine_vm
    vm.clean_images = True
    engine.images[V12] = (ID12, labels(12))
    engine.raw["Image"] = ID12
    engine.raw["Config"]["Labels"][f"{LABEL}.layer"] = "12"
    seen = []

    async def run(args, **kwargs):
        result = await engine(args, **kwargs)
        if args[0] == "run":
            seen.append(dict(vm.preparation[target.state_key]))
            engine.raw = container(vm, target, engine)
        return result

    vm.run = run
    assert (await vm.start(target))["ready"]
    assert seen == [{"state": "preparing", "ready": False, "progress": "", "update": True}]
    assert target.state_key not in vm.preparation and not vm.updating
    assert await vm.image_tasks[""] == [V12]
    assert set(engine.images) == {IMAGE}


async def test_once_the_current_layer_runs_only_the_older_images_of_ours_are_removed(engine_vm):
    vm, target, engine = engine_vm
    vm.clean_images = True
    engine.images.update({V9: (ID9, labels(9)), V12: (ID12, labels(12)), NEWER: (ID_NEWER, labels(LAYER + 1))})
    assert (await vm.start(target))["ready"]
    assert await vm.image_tasks[""] == [V12, V9]
    assert engine.commands("image", "rm") == [["image", "rm", V12], ["image", "rm", V9]]
    # The current image and a newer layer (a build the owner may go back to) stay.
    assert set(engine.images) == {IMAGE, NEWER}


async def test_an_older_image_a_stopped_container_still_uses_is_kept(engine_vm):
    vm, target, engine = engine_vm
    engine.images.update({V9: (ID9, labels(9)), V12: (ID12, labels(12))})
    engine.others = {"1" * 64: ID12}  # stopped or running, ours or anyone's: a container references it
    assert await vm.remove_old_images(target) == [V9]
    assert engine.commands("image", "rm") == [["image", "rm", V9]]
    assert V12 in engine.images


async def test_images_of_any_other_repository_or_without_our_label_are_never_touched(engine_vm):
    vm, target, engine = engine_vm
    engine.ignore_filters = True  # even an engine whose list shows everything
    others = {"someone/else:latest": ("sha256:" + "f" * 64, labels(1)),
              "raphael/cua-local-vm-extra:driver-0.37.0-v1": ("sha256:" + "1" * 64, labels(1)),
              "raphael/cua-local-vm:handmade": ("sha256:" + "d" * 64, {"maintainer": "someone"}),
              "raphael/cua-local-vm:unlabelled-layer": ("sha256:" + "2" * 64, {LABEL: "1"})}
    engine.images.update({**others, V9: (ID9, labels(9))})
    assert await vm.remove_old_images(target) == [V9]
    assert engine.commands("image", "rm") == [["image", "rm", V9]]
    assert set(others) <= set(engine.images)


@pytest.mark.parametrize("work", ["building", "preparing", "starting", "build", "maintenance", "launch", "start"])
async def test_nothing_is_removed_while_a_computer_is_being_built_made_or_started(engine_vm, work):
    vm, target, engine = engine_vm
    engine.images[V12] = (ID12, labels(12))
    vm.images_checked[""] = 0
    pending = asyncio.get_running_loop().create_future()
    if work in ("building", "preparing", "starting"):
        vm.preparation[target.state_key] = {"state": work, "ready": False}
    elif work == "maintenance":
        vm.maintenance[target.state_key] = object()
    elif work == "launch":
        vm.preparing[target.state_key] = pending
    lock = vm.build_lock if work == "build" else vm.locks.setdefault(target.state_key, asyncio.Lock()) if work == "start" else None
    if lock:
        await lock.acquire()
    try:
        assert await vm.remove_old_images(target) == []
    finally:
        if lock:
            lock.release()
        pending.cancel()
    assert not engine.calls
    assert "" not in vm.images_checked  # looked at again at the next ready start


async def test_a_start_that_begins_during_the_removal_stops_it_before_the_next_image(engine_vm):
    vm, target, engine = engine_vm
    engine.images.update({V9: (ID9, labels(9)), V12: (ID12, labels(12))})

    async def run(args, **kwargs):
        result = await engine(args, **kwargs)
        if args[:2] == ["image", "rm"]:
            vm.preparation[target.state_key] = {"state": "preparing", "ready": False}
        return result

    vm.run = run
    assert await vm.remove_old_images(target) == [V12]
    assert V9 in engine.images


async def test_a_failed_removal_is_logged_by_its_kind_and_never_raised(engine_vm, caplog):
    vm, target, engine = engine_vm
    engine.images[V12] = (ID12, labels(12))
    engine.rm_fails = True
    with caplog.at_level(logging.INFO, logger="raphael_core.computer.vm"):
        assert await vm.remove_old_images(target) == []
    assert "layer 12" in caplog.text and "synthetic private engine output" not in caplog.text

    async def broken(args, **kwargs):
        raise OSError("synthetic pipe detail")

    vm.run = broken
    caplog.clear()
    with caplog.at_level(logging.INFO, logger="raphael_core.computer.vm"):
        assert await vm.remove_old_images(target) == []
    assert "OSError" in caplog.text and "synthetic pipe detail" not in caplog.text


async def test_containers_that_cannot_be_read_keep_every_image(engine_vm):
    vm, target, engine = engine_vm
    engine.images[V12] = (ID12, labels(12))
    engine.ps_fails = True
    assert await vm.remove_old_images(target) == []
    assert not engine.commands("image", "rm") and V12 in engine.images


async def test_the_app_looks_once_a_day_for_each_engine_and_an_injected_runner_never_does(engine_vm, monkeypatch):
    vm, target, engine = engine_vm
    engine.images[V12] = (ID12, labels(12))
    assert vm.clean_images is False
    assert (await vm.start(target))["ready"]
    assert not vm.image_tasks and not engine.commands("image", "ls") and not engine.commands("image", "rm") and V12 in engine.images
    vm.clean_images, clock = True, [0]
    vm.clock = lambda: clock[0]
    vm.clean_soon(target)
    assert await vm.image_tasks[""] == [V12]
    engine.images[V12] = (ID12, labels(12))
    first = vm.image_tasks[""]
    clock[0] = IMAGE_CLEAN_S - 1
    vm.clean_soon(target)
    assert vm.image_tasks[""] is first
    clock[0] = IMAGE_CLEAN_S
    vm.clean_soon(target)
    assert await vm.image_tasks[""] == [V12]
    # The acceptance builds its own image under another repository: the owner's images are never its to remove.
    monkeypatch.setattr(vm_module, "IMAGE", "raphael-acceptance/cua-local-vm:synthetic")
    engine.images[V12] = (ID12, labels(12))
    engine.calls.clear()
    assert await vm.remove_old_images(target) == [] and not engine.calls


async def test_a_press_while_the_computer_is_being_updated_joins_the_update_and_a_reset_waits(engine_vm):
    vm, target, engine = engine_vm
    del engine.images[IMAGE]
    engine.images[V12] = (ID12, labels(12))
    gate = asyncio.Event()

    async def run(args, **kwargs):
        if args[:1] == ["build"]:
            await gate.wait()
        return await engine(args, **kwargs)

    vm.run = run
    viewer = DesktopViewer(vm)
    vm.launch(target)
    for _ in range(200):
        if (vm.preparation.get(target.state_key) or {}).get("state") == "building" and engine.commands("pull"):
            break
        await asyncio.sleep(0)
    status = await viewer.status({"member_id": 1})
    assert status["state"] == "building" and status["update"] is True and not status["ready"]
    for action in ("restart", "update", "repair"):
        answer = await viewer.lifecycle({"member_id": 1, "action": action, "host": "", "target": target.key})
        assert answer["state"] == "building" and answer["update"] is True and answer["lifecycle"] is None
    with pytest.raises(VmError, match="^busy$"):
        await maintain(vm, target, "reset", confirmed=True)
    assert not any(args[0] in ("stop", "rm", "restart", "run") for args, _ in engine.calls)
    assert not vm.maintenance and not vm.lifecycle
    gate.set()
    await vm.preparing[target.state_key]
    after = await viewer.status({"member_id": 1})
    assert after["state"] == "running" and "update" not in after

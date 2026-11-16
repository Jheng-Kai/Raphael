"""The computer's housekeeping: a size from the engine, old scratch cleared, a UTF-8 locale. No Docker: the existing fakes, and the shell scripts run for real where one is there."""

import logging
import os
import shutil
import subprocess
import time
from pathlib import Path

import pytest

from raphael_core.computer import vm as module
from raphael_core.computer.vm import (GUEST, LABEL, Result, compatible, exec_args, known_previous, limits_match, run_args,
                                      scratch_args, sized)
from .test_vm import container, desktop, per_bot_desktop  # noqa: F401

GIB = 1024**3
SHELL = shutil.which("sh")


def earlier_layer(raw, layer="12"):
    """A computer as a layer before 13 made it: its own label and image (and no locale in its environment)."""
    raw["Config"]["Labels"][f"{LABEL}.layer"] = layer
    raw["Image"] = "sha256:the-layer-before"
    return raw


# --- 1. a UTF-8 locale ------------------------------------------------------------------------------------------------


def test_the_computer_runs_with_a_utf8_locale(tmp_path):
    vm = module.LocalVm(tmp_path)
    for target in (vm.target(1), vm.shared_target("", 1, 1)):
        args = run_args(target, vm.owner, "private")
        environment = [args[i + 1] for i, value in enumerate(args[:-1]) if value == "-e"]
        assert "LANG=C.UTF-8" in environment and "LC_ALL=C.UTF-8" in environment


# --- 2. the shared computer's size follows the engine ----------------------------------------------------------------


@pytest.mark.parametrize("memory_gib,cpus,expected", [
    (7.5, 8, (6, 4)),        # today's numbers on an engine of that size
    (7.8, 20, (6, 8)),       # the owner's Docker Desktop: about half of 15.7 GB, every logical CPU
    (2.0, 1, (4, 2)),        # clamped up
    (3.0, 3, (4, 2)),
    (15.7, 20, (12, 8)),     # clamped down, 12.56 floors then clamps
    (64.0, 64, (12, 8)),
    (10.0, 12, (8, 6)),      # floor(8.0) and half of 12
    (11.0, 5, (8, 2)),       # floor(8.8) is 8 and half of 5 is 2
])
def test_the_size_rule_clamps_memory_to_4_to_12_gib_and_cpus_to_2_to_8(memory_gib, cpus, expected):
    assert sized(int(memory_gib * GIB), cpus) == expected


async def test_the_shared_computer_takes_the_engines_size_when_it_is_made(desktop):
    vm, target, runtime = desktop
    runtime.raw = None
    runtime.engine = (int(15.7 * GIB), 20)
    original = runtime.__call__

    async def runner(args, **kwargs):
        actual = args[2:] if args[:1] == ["--host"] else args
        if actual[0] == "run" and actual[1] == "-d":
            runtime.raw = container(vm, target, runtime)
            runtime.raw["HostConfig"].update(Memory=12 * GIB, MemorySwap=12 * GIB, NanoCpus=8 * 1_000_000_000)
        return await original(args, **kwargs)

    vm.run = runner
    assert (await vm.start(target))["ready"]
    made = next(args for args, _ in runtime.calls if args[:2] == ["run", "-d"])
    assert (made[made.index("--memory") + 1], made[made.index("--memory-swap") + 1], made[made.index("--cpus") + 1]) == ("12g", "12g", "8")


async def test_a_member_computer_keeps_its_own_size_whatever_the_engine_has(per_bot_desktop):
    vm, target, runtime = per_bot_desktop
    runtime.engine = (int(64 * GIB), 64)
    args = run_args(target, vm.owner, "private", size=await vm.machine_size(target))
    assert (args[args.index("--memory") + 1], args[args.index("--cpus") + 1]) == ("3g", "2")
    runtime.calls.clear()
    vm.running.clear()
    assert (await vm.start(target))["ready"]
    assert not any(args[0] == "update" for args, _ in runtime.calls)


@pytest.mark.parametrize("answer", [None, "linux", "0 0", "x y", "1 2 3", "-5 4"])
async def test_an_engine_that_cannot_be_asked_leaves_the_numbers_it_always_had(desktop, caplog, answer):
    vm, target, runtime = desktop
    original = vm.run

    async def runner(args, **kwargs):
        if args[0] == "info" and "{{.MemTotal}} {{.NCPU}}" in args:
            return Result(1) if answer is None else Result(0, answer)
        return await original(args, **kwargs)

    vm.run = runner
    with caplog.at_level(logging.WARNING):
        assert await vm.machine_size(target) == module.SHARED_SIZE == (6, 4)
    assert target.remote not in vm.sizes  # a guess is not kept: the next start asks again


async def test_an_engine_that_fails_while_asked_leaves_the_numbers_it_always_had(desktop):
    vm, target, runtime = desktop

    async def broken(args, **kwargs):
        raise OSError("engine gone")

    vm.run = broken
    assert await vm.machine_size(target) == module.SHARED_SIZE


async def test_the_size_is_asked_once_in_a_while_not_at_every_start(desktop):
    vm, target, runtime = desktop
    clock = [0.0]
    vm.clock = lambda: clock[0]
    await vm.machine_size(target)
    await vm.machine_size(target)
    asked = lambda: sum(args[:1] == ["info"] and "{{.MemTotal}} {{.NCPU}}" in args for args, _ in runtime.calls)
    assert asked() == 1
    clock[0] = module.SIZE_TTL_S + 1
    runtime.engine = (int(15.7 * GIB), 20)
    assert await vm.machine_size(target) == (12, 8) and asked() == 2


async def test_a_running_shared_computer_of_another_size_is_updated_in_place_once(desktop):
    vm, target, runtime = desktop
    assert runtime.raw["HostConfig"]["Memory"] == 6 * GIB
    runtime.engine = (int(15.7 * GIB), 20)
    runtime.calls.clear()
    assert (await vm.start(target))["ready"]
    updates = [args for args, _ in runtime.calls if args[0] == "update"]
    assert updates == [["update", "--memory", "12g", "--memory-swap", "12g", "--cpus", "8", target.name]]
    # Nothing was rebuilt or stopped, and the computer is still the one `compatible` accepts.
    assert not any(args[0] in ("rm", "stop", "restart") or args[:2] == ["run", "-d"] for args, _ in runtime.calls)
    assert runtime.raw["HostConfig"]["Memory"] == 12 * GIB and runtime.raw["HostConfig"]["NanoCpus"] == 8_000_000_000
    assert compatible(runtime.raw, target, vm.owner, runtime.image_id)
    runtime.calls.clear()
    vm.running.clear()
    assert (await vm.start(target))["ready"]
    assert not any(args[0] == "update" for args, _ in runtime.calls)


async def test_a_refused_update_is_logged_and_the_computer_starts_anyway(desktop, caplog):
    vm, target, runtime = desktop
    runtime.engine = (int(15.7 * GIB), 20)
    original = vm.run

    async def refusing(args, **kwargs):
        if (args[2:] if args[:1] == ["--host"] else args)[0] == "update":
            runtime.calls.append((args, kwargs))
            return Result(1, "", "cannot lower memory")
        return await original(args, **kwargs)

    vm.run = refusing
    with caplog.at_level(logging.WARNING):
        assert (await vm.start(target))["ready"]
    assert "could not be resized" in caplog.text
    assert runtime.raw["HostConfig"]["Memory"] == 6 * GIB


@pytest.mark.parametrize("memory,swap,nano,ok", [
    (6, 6, 4, True), (4, 4, 2, True), (12, 12, 8, True),
    (3, 3, 4, False), (13, 13, 4, False), (6, 6, 1, False), (6, 6, 9, False), (6, 8, 4, False),
])
def test_a_shared_computer_is_compatible_at_any_size_the_rule_allows_and_no_other(desktop, memory, swap, nano, ok):
    vm, target, _ = desktop
    host = {"Memory": memory * GIB, "MemorySwap": swap * GIB, "NanoCpus": nano * 1_000_000_000}
    assert limits_match(host, target) is ok
    host["Memory"] += 1  # not a whole GiB
    assert not limits_match(host, target)


def test_a_members_own_computer_is_compatible_only_at_its_own_size(per_bot_desktop):
    vm, target, runtime = per_bot_desktop
    assert compatible(runtime.raw, target, vm.owner, runtime.image_id)
    runtime.raw["HostConfig"]["Memory"] = runtime.raw["HostConfig"]["MemorySwap"] = 6 * GIB
    assert not compatible(runtime.raw, target, vm.owner, runtime.image_id)


# --- 3. old scratch ------------------------------------------------------------------------------------------------


async def test_old_scratch_is_cleared_when_a_computer_is_prepared_and_once_a_day_after(desktop):
    vm, target, runtime = desktop
    clock = [1000.0]
    vm.clock = lambda: clock[0]

    def clearings():
        return [args for args, _ in runtime.calls if args[0] == "exec" and "find" in " ".join(args)]
    assert (await vm.start(target))["ready"]
    assert clearings() == [scratch_args(target)]
    # Another tool call a moment later, and one an hour later: the same computer is not searched again.
    for later in (1010.0, 1000.0 + 3600):
        clock[0] = later
        vm.running.clear()
        assert (await vm.start(target))["ready"]
    assert len(clearings()) == 1
    clock[0] = 1000.0 + 86_400 + 1
    vm.running.clear()
    assert (await vm.start(target))["ready"]
    assert len(clearings()) == 2
    # A computer that sleeps and wakes is prepared again, so it is cleared again at once.
    clock[0] += 10
    runtime.raw["State"]["Running"] = False
    vm.running.clear()
    assert (await vm.start(target))["ready"]
    assert len(clearings()) == 3


def test_the_cleanup_command_names_exactly_tmp_and_the_job_folder(desktop):
    _, target, _ = desktop
    args = scratch_args(target)
    assert args[:-5] == exec_args(target, [])
    assert args[-5:-2] == ["sh", "-c", args[-3]] and args[-2:] == ["sh", f"{GUEST}/.raphael-jobs"]
    script = args[-3]
    assert script.split("; ") == [
        'find /tmp -xdev -mindepth 1 -type f ! -path "/tmp/.*" -mmin +4320 -amin +4320 -delete 2>/dev/null',
        'find "$1" -maxdepth 1 -type f \\( -name "*.log" -o -name "*.exit" \\) -mmin +10080 -delete 2>/dev/null',
        "true"]
    # Three days, and seven; nothing is removed with rm, nothing recursive, nothing else is searched.
    assert " rm " not in script and "-r" not in script.replace("-mindepth", "").replace("-maxdepth", "")


async def test_a_cleanup_that_fails_is_logged_and_never_stops_the_computer(desktop, caplog):
    vm, target, runtime = desktop
    original = vm.run

    async def failing(args, **kwargs):
        if "find" in " ".join(args):
            runtime.calls.append((args, kwargs))
            if kwargs.get("timeout") == 60 and len(runtime.calls) % 2:
                raise TimeoutError
            return Result(1, "", "find: error")
        return await original(args, **kwargs)

    vm.run = failing
    with caplog.at_level(logging.WARNING):
        assert (await vm.start(target))["ready"]
        vm.scratch_cleaned.clear()
        vm.running.clear()
        assert (await vm.start(target))["ready"]
    assert "scratch could not be cleared" in caplog.text


@pytest.fixture
def scratch(tmp_path):
    """The cleanup command, run with a real POSIX shell and GNU find over a folder standing for /tmp and a job folder."""
    if SHELL is None:
        pytest.skip("A POSIX shell is required")
    version = subprocess.run([SHELL, "-c", "find --version"], capture_output=True, text=True)
    if "GNU findutils" not in version.stdout:
        pytest.skip("GNU find is required")
    temporary, jobs = tmp_path / "tmp", tmp_path / "jobs"
    temporary.mkdir()
    jobs.mkdir()

    def run():
        script = scratch_args(module.LocalVm(tmp_path).target(1))[-3].replace("/tmp", temporary.as_posix())
        return subprocess.run([SHELL, "-c", script, "sh", jobs.as_posix()], capture_output=True, text=True, timeout=30)

    def make(path, days=0.0, content="x"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        stamp = time.time() - days * 86_400
        os.utime(path, (stamp, stamp))
        return path
    return temporary, jobs, run, make


def test_old_files_in_tmp_go_and_everything_else_stays(scratch):
    temporary, jobs, run, make = scratch
    old = make(temporary / "render" / "video.mp4", 5)
    read_lately = make(temporary / "tool.bin", 5)
    os.utime(read_lately, (time.time(), time.time() - 5 * 86_400))  # written long ago but read a moment ago
    recent = make(temporary / "render" / "new.mp4", 2)
    lock = make(temporary / ".X1-lock", 30)
    socket_dir_file = make(temporary / ".X11-unix" / "X1", 30)
    assert run().returncode == 0
    assert not old.exists() and recent.exists() and read_lately.exists()
    assert lock.exists() and socket_dir_file.exists()
    assert (temporary / "render").is_dir()


def test_job_logs_older_than_a_week_go_and_a_running_job_never_does(scratch):
    temporary, jobs, run, make = scratch
    finished_log, finished_exit = make(jobs / "aaaa.log", 8), make(jobs / "aaaa.exit", 8, "0")
    running = make(jobs / "bbbb.log", 0.01)            # being written now, no exit file yet
    quiet_running = make(jobs / "cccc.log", 6)         # a long job whose last line was days ago: its limit is six hours
    recent_pair = make(jobs / "dddd.log", 1), make(jobs / "dddd.exit", 1, "0")
    other = make(jobs / "notes.txt", 30)               # not a job's file
    nested = make(jobs / "folder" / "eeee.log", 30)    # not one level down
    assert run().returncode == 0
    assert not finished_log.exists() and not finished_exit.exists()
    assert running.exists() and quiet_running.exists() and all(path.exists() for path in recent_pair)
    assert other.exists() and nested.exists()


def test_a_missing_job_folder_is_no_failure(scratch):
    temporary, jobs, run, make = scratch
    jobs.rmdir()
    old = make(temporary / "x", 9)
    assert run().returncode == 0 and not old.exists()


# --- 4. an existing computer is made again once, keeping its workspace and sign-ins --------------------------------


async def test_a_computer_of_the_layer_before_is_made_again_once_and_not_at_every_start(desktop):
    vm, target, runtime = desktop
    runtime.raw = earlier_layer(runtime.raw)
    runtime.raw["Config"]["Env"] = ["VNC_PW=private", f"RAPHAEL_SCREENS={target.screens}"]
    assert known_previous(runtime.raw, target, vm.owner) and not compatible(runtime.raw, target, vm.owner, runtime.image_id)
    original = vm.run

    async def runner(args, **kwargs):
        actual = args[2:] if args[:1] == ["--host"] else args
        if actual[:2] == ["run", "-d"]:
            runtime.raw = container(vm, target, runtime)
        return await original(args, **kwargs)

    vm.run = runner
    runtime.calls.clear()
    assert (await vm.start(target))["ready"]
    order = [(args[0], args[1] if len(args) > 1 else "") for args, _ in runtime.calls if args[0] in ("stop", "rm", "run")]
    # Stopped, removed, made: one of each, and its workspace is never removed.
    assert order == [("stop", "--time"), ("rm", target.name), ("run", "-d")]
    assert not any(args[:2] == ["volume", "rm"] for args, _ in runtime.calls)
    # The next starts find a computer of the layer, whole: nothing is made again.
    for _ in range(2):
        runtime.calls.clear()
        vm.running.clear()
        assert (await vm.start(target))["ready"]
        assert not [args for args, _ in runtime.calls if args[0] in ("stop", "rm", "run", "create")]


async def test_a_member_computer_of_the_layer_before_is_made_again_once_too(per_bot_desktop):
    vm, target, runtime = per_bot_desktop
    runtime.raw = earlier_layer(runtime.raw)
    runtime.raw["Config"]["Env"] = ["VNC_PW=private", f"RAPHAEL_SCREENS={target.screens}"]
    runtime.raw["Config"]["Labels"][f"{LABEL}.layer"] = "12"
    assert known_previous(runtime.raw, target, vm.owner)
    original = vm.run

    async def runner(args, **kwargs):
        if args[:2] == ["run", "-d"]:
            runtime.raw = container(vm, target, runtime)
        return await original(args, **kwargs)

    vm.run = runner
    runtime.calls.clear()
    assert (await vm.start(target))["ready"]
    assert sum(args[:2] == ["run", "-d"] for args, _ in runtime.calls) == 1 and sum(args[0] == "rm" for args, _ in runtime.calls) == 1
    runtime.calls.clear()
    vm.running.clear()
    assert (await vm.start(target))["ready"]
    assert not [args for args, _ in runtime.calls if args[0] in ("rm", "run", "create")]


@pytest.mark.parametrize("layer", ["5", "7", "8", "9", "10", "11", "12"])
async def test_every_shared_layer_before_13_is_recognised_with_its_screens_and_old_size(desktop, layer):
    vm, target, runtime = desktop
    raw = earlier_layer(runtime.raw, layer)
    raw["Config"]["Env"] = ["VNC_PW=private", "RAPHAEL_SCREENS=6"]
    assert known_previous(raw, target, vm.owner)
    raw["HostConfig"]["NanoCpus"] = 8_000_000_000  # a size no layer ever made: somebody else's container
    assert not known_previous(raw, target, vm.owner)


# --- 5. the image -------------------------------------------------------------------------------------------------------


def test_the_dockerfile_comment_about_root_is_true_and_the_layer_is_the_one_the_core_names():
    text = (Path(module.__file__).parent / "image" / "Dockerfile").read_text(encoding="utf-8")
    assert "Nothing in a computer is root" not in text and "sudo without a password" in text
    assert f'org.raphael.computer.layer="{module.IMAGE_LABELS[LABEL + ".layer"]}"' in text
    assert module.IMAGE.endswith("-v" + module.IMAGE_LABELS[LABEL + ".layer"])

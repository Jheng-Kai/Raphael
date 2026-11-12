"""Docker desktop contracts without a daemon, network, desktop or model."""

import asyncio
import base64
import csv
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from raphael_core.agent.gate import ToolGate
from raphael_core.agent.mcp_server import RaphaelMcp
from raphael_core.agent.policy import Tier
from raphael_core.background.snapshot import take_snapshot
from raphael_core.brain.settings import SettingsStore, checked
from raphael_core.computer.vm import BASE, DRIVER, IMAGE, IMAGE_LABELS, LABEL, GUEST, LocalVm, Result, VmError, compatible, exec_args, healthy, run_args
from raphael_core.computer.vm_bridge import CuaBridge, normalize_schema
from raphael_core.computer.vm_tools import VmTools, vm_scope
from raphael_core.services.attachment_store import AttachmentStore
from raphael_core.worker.loop import Call, Turn, ToolOutcome, run_task, without_computer_images


class Runtime:
    def __init__(self):
        self.calls, self.raw, self.image_id = [], None, "sha256:test-image"
        self.up, self.built = True, True
        self.screens_ready = True

    async def __call__(self, args, **kwargs):
        if args[:1] == ["--host"]:
            args = args[2:]
        self.calls.append((args, kwargs))
        if args[0] == "info":
            return Result(0, "linux") if self.up else Result(1)
        if args[:2] == ["image", "inspect"]:
            return Result(0, json.dumps([{"Id": self.image_id, "Config": {"Labels": IMAGE_LABELS}}])) if self.built else Result(1)
        if args[:2] == ["container", "inspect"]:
            return Result(0, json.dumps([self.raw])) if self.raw else Result(1)
        if args[0] == "ps":
            return Result(0, self.raw["Name"].lstrip("/") if self.raw else "")
        if args[0] == "start":
            self.raw["State"]["Running"] = True
        if args[0] == "stop":
            self.raw["State"]["Running"] = False
        if args[0] == "rm":
            self.raw = None
        if args[0] == "exec" and args[-1] == "--version":
            if "/dev/shm/raphael-screens.ready" in args and not self.screens_ready:
                return Result(42, "cua-driver 0.37.0")
            return Result(0, "cua-driver 0.37.0")
        if "health_report" in args:
            return Result(0, '{"schema_version":"1","overall":"ok","checks":[]}')
        if any(arg.startswith('"""Guest-only file checkpoints') for arg in args):
            return Result(0, json.dumps("0" * 32 if args[-2] == "begin" else [] if args[-2] == "list" else None))
        if "base64" in " ".join(args):
            return Result(0, base64.b64encode(b"hello").decode())
        return Result(0, "ok")


def container(vm, target, runtime):
    raw = {"Name": "/" + target.name, "Image": runtime.image_id,
        "Config": {"Labels": {**IMAGE_LABELS, f"{LABEL}.owner": vm.owner, f"{LABEL}.target": target.unit}, "Env": ["VNC_PW=private", f"RAPHAEL_SCREENS={target.screens}"]},
        "State": {"Running": True}, "HostConfig": {"Privileged": False, "CapDrop": ["ALL"], "CapAdd": ["SETUID", "SETGID"],
            "IpcMode": "private", "CgroupnsMode": "private", "NetworkMode": "bridge", "RestartPolicy": {"Name": "no"},
            "Memory": (6 if target.container else 3) * 1024**3, "MemorySwap": (6 if target.container else 3) * 1024**3,
            "NanoCpus": (4 if target.container else 2) * 1_000_000_000, "PidsLimit": 4096,
            "ShmSize": 512 * 1024**2, "PortBindings": {"6901/tcp": [{"HostIp": "127.0.0.1", "HostPort": "6080"}]}},
        "Mounts": [{"Type": "bind", "Source": str(target.workspace), "Destination": GUEST, "RW": True}],
        "NetworkSettings": {"Ports": {"6901/tcp": [{"HostIp": "127.0.0.1", "HostPort": "6080"}]}}}
    if target.shared:
        raw["Mounts"].append({"Type": "bind", "Source": str(target.shared), "Destination": "/home/cua/team", "RW": True})
    if target.remote:
        for mount, source in zip(raw["Mounts"], [target.workspace, target.shared]):
            mount.update(Type="volume", Name=str(source), Source="/engine/volumes/" + str(source))
        raw["HostConfig"]["Mounts"] = [{"Type": "volume", "Source": m["Name"], "Target": m["Destination"]} for m in raw["Mounts"]]
        raw["NetworkSettings"]["Networks"] = {"bridge": {"IPAddress": "172.18.0.2"}}
    return raw



@pytest.fixture
async def desktop(tmp_path, conn, monkeypatch):
    # Shared desktop pictures now come from the clipped view, not the driver fake.
    monkeypatch.setattr("raphael_core.computer.rfb_view.capture", lambda *args, **kwargs: b"\x89PNG\r\n\x1a\nimage")
    settings = SettingsStore(conn)
    settings.set("computer_vm_mode", "shared")
    runtime = Runtime()
    vm = LocalVm(tmp_path, settings=settings, runner=runtime, clock=lambda: 0)
    target = await vm.seat()
    runtime.raw = container(vm, target, runtime)
    return vm, target, runtime


@pytest.fixture
async def per_bot_desktop(tmp_path, conn):
    settings = SettingsStore(conn)
    settings.set("computer_vm_mode", "per-bot")
    runtime = Runtime()
    vm = LocalVm(tmp_path, settings=settings, runner=runtime, clock=lambda: 0)
    target = await vm.seat()
    runtime.raw = container(vm, target, runtime)
    return vm, target, runtime


async def test_status_without_probe_only_inspects_until_engine_ttl_expires(desktop):
    vm, target, runtime = desktop
    clock = [0]
    vm.clock = lambda: clock[0]
    await vm.status(target, probe=False)
    runtime.calls.clear()
    for _ in range(5):
        await vm.status(target, probe=False)
    assert [args[:2] for args, _ in runtime.calls] == [["container", "inspect"]] * 5
    clock[0] = 60
    runtime.calls.clear()
    await vm.status(target, probe=False)
    assert [args[0] for args, _ in runtime.calls] == ["info", "image", "container"]


async def test_failed_container_inspect_rechecks_engine_and_image(desktop):
    vm, target, runtime = desktop
    await vm.status(target, probe=False)
    runtime.calls.clear()
    runtime.raw = None
    assert (await vm.status(target, probe=False))["state"] == "missing"
    assert [args[0] for args, _ in runtime.calls] == ["container", "info", "image"]


def test_args_are_hardened_loopback_only_and_host_agnostic(tmp_path):
    vm = LocalVm(tmp_path / 'a,b')
    target = vm.target()
    args = run_args(target, vm.owner, "secret")
    assert args[args.index("--pids-limit") + 1] == "4096"
    assert args[args.index("-p") + 1] == "127.0.0.1::6901"
    mount = next(csv.reader([args[args.index("--mount") + 1]]))
    assert mount == ["type=bind", f"source={target.workspace}", f"target={GUEST}"]
    assert "--privileged" not in args and "--network=host" not in args
    assert exec_args(target, [DRIVER, "mcp"], interactive=True)[:3] == ["exec", "-i", "-u"]


@pytest.mark.parametrize('remote', [False, True])
async def test_start_installs_the_decorative_wallpaper_once_per_start_and_target(desktop, remote):
    vm, target, runtime = desktop
    if remote:
        vm.settings.set('computer_ssh_alias', 'sample-host')
        target = vm.target()
        runtime.raw = container(vm, target, runtime)
    sent = []
    original = vm.run

    async def run(args, **kwargs):
        sent.append((args, kwargs))
        return await original(args, **kwargs)

    vm.run = run
    for _ in range(3):
        assert (await vm.start(target))['ready']
    copies = [args for args, _ in runtime.calls if args[0] == 'cp']
    assert len(copies) == 2
    assert any(Path(args[1]).name == 'wallpaper.py' and args[-1] == target.name + ':/opt/raphael-desktop/wallpaper.py' for args in copies)
    assert any(Path(args[1]).name == 'wallpapers' and args[-1] == target.name + ':/opt/raphael-desktop/' for args in copies)
    watcher = [(args, options) for args, options in runtime.calls if args[0] == 'exec' and '-d' in args and 'sh' in args]
    assert len(watcher) == 1
    script = watcher[0][0][-1]
    assert 'pgrep' in script and 'xfce4-session' in script and '/proc/' in script and 'DBUS_SESSION_BUS_ADDRESS' in script
    assert '--watch' in script and '60' in script
    # A watcher that is already running is ended, never a reason to leave: it holds the picture it was started with.
    lines = script.splitlines()
    assert lines.index('pkill -f "$watcher" >/dev/null 2>&1') < next(i for i, line in enumerate(lines) if line.startswith('exec '))
    assert 'pgrep -f "$watcher"' not in script and script.count('exit 0') == 3
    assert all(options['timeout'] <= 3 for args, options in runtime.calls if args[0] == 'cp' or args == watcher[0][0])
    if remote:
        assert all(args[:2] == ['--host', 'ssh://sample-host'] for args, _ in sent)
    await vm.stop(target)
    assert (await vm.start(target))['ready']
    assert len([args for args, _ in runtime.calls if args[0] == 'cp']) == 4


def test_finding_docker_walks_path_once_however_often_it_is_asked(monkeypatch):
    from raphael_core.computer import vm as module
    walked = []
    monkeypatch.setattr('raphael_core.computer.desktop_host.shutil.which', lambda name: walked.append(name) or 'docker.exe')
    monkeypatch.setattr(module, '_docker_cli', None)
    for _ in range(50):
        assert module.Docker('').argv(['info'])[0] == 'docker.exe'
    assert len(walked) == 1


async def test_an_installed_check_does_not_walk_path_on_every_poll(tmp_path, monkeypatch):
    from raphael_core.computer.desktop_host import DockerDesktop
    walked = []
    monkeypatch.setattr('raphael_core.computer.desktop_host.shutil.which', lambda name: walked.append(name) or 'docker.exe')
    vm = LocalVm(tmp_path, runner=Runtime())
    vm.desktop = DockerDesktop()
    for _ in range(20):
        assert await vm.installed()
    assert len(walked) == 1


def _watcher_script(runtime):
    return next(args[-1] for args, _ in runtime.calls if args[0] == 'exec' and '-d' in args and 'sh' in args)


async def test_the_owner_picture_goes_to_the_guest_and_the_watcher_keeps_it(desktop, tmp_path):
    vm, target, runtime = desktop
    (tmp_path / 'computer-wallpaper.jpg').write_bytes(b'\xff\xd8\xff sample')
    assert (await vm.start(target))['ready']
    own = [args for args, _ in runtime.calls if args[0] == 'cp' and args[-1] == target.name + ':/opt/raphael-desktop/wallpapers/own.jpg']
    assert [Path(args[1]).name for args in own] == ['computer-wallpaper.jpg']
    assert '--watch --image /opt/raphael-desktop/wallpapers/own.jpg' in _watcher_script(runtime)


async def test_a_changed_or_removed_picture_is_put_up_at_the_next_start_of_a_running_computer(desktop, tmp_path):
    vm, target, runtime = desktop
    picture = tmp_path / 'computer-wallpaper.jpg'

    def scripts():
        return [args[-1] for args, _ in runtime.calls if args[0] == 'exec' and '-d' in args and 'sh' in args]

    async def start_again():
        vm.invalidate(target)  # a start confirmed moments ago is answered from memory
        assert (await vm.start(target))['ready']

    picture.write_bytes(b'\xff\xd8\xff first')
    await start_again()
    await start_again()
    assert len(scripts()) == 1 and '--image' in scripts()[0]
    picture.write_bytes(b'\xff\xd8\xff another picture')
    await start_again()
    assert len(scripts()) == 2 and '--image' in scripts()[1]
    picture.unlink()
    await start_again()
    await start_again()
    assert len(scripts()) == 3 and '--image' not in scripts()[2]
    picture.write_bytes(b'\xff\xd8\xff back')
    await start_again()
    assert len(scripts()) == 4 and '--image' in scripts()[3]
    assert not any(args[0] in ('stop', 'restart', 'rm') for args, _ in runtime.calls)


@pytest.mark.parametrize('content', [None, b'<svg/>', b'\xff\xd8\xff' + b'0' * 8_000_000], ids=['absent', 'not-a-jpeg', 'too-large'])
async def test_without_a_usable_picture_the_guest_keeps_the_town(desktop, tmp_path, content):
    vm, target, runtime = desktop
    if content is not None:
        (tmp_path / 'computer-wallpaper.jpg').write_bytes(content)
    assert vm.own_wallpaper() is None
    assert (await vm.start(target))['ready']
    assert not [args for args, _ in runtime.calls if args[0] == 'cp' and args[-1].endswith('own.jpg')]
    assert '--image' not in _watcher_script(runtime)


async def test_a_failed_picture_copy_still_starts_the_town(desktop, tmp_path):
    vm, target, runtime = desktop
    (tmp_path / 'computer-wallpaper.jpg').write_bytes(b'\xff\xd8\xff sample')
    original = vm.run

    async def run(args, **kwargs):
        if args[0] == 'cp' and args[-1].endswith('own.jpg'):
            return Result(1, '', 'Synthetic copy failure')
        return await original(args, **kwargs)

    vm.run = run
    assert (await vm.start(target))['ready']
    assert '--image' not in _watcher_script(runtime)


@pytest.mark.parametrize('failure', ['exit', 'exception'])
async def test_wallpaper_copy_failure_leaves_the_start_result_and_once_mark_alone(desktop, failure):
    vm, target, runtime = desktop
    original = vm.run

    async def run(args, **kwargs):
        if args[0] == 'cp':
            runtime.calls.append((args, kwargs))
            if failure == 'exception':
                raise OSError('Synthetic copy failure')
            return Result(1, '', 'Synthetic copy failure')
        return await original(args, **kwargs)

    vm.run = run
    for _ in range(2):
        result = await vm.start(target)
        assert result['state'] == 'running' and result['ready']
    assert len([args for args, _ in runtime.calls if args[0] == 'cp']) == 1
    assert not any(args[0] == 'exec' and '-d' in args for args, _ in runtime.calls)


async def test_a_stalled_wallpaper_copy_cannot_hold_the_ready_computer(desktop, monkeypatch):
    from raphael_core.computer import vm as module
    vm, target, runtime = desktop
    monkeypatch.setattr(module, 'WALLPAPER_SETUP_S', .01, raising=False)
    original = vm.run

    async def run(args, **kwargs):
        if args[0] == 'cp':
            runtime.calls.append((args, kwargs))
            await asyncio.sleep(10)
        return await original(args, **kwargs)

    vm.run = run
    assert (await asyncio.wait_for(vm.start(target), timeout=.5))['ready']
    assert len([args for args, _ in runtime.calls if args[0] == 'cp']) == 1


@pytest.mark.parametrize("zone,expected", [
    ("Asia/Taipei", "Asia/Taipei"), ("Europe/Paris", "Europe/Paris"),
    (None, "UTC"), ("", "UTC"), ("invalid/timezone", "UTC"), (8, "UTC"),
])
def test_run_args_use_known_iana_zone_or_utc(tmp_path, zone, expected):
    vm = LocalVm(tmp_path)
    args = run_args(vm.target(), vm.owner, "secret", tz=zone)
    assert [args[index + 1] for index, arg in enumerate(args) if arg == "-e"] == ["VNC_PW=secret", f"TZ={expected}", "RAPHAEL_SCREENS=1", "VNC_RESOLUTION=1280x900"]
    assert args[-1] == IMAGE


async def test_start_reads_latest_owner_timezone_when_creating_container(desktop):
    vm, target, runtime = desktop
    runtime.raw = None
    original = runtime.__call__

    async def run(args, **kwargs):
        if args[0] == "run":
            runtime.raw = container(vm, target, runtime)
        return await original(args, **kwargs)

    owner = SimpleNamespace(zone=None)
    vm.run, vm.timezone = run, lambda: owner.zone
    owner.zone = "Asia/Taipei"
    assert (await vm.start(target))["ready"]
    assert "TZ=Asia/Taipei" in next(args for args, _ in runtime.calls if args[0] == "run")


async def test_start_launches_installed_docker_and_builds_missing_image_once(desktop):
    vm, target, runtime = desktop
    runtime.up, runtime.built = False, False
    launches, progress = [], []

    class Desktop:
        def installed(self):
            return True
        async def start(self):
            launches.append("start")
            runtime.up = True

    original = runtime.__call__

    async def run(args, **kwargs):
        if args[0] in ("pull", "build"):
            kwargs["progress"]("#3 [2/4] Installing desktop tools")
            progress.append(vm.preparation[target.state_key].copy())
        if args[0] == "build":
            runtime.built = True
        return await original(args, **kwargs)

    vm.desktop, vm.run = Desktop(), run
    await vm.ensure_engine(target, start_desktop=True)
    assert (await vm.start(target))["ready"]
    assert (await vm.start(target))["ready"]
    assert launches == ["start"]
    assert len([args for args, _ in runtime.calls if args[0] == "build"]) == 1
    assert progress and all(p["state"] == "building" and "[2/4]" in p["progress"] for p in progress)
    assert target.key not in vm.preparation


async def test_absent_docker_never_launches_or_builds(desktop):
    vm, target, runtime = desktop
    runtime.up = False

    class Desktop:
        def installed(self):
            return False
        async def start(self):
            pytest.fail("Absent Docker must never be started")

    vm.desktop = Desktop()
    with pytest.raises(VmError, match="absent"):
        await vm.start(target)
    assert not any(args[0] in ("pull", "build", "run") for args, _ in runtime.calls)


@pytest.mark.parametrize("running", [True, False])
async def test_start_recreates_owned_container_when_owner_zone_arrives(desktop, running):
    vm, target, runtime = desktop
    runtime.raw["State"]["Running"] = running
    runtime.raw["Config"]["Env"].append("TZ=UTC")
    target.workspace.mkdir(parents=True)
    (target.workspace / "keep.txt").write_text("keep")
    original = runtime.__call__

    async def run(args, **kwargs):
        if args[0] == "run":
            runtime.raw = container(vm, target, runtime)
            runtime.raw["Config"]["Env"].append("TZ=Asia/Taipei")
        return await original(args, **kwargs)

    vm.run, vm.timezone = run, lambda: "Asia/Taipei"
    assert (await vm.start(target))["ready"]
    assert any(args == ["rm", target.name] for args, _ in runtime.calls)
    assert "TZ=Asia/Taipei" in next(args for args, _ in runtime.calls if args[0] == "run")
    assert (target.workspace / "keep.txt").read_text() == "keep"
    runtime.calls.clear()
    await vm.start(target)
    assert not any(args[0] in ("run", "stop", "rm") for args, _ in runtime.calls)


@pytest.mark.parametrize("blocked", ["active", "held", "busy", None])
async def test_home_timezone_refresh_recovers_old_vm_and_defers_busy_desktops(desktop, blocked):
    vm, target, runtime = desktop
    original = runtime.__call__

    async def run(args, **kwargs):
        if args[0] == "run":
            runtime.raw = container(vm, target, runtime)
            runtime.raw["Config"]["Env"].append("TZ=Asia/Taipei")
        return await original(args, **kwargs)

    vm.run, vm.timezone = run, lambda: "Asia/Taipei"
    vm.targets.clear()  # A fresh app instance must discover the pre-launch VM.
    if blocked == "active": vm.active[target.key] = 1
    if blocked == "held": vm.held.add(target.key)
    if blocked == "busy": vm.busy = lambda key: True
    await vm.refresh_timezone()
    assert target.key in vm.targets
    assert vm.timezone_pending == bool(blocked)
    assert any(args[0] == "run" for args, _ in runtime.calls) == (blocked is None)
    vm.active.clear(); vm.held.clear(); vm.busy = lambda key: False
    await vm.refresh_timezone()
    assert "TZ=Asia/Taipei" in runtime.raw["Config"]["Env"]
    assert not vm.timezone_pending


async def test_timezone_refresh_does_not_replace_foreign_desktops(desktop):
    vm, target, runtime = desktop
    vm.timezone = lambda: "Asia/Taipei"
    runtime.raw["Config"]["Labels"][f"{LABEL}.owner"] = "foreign"
    await vm.refresh_timezone()
    assert not any(args[0] in ("run", "start", "stop", "rm") for args, _ in runtime.calls)


async def test_timezone_refresh_recreates_stopped_desktop_without_waking_it(desktop):
    vm, target, runtime = desktop
    vm.timezone = lambda: "Asia/Taipei"
    runtime.raw["State"]["Running"] = False
    original = runtime.__call__
    async def run(args, **kwargs):
        if args[0] == "create":
            runtime.raw = container(vm, target, runtime)
            runtime.raw["Config"]["Env"].append("TZ=Asia/Taipei")
            runtime.raw["State"]["Running"] = False
        return await original(args, **kwargs)
    vm.run = run
    await vm.refresh_timezone()
    assert not runtime.raw["State"]["Running"]
    assert "TZ=Asia/Taipei" in runtime.raw["Config"]["Env"]
    assert not any(args[0] in ("run", "start", "stop") for args, _ in runtime.calls)


async def test_timezone_recreation_rechecks_ownership_and_keeps_owner_hold(desktop):
    vm, target, runtime = desktop
    vm.timezone = lambda: "Asia/Taipei"
    vm.held.add(target.key)
    with pytest.raises(VmError, match="owner_holds_control"):
        await vm.start(target)
    vm.held.clear()
    original = vm.inspect
    inspections = 0
    async def inspect(target):
        nonlocal inspections
        inspections += 1
        if inspections == 2:
            runtime.raw["Config"]["Labels"][f"{LABEL}.owner"] = "foreign"
        return await original(target)
    vm.inspect = inspect
    with pytest.raises(VmError, match="incompatible"):
        await vm.start(target)
    assert not any(args[0] in ("run", "stop", "rm") for args, _ in runtime.calls)


async def test_native_timezone_check_uses_vm_exec_after_home(desktop, tmp_path, monkeypatch):
    from raphael_core.computer import vm as vm_module, vm_tools
    from raphael_core.native_journeys import vm_timezone_smoke
    vm, target, runtime = desktop
    monkeypatch.setenv("RAPHAEL_TEST_NATIVE", "1")
    monkeypatch.setattr(vm_module, "LocalVm", lambda *args, **kwargs: vm)
    commands = []
    async def execute(target, command, timeout, **kwargs):
        commands.append(command)
        return {"exit_code": 0, "output": "+0800\n", "truncated": False}
    monkeypatch.setattr(vm, "execute", execute)
    monkeypatch.setattr(vm_tools, "VmTools", lambda *args, **kwargs: VmTools(*args, bridge=Bridge, **kwargs))
    assert await vm_timezone_smoke(tmp_path) == {"command": "date +%z", "offset": "+0800"}
    assert commands == ["date +%z"]


def test_targets_are_isolated_by_default_and_can_explicitly_share(conn, tmp_path):
    settings = SettingsStore(conn)
    vm = LocalVm(tmp_path, settings=settings)
    assert vm.target(0) != vm.target(17)
    settings.set("computer_vm_mode", "shared")
    assert vm.target(0) != vm.target(17)
    assert vm.target(0).unit == vm.target(17).unit == 'shared'
    assert vm.target(0).workspace == vm.target(17).workspace
    assert vm.target("../../escape").workspace.parent == tmp_path / "vm-homes"


@pytest.mark.parametrize("value", [4, 1441, True, 5.0])
def test_idle_setting_rejects_invalid_values(value):
    with pytest.raises((TypeError, ValueError)):
        checked("computer_vm_idle_minutes", value)


@pytest.mark.parametrize("overall,expected", [("ok", True), ("degraded", True), ("error", False)])
def test_health_contract(overall, expected):
    assert healthy(json.dumps({"schema_version": "1", "overall": overall, "checks": []})) == expected
    assert not healthy("[]") and not healthy("not-json")


async def test_status_checks_real_health_and_hides_remote_binding(desktop):
    vm, target, runtime = desktop
    state = await vm.status(target)
    assert state["ready"] and state["viewer_url"].startswith("http://127.0.0.1:6080/vnc.html#")
    assert "private" not in json.dumps(state) and "password" not in state["viewer_url"]
    runtime.raw["HostConfig"]["PortBindings"]["6901/tcp"][0]["HostIp"] = "0.0.0.0"
    assert (await vm.status(target))["state"] == "incompatible"


def test_reuse_checks_original_host_mount_without_engine_path_translation(desktop):
    vm, target, runtime = desktop
    runtime.raw["HostConfig"]["Mounts"] = [{"Type": "bind", "Source": m["Source"], "Target": m["Destination"]} for m in runtime.raw["Mounts"]]
    runtime.raw["Mounts"][0]["Source"] = "/engine/internal/path"
    assert compatible(runtime.raw, target, vm.owner, runtime.image_id)
    runtime.raw["HostConfig"]["Mounts"][0]["Source"] = str(target.workspace.parent)
    assert not compatible(runtime.raw, target, vm.owner, runtime.image_id)


@pytest.mark.parametrize("change", [
    lambda r: r["Config"]["Labels"].update({f"{LABEL}.owner": "foreign"}),
    lambda r: r.update(Image="other"),
    lambda r: r["HostConfig"].update(Privileged=True),
    lambda r: r["HostConfig"].update(CapAdd=["SYS_ADMIN"]),
    lambda r: r["HostConfig"].update(PidMode="host"),
    lambda r: r["HostConfig"].update(SecurityOpt=["seccomp=unconfined"]),
    lambda r: r["HostConfig"].update(Memory=0),
    lambda r: r["Mounts"].append({"Type": "bind", "Source": "/", "Destination": "/host"}),
])
async def test_foreign_or_weakened_containers_are_never_reused_or_removed(desktop, change):
    vm, target, runtime = desktop
    change(runtime.raw)
    with pytest.raises(VmError, match="incompatible"):
        await vm.start(target)
    with pytest.raises(VmError, match="incompatible"):
        await vm.stop(target, remove=True)
    assert not any(args[0] in ("start", "stop", "rm") for args, _ in runtime.calls)


async def test_recovery_and_idle_stop_keep_workspace_and_ignore_busy_or_held(desktop):
    vm, target, runtime = desktop
    target.workspace.mkdir(parents=True)
    file = target.workspace / "keep.txt"
    file.write_text("persistent")
    await vm.recover()
    assert target.state_key in vm.last_activity
    vm.clock = lambda: 15 * 60 + 1
    vm.active[target.key] = 1
    await vm.sweep()
    assert runtime.raw["State"]["Running"]
    vm.active.clear()
    vm.held.add(target.key)
    await vm.sweep()
    assert runtime.raw["State"]["Running"]
    vm.held.clear()
    await vm.sweep()
    assert not runtime.raw["State"]["Running"] and file.read_text() == "persistent"
    await vm.stop(target, remove=True)
    assert runtime.raw is None and file.exists()


async def test_engine_unavailable_is_optional_and_never_starts_daemon(desktop):
    vm, target, runtime = desktop
    runtime.up = False
    assert (await vm.status(target))["state"] == "unavailable"
    assert all(args[0] == "info" for args, _ in runtime.calls)


async def test_exec_has_guest_timeout_and_combined_output_cap(desktop):
    vm, target, runtime = desktop
    original = runtime.__call__
    async def run(args, **kwargs):
        if "sh" in args and "-lc" in args:
            runtime.calls.append((args, kwargs))
            return Result(0, "a" * 40000, "b" * 40000)
        return await original(args, **kwargs)
    vm.run = run
    result = await vm.execute(target, "printf hello")
    assert len(result["output"]) == 50000 and result["truncated"]
    args, kwargs = next((a, k) for a, k in runtime.calls if "-lc" in a)
    assert "timeout --signal=TERM --kill-after=2" in args[args.index("-c") + 1]
    assert "60" in args and kwargs["timeout"] == 65


@pytest.mark.parametrize("timeout", [1801, 0, -1, True, float("nan"), float("inf")])
async def test_exec_rejects_invalid_timeouts_before_docker(desktop, timeout):
    vm, target, runtime = desktop
    with pytest.raises(VmError, match="bad_arguments"):
        await vm.execute(target, "echo hello", timeout)
    assert not runtime.calls


@pytest.mark.parametrize("path", ["/etc/passwd", GUEST + "/../secret", "relative.txt"])
async def test_attach_refuses_paths_outside_workspace(desktop, path):
    vm, target, runtime = desktop
    with pytest.raises(VmError, match="outside_workspace"):
        await vm.read_file(target, path, limit=10)
    assert not runtime.calls


class EmptyHub:
    def offered(self): return []
    def tier_of(self, key): return None
    def kind_of(self, server, name): return None
    # Like the real hub: it cannot answer for tools it does not know.
    def tier_for_call(self, key, arguments): return None
    def kind_for_call(self, server, name, arguments): return None
    def record_unrun(self, *args, **kwargs): pass


from .fixtures.driver_contract import checked_request, validate_call


class Bridge:
    alive = True
    calls = []
    def __init__(self, vm, target): self.vm, self.target = vm, target
    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        if "request" in cls.__dict__:
            cls.request = checked_request(cls.request)
    async def __aenter__(self): return self
    async def __aexit__(self, *args): pass
    async def request(self, method, params=None):
        validate_call(method, params)
        self.calls.append((method, params))
        if method == "tools/list":
            return {"tools": [{"name": name, "description": name, "inputSchema": {"type": "object"}}
                              for name in ("get_desktop_state", "get_window_state", "list_windows", "click", "type_text", "scroll", "launch_app")]}
        if params["name"] == "list_windows":
            from raphael_core.computer.vm import screen_grid
            state = {"windows": [dict(window_id=number, pid=number, title="Terminal", app_name="Xfce4-terminal",
                        bounds=dict(x=x + 20, y=y + 20, width=600, height=400))
                        for number, (x, y, _, _) in enumerate(screen_grid(self.target.screens)[0], 1)]}
            return {"structuredContent": state, "content": [{"type": "text", "text": json.dumps(state)}]}
        return {"content": [{"type": "image", "data": base64.b64encode(b"\x89PNG\r\n\x1a\nimage").decode(), "mimeType": "image/png"}]}


DRIVER_CATALOG = json.loads((Path(__file__).parent / "fixtures/cua-driver-0.37.0.json").read_text(encoding="utf-8"))
CURATED = set("""get_guide get_desktop_state get_window_state get_cursor_position
    click double_click right_click type_text press_key hotkey scroll drag move_cursor
    launch_app list_apps list_windows bring_to_front clipboard_read clipboard_write verify_state
    get_browser_state browser_prepare browser_navigate browser_click browser_type browser_select
    browser_pointer browser_dialog browser_set_input_files browser_download vm_exec attach_file""".split())


class CatalogBridge(Bridge):
    async def request(self, method, params=None):
        if method == "tools/list":
            # The owner recorded names only. These schemas exercise discovery, not Linux arguments.
            names = [name for name in DRIVER_CATALOG["names"] if name not in DRIVER_CATALOG["raphael_tools"]]
            return {"tools": [{"name": name, "description": name, "inputSchema": {"type": "object"}}
                              for name in [*names, "future_driver_admin_tool"]]}
        return await super().request(method, params)


async def test_first_screen_starts_docker_for_the_member_then_reuses_catalog(desktop, tmp_path):
    # (owner, 2026-11-11: 「理論上就算我沒有開 Docker，它也會自動自己打開才對」) supersedes the owner-press-only start.
    from unittest.mock import AsyncMock
    vm, target, runtime = desktop
    runtime.up = False
    runtime.raw["State"]["Running"] = False
    async def start_engine():
        runtime.up = True
    vm.desktop = SimpleNamespace(installed=lambda: True, start=AsyncMock(side_effect=start_engine))
    class RecordingBridge(Bridge):
        calls = []
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=RecordingBridge)
    await hub.prepare()
    assert runtime.calls == []
    shot = next(tool for tool in hub.offered() if tool.name == "get_desktop_state")
    result = await hub.call(shot.key, {}, approver="auto")
    assert result.ok and result.blocks
    vm.desktop.start.assert_awaited_once()
    assert sum(args[0] == "start" for args, _ in runtime.calls) == 1
    before = len(runtime.calls), len(RecordingBridge.calls)
    await hub.prepare()
    assert (len(runtime.calls), len(RecordingBridge.calls)) == before
    assert "click" in {tool.name for tool in hub.offered()}
    assert (await hub.call(shot.key, {}, approver="auto")).ok
    vm.desktop.start.assert_awaited_once()
    assert sum(method == "tools/list" for method, _ in RecordingBridge.calls) == 1


async def _stopped_engine(desktop, tmp_path, *, starts=True):
    """A stopped engine whose Docker Desktop launcher is a fake; `starts` says whether the engine then comes up."""
    from unittest.mock import AsyncMock
    vm, target, runtime = desktop
    runtime.up = False
    runtime.raw["State"]["Running"] = False
    async def launch():
        await asyncio.sleep(0)
        runtime.up = starts
    vm.desktop = SimpleNamespace(installed=lambda: True, start=AsyncMock(side_effect=launch))
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare()
    return vm, target, runtime, hub, next(tool for tool in hub.offered() if tool.name == "get_desktop_state")


async def test_member_call_says_it_is_starting_docker_while_it_waits(desktop, tmp_path):
    vm, target, runtime, hub, shot = await _stopped_engine(desktop, tmp_path)
    said = []
    with vm_scope(("turn", 0, 7), turn_id=7, progress=said.append, language="zh-TW"):
        assert (await hub.call(shot.key, {}, approver="auto")).ok
    # The restart of the stopped container may add its own repair line after it.
    assert said[0] == "正在啟動 Docker Desktop 來準備電腦，大約需要一分鐘" and said.count(said[0]) == 1


async def test_a_start_timeout_tells_the_model_to_try_once_more_later(desktop, tmp_path, monkeypatch):
    monkeypatch.setattr("raphael_core.computer.vm.ENGINE_WAIT_S", 0.05)
    monkeypatch.setattr("raphael_core.computer.vm.ENGINE_POLL_S", 0.01)
    vm, target, runtime, hub, shot = await _stopped_engine(desktop, tmp_path, starts=False)
    result = await hub.call(shot.key, {}, approver="auto")
    assert (result.ok, result.kind) == (False, "docker_start_timeout")
    assert "Try this tool again once after about 30 seconds" in result.text
    assert "tell the owner plainly that Docker Desktop did not start" in result.text
    assert target.key not in vm.preparation and vm.active[target.key] == 0
    from raphael_core.failures import classify
    failure = classify({"kind": result.kind, "message": result.text}, record=False)
    assert failure.kind == "timeout"
    for kind in ("docker_stopped", "docker_start_failed"):
        assert classify({"kind": kind, "message": "x"}, record=False).kind == "tool_broken"


async def test_two_concurrent_member_calls_start_docker_once(desktop, tmp_path):
    vm, target, runtime, hub, shot = await _stopped_engine(desktop, tmp_path)
    first, second = await asyncio.gather(hub.call(shot.key, {}, approver="auto"), hub.call(shot.key, {}, approver="auto"))
    assert first.ok or second.ok
    assert all(result.ok or result.kind == "computer_busy" for result in (first, second))
    vm.desktop.start.assert_awaited_once()
    assert sum(args[0] == "start" for args, _ in runtime.calls) == 1


async def test_concurrent_computers_share_one_docker_start(tmp_path, conn):
    from unittest.mock import AsyncMock
    from raphael_core.computer.vm import engine_start_allowed
    settings = SettingsStore(conn)
    settings.set("computer_vm_mode", "per-bot")
    runtime = Runtime()
    runtime.up = False
    vm = LocalVm(tmp_path, settings=settings, runner=runtime, clock=lambda: 0)
    async def launch():
        await asyncio.sleep(0.01)
        runtime.up = True
    vm.desktop = SimpleNamespace(installed=lambda: True, start=AsyncMock(side_effect=launch))
    async def member(number):
        with engine_start_allowed():
            await vm.ensure_engine(vm.target(number), start_desktop=True)
    await asyncio.gather(member(1), member(2), member(3))
    vm.desktop.start.assert_awaited_once()


async def test_status_reads_and_the_viewer_never_start_docker_for_a_member(desktop, tmp_path):
    from raphael_core.computer.viewer import DesktopViewer
    vm, target, runtime, hub, shot = await _stopped_engine(desktop, tmp_path)
    assert (await vm.status(target, probe=False))["error"] == "docker_stopped"
    viewer = DesktopViewer(vm)
    try:
        assert (await viewer.status({"member_id": 0}))["error"] == "docker_stopped"
    finally:
        await viewer.aclose()
    vm.desktop.start.assert_not_awaited()
    assert not any(args[0] == "start" for args, _ in runtime.calls)


async def test_start_failure_is_reported_on_use_and_releases_action_lock(desktop, tmp_path):
    from unittest.mock import AsyncMock
    vm, target, runtime = desktop
    vm.start = AsyncMock(side_effect=VmError("docker_start_failed"))
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare()
    vm.start.assert_not_awaited()
    shot = next(tool for tool in hub.offered() if tool.name == "get_desktop_state")
    failed = await hub.call(shot.key, {}, approver="auto")
    assert failed.kind == "docker_start_failed" and "did not start" in failed.text
    assert not hub.actions[target.key].locked() and vm.active[target.key] == 0


def test_the_image_carries_the_labels_the_core_checks():
    # Live, a new image with an old label left every computer refused as incompatible.
    import raphael_core.computer.vm as vm_module
    dockerfile = (Path(vm_module.__file__).parent / "image/Dockerfile").read_text(encoding="utf-8")
    for key, value in IMAGE_LABELS.items():
        assert f'{key}="{value}"' in dockerfile


async def test_a_computer_keeps_one_driver_connection_and_session_until_it_breaks(per_bot_desktop, tmp_path):
    # The driver ends a session with the connection that used it: live, the browser browser_prepare opened was gone by the
    # next call, every later call was refused as "session has ended", and a drag never found the screenshot read before it.
    vm, target, runtime = per_bot_desktop
    class Recording(CatalogBridge):
        calls, opened, closed = [], [], []
        async def __aenter__(self):
            self.opened.append(self)
            return self
        async def __aexit__(self, *args):
            self.closed.append(self)
        async def request(self, method, params=None):
            result = await super().request(method, params)
            if method == "tools/list":
                for item in result["tools"]:
                    if item["name"] in ("browser_pointer", "click", "browser_click"):
                        from .fixtures.driver_contract import SCHEMAS
                        item["inputSchema"] = SCHEMAS[item["name"]]
            elif params and params["name"] == "get_browser_state":
                self.calls.append((method, params))
                return {"content": [{"type": "text", "text": "bound target with 1 tab(s)"}], "structuredContent": {"target_id": "bt-1", "tabs": [{"tab_id": "tab-1"}]}}
            return result
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Recording)
    await hub.prepare()
    tool = lambda name: next(item for item in hub.offered() if item.name == name)
    assert (await hub.call(tool("get_desktop_state").key, {}, approver="auto")).ok
    used = len(Recording.opened)
    assert (await hub.call(tool("browser_pointer").key, {"action": "drag", "target_id": "bt-1", "tab_id": "tab-1", "ref": "source", "destination_ref": "dest"}, approver="auto")).ok
    assert (await hub.call(tool("browser_click").key, {"delivery_mode": "background", "target_id": "bt-1", "tab_id": "tab-1", "ref": "button"}, approver="auto")).ok
    assert (await hub.call(tool("click").key, {"x": 1, "y": 2}, approver="auto")).ok
    sent = {params["name"]: params["arguments"] for method, params in Recording.calls if method == "tools/call"}
    assert len({arguments["session"] for arguments in sent.values()}) == 1 and len(Recording.opened) == used
    # On a screen that is the member's own, input need not stay in the background: Chromium refuses it.
    assert sent["browser_pointer"]["delivery_mode"] == sent["click"]["delivery_mode"] == "foreground"
    assert sent["browser_click"]["delivery_mode"] == "background"  # what the model chose stays
    assert "delivery_mode" not in sent["get_desktop_state"]
    # The page tools say what a model needs only in their structured result; their text is a one-line summary.
    state = await hub.call(tool("get_browser_state").key, {}, approver="auto")
    assert "tab-1" in state.text and "bt-1" in state.text and "bound target" in state.text
    desktop_shot = await hub.call(tool("get_desktop_state").key, {}, approver="auto")
    assert "structuredContent" not in (desktop_shot.text or "")
    # The label is Raphael's: the model cannot choose one.
    assert not (await hub.call(tool("click").key, {"session": "other"}, approver="auto")).ok
    # A connection that broke (the computer stopped) is replaced, and the driver refuses an ended label.
    first = sent["click"]["session"]
    hub.connections[target.key][0].alive = False
    assert (await hub.call(tool("click").key, {"x": 3, "y": 4}, approver="auto")).ok
    assert Recording.calls[-1][1]["arguments"]["session"] != first and len(Recording.opened) == used + 1
    await hub.aclose()
    assert Recording.opened[-1] in Recording.closed


async def test_real_driver_catalog_offers_only_the_curated_tools(desktop, tmp_path):
    vm, target, runtime = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=CatalogBridge)
    await hub.prepare()
    assert not runtime.calls
    shot = next(tool for tool in hub.offered() if tool.name == "get_desktop_state")
    assert (await hub.call(shot.key, {}, approver="auto")).ok
    assert DRIVER_CATALOG["reported_count"] == 67
    assert len(DRIVER_CATALOG["names"]) == len(set(DRIVER_CATALOG["names"])) == 68
    assert CURATED <= set(DRIVER_CATALOG["names"])
    deferred = {"vault_entries", "fill_contact", "fill_card"}
    assert {tool.name for tool in hub.offered()} == CURATED | {"request_takeover", "fill_login", "browser_open", "run_steps"} | deferred
    snapshot = take_snapshot(hub)
    assert {ref.name for ref in snapshot.refs.values() if ref.server == "computer"} == CURATED | {"request_takeover", "fill_login", "browser_open", "run_steps"}
    assert set(snapshot.hidden()) == {"computer__" + name for name in deferred}
    assert not snapshot.refresh_computer(hub, 0)
    assert all(tool.pinned for tool in hub.offered())
    assert hub.tier_of("mcp:computer-shared/install_extension") is None


@pytest.mark.parametrize("interactive", [False, True])
async def test_vault_discovery_survives_refresh_but_not_a_disabled_computer(desktop, tmp_path, interactive):
    vm, _, runtime = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=CatalogBridge)
    await hub.prepare()
    snapshot = take_snapshot(hub, interactive=interactive)
    deferred = {"computer__vault_entries", "computer__fill_contact", "computer__fill_card"}
    try:
        assert not deferred & snapshot.refs.keys()
        snapshot.refresh_plugins(hub, 0)
        snapshot.refresh_computer(hub, 0)
        assert not deferred & snapshot.refs.keys()
        for name in sorted(deferred):
            assert name in {item["function"]["name"] for item in snapshot.find(name)[0]}
            assert snapshot.reveal(name) is not None  # what use_tool does with a found name
        assert snapshot.refs["computer__fill_card"].tier == Tier.T3
        listed = [item["function"]["name"] for item in snapshot.definitions]
        snapshot.refresh_plugins(hub, 0)
        snapshot.refresh_computer(hub, 0)
        assert deferred <= snapshot.refs.keys(), "a found tool stays callable after a refresh"
        assert [item["function"]["name"] for item in snapshot.definitions] == listed, "and is never listed"
        vm.enabled = False  # computer tools turned off: nothing of the computer stays on offer
        snapshot.refresh_plugins(hub, 0)
        snapshot.refresh_computer(hub, 0)
        assert not deferred & snapshot.refs.keys()
        assert not deferred & {item["function"]["name"] for item in snapshot.find("fill_card")[0]}
        assert not runtime.calls
    finally:
        await hub.aclose()


@pytest.mark.parametrize("count", [40, 65, 400])
@pytest.mark.parametrize("interactive", [False, True])
async def test_the_computer_set_stays_listed_whatever_the_plugins_hold(desktop, tmp_path, count, interactive):
    from raphael_core.agent.plugins import PluginTool
    from raphael_core.agent.team import SKILL_TOOLS
    from raphael_core.memory.growth import TOOLS as MEMORY_TOOLS

    class ManyHub(EmptyHub):
        def offered(self):
            return [PluginTool(f"mcp:other/t{n}", "Other", f"t{n}", "Search notion", {"type": "object"}, Tier.T0)
                    for n in range(count)]

    vm, target, runtime = desktop
    hub = VmTools(ManyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=CatalogBridge)
    await hub.prepare()
    shot = next(tool for tool in hub.offered() if tool.name == "get_desktop_state")
    assert (await hub.call(shot.key, {}, approver="auto")).ok
    snapshot = take_snapshot(hub, memory=True, team=SKILL_TOOLS, interactive=interactive)
    expected = {"computer__" + name for name in CURATED} | set(MEMORY_TOOLS) | set(SKILL_TOOLS)
    listed = {d["function"]["name"] for d in snapshot.definitions}
    # The member's computer is the core's own and listed; a connection's tools are found (decision 2).
    assert expected <= listed and expected.isdisjoint(snapshot.hidden())
    assert not [name for name in listed if name.startswith("Other__")]
    assert len([alias for alias in snapshot.hidden() if alias.startswith("Other__")]) == count


async def test_a_tool_call_on_a_running_desktop_does_not_report_preparation(desktop, monkeypatch):
    vm, target, runtime = desktop
    await vm.start(target)
    seen = []
    real = vm._start
    async def watching(checked):
        seen.append(vm.preparation.get(checked.key))
        return await real(checked)
    monkeypatch.setattr(vm, "_start", watching)
    await vm.start(target)
    assert seen == []
    vm.invalidate(target)
    await vm.start(target)
    assert seen == [None]


@pytest.mark.parametrize("action_mode", ["direct", "ask"])
async def test_tools_share_snapshot_and_gate_and_owner_control(desktop, conn, tmp_path, action_mode):
    vm, target, runtime = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Bridge)
    await hub.prepare(0)
    snapshot = take_snapshot(hub)
    assert "computer__vm_exec" in snapshot.refs and "computer__get_desktop_state" in snapshot.refs
    gate = ToolGate(hub, conn=conn)
    SettingsStore(conn).set("action_mode", action_mode)
    shot = next(tool for tool in hub.offered() if tool.name == "get_desktop_state")
    assert (await gate.call_plugin(shot.key, {})).ok
    assert snapshot.refresh_computer(hub, 0)
    click = next(tool for tool in hub.offered() if tool.name == "click")
    execute = next(tool for tool in hub.offered() if tool.name == "vm_exec")
    shot = next(tool for tool in hub.offered() if tool.name == "get_desktop_state")
    calls = [(shot, {}), (click, {"pid": 1, "window_id": 1}), (execute, {"command": "printf hello"})]
    assert gate.reads_only("computer", "get_desktop_state", {}) and not gate.reads_only("computer", "vm_exec", {"command": "x"})
    for tool, arguments in calls:
        assert gate.tier(tool.key) == Tier.T0
        assert gate.tier_now(tool.key, arguments) == Tier.T0
        assert not gate.needs_confirmation(tool.key)
        assert (await gate.call_plugin(tool.key, arguments)).ok
    vm.hold(target, True)
    before = len(runtime.calls), len(Bridge.calls)
    for tool, arguments in calls:
        assert (await gate.call_plugin(tool.key, arguments)).kind == "owner_holds_control"
    assert (len(runtime.calls), len(Bridge.calls)) == before
    assert (await hub.call(shot.key, {}, approver="none")).kind == "blocked"
    vm.hold(target, False)
    for tool, arguments in calls:
        assert (await gate.call_plugin(tool.key, arguments)).ok


async def test_sandbox_steps_do_not_reenter_per_action_safety_screening(desktop, conn, tmp_path):
    from raphael_core.agent.safety import DENY, PASS, Screening
    from raphael_core.agent.service import AgentService
    from raphael_core.background.run import TaskRun

    vm, target, runtime = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare()
    SettingsStore(conn).set("action_mode", "ask")
    screened = []
    async def deny(proposed, **kwargs):
        screened.append(proposed.tool)
        return Screening(DENY)
    async def guarded(result): return await result
    gate = ToolGate(hub, conn=conn, safety=SimpleNamespace(screen=deny))
    snapshot = take_snapshot(hub)
    caller = SimpleNamespace(_gate=gate, snapshot=snapshot, language="en", ledger=None,
                             _check=lambda **kwargs: None, _guarded=guarded)
    private_fills = {"fill_login", "fill_contact", "fill_card"}
    for tool in hub.offered():
        call = SimpleNamespace(tool=tool, arguments={})
        expected = Screening(DENY) if tool.name in private_fills else PASS
        assert await AgentService._screen_call(caller, SimpleNamespace(language="en"), call, None) == expected
        ref = snapshot.ref("computer__" + tool.name)  # listed, or found and called through use_tool
        assert await TaskRun._screen(caller, ref, {}) == expected
    assert screened == [f"computer / {tool.name}" for tool in hub.offered() if tool.name in private_fills for _ in range(2)]
    assert not gate.is_vm_tool("mcp:unrelated/click")


async def test_vm_tool_descriptions_require_owner_yes_before_outward_actions(desktop, tmp_path):
    from raphael_core.computer.vm_tools import ATTACH, SHARED_CONTRACT

    vm, target, runtime = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare()
    snapshot = take_snapshot(hub)
    # Listed, or (the vault's) found with find_tools: the description a model reads either way.
    definitions = {name: item["function"] for name, item in snapshot.catalog().items()}
    for tool in hub.offered():
        assert tool.tier == (Tier.T3 if tool.name == "fill_card" else Tier.T0)
        description = definitions["computer__" + tool.name]["description"]
        if tool.name == "vault_entries":
            assert "opaque IDs" in description and "Never ask for private values" in description
            continue
        if tool.name in ("fill_login", "fill_contact", "fill_card"):
            assert all(clause in description for clause in ("hint", "ask_owner", "submit"))
            if tool.name == "fill_card":
                assert "Every use needs owner approval" in description and "request_takeover" in description
            continue
        if tool.name == "attach_file":
            assert tool.description == ATTACH["description"] + SHARED_CONTRACT
            continue
        if tool.name == "request_takeover":
            assert "Never request secrets in chat" in definitions["computer__request_takeover"]["description"]
            continue
        for clause in ("no per-action approval", "owner control blocks all calls",
                       "sending a message/email", "publishing/posting", "outside the workspace",
                       "paying/buying", "call approve", "API harness", "owner's yes",
                       "unavailable, denied or expired", "Sandbox success is not approval"):
            assert clause in description


async def test_native_vm_journey_checks_no_approval_and_owner_control(per_bot_desktop, tmp_path, monkeypatch):
    from raphael_core.computer import vm as vm_module, vm_tools
    from raphael_core.native_journeys import vm_smoke

    vm, target, runtime = per_bot_desktop
    monkeypatch.setenv("RAPHAEL_TEST_NATIVE", "1")
    monkeypatch.setattr(vm_module, "LocalVm", lambda *args, **kwargs: vm)
    payload = b"Raphael VM smoke\n"
    png = b"\x89PNG\r\n\x1a\nimageIEND\xaeB`\x82"
    forwarded = []

    class SmokeBridge(CatalogBridge):
        async def request(self, method, params=None):
            if method == "tools/list":
                return await super().request(method, params)
            assert target.key not in vm.held
            forwarded.append(params["name"])
            return {"content": [{"type": "image", "data": base64.b64encode(png).decode(), "mimeType": "image/png"}]}

    async def execute(*args, **kwargs):
        assert target.key not in vm.held
        forwarded.append("vm_exec")
        return {"exit_code": 0, "output": payload.decode(), "truncated": False}

    async def read_file(*args, **kwargs):
        assert target.key not in vm.held
        forwarded.append("attach_file")
        return payload

    monkeypatch.setattr(vm, "execute", execute)
    monkeypatch.setattr(vm, "read_file", read_file)
    monkeypatch.setattr(vm_tools, "VmTools", lambda *args, **kwargs: VmTools(*args, bridge=SmokeBridge, **kwargs))
    import raphael_core.native_journeys as journeys  # the page's own tools need a real computer: the native journey runs them
    async def no_page(*args):
        return {}
    monkeypatch.setattr(journeys, "_page_tools", no_page)
    directory = tmp_path / "journey"
    directory.mkdir()
    report = await vm_smoke(directory)
    expected = ["computer__" + name for name in ("get_desktop_state", "click", "get_desktop_state", "vm_exec", "attach_file")]
    assert report["completed"] == report["without_approval"] == report["owner_held_refused"] == expected
    assert forwarded == ["set_config", "set_agent_cursor_enabled", *[name.removeprefix("computer__") for name in expected]]
    assert report["paid_requests"] == 0
    assert report["prepare_docker_commands"] == report["next_turn_docker_commands"] == 0


async def test_stopped_engine_keeps_offline_tools_without_probing(desktop, tmp_path):
    vm, target, runtime = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare()
    shot = next(tool for tool in hub.offered() if tool.name == "get_desktop_state")
    runtime.up = False
    vm.clock = lambda: 11
    await hub.prepare()
    assert "computer__get_desktop_state" in take_snapshot(hub).refs
    assert hub.tier_of(shot.key) == Tier.T0
    assert not runtime.calls


async def test_mode_change_revokes_previously_offered_shared_tools(desktop, conn, tmp_path):
    vm, target, runtime = desktop
    vm.settings = SettingsStore(conn)
    vm.settings.set("computer_vm_mode", "shared")
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare()
    shot = next(tool for tool in hub.offered() if tool.name == "get_desktop_state")
    vm.settings.set("computer_vm_mode", "per-bot")
    assert hub.tier_of(shot.key) is None and not hub.offered_for(0)
    assert not (await hub.call(shot.key, {}, approver="auto")).ok


async def test_bridge_answers_ping_and_refuses_tools_while_held(desktop):
    vm, target, runtime = desktop
    bridge = CuaBridge(vm, target)
    assert await bridge.request("ping") == {}
    vm.hold(target, True)
    assert (await bridge.request("tools/call", {"name": "click"}))["isError"]


async def test_owner_observation_allows_only_exact_read_calls_during_takeover(desktop):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    vm, target, runtime = desktop
    bridge = CuaBridge(vm, target)
    vm.hold(target, True)
    bridge._write = AsyncMock()
    bridge.process = SimpleNamespace(stdout=SimpleNamespace(readline=AsyncMock(side_effect=[
        json.dumps({"id":i,"result":{"content":[{"type":"text","text":"Report editor"}]}}).encode() + b"\n" for i in (1,2)])))
    assert (await bridge.request("tools/call", {"name":"click","arguments":{}}, owner_observation=True))["isError"]
    assert (await bridge.request("tools/call", {"name":"get_desktop_state","arguments":{}}))["isError"]
    assert (await bridge.request("tools/call", {"name":"get_desktop_state","arguments":{"other":True}}, owner_observation=True))["isError"]
    bridge._write.assert_not_called()
    for name in ("get_accessibility_tree","get_desktop_state"):
        assert not (await bridge.request("tools/call", {"name":name,"arguments":{}}, owner_observation=True)).get("isError")
    assert bridge._write.await_count == 2


def test_schema_normalization_preserves_constraints():
    raw = {"$schema": "x", "properties": {"x": {"type": "array", "items": {"type": "integer", "minimum": 1}}}, "required": ["x", "missing"]}
    normalized = normalize_schema(raw)
    assert normalized["type"] == "object" and normalized["required"] == ["x"]
    assert normalized["properties"]["x"]["items"]["minimum"] == 1
    assert "$schema" not in normalized and "type" not in raw


def test_schema_root_combinators_become_plain_object():
    schema = normalize_schema({"anyOf": [
        {"properties": {"url": {"type": "string"}, "a": {}}, "required": ["url", "a"]},
        {"properties": {"url": {"type": "string"}, "b": {}}, "required": ["url", "b"]}]})
    assert schema["type"] == "object" and "anyOf" not in schema
    assert set(schema["properties"]) == {"url", "a", "b"} and schema["required"] == ["url"]


async def test_a_seats_lease_refuses_another_active_turn_of_the_same_member(desktop, tmp_path):
    vm, target, runtime = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare()
    hub.busy_wait_s = 0  # the wait is tested in test_shared_desktop
    hub.scope_busy = lambda owner: owner == ("turn", 0, 1)
    shot = next(tool for tool in hub.offered() if tool.name == "get_desktop_state")
    with vm_scope(("turn", 0, 1)):
        assert (await hub.call(shot.key, {}, approver="auto")).ok
    with vm_scope(("turn", 0, 3)):
        assert (await hub.call(shot.key, {}, approver="auto")).kind == "computer_busy"
    vm.clock = lambda: 500 * 60
    await vm.sweep()
    assert runtime.raw["State"]["Running"]
    hub.scope_busy = lambda owner: False
    with vm_scope(("turn", 0, 3)):
        assert (await hub.call(shot.key, {}, approver="auto")).ok


def test_finished_conversation_does_not_keep_lease_when_same_member_starts_another():
    from types import SimpleNamespace
    from raphael_core.agent.service import AgentService

    service = SimpleNamespace(_inflight_scopes={"new": (0, 2)}, _cli_loops=[], _followups={})
    assert not AgentService.computer_scope_busy(service, 0, 1)
    assert AgentService.computer_scope_busy(service, 0, 2)


async def test_attach_copies_bytes_to_existing_store(desktop, tmp_path):
    vm, target, runtime = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare()
    attach = next(tool for tool in hub.offered() if tool.name == "attach_file")
    result = await hub.call(attach.key, {"path": GUEST + "/hello.txt"}, approver="auto")
    assert result.ok
    metadata = json.loads(result.text)["attachment"]
    assert hub.attachments.path(metadata["id"]).read_bytes() == b"hello"
    guest_script = next(args for args, _ in runtime.calls if "/opt/venv/bin/python" in args)
    assert "O_NOFOLLOW" in guest_script[guest_script.index("-c") + 1]


async def test_exec_cancellation_signals_guest_and_removes_pidfile(desktop):
    vm, target, runtime = desktop
    original = runtime.__call__
    async def run(args, **kwargs):
        if "-lc" in args:
            raise asyncio.CancelledError()
        return await original(args, **kwargs)
    vm.run = run
    with pytest.raises(asyncio.CancelledError):
        await vm.execute(target, "sleep 300")
    assert any("kill -TERM" in " ".join(args) for args, _ in runtime.calls)
    assert any("rm" in args and args[-1].startswith("/tmp/raphael-exec-") for args, _ in runtime.calls)


async def test_screenshots_reach_api_context_and_saved_context_excludes_bytes():
    observed = []
    class Host:
        async def chat(self, messages, tools):
            observed.append(list(messages))
            return Turn("done") if len(observed) == 2 else Turn("look", [Call("1", "shot", {}, "{}")])
        async def tool(self, *args):
            return ToolOutcome(True, blocks=[{"type": "image", "data": "cHJpdmF0ZQ==", "mimeType": "image/png"}])
    result = await run_task(Host(), system="system", user="look", tools=[{"function": {"name": "shot", "parameters": {"type": "object"}}}])
    assert result.status == "done"
    assert observed[-1][-1]["content"][-1]["image_url"]["url"].endswith("cHJpdmF0ZQ==")
    assert "cHJpdmF0ZQ==" not in json.dumps(without_computer_images(observed[-1]))


async def test_real_stdio_bridge_handles_driver_ping_schema_and_control(desktop, tmp_path, monkeypatch):
    vm, target, runtime = desktop
    script = tmp_path / "driver.py"
    script.write_text('''import json,sys
for line in sys.stdin:
    packet=json.loads(line)
    if packet.get('method')=='initialize':
        assert packet['params']['clientInfo'] == {'name':'Raphael','version':sys.argv[1]}
        print(json.dumps({'jsonrpc':'2.0','id':'driver-ping','method':'ping'}),flush=True)
        print(json.dumps({'jsonrpc':'2.0','id':packet['id'],'result':{}}),flush=True)
    elif packet.get('method')=='tools/list':
        print(json.dumps({'jsonrpc':'2.0','id':packet['id'],'result':{'tools':[{'name':'click','inputSchema':{'anyOf':[{'properties':{'x':{'type':'integer'}},'required':['x']}]}}]}}),flush=True)
    elif packet.get('method')=='tools/call':
        print(json.dumps({'jsonrpc':'2.0','id':packet['id'],'result':{'isError':True,'content':[{'type':'image','data':'private'},{'type':'text','text':'failed'}]}}),flush=True)
''', encoding="utf-8")
    original = asyncio.create_subprocess_exec
    commands = []
    async def spawn(command, *args, **kwargs):
        commands.append((command, args))
        from raphael_core import __version__
        return await original(sys.executable, str(script), __version__, **kwargs)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", spawn)
    async with CuaBridge(vm, target) as bridge:
        listed = await bridge.request("tools/list")
        tool = listed["tools"][0]
        assert tool["inputSchema"] == {"type": "object", "properties": {"x": {"type": "integer"}}, "required": ["x"]}
        assert "anyOf" in tool["originalInputSchema"]
        assert (await bridge.request("tools/call", {"name": "click"}))["content"] == [{"type": "text", "text": "failed"}]
        vm.hold(target, True)
        assert (await bridge.request("tools/call", {"name": "click"}))["isError"]
    assert Path(commands[0][0]).stem == "docker" and commands[0][1][:2] == ("exec", "-i")
    assert bridge.process is None


@pytest.mark.parametrize("name", ["claude", "codex", "gemini"])
async def test_each_cli_receives_computer_server_without_token_in_argv(name, tmp_path):
    from raphael_core.agent.cli.drivers import Driver
    script = tmp_path / "cli.py"
    record = tmp_path / "config.json"
    script.write_text('''import json,os,sys
from pathlib import Path
name,record=sys.argv[1:3]
def send(packet): print(json.dumps(packet),flush=True)
if name=='codex':
    args=sys.argv[4:]
    overrides=dict(value.split('=',1) for value in args if '=' in value)
    Path(record).write_text(json.dumps(overrides))
    for line in sys.stdin:
        p=json.loads(line)
        if p.get('method')=='initialize': send({'id':p['id'],'result':{}})
        elif p.get('method')=='thread/start': send({'id':p['id'],'result':{'thread':{'id':'private'}}})
        elif p.get('method')=='turn/start':
            send({'method':'item/completed','params':{'item':{'type':'agentMessage','text':'done'}}})
            send({'method':'turn/completed','params':{'turn':{'status':'completed'}}})
            break
else:
    if name=='claude':
        config=json.loads(Path(sys.argv[sys.argv.index('--mcp-config')+1]).read_text())
    else:
        config=json.loads((Path(os.environ['HOME'])/'.gemini/config/mcp_config.json').read_text())
    Path(record).write_text(json.dumps(config))
    if name=='claude': send({'type':'result','subtype':'success','result':'done'})
    else: send({'event':'result','result':{'status':'SUCCESS','response':'done'}})
''', encoding="utf-8")
    environ = {**os.environ, "CODEX_HOME": str(tmp_path / "owner-codex")}
    driver = Driver(name, [sys.executable, str(script), name, str(record)], environ=environ, home=tmp_path)
    events = [event async for event in driver.run(user="test", system="system", endpoint="http://127.0.0.1:1/mcp",
        computer_endpoint="http://127.0.0.1:1/computer", token="test-private-token", permission=None, cwd=str(tmp_path))]
    assert events[-1].kind == "final", events
    config = json.loads(record.read_text())
    if name == "codex":
        assert json.loads(config["mcp_servers.computer.url"]) == "http://127.0.0.1:1/computer"
        assert json.loads(config["mcp_servers.computer.bearer_token_env_var"]) == "RAPHAEL_MCP_TOKEN"
        assert "test-private-token" not in json.dumps(config)
    else:
        assert set(config["mcpServers"]) == {"raphael", "computer"}
        assert config["mcpServers"]["computer"]["headers"]["Authorization"] == "Bearer test-private-token"


def test_cli_action_instructions_include_computer_only_when_offered():
    from raphael_core.agent.cli.loop import CliLoop

    options = dict(brains=None, sessions=None, member_id=0, model="cli:codex", ledger=None,
        language="en", plain=False, system="Persona", user="Look", progress=lambda _: None,
        thinking=lambda _: None, event=lambda _: None, execute=None)
    assert "Use only Raphael MCP tools" in CliLoop(tools=[], **options).system
    tools = [{"function": {"name": "computer__get_desktop_state"}}]
    assert "Use only Raphael and computer MCP tools" in CliLoop(tools=tools, **options).system


async def test_computer_mcp_uses_same_authenticated_gated_server_and_keeps_images():
    called = []
    async def execute(identifier, name, args):
        called.append(name)
        return ToolOutcome(True, blocks=[{"type": "image", "data": "aGVsbG8=", "mimeType": "image/png"}])
    definitions = [{"function": {"name": name, "parameters": {"type": "object"}}} for name in ("local_time", "computer__get_desktop_state")]
    async with RaphaelMcp(lambda: definitions, execute) as server, httpx.AsyncClient() as client:
        packet = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
        assert (await client.post(server.computer_url, json=packet)).status_code == 401
        headers = {"Authorization": "Bearer " + server.token}
        tools = (await client.post(server.computer_url, headers=headers, json=packet)).json()["result"]["tools"]
        assert [t["name"] for t in tools] == ["computer__get_desktop_state"]
        packet.update(method="tools/call", params={"name": "computer__get_desktop_state", "arguments": {}})
        assert (await client.post(server.url, headers=headers, json=packet)).json().get("error")
        result = (await client.post(server.computer_url, headers=headers, json=packet)).json()["result"]
        assert result["content"][-1]["type"] == "image" and called == ["computer__get_desktop_state"]

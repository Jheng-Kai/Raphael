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
            return Result(0, "cua-driver 0.37.0")
        if "health_report" in args:
            return Result(0, '{"schema_version":"1","overall":"ok","checks":[]}')
        if "base64" in " ".join(args):
            return Result(0, base64.b64encode(b"hello").decode())
        return Result(0, "ok")


def container(vm, target, runtime):
    raw = {"Name": "/" + target.name, "Image": runtime.image_id,
        "Config": {"Labels": {**IMAGE_LABELS, f"{LABEL}.owner": vm.owner, f"{LABEL}.target": target.key}, "Env": ["VNC_PW=private"]},
        "State": {"Running": True}, "HostConfig": {"Privileged": False, "CapDrop": ["ALL"], "CapAdd": ["SETUID", "SETGID"],
            "IpcMode": "private", "CgroupnsMode": "private", "NetworkMode": "bridge", "RestartPolicy": {"Name": "no"},
            "Memory": 2 * 1024**3, "MemorySwap": 2 * 1024**3, "NanoCpus": 2_000_000_000, "PidsLimit": 4096,
            "ShmSize": 512 * 1024**2, "PortBindings": {"6901/tcp": [{"HostIp": "127.0.0.1", "HostPort": "6080"}]}},
        "Mounts": [{"Type": "bind", "Source": str(target.workspace), "Destination": GUEST, "RW": True}],
        "NetworkSettings": {"Ports": {"6901/tcp": [{"HostIp": "127.0.0.1", "HostPort": "6080"}]}}}
    if target.shared:
        raw["Mounts"].append({"Type": "bind", "Source": str(target.shared), "Destination": "/home/cua/team", "RW": True})
    if target.remote:
        raw["HostConfig"]["PortBindings"] = {}
        for mount, source in zip(raw["Mounts"], [target.workspace, target.shared]):
            mount.update(Type="volume", Name=str(source), Source="/engine/volumes/" + str(source))
        raw["HostConfig"]["Mounts"] = [{"Type": "volume", "Source": m["Name"], "Target": m["Destination"]} for m in raw["Mounts"]]
        raw["NetworkSettings"] = {"Ports": {}, "Networks": {"bridge": {"IPAddress": "172.18.0.2"}}}
    return raw



@pytest.fixture
def desktop(tmp_path, conn):
    settings = SettingsStore(conn)
    settings.set("computer_vm_mode", "shared")
    runtime = Runtime()
    vm = LocalVm(tmp_path, settings=settings, runner=runtime, clock=lambda: 0)
    vm.grants.set(0, True)
    target = vm.target()
    runtime.raw = container(vm, target, runtime)
    return vm, target, runtime


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


@pytest.mark.parametrize("zone,expected", [
    ("Asia/Taipei", "Asia/Taipei"), ("Europe/Paris", "Europe/Paris"),
    (None, "UTC"), ("", "UTC"), ("invalid/timezone", "UTC"), (8, "UTC"),
])
def test_run_args_use_known_iana_zone_or_utc(tmp_path, zone, expected):
    vm = LocalVm(tmp_path)
    args = run_args(vm.target(), vm.owner, "secret", tz=zone)
    assert [args[index + 1] for index, arg in enumerate(args) if arg == "-e"] == ["VNC_PW=secret", f"TZ={expected}"]
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
            progress.append(vm.preparation[target.key].copy())
        if args[0] == "build":
            runtime.built = True
        return await original(args, **kwargs)

    vm.desktop, vm.run = Desktop(), run
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
    async def execute(target, command, timeout):
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
    assert vm.target(0) == vm.target(17)
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
    assert target.key in vm.last_activity
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


class Bridge:
    calls = []
    def __init__(self, vm, target): self.vm, self.target = vm, target
    async def __aenter__(self): return self
    async def __aexit__(self, *args): pass
    async def request(self, method, params=None):
        self.calls.append((method, params))
        if method == "tools/list":
            return {"tools": [{"name": name, "description": name, "inputSchema": {"type": "object"}}
                              for name in ("get_desktop_state", "click", "type_text", "scroll", "launch_app")]}
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


async def test_first_screen_starts_engine_once_and_later_turn_reuses_catalog(desktop, tmp_path):
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


async def test_start_failure_is_reported_on_use_and_releases_action_lock(desktop, tmp_path):
    from unittest.mock import AsyncMock
    vm, target, runtime = desktop
    vm.start = AsyncMock(side_effect=VmError("docker_start_failed"))
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare()
    vm.start.assert_not_awaited()
    shot = next(tool for tool in hub.offered() if tool.name == "get_desktop_state")
    assert (await hub.call(shot.key, {}, approver="auto")).kind == "docker_start_failed"
    assert not hub.actions[target.key].locked() and vm.active[target.key] == 0


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
    assert {tool.name for tool in hub.offered()} == CURATED | {"request_takeover"}
    snapshot = take_snapshot(hub)
    assert {ref.name for ref in snapshot.refs.values() if ref.server == "computer"} == CURATED | {"request_takeover"}
    assert not snapshot.hidden()
    assert not snapshot.refresh_computer(hub, 0)
    assert all(tool.pinned for tool in hub.offered())
    assert hub.tier_of("mcp:computer-shared/install_extension") is None


@pytest.mark.parametrize("count", [40, 65, 400])
@pytest.mark.parametrize("question", ["", "hello", "search notion", "install_extension set_config replay_trajectory"])
@pytest.mark.parametrize("interactive", [False, True])
async def test_computer_set_survives_plugin_shortlists_and_refine(desktop, tmp_path, count, question, interactive):
    from raphael_core.agent.plugins import PluginTool
    from raphael_core.agent.team import SKILL_TOOLS
    from raphael_core.background.snapshot import refine
    from raphael_core.memory.growth import TOOLS as MEMORY_TOOLS

    class ManyHub(EmptyHub):
        def offered(self):
            return [PluginTool(f"mcp:other/t{n}", "Other", f"t{n}", "Search notion", {"type": "object"}, Tier.T0)
                    for n in range(count)]

    class Picker:
        calls = 0
        async def pick(self, offer, *args, **kwargs):
            self.calls += 1
            assert len(offer.tools) == count
            assert all(tool.server == "Other" for tool in offer.tools)
            return [next(iter(offer.by_alias))]

    vm, target, runtime = desktop
    hub = VmTools(ManyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=CatalogBridge)
    await hub.prepare()
    shot = next(tool for tool in hub.offered() if tool.name == "get_desktop_state")
    assert (await hub.call(shot.key, {}, approver="auto")).ok
    snapshot = take_snapshot(hub, question, memory=True, team=SKILL_TOOLS, interactive=interactive)
    expected = {"computer__" + name for name in CURATED} | set(MEMORY_TOOLS) | set(SKILL_TOOLS)
    assert expected <= snapshot.refs.keys()
    other = [ref for ref in snapshot.refs.values() if ref.server == "Other"]
    if count <= 40:
        assert len(other) == count
    else:
        assert len(other) < count
    picker = Picker()
    await refine(snapshot, picker, question, [], model="fake", ledger=None)
    assert picker.calls == (0 if count <= 40 else 1)
    assert expected <= snapshot.refs.keys()
    assert expected.isdisjoint(snapshot.hidden())
    assert {d["function"]["name"] for d in snapshot.definitions} == snapshot.refs.keys()


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
    assert seen == [None]


@pytest.mark.parametrize("action_mode", ["direct", "ask"])
async def test_tools_share_snapshot_and_gate_and_owner_control(desktop, conn, tmp_path, action_mode):
    vm, target, runtime = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Bridge)
    vm.grants.set(0, True)
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
    calls = [(shot, {}), (click, {}), (execute, {"command": "printf hello"})]
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
    from raphael_core.agent.safety import PASS
    from raphael_core.agent.service import AgentService
    from raphael_core.background.run import TaskRun

    vm, target, runtime = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare()
    SettingsStore(conn).set("action_mode", "ask")
    gate = ToolGate(hub, conn=conn, safety=object())
    caller = SimpleNamespace(_gate=gate)
    snapshot = take_snapshot(hub)
    for tool in hub.offered():
        call = SimpleNamespace(tool=tool, arguments={})
        assert await AgentService._screen_call(caller, None, call, None) == PASS
        ref = snapshot.refs["computer__" + tool.name]
        assert await TaskRun._screen(caller, ref, {}) == PASS
    assert not gate.is_vm_tool("mcp:unrelated/click")


async def test_vm_tool_descriptions_require_owner_yes_before_outward_actions(desktop, tmp_path):
    from raphael_core.computer.vm_tools import ATTACH

    vm, target, runtime = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare()
    definitions = {item["function"]["name"]: item["function"] for item in take_snapshot(hub).definitions}
    for tool in hub.offered():
        assert tool.tier == Tier.T0
        if tool.name == "attach_file":
            assert tool.description == ATTACH["description"]
            continue
        if tool.name == "request_takeover":
            assert "Never request secrets in chat" in definitions["computer__request_takeover"]["description"]
            continue
        description = definitions["computer__" + tool.name]["description"]
        for clause in ("no per-action approval", "owner control blocks all calls",
                       "sending a message/email", "publishing/posting", "outside the workspace",
                       "paying/buying", "call approve", "API harness", "owner's yes",
                       "unavailable, denied or expired", "Sandbox success is not approval"):
            assert clause in description


async def test_native_vm_journey_checks_no_approval_and_owner_control(desktop, tmp_path, monkeypatch):
    from raphael_core.computer import vm as vm_module, vm_tools
    from raphael_core.native_journeys import vm_smoke

    vm, target, runtime = desktop
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

    async def execute(*args):
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
    directory = tmp_path / "journey"
    directory.mkdir()
    report = await vm_smoke(directory)
    expected = ["computer__" + name for name in ("get_desktop_state", "click", "vm_exec", "attach_file")]
    assert report["completed"] == report["without_approval"] == report["owner_held_refused"] == expected
    assert forwarded == [name.removeprefix("computer__") for name in expected]
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


async def test_shared_desktop_lease_refuses_another_active_turn(desktop, tmp_path):
    vm, target, runtime = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare()
    vm.grants.set(2, True)
    hub.busy_wait_s = 0  # the wait is tested in test_shared_desktop
    hub.scope_busy = lambda owner: owner == ("turn", 0, 1)
    shot = next(tool for tool in hub.offered() if tool.name == "get_desktop_state")
    with vm_scope(("turn", 0, 1)):
        assert (await hub.call(shot.key, {}, approver="auto")).ok
    with vm_scope(("turn", 2, 3)):
        assert (await hub.call(shot.key, {}, approver="auto")).kind == "computer_busy"
    vm.clock = lambda: 500 * 60
    await vm.sweep()
    assert runtime.raw["State"]["Running"]
    hub.scope_busy = lambda owner: False
    with vm_scope(("turn", 2, 3)):
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
        return await original(sys.executable, str(script), **kwargs)
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

"""Host and resource policy through fake processes and the existing Docker runtime."""

import csv
import asyncio
from types import SimpleNamespace

import pytest

from raphael_core.brain.settings import SettingsStore, checked
from raphael_core.computer.vm import Docker, LocalVm, VmError, run_args
from .test_vm import Runtime, container
from raphael_core.computer.ssh_tunnel import tunnel_args


@pytest.fixture(autouse=True)
def a_computer_per_member(conn):
    # This file's subject is the owner's stored choice of a computer per member: how many run on this PC, which is
    # stopped first, what a remote host is spared. One computer for every member is test_seat_wiring.py's.
    SettingsStore(conn).set("computer_vm_mode", "per-bot")


def test_auto_host_uses_alias_then_installed_local_then_absent(tmp_path, conn):
    settings = SettingsStore(conn)
    settings.set("computer_ssh_alias", "studio-mini")
    vm = LocalVm(tmp_path, settings=settings, runner=Runtime())
    assert vm.remote == "studio-mini"
    assert vm.desktop is None
    settings.set("computer_ssh_alias", "")
    assert not vm.remote


@pytest.mark.parametrize("alias", ["-oProxyCommand=bad", "host name", "a;id", "a/b", "a@b", "a\n", ".host", "x" * 129])
def test_ssh_alias_rejected_before_process_arguments(alias):
    with pytest.raises(ValueError):
        checked("computer_ssh_alias", alias)
    with pytest.raises(ValueError):
        Docker(alias).argv(["info"])


def test_ssh_transport_has_one_validated_host_argument():
    assert Docker("studio-mini").argv(["exec", "-i", "computer", "driver"])[1:] == [ "--host", "ssh://studio-mini", "exec", "-i", "computer", "driver"]


@pytest.mark.parametrize("alias,port,address", [
    ("-Fbad", 43123, "172.18.0.2"), ("mini", 80, "172.18.0.2"),
    ("mini", 43123, "127.0.0.2"), ("mini", 43123, "8.8.8.8"),
    ("mini", 43123, "172.18.0.2:22"), ("mini", 43123, "169.254.1.1"),
])
def test_tunnel_rejects_nonprivate_destinations_and_invalid_argv(alias, port, address):
    with pytest.raises(ValueError):
        tunnel_args(alias, port, address)


def test_tunnel_uses_only_random_loopback_binding_and_noninteractive_ssh():
    args = tunnel_args("studio-mini", 43123, "172.18.0.2")
    assert args[-3:] == ["-L", "127.0.0.1:43123:172.18.0.2:6901", "studio-mini"]
    assert "BatchMode=yes" in args and "ExitOnForwardFailure=yes" in args
    assert "PermitLocalCommand=no" in args


async def test_local_auto_has_no_desktop_when_docker_is_absent(tmp_path):
    runtime = Runtime()
    runtime.up = False
    vm = LocalVm(tmp_path, runner=runtime)
    assert not await vm.installed()
    assert not vm.remote
    assert not any(args[0] in ("run", "start", "pull", "build") for args, _ in runtime.calls)


async def test_remote_attachment_reads_guest_bytes_without_local_workspace(tmp_path, conn):
    settings = SettingsStore(conn)
    settings.set("computer_ssh_alias", "studio-mini")
    runtime = Runtime()
    vm = LocalVm(tmp_path, settings=settings, runner=runtime)
    target = vm.target(1)
    assert await vm.read_file(target, "/home/cua/workspace/hello.txt", limit=100) == b"hello"
    assert not (tmp_path / "vm-homes").exists()


def test_remote_compatible_checks_volume_names_without_resolving_local_paths(tmp_path, conn):
    from raphael_core.computer.vm import compatible
    settings = SettingsStore(conn)
    settings.set("computer_ssh_alias", "studio-mini")
    runtime = Runtime()
    vm = LocalVm(tmp_path, settings=settings, runner=runtime)
    target = vm.target(1)
    raw = container(vm, target, runtime)
    assert compatible(raw, target, vm.owner, runtime.image_id)
    raw["Mounts"][0]["Name"] = "another-members-workspace"
    assert not compatible(raw, target, vm.owner, runtime.image_id)


async def test_remote_never_starts_desktop_and_reports_unreachable(tmp_path, conn):
    settings = SettingsStore(conn)
    settings.set("computer_ssh_alias", "studio-mini")
    runtime = Runtime()
    runtime.up = False
    vm = LocalVm(tmp_path, settings=settings, runner=runtime)
    assert await vm.installed()
    with pytest.raises(VmError, match="remote_unavailable"):
        await vm.ensure_engine(vm.target())
    assert vm.desktop is None
    assert not any(args[0] in ("pull", "build", "run") for args, _ in runtime.calls)


async def test_remote_idle_sleep_stops_only_its_container_without_removing_workspace(tmp_path, conn):
    settings = SettingsStore(conn)
    settings.set("computer_ssh_alias", "studio-mini")
    runtime = Runtime()
    vm = LocalVm(tmp_path, settings=settings, runner=runtime, clock=lambda: 100000)
    target = vm.target()
    runtime.raw = container(vm, target, runtime)
    vm.last_activity[target.key] = 0
    await vm.sweep()
    assert not runtime.raw["State"]["Running"]
    assert [args for args, _ in runtime.calls if args[0] == "stop"] == [["stop", "--time", "10", target.name]]
    assert not any(args[0] in ("rm", "volume") for args, _ in runtime.calls)


async def test_remote_viewer_forwards_host_loopback_and_disposes_only_its_tunnel(tmp_path, conn, monkeypatch):
    from raphael_core.computer import ssh_tunnel
    settings = SettingsStore(conn)
    settings.set("computer_ssh_alias", "studio-mini")
    runtime = Runtime()
    vm = LocalVm(tmp_path, settings=settings, runner=runtime)
    target = vm.target(1)
    runtime.raw = container(vm, target, runtime)
    calls = []
    class FakeTunnel:
        async def open(self, alias, address, remote_port):
            calls.append((alias, address, remote_port))
            return 43123
        async def close(self):
            calls.append("close")
    monkeypatch.setattr(ssh_tunnel, "Tunnel", FakeTunnel)
    from unittest.mock import AsyncMock
    monkeypatch.setattr(ssh_tunnel, "verify_viewer", AsyncMock())
    assert await vm.viewer_connection(target) == (43123, "private")
    assert "private" not in str(await vm.status(target))
    assert vm.command(target, ["exec", "-i", target.name, "driver"])[1:3] == ["--host", "ssh://studio-mini"]
    await vm.close_viewer(target)
    assert calls == [("studio-mini", "127.0.0.1", 6080), "close"]
    assert not vm.tunnels


async def test_remote_starts_do_not_share_the_local_capacity_lock(tmp_path, conn):
    settings = SettingsStore(conn)
    settings.set("computer_ssh_alias", "studio-mini")
    vm = LocalVm(tmp_path, settings=settings, runner=Runtime())
    entered, both = set(), asyncio.Event()
    async def start(target):
        entered.add(target.key)
        if len(entered) == 2:
            both.set()
        await asyncio.wait_for(both.wait(), 1)
        return {"ready": True}
    vm._start = start
    assert all(state["ready"] for state in await asyncio.gather(vm.start(vm.target(1)), vm.start(vm.target(2))))


def test_default_member_computers_share_only_team_files(tmp_path, conn):
    vm = LocalVm(tmp_path, settings=SettingsStore(conn), runner=Runtime())
    one, two = vm.target(1), vm.target(2)
    assert one.name != two.name and one.workspace != two.workspace
    assert one.shared == two.shared
    mounts = [next(csv.reader([args])) for args in run_args(one, vm.owner, "private") if args.startswith("type=")]
    assert len(mounts) == 2
    args = run_args(one, vm.owner, "private")
    assert args[args.index("--memory") + 1] == "3g"
    assert args[args.index("--memory-swap") + 1] == "3g"
    assert args[args.index("--cpus") + 1] == "2"


def test_remote_uses_engine_volumes_and_publishes_only_loopback(tmp_path, conn):
    settings = SettingsStore(conn)
    settings.set("computer_ssh_alias", "studio-mini")
    vm = LocalVm(tmp_path, settings=settings, runner=Runtime())
    target = vm.target(1)
    args = run_args(target, vm.owner, "private")
    assert args[args.index("-p") + 1] == "127.0.0.1::6901"
    assert len([arg for arg in args if arg.startswith("type=volume,")]) == 2
    assert str(tmp_path) not in " ".join(args)


class Computers(Runtime):
    def __init__(self):
        super().__init__()
        self.computers = {}

    async def __call__(self, args, **kwargs):
        if args[:1] == ["--host"]:
            args = args[2:]
        if args[:2] == ["container", "inspect"]:
            self.raw = self.computers.get(args[-1])
        if args[0] in ("stop", "start", "rm"):
            self.raw = self.computers.get(args[-1])
        if args[0] == "ps":
            self.calls.append((args, kwargs))
            return SimpleNamespace(code=0, stdout="\n".join(self.computers))
        return await super().__call__(args, **kwargs)


async def test_two_local_members_run_together_before_third_evicts_idle_lru(tmp_path, conn):
    runtime = Computers()
    vm = LocalVm(tmp_path, settings=SettingsStore(conn), runner=runtime)
    one, two, three = [vm.target(i) for i in range(1, 4)]
    for target in (one, two, three):
        raw = container(vm, target, runtime)
        raw["State"]["Running"] = False
        runtime.computers[target.name] = raw
    assert one.name != two.name and one.workspace != two.workspace
    assert (await vm.start(one))["ready"]
    vm.active[one.key] = 1
    assert (await vm.start(two))["ready"]
    vm.active[two.key] = 1
    assert all(runtime.computers[target.name]["State"]["Running"] for target in (one, two))
    assert not any(args[0] == "stop" for args, _ in runtime.calls)
    vm.active.clear()
    vm.last_activity.update({one.key: 20, two.key: 10})
    assert (await vm.start(three))["ready"]
    assert [args[-1] for args, _ in runtime.calls if args[0] == "stop"] == [two.name]
    assert runtime.computers[one.name]["State"]["Running"]
    assert not runtime.computers[two.name]["State"]["Running"]
    assert runtime.computers[three.name]["State"]["Running"]


async def test_team_layout_is_created_on_first_use_and_existing_files_survive(tmp_path, conn):
    runtime = Computers()
    vm = LocalVm(tmp_path, settings=SettingsStore(conn), runner=runtime)
    target = vm.target(1)
    raw = container(vm, target, runtime)
    raw["State"]["Running"] = False
    runtime.computers[target.name] = raw
    (target.shared / "context").mkdir(parents=True)
    existing = target.shared / "context" / "owner.md"
    existing.write_text("Keep this exact content", encoding="utf-8")
    assert (await vm.start(target))["ready"]
    assert all((target.shared / name).is_dir() for name in ("context", "meetings", "projects"))
    assert existing.read_text(encoding="utf-8") == "Keep this exact content"
    assert (await vm.start(target))["ready"]
    assert existing.read_text(encoding="utf-8") == "Keep this exact content"
    assert not any(args[0] == "rm" for args, _ in runtime.calls)


@pytest.mark.parametrize("remote", [False, True])
async def test_local_bound_evicts_longest_idle_and_remote_has_no_bound(tmp_path, conn, remote):
    settings = SettingsStore(conn)
    if remote:
        settings.set("computer_ssh_alias", "studio-mini")
    runtime = Computers()
    vm = LocalVm(tmp_path, settings=settings, runner=runtime)
    targets = [vm.target(i) for i in range(3)]
    for index, target in enumerate(targets):
        raw = container(vm, target, runtime)
        raw["State"]["Running"] = index != 2
        runtime.computers[target.name] = raw
        if index != 2:
            vm.last_activity[target.key] = index
    assert (await vm.start(targets[2]))["ready"]
    stopped = [args[-1] for args, _ in runtime.calls if args[0] == "stop"]
    assert stopped == ([] if remote else [targets[0].name])


async def test_local_bound_never_interrupts_active_or_owner_held_computers(tmp_path, conn):
    runtime = Computers()
    vm = LocalVm(tmp_path, settings=SettingsStore(conn), runner=runtime)
    targets = [vm.target(i) for i in range(3)]
    for index, target in enumerate(targets):
        raw = container(vm, target, runtime)
        raw["State"]["Running"] = index != 2
        runtime.computers[target.name] = raw
        vm.last_activity[target.key] = index
    vm.active[targets[0].key] = 1
    vm.hold(targets[1], True)
    with pytest.raises(VmError, match="local_capacity"):
        await vm.start(targets[2])
    assert not any(args[0] in ("stop", "start") for args, _ in runtime.calls)


async def test_local_bound_counts_old_owned_computers_without_stopping_them(tmp_path, conn):
    runtime = Computers()
    vm = LocalVm(tmp_path, settings=SettingsStore(conn), runner=runtime)
    targets = [vm.target(i) for i in range(3)]
    for target in targets[:2]:
        raw = container(vm, target, runtime)
        raw["HostConfig"]["Memory"] = 2 * 1024**3
        runtime.computers[target.name] = raw
    with pytest.raises(VmError, match="local_capacity"):
        await vm.start(targets[2])
    assert not any(args[0] in ("stop", "run", "start", "rm") for args, _ in runtime.calls)


async def test_local_start_and_eviction_take_capacity_before_target_locks(tmp_path, conn):
    runtime = Computers()
    vm = LocalVm(tmp_path, settings=SettingsStore(conn), runner=runtime)
    one, two = vm.target(1), vm.target(2)
    for target in (one, two):
        runtime.computers[target.name] = container(vm, target, runtime)
    entered, release = asyncio.Event(), asyncio.Event()
    async def make_room(target):
        if target == two:
            entered.set()
            await release.wait()
            await vm.stop(one)
    async def start(target):
        return {"ready": True}
    vm._make_room, vm._start = make_room, start
    first = asyncio.create_task(vm.start(two))
    await entered.wait()
    second = asyncio.create_task(vm.start(one))
    await asyncio.sleep(0)
    release.set()
    try:
        assert all(state["ready"] for state in await asyncio.wait_for(asyncio.gather(first, second), 1))
    finally:
        for task in (first, second):
            task.cancel()
        await asyncio.gather(first, second, return_exceptions=True)


async def test_eviction_rechecks_activity_after_status_await(tmp_path, conn):
    runtime = Computers()
    vm = LocalVm(tmp_path, settings=SettingsStore(conn), runner=runtime)
    target = vm.target(1)
    runtime.computers[target.name] = container(vm, target, runtime)
    status = vm.status
    async def became_active(candidate, **kwargs):
        state = await status(candidate, **kwargs)
        vm.active[candidate.key] = 1
        return state
    vm.status = became_active
    with pytest.raises(VmError, match="busy"):
        await vm.stop(target)
    assert not any(args[0] == "stop" for args, _ in runtime.calls)

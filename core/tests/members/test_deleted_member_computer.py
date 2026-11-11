"""Deleting a member removes its computer too, by itself (owner, 2026-11-11: 「理論上不會問這個問題，應該是知道他可能有這個東西
會自動刪掉；如果還沒開起就不用顯示」). The deletion never waits for an engine and never fails for one: the computer is owed,
and paid when its engine can be reached. A fake engine stands in for Docker; nothing here starts or contacts a real one."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from raphael_core.brain.settings import SettingsStore
from raphael_core.computer import removals
from raphael_core.computer.vm import LABEL, LocalVm, Result
from .test_answering import client, live_said, member, setup, typed  # noqa: F401
from agent.test_narration import chat, use


class Engine:
    """Docker as the VM asks it: containers and volumes by name. `up` false is an engine that cannot be reached now;
    `gate` set to an Event is one that never answers until it is released."""

    def __init__(self):
        self.up, self.gate = True, None
        self.containers, self.volumes, self.calls, self.hosts = {}, set(), [], []
        self.refuse_rm = False

    @property
    def verbs(self):
        return [call[0] for call in self.calls]

    async def __call__(self, args, **kwargs):
        if args[:1] == ["--host"]:
            self.hosts.append(args[1])
            args = args[2:]
        self.calls.append(list(args))
        if self.gate is not None:
            await self.gate.wait()
        if not self.up:
            return Result(1)
        if args[0] == "info":
            return Result(0, "linux")
        if args[:2] == ["container", "inspect"]:
            raw = self.containers.get(args[2])
            return Result(0, json.dumps([raw])) if raw else Result(1)
        if args[0] == "rm":
            if self.refuse_rm:
                return Result(1)
            return Result(0 if self.containers.pop(args[-1], None) else 1)
        if args[:2] == ["volume", "rm"]:
            return Result(0) if args[2] in self.volumes and not self.volumes.remove(args[2]) else Result(1)
        if args[:2] == ["volume", "inspect"]:
            return Result(0) if args[2] in self.volumes else Result(1)
        return Result(0)


@pytest.fixture
def engine():
    return Engine()


def new_vm(conn, engine, folder):
    clock = [0.0]
    fresh = LocalVm(folder, settings=SettingsStore(conn), runner=engine, conn=conn, clock=lambda: clock[0])
    fresh.now = clock
    return fresh


@pytest.fixture
async def vm(rig, engine, tmp_path):
    fresh = new_vm(rig.conn, engine, tmp_path / "data")
    rig.service.computer_data = fresh.data
    yield fresh
    await fresh.aclose(stop=False)


async def made(rig, name="A"):
    return SimpleNamespace(id=(await rig.call("members.create", {"name": name, "role": "r"}))["member"]["id"])


def has_computer(vm, engine, member_id, *, host="", files=True):
    """The member has a computer the app made: a container, and a folder here or a volume on `host`."""
    if host:
        vm.settings.set("computer_ssh_alias", host)
    target = vm.target(member_id)
    engine.containers[target.name] = {"Config": {"Labels": {f"{LABEL}.owner": vm.owner, f"{LABEL}.target": target.key}}}
    if host:
        engine.volumes.add(str(target.workspace))
    elif files:
        target.workspace.mkdir(parents=True)
        (target.workspace / "work.txt").write_text("a deleted member's file")
    vm.data.made(target)
    return target


def owed(vm):
    return {(host, key): (owing, attempts) for host, key, owing, attempts in vm.data.conn.execute("SELECT host, key, owed, attempts FROM computer_data")}


async def delete(rig, member_id):
    return await asyncio.wait_for(rig.call("members.delete", {"id": member_id}), 5)


async def test_a_member_that_never_had_a_computer_costs_the_engine_nothing(rig, vm, engine):
    one = await made(rig)
    assert await delete(rig, one.id) == {"deleted": True}
    assert vm.data.task is None and not vm.data.has_owed()
    assert engine.calls == [] and owed(vm) == {}


async def test_a_member_that_never_had_a_computer_on_a_host_costs_that_host_nothing(rig, vm, engine):
    vm.settings.set("computer_ssh_alias", "studio-mini")
    one = await made(rig)
    assert await delete(rig, one.id) == {"deleted": True}
    assert engine.calls == [] and engine.hosts == [] and owed(vm) == {}


async def test_the_computer_goes_after_the_answer_and_the_owner_is_asked_nothing(rig, vm, engine):
    one = await made(rig)
    target = has_computer(vm, engine, one.id)
    assert await delete(rig, one.id) == {"deleted": True}
    # The member is gone and the answer is out; the computer is owed and still there.
    assert rig.service.store.member(one.id) is None
    assert owed(vm) == {("", target.key): (1, 0)} and target.name in engine.containers and target.workspace.exists()
    await vm.data.task
    assert target.name not in engine.containers and not target.workspace.exists()
    assert owed(vm) == {} and not vm.data.has_owed()
    assert "stop" not in engine.verbs and "start" not in engine.verbs


async def test_an_engine_that_cannot_be_reached_owes_the_removal_until_it_is(rig, vm, engine):
    one = await made(rig)
    target = has_computer(vm, engine, one.id)
    engine.up = False
    assert await delete(rig, one.id) == {"deleted": True}
    await vm.data.task
    # Nothing was touched, nothing counts against it, and nothing was started.
    assert owed(vm) == {("", target.key): (1, 0)} and target.workspace.exists()
    assert set(engine.verbs) == {"info"} and vm.data.settling is False
    # Every later look at it from the monitor costs a probe and no more.
    engine.calls.clear()
    vm.data.settle_soon()
    await vm.data.task
    assert set(engine.verbs) == {"info"} and owed(vm) == {("", target.key): (1, 0)}
    # It comes back: whoever learns that, the first time, pays what is owed.
    engine.up = True
    assert await vm.available() is True
    await vm.data.task
    assert owed(vm) == {} and target.name not in engine.containers and not target.workspace.exists()


async def test_an_engine_that_never_answers_never_holds_the_deletion(rig, vm, engine):
    one = await made(rig)
    target = has_computer(vm, engine, one.id)
    engine.gate = asyncio.Event()
    assert await delete(rig, one.id) == {"deleted": True}
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert not vm.data.task.done() and owed(vm) == {("", target.key): (1, 0)}
    # The core ends while it still waits: the removal is still owed and nothing hangs.
    await vm.aclose(stop=False)
    assert vm.data.task is None and owed(vm) == {("", target.key): (1, 0)}
    engine.gate.set()
    engine.gate = None
    vm.data.settle_soon()
    await vm.data.task
    assert owed(vm) == {} and not target.workspace.exists()


async def test_a_computer_still_starting_for_the_deleted_member_does_not_hold_the_deletion(rig, vm, engine):
    # What the old dialog's tick hung on: the member's computer was being prepared (Docker Desktop waited for, an image
    # built), and the removal queued for the same lock before anything was deleted.
    one = await made(rig)
    target = has_computer(vm, engine, one.id)
    lock = vm.locks.setdefault(target.key, asyncio.Lock())
    await lock.acquire()
    assert await delete(rig, one.id) == {"deleted": True}
    assert rig.service.store.member(one.id) is None
    await vm.aclose(stop=False)
    lock.release()
    vm.data.settle_soon()
    await vm.data.task
    assert owed(vm) == {} and not target.workspace.exists()


async def test_a_computer_in_use_is_removed_when_it_is_free_and_the_wait_is_not_a_failure(rig, vm, engine):
    one = await made(rig)
    target = has_computer(vm, engine, one.id)
    vm.active[target.key] = 1
    assert await delete(rig, one.id) == {"deleted": True}
    await vm.data.task
    assert owed(vm) == {("", target.key): (1, 0)} and target.name in engine.containers
    vm.active.clear()
    vm.data.settle_soon()
    await vm.data.task
    assert owed(vm) == {} and target.name not in engine.containers


async def test_a_deleted_members_unfinished_start_is_ended(rig, vm, engine):
    one = await made(rig)
    target = has_computer(vm, engine, one.id)
    started = asyncio.get_running_loop().create_future()
    vm.preparing[target.key] = asyncio.ensure_future(started)
    assert await delete(rig, one.id) == {"deleted": True}
    await vm.data.task
    assert started.cancelled() and owed(vm) == {}


async def test_removal_that_is_already_done_is_success(rig, vm, engine):
    one = await made(rig)
    target = has_computer(vm, engine, one.id)
    engine.containers.clear()
    target.workspace.joinpath("work.txt").unlink()
    target.workspace.rmdir()
    assert await delete(rig, one.id) == {"deleted": True}
    await vm.data.task
    assert owed(vm) == {}


async def test_a_removal_that_fails_is_retried_a_bounded_number_of_times_then_waits_for_the_engine(rig, vm, engine):
    one = await made(rig)
    target = has_computer(vm, engine, one.id)
    engine.refuse_rm = True
    assert await delete(rig, one.id) == {"deleted": True}
    await vm.data.task
    assert owed(vm) == {("", target.key): (1, 1)}
    for _ in range(removals.RETRY_LIMIT + 3):
        await vm.data.settle()
    assert owed(vm) == {("", target.key): (1, removals.RETRY_LIMIT)}
    engine.calls.clear()
    vm.data.settle_soon()
    await vm.data.task
    assert engine.calls == []  # the timer leaves it alone now
    # The engine going away and coming back is news, and gets one more try, which now succeeds.
    engine.refuse_rm = False
    engine.up = False
    await vm.available()
    engine.up = True
    await vm.available()
    await vm.data.task
    assert owed(vm) == {} and target.name not in engine.containers


async def test_a_remote_hosts_computer_and_volume_are_removed_on_that_host(rig, vm, engine):
    one = await made(rig)
    target = has_computer(vm, engine, one.id, host="studio-mini")
    assert await delete(rig, one.id) == {"deleted": True}
    assert owed(vm) == {("studio-mini", target.key): (1, 0)}
    await vm.data.task
    assert owed(vm) == {} and not engine.containers and not engine.volumes
    assert set(engine.hosts) == {"ssh://studio-mini"}


async def test_a_remote_host_that_does_not_answer_is_tried_again_only_later_and_not_forever(rig, vm, engine):
    one = await made(rig)
    target = has_computer(vm, engine, one.id, host="studio-mini")
    engine.up = False
    assert await delete(rig, one.id) == {"deleted": True}
    await vm.data.task
    assert owed(vm) == {("studio-mini", target.key): (1, 1)}
    engine.calls.clear()
    vm.data.settle_soon()
    await vm.data.task
    assert engine.calls == []  # too soon for another SSH try
    vm.now[0] += removals.RETRY_AFTER_S
    vm.data.settle_soon()
    await vm.data.task
    assert owed(vm) == {("studio-mini", target.key): (1, 2)}
    engine.up = True
    assert await vm.available(vm.target(one.id)) is True
    await vm.data.task
    assert owed(vm) == {} and not engine.volumes


async def test_the_shared_computer_is_never_owed_to_a_deleted_member(rig, vm, engine):
    vm.settings.set("computer_vm_mode", "shared")
    one = await made(rig)
    shared = await vm.seat(one.id)
    assert shared.key == vm.key_for("", one.id) and shared.container == "shared"
    vm.data.made(shared)
    shared.workspace.mkdir(parents=True)
    assert await delete(rig, one.id) == {"deleted": True}
    assert vm.data.task is None and owed(vm) == {} and shared.workspace.exists() and engine.calls == []
    assert vm.seats.seat("", one.id) is None


async def test_deleting_releases_every_hosts_seat_and_keeps_shared_and_historic_cleanup(rig, vm, engine):
    one = await made(rig)
    historical = has_computer(vm, engine, one.id)
    vm.settings.set("computer_vm_mode", "shared")
    local = await vm.seat(one.id)
    vm.settings.set("computer_ssh_alias", "studio")
    remote = await vm.seat(one.id)
    for target in (local, remote):
        engine.containers[target.name] = {"Config": {"Labels": {f"{LABEL}.owner": vm.owner, f"{LABEL}.target": target.unit}}}
    vm.disconnect_driver = AsyncMock()
    vm.close_seat_viewers = AsyncMock()
    assert await delete(rig, one.id) == {"deleted": True}
    assert not vm.seats.rows
    await vm.data.task
    assert historical.name not in engine.containers
    assert local.name in engine.containers and remote.name in engine.containers
    assert vm.disconnect_driver.await_count == vm.close_seat_viewers.await_count == 2


async def test_the_owed_removal_survives_the_core_ending_and_is_paid_at_its_start(rig, vm, engine, tmp_path):
    one = await made(rig)
    target = has_computer(vm, engine, one.id)
    engine.up = False
    assert await delete(rig, one.id) == {"deleted": True}
    await vm.data.task
    await vm.aclose(stop=False)
    # A new core on the same database and folder.
    engine.up = True
    again = new_vm(rig.conn, engine, tmp_path / "data")
    assert again.data.has_owed()
    again.start_monitor()
    await again.data.task
    assert owed(again) == {} and target.name not in engine.containers and not target.workspace.exists()
    await again.aclose(stop=False)


async def test_a_failed_deletion_owes_nothing(rig, vm, engine):
    one = await made(rig)
    target = has_computer(vm, engine, one.id)
    original = rig.service.store.delete_member

    def broken(member_id):
        original(member_id)
        raise RuntimeError("the transaction fails after the rows are gone")

    rig.service.store.delete_member = broken
    with pytest.raises(Exception):
        await delete(rig, one.id)
    assert rig.service.store.member(one.id) is not None
    assert owed(vm) == {("", target.key): (0, 0)} and vm.data.task is None and target.workspace.exists()


async def test_the_primary_members_deletion_through_its_tools_removes_the_computer_too(setup, client, engine, tmp_path):
    rig, team = setup
    team.members.register(rig.rpc)
    one = member(team, name="COO")
    vm = new_vm(rig.conn, engine, tmp_path / "data")
    team.members.computer_data = vm.data
    target = has_computer(vm, engine, one.id)
    rig.settings.set("action_mode", "direct")
    client.chats = [chat("Deleting COO.", use("member_delete", {"id": one.id})), live_said("Deleted COO.")]
    asked = await typed(rig, "Delete COO", 0, language="en")
    assert asked["status"] == "confirm" and asked["confirm"]["tier"] == "T3"
    assert "computer" not in asked["confirm"]["text"].lower()
    assert target.name in engine.containers  # nothing is removed before the yes
    await rig.confirm(asked["confirm"]["id"], True)
    assert team.members.speaker(one.id) is None
    await vm.data.task
    assert owed(vm) == {} and target.name not in engine.containers and not target.workspace.exists()
    await vm.aclose(stop=False)


async def test_the_database_keeps_the_record_of_computers_the_app_made(conn):
    assert conn.execute("SELECT COUNT(*) FROM computer_data").fetchone()[0] == 0
    columns = [row[1] for row in conn.execute("PRAGMA table_info(computer_data)")]
    assert columns == ["host", "key", "owed", "attempts"]

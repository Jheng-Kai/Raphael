"""Lifecycle contracts use the fake Docker runner and synthetic disk output only."""

import asyncio
import json

import pytest

from raphael_core.brain.settings import checked
from raphael_core.computer.lifecycle import disk_pressure, maintain, repair_connection
from raphael_core.computer.vm import GUEST, LABEL, Result, VmError
from raphael_core.computer.viewer import DesktopViewer
from .test_vm import container, desktop  # noqa: F401
from .test_vm import CatalogBridge, EmptyHub
from raphael_core.computer.vm_tools import VmTools, vm_scope
from raphael_core.services.attachment_store import AttachmentStore


@pytest.fixture
def previous_computer(desktop, request):
    remote, layer = request.param
    vm, _, runtime = desktop
    vm.settings.set('computer_vm_mode', 'per-bot')
    vm.settings.set('computer_ssh_alias', 'review-host' if remote else '')
    target = vm.target(1)
    runtime.raw = container(vm, target, runtime)
    runtime.raw['Image'] = 'sha256:previous-image'
    runtime.raw['Config']['Labels'][f'{LABEL}.layer'] = str(layer)
    runtime.raw['Config']['Env'] = ['VNC_PW=private', 'TZ=UTC']
    memory = (2 if layer == 3 else 3) * 1024**3
    runtime.raw['HostConfig'].update(Memory=memory, MemorySwap=memory)
    return vm, target, runtime


@pytest.mark.parametrize('previous_computer', [(remote, layer) for remote in (False, True) for layer in (3, 4)], indirect=True)
@pytest.mark.parametrize('action', ['restart', 'update', 'repair', 'reset'])
async def test_previous_computer_maintenance_rebuilds_without_starting_old_image(previous_computer, action):
    vm, target, runtime = previous_computer
    original = vm.run

    async def runner(args, **kwargs):
        actual = args[2:] if args[:1] == ['--host'] else args
        if actual[0] == 'run':
            runtime.raw = container(vm, target, runtime)
        return await original(args, **kwargs)

    vm.run = runner
    assert (await maintain(vm, target, action, confirmed=action == 'reset'))['ready']
    assert sum(args[0] == 'rm' for args, _ in runtime.calls) == 1
    assert sum(args[0] == 'run' for args, _ in runtime.calls) == 1
    assert not any(args[0] == 'start' for args, _ in runtime.calls)
    assert [args for args, _ in runtime.calls if args[0] == 'volume'] == (
        [['volume', 'rm', str(target.workspace)]] if action == 'reset' and target.remote else [])


@pytest.mark.parametrize('previous_computer', [(remote, layer) for remote in (False, True) for layer in (3, 4)], indirect=True)
async def test_previous_member_data_deletion_needs_no_new_image_or_start(previous_computer):
    vm, target, runtime = previous_computer
    runtime.built = False
    if not target.remote:
        target.workspace.mkdir(parents=True)
        (target.workspace / 'saved.txt').write_text('old data', encoding='utf-8')
    await vm.erase(target)
    assert runtime.raw is None
    assert not any(args[0] in ('start', 'run', 'pull', 'build') for args, _ in runtime.calls)
    if target.remote:
        assert ['volume', 'rm', str(target.workspace)] in [args for args, _ in runtime.calls]
    else:
        assert not target.workspace.exists()


@pytest.mark.parametrize('guard', ['allowed', 'admission', 'held', 'active', 'driver', 'fresh', 'recovers', 'persistent'])
async def test_missing_screen_setup_repairs_once_after_twenty_polls(desktop, monkeypatch, guard):
    vm, target, runtime = desktop
    runtime.screens_ready = False
    if guard == 'held':
        vm.held.add(target.key)
    vm.active[target.key] = 2 if guard == 'active' else 1
    vm.repair_admit = lambda captured: guard != 'admission'
    if guard == 'fresh':
        runtime.raw['State']['Running'] = False
    pauses, repairs = [], []
    original = vm.run

    async def runner(args, **kwargs):
        if args[0] == 'restart':
            repairs.append(len(pauses))
            if guard != 'persistent':
                runtime.screens_ready = True
        if guard == 'driver' and 'health_report' in args:
            return Result(1)
        return await original(args, **kwargs)

    async def sleep(seconds):
        pauses.append(seconds)
        if guard == 'recovers' and len(pauses) == 19:
            runtime.screens_ready = True

    vm.run = runner
    monkeypatch.setattr(asyncio, 'sleep', sleep)
    if guard in ('allowed', 'fresh', 'recovers'):
        assert (await vm._start(target))['ready']
    else:
        with pytest.raises(VmError, match='^health_timeout$'):
            await vm._start(target)
    expected = [20] if guard in ('allowed', 'fresh', 'persistent') else []
    assert repairs == expected
    # Waking a stopped computer in the middle of a member's call is recorded as a repair of its own.
    assert vm.repair_revisions.get(target.key, 0) == len(expected) + (guard == 'fresh')
    assert all(args == ['restart', '--time', '10', target.name] for args, _ in runtime.calls if args[0] == 'restart')


@pytest.mark.parametrize("action", ["restart", "update", "repair", "reset"])
async def test_maintenance_is_targeted_and_only_confirmed_reset_removes_workspace(desktop, action):
    vm, target, runtime = desktop
    target.workspace.mkdir(parents=True)
    marker = target.workspace / "saved.txt"
    marker.write_text("owner data")
    target.shared.mkdir(parents=True)
    shared = target.shared / "shared.txt"
    shared.write_text("team data")
    original = vm.run
    async def runner(args, **kwargs):
        result = await original(args, **kwargs)
        if args[0] == "run":
            runtime.raw = container(vm, target, runtime)
        return result
    vm.run = runner
    await maintain(vm, target, action, confirmed=action == "reset")
    assert marker.exists() == (action != "reset")
    assert shared.read_text() == "team data"
    mutations = [args for args, _ in runtime.calls if args[0] in ("stop", "rm", "start", "run")]
    assert mutations and all(target.name in args for args in mutations)
    assert not any(args[:2] == ["volume", "rm"] for args, _ in runtime.calls)
    assert not vm.maintenance and not vm.lifecycle


async def test_reset_needs_explicit_true_and_refuses_foreign_or_held_computers(desktop):
    vm, target, runtime = desktop
    for confirmed in (False, 1, "yes"):
        with pytest.raises(VmError, match="confirmation_required"):
            await maintain(vm, target, "reset", confirmed=confirmed)
    assert not runtime.calls
    runtime.raw["Config"]["Labels"][f"{LABEL}.owner"] = "someone-else"
    with pytest.raises(VmError, match="incompatible"):
        await maintain(vm, target, "repair")
    assert not any(args[0] in ("stop", "rm", "run") for args, _ in runtime.calls)
    vm.held.add(target.key)
    with pytest.raises(VmError, match="busy"):
        await maintain(vm, target, "reset", confirmed=True)


async def test_reset_refuses_workspace_symlink_before_any_mutation(desktop, tmp_path):
    vm, target, runtime = desktop
    outside = tmp_path / 'outside'
    outside.mkdir()
    target.workspace.parent.mkdir(parents=True)
    try:
        target.workspace.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip('Directory symlinks are not available')
    with pytest.raises(VmError, match='outside_workspace'):
        await maintain(vm, target, 'reset', confirmed=True)
    assert not any(args[0] in ('stop','rm','run') for args, _ in runtime.calls)


async def test_never_sleep_and_remote_idle_keep_the_same_stop_contract(desktop):
    vm, target, runtime = desktop
    assert checked('computer_vm_idle_minutes', 0) == ('computer_vm_idle_minutes', 0)
    vm.settings.set('computer_vm_idle_minutes', 0)
    vm.last_activity[target.key] = -100000
    await vm.sweep()
    assert not runtime.calls
    vm.settings.set('computer_vm_idle_minutes', 5)
    await vm.sweep()
    assert any(args[0] == 'stop' for args, _ in runtime.calls)
    assert not any(args[0] == 'rm' for args, _ in runtime.calls)


async def test_disk_notice_reads_fake_df_once_per_episode_and_never_deletes(desktop):
    vm, target, runtime = desktop
    now, percent = [0], [95]
    vm.clock = lambda: now[0]
    async def runner(args, **kwargs):
        runtime.calls.append((args, kwargs))
        if 'df' in args:
            return Result(0, f'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/fake 100 95 5 {percent[0]}% /\n')
        if 'du' in args:
            return Result(0, f'204800\t{GUEST}/downloads\n102400\t{GUEST}/reports\n409600\t{GUEST}\n')
        raise AssertionError(args)
    vm.run = runner
    assert await disk_pressure(vm, target) == [(204800, GUEST + '/downloads'), (102400, GUEST + '/reports')]
    assert await disk_pressure(vm, target) is None
    now[0] += 300
    assert await disk_pressure(vm, target) is None
    now[0] += 300; percent[0] = 30
    assert await disk_pressure(vm, target) is None
    now[0] += 300; percent[0] = 98
    assert await disk_pressure(vm, target)
    assert all('df' in args or 'du' in args for args, _ in runtime.calls)


async def test_maintenance_rpc_pins_host_and_target_before_docker(desktop):
    vm, target, runtime = desktop
    viewer = DesktopViewer(vm)
    try:
        with pytest.raises(Exception, match='Computer changed'):
            await viewer.lifecycle({'member_id':0,'host':'other-host','target':target.key,'action':'reset','confirmed':True})
        assert not runtime.calls
    finally:
        await viewer.aclose()


async def test_missing_driver_socket_repairs_one_exact_container_without_workspace_removal(desktop):
    vm, target, runtime = desktop
    original = vm.run
    notices = []
    vm.repair_notice = lambda captured: notices.append(captured)
    async def runner(args, **kwargs):
        if 'test' in args and '-S' in args:
            runtime.calls.append((args, kwargs)); return Result(1)
        return await original(args, **kwargs)
    vm.run = runner
    await repair_connection(vm, target)
    assert [args for args, _ in runtime.calls if args[0] == 'restart'] == [['restart','--time','10',target.name]]
    assert notices == [target]
    assert not any(args[0] in ('rm','volume') for args, _ in runtime.calls)


@pytest.mark.parametrize('initial', ['missing', 'stopped', 'running'])
async def test_boot_waits_for_driver_without_restarting_fresh_or_already_repaired_computer(desktop, initial):
    vm, target, runtime = desktop
    states = iter([{'state': initial, 'ready': False, 'image': True},
                   {'state': 'running', 'ready': False}, {'state': 'running', 'ready': True}])
    async def status(*args, **kwargs):
        return next(states)
    async def wallpaper(*args):
        pass
    original = vm.run
    async def runner(args, **kwargs):
        if 'test' in args and '-S' in args:
            runtime.calls.append((args, kwargs))
            return Result(1)
        return await original(args, **kwargs)
    vm.status, vm._wallpaper, vm.run = status, wallpaper, runner
    vm.repair_admit = lambda captured: False
    assert (await vm._start(target))['ready']
    assert not any(args[0] == 'restart' for args, _ in runtime.calls)
    if initial != 'running':
        assert not any('test' in args and '-S' in args for args, _ in runtime.calls)


@pytest.mark.parametrize('phase', ['connect', 'action'])
async def test_self_repair_is_once_in_the_current_turn_and_never_replays_uncertain_input(desktop, tmp_path, phase):
    vm, target, runtime = desktop
    class Driver(CatalogBridge):
        attempts, clicks, calls = 0, 0, []
        async def __aenter__(self):
            type(self).attempts += 1
            if phase == 'connect' and type(self).attempts == 1:
                raise ConnectionError('Synthetic missing socket')
            return await super().__aenter__()
        async def request(self, method, params=None):
            if method == 'tools/call' and params['name'] == 'click':
                type(self).clicks += 1
                if phase == 'action':
                    raise ConnectionError('Synthetic stopped container')
            return await super().request(method, params)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Driver)
    await hub.prepare()
    lines = []
    try:
        key = next(tool.key for tool in hub.offered() if tool.name == 'click')
        with vm_scope(0, private=True, progress=lines.append, language='zh-TW'):
            result = await hub.call(key, {}, approver='auto')
        assert result.ok == (phase == 'connect')
        assert Driver.clicks == 1
        assert sum('已自動修復' in line for line in lines) == 1
        if phase == 'action':
            assert result.kind == 'connection_repaired' and 'not replayed' in result.text
            with vm_scope(0, private=True, progress=lines.append, language='zh-TW'):
                blocked = await hub.call(key, {}, approver='auto')
            assert blocked.kind in ('screen_changed', 'desktop_check_required') and Driver.clicks == 1
    finally:
        await hub.aclose()


async def test_viewer_tunnel_gets_one_retry_and_reports_repair(desktop):
    vm, target, _ = desktop
    attempts, lines = [], []
    vm.repair_notice = lines.append
    async def connection(captured):
        attempts.append(captured)
        if len(attempts) == 1:
            raise VmError('viewer_tunnel_failed')
        return 1234, 'not-public'
    vm._viewer_connection = connection
    assert await vm.viewer_connection(target) == (1234, 'not-public')
    assert attempts == [target, target] and lines == [target]


async def test_remote_reset_removes_only_the_confirmed_workspace_volume(desktop):
    vm, _, runtime = desktop
    vm.settings.set('computer_ssh_alias', 'studio')
    target = vm.target()
    runtime.raw = container(vm, target, runtime)
    original = vm.run
    async def runner(args, **kwargs):
        result = await original(args, **kwargs)
        command = args[2:] if args[:1] == ['--host'] else args
        if command[0] == 'run':
            runtime.raw = container(vm, target, runtime)
        return result
    vm.run = runner
    with pytest.raises(VmError, match='confirmation_required'):
        await maintain(vm, target, 'reset')
    assert not runtime.calls
    await maintain(vm, target, 'reset', confirmed=True)
    assert [args for args, _ in runtime.calls if args[:2] == ['volume','rm']] == [['volume','rm',str(target.workspace)]]
    assert not any(str(target.shared) in args for args, _ in runtime.calls if args[:2] == ['volume','rm'])


async def test_low_disk_notice_uses_a_complete_member_message_once(desktop, tmp_path):
    vm, _, runtime = desktop
    original = vm.run
    async def runner(args, **kwargs):
        if 'df' in args:
            return Result(0, 'Filesystem 1024-blocks Used Available Capacity Mounted on\nfake 100 95 5 95% /\n')
        if 'du' in args:
            return Result(0, f'204800\t{GUEST}/downloads\n')
        return await original(args, **kwargs)
    vm.run = runner
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=CatalogBridge)
    await hub.prepare()
    lines, notices = [], []
    try:
        key = next(tool.key for tool in hub.offered() if tool.name == 'list_windows')
        with vm_scope(0, private=True, progress=lines.append, notice=notices.append, language='zh-TW'):
            assert (await hub.call(key, {}, approver='auto')).ok
            assert (await hub.call(key, {}, approver='auto')).ok
        assert not lines
        assert len(notices) == 1 and 'downloads (200 MiB)' in notices[0] and '刪除前' in notices[0]
        assert not any(args[0] in ('rm','stop','volume') for args, _ in runtime.calls)
    finally:
        await hub.aclose()


async def test_a_second_driver_connection_failure_is_returned_without_repair_loop(desktop, tmp_path):
    vm, target, _ = desktop
    class Driver(CatalogBridge):
        attempts = 0
        async def __aenter__(self):
            type(self).attempts += 1
            raise ConnectionError('Synthetic permanent failure')
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Driver)
    await hub.prepare()
    lines = []
    try:
        key = next(tool.key for tool in hub.offered() if tool.name == 'click')
        with vm_scope(0, private=True, progress=lines.append, language='zh-TW'):
            result = await hub.call(key, {}, approver='auto')
        assert not result.ok and Driver.attempts == 2
        assert vm.repair_revisions[target.key] == 1
    finally:
        await hub.aclose()


async def test_owner_maintenance_never_evicts_another_computer_at_capacity(desktop):
    vm, _, _ = desktop
    vm.settings.set('computer_vm_mode', 'per-bot')
    vm.targets.clear()
    target = vm.target(0)
    vm.target(1); vm.target(2)
    vm.maintenance[target.key] = asyncio.current_task()
    async def recover():
        pass
    async def status(captured, **kwargs):
        return {'state':'missing' if captured == target else 'running'}
    async def stop(*args, **kwargs):
        raise AssertionError('Maintenance must not evict another computer')
    vm.recover, vm.status, vm.stop = recover, status, stop
    with pytest.raises(VmError, match='local_capacity'):
        await vm._make_room(target)


async def test_another_task_cannot_start_a_computer_during_maintenance(desktop):
    vm, target, runtime = desktop
    vm.maintenance[target.key] = object()
    with pytest.raises(VmError, match='busy'):
        await vm.start(target)
    assert not runtime.calls


async def test_update_rebuilds_on_the_current_image_without_pulling_or_losing_workspace(desktop):
    vm, target, runtime = desktop
    target.workspace.mkdir(parents=True)
    marker = target.workspace / 'saved.txt'; marker.write_text('kept')
    runtime.image_id = 'sha256:current-image'
    original = vm.run
    async def runner(args, **kwargs):
        result = await original(args, **kwargs)
        if args[0] == 'run':
            runtime.raw = container(vm, target, runtime)
        return result
    vm.run = runner
    await maintain(vm, target, 'update')
    assert runtime.raw['Image'] == 'sha256:current-image' and marker.read_text() == 'kept'
    assert not any(args[0] in ('pull','build','volume') for args, _ in runtime.calls)

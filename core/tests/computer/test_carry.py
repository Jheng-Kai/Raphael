"""Carry contracts use only temporary synthetic homes and injected container operations."""

import asyncio
import json
from copy import deepcopy
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from raphael_core.computer import carry, carry_runtime, vm
from .test_vm import Runtime, container, per_bot_desktop


@pytest.fixture
def homes(tmp_path, monkeypatch):
    source, destination = tmp_path / 'old', tmp_path / 'shared'
    source.mkdir()
    destination.mkdir()
    (source / 'report.txt').write_text('owner test files')
    profile = source / carry_runtime.PROFILE
    (profile / 'Default').mkdir(parents=True)
    (profile / 'Default/Cookies').write_bytes(b'persistent test cookie')
    (profile / 'SingletonLock').write_text('old lock')
    for cache in ('Default/Cache', 'Default/Code Cache', 'GrShaderCache'):
        (profile / cache).mkdir()
        (profile / cache / 'data_0').write_bytes(b'rebuilt by the browser')
    (source / '.raphael-data').mkdir()
    (source / '.raphael-data/sales.duckdb').write_bytes(b'test dataset')
    (source / '.raphael-data/venv').mkdir()
    for excluded in carry.EXCLUDE:
        if not (source / excluded).exists():
            (source / excluded).mkdir()
            (source / excluded / 'excluded').write_text('excluded')
    monkeypatch.setattr(carry_runtime.os, 'chown', lambda *args, **kwargs: None, raising=False)
    return source, destination


def arguments(**kwargs):
    return {'operation': 'copy', 'key': 'a' * 16, 'folder': 'Ada', 'profile': True,
            'excluded': carry.EXCLUDE, **kwargs}


def test_linux_copy_carries_profile_files_and_datasets_with_exclusions_and_source_unchanged(homes, monkeypatch):
    source, destination = homes
    before = {str(p.relative_to(source)): p.read_bytes() for p in source.rglob('*') if p.is_file()}
    owners = []
    monkeypatch.setattr(carry_runtime.os, 'chown', lambda path, uid, gid, **kwargs: owners.append((Path(path), uid, gid)))
    result = carry_runtime.execute(arguments(), source, destination)
    assert result['profile'] == 'carried' and result['files'] == 'carried'
    assert (destination / carry_runtime.PROFILE / 'Default/Cookies').read_bytes() == b'persistent test cookie'
    assert not list((destination / carry_runtime.PROFILE).glob('Singleton*'))
    # Caches are most of a used profile and hold no sign-in: the browser rebuilds them.
    assert not [path for path in (destination / carry_runtime.PROFILE).rglob('*') if path.name in carry_runtime.PROFILE_LEFT]
    assert (destination / 'Ada/report.txt').read_text() == 'owner test files'
    assert not any((destination / 'Ada' / name).exists() for name in carry.EXCLUDE)
    assert (destination / '.raphael-data/members' / ('a' * 16) / 'sales.duckdb').read_bytes() == b'test dataset'
    assert not list(destination.rglob('venv'))
    assert all((uid, gid) == (1000, 1000) for _, uid, gid in owners)
    # Files and the profile are handed over while still staged (in the helper's own root-only folder), so
    # nothing a member could prepare is ever walked; folders made on the way are handed over one by one.
    owned = {path for path, _, _ in owners}
    assert {destination / '.raphael-data', destination / '.raphael-data/members',
            destination / '.raphael-data/members' / ('a' * 16),
            destination / '.browser-profiles', destination / '.browser-profiles/driver'} <= owned
    staged = {path for path in owned if any(part.startswith(('.raphael-carry-', '.carry-profile-')) for part in path.parts)}
    assert {'report.txt', 'Cookies', '.raphael-carried-member'} <= {path.name for path in staged}
    assert any(path.parent == destination / '.raphael-data/members' / ('a' * 16) for path in owned)
    assert not [path for path in owned - staged if path.is_relative_to(destination / 'Ada')
                or path.is_relative_to(destination / carry_runtime.PROFILE)]
    assert before == {str(p.relative_to(source)): p.read_bytes() for p in source.rglob('*') if p.is_file()}
    assert not (destination / carry.RECORD).exists()
    # A core retry after a later operation failed recognizes its own already published folder.
    assert carry_runtime.execute(arguments(), source, destination)['profile'] == 'kept_existing'


def test_large_home_keeps_only_its_files_in_place_and_an_unknown_folder_is_never_merged(homes, monkeypatch):
    source, destination = homes
    monkeypatch.setattr(carry_runtime, 'LIMIT', 1)
    result = carry_runtime.execute(arguments(), source, destination)
    # No part of the files, but the member's sign-ins and datasets are what a shared computer is for.
    assert result['files'] == 'left_in_place' and not (destination / 'Ada').exists()
    assert not [path for path in destination.iterdir() if path.name.startswith('.raphael-carry-')]
    assert result['profile'] == 'carried' and (destination / carry_runtime.PROFILE / 'Default/Cookies').is_file()
    assert result['datasets'] == [{'name': 'sales.duckdb', 'status': 'carried'}]
    monkeypatch.setattr(carry_runtime, 'LIMIT', 1024 ** 3)
    (destination / 'Ada').mkdir()
    with pytest.raises(ValueError, match='already exists'):
        carry_runtime.execute(arguments(), source, destination)
    assert not list((destination / 'Ada').iterdir())


def test_a_copy_without_a_profile_hands_over_nothing_a_member_prepared(homes, monkeypatch):
    # Review D-02: os.walk follows a link given as its starting point, and the helper is root. A member's
    # .browser-profiles (a link to anywhere) was walked and handed over even when no profile was copied.
    source, destination = homes
    prepared = destination / '.browser-profiles'
    (prepared / 'elsewhere').mkdir(parents=True)
    (prepared / 'elsewhere/kept').write_text('made by a member, not by this carry')
    (destination / '.raphael-data/members' / ('b' * 16)).mkdir(parents=True)
    owners = []
    monkeypatch.setattr(carry_runtime.os, 'chown', lambda path, uid, gid, **kwargs: owners.append(Path(path)))
    result = carry_runtime.execute(arguments(profile=False), source, destination)
    assert result['profile'] == 'skipped' and result['files'] == 'carried'
    assert not [path for path in owners if path == prepared or path.is_relative_to(prepared)]
    assert not [path for path in owners if path.is_relative_to(destination / '.raphael-data/members' / ('b' * 16))]


def test_folders_made_on_the_way_are_handed_over_before_a_copy_that_may_fail(homes, monkeypatch):
    # Second review, D2-06: the helper is root. A profile copy that failed, or was still running when the browser
    # could wait no longer, left .browser-profiles/driver root-owned: the launcher's own mkdir then fails.
    source, destination = homes
    owners = []
    monkeypatch.setattr(carry_runtime.os, 'chown', lambda path, uid, gid, **kwargs: owners.append(Path(path)))
    def copytree(*args, **kwargs):
        assert {destination / '.browser-profiles', destination / '.browser-profiles/driver'} <= set(owners)
        raise OSError(5, 'synthetic read error')
    monkeypatch.setattr(carry_runtime.shutil, 'copytree', copytree)
    with pytest.raises(OSError):
        carry_runtime.execute(arguments(), source, destination)
    assert (destination / '.browser-profiles/driver').is_dir() and not (destination / carry_runtime.PROFILE).exists()
    owners.clear()
    def copy2(old, new, **kwargs):
        if Path(old).suffix == '.duckdb':
            assert {destination / '.raphael-data', destination / '.raphael-data/members',
                    destination / '.raphael-data/members' / ('a' * 16)} <= set(owners)
            raise OSError(5, 'synthetic read error')
        return original(old, new, **kwargs)
    original = carry_runtime.shutil.copy2
    monkeypatch.setattr(carry_runtime.shutil, 'copy2', copy2)
    with pytest.raises(OSError):
        carry_runtime.execute(arguments(profile=False), source, destination)


def test_a_profile_the_browser_made_meanwhile_is_kept(homes, monkeypatch):
    # The carry goes on behind a browser that could not wait: its own new profile wins, the copy is dropped.
    source, destination = homes
    target = destination / carry_runtime.PROFILE
    original = Path.rename
    def rename(path, new):
        if Path(new) == target:
            target.mkdir(parents=True)
            (target / 'First Run').write_text('the browser was first')
            raise OSError(39, 'Directory not empty')
        return original(path, new)
    monkeypatch.setattr(Path, 'rename', rename)
    result = carry_runtime.execute(arguments(), source, destination)
    assert result['profile'] == 'kept_existing' and result['files'] == 'carried'
    assert [path.name for path in target.iterdir()] == ['First Run']
    assert not [path for path in target.parent.iterdir() if path.name.startswith('.carry-profile-')]


def test_workspace_links_are_skipped_without_copying_their_contents(homes, monkeypatch):
    source, destination = homes
    (source / 'linked.txt').write_text('do not follow')
    (source / 'linked-dir').mkdir()
    (source / 'linked-dir/hidden.txt').write_text('do not descend')
    original = Path.is_symlink
    monkeypatch.setattr(Path, 'is_symlink', lambda path: path in (source / 'linked.txt', source / 'linked-dir') or original(path))
    result = carry_runtime.execute(arguments(profile=False), source, destination)
    assert result['skipped_links_or_special'] == 1
    assert not (destination / 'Ada/linked.txt').exists() and not (destination / 'Ada/linked-dir').exists()


def test_existing_profile_is_preserved_and_symlink_destinations_refused(homes, monkeypatch):
    source, destination = homes
    profile = destination / carry_runtime.PROFILE
    profile.mkdir(parents=True)
    (profile / 'keep').write_text('existing sign-in')
    assert carry_runtime.execute(arguments(), source, destination)['profile'] == 'kept_existing'
    assert (profile / 'keep').read_text() == 'existing sign-in'
    original = Path.is_symlink
    monkeypatch.setattr(Path, 'is_symlink', lambda path: path == destination / '.raphael-data' or original(path))
    with pytest.raises(ValueError, match='symlink'):
        carry_runtime.execute(arguments(folder='Other'), source, destination)


def test_safe_names_disambiguate_names_and_preexisting_directories():
    assert carry.folder_name('../Ada:*', 'a' * 16, set()) == '_Ada__'
    assert carry.folder_name('Ada', 'a' * 16, {'ada'}) == 'Ada-' + 'a' * 16
    assert carry.folder_name('Ada', 'a' * 16, {'Ada', 'Ada-' + 'a' * 16}) == 'Ada-' + 'a' * 16 + '-2'
    assert carry.folder_name('CON.txt', 'a' * 16, set()) == 'member-CON.txt'
    long = '\u754c' * 100
    base = carry.folder_name(long, 'a' * 16, set())
    assert len(carry.folder_name(long, 'a' * 16, {base}).encode('utf-8')) < 255


@pytest.mark.parametrize('remote', ['', 'test-host'])
def test_helper_exact_linux_form_uses_readonly_source_and_same_image(tmp_path, remote):
    machine = vm.LocalVm(tmp_path, runner=Runtime())
    source, target = machine.target_for(remote, 'a' * 16), machine.shared_target(remote, 1, 1)
    args = carry.helper_args(source, target, arguments())
    assert args[:6] == ['run', '--rm', '--network', 'none', '--user', '0']
    # Named, and not with the computers' prefix: a helper that is given up is killed by this name.
    assert args[6:8] == ['--name', f'raphael-carry-{machine.owner}-' + 'a' * 16] and carry.helper_name(source) == args[7]
    assert not args[7].startswith('raphael-computer-')
    assert args[8:10] == ['-v', str(source.workspace) + ':/from:ro']
    assert args[10:16] == ['-v', str(target.workspace) + ':/to', '--entrypoint', 'sh', vm.IMAGE, '-c']
    assert 'Singleton*' in args[-1] and '1000' in args[-1] and len(args) == 17


@pytest.mark.parametrize('remote', ['', 'test-host'])
async def test_core_stops_idle_skips_busy_selects_newest_and_retries_failures_once_next_start(tmp_path, monkeypatch, remote):
    machine = vm.LocalVm(tmp_path, runner=Runtime())
    target = machine.shared_target(remote, 1, 1)
    sources = [machine.target_for(remote, char * 16) for char in 'abcd']
    machine.active[sources[0].key] = 1
    for source in sources:
        if not remote:
            source.workspace.mkdir(parents=True)
    state, copies, scans, commands = {}, [], [], []
    failed = set()
    async def journal(vm, target, record=None):
        if record is None:
            return deepcopy(state)
        state.clear()
        state.update(deepcopy(record))
    async def inspect(source):
        raw = container(machine, source, machine.run)
        return raw
    async def run_for(target, args, **kwargs):
        commands.append(args)
        return vm.Result(0, '[]')
    async def helper(vm, source, target, args):
        if args['operation'] == 'scan':
            scans.append(source.key)
            return {'profile': True, 'cookies': sources.index(source), 'destination_profile': False,
                    'folders': ['Ada'], 'bytes': 2 * 1024**3 if source == sources[3] else 1}
        copies.append((source.key, args))
        if source == sources[1] and source.key not in failed:
            failed.add(source.key)
            raise RuntimeError('synthetic interrupted copy')
        return {'profile': 'carried' if args['profile'] else 'skipped',
                'files': 'left_in_place' if source == sources[3] else 'carried'}
    monkeypatch.setattr(carry, 'journal', journal)
    monkeypatch.setattr(carry, 'candidates', AsyncMock(return_value=[(source, 'Ada') for source in sources]))
    monkeypatch.setattr(carry, 'helper', helper)
    monkeypatch.setattr(machine, 'inspect', inspect)
    monkeypatch.setattr(machine, 'run_for', run_for)
    await carry.before_browser(machine, target)
    assert state[sources[0].key]['status'] == 'deferred'
    assert state[sources[1].key]['status'] == 'failed' and state[sources[1].key]['attempts'] == 1
    assert state[sources[2].key]['status'] == 'done'
    # The largest home has the newest sign-ins: its files stay, its profile is carried, and it goes first.
    assert state[sources[3].key] == {'status': 'done', 'profile': 'carried', 'files': 'left_in_place'}
    assert sources[0].key not in scans
    assert [(key, args['profile']) for key, args in copies] == [
        (sources[3].key, True), (sources[1].key, False), (sources[2].key, False)]
    assert all(args['folder'] == 'Ada-' + key for key, args in copies)
    assert ['stop', '--time', '10', sources[0].name] not in commands
    assert all(args[0] not in ('rm', 'cp') for args in commands)
    await carry.before_browser(machine, target)
    assert len(copies) == 3
    machine.carry_attempted.clear()
    await carry.before_browser(machine, target)
    assert state[sources[1].key]['status'] == 'done' and len(copies) == 4
    assert not machine.maintenance


async def carry_rig(tmp_path, monkeypatch, copy):
    machine = vm.LocalVm(tmp_path, runner=Runtime())
    target, source = machine.shared_target('', 1, 1), machine.target_for('', 'a' * 16)
    source.workspace.mkdir(parents=True)
    state, copies = {}, []
    async def journal(vm, target, record=None):
        if record is None:
            return deepcopy(state)
        state.clear()
        state.update(deepcopy(record))
    async def helper(vm, source, target, args):
        if args['operation'] == 'scan':
            return {'profile': True, 'cookies': 1, 'destination_profile': False, 'folders': [], 'bytes': 1}
        copies.append(args)
        return await copy()
    monkeypatch.setattr(carry, 'journal', journal)
    monkeypatch.setattr(carry, 'candidates', AsyncMock(return_value=[(source, 'Ada')]))
    monkeypatch.setattr(carry, 'helper', helper)
    monkeypatch.setattr(machine, 'inspect', AsyncMock(return_value=None))
    return machine, target, source, state, copies


async def test_a_copy_that_keeps_failing_is_paid_for_three_times_and_then_left_in_place(tmp_path, monkeypatch):
    async def copy():
        raise RuntimeError('synthetic unreadable file')
    machine, target, source, state, copies = await carry_rig(tmp_path, monkeypatch, copy)
    for attempt in range(1, carry.ATTEMPTS + 1):
        machine.carry_attempted.clear()
        await carry.before_browser(machine, target)
        assert state[source.key]['status'] == 'failed' and state[source.key]['attempts'] == attempt
    for later in range(2):
        machine.carry_attempted.clear()
        await carry.before_browser(machine, target)
        assert state[source.key]['status'] == 'left_in_place' and state[source.key]['reason'] == 'failed'
    assert len(copies) == carry.ATTEMPTS and not machine.maintenance


async def test_the_browser_waits_only_its_budget_and_a_slow_copy_keeps_the_old_homes_guard(tmp_path, monkeypatch):
    # Review D-03: cutting the carry short at the budget released the old home while its copy container, which
    # outlives its Docker CLI, was still reading it. The browser stops waiting; the carry and its guard do not.
    finish = asyncio.Event()
    async def copy():
        await finish.wait()
        return {'profile': 'carried', 'files': 'carried'}
    machine, target, source, state, copies = await carry_rig(tmp_path, monkeypatch, copy)
    monkeypatch.setattr(carry, 'BUDGET_SECONDS', .05)
    await asyncio.wait_for(carry.before_browser(machine, target), 2)
    # The copy was announced before it began, so a later start knows its folder and counts the attempt.
    assert state[source.key] == {'status': 'failed', 'folder': 'Ada', 'attempts': 1}
    assert machine.maintenance and machine.locks[source.state_key].locked()
    # Another browser of this start, and the next start's first, begin no second carry while this one runs.
    await carry.before_browser(machine, target)
    machine.carry_attempted.clear()
    await carry.before_browser(machine, target)
    assert len(copies) == 1
    finish.set()
    await machine.carry_tasks[target.physical][0]
    assert state[source.key]['status'] == 'done'
    assert not machine.maintenance and not machine.locks[source.state_key].locked()


async def test_a_cancelled_browser_call_does_not_end_the_carry_but_the_core_closing_does(tmp_path, monkeypatch):
    started = asyncio.Event()
    async def copy():
        started.set()
        await asyncio.Event().wait()
    machine, target, source, state, copies = await carry_rig(tmp_path, monkeypatch, copy)
    waiting = asyncio.create_task(carry.before_browser(machine, target))
    await started.wait()
    waiting.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiting
    task = machine.carry_tasks[target.physical][0]
    assert not task.done() and machine.locks[source.state_key].locked()
    await machine.aclose(stop=False)
    assert task.done() and not machine.carry_tasks
    assert not machine.maintenance and not machine.locks[source.state_key].locked()


def helper_rig(tmp_path, monkeypatch, answer):
    machine = vm.LocalVm(tmp_path, runner=Runtime())
    source, target = machine.target_for('', 'a' * 16), machine.shared_target('', 1, 1)
    commands = []
    async def run_for(target, args, **kwargs):
        commands.append((args[0], args[1] if args[0] in ('kill', 'wait') else None, kwargs.get('timeout')))
        return await answer(args, len(commands))
    monkeypatch.setattr(machine, 'run_for', run_for)
    return machine, source, target, commands


SCAN = {'operation': 'scan', 'excluded': carry.EXCLUDE}


async def test_a_hung_helper_is_killed_by_name_before_its_error_is_raised(tmp_path, monkeypatch):
    # Measured: ending the Docker CLI leaves the container running. A helper out of time is hung, and nothing
    # else will ever end it; its home's guard is released only after the kill has answered.
    async def answer(args, count):
        if args[0] == 'run':
            raise TimeoutError
        return vm.Result(0, '')
    machine, source, target, commands = helper_rig(tmp_path, monkeypatch, answer)
    with pytest.raises(TimeoutError):
        await carry.helper(machine, source, target, SCAN)
    assert commands == [('run', None, carry.HELPER_SECONDS), ('kill', carry.helper_name(source), 15)]


async def test_a_closing_core_leaves_its_copy_to_finish_but_sees_a_kill_through(tmp_path, monkeypatch):
    # A killed copy leaves its staging folder in the workspace for good; a core that closes kills nothing.
    running = asyncio.Event()
    async def answer(args, count):
        running.set()
        await asyncio.Event().wait()
    machine, source, target, commands = helper_rig(tmp_path, monkeypatch, answer)
    work = asyncio.create_task(carry.helper(machine, source, target, SCAN))
    await running.wait()
    work.cancel()
    with pytest.raises(asyncio.CancelledError):
        await work
    assert [command[0] for command in commands] == ['run']
    # Second review, D2-02: a cancellation that arrives while a hung helper is being killed must not release the
    # home before the kill has answered.
    killing, killed, order = asyncio.Event(), asyncio.Event(), []
    async def slow_kill(args, count):
        if args[0] == 'run':
            raise TimeoutError
        killing.set()
        await killed.wait()
        order.append('kill answered')
        return vm.Result(0, '')
    machine, source, target, commands = helper_rig(tmp_path, monkeypatch, slow_kill)
    work = asyncio.create_task(carry.helper(machine, source, target, SCAN))
    await killing.wait()
    work.cancel()
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert not work.done()
    killed.set()
    with pytest.raises(asyncio.CancelledError):
        await work
    order.append('helper returned')
    assert order == ['kill answered', 'helper returned']


async def test_a_helper_an_earlier_core_left_running_is_waited_for_and_then_asked_once_more(tmp_path, monkeypatch):
    # Second review, D2-02: after a core died its copy may still be reading the old home under the same name.
    # The new core keeps that home's guard until it has ended; its folder is then found by its mark.
    async def answer(args, count):
        if args[0] == 'run':
            return vm.Result(125, '', 'name already in use') if count == 1 else vm.Result(0, '{"profile": "kept_existing"}')
        return vm.Result(0, '0')
    machine, source, target, commands = helper_rig(tmp_path, monkeypatch, answer)
    assert await carry.helper(machine, source, target, SCAN) == {'profile': 'kept_existing'}
    assert commands == [('run', None, carry.HELPER_SECONDS), ('wait', carry.helper_name(source), carry.HELPER_SECONDS),
                        ('run', None, carry.HELPER_SECONDS)]


@pytest.mark.parametrize('waiting', ['absent', 'hung', 'failed_again'])
async def test_a_helper_that_failed_is_not_retried_unless_another_was_seen_to_end(tmp_path, monkeypatch, waiting):
    async def answer(args, count):
        if args[0] == 'run':
            return vm.Result(1, '', 'copy failed')
        if args[0] == 'wait':
            if waiting == 'hung':
                raise TimeoutError
            return vm.Result(1 if waiting == 'absent' else 0, '', 'No such container')
        return vm.Result(0, '')
    machine, source, target, commands = helper_rig(tmp_path, monkeypatch, answer)
    with pytest.raises(vm.VmError, match='carry_failed'):
        await carry.helper(machine, source, target, SCAN)
    expected = {'absent': ['run', 'wait'], 'hung': ['run', 'wait', 'kill'], 'failed_again': ['run', 'wait', 'run']}
    assert [command[0] for command in commands] == expected[waiting]


async def test_a_closing_core_does_not_sit_out_another_cores_copy(tmp_path, monkeypatch):
    waiting = asyncio.Event()
    async def answer(args, count):
        if args[0] == 'run':
            return vm.Result(125, '', 'name already in use')
        waiting.set()
        await asyncio.Event().wait()
    machine, source, target, commands = helper_rig(tmp_path, monkeypatch, answer)
    work = asyncio.create_task(carry.helper(machine, source, target, SCAN))
    await waiting.wait()
    work.cancel()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(work, 2)
    assert [command[0] for command in commands] == ['run', 'wait']


async def test_every_browser_of_a_computer_waits_until_the_same_moment_and_another_computer_does_not_queue(tmp_path, monkeypatch):
    # Second review, D2-05: the lock was held for the whole wait, so a browser of another computer queued behind
    # it and then began a full budget of its own, past what browser_open allows.
    finish = asyncio.Event()
    async def copy():
        await finish.wait()
        return {'profile': 'carried', 'files': 'carried'}
    machine, target, source, state, copies = await carry_rig(tmp_path, monkeypatch, copy)
    monkeypatch.setattr(carry, 'BUDGET_SECONDS', .3)
    loop = asyncio.get_running_loop()
    began = loop.time()
    first = asyncio.create_task(carry.before_browser(machine, target))
    await asyncio.sleep(.15)
    assert not machine.carry_lock.locked()
    # A second seat's browser waits for what is left of the same budget, not for a budget of its own.
    await carry.before_browser(machine, machine.shared_target('', 2, 2))
    waited = loop.time() - began
    await first
    assert .25 < waited < .6 and len(copies) == 1
    # Once the moment has passed nobody waits, though the carry still runs.
    began = loop.time()
    await carry.before_browser(machine, target)
    assert loop.time() - began < .1 and not machine.carry_tasks[target.physical][0].done()
    finish.set()
    await machine.carry_tasks[target.physical][0]


async def test_shared_activity_is_not_old_activity_but_old_captured_activity_hold_and_lease_are_busy(tmp_path):
    machine = vm.LocalVm(tmp_path, runner=Runtime())
    old = machine.target_for('', machine.key_for('', 1))
    seat = machine.shared_target('', 1, 1)
    machine.targets[old.key] = seat
    machine.active[seat.key] = 1
    machine.physical_active[seat.physical] = 1
    assert not machine.carry_busy(old)
    machine.physical_active[old.physical] = 1
    assert machine.carry_busy(old)
    machine.physical_active[old.physical] = 0
    machine.hold(old, True)
    assert machine.carry_busy(old)
    machine.hold(old, False)
    machine.lease_targets[old.key] = old
    machine.busy = lambda key: True
    assert machine.carry_busy(old)


@pytest.mark.parametrize('failure', [False, True])
async def test_product_calls_capture_old_physical_activity_and_lease_until_their_work_finishes(per_bot_desktop, tmp_path, monkeypatch, failure):
    from raphael_core.computer.vm_tools import VmTools, vm_scope
    from raphael_core.services.attachment_store import AttachmentStore
    from .test_vm import EmptyHub
    machine, old, _ = per_bot_desktop
    hub = VmTools(EmptyHub(), machine, attachments=AttachmentStore(tmp_path))
    await hub.prepare()
    hub.scope_busy = lambda scope: True
    monkeypatch.setattr(hub, '_connection', AsyncMock(return_value=(object(), 'test-session')))
    monkeypatch.setattr(hub, '_refresh', lambda target: None)
    async def driver(target, client, name, args):
        assert machine.physical_active[old.physical] == 1
        machine.targets[old.key] = machine.shared_target('', 0, 1)
        assert machine.carry_busy(old)
        machine.targets[old.key] = old
        if failure:
            raise vm.VmError('bad_arguments')
        return {'content': [{'type': 'text', 'text': 'Found 0 windows:'}]}
    monkeypatch.setattr(hub, '_driver_call', driver)
    try:
        key = next(tool.key for tool in hub.offered() if tool.name == 'list_windows')
        with vm_scope(('turn', 0, 1)):
            result = await hub.call(key, {}, approver='auto')
        assert result.ok is not failure and machine.physical_active[old.physical] == 0
        assert machine.lease_targets[old.key] == old
        machine.targets[old.key] = machine.shared_target('', 0, 1)
        assert machine.carry_busy(old)
        hub.leases.clear()
        assert not machine.carry_busy(old)
    finally:
        await hub.aclose()


async def test_carry_failure_never_prevents_browser_and_per_bot_does_nothing(tmp_path, monkeypatch):
    machine = vm.LocalVm(tmp_path, runner=Runtime())
    carry_work = AsyncMock(side_effect=RuntimeError('synthetic journal unavailable'))
    monkeypatch.setattr(carry, 'carry', carry_work)
    await carry.before_browser(machine, machine.target(1))
    carry_work.assert_not_called()
    target = machine.shared_target('', 1, 1)
    async def run_for(target, args, **kwargs):
        assert 'raphael-seat-browser' in args
        return vm.Result(0, 'pid=1 window_id=2')
    monkeypatch.setattr(machine, 'run_for', run_for)
    assert await machine.seat_browser(target) == {'pid': 1, 'window_id': 2}
    assert carry_work.await_count == 1


@pytest.mark.parametrize('remote', ['', 'test-host'])
async def test_discovery_reads_only_this_owners_home_namespace(tmp_path, monkeypatch, remote):
    machine = vm.LocalVm(tmp_path, runner=Runtime())
    key = machine.key_for(remote, 1)
    if remote:
        prefix = 'raphael-computer-' + machine.owner + '-'
        run_for = AsyncMock(return_value=vm.Result(0, '\n'.join([
            prefix + key + '-workspace', prefix + 'shared-workspace',
            'raphael-computer-foreign-' + 'b' * 16 + '-workspace', prefix + 'bad-workspace'])))
        monkeypatch.setattr(machine, 'run_for', run_for)
    else:
        root = tmp_path / 'vm-homes'
        for folder in (key, 'shared', 'not-a-key'):
            (root / folder).mkdir(parents=True)
    result = await carry.candidates(machine, machine.shared_target(remote, 1, 1))
    assert [(source.key, source.remote) for source, name in result] == [(key, remote)]
    if remote:
        assert run_for.call_args.args[1] == ['volume', 'ls', '--filter', 'name=^' + prefix, '--format', '{{.Name}}']


async def test_cancelled_carry_releases_source_lifecycle_lock(tmp_path, monkeypatch):
    machine = vm.LocalVm(tmp_path, runner=Runtime())
    source = machine.target(1)
    entered = asyncio.Event()
    monkeypatch.setattr(carry, 'journal', AsyncMock(return_value={}))
    monkeypatch.setattr(carry, 'candidates', AsyncMock(return_value=[(source, 'Ada')]))
    async def inspect(source):
        entered.set()
        await asyncio.Event().wait()
    monkeypatch.setattr(machine, 'inspect', inspect)
    task = asyncio.create_task(carry.carry(machine, machine.shared_target('', 1, 1)))
    await entered.wait()
    assert machine.locks[source.state_key].locked()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not machine.maintenance and not machine.locks[source.state_key].locked()

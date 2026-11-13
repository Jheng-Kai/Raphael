"""Best-effort migration before a shared browser starts. No host-side file copying."""

import asyncio
import base64
from collections import Counter
import inspect
import json
import logging
import re
import shlex
import unicodedata

from . import carry_runtime
from .checkpoints import EXCLUDED
from .vm import VmError, exec_args

logger = logging.getLogger(__name__)
RECORD = '.raphael-carried.json'
EXCLUDE = sorted(EXCLUDED | {'.raphael-data', RECORD})
# The member's browser_open waits this long inside VmTools.browser_open_s (300 s), holding the computer's input
# lock. The carry itself is not cut short: it goes on behind the browser and keeps each old home's guard until that
# home's copy has ended.
BUDGET_SECONDS = 75
# One home's scan or copy. Ending a Docker CLI does not end its container (measured). A helper that runs out of this
# time is hung: it is killed by name before its home's guard is released. One whose core is closing is left to finish
# (a killed copy leaves its staging folder behind); the next core finds it by its name and waits for it.
HELPER_SECONDS = 1800
# A copy that fails the same way at every start must not be paid for at every start.
ATTEMPTS = 3


def helper_args(source, target, arguments):
    from .vm import IMAGE
    program = inspect.getsource(carry_runtime)
    script = 'python3 -c ' + shlex.quote(program) + ' ' + shlex.quote(json.dumps(arguments))
    return ['run', '--rm', '--network', 'none', '--user', '0', '--name', helper_name(source),
            '-v', str(source.workspace) + ':/from:ro', '-v', str(target.workspace) + ':/to',
            '--entrypoint', 'sh', IMAGE, '-c', script]


def helper_name(source):
    # Not the computers' own prefix: nothing that lists or removes computers by name may ever match a helper.
    return 'raphael-carry-' + source.name.removeprefix('raphael-computer-')


def folder_name(name, key, occupied):
    name = unicodedata.normalize('NFKC', name)
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name).strip(' .')[:80]
    # Leave room for a key within Linux's byte-counted filename limit.
    name = name.encode('utf-8')[:180].decode('utf-8', errors='ignore')
    if not name or name in ('.', '..') or name.startswith('.'):
        name = 'member'
    if re.fullmatch(r'CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]', name.split('.')[0], re.I):
        name = 'member-' + name
    if name.casefold() in {part.casefold() for part in occupied}:
        name += '-' + key
    # Never merge with an unknown pre-existing directory, including the keyed fallback.
    base, number = name, 2
    while name.casefold() in {part.casefold() for part in occupied}:
        name = base + '-' + str(number)
        number += 1
    return name


async def helper(vm, source, target, arguments):
    name = helper_name(source)
    for again in (False, True):
        try:
            result = await vm.run_for(target, helper_args(source, target, arguments), timeout=HELPER_SECONDS, limit=200000)
        except TimeoutError:
            await stopped(vm, source, target)
            raise
        if not result.code and not result.truncated:
            return json.loads(result.stdout)
        if again:
            break
        # The name may be held by a helper an earlier core left running: it is reading this home now. Keep the
        # guard until it has ended, then ask once more (its folder is found by its mark, nothing is copied twice).
        waited = await ended(vm, target, ['wait', name], HELPER_SECONDS)
        if waited is None:
            await stopped(vm, source, target)
        if not waited:
            break
    raise VmError('carry_failed')


async def stopped(vm, source, target):
    """End a hung helper by name. When it cannot be seen to have ended or to be absent, its home stays closed to its
    old computer for as long as this core lives (LocalVm.start answers busy): a reader may still be there."""
    name = helper_name(source)
    if await ended(vm, target, ['kill', name], 15):
        return
    try:
        seen = await vm.run_for(target, ['container', 'inspect', name], timeout=15, limit=4000)
        if seen.code and 'no such' in (seen.stdout + seen.stderr).lower():
            return
    except Exception:
        pass
    vm.carry_lost.add(source.state_key)
    logger.error('A carry helper could not be ended; its home stays closed to its old computer')


async def ended(vm, target, command, seconds):
    """Run the command that ends, or waits for the end of, a helper: True when a helper was there and has ended,
    False when the engine says otherwise (none by that name), None when the command itself did not answer.
    A kill is seen through even when its caller is cancelled meanwhile (then the caller is cancelled): the old
    home's guard must outlive its reader. A wait is not: a closing core does not sit out another's copy."""
    work = asyncio.ensure_future(vm.run_for(target, command, timeout=seconds))
    cancelled = False
    while not work.done():
        try:
            await asyncio.shield(work)
        except asyncio.CancelledError:
            if command[0] == 'wait':
                work.cancel()
                raise
            cancelled = True
        except Exception:
            break
    if cancelled:
        raise asyncio.CancelledError
    return None if work.exception() is not None else not work.result().code


async def journal(vm, target, record=None):
    # Core-generated journal data is written in the guest; the Linux copy never writes it.
    script = """import base64,json,pathlib,sys
root=pathlib.Path('/home/cua/workspace').resolve()
path=root/'.raphael-carried.json'
assert not path.is_symlink()
if len(sys.argv)==1:
 print(path.read_text() if path.exists() else '{}')
else:
 temporary=root/'.raphael-carried.tmp'
 assert not temporary.is_symlink()
 temporary.write_bytes(base64.b64decode(sys.argv[1]))
 temporary.replace(path)
"""
    args = ['python3', '-c', script]
    if record is not None:
        args.append(base64.b64encode(json.dumps(record).encode()).decode())
    result = await vm.run_for(target, exec_args(target, args), timeout=15, limit=200000)
    if result.code or result.truncated:
        raise VmError('carry_record_failed')
    return json.loads(result.stdout) if record is None else None


async def candidates(vm, target):
    host = target.remote
    names = {}
    if vm.data.conn is not None:
        names = {vm.key_for(host, member): name for member, name in vm.data.conn.execute('SELECT id, name FROM members')}
    names.setdefault(vm.key_for(host, 0), 'Raphael')
    keys = set()
    if host:
        prefix = f'raphael-computer-{vm.owner}-'
        result = await vm.run_for(target, ['volume', 'ls', '--filter', 'name=^' + prefix,
                                           '--format', '{{.Name}}'])
        if result.code or result.truncated:
            raise VmError('carry_discovery_failed')
        for volume in result.stdout.splitlines():
            match = re.fullmatch(re.escape(prefix) + r'([0-9a-f]{16})-workspace', volume)
            if match:
                keys.add(match[1])
    else:
        root = vm.root / 'vm-homes'
        if root.is_symlink():
            raise VmError('outside_workspace')
        keys.update(path.name for path in root.iterdir() if re.fullmatch(r'[0-9a-f]{16}', path.name)
                    and path.is_dir() and not path.is_symlink())
    return [(vm.target_for(host, key), names.get(key, 'member-' + key)) for key in sorted(keys)
            if re.fullmatch(r'[0-9a-f]{16}', key)]


async def carry(vm, target):
    record = await journal(vm, target)
    sources, held = [], []
    try:
        for source, name in await candidates(vm, target):
            prior = record.get(source.key, {})
            if prior.get('status') in ('done', 'left_in_place'):
                continue
            if prior.get('status') == 'failed' and prior.get('attempts', 0) >= ATTEMPTS:
                record[source.key] = {**prior, 'status': 'left_in_place', 'reason': 'failed'}
                continue
            try:
                vm.validate_storage(source)
                lock = vm.locks.setdefault(source.state_key, asyncio.Lock())
                if (vm.carry_busy(source)
                        or source.state_key in vm.maintenance or lock.locked()):
                    record[source.key] = {**record.get(source.key, {}), 'status': 'deferred', 'reason': 'busy'}
                    continue
                vm.maintenance[source.state_key] = asyncio.current_task()
                await lock.acquire()
                held.append((source, lock))
                if source.remote:
                    volume = await vm.run_for(source, ['volume', 'inspect', str(source.workspace)], limit=4000)
                    if volume.code:
                        raise VmError('carry_source_missing')
                raw = await vm.inspect(source)
                if raw:
                    from .vm import compatible, known_previous
                    if not (compatible(raw, source, vm.owner, raw.get('Image')) or known_previous(raw, source, vm.owner)):
                        raise VmError('incompatible')
                    if raw.get('State', {}).get('Running'):
                        if vm.carry_busy(source):
                            record[source.key] = {**record.get(source.key, {}), 'status': 'deferred', 'reason': 'busy'}
                            continue
                        # Seat and historical per-bot keys are identical. Do not stop/disconnect the shared
                        # seat using the key-scoped lifecycle guards; the captured physical source is guarded above.
                        stopped = await vm.run_for(source, ['stop', '--time', '10', source.name], timeout=30)
                        if stopped.code:
                            raise VmError('stop_failed')
                        vm.invalidate(source)
                        await vm.close_viewer(source)
                info = await helper(vm, source, target, {'operation': 'scan', 'excluded': EXCLUDE})
                sources.append((source, name, info))
            except Exception as error:
                record[source.key] = {**record.get(source.key, {}), 'status': 'failed', 'reason': type(error).__name__}
                logger.warning('A computer home carry is deferred (%s)', type(error).__name__)
        occupied = {name for _, _, info in sources for name in info['folders']}
        names = Counter(folder_name(name, source.key, set()).casefold() for source, name, _ in sources)
        selected = max((row for row in sources if row[2]['profile']), key=lambda row: row[2]['cookies'], default=None)
        profile_exists = any(info['destination_profile'] for _, _, info in sources)
        # Sign-ins first: once the browser has started with an empty profile, none is ever carried.
        sources.sort(key=lambda row: row is not selected)
        for source, name, info in sources:
            prior = record.get(source.key, {})
            # A failed copy can have published its files before a later dataset/profile step failed.
            base = folder_name(name, source.key, set())
            taken = occupied | {base} if names[base.casefold()] > 1 else occupied
            folder = prior.get('folder') or folder_name(name, source.key, taken)
            arguments = {'operation': 'copy', 'key': source.key, 'folder': folder, 'excluded': EXCLUDE,
                         'profile': not profile_exists and selected is not None and selected[0] == source}
            record[source.key] = {'status': 'failed', 'folder': folder, 'attempts': prior.get('attempts', 0) + 1}
            await journal(vm, target, record)
            try:
                result = await helper(vm, source, target, arguments)
                record[source.key] = {'status': 'done', **result}
                profile_exists |= result['profile'] in ('carried', 'kept_existing')
                occupied.add(folder)
            except Exception as error:
                record[source.key]['reason'] = type(error).__name__
                logger.warning('A computer home carry failed (%s)', type(error).__name__)
            await journal(vm, target, record)
        await journal(vm, target, record)
    finally:
        for source, lock in held:
            if source.state_key not in vm.carry_lost:
                vm.maintenance.pop(source.state_key, None)
            lock.release()


async def before_browser(vm, target):
    if target.container != 'shared':
        return
    loop = asyncio.get_running_loop()
    async with vm.carry_lock:
        running = vm.carry_tasks.get(target.physical)
        if running is None or running[0].done():
            if target.physical in vm.carry_attempted:
                return
            vm.carry_attempted.add(target.physical)

            async def work():
                try:
                    await carry(vm, target)
                except Exception as error:
                    logger.warning('Shared computer carry could not finish (%s)', type(error).__name__)

            running = vm.carry_tasks[target.physical] = asyncio.create_task(work()), loop.time()
    # Every browser of this computer waits for the same carry until the same moment, so none starts on an empty
    # profile while the sign-ins are still on their way; after that moment none waits. The lock is not held here:
    # another computer's browser has its own carry and its own budget. Neither the budget nor a cancelled browser
    # call ends the carry: asyncio.wait leaves the task running.
    task, started = running
    remaining = started + BUDGET_SECONDS - loop.time()
    if remaining > 0 and not task.done():
        done, _ = await asyncio.wait({task}, timeout=remaining)
        if not done:
            logger.warning('Shared computer carry goes on behind its browser')

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
# The member's browser_open waits for this inside CuaBridge.read_timeout_s (120 s), holding the computer's input lock.
# A copy the budget cuts short goes on by itself in its container; the next start finds its folder and finishes.
BUDGET_SECONDS = 75
# A copy that fails the same way at every start must not be paid for at every start.
ATTEMPTS = 3


def helper_args(source, target, arguments):
    from .vm import IMAGE
    program = inspect.getsource(carry_runtime)
    script = 'python3 -c ' + shlex.quote(program) + ' ' + shlex.quote(json.dumps(arguments))
    return ['run', '--rm', '--network', 'none', '--user', '0',
            '-v', str(source.workspace) + ':/from:ro', '-v', str(target.workspace) + ':/to',
            '--entrypoint', 'sh', IMAGE, '-c', script]


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
    result = await vm.run_for(target, helper_args(source, target, arguments), timeout=180, limit=200000)
    if result.code or result.truncated:
        raise VmError('carry_failed')
    return json.loads(result.stdout)


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
            vm.maintenance.pop(source.state_key, None)
            lock.release()


async def before_browser(vm, target):
    if target.container != 'shared':
        return
    async with vm.carry_lock:
        if target.physical in vm.carry_attempted:
            return
        vm.carry_attempted.add(target.physical)
        try:
            async with asyncio.timeout(BUDGET_SECONDS):
                await carry(vm, target)
        except Exception as error:
            logger.warning('Shared computer carry could not finish (%s)', type(error).__name__)

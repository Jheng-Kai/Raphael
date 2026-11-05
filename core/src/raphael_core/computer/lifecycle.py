"""Owner maintenance and bounded disk readings for one captured computer."""

import asyncio
from pathlib import Path

from .vm import GUEST, SOCKET, VmError, compatible, exec_args


async def repair_connection(vm, target):
    """Repair before dispatch only; never replay an uncertain action."""
    if target.key in vm.held or vm.active.get(target.key, 0) > 1 or vm.busy(target.key) and not vm.active.get(target.key):
        raise VmError("busy")
    if not vm.repair_admit(target):
        raise VmError("repair_failed")
    before = vm.repair_revisions.get(target.key, 0)
    state = await vm.status(target, probe=False)
    if state["state"] == "stopped":
        vm.invalidate(target)
        await vm.start(target)
    elif state["state"] == "running":
        socket = await vm.run_for(target, exec_args(target, ["test", "-S", SOCKET]), timeout=5)
        if socket.code:
            # A compatible computer's missing driver socket is fixed by its supervisor
            # on restart. This changes no image, workspace, volume or other computer.
            if (await vm.run_for(target, ["restart", "--time", "10", target.name], timeout=60)).code:
                raise VmError("start_failed")
            vm.invalidate(target)
            vm.changes += 1
            await vm.start(target)
    else:
        raise VmError(state["state"])
    await vm.close_viewer(target)
    if vm.repair_revisions.get(target.key, 0) == before:
        vm.record_repair(target)


async def maintain(vm, target, action, *, confirmed=False):
    if action not in ("restart", "update", "repair", "reset"):
        raise VmError("bad_arguments")
    if action == "reset" and confirmed is not True:
        raise VmError("confirmation_required")
    if target.key in vm.maintenance:
        raise VmError("busy")
    vm.maintenance[target.key] = asyncio.current_task()
    vm.lifecycle[target.key] = "updating" if action == "update" else "repairing" if action == "repair" else "waking"
    vm.changes += 1
    try:
        if vm.active.get(target.key) or target.key in vm.held or vm.busy(target.key) or target.key in vm.preparing and not vm.preparing[target.key].done():
            raise VmError("busy")
        raw = await vm.inspect(target)
        if raw and not compatible(raw, target, vm.owner, raw.get("Image")):
            raise VmError("incompatible")
        # Validate the exact workspace before stopping or removing anything.
        workspace = Path(target.workspace) if not target.remote else None
        if action == "reset":
            if target.remote:
                if str(target.workspace) != target.name + "-workspace":
                    raise VmError("outside_workspace")
            else:
                root = vm.root / "vm-homes"
                if root.is_symlink() or root.resolve() != root or workspace.is_symlink() or workspace.resolve() != root / target.key:
                    raise VmError("outside_workspace")
        await vm.disconnect_driver(target.key)
        # stop() validates ownership, mount identity and busy/hold again.
        await vm.stop(target, remove=action != "restart", captured_image=raw.get("Image") if raw else None)
        if action == "reset":
            if target.remote:
                if (await vm.run_for(target, ["volume", "rm", str(target.workspace)])).code:
                    raise VmError("workspace_remove_failed")
            elif workspace.exists():
                import shutil
                if root.is_symlink() or root.resolve() != root or workspace.is_symlink() or workspace.resolve() != root / target.key:
                    raise VmError("outside_workspace")
                await asyncio.to_thread(shutil.rmtree, workspace)
            vm.disk_warned.discard(target)
        vm.invalidate(target)
        return await vm.start(target)
    finally:
        vm.maintenance.pop(target.key, None)
        vm.lifecycle.pop(target.key, None)
        vm.changes += 1


async def disk_pressure(vm, target):
    """Read only, once per pressure episode, with a five-minute probe interval."""
    now = vm.clock()
    if now - vm.disk_checked.get(target, float("-inf")) < 300:
        return None
    vm.disk_checked[target] = now
    result = await vm.run_for(target, exec_args(target, ["timeout", "--signal=TERM", "--kill-after=1", "4", "df", "-Pk", "/", GUEST]), timeout=5, limit=4000)
    if result.code or result.truncated:
        return None
    percentages = []
    for line in result.stdout.splitlines()[1:]:
        columns = line.split()
        if len(columns) >= 6 and columns[-2].endswith("%"):
            try:
                percentages.append(int(columns[-2][:-1]))
            except ValueError:
                pass
    if not percentages:
        return None
    if max(percentages) < 90:
        vm.disk_warned.discard(target)
        return None
    if target in vm.disk_warned:
        return None
    sizes = await vm.run_for(target, exec_args(target, ["timeout", "--signal=TERM", "--kill-after=1", "4", "du", "-x", "-k", "--max-depth=1", GUEST, "/home/cua/.cache"]), timeout=5, limit=8000)
    folders = []
    for line in sizes.stdout.splitlines() if not sizes.truncated else []:
        size, separator, path = line.partition("\t")
        if separator and size.isdecimal() and (path.startswith(GUEST + "/") or path == "/home/cua/.cache"):
            folders.append((int(size), path))
    if not folders:
        return None  # Retry the bounded folder reading later; never invent sizes.
    vm.disk_warned.add(target)
    return sorted(folders, reverse=True)[:3]

"""Owner maintenance and bounded disk readings for one captured computer."""

import asyncio
from dataclasses import dataclass
from pathlib import Path

from .vm import GUEST, SOCKET, VmError, compatible, exec_args, known_previous


async def repair_connection(vm, target):
    """Repair before dispatch only; never replay an uncertain action."""
    def guard():
        if (vm.unit_held(target) or vm.unit_active(target) > 1
                or vm.unit_active(target, excluding=target.key) or vm.unit_busy(target, excluding=target.key)
                or vm.unit_busy(target) and not vm.unit_active(target)):
            raise VmError("busy")

    guard()
    key = target.state_key
    owned = target.container and key not in vm.maintenance
    if target.container:
        if key in vm.maintenance and vm.maintenance[key] is not asyncio.current_task():
            raise VmError("busy")
        vm.maintenance[key] = asyncio.current_task()
    try:
        if not vm.repair_admit(target):
            raise VmError("repair_failed")
        before = vm.repair_revisions.get(target.state_key, 0)
        state = await vm.status(target, probe=False)
        if state["state"] == "stopped":
            vm.invalidate(target)
            await vm.start(target)
        elif state["state"] == "running":
            socket = await vm.run_for(target, exec_args(target, ["test", "-S", SOCKET]), timeout=5)
            if socket.code:
                if target.container:
                    guard()
                    await vm.disconnect_unit(target)
                    guard()
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
        if vm.repair_revisions.get(target.state_key, 0) == before:
            vm.record_repair(target)
    finally:
        if owned:
            vm.maintenance.pop(key, None)


async def maintain(vm, target, action, *, confirmed=False):
    if action not in ("restart", "update", "repair", "reset"):
        raise VmError("bad_arguments")
    if action == "reset" and confirmed is not True:
        raise VmError("confirmation_required")
    if target.state_key in vm.maintenance:
        raise VmError("busy")
    vm.maintenance[target.state_key] = asyncio.current_task()
    vm.lifecycle[target.state_key] = "updating" if action == "update" else "repairing" if action == "repair" else "waking"
    vm.changes += 1
    try:
        if vm.unit_active(target) or vm.unit_held(target) or vm.unit_busy(target) or target.state_key in vm.preparing and not vm.preparing[target.state_key].done():
            raise VmError("busy")
        raw = await vm.inspect(target)
        if raw and not (compatible(raw, target, vm.owner, raw.get("Image")) or known_previous(raw, target, vm.owner)):
            raise VmError("incompatible")
        # Validate the exact workspace before stopping or removing anything.
        workspace = Path(target.workspace) if not target.remote else None
        if action == "reset":
            if target.remote:
                if str(target.workspace) != target.name + "-workspace":
                    raise VmError("outside_workspace")
            else:
                root = vm.root / "vm-homes"
                if root.is_symlink() or root.resolve() != root or workspace.is_symlink() or workspace.resolve() != root / target.unit:
                    raise VmError("outside_workspace")
        await vm.disconnect_unit(target)
        # stop() validates ownership, mount identity and busy/hold again.
        await vm.stop(target, remove=action != "restart", captured_image=raw.get("Image") if raw else None)
        if action == "reset":
            if target.remote:
                if (await vm.run_for(target, ["volume", "rm", str(target.workspace)])).code:
                    raise VmError("workspace_remove_failed")
            elif workspace.exists():
                import shutil
                if root.is_symlink() or root.resolve() != root or workspace.is_symlink() or workspace.resolve() != root / target.unit:
                    raise VmError("outside_workspace")
                await asyncio.to_thread(shutil.rmtree, workspace)
            vm.disk_warned.discard(target.physical)
        vm.invalidate(target)
        return await vm.start(target)
    finally:
        vm.maintenance.pop(target.state_key, None)
        vm.lifecycle.pop(target.state_key, None)
        vm.changes += 1


# What the computer's own folders must hold before cleaning them is worth offering as the way to free a disk.
FOLDERS_MATTER_KIB = 1024 * 1024


@dataclass(frozen=True)
class DiskPressure:
    """Which disk is nearly full and what the computer's own folders have to do with it. `disk` is "computer" for the
    container's own disk (`/`) and "files" for the one its workspace is kept on: a folder of this PC (`C:`) or a
    remote host's volume. A computer whose workspace is on this PC's C: reads that drive's use, not its own."""
    disk: str
    filesystem: str
    percent: int
    free_kib: int
    folders: list
    own_kib: int

    @property
    def folders_matter(self):
        return self.own_kib >= FOLDERS_MATTER_KIB


def _disk_rows(output):
    """(filesystem, percent used, free KiB) of each line `df -Pk` printed, in the order its paths were given."""
    rows = []
    for line in output.splitlines()[1:]:
        columns = line.split()
        if len(columns) >= 6 and columns[-2].endswith("%"):
            try:
                rows.append((columns[0], int(columns[-2][:-1]), int(columns[-3])))
            except ValueError:
                pass
    return rows


async def disk_pressure(vm, target):
    """Read only, once per pressure episode, with a five-minute probe interval. The disk named is the one that is at
    90 percent: the computer's own, or the one holding its workspace (owner, 2026-11-14: a PC whose C: was at 94 percent
    was told the computer's few hundred MiB of folders were what filled it)."""
    now = vm.clock()
    if now - vm.disk_checked.get(target.physical, float("-inf")) < 300:
        return None
    vm.disk_checked[target.physical] = now
    result = await vm.run_for(target, exec_args(target, ["timeout", "--signal=TERM", "--kill-after=1", "4", "df", "-Pk", "/", GUEST]), timeout=5, limit=4000)
    if result.code or result.truncated:
        return None
    rows = _disk_rows(result.stdout)
    if not rows:
        return None
    own = rows[0]
    files = rows[1] if len(rows) > 1 and rows[1][0] != own[0] else None
    full = next((("computer" if row is own else "files", row) for row in (own, files) if row and row[1] >= 90), None)
    if full is None:
        vm.disk_warned.discard(target.physical)
        return None
    if target.physical in vm.disk_warned:
        return None
    sizes = await vm.run_for(target, exec_args(target, ["timeout", "--signal=TERM", "--kill-after=1", "4", "du", "-x", "-k", "--max-depth=1", GUEST, "/home/cua/.cache"]), timeout=5, limit=8000)
    folders, workspace = [], None
    for line in sizes.stdout.splitlines() if not sizes.truncated else []:
        size, separator, path = line.partition("\t")
        if separator and size.isdecimal() and (path.startswith(GUEST + "/") or path == "/home/cua/.cache"):
            folders.append((int(size), path))
        elif separator and size.isdecimal() and path == GUEST:
            workspace = int(size)
    if not folders:
        return None  # Retry the bounded folder reading later; never invent sizes.
    vm.disk_warned.add(target.physical)
    kind, (filesystem, percent, free) = full
    # A drive's name is its letter: `C:\` is shown as `C:`.
    return DiskPressure(kind, filesystem.rstrip("\\"), percent, free, sorted(folders, reverse=True)[:3],
                        workspace if workspace is not None else sum(size for size, _ in folders))

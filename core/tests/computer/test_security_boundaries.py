"""Hostile filesystem and delayed permission changes, using only temporary data."""

import os
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from raphael_core.computer.viewer import DesktopViewer
from raphael_core.computer.vm import VmError
from raphael_core.computer.vm_tools import VmTools, vm_scope
from raphael_core.background.tasks import TaskStore
from raphael_core.members.panel import snapshot
from raphael_core.protocol import RpcError
from raphael_core.services.attachment_store import AttachmentStore
from .test_vm import desktop, EmptyHub  # noqa: F401


def directory_link(source, destination):
    if os.name == "nt":
        import _winapi
        _winapi.CreateJunction(str(source), str(destination))
    else:
        destination.symlink_to(source, target_is_directory=True)


@pytest.mark.parametrize("area", ["workspace", "shared", "parent"])
async def test_start_refuses_redirected_mount_roots(desktop, tmp_path, area):
    vm, target, runtime = desktop
    outside = tmp_path / "owner-files"
    outside.mkdir()
    redirected = target.workspace if area == "workspace" else target.shared if area == "shared" else target.workspace.parent
    redirected.parent.mkdir(parents=True, exist_ok=True)
    directory_link(outside, redirected)
    runtime.raw = None
    async def reject_dispatch(args, **kwargs):
        if args[0] in ("run", "start"):
            raise VmError("unsafe_dispatch")
        return await runtime(args, **kwargs)
    vm.run = reject_dispatch
    with pytest.raises(VmError, match="outside_workspace"):
        await vm.start(target)
    assert not any(args[0] in ("run", "start") for args, _ in runtime.calls)


@pytest.mark.parametrize("handle", ["/home/cua/team/private.txt", "member-file:0:team:private.txt", "member-file:0:workspace:private.txt"])
async def test_team_file_rejects_a_redirected_root(desktop, tmp_path, handle):
    vm, target, _ = desktop
    outside = tmp_path / "owner-files"
    outside.mkdir()
    (outside / "private.txt").write_text("owner-only", encoding="utf-8")
    root = target.workspace if ":workspace:" in handle else target.shared
    root.parent.mkdir(parents=True, exist_ok=True)
    directory_link(outside, root)
    viewer = DesktopViewer(vm)
    try:
        with pytest.raises(RpcError):
            await viewer.team_file({"path": handle})
    finally:
        await viewer.aclose()


def test_library_does_not_scan_a_redirected_root(conn, tmp_path):
    outside, root = tmp_path / "owner-files", tmp_path / "workspace"
    outside.mkdir()
    (outside / "private.txt").write_text("owner-only", encoding="utf-8")
    directory_link(outside, root)
    assert snapshot(conn, 0, [("workspace", root)])["files"] == []


def test_artifact_receipts_cannot_authorize_a_redirected_workspace(conn, tmp_path):
    store = TaskStore(conn)
    task = store.create(session_id="security", language="en", text="Write a file")
    root, outside = tmp_path / "workspace", tmp_path / "owner-files"
    root.mkdir()
    outside.mkdir()
    file = root / "result.txt"
    file.write_bytes(b"same known bytes")
    store.verify_artifact(task, "file", file, workspace=root, mime="text/plain")
    evidence = store.evidence(task)[0]["id"]
    root.rename(tmp_path / "old-workspace")
    (outside / "result.txt").write_bytes(b"same known bytes")
    directory_link(outside, root)
    assert store.artifact_path(task, evidence) is None
    with pytest.raises(ValueError):
        store.verify_artifact(task, "redirected", root / "result.txt", workspace=root, mime="text/plain")


def test_artifact_admission_bounds_bytes_before_hashing(conn, tmp_path):
    store = TaskStore(conn)
    task = store.create(session_id="security", language="en", text="Write a file")
    file = tmp_path / "oversized.bin"
    with file.open("wb") as stream:
        stream.truncate(50 * 1024 * 1024 + 1)
    with pytest.raises(ValueError):
        store.verify_artifact(task, "file", file, workspace=tmp_path, mime="application/octet-stream")
    assert not store.evidence(task)


def test_artifact_growth_after_stat_cannot_bypass_the_read_budget(conn, tmp_path, monkeypatch):
    store = TaskStore(conn)
    task = store.create(session_id="security", language="en", text="Write a file")
    file = tmp_path / "growing.bin"
    file.write_bytes(b"small at stat")
    original = Path.open
    def grow_before_read(path, mode="r", *args, **kwargs):
        if path == file and mode == "rb":
            with original(file, "ab") as stream:
                stream.truncate(50 * 1024 * 1024 + 1)
        return original(path, mode, *args, **kwargs)
    monkeypatch.setattr(Path, "open", grow_before_read)
    with pytest.raises(ValueError):
        store.verify_artifact(task, "file", file, workspace=tmp_path, mime="application/octet-stream")
    assert not store.evidence(task)


@pytest.mark.parametrize("stage,name,arguments", [
    ("start", "vm_exec", {"command": "echo allowed"}),
    ("start", "attach_file", {"path": "/home/cua/workspace/a.txt"}),
    ("checkpoint", "vm_exec", {"command": "echo allowed"}),
])
@pytest.mark.parametrize("change", ["owner_hold", "target"])
async def test_a_change_during_preparation_prevents_file_and_command_dispatch(desktop, tmp_path, stage, name, arguments, change):
    vm, target, _ = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path))
    await hub.prepare()
    tools = {tool.name: tool.key for tool in hub.offered()}
    async def revoke(*args, **kwargs):
        if change == "owner_hold":
            vm.hold(target, True)
        else:
            vm.settings.set("computer_vm_mode", "per-bot")
    vm.start = AsyncMock(side_effect=revoke if stage == "start" else None)
    hub._disk_notice = AsyncMock()
    hub._checkpoint = AsyncMock(side_effect=revoke if stage == "checkpoint" else None)
    vm.execute, vm.read_file = AsyncMock(return_value={}), AsyncMock(return_value=b"owner data")
    try:
        with vm_scope(("turn", 0, 7), turn_id=7):
            result = await hub.call(tools[name], arguments, approver="auto")
        assert not result.ok
        assert result.kind == ("owner_holds_control" if change == "owner_hold" else "computer_changed")
        vm.execute.assert_not_awaited()
        vm.read_file.assert_not_awaited()
    finally:
        await hub.aclose()

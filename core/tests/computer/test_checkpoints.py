from pathlib import Path

from raphael_core.computer.checkpoints import CheckpointStore
from .test_vm import desktop, Bridge, EmptyHub


async def test_full_permission_restores_without_confirmation_but_revocation_still_refuses(desktop, conn):
    from raphael_core.brain.settings import SettingsStore
    from raphael_core.computer.grants import ComputerGrants
    from raphael_core.computer.checkpoint_service import Checkpoints
    from raphael_core.protocol import RpcError
    import pytest
    vm, _, _ = desktop
    vm.grants = ComputerGrants(conn)
    SettingsStore(conn).set("action_mode", "bypass")
    service = Checkpoints(vm, lambda member: member == 2)
    assert (await service.call({"member_id": 2}))["confirmation_required"] is False
    await service.call({"member_id": 2, "action": "restore", "id": "1" * 32})
    vm.grants.set(2, False)
    with pytest.raises(RpcError):
        await service.call({"member_id": 2, "action": "restore", "id": "1" * 32})


async def test_workspace_commands_take_the_guest_checkpoint_path(desktop, tmp_path):
    from raphael_core.computer.vm_tools import VmTools, vm_scope
    from raphael_core.services.attachment_store import AttachmentStore
    vm, target, runtime = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare()
    tool = next(item for item in hub.offered() if item.name == "vm_exec")
    with vm_scope(("turn", 0, 7), turn_id=7):
        assert (await hub.call(tool.key, {"command": "echo changed > report.txt"}, approver="auto")).ok
    commands = [args[-1] for args, _ in runtime.calls if "-lc" in args]
    assert commands and commands[0] == "cd /home/cua/workspace && echo changed > report.txt"
    assert any("class CheckpointStore" in str(args) for args, _ in runtime.calls)


async def test_checkpoint_internals_do_not_shorten_the_members_command_budget(desktop, tmp_path):
    from raphael_core.computer.vm_tools import VmTools, vm_scope
    from raphael_core.services.attachment_store import AttachmentStore
    vm, _, _ = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare()
    tool = next(item for item in hub.offered() if item.name == "vm_exec")
    with vm_scope(("turn", 0, 7), turn_id=7):
        result = await hub.call(tool.key, {"command": "true #" + "x" * 15000}, approver="auto")
    assert result.ok


def test_a_read_only_operation_leaves_no_checkpoint_and_changes_can_be_reviewed_and_restored(tmp_path):
    work, team, archive = (tmp_path / name for name in ("workspace", "team", "archive"))
    work.mkdir(); team.mkdir()
    file = work / "report.txt"
    file.write_text("before")
    store = CheckpointStore(archive, [work, team])
    ticket = store.begin(member=2, turn=7)
    assert store.list(member=2) == []
    file.write_text("after")
    (team / "new.txt").write_text("new")
    checkpoint = ticket
    view = store.list(member=2)[0]
    assert view["id"] == checkpoint and len(view["files"]) == 2 and "before" in view["files"][0]["diff"]
    result = store.restore(checkpoint, member=2)
    assert len(result["restored"]) == 2 and file.read_text() == "before" and not (team / "new.txt").exists()


def test_restore_preserves_later_owner_changes_and_refuses_another_member(tmp_path):
    root = tmp_path / "workspace"; root.mkdir()
    file = root / "a.txt"; file.write_text("original")
    store = CheckpointStore(tmp_path / "archive", [root])
    ticket = store.begin(member=2, turn=7)
    file.write_text("member")
    checkpoint = ticket
    store.list(member=2)
    file.write_text("owner later")
    assert store.restore(checkpoint, member=2)["skipped"] == [str(file)]
    assert file.read_text() == "owner later"
    import pytest
    with pytest.raises(ValueError):
        store.restore(checkpoint, member=3)


async def test_restore_is_an_owner_action_and_refuses_active_work():
    from types import SimpleNamespace
    import pytest
    from raphael_core.computer.checkpoint_service import Checkpoints
    from raphael_core.protocol import RpcError
    calls = []
    async def checkpoint(*args, **kwargs): calls.append((args, kwargs)); return []
    vm = SimpleNamespace(target=lambda _: SimpleNamespace(key="one"), grants=SimpleNamespace(allowed=lambda _: True, full_permission=lambda: False),
                         active={"one": 1}, busy=lambda _: False, checkpoint=checkpoint)
    service = Checkpoints(vm, lambda member: member == 2)
    with pytest.raises(RpcError): await service.call({"member_id": 2, "action": "restore", "id": "1" * 32})
    with pytest.raises(RpcError): await service.call({"member_id": 2, "action": "restore", "id": "1" * 32, "confirmed": True})
    assert not calls
    assert (await service.call({"member_id": 2}))["busy"] is True
    vm.active.clear()
    await service.call({"member_id": 2, "action": "restore", "id": "1" * 32, "confirmed": True})
    assert calls[-1][1] == {"id": "1" * 32, "member": 2}


def test_a_forged_restore_path_cannot_change_anything_outside_the_workspace(tmp_path):
    import json
    root = tmp_path / "work"; root.mkdir()
    file = root / "a"; file.write_text("before")
    outside = tmp_path / "owner.txt"; outside.write_text("owner")
    store = CheckpointStore(tmp_path / "archive", [root])
    ticket = store.begin(member=2, turn=7); file.write_text("after"); store.list(member=2)
    path = store.archive / (ticket + ".json")
    data = json.loads(path.read_text()); data["review"][0]["path"] = str(outside); path.write_text(json.dumps(data))
    assert store.restore(ticket, member=2)["skipped"] == [str(outside)]
    assert outside.read_text() == "owner"


def test_background_work_has_no_pending_state_and_later_changes_are_kept(tmp_path):
    root = tmp_path / "work"; root.mkdir()
    file = root / "a"; file.write_text("before")
    store = CheckpointStore(tmp_path / "archive", [root])
    ticket = store.begin(member=2, turn=7)
    file.write_text("after"); store.list(member=2)
    store.begin(member=2, turn=8)
    file.write_text("background update")
    assert store.restore(ticket, member=2)["skipped"] == [str(file)]
    assert file.read_text() == "background update"

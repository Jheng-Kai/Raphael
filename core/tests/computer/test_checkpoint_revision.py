"""Checkpoints are an optional archive, never a prerequisite for ordinary work."""

import json

import pytest

from raphael_core.computer.checkpoints import CheckpointStore
from raphael_core.computer.vm_tools import VmTools, vm_scope
from raphael_core.services.attachment_store import AttachmentStore
from .test_vm import desktop, Bridge, EmptyHub


@pytest.mark.parametrize("failure", ["large", "many", "broken", "timeout"])
async def test_archive_failure_never_stops_a_command(desktop, tmp_path, failure):
    vm, target, runtime = desktop
    root = tmp_path / "work"; root.mkdir()
    if failure == "large":
        with (root / "video.mp4").open("wb") as stream:
            stream.truncate(60 * 1024**2)
    if failure == "many":
        for index in range(5000):
            (root / str(index)).touch()
    store = CheckpointStore(tmp_path / "archive", [root])
    async def checkpoint(*args, **kwargs):
        if failure == "broken":
            raise OSError("archive unavailable")
        if failure == "timeout":
            raise TimeoutError()
        return store.begin(member=kwargs["member"], turn=kwargs["turn"])
    vm.checkpoint = checkpoint
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare()
    tool = next(item for item in hub.offered() if item.name == "vm_exec")
    with vm_scope(("turn", 0, 7), turn_id=7):
        result = await hub.call(tool.key, {"command": "echo changed > report.txt"}, approver="auto")
    assert result.ok
    assert any(args[-1].endswith("echo changed > report.txt") and "CheckpointStore" not in args[-1]
               for args, _ in runtime.calls if "-lc" in args)


async def test_one_bounded_snapshot_per_turn_and_no_gesture_snapshot(desktop, tmp_path):
    vm, _, _ = desktop
    calls = []
    async def checkpoint(*args, **kwargs): calls.append((args, kwargs))
    vm.checkpoint = checkpoint
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare()
    with vm_scope(("turn", 0, 7), turn_id=7):
        command = next(item for item in hub.offered() if item.name == "vm_exec")
        for text in ("pwd", "echo one > a", "echo two >> a"):
            assert (await hub.call(command.key, {"command": text}, approver="auto")).ok
        screen = next(item for item in hub.offered() if item.name == "get_desktop_state")
        assert (await hub.call(screen.key, {}, approver="auto")).ok
        click = next(item for item in hub.offered() if item.name == "click")
        assert (await hub.call(click.key, {"x": 1, "y": 1}, approver="auto")).ok
    assert len(calls) == 1 and calls[0][1] == {"member": 0, "turn": 7}
    with vm_scope(("turn", 0, 8), turn_id=8):
        assert (await hub.call(command.key, {"command": "echo next > a"}, approver="auto")).ok
    assert len(calls) == 2


@pytest.mark.parametrize("background", [False, True])
async def test_original_command_bytes_reach_the_original_executor(desktop, tmp_path, background):
    vm, _, runtime = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare()
    tool = next(item for item in hub.offered() if item.name == "vm_exec")
    command = "printf '%s\\n' 'a; b' > result.txt & wait"
    with vm_scope(("turn", 0, 7), turn_id=7):
        assert (await hub.call(tool.key, {"command": command, "background": background}, approver="auto")).ok
    expected = "cd /home/cua/workspace && " + command
    assert any(expected in args for args, _ in runtime.calls)
    assert not any("signal.signal" in str(args) for args, _ in runtime.calls)
    snapshots = [kwargs for args, kwargs in runtime.calls if any("class CheckpointStore" in arg for arg in args)]
    assert len(snapshots) == 1 and snapshots[0]["timeout"] <= 12


def test_unchanged_manifests_reuse_objects_without_reading_files(tmp_path, monkeypatch):
    root = tmp_path / "work"; root.mkdir()
    file = root / "a"; file.write_text("original")
    store = CheckpointStore(tmp_path / "archive", [root])
    first = store.begin(member=2, turn=7)
    assert store.list(member=2) == []
    def unexpected(*_args, **_kwargs): raise AssertionError("unchanged contents read twice")
    monkeypatch.setattr(store, "_read", unexpected)
    monkeypatch.setattr(store, "_write", unexpected)
    assert store.begin(member=2, turn=8) is None
    assert len(list(store.archive.glob("*.json"))) == 1
    assert len(list((store.archive / "objects").iterdir())) == 1
    data = json.loads((store.archive / (first + ".json")).read_text())
    assert "data" not in repr(data) and "pending" not in repr(data)


def test_restore_keeps_later_edits_and_pruning_preserves_referenced_objects(tmp_path, monkeypatch):
    import raphael_core.computer.checkpoints as module
    monkeypatch.setattr(module, "MAX_CHECKPOINTS", 3)
    root = tmp_path / "work"; root.mkdir()
    file = root / "a"; file.write_text("original")
    store = CheckpointStore(tmp_path / "archive", [root])
    for turn in range(8):
        store.begin(member=2, turn=turn)
        file.write_text(str(turn))
    views = store.list(member=2)
    assert len(list(store.archive.glob("*.json"))) == 3
    file.write_text("owner later")
    assert store.restore(views[0]["id"], member=2)["skipped"] == [str(file)]
    file.write_text("7")
    result = store.restore(views[0]["id"], member=2)
    assert result["restored"] == [str(file)] and file.read_text() == "6"
    digests = {entry["digest"] for path in store.archive.glob("*.json")
               for entry in json.loads(path.read_text())["manifest"].values() if entry.get("digest")}
    assert digests <= {path.name for path in (store.archive / "objects").iterdir()}


def test_partial_archive_names_uncovered_files_and_stays_within_budget(tmp_path, monkeypatch):
    import raphael_core.computer.checkpoints as module
    monkeypatch.setattr(module, "MAX_ARCHIVE_BYTES", 100)
    root = tmp_path / "work"; root.mkdir()
    (root / "a").write_bytes(b"a" * 60)
    (root / "b").write_bytes(b"b" * 60)
    store = CheckpointStore(tmp_path / "archive", [root])
    store.begin(member=2, turn=7)
    view = store.list(member=2)[0]
    assert view["partial"] and str(root / "b") in view["uncovered"]
    assert sum(path.stat().st_size for path in (store.archive / "objects").iterdir()) <= 100


def test_budget_evicts_old_objects_instead_of_permanently_disabling_new_backups(tmp_path, monkeypatch):
    import raphael_core.computer.checkpoints as module
    monkeypatch.setattr(module, "MAX_ARCHIVE_BYTES", 100)
    root = tmp_path / "work"; root.mkdir()
    file = root / "a"; file.write_bytes(b"a" * 60)
    store = CheckpointStore(tmp_path / "archive", [root])
    store.begin(member=2, turn=7)
    file.write_bytes(b"b" * 60)
    latest = store.begin(member=2, turn=8)
    file.write_bytes(b"c" * 60)
    assert store.list(member=2)[0]["id"] == latest
    assert store.restore(latest, member=2)["restored"] == [str(file)]
    assert file.read_bytes() == b"b" * 60
    assert sum(path.stat().st_size for path in (store.archive / "objects").iterdir()) <= 100


def test_slow_walk_marks_missing_paths_uncovered_without_deleting_them_on_restore(tmp_path, monkeypatch):
    import raphael_core.computer.checkpoints as module
    root = tmp_path / "work"; root.mkdir()
    file = root / "a"; file.write_text("before")
    store = CheckpointStore(tmp_path / "archive", [root])
    store.begin(member=2, turn=7)
    monkeypatch.setattr(module, "WALK_SECONDS", -1)
    view = store.list(member=2)[0]
    assert view["partial"] and view["uncovered"]
    assert not store.restore(view["id"], member=2)["restored"]
    assert file.read_text() == "before"


def test_guest_source_compiles_as_the_exact_exec_string_without_a_bom():
    import raphael_core.computer.checkpoints as module
    from pathlib import Path
    compile(Path(module.__file__).read_text(encoding="utf-8"), "<guest-checkpoint>", "exec")


async def test_unavailable_archive_is_an_owner_notice_not_a_failed_command(desktop):
    from raphael_core.computer.checkpoint_service import Checkpoints
    vm, _, _ = desktop
    async def unavailable(*_args, **_kwargs): raise TimeoutError()
    vm.checkpoint = unavailable
    response = await Checkpoints(vm, lambda _: True).call({"member_id": 0})
    assert response["coverage_warning"] and response["checkpoints"] == []


def test_refreshing_policy_cannot_replace_the_after_state_the_owner_reviewed(tmp_path):
    root = tmp_path / "work"; root.mkdir()
    file = root / "a"; file.write_text("before")
    store = CheckpointStore(tmp_path / "archive", [root])
    ticket = store.begin(member=2, turn=7)
    file.write_text("member")
    shown = store.list(member=2)[0]
    file.write_text("owner later")
    refreshed = store.list(member=2)[0]
    assert shown["review_token"] != refreshed["review_token"]
    result = store.restore(ticket, member=2, review_token=shown["review_token"])
    assert result["skipped"] == [str(file)] and file.read_text() == "owner later"


def test_reusing_a_restored_baseline_tracks_new_work_instead_of_remaining_restored(tmp_path):
    root = tmp_path / "work"; root.mkdir()
    file = root / "a"; file.write_text("before")
    store = CheckpointStore(tmp_path / "archive", [root])
    first = store.begin(member=2, turn=7)
    file.write_text("first")
    store.list(member=2)
    assert store.restore(first, member=2)["restored"] == [str(file)]
    assert store.begin(member=2, turn=8) is None
    file.write_text("second")
    view = store.list(member=2)[0]
    assert view["state"] == "ready" and "second" in view["files"][0]["diff"]
    assert store.restore(view["id"], member=2, review_token=view["review_token"])["restored"] == [str(file)]
    assert file.read_text() == "before"


def test_diff_lines_stay_separate_when_neither_file_ends_with_a_newline(tmp_path):
    root = tmp_path / "work"; root.mkdir()
    file = root / "a"; file.write_text("before")
    store = CheckpointStore(tmp_path / "archive", [root])
    store.begin(member=2, turn=7)
    file.write_text("after")
    diff = store.list(member=2)[0]["files"][0]["diff"]
    assert "-before" in diff.splitlines() and "+after" in diff.splitlines()


def test_a_swollen_archive_object_is_rejected_without_reading_it_all(tmp_path, monkeypatch):
    import io
    import raphael_core.computer.checkpoints as module
    monkeypatch.setattr(module, "MAX_FILE_BYTES", 1024)
    read_sizes = []
    class Stream(io.BytesIO):
        def read(self, size=-1):
            content = super().read(size)
            read_sizes.append(len(content))
            return content
    class Object:
        def open(self, *_args): return Stream(b"x" * 65536)
        def read_bytes(self):
            with self.open() as stream: return stream.read()
    store = CheckpointStore(tmp_path / "archive", [tmp_path / "work"])
    monkeypatch.setattr(store, "_object", lambda _digest: Object())
    with pytest.raises(ValueError, match="broken_archive"):
        store._bytes({"digest": "0" * 64})
    assert sum(read_sizes) <= 1025


@pytest.mark.parametrize("failure", [False, True])
async def test_lazy_archive_status_never_fails_a_rebound_computer(desktop, tmp_path, failure):
    vm, _, _ = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare()
    vm.__dict__.pop("checkpoint_failures", None)
    if failure:
        async def broken(*args, **kwargs): raise OSError("archive unavailable")
        vm.checkpoint = broken
    command = next(item for item in hub.offered() if item.name == "vm_exec")
    with vm_scope(("turn", 0, 7), turn_id=7):
        assert (await hub.call(command.key, {"command": "echo one > a"}, approver="auto")).ok


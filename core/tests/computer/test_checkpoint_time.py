"""A run's first file checkpoint has the time the store takes, and one that cannot be had says why and after how long.

The app's log held 18 "File checkpoint skipped: VmError" (one TimeoutError) in three days, and listing the checkpoints
took 8.6 to 12.1 s (median 8.8 s over 255 calls) inside a guest limit of 10 s: a begin reads the same records, walks the
workspace for up to eight seconds and writes, so it was ended by the guest's `timeout` before it wrote anything. That
run's changes then had no checkpoint of their own (the undo of the changed-files card covers a run from it), and only
the log said so, by the exception's type alone."""

import logging
import time
from types import SimpleNamespace

import pytest

import raphael_core.computer.checkpoints as store_module
from raphael_core.computer.checkpoints import CheckpointStore
from raphael_core.computer.vm import VmError
from raphael_core.computer.vm_tools import VmTools, vm_scope
from raphael_core.services.attachment_store import AttachmentStore
from .test_vm import desktop, Bridge, EmptyHub  # noqa: F401


def test_a_begin_that_has_used_its_time_on_the_records_writes_what_it_walked_as_partial(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    root.mkdir()
    for n in range(30):
        (root / f"note-{n:02}.txt").write_text(f"text {n}")
    store = CheckpointStore(tmp_path / "archive", [root])
    # The script began long enough ago that one second is left before it must stop walking.
    monkeypatch.setattr(store_module, "STARTED", time.monotonic() - (store_module.GUEST_SECONDS - store_module.WRITE_SECONDS - 1))
    began = time.monotonic()
    identifier = store.begin(member=2, turn=7)
    assert identifier and time.monotonic() - began < store_module.WRITE_SECONDS
    assert store_module.GUEST_SECONDS - store_module.WRITE_SECONDS > store_module.WALK_SECONDS + 9  # records, then a walk


def test_a_begin_with_no_time_left_writes_no_empty_checkpoint(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "report.txt").write_text("before")
    store = CheckpointStore(tmp_path / "archive", [root])
    monkeypatch.setattr(store_module, "STARTED", time.monotonic() - store_module.GUEST_SECONDS)
    with pytest.raises(TimeoutError):
        store.begin(member=2, turn=7)
    assert not list((tmp_path / "archive").glob("*.json"))


async def test_the_guest_gives_the_store_its_time_and_a_store_that_ran_out_of_it_says_so(desktop):
    vm, target, _ = desktop
    seen = []

    async def run_for(target, args, **kwargs):
        seen.append((args, kwargs))
        return SimpleNamespace(code=124, truncated=False, stdout="", stderr="")
    vm.run_for = run_for
    with pytest.raises(VmError, match="checkpoint_timeout"):
        await vm.checkpoint(target, "begin", member=2, turn=7)
    args, kwargs = seen[0]
    limit = args[args.index("--kill-after=1") + 1]
    assert float(limit) == store_module.GUEST_SECONDS >= 20 and kwargs["timeout"] > store_module.GUEST_SECONDS


async def test_a_skipped_checkpoint_says_which_kind_and_after_how_long(desktop, tmp_path, caplog):
    vm, _, _ = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare()

    async def slow(*args, **kwargs):
        raise VmError("checkpoint_timeout")
    vm.checkpoint = slow
    caplog.set_level(logging.WARNING)
    command = next(item for item in hub.offered() if item.name == "vm_exec")
    with vm_scope(("turn", 0, 7), turn_id=7):
        assert (await hub.call(command.key, {"command": "echo one > a"}, approver="auto")).ok
    line = next(record.getMessage() for record in caplog.records if "File checkpoint skipped" in record.getMessage())
    assert "checkpoint_timeout after" in line and " s (a command)" in line and "echo" not in line

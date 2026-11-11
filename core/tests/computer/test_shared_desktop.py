"""Members share one desktop: a bounded wait with one progress line, a result that names who holds it,
the screen looked at again after waiting, and long commands that never hold the screen."""

import asyncio
import json

from raphael_core.computer.vm import GUEST, Result
from raphael_core.computer.vm_tools import EXEC, VmTools, vm_scope
from raphael_core.services.attachment_store import AttachmentStore

from .test_vm import Bridge, EmptyHub, desktop, Runtime  # noqa: F401


async def shared(desktop, tmp_path, *, wait=0.3):
    vm, target, runtime = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    hub.busy_wait_s, hub.busy_poll_s = wait, 0.01
    hub.names = {0: "Raphael", 2: "Alice"}.get
    await hub.prepare()
    await hub._discover(target)
    return vm, target, runtime, hub


def tool(hub, name):
    return next(item for item in hub.offered() if item.name == name)


async def test_a_member_waits_for_the_desktop_with_one_line_and_looks_at_the_screen_again(desktop, tmp_path):
    vm, target, runtime, hub = await shared(desktop, tmp_path)
    holding = {("turn", 0, 1)}
    hub.scope_busy = lambda owner: owner in holding
    shot = tool(hub, "get_desktop_state")
    with vm_scope(("turn", 0, 1)):
        assert (await hub.call(shot.key, {}, approver="auto")).ok
    click = tool(hub, "click")  # the driver's tools are offered from the first look at the screen on

    async def done():
        await asyncio.sleep(0.1)
        holding.clear()

    asyncio.ensure_future(done())
    lines = []
    with vm_scope(("turn", 2, 3), progress=lines.append, language="zh-TW"):
        moved = await hub.call(click.key, {}, approver="auto")
        # The screen is not what the model last saw: it looks first, and then acts.
        assert moved.ok and moved.kind == "screen_changed"
        assert (await hub.call(shot.key, {}, approver="auto")).ok
        assert (await hub.call(click.key, {}, approver="auto")).kind is None
    assert lines == ["正在等 Raphael 用完電腦"]


async def test_a_desktop_that_stays_taken_is_reported_with_who_and_for_how_long(desktop, tmp_path):
    vm, target, runtime, hub = await shared(desktop, tmp_path, wait=0.1)
    clock = [0.0]
    vm.clock = lambda: clock[0]
    hub.lease_idle_s = 1000
    hub.scope_busy = lambda owner: owner == ("turn", 0, 1)
    shot = tool(hub, "get_desktop_state")
    with vm_scope(("turn", 0, 1)):
        assert (await hub.call(shot.key, {}, approver="auto")).ok
    clock[0] = 125.0
    lines = []
    with vm_scope(("turn", 2, 3), progress=lines.append, language="en"):
        result = await hub.call(shot.key, {}, approver="auto")
    # Not a tool failure: the model is told how things stand and decides what to do.
    assert result.ok and result.kind == "computer_busy"
    said = json.loads(result.text)
    assert said["held_by"] == "Raphael" and said["held_for_s"] == 125 and said["waited_s"] >= 0
    assert lines == ["Waiting for Raphael to finish with the computer"]


async def test_a_holder_that_has_not_touched_the_screen_for_a_minute_has_let_go_of_it(desktop, tmp_path):
    vm, target, runtime, hub = await shared(desktop, tmp_path, wait=0.1)
    clock = [0.0]
    vm.clock = lambda: clock[0]
    hub.scope_busy = lambda owner: owner == ("turn", 0, 1)  # still at work, but not at the screen
    shot = tool(hub, "get_desktop_state")
    with vm_scope(("turn", 0, 1)):
        assert (await hub.call(shot.key, {}, approver="auto")).ok
    click = tool(hub, "click")
    clock[0] = 61.0
    with vm_scope(("turn", 2, 3)):
        taken = await hub.call(shot.key, {}, approver="auto")
    assert taken.ok and taken.kind is None  # no wait
    clock[0] = 62.0
    with vm_scope(("turn", 0, 1)):  # the first one comes back: the screen is not what it saw
        assert (await hub.call(click.key, {}, approver="auto")).kind == "screen_changed"


async def test_a_long_command_does_not_hold_the_screen_or_other_commands(desktop, tmp_path):
    vm, target, runtime, hub = await shared(desktop, tmp_path, wait=0.0)
    release = asyncio.Event()
    original = runtime.__call__
    entered = []

    async def run(args, **kwargs):
        if "-lc" in args and "sleep 1200" in " ".join(args):
            entered.append(1)
            await release.wait()
            return Result(0, "built")
        return await original(args, **kwargs)

    vm.run = run
    execute, shot = tool(hub, "vm_exec"), tool(hub, "get_desktop_state")
    with vm_scope(("task", 5, 2, 9)):
        building = asyncio.ensure_future(hub.call(execute.key, {"command": "sleep 1200", "timeout_seconds": 1800}, approver="auto"))

        async def started():
            while not entered:
                await asyncio.sleep(0.01)

        await asyncio.wait_for(started(), 5)
    with vm_scope(("turn", 0, 1)):
        assert (await hub.call(shot.key, {}, approver="auto")).kind is None
        other = await hub.call(execute.key, {"command": "echo hello"}, approver="auto")
        assert other.ok and other.kind is None
    assert vm.active[target.key] == 1  # the build still keeps the desktop from being stopped
    release.set()
    assert (await building).ok
    assert vm.active[target.key] == 0


async def test_a_foreground_command_may_run_for_half_an_hour_and_no_longer(desktop):
    vm, target, runtime = desktop
    assert EXEC["parameters"]["properties"]["timeout_seconds"]["maximum"] == 21600  # a job's, for a foreground command it is 1800
    await vm.execute(target, "make", 1800)
    _, kwargs = next((a, k) for a, k in runtime.calls if "-lc" in a)
    assert kwargs["timeout"] == 1805
    import pytest
    from raphael_core.computer.vm import VmError

    with pytest.raises(VmError, match="bad_arguments"):
        await vm.execute(target, "make", 1801)


async def test_a_background_command_returns_at_once_and_leaves_a_log_to_read(desktop):
    vm, target, runtime = desktop
    job = await vm.execute(target, "npm run build", background=True)
    assert job["job"] and job["log"].startswith(GUEST + "/.raphael-jobs/") and job["exit_file"].endswith(".exit")
    args, kwargs = next((a, k) for a, k in runtime.calls if "-d" in a and "exec" == a[0])
    script = args[args.index("-c") + 1] if "-c" in args else " ".join(args)
    assert "npm run build" in " ".join(args) and kwargs["timeout"] <= 30
    assert job["log"] in " ".join(args) and job["exit_file"] in " ".join(args)

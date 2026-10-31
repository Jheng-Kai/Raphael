"""The real VM adapter and viewer lease, with a deterministic Docker boundary."""
import asyncio
import json

import pytest

from raphael_core.agent.gate import ToolGate
from raphael_core.agent.mcp_server import RaphaelMcp
from raphael_core.background.snapshot import take_snapshot
from raphael_core.computer.vm import LocalVm
from raphael_core.computer.viewer import DesktopViewer
from raphael_core.computer.vm_tools import VmTools, vm_scope
from raphael_core.protocol import RpcError
from raphael_core.services.attachment_store import AttachmentStore
from .test_vm import Runtime, container, Bridge, EmptyHub


@pytest.fixture
async def rig(tmp_path, conn):
    from raphael_core.brain.settings import SettingsStore
    settings = SettingsStore(conn)
    settings.set("computer_vm_mode", "shared")
    runtime = Runtime()
    vm = LocalVm(tmp_path, settings=settings, runner=runtime)
    runtime.raw = container(vm, vm.target(), runtime)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge, conn=conn)
    vm.grants.set(0, True)
    vm.grants.set(1, True)
    await hub.prepare(1)
    hub.scope_busy = lambda scope: True
    viewer = DesktopViewer(vm)
    snapshot = take_snapshot(hub)
    gate = ToolGate(hub)

    async def call(name, arguments=None, *, turn=42, private=True, task_id=None):
        with vm_scope(("turn", 1, 11), turn_id=turn, private=private):
            result = await gate.call_plugin(snapshot.refs["computer__" + name].key, arguments or {}, task_id=task_id)
            snapshot.refresh_computer(hub, 1)
            return result

    try:
        yield vm, viewer, call, snapshot
    finally:
        await viewer.aclose()


async def waiting(vm):
    for _ in range(50):
        if vm.work.pending(vm.target()):
            return vm.work.pending(vm.target())
        await asyncio.sleep(0)
    raise AssertionError("Takeover did not pause")


async def test_private_takeover_blocks_every_tool_and_resumes_once_after_explicit_done(rig):
    vm, viewer, call, snapshot = rig
    task = asyncio.create_task(call("request_takeover", {"reason": "sign_in"}))
    work = await waiting(vm)
    try:
        assert (await viewer.status({"member_id": 1, "conversation_id": 11}))["works"][0]["state"] == "waiting_control"
        assert "works" not in await viewer.status({"member_id": 0, "conversation_id": 11})
        assert "works" not in await viewer.status({"member_id": 1, "conversation_id": 12})
        for ref in snapshot.refs.values():
            if ref.server == "computer":
                assert (await call(ref.name)).kind == "owner_holds_control"
        wrong = await viewer.open({"member_id": 0})
        with pytest.raises(RpcError):
            await viewer.control({**wrong, "held": True})
        opened = await viewer.open({"member_id": 1, "conversation_id": 11})
        assert (await viewer.renew(opened))["control"] == "member"
        await viewer.control({**opened, "held": True})
        with pytest.raises(RpcError):
            await viewer.control({**opened, "held": False})
        await viewer.control({**opened, "held": False, "takeover": work.request_id})
        await viewer.control({**opened, "held": False, "takeover": work.request_id})
        result = await task
        assert result.ok and json.loads(result.text)["status"] == "owner_finished"
        assert not vm.held
        with vm_scope(("turn", 1, 11), turn_id=42, private=True, task=asyncio.current_task()):
            work.task = asyncio.current_task()
            assert (await call("vm_exec", {"command": "true"})).kind == "desktop_check_required"
            assert (await call("get_desktop_state")).ok
            assert (await call("click")).ok
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


@pytest.mark.parametrize("end", ["close", "expire", "stop", "timeout"])
async def test_disconnect_timeout_and_stop_never_resume(rig, end):
    vm, viewer, call, _ = rig
    if end == "timeout":
        vm.work.timeout = 0.02
    task = asyncio.create_task(call("request_takeover", {"reason": "two_factor"}))
    await waiting(vm)
    opened = await viewer.open({"member_id": 1, "conversation_id": 11})
    await viewer.control({**opened, "held": True})
    if end == "expire":
        viewer.sessions[opened["session"]].expires = vm.clock() - 1
    if end in ("close", "expire"):
        await viewer.close(opened)
        assert not task.done() and vm.held
        reopened = await viewer.open({"member_id": 1, "conversation_id": 11})
        await viewer.control({**reopened, "held": True})
        assert not task.done()
    elif end == "timeout":
        result = await task
        assert not result.ok and result.kind == "takeover_expired"
        assert (await call("vm_exec", {"command": "true"})).kind in ("owner_holds_control", "task_stopped")
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    assert vm.work.views(1, 11)[0]["state"] in ("stopped", "expired")


async def test_typed_reason_rejects_secrets_and_non_private_requests(rig, conn):
    vm, _, call, snapshot = rig
    secret = "sentinel-password-44821"
    assert (await call("request_takeover", {"reason": "sign_in", "password": secret})).kind == "bad_arguments"
    assert (await call("request_takeover", {"reason": secret})).kind == "bad_arguments"
    assert (await call("request_takeover", {"reason": "sign_in"}, private=False)).kind == "private_conversation_required"
    assert secret not in json.dumps(vm.work.views(1, 11))
    assert secret not in json.dumps([dict(row) for row in conn.execute("SELECT * FROM tool_audit")])
    # Both API snapshots and the single CLI MCP consume this same typed definition.
    definition = next(d for d in snapshot.definitions if d["function"]["name"] == "computer__request_takeover")
    async with RaphaelMcp(lambda: snapshot.definitions, lambda *args: None) as server:
        listed = await server._dispatch({"method": "tools/list"}, computer=True)
        offered = next(d for d in listed["result"]["tools"] if d["name"] == "computer__request_takeover")
        assert offered["inputSchema"] == definition["function"]["parameters"]


async def test_preview_cannot_acquire_control_or_start_docker(rig):
    vm, viewer, _, _ = rig
    launched = []
    vm.launch = launched.append
    opened = await viewer.open({"member_id": 1, "preview": True})
    assert not launched
    with pytest.raises(RpcError):
        await viewer.control({**opened, "held": True})


async def test_another_owner_surface_suppresses_inline_preview_without_granting_its_lease(rig):
    _, viewer, _, _ = rig
    owner = await viewer.open({"member_id": 1, "conversation_id": 11})
    reader = await viewer.open({"member_id": 1, "conversation_id": 11})
    await viewer.control({**owner, "held": True})
    state = await viewer.renew(reader)
    assert state["control"] == "member" and state["preview_allowed"] is False
    await viewer.control({**owner, "held": False})
    assert (await viewer.renew(reader))["preview_allowed"] is True


async def test_an_old_done_cannot_complete_a_second_takeover_of_the_same_task(rig):
    vm, viewer, call, _ = rig
    first = asyncio.create_task(call("request_takeover", {"reason": "sign_in"}))
    work = await waiting(vm)
    old_request = work.request_id
    opened = await viewer.open({"member_id": 1, "conversation_id": 11})
    await viewer.control({**opened, "held": True})
    await viewer.control({**opened, "held": False, "takeover": old_request})
    assert (await first).ok
    assert (await call("get_desktop_state")).ok
    second = asyncio.create_task(call("request_takeover", {"reason": "two_factor"}))
    await waiting(vm)
    try:
        assert work.request_id != old_request
        await viewer.control({**opened, "held": True})
        with pytest.raises(RpcError):
            await viewer.control({**opened, "held": False, "takeover": old_request})
        assert not second.done() and vm.held
        await viewer.control({**opened, "held": False, "takeover": work.request_id})
        assert (await second).ok
        assert len(vm.work.views(1, 11)) == 1
    finally:
        second.cancel()
        await asyncio.gather(second, return_exceptions=True)


async def test_takeover_never_overlaps_an_already_running_input(rig):
    vm, _, call, _ = rig
    vm.active[vm.target().key] = 1
    assert (await call("request_takeover", {"reason": "sign_in"})).kind == "computer_busy"
    assert not vm.work.pending(vm.target()) and not vm.held


async def test_private_background_takeover_is_bound_to_its_existing_conversation(rig, conn):
    from raphael_core.agent.history import AgentHistory
    from raphael_core.agent.conversations import Conversations
    from raphael_core.background.tasks import TaskStore

    vm, viewer, call, _ = rig
    conversation = Conversations(conn).main()
    turn = AgentHistory(conn).add(session_id="background-computer", question="Local test", route="delegate",
        prefix="", text="", status="running", source="typed", conversation_id=conversation)
    store = TaskStore(conn)
    task_id = store.create(session_id="background-computer", language="en", text="Local test")
    store.attach_turn(task_id, turn)
    task = asyncio.create_task(call("request_takeover", {"reason": "captcha"}, private=False, task_id=task_id))
    work = await waiting(vm)
    try:
        assert work.turn_id == turn and work.member_id == 0 and work.conversation_id == conversation
        assert len(vm.work.views(0, conversation)) == 1 and not vm.work.views(1, 11)
        opened = await viewer.open({"member_id": 0, "conversation_id": conversation})
        await viewer.control({**opened, "held": True})
        await viewer.control({**opened, "held": False, "takeover": work.request_id})
        assert (await task).ok
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

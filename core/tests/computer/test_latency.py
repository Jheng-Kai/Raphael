"""Computer latency contracts using only the existing fake Docker and driver."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from jsonschema import Draft202012Validator

from raphael_core.background.snapshot import take_snapshot
from raphael_core.computer.vm import PREFLIGHT_S, VmError
from raphael_core.computer.vm_bridge import CuaBridge
from raphael_core.computer.vm_catalog import DRIVER_TOOLS, offline_catalog
from raphael_core.computer.vm_tools import VmTools, vm_scope
from raphael_core.services.attachment_store import AttachmentStore
from .test_vm import CatalogBridge, EmptyHub, per_bot_desktop as desktop  # noqa: F401


def tool(hub, name):
    return next(item for item in hub.offered() if item.name == name)


async def test_confirmed_start_skips_docker_and_capacity_lock_until_expiry(desktop):
    vm, target, runtime = desktop
    now = [0]
    vm.clock = lambda: now[0]
    assert (await vm.start(target))["ready"]
    runtime.calls.clear()
    async with vm.capacity_lock:
        assert (await asyncio.wait_for(vm.start(target), 0.1))["ready"]
    assert not runtime.calls
    now[0] = PREFLIGHT_S
    assert (await vm.start(target))["ready"] and runtime.calls
    runtime.calls.clear()
    vm.changes += 1
    await vm.start(target)
    assert runtime.calls


async def test_configuration_and_explicit_invalidation_drop_preflight(desktop):
    vm, target, runtime = desktop
    await vm.start(target)
    runtime.calls.clear()
    vm.timezone_pending = True
    await vm.start(target)
    assert runtime.calls
    runtime.calls.clear()
    vm.invalidate(target)
    await vm.start(target)
    assert runtime.calls
    vm.enabled = False
    with pytest.raises(VmError, match="absent"):
        await vm.start(target)


async def test_observed_external_stop_invalidates_preflight_immediately(desktop):
    vm, target, runtime = desktop
    await vm.start(target)
    assert target.physical in vm.running
    runtime.raw["State"]["Running"] = False
    assert (await vm.status(target, probe=False))["state"] == "stopped"
    assert target.physical not in vm.running


@pytest.mark.parametrize("failure", [VmError("incompatible_image"), ConnectionError(), TimeoutError()])
async def test_status_failure_invalidates_a_previous_confirmation(desktop, failure):
    vm, target, _ = desktop
    await vm.start(target)
    async def failed_image(_):
        raise failure
    vm.image = failed_image
    with pytest.raises(type(failure)):
        await vm.status(target)
    assert target.physical not in vm.running


async def test_full_catalog_is_offered_to_worker_before_any_docker_or_screen(desktop, tmp_path):
    vm, _, runtime = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=CatalogBridge)
    await hub.prepare()
    assert not runtime.calls
    assert set(DRIVER_TOOLS) | {"browser_open", "vm_exec"} <= {item.name for item in hub.offered()}
    snapshot = take_snapshot(hub)
    assert {"computer__click", "computer__browser_open", "computer__browser_type"} <= snapshot.refs.keys()
    for definition in offline_catalog().values():
        Draft202012Validator.check_schema(definition["parameters"])
        assert "session" not in definition["parameters"]["properties"]


async def test_window_reads_are_bounded_and_driver_images_and_cursor_are_configured(desktop, tmp_path):
    vm, _, _ = desktop
    class Driver(CatalogBridge):
        calls = []
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Driver)
    await hub.prepare()
    try:
        result = await hub.call(tool(hub, "get_window_state").key, {"pid": 7, "window_id": 9, "query": "Save", "max_elements": 900}, approver="auto")
        assert result.ok and "Elapsed:" in result.text
        calls = [params for method, params in Driver.calls if method == "tools/call"]
        sent = next(call["arguments"] for call in calls if call["name"] == "get_window_state")
        assert sent["max_elements"] == 200 and sent["include_screenshot"] is False and sent["query"] == "Save"
        assert next(call["arguments"] for call in calls if call["name"] == "set_config")["max_image_dimension"] == 1456
        # The real driver's schema for this call is `enabled` and `session`, nothing else: one more key and the
        # connection, and with it every tool of the computer, is refused (seen in real containers, 2026-11-12).
        cursor = next(call["arguments"] for call in calls if call["name"] == "set_agent_cursor_enabled")
        assert cursor == {"enabled": False, "session": cursor["session"]} and cursor["session"].startswith("raphael-")
        config = next(call["arguments"] for call in calls if call["name"] == "set_config")
        assert config == {"max_image_dimension": 1456, "session": cursor["session"]}
    finally:
        await hub.aclose()


async def test_a_core_started_again_never_reuses_a_driver_session_label(desktop, tmp_path):
    # The driver in a computer that kept running refuses a label that has ended: a second core that counted from
    # "raphael-1" again had its set-up refused (seen in a real container, 2026-11-12).
    vm, _, _ = desktop
    class Driver(CatalogBridge):
        calls = []
    labels = []
    for _ in range(2):
        hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Driver)
        await hub.prepare()
        try:
            first = (await hub._connection(vm.target()))[1]
            await hub._disconnect(vm.target().key)
            labels += [first, (await hub._connection(vm.target()))[1]]
        finally:
            await hub.aclose()
    assert len(set(labels)) == 4 and all(label.startswith("raphael-") for label in labels)


@pytest.mark.parametrize("failure", [VmError("transport_closed"), ConnectionError(), TimeoutError()])
async def test_bridge_failure_invalidates_start_without_replaying_action(desktop, tmp_path, failure):
    vm, target, runtime = desktop
    class Driver(CatalogBridge):
        broken = True
        calls = []
        async def request(self, method, params=None):
            if method == "tools/call" and params["name"] == "click" and self.broken:
                self.calls.append((method, params))
                raise failure
            return await super().request(method, params)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Driver)
    await hub.prepare()
    try:
        assert not (await hub.call(tool(hub, "click").key, {}, approver="auto")).ok
        assert target.physical not in vm.running
        assert sum(params.get("name") == "click" for _, params in Driver.calls) == 1
        runtime.calls.clear()
        Driver.broken = False
        if failure.__class__ is ConnectionError or str(failure) == "transport_closed":
            assert (await hub.call(tool(hub, "get_window_state").key, {}, approver="auto")).ok
        assert (await hub.call(tool(hub, "click").key, {}, approver="auto")).ok
        assert any(args[0] == "info" for args, _ in runtime.calls)
    finally:
        await hub.aclose()


class Browser(CatalogBridge):
    calls = []
    fail = None
    hold = False

    async def request(self, method, params=None):
        if method != "tools/call":
            return await super().request(method, params)
        self.calls.append((method, params))
        name = params["name"]
        if self.fail == name:
            return {"isError": True, "content": [{"type": "text", "text": "failed"}]}
        if name == "browser_prepare":
            if self.hold:
                self.vm.hold(self.target, True)
            return {"structuredContent": {"pid": 7}}
        if name == "list_windows":
            return {"content": [{"type": "text", "text": 'window_id=9 pid=7 "Page" app=Chromium'}]}
        if name == "get_browser_state":
            return {"structuredContent": {"target_id": "target", "tabs": [{"tab_id": "tab", "active": True}],
                "page": {"title": "Visible page", "refs": ["e1"]}}, "content": [{"type": "image", "data": "discarded"}]}
        return {"content": []}


async def test_browser_open_prepares_binds_navigates_and_returns_semantics_in_one_call(desktop, tmp_path):
    vm, _, _ = desktop
    class Driver(Browser):
        calls = []
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Driver)
    await hub.prepare()
    try:
        result = await hub.call(tool(hub, "browser_open").key, {"url": "https://example.test", "query": "article", "scope_ref": "main"}, approver="auto")
        assert result.ok and "Visible page" in result.text and "e1" in result.text and not result.blocks
        calls = [params for method, params in Driver.calls if method == "tools/call" and params["name"] not in ("set_config", "set_agent_cursor_enabled")]
        assert [call["name"] for call in calls] == ["browser_prepare", "list_windows", "get_browser_state", "browser_navigate", "get_browser_state"]
        assert calls[0]["arguments"]["profile"] == {"mode": "isolated_named", "name": "main"}
        assert calls[3]["arguments"]["target_id"] == "target" and calls[3]["arguments"]["tab_id"] == "tab"
        assert calls[-1]["arguments"] == {"session": calls[0]["arguments"]["session"], "target_id": "target", "tab_id": "tab",
            "include_screenshot": False, "snapshot_format": "semantic_v2", "query": "article", "scope_ref": "main"}
        assert not (await hub.call(tool(hub, "browser_open").key, {"url": "file:///secret"}, approver="auto")).ok
    finally:
        await hub.aclose()


@pytest.mark.parametrize("missing", [False, True])
async def test_browser_open_waits_for_a_late_window_with_a_bounded_deadline(desktop, tmp_path, missing):
    vm, _, _ = desktop
    class Driver(Browser):
        calls, windows = [], 0
        async def request(self, method, params=None):
            if method == "tools/call" and params["name"] == "list_windows":
                type(self).windows += 1
                if missing or self.windows == 1:
                    return {"structuredContent": {"windows": []}}
            return await super().request(method, params)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Driver)
    hub.browser_window_wait_s, hub.browser_window_poll_s = 0.03, 0.005
    await hub.prepare()
    try:
        result = await hub.call(tool(hub, "browser_open").key, {"url": "https://example.test"}, approver="auto")
        assert Driver.windows >= 2
        assert result.ok is not missing
        if missing:
            assert result.kind == "browser_window_missing"
            assert not any(params.get("name") == "browser_navigate" for _, params in Driver.calls)
    finally:
        await hub.aclose()


@pytest.mark.parametrize("hold", [False, True])
async def test_browser_open_stops_on_driver_error_or_new_owner_hold(desktop, tmp_path, hold):
    vm, _, _ = desktop
    class Driver(Browser):
        calls = []
    Driver.hold, Driver.fail = hold, None if hold else "browser_navigate"
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Driver)
    await hub.prepare()
    try:
        assert not (await hub.call(tool(hub, "browser_open").key, {"url": "https://example.test"}, approver="auto")).ok
        calls = [params for method, params in Driver.calls if method == "tools/call"]
        assert calls[-1]["name"] == ("browser_prepare" if hold else "browser_navigate")
    finally:
        await hub.aclose()


async def test_slow_read_emits_one_progress_line_and_elapsed_time(desktop, tmp_path):
    vm, _, _ = desktop
    class Driver(CatalogBridge):
        async def request(self, method, params=None):
            if method == "tools/call" and params["name"] == "get_desktop_state":
                await asyncio.sleep(0.04)
            return await super().request(method, params)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Driver)
    hub.read_progress_s = 0.01
    await hub.prepare()
    lines = []
    try:
        with vm_scope(("turn", 0, 1), progress=lines.append, language="en"):
            result = await hub.call(tool(hub, "get_desktop_state").key, {}, approver="auto")
        assert result.ok and len(lines) == 1 and "Elapsed:" in result.text
    finally:
        await hub.aclose()


def waiting_bridge(vm, target):
    bridge = CuaBridge(vm, target)
    queue, sent = asyncio.Queue(), []
    async def write(packet):
        sent.append(packet)
    async def wait():
        pass
    process = SimpleNamespace(stdout=SimpleNamespace(readline=queue.get), returncode=None, wait=wait)
    process.kill = lambda: setattr(process, "returncode", -1)
    bridge.process, bridge._write = process, write
    return bridge, queue, sent


async def test_read_wait_does_not_hold_connection_lock_and_routes_out_of_order_replies(desktop):
    vm, target, _ = desktop
    bridge, queue, sent = waiting_bridge(vm, target)
    first = asyncio.create_task(bridge.request("tools/call", {"name": "get_window_state"}))
    await asyncio.sleep(0)
    assert not bridge.lock.locked()
    second = asyncio.create_task(bridge.request("tools/call", {"name": "click"}))
    await asyncio.sleep(0)
    for packet in reversed(sent):
        queue.put_nowait(json.dumps({"id": packet["id"], "result": {"value": packet["params"]["name"]}}).encode())
    assert await second == {"value": "click"}
    assert await first == {"value": "get_window_state"}
    await bridge.__aexit__()


async def test_screen_read_outlasts_action_deadline_and_an_action_still_times_out(desktop):
    vm, target, _ = desktop
    bridge, queue, sent = waiting_bridge(vm, target)
    bridge.read_timeout_s, bridge.action_timeout_s = 0.2, 0.01
    read = asyncio.create_task(bridge.request("tools/call", {"name": "get_window_state"}))
    await asyncio.sleep(0.03)
    assert not read.done()
    queue.put_nowait(json.dumps({"id": sent[0]["id"], "result": {"ready": True}}).encode())
    assert await read == {"ready": True}
    with pytest.raises(TimeoutError):
        await bridge.request("tools/call", {"name": "click"})


@pytest.mark.parametrize("cancel", [False, True])
async def test_timeout_or_cancel_closes_owned_bridge_and_releases_waiters(desktop, cancel):
    vm, target, _ = desktop
    await vm.start(target)
    bridge, _, _ = waiting_bridge(vm, target)
    bridge.action_timeout_s = 0.01
    bridge.read_timeout_s = 0.03
    task = asyncio.create_task(bridge.request("tools/call", {"name": "get_window_state"}))
    await asyncio.sleep(0)
    if cancel:
        task.cancel()
    with pytest.raises(asyncio.CancelledError if cancel else TimeoutError):
        await task
    assert target.physical not in vm.running and not bridge.lock.locked() and not bridge.pending and bridge.process is None


def test_member_persona_explains_first_turn_tools_and_targeted_reads():
    from raphael_core.agent.persona import _SHARED_CONTRACT
    assert "browser_open(url)" in _SHARED_CONTRACT
    assert "Computer tools exist from turn one" in _SHARED_CONTRACT
    assert "max_elements 200" in _SHARED_CONTRACT
    assert "before input" in _SHARED_CONTRACT

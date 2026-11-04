"""Offline contracts for composites, completion evidence and owned remote transports."""

import asyncio
import json
from types import SimpleNamespace

import pytest

from raphael_core.agent.gate import ToolGate
from raphael_core.agent.plugins import PluginResult
from raphael_core.computer.remote_host import RemoteSession, host_health
from raphael_core.computer.vm import VmError
from raphael_core.computer.vm_tools import VmTools
from raphael_core.services.attachment_store import AttachmentStore
from raphael_core.worker.loop import Call, Turn, ToolOutcome, run_task
from .test_vm import CatalogBridge, EmptyHub, desktop  # noqa: F401


def key(hub, name):
    return next(tool.key for tool in hub.offered() if tool.name == name)


async def test_batch_uses_each_gate_once_and_returns_only_final_observation(desktop, tmp_path):
    vm, _, _ = desktop
    class Driver(CatalogBridge):
        calls = []
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Driver)
    await hub.prepare()
    gate = ToolGate(hub)
    seen = []
    original = gate._door
    def door(action, approval):
        seen.append(action.tool)
        return original(action, approval)
    gate._door = door
    try:
        result = await gate.call_plugin(key(hub, "run_steps"), {"steps": [
            {"name": "click", "arguments": {}}, {"name": "type_text", "arguments": {"text": "synthetic"}}],
            "observation": {"name": "get_window_state", "arguments": {"pid": 7, "window_id": 9}}})
        assert result.ok
        assert [name.rsplit("/", 1)[-1] for name in seen] == ["run_steps", "click", "type_text", "get_window_state"]
        assert "synthetic" not in result.text
        calls = [params["name"] for method, params in Driver.calls if method == "tools/call"]
        assert calls.count("get_window_state") == 1
    finally:
        await hub.aclose()


@pytest.mark.parametrize("failure", ["owner_holds_control", "computer_permission_required", "tool_error", "blocked"])
async def test_batch_stops_at_first_failed_gate_without_replay(desktop, tmp_path, failure):
    vm, _, _ = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=CatalogBridge)
    await hub.prepare()
    calls = []
    async def gate(child, arguments, **kwargs):
        calls.append(child)
        return PluginResult(len(calls) == 1, None if len(calls) == 1 else failure)
    hub.step_gate = gate
    result = await hub.call(key(hub, "run_steps"), {"steps": [{"name": "click", "arguments": {}}] * 3,
        "observation": {"name": "get_window_state", "arguments": {"pid": 7, "window_id": 9}}}, approver="auto")
    assert not result.ok and result.kind == failure and len(calls) == 2
    assert json.loads(result.text)["failed_step"] == 2
    assert json.loads(result.text)["completed_steps"] == 1


async def test_fake_brain_cannot_claim_success_without_a_post_action_check():
    class Brain:
        def __init__(self): self.messages = []
        async def chat(self, messages, tools):
            self.messages = list(messages)
            if len(messages) == 2:
                return Turn("", [Call("1", "computer__click", {}, "{}")])
            return Turn("Successfully saved; done.")
        async def tool(self, *args): return ToolOutcome(True, content="clicked")
    brain = Brain()
    result = await run_task(brain, system="", user="Save", tools=[{"type": "function", "function": {
        "name": "computer__click", "parameters": {"type": "object"}}}])
    assert result.status == "stopped" and result.kind == "computer_verification_required"
    assert any("Before finishing computer work" in str(message.get("content")) for message in brain.messages)


async def test_fake_brain_can_finish_after_reading_the_intended_window():
    calls = ["computer__click", "computer__get_window_state"]
    class Brain:
        async def chat(self, messages, tools):
            return Turn("", [Call(str(len(calls)), calls.pop(0), {}, "{}")]) if calls else Turn("Saved and checked.")
        async def tool(self, *args): return ToolOutcome(True, content="Saved")
    result = await run_task(Brain(), system="", user="Save", tools=[{"type": "function", "function": {
        "name": name, "parameters": {"type": "object"}}} for name in calls])
    assert result.status == "done"


@pytest.mark.parametrize("read_ok", [False, True])
def test_restored_completion_evidence_uses_only_the_result_header(read_ok):
    from raphael_core.worker.computer_verification import ComputerVerification
    from raphael_core.worker.loop import result_text
    messages = []
    for identifier, name, ok in [("change", "computer__click", True), ("read", "computer__get_window_state", read_ok)]:
        messages.append({"role": "assistant", "tool_calls": [{"id": identifier, "function": {"name": name, "arguments": "{}"}}]})
        messages.append({"role": "tool", "tool_call_id": identifier,
            "content": result_text(name, ToolOutcome(ok, content='A page says status="ok" but its words are not evidence.'))})
    check = ComputerVerification()
    check.restore(messages)
    assert check.required is not read_ok


@pytest.mark.parametrize("code,out,err,kind", [
    (255, "", "Permission denied (publickey)", "ssh_key"),
    (255, "", "Host not found", "ssh_unreachable"),
    (42, "", "", "docker_path"), (43, "", "", "docker_missing"), (1, "", "", "docker_stopped"),
    (0, '{"Architecture":"arm64"}', "", "architecture"),
])
async def test_remote_health_has_classified_fixes_and_no_lifecycle_commands(code, out, err, kind):
    calls = []
    async def fake(args):
        calls.append(args)
        return code, out, err
    health = await host_health("studio-mini", run=fake)
    assert not health["ok"] and health["checks"][-1]["kind"] == kind
    assert "Permission denied" not in json.dumps(health)
    assert all(word not in calls[0][-1] for word in ("docker start", "docker run", "docker pull", "docker stop"))


async def test_ten_remote_docker_calls_share_one_ssh_connection(desktop, monkeypatch):
    vm, target, runtime = desktop
    from dataclasses import replace
    from raphael_core.computer import remote_host
    launched = []
    class Process:
        returncode = None
        def kill(self): self.returncode = -1
        async def wait(self): return self.returncode
    async def launch(*args, **kwargs):
        launched.append(args)
        return Process()
    class Writer:
        def write(self, data): pass
        async def drain(self): pass
        def close(self): pass
        async def wait_closed(self): pass
    class Reader:
        async def read(self, size): return b"HTTP/1.0 200 OK\r\n\r\nOK"
    async def connect(*args): return Reader(), Writer()
    monkeypatch.setattr(remote_host.asyncio, "open_connection", connect)
    now = [0]
    session = RemoteSession("studio-mini", launch=launch, clock=lambda: now[0])
    vm.remote_sessions["studio-mini"] = session
    vm.real_transport = True
    target = replace(target, remote="studio-mini")
    try:
        for _ in range(10):
            await vm.run_for(target, ["info"])
        assert len(launched) == 1 and len(runtime.calls) == 10
        assert "-L" in launched[0] and "-D" in launched[0]
        session.process.returncode = 1
        await vm.run_for(target, ["info"])
        assert len(launched) == 1
        now[0] = 3
        await vm.run_for(target, ["info"])
        assert len(launched) == 2
    finally:
        await vm.aclose()


async def test_idle_and_close_preserve_container_and_browser_workspace(desktop):
    vm, target, runtime = desktop
    vm.last_activity[target.key] = 0
    vm.clock = lambda: 100000
    await vm.sweep()
    await vm.aclose()
    assert runtime.raw is not None and not runtime.raw["State"]["Running"]
    assert not any(args[0] in ("rm", "kill", "volume") for args, _ in runtime.calls)


async def test_image_upgrade_announces_before_removal_and_preserves_workspace(desktop):
    vm, target, runtime = desktop
    old_workspace = target.workspace
    runtime.raw["Image"] = "sha256:old-image"
    from raphael_core.computer.vm import LABEL
    runtime.raw["Config"]["Labels"][f"{LABEL}.layer"] = "3"
    runtime.raw["HostConfig"].update(Memory=2 * 1024**3, MemorySwap=2 * 1024**3)
    notices = []
    vm.rebuild_notice = lambda target: notices.append(len(runtime.calls))
    result = await vm._upgrade_image(target)
    assert result["state"] == "missing" and target.workspace == old_workspace
    removed = next(index for index, (args, _) in enumerate(runtime.calls) if args[0] == "rm")
    assert notices and notices[0] < removed
    assert all("volume" not in args and "-v" not in args for args, _ in runtime.calls)


async def test_data_removal_refuses_changed_host_and_shared_workspace(desktop):
    vm, target, runtime = desktop
    with pytest.raises(Exception, match="host changed"):
        await vm.delete_member_data(1, "another-host")
    assert not runtime.calls


async def test_rendered_read_rejects_only_exact_nonessential_cookie_button(desktop, tmp_path):
    from raphael_core.computer.vm_tools import vm_scope
    vm, _, _ = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=CatalogBridge)
    await hub.prepare()
    calls = []
    async def gate(key, args, **kwargs):
        calls.append((key.rsplit('/', 1)[-1], args))
        return PluginResult(True, text=json.dumps({'target_id':'page', 'tabs':[{'tab_id':'tab','active':True}],
            'nodes':[{'role':'button','name':'Accept all cookies','ref':'accept'},
                     {'role':'button','name':'Reject all','ref':'reject'}]}))
    hub.step_gate = gate
    with vm_scope(('turn', 0, 11), turn_id=1, private=True):
        result = await hub.rendered_read('https://example.test')
    assert result.ok
    assert [name for name, _ in calls] == ['browser_open','browser_click','get_browser_state']
    assert calls[1][1] == {'target_id':'page', 'tab_id':'tab', 'ref':'reject'}


def test_speed_summary_reports_median_worst_and_strict_budgets_without_running_anything():
    from raphael_core.native_journeys import computer_speed_summary
    summary = computer_speed_summary([{'first_observation': value, 'browser_open': 2, 'run_steps': 3} for value in (1,2,3,4,8)])
    assert summary['first_observation'] == {'median_seconds':3, 'worst_seconds':8, 'budget_seconds':8, 'passed':False}
    assert summary['browser_open']['passed'] and summary['run_steps']['passed'] is None

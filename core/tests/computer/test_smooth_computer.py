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


@pytest.mark.parametrize("failure", ["owner_holds_control", "computer_changed", "tool_error", "blocked"])
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


IMAGE_NAME = "raphael/cua-local-vm:driver-0.37.0-v5"


def answer(code, out="", err="", config="host studio\nuser jack2\nhostname 192.168.8.178\n"):
    calls = []

    async def fake(args):
        calls.append(args)
        return (0, config, "") if args[:2] == ["ssh", "-G"] else (code, out, err)
    return fake, calls


@pytest.mark.parametrize("code,out,err,kind,command", [
    (255, "", "Permission denied (publickey)", "ssh_key", "ssh-keygen -t ed25519\nssh-copy-id studio-mini"),
    (255, "", "ssh: Could not resolve hostname studio-mini: No such host is known.", "ssh_alias_unknown",
     "Host studio-mini\n  HostName HOST_ADDRESS\n  User ACCOUNT_ON_HOST\n  IdentityFile ~/.ssh/id_ed25519"),
    (255, "", "Host key verification failed.", "ssh_hostkey", "ssh studio-mini"),
    (255, "", "@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@\nHost key verification failed.", "ssh_hostkey_changed",
     "ssh-keygen -R 192.168.8.178"),
    (255, "", "ssh: connect to host studio-mini port 22: Connection timed out", "ssh_unreachable", "ssh studio-mini"),
    (255, "", "Host not found", "ssh_unreachable", "ssh studio-mini"),
    (42, "Darwin\n", "", "docker_path", "ssh studio-mini \"echo 'export PATH=/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:/usr/sbin:/sbin' >> ~/.zshenv\""),
    (42, "Linux\n", "", "docker_path", "ssh -t studio-mini \"sudo ln -s /usr/local/bin/docker /usr/bin/docker\""),
    (43, "Linux\n", "", "docker_missing", "ssh -t studio-mini \"curl -fsSL https://get.docker.com | sh\""),
    (43, "Darwin\n", "", "docker_missing", None),
    (44, "Linux\n", "Cannot connect to the Docker daemon", "docker_stopped", "ssh -t studio-mini \"sudo systemctl start docker\""),
    (44, "Darwin\n", "Cannot connect to the Docker daemon", "docker_stopped", "ssh studio-mini \"open -a Docker\""),
    (44, "Linux\n", "permission denied while trying to connect to the Docker daemon socket", "docker_access",
     "ssh -t studio-mini \"sudo usermod -aG docker jack2\""),
    (0, "Linux\naarch64\namd64\n", "", "architecture", f"ssh studio-mini \"docker image rm {IMAGE_NAME}\""),
])
async def test_remote_health_classifies_each_failure_with_the_command_that_fixes_it(monkeypatch, code, out, err, kind, command):
    monkeypatch.setattr("raphael_core.computer.remote_host.sys.platform", "linux")
    fake, calls = answer(code, out, err)
    health = await host_health("studio-mini", run=fake)
    assert not health["ok"] and health["checks"][-1]["kind"] == kind and health["checks"][-1]["ok"] is False
    assert health["checks"][-1].get("command") == command
    assert "Permission denied" not in json.dumps(health)
    assert all(word not in calls[0][-1] for word in ("docker start", "docker run", "docker pull", "docker stop"))


@pytest.mark.parametrize("platform,first", [("win32", "Get-Content $env:USERPROFILE\\.ssh\\id_ed25519.pub | ssh studio-mini \"mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys\""),
                                            ("linux", "ssh-copy-id studio-mini"), ("darwin", "ssh-copy-id studio-mini")])
async def test_a_refused_key_gets_the_key_setup_for_this_computers_system(monkeypatch, platform, first):
    monkeypatch.setattr("raphael_core.computer.remote_host.sys.platform", platform)
    fake, _ = answer(255, "", "Permission denied (publickey)")
    check = (await host_health("studio-mini", run=fake))["checks"][0]
    assert check["command"].splitlines() == ["ssh-keygen -t ed25519", first]


async def test_a_reachable_host_without_an_image_is_healthy_and_asks_for_no_build():
    # A real start pulls and builds the image on the host's own engine (vm.py `build`), so this is a note, not a failure.
    fake, _ = answer(45, "Linux\naarch64\n")
    health = await host_health("studio-mini", run=fake)
    assert health["ok"] and health["checks"][-1] == {"kind": "image_pending", "ok": True}
    assert "command" not in json.dumps(health) and "core/src" not in json.dumps(health)


async def test_every_command_shown_reaches_the_host_or_sets_up_this_computers_ssh():
    from raphael_core.computer.remote_host import repair_command
    kinds = ("ssh_unreachable", "ssh_hostkey", "ssh_hostkey_changed", "ssh_alias_unknown", "ssh_key", "docker_path",
             "docker_missing", "docker_stopped", "docker_access", "architecture")
    for os_name in ("linux", "darwin", ""):
        for kind in kinds:
            command = repair_command(kind, "studio-mini", os_name=os_name, user="jack2", hostname="192.168.8.178")
            for line in command.splitlines():
                assert line.startswith(("ssh ", "ssh-", "Host ", "  ", "Get-Content")), (kind, line)
                assert "core/src" not in line and "docker build" not in line
            if kind.startswith("docker") or kind == "architecture":
                assert command == "" or command.startswith("ssh ") and "studio-mini" in command, (kind, os_name)


async def test_a_matching_arm64_mac_reads_only_the_two_architectures_and_passes():
    # Docker Desktop's full `docker info` JSON (13 KB on the owner's Mac mini) plus the image's passed the
    # 16 KiB read, so the image line was cut and a matching host read as unsupported.
    fake, calls = answer(0, "Darwin\naarch64\narm64\n")
    health = await host_health("mac-mini", run=fake)
    assert health["ok"] and health["checks"][-1] == {"kind": "architecture", "ok": True, "architecture": "arm64"}
    assert calls[0][-1].count("{{.Architecture}}") == 2 and "json" not in calls[0][-1]


async def test_a_refused_key_login_names_the_user_ssh_logged_in_as():
    async def fake(args):
        if args[:2] == ["ssh", "-G"]:
            return 0, "host 192.0.2.42\nuser tester\nhostname 192.0.2.42\n", ""
        return 255, "", "tester@192.0.2.42: Permission denied (publickey,password)."
    health = await host_health("192.0.2.42", run=fake)
    assert health["checks"][0]["user"] == "tester" and set(health["checks"][0]) == {"kind", "ok", "user", "command"}
    assert "Permission denied" not in json.dumps(health)


async def test_ten_remote_docker_calls_share_one_ssh_connection(desktop, monkeypatch, tmp_path):
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
    session._socket_path = lambda: tmp_path / "docker.sock"
    async def probe(endpoint): return True
    session._probe = probe
    vm.remote_sessions["studio-mini"] = session
    vm.real_transport = True
    target = replace(target, remote="studio-mini")
    try:
        for _ in range(10):
            await vm.run_for(target, ["info"])
        assert len(launched) == 1 and len(runtime.calls) == 10
        assert "-L" in launched[0] and "-D" not in launched[0]
        assert all("tcp://" not in arg and "127.0.0.1:" not in arg for arg in launched[0])
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


@pytest.mark.parametrize('layer,memory', [('3', 2), ('4', 3)])
async def test_image_upgrade_announces_before_removal_and_preserves_workspace(desktop, layer, memory):
    vm, target, runtime = desktop
    old_workspace = target.workspace
    runtime.raw["Image"] = "sha256:old-image"
    from raphael_core.computer.vm import LABEL
    runtime.raw["Config"]["Labels"][f"{LABEL}.layer"] = layer
    runtime.raw["Config"]["Env"] = ['VNC_PW=private']
    runtime.raw["HostConfig"].update(Memory=memory * 1024**3, MemorySwap=memory * 1024**3)
    notices = []
    vm.rebuild_notice = lambda target: notices.append(len(runtime.calls))
    result = await vm._upgrade_image(target)
    assert result["state"] == "missing" and target.workspace == old_workspace
    removed = next(index for index, (args, _) in enumerate(runtime.calls) if args[0] == "rm")
    assert notices and notices[0] < removed
    assert all("volume" not in args and "-v" not in args for args, _ in runtime.calls)


async def test_erasing_never_touches_the_shared_workspace_or_a_container_that_is_not_ours(desktop):
    vm, target, runtime = desktop
    assert target.key == "shared"
    with pytest.raises(VmError, match="shared"):
        await vm.erase(target)
    assert not runtime.calls
    from raphael_core.computer.vm import LABEL
    own = vm.target_for("", "0123456789abcdef")
    runtime.raw["Config"]["Labels"].update({f"{LABEL}.owner": "someone-else", f"{LABEL}.target": own.key})
    with pytest.raises(VmError, match="foreign"):
        await vm.erase(own)
    assert not any(args[0] in ("rm", "volume") for args, _ in runtime.calls)


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

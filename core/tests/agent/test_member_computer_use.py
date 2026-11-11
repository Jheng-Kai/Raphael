"""A member uses its computer when its work needs it: no question, no card, no grant. No model calls."""
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from raphael_core.agent.gate import ToolGate
from raphael_core.agent.permissions import PermissionCards
from raphael_core.computer.vm import LocalVm
from raphael_core.computer.vm_tools import VmTools
from raphael_core.services.attachment_store import AttachmentStore
from computer.test_vm import Runtime, Bridge, EmptyHub, container
from .conftest import decision
from .test_permission_cards import chat, finished, typed
from .test_service import make_rig  # noqa: F401


@pytest.fixture
async def computer_owner(tmp_path, conn, make_rig, client):
    runtime = Runtime()
    vm = LocalVm(tmp_path, runner=runtime)
    async def start(target):
        runtime.raw = container(vm, target, runtime)
        return {"ready": True}
    vm.start = AsyncMock(side_effect=start)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Bridge)
    cards = PermissionCards(conn)
    rig = make_rig(plugins=hub, gate=ToolGate(hub, conn=conn), permissions=cards)
    client.decisions.append(decision("answer"))
    client.chats = [chat("I will create it.", ("computer__vm_exec", {"command": "printf hello"})), finished("File created.")]
    return rig, vm, hub, cards


async def test_a_member_never_asked_uses_its_computer_from_the_first_step_with_no_card(computer_owner, client, conn):
    rig, vm, hub, cards = computer_owner
    reply = await typed(rig, "Use the computer to create a file")
    assert reply["status"] == "done" and reply["text"] == "File created."
    assert "confirm" not in reply
    first = {tool["function"]["name"] for tool in client.chat_calls[0]["tools"]}
    assert {"computer__vm_exec", "computer__get_desktop_state"} <= first
    assert not any("request_computer" in name or "computer-access" in name for name in first)
    assert vm.start.await_count >= 1
    assert conn.execute("SELECT COUNT(*) FROM computer_grants").fetchone()[0] == 0


@pytest.mark.parametrize("mode", ["ask", "direct", "plan", "bypass"])
async def test_every_permission_mode_offers_the_same_computer_tools_without_a_question(computer_owner, mode):
    rig, vm, hub, cards = computer_owner
    rig.settings.set("action_mode", "direct")
    await hub.prepare(0)
    baseline = sorted(tool.key for tool in hub.offered_for(0))
    rig.settings.set("action_mode", mode)
    await hub.prepare(0)
    names = sorted(tool.key for tool in hub.offered_for(0))
    assert names == baseline and any(key.endswith("vm_exec") for key in names)
    assert not any("request_computer" in key for key in names)


async def test_turns_without_computer_calls_never_probe_or_start(computer_owner, client):
    rig, vm, hub, cards = computer_owner
    for _ in range(2):
        client.decisions.append(decision("answer"))
        client.chats = [finished("Hello.")]
        reply = await typed(rig, "Hello")
        assert reply["status"] == "done"
        names = {tool["function"]["name"] for tool in client.chat_calls[-1]["tools"]}
        assert "computer__get_desktop_state" in names and "computer__vm_exec" in names
    vm.start.assert_not_awaited()
    assert vm.run.calls == []


async def test_a_pc_without_docker_offers_no_computer_tools(computer_owner, client):
    rig, vm, hub, cards = computer_owner
    vm.desktop = SimpleNamespace(installed=lambda: False)
    client.chats = [finished("Hello.")]
    assert (await typed(rig, "Hello"))["status"] == "done"
    assert not any(tool["function"]["name"].startswith("computer__") for tool in client.chat_calls[-1]["tools"])
    vm.start.assert_not_awaited()
    assert vm.run.calls == []


async def test_first_api_turn_offers_controls_and_refreshes_after_screen(computer_owner, client):
    rig, vm, hub, cards = computer_owner
    client.chats = [chat("Look first.", ("computer__get_desktop_state", {})),
                    chat("Click.", ("computer__click", {})),
                    chat("Check the result.", ("computer__get_window_state", {"pid": 7, "window_id": 9})), finished("Done.")]
    reply = await typed(rig, "Use the computer")
    assert reply["status"] == "done" and reply["text"] == "Done."
    first = {tool["function"]["name"] for tool in client.chat_calls[0]["tools"]}
    second = {tool["function"]["name"] for tool in client.chat_calls[1]["tools"]}
    assert {"computer__click", "computer__browser_open", "computer__browser_type"} <= first
    assert "computer__click" in second
    assert vm.start.await_count == 3
    before = vm.start.await_count
    client.decisions.append(decision("answer"))
    client.chats = [finished("Hello again.")]
    assert (await typed(rig, "Hello"))["status"] == "done"
    assert vm.start.await_count == before


@pytest.mark.parametrize("missing", [False, True], ids=["changed-schema", "missing-screen"])
async def test_real_catalog_replaces_bootstrap_schema_without_forwarding_bad_calls(computer_owner, client, missing):
    rig, vm, hub, cards = computer_owner
    sent = []
    class ChangedBridge(Bridge):
        async def request(self, method, params=None):
            sent.append(method)
            if method == "tools/list":
                return {"tools": [{"name": "click" if missing else "get_desktop_state", "description": "Live tool",
                    "inputSchema": {"type": "object", "properties": {"scope": {"type": "string"}}, "required": ["scope"]}}]}
            return await super().request(method, params)
    hub.bridge = ChangedBridge
    client.chats = [chat("Look.", ("computer__get_desktop_state", {})), finished("The tools changed.")]
    assert (await typed(rig, "Use the computer"))["status"] == "done"
    actual = {tool["function"]["name"]: tool["function"] for tool in client.chat_calls[1]["tools"]}
    if missing:
        assert "computer__get_desktop_state" not in actual and "computer__click" in actual
    else:
        assert actual["computer__get_desktop_state"]["parameters"]["required"] == ["scope"]
    assert sent == ["tools/call", "tools/call", "tools/list"]


@pytest.mark.parametrize("use_computer", [False, True])
async def test_cli_is_lazy_and_reloads_after_first_screen(computer_owner, client, tmp_path, monkeypatch, use_computer):
    import httpx
    from raphael_core.agent.cli.discovery import CliBrains
    from raphael_core.agent.cli.drivers import Event
    rig, vm, hub, cards = computer_owner
    brains = CliBrains(home=tmp_path, environ={}, commands={"codex": ["never-spawn"]})
    monkeypatch.setattr(brains, "available", lambda *args, **kwargs: True)
    rig.service._cli_brains = brains
    rig.settings.set("agent_model", "cli:codex:test")
    sessions, catalogs = [], []

    async def run(driver, **kwargs):
        sessions.append(kwargs.get("session"))
        yield Event("session", "screen-thread")
        async with httpx.AsyncClient(headers={"Authorization": "Bearer " + kwargs["token"]}) as http:
            async def rpc(method, params=None):
                response = await http.post(kwargs["computer_endpoint"], json={
                    "jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}})
                return response.json()["result"]
            names = {tool["name"] for tool in (await rpc("tools/list"))["tools"]}
            catalogs.append(names)
            assert "computer__get_desktop_state" in names
            if use_computer and len(catalogs) == 1:
                assert {"computer__click", "computer__browser_open", "computer__browser_type"} <= names
                result = await rpc("tools/call", {"name": "computer__get_desktop_state", "arguments": {}})
                assert not result["isError"]
                yield Event("tool_end")
                pytest.fail("Reload the discovered catalog before continuing")
            if use_computer:
                assert "computer__click" in names
                result = await rpc("tools/call", {"name": "computer__click", "arguments": {}})
                assert not result["isError"]
                result = await rpc("tools/call", {"name": "computer__get_window_state", "arguments": {"pid": 7, "window_id": 9}})
                assert not result["isError"]
            yield Event("final", "Finished.")

    monkeypatch.setattr("raphael_core.agent.cli.loop.Driver.run", run)
    assert (await typed(rig, "Help me"))["text"] == "Finished."
    if use_computer:
        assert sessions == [None, "screen-thread"]
        assert vm.start.await_count == 3
    else:
        assert sessions == [None]
        vm.start.assert_not_awaited()
        assert vm.run.calls == []



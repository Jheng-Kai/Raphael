"""The existing approval card grants computer tools in the same API turn; no model calls."""
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
    client.chats = [chat("I need the computer.", ("computer__request_computer", {"reason": "Create the requested file"})),
                    chat("I will create it.", ("computer__vm_exec", {"command": "printf hello"})), finished("File created.")]
    return rig, vm, hub, cards


async def test_yes_uses_existing_card_and_adds_tools_to_the_next_model_step(computer_owner, client):
    rig, vm, hub, cards = computer_owner
    asked = await typed(rig, "Use the computer to create a file")
    assert asked["status"] == "confirm" and not vm.grants.allowed(0)
    vm.start.assert_not_awaited()
    card = cards.get(asked["confirm"]["id"])
    assert (card.service, card.tool, card.state, card.always) == ("computer", "request_computer", "pending", False)
    assert "until you revoke access" in card.summary
    assert "until you revoke access" in asked["confirm"]["text"]
    assert "always" not in asked["confirm"]
    first_names = {tool["function"]["name"] for tool in client.chat_calls[0]["tools"]}
    assert "computer__vm_exec" not in first_names
    reply = await rig.call("agent.confirm", {"id": card.id, "approved": True})
    assert reply["status"] == "done" and reply["text"] == "File created."
    assert vm.grants.allowed(0) and cards.get(card.id).state == "allowed"
    assert vm.start.await_count >= 1
    assert "computer__vm_exec" in {tool["function"]["name"] for tool in client.chat_calls[1]["tools"]}
    assert "computer__request_computer" not in {tool["function"]["name"] for tool in client.chat_calls[1]["tools"]}


async def test_granted_turns_without_computer_calls_never_probe_or_start(computer_owner, client):
    rig, vm, hub, cards = computer_owner
    vm.grants.set(0, True)
    for _ in range(2):
        client.decisions.append(decision("answer"))
        client.chats = [finished("Hello.")]
        reply = await typed(rig, "Hello")
        assert reply["status"] == "done"
        names = {tool["function"]["name"] for tool in client.chat_calls[-1]["tools"]}
        assert "computer__get_desktop_state" in names and "computer__vm_exec" in names
        assert "computer__request_computer" not in names
    vm.start.assert_not_awaited()
    assert vm.run.calls == []


async def test_a_pc_without_docker_offers_no_computer_tools(computer_owner, client):
    rig, vm, hub, cards = computer_owner
    vm.grants.set(0, True)
    vm.desktop = SimpleNamespace(installed=lambda: False)
    client.chats = [finished("Hello.")]
    assert (await typed(rig, "Hello"))["status"] == "done"
    assert not any(tool["function"]["name"].startswith("computer__") for tool in client.chat_calls[-1]["tools"])
    vm.start.assert_not_awaited()
    assert vm.run.calls == []


async def test_first_api_turn_offers_controls_and_refreshes_after_screen(computer_owner, client):
    rig, vm, hub, cards = computer_owner
    vm.grants.set(0, True)
    client.chats = [chat("Look first.", ("computer__get_desktop_state", {})),
                    chat("Click.", ("computer__click", {})), finished("Done.")]
    reply = await typed(rig, "Use the computer")
    assert reply["status"] == "done" and reply["text"] == "Done."
    first = {tool["function"]["name"] for tool in client.chat_calls[0]["tools"]}
    second = {tool["function"]["name"] for tool in client.chat_calls[1]["tools"]}
    assert {"computer__click", "computer__browser_open", "computer__browser_type"} <= first
    assert "computer__click" in second
    assert vm.start.await_count == 2
    before = vm.start.await_count
    client.decisions.append(decision("answer"))
    client.chats = [finished("Hello again.")]
    assert (await typed(rig, "Hello"))["status"] == "done"
    assert vm.start.await_count == before


@pytest.mark.parametrize("missing", [False, True], ids=["changed-schema", "missing-screen"])
async def test_real_catalog_replaces_bootstrap_schema_without_forwarding_bad_calls(computer_owner, client, missing):
    rig, vm, hub, cards = computer_owner
    vm.grants.set(0, True)
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
async def test_granted_cli_is_lazy_and_reloads_after_first_screen(computer_owner, client, tmp_path, monkeypatch, use_computer):
    import httpx
    from raphael_core.agent.cli.discovery import CliBrains
    from raphael_core.agent.cli.drivers import Event
    rig, vm, hub, cards = computer_owner
    vm.grants.set(0, True)
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
            assert "computer__get_desktop_state" in names and "computer__request_computer" not in names
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
            yield Event("final", "Finished.")

    monkeypatch.setattr("raphael_core.agent.cli.loop.Driver.run", run)
    assert (await typed(rig, "Help me"))["text"] == "Finished."
    if use_computer:
        assert sessions == [None, "screen-thread"]
        assert vm.start.await_count == 2
    else:
        assert sessions == [None]
        vm.start.assert_not_awaited()
        assert vm.run.calls == []


@pytest.mark.parametrize("answer", ["no", "expiry"])
async def test_no_or_expiry_never_grants_or_starts_and_says_cannot_use_computer(computer_owner, answer):
    rig, vm, hub, cards = computer_owner
    asked = await typed(rig, "Use the computer")
    if answer == "expiry":
        rig.clock.now += 31
    reply = await rig.call("agent.confirm", {"id": asked["confirm"]["id"], "approved": answer != "no"})
    assert not vm.grants.allowed(0)
    vm.start.assert_not_awaited()
    assert "cannot use the computer" in rig.history.get(asked["turn_id"]).text
    assert cards.get(asked["confirm"]["id"]).state == ("denied" if answer == "no" else "expired")


async def test_cli_reloads_mcp_catalog_after_owner_yes_in_the_same_turn(computer_owner, client, tmp_path, monkeypatch):
    import httpx
    from raphael_core.agent.cli.discovery import CliBrains
    from raphael_core.agent.cli.drivers import Event
    rig, vm, hub, cards = computer_owner
    brains = CliBrains(home=tmp_path, environ={}, commands={"codex": ["never-spawn"]})
    monkeypatch.setattr(brains, "available", lambda *args, **kwargs: True)
    rig.service._cli_brains = brains
    rig.settings.set("agent_model", "cli:codex:test")
    catalogs, sessions = [], []

    async def run(driver, **kwargs):
        sessions.append(kwargs.get("session"))
        yield Event("session", "grant-thread")
        async with httpx.AsyncClient(headers={"Authorization": "Bearer " + kwargs["token"]}) as http:
            async def rpc(method, params=None):
                response = await http.post(kwargs["computer_endpoint"], json={
                    "jsonrpc": "2.0", "id": len(catalogs), "method": method, "params": params or {}})
                return response.json()["result"]
            listed = await rpc("tools/list")
            names = {item["name"] for item in listed["tools"]}
            catalogs.append(names)
            if len(catalogs) == 1:
                assert names == {"computer__request_computer"}
                answer = await rpc("tools/call", {"name": "computer__request_computer", "arguments": {"reason": "Create the requested file"}})
                assert not answer["isError"]
                yield Event("tool_end")
                pytest.fail("The CLI must reload before another model step")
            else:
                assert "computer__vm_exec" in names and "computer__request_computer" not in names
                answer = await rpc("tools/call", {"name": "computer__vm_exec", "arguments": {"command": "printf hello"}})
                assert not answer["isError"]
                yield Event("final", "File created through CLI.")

    monkeypatch.setattr("raphael_core.agent.cli.loop.Driver.run", run)
    asked = await typed(rig, "Use the computer to create a file")
    assert asked["status"] == "confirm"
    vm.start.assert_not_awaited()
    result = await rig.call("agent.confirm", {"id": asked["confirm"]["id"], "approved": True})
    assert result["status"] == "done" and result["text"] == "File created through CLI."
    assert len(catalogs) == 2 and sessions == [None, "grant-thread"]
    assert vm.grants.allowed(0)

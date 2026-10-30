"""The existing approval card grants computer tools in the same API turn; no model calls."""
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

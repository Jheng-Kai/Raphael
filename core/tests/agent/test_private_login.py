"""Private login through the real conversation gate, without a browser or provider."""

import json

import pytest

from raphael_core.agent.gate import ToolGate
from raphael_core.agent.safety import DENY, SafetyGuard, SafetyRules
from raphael_core.brain.settings import SettingsStore
from raphael_core.computer.logins import LoginVault
from raphael_core.computer.vm_tools import VmTools
from raphael_core.services.attachment_store import AttachmentStore

from computer.test_vm import desktop, CatalogBridge, EmptyHub  # noqa: F401
from computer.test_login_vault import Vault
from computer.fixtures.driver_contract import bind_page, window_reply
from .test_service import make_rig  # noqa: F401
from .test_narration import chat, typed, use


@pytest.mark.parametrize("deny", [False, True])
async def test_full_permission_login_stays_private_and_an_explicit_deny_wins(desktop, conn, tmp_path, make_rig, client, caplog, deny):
    vm, target, _ = desktop
    private = {"username": 'owner-"\\帳號', "password": 'password-"\\\n密碼'}
    forwarded, events = [], []
    class Browser(CatalogBridge):
        async def request(self, method, params=None):
            if method == "tools/list":
                return {"tools": [{"name": name, "inputSchema": {"type": "object", "properties": {}}}
                                  for name in ("get_browser_state", "browser_type")]}
            if params["name"] == "list_windows":
                return window_reply(self.target)
            forwarded.append(params["name"])
            return {"structuredContent": {"target_id": "tab", "tab_id": "tab-1", "url": "https://example.com/login", **private},
                    "content": [{"type": "text", "text": json.dumps(private)}]}
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Browser)
    hub.logins = LoginVault(Vault())
    reference = hub.logins.reference(0, "https://example.com")
    hub.logins.save(reference, json.dumps(private))
    SettingsStore(conn).set("action_mode", "bypass")
    rules = SafetyRules(conn)
    rule = rules.create("Never fill a saved login", DENY)
    class Judge:
        async def matching(self, *_): return {rule.id} if deny else set()
    gate = ToolGate(hub, conn=conn, safety=SafetyGuard(rules, Judge()))
    rig = make_rig(plugins=hub, gate=gate, notify=lambda *event: events.append(event))
    await hub.prepare()
    await bind_page(hub, vm.target(0))
    forwarded.clear()
    client.chats = [chat("", ("computer__fill_login", {"site": "https://example.com", "reference": reference,
                     "target_id": "tab", "username_ref": "u", "password_ref": "p"})),
                    *([] if deny else [chat("", ("computer__get_browser_state", {"target_id": "tab", "tab_id": "tab-1"}))]),
                    chat('{"text":"Finished."}')]
    try:
        result = await typed(rig, "Fill my saved login")
        assert result["status"] != "confirm"
        assert ("browser_type" in forwarded) is not deny
        assert bool(forwarded) is not deny
        seen = json.dumps([client.chat_calls, events, await rig.turns(), list(conn.iterdump()), result], default=str) + caplog.text
        for value in private.values():
            assert value not in seen and json.dumps(value)[1:-1] not in seen
    finally:
        await hub.aclose()


async def test_contact_values_never_reach_model_history_notifications_or_logs(desktop, conn, tmp_path, make_rig, client, caplog):
    from raphael_core.computer.vault_entries import VaultEntries
    vm, _, _ = desktop
    private = {key: f'private-{key}-"\\\n密碼' for key in ("name", "address", "phone", "email")}
    filled = []
    class Browser(CatalogBridge):
        async def request(self, method, params=None):
            if method == "tools/list":
                return {"tools": [{"name": name, "inputSchema": {"type": "object"}} for name in ("get_browser_state", "browser_type")]}
            if params["name"] == "list_windows":
                return window_reply(self.target)
            if params["name"] == "browser_type": filled.append(params["arguments"]["text"])
            return {"structuredContent": {"target_id": "tab", "tab_id": "tab-1", "url": "https://example.com/contact", **private},
                    "content": [{"type": "text", "text": json.dumps(private)}]}
    events = []
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Browser)
    hub.logins = VaultEntries(Vault(), conn=conn)
    identifier = hub.logins.put({"kind": "contact", "label": "Company", "hint": "Work deliveries", "values": private})
    SettingsStore(conn).set("action_mode", "bypass")
    gate = ToolGate(hub, conn=conn)
    rig = make_rig(plugins=hub, gate=gate, notify=lambda *event: events.append(event))
    await hub.prepare()
    await bind_page(hub, vm.target(0))
    client.chats = [chat("", ("find_tools", {"query": "vault_entries fill_contact"})),
        chat("", use("computer__vault_entries", {})), chat("", use("computer__fill_contact", {"site": "https://example.com", "reference": identifier,
        "label": "Company", "target_id": "tab", "fields": {key: key + "-ref" for key in private}})),
        chat("", ("computer__get_browser_state", {"target_id": "tab", "tab_id": "tab-1"})), chat('{"text":"Finished."}')]
    try:
        result = await typed(rig, "Fill my work contact details")
        assert result["status"] != "confirm"
        assert filled == list(private.values())
        seen = json.dumps([client.chat_calls, events, await rig.turns(), list(conn.iterdump()), result], default=str) + caplog.text
        assert "Work deliveries" in seen
        for value in private.values(): assert value not in seen and json.dumps(value)[1:-1] not in seen
    finally:
        await hub.aclose()


@pytest.mark.parametrize("mode", ["direct", "ask", "plan", "bypass"])
async def test_card_in_the_real_loop_asks_even_with_allow_all(desktop, conn, tmp_path, make_rig, client, mode):
    from raphael_core.computer.vault_entries import VaultEntries
    vm, _, _ = desktop
    calls = []
    class Browser(CatalogBridge):
        async def request(self, method, params=None):
            calls.append(method)
            return await super().request(method, params)
    SettingsStore(conn).set("action_mode", mode)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Browser)
    hub.logins = VaultEntries(Vault(), conn=conn)
    identifier = hub.logins.put({"kind": "card", "label": "Company travel", "hint": "Travel only", "values": {"name": "private-holder", "number": "4111111111111111", "expiry": "private-expiry", "cvc": "private-cvc"}})
    gate = ToolGate(hub, conn=conn)
    from raphael_core.agent.permissions import PermissionCards
    permissions = PermissionCards(conn)
    rig = make_rig(plugins=hub, gate=gate, permissions=permissions)
    client.chats = [chat("", ("find_tools", {"query": "fill_card"})),
        chat("", use("computer__fill_card", {"reference": identifier, "label": "Company travel", "site": "https://shop.example",
        "amount": "NT$ 1,280", "target_id": "tab", "fields": {"number": "n"}}))]
    try:
        result = await typed(rig, "Fill the card for my hotel")
        assert result["status"] == "confirm"
        assert all(word in result["confirm"]["text"] for word in ("Company travel", "https://shop.example", "NT$ 1,280"))
        assert not calls
        assert "always" not in result["confirm"]
        card = permissions.get(result["confirm"]["id"])
        assert card is not None and card.tool == "fill_card" and not card.always
        assert all(word in card.summary for word in ("Company travel", "https://shop.example", "NT$ 1,280"))
    finally:
        await hub.aclose()


"""Synthetic vault, browser and CSV checks; never inspect Windows credentials."""

import json

import pytest

from raphael_core.agent.gate import ToolGate
from raphael_core.agent.policy import Action, Confirmations, Tier
from raphael_core.brain.settings import SettingsStore
from raphael_core.computer.vault_entries import VaultEntries
from raphael_core.computer.vm_tools import VmTools, vm_scope
from raphael_core.services.attachment_store import AttachmentStore
from .test_login_vault import Vault as LoginTestVault
from .test_vm import desktop, CatalogBridge, EmptyHub  # noqa: F401


CONTACT = {"name": "private-owner", "address": "private-address", "phone": "private-phone", "email": "private-email"}
CARD = {"name": "private-holder", "number": "4111111111111111", "expiry": "private-expiry", "cvc": "private-cvc"}


class Vault(LoginTestVault):
    def delete(self, key): self.values.pop(key, None)


def test_private_fill_guidance_survives_the_shared_model_description_limit():
    from raphael_core.agent.plugins import DESCRIPTION_CHARS
    from raphael_core.computer.vm_tools import FILL_LOGIN, FILL_CONTACT, FILL_CARD
    for definition in (FILL_LOGIN, FILL_CONTACT, FILL_CARD):
        offered = definition["description"][:DESCRIPTION_CHARS]
        assert "hint" in offered and "ask_owner" in offered and "submit" in offered
    assert "Every use needs owner approval" in FILL_CARD["description"][:DESCRIPTION_CHARS]
    assert "request_takeover" in FILL_CARD["description"][:DESCRIPTION_CHARS]


def test_entry_sharing_revocation_and_legacy_migration_do_not_store_values(conn):
    from raphael_core.brain import db
    from raphael_core.computer.logins import LoginVault
    vault = Vault()
    old = LoginVault(vault, conn=conn)
    reference = old.reference(0, "https://example.com/login")
    old.save(reference, json.dumps({"username": "old-user", "password": "old-password"}), member=0, site="https://example.com")
    # Recreate exactly the metadata-only migration against the earlier login registry.
    conn.execute("DROP TABLE vault_entries")
    conn.execute("DROP TABLE computer_payment_holds")
    conn.commit()
    conn.executescript(db._MIGRATIONS[63])
    entries = VaultEntries(vault, conn=conn)
    assert entries.load(0, "https://example.com", reference)["password"] == "old-password"
    assert entries.entries()[0]["members"] == [0]
    identifier = entries.put({"kind": "contact", "label": "Travel", "hint": "Use for travel", "values": CONTACT})
    assert entries.entry(200, identifier, "contact")[1] == CONTACT
    with conn:
        conn.execute("UPDATE vault_entries SET members='[0]' WHERE id=?", (identifier,))
    with pytest.raises(ValueError): entries.entry(200, identifier, "contact")
    assert entries.choices(200) == []
    for private in (*CONTACT.values(), "old-password", "old-user"):
        assert private not in repr(list(conn.iterdump()))


@pytest.mark.parametrize("header", ["name,url,username,password", "Title,Url,Username,Password", "title,website,username,password"])
async def test_csv_preview_selection_cancel_expiry_and_single_use_never_write_source(conn, header):
    from raphael_core.protocol import RpcError
    entries = VaultEntries(Vault(), conn=conn)
    handlers = {}
    class Router:
        def register(self, name, handler): handlers[name] = handler
    entries.register(Router())
    text = header + '\nTravel,https://travel.example,private-user,private-password\nOther,https://other.example,other-user,other-password\nBad,http://insecure.example,x,y\n'
    preview = entries.preview(text)
    assert not entries.vault.values and not entries.entries()
    assert preview["rejected"] == 1 and len(preview["entries"]) == 2
    assert "private-user" not in json.dumps(preview) and "private-password" not in json.dumps(preview)
    result = await handlers["vault.import"]({"token": preview["token"], "ids": [0], "members": [0]})
    assert result == {"saved": 1, "remaining": 0} and len(entries.entries()) == 1
    with pytest.raises(RpcError): await handlers["vault.import"]({"token": preview["token"], "ids": [0]})
    preview = entries.preview(text)
    await handlers["vault.cancel"]({"token": preview["token"]})
    assert not entries.previews and len(entries.entries()) == 1
    preview = entries.preview(text)
    entries.previews[preview["token"]] = (0, [])
    with pytest.raises(RpcError): await handlers["vault.import"]({"token": preview["token"], "ids": []})


def test_csv_values_expire_without_another_owner_action_even_after_a_rejected_preview(conn, monkeypatch):
    from types import SimpleNamespace
    callbacks = []
    def later(seconds, callback):
        assert seconds == 600
        callbacks.append(callback)
        return SimpleNamespace(cancel=lambda: None)
    monkeypatch.setattr("asyncio.get_running_loop", lambda: SimpleNamespace(call_later=later))
    entries = VaultEntries(Vault(), conn=conn)
    entries.preview("name,url,username,password\nTravel,https://travel.example,private-user,private-password\n")
    with pytest.raises(ValueError): entries.preview("unsupported")
    assert entries.previews
    callbacks[0]()
    assert not entries.previews and not entries.vault.values


async def test_metadata_edit_does_not_read_or_replace_credentials(conn):
    entries = VaultEntries(Vault(), conn=conn)
    identifier = entries.put({"kind": "contact", "label": "Travel", "values": CONTACT})
    handlers = {}
    class Router:
        def register(self, name, handler): handlers[name] = handler
    entries.register(Router())
    before = dict(entries.vault.values)
    entries.vault.get = lambda *_: pytest.fail("Metadata edit read a private value")
    await handlers["vault.update"]({"id": identifier, "label": "Company", "hint": "Travel only", "members": [0]})
    assert entries.entries()[0]["hint"] == "Travel only" and entries.vault.values == before
    assert not entries.choices(9)


async def test_shared_login_revocation_between_fields_stops_before_the_password(desktop, conn, tmp_path):
    vm, _, _ = desktop
    filled = []
    class Browser(CatalogBridge):
        async def request(self, method, params=None):
            if method == "tools/list":
                return {"tools": [{"name": name, "inputSchema": {"type": "object"}} for name in ("get_browser_state", "browser_type")]}
            if params["name"] == "browser_type":
                filled.append(params["arguments"]["text"])
                with conn:
                    conn.execute("UPDATE vault_entries SET members='[]' WHERE id=?", (identifier,))
            return {"structuredContent": {"target_id": "tab", "url": "https://shop.example/login"}}
    hub = VmTools(EmptyHub(), vm, conn=conn, attachments=AttachmentStore(tmp_path), bridge=Browser)
    hub.logins = VaultEntries(Vault(), conn=conn)
    identifier = hub.logins.put({"kind": "login", "label": "Travel", "origin": "https://shop.example", "values": {"username": "private-user", "password": "private-password"}})
    vm.grants.set(0, True)
    await hub.prepare()
    with vm_scope(("turn", 0, 7), turn_id=7, private=True):
        result = await hub.call(next(t.key for t in hub.offered() if t.name == "fill_login"), {"reference": identifier, "site": "https://shop.example", "target_id": "tab", "username_ref": "u", "password_ref": "p"}, approver="user")
    assert not result.ok and filled == ["private-user"]
    await hub.aclose()


@pytest.mark.parametrize("mode", ["normal", "ask", "plan", "bypass"])
async def test_card_always_needs_an_exact_single_use_approval_and_never_submits(desktop, conn, tmp_path, caplog, mode):
    vm, target, _ = desktop
    calls = []
    class Browser(CatalogBridge):
        async def request(self, method, params=None):
            if method == "tools/list":
                return {"tools": [{"name": name, "inputSchema": {"type": "object"}} for name in ("get_browser_state", "browser_type", "browser_pointer", "browser_navigate")]}
            calls.append(params)
            return {"structuredContent": {"target_id": "tab", "url": "https://shop.example/checkout", "total": "NT$ 1,280", **CARD},
                    "content": [{"type": "text", "text": json.dumps(CARD)}]}
    SettingsStore(conn).set("action_mode", "direct" if mode == "normal" else mode)
    hub = VmTools(EmptyHub(), vm, conn=conn, attachments=AttachmentStore(tmp_path), bridge=Browser)
    hub.logins = VaultEntries(Vault(), conn=conn)
    identifier = hub.logins.put({"kind": "card", "label": "Company", "hint": "Travel only", "values": CARD})
    gate = ToolGate(hub, conn=conn)
    vm.grants.set(0, True)
    await hub.prepare()
    tools = {t.name: t.key for t in hub.offered()}
    args = {"reference": identifier, "label": "Company", "site": "https://shop.example", "amount": "NT$ 1,280", "target_id": "tab", "fields": {key: key + "-ref" for key in CARD}}
    assert gate.needs_confirmation(tools["fill_card"], args)
    with vm_scope(("turn", 0, 7), turn_id=7, private=True):
        assert not (await gate.call_plugin(tools["fill_card"], args)).ok
        assert not calls
        action = Action(tools["fill_card"], args)
        confirmations = Confirmations(lambda: 0)
        pending = confirmations.open("test", 7, action, Tier.T3, "en")
        approval = confirmations.resolve(pending.id, True, pending.digest).approval
        result = await gate.call_plugin(tools["fill_card"], args, action=action, approval=approval)
        assert result.ok and json.loads(result.text)["owner_finishes"]
        assert not (await gate.call_plugin(tools["fill_card"], args, action=action, approval=approval)).ok
        for name, arguments in (("browser_pointer", {}), ("browser_navigate", {"url": "https://shop.example/pay"}), ("vm_exec", {"command": "echo submit"}), ("run_steps", {"steps": [{"name": "browser_pointer", "arguments": {}}], "observe": {"name": "get_browser_state", "arguments": {}}})):
            blocked = await hub.call(tools[name], arguments, approver="user")
            assert not blocked.ok
        observed = await hub.call(tools["get_browser_state"], {"target_id": "tab"}, approver="user")
        assert observed.ok
    assert [call["name"] for call in calls].count("browser_type") == 4
    assert all(call["name"] in ("browser_type", "get_browser_state", "set_config", "set_agent_cursor_enabled") for call in calls)
    seen = repr(result) + repr(observed) + caplog.text + repr(list(conn.iterdump()))
    for value in CARD.values(): assert value not in seen
    restarted = VmTools(EmptyHub(), vm, conn=conn, attachments=AttachmentStore(tmp_path), bridge=Browser)
    assert target.key in restarted.payment_holds
    await hub.aclose()


async def test_worker_pauses_for_card_even_when_all_actions_are_allowed(desktop, conn, tmp_path):
    from types import SimpleNamespace
    from background.test_run import Rig
    from raphael_core.protocol import RpcError
    vm, _, _ = desktop
    hub = VmTools(EmptyHub(), vm, conn=conn, attachments=AttachmentStore(tmp_path), bridge=CatalogBridge)
    hub.logins = VaultEntries(Vault(), conn=conn)
    identifier = hub.logins.put({"kind": "card", "label": "Company", "values": CARD})
    SettingsStore(conn).set("action_mode", "bypass")
    await hub.prepare()
    rig = Rig(conn, SimpleNamespace(hub=hub), can_wait=True)
    try:
        found = await rig.tool("find_tools", {"query": "fill_card"})
        # Found, and called through use_tool: it is never listed (decision 2).
        assert found["ok"] and "computer__fill_card" in found["content"] and "computer__fill_card" not in rig.run.snapshot.listed()
        with vm_scope(("turn", 0, 7), turn_id=7, private=True):
            with pytest.raises(RpcError):
                await rig.tool("use_tool", {"name": "computer__fill_card", "arguments": {
                    "reference": identifier, "label": "Company", "site": "https://shop.example", "target_id": "tab",
                    "amount": "NT$ 1,280", "fields": {"number": "n"}}})
        assert rig.run.waiting is not None and rig.run.waiting.ref.name == "fill_card"
        assert not hub.connections
    finally:
        await rig.meteo.http.aclose()
        await hub.aclose()


@pytest.mark.parametrize("failure", [None, "origin", "amount", "echo", "revoked", "revoked_during_fill"])
async def test_private_fill_fails_closed_and_never_returns_driver_values(desktop, conn, tmp_path, caplog, failure):
    vm, target, _ = desktop
    calls = []
    values = {key: value + '-"\\\n密碼' for key, value in CARD.items()}
    class Browser(CatalogBridge):
        async def request(self, method, params=None):
            if method == "tools/list":
                return {"tools": [{"name": name, "inputSchema": {"type": "object"}} for name in ("get_browser_state", "browser_type")]}
            calls.append(params)
            if params["name"] == "browser_type" and failure == "echo": raise ValueError(json.dumps(values))
            if params["name"] == "browser_type" and failure == "revoked_during_fill":
                with conn:
                    conn.execute("UPDATE vault_entries SET members='[]' WHERE id=?", (identifier,))
            return {"structuredContent": {"target_id": "tab", "url": "https://evil.example" if failure == "origin" else "https://shop.example/checkout", "total": "NT$ 1,280"}}
    hub = VmTools(EmptyHub(), vm, conn=conn, attachments=AttachmentStore(tmp_path), bridge=Browser)
    hub.logins = VaultEntries(Vault(), conn=conn)
    identifier = hub.logins.put({"kind": "card", "label": "Company", "values": values, "members": [0]})
    vm.grants.set(0, True)
    await hub.prepare()
    if failure == "revoked": conn.execute("UPDATE vault_entries SET members='[]' WHERE id=?", (identifier,)); conn.commit()
    with vm_scope(("turn", 0, 7), turn_id=7, private=True):
        result = await hub.call(next(t.key for t in hub.offered() if t.name == "fill_card"), {"reference": identifier, "label": "Company", "site": "https://shop.example", "target_id": "tab", "amount": "NT$ 99" if failure == "amount" else "NT$ 1,280", "fields": {key: key + "-ref" for key in values}}, approver="user")
    assert result.ok is (failure is None)
    if failure in ("origin", "amount", "revoked"): assert not any(call["name"] == "browser_type" for call in calls)
    if failure == "revoked_during_fill": assert sum(call["name"] == "browser_type" for call in calls) == 1
    seen = repr(result) + caplog.text + repr(list(conn.iterdump()))
    for value in values.values():
        assert value not in seen and json.dumps(value)[1:-1] not in seen
    await hub.aclose()

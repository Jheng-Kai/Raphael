import json

import pytest

from raphael_core.computer.logins import LoginVault
from .test_vm import desktop, CatalogBridge, EmptyHub
from .fixtures.driver_contract import bind_page, catalog, window_reply


@pytest.mark.parametrize("failure", [False, True])
async def test_private_values_and_json_escapes_never_reach_results_or_errors(desktop, tmp_path, conn, caplog, failure):
    from raphael_core.computer.vm import VmError
    from raphael_core.computer.vm_tools import VmTools, vm_scope
    from raphael_core.services.attachment_store import AttachmentStore
    from raphael_core.brain.settings import SettingsStore
    vm, target, _ = desktop
    password, username = 'secret-"\\\n密碼', 'owner-"\\帳號'
    class Browser(CatalogBridge):
        async def request(self, method, params=None):
            if method == "tools/call" and params["name"] == "list_windows":
                return window_reply(self.target)
            if method == "tools/list":
                return catalog(("get_browser_state", "browser_type"))
            if params["name"] == "get_browser_state":
                return {"structuredContent": {"target_id": "tab", "tab_id": "tab-1", "page": {"url": "https://example.com/login"}}}
            if failure and params["name"] == "browser_type":
                raise VmError(json.dumps({"password": password, "username": username}))
            return {"content": [{"type": "text", "text": json.dumps([password, username])}]}
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Browser)
    SettingsStore(conn).set("action_mode", "bypass")
    hub.logins = LoginVault(Vault())
    reference = hub.logins.reference(0, "https://example.com")
    hub.logins.save(reference, json.dumps({"username": username, "password": password}))
    await hub.prepare()
    await bind_page(hub, target)
    tool = next(item for item in hub.offered() if item.name == "fill_login")
    args = {"reference": reference, "site": "https://example.com", "target_id": "tab", "username_ref": "u", "password_ref": "p"}
    with vm_scope(("turn", 0, 7), turn_id=7, private=True):
        result = await hub.call(tool.key, args, approver="auto")
    assert result.ok is not failure
    assert json.loads(result.text) == {"filled": not failure}
    seen = repr(result) + json.dumps(vars(result)) + caplog.text + repr(list(conn.iterdump()))
    for value in (password, username):
        assert value not in seen and json.dumps(value)[1:-1] not in seen
    await hub.aclose()


class Vault:
    def __init__(self): self.values = {}
    def get(self, key): return self.values.get(key)
    def set(self, key, value): self.values[key] = value


def test_login_reference_is_bound_to_member_and_https_origin_and_redacts_every_value():
    vault = LoginVault(Vault())
    reference = vault.reference(2, "https://example.com/login")
    vault.save(reference, json.dumps({"username": "private-owner", "password": "never-send-this"}))
    assert vault.load(2, "https://example.com", reference)["password"] == "never-send-this"
    with pytest.raises(ValueError): vault.load(3, "https://example.com", reference)
    with pytest.raises(ValueError): vault.load(2, "https://evil.example", reference)
    with pytest.raises(ValueError): vault.reference(2, "http://example.com")
    assert "never-send-this" not in vault.redact(2, "result: private-owner never-send-this")
    assert "private-owner" not in vault.redact(2, "result: private-owner never-send-this")


async def test_fill_login_uses_the_owned_connection_and_never_returns_driver_echoes(desktop, tmp_path, caplog):
    from raphael_core.computer.vm_tools import VmTools, vm_scope
    from raphael_core.services.attachment_store import AttachmentStore
    vm, target, runtime = desktop
    class Browser(CatalogBridge):
        calls = []
        async def request(self, method, params=None):
            if method == "tools/call" and params["name"] == "list_windows":
                return window_reply(self.target)
            if method == "tools/list":
                return catalog(("get_browser_state", "browser_type"))
            self.calls.append(params)
            if params["name"] == "get_browser_state":
                return {"structuredContent": {"target_id": "bt-1", "tabs": [{"tab_id": "tab-1", "active": True, "url": "https://example.com/login"}]}}
            return {"content": [{"type": "text", "text": "private-owner never-send-this"}]}
    vault = LoginVault(Vault())
    reference = vault.reference(0, "https://example.com")
    vault.save(reference, json.dumps({"username": "private-owner", "password": "never-send-this"}))
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Browser)
    hub.logins = vault
    await hub.prepare()
    await hub._discover(target)
    await bind_page(hub, target)
    tool = next(item for item in hub.offered() if item.name == "fill_login")
    with vm_scope(("turn", 0, 7), turn_id=7, private=True):
        result = await hub.call(tool.key, {"reference": reference, "site": "https://example.com", "target_id": "bt-1", "username_ref": "u", "password_ref": "p"}, approver="auto")
    assert result.ok and json.loads(result.text) == {"filled": True}
    assert len({call["arguments"]["session"] for call in Browser.calls}) == 1
    assert [call["arguments"]["text"] for call in Browser.calls if call["name"] == "browser_type"] == ["private-owner", "never-send-this"]
    assert all(call["arguments"]["tab_id"] == "tab-1" for call in Browser.calls if call["name"] == "browser_type")
    assert "private-owner" not in repr(result) + caplog.text and "never-send-this" not in repr(result) + caplog.text
    with vm_scope(("turn", 0, 7), turn_id=7, private=True):
        wrong = await hub.call(tool.key, {"reference": reference, "site": "https://evil.example", "target_id": "bt-1", "username_ref": "u", "password_ref": "p"}, approver="auto")
    assert not wrong.ok and json.loads(wrong.text) == {"filled": False}
    assert len([call for call in Browser.calls if call["name"] == "browser_type"]) == 2
    await hub.aclose()


async def test_the_existing_secret_card_saves_only_to_the_vault_and_resumes_once(tmp_path, conn, caplog):
    from test_secret_cards import Rig
    rig = Rig(tmp_path, conn)
    rig.cards.logins = LoginVault(rig.vault)
    reference, cards = rig.cards.show_login(turn_id=rig.turn, member_id=0, conversation_id=None,
        site="https://example.com/login", language="en")
    [card] = cards
    password = "private-login-" + rig.key + '"\\\n密碼'
    value = json.dumps({"username": "private-owner", "password": password})
    saved, state = await rig.save(card, value)
    assert saved["saved"] and state.state == "resumed" and state.view()["login"]
    assert rig.cards.logins.load(0, "https://example.com", reference)["password"] == password
    assert rig.resume.calls == [(rig.turn, 1)]
    seen = rig.everything() + json.dumps(saved) + repr(rig.resume.calls) + caplog.text
    assert password not in seen and json.dumps(password)[1:-1] not in seen and "private-owner" not in seen
    assert rig.cards.show_login(turn_id=rig.turn, member_id=0, conversation_id=None, site="https://example.com", language="en") == (reference, [])
    await rig.save(card, value)
    assert rig.resume.calls == [(rig.turn, 1)]


async def test_removing_the_request_turn_keeps_restart_redaction_for_the_saved_login(desktop, tmp_path, conn):
    from test_secret_cards import Rig
    from raphael_core.computer.vm_tools import VmTools, vm_scope
    from raphael_core.services.attachment_store import AttachmentStore
    rig = Rig(tmp_path, conn)
    rig.cards.logins = LoginVault(rig.vault, conn=conn)
    _, cards = rig.cards.show_login(turn_id=rig.turn, member_id=0, conversation_id=None,
        site="https://example.com", language="en")
    private = {"username": "private-owner", "password": 'private-"\\密碼'}
    await rig.save(cards[0], json.dumps(private))
    with conn:
        conn.execute("DELETE FROM agent_turns WHERE id=?", (rig.turn,))
    assert not rig.cards.cards_of(rig.turn)
    class Browser(CatalogBridge):
        async def request(self, method, params=None):
            if method == "tools/call" and params["name"] == "list_windows":
                return window_reply(self.target)
            if method == "tools/list":
                return {"tools": [{"name": "get_browser_state", "inputSchema": {"type": "object"}}]}
            return {"structuredContent": {"target_id": "bound-own", **private}, "content": [{"type": "text", "text": json.dumps(private)}]}
    vm, target, _ = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Browser)
    hub.logins = LoginVault(rig.vault, conn=conn)
    await hub.prepare()
    await hub._discover(target)
    await bind_page(hub, target)
    tool = next(item for item in hub.offered() if item.name == "get_browser_state")
    with vm_scope(("turn", 0, 9), turn_id=9, private=True):
        result = await hub.call(tool.key, {"target_id": "bound-own", "tab_id": "tab-1"}, approver="auto")
    assert result.ok and "[private]" in result.text
    for value in private.values():
        assert value not in repr(result) and json.dumps(value)[1:-1] not in repr(result)
    await hub.aclose()


@pytest.mark.parametrize("shared", [False, True])
@pytest.mark.parametrize("shape", ["snapshot", "active", "ambiguous", "unseen", "lost-active"])
async def test_fill_and_private_picture_use_only_the_tab_observed_for_this_connection(desktop, tmp_path, shared, shape):
    from raphael_core.computer.vm_tools import VmTools
    from raphael_core.services.attachment_store import AttachmentStore
    vm, _, _ = desktop
    vm.settings.set("computer_vm_mode", "shared" if shared else "per-bot")
    calls = []
    class Browser(CatalogBridge):
        url = "https://example.com/login"
        async def request(self, method, params=None):
            if method == "tools/list":
                return catalog(("get_browser_state", "browser_type"))
            if params["name"] == "list_windows":
                return window_reply(self.target)
            if params["name"] in ("get_browser_state", "browser_type"):
                calls.append(params)
            if params["name"] == "get_browser_state":
                page = {"target_id": "own", "page": {"url": self.url}}
                if "target_id" in params["arguments"]:
                    assert params["arguments"]["tab_id"] == "exact-tab"
                    page.update(nodes=[], truncated=False, has_more=False)
                    if shape == "lost-active":
                        page["tabs"] = [{"tab_id": "exact-tab"}]
                    else:
                        page["tab_id"] = "exact-tab"
                elif shape == "snapshot":
                    page["tab_id"] = "exact-tab"
                else:
                    page["tabs"] = [{"tab_id": "other"}, {"tab_id": "exact-tab", "active": shape in ("active", "lost-active")}]
                return {"structuredContent": page}
            return {"content": []}
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Browser)
    hub.logins = LoginVault(Vault())
    reference = hub.logins.reference(0, "https://example.com")
    hub.logins.save(reference, json.dumps({"username": "owner", "password": "secret"}))
    await hub.prepare()
    target = vm.target(0)
    if shape != "unseen":
        await bind_page(hub, target)
    args = dict(reference=reference, site="https://example.com", target_id="own", username_ref="u", password_ref="p")
    result = await hub._fill_login(target, 0, args)
    assert result.ok is (shape in ("snapshot", "active"))
    typed = [call for call in calls if call["name"] == "browser_type"]
    assert len(typed) == (2 if result.ok else 0)
    assert all(call["arguments"]["tab_id"] == "exact-tab" for call in typed)
    if not result.ok:
        reads = [call for call in calls if call["arguments"].get("target_id")]
        assert len(reads) == (1 if shape == "lost-active" else 0)
    hub._protect_page(target, "own", "https://example.com", ("p",))
    assert await hub._private_picture(target, {})
    Browser.url = "https://other.example/done"
    assert (await hub._private_picture(target, {})) is (not result.ok)
    hub._protect_page(target, "own", "https://example.com", ("p",))
    await hub._disconnect(target.key)
    assert not any(key[0] == target.key for key in hub.page_tabs)
    count = len(calls)
    assert await hub._private_picture(target, {})
    assert len(calls) == count
    await hub.aclose()

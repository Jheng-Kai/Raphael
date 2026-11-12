"""A saved login must not take away ordinary tools or their visual results."""

import json

import pytest

from .fixtures.semantic_browser import measured, member_ref

from raphael_core.agent.plugins import PluginResult
from raphael_core.computer.logins import LoginVault
from raphael_core.computer.vm_tools import VmTools, vm_scope
from raphael_core.services.attachment_store import AttachmentStore
from .test_login_vault import Vault
from .test_vm import desktop, Bridge, EmptyHub
from .fixtures.driver_contract import bind_page


class Browser(Bridge):
    url = "https://example.com/login"
    @measured()
    async def request(self, method, params=None):
        if method == "tools/list":
            return {"tools": [{"name": name, "inputSchema": {"type": "object"}}
                              for name in ("get_desktop_state", "get_browser_state", "browser_type", "browser_navigate")]}
        if params["name"] == "list_windows":
            from copy import deepcopy
            result = await super().request(method, params)
            second = deepcopy(result["structuredContent"]["windows"][0])
            second["window_id"] = 11
            second["bounds"]["x"] = 100
            result["structuredContent"]["windows"].append(second)
            return result
        if params["name"] == "browser_navigate":
            type(self).url = params["arguments"]["url"]
        picture = await super().request(method, params)
        identifier = "other" if params["arguments"].get("window_id") == 11 else "tab"
        return {**picture, "structuredContent": {"target_id": params["arguments"].get("target_id", identifier), "tab_id": "tab-1", "url": self.url}}


async def rig(desktop, tmp_path):
    vm, target, _ = desktop
    Browser.url = "https://example.com/login"
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Browser)
    hub.logins = LoginVault(Vault())
    reference = hub.logins.reference(0, "https://example.com")
    hub.logins.save(reference, json.dumps({"username": "private-owner", "password": 'private-"\\secret'}))
    hub.logins.load(0, "https://example.com", reference)
    await hub.prepare()
    await hub._discover(target)
    await bind_page(hub, target)
    await bind_page(hub, target, window_id=11)
    return hub, {tool.name: tool.key for tool in hub.offered()}, reference


async def test_saved_but_unfilled_login_does_not_hide_any_screenshot(desktop, tmp_path):
    hub, tools, _ = await rig(desktop, tmp_path)
    with vm_scope(("turn", 0, 7), turn_id=7):
        result = await hub.call(tools["get_desktop_state"], {}, approver="auto")
        assert result.blocks
    await hub.aclose()


@pytest.mark.parametrize("recovery", ["navigation", "expiry", "other-target", "desktop-navigation"])
async def test_picture_suppression_survives_navigation_time_and_other_tabs(desktop, tmp_path, recovery):
    hub, tools, reference = await rig(desktop, tmp_path)
    with vm_scope(("turn", 0, 7), turn_id=7):
        filled = await hub.call(tools["fill_login"], {"reference": reference, "site": "https://example.com",
            "target_id": "tab", "username_ref": member_ref(hub, hub.vm.target(0), "tab", "username"), "password_ref": member_ref(hub, hub.vm.target(0), "tab", "password")}, approver="auto")
        assert filled.ok
        hidden = await hub.call(tools["get_browser_state"], {"target_id": "tab", "tab_id": "tab-1"}, approver="auto")
        assert not hidden.blocks
        args, tool = {"target_id": "tab", "tab_id": "tab-1"}, tools["get_browser_state"]
        if recovery == "navigation":
            tool = tools["browser_navigate"]
            args["url"] = "https://example.com/done"
            args["tab_id"] = "tab-1"
        elif recovery == "expiry":
            hub.vm.clock = lambda: 121
        elif recovery == "other-target":
            args["target_id"] = "other"
        else:
            Browser.url = "https://example.com/done"
            args, tool = {}, tools["get_desktop_state"]
        recovered = await hub.call(tool, args, approver="auto")
        assert not recovered.blocks
    await hub.aclose()


async def test_a_colleagues_saved_login_does_not_blind_a_shared_computer(desktop, tmp_path):
    hub, tools, _ = await rig(desktop, tmp_path)
    await hub.prepare(2)
    await hub._discover(hub.vm.target(2))
    tools = {tool.name: tool.key for tool in hub.offered_for(2)}
    with vm_scope(("turn", 2, 7), turn_id=7):
        assert (await hub.call(tools["get_desktop_state"], {}, approver="auto")).blocks
    await hub.aclose()


async def test_delegate_results_pass_through_untouched_even_after_a_fill(desktop, tmp_path):
    hub, tools, reference = await rig(desktop, tmp_path)
    original = PluginResult(True, text="private-owner", blocks=[{"type": "image", "data": "unchanged"}],
                            page={"html": "private-owner"}, mcp_result={"calendar": "private-owner"})
    class Delegate(EmptyHub):
        async def call(self, *args, **kwargs): return original
    hub.delegate = Delegate()
    with vm_scope(("turn", 0, 7), turn_id=7):
        await hub.call(tools["fill_login"], {"reference": reference, "site": "https://example.com",
            "target_id": "tab", "username_ref": member_ref(hub, hub.vm.target(0), "tab", "username"), "password_ref": member_ref(hub, hub.vm.target(0), "tab", "password")}, approver="auto")
        result = await hub.call("external__show_page", {}, approver="auto")
    assert result is original and result.text == "private-owner" and result.blocks
    assert result.page == {"html": "private-owner"} and result.mcp_result == {"calendar": "private-owner"}
    await hub.aclose()


@pytest.mark.parametrize("stage", ["references", "load"])
async def test_unreadable_vault_never_fails_prepare_or_leaks_diagnostics(desktop, tmp_path, caplog, stage):
    hub, tools, reference = await rig(desktop, tmp_path)
    def broken(*_): raise OSError('private-owner private-"\\secret')
    hub.logins.references = lambda *_: [{"member_id": 0, "origin": "https://example.com", "reference": reference}]
    setattr(hub.logins, stage, broken)
    hub.logins.vault.get = broken
    await hub.prepare()
    with vm_scope(("turn", 0, 7), turn_id=7):
        result = await hub.call(tools["fill_login"], {"reference": reference, "site": "https://example.com",
            "target_id": "tab", "username_ref": member_ref(hub, hub.vm.target(0), "tab", "username"), "password_ref": member_ref(hub, hub.vm.target(0), "tab", "password")}, approver="auto")
    assert not result.ok and json.loads(result.text) == {"filled": False}
    assert "OSError" in caplog.text and "private-owner" not in caplog.text
    await hub.aclose()


@pytest.mark.parametrize('shared', [False, True])
@pytest.mark.parametrize('clearance', ['origin', 'fields'])
async def test_another_tab_read_or_rebind_never_lifts_the_visible_private_tab(desktop, tmp_path, shared, clearance):
    from .test_vm import CatalogBridge
    from .fixtures.driver_contract import catalog, window_reply
    from .test_vm import container
    vm, _, runtime = desktop
    vm.settings.set('computer_vm_mode', 'shared' if shared else 'per-bot')
    runtime.raw = container(vm, vm.target(), runtime)
    probes = []
    class Tabs(CatalogBridge):
        left = False
        gone = False
        @measured()
        async def request(self, method, params=None):
            if method == 'tools/list':
                return catalog(('get_browser_state', 'browser_type', 'get_window_state'))
            name, args = params['name'], params['arguments']
            if name == 'list_windows':
                return window_reply(self.target)
            if name == 'get_browser_state':
                tab = args.get('tab_id', 'private-tab')
                identifier = args.get('target_id', 'own')
                probes.append((identifier, tab))
                url = 'https://other.example/' if tab != 'private-tab' or self.left else 'https://example.com/login'
                return {'structuredContent': {'target_id': identifier, 'tab_id': tab, 'page': {'url': url}}}
            if name == 'get_window_state':
                return await Bridge.request(self, method, params)
            return {'content': []}
    original = Tabs.request
    async def request(self, method, params=None):
        reply = await original(self, method, params)
        if self.gone and method == 'tools/call' and params['name'] == 'get_browser_state':
            reply['structuredContent']['refs'] = []
        return reply
    Tabs.request = request
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Tabs)
    hub.logins = LoginVault(Vault())
    reference = hub.logins.reference(0, 'https://example.com')
    hub.logins.save(reference, json.dumps({'username': 'synthetic-user', 'password': 'synthetic-secret'}))
    await hub.prepare()
    target = vm.target()
    await bind_page(hub, target)
    tools = {t.name: t.key for t in hub.offered()}
    with vm_scope(('turn', 0, 31), turn_id=31):
        refs = {name: member_ref(hub, target, 'own', name) for name in ('username', 'password')}
        # Rebinding yields new IDs without invalidating the old target/tab or its refs.
        await bind_page(hub, target)
        assert (target.key, 'own-bind1', 'private-tab-bind1') in hub.page_refs
        assert (await hub.call(tools['browser_type'], {'target_id': 'own', 'tab_id': 'private-tab', 'ref': refs['username'], 'text': 'first'}, approver='auto')).ok
        # Select the original tab through a member read, then fill it.
        await hub.call(tools['get_browser_state'], {'target_id': 'own', 'tab_id': 'private-tab'}, approver='auto')
        result = await hub.call(tools['fill_login'], dict(reference=reference, site='https://example.com', target_id='own',
            username_ref=member_ref(hub, target, 'own', 'username'), password_ref=member_ref(hub, target, 'own', 'password')), approver='auto')
        assert result.ok and (target.key, 'own', 'private-tab') in hub.private_pages
        other = await hub.call(tools['get_browser_state'], {'target_id': 'own', 'tab_id': 'other-tab'}, approver='auto')
        assert other.ok and (target.key, 'own', 'private-tab') in hub.private_pages
        assert hub.page_tabs[target.key, 'own'] == 'other-tab'
        shown = json.loads(other.text.splitlines()[0])
        shown_refs = {row['name']: row['ref'] for row in shown['refs']}
        # The privacy response actually showed A's latest tree while the current tab remains B.
        # Those member-visible refs must still resolve to A, never B.
        assert shown['tab_id'] == 'private-tab'
        again = await hub.call(tools['fill_login'], dict(reference=reference, site='https://example.com', target_id='own',
            username_ref=shown_refs['username'], password_ref=shown_refs['password']), approver='auto')
        assert again.ok and hub.page_tabs[target.key, 'own'] == 'other-tab'
        before = len(probes)
        picture = await hub.call(tools['get_window_state'], {'pid': 1, 'window_id': 1, 'include_screenshot': True}, approver='auto')
        assert not picture.blocks and (target.key, 'own', 'private-tab') in hub.private_pages
        assert ('own', 'private-tab') in probes[before:]
        assert hub.page_tabs[target.key, 'own'] == 'other-tab'
        await bind_page(hub, target)
        assert (target.key, 'own', 'private-tab') in hub.private_pages
        Tabs.left = clearance == 'origin'
        Tabs.gone = clearance == 'fields'
        # Only the marked tab's own complete read can lift its protection, and only once it shows another origin.
        await hub.call(tools['get_browser_state'], {'target_id': 'own', 'tab_id': 'private-tab'}, approver='auto')
        if clearance == 'fields':
            # Losing the fields on the same origin lifts nothing: the next page of a site may show what was filled.
            assert (target.key, 'own', 'private-tab') in hub.private_pages
            assert not (await hub.call(tools['get_window_state'], {'pid': 1, 'window_id': 1, 'include_screenshot': True}, approver='auto')).blocks
            assert (target.key, 'own', 'private-tab') in hub.private_pages
            Tabs.left = True
            await hub.call(tools['get_browser_state'], {'target_id': 'own', 'tab_id': 'private-tab'}, approver='auto')
        assert not hub.private_pages
        assert (await hub.call(tools['get_window_state'], {'pid': 1, 'window_id': 1, 'include_screenshot': True}, approver='auto')).blocks
    await hub.aclose()

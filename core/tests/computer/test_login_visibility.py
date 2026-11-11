"""A saved login must not take away ordinary tools or their visual results."""

import json

import pytest

from raphael_core.agent.plugins import PluginResult
from raphael_core.computer.logins import LoginVault
from raphael_core.computer.vm_tools import VmTools, vm_scope
from raphael_core.services.attachment_store import AttachmentStore
from .test_login_vault import Vault
from .test_vm import desktop, Bridge, EmptyHub


class Browser(Bridge):
    url = "https://example.com/login"
    async def request(self, method, params=None):
        if method == "tools/list":
            return {"tools": [{"name": name, "inputSchema": {"type": "object"}}
                              for name in ("get_desktop_state", "get_browser_state", "browser_type", "browser_navigate")]}
        if params["name"] == "browser_navigate":
            type(self).url = params["arguments"]["url"]
        picture = await super().request(method, params)
        return {**picture, "structuredContent": {"target_id": params["arguments"].get("target_id", "tab"), "url": self.url}}


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
            "target_id": "tab", "username_ref": "u", "password_ref": "p"}, approver="auto")
        assert filled.ok
        hidden = await hub.call(tools["get_browser_state"], {"target_id": "tab"}, approver="auto")
        assert not hidden.blocks
        args, tool = {"target_id": "tab"}, tools["get_browser_state"]
        if recovery == "navigation":
            tool = tools["browser_navigate"]
            args["url"] = "https://example.com/done"
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
            "target_id": "tab", "username_ref": "u", "password_ref": "p"}, approver="auto")
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
            "target_id": "tab", "username_ref": "u", "password_ref": "p"}, approver="auto")
    assert not result.ok and json.loads(result.text) == {"filled": False}
    assert "OSError" in caplog.text and "private-owner" not in caplog.text
    await hub.aclose()

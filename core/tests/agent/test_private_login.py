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
from .test_service import make_rig  # noqa: F401
from .test_narration import chat, typed


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
            forwarded.append(params["name"])
            return {"structuredContent": {"target_id": "tab", "url": "https://example.com/login", **private},
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
    client.chats = [chat("", ("computer__fill_login", {"site": "https://example.com", "reference": reference,
                     "target_id": "tab", "username_ref": "u", "password_ref": "p"})),
                    *([] if deny else [chat("", ("computer__get_browser_state", {"target_id": "tab"}))]),
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


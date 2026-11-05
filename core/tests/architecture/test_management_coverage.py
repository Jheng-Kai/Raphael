"""Every UI core method and settings key requires an explicit boundary decision."""

import re
from pathlib import Path

from raphael_core.brain.settings import DEFAULTS
from raphael_core.management import ACTIONS, DEFINITIONS, GROUPS, INTERACTION_RPCS, OWNER_ONLY, OWNER_ONLY_SETTINGS, READ_ONLY_RPCS

ROOT = Path(__file__).resolve().parents[3]


def ui_methods(api, rust):
    block = re.search(r"const ALLOWED_METHODS:[^=]+?=\s*&?\[(.*?)\];", rust, re.S)
    assert block
    named = set(re.findall(r'^\s*"([a-z][a-z0-9_.]+)"', block[1], re.M))
    called = set(re.findall(r'\b(?:core(?:<[^;\n]*?>)?|connectorCall)\(\s*"([a-z][a-z0-9_.]+)"', api))
    prefixes = re.search(r"const ALLOWED_PREFIXES:[^=]+?=\s*\[(.*?)\];", rust, re.S)
    assert prefixes
    allowed = tuple(re.findall(r'"([a-z][a-z0-9_.]+)"', prefixes[1]))
    assert all(method in named or method.startswith(allowed) for method in called)
    return named | called


def unclassified(methods):
    return methods - {item.rpc for item in ACTIONS} - OWNER_ONLY.keys() - INTERACTION_RPCS.keys() - READ_ONLY_RPCS - {"settings.set"}


def test_every_ui_rpc_has_an_explicit_management_or_owner_boundary():
    api = (ROOT / "app/src/main/api.ts").read_text(encoding="utf-8")
    rust = (ROOT / "app/src-tauri/src/commands.rs").read_text(encoding="utf-8")
    assert not unclassified(ui_methods(api, rust))
    # A future mutation must fail even if it uses an allowed prefix.
    assert unclassified(ui_methods(api + '\ncore("integrations.erase_everything", {});', rust)) == {"integrations.erase_everything"}
    assert unclassified(ui_methods(api, rust.replace('"rooms.update",', '"rooms.update",\n"rooms.erase_everything",'))) == {"rooms.erase_everything"}


def test_settings_are_classified_by_key_and_never_expose_generic_writes():
    managed = {item.setting for item in ACTIONS if item.setting}
    assert not managed & OWNER_ONLY_SETTINGS.keys()
    assert set(DEFAULTS) == managed | OWNER_ONLY_SETTINGS.keys()
    assert set(DEFINITIONS["settings_update"]["parameters"]["properties"]["key"]["enum"]) == managed
    assert all(item.setting or item.rpc != "settings.set" for item in ACTIONS)
    assert all(OWNER_ONLY.values()) and all(OWNER_ONLY_SETTINGS.values())


def test_owner_only_rpc_cannot_become_a_direct_tool_by_adding_a_row():
    assert len({item.name for item in ACTIONS}) == len(ACTIONS)
    for item in ACTIONS:
        assert item.rpc not in OWNER_ONLY or (item.name == "add_mcp_server" and item.service == "connection")
        assert item.schema["additionalProperties"] is False
    for name, rows in GROUPS.items():
        assert set(DEFINITIONS[name]["parameters"]["properties"]["action"]["enum"]) == {item.name for item in rows}


def test_vault_rpcs_are_owner_only_without_model_or_private_read_settings():
    methods = {"vault.list", "vault.add", "vault.update", "vault.remove", "vault.preview", "vault.cancel", "vault.import"}
    assert {name for name in OWNER_ONLY if name.startswith("vault.")} == methods
    assert not unclassified(methods)
    assert not methods & ({item.rpc for item in ACTIONS} | READ_ONLY_RPCS | INTERACTION_RPCS.keys())
    assert not any(key.startswith("vault") for key in DEFAULTS)
    assert not any(item.rpc.startswith("vault.") or (item.setting or "").startswith("vault") for item in ACTIONS)


def test_owner_import_upload_and_routine_test_do_not_add_model_authority():
    assert "memory.import" in OWNER_ONLY
    assert {"attachments.info", "attachments.upload", "routines.run"} <= INTERACTION_RPCS.keys()
    assert {"routine_timezone", "routine_detected_timezone"} <= OWNER_ONLY_SETTINGS.keys()
    assert not {"memory.import", "attachments.info", "attachments.upload", "routines.run"} & {item.rpc for item in ACTIONS}
    from raphael_core.management import resolve
    from raphael_core.protocol import RpcError
    import pytest

    for key in ("routine_timezone", "routine_detected_timezone", "auto_update"):
        with pytest.raises(RpcError):
            resolve("settings_update", {"key": key, "value": "UTC"})


def test_chat_metadata_rpcs_remain_owner_interactions_without_model_authority():
    methods = {"agent.react", "rooms.react", "rooms.thread_open"}
    assert methods <= INTERACTION_RPCS.keys()
    assert not unclassified(methods)
    assert not methods & ({item.rpc for item in ACTIONS} | READ_ONLY_RPCS | OWNER_ONLY.keys())


def test_primary_native_offer_stays_bounded_with_all_management_areas():
    from raphael_core.agent.speaker import Speaker
    from raphael_core.agent.team import TEAM_TOOLS
    from raphael_core.background.snapshot import take_snapshot

    snapshot = take_snapshot(None, "members folders group chats conversations connections models settings", speaker=Speaker(capabilities=frozenset({"chief"})), team=TEAM_TOOLS,
                             memory=True, attachments=True, interactive=True)
    from raphael_core.agent.plugins import MAX_OFFERED
    assert "member_create" in snapshot.refs
    assert "create_member" not in snapshot.refs
    assert "slack_draft" not in snapshot.refs
    snapshot.find("slack_draft")
    assert "slack_draft" in snapshot.refs
    assert len(snapshot.definitions) + MAX_OFFERED + 1 <= 128  # Reserve plugins and Claude's approval tool.

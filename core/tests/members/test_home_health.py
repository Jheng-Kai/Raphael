"""Home projects only in-use offline diagnostics, with owner-facing names."""

import pytest

from raphael_core.home_digest import health
from raphael_core.ui_words import NEW_LANGUAGES, ui_word


def observe(rig, **data):
    rig.background.diagnostics = lambda speaker, turn: {"memory": {"status": "ok"}, **data}
    return health(rig.service, rig.language)["checks"]


@pytest.mark.parametrize("installed,chosen,expected", [
    (False, False, False), (True, False, True), (False, True, True),
])
@pytest.mark.parametrize("owner", ["raphael", "member"])
async def test_cli_is_in_use_if_installed_or_selected(rig, installed, chosen, expected, owner):
    rig.service._settings.set("agent_model", "@local:model")
    model = "cli:gemini:example?effort=high" if chosen else "@local:model"
    if owner == "raphael":
        rig.service._settings.set("agent_model", model)
    else:
        member = (await rig.call("members.create", {"name": "Research"}))["member"]["id"]
        rig.service.store.update_member(member, model=model)
    checks = observe(rig, brains=[{"id": "gemini", "installed": installed, "signed_in": False}])
    assert [check["id"] for check in checks] == (["brain:gemini", "memory"] if expected else ["memory"])
    if expected:
        assert checks[0]["status"] == "warn"
        assert checks[0]["name"] == "Antigravity"


@pytest.mark.parametrize("source,key,name", [
    ("composio", "Composio", "Gmail"), ("google", "Google OAuth client", "Google Calendar"),
])
@pytest.mark.parametrize("configured", [False, True])
async def test_managed_keys_require_a_connection_even_if_disabled(rig, source, key, name, configured):
    connections = [{"id": "opaque-connection", "name": name, "source": source,
                    "enabled": False, "state": "error"}] if configured else []
    checks = observe(rig, keys_present={"Composio": False, "Google OAuth client": None}, connections=connections)
    assert [check["id"] for check in checks] == ([f"key:{key}", "connection:opaque-connection", "memory"] if configured else ["memory"])
    if configured:
        assert checks[0]["name"] == key and checks[0]["status"] == "warn"
        assert checks[1]["name"] == name and checks[1]["status"] == "error"


@pytest.mark.parametrize("enabled,selected,expected", [(False, False, False), (True, False, True), (False, True, True)])
@pytest.mark.parametrize("owner", ["raphael", "member"])
async def test_api_provider_is_in_use_if_enabled_or_selected(rig, enabled, selected, expected, owner):
    rig.service._settings.set("agent_model", "cli:codex")
    model = "@custom:model" if selected else "cli:codex"
    if owner == "raphael":
        rig.service._settings.set("agent_model", model)
    else:
        member = (await rig.call("members.create", {"name": "Research"}))["member"]["id"]
        rig.service.store.update_member(member, model=model)
    checks = observe(rig, brains=[{"id": "custom", "name": "Studio AI", "kind": "openai",
                                  "enabled": enabled, "has_key": False, "status": "auth"}])
    assert [check["id"] for check in checks] == (["brain:custom", "memory"] if expected else ["memory"])
    if expected:
        assert checks[0]["name"] == "Studio AI" and checks[0]["status"] == "warn"


@pytest.mark.parametrize("enabled,model,expected", [
    (False, "cli:codex", False), (True, "cli:codex", True),
    (False, "openai/example", True), (False, "@openrouter:openai/example", True),
])
@pytest.mark.parametrize("present", [True, False, None])
async def test_openrouter_key_and_provider_are_one_check(rig, enabled, model, expected, present):
    rig.service._settings.set("agent_model", model)
    checks = observe(rig, keys_present={"OpenRouter": present}, brains=[{
        "id": "openrouter", "name": "OpenRouter", "kind": "openrouter", "enabled": enabled,
        "has_key": present, "status": "configured"}])
    assert [check["id"] for check in checks] == (["brain:openrouter", "memory"] if expected else ["memory"])
    if expected:
        assert checks[0]["status"] == ("ok" if enabled and present is True else "warn")
        assert checks[0]["name"] == "OpenRouter"


@pytest.mark.parametrize("enabled", [False, True])
async def test_mcp_keys_require_an_enabled_configured_server(rig, enabled):
    checks = observe(rig, keys_present={"server/env/TOKEN": False, "server/header/Authorization": None,
                                       "removed/env/TOKEN": False}, connections=[{
        "id": "server", "name": "Weather Station", "source": None, "enabled": enabled, "state": "ready"}])
    assert [check["id"] for check in checks] == (["key:server/env/TOKEN", "key:server/header/Authorization"] if enabled else []) + ["connection:server", "memory"]
    for check in checks[:-1]:
        assert check["name"] == "Weather Station"
    assert all(check["status"] == "warn" and check["detail"] for check in checks if check["id"].startswith("key:"))


@pytest.mark.parametrize("language,memory_name", [("zh-TW", "記憶"), ("ja", "メモリ"), ("en", "Memory")])
async def test_every_check_has_a_display_name_and_keeps_failing_observations(rig, language, memory_name):
    rig.language = language
    checks = observe(rig, keys_present={"OpenRouter": False, "Composio": False}, brains=[
        {"id": "openrouter", "name": "OpenRouter", "enabled": True, "has_key": False, "status": "auth"},
        {"id": "codex", "installed": True, "signed_in": True, "blocked": {"reset_at_ms": None}},
        {"id": "claude", "installed": True, "signed_in": True, "disconnected": True},
        {"id": "gemini", "installed": False, "signed_in": False},
    ], connections=[{"id": "mail", "name": "Gmail", "source": "composio", "state": "ready",
                     "failure": {"kind": "auth_expired"}}], memory={"status": "unknown"})
    assert [check["name"] for check in checks] == ["Composio", "OpenRouter", "Codex CLI", "Claude Code", "Gmail", memory_name]
    assert all(check["status"] == "warn" and check["detail"] for check in checks)
    assert all(check["name"].strip() and check["name"] != check["id"] for check in checks)


async def test_unavailable_snapshot_remains_unknown_instead_of_healthy(rig):
    assert health(rig.service, "en") == {"checks": [], "reason": "self_check_unavailable"}
    def unavailable(*args):
        raise RuntimeError("offline diagnostic failed")
    rig.background.diagnostics = unavailable
    assert health(rig.service, "en") == {"checks": [], "reason": "self_check_unavailable"}


async def test_ok_checks_have_names_for_the_healthy_summary(rig):
    checks = observe(rig, keys_present={"OpenRouter": True}, brains=[
        {"id": "openrouter", "name": "OpenRouter", "enabled": True, "has_key": True, "status": "ok"},
        {"id": "codex", "installed": True, "signed_in": True},
        {"id": "claude", "installed": True, "signed_in": True},
    ], connections=[{"id": "mail", "name": "Gmail", "state": "ready"},
                    {"id": "notes", "name": "Notion", "state": "duplicate"}])
    assert [check["name"] for check in checks] == ["OpenRouter", "Codex CLI", "Claude Code", "Gmail", "Notion", "記憶"]
    assert all(check["status"] == "ok" and check["detail"] is None and check["detail_key"] is None for check in checks)


async def test_member_selection_also_keeps_the_openrouter_key_when_provider_is_disabled(rig):
    rig.service._settings.set("agent_model", "cli:codex")
    member = (await rig.call("members.create", {"name": "Research"}))["member"]["id"]
    rig.service.store.update_member(member, model="openai/example")
    checks = observe(rig, keys_present={"OpenRouter": False}, brains=[
        {"id": "openrouter", "name": "OpenRouter", "enabled": False, "has_key": False, "status": "auth"}])
    assert [check["id"] for check in checks] == ["brain:openrouter", "memory"]
    assert checks[0]["status"] == "warn"


@pytest.mark.parametrize("language", NEW_LANGUAGES)
async def test_health_uses_translated_names_and_failure_details_for_every_new_locale(rig, language):
    rig.language = language
    checks = observe(rig, brains=[{"id": "codex", "installed": True, "signed_in": False}],
                     connections=[{"id": "test", "name": "Test", "state": "error"}],
                     memory={"status": "unknown"})
    assert checks[-1]["name"] == ui_word("Memory", language)
    assert checks[-1]["detail"] == ui_word("Memory needs attention.", language)
    assert checks[0]["detail"] == ui_word("Model is unavailable or needs sign-in.", language)
    assert checks[1]["detail"] == ui_word("Connection is not ready.", language)
    assert all(check["detail"] != "State is unknown." for check in checks)


async def test_unknown_health_locale_uses_english_as_insurance(rig):
    rig.language = "unknown"
    checks = observe(rig, memory={"status": "unknown"})
    assert checks[-1]["name"] == "Memory"
    assert checks[-1]["detail"] == "Memory needs attention."

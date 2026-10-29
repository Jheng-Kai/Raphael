from raphael_core.connectors.composio import KEY
from raphael_core.integrations.vault import CredentialVault
import pytest

from raphael_core.device.models import ModelDownloadError, REGISTRY
from raphael_core.native_journeys import GmailJourneyVault, OfflineModelManager, gmail_enabled
from raphael_core.app import EchoClient
from raphael_core.native_journeys import native_codex_model, catalog_enabled, native_connect
import json


def test_native_model_manager_never_downloads_missing_models(tmp_path, monkeypatch):
    manager = OfflineModelManager(tmp_path)
    monkeypatch.setattr(manager, "_http", lambda: (_ for _ in ()).throw(AssertionError("network")))
    with pytest.raises(ModelDownloadError, match="downloads are disabled"):
        manager.ensure_spec(REGISTRY["silero-vad"])


def test_gmail_requires_fake_llm_and_both_explicit_native_flags(monkeypatch):
    monkeypatch.delenv("RAPHAEL_TEST_NATIVE", raising=False)
    monkeypatch.delenv("RAPHAEL_TEST_NATIVE_GMAIL", raising=False)
    assert not gmail_enabled(True)
    monkeypatch.setenv("RAPHAEL_TEST_NATIVE_GMAIL", "1")
    assert not gmail_enabled(True)
    monkeypatch.setenv("RAPHAEL_TEST_NATIVE", "1")
    assert gmail_enabled(True)
    assert not gmail_enabled(False)


def test_catalog_journeys_require_explicit_native_opt_in_and_script_only_discovery_then_card(monkeypatch):
    monkeypatch.delenv("RAPHAEL_TEST_NATIVE", raising=False)
    monkeypatch.setenv("RAPHAEL_TEST_NATIVE_CATALOG", "1")
    assert not catalog_enabled(True)
    monkeypatch.setenv("RAPHAEL_TEST_NATIVE", "1")
    assert catalog_enabled(True) and not catalog_enabled(False)
    messages = [{"role": "user", "content": "Connect Spotify [native-connect:spotify]"}]
    offered = {"find_app", "connect_app"}
    assert native_connect(messages, offered, 0) == ("find_app", {"query": "spotify"})
    assert native_connect(messages, offered, 1) == ("connect_app", {"app": "spotify"})
    assert native_connect(messages, offered, 2) is None
    assert native_connect(messages, set(), 0) is None
    monkeypatch.delenv("RAPHAEL_TEST_NATIVE_CATALOG")
    assert native_connect(messages, offered, 0) is None


def test_gmail_vault_reads_only_composio_and_never_changes_owner_credentials(monkeypatch):
    reads = []
    monkeypatch.setattr(CredentialVault, "get", lambda _self, name: reads.append(name) or "test-value")
    monkeypatch.setattr(CredentialVault, "set", lambda *_: (_ for _ in ()).throw(AssertionError("owner write")))
    monkeypatch.setattr(CredentialVault, "delete", lambda *_: (_ for _ in ()).throw(AssertionError("owner delete")))
    vault = GmailJourneyVault()
    assert vault.get("unrelated") is None
    assert vault.get(KEY) == "test-value"
    vault.set("unrelated", "temporary")
    vault.delete(KEY)
    assert reads == [KEY]


@pytest.mark.asyncio
async def test_native_consult_uses_real_tool_protocol_only_when_opted_in(monkeypatch):
    client = EchoClient()
    tools = [{"type": "function", "function": {"name": "ask_member"}}]
    messages = [{"role": "user", "content": "Ask NativeTarget [native-consult:NativeTarget]"}]
    monkeypatch.delenv("RAPHAEL_TEST_NATIVE", raising=False)
    assert not (await client.chat_tools(messages=messages, tools=tools)).calls
    monkeypatch.setenv("RAPHAEL_TEST_NATIVE", "1")
    turn = await client.chat_tools(messages=messages, tools=tools)
    assert len(turn.calls) == 1
    call = turn.calls[0]
    assert call.name == "ask_member"
    assert call.arguments["member"] == "NativeTarget"
    assert "native-consult" not in call.arguments["request"]
    assert turn.cost_usd == 0
    assert not (await client.chat_tools(messages=messages, tools=[])).calls
    assert not (await client.chat_tools(messages=[*messages, {"role": "tool", "content": "Report"}], tools=tools)).calls
    assert not (await client.chat_tools(messages=[*messages, {"role": "user", "content": "Another question"}], tools=tools)).calls


def test_native_codex_model_uses_configured_available_model_and_rejects_guessed_alias(tmp_path):
    home = tmp_path / ".codex"
    home.mkdir()
    (home / "config.toml").write_text('model = "gpt-6.1-sol"\n')
    (home / "models_cache.json").write_text(json.dumps({"models": [{"slug": "gpt-6.1-sol"}]}))
    environ = {"CODEX_HOME": str(home)}
    assert native_codex_model(environ) == "cli:codex:gpt-6.1-sol"
    with pytest.raises(ValueError, match="absent from the CLI model cache"):
        native_codex_model({**environ, "RAPHAEL_NATIVE_CODEX_MODEL": "gpt-6.1"})
    with pytest.raises(ValueError, match="installed Codex model id"):
        native_codex_model({**environ, "RAPHAEL_NATIVE_CODEX_MODEL": "openrouter:paid?key=secret"})

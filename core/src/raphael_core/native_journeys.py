"""Opt-in native diagnostics: only Composio may read an existing credential; writes stay in memory."""
import os
import re
import json
import tomllib
from pathlib import Path

from .connectors.composio import KEY
from .integrations.vault import CredentialVault, MemoryVault
from .device.models import ModelManager, ModelDownloadError


def native_enabled(fake_llm: bool) -> bool:
    return fake_llm and os.environ.get("RAPHAEL_TEST_NATIVE") == "1"


def gmail_enabled(fake_llm: bool) -> bool:
    return (native_enabled(fake_llm)
            and os.environ.get("RAPHAEL_TEST_NATIVE_GMAIL") == "1")


def native_consult(messages: list[dict], offered: set[str], seen: int) -> dict | None:
    if not native_enabled(True) or "ask_member" not in offered or seen:
        return None
    latest = next((str(message.get("content", "")) for message in reversed(messages)
                   if message.get("role") == "user"), "")
    targets = re.findall(r"\[native-consult:([^\]\r\n]+)\]", latest)
    if not targets:
        return None
    return {"member": targets[-1], "request": "NATIVE-AUDIT-EXCHANGE: give a short report for the owner."}


def native_diagnosis(messages, offered, seen):
    """Script only the fake provider; cards, vault checks and continuation stay production code."""
    if not native_enabled(True):
        return None
    task = " ".join(str(message.get("content", "")) for message in messages if message.get("role") == "user")
    if "[native-diagnosis]" not in task:
        return None
    if "card_failure" in task:
        if not seen and "self_check" in offered:
            return "self_check", {}
        reason = re.search(r'"kind":\s*"([a-z_]+)"\s*,\s*"reason":\s*"([^"\\]*)"', task)
        if reason is None:
            raise ValueError("Native diagnosis never received the classified card failure")
        if reason.groups() != ("auth_expired", "not_configured"):
            raise ValueError("Native diagnosis received a different connection failure")
        return "reply", "Gmail 還沒登入或缺少金鑰，請到設定 › 連接完成連線。我已檢查設定，會在連線完成後繼續原本的工作。"
    if not seen and "connect_app" in offered:
        return "connect_app", {"app": "gmail"}
    return "reply", "請從卡片連線 Gmail，完成後我會繼續。"


def native_codex_model(environ=None):
    """Use the owner's public model selection, never a guessed CLI model alias."""
    environ = os.environ if environ is None else environ
    home = Path(environ.get("CODEX_HOME") or Path(environ.get("USERPROFILE") or environ.get("HOME") or Path.home()) / ".codex")
    config = home / "config.toml"
    settings = tomllib.loads(config.read_text(encoding="utf-8-sig")) if config.exists() else {}
    model = environ.get("RAPHAEL_NATIVE_CODEX_MODEL") or settings.get("model")
    if not isinstance(model, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]{0,199}", model):
        raise ValueError("Set RAPHAEL_NATIVE_CODEX_MODEL to an installed Codex model id")
    cache = home / "models_cache.json"
    if cache.exists():
        models = json.loads(cache.read_text(encoding="utf-8-sig")).get("models", [])
        known = {row.get("slug") for row in models if isinstance(row, dict)}
        if known and model not in known:
            raise ValueError("Native Codex model is absent from the CLI model cache; choose an available model id")
    return f"cli:codex:{model}"


class OfflineModelManager(ModelManager):
    def ensure_spec(self, spec, progress=None):
        if not self.is_ready_spec(spec):
            raise ModelDownloadError(f"Native journeys require the preinstalled model {spec.name}; downloads are disabled")
        return self.dir(spec.name)


class GmailJourneyVault(MemoryVault):
    def get(self, name: str) -> str | None:
        if name == KEY:
            return CredentialVault().get(name)
        return super().get(name)

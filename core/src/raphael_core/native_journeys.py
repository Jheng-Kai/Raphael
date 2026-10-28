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

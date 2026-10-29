"""Opt-in native diagnostics: only Composio may read an existing credential; writes stay in memory."""
import os
import re
import json
import tomllib
import sys
from pathlib import Path

from .connectors.composio import KEY
from .integrations.vault import CredentialVault, MemoryVault
from .device.models import ModelManager, ModelDownloadError


def native_enabled(fake_llm: bool) -> bool:
    return fake_llm and os.environ.get("RAPHAEL_TEST_NATIVE") == "1"


def gmail_enabled(fake_llm: bool) -> bool:
    return (native_enabled(fake_llm)
            and os.environ.get("RAPHAEL_TEST_NATIVE_GMAIL") == "1")


def bot_homes_brain(fake_llm: bool, data: Path):
    """An offline child at the CLI transport boundary of the isolated native journey."""
    if not native_enabled(fake_llm) or os.environ.get("RAPHAEL_TEST_NATIVE_HOMES") != "1":
        return None
    from .agent.cli.discovery import CliBrains
    home = data / "native-cli"
    auth = home / ".codex/auth.json"
    auth.parent.mkdir(parents=True, exist_ok=True)
    auth.write_text("{}", encoding="utf-8")
    child = home / "codex.py"
    child.write_text('''import json, sys
from pathlib import Path
def send(value): print(json.dumps(value), flush=True)
if "--version" in sys.argv:
    print("native-fake-codex 1"); sys.exit()
for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    if method == "initialize": send({"id":msg["id"], "result":{}})
    elif method == "model/list": send({"id":msg["id"], "result":{"data":[]}})
    elif method in ("thread/start", "thread/resume"):
        prompt = msg["params"].get("developerInstructions", "")
        assert "private-review" in prompt and "Review" in prompt
        Path(sys.argv[1]).write_text(json.dumps({"member_home":True,"skills":True}), encoding="utf-8")
        send({"id":msg["id"], "result":{"thread":{"id":"native-home"}}})
    elif method == "turn/start":
        send({"method":"item/completed", "params":{"item":{"type":"agentMessage", "id":"final", "phase":"final_answer", "text":"Native Codex home verified."}}})
        send({"method":"turn/completed", "params":{"turn":{"status":"completed"}}})
        break
''', encoding="utf-8")
    return CliBrains(home=home, environ={**os.environ, "CODEX_HOME": str(auth.parent), "PYTHONUTF8": "1"},
                     commands={"codex": [sys.executable, str(child), str(home / "receipt.json")]})


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


def native_memory(messages, offered, seen):
    """Script only provider choices; production recall, tools and homes do the work."""
    if not native_enabled(True):
        return None
    latest = next((str(message.get("content", "")) for message in reversed(messages)
                   if message.get("role") == "user"), "")
    questions = re.findall(r"<question>\s*(.*?)\s*</question>", latest, re.S)
    question = questions[-1] if questions else latest
    if "[native-memory:" not in question:
        return None
    if "[native-memory:record]" in question:
        if not seen:
            if "memory_update" not in offered:
                raise ValueError("Native memory tool is absent")
            return "memory_update", {"op": "add", "name": "reference-project-colour",
                                     "body": "The project colour is heliotrope."}
        return "reply", "The member saved the project colour."
    if "[native-memory:recall]" in question:
        recall = re.findall(r'<tool_result [^>]*tool="auto_recall"[^>]*>(.*?)</tool_result>', latest, re.S)
        if not any("heliotrope" in block for block in recall):
            raise ValueError("Turn one was not automatically recalled at turn twenty-five")
        return "reply", "The project colour is heliotrope."
    return "reply", "Work step recorded."


def native_skill_review(user):
    """The offline provider proposes a skill; the real reviewer validates and persists it."""
    if not native_enabled(True) or "[native-skills:learn]" not in user:
        return {"changes": []}
    return {"changes": [{"text": "---\nname: clock-audit\ndescription: Audit repeated clock observations\n---\n"
                        "## When to use\nUse for a clock audit.\n## Procedure\nRead and compare ten observations.\n"
                        "## Pitfalls\nKeep time zones consistent.\n## Verification\nCheck all observations."}]}


def native_skills(messages, offered, seen):
    if not native_enabled(True):
        return None
    latest = next((str(m.get("content", "")) for m in reversed(messages) if m.get("role") == "user"), "")
    questions = re.findall(r"<question>\s*(.*?)\s*</question>", latest, re.S)
    latest = questions[-1] if questions else latest
    if "[native-skills:" not in latest:
        return None
    if "[native-skills:learn]" in latest:
        if not seen:
            return "local_time", {}
        if seen < 10:
            return "history_search", {"query": f"Clock audit observation {seen}"}
        return "reply", "Clock audit completed."
    if not seen:
        if "skill_read" not in offered:
            raise ValueError("Native skills reader is missing")
        return "skill_read", {"name": "clock-audit"}
    tool_data = " ".join(str(m.get("content", "")) for m in messages if m.get("role") == "tool")
    if "Read and compare ten observations" not in tool_data:
        raise ValueError("The next task did not read the learned procedure")
    return "reply", "The learned clock audit procedure was read."


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

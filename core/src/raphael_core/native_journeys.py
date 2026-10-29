"""Opt-in native diagnostics: only Composio may read an existing credential; writes stay in memory."""
import os
import re
import json
import tomllib
from pathlib import Path

from .connectors.composio import KEY
from .integrations.vault import CredentialVault, MemoryVault
from .device.models import ModelManager, ModelDownloadError


async def vm_smoke(directory):
    """Existing native runner's Docker journey: fake brain, real tools and engine."""
    import base64
    from .brain.db import connect
    from .brain.settings import SettingsStore
    from .agent.gate import ToolGate
    from .agent.policy import Tier
    from .background.snapshot import take_snapshot
    from .computer.vm import LocalVm, VmError
    from .computer.vm_tools import VmTools
    from .services.attachment_store import AttachmentStore
    from .worker.loop import Call, Turn, ToolOutcome, run_task

    if not native_enabled(True):
        raise RuntimeError("VM smoke requires RAPHAEL_TEST_NATIVE=1 and the native runner")

    class EmptyHub:
        def offered(self): return []
        def tier_of(self, key): return None
        def kind_of(self, server, name): return None
        def record_unrun(self, *args, **kwargs): pass

    directory = Path(directory)
    conn = connect(directory / "raphael.db")
    vm = LocalVm(directory, settings=SettingsStore(conn))
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(directory), conn=conn)
    try:
        if not await vm.available():
            raise VmError("Docker engine unavailable; start Docker Desktop yourself, then rerun")
        await hub.prepare()
        snapshot = take_snapshot(hub)
        assert vm.target(0) == vm.target(1), "Expected shared desktop"
        shot = next((name for name in snapshot.refs if name == "computer__get_desktop_state"), None)
        if not shot:
            raise VmError("Desktop tool discovery failed; build the pinned image first")
        assert "computer__click" in snapshot.refs, "Desktop click tool discovery failed"
        gate, completed = ToolGate(hub, conn=conn), []
        calls = [(shot, {}), ("computer__click", {"x": 640, "y": 480, "scope": "desktop"}),
                 ("computer__vm_exec", {"command": "printf 'Raphael VM smoke\\n' > raphael-smoke.txt; cat raphael-smoke.txt"}),
                 ("computer__attach_file", {"path": "/home/cua/workspace/raphael-smoke.txt"})]

        class FakeBrain:
            async def chat(self, messages, tools):
                if len(completed) == len(calls):
                    return Turn("Done")
                name, args = calls[len(completed)]
                return Turn("Checking the desktop.", [Call(str(len(completed)), name, args, json.dumps(args))])

            async def tool(self, identifier, name, arguments):
                ref = snapshot.refs[name]
                assert gate.tier(ref.key) == Tier.T0 and not gate.needs_confirmation(ref.key)
                result = await gate.call_plugin(ref.key, arguments)
                assert result.ok, f"{name}: {result.kind}"
                if name == shot:
                    image = next(block for block in result.blocks if block["type"] == "image")
                    assert image["mimeType"] == "image/png", "Expected a PNG screenshot"
                    data = base64.b64decode(image["data"], validate=True)
                    assert data.startswith(b"\x89PNG\r\n\x1a\n") and data.endswith(b"IEND\xaeB`\x82")
                    (directory.parent / "vm-tool-screenshot.png").write_bytes(data)
                elif name == "computer__vm_exec":
                    assert "Raphael VM smoke" in json.loads(result.text)["output"]
                elif name == "computer__attach_file":
                    attachment = json.loads(result.text)["attachment"]
                    assert hub.attachments.path(attachment["id"]).read_bytes() == b"Raphael VM smoke\n"
                completed.append(name)
                return ToolOutcome(True, content=result.text, blocks=result.blocks)

        outcome = await run_task(FakeBrain(), system="Deterministic fake brain; use only the specified test tools.", user="Test the optional desktop", tools=snapshot.definitions)
        assert outcome.status == "done" and completed == [name for name, _ in calls]
        target = vm.target()
        vm.hold(target, True)
        refused = []
        for name, arguments in calls:
            assert (await gate.call_plugin(snapshot.refs[name].key, arguments)).kind == "owner_holds_control", name
            refused.append(name)
        vm.hold(target, False)
        state = await vm.status(target)
        assert state["ready"] and state["viewer_url"]
        return {"state": state, "completed": completed, "brain": "fake", "paid_requests": 0,
                "without_approval": completed, "owner_held_refused": refused,
                "control_gate": "refused while held", "attachment_id": attachment_id(hub.attachments)}
    finally:
        await vm.aclose()
        conn.close()


def attachment_id(store):
    return next(path.name for path in store.root.iterdir() if not path.name.endswith(".json"))


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

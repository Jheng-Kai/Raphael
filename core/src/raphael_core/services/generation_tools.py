# Adapted from NousResearch/hermes-agent (MIT); see core/packaging/licenses.
"""One pinned media tool table for API, authenticated CLI MCP and worker snapshots."""

from raphael_core.ui_words import ui_word, with_ui_words
import json

from jsonschema import Draft202012Validator

from ..agent.plugins import PluginResult, PluginTool, tool_key
from ..agent.policy import Tier
from ..agent.ledger import Ledger
from ..brain.spend import SpendTracker
from ..integrations.audit import AuditLog
from ..brain.model_ref import split_api_ref
from ..brain.settings import SettingsStore
from .common import ServiceError


class GenerationTools:
    def __init__(self, delegate, service, conn=None):
        self.delegate, self.service = delegate, service
        self.conn = conn
        self.audit = AuditLog(conn) if conn is not None else None

    def __getattr__(self, name):
        return getattr(self.delegate, name)

    def selected_model(self, kind):
        if self.conn is None:
            return ""
        return SettingsStore(self.conn).get(kind + "_model")

    def choices_for(self, kind, selected):
        selected, _ = split_api_ref(selected)
        choices = self.service.media_choices(kind, selected) if hasattr(self.service, "media_choices") else self.service.providers.media_choices(kind)
        return [row for row in choices if row["reference"] == selected]

    def offered_for(self, member):
        tools = []
        for kind in ("image", "video"):
            choices = self.choices_for(kind, self.selected_model(kind))
            models = [row["reference"] for row in choices]
            properties = {"prompt": {"type": "string", "minLength": 1, "maxLength": 12000}}
            if models:
                properties["model"] = {"type": "string", "enum": models}
            if kind == "image" and any(row.get("image_input") for row in choices):
                properties["images"] = {"type": "array", "maxItems": 4, "items": {"type": "string"}, "description": "Stored attachment IDs to edit; never URLs or host paths."}
            schema = {"type": "object", "properties": properties, "required": ["prompt"], "additionalProperties": False}
            description = ("Generate or edit an image and deliver its attachment in this conversation. " if kind == "image" else
                           "Generate a video in an existing background task; delegate this long job first. Task Stop cancels polling and delivery. ")
            description += "Uses only the owner's explicit media model setting, independent of the conversational brain. The selected source bills API or subscription usage. If unset or unavailable, call once to show the existing media model row; never choose or substitute a model."
            tools.append(PluginTool(tool_key("media", kind + "_generate"), "media", kind + "_generate", description, schema, Tier.T1, pinned=True))
        return [*self.delegate.offered_for(member), *tools]

    def offered(self):
        return self.offered_for(0)

    def tier_of(self, key):
        return Tier.T1 if key in (tool_key("media", "image_generate"), tool_key("media", "video_generate")) else self.delegate.tier_of(key)

    def tier_for_call(self, key, arguments):
        return self.tier_of(key) if key.startswith("mcp:media/") else self.delegate.tier_for_call(key, arguments)

    def kind_of(self, server, name):
        return "write" if server == "media" else self.delegate.kind_of(server, name)

    def kind_for_call(self, server, name, arguments):
        return self.kind_of(server, name) if server == "media" else self.delegate.kind_for_call(server, name, arguments)

    def record_unrun(self, key, *, outcome, task_id=None):
        if key.startswith("mcp:media/"):
            if self.audit:
                self.audit.add(server="media", tool=key.split("/")[-1], tier="T1", approver="none", outcome=outcome, task_id=task_id)
        else:
            self.delegate.record_unrun(key, outcome=outcome, task_id=task_id)

    async def call(self, key, arguments, *, approver, task_id=None, pool=None):
        if not key.startswith("mcp:media/"):
            return await self.delegate.call(key, arguments, approver=approver, task_id=task_id, pool=pool)
        if task_id:
            row = self.conn.execute("SELECT member_id FROM worker_tasks WHERE id=?", (task_id,)).fetchone() if self.conn is not None else None
            if row is None:
                return PluginResult(False, "blocked")
        tool = next((t for t in self.offered_for(0) if t.key == key), None)
        if tool is None or not Draft202012Validator(tool.schema).is_valid(arguments):
            return PluginResult(False, "bad_arguments")
        if approver == "none":
            return PluginResult(False, "blocked")
        kind = tool.name.removesuffix("_generate")
        selected = self.selected_model(kind)
        if kind == "video" and not task_id and self.choices_for("video", selected):
            return PluginResult(False, "background_required", "Delegate this video request to the existing background task, then call video_generate there. Do not call a provider in this chat.")
        try:
            from ..computer.vm_tools import _NOTE
            progress, language = _NOTE.get()
            def update(state):
                if progress:
                    line = with_ui_words({"zh-TW": "正在製作影片", "ja": "動画を生成しています", "en": "Generating the video"}).get(language, "Generating the video")
                    value = state.get("progress")
                    progress(line + (f" · {int(value)}%" if isinstance(value, (int, float)) and 0 <= value <= 100 else ""))
            ledger = Ledger(SpendTracker(self.conn), purpose=kind) if self.conn is not None else None
            data = await self.service.make(kind, arguments, selected_model=selected, progress=update, ledger=ledger)
            result = PluginResult(True, text=json.dumps(data), billing={"model": data["model"], "cost_usd": data["cost_usd"]})
            if data.get("billing_source") == "subscription":
                result.billing["billing_source"] = "subscription"
        except ServiceError as error:
            label = "drawing" if kind == "image" else "video"
            result = PluginResult(False, error.kind, f"No available {label} model is chosen. Choose one in Settings > Models & usage > {label} model. The selected source uses paid API billing or subscription usage; no model is chosen automatically." if error.kind == "not_configured" else f"Media generation{(' with ' + error.service) if error.service else ''} did not finish ({error.kind}); no file was delivered.",
                                  billing={"model": selected, "cost_usd": ledger.total if ledger.calls[-1]["outcome"] != "cost_unknown" else None} if ledger and ledger.calls else None)
            if ledger and ledger.calls and ledger.calls[-1].get("billing_source") == "subscription":
                result.billing.update(cost_usd=None, billing_source="subscription")
            if error.service == "codex" and error.kind == "auth_expired":
                from ..failures import Missing
                result.text = json.dumps({"missing": Missing("codex", "cli", "missing", "models").wire(),
                                          "target": {"pane": "models", "resource": "codex"}})
        if self.audit:
            outcome = "ok" if result.ok else result.kind if result.kind in ("timeout", "denied", "expired", "blocked") else "error"
            self.audit.add(server="media", tool=tool.name, tier="T1", approver=approver, outcome=outcome, task_id=task_id)
        return result

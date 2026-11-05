"""Owner UI management contracts, shared by tool offers, execution and coverage checks.

Rows name existing UI RPCs. No generic RPC or settings-key escape hatch is offered.
Owner-only boundaries live beside the registry so new UI mutations require a decision.
"""

from dataclasses import dataclass
from contextvars import ContextVar
import json
import re
from typing import Any

from .agent.policy import Tier

# Trusted execution context, never an RPC/model argument. Clearing the very chat
# that requested a change must not cancel or await its own executing tool.
ORIGIN_TURN = ContextVar("management_origin_turn", default=None)


def obj(properties=None, required=()):
    return {"type": "object", "properties": properties or {}, "required": list(required), "additionalProperties": False}


TEXT = {"type": "string"}
BOOL = {"type": "boolean"}
ID = {"type": "integer", "minimum": 1}
MEMBER_ID = {"type": "integer", "minimum": 0}
STRINGS = {"type": "array", "items": TEXT}
IDS = {"type": "array", "items": MEMBER_ID}
NULL_ID = {"type": ["integer", "null"], "minimum": 1}
PROFILE = {
    **{key: TEXT for key in ("name", "role", "blurb", "personality", "instructions", "group", "avatar_preset", "model", "voice")},
    **{key: BOOL for key in ("read_aloud", "notify", "ask_before_members", "draft_first", "pinned", "hidden")},
    "reply_style": {"type": "string", "enum": ["full", "conversational"]},
    "effort": {"type": "string", "enum": ["none", "minimal", "low", "medium", "high", "xhigh", "max"]},
    "position": {"type": "integer"}, "group_id": NULL_ID,
}
ROUTINE = {**{key: TEXT for key in ("title", "prompt")}, "enabled": BOOL,
           "schedule": {"type": "object"}, "when": {"type": "object"}, "member_id": MEMBER_ID}
ROOM = {"name": TEXT, "member_ids": IDS, "default_responder": TEXT, "group_id": NULL_ID}


@dataclass(frozen=True)
class ManagementAction:
    name: str
    rpc: str
    description: str
    schema: dict[str, Any]
    destructive: bool = False
    setting: str | None = None
    service: str = "rpc"

    @property
    def tier(self):
        return Tier.T3 if self.destructive else Tier.T1

    @property
    def definition(self):
        return {"description": self.description + (" Always wait for the owner's approval." if self.destructive else ""),
                "parameters": self.schema}


def row(name, rpc, description, properties=None, required=(), *, destructive=False, setting=None, service="rpc"):
    return ManagementAction(name, rpc, description, obj(properties, required), destructive, setting, service)


ACTIONS = (
    row("member_create", "members.create", "Create a member with the same defaults as the UI. Use its returned ID.", PROFILE, ("name", "role"), service="member"),
    row("member_update", "members.update", "Edit supplied profile fields, preferences, model/effort, pin/hide, folder or position. ID 0 is the first Bot. Change models only when the owner explicitly requests it.", {"id": MEMBER_ID, **PROFILE}, ("id",), service="member"),
    row("member_delete", "members.delete", "Permanently delete a member, conversations, memories, routines and resources.", {"id": ID}, ("id",), destructive=True),
    row("member_primary", "members.set_primary", "Move the primary contact and management authority to this member.", {"id": MEMBER_ID}, ("id",), destructive=True),
    row("member_duplicate", "members.duplicate", "Duplicate a member using the UI service.", {"id": ID}, ("id",)),
    row("member_read", "members.read", "Mark a member's conversation read.", {"id": MEMBER_ID}, ("id",)),
    row("members_mark_all_read", "members.mark_all_read", "Mark every member read."),
    row("member_avatar", "members.set_avatar", "Set a member's image through the same checked image upload as the UI.", {"id": ID, "name": TEXT, "mime": TEXT, "data": TEXT}, ("id", "name", "mime", "data")),
    row("member_history_clear", "agent.history.clear", "Clear all recorded conversations of the named member.", {"member_id": MEMBER_ID}, ("member_id",), destructive=True),
    row("member_history_delete", "agent.history.delete", "Delete a recorded conversation turn.", {"turn_id": ID, "member_id": MEMBER_ID, "conversation_id": ID}, ("turn_id", "member_id", "conversation_id"), destructive=True),
    row("group_create", "groups.create", "Create a sidebar folder.", {"name": TEXT}, ("name",)),
    row("group_rename", "groups.update", "Rename a sidebar folder.", {"id": ID, "name": TEXT}, ("id", "name")),
    row("group_update", "groups.update", "Edit folder sources or reorder the folder.", {"id": ID, "sources": {"type": "array", "items": obj({"kind": {"type": "string", "enum": ["github", "notion"]}, "ref": TEXT}, ("kind", "ref"))}, "position": {"type": "integer"}}, ("id",)),
    row("group_delete", "groups.delete", "Delete the sidebar folder; its members remain ungrouped.", {"id": ID}, ("id",), destructive=True),
    row("room_create", "rooms.create", "Create a group chat with folder and default responder, without an agenda post.", ROOM, ("member_ids",)),
    row("room_update", "rooms.update", "Rename, pin, hide or mark a group chat read; set default responder and roles.",
        {"room_id": ID, **{key: value for key, value in ROOM.items() if key not in ("member_ids", "group_id")},
         "roles": {"type": "object", "additionalProperties": {"type": "string", "enum": ["moderator", "pro", "con", "participant"]}}, "pinned": BOOL, "hidden": BOOL, "read": BOOL}, ("room_id",)),
    row("room_members", "rooms.update", "Replace group chat membership. The card names the complete new membership.", {"room_id": ID, "member_ids": IDS}, ("room_id", "member_ids"), destructive=True),
    row("room_stop", "rooms.stop", "Stop all work belonging to a group chat.", {"room_id": ID}, ("room_id",)),
    row("room_delete", "rooms.delete", "Delete a group chat, messages and associated room state.", {"room_id": ID}, ("room_id",), destructive=True),
    row("conversation_create", "conversations.create", "Create a member conversation.", {"member_id": MEMBER_ID}, ("member_id",)),
    row("conversation_rename", "conversations.rename", "Rename a conversation.", {"id": ID, "title": TEXT}, ("id", "title")),
    row("conversation_delete", "conversations.delete", "Delete a conversation and its recorded turns.", {"id": ID}, ("id",), destructive=True),
    row("conversation_clear", "conversations.clear", "Clear the selected conversation. Read conversations.list for the permanent quick conversation ID.", {"id": ID}, ("id",), destructive=True),
    row("member_skill_import", "members.skills.import", "Import a member's skill package through the UI importer.", {"member_id": MEMBER_ID, "shared": BOOL, "source": TEXT}, ("member_id", "source")),
    row("member_skill_update", "members.skills.update", "Edit a member skill document or turn it on/off.", {"member_id": MEMBER_ID, "shared": BOOL, "id": ID, "enabled": BOOL, "text": TEXT, "expected_hash": TEXT}, ("member_id", "id")),
    row("member_skill_undo", "members.skills.update", "Undo the last skill document change at the specified revision.", {"member_id": MEMBER_ID, "shared": BOOL, "undo": TEXT}, ("member_id", "undo"), destructive=True),
    row("member_skill_delete", "members.skills.delete", "Delete a member or shared skill package and grants.", {"member_id": MEMBER_ID, "shared": BOOL, "id": ID}, ("member_id", "id"), destructive=True),
    row("member_command_save", "members.commands.save", "Save a member's slash command template containing {input}.", {"member_id": MEMBER_ID, "id": ID, **{key: TEXT for key in ("name", "description", "template")}}, ("member_id", "name", "template")),
    row("member_command_delete", "members.commands.delete", "Delete a member's slash command.", {"member_id": MEMBER_ID, "id": ID}, ("member_id", "id"), destructive=True),
    row("conversation_list", "conversations.list", "Read a member's conversation IDs, including the quick conversation.", {"member_id": MEMBER_ID, "query": TEXT}, ("member_id",)),
    row("dictionary_list", "dictionary.list", "Read the dictionary with entry IDs."),
    row("settings_read", "settings.get", "Read current non-secret settings."),
    row("member_skills_list", "members.skills.list", "Read a member's installed skills including disabled packages.", {"member_id": MEMBER_ID, "shared": BOOL}, ("member_id",)),
    row("member_skill_read", "members.skills.read", "Read a member's complete skill document for editing.", {"member_id": MEMBER_ID, "shared": BOOL, "id": ID}, ("member_id", "id")),
    row("member_commands_list", "members.commands.list", "Read a member's command IDs and templates.", {"member_id": MEMBER_ID}, ("member_id",)),
    row("member_routines_list", "routines.list", "Read any member's routines and IDs.", {"member_id": MEMBER_ID}, ("member_id",)),
    row("memory_document_read", "memory.get", "Read the document and revision before editing.", {"member_id": MEMBER_ID, "space": {"type": "string", "enum": ["own", "shared"]}}),
    row("member_routine_create", "routines.create", "Create a routine for any member.", ROUTINE, ("member_id", "title", "prompt")),
    row("member_routine_update", "routines.update", "Edit a routine for any member.", {"id": ID, **ROUTINE}, ("id",)),
    row("member_routine_delete", "routines.delete", "Delete any member's routine and its schedule.", {"id": ID}, ("id",), destructive=True),
    row("connection_enable", "integrations.set_enabled", "Enable or disable an existing connection.", {"id": TEXT, "enabled": BOOL}, ("id", "enabled")),
    row("connection_tool", "integrations.set_tool_enabled", "Turn one connection tool on/off.", {"id": TEXT, "tool": TEXT, "enabled": BOOL}, ("id", "tool", "enabled")),
    row("connection_tools", "integrations.set_tools_enabled", "Turn several connection tools on/off.", {"id": TEXT, "tools": STRINGS, "enabled": BOOL}, ("id", "tools", "enabled")),
    row("connection_disconnect", "integrations.disconnect", "Disconnect and remove a connection and revoke its stored authorization.", {"id": TEXT}, ("id",), destructive=True),
    row("connection_refresh", "integrations.refresh", "Refresh an existing connection's tool inventory.", {"id": TEXT}, ("id",)),
    row("connector_update", "connectors.set_tools", "Enable/disable a managed app or replace its disabled tool list.", {"id": TEXT, "enabled": BOOL, "disabled_tools": STRINGS}, ("id",)),
    row("connector_disconnect", "connectors.disconnect", "Disconnect a managed app and revoke its authorization.", {"id": TEXT}, ("id",), destructive=True),
    row("dictionary_add", "dictionary.add", "Add a speech dictionary word.", {"word": TEXT}, ("word",)),
    row("dictionary_import", "dictionary.import", "Import speech dictionary words.", {"words": STRINGS}, ("words",)),
    row("dictionary_delete", "dictionary.delete", "Delete a speech dictionary entry.", {"id": ID}, ("id",), destructive=True),
    row("dictation_delete", "history.delete", "Delete a dictation record.", {"id": ID}, ("id",), destructive=True),
    row("dictation_clear", "history.clear", "Delete all dictation records.", destructive=True),
    row("memory_document_update", "memory.update", "Edit a memory document exposed in Settings using the revision from memory.get.", {"text": TEXT, "revision": TEXT, "space": {"type": "string", "enum": ["own", "shared"]}, "member_id": MEMBER_ID}, ("text", "revision")),
    row("memory_clear", "memory.clear", "Clear the first Bot's memory documents.", destructive=True),
    row("memory_summary_clear", "memory.summary_clear", "Clear the first Bot's conversation summaries.", destructive=True),
    # Legacy connection tools keep their names and their existing editable proposal card.
    row("manage_connection", "integrations.set_enabled", "Manage a connection; disconnect always asks. Sign-in still uses the owner's card.",
        {"connection": TEXT, "operation": {"type": "string", "enum": ["enable", "disable", "tool_enable", "tool_disable", "disconnect", "refresh", "reconnect"]}, "tool": TEXT}, ("connection", "operation"), service="connection"),
    row("add_mcp_server", "integrations.proposal", "Propose a custom MCP through the existing editable owner card. Never submit secrets.",
        {"name": TEXT, "transport": {"type": "string", "enum": ["stdio", "http"]}, "command": TEXT, "args": STRINGS, "url": TEXT, "env": STRINGS, "headers": STRINGS}, ("name", "transport"), service="connection"),
    *(row("settings_" + key, "settings.set", description, {"value": schema}, ("value",), setting=key)
      for key, schema, description in (
          ("agent_city", TEXT, "Set the owner's weather city."),
          ("languages", STRINGS, "Set speech languages in priority order."),
          ("history_retention_days", {"type": "integer", "minimum": -1}, "Set history retention days (-1 keeps forever; 0 deletes immediately). Shortening always asks."),
          ("owner_name", TEXT, "Set the owner's name."), ("owner_about", TEXT, "Set the owner's about text."),
          ("owner_output_folder", TEXT, "Set the folder where members save files meant for the owner; existing files never move."),
          ("agent_model", TEXT, "Set the first Bot's model only when explicitly requested by the owner; never to recover a failure."),
          ("quick_model", TEXT, "Set the quick model only when explicitly requested by the owner."),
          ("quick_effort", TEXT, "Set quick reasoning effort only when explicitly requested by the owner."),
          ("image_model", TEXT, "Set the image model only when explicitly requested by the owner."),
          ("video_model", TEXT, "Set the video model only when explicitly requested by the owner."),
          ("model_favorites", {"type": "object", "properties": {key: STRINGS for key in ("cleanup", "answer", "stt")}, "additionalProperties": False}, "Set starred models only at the owner's request."),
          ("first_bot_profile", obj({key: TEXT for key in ("name", "role", "personality", "instructions")}), "Edit the first Bot's profile."),
          ("raphael_draft_first", BOOL, "Set the first Bot's mail draft preference."),
          ("chief_pinned", BOOL, "Pin/unpin the primary contact."),
          ("tts_enabled", BOOL, "Enable/disable the first Bot's read-aloud voice."),
          ("tts_fish_voice", TEXT, "Set the first Bot's read-aloud voice ID."),
          *((key, TEXT, "Choose this model only when the owner explicitly requests it; never recover a failure by changing it.")
            for key in ("cleanup_model", "stt_cloud_model", "assistant_model", "router_model", "memory_model", "pdf_model", "vision_model")),
          *((key, STRINGS, "Edit the model fallback list only when explicitly requested by the owner.")
            for key in ("agent_fallbacks", "cleanup_fallbacks", "router_fallbacks", "vision_fallbacks", "pdf_fallbacks", "stt_fallbacks", "memory_fallbacks")),
          *((key, TEXT, "Choose the service used by this capability.")
            for key in ("web_search_service", "web_read_service", "pdf_service", "searxng_url", "tts_service", "tts_fish_model", "tts_language")),
          *((key, BOOL, "Enable or disable this shared work capability.")
            for key in ("web_search_enabled", "web_read_enabled", "vision_enabled", "pdf_enabled")),
      )),
)
REGISTRY = {item.name: item for item in ACTIONS}
SETTINGS = {item.setting: item for item in ACTIONS if item.setting}
SETTINGS_TOOL = row("settings_update", "settings.set",
                    "Change one listed owner preference with its UI service. Model/effort/fallback/favourite changes require an explicit owner request, never failure recovery. Shortening retention always asks. The value must match the selected key's schema.",
                    {"key": {"type": "string", "enum": list(SETTINGS),
                             "description": "\n".join(f"{key}: {item.description} Value type: {item.schema['properties']['value']['type']}." for key, item in SETTINGS.items())},
                     "value": {}}, ("key", "value"))
REGISTRY[SETTINGS_TOOL.name] = SETTINGS_TOOL
GROUPS = {
    "member_manage": tuple(item for item in ACTIONS if item.name.startswith("member_") and item.name not in
                           {"member_create", "member_update", "member_delete", "member_skill_import", "member_command_save"}),
    "room_manage": tuple(item for item in ACTIONS if item.name.startswith("room_")),
    "dictionary_manage": tuple(item for item in ACTIONS if item.name.startswith("dictionary_")),
}
GROUPED_NAMES = {item.name: name for name, items in GROUPS.items() for item in items}
GROUPED_TOOLS = {
    name: row(name, "", "Manage this area through the owner's UI services. Select an action and supply its exact arguments. Destructive actions always require the owner's yes.\n"
              + "\n".join(item.name + ": " + item.description + " Schema: " + json.dumps(item.schema) for item in items),
              {"action": {"type": "string", "enum": [item.name for item in items]}, "arguments": {"type": "object"}},
              ("action", "arguments"))
    for name, items in GROUPS.items()
}
REGISTRY.update(GROUPED_TOOLS)
DEFINITIONS = {item.name: item.definition for item in ACTIONS if not item.setting and item.name not in GROUPED_NAMES}
DEFINITIONS[SETTINGS_TOOL.name] = SETTINGS_TOOL.definition
DEFINITIONS.update({name: item.definition for name, item in GROUPED_TOOLS.items()})
MANAGEMENT_TOOLS = frozenset(REGISTRY) | {"create_member"}
TIERS = {item.name: item.tier for item in ACTIONS}
TIERS[SETTINGS_TOOL.name] = SETTINGS_TOOL.tier
TIERS.update({name: item.tier for name, item in GROUPED_TOOLS.items()})


# Like team_tools_for, use the owner's request to offer only relevant areas.
# The full catalog remains discoverable; these words never grant authority.
_AREA_WORDS = {
    "members": r"\b(?:members?|assistants?|teammates?|teams?|company|roles?|profiles?|skills?|commands?|routines?|first bot)\b|\b(?:name|rename|call)\s+yourself\b|成員|助手|隊員|團隊|公司|技能|例行|メンバー|スキル",
    "folders": r"\b(?:folders?|company|teams?)\b|\bgroups?\b(?!\s+chats?\b)|資料夾|文件夾|團隊|公司|フォルダ",
    "rooms": r"\b(?:group chats?|rooms?)\b|群聊|群組|グループ",
    "conversations": r"\b(?:conversations?|quick chat|chat history)\b|對話|交談|聊天紀錄|会話",
    "connections": r"\b(?:connections?|connectors?|integrations?|mcp|disconnect|reconnect|app access)\b|連線|連接|斷線|接続",
    "models": r"\b(?:models?|effort|reasoning|favorites?|favourites?)\b|模型|推理|思考|收藏|モデル",
    "settings": r"\b(?:settings?|preferences?|city|retention|dictionary|dictation|memory)\b|設定|偏好|城市|保留|字典|辭典|聽寫|記憶",
}


def tool_areas(name):
    """Derive discovery areas from the same action rows that generate the tools."""
    areas = set()
    for item in GROUPS.get(name, (REGISTRY[name],)):
        prefix = item.rpc.partition(".")[0]
        area = {"members": "members", "routines": "members", "groups": "folders", "rooms": "rooms",
                "conversations": "conversations", "agent": "conversations", "integrations": "connections",
                "connectors": "connections", "dictionary": "settings", "history": "settings",
                "memory": "settings", "settings": "settings"}.get(prefix)
        if area:
            areas.add(area)
    if name in ("member_update", "settings_read", "settings_update"):
        areas.add("models")
    return areas


def tools_for_request(text, *, member_named=False):
    """Select matching management areas without adding another model call."""
    areas = {area for area, pattern in _AREA_WORDS.items() if re.search(pattern, text or "", re.I)}
    if member_named:
        areas.add("members")
    return [name for name in DEFINITIONS if tool_areas(name) & areas]


def resolve(name, arguments):
    """Keep per-preference contracts while offering one bounded settings tool."""
    if name == "settings_update":
        from .protocol import invalid_params
        key = arguments.get("key")
        if not isinstance(key, str) or key not in SETTINGS:
            raise invalid_params("This setting belongs to the owner or does not exist")
        return SETTINGS[key], {"value": arguments.get("value")}
    if name in GROUPS:
        from .protocol import invalid_params
        action = arguments.get("action")
        values = arguments.get("arguments")
        if not isinstance(action, str) or GROUPED_NAMES.get(action) != name or not isinstance(values, dict):
            raise invalid_params("Select a listed management action and its argument object")
        return REGISTRY[action], values
    return REGISTRY.get(name), arguments


def publish(name, arguments):
    """Project an action row to its generated area tool without another policy list."""
    if name in GROUPED_NAMES:
        return GROUPED_NAMES[name], {"action": name, "arguments": arguments}
    item = REGISTRY[name]
    return ("settings_update", {"key": item.setting, **arguments}) if item.setting else (name, arguments)


def validate(value, schema):
    """Reject widening and malformed JSON before entering a UI service."""
    from .protocol import invalid_params

    kind = schema.get("type")
    kinds = kind if isinstance(kind, list) else [kind]
    types = {"object": dict, "array": list, "string": str, "boolean": bool, "integer": int, "null": type(None)}
    if kind and not any(type(value) is types[item] for item in kinds):
        raise invalid_params("Invalid management argument type")
    if "enum" in schema and value not in schema["enum"]:
        raise invalid_params("Invalid management argument choice")
    if type(value) is int and "minimum" in schema and value < schema["minimum"]:
        raise invalid_params("Invalid management argument range")
    if isinstance(value, dict):
        fields = schema.get("properties", {})
        if schema.get("additionalProperties") is False and set(value) - set(fields):
            raise invalid_params("Unknown management fields")
        if set(schema.get("required", [])) - set(value):
            raise invalid_params("Missing management fields")
        for key, item in value.items():
            child = fields.get(key, schema.get("additionalProperties"))
            if isinstance(child, dict):
                validate(item, child)
    if isinstance(value, list) and "items" in schema:
        for item in value:
            validate(item, schema["items"])


def destructive(name, arguments, retention=None):
    # Tier discovery must remain total for malformed model arguments; the
    # service rejects them with a readable schema error before any mutation.
    key = arguments.get("key")
    item = (SETTINGS.get(key) if isinstance(key, str) else None) if name == "settings_update" else REGISTRY.get(name)
    if name in GROUPS:
        from .protocol import RpcError
        try:
            item, arguments = resolve(name, arguments)
        except RpcError:
            return False
    if item is None:
        return False
    if item.destructive or name == "manage_connection" and arguments.get("operation") == "disconnect":
        return True
    if item.setting == "history_retention_days":
        value = arguments.get("value")
        # Negative means forever; zero prunes immediately. Unknown old state fails closed.
        return retention is None or (type(value) is int and value >= 0 and (retention < 0 or value < retention))
    return False


# These are UI-controlled boundaries, never direct management tools. Work tools may
# propose a card, but may not answer it or handle its credentials.
OWNER_ONLY = {
    **dict.fromkeys(("vault.list", "vault.add", "vault.update", "vault.remove", "vault.preview", "vault.cancel", "vault.import"),
                   "Vault metadata, values, sharing and CSV imports belong to the owner."),
    **dict.fromkeys(("owner_questions.answer", "owner_questions.bring", "background.answer", "pages.tool_call",
                     "integrations.card_connect", "integrations.card_cancel", "integrations.card_save", "integrations.card_resume",
                     "integrations.card_done", "integrations.card_stop", "integrations.card_allow", "integrations.card_always", "integrations.card_deny",
                     "integrations.draft_save", "integrations.draft_send", "integrations.draft_discard", "integrations.draft_handover",
                     "integrations.proposal"), "Only the owner answers consent, approval, secrets, handback and editable proposal cards."),
    **dict.fromkeys(("secrets.set_openrouter_key", "secrets.clear_openrouter_key", "services.set_key", "services.clear_key",
                     "connectors.set_key", "connectors.google.configure", "providers.add", "providers.update", "providers.remove", "providers.test"),
                   "Credentials and provider authentication are owner-only."),
    **dict.fromkeys(("brains.cli_login", "brains.cli_disconnect", "chatgpt.sign_in", "chatgpt.cancel", "chatgpt.sign_out",
                     "connectors.connect", "connectors.google.connect", "integrations.connect", "integrations.connect_cancel",
                     "integrations.add", "integrations.update", "integrations.import", "integrations.test"),
                   "Sign-in and custom MCP activation use the existing owner-controlled card."),
    **dict.fromkeys(("safety.rules.create", "safety.rules.update", "safety.rules.delete"), "Safety rules cannot be changed by a model."),
    **dict.fromkeys((f"messaging.{kind}.{action}" for kind in ("telegram", "slack", "discord")
                    for action in ("connect", "set_enabled", "approve", "reject", "remove_user", "disconnect")),
                   "Messaging authentication and access approval belong to the owner."),
    **dict.fromkeys(("computer.viewer_open", "computer.viewer_renew", "computer.viewer_control", "computer.viewer_close",
                     "computer.teach", "computer.revoke", "computer.checkpoints"), "Owner computer viewing, takeover, teaching and restore consent."),
    "computer.lifecycle": "Restarting, updating, repairing or resetting a member computer is the owner's maintenance; reset removes a workspace.",
    **dict.fromkeys(("audio.monitor", "models.ensure", "models.local_use", "models.local_cancel", "models.local_delete"),
                   "Device and downloaded speech-model settings belong to the owner."),
}
INTERACTION_RPCS = {
    **dict.fromkeys(("members.viewing", "rooms.send", "rooms.transcribe", "agent.history.stop", "agent.history.retract",
                     "worker.cancel", "worker.rerun", "agent.speak", "tts.preview", "tts.stop", "pages.open"),
                   "Existing owner conversation, work or presentation entry; not team administration."),
    **dict.fromkeys(("calendar.add", "calendar.update", "calendar.delete"), "Shared calendar work tools retain their existing gate for every member."),
}
# Settings are classified per key, never by the broad settings.set RPC.
OWNER_ONLY_SETTINGS = {
    "chatgpt.registrations.v1": "Internal provider registration state, never model-editable.",
    **dict.fromkeys(("action_mode", "local_commands_mode", "local_commands_seen", "worker_cost_cap_usd", "monthly_limit_usd"),
                   "Permission, local command authority and spending limits are owner-only."),
    **dict.fromkeys(("computer_vm_mode", "computer_ssh_alias", "computer_vm_idle_minutes", "routine_webhook_port", "disconnected_clis", "owner_photo"),
                   "Device, login, webhook or native avatar state belongs to the owner."),
    **dict.fromkeys(("stt_engine", "stt_local_model"),
                   "Device dictation configuration is controlled by the owner."),
    **dict.fromkeys(("routine_owner_seen_ms", "routine_run_window"),
                   "Internal routine guard state (owner activity and the run-rate window), never model-editable."),
}

# Explicit reads, not a suffix heuristic: a newly named RPC is unclassified until
# reviewed. routines.webhook is owner-only because it can reveal a secret.
READ_ONLY_RPCS = frozenset("""
agent.history.list agent.history.search agent.history.sent agent.speech.status
attachments.get audio.devices background.questions.list background.waiting.list
brains.cli chatgpt.models chatgpt.status computer.viewer_status computer.wallpaper
connectors.catalog connectors.categories connectors.status connectors.toolkit connectors.tools
history.list home.overview integrations.audit integrations.catalog integrations.discover
integrations.inventory integrations.preview languages.list links.preview members.list
members.tool_choices members.unread members.voices messages.search messaging.discord.status
messaging.slack.status messaging.telegram.status models.catalog models.local models.status
providers.kinds providers.list providers.models quota.list rooms.list rooms.messages
routines.runs routines.template safety.rules.list secrets.status services.status stats.summary
status.check_openrouter status.get toolsets.list usage.allowances usage.analytics usage.export usage.runs
""".split())
OWNER_ONLY["routines.webhook"] = "Webhook addresses and secrets are owner-only."

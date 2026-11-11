"""Owner-private administration contracts, generated from the owner UI registry.

Member data: name, role, blurb, personality, instructions, group name, avatar preset.
Targets use member IDs; groups use IDs for rename and names for member placement.
The member service owns validation, persistence, defaults and live notifications.
"""

from raphael_core.ui_words import ui_word, with_ui_words
from dataclasses import dataclass
import re
from typing import Any

from .policy import Tier
from ..management import DEFINITIONS as MANAGEMENT_DEFINITIONS, MANAGEMENT_TOOLS, TIERS as MANAGEMENT_TIERS


@dataclass(frozen=True)
class MemberDraft:
    id: str
    name: str
    role: str = ""
    blurb: str = ""
    personality: str = ""
    instructions: str = ""
    group: str = ""
    avatar_preset: str = ""
    member_id: int | None = None

    def to_json(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "id": self.id,
            "name": self.name,
            "role": self.role,
            "blurb": self.blurb,
            "personality": self.personality,
            "instructions": self.instructions,
            "group": self.group,
            "avatar_preset": self.avatar_preset,
        }
        if self.member_id is not None:
            data["member_id"] = self.member_id
        return data


@dataclass(frozen=True)
class GroupDraft:
    id: str
    name: str
    group_id: int | None = None

    def to_json(self) -> dict[str, Any]:
        data: dict[str, Any] = {"id": self.id, "name": self.name}
        if self.group_id is not None:
            data["group_id"] = self.group_id
        return data


def definition(description, properties=None, required=()):
    return {"description": description, "parameters": {"type": "object", "properties": properties or {},
            "required": list(required), "additionalProperties": False}}


# Team reads do not grant management authority.
TEAM_READS = frozenset({"team_overview", "team_work"})
DEFINITIONS = {
    "team_overview": definition("Read a compact complete roster: IDs, names, roles, models and counts. Supply member_id for that member's full brain, grants, tools, skills, commands and routines. Rooms are limited to the caller's own membership.",
                                {"member_id": {"type": "integer", "minimum": 0}}),
    "team_work": definition("Read the team's recorded work for a report or status overview (報告, 統整, 總覽, 進度, 狀況, report, overview, status, progress): each member's role, recent finished and failed work, unfinished work, what waits for the owner, routines, outputs and hand-offs between members. "
                            "Read-only; every item is a stored record with its local time and nothing is estimated: write only these facts and say what is unknown. Only in the owner's private chat. member_id narrows it to one member; days (1-30, default 14) is the window.",
                            {"member_id": {"type": "integer", "minimum": 0},
                             "days": {"type": "integer", "minimum": 1, "maximum": 30}}),
    **MANAGEMENT_DEFINITIONS,
}
TIERS = {"team_overview": Tier.T0, "team_work": Tier.T0, **MANAGEMENT_TIERS}
BATCH_TOOLS = {"member_create", "create_member", "member_update", "group_create", "group_rename"}
CONFIRM_TOOLS = (set(DEFINITIONS) - TEAM_READS) | {"create_member", "routine_create", "routine_update", "routine_delete"}
# The speaker's own routine writes are administrative changes like the registry's; they are asked and held with them.
ROUTINE_WRITES = frozenset({"routine_create", "routine_update", "routine_delete"})
# What a member's turn in the owner's private chat holds back and asks once, on one card, at its end (`management_batch`).
STAGED_TOOLS = MANAGEMENT_TOOLS | ROUTINE_WRITES
# Every call that is an administrative card: none of them has a timer when the owner answers it in a conversation.
ADMIN_CARD_TOOLS = frozenset(CONFIRM_TOOLS | STAGED_TOOLS | {"team_admin_batch", "management_batch"})

DELEGATED_MANAGEMENT_GUIDANCE = (
    "Member management cannot be delegated through ask_member or handoff. Every member has management tools "
    "in the owner's private chat. Make the requested member changes yourself there; in a room, ask the owner "
    "to continue in your private chat. Do not try file, database or shell workarounds."
)


def delegated_management(request):
    """Recognize an operational member-management request before creating another member's task."""
    if not isinstance(request, str):
        return False
    operation = r'(?:\b(?:create|add|update|edit|change|rename|remove|delete|set|assign|move|enable|disable)\b|新增|建立|修改|更改|更新|刪除|删除|設定|设置|改名|調整|调整|移動|移动|追加|変更|削除)'
    subject = r'(?:members?\b|teammates?\b|bots?\b|groups?\b|成員|成员|群組|群组|メンバー|グループ)'
    from ..management import ACTIONS
    tools = '|'.join(re.escape(item.name) for item in ACTIONS if item.name.startswith(('member_', 'group_')))
    # Source-code work and questions about a tool are not app-state management.
    if re.search(r'\b(?:implementation|code|tests?|regression|documentation)\b|程式碼|實作|測試|測试|ソースコード', request, re.I):
        return False
    request = re.sub(r"(?:do not|don't|never|不要|不得|勿)[^.;。\n]*", '', request, flags=re.I)
    return bool(re.search(r'\b(?:call|use|invoke|run|execute)\b.{0,40}\b(?:' + tools + r'|create_member)\b', request, re.I)
                or re.search(operation + r'.{0,60}' + subject, request, re.I)
                or re.search(subject + r'.{0,40}' + operation, request, re.I)
                or re.search(operation + r'.{0,40}(?:model|instructions|personality|模型|指令|性格).{0,20}(?:\bto\b|為|为|成)', request, re.I))

LEADERSHIP = (
    "\nEvery member has the same management tools in the owner's private chat. Use team_overview and your team administration tools "
    "(find_tools finds them, use_tool calls them) to create and change members, groups, routines, skills and commands. Use returned IDs. "
    "You decide how many members the work needs. When the owner's approval setting asks first, member creates, "
    "updates and groups are proposals staged until the turn ends: collect every requested change before your final "
    "reply; pending_approval is not success and has no new ID. Once the owner approves, you go on in the same "
    "turn and are told the real IDs. Otherwise they happen at once and each result carries the real ID: hand "
    "work to the new members with those IDs in the same turn. Destructive changes always need approval, including allow-all mode. "
    "Change a model or effort only when the owner explicitly asks, never to recover from a failure. "
    "After creating members, report their names and roles in one short message. "
    "Grok template instructions that say CreateAgent mean member_create here (legacy alias: create_member). "
    "Do not claim the creation interface is disconnected; attempt the provided tools and report "
    "their actual results. Never claim an action succeeded without a successful result."
)


def proposal_operations(calls: list[dict]) -> list[dict]:
    """Combine sequential edits to one target without losing fields from earlier rounds."""
    operations: list[dict] = []
    targets: dict[tuple[str, int], dict] = {}
    for call in calls:
        operation = {"name": call["name"], "arguments": dict(call["arguments"])}
        name, args = operation["name"], operation["arguments"]
        if name in ("member_update", "group_rename") and type(args.get("id")) is int:
            key = (name, args["id"])
            if key in targets:
                targets[key]["arguments"].update(args)
                continue
            targets[key] = operation
        operations.append(operation)
    return operations


_ACTION_NAMES = ("member_create", "member_update", "member_delete", "group_create", "group_rename", "member_skill_import", "member_command_save", "routine_create", "routine_update", "routine_delete")
_ACTION_TITLES = {
    "en": ("Create member", "Update member", "Permanently delete member and all its data", "Create group", "Rename group", "Import member skills", "Save member command", "Create routine", "Update routine", "Delete routine"),
    "zh-TW": ("建立成員", "更新成員", "永久刪除成員及其所有資料", "建立群組", "重新命名群組", "匯入成員技能", "儲存成員指令", "建立例行任務", "更新例行任務", "刪除例行任務"),
    "ja": ("メンバーを作成", "メンバーを更新", "メンバーと全データを完全に削除", "グループを作成", "グループ名を変更", "スキルをインポート", "コマンドを保存", "定期タスクを作成", "定期タスクを更新", "定期タスクを削除"),
}


def title_of(name: str, language: str) -> str:
    """What a change of the first group of tools does, in the owner's language; the tool's name when none says."""
    from ..ui_languages import fixed_language
    language = fixed_language(language)
    name = "member_create" if name == "create_member" else name
    return with_ui_words(_ACTION_TITLES)[language][_ACTION_NAMES.index(name)] if name in _ACTION_NAMES else name


def confirmation(name: str, arguments: dict, language: str, target: str = "", *, question: bool = True) -> str:
    """Complete owner-facing details; never truncate fields that the owner is approving. No ID line: the card names
    its target (owner, 2026-11-11: 「不用這麼複雜」)."""
    from ..ui_languages import fixed_language
    language = fixed_language(language)
    fields = ("name", "role", "blurb", "personality", "instructions", "group", "avatar_preset", "source", "description", "template", "title", "prompt", "schedule", "enabled")
    labels = with_ui_words({
        "en": ("Name", "Role", "About", "Personality", "Instructions", "Group", "Avatar preset", "Skill source", "Description", "Template", "Title", "Prompt", "Schedule", "Enabled"),
        "zh-TW": ("名稱", "職責", "簡介", "個性", "工作指示", "群組", "預設頭像", "技能來源", "說明", "指令範本", "任務名稱", "任務內容", "排程", "啟用"),
        "ja": ("名前", "役割", "紹介", "性格", "指示", "グループ", "アバター", "スキルの取得元", "説明", "テンプレート", "タスク名", "内容", "スケジュール", "有効"),
    })
    title = title_of(name, language)
    separator = ": " if language == "en" else "："
    lines = [title + (separator + target if target else "")]
    for field, label in zip(fields, labels[language]):
        if field in arguments:
            value = arguments[field]
            if field == "schedule" and isinstance(value, dict):
                # Every schedule value is visible, including advanced fields from existing RPCs.
                value = "; ".join(f"{key}{separator}{item}" for key, item in value.items())
            lines.append(f"{label}{separator}{value}")
    return "\n".join(lines) + (with_ui_words({"en": "\nAllow this change?", "zh-TW": "\n允許這項變更嗎？", "ja": "\nこの変更を許可しますか？"})[language] if question else "")

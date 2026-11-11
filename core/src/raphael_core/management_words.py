"""What the owner reads on the card of a management change, in the owner's language and plain words.

A card names each change by its effect and its target by name (never an ID, never JSON, never a fragment of another
language: owner, 2026-11-11: 「不用這麼複雜」, and the standing rules of one language and no raw JSON). Several changes
asked for in one turn share one card: one line each (`batch`), one yes for all of them.
"""

from .ui_words import ui_word

# Effect of each action that cannot be undone, as (English, Traditional Chinese, Japanese); the other twelve
# languages come from ui_words by the English text (_card_words_data.py).
EFFECTS = {
    "member_primary": ("Make this member the primary contact and give it management", "移轉主要聯絡人與管理權", "主担当と管理権限を移動"),
    "member_history_clear": ("Clear all of this member's conversation records", "清除此成員的全部對話紀錄", "メンバーの全会話履歴を消去"),
    "member_history_delete": ("Delete one conversation record", "刪除此則對話紀錄", "会話記録を削除"),
    "group_delete": ("Delete the folder (its members stay, ungrouped)", "刪除資料夾；成員保留並移至未分類", "フォルダーを削除しメンバーは保持"),
    "room_members": ("Replace the group chat's members", "替換群聊成員", "グループのメンバーを置換"),
    "room_delete": ("Delete the group chat and all its messages", "刪除群聊及全部訊息", "グループと全メッセージを削除"),
    "conversation_clear": ("Clear all records of this conversation", "清除此對話的全部紀錄", "会話の全記録を消去"),
    "member_skill_undo": ("Undo the last change to a skill", "還原技能的上一次修改", "スキルの直前の変更を元に戻す"),
    "member_skill_delete": ("Delete the skill and its permissions", "刪除技能套件與授權", "スキルと権限を削除"),
    "member_command_delete": ("Delete the member's command", "刪除成員指令", "コマンドを削除"),
    "member_routine_delete": ("Delete the routine and its schedule", "刪除例行任務及排程", "定期タスクと予定を削除"),
    "connection_disconnect": ("Disconnect and revoke its authorization", "中斷連線並撤銷認證", "接続と認証を解除"),
    "connector_disconnect": ("Disconnect the app and revoke its authorization", "中斷應用程式連線並撤銷認證", "アプリ接続と認証を解除"),
    "manage_connection": ("Change the connection (disconnecting revokes its authorization)", "變更連線；中斷連線會撤銷認證", "接続を変更・認証を解除"),
    "dictionary_delete": ("Delete the dictionary word", "刪除字典詞彙", "辞書の単語を削除"),
    "dictation_delete": ("Delete this dictation record", "刪除此則聽寫紀錄", "音声入力記録を削除"),
    "dictation_clear": ("Delete all dictation records", "刪除全部聽寫紀錄", "音声入力の全記録を削除"),
    "memory_clear": ("Clear the memory documents", "清除記憶文件", "メモリ文書を消去"),
    "memory_summary_clear": ("Clear the conversation summaries", "清除對話摘要", "会話の要約を消去"),
    "settings_history_retention_days": ("Change how long records are kept (older records are deleted for good)", "變更保留天數；較舊紀錄會被永久刪除", "保持期間を変更・古い記録を完全削除"),
}
GENERIC = ("Apply this management change", "套用下列管理變更", "次の管理変更を適用")

# What a change does that can be undone, or a reading (these are asked in the mode that asks first and held with the
# rest on one card), by kind of change; `FAMILY` says which kind each action is, and `settings_*` are all "setting".
FAMILIES = {
    "read": ("Read information (nothing is changed)", "讀取資料（不會變更任何內容）", "情報を読み取ります（変更はありません）"),
    "member_duplicate": ("Duplicate this member", "複製此成員", "このメンバーを複製"),
    "member_picture": ("Change this member's picture or cover", "變更此成員的圖片或封面", "メンバーの画像またはカバーを変更"),
    "room_create": ("Create a group chat", "建立群聊", "グループチャットを作成"),
    "room_update": ("Change the group chat", "變更群聊設定", "グループチャットを変更"),
    "room_stop": ("Stop all work in the group chat", "停止群聊中的所有工作", "グループチャットの全作業を停止"),
    "group_update": ("Change the folder", "變更資料夾", "フォルダーを変更"),
    "routine_create": ("Create a routine", "建立例行任務", "定期タスクを作成"),
    "routine_update": ("Change a routine", "變更例行任務", "定期タスクを変更"),
    "skill_update": ("Change a skill or turn it on or off", "變更技能或將其開啟或關閉", "スキルを変更またはオン/オフ"),
    "connection_toggle": ("Turn a connection or its tools on or off", "開啟或關閉連線或其工具", "接続またはそのツールをオン/オフ"),
    "connection_refresh": ("Refresh the connection's tools", "重新整理連線的工具", "接続のツールを更新"),
    "dictionary_add": ("Add words to the dictionary", "新增字典詞彙", "辞書に単語を追加"),
    "memory_update": ("Edit the memory document", "編輯記憶文件", "メモリ文書を編集"),
    "setting": ("Change a setting", "變更一項設定", "設定を1つ変更"),
    "mark_read": ("Mark conversations as read", "將對話標為已讀", "会話を既読にする"),
    "add_mcp_server": ("Add a custom connection", "新增自訂連線", "カスタム接続を追加"),
}
FAMILY = {
    "member_duplicate": "member_duplicate", "member_avatar": "member_picture", "member_cover": "member_picture",
    "room_create": "room_create", "room_update": "room_update", "room_stop": "room_stop", "group_update": "group_update",
    "member_routine_create": "routine_create", "member_routine_update": "routine_update", "member_skill_update": "skill_update",
    "connection_enable": "connection_toggle", "connection_tool": "connection_toggle", "connection_tools": "connection_toggle",
    "connector_update": "connection_toggle", "connection_refresh": "connection_refresh",
    "dictionary_add": "dictionary_add", "dictionary_import": "dictionary_add", "memory_document_update": "memory_update",
    "member_read": "mark_read", "members_mark_all_read": "mark_read", "add_mcp_server": "add_mcp_server",
}

_CJK = ("zh-TW", "zh-CN", "ja")


def say(language: str, english: str, chinese: str, japanese: str) -> str:
    """A fixed line in `language`: three written by hand, the other twelve from the catalogue."""
    if language == "en":
        return english
    if language == "zh-TW":
        return chinese
    if language == "ja":
        return japanese
    return ui_word(english, language)


def effect(name: str, language: str) -> str:
    """What the change does, in words."""
    from .management import READS

    if name in EFFECTS:
        return say(language, *EFFECTS[name])
    kind = "read" if name in READS else "setting" if name.startswith("settings_") else FAMILY.get(name)
    return say(language, *FAMILIES.get(kind, GENERIC))


def quoted(target: str, language: str) -> str:
    return f"「{target}」" if language in _CJK else f"“{target}”"


def listed(targets: list[str], language: str) -> str:
    """The targets of one change, each quoted, in one run."""
    return ("、" if language in _CJK else ", ").join(quoted(target, language) for target in targets)


def joined(label: str, detail: str, language: str) -> str:
    """`label` and what it is about, on one line."""
    if not detail:
        return label
    return f"{label}：{detail}" if language in _CJK else f"{label}: {detail}"


def count_title(count: int, language: str, asker: str = "") -> str:
    """How many changes the card asks for, led by the member that asks when it is not Raphael."""
    title = say(language, "{count} changes need your approval", "有 {count} 項變更需要你同意", "{count} 件の変更に承認が必要です").format(count=count)
    return joined(quoted(asker, language), title, language) if asker else title


def question(language: str, *, several: bool) -> str:
    """The closing question of a card (the words the other cards of the team administration already use)."""
    if language in ("en", "zh-TW", "ja"):
        table = {"en": ("Allow this change?", "Allow all these changes?"), "zh-TW": ("允許這項變更嗎？", "允許以上所有變更嗎？"),
                 "ja": ("この変更を許可しますか？", "すべての変更を許可しますか？")}
        return table[language][several]
    return ui_word("\n\nAllow all these changes?" if several else "\nAllow this change?", language).strip()


def batch(lines: list[str], language: str, *, asker: str = "") -> str:
    """One card for several changes: how many, one line each, and one question."""
    return "\n".join([count_title(len(lines), language, asker), *lines, question(language, several=True)])


def outcome(change: str, language: str, *, done: bool, gone: bool = False) -> str:
    """What came of one change after the owner's yes."""
    if done:
        return say(language, "Done: {change}", "已完成：{change}", "完了：{change}").format(change=change)
    if gone:
        return say(language, "Not done: {change} (it no longer exists)", "未完成：{change}（它已不存在）", "未完了：{change}（すでに存在しません）").format(change=change)
    return say(language, "Not done: {change}", "未完成：{change}", "未完了：{change}").format(change=change)


def expired(language: str) -> str:
    return say(language, "Timed out before you answered, so nothing was changed", "你還沒回答就超時了，所以沒有做任何變更", "回答前に時間切れとなり、何も変更していません")

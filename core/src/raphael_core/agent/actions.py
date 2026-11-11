"""Bounded public action words, retained only with the conversation that owns them."""

from raphael_core.ui_words import ui_word, with_ui_words
import json
import asyncio
import re
import sqlite3
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
from urllib.parse import urlsplit
from uuid import uuid4
from .steps import reason_of

_ACTIVE = ContextVar("public_action", default=None)
_PRIVATE = re.compile(r"password|passwd|token|secret|key|authorization|credential|cookie|login", re.I)
_SENSITIVE = re.compile(r"(?:https?://|[\w.+-]+@[\w.-]+|(?:sk|ghp|gho|eyJ)[-_A-Za-z0-9]{8,}|[A-Za-z0-9_-]{24,}|password|token|secret|authorization|api.?key)", re.I)
_APPS = {"googlecalendar":"Google Calendar", "github":"GitHub", "gmail":"Gmail", "notion":"Notion", "slack":"Slack", "googledrive":"Google Drive"}
_WORDS = with_ui_words({
    "en": {
        "read": ("Reading {x}", "Read {x}"), "write": ("Writing {x}", "Wrote {x}"),
        "edit": ("Editing {x}", "Edited {x}"), "search": ('Searching for “{x}”', 'Searched for “{x}”'),
        "page": ("Reading {x}", "Read {x}"), "command": ("Running {x}", "Ran {x}"),
        "computer_command": ("Running {x} on your computer", "Ran {x} on your computer"),
        "job": ("Checking command progress", "Checked command progress"),
        "ask": ("Asking {x}", "Asked {x}"), "routine": ("Managing routine {x}", "Managed routine {x}"),
        "calendar": ("Managing calendar event {x}", "Managed calendar event {x}"),
        "click": ("Clicking on the computer", "Clicked on the computer"),
        "type": ("Typing on the computer", "Typed on the computer"),
        "computer": ("Using the computer", "Used the computer"),
        "use": ("Using {x}", "Used {x}"), "view": ("Checking {x}", "Checked {x}"),
        "create": ("Creating in {x}", "Created in {x}"), "update": ("Updating {x}", "Updated {x}"),
        "delete": ("Deleting from {x}", "Deleted from {x}"), "send": ("Sending through {x}", "Sent through {x}"),
        "private": ("Waiting for private sign-in", "Handled private sign-in"),
    },
    "zh-TW": {
        "read": ("正在讀取 {x}", "讀取了 {x}"), "write": ("正在寫入 {x}", "寫入了 {x}"),
        "edit": ("正在修改 {x}", "修改了 {x}"), "search": ("正在搜尋「{x}」", "搜尋了「{x}」"),
        "page": ("正在閱讀 {x}", "閱讀了 {x}"), "command": ("正在執行 {x}", "執行了 {x}"),
        "computer_command": ("正在你的電腦上執行 {x}", "在你的電腦上執行了 {x}"),
        "job": ("正在查看指令的進度", "查看了指令的進度"),
        "ask": ("正在問 {x}", "問了 {x}"), "routine": ("正在處理例行工作 {x}", "處理了例行工作 {x}"),
        "calendar": ("正在處理行事曆活動 {x}", "處理了行事曆活動 {x}"),
        "click": ("正在電腦上點選", "在電腦上點選了項目"), "type": ("正在電腦上輸入文字", "在電腦上輸入了文字"),
        "computer": ("正在使用電腦", "使用了電腦"), "use": ("正在使用 {x}", "使用了 {x}"),
        "view": ("正在查看 {x}", "查看了 {x}"), "create": ("正在 {x} 建立項目", "在 {x} 建立了項目"),
        "update": ("正在更新 {x}", "更新了 {x}"), "delete": ("正在刪除 {x} 的項目", "刪除了 {x} 的項目"),
        "send": ("正在透過 {x} 傳送", "透過 {x} 傳送了內容"), "private": ("正在等待私人登入", "處理了私人登入"),
    },
    "ja": {
        "read": ("{x} を読んでいます", "{x} を読みました"), "write": ("{x} を書いています", "{x} を書きました"),
        "edit": ("{x} を編集しています", "{x} を編集しました"), "search": ("「{x}」を検索しています", "「{x}」を検索しました"),
        "page": ("{x} を読んでいます", "{x} を読みました"), "command": ("{x} を実行しています", "{x} を実行しました"),
        "computer_command": ("あなたのパソコンで {x} を実行しています", "あなたのパソコンで {x} を実行しました"),
        "job": ("コマンドの進行状況を確認しています", "コマンドの進行状況を確認しました"),
        "ask": ("{x} に聞いています", "{x} に聞きました"), "routine": ("ルーティン {x} を管理しています", "ルーティン {x} を管理しました"),
        "calendar": ("予定 {x} を管理しています", "予定 {x} を管理しました"),
        "click": ("パソコンでクリックしています", "パソコンでクリックしました"), "type": ("パソコンで入力しています", "パソコンで入力しました"),
        "computer": ("パソコンを使っています", "パソコンを使いました"), "use": ("{x} を使っています", "{x} を使いました"),
        "view": ("{x} を確認しています", "{x} を確認しました"), "create": ("{x} で作成しています", "{x} で作成しました"),
        "update": ("{x} を更新しています", "{x} を更新しました"), "delete": ("{x} から削除しています", "{x} から削除しました"),
        "send": ("{x} で送信しています", "{x} で送信しました"), "private": ("非公開のログインを待っています", "非公開のログインを処理しました"),
    },
})


def _safe(value):
    if not isinstance(value, str) or _SENSITIVE.search(value):
        return ""
    return " ".join(value.split())[:45]


def _command(value):
    words = []
    for word in str(value or "").split():
        if not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9.-]{0,20}", word) or _SENSITIVE.search(word):
            break
        words.append(word)
        if len(words) == 4:
            break
    return " ".join(words)


def sentence(tool, arguments, language, *, server=None):
    if str(tool).endswith("COMPOSIO_MULTI_EXECUTE_TOOL"):
        calls = [call for call in (arguments or {}).get("tools", []) if isinstance(call, dict) and re.fullmatch(r"[A-Z][A-Z0-9_]{1,100}", str(call.get("tool_slug", "")))]
        if calls:
            parts = [_sentence(call["tool_slug"], {}, language, server="composio") for call in calls]
            return tuple(_bound(" · ".join(part[index] for part in parts)) for index in (0, 1))
    return _sentence(tool, arguments, language, server=server)


def _bound(text):
    return text if len(text) <= 60 else text[:59] + "…"


def _sentence(tool, arguments, language, *, server=None):
    from ..ui_languages import fixed_language
    language = fixed_language(language)
    words = _WORDS.get(language, _WORDS["zh-TW"])
    args = {k: v for k, v in (arguments or {}).items() if not _PRIVATE.search(k)}
    short = str(tool).rsplit("/", 1)[-1].rsplit("__", 1)[-1]
    if server and (server.lower() in ("composio", "connectors_composio") or server.startswith("composio:")):
        server = "composio"
    tokens = re.findall(r"[a-z]+", short.lower())
    action, target = "use", with_ui_words({"en": "a tool", "ja": "ツール"}).get(language, "工具")
    if _PRIVATE.search(short):
        action = "private"
    elif short in ("local_exec", "vm_exec", "exec_command", "run_command", "execute_command") or server == "computer" and short in ("exec", "command", "shell"):
        action = "command" if short == "local_exec" else "computer_command"
        if short == "local_exec":
            from ..failures import redact
            command = str(args.get("command") or "").splitlines()
            target = (_command(command[0]) if _SENSITIVE.search(command[0]) else redact(command[0].strip())) if command else ""
        else:
            target = _command(args.get("command", args.get("cmd", "")))
        target = target or with_ui_words({"en": "a command", "ja": "コマンド"}).get(language, "指令")
    elif short == "local_job":
        action = "job"
    elif short in ("read_file", "Read", "read_document", "write_file", "Write", "edit_file", "Edit", "apply_patch", "read_attachment"):
        action = "write" if "write" in short.lower() else "edit" if short in ("Edit", "edit_file", "apply_patch") else "read"
        path = args.get("path", args.get("file_path", args.get("filename", "")))
        target = _safe(str(path).replace("\\", "/").rsplit("/", 1)[-1]) or with_ui_words({"en": "a file", "ja": "ファイル"}).get(language, "檔案")
    elif short in ("web_search", "search_query", "search_code", "code_search", "Grep", "grep", "rg"):
        action = "search"
        target = _safe(args.get("query", args.get("pattern", ""))) or with_ui_words({"en": "information", "ja": "情報"}).get(language, "資料")
    elif short in ("web_read", "WebFetch", "fetch_url"):
        action = "page"
        try:
            target = _safe(urlsplit(args.get("url", "")).hostname or "")
        except ValueError:
            target = ""
        target = target or with_ui_words({"en": "a web page", "ja": "ウェブページ"}).get(language, "網頁")
    elif short in ("ask_member", "consult", "handoff"):
        action, target = "ask", _safe(args.get("member_name", args.get("member", args.get("name", "")))) or with_ui_words({"en": "a colleague", "ja": "同僚"}).get(language, "同事")
    elif ("routine" in tokens or "calendar" in tokens) and server in (None, "Raphael", "local"):
        action = "routine" if "routine" in tokens else "calendar"
        target = _safe(args.get("title", args.get("name", "")))
    elif server == "computer" or str(tool).startswith("computer__"):
        action = "type" if any(t in tokens for t in ("type", "typing", "input", "write")) else "click" if "click" in tokens else "computer"
    elif server and server not in ("Raphael", "local", "composio") or server == "composio" or short.isupper():
        app = tokens[0] if server == "composio" or short.isupper() else server
        target = _safe(_APPS.get(str(app).lower(), str(app).replace("_", " ").title())) or target
        action = next((kind for verbs, kind in (({"search", "list", "get", "fetch", "read"}, "view"), ({"create", "add"}, "create"), ({"update", "edit"}, "update"), ({"delete", "remove"}, "delete"), ({"send", "post", "reply"}, "send")) if set(tokens) & verbs), "use")
    return tuple(_bound(text.format(x=target).strip()) for text in words[action])


def is_action(text):
    try:
        return json.loads(text).get("type") == "action"
    except (ValueError, TypeError, AttributeError):
        return False


def _targets(history, tool, arguments):
    args = dict(arguments or {})
    short = str(tool).rsplit("/", 1)[-1].rsplit("__", 1)[-1]
    target = None
    if short in ("ask_member", "handoff") and type(args.get("member_id")) is int:
        target = ("members", "name", args["member_id"], "member_name")
    elif short.startswith("routine_") and type(args.get("id")) is int:
        target = ("routines", "title", args["id"], "title")
    elif short.startswith("calendar_") and type(args.get("id")) is int:
        target = ("calendar_events", "title", args["id"], "title")
    if target and not args.get(target[3]):
        table, column, identifier, field = target
        row = history._conn.execute(f"SELECT {column} FROM {table} WHERE id=?", (identifier,)).fetchone()
        if row:
            args[field] = row[0]
    return args


@contextmanager
def action_scope(history, turn_id, language, tool, arguments, *, server=None, changed=None):
    if not turn_id or _ACTIVE.get() == (history._conn, turn_id):
        yield {}
        return
    present, past = sentence(tool, _targets(history, tool, arguments), language, server=server)
    key = uuid4().hex
    result = {}
    def publish(state):
        try:
            history.add_message(turn_id, "event", json.dumps({"type": "action", "id": key, "present": present, "past": past, "state": state, **result}, ensure_ascii=False))
        except sqlite3.Error:
            return
        if changed and history.get(turn_id):
            changed()
    token = _ACTIVE.set((history._conn, turn_id))
    ending = "done"
    try:
        publish("running")
        yield result
    except BaseException as exc:
        data = getattr(exc, "data", None)
        stop = data.get("stop") if isinstance(data, dict) else None
        if stop == "waiting":
            ending = "paused"
        else:
            outcome = "cancelled" if isinstance(exc, asyncio.CancelledError) else "error"
            result.update(outcome=outcome, reason=reason_of(outcome, stop))
        raise
    finally:
        try:
            publish(ending)
        finally:
            _ACTIVE.reset(token)


def action_call(context):
    def decorate(function):
        @wraps(function)
        async def observed(*args, **kwargs):
            details = context(*args, **kwargs)
            with (action_scope(**details) if isinstance(details, dict) else details) as status:
                result = await function(*args, **kwargs)
                ok = getattr(result, "ok", True)
                if status is not None:
                    status.update(outcome="ok" if ok else "error", reason=reason_of("ok" if ok else "error", getattr(result, "kind", getattr(result, "error", None))))
                return result
        return observed
    return decorate

"""Shared, bounded failure diagnostics. Raw packets and credentials never leave ingress."""

import json
import logging
import re
from collections import deque
from dataclasses import dataclass

KINDS = frozenset(("credits", "usage_limit", "rate_limit", "overloaded", "server", "auth_expired",
                   "network", "permission_denied", "not_found", "tool_broken", "invalid_request", "timeout", "refused", "unknown",
                   "chatgpt_unavailable", "chatgpt_plan_unavailable", "chatgpt_scope"))
TRANSIENT = frozenset(("rate_limit", "overloaded", "server", "network", "timeout"))
RETRY_WAITS = (1.0, 3.0, 8.0)
RECENT = deque(maxlen=40)
logger = logging.getLogger(__name__)

# Owner copy never interpolates provider reasons; those remain in wire diagnostics.
_OWNER_MESSAGES = {
    "zh-TW": {
        "invalid_request": "{name} 無法接受連線請求的格式，需要更新連線功能。",
        "credits": "{name} 的點數用完了，補充後就能繼續。",
        "usage_limit": "{name} 的用量已達上限，請等額度重設或選擇其他模型。",
        "rate_limit": "{name} 暫時收到太多請求，請稍後再試。",
        "overloaded": "{name} 目前忙碌中，請稍後再試或選擇其他模型。",
        "server": "{name} 的服務暫時出問題了，請稍後再試。",
        "auth_expired": "{name} 還沒登入或缺少金鑰，請到設定 › 連接完成連線。",
        "network": "{name} 目前無法連線，請確認網路後再試。",
        "permission_denied": "{name} 沒有執行這項操作的權限，請檢查連接權限。",
        "not_found": "{name} 找不到需要的內容，請確認目標或改用其他來源。",
        "tool_broken": "{name} 的工具未能正常運作，請檢查連接設定或改用其他方法。",
        "timeout": "{name} 等待回應太久了，請稍後再試。",
        "refused": "{name} 拒絕了這項請求，請調整請求並遵守原有的限制。",
        "unknown": "{name} 未能完成這項工作，請檢查設定後再試一次。",
    },
    "ja": {
        "invalid_request": "{name} への接続リクエストに互換性がありません。接続機能の更新が必要です。",
        "credits": "{name} のクレジットがなくなりました。追加すると続けられます。",
        "usage_limit": "{name} の利用上限に達しました。利用枠のリセットを待つか、別のモデルを選んでください。",
        "rate_limit": "{name} へのリクエストが一時的に多すぎます。しばらくしてから再試行してください。",
        "overloaded": "{name} は現在混み合っています。しばらく待つか、別のモデルを選んでください。",
        "server": "{name} のサービスで一時的な問題が起きています。しばらくしてから再試行してください。",
        "auth_expired": "{name} にログインしていないか、必要なキーがありません。設定の「接続」で接続を完了してください。",
        "network": "{name} に接続できません。ネットワークを確認してから再試行してください。",
        "permission_denied": "{name} にはこの操作の権限がありません。接続の権限を確認してください。",
        "not_found": "{name} で必要な内容が見つかりません。対象を確認するか、別の情報源を使ってください。",
        "tool_broken": "{name} のツールが正常に動作しませんでした。接続設定を確認するか、別の方法を試してください。",
        "timeout": "{name} の応答を待つ時間が長すぎました。しばらくしてから再試行してください。",
        "refused": "{name} はこのリクエストを拒否しました。元の制限を守り、リクエストを見直してください。",
        "unknown": "{name} はこの作業を完了できませんでした。設定を確認してからもう一度試してください。",
    },
    "en": {
        "invalid_request": "Raphael's connection request is incompatible with {name}. The connection feature needs updating.",
        "credits": "{name} has run out of credits. Add credits to continue.",
        "usage_limit": "{name} has reached its usage limit. Wait for it to reset or choose another model.",
        "rate_limit": "{name} is receiving too many requests right now. Try again shortly.",
        "overloaded": "{name} is busy right now. Wait a little or choose another model.",
        "server": "{name} is having a temporary service problem. Try again later.",
        "auth_expired": "{name} is signed out or missing a required key. Complete the connection in Settings > Connections.",
        "network": "{name} cannot connect right now. Check your network and try again.",
        "permission_denied": "{name} does not have permission for this action. Check the connection permissions.",
        "not_found": "{name} could not find the requested content. Check the target or use another source.",
        "tool_broken": "{name}'s tool did not work correctly. Check the connection settings or try another approach.",
        "timeout": "{name} took too long to respond. Try again later.",
        "refused": "{name} declined this request. Revise the request while respecting the original restrictions.",
        "unknown": "{name} could not complete this task. Check the settings and try once more.",
    },
}


_OWNER_MESSAGES["en"].update({
    "chatgpt_unavailable": "{name} cannot check ChatGPT plan availability right now. Try again later.",
    "chatgpt_plan_unavailable": "{name} cannot use the selected account's ChatGPT plan. Check account and workspace eligibility.",
    "chatgpt_scope": "{name} has no permission to use your ChatGPT plan. Sign in again and enable plan usage.",
})
_OWNER_MESSAGES["zh-TW"].update({
    "chatgpt_unavailable": "{name} 目前無法確認訂閱方案是否可用，請稍後重試。",
    "chatgpt_plan_unavailable": "{name} 無法使用所選帳號的訂閱方案，請確認帳號與工作區資格。",
    "chatgpt_scope": "{name} 尚未獲准使用訂閱方案，請重新登入並啟用方案使用權限。",
})
_OWNER_MESSAGES["ja"].update({
    "chatgpt_unavailable": "{name} は現在サブスクリプションの利用可否を確認できません。後でもう一度お試しください。",
    "chatgpt_plan_unavailable": "{name} は選択されたアカウントのサブスクリプションを利用できません。アカウントとワークスペースの条件を確認してください。",
    "chatgpt_scope": "{name} にサブスクリプションの利用権限がありません。再ログインしてプランの利用を許可してください。",
})


def redact(value: object, *, secrets=(), limit=240) -> str:
    text = str(value)
    for secret in secrets:
        if isinstance(secret, str) and secret:
            text = text.replace(secret, "[redacted]")
            if secret.lower().startswith("bearer "):
                text = text.replace(secret[7:], "[redacted]")
    text = re.sub(r"(?i)\b(?:bearer\s+)[^\s,;\"']+", "[redacted]", text)
    text = re.sub(r"(?i)([\"']?(?:[\w-]*(?:key|token|secret|password|authorization|cookie))[\"']?\s*[:=]\s*)(?:[\"'][^\"']*[\"']|[^\s,;}]+)", r"\1[redacted]", text)
    text = re.sub(r"(?i)\b(?:sk[-_]|ak_|lt_|gh[pousr]_|eyJ)[A-Za-z0-9_.-]+", "[redacted]", text)
    text = re.sub(r"(?i)\b(?:refresh_token|access_token|id_token)\b", "[credential]", text)
    text = re.sub(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", "[email]", text)
    text = re.sub(r"(?i)(?:[a-z]:[\\/]+Users[\\/]+|/Users/|/home/)[^\s\"'<>|,;]+", "[profile path]", text)
    text = re.sub(r"https?://[^\s\"'<>]+", "[url]", text)
    text = re.sub(r"\b[A-Za-z0-9_+/=-]{32,}\b", "[redacted]", text)
    return " ".join(text.split())[:limit]


@dataclass(frozen=True)
class Failure:
    kind: str
    reason: str

    @property
    def transient(self):
        return self.kind in TRANSIENT

    def wire(self):
        return {"kind": self.kind, "reason": self.reason}

    def sentence(self, name, language="en"):
        language = "zh-TW" if language == "zh-TW" else "ja" if str(language).startswith("ja") else "en"
        messages = _OWNER_MESSAGES[language]
        return messages.get(self.kind, messages["unknown"]).format(name=name)


_ALIASES = {"auth": "auth_expired", "login": "auth_expired", "not_configured": "auth_expired", "missing_key": "auth_expired",
            "missing_secret": "auth_expired", "reconnect": "auth_expired", "scope": "permission_denied", "denied": "permission_denied",
            "toolkit_not_allowed": "permission_denied", "gone": "not_found", "protocol": "tool_broken", "http_error": "server",
            "quota": "usage_limit", "rate_limited": "rate_limit", "offline": "network", "serverOverloaded": "overloaded",
            "refusal": "refused", "bad_request": "refused", "tool_error": "tool_broken", "no_key": "auth_expired",
            "bad_arguments": "tool_broken", "bad_response": "tool_broken", "vault": "tool_broken",
            "resume_failed": "tool_broken", "forbidden": "refused", "presence_required": "refused"}


def classify(value: object, *, secrets=(), record=True) -> Failure:
    if isinstance(value, Failure):
        return value
    if isinstance(getattr(value, "diagnostic", None), Failure):
        return value.diagnostic
    raw = json.dumps(value, ensure_ascii=False, default=str) if isinstance(value, (dict, list)) else str(value)
    code = getattr(value, "kind", None) or (value.get("kind") if isinstance(value, dict) else None)
    status = getattr(value, "status", None) or getattr(value, "status_code", None)
    reason = raw
    if isinstance(value, dict):
        error = value.get("error", value)
        if isinstance(error, dict):
            code = code or error.get("code") or error.get("kind")
            reason = error.get("message") or error.get("reason") or str(code or "Unknown failure")
        else:
            reason = value.get("message") or error
    kind = _ALIASES.get(str(code), str(code)) if code else _ALIASES.get(raw, raw)
    if kind not in KINDS or kind in ("unknown", "tool_broken", "server"):
        fallback = kind if kind in KINDS else "unknown"
        patterns = (
            ("credits", r"insufficient[_ ]?(?:credits|funds|quota)|out of credits|no credits|payment required|\b402\b"),
            ("usage_limit", r"usage[_ ]?limit|quota|hit your (?!rate)[\w ]*limit|resource_exhausted"),
            ("refused", r"safety|policy violation|content[_ ]filter|refusal|owner.{0,20}(?:denied|said no)"),
            ("auth_expired", r"\b401\b|unauthorized|auth|not logged in|token.{0,20}expired|missing[_ ](?:key|secret)|not_configured"),
            ("permission_denied", r"\b403\b|forbidden|permission|access_denied|missing_scopes|toolkit_not_allowed"),
            ("not_found", r"\b404\b|not[_ ]found|no such|\bgone\b"),
            ("overloaded", r"server[_ ]?overloaded|overload|at capacity|\b529\b"),
            ("rate_limit", r"\b429\b|rate.?limit|too many requests"),
            ("server", r"\b5\d\d\b|server error|service unavailable|bad gateway"),
            ("timeout", r"timeout|timed out|\b408\b"),
            ("network", r"network|offline|econn|epipe|connection (?:failed|reset|refused)|fetch failed|ConnectError|ConnectionError"),
            ("tool_broken", r"protocol|schema|tool_error|tool_broken|bad_response|JSONDecodeError"),
        )
        searchable = f"{status or ''} {type(value).__name__} {raw}"
        kind = next((kind for kind, pattern in patterns if re.search(pattern, searchable, re.I)), fallback)
    if isinstance(value, BaseException) and kind == "unknown":
        reason = type(value).__name__
    failure = Failure(kind, redact(reason, secrets=secrets) or kind)
    if record:
        line = f"{failure.kind}: {failure.reason}"
        RECENT.append(line)
        logger.warning("Failure %s", line)
    return failure


def tool_failure(kind, content="", *, record=True):
    """Preserve structured diagnostics across the existing tool-result text boundary."""
    try:
        data = json.loads(content)
    except (ValueError, TypeError):
        data = None
    if isinstance(data, dict) and (data.get("kind") in KINDS or data.get("error")):
        return classify(data, record=record)
    return classify({"kind": kind, "message": content or kind or "unknown"}, record=record)


class RepeatFailures:
    """A tool failing twice with the same kind is not called again until other work has succeeded:
    what stopped it may have changed by then, and a long job must not lose the tool for good."""

    def __init__(self):
        self.counts = {}

    def succeeded(self):
        self.counts.clear()

    def blocked(self, tool):
        return any(name == tool and count >= 2 for (name, _), count in self.counts.items())

    def record(self, tool, kind):
        key = (tool, kind)
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key] >= 2


REPEAT_NOTE = "This tool failed twice with the same failure kind. Use a different approach or report the blocker; do not call it again until something else has worked."
CORRECTIVE_NOTE = "The last tool failed. Read its reason, run self_check once if useful, then use a different approach at most once or report the exact blocker. Never claim success without evidence or bypass an owner denial."

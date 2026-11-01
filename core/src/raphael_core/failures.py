"""Shared, bounded failure diagnostics. Raw packets and credentials never leave ingress.

The words that tell a spent quota from a throttle, a context that does not fit and a filtered prompt are adapted from
NousResearch/hermes-agent agent/error_classifier.py @ c419cf7c (MIT), narrowed to the kinds Raphael tells apart.
"""

import json
import logging
import math
import re
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime

from .retry_utils import RETRY_AFTER_CAP_S, reset_delay_from_message

KINDS = frozenset(("credits", "usage_limit", "rate_limit", "overloaded", "server", "auth_expired",
                   "network", "permission_denied", "not_found", "tool_broken", "invalid_request", "timeout", "refused", "unknown",
                   "chatgpt_unavailable", "chatgpt_plan_unavailable", "chatgpt_scope",
                   "context_overflow", "payload_too_large", "content_policy"))
# What is worth asking again. A spent quota (`credits`, `usage_limit`) is not: waiting does not refill it.
TRANSIENT = frozenset(("rate_limit", "overloaded", "server", "network", "timeout"))
# A failed model call is made again after these waits, which are all a question gets before the owner is told: nothing
# was done yet, and he learns in seconds. After something was done it goes on at the patient pace until he stops it.
RETRY_WAITS = (1.0, 3.0, 8.0)
PATIENT_WAITS = (30.0, 60.0, 120.0, 300.0)
RECENT = deque(maxlen=40)
logger = logging.getLogger(__name__)

# Owner copy never interpolates provider reasons; those remain in wire diagnostics.
_OWNER_MESSAGES = {
    "zh-TW": {
        "invalid_request": "目前版本與 {name} 的連線不相容，請更新拉斐爾，若已是最新版請回報這項連接問題。",
        "credits": "{name} 的服務點數已用完，請到供應商帳戶補充點數，或在模型選單改用其他來源。",
        "usage_limit": "{name} 的用量已達上限，請等額度重設或選擇其他模型。",
        "rate_limit": "{name} 暫時收到太多請求，請稍後再試。",
        "overloaded": "{name} 目前忙碌中，請稍後再試或選擇其他模型。",
        "server": "{name} 的服務暫時出問題了，請稍後再試。",
        "auth_expired": "{name} 還沒登入或缺少金鑰，請到設定 › 連接完成連線。",
        "network": "{name} 目前無法連線，請確認網路後再試。",
        "permission_denied": "{name} 尚未取得執行此操作的權限，請到「設定 › 連接」檢查它的讀寫工具，並在需要時重新登入授權。",
        "not_found": "找不到 {name} 這次工作需要的項目，請重新選擇原檔、連結或模型，若是連接工具請先重新讀取工具。",
        "tool_broken": "目前無法確認 {name} 這次失敗的原因，請保留原對話並重新嘗試一次，若仍失敗請回報問題。",
        "timeout": "{name} 等待回應太久了，請稍後再試。",
        "refused": "{name} 拒絕了這項請求，請調整請求並遵守原有的限制。",
        "unknown": "目前無法確認 {name} 這次失敗的原因，請保留原對話並重新嘗試一次，若仍失敗請回報問題。",
    },
    "ja": {
        "invalid_request": "このバージョンは {name} と互換性がありません。ラファエルを更新し、最新版なら接続の問題を報告してください。",
        "credits": "{name} のクレジットがなくなりました。提供元のアカウントで追加するか、モデル選択で別のソースを選んでください。",
        "usage_limit": "{name} の利用上限に達しました。利用枠のリセットを待つか、別のモデルを選んでください。",
        "rate_limit": "{name} へのリクエストが一時的に多すぎます。しばらくしてから再試行してください。",
        "overloaded": "{name} は現在混み合っています。しばらく待つか、別のモデルを選んでください。",
        "server": "{name} のサービスで一時的な問題が起きています。しばらくしてから再試行してください。",
        "auth_expired": "{name} にログインしていないか、必要なキーがありません。設定の「接続」で接続を完了してください。",
        "network": "{name} に接続できません。ネットワークを確認してから再試行してください。",
        "permission_denied": "{name} には操作の権限がありません。「設定 › 接続」で読み書きツールを確認し、必要なら再ログインして許可してください。",
        "not_found": "{name} の作業に必要な項目がありません。元のファイル、リンク、モデルを選び直し、接続ツールなら再読み込みしてください。",
        "tool_broken": "{name} の失敗原因を確認できません。この会話を残して一度再試行し、続く場合は問題を報告してください。",
        "timeout": "{name} の応答を待つ時間が長すぎました。しばらくしてから再試行してください。",
        "refused": "{name} はこのリクエストを拒否しました。元の制限を守り、リクエストを見直してください。",
        "unknown": "{name} の失敗原因を確認できません。この会話を残して一度再試行し、続く場合は問題を報告してください。",
    },
    "en": {
        "invalid_request": "This version cannot connect compatibly to {name}. Update Raphael. If it is current, report this connection problem.",
        "credits": "{name} has run out of credits. Add credits in the provider account or choose another source in the model menu.",
        "usage_limit": "{name} has reached its usage limit. Wait for it to reset or choose another model.",
        "rate_limit": "{name} is receiving too many requests right now. Try again shortly.",
        "overloaded": "{name} is busy right now. Wait a little or choose another model.",
        "server": "{name} is having a temporary service problem. Try again later.",
        "auth_expired": "{name} is signed out or missing a required key. Complete the connection in Settings > Connections.",
        "network": "{name} cannot connect right now. Check your network and try again.",
        "permission_denied": "{name} lacks permission for this action. Check its read and write tools in Settings > Connections and sign in again if authorization is needed.",
        "not_found": "{name} could not find an item this task needs. Reselect the original file, link or model. Reload tools for a connected app.",
        "tool_broken": "The cause of this failure in {name} is unknown. Keep this conversation and try once more. Report the problem if it continues.",
        "timeout": "{name} took too long to respond. Try again later.",
        "refused": "{name} declined this request. Revise the request while respecting the original restrictions.",
        "unknown": "The cause of this failure in {name} is unknown. Keep this conversation and try once more. Report the problem if it continues.",
    },
}


_OWNER_MESSAGES["en"].update({
    "chatgpt_unavailable": "{name} cannot check ChatGPT plan availability right now. Try again later.",
    "chatgpt_plan_unavailable": "{name}’s selected ChatGPT account cannot use this plan. Check the account and workspace eligibility in Settings > Models & usage > Models > Subscription accounts > ChatGPT, or choose another source.",
    "chatgpt_scope": "{name}’s ChatGPT plan permission is missing. Sign in again and grant plan usage in Settings > Models & usage > Models > Subscription accounts > ChatGPT.",
})
_OWNER_MESSAGES["zh-TW"].update({
    "chatgpt_unavailable": "{name} 目前無法確認訂閱方案是否可用，請稍後重試。",
    "chatgpt_plan_unavailable": "{name} 所選的 ChatGPT 帳號無法使用這項訂閱方案，請到「設定 › 模型與用量 › 模型 › 訂閱帳號 › ChatGPT」確認登入帳號與工作區資格，或改用其他來源。",
    "chatgpt_scope": "{name} 的 ChatGPT 尚未獲准使用訂閱方案，請到「設定 › 模型與用量 › 模型 › 訂閱帳號 › ChatGPT」重新登入並允許使用方案。",
})
_OWNER_MESSAGES["ja"].update({
    "chatgpt_unavailable": "{name} は現在サブスクリプションの利用可否を確認できません。後でもう一度お試しください。",
    "chatgpt_plan_unavailable": "{name} が選択した ChatGPT アカウントはこのプランを利用できません。「設定 › モデルと使用量 › モデル › アカウント › ChatGPT」でアカウントとワークスペースの条件を確認するか、別のソースを選んでください。",
    "chatgpt_scope": "{name} の ChatGPT プラン利用が許可されていません。「設定 › モデルと使用量 › モデル › アカウント › ChatGPT」で再ログインして許可してください。",
})
_OWNER_MESSAGES["en"].update({
    "context_overflow": "{name} cannot take this much text at once. Start a new conversation or shorten the request.",
    "payload_too_large": "{name} refused the request because it is too big. Remove large attachments or shorten the request.",
    "content_policy": "{name}'s content filter blocked this request. Rephrase it or choose another model.",
})
_OWNER_MESSAGES["zh-TW"].update({
    "context_overflow": "{name} 一次容納不下這麼多內容，請開新對話或縮短需求。",
    "payload_too_large": "{name} 因為請求太大而拒絕，請移除較大的附件或縮短需求。",
    "content_policy": "{name} 的內容過濾擋下了這項請求，請改寫需求或選擇其他模型。",
})
_OWNER_MESSAGES["ja"].update({
    "context_overflow": "{name} は一度にこれだけの量を扱えません。新しい会話を始めるか、依頼を短くしてください。",
    "payload_too_large": "{name} はリクエストが大きすぎるため拒否しました。大きな添付を外すか、依頼を短くしてください。",
    "content_policy": "{name} のコンテンツフィルターがこのリクエストを止めました。表現を変えるか、別のモデルを選んでください。",
})

# When the provider says a usage limit lifts, the owner is told when (`{when}` is `_when`).
_RESET_MESSAGES = {
    "en": "{name} has reached its usage limit; it resets {when}. Wait for it or choose another model.",
    "zh-TW": "{name} 的用量已達上限，預計{when}重設。請等額度重設或選擇其他模型。",
    "ja": "{name} の利用上限に達しました。{when}にリセットされます。リセットを待つか、別のモデルを選んでください。",
}
# The one line a run says while it waits to ask again: what is wrong, that the work is intact, and when it asks.
_WAITING_MESSAGES = {
    "en": {
        "rate_limit": "{name} is limiting requests right now. The work is intact, and I try again {when}.",
        "busy": "{name} is having trouble right now. The work is intact, and I try again {when}.",
        "silent": "{name} is not answering. The work is intact, and I try again {when}.",
    },
    "zh-TW": {
        "rate_limit": "{name} 暫時限制了請求。工作沒有中斷，{when}再試。",
        "busy": "{name} 暫時出了問題。工作沒有中斷，{when}再試。",
        "silent": "{name} 暫時沒有回應。工作沒有中斷，{when}再試。",
    },
    "ja": {
        "rate_limit": "{name} がリクエストを一時的に制限しています。作業はそのままで、{when}再試行します。",
        "busy": "{name} で一時的な問題が起きています。作業はそのままで、{when}再試行します。",
        "silent": "{name} から応答がありません。作業はそのままで、{when}再試行します。",
    },
}


def _language(language):
    return "zh-TW" if language == "zh-TW" else "ja" if str(language).startswith("ja") else "en"


def _when(at, language, now=None):
    """`at` (seconds since the epoch) as the owner reads it: how long from now when that is soon, else the time of day."""
    now = time.time() if now is None else now
    left = at - now
    if left < 90 * 60:
        seconds = max(1, round(left))
        count, unit = (seconds, "s") if seconds < 90 else (math.ceil(seconds / 60), "min")
        return {"en": f"in about {count} {unit}",
                "zh-TW": f"約 {count} {'秒' if unit == 's' else '分鐘'}後",
                "ja": f"約{count}{'秒' if unit == 's' else '分'}後"}[language]
    moment = datetime.fromtimestamp(at)
    clock = moment.strftime("%H:%M")
    today = moment.date() == datetime.fromtimestamp(now).date()
    date = moment.strftime("%m/%d")
    return {"en": f"at {clock}" if today else f"on {date} at {clock}",
            "zh-TW": f"於 {clock}" if today else f"於 {date} {clock}",
            "ja": clock if today else f"{date} {clock}"}[language]


def scrub(text: str) -> str:
    """`text` without what looks like a credential, and otherwise as it was: addresses, paths and
    long ids stay, for a text that has to keep them (a run's summary), unlike `redact`."""
    text = re.sub(r"(?i)\b(?:bearer\s+)[^\s,;\"']+", "[redacted]", text)
    text = re.sub(r"(?i)(?<![\w-])([\"']?(?:[\w-]*(?:key|token|secret|password|authorization|cookie))[\"']?\s*[:=]\s*)(?:[\"'][^\"']*[\"']|[^\s,;}]+)", r"\1[redacted]", text)
    text = re.sub(r"(?i)\b(?:sk[-_]|ak_|lt_|gh[pousr]_|eyJ)[A-Za-z0-9_.-]+", "[redacted]", text)
    return re.sub(r"(?i)\b(?:refresh_token|access_token|id_token)\b", "[credential]", text)


def redact(value: object, *, secrets=(), limit=240) -> str:
    text = str(value)
    for secret in secrets:
        if isinstance(secret, str) and secret:
            text = text.replace(secret, "[redacted]")
            if secret.lower().startswith("bearer "):
                text = text.replace(secret[7:], "[redacted]")
    text = scrub(text)
    text = re.sub(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", "[email]", text)
    text = re.sub(r"(?i)(?:[a-z]:[\\/]+Users[\\/]+|/Users/|/home/)[^\s\"'<>|,;]+", "[profile path]", text)
    text = re.sub(r"https?://[^\s\"'<>]+", "[url]", text)
    text = re.sub(r"\b[A-Za-z0-9_+/=-]{32,}\b", "[redacted]", text)
    return " ".join(text.split())[:limit]


@dataclass(frozen=True)
class Missing:
    """Public prerequisite metadata, never a credential, URL, argument or remote error."""
    resource: str
    requirement: str
    state: str
    repair: str | None

    def wire(self):
        return {"resource": self.resource, "requirement": self.requirement, "state": self.state, "repair": self.repair}

    @classmethod
    def read(cls, value):
        if not isinstance(value, dict) or set(value) != {"resource", "requirement", "state", "repair"}:
            return None
        if value["state"] not in ("missing", "broken", "unknown", "off"):
            return None
        if any(not isinstance(value[k], str) or not re.fullmatch(r"[a-z0-9_-]{1,64}", value[k]) for k in ("resource", "requirement")):
            return None
        if value["repair"] not in (None, "models", "connections", "store", "search", "read", "vision", "pdf", "voice", "computer", "dictation"):
            return None
        return cls(**value)

    def sentence(self, language):
        language = _language(language)
        paths = {
            "zh-TW": {"models": "設定 › 模型與用量 › 模型", "connections": "設定 › 連接", "store": "設定 › 連接 › 商店", "search": "設定 › 拉斐爾 › 服務 › 搜尋網路", "read": "設定 › 拉斐爾 › 服務 › 讀網頁", "vision": "設定 › 拉斐爾 › 服務 › 看圖片", "pdf": "設定 › 拉斐爾 › 服務 › 讀 PDF", "voice": "設定 › 拉斐爾 › 服務 › 拉斐爾的聲音", "computer": "設定 › 拉斐爾 › 電腦操作", "dictation": "設定 › 聽寫"},
            "en": {"models": "Settings > Models & usage > Models", "connections": "Settings > Connections", "store": "Settings > Connections > Store", "search": "Settings > Raphael > Services > Search the web", "read": "Settings > Raphael > Services > Read web pages", "vision": "Settings > Raphael > Services > See images", "pdf": "Settings > Raphael > Services > Read PDF", "voice": "Settings > Raphael > Services > Raphael's voice", "computer": "Settings > Raphael > Computer operation", "dictation": "Settings > Dictation"},
            "ja": {"models": "設定 › モデルと使用量 › モデル", "connections": "設定 › 接続", "store": "設定 › 接続 › ストア", "search": "設定 › ラファエル › サービス › ウェブ検索", "read": "設定 › ラファエル › サービス › ウェブページを読む", "vision": "設定 › ラファエル › サービス › 画像を見る", "pdf": "設定 › ラファエル › サービス › PDF を読む", "voice": "設定 › ラファエル › サービス › ラファエルの声", "computer": "設定 › ラファエル › PC 操作", "dictation": "設定 › ディクテーション"},
        }
        name = {"searxng": "SearXNG", "chatgpt": "ChatGPT", "composio": "Composio", "fish": "Fish Audio", "search": "Search", "read": "Page reader", "vision": "Image reading", "pdf": "PDF", "computer": "Computer"}.get(self.resource, {"zh-TW": "這項功能", "en": "This feature", "ja": "この機能"}[language])
        path = paths[language].get(self.repair, "")
        if self.state == "unknown":
            return _OWNER_MESSAGES[language]["unknown"].format(name=name)
        if self.requirement in ("audio_transcriber", "audio_ffmpeg", "audio_decode"):
            return {"zh-TW": "影音附件無法轉錄，請改附 WAV 音訊或文字稿，並聯絡管理者檢查語音辨識與解碼元件；這裡沒有可新增的設定。", "en": "Media transcription is unavailable. Attach WAV audio or a transcript and ask an administrator to check speech recognition and decoding; no setting here can add them.", "ja": "音声を書き起こせません。WAV 音声か文字起こしを添付し、管理者に音声認識と解読機能を確認してください。ここで追加できる設定はありません。"}[language]
        if self.requirement in ("encrypted", "bad_pdf", "no_text"):
            return {"encrypted": {"zh-TW": "這份 PDF 受密碼保護，請在自己的電腦解鎖並另存可讀取副本後重新附加。", "en": "This PDF is password protected. Unlock it on your computer, save a readable copy and attach it again.", "ja": "PDF はパスワードで保護されています。PC で解除し、読めるコピーを添付し直してください。"}, "bad_pdf": {"zh-TW": "這份檔案無法當作 PDF 讀取，請確認原檔並重新匯出 PDF 後附加。", "en": "This file could not be read as a PDF. Check the original and attach a newly exported PDF.", "ja": "PDF として読めません。元のファイルを確認し、書き出し直した PDF を添付してください。"}, "no_text": {"zh-TW": f"這份 PDF 需要圖片辨識，請到「{path}」選擇支援圖片的模型。", "en": f"This PDF needs image recognition. Choose an image-capable model in {path}.", "ja": f"この PDF には画像認識が必要です。「{path}」で画像対応モデルを選んでください。"}}[self.requirement][language]
        if self.requirement == "url" and self.resource == "searxng":
            return {"zh-TW": f"尚未設定 SearXNG 網址，請到「{path} › SearXNG」填入服務網址並儲存。", "en": f"SearXNG has no service URL. Enter and save it in {path} > SearXNG.", "ja": f"SearXNG の URL が未設定です。「{path} › SearXNG」で入力して保存してください。"}[language]
        if not path:
            return {"zh-TW": f"{name} 缺少安裝元件，這裡沒有可修復的設定，請聯絡管理者檢查安裝。", "en": f"{name} needs an installation component. There is no setting here to fix it; ask an administrator to check the installation.", "ja": f"{name} のインストールに必要な機能がありません。ここで修復できる設定はないため、管理者に確認してください。"}[language]
        if self.state == "off":
            return {"zh-TW": f"{name} 已關閉，若你要使用，請到「{path}」開啟後再試。", "en": f"{name} is turned off. If you want to use it, enable it in {path} and try again.", "ja": f"{name} はオフです。利用する場合は「{path}」で有効にしてください。"}[language]
        if self.resource == "chatgpt" and self.requirement == "provider":
            return {"zh-TW": f"ChatGPT 登入已失效，請到「{path} › 訂閱帳號 › ChatGPT」重新登入。", "en": f"ChatGPT sign-in has expired. Sign in again in {path} > Subscription accounts > ChatGPT.", "ja": f"ChatGPT のログインが無効です。「{path} › アカウント › ChatGPT」で再ログインしてください。"}[language]
        if self.requirement == "provider" and self.state == "broken":
            return {"zh-TW": f"所選模型的供應商無法驗證這份登入資料，請到「{path}」開啟該供應商並更新憑證。", "en": f"The selected model's provider could not verify its credentials. Open its card in {path} and update the credentials.", "ja": f"モデルのプロバイダーが認証情報を確認できません。「{path}」で該当カードを開いて更新してください。"}[language]
        if self.requirement == "provider":
            return {"zh-TW": f"所選模型的供應商尚未連線，請到「{path}」開啟該供應商並補齊登入資料。", "en": f"The selected model's provider is not connected. Open its card in {path} and complete sign-in or credentials.", "ja": f"選択したモデルのプロバイダーに接続できません。「{path}」の該当カードで接続を完了してください。"}[language]
        return {"zh-TW": f"{name} 尚未設定完成，請到「{path}」補齊所需設定後再試。", "en": f"{name} is not ready. Complete its required setup in {path} and try again.", "ja": f"{name} の設定が完了していません。「{path}」で必要な設定を完了してください。"}[language]


def missing_for(kind, tool, detail=None):
    if tool in ("image_generate", "video_generate") and kind == "not_configured":
        return Missing("image" if tool == "image_generate" else "video", "image_generation" if tool == "image_generate" else "video_generation", "missing", "models")
    if tool == "provider" and kind in ("provider_missing", "provider_broken", "provider_off", "chatgpt_scope", "chatgpt_plan_unavailable"):
        requirement = kind if kind.startswith("chatgpt_") else "provider"
        state = kind.removeprefix("provider_") if kind.startswith("provider_") else "broken"
        return Missing(detail or "provider", requirement, state, "models")
    if tool == "read_attachment" and detail in ("audio_transcriber", "audio_ffmpeg", "audio_decode"):
        return Missing("audio", detail, "missing" if detail != "audio_decode" else "broken", None)
    if tool == "read_attachment" and kind in ("encrypted", "bad_pdf", "no_text"):
        return Missing("pdf", kind, "broken", "vision" if kind == "no_text" else None)
    repair = {"web_search": "search", "web_read": "read", "read_attachment": "pdf" if detail == "pdf" else "vision", "tts": "voice", "generate_audio": "voice", "computer": "computer"}.get(tool)
    if not repair or kind not in ("not_configured", "missing_secret", "no_key", "disabled", "vision_unsupported", "unavailable"):
        return None
    resource = detail if detail in ("searxng", "tavily", "brave", "exa", "jina", "firecrawl", "openrouter", "fish") else repair
    requirement = "url" if detail == "searxng" and kind == "not_configured" else "key" if kind in ("missing_secret", "no_key") else "model" if kind == "vision_unsupported" else "installation" if kind == "unavailable" else "setup"
    return Missing(resource, requirement, "off" if kind == "disabled" else "missing", None if requirement == "installation" else repair)


@dataclass(frozen=True)
class Failure:
    kind: str
    reason: str
    # When the provider says a limit lifts or a new try can work: seconds since the epoch. None when it said nothing.
    resets_at: float | None = field(default=None, compare=False)
    missing: Missing | None = None

    @property
    def transient(self):
        return self.kind in TRANSIENT

    @property
    def retry_after(self):
        """Seconds from now to `resets_at`, never below zero; None when the provider named no time."""
        return None if self.resets_at is None else max(0.0, self.resets_at - time.time())

    def wire(self):
        wire = {"kind": self.kind, "reason": self.reason}
        if self.missing is not None:
            wire["missing"] = self.missing.wire()
        if self.resets_at is not None:
            wire["resets_at"] = self.resets_at
        return wire

    def sentence(self, name, language="en", *, now=None):
        language = _language(language)
        if self.missing is not None:
            text = _OWNER_MESSAGES[language][self.kind].format(name=name) if self.kind.startswith("chatgpt_") else self.missing.sentence(language)
            return f"{name}: {text}" if self.missing.requirement == "provider" and not self.kind.startswith("chatgpt_") else text
        if self.kind == "usage_limit" and self.resets_at is not None:
            return _RESET_MESSAGES[language].format(name=name, when=_when(self.resets_at, language, now))
        messages = _OWNER_MESSAGES[language]
        return messages.get(self.kind, messages["unknown"]).format(name=name)

    def waiting(self, name, language, seconds):
        """The line a run says when it will ask again in `seconds`."""
        language = _language(language)
        family = ("rate_limit" if self.kind == "rate_limit" else "busy" if self.kind in ("overloaded", "server") else "silent")
        return _WAITING_MESSAGES[language][family].format(name=name, when=_when(time.time() + seconds, language))


_ALIASES = {"auth": "auth_expired", "login": "auth_expired", "not_configured": "auth_expired", "missing_key": "auth_expired",
            "missing_secret": "auth_expired", "reconnect": "auth_expired", "scope": "permission_denied", "denied": "permission_denied",
            "toolkit_not_allowed": "permission_denied", "gone": "not_found", "protocol": "tool_broken", "http_error": "server",
            "quota": "usage_limit", "usage_limit_reached": "usage_limit", "rate_limited": "rate_limit", "offline": "network", "serverOverloaded": "overloaded",
            "refusal": "refused", "bad_request": "refused", "tool_error": "tool_broken", "no_key": "auth_expired",
            "bad_arguments": "tool_broken", "bad_response": "tool_broken", "vault": "tool_broken",
            "resume_failed": "tool_broken", "forbidden": "refused", "presence_required": "refused",
            "context_length_exceeded": "context_overflow", "request_too_large": "payload_too_large",
            "content_filter": "content_policy", "content_policy_violation": "content_policy",
            "safety_violation": "content_policy"}

# Words providers use. A throttle is told apart from a spent quota by them, and a context that does not fit from both.
_CREDITS = (r"insufficient[_ ]?(?:credits|funds|quota|balance)|out of (?:credits|funds)|no credits|payment required|credit balance"
            r"|top up your|exceeded your current quota|billing[_ ](?:hard[_ ])?limit|billing_not_active|budget limit exceeded|\b402\b")
_QUOTA = r"usage[_ ]?limit|quota|hit your (?!rate)[\w ]*limit|resource_exhausted"
_QUOTA_WALL = _QUOTA + r"|limit exceeded|resource has been exhausted|(?:weekly|monthly) limit"
_THROTTLE = r"rate.?limit|too many requests|requests? per|tokens? per|per[- ]minute|throttl"
_PAYLOAD = r"request entity too large|payload too large|request_too_large|request exceeds the maximum size"
_OVERFLOW = (r"context[_ ](?:length|window|size)|maximum context|(?:prompt|input) is too long|too many tokens|token limit"
             r"|maximum (?:allowed )?input length|maximum number of (?:input )?tokens|max_model_len|maximum model length"
             r"|reduce the length|more than max tokens|上下文長度|上下文长度|超過最大長度|超过最大长度")
_CONTENT_POLICY = (r"content[_ ]filter|content[_ ]polic|usage polic|flagged (?:by|for)|safety (?:system|filter|polic)"
                   r"|responsibleaipolicyviolation|data_inspection_failed")


def _status(value, error):
    """The HTTP status a failure carries, if it carries one: on the error, or in the dict that describes it."""
    candidates = [getattr(value, "status", None), getattr(value, "status_code", None)]
    for source in (value, error):
        if isinstance(source, dict):
            candidates += [source.get("status"), source.get("status_code"), source.get("httpStatusCode")]
    return next((c for c in candidates if type(c) is int and c), None)


def _seconds_to_reset(value, error, raw):
    """Seconds until the provider says the limit lifts: given by the call that failed (`retry_after`, or `resets_at` as a
    time), else read from its words."""
    for source in (value, error):
        given = source.get("retry_after") if isinstance(source, dict) else getattr(source, "retry_after", None)
        if type(given) in (int, float) and given > 0:
            return float(given)
        at = source.get("resets_at") if isinstance(source, dict) else None
        if type(at) in (int, float) and at > time.time():
            return at - time.time()
    seconds = reset_delay_from_message(raw)
    return seconds if seconds else None


def _turned_down(status, text):
    """Why a provider turned the request itself down, when it says so: it is too big, it holds more than the model reads,
    or its content was filtered. Throttling and server trouble are never this."""
    if status == 413 or re.search(_PAYLOAD, text, re.I):
        return "payload_too_large"
    if status != 429 and not (status or 0) >= 500 and re.search(_OVERFLOW, text, re.I) and not re.search(_THROTTLE, text, re.I):
        return "context_overflow"
    if re.search(_CONTENT_POLICY, text, re.I):
        return "content_policy"
    return None


def classify(value: object, *, secrets=(), record=True) -> Failure:
    if isinstance(value, Failure):
        return value
    if isinstance(getattr(value, "diagnostic", None), Failure):
        return value.diagnostic
    raw = json.dumps(value, ensure_ascii=False, default=str) if isinstance(value, (dict, list)) else str(value)
    code = getattr(value, "kind", None) or (value.get("kind") if isinstance(value, dict) else None)
    error = value.get("error", value) if isinstance(value, dict) else None
    status = _status(value, error)
    reason = raw
    if isinstance(value, dict):
        if isinstance(error, dict):
            code = code or error.get("code") or error.get("kind")
            reason = error.get("message") or error.get("reason") or str(code or "Unknown failure")
        else:
            reason = value.get("message") or error
    kind = _ALIASES.get(str(code), str(code)) if code else _ALIASES.get(raw, raw)
    searchable = f"{status or ''} {type(value).__name__} {raw}"
    wait = _seconds_to_reset(value, error, raw)
    # What the provider said, without the names of the fields it came in (a "rate_limit" kind is no throttle wording).
    said = f"{reason} {code}" if isinstance(code, str) and kind not in KINDS else str(reason)
    if kind not in KINDS or kind in ("unknown", "tool_broken", "refused", "invalid_request"):
        kind = _turned_down(status, said) or kind
    if kind == "rate_limit":
        # A 429 is a throttle that passes, unless it says the money or the plan's allowance is spent.
        if re.search(_CREDITS, said, re.I):
            kind = "credits"
        elif re.search(_QUOTA_WALL, said, re.I) and not re.search(_THROTTLE, said, re.I) and not (wait and wait <= RETRY_AFTER_CAP_S):
            kind = "usage_limit"
    if kind not in KINDS or kind in ("unknown", "tool_broken", "server"):
        fallback = kind if kind in KINDS else "unknown"
        patterns = (
            ("credits", _CREDITS),
            ("usage_limit", _QUOTA),
            ("refused", r"safety|policy violation|refusal|owner.{0,20}(?:denied|said no)"),
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
        kind = next((kind for kind, pattern in patterns if re.search(pattern, searchable, re.I)), fallback)
    if isinstance(value, BaseException) and kind == "unknown":
        reason = type(value).__name__
    missing = Missing.read(value.get("missing")) if isinstance(value, dict) else None
    failure = Failure(kind, redact(reason, secrets=secrets) or kind, time.time() + wait if wait else None, missing)
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


CORRECTIVE_NOTE = "The last tool failed. Read its reason, run self_check once if useful, then use a different approach at most once or report the exact blocker. Never claim success without evidence or bypass an owner denial."

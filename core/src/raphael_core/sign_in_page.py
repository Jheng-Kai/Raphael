"""The page a browser lands on at the end of a sign-in: this computer answering, on 127.0.0.1.

It loads nothing and asks nothing, and it never repeats what the address carried. Its address loses
the one-time code as soon as it is read, so that the browser's history does not keep it.
"""

from raphael_core.ui_words import ui_word, with_ui_words
import html
import secrets
from dataclasses import dataclass

CHECK = '<path d="M5 12.5l4.5 4.5L19 7.5"/>'
CROSS = '<path d="M7 7l10 10M17 7L7 17"/>'
LOCK = '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'
KEY = '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l3 3"/>'
GAUGE = '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/>'

_STYLE = """
:root{color-scheme:light dark;--bg:#fff;--card:#fafafa;--line:#e5e5e5;--text:#0a0a0a;--soft:#525252;--press:#ededed}
@media(prefers-color-scheme:dark){:root{--bg:#0a0a0a;--card:#141414;--line:#262626;--text:#f5f5f5;--soft:#a3a3a3;--press:#262626}}
*{box-sizing:border-box}
body{display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;background:var(--bg);color:var(--text);
font:15px/1.6 Inter,"Segoe UI","Microsoft JhengHei UI","Yu Gothic UI",system-ui,sans-serif}
main{display:grid;justify-items:center;gap:8px;width:min(420px,100%);padding:32px;border:1px solid var(--line);border-radius:16px;
background:var(--card);text-align:center;animation:rise .28s ease-out}
.mark{display:grid;place-items:center;width:56px;height:56px;margin-bottom:8px;border:1px solid var(--line);border-radius:50%}
.mark svg{width:28px;height:28px;fill:none;stroke:var(--text);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.mark path{stroke-dasharray:40;animation:draw .5s .12s ease-out both}
h1{margin:0;font-size:20px;font-weight:600;text-wrap:balance}
p{margin:0;color:var(--soft);text-wrap:pretty}
.who{color:var(--text);font-weight:500;overflow-wrap:anywhere}
ul{display:grid;gap:12px;width:100%;margin:16px 0 0;padding:16px 0 0;border-top:1px solid var(--line);list-style:none;text-align:left}
li{display:grid;grid-template-columns:20px minmax(0,1fr);gap:12px;align-items:start;color:var(--soft);font-size:14px;text-wrap:pretty}
li svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
a{display:inline-flex;align-items:center;justify-content:center;min-height:36px;margin-top:16px;padding:0 16px;border:1px solid var(--line);
border-radius:999px;color:var(--text);font-size:14px;font-weight:500;text-decoration:none}
a:hover{background:var(--press)}
a:focus-visible{outline:2px solid var(--text);outline-offset:2px}
@keyframes rise{from{opacity:0;transform:translateY(6px)}}
@keyframes draw{from{stroke-dashoffset:40}to{stroke-dashoffset:0}}
@media(prefers-reduced-motion:reduce){main,.mark path{animation:none}}
"""

_CHATGPT = with_ui_words({
    "zh": {
        "ok": ("已連上 ChatGPT", "可以關閉這個分頁，回到拉斐爾。"),
        "no_plan": ("還不能使用方案額度", "這次登入沒有允許使用 ChatGPT 方案。回到拉斐爾再按一次，並在 OpenAI 的頁面允許。"),
        "permission_denied": ("沒有連上 ChatGPT", "你沒有同意這次連線，帳號沒有任何變動。需要時回到拉斐爾再按一次。"),
        "network": ("沒有連上 ChatGPT", "連不上 OpenAI。確認網路後，回到拉斐爾再試一次。"),
        "tool_broken": ("沒有連上 ChatGPT", "登入憑證存不進 Windows 認證管理員。回到拉斐爾再試一次。"),
        "cancelled": ("這次登入已取消", "你已經在拉斐爾取消了，這個分頁可以關閉。"),
        "expired": ("這個登入連結已經失效", "為了安全，一個連結只能用一次。請回到拉斐爾重新開始。"),
        "finishing": ("快好了", "還在向 OpenAI 確認，結果會顯示在拉斐爾。這個分頁可以關閉。"),
        "failed": ("沒有連上 ChatGPT", "這次登入沒有通過驗證，帳號和憑證都沒有變動。回到拉斐爾再試一次。"),
        "facts": ("拉斐爾看不到你的密碼和 ChatGPT 對話。",
                  "憑證只存在這台電腦的 Windows 認證管理員。",
                  "用量算在你的 ChatGPT 方案，隨時可以中斷連線。"),
        "usage": "管理用量",
    },
    "en": {
        "ok": ("Connected to ChatGPT", "You can close this tab and go back to Raphael."),
        "no_plan": ("Plan usage is not on yet", "This sign-in did not allow your ChatGPT plan. Press it again in Raphael and allow it on OpenAI's page."),
        "permission_denied": ("Not connected to ChatGPT", "You did not approve this connection, and nothing about your account changed. Press it again in Raphael when you want to."),
        "network": ("Not connected to ChatGPT", "OpenAI could not be reached. Check your connection and try again in Raphael."),
        "tool_broken": ("Not connected to ChatGPT", "Your sign-in could not be saved in Windows Credential Manager. Try again in Raphael."),
        "cancelled": ("This sign-in was cancelled", "You cancelled it in Raphael. You can close this tab."),
        "expired": ("This sign-in link has expired", "For your safety a link works only once. Start again in Raphael."),
        "finishing": ("Almost there", "Still checking with OpenAI; Raphael will show the result. You can close this tab."),
        "failed": ("Not connected to ChatGPT", "This sign-in did not pass its checks, and your account and credentials did not change. Try again in Raphael."),
        "facts": ("Raphael never sees your password or your ChatGPT conversations.",
                  "Your sign-in stays on this computer, in Windows Credential Manager.",
                  "Usage counts against your ChatGPT plan. Disconnect at any time."),
        "usage": "Manage usage",
    },
    "ja": {
        "ok": ("ChatGPT に接続しました", "このタブを閉じて、Raphael に戻ってください。"),
        "no_plan": ("プランはまだ使えません", "このサインインではプランの利用が許可されませんでした。Raphael でもう一度押し、OpenAI のページで許可してください。"),
        "permission_denied": ("ChatGPT に接続していません", "接続を許可しなかったため、アカウントは変わっていません。必要なときに Raphael でもう一度押してください。"),
        "network": ("ChatGPT に接続していません", "OpenAI に接続できませんでした。ネットワークを確認して、Raphael でもう一度お試しください。"),
        "tool_broken": ("ChatGPT に接続していません", "サインイン情報を Windows 資格情報マネージャーに保存できませんでした。Raphael でもう一度お試しください。"),
        "cancelled": ("サインインを取り消しました", "Raphael で取り消しました。このタブは閉じて構いません。"),
        "expired": ("このリンクは無効になりました", "安全のため、リンクは一度しか使えません。Raphael でやり直してください。"),
        "finishing": ("もう少しです", "OpenAI に確認しています。結果は Raphael に表示されます。このタブは閉じて構いません。"),
        "failed": ("ChatGPT に接続していません", "確認を通らなかったため、アカウントと資格情報は変わっていません。Raphael でもう一度お試しください。"),
        "facts": ("Raphael にパスワードや ChatGPT の会話は見えません。",
                  "サインイン情報はこのコンピューターの Windows 資格情報マネージャーにだけ保存されます。",
                  "利用分は ChatGPT プランに計上され、いつでも切断できます。"),
        "usage": "利用状況を管理",
    },
})
USAGE_URL = "https://chatgpt.com/settings/usage"


@dataclass(frozen=True)
class SignInPage:
    body: bytes
    nonce: str


def language_of(value: str) -> str:
    """Resolve the first requested UI locale, retaining the original Traditional Chinese key."""
    from .ui_languages import normalize_language
    language = normalize_language((value or "").split(",")[0].split(";")[0])
    return "zh" if language == "zh-TW" else language


def _icon(paths: str) -> str:
    return f'<svg viewBox="0 0 24 24" aria-hidden="true">{paths}</svg>'


def sign_in_page(language: str, *, ok: bool, title: str, text: str, who: str = "",
                 facts: tuple[tuple[str, str], ...] = (), link: tuple[str, str] | None = None) -> SignInPage:
    """The page, in `language` (see `language_of`); every word and address is escaped here."""
    nonce = secrets.token_urlsafe(16)
    lang = "zh-Hant" if language == "zh" else language_of(language)
    rows = "".join(f"<li>{_icon(paths)}<span>{html.escape(words)}</span></li>" for paths, words in facts)
    body = (
        f'<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><title>{html.escape(title)}</title>'
        '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,">'
        f'<style nonce="{nonce}">{_STYLE}</style></head><body><main>'
        f'<div class="mark">{_icon(CHECK if ok else CROSS)}</div><h1>{html.escape(title)}</h1>'
        + (f'<p class="who">{html.escape(who)}</p>' if who else "")
        + f"<p>{html.escape(text)}</p>"
        + (f"<ul>{rows}</ul>" if rows else "")
        + (f'<a href="{html.escape(link[1], quote=True)}" target="_blank" rel="noopener noreferrer">{html.escape(link[0])}</a>' if link else "")
        + f'</main><script nonce="{nonce}">history.replaceState(null,"",location.pathname)</script></body></html>'
    )
    return SignInPage(body.encode("utf-8"), nonce)


def chatgpt_page(language: str, outcome: str, who: str = "") -> SignInPage:
    """What became of a sign-in with ChatGPT. An outcome this page has no words for is a failed check."""
    language = language_of(language)
    words = _CHATGPT[language]
    if outcome == "ok":
        title, text = words["ok"]
        facts = tuple(zip((LOCK, KEY, GAUGE), words["facts"], strict=True))
        return sign_in_page(language, ok=True, title=title, text=text, who=who, facts=facts, link=(words["usage"], USAGE_URL))
    kind = {"timeout": "network"}.get(outcome, outcome)
    title, text = words.get(kind, words["failed"])
    return sign_in_page(language, ok=False, title=title, text=text, who=who if outcome == "no_plan" else "")


def http_response(status: str, page: SignInPage | None) -> bytes:
    """The whole answer, headers included: a page that frames, caches and refers to nothing."""
    body = page.body if page else b""
    policy = (f"default-src 'none'; style-src 'nonce-{page.nonce}'; script-src 'nonce-{page.nonce}'; img-src data:; "
              "base-uri 'none'; form-action 'none'; frame-ancestors 'none'") if page else "default-src 'none'"
    return (f"HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {len(body)}\r\n"
            f"Content-Security-Policy: {policy}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\n"
            "X-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nConnection: close\r\n\r\n").encode() + body

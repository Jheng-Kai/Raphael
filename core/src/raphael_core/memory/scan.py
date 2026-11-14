"""The checks every memory passes before it is written, whoever writes it: the agent in a turn,
the reflection pass, the weekly consolidation, or the user in the settings. The same secret check keeps credentials
off a member's page (`agent/pages.py`) and out of its notes, skills and private tool transcripts (`bots/homes.py`).

A model is told never to keep a password, and usually does not, but the code is the guarantee (the
advice of Anthropic's own documentation for its memory tool). What is secret is what the owner named on
2026-11-14 (R-SECRET-01: "除非是什麼密碼啊、金鑰啊，不然是什麼 credit cards 的密碼什麼的，那個才是機密啊"): credentials and
payment secrets, and nothing else. Raphael is open source, so an address, an ID inside an address, an article, a
hash, a file name or a fact about a person (a national ID number too) is never a secret. A memory is refused when it
holds:

- a secret (`find_secret`): the known shapes of API keys and tokens (OpenRouter's and OpenAI's `sk-`,
  GitHub's `ghp_` and `github_pat_`, Slack's `xox?-`, AWS's `AKIA`, Google's `AIza`, a JWT, a
  `Bearer` token, a private key block, a Telegram bot's token); a value given to a word for a key, a token or a
  secret ("api_key: ...", "token=...", 金鑰是 ...); what follows a word for a password, a PIN or a one-time
  code (a value with a digit or a symbol in it, or any value at all once "is", ":", "=", 是, 為 or は gives it to
  the word, so "password is hunter" too, while "password manager" and "the password is stored in ..." pass);
  a card number (a card's first digit and the Luhn check) or a bank account number (an IBAN whose check digits hold,
  or the digits that follow a word for an account). A string that merely looks random is not a secret: nothing is one
  for its shape alone unless a key's own prefix says so;
- or something written to steer a model (`find_injection`), which is how a memory is poisoned
  (SpAIware, 2024): an order to ignore the instructions, a line dressed as a system message, a
  Markdown image whose address carries a query (a way to send data out), an order to send something to an
  address, or invisible characters. A plain https link, with a query string or not, is a fact and passes.

Each check says only which kind of thing it found, never the text, so that the reason can be shown
and logged. Nothing here logs anything.
"""

import re
import unicodedata

# --- secrets ---------------------------------------------------------------------------------------

_TOKEN_SHAPES = (
    # A key with its maker's prefix (OpenRouter, project, Anthropic and service-account keys); a bare `sk-` is one only
    # when what follows is one run of letters and digits as long as OpenAI's own, so that a readable slug that begins
    # with "sk-" in an address is not.
    re.compile(r"\bsk-(?:or|proj|ant|svcacct|admin)-[A-Za-z0-9_\-]{16,}"),
    re.compile(r"\bsk-[A-Za-z0-9]{20,}"),
    re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"\bxox[abprs]-[A-Za-z0-9\-]{10,}"),
    re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    re.compile(r"\bAIza[0-9A-Za-z_\-]{30,}"),
    re.compile(r"\beyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}"),
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/\-]{16,}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\b\d{6,}:[A-Za-z0-9_\-]{30,}"),  # a Telegram bot's token
)

# The words for a password, a PIN or a one-time code, in the three languages and a few spellings,
# then what is written after them within a few characters ("是", ":", "is"...).
_SECRET_WORDS = (
    r"密碼|密码|口令|通關碼|驗證碼|验证码|認證碼|認証コード|確認碼|動態碼|"
    r"パスワード|パスコード|暗証番号|ワンタイム|"
    r"\b(?:password|passwd|passcode|passphrase|pin(?:\s*code)?|otp|one[- ]time\s+(?:code|password)|"
    r"verification\s+code|security\s+code|2fa\s+code|cvv|cvc)\b"
)
# What a value is written with: the printable ASCII a password or a code is made of. A word of Chinese or Japanese
# after a mark ("パスワードは大切です", "暗証番号4桁を入力") is a sentence, not a value; a value in quotes may be any.
_VALUE = r"[^\s\"',\u0080-\U0010ffff]"
_QUOTE = r"[「『\"'“]"
_ANY = r"[^\s」』\"'”。，,]"
# The value: three characters or more with a digit or a symbol in them (a word alone, such as the
# "manager" of "password manager", is not taken for one).
_SECRET_VALUE = re.compile(
    rf"(?i)(?:{_SECRET_WORDS})(?:\s+(?:code|number|no\.?))?\s*"
    rf"(?:是|為|为|は|:|：|=|\bis\b|\bwas\b)?\s*{_QUOTE}?\s*"
    rf"(?={_VALUE}*[\d!@#$%^&*]){_VALUE}{{3,}}"
)
# The words that say where or how a password is kept rather than what it is, after "is" or "was"
# ("the password is stored in 1Password", "the PIN was changed").
_NOT_A_VALUE = (
    r"in|on|at|by|the|a|an|my|your|his|her|their|our|its|this|that|not|also|still|now|"
    r"stored|saved|kept|written|managed|synced|set|changed|reset|updated|required|needed|"
    r"same|different|long|short|strong|weak|easy|hard|secret|private|unknown|forgotten|expired"
)
# Any value at all, once ":" or "=" gives it to the word, or "is" or "was" does (a password of letters alone, "password
# is hunter", is a password too). 是, 為 and は give it only a value in quotes or one that begins in ASCII, so that a
# Chinese or Japanese sentence about a password ("パスワードは大切です") is not taken for one. A word that is followed by
# no such mark ("password manager", "密碼管理器是 Bitwarden") is left alone.
_SECRET_GIVEN = re.compile(
    rf"(?i)(?:{_SECRET_WORDS})(?:\s+(?:code|number|no\.?))?\s*"
    rf"(?:(?::|=)\s*{_QUOTE}?\s*{_ANY}"
    rf"|\b(?:is|was)\b(?!\s+(?:{_NOT_A_VALUE})\b)\s*{_QUOTE}?\s*{_ANY}"
    rf"|(?:是|為|为|は)\s*(?:{_QUOTE}\s*{_ANY}|[A-Za-z0-9!@#$%^&*_\-]))"
)
# A key, a token or a secret that is given its value ("api_key: ...", "token=...", "金鑰是 ..."): the value is one run of
# what keys are written in, eight characters or more, that is not a word (`_keylike`).
_KEY_WORDS = (
    r"api[_\- ]?key|apikey|secret[_\- ]?key|client[_\- ]?secret|access[_\- ]?key|private[_\- ]?key|"
    r"(?:access|auth|refresh|bearer|bot|api|session|id)[_\- ]?token|token|secret|"
    r"金鑰|金钥|密鑰|密钥|權杖|令牌|API\s*キー|アクセスキー|トークン|シークレット"
)
_KEY_GIVEN = re.compile(
    rf"(?i)(?:{_KEY_WORDS})[\"']?\s*(?:[:=]|是|為|为|は|\bis\b)\s*[\"'「『“]?\s*"
    r"(?P<value>[A-Za-z0-9][A-Za-z0-9+/_\-.~=]{7,})"
)
# A bank account: the digits that a word for one gives its number to (an IBAN is told by its own check digits).
_ACCOUNT_WORDS = (
    r"銀行帳號|銀行帳戶|銀行账号|銀行账户|匯款帳號|匯款帳戶|轉帳帳號|轉帳帳戶|口座番号|"
    r"\bbank\s+account(?:\s+(?:number|no\.?))?|\baccount\s+(?:number|no\.?)|\brouting\s+number"
)
_ACCOUNT_GIVEN = re.compile(
    rf"(?i)(?:{_ACCOUNT_WORDS})\s*(?:是|為|为|は|:|=|\bis\b|#)?\s*{_QUOTE}?\s*(?P<number>\d(?:[ \-]?\d){{7,19}})(?!\d)"
)
# Thirteen to nineteen digits, in one run or in the groups a card is written in (4-4-4-4, 4-6-5): a card number if the
# Luhn check passes. Numbers that are only set apart by spaces (a row of years) are not one. Not the digits of a longer
# number, of a decimal, of a word or of an address's path (the number of a file or an article is not a card).
_CARD = re.compile(
    r"(?<![\d./\\=#A-Za-z_-])(?<!\d\.)(?:\d{13,19}|\d{4}(?:[ \-]\d{4}){2,3}(?:[ \-]\d{1,3})?|\d{4}[ \-]\d{6}[ \-]\d{4,5})(?!\.?\d)")
# An IBAN, written in one run or in groups of four.
_IBANS = (
    re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b"),
    re.compile(r"\b[A-Z]{2}\d{2}(?: [A-Z0-9]{4}){2,7}(?: [A-Z0-9]{1,4})?\b"),
)


def _keylike(value: str) -> bool:
    """Whether a value given to a word for a key reads as a key: it has a digit, or is long and changes case the way
    random letters do. A word given to it ("token: Authentication") is not."""
    if any(char.isdigit() for char in value):
        return True
    letters = [char for char in value if char.isalpha()]
    changes = sum(a.isupper() != b.isupper() for a, b in zip(letters, letters[1:]))
    return len(value) >= 20 and changes >= 6


def _luhn(digits: str) -> bool:
    total = 0
    for index, char in enumerate(reversed(digits)):
        value = int(char)
        if index % 2:
            value *= 2
            if value > 9:
                value -= 9
        total += value
    return total % 10 == 0


def _is_card(found: str) -> bool:
    digits = re.sub(r"\D", "", found)
    # A card number begins with 2 to 6 (Mastercard's 2-series, Amex, JCB and Diners 3, Visa 4, Mastercard 5, Discover and
    # UnionPay 6); a time in milliseconds, which passes the check one time in ten, begins with 1.
    return 13 <= len(digits) <= 19 and digits[0] in "23456" and _luhn(digits)


def _is_iban(found: str) -> bool:
    """An IBAN's check digits hold (ISO 7064, mod 97): a code that only looks like one, as a part number or an identifier
    in capitals does, passes one time in ninety-seven."""
    compact = found.replace(" ", "")
    moved = compact[4:] + compact[:4]
    return 15 <= len(compact) <= 34 and int("".join(str(int(char, 36)) for char in moved)) % 97 == 1


def _findings(text: str):
    """The secrets `text` holds, each as its kind and the span it occupies."""
    for shape in _TOKEN_SHAPES:
        for found in shape.finditer(text):
            yield "token", found.span()
    for found in _KEY_GIVEN.finditer(text):
        if _keylike(found["value"]):
            yield "token", found.span()
    for pattern in (_SECRET_VALUE, _SECRET_GIVEN):
        for found in pattern.finditer(text):
            yield "password", found.span()
    for found in _CARD.finditer(text):
        if _is_card(found.group()):
            yield "card", found.span()
    for found in _ACCOUNT_GIVEN.finditer(text):
        if 8 <= len(re.sub(r"\D", "", found["number"])) <= 20:
            yield "account", found.span()
    for pattern in _IBANS:
        for found in pattern.finditer(text):
            if _is_iban(found.group()):
                yield "iban", found.span()


def find_secret(text: str) -> str | None:
    """The kind of secret `text` holds ("token", "password", "card", "account" or "iban"), or None when it holds none.
    Only credentials and payment secrets are secret (see the module): an address, a number or a code inside one, an
    article, a hash, a file name and a personal identifier such as a national ID number are not."""
    plain = unicodedata.normalize("NFKC", text)
    return next((kind for kind, _ in _findings(plain)), None)


def redact(text: str) -> str:
    """`text` with each secret in it replaced by "[redacted]", everything else (Markdown, links, facts) as it was."""
    pieces, last = [], 0
    for start, end in sorted(span for _, span in _findings(text)):
        if start < last:
            if end > last:
                last = end
            continue
        pieces.append(text[last:start])
        pieces.append("[redacted]")
        last = end
    pieces.append(text[last:])
    return "".join(pieces)


# --- injection -------------------------------------------------------------------------------------

# Bounded filler between key words (an unbounded one backtracks badly), and an environment variable
# whose name ends in a word for a secret.
_FILLER = r"(?:\w+\s+){0,8}"
_SECRET_VAR = r"\$\{?\w*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)S?\b"
_MODIFY = r"(update|modify|edit|write|change|append|add\s+to)\s+[^\n]{0,2048}"
_INJECTION = (
    re.compile(
        r"(?i)\b(?:ignore|disregard|forget|override)\b[^.\n]{0,30}"
        r"\b(?:previous|prior|above|earlier|all|your|system)\b[^.\n]{0,20}"
        r"\b(?:instructions?|prompts?|rules|messages|directions)\b"
    ),
    re.compile(r"(?i)(?:^|\n)\s*(?:system|assistant|developer)\s*[:：]"),
    re.compile(r"(?i)\bsystem\s+prompt\b"),
    re.compile(r"(?i)\byou\s+are\s+now\b"),
    re.compile(r"(?i)</?\s*(?:system|instructions?|script|tool_result|shared_memory|own_memory)\b"),
    re.compile(r"(?:忽略|無視|无视|不要理會|別理)[^。\n]{0,12}(?:指示|指令|規則|规则|提示|設定)"),
    re.compile(r"(?:指示|命令|ルール|プロンプト)[^。\n]{0,10}(?:無視|忘れ)"),
    # A Markdown image whose address carries a query: a way to send what it is given away. A picture at a plain address
    # is a fact, and so is a link with a query string (owner, 2026-11-14: only credentials are secret).
    re.compile(r"!\[[^\]]*\]\(\s*<?(?:https?:)?//[^)\s>]*\?[^)\s>]*="),
    *(re.compile(pattern, re.I) for pattern in (
        # Adapted from NousResearch/hermes-agent (MIT); see core/packaging/licenses.
        # Offensive tool names are excluded: they are ordinary words too, and a fact here is about a person.
        rf"disregard\s+{_FILLER}(your|all|any)\s+{_FILLER}(instructions|rules|guidelines)",
        rf"act\s+as\s+(if|though)\s+{_FILLER}you\s+{_FILLER}(have\s+no|don't\s+have)\s+{_FILLER}(restrictions|limits|rules)",
        r"<!--[^>]{0,512}(?:ignore|override|system|secret|hidden)[^>]{0,512}-->",
        r"<\s*div\s+style\s*=\s*[\"'][^>]{0,2048}display\s*:\s*none",
        r"translate\s+[^\n]{0,512}\s+into\s+\w+(?:[\s-]+\w+){0,2}\s+and\s+(execute|run|eval)\b",
        rf"do\s+not\s+{_FILLER}tell\s+{_FILLER}the\s+user",
        rf"you\s+are\s+{_FILLER}now\s+(?:a|an|the)\s+",
        rf"pretend\s+{_FILLER}(you\s+are|to\s+be)\s+",
        rf"output\s+{_FILLER}(system|initial)\s+prompt",
        rf"(respond|answer|reply)\s+without\s+{_FILLER}(restrictions|limitations|filters|safety)",
        rf"you\s+have\s+been\s+{_FILLER}(updated|upgraded|patched)\s+to",
        r"register\s+(as\s+)?a?\s*node",
        r"(heartbeat|beacon|check[\s\-]?in)\s+(to|with)\s+https?:",
        r"you\s+must\s+(?:\w+\s+){0,3}(register|connect|report|beacon)\b",
        r"unset\s+\w*(?:CLAUDE|CODEX|HERMES|RAPHAEL|AGENT|OPENAI|ANTHROPIC)\w*",
        rf"curl\s+[^\n]{{0,2048}}{_SECRET_VAR}",
        rf"wget\s+[^\n]{{0,2048}}{_SECRET_VAR}",
        r"cat\s+[^\n]{0,2048}(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)",
        r"(send|post|upload|transmit)\s+[^\n]{0,2048}\s+(to|at)\s+https?://",
        rf"(include|output|print|share)\s+{_FILLER}(conversation|chat\s+history|previous\s+messages|full\s+context|entire\s+context)",
        r"authorized_keys",
        r"(?:\b(?:echo|cat|cp|mv|dd|tee|install|printf|rsync|scp|ln|append|add|write|sed|chmod|chown|truncate|rm|touch|curl|wget|git)\b|\bopen\s*\(|>>?)[^\n]{0,512}(?:\$HOME/\.ssh|~/\.ssh)",
        rf"{_MODIFY}(?:AGENTS\.md|CLAUDE\.md|\.cursorrules|\.clinerules|SOUL\.md)",
    )),
)
# Characters that are not seen: zero-width ones, the bidirectional controls and the tag characters.
_INVISIBLE = re.compile(
    "[​-‏‪-‮⁠-⁤⁦-⁩﻿\U000e0000-\U000e007f]"
)


def find_injection(text: str) -> str | None:
    """The kind of model-steering `text` holds ("invisible" or "instructions"), or None."""
    if _INVISIBLE.search(text):
        return "invisible"
    plain = unicodedata.normalize("NFKC", text)
    if any(pattern.search(plain) for pattern in _INJECTION):
        return "instructions"
    return None


def refusal(*texts: str) -> str | None:
    """Why a memory made of `texts` may not be written ("secret:<kind>" or
    "injection:<kind>"), or None when it may."""
    for text in texts:
        if not text:
            continue
        secret = find_secret(text)
        if secret is not None:
            return f"secret:{secret}"
        steering = find_injection(text)
        if steering is not None:
            return f"injection:{steering}"
    return None

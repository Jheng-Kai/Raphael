"""The checks every memory passes before it is written, whoever writes it: the agent in a turn,
the reflection pass, the weekly consolidation, or the user in the settings.

A model is told never to keep a password, and usually does not, but the code is the guarantee (the
advice of Anthropic's own documentation for its memory tool). So a memory is refused when it holds:

- a secret (`find_secret`): the shapes of API keys and tokens (OpenRouter's and OpenAI's `sk-`,
  GitHub's `ghp_` and `github_pat_`, Slack's `xox?-`, AWS's `AKIA`, Google's `AIza`, a JWT, a
  `Bearer` token, a private key block), a long run of random-looking characters (not the words and
  numbers of an address's path, which on 2026-11-14 kept a weather link off a page), what follows a
  word for a password, a PIN or a one-time code (a value with a digit or a symbol in it, or any
  value at all once "is", ":", "=", 是, 為 or は gives it to the word, so "password is hunter" too,
  while "password manager" and "the password is stored in ..." pass), a card number (a card's first
  digit and the Luhn check), a Taiwanese ID number or an IBAN;
- or something written to steer a model (`find_injection`), which is how a memory is poisoned
  (SpAIware, 2024): an order to ignore the instructions, a line dressed as a system message, a
  Markdown image (a way to send data out), an address with a query string, or invisible characters.

Each check says only which kind of thing it found, never the text, so that the reason can be shown
and logged. Nothing here logs anything.
"""

import math
import re
import unicodedata
from collections import Counter

# --- secrets ---------------------------------------------------------------------------------------

_TOKEN_SHAPES = (
    re.compile(r"\bsk-(?:or-|proj-|ant-)?[A-Za-z0-9_\-]{16,}"),
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
# A long run of the characters keys are written in.
_LONG_RUN = re.compile(r"[A-Za-z0-9+/=_\-]{32,}")
# The entropy, in bits a character, from which such a run looks random rather than like a word.
_RANDOM_BITS = 3.5
# What an address or a file name joins its words with.
_JOINERS = re.compile(r"[/_\-]+")
# A word changes case a few times at most (iPhone, GitHub, NVIDIA); random letters keep changing it.
_WORD_CASE_CHANGES = 3
# A short code among the words of a path (v2, mp4, h264, 3d).
_CODE = 4

# The words for a password, a PIN or a one-time code, in the three languages and a few spellings,
# then what is written after them within a few characters ("是", ":", "is"...).
_SECRET_WORDS = (
    r"密碼|密码|口令|通關碼|驗證碼|验证码|認證碼|認証コード|確認碼|動態碼|"
    r"パスワード|パスコード|暗証番号|ワンタイム|"
    r"\b(?:password|passwd|passcode|passphrase|pin(?:\s*code)?|otp|one[- ]time\s+(?:code|password)|"
    r"verification\s+code|security\s+code|2fa\s+code|cvv|cvc)\b"
)
# The value: three characters or more with a digit or a symbol in them (a word alone, such as the
# "manager" of "password manager", is not taken for one).
_SECRET_VALUE = re.compile(
    rf"(?i)(?:{_SECRET_WORDS})(?:\s+(?:code|number|no\.?))?\s*"
    r"(?:是|為|为|は|:|：|=|\bis\b|\bwas\b)?\s*[「『\"'“]?\s*"
    r"(?=[^\s」』\"'”。，,]*[\d!@#$%^&*])[^\s」』\"'”。，,]{3,}"
)
# The words that say where or how a password is kept rather than what it is, after "is" or "was"
# ("the password is stored in 1Password", "the PIN was changed").
_NOT_A_VALUE = (
    r"in|on|at|by|the|a|an|my|your|his|her|their|our|its|this|that|not|also|still|now|"
    r"stored|saved|kept|written|managed|synced|set|changed|reset|updated|required|needed|"
    r"same|different|long|short|strong|weak|easy|hard|secret|private|unknown|forgotten|expired"
)
# Any value at all, once something gives it to the word ("是", "為", "は", ":", "=", "is", "was"):
# a password of letters alone ("password is hunter", "密碼是 hunter") is a password too. A word that
# is followed by no such mark ("password manager", "密碼管理器是 Bitwarden") is left alone.
_SECRET_GIVEN = re.compile(
    rf"(?i)(?:{_SECRET_WORDS})(?:\s+(?:code|number|no\.?))?\s*"
    rf"(?:是|為|为|は|:|=|\b(?:is|was)\b(?!\s+(?:{_NOT_A_VALUE})\b))\s*[「『\"'“]?\s*"
    r"[^\s」』\"'”。，,]"
)
# Thirteen to nineteen digits, in groups or not: a card number if the Luhn check passes.
_CARD = re.compile(r"(?<![\d.])(?:\d[ \-]?){12,18}\d(?![\d.])")
_TAIWAN_ID = re.compile(r"\b[A-Z][12]\d{8}\b")
_IBAN = re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b")


def _bits_per_char(text: str) -> float:
    counts = Counter(text)
    return -sum(n / len(text) * math.log2(n / len(text)) for n in counts.values())


def _readable(run: str) -> bool:
    """Words and numbers joined the way an address joins them, with a few short codes among them: a path someone can read
    (taichung-city/315040/weather-forecast, news/press-release-details/2026/NVIDIA-Announces-CEO-Transition), not a key.
    A path has a slash: words joined by underscores or hyphens alone (synthetic_private_credential_123456789) are a
    value given to a key's name as often as a name, and stay judged as keys. A piece that mixes letters and digits beyond
    a short code, or letters that keep changing case, is a key's."""
    if "/" not in run or "+" in run or "=" in run:
        return False
    words = codes = 0
    for part in filter(None, _JOINERS.split(run)):
        if part.isdigit():
            continue
        if part.isalpha():
            if sum(a.isupper() != b.isupper() for a, b in zip(part, part[1:])) > _WORD_CASE_CHANGES:
                return False
            words += 1
        elif len(part) <= _CODE:
            codes += 1
        else:
            return False
    return words > codes


def _looks_random(run: str) -> bool:
    has_digit = any(c.isdigit() for c in run)
    has_letter = any(c.isalpha() for c in run)
    return has_digit and has_letter and _bits_per_char(run) >= _RANDOM_BITS and not _readable(run)


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


def find_secret(text: str) -> str | None:
    """The kind of secret `text` holds ("token", "password", "card", "id_number", "iban"), or None
    when it holds none."""
    plain = unicodedata.normalize("NFKC", text)
    if any(shape.search(plain) for shape in _TOKEN_SHAPES):
        return "token"
    if any(_looks_random(run) for run in _LONG_RUN.findall(plain)):
        return "token"
    if _SECRET_VALUE.search(plain) or _SECRET_GIVEN.search(plain):
        return "password"
    for found in _CARD.finditer(plain):
        digits = re.sub(r"\D", "", found.group())
        # A card number begins with 2 to 6 (Mastercard's 2-series, Amex, JCB and Diners 3, Visa 4, Mastercard 5, Discover and
        # UnionPay 6); a time in milliseconds, which passes the check one time in ten, begins with 1.
        if 13 <= len(digits) <= 19 and digits[0] in "23456" and _luhn(digits):
            return "card"
    if _TAIWAN_ID.search(plain):
        return "id_number"
    if _IBAN.search(plain):
        return "iban"
    return None


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
    re.compile(r"!\[[^\]]*\]\("),  # a Markdown image: a way to send what it is given away
    re.compile(r"(?i)\bhttps?://\S+\?\S*="),  # an address with a query string
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

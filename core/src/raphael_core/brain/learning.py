"""Persistence validation for learned terms selected by the native pure capture rule."""

from .mishearing import _CJK_FUNCTION_WORDS, _LATIN_FUNCTION_WORDS, _is_cjk


_COMMON_CJK = _CJK_FUNCTION_WORDS | frozenset("後天 明日 再 討論 真的 很好 謝謝 ありがとう こんにちは".split())


def term(text: str, *, target: bool = True) -> bool:
    # Capture owns term selection. Persistence validates its shape without an OS dictionary,
    # so the same captured name works on every machine and language.
    if not text or len(text) > (24 if target else 60):
        return False
    if any(c in text for c in "，。！？、；：,.!?;:\r\n\u2028\u2029"):
        return False
    if not target:
        return True
    if all(_is_cjk(c) for c in text):
        return 2 <= len(text) <= 8
    latin_words = 0
    in_word = False
    for c in text:
        letter = c.isalnum() and not _is_cjk(c)
        latin_words += letter and not in_word
        in_word = letter
    return latin_words <= 3 and any(c.isalpha() for c in text)


def target_term(word: str) -> bool:
    if not term(word) or all(part.casefold() in _LATIN_FUNCTION_WORDS for part in word.split()):
        return False
    remaining = word
    while remaining:
        prefix = max((part for part in _COMMON_CJK if remaining.startswith(part)), key=len, default="")
        if not prefix:
            return True
        remaining = remaining[len(prefix):]
    return False


def accepted(word: str, misheard: str) -> bool:
    """Validate a captured pair without a model or a platform word dictionary."""
    if not target_term(word) or not term(misheard, target=False) or word.casefold() == misheard.casefold():
        return False
    # A pure shortening carries no replacement term, even when a caller expands its bounds.
    old, new = misheard.casefold(), word.casefold()
    if len(new) < len(old) and (old.startswith(new) or old.endswith(new)):
        return False
    if not 0.4 <= len(misheard) / len(word) <= 2.5:
        return False
    return True

"""The single acceptance boundary for automatically learned terms, including direct store calls."""

import ctypes
import functools
import sys
from .mishearing import _CJK_FUNCTION_WORDS, _LATIN_FUNCTION_WORDS, _is_cjk, _is_latin_letter


@functools.lru_cache(maxsize=4096)
def cjk_word(text: str) -> bool:
    """Use the OS's offline ICU word dictionary; unavailable segmentation fails closed."""
    if sys.platform != "win32":
        return False
    try:
        icu = ctypes.CDLL("icu.dll")
        icu.ubrk_open.restype = ctypes.c_void_p
        icu.ubrk_open.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(ctypes.c_int)]
        for name in ("ubrk_first", "ubrk_next", "ubrk_close"):
            getattr(icu, name).argtypes = [ctypes.c_void_p]
        encoded = text.encode("utf-16-le")
        buffer = ctypes.create_string_buffer(encoded)
        status = ctypes.c_int(0)
        iterator = icu.ubrk_open(1, b"zh_TW", buffer, len(encoded) // 2, ctypes.byref(status))
        if not iterator:
            return False
        try:
            if status.value > 0:
                return False
            return icu.ubrk_first(iterator) == 0 and icu.ubrk_next(iterator) == len(encoded) // 2 and icu.ubrk_next(iterator) == -1
        finally:
            icu.ubrk_close(iterator)
    except (OSError, AttributeError):
        return False


def term(text: str, *, target: bool = True) -> bool:
    if not text or len(text) > 40:
        return False
    if all(_is_cjk(c) for c in text):
        return 2 <= len(text) <= 4 and (not target or cjk_word(text))
    parts = text.split(" ")
    return (1 <= len(parts) <= 2 and all(part and _is_latin_letter(part[0]) and all(_is_latin_letter(c) or c.isascii() and c.isdigit() for c in part) for part in parts)
            and sum(c.isalpha() for c in text) >= (3 if target else 2))


def target_term(word: str) -> bool:
    return (term(word) and word not in _CJK_FUNCTION_WORDS
            and not all(part.casefold() in _LATIN_FUNCTION_WORDS for part in word.split()))


def accepted(word: str, misheard: str) -> bool:
    """Both sides are terms; punctuation, clauses, common words and deletion-only edits fail."""
    if not target_term(word) or not term(misheard, target=False) or word.casefold() == misheard.casefold():
        return False
    # A shortened run is a deletion, even if a caller expanded it to whole words.
    old, new = misheard.casefold(), word.casefold()
    if len(new) < len(old) and (old.startswith(new) or old.endswith(new)):
        return False
    return True

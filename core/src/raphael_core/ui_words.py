"""Complete fixed UI copy for the additional interface locales."""

from dataclasses import fields, is_dataclass, replace

from .ui_languages import LANGUAGES, normalize_language
from ._ui_words_data import WORDS as _WORDS
from ._card_words_data import CARD_WORDS
from ._computer_words_data import COMPUTER_WORDS
from ._whose_computer_words_data import WHOSE_COMPUTER_WORDS

WORDS = {**_WORDS, **CARD_WORDS, **COMPUTER_WORDS, **WHOSE_COMPUTER_WORDS}
NEW_LANGUAGES = tuple(language for language in LANGUAGES if language not in ("zh-TW", "en", "ja"))


def ui_word(source: str, language: str) -> str:
    """Unknown locales use English; supported new locales require an actual translation."""
    language = normalize_language(language)
    return WORDS[source][language] if language in NEW_LANGUAGES else source


def _translated(value, language):
    if isinstance(value, str):
        return ui_word(value, language)
    if isinstance(value, dict):
        return {key: _translated(item, language) for key, item in value.items()}
    if isinstance(value, tuple):
        return tuple(_translated(item, language) for item in value)
    if isinstance(value, list):
        return [_translated(item, language) for item in value]
    if is_dataclass(value):
        return replace(value, **{field.name: _translated(getattr(value, field.name), language) for field in fields(value)})
    return value


def with_ui_words(table, render=None):
    """Extend a legacy table while leaving its original three entries unchanged."""
    return {
        **table,
        **{language: render(language) if render else _translated(table["en"], language) for language in NEW_LANGUAGES},
    }

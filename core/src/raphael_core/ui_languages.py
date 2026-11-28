"""Canonical interface locales and English fallback for unknown locale codes.

The interface language picks fixed app copy and supplies the fallback for authored speech
when there is no language preference or owner message to follow."""

LANGUAGE_NAMES = {
    "zh-TW": "Traditional Chinese as written in Taiwan (never Simplified characters)",
    "en": "English", "ja": "Japanese", "zh-CN": "Simplified Chinese as written in mainland China",
    "ko": "Korean", "es": "Spanish", "fr": "French", "de": "German",
    "pt-BR": "Brazilian Portuguese", "it": "Italian", "ru": "Russian",
    "vi": "Vietnamese", "th": "Thai", "id": "Indonesian", "tr": "Turkish",
}
LANGUAGES = tuple(LANGUAGE_NAMES)


def normalize_language(value: str) -> str:
    """Resolve UI locale aliases without collapsing Simplified Chinese into Traditional."""
    code = value.strip().replace("_", "-").casefold() if isinstance(value, str) else ""
    if code == "zh" or code.startswith("zh-"):
        return "zh-CN" if any(part in ("cn", "sg", "hans") for part in code.split("-")[1:]) else "zh-TW"
    base = code.split("-")[0]
    if base == "pt":
        return "pt-BR"
    return base if base in LANGUAGE_NAMES else "en"


def fixed_language(value: str) -> str:
    """Preserve supported locales and use English only for an unknown locale."""
    return normalize_language(value)


def interface_language_name(value: str) -> str:
    """Name the normalized interface locale and its code in a model instruction."""
    code = normalize_language(value)
    return f"{LANGUAGE_NAMES[code].split(' as written', 1)[0]} ({code})"


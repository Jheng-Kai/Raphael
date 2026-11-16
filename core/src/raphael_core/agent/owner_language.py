"""The interface language the owner chose in the window, for the words the app draws and for nothing a model reads.

The interface language picks the words the app draws; it never changes the language a conversation is held in and never reaches a system prompt.
`configured_language` picks the fixed notices of unattended and external conversations (a Telegram chat, a routine, a
resumed request); the language of a reply comes from the owner's own words (`conversation_language`)."""

import json
from pathlib import Path

from ..ui_languages import LANGUAGES, normalize_language


def configured_language(data_dir: Path) -> str | None:
    try:
        document = json.loads((data_dir / "device.json").read_text(encoding="utf-8-sig"))
        value = document.get("ui_language") if isinstance(document, dict) else None
    except (OSError, ValueError):
        value = None
    return normalize_language(value) if isinstance(value, str) and value in LANGUAGES else None

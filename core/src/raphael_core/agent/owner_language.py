"""The interface language the owner chose in the window, for the words the app draws and for nothing a model reads.

The owner, 2026-11-14: 「系統的 UI 語言並不會影響到使用者內部聊天的語言…它也不會去到 system prompt，什麼事都不會發生」.
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

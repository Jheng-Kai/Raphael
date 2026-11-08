"""Read the shell's configured language without borrowing another turn's language."""

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


def reply_context(language: str) -> str:
    return (f"Owner's configured reply language: {normalize_language(language)}. "
            "Use it for this reply and report unless the owner's explicit request or your own persona specifies "
            "another language. Earlier turns, colleague messages and tool output do not change this default.")

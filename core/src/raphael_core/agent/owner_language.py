"""Read the interface language the owner chose in the window.

Unattended and external conversations use it for fixed notices and as the authored-language fallback when the
owner has supplied no words or explicit preference."""

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

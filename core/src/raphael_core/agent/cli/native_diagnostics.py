"""Redacted diagnostics for opted-in, unpackaged native test runs only."""

import json
import logging
import os
import re
import sys
from pathlib import Path

from ...failures import scrub

logger = logging.getLogger(__name__)
_SECRET = re.compile(r"token|authorization|cookie|password|secret|api.?key|account.?id", re.I)


def enabled():
    return (not getattr(sys, "frozen", False) and os.environ.get("RAPHAEL_TEST_NATIVE") == "1"
            and os.environ.get("RAPHAEL_FAKE_LLM") == "1" and bool(os.environ.get("RAPHAEL_DATA_DIR")))


def directory(kind):
    return Path(os.environ["RAPHAEL_DATA_DIR"]) / "cli" / kind if enabled() else None


def redact(value, secrets=()):
    if isinstance(value, dict):
        return {key: "[redacted]" if _SECRET.search(str(key)) else redact(item, secrets) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(item, secrets) for item in value]
    if not isinstance(value, str):
        return value
    for secret in sorted((item for item in secrets if isinstance(item, str) and item), key=len, reverse=True):
        for representation in {secret, json.dumps(secret)[1:-1], json.dumps(secret, ensure_ascii=False)[1:-1]}:
            value = value.replace(representation, "[redacted]")
    value = scrub(value)
    value = re.sub(r"[A-Za-z0-9_+/=.-]{32,}", "[redacted]", value)
    # URLs may contain credentials or OAuth state; never retain their contents.
    value = re.sub(r"https?://[^\s\"'<>]+", "[url redacted]", value)
    return value


def capture(stage, value, secrets=()):
    if enabled():
        safe = json.dumps(redact(value, secrets), ensure_ascii=True)
        logger.warning("Native CLI diagnostic %s: %s", stage, safe[-12000:])

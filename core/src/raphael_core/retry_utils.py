"""How long to wait before a failed model call is made again.

Adapted from NousResearch/hermes-agent (MIT); see core/packaging/licenses.

Jittered delays (vs. fixed ones) keep many sessions that meet the same throttled provider from retrying in step.
Standard library only: the worker process imports `failures`, which imports this.
"""

import random
import re
import threading
import time
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any, Optional

# Monotonic counter for jitter-seed uniqueness within a process; locked because sessions retry at the same time.
_jitter_counter = 0
_jitter_lock = threading.Lock()

# How long a model may say nothing before its answer begins. Deep reasoning is silent for minutes: a real gpt-6-sol at max
# effort thought 470 s; opencode waits 900 s for a chunk (DeepSeek asked for at least that), Hermes 600 s for its reasoning
# models (1500 s at most for a Codex plan), Codex itself 300 s. Any traffic, a keep-alive comment included, starts the wait
# again: this is for a connection that sends nothing at all, and it is the longest silence a person would call thinking.
MODEL_SILENCE_S = 1800.0
# Once the answer is flowing, a gap this long is a dead connection, not a thought. Hermes: 180 s, and 600 s for its
# reasoning models, which is the number taken here.
STREAM_STALL_S = 600.0
# Connecting is quick or it is not going to happen (Hermes: 30 s).
CONNECT_TIMEOUT_S = 30.0
# A provider's own "wait N seconds" is believed up to this long (Hermes: Anthropic buckets of ~171 s tripped a 120 s cap).
# One that names more is asked again after this long, so that a wait of hours is polled and not slept through (a quota
# that lasts hours is a `usage_limit` and is not waited for at all: `failures.classify`).
RETRY_AFTER_CAP_S = 600.0
# A wait this long is worth a line to the owner.
ANNOUNCE_WAIT_S = 10.0


def parse_retry_after_seconds(value_or_headers: Any) -> Optional[float]:
    """Parse a ``Retry-After`` value (numeric / HTTP-date) or a headers mapping (both casings tried) into
    seconds, clamped at 0.0; None when absent / unparseable."""
    raw = value_or_headers
    if raw is not None and not isinstance(raw, (str, int, float)):
        getter = getattr(raw, "get", None)
        if not callable(getter):
            return None
        try:
            raw = getter("Retry-After")
            if raw is None:
                raw = getter("retry-after")
        except Exception:
            return None
    if raw is None or isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        return max(0.0, float(raw))
    text = str(raw).strip()
    if not text:
        return None
    try:
        return max(0.0, float(text))
    except (TypeError, ValueError):
        pass
    # HTTP-date form (RFC 7231): seconds until that instant, clamped at 0.
    try:
        when = parsedate_to_datetime(text)
    except (TypeError, ValueError):
        return None
    if when is None:  # older stdlib returns None instead of raising
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=UTC)
    return max(0.0, (when - datetime.now(UTC)).total_seconds())


# Free-text "reset" grammars providers put in error bodies, tried in order.
_QUOTA_RESET_DELAY_RE = re.compile(r"quotaResetDelay[:\s\"]+(\d+(?:\.\d+)?)(ms|s)", re.IGNORECASE)
# "Resets in 4hr 5min" (weekly usage limits), "resets in 2 hours 5 minutes", "resets in 30s".
_RESETS_IN_RE = re.compile(
    r"resets?\s+in\s+"
    r"(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b\s*)?"
    r"(?:(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b\s*)?"
    r"(?:(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b)?", re.IGNORECASE,
)
_RETRY_AFTER_SECONDS_RE = re.compile(r"retry\s+(?:after\s+|in\s+)?(\d+(?:\.\d+)?)\s*(?:sec|secs|seconds|s\b)", re.IGNORECASE)
# OpenAI's "Please try again in 6s / 1m30.5s / 20ms / 5 minutes".
_TRY_AGAIN_IN_RE = re.compile(
    r"try\s+again\s+in\s+"
    r"(?:(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)(?![a-z])\s*)?"
    r"(?:(\d+(?:\.\d+)?)\s*(ms|seconds?|secs?|s)(?![a-z]))?", re.IGNORECASE,
)
# The plan usage-limit body field as it appears once stringified: ``'resets_in_seconds': 30995``.
_RESETS_IN_SECONDS_FIELD_RE = re.compile(r"resets_in_seconds\W{1,4}(\d+(?:\.\d+)?)", re.IGNORECASE)


def _quota_reset_seconds(m: re.Match[str]) -> float:
    value = float(m.group(1))
    return value / 1000.0 if m.group(2).lower() == "ms" else value


def _resets_in_seconds(m: re.Match[str]) -> Optional[float]:
    if not any(m.groups()):  # "resets in" with no unit-bearing number: not this grammar
        return None
    return float(m.group(1) or 0) * 3600 + float(m.group(2) or 0) * 60 + float(m.group(3) or 0)


def _try_again_in_seconds(m: re.Match[str]) -> Optional[float]:
    minutes, amount, unit = m.groups()
    if minutes is None and amount is None:  # "try again in a moment"
        return None
    seconds = float(amount or 0) / (1000.0 if (unit or "").lower() == "ms" else 1.0)
    return float(minutes or 0) * 60 + seconds


# An explicit "retry after N s" wins over "resets in ...": a body carrying both describes a short throttle inside a
# long quota window, and the shorter explicit wait is the one the provider actually asks for.
RETRY_DELAY_PATTERNS = (
    (_QUOTA_RESET_DELAY_RE, _quota_reset_seconds),
    (_RETRY_AFTER_SECONDS_RE, lambda m: float(m.group(1))),
    (_TRY_AGAIN_IN_RE, _try_again_in_seconds),
    (_RESETS_IN_SECONDS_FIELD_RE, lambda m: float(m.group(1))),
    (_RESETS_IN_RE, _resets_in_seconds),
)


def reset_delay_from_message(message: str) -> Optional[float]:
    """Seconds-until-reset parsed from free-text provider error messages, or None."""
    if not message:
        return None
    for pattern, to_seconds in RETRY_DELAY_PATTERNS:
        m = pattern.search(message)
        if m and (seconds := to_seconds(m)) is not None:
            return seconds
    return None


def jittered_backoff(attempt: int, *, base_delay: float = 5.0, max_delay: float = 120.0, jitter_ratio: float = 0.5) -> float:
    """min(base * 2^(attempt-1), max_delay) + uniform jitter in
    [0, jitter_ratio * delay]. ``attempt`` is 1-based."""
    global _jitter_counter
    with _jitter_lock:
        _jitter_counter += 1
        tick = _jitter_counter

    exponent = max(0, attempt - 1)
    delay = max_delay if (exponent >= 63 or base_delay <= 0) else min(base_delay * (2 ** exponent), max_delay)

    # Seed from time + counter so coarse clocks still decorrelate.
    seed = (time.time_ns() ^ (tick * 0x9E3779B9)) & 0xFFFFFFFF
    return delay + random.Random(seed).uniform(0, jitter_ratio * delay)


def provider_retry_after_seconds(error: Any) -> Optional[float]:
    """Provider-declared cooldown: the ``Retry-After`` header, else a ``retry_after`` body field
    (top level or nested under ``error``). None when absent, unparseable or zero: a zero or expired
    cooldown carries no usable wait, and treating it as one would hot-loop the provider."""
    value = parse_retry_after_seconds(getattr(getattr(error, "response", None), "headers", None))
    if value is None:
        body = getattr(error, "body", None)
        if isinstance(body, dict):
            nested = body.get("error")
            value = parse_retry_after_seconds((nested if isinstance(nested, dict) else body).get("retry_after"))
    return value if value is not None and value > 0 else None


def retry_delay(step: float, retry_after: Optional[float] = None) -> float:
    """The wait before the next try: the schedule's `step` with a little jitter, or what the provider asked for
    (up to RETRY_AFTER_CAP_S) when that is longer."""
    wait = jittered_backoff(1, base_delay=step, max_delay=step, jitter_ratio=0.2)
    return wait if not retry_after else max(wait, min(retry_after, RETRY_AFTER_CAP_S))


class Outage:
    """The waits of one run of failed model calls. Asking again repeats nothing, since tools run only after a reply, so
    after something was done the run rides the failure out at the `patient` pace until the owner stops it; before that it
    gives up after the `quick` waits so that the owner learns in seconds. The owner is told once, when the outage is
    long enough to notice: a wait the owner would feel, or the run settling in to wait."""

    def __init__(self, quick, patient, *, patient_ok: bool) -> None:
        patient = tuple(patient)
        self._quick, self._patient, self._patient_ok = iter(quick), iter(patient), patient_ok
        self._last = patient[-1] if patient else 0.0
        self._settled = False
        self.told = False

    def wait(self, retry_after: Optional[float] = None) -> Optional[float]:
        """Seconds to wait before the next try, or None when the run gives up."""
        step = next(self._quick, None)
        if step is None:
            if not self._patient_ok:
                return None
            self._settled = True
            step = next(self._patient, self._last)
        return retry_delay(step, retry_after)

    def announce(self, wait: float) -> bool:
        """Whether the owner is told about this wait: once per outage."""
        if self.told or not (self._settled or wait >= ANNOUNCE_WAIT_S):
            return False
        self.told = True
        return True

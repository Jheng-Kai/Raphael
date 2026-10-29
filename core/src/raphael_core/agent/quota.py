"""Persistent subscription exhaustion hints. Provider text is parsed and discarded at ingress."""

import json
import math
import re
import sqlite3
from datetime import datetime, timedelta

from ..clock import wall_clock_ms

_LIMIT = re.compile(r"quota|usage.?limit|limit.{0,24}(?:reached|exceeded)|resource_exhausted|out of.{0,10}(?:usage|credits)|hit your limit", re.I)


def credit_state(packet: dict) -> dict | None:
    """Normalize only Codex credit fields, without retaining account/provider text."""
    if not isinstance(packet, dict):
        return None
    credits = packet.get("credits")
    if isinstance(credits, dict):
        balance = credits.get("balance")
        try:
            balance = float(balance) if not isinstance(balance, bool) and balance is not None else None
            balance = balance if balance is not None and math.isfinite(balance) and balance >= 0 else None
        except (ValueError, TypeError, OverflowError):
            balance = None
        return {"has_credits": credits.get("hasCredits") is True, "unlimited": credits.get("unlimited") is True,
                "balance": balance}
    for value in packet.values():
        if isinstance(value, dict) and (found := credit_state(value)) is not None:
            return found
    return None


def can_use_credits(state: dict | None) -> bool:
    # hasCredits is authoritative; a balance alone does not establish entitlement.
    return bool(state and (state.get("has_credits") is True or state.get("unlimited") is True))


def _timestamp(value):
    if isinstance(value, (float, int)) and not isinstance(value, bool):
        return int(value * 1000) if 1000000000 < value < 100000000000 else int(value) if value > 100000000000 else None
    if isinstance(value, str):
        try:
            return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
        except (ValueError, OverflowError):
            pass
    return None


def parse_quota(packet: dict, now_ms: int) -> dict | None:
    """Accept Codex windows or CLI error messages; never return any provider prose."""
    if packet.get("type") == "rate_limit_event" and "rate_limit_info" in packet:
        info = packet["rate_limit_info"]
        if not isinstance(info, dict):
            return None
        status = info.get("status")
        period = {"five_hour": "fiveHour", "seven_day": "weekly", "seven_day_opus": "weeklyOpus",
                  "seven_day_sonnet": "weeklySonnet"}.get(info.get("rateLimitType", info.get("rate_limit_type")))
        if status not in ("allowed", "allowed_warning", "rejected") or not period:
            return None
        reset = _timestamp(info.get("resetsAt", info.get("resets_at")))
        used = info.get("utilization")
        remaining = round(100 * (1 - used), 2) if type(used) in (int, float) and math.isfinite(used) and 0 <= used <= 1 else None
        exhausted = status == "rejected" and (reset is None or reset > now_ms)
        return {"exhausted": exhausted, "reset_at_ms": reset if exhausted else None,
                "windows": [{"period": period, "remaining_percent": remaining,
                             "resets_at": reset // 1000 if reset else None, "status": status}]}
    text = json.dumps(packet, ensure_ascii=False, default=str)[:64000]
    limit_text = re.sub(r"rate[ _-]?limit", "", text, flags=re.I)
    windows = []
    reported = []
    denied = False

    def visit(item):
        nonlocal denied
        if isinstance(item, dict):
            if item.get("error") and _LIMIT.search(re.sub(r"rate[ _-]?limit", "",
                    json.dumps(item["error"], default=str), flags=re.I)):
                denied = True
            percent = item.get("usedPercent", item.get("used_percent"))
            if type(percent) in (int, float) and math.isfinite(percent):
                reset = _timestamp(item.get("resetsAt", item.get("resets_at")))
                windows.append((percent >= 100, reset))
                period = {300: "fiveHour", 10080: "weekly"}.get(item.get("windowDurationMins"))
                if period and 0 <= percent <= 100:
                    reported.append({"period": period, "remaining_percent": 100 - percent,
                                     "resets_at": reset // 1000 if reset else None,
                                     "status": "rejected" if percent >= 100 else "allowed"})
            for value in item.values():
                visit(value)
        elif isinstance(item, list):
            for value in item:
                visit(value)

    visit(packet)
    if windows:
        exhausted = [reset for full, reset in windows if full and (reset is None or reset > now_ms)]
        credits = credit_state(packet)
        blocked = denied or bool(exhausted) and not can_use_credits(credits)
        return {"exhausted": blocked, "reset_at_ms": max((r for r in exhausted if r), default=None) if blocked else None,
                **({"terminal": True} if denied else {}),
                **({"credits": credits} if credits is not None else {}),
                **({"windows": reported} if reported else {})}
    if (credits := credit_state(packet)) is not None and not _LIMIT.search(limit_text):
        return {"exhausted": False, "reset_at_ms": None, "credits": credits}
    if not _LIMIT.search(limit_text):
        return None
    resets = []

    def dates(item):
        if isinstance(item, dict):
            for key, value in item.items():
                if key in ("resetsAt", "resetAt", "reset_at", "reset_at_ms", "resets_at", "resetTime"):
                    if stamp := _timestamp(value):
                        resets.append(stamp)
                elif key in ("retryAfter", "retry_after", "reset_after_seconds") and type(value) in (int, float):
                    resets.append(now_ms + int(value * 1000))
                dates(value)
        elif isinstance(item, list):
            for value in item:
                dates(value)

    dates(packet)
    for iso in re.findall(r"\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:Z|[+-]\d\d:\d\d)", text):
        if stamp := _timestamp(iso):
            resets.append(stamp)
    relative = re.search(r"(?:retry|resets?|try again)\s+(?:in|after)\s+((?:\d+\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\s*)+)", text, re.I)
    if relative:
        seconds = sum(int(n) * (3600 if unit.lower().startswith("h") else 60 if unit.lower().startswith("m") else 1)
                      for n, unit in re.findall(r"(\d+)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)", relative[1], re.I))
        resets.append(now_ms + seconds * 1000)
    clock = re.search(r"resets?\s+(?:at\s+)?(\d{1,2})(?::(\d\d))?\s*(AM|PM)?\b", text, re.I)
    if clock and 0 <= int(clock[1]) <= 23 and int(clock[2] or 0) < 60:
        hour = int(clock[1])
        if clock[3]:
            hour = hour % 12 + (12 if clock[3].upper() == "PM" else 0)
        now = datetime.fromtimestamp(now_ms / 1000).astimezone()
        reset = now.replace(hour=hour, minute=int(clock[2] or 0), second=0, microsecond=0)
        if reset <= now:
            reset += timedelta(days=1)
        resets.append(int(reset.timestamp() * 1000))
    return {"exhausted": True, "reset_at_ms": max((r for r in resets if r > now_ms), default=None)}


class Quotas:
    def __init__(self, conn: sqlite3.Connection, now_ms=wall_clock_ms, notify=None):
        self.conn, self.now_ms, self.notify = conn, now_ms, notify
        self.credits: dict[str, dict] = {}

    def record(self, provider: str, data: dict) -> None:
        if provider not in ("codex", "claude", "gemini"):
            return
        before = self._state(provider)
        reset = data.get("reset_at_ms")
        if isinstance(data.get("credits"), dict):
            self.credits[provider] = data["credits"]
        with self.conn:
            for window in data.get("windows", []):
                period, status = window.get("period"), window.get("status")
                if period not in ("fiveHour", "weekly", "weeklyOpus", "weeklySonnet") or status not in ("allowed", "allowed_warning", "rejected"):
                    continue
                remaining, stamp = window.get("remaining_percent"), window.get("resets_at")
                remaining = remaining if type(remaining) in (int, float) and math.isfinite(remaining) and 0 <= remaining <= 100 else None
                self.conn.execute("INSERT INTO subscription_allowances VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(provider, period) DO UPDATE SET remaining_percent=excluded.remaining_percent, resets_at=excluded.resets_at, status=excluded.status, updated_at_ms=excluded.updated_at_ms",
                                  (provider, period, remaining, stamp if type(stamp) is int and stamp > 0 else None, status, self.now_ms()))
            if not data.get("terminal") and (data.get("windows") or not data.get("exhausted") and self.allowances(provider)):
                # A healthy short window must not clear a still-rejected weekly window.
                rejected = [w for w in self.allowances(provider) if w["status"] == "rejected"
                            and (w["resets_at"] is None or w["resets_at"] * 1000 > self.now_ms())]
                data = {"exhausted": bool(rejected)}
                reset = None if any(w["resets_at"] is None for w in rejected) else max((w["resets_at"] * 1000 for w in rejected), default=None)
                if can_use_credits(self.credits.get(provider)):
                    data = {"exhausted": False}
            if not data.get("exhausted") or (type(reset) is int and reset <= self.now_ms()):
                self.conn.execute("DELETE FROM subscription_quotas WHERE provider = ?", (provider,))
            else:
                self.conn.execute("INSERT INTO subscription_quotas VALUES (?, ?, ?) ON CONFLICT(provider) DO UPDATE SET reset_at_ms = excluded.reset_at_ms, updated_at_ms = excluded.updated_at_ms",
                                  (provider, reset if type(reset) is int else None, self.now_ms()))
        # Usage reads record live windows; only a real change may notify, or every reader reloads forever.
        if self.notify and self._state(provider) != before:
            self.notify("quota.changed", {})

    def _state(self, provider: str):
        windows = [(w["period"], w["remaining_percent"], w["resets_at"], w["status"]) for w in self.allowances(provider)]
        blocked = self.conn.execute("SELECT reset_at_ms FROM subscription_quotas WHERE provider = ?", (provider,)).fetchone()
        return windows, None if blocked is None else (blocked[0],), self.credits.get(provider)

    def allowances(self, provider: str) -> list[dict]:
        return [dict(row) for row in self.conn.execute(
            "SELECT period, remaining_percent, resets_at, status, updated_at_ms FROM subscription_allowances WHERE provider = ? ORDER BY period", (provider,))]

    def list(self) -> list[dict]:
        with self.conn:
            self.conn.execute("DELETE FROM subscription_quotas WHERE reset_at_ms IS NOT NULL AND reset_at_ms <= ?", (self.now_ms(),))
        return [dict(row) for row in self.conn.execute("SELECT provider, reset_at_ms FROM subscription_quotas ORDER BY provider")]

"""Readable equivalents of bounded answer forms for external messages."""

import json
import math
import re


def _words(value):
    return isinstance(value, str) and bool(value.strip()) and len(value) <= 160


def _number(value):
    return type(value) in (int, float) and math.isfinite(value) and abs(value) <= 1e12


def _keys(value, required, optional=()):
    return isinstance(value, dict) and set(required) <= value.keys() <= set(required) | set(optional)


def _list(value, maximum):
    return isinstance(value, list) and 0 < len(value) <= maximum


def _degrees(value):
    return _number(value) and -1000 <= value <= 1000


def _percent(value):
    return _number(value) and 0 <= value <= 100


def _optional(value, key, check):
    return key not in value or check(value[key])


def _forecast(v):
    """The readable lines of a forecast form, or None when it is not a valid one."""
    if not (_keys(v, ("place", "units", "days"), ("now", "hours", "source", "updated")) and _words(v["place"]) and _words(v["units"]) and _list(v["days"], 7)):
        return None
    if not all(_optional(v, k, _words) for k in ("source", "updated")):
        return None
    if not all(_keys(d, ("day", "condition", "high", "low"), ("rain",)) and _words(d["day"]) and _words(d["condition"]) and _degrees(d["high"]) and _degrees(d["low"]) and d["low"] <= d["high"] and _optional(d, "rain", _percent) for d in v["days"]):
        return None
    lines = [v["place"]]
    now = v.get("now")
    if "now" in v:
        if not (_keys(now, ("temp", "condition"), ("feels", "humidity", "wind")) and _degrees(now["temp"]) and _words(now["condition"]) and _optional(now, "feels", _degrees) and _optional(now, "humidity", _percent) and _optional(now, "wind", _words)):
            return None
        lines.append(f'Now: {now["condition"]} {now["temp"]}' + (f' (feels {now["feels"]})' if "feels" in now else "") + (f', humidity {now["humidity"]}%' if "humidity" in now else "") + (f', wind {now["wind"]}' if "wind" in now else ""))
    if "hours" in v:
        hours = v["hours"]
        if not (_list(hours, 24) and all(_keys(h, ("time", "condition", "temp"), ("rain",)) and _words(h["time"]) and _words(h["condition"]) and _degrees(h["temp"]) and _optional(h, "rain", _percent) for h in hours)):
            return None
        lines.append("Hours: " + ", ".join(f'{h["time"]} {h["condition"]} {h["temp"]}' + (f' ({h["rain"]}%)' if "rain" in h else "") for h in hours))
    lines += [f'{d["day"]}: {d["condition"]}, {d["high"]} / {d["low"]} {v["units"]}' + (f' rain {d["rain"]}%' if "rain" in d else "") for d in v["days"]]
    if "source" in v or "updated" in v:
        lines.append(_credit(v))
    return "\n".join(lines)


def _credit(v):
    if "source" in v and "updated" in v:
        return f'Source: {v["source"]}, updated {v["updated"]}'
    return f'Source: {v["source"]}' if "source" in v else f'Updated: {v["updated"]}'


def _read(kind, source):
    if len(source) > 24000:
        return None
    try:
        v = json.loads(source)
        if kind == "forecast":
            plain = _forecast(v)
            if plain is not None:
                return plain
        if kind == "board" and _keys(v, ("columns",)) and _list(v["columns"], 5):
            if all(_keys(c, ("title", "cards")) and _words(c["title"]) and isinstance(c["cards"], list) and len(c["cards"]) <= 20 and all(_keys(card, ("title",), ("line", "owner")) and _words(card["title"]) and all(k not in card or _words(card[k]) for k in ("line", "owner")) for card in c["cards"]) for c in v["columns"]):
                return "\n\n".join("\n".join([c["title"], *["- " + card["title"] + (" — " + card["line"] if card.get("line") else "") + (" (" + card["owner"] + ")" if card.get("owner") else "") for card in c["cards"]]]) for c in v["columns"])
        if kind == "chart" and _keys(v, ("type", "title", "units", "labels", "series")) and v["type"] in ("bar", "line") and _words(v["title"]) and _words(v["units"]) and _list(v["labels"], 24) and all(map(_words, v["labels"])) and _list(v["series"], 2):
            if all(_keys(s, ("name", "values")) and _words(s["name"]) and isinstance(s["values"], list) and len(s["values"]) == len(v["labels"]) and all(map(_number, s["values"])) for s in v["series"]):
                return "\n".join([v["title"], *[label + ": " + "; ".join(f'{s["name"]} {s["values"][i]} {v["units"]}' for s in v["series"]) for i, label in enumerate(v["labels"])]])
    except (ValueError, TypeError, OverflowError, RecursionError):
        pass
    return None


def forms_plain_text(text: str) -> str:
    # Consume all fences, so examples nested inside ordinary code never become answer forms.
    lines, out, i = text.replace("\r\n", "\n").replace("\r", "\n").split("\n"), [], 0
    while i < len(lines):
        fence = re.fullmatch(r"[ \t]*(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*", lines[i])
        if not fence:
            out.append(lines[i])
            i += 1
            continue
        start, i = i, i + 1
        end = re.compile(r"[ \t]*" + re.escape(fence[1][0]) + "{" + str(len(fence[1])) + r",}[ \t]*")
        while i < len(lines) and not end.fullmatch(lines[i]):
            i += 1
        kind = fence[2].lower()
        plain = _read(kind, "\n".join(lines[start + 1:i])) if i < len(lines) and kind in ("forecast", "board", "chart") else None
        out.append(plain if plain is not None else "\n".join(lines[start:i + 1]))
        i += 1
    return "\n".join(out)

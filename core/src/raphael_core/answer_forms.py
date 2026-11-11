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


def _read(kind, source):
    if len(source) > 24000:
        return None
    try:
        v = json.loads(source)
        if kind == "forecast" and _keys(v, ("place", "units", "days")) and _words(v["place"]) and _words(v["units"]) and _list(v["days"], 7):
            if all(_keys(d, ("day", "condition", "high", "low")) and _words(d["day"]) and _words(d["condition"]) and _number(d["high"]) and _number(d["low"]) and -1000 <= d["low"] <= d["high"] <= 1000 for d in v["days"]):
                return "\n".join([v["place"], *[f'{d["day"]}: {d["condition"]}, {d["high"]} / {d["low"]} {v["units"]}' for d in v["days"]]])
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

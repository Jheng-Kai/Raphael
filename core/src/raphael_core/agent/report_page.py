"""A report page: a page whose content is structured, drawn by the app in its own design (app/src/main/report-page.ts).

A member gives `report` to show_page or update_page instead of HTML. It is checked here and kept as the page's tool_input,
so it is a page like any other: the same table, revisions, card in the turn and update path. The app draws it natively,
with every value escaped; no model-written markup or script runs. The page's `html` is a plain rendition of the same
facts, for the revision history and anything that reads a page as HTML.

The owner's request (2026-11-09, after Grok Bot's Page): a title, the date the data is as of and the promise that it only
states recorded facts, a table of contents, findings with coloured status words under a summary box, an overview table
with tabs, and a team diagram: members as boxes with their colour, labelled arrows between them, notes under it.
Shared, a report is a file of the app's own drawing (2026-11-10): see `checked_file` below.
Since 2026-11-14 (the owner's daily overview, in place of the old home) a report also holds tiles of figures (`stats`) and
charts of every common kind (`chart`), drawn by app/src/main/report-chart.ts, and a section may stand at half the width.
"""

import html as html_lib
import math
import re
from datetime import UTC, datetime

from .pages import PageError, checked_text

KINDS = ("findings", "table", "team", "text", "stats", "chart")
STATUSES = ("running", "done", "pending", "waiting", "blocked", "paused", "failed")
# The charts the app draws (app/src/main/report-chart.ts): lines and areas over time, columns side by side or stacked, bars
# across for long names, and parts of one whole.
CHARTS = ("line", "area", "bar", "stacked", "hbar", "pie", "donut")
# Charts of one whole, and those whose parts add up: no part below zero.
PARTS = ("stacked", "hbar", "pie", "donut")
# A daily overview (owner, 2026-11-14: weather, schedule, investments, projects and members on one page) has more sections
# than a report; a section may take half the page's width beside another where the page is wide enough.
SECTIONS_MAX = 12
SPANS = ("half",)
NODE_ID = re.compile(r"[A-Za-z0-9_-]{1,24}")

# Characters, not bytes: what fits the design. Each also passes the secret scan.
TITLE = 40
CALLOUT = 400
ITEMS = 12
ITEM_TITLE = 80
ITEM_TEXT = 300
LABEL = 12
COLUMNS = 6
COLUMN = 24
ROWS = 40
CELL = 120
GROUP = 24
NODES = 12
NODE_NAME = 24
NODE_NOTE = 40
EDGES = 24
EDGE_LABEL = 16
NOTES = 6
NOTE_LABEL = 12
NOTE_TEXT = 300
TEXT = 1200
STATS = 6
STAT_LABEL = 24
STAT_VALUE = 16
STAT_UNIT = 8
STAT_NOTE = 80
DELTA = 12
TREND = 24
POINTS = 24
POINT = 16
SERIES = 8
SERIES_NAME = 24
UNIT = 8
CHART_NOTE = 160
# Big enough for money in any currency. Values are kept as numbers and the kept content is scanned as a whole (a card
# number given as a value is refused as a secret like any other).
VALUE_MAX = 1e15


def _text(value, where, limit, *, required=False):
    """Trimmed text of at most `limit` characters; empty is allowed unless required."""
    if value is None and not required:
        return ""
    if not isinstance(value, str):
        raise PageError("bad_arguments", f"{where} must be text")
    value = " ".join(value.split()) if limit <= CELL else value.strip()
    if required and not value:
        raise PageError("bad_arguments", f"{where} must be nonempty text")
    if len(value) > limit:
        raise PageError("too_large", f"{where} exceeds {limit} characters; shorten it")
    return checked_text(value, where, limit * 4) if value else ""


def _list(value, where, limit, *, least=0):
    if value is None:
        value = []
    if not isinstance(value, list):
        raise PageError("bad_arguments", f"{where} must be a list")
    if len(value) > limit:
        raise PageError("too_large", f"{where} has more than {limit} entries")
    if len(value) < least:
        raise PageError("bad_arguments", f"{where} needs at least {least} entries")
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise PageError("bad_arguments", f"{where}[{index}] must be an object")
    return value


def _status(entry, where):
    """A status key, with an optional short word of the member's own for it."""
    status = entry.get("status")
    if status is None:
        if entry.get("label"):
            raise PageError("bad_arguments", f"{where}.label needs a status")
        return {}
    if status not in STATUSES:
        raise PageError("bad_arguments", f"{where}.status must be one of {', '.join(STATUSES)}")
    label = _text(entry.get("label"), f"{where}.label", LABEL)
    return {"status": status, **({"label": label} if label else {})}


def _member(value, where, exists):
    if type(value) is not int or not exists(value):
        raise PageError("bad_arguments", f"{where} is not a member; use an id from team_overview or team_work")
    return value


def _findings(section, where, exists):
    items = []
    for index, item in enumerate(_list(section.get("items"), f"{where}.items", ITEMS)):
        at = f"{where}.items[{index}]"
        items.append({"title": _text(item.get("title"), f"{at}.title", ITEM_TITLE, required=True),
                      **({"text": text} if (text := _text(item.get("text"), f"{at}.text", ITEM_TEXT)) else {}),
                      **_status(item, at)})
    callout = _text(section.get("callout"), f"{where}.callout", CALLOUT)
    if not items and not callout:
        raise PageError("bad_arguments", f"{where} needs a callout or items")
    return {**({"callout": callout} if callout else {}), "items": items}


def _table(section, where, exists):
    columns = section.get("columns")
    if not isinstance(columns, list) or not 1 <= len(columns) <= COLUMNS:
        raise PageError("bad_arguments", f"{where}.columns must be 1 to {COLUMNS} column names")
    columns = [_text(name, f"{where}.columns[{index}]", COLUMN, required=True) for index, name in enumerate(columns)]
    rows = []
    for index, row in enumerate(_list(section.get("rows"), f"{where}.rows", ROWS, least=1)):
        at = f"{where}.rows[{index}]"
        cells = row.get("cells")
        if not isinstance(cells, list) or len(cells) != len(columns):
            raise PageError("bad_arguments", f"{at}.cells must have one value for each of the {len(columns)} columns")
        value = {"cells": [_text(cell, f"{at}.cells[{n}]", CELL) for n, cell in enumerate(cells)]}
        if group := _text(row.get("group"), f"{at}.group", GROUP):
            value["group"] = group
        if row.get("member_id") is not None:
            value["member_id"] = _member(row.get("member_id"), f"{at}.member_id", exists)
        rows.append({**value, **_status(row, at)})
    status_title = _text(section.get("status_title"), f"{where}.status_title", LABEL)
    return {"columns": columns, "rows": rows, **({"status_title": status_title} if status_title else {})}


def _team(section, where, exists):
    nodes, seen, owner = [], set(), False
    for index, node in enumerate(_list(section.get("nodes"), f"{where}.nodes", NODES, least=2)):
        at = f"{where}.nodes[{index}]"
        identifier = node.get("id")
        if not isinstance(identifier, str) or not NODE_ID.fullmatch(identifier) or identifier in seen:
            raise PageError("bad_arguments", f"{at}.id must be a unique short id (letters, digits, - or _)")
        seen.add(identifier)
        # Raphael is member 0, and 0 == False: say each one's absence in its own terms.
        given = {"member_id": node.get("member_id") is not None, "owner": node.get("owner") not in (None, False),
                 "name": node.get("name") not in (None, "")}
        kinds = [key for key, present in given.items() if present]
        if len(kinds) != 1:
            raise PageError("bad_arguments", f"{at} needs exactly one of member_id, owner or name")
        value = {"id": identifier}
        if kinds == ["member_id"]:
            value["member_id"] = _member(node["member_id"], f"{at}.member_id", exists)
        elif kinds == ["owner"]:
            if node["owner"] is not True or owner:
                raise PageError("bad_arguments", f"{at}.owner must be true, once")
            owner = value["owner"] = True
        else:
            value["name"] = _text(node["name"], f"{at}.name", NODE_NAME, required=True)
        if note := _text(node.get("note"), f"{at}.note", NODE_NOTE):
            value["note"] = note
        nodes.append(value)
    edges = []
    for index, edge in enumerate(_list(section.get("edges"), f"{where}.edges", EDGES)):
        at = f"{where}.edges[{index}]"
        start, end = edge.get("from"), edge.get("to")
        if start not in seen or end not in seen or start == end:
            raise PageError("bad_arguments", f"{at} must join two different node ids")
        edges.append({"from": start, "to": end, **({"label": label} if (label := _text(edge.get("label"), f"{at}.label", EDGE_LABEL)) else {})})
    notes = [{"label": _text(note.get("label"), f"{where}.notes[{index}].label", NOTE_LABEL, required=True),
              "text": _text(note.get("text"), f"{where}.notes[{index}].text", NOTE_TEXT, required=True)}
             for index, note in enumerate(_list(section.get("notes"), f"{where}.notes", NOTES))]
    return {"nodes": nodes, "edges": edges, **({"notes": notes} if notes else {})}


def _plain(section, where, exists):
    return {"text": _text(section.get("text"), f"{where}.text", TEXT, required=True)}


def _number(value, where, *, gap=False, parts=False):
    """A plain number (never a boolean or text), or None where a line may have a gap."""
    if value is None and gap:
        return None
    if type(value) not in (int, float) or not math.isfinite(value) or abs(value) > VALUE_MAX:
        raise PageError("bad_arguments", f"{where} must be a number" + (" or null" if gap else ""))
    if parts and value < 0:
        raise PageError("bad_arguments", f"{where} is below zero; parts of a whole are zero or more")
    return value


def _stats(section, where, exists):
    """Figures as tiles: what it is, the value and its unit, its change, a few words and a little line of its recent values.
    A tile's own name is `name`: `label` is a status's word, as elsewhere in a report."""
    tiles = []
    for index, tile in enumerate(_list(section.get("tiles"), f"{where}.tiles", STATS, least=1)):
        at = f"{where}.tiles[{index}]"
        value = {"name": _text(tile.get("name"), f"{at}.name", STAT_LABEL, required=True),
                 "value": _text(tile.get("value"), f"{at}.value", STAT_VALUE, required=True)}
        for key, limit in (("unit", STAT_UNIT), ("delta", DELTA), ("note", STAT_NOTE)):
            if text := _text(tile.get(key), f"{at}.{key}", limit):
                value[key] = text
        if tile.get("trend") is not None:
            trend = tile["trend"]
            if not isinstance(trend, list) or not 2 <= len(trend) <= TREND:
                raise PageError("bad_arguments", f"{at}.trend must be 2 to {TREND} numbers")
            value["trend"] = [_number(point, f"{at}.trend[{n}]") for n, point in enumerate(trend)]
        tiles.append({**value, **_status(tile, at)})
    return {"tiles": tiles}


def _chart(section, where, exists):
    kind = section.get("type")
    if kind not in CHARTS:
        raise PageError("bad_arguments", f"{where}.type must be one of {', '.join(CHARTS)}")
    labels = section.get("labels")
    if not isinstance(labels, list) or not 1 <= len(labels) <= POINTS:
        raise PageError("bad_arguments", f"{where}.labels must be 1 to {POINTS} names, one for each value")
    labels = [_text(label, f"{where}.labels[{n}]", POINT, required=True) for n, label in enumerate(labels)]
    whole = kind in ("pie", "donut")
    series = _list(section.get("series"), f"{where}.series", 1 if whole else SERIES, least=1)
    kept = []
    for index, entry in enumerate(series):
        at = f"{where}.series[{index}]"
        values = entry.get("values")
        if not isinstance(values, list) or len(values) != len(labels):
            raise PageError("bad_arguments", f"{at}.values must have one number for each of the {len(labels)} labels")
        value = {"values": [_number(point, f"{at}.values[{n}]", gap=kind in ("line", "area"), parts=kind in PARTS)
                            for n, point in enumerate(values)]}
        # One series is named by the section's title; more need a name each, for the legend.
        if name := _text(entry.get("name"), f"{at}.name", SERIES_NAME, required=len(series) > 1):
            value["name"] = name
        if entry.get("member_id") is not None:
            value["member_id"] = _member(entry["member_id"], f"{at}.member_id", exists)
        kept.append(value)
    if whole and not any(kept[0]["values"]):
        raise PageError("bad_arguments", f"{where}.series[0].values add up to nothing; a {kind} needs a part above zero")
    if all(point is None for entry in kept for point in entry["values"]):
        raise PageError("bad_arguments", f"{where}.series has no values")
    extra = {key: text for key, limit in (("unit", UNIT), ("note", CHART_NOTE))
             if (text := _text(section.get(key), f"{where}.{key}", limit))}
    return {"type": kind, "labels": labels, "series": kept, **extra}


_CHECK = {"findings": _findings, "table": _table, "team": _team, "text": _plain, "stats": _stats, "chart": _chart}


def checked_report(value, *, exists, as_of_ms):
    """The report as it is kept: only known fields, trimmed, checked for size and secrets. `exists(member_id)` says
    whether a member id is real; `as_of_ms` is when the data was read, which the page states."""
    if not isinstance(value, dict):
        raise PageError("bad_arguments", "report must be an object with sections")
    sections = []
    for index, section in enumerate(_list(value.get("sections"), "report.sections", SECTIONS_MAX, least=1)):
        where = f"report.sections[{index}]"
        kind = section.get("kind")
        if kind not in KINDS:
            raise PageError("bad_arguments", f"{where}.kind must be one of {', '.join(KINDS)}")
        title = _text(section.get("title"), f"{where}.title", TITLE)
        span = section.get("span")
        if span is not None and span not in SPANS:
            raise PageError("bad_arguments", f"{where}.span must be {' or '.join(SPANS)}, or left out for the whole width")
        sections.append({"kind": kind, **({"title": title} if title else {}), **({"span": span} if span else {}),
                         **_CHECK[kind](section, where, exists)})
    # A time as text: thirteen digits of milliseconds pass the card-number check one time in ten, and the kept content is
    # scanned for secrets as a whole.
    as_of = datetime.fromtimestamp(as_of_ms / 1000, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {"as_of": as_of, "sections": sections}


def _who(node, names):
    if "member_id" in node:
        return names(node["member_id"]) or "?"
    return "Owner" if node.get("owner") else node.get("name", "")


def _figure(value):
    """A value as it is written: a whole number without a point."""
    return str(int(value)) if float(value).is_integer() else f"{value:g}"


def report_html(title, report, names):
    """A plain rendition of the same facts. `names(member_id)` gives a member's current name."""
    e = html_lib.escape
    status = lambda entry: f" [{e(entry.get('label') or entry['status'])}]" if entry.get("status") else ""
    parts = [f"<h1>{e(title)}</h1>"]
    for section in report["sections"]:
        if section.get("title"):
            parts.append(f"<h2>{e(section['title'])}</h2>")
        if section["kind"] == "findings":
            if section.get("callout"):
                parts.append(f"<p>{e(section['callout'])}</p>")
            parts.append("<ul>" + "".join(f"<li><b>{e(item['title'])}</b>{status(item)}" + (f" {e(item['text'])}" if item.get("text") else "")
                                          + "</li>" for item in section["items"]) + "</ul>")
        elif section["kind"] == "table":
            head = "".join(f"<th>{e(name)}</th>" for name in section["columns"])
            rows = "".join("<tr>" + "".join(f"<td>{e(cell)}</td>" for cell in row["cells"]) + f"<td>{status(row).strip()}</td></tr>"
                           for row in section["rows"])
            parts.append(f"<table><tr>{head}<th></th></tr>{rows}</table>")
        elif section["kind"] == "team":
            nodes = {node["id"]: node for node in section["nodes"]}
            parts.append("<ul>" + "".join(f"<li>{e(_who(node, names))}" + (f" ({e(node['note'])})" if node.get("note") else "") + "</li>"
                                          for node in section["nodes"]) + "</ul>")
            parts.append("<ul>" + "".join(f"<li>{e(_who(nodes[edge['from']], names))} → {e(_who(nodes[edge['to']], names))}"
                                          + (f": {e(edge['label'])}" if edge.get("label") else "") + "</li>" for edge in section["edges"]) + "</ul>")
            parts.extend(f"<p><b>{e(note['label'])}</b> {e(note['text'])}</p>" for note in section.get("notes", []))
        elif section["kind"] == "stats":
            parts.append("<ul>" + "".join(
                f"<li>{e(tile['name'])}: <b>{e(tile['value'])}{e(tile.get('unit', ''))}</b>"
                + "".join(f" {e(tile[key])}" for key in ("delta", "note") if tile.get(key)) + f"{status(tile)}</li>"
                for tile in section["tiles"]) + "</ul>")
        elif section["kind"] == "chart":
            # A chart's values as the table it was drawn from.
            names = [entry.get("name", section.get("title", "")) for entry in section["series"]]
            head = "<th></th>" + "".join(f"<th>{e(name)}</th>" for name in names)
            rows = "".join(f"<tr><td>{e(label)}</td>" + "".join(
                f"<td>{'' if entry['values'][n] is None else e(_figure(entry['values'][n]))}</td>" for entry in section["series"])
                + "</tr>" for n, label in enumerate(section["labels"]))
            unit = f"<p>{e(section['unit'])}</p>" if section.get("unit") else ""
            parts.append(f"{unit}<table><tr>{head}</tr>{rows}</table>" + (f"<p>{e(section['note'])}</p>" if section.get("note") else ""))
        else:
            parts.append("".join(f"<p>{e(line)}</p>" for line in section["text"].split("\n") if line.strip()))
    return "\n".join(parts)


def report_fallback(title, report):
    """At most 1500 characters the card can say when the page cannot be drawn: the title and the first findings."""
    lines = [title]
    for section in report["sections"]:
        if section["kind"] == "findings":
            lines.extend(filter(None, [section.get("callout")]))
            lines.extend(item["title"] for item in section["items"])
        elif section["kind"] == "stats":
            lines.append(" · ".join(f"{tile['name']} {tile['value']}{tile.get('unit', '')}" for tile in section["tiles"]))
    text = "\n".join(lines)
    return text if len(text) <= 1500 else text[:1499] + "…"


# ---------- the file a report is shared as ----------

# The owner shares a report as a file (2026-11-10, 存成檔案): the app's own drawing of the page and its style, as one HTML
# document any browser opens (app/src/main/report-page.ts `reportFile`). Nothing in it may run or load: its policy stands
# first in its head, and the rest is held to the elements and attributes that drawing makes, its links within the page.
FILE_BYTES = 2 * 1024 * 1024
FILE_POLICY = "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"
_FILE_HEAD = re.compile(
    r'<!doctype html><html lang="[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*"><head><meta charset="utf-8">'
    + re.escape(f'<meta http-equiv="Content-Security-Policy" content="{FILE_POLICY}">'
                '<meta name="viewport" content="width=device-width, initial-scale=1">'))
# The page's own elements, then the drawing's: the team's arrows and the app's line icons (icon-set.ts).
_FILE_TAGS = frozenset("html head title body article header h1 h2 p nav a span div section ul li b small "
                       "table thead tbody tr th td dl dt dd svg defs marker path circle ellipse line rect".split())
_FILE_ATTRIBUTES = frozenset("lang class id href style role aria-label aria-hidden scope width height viewbox preserveaspectratio d "
                             "marker-end refx refy markerwidth markerheight orient cx cy r rx ry x y x1 y1 x2 y2".split())
_VALUE = r"(?:\"[^\"]*\"|'[^']*'|[^\s\"'=<>`]+)"
_TAG = re.compile(rf"<(/?)([A-Za-z][A-Za-z0-9]*)((?:\s+[^\s\"'=<>/]+(?:\s*=\s*{_VALUE})?)*)\s*/?>")
_ATTRIBUTE = re.compile(rf"([^\s\"'=<>/]+)(?:\s*=\s*({_VALUE}))?")
# Names Windows keeps for its devices, with any extension.
_RESERVED = re.compile(r"(?i)(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\..*)?")


def checked_file(text):
    """The file as the app drew it, or why it is refused: its policy first, one style with no markup in it, then only
    the drawing's elements and attributes."""
    if not isinstance(text, str) or not text:
        raise PageError("bad_arguments", "html must be the report's file")
    if len(text.encode("utf-8")) > FILE_BYTES:
        raise PageError("too_large", f"the file exceeds {FILE_BYTES} UTF-8 bytes")
    head = _FILE_HEAD.match(text)
    if head is None:
        raise PageError("bad_arguments", "the file must begin with its policy")
    rest, styles = re.subn(r"<style>[^<]*</style>", "", text[head.end():])
    if styles != 1:
        raise PageError("bad_arguments", "the file holds one style, with no markup in it")
    end = 0
    for tag in _TAG.finditer(rest):
        if "<" in rest[end:tag.start()] or tag[2].lower() not in _FILE_TAGS:
            raise PageError("bad_arguments", "the file holds only the report's own drawing")
        for attribute in _ATTRIBUTE.finditer(tag[3]):
            name, value = attribute[1].lower(), (attribute[2] or "").strip("\"'")
            if name not in _FILE_ATTRIBUTES and not re.fullmatch(r"data-[a-z0-9-]+", name):
                raise PageError("bad_arguments", f"the file may not hold the attribute {name[:24]}")
            if name == "href" and not value.startswith("#"):
                raise PageError("bad_arguments", "a link in the file goes within the page")
        end = tag.end()
    if "<" in rest[end:]:
        raise PageError("bad_arguments", "the file holds only the report's own drawing")
    return text


def file_name(title):
    """The file's name: the page's title as Windows takes a name (no reserved character, no dot or space at its end, no
    device's name), or `report`."""
    name = " ".join(re.sub(r'[<>:"/\\|?*\x00-\x1f]', " ", title).split())[:80].rstrip(". ")
    if not name:
        return "report"
    return f"{name}_" if _RESERVED.fullmatch(name) else name


def save_file(text, name, folders):
    """Writes the file into the first of `folders` ((place, folder) pairs) that takes it, as `name.html` or, where a
    file has that name, `name (2).html` and on: never over another file. Returns the place and the path."""
    data = text.encode("utf-8")
    for place, folder in folders:
        try:
            folder.mkdir(parents=True, exist_ok=True)
            for number in range(1, 100):
                path = folder / (f"{name}.html" if number == 1 else f"{name} ({number}).html")
                try:
                    out = open(path, "xb")
                except FileExistsError:
                    continue
                try:
                    with out:
                        out.write(data)
                except OSError:
                    path.unlink(missing_ok=True)
                    raise
                return place, path
        except OSError:
            continue
    raise PageError("unwritable", "the file could not be written")

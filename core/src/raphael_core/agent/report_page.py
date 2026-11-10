"""A report page: a page whose content is structured, drawn by the app in its own design (app/src/main/report-page.ts).

A member gives `report` to show_page or update_page instead of HTML. It is checked here and kept as the page's tool_input,
so it is a page like any other: the same table, revisions, card in the turn and update path. The app draws it natively,
with every value escaped; no model-written markup or script runs. The page's `html` is a plain rendition of the same
facts, for the revision history and anything that reads a page as HTML.

The owner's request (2026-11-09, after Grok Bot's Page): a title, the date the data is as of and the promise that it only
states recorded facts, a table of contents, findings with coloured status words under a summary box, an overview table
with tabs, and a team diagram: members as boxes with their colour, labelled arrows between them, notes under it.
Shared, a report is a file of the app's own drawing (2026-11-10): see `checked_file` below.
"""

import html as html_lib
import re
from datetime import UTC, datetime

from .pages import PageError, checked_text

KINDS = ("findings", "table", "team", "text")
STATUSES = ("running", "done", "pending", "waiting", "blocked", "paused", "failed")
SECTIONS_MAX = 8
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


_CHECK = {"findings": _findings, "table": _table, "team": _team, "text": _plain}


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
        sections.append({"kind": kind, **({"title": title} if title else {}), **_CHECK[kind](section, where, exists)})
    # A time as text: thirteen digits of milliseconds pass the card-number check one time in ten, and the kept content is
    # scanned for secrets as a whole.
    as_of = datetime.fromtimestamp(as_of_ms / 1000, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {"as_of": as_of, "sections": sections}


def _who(node, names):
    if "member_id" in node:
        return names(node["member_id"]) or "?"
    return "Owner" if node.get("owner") else node.get("name", "")


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
_FILE_ATTRIBUTES = frozenset("lang class id href style role aria-label aria-hidden scope width height viewbox d "
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

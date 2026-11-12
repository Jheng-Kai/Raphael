"""Pure coordinate and window projections for one screen of a shared computer."""

from collections.abc import Mapping
from copy import deepcopy
import json
import re

from .vm import screen_grid


def rectangle(screen, screens):
    if type(screen) is not int or type(screens) is not int or not 1 <= screen <= screens <= 6:
        raise ValueError("Screens must be integers with 1 <= screen <= screens <= 6")
    return screen_grid(screens)[0][screen - 1]


def _bounds(bounds):
    if isinstance(bounds, Mapping):
        return tuple(bounds[key] for key in ("x", "y", "width", "height"))
    return tuple(bounds)


def holder(bounds, screens):
    rectangle(1, screens)
    x, y, width, height = _bounds(bounds)
    centre_x, centre_y = x + width / 2, y + height / 2
    for screen, (left, top, width, height) in enumerate(screen_grid(screens)[0], 1):
        if left <= centre_x < left + width and top <= centre_y < top + height:
            return screen
    return None


def to_canvas(screen, screens, x, y):
    left, top, _, _ = rectangle(screen, screens)
    return left + x, top + y


def to_seat(screen, screens, x, y):
    left, top, width, height = rectangle(screen, screens)
    if left <= x < left + width and top <= y < top + height:
        return x - left, y - top
    return None


def contains(bounds, screen, screens):
    x, y, width, height = _bounds(bounds)
    left, top, wide, high = rectangle(screen, screens)
    return width > 0 and height > 0 and left <= x and top <= y and x + width <= left + wide and y + height <= top + high


def overlaps(bounds, screen, screens):
    x, y, width, height = _bounds(bounds)
    left, top, wide, high = rectangle(screen, screens)
    return width > 0 and height > 0 and x < left + wide and left < x + width and y < top + high and top < y + height


def windows(result, screen, screens):
    left, top, _, _ = rectangle(screen, screens)
    canvas = (0, 0, *screen_grid(screens)[1])
    projected = deepcopy(result)
    projected["windows"] = []
    for window in result["windows"]:
        bounds = window["bounds"]
        if _bounds(bounds) == canvas or holder(bounds, screens) != screen:
            continue
        local = deepcopy(window)
        local["bounds"]["x"] -= left
        local["bounds"]["y"] -= top
        for key, offset in (("x", left), ("y", top)):
            if key in local:
                local[key] -= offset
        local["z_index"] = len(projected["windows"])
        projected["windows"].append(local)
    return projected


def windows_text(result):
    found = result["windows"]
    # The driver's empty wording has not been measured; use "Found 0 windows:".
    lines = [f"Found {len(found)} windows:"]
    for window in found:
        x, y, width, height = _bounds(window["bounds"])
        lines.append(f'  window_id={window["window_id"]} pid={window["pid"]} "{window["title"]}" '
                     f'{width}x{height}{x:+}{y:+} app={window["app_name"]}')
    return "\n".join(lines)


def mine(window_id, result, screen, screens):
    return any(window["window_id"] == window_id for window in windows(result, screen, screens)["windows"])


def canvas_windows(reply):
    """Read structured rows or the measured signed-geometry driver text, never guess ownership."""
    if reply.get("isError"):
        raise ValueError("Cannot read canvas windows")
    state = reply.get("structuredContent")
    if isinstance(state, dict) and isinstance(state.get("windows"), list):
        return state
    for block in reply.get("content", []):
        if block.get("type") != "text":
            continue
        text = block.get("text", "")
        try:
            state = json.loads(text)
        except ValueError:
            state = None
        if isinstance(state, dict) and isinstance(state.get("windows"), list):
            return state
        header = re.search(r"Found (\d+) windows:", text)
        if header:
            rows = []
            for match in re.finditer(r'window_id=(\d+) pid=(\d+) "([^\n]*)" (\d+)x(\d+)([+-]\d+)([+-]\d+) app=([^\n]+)', text):
                identifier, pid, title, width, height, x, y, app = match.groups()
                rows.append(dict(window_id=int(identifier), pid=int(pid), title=title, app_name=app,
                                 bounds=dict(zip(("x", "y", "width", "height"), map(int, (x, y, width, height))))))
            if len(rows) == int(header[1]):
                return {"windows": rows}
    raise ValueError("Unrecognized canvas window list")


def window_state(result, screen, screens):
    """Translate window placement only. Accessibility and screenshot nodes are window-local."""
    local = deepcopy(result)
    left, top, _, _ = rectangle(screen, screens)
    for record in (local, local.get("window"), local.get("window_info")):
        if not isinstance(record, dict):
            continue
        for key in ("bounds", "frame", "window_bounds"):
            bounds = record.get(key)
            if isinstance(bounds, dict) and {"x", "y"} <= bounds.keys():
                bounds["x"] -= left
                bounds["y"] -= top
        if "x" in record and "y" in record:
            record["x"] -= left
            record["y"] -= top
    for predicate in local.get("predicates", []):
        observed = predicate.get("observed_json")
        if isinstance(observed, str):
            try:
                value = json.loads(observed)
            except ValueError:
                continue
            if isinstance(value, dict):
                predicate["observed_json"] = json.dumps(window_state(value, screen, screens))
    return local


def projected_reply(reply, state, text=None):
    """Project structured placement, preserving the driver's tree and token prose unless explicitly rewritten."""
    result = deepcopy(reply)
    result["structuredContent"] = state
    if text is not None:
        result["content"] = [dict(type="text", text=text)]
        result["content"].extend(block for block in reply.get("content", []) if block.get("type") == "image")
    return result


def wmctrl_windows(geometry, classes):
    """Join the prototype's measured -lG and -lx shapes for disconnected-seat cleanup."""
    apps = {int(parts[0], 16): parts[2].split(".")[0] for line in classes.splitlines()
            if len(parts := line.split(None, 4)) >= 4}
    rows = []
    for line in geometry.splitlines():
        parts = line.split(None, 7)
        # id, desktop, x, y, width, height, host, then the title: a window with no title has seven parts.
        if len(parts) < 7:
            raise ValueError("Incomplete window geometry")
        identifier = int(parts[0], 16)
        # Keep unknown classes visible: they cannot prove a screen empty or be closed as a known non-panel.
        rows.append(dict(window_id=identifier, pid=0, app_name=apps.get(identifier, ""), title=parts[7] if len(parts) > 7 else "",
                         bounds=dict(zip(("x", "y", "width", "height"), map(int, parts[2:6])))))
    return {"windows": rows}

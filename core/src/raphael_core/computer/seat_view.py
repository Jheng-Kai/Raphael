"""Pure coordinate and window projections for one screen of a shared computer."""

from collections.abc import Mapping
from copy import deepcopy

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

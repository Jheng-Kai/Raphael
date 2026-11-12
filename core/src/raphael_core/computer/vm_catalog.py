"""Small, pinned desktop surface; unlisted and future driver tools stay unavailable.

Selection follows Cua's bundled get_guide topics and published tool descriptions:
https://cua.ai/docs/cua-driver/reference/mcp-tools
https://cua.ai/docs/cua-driver/reference/mcp-tools/pointer-cursor-and-browser
Browser tools support Linux CDP; this is a capability contract, not image smoke proof.
Raphael owns lifecycle/control and uses vm_exec/attach_file.
Each line below is all a model is told a tool is for (its parameters carry the driver's own words): the driver's
description is not offered, so a tool reads the same before and after the driver is asked.

Adapted from OpenMausBot (Apache-2.0); see core/packaging/licenses.
"""

DRIVER_TOOLS = {
    "get_guide": "Read the driver's bundled guidance for exact targeting and recovery.",
    "get_desktop_state": "Capture whole-screen pixels only when the entire display is needed.",
    "get_window_state": "Read one window with max_elements 200, query and no screenshot unless needed.",
    "get_cursor_position": "Read the pointer position for the next gesture.",
    "click": "Activate a visible desktop target.",
    "double_click": "Open desktop items that require a double click.",
    "right_click": "Open context menus.",
    "type_text": "Enter text in the focused field.",
    "press_key": "Use navigation and editing keys.",
    "hotkey": "Use application keyboard shortcuts.",
    "scroll": "Reach offscreen content.",
    "drag": "Perform one complete press-drag-release gesture.",
    "move_cursor": "Hover over a target without activating it.",
    "launch_app": "Open a sandbox application.",
    "list_apps": "Discover applications and process identifiers.",
    "list_windows": "Discover exact window identifiers and bounds.",
    "bring_to_front": "Focus the intended sandbox window.",
    "clipboard_read": "Read the sandbox clipboard.",
    "clipboard_write": "Prepare sandbox clipboard text for paste.",
    "verify_state": "Wait for bounded window predicates and verify an action's result.",
    "get_browser_state": "Bind a Linux Chromium CDP tab and read its current references.",
    "browser_prepare": "Prepare the owned Chromium endpoint required by typed browser tools.",
    "browser_navigate": "Navigate an exactly bound browser tab.",
    "browser_click": "Activate a current page reference or viewport target.",
    "browser_type": "Enter text through the bound tab's input domain.",
    "browser_select": "Select a native HTML option through a live page reference.",
    "browser_pointer": "Hover, scroll or drag within the bound tab.",
    "browser_dialog": "Inspect or resolve a page's JavaScript dialog.",
    "browser_set_input_files": "Upload an explicit guest file through a live file input.",
    "browser_download": "Save a bound browser download in an explicit guest directory.",
}

PAGE_TOOLS = ("browser_", "get_browser_state")
# What the driver calls a window of the computer's own browser: Google's Chrome where the image has it (amd64),
# Chromium elsewhere.
BROWSER_APPS = frozenset({"google-chrome", "chromium-browser"})

# Each call can move the physical pointer, focus or clipboard, including browser launch.
NATIVE_INPUT_TOOLS = frozenset({
    "click", "double_click", "right_click", "type_text", "press_key", "hotkey", "scroll", "drag",
    "move_cursor", "bring_to_front", "launch_app", "clipboard_write", "browser_prepare",
})

# Reviewed against the measured 0.37.0 tools/list. Unknown arguments fail closed in shared mode.
# Each parameter has exactly one disposition: pass, check, translate or refuse.
# Dotted paths classify nested properties; [] denotes an object in an array.
SHARED_ARGUMENTS = {
    "get_guide": {"pass": "session topic"},
    "get_desktop_state": {"check": "max_image_dimension session", "refuse": "screenshot_out_file"},
    "get_window_state": {"pass": "capture_mode display_only full_output include_accessibility_tree include_screenshot max_depth max_dimension max_elements max_image_dimension query session since timeout_ms tree_format verbose", "check": "pid window_id", "refuse": "screenshot_out_file"},
    "get_cursor_position": {"pass": "session"},
    "click": {"pass": "button count cursor_id delivery_mode element_token modifier session", "check": "coordinate_frame pid scope window_id x y", "refuse": "capture_id from_zoom target"},
    "double_click": {"pass": "cursor_id delivery_mode element_token session", "check": "coordinate_frame pid window_id x y", "refuse": "from_zoom"},
    "right_click": {"pass": "cursor_id delivery_mode element_token modifier session", "check": "coordinate_frame pid window_id x y", "refuse": "from_zoom"},
    "type_text": {"pass": "delivery_mode element_token session text", "check": "coordinate_frame pid scope window_id x y", "refuse": "target"},
    "press_key": {"pass": "delivery_mode element_token key modifiers session", "check": "coordinate_frame pid scope window_id x y", "refuse": "target"},
    "hotkey": {"pass": "delivery_mode element_token keys session", "check": "pid scope window_id x y", "refuse": "target"},
    "scroll": {"pass": "amount by cursor_id delivery_mode direction element_token session", "check": "coordinate_frame pid scope window_id x y", "refuse": "target"},
    "drag": {"pass": "button cursor_id delivery_mode duration_ms modifier session steps", "check": "coordinate_frame from_x from_y pid scope to_x to_y window_id", "refuse": "from_zoom target"},
    "move_cursor": {"pass": "cursor_id session", "check": "scope", "translate": "x y", "refuse": "target"},
    "launch_app": {"pass": "additional_arguments bundle_id launch_path name session urls"},
    "list_apps": {"pass": "session"},
    "list_windows": {"pass": "app on_screen_only session", "check": "pid"},
    "bring_to_front": {"pass": "session", "check": "pid window_id"},
    "clipboard_read": {"pass": "include_text session"},
    "clipboard_write": {"pass": "file_path image_path session text"},
    "verify_state": {"pass": "include_screenshot session stable_samples timeout_ms expect[].element expect[].element.enabled expect[].element.exists expect[].element.selected expect[].element.selector expect[].element.selector.label_contains expect[].element.selector.role expect[].element.value_equals expect[].window expect[].window.bounds expect[].window.bounds.height expect[].window.bounds.tolerance_px expect[].window.bounds.width expect[].window.exists", "check": "pid window_id", "translate": "expect expect[].window.bounds.x expect[].window.bounds.y"},
    "get_browser_state": {"pass": "continuation include_screenshot query scope_ref session snapshot_format tab_id", "check": "pid target_id window_id"},
    "browser_prepare": {"pass": "delivery_mode session", "check": "pid window_id", "translate": "allow_launch profile profile.mode profile.name strategy strategy.kind"},
    "browser_navigate": {"pass": "session tab_id url", "check": "target_id"},
    "browser_click": {"pass": "delivery_mode input_route ref session tab_id x y", "check": "target_id"},
    "browser_type": {"pass": "mode ref replace session tab_id text", "check": "target_id"},
    "browser_select": {"pass": "label ref session tab_id value", "check": "target_id"},
    "browser_pointer": {"pass": "action delivery_mode delta_x delta_y destination_ref input_route ref session tab_id to_x to_y x y", "check": "target_id"},
    "browser_dialog": {"pass": "action delivery_mode dialog_id prompt_text session tab_id", "check": "target_id"},
    "browser_set_input_files": {"pass": "files ref session tab_id", "check": "target_id"},
    "browser_download": {"pass": "destination_root ref session tab_id", "check": "target_id"},
}
SHARED_ARGUMENTS = {tool: {parameter: action for action, parameters in groups.items()
                          for parameter in parameters.split()} for tool, groups in SHARED_ARGUMENTS.items()}
for _policy in SHARED_ARGUMENTS.values():
    if _policy.get("target") == "refuse":
        _policy.update({"target." + parameter: "refuse" for parameter in ("display_id", "kind", "pid", "window_id")})


def shared_argument_paths(arguments, prefix=""):
    for key, value in arguments.items():
        path = prefix + key
        yield path
        if isinstance(value, dict):
            yield from shared_argument_paths(value, path + ".")
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    yield from shared_argument_paths(item, path + "[].")


def shared_native_input(name, arguments):
    """Foreground posture always takes the unit lock, including explicit DOM routes and dialog inspect.

    Background page routes (trusted or DOM), dialog inspect/resolve and CDP typing do not activate X focus.
    Native tools retain their lock regardless of delivery mode; prepare can launch/move a window.
    """
    return name in NATIVE_INPUT_TOOLS or arguments.get("delivery_mode") == "foreground"

# Answers that report how things stand and are not a tool failing: a model told one decides what to do, and
# nothing it did is evidence of work.
NOTICES = ("computer_busy", "screen_changed")

# Everything else is excluded: updates/installs/configuration, recording/replay,
# escalation, lifecycle, cosmetic cursor settings and redundant primitives. In
# particular page/run_script are never forwarded. Raphael's run_steps composite
# recursively uses the ordinary gate instead of forwarding the driver's batch tool.
READS = frozenset({
    "get_guide", "get_desktop_state", "get_window_state", "get_cursor_position",
    "list_apps", "list_windows", "clipboard_read", "verify_state", "get_browser_state",
})

SCREEN_READS = frozenset({"get_desktop_state", "get_window_state", "get_browser_state", "list_windows"})
FRESH_READS = frozenset({"get_desktop_state", "get_window_state", "get_browser_state", "browser_open"})


def definition(name, schema, original=None):
    """What a member is offered of one tool a driver lists: Raphael's own line on what it is for, the parameters a
    model reads and the ones a call is checked against. The list kept with the code and the list a running driver
    gives are both read here, so for the same driver the two are the same offer."""
    return {"description": DRIVER_TOOLS[name], "parameters": without_session(schema),
            "validation": without_session(schema if original is None else original)}


def offline_catalog():
    """The offer before any driver has been asked: the pinned driver's own list (driver_schemas.json), put through
    the bridge's reading as a running driver's list is. A member's tool list is read once by a CLI brain and cached
    by a provider, so the first use of the computer must not change it: a list that differed from the driver's
    started the turn again and lost that first call's result."""
    import json
    from pathlib import Path
    from .vm_bridge import normalize_schema  # the bridge imports this module
    listed = json.loads(Path(__file__).with_name("driver_schemas.json").read_text(encoding="utf-8"))["tools"]
    return {name: definition(name, normalize_schema(listed[name]), listed[name]) for name in DRIVER_TOOLS}


def without_session(schema):
    """Driver sessions belong to Raphael; a model cannot select an ended session."""
    if not isinstance(schema, dict):
        return schema
    result = {}
    for key, value in schema.items():
        if key == "properties":
            result[key] = {name: item for name, item in value.items() if name != "session"}
        elif key == "required":
            result[key] = [name for name in value if name != "session"]
        elif key in ("allOf", "anyOf", "oneOf"):
            result[key] = [without_session(branch) for branch in value]
        else:
            result[key] = value
    return result

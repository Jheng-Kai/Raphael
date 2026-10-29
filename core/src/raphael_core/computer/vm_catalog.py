"""Small, pinned desktop surface; unlisted and future driver tools stay unavailable.

Selection follows Cua's bundled get_guide topics and published tool descriptions:
https://cua.ai/docs/cua-driver/reference/mcp-tools
https://cua.ai/docs/cua-driver/reference/mcp-tools/pointer-cursor-and-browser
Browser tools support Linux CDP; this is a capability contract, not image smoke proof.
Raphael owns lifecycle/control and uses vm_exec/attach_file, as in OpenMausBot's
server/drivers/agents-catalog.ts and server/mcp-bridge.ts.
"""

DRIVER_TOOLS = {
    "get_guide": "Read the driver's bundled guidance for exact targeting and recovery.",
    "get_desktop_state": "Capture the full sandbox display before acting.",
    "get_window_state": "Read one window's screenshot and accessibility state.",
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

# Everything else is excluded: updates/installs/configuration, recording/replay,
# escalation, lifecycle, cosmetic cursor settings and redundant primitives. In
# particular page/run_script/run_steps never bypass the single vm_exec path.
READS = frozenset({
    "get_guide", "get_desktop_state", "get_window_state", "get_cursor_position",
    "list_apps", "list_windows", "clipboard_read", "verify_state", "get_browser_state",
})

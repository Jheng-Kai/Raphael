"""Completion evidence for the shared API/worker and CLI loops; no screen data retained."""

import json
import re

NOTE = ("Before finishing computer work, check the result with verify_state and an expectation, "
        "or read the intended get_window_state/get_browser_state. Do not claim success without that check.")
READS = {"get_window_state", "get_browser_state", "get_desktop_state", "verify_state"}
CHANGES = {"click", "double_click", "right_click", "type_text", "press_key", "hotkey", "scroll", "drag",
           "launch_app", "bring_to_front", "clipboard_write", "browser_open", "browser_navigate", "browser_click",
           "browser_type", "browser_select", "browser_pointer", "browser_dialog", "browser_set_input_files", "fill_login", "fill_contact", "fill_card"}


class ComputerVerification:
    def __init__(self):
        self.required = False
        self.nudged = False

    def restore(self, messages):
        calls = {}
        for message in messages:
            for call in message.get('tool_calls') or []:
                function = call.get('function', {})
                try:
                    args = json.loads(function.get('arguments', '{}'))
                except (ValueError, TypeError):
                    args = {}
                if not isinstance(args, dict):
                    args = {}
                calls[call.get('id')] = (function.get('name', ''), args)
            if message.get('role') == 'tool' and message.get('tool_call_id') in calls:
                name, args = calls[message['tool_call_id']]
                content = str(message.get('content', ''))
                header = content.split('\n', 1)[0]
                self.after(name, args, header.startswith('<tool_result ') and ' status="ok"' in header)

    def after(self, name, arguments, ok, kind=None):
        if not re.search(r"(?:computer[^/:]*[/_:]|computer__)", name):
            return
        verb = re.split(r"/|__", name)[-1]
        if verb == "run_steps":
            # A failed batch may have changed the screen before stopping.
            self.required = not ok
        elif ok and kind not in ("computer_busy", "screen_changed"):
            if verb in CHANGES:
                self.required = True
            elif verb in READS and (verb != 'verify_state' or arguments.get('predicates')):
                self.required = False

    def finishing(self):
        if not self.required:
            return None
        if self.nudged:
            return "stop"
        self.nudged = True
        return NOTE

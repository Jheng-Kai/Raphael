"""The host computer's tool catalog and dispatch. Docker keeps its own catalog."""

import asyncio
import json
from collections import Counter
from pathlib import Path

from jsonschema import Draft202012Validator

from ..agent.data_floor import DataFloor, WRITE_REFUSAL
from ..agent.plugins import PluginResult, PluginTool, tool_key
from ..agent.policy import Tier
from . import host_page
from .browser_tabs import BROWSER_TABS
from .file_tools import Refused, _refusal
from .host_browser import BrowserError, HostBrowser
from .owner_files import OwnerFiles, OwnerFileTools, READS, WRITES, DEFINITIONS, kept_place, place
from .takeover import REASONS, TAKEOVER, TAKEOVER_REASON_REQUIRED, takeover_detail
from .vm import VmError
from .vm_catalog import offline_catalog


BROWSER_TOOLS = {
    "get_browser_state": "Read the shown tab or a tab from browser_tabs. Request include_screenshot for viewport pixels.",
    "browser_navigate": "Navigate the shown or named tab to an HTTP or HTTPS page.",
    "browser_click": "Click a stable ref or use x,y from a screenshot when the page keeps changing. Verify the result.",
    "browser_type": "Fill a field by its current ref. Never type passwords, verification codes, keys or payment details.",
    "browser_select": "Choose an option in an HTML select by its current ref.",
}
VIEWPORT_TOOLS = {
    "get_desktop_state": ("Capture the shown tab's 1280 × 900 page as a screenshot.", "", ""),
    "click": ("Click at x,y from the shown tab's screenshot.", "x y button count modifier", "x y"),
    "double_click": ("Double-click at x,y from the shown tab's screenshot.", "x y", "x y"),
    "type_text": ("Type into the page's focused field. Leave credentials, codes and payment to the owner.", "text", "text"),
    "press_key": ("Press a page key, optionally with modifiers.", "key modifiers", "key"),
    "scroll": ("Scroll the page at x,y from the screenshot.", "x y direction amount by", "x y direction"),
}
PAGE_ACTIONS = {"browser_click", "browser_type", "browser_select"}
INPUT_ACTIONS = (VIEWPORT_TOOLS.keys() - {"get_desktop_state"}) | PAGE_ACTIONS
HOST_TAKEOVER = {**TAKEOVER["parameters"], "properties": {
    **TAKEOVER["parameters"]["properties"],
    "reason": {"type": "string", "enum": [*REASONS, "certificate"]},
    "target_id": {"type": "string"}, "tab_id": {"type": "string"},
}}
HOST_CONTRACT = ("Raphael Chrome runs on this computer in the background. Its shared profile keeps members' sign-ins, "
                 "separately from Docker. It can browse and use work files. ")
WORDS = {
    "chrome_missing": "Raphael Chrome is unavailable because Google Chrome is not installed.",
    "chrome_start_failed": "Raphael Chrome could not start.",
    "chrome_profile": "Raphael Chrome could not open its shared profile.",
    "chrome_disconnected": "Raphael Chrome disconnected. Open the page again if the request still needs it.",
    "chrome_command_failed": "Chrome rejected the browser command. Read the tab again before retrying.",
    "browser_url": "Chrome can only open a valid HTTP or HTTPS page, except its own control address.",
    "browser_navigation_failed": "Chrome could not load the requested page.",
    "browser_tab_required": "Use browser_tabs for your current tabs, or open one if the list is empty.",
    "browser_tab_changed": "The Chrome tab closed or changed. Use browser_tabs to find a live tab.",
    "browser_tab_busy": "Another turn or task is using this tab. Try it again shortly or use another tab from browser_tabs.",
    "browser_page_changed": "The page changed after the last read. Read it again for current controls.",
    "browser_action_refused": "Chrome could not perform this action on the selected page element.",
    "browser_field_refused": "Chrome could not type into or select a value in that field.",
    "owner_holds_control": "The owner has control of this Chrome tab. Wait for them to finish.",
    "bad_path": "The requested work file path is invalid.",
    "browser_navigation_waiting": "Chrome is still waiting for this page. If a native certificate or key prompt is blocking it, use request_takeover with reason: certificate.",
    "browser_owner_approval_required": "The owner must approve the exact outward action before it can run.",
    "browser_handback_stopped": "The owner stopped the handback. End this task without retrying the action.",
    "browser_handback_expired": "The owner did not return this tab in time. End this task without retrying the action.",
    "private_conversation_required": "Ask the owner to continue in the private conversation at this computer to take over the tab.",
    "browser_current_ref_required": "Read the tab again for current references or use screenshot coordinates for a click.",
    "browser_dom_input_required": "Use screenshot coordinates for native page input or omit input_route for a ref click.",
    "browser_coordinates": "Use x and y inside the current 1280 × 900 tab screenshot.",
    "browser_background_only": "The owner can watch this tab in the app's Computer panel.",
    "host_tool_unavailable": "This tool requires the isolated Docker computer. Use the browser or work folder on this computer.",
}


class HostComputerTools:
    def __init__(self, vm, conn, open_definition):
        self.vm = vm
        self.browser = HostBrowser(vm.machine / "browser")
        self.cards = None
        self.catalog, self.routes = {}, {}
        self.active = Counter()
        self.files = OwnerFileTools(vm.settings, DataFloor(conn))
        definitions = offline_catalog()
        tab_id = {"type": "string", "description": "Tab ID from browser_tabs. Omit to use the shown tab."}
        self.definitions = {}
        for name, description in BROWSER_TOOLS.items():
            definition = definitions[name]
            self.definitions[name] = {"description": description, **{
                key: {**definition[key],
                      "properties": {arg: tab_id if arg in {"target_id", "tab_id"} else prop
                                     for arg, prop in definition[key]["properties"].items()},
                      "required": [arg for arg in definition[key].get("required", []) if arg not in {"target_id", "tab_id"}]}
                for key in ("parameters", "validation")
            }}
        for name, (description, fields, required) in VIEWPORT_TOOLS.items():
            source = definitions[name]["parameters"]["properties"]
            properties = {field: {**source[field]} for field in fields.split()}
            for field in properties.keys() & {"x", "y"}:
                properties[field]["description"] = f"{field.upper()} in the 1280 × 900 Chrome page screenshot."
            self.definitions[name] = {"description": description, "parameters": {
                "type": "object", "properties": {**properties, "tab_id": tab_id}, "required": required.split(),
                "additionalProperties": False,
            }}
        self.definitions.update({
            "browser_open": {**open_definition, "description": "Open an HTTP or HTTPS URL in your own background Chrome tab. "
                             "The owner sees it in the app's Computer panel. When asked to show a page, open it and say where to look. "
                             "Check browser_tabs first. Use new_tab to keep the current page. " + HOST_CONTRACT},
            "browser_tabs": {"description": "List your Chrome tabs across turns and tasks, including tabs the owner opened "
                             "and popups. Check before opening a duplicate. The shown tab is the default. Pass show or close "
                             "with a listed tab_id to select or close it.", "parameters": {
                                 **BROWSER_TABS["parameters"], "properties": {
                                     **BROWSER_TABS["parameters"]["properties"],
                                     "close": {**BROWSER_TABS["parameters"]["properties"]["show"]},
                                 }, "not": {"required": ["show", "close"]},
                             }},
            "request_takeover": {"parameters": HOST_TAKEOVER, "description": TAKEOVER["description"] + " Use certificate for a certificate prompt."},
            **{name: {**DEFINITIONS[name], "description": DEFINITION_WORDS[name]} for name in READS | WRITES},
        })

    def offered(self, member):
        keyspace = f"computer-host-{member}"
        if member not in self.catalog:
            tools = []
            for name, definition in self.definitions.items():
                key = tool_key(keyspace, name)
                tool = PluginTool(key, "computer", name, "Raphael Chrome. " + definition["description"], definition["parameters"],
                                  self.base_tier(name), pinned=True, whole=True, alias_group="computer_chrome")
                self.routes[key] = (member, tool)
                tools.append(tool)
            self.catalog[member] = tools
        return self.catalog[member]

    @staticmethod
    def base_tier(name):
        return Tier.T2 if name in WRITES or name in INPUT_ACTIONS else Tier.T0

    def local_target(self, member):
        return (self.vm.shared_target("", member, 0) if self.vm.mode == "shared" and not self.vm.remote
                else self.vm.target_for("", self.vm.key_for("", member)))

    def folders(self, member):
        target = self.local_target(member)
        return self.vm.member_workspace(target), target.shared

    def finish_work(self, *, turn_id=None, task_id=None):
        for tab in self.browser.tabs.values():
            if tab.work is None:
                continue
            scope, turn = tab.work
            if (task_id is not None and scope == ("task", task_id)
                    or turn_id is not None and scope[0] == "turn" and turn == turn_id):
                tab.finished = True

    async def aclose(self):
        await self.browser.aclose()

    def path(self, member, raw):
        workspace, team = self.folders(member)
        raw = raw.replace("\\", "/").strip()
        if not raw or "\x00" in raw:
            raise VmError("bad_path")
        guest_workspace = self.vm.guest_workspace(self.local_target(member))
        for alias, folder in ((guest_workspace, workspace), ("/home/cua/workspace", workspace),
                              ("/home/cua/team", team), ("team:", team)):
            if raw == alias or raw.startswith(alias + "/"):
                return (folder / raw[len(alias):].lstrip("/")).resolve()
        path = Path(raw)
        return (workspace / path).resolve() if not path.is_absolute() and not raw.startswith("~") else Path(place(raw))

    def inside_work(self, path, member):
        return any(path.is_relative_to(folder) and folder.resolve() == folder for folder in self.folders(member))

    def private_path(self, path, member):
        if path.is_relative_to(self.browser.profile.resolve()):
            return True
        for root in self.folders(member):
            if path.is_relative_to(root) and any(part.casefold().startswith((".browser-profiles", ".raphael-"))
                                                 for part in path.relative_to(root).parts):
                return True
        return False

    def work_file(self, key, arguments):
        route = self.routes.get(key)
        if route is None or route[1].name not in READS | WRITES:
            return False
        member, tool = route
        if any(field not in tool.schema.get("properties", {}) for field in arguments):
            return False
        try:
            path = self.path(member, arguments.get("path", "."))
            return self.inside_work(path, member) and not self.private_path(path, member)
        except (VmError, OSError, AttributeError, ValueError):
            return False

    def tier_for_call(self, key, arguments):
        member, tool = self.routes[key]
        if tool.name == "browser_tabs" and "close" in arguments:
            return Tier.T2
        if tool.name in WRITES:
            try:
                path = self.path(member, arguments.get("path", ""))
                if self.inside_work(path, member) or self.files.writable({"path": str(path)}, member):
                    return Tier.T0
            except (VmError, OSError, AttributeError, ValueError):
                pass
        return tool.tier

    async def file_call(self, member, name, arguments, approver, scope):
        await self.vm.settled()
        path = self.path(member, arguments.get("path", "."))
        args = {**arguments, "path": str(path)}
        inside = self.inside_work(path, member)
        # The mounted folder's own Chrome data, recovery files and guest internals remain private.
        if self.private_path(path, member) or not inside and self.files.guard()(str(path)):
            return PluginResult(False, "protected_data", WRITE_REFUSAL)
        if kept_place(str(path)):
            return PluginResult(False, "kept", "This private system folder is unavailable.")
        if name in WRITES and (approver == "none" or
                not inside and not self.files.writable(args, member) and approver != "user"):
            return PluginResult(False, "approval_required", "This write requires the owner's approval.")
        if name in ("glob", "grep"):
            from .owner_files import glob_files, grep_files
            guard = self.files.guard()
            def protected(item):
                return self.private_path(Path(item), member) or (not inside or not self.inside_work(Path(item), member)) and guard(item)
            return await asyncio.to_thread(glob_files if name == "glob" else grep_files, args, protected)
        if inside and name in WRITES:
            path.parent.mkdir(parents=True, exist_ok=True)
        files = OwnerFiles(self.files.reads, scope)
        return await getattr(files, name)(args)

    async def call(self, key, arguments, *, member, scope, turn_id, conversation_id, private, approver, language, announce):
        owner, tool = self.routes[key]
        if owner != member or scope is None:
            return PluginResult(False, "computer_changed")
        name = tool.name
        schema = self.definitions[name].get("validation", tool.schema)
        if not Draft202012Validator(schema).is_valid(arguments) or set(arguments) - set(schema.get("properties", {})):
            if name == "request_takeover" and not arguments.get("reason"):
                return PluginResult(False, "takeover_reason_required", TAKEOVER_REASON_REQUIRED)
            return PluginResult(False, "bad_arguments")
        if name == "request_takeover" and takeover_detail(arguments) is None:
            return PluginResult(False, "takeover_reason_required", TAKEOVER_REASON_REQUIRED)
        if approver == "none":
            return PluginResult(False, "approval_required")
        self.active[member] += 1
        try:
            if name in READS | WRITES:
                return await self.file_call(member, name, arguments, approver, scope)
            work = (scope, turn_id)
            browser = self.browser
            can_hand_back = private and turn_id and conversation_id is not None and self.cards is not None
            data, blocks, tab, reason = await self.browser_call(
                name, arguments, approver, member, work, conversation_id, announce, can_hand_back=can_hand_back)
            if reason:
                try:
                    detail = data.get("detail", "")
                    await self.cards.wait_for_browser(turn_id=turn_id, member_id=member, conversation_id=conversation_id,
                                                      language=language, reason=reason, tab=tab, detail=detail, browser=browser)
                    await browser.wait_popups(member)
                    returned = browser.handback_tab(tab)
                    if returned is None:
                        raise BrowserError("browser_tab_changed")
                    async with browser.action_lock(returned):
                        data, blocks = await host_page.snapshot(browser, returned, {})
                finally:
                    if browser.handback.get(member) is tab:
                        browser.handback.pop(member)
                if data.get("owner_needed"):
                    data["status"] = "owner_step_still_needed"
                else:
                    data["status"] = "owner_finished"
            return PluginResult(True, text=json.dumps(data, ensure_ascii=False), blocks=blocks)
        except (BrowserError, VmError) as error:
            code = str(error)
            return PluginResult(False, code, WORDS.get(code, f"Raphael Chrome could not run {name} ({code})."))
        except (OSError, RuntimeError, KeyError, TimeoutError):
            place_name = "the work folder" if name in READS | WRITES else "the Chrome tab"
            return PluginResult(False, "host_computer_unavailable", f"Could not complete {name} in {place_name}.")
        except Refused as error:
            return _refusal(error)
        finally:
            self.active[member] -= 1
            if not self.active[member]:
                del self.active[member]

    async def browser_call(self, name, arguments, approver, member, work, conversation, announce, *, can_hand_back=False):
        browser = self.browser
        if name != "browser_open":
            await browser.restart_if_disconnected()
        if not (arguments.get("target_id") or arguments.get("tab_id")):
            await browser.wait_popups(member)
        if name == "browser_tabs":
            if identifier := arguments.get("show") or arguments.get("close"):
                tab = browser.tab(member, identifier)
                async with browser.action_lock(tab):
                    if browser.member_blocked(tab):
                        raise BrowserError("owner_holds_control")
                    if "close" in arguments:
                        await browser.close_tab(tab)
                    else:
                        current = browser.selected(member)
                        if current is not None and browser.member_blocked(current):
                            raise BrowserError("owner_holds_control")
                        browser.select(tab)
            current = browser.selected(member)
            tabs = [{"tab_id": tab.id, "title": tab.title, "url": tab.url, "shown": tab is current}
                    for tab in browser.member_tabs(member) if browser.live(tab)]
            return {"tabs": tabs}, [], None, None
        scope, turn_id = work
        if name == "browser_open":
            if scope[0] == "turn" and not turn_id:
                raise BrowserError("private_conversation_required")
            await self.vm.settled()
            tab, _ = await browser.open_tab(member, self.folders(member)[0], conversation,
                                            new=bool(arguments.get("new_tab")))
        else:
            tab = browser.tab(member, arguments.get("target_id"), arguments.get("tab_id"))
        async with browser.action_lock(tab):
            if browser.member_blocked(tab):
                raise BrowserError("owner_holds_control")
            if name == "browser_open" and tab.work != work and announce:
                announce()
            tab.work, tab.turn_id, tab.conversation, tab.finished = work, turn_id, conversation, False
            data, blocks = await self.page_call(browser, tab, name, arguments, approver)
            # Reading a private page describes the owner step without asking for control.
            reason = data.get("owner_needed") if name in INPUT_ACTIONS | {"request_takeover"} else None
            if reason:
                if not can_hand_back:
                    raise BrowserError("private_conversation_required")
                if member in browser.handback or member in browser.held:
                    raise BrowserError("owner_holds_control")
                browser.handback[member] = tab
                browser.select(tab)
        return data, blocks, tab, reason

    @staticmethod
    async def page_call(browser, tab, name, arguments, approver):
        if name == "request_takeover":
            return {"owner_needed": arguments["reason"], "detail": takeover_detail(arguments)}, []
        if name in ("browser_open", "browser_navigate"):
            try:
                navigated = await host_page.navigate(browser, tab, arguments["url"])
            except BrowserError as error:
                if str(error) != "browser_certificate_needed":
                    raise
                return {"target_id": tab.id, "tab_id": tab.id, "owner_needed": "certificate"}, []
            if not navigated:
                return {"status": "download_started", "target_id": tab.id, "tab_id": tab.id}, []
        if name == "browser_click" and ("x" in arguments or "y" in arguments):
            return await host_page.viewport_action(browser, tab, "click", arguments, approver), []
        if name in PAGE_ACTIONS:
            return await host_page.act(browser, tab, name, arguments, approver)
        if name == "get_desktop_state":
            return await host_page.screenshot(browser, tab)
        if name in VIEWPORT_TOOLS:
            return await host_page.viewport_action(browser, tab, name, arguments, approver), []
        data, blocks = await host_page.snapshot(browser, tab, arguments)
        data["view"] = "The owner can see this page in the app's Computer panel."
        return data, blocks


DEFINITION_WORDS = {
    "read_file": "Read a file. Relative paths start in your work folder; team:/ selects the team folder. Read before overwriting.",
    "write_file": "Write a file in your work folder, team folder or an owner-selected project. Other writes require approval.",
    "edit_file": "Edit a file you read in this turn. Relative paths start in your work folder; team:/ selects the team folder.",
    "glob": "List files under a folder by glob pattern. The default is your work folder; team:/ selects the team folder.",
    "grep": "Search files by regular expression. The default is your work folder; team:/ selects the team folder.",
}

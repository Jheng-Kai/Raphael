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
from .takeover import REASONS, TAKEOVER
from .vm import VmError
from .vm_catalog import offline_catalog


BROWSER_TOOLS = {
    "get_browser_state": "Read the current tab's text and accessibility references, optionally with a viewport screenshot.",
    "browser_navigate": "Navigate the exact owned tab to an HTTP or HTTPS page.",
    "browser_click": "Click a current accessibility reference in the background. Use a DOM event; native and coordinate input are unavailable.",
    "browser_type": "Fill a current text field in the background. Never type passwords, verification codes, keys or payment details.",
    "browser_select": "Choose an option in a native HTML select using its current accessibility reference.",
}
HOST_TAKEOVER = {**TAKEOVER["parameters"], "properties": {
    "reason": {"type": "string", "enum": [*REASONS, "certificate"]},
    "target_id": {"type": "string"}, "tab_id": {"type": "string"},
}}
HANDOFF = "In a private chat, request_takeover brings this tab forward for sign-in, certificates, verification codes or CAPTCHAs."
WORDS = {
    "chrome_missing": "Google Chrome is missing. Hand this to Raphael to help the owner install Chrome. No other profile was opened.",
    "browser_navigation_waiting": "Chrome is still waiting for this page. If a native certificate or key prompt is blocking it, use request_takeover with reason: certificate.",
    "browser_owner_approval_required": "The owner must approve the exact outward action before it can run.",
    "browser_handback_stopped": "The owner stopped the handback. End this task without retrying the action.",
    "browser_handback_expired": "The owner did not return this tab in time. End this task without retrying the action.",
    "private_conversation_required": "Ask the owner to continue in the private conversation at this computer to take over the tab.",
    "browser_current_ref_required": "Read the current tab and use a current accessibility reference. Coordinates are unavailable in this mode.",
    "browser_dom_input_required": "Chrome requires DOM input to keep this tab in the background. Use input_route: dom_event.",
    "browser_background_only": "The browser tool can only operate the tab in the background. Use request_takeover if the owner needs to see it.",
    "host_tool_unavailable": "This tool requires the isolated Docker computer. Use the browser or work folder on this computer.",
}


class HostComputerTools:
    def __init__(self, vm, conn, open_definition):
        self.vm = vm
        self.browser = HostBrowser(vm.machine / "browser")
        self.cards = None
        self.catalog, self.routes = {}, {}
        self.active = Counter()
        self.cleanup = set()
        self.files = OwnerFileTools(vm.settings, DataFloor(conn))
        definitions = offline_catalog()
        self.definitions = {
            name: {**definitions[name], "description": f"{description} {HANDOFF}"}
            for name, description in BROWSER_TOOLS.items()
        }
        self.definitions.update({
            "browser_open": {**open_definition, "description": "Open an HTTP or HTTPS URL in your own background Chrome tab. "
                             "Use new_tab to keep the current page. " + HANDOFF},
            "browser_tabs": {**BROWSER_TABS, "description": "List only your current work's Chrome tabs. The show option is "
                             "reserved for owner takeover; tabs otherwise stay in the background."},
            "request_takeover": {"parameters": HOST_TAKEOVER, "description": HANDOFF + " Wait for the owner to finish, then inspect the same tab again."},
            **{name: {**DEFINITIONS[name], "description": DEFINITION_WORDS[name]} for name in READS | WRITES},
        })

    def offered(self, member):
        keyspace = f"computer-host-{member}"
        if member not in self.catalog:
            tools = []
            for name, definition in self.definitions.items():
                key = tool_key(keyspace, name)
                tool = PluginTool(key, "computer", name, definition["description"], definition["parameters"],
                                  self.base_tier(name), pinned=True, whole=True)
                self.routes[key] = (member, tool)
                tools.append(tool)
            self.catalog[member] = tools
        return self.catalog[member]

    @staticmethod
    def base_tier(name):
        return Tier.T2 if name in WRITES or name in ("browser_click", "browser_type", "browser_select") else Tier.T0

    def folders(self, member):
        target = self.vm.target_for("", "shared" if self.vm.mode == "shared" and not self.vm.remote else self.vm.key_for("", member))
        return target.workspace, target.shared

    def download_folder(self, member):
        workspace, _ = self.folders(member)
        return workspace / "downloads" / self.vm.key_for("", member) if workspace.name == "shared" else workspace

    def close_turn(self, turn_id):
        for work in set(self.browser.owned_targets.values()):
            if len(work) != 2 or not isinstance(work[0], tuple) or work[1] != turn_id:
                continue
            task = asyncio.create_task(self.browser.close_scope(work))
            self.cleanup.add(task)
            task.add_done_callback(self.cleanup.discard)

    async def aclose(self):
        await asyncio.gather(*self.cleanup, return_exceptions=True)
        await self.browser.aclose()

    def path(self, member, raw):
        workspace, team = self.folders(member)
        raw = raw.replace("\\", "/").strip()
        if not raw or "\x00" in raw:
            raise VmError("bad_path")
        for alias, folder in (("/home/cua/workspace", workspace), ("/home/cua/team", team), ("team:", team)):
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
            return PluginResult(False, "bad_arguments")
        if approver == "none":
            return PluginResult(False, "approval_required")
        self.active[member] += 1
        try:
            if name in READS | WRITES:
                return await self.file_call(member, name, arguments, approver, scope)
            work = (scope, turn_id) if scope[0] == "turn" else scope
            browser = self.browser
            can_hand_back = private and turn_id and conversation_id is not None and self.cards is not None
            async with browser.lock:
                data, blocks, tab = await self.browser_call(name, arguments, approver, member, work, announce)
                if data.get("owner_needed") and can_hand_back:
                    tab.handoff = True
            if reason := data.get("owner_needed"):
                if not can_hand_back:
                    raise BrowserError("private_conversation_required")
                try:
                    await self.cards.wait_for_browser(turn_id=turn_id, member_id=member, conversation_id=conversation_id,
                                                      language=language, reason=reason, focus=lambda: browser.focus(tab))
                finally:
                    tab.handoff = False
                async with browser.lock:
                    data, blocks = await host_page.snapshot(browser, tab, {})
                if data.get("owner_needed"):
                    data["status"] = "owner_step_still_needed"
                else:
                    data["status"] = "owner_finished"
            return PluginResult(True, text=json.dumps(data, ensure_ascii=False), blocks=blocks)
        except (BrowserError, VmError) as error:
            code = str(error)
            return PluginResult(False, code, WORDS.get(code, "This operation could not be completed in this Chrome tab or work folder."))
        except (OSError, RuntimeError, KeyError, TimeoutError):
            return PluginResult(False, "host_computer_unavailable", "Chrome or the work folder is temporarily unavailable.")
        except Refused as error:
            return _refusal(error)
        finally:
            self.active[member] -= 1
            if not self.active[member]:
                del self.active[member]

    async def browser_call(self, name, arguments, approver, member, work, announce):
        browser = self.browser
        if name == "browser_tabs":
            if arguments.get("show"):
                raise BrowserError("browser_background_only")
            tabs = []
            if browser.cdp is not None and browser.tabs:
                listing = await browser.cdp.call("Target.getTargets")
                owned = {tab.target: tab.id for tab in browser.tabs.values() if tab.scope == work}
                tabs = [{"tab_id": owned[row["targetId"]], "title": row["title"], "url": row["url"], "shown": None}
                        for row in listing["targetInfos"] if row["targetId"] in owned]
            return {"tabs": tabs}, [], None
        if name == "browser_open":
            if isinstance(work[0], tuple) and not work[1]:
                raise BrowserError("private_conversation_required")
            await self.vm.settled()
            new_window = await browser.start()
            if arguments.get("new_tab") or not any(tab.scope == work for tab in browser.tabs.values()):
                try:
                    tab = await browser.new_tab(work, member, self.download_folder(member))
                finally:
                    browser._schedule_idle()
            else:
                tab = browser.tab(work)
            if new_window and announce:
                announce()
        else:
            tab = browser.tab(work, arguments.get("target_id"), arguments.get("tab_id"))
        if tab.handoff:
            raise BrowserError("owner_holds_control")
        if name == "request_takeover":
            return {"owner_needed": arguments["reason"]}, [], tab
        if name in ("browser_open", "browser_navigate"):
            try:
                navigated = await host_page.navigate(browser, tab, arguments["url"])
            except BrowserError as error:
                if str(error) != "browser_certificate_needed":
                    raise
                return {"owner_needed": "certificate"}, [], tab
            if not navigated:
                return {"status": "download_started", "target_id": tab.id, "tab_id": tab.id}, [], tab
        if name in ("browser_click", "browser_type", "browser_select"):
            return await host_page.act(browser, tab, name, arguments, approver), [], tab
        data, blocks = await host_page.snapshot(browser, tab, arguments)
        return data, blocks, tab


DEFINITION_WORDS = {
    "read_file": "Read a file. Relative paths start in your work folder; team:/ selects the team folder. Read before overwriting.",
    "write_file": "Write a file in your work folder, team folder or an owner-selected project. Other writes require approval.",
    "edit_file": "Edit a file you read in this turn. Relative paths start in your work folder; team:/ selects the team folder.",
    "glob": "List files under a folder by glob pattern. The default is your work folder; team:/ selects the team folder.",
    "grep": "Search files by regular expression. The default is your work folder; team:/ selects the team folder.",
}


CHROME_OPENED = {
    "zh-TW": "已開啟 Raphael 的 Chrome。",
    "en": "I opened Raphael’s Chrome.",
    "ja": "Raphael 専用の Chrome を開きました。",
    "zh-CN": "已打开 Raphael 的 Chrome。",
    "ko": "Raphael 전용 Chrome을 열었습니다.",
    "es": "Abrí el Chrome de Raphael.",
    "fr": "J’ai ouvert le Chrome de Raphael.",
    "de": "Ich habe Raphaels Chrome geöffnet.",
    "pt-BR": "Abri o Chrome do Raphael.",
    "it": "Ho aperto il Chrome di Raphael.",
    "ru": "Я открыл Chrome Рафаэля.",
    "vi": "Tôi đã mở Chrome của Raphael.",
    "th": "เปิด Chrome ของ Raphael แล้ว",
    "id": "Saya membuka Chrome milik Raphael.",
    "tr": "Raphael’in Chrome’unu açtım."
}

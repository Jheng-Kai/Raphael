"""Local desktops as a PluginHub adapter, under the existing gate and snapshots.

Lease/file contracts adapted from OpenMausBot (Apache-2.0); see THIRD_PARTY_NOTICES.md.
"""

import asyncio
import base64
import itertools
import json
import logging
import mimetypes
import re
import shlex
import time
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import PurePosixPath

from jsonschema import Draft202012Validator

from ..agent.plugins import PluginResult, PluginTool, tool_key
from ..agent.policy import Tier
from ..integrations.audit import AuditLog
from ..services.attachments import Attachment, MAX_FILE_BYTES, sniff_ok
from .vm import VmError
from .vm_bridge import CuaBridge
from .vm_catalog import DRIVER_TOOLS, NOTICES, PAGE_TOOLS, READS, without_session
from .takeover import TAKEOVER

_SCOPE = ContextVar("computer_scope", default=None)
_TURN = ContextVar("computer_turn", default=(0, False, None))
# Where a call that has to wait for the desktop says so: the line for the owner, and the language of the work.
_NOTE = ContextVar("computer_note", default=(None, "en"))
logger = logging.getLogger(__name__)


def plain_read(command):
    if any(char in command for char in "$`;&|<>\n\r"):
        return False
    try:
        words = shlex.split(command)
    except ValueError:
        return False
    return bool(words) and (words[0] in ("pwd", "ls", "cat", "echo", "printf") or
                           words[0] == "date" and all(word.startswith("+") for word in words[1:]))

# The line a member shows while another has the desktop (one line per wait, never one per poll).
WAITING_FOR = {
    "zh-TW": "正在等 {who} 用完電腦",
    "ja": "{who} がコンピューターを使い終わるのを待っています",
    "en": "Waiting for {who} to finish with the computer",
}


@contextmanager
def vm_scope(owner, *, turn_id=0, private=False, task=None, progress=None, language="en"):
    token = _SCOPE.set(owner)
    turn = _TURN.set((turn_id, private, task))
    note = _NOTE.set((progress, language))
    try:
        yield
    finally:
        _SCOPE.reset(token)
        _TURN.reset(turn)
        _NOTE.reset(note)


VM_CONTRACT = (
    "VM sandbox: no per-action approval; owner control blocks all calls. Before sending a message/email, "
    "publishing/posting, deleting outside the workspace, or paying/buying, call approve (CLI) or the API "
    "harness equivalent and wait for the owner's yes for the exact action/target. If unavailable, denied "
    "or expired, stop. Sandbox success is not approval."
)

EXEC = {"description": VM_CONTRACT + " Run a shell command inside the VM workspace, never on the host. Your own files are in /home/cua/workspace; /home/cua/team is the folder the whole team shares, so what a colleague or the owner needs goes there. Nothing it does shows on the screen the owner watches: use it for files and programs, never to fetch a page in place of opening it in the browser. It waits for the command for at most timeout_seconds (60 by default, 1800 at most) and ends it then. For a build or a server that takes longer, or to work on while it runs, set background: it returns at once with a job and the paths of its log and of its .exit file (the exit code, there once the job has ended); read them with another vm_exec. Other members' commands and the screen are not held up by it.",
        "parameters": {"type": "object", "properties": {"command": {"type": "string", "minLength": 1},
        "timeout_seconds": {"type": "number", "exclusiveMinimum": 0, "maximum": 21600},
        "background": {"type": "boolean"}}, "required": ["command"], "additionalProperties": False}}
ATTACH = {"description": "Copy an existing file from /home/cua/workspace or /home/cua/team into Raphael's attachment store and return its attachment ID. Paths elsewhere are refused.",
          "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"], "additionalProperties": False}}
REQUEST = {"description": "Ask for a sandbox desktop when a task must be seen or clicked. Questions about the owner's own PC use local__local_exec first; service work uses its connected app. No sandbox starts before yes. On denial or expiry, say sandbox access was not granted. Routines cannot grant it; ask in private chat.",
           "parameters": {"type": "object", "properties": {"reason": {"type": "string", "minLength": 1, "maxLength": 500}}, "required": ["reason"], "additionalProperties": False}}
SCREEN = {"description": VM_CONTRACT + " Inspect screen and discover control tools.",
          "parameters": {"type": "object", "properties": {}, "additionalProperties": False}}
FILL_LOGIN = {"description": VM_CONTRACT + " Fill the username and password saved through request_secret(site) into current page references. The reference belongs to this member and exact HTTPS origin. Values never enter your messages or results. This does not submit; keep request_takeover for owner-only sign-in steps. Private fields hide screenshots while filled; page text remains redacted.",
    "parameters": {"type": "object", "properties": {key: {"type": "string", "minLength": 1, "maxLength": 2048} for key in
        ("reference", "site", "target_id", "username_ref", "password_ref")},
        "required": ["reference", "site", "target_id", "username_ref", "password_ref"], "additionalProperties": False}}


class VmTools:
    # How long a member waits for another to finish with the screen, and how often it looks: a bounded wait,
    # then a result that says who holds it and for how long.
    busy_wait_s = 60.0
    busy_poll_s = 0.5
    # A holder that has not touched the screen for this long (it is thinking, or busy with commands) has let go
    # of it: another may take it, and the holder looks at it again when it comes back.
    lease_idle_s = 60.0

    def __init__(self, delegate, vm, *, attachments, conn=None, bridge=CuaBridge):
        self.delegate, self.vm, self.attachments, self.bridge = delegate, vm, attachments, bridge
        # What a member is called (told by the app), when each holder took the screen and last used it, and the
        # (desktop, scope) pairs whose picture of the screen is out of date because another used it since.
        self.names = lambda member_id: None
        self.lease_since, self.lease_used, self.stale = {}, {}, set()
        self.commands = {}  # the shell commands under way on each desktop: they are not input at the screen
        self.audit = AuditLog(conn) if conn is not None else None
        self.conn = conn
        if conn is not None:
            from .grants import ComputerGrants
            self.vm.grants = ComputerGrants(conn)
        self.requests = {}
        self.catalogs, self.tools, self.routes, self.locks, self.actions = {}, {}, {}, {}, {}
        self.schemas = {}
        self.problem = None
        self.leases = {}
        self.scope_busy = lambda scope: scope[0] == "async" and not scope[1].done()
        self.vm.busy = lambda key: key in self.leases and self.scope_busy(self.leases[key])
        self.listed = set()
        self.connections, self.labels = {}, itertools.count(1)
        self.logins = None
        self.private_pages = {}
        self.checkpointed, self.checkpoint_locks = set(), {}

    def __getattr__(self, name):
        return getattr(self.delegate, name)

    async def prepare(self, member_id=0):
        if not self.vm.enabled or not self.vm.grants.allowed(member_id):
            return
        # Looking for the program runs nothing. With no Docker on this PC there is no computer to offer.
        if self.vm.desktop and not self.vm.desktop.installed():
            return
        target = self.vm.target(member_id)
        if self.logins:
            try:
                for row in self.logins.references(None if target.key == "shared" else member_id):
                    try:
                        self.logins.load(row["member_id"], row["origin"], row["reference"])
                    except Exception as error:
                        logger.warning("Login vault read failed: %s", type(error).__name__)
            except Exception as error:
                logger.warning("Login registry read failed: %s", type(error).__name__)
        keys = self.catalogs.get(target.key, [])
        if not keys or self.routes[keys[0]] != target:
            self.listed.discard(target.key)
            # This offer is entirely offline. Driver schemas are learned only
            # after an actual screen call, never by probing Docker at turn start.
            self._catalog(target, {"get_desktop_state": SCREEN})

    def _catalog(self, target, definitions):
        definitions.update(vm_exec=EXEC, attach_file=ATTACH, request_takeover=TAKEOVER, fill_login=FILL_LOGIN)
        keys = []
        for name, definition in definitions.items():
            key = tool_key(f"computer-{target.key}", name)
            self.tools[key] = PluginTool(key, "computer", name, definition["description"], definition["parameters"], Tier.T0, pinned=True)
            self.routes[key] = target
            self.schemas[key] = definition.get("validation", definition["parameters"])
            keys.append(key)
        self.catalogs[target.key] = keys

    async def _discover(self, target):
        async with self.locks.setdefault(target.key, asyncio.Lock()):
            if target.key in self.listed:
                return
            try:
                async with self.bridge(self.vm, target) as client:
                    listed, cursor = [], None
                    for _ in range(10):
                        page = await client.request("tools/list", {"cursor": cursor} if cursor else {})
                        listed.extend(page.get("tools", []))
                        cursor = page.get("nextCursor")
                        if not cursor:
                            break
                    else:
                        raise VmError("tool_list_limit")
                definitions = {}
                for item in listed:
                    name, schema = item.get("name"), item.get("inputSchema")
                    if name not in DRIVER_TOOLS:
                        continue
                    if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,59}", name) or name in definitions:
                        raise VmError("invalid_tool")
                    if name in ("vm_exec", "attach_file") or not isinstance(schema, dict):
                        raise VmError("invalid_tool")
                    schema = without_session(schema)
                    Draft202012Validator.check_schema(schema)
                    # Keep the contract first and within Offer's description cap.
                    definitions[name] = {"description": VM_CONTRACT + " " + item.get("description", ""), "parameters": schema,
                        "validation": without_session(item.get("originalInputSchema", schema))}
                self._catalog(target, definitions)
                self.listed.add(target.key)
                self.problem = None
            except Exception as error:
                self.problem = str(error) if isinstance(error, VmError) else type(error).__name__
                raise

    def offered_for(self, member_id):
        target = self.vm.target(member_id)
        if self.vm.grants.allowed(member_id):
            native = [self.tools[key] for key in self.catalogs.get(target.key, []) if self.routes[key] == target] if self.vm.enabled else []
        elif self.vm.grants.full_permission():
            native = []  # Nobody would be asked, and the yes that gives itself would undo the owner's revoke.
        else:
            key = tool_key(f"computer-access-{member_id}", "request_computer")
            self.requests[key] = member_id
            native = [PluginTool(key, "computer", "request_computer", REQUEST["description"], REQUEST["parameters"], Tier.T2, pinned=True)]
        return [*self.delegate.offered(), *native]

    def offered(self):
        return self.offered_for(0)

    def has_own_computer(self, member_id):
        if self.vm.grants.state(member_id) is True:
            return True
        # Opened by 全部允許 on a PC with no Docker there is no computer of its own, so the owner's desktop stays offered.
        return self.vm.grants.allowed(member_id) and bool(self.catalogs.get(self.vm.target(member_id).key))

    def page_tool(self, server_id, name):
        return self.delegate.page_tool(server_id, name)

    def is_computer_tool(self, key):
        return key in self.tools or key in self.requests

    def tier_of(self, key):
        if key in self.requests:
            return Tier.T2
        if key in self.tools:
            shared = self.vm.settings is not None and self.vm.settings.get("computer_vm_mode") == "shared"
            matches = (self.routes[key].key == "shared") == shared
            return self.tools[key].tier if self.vm.enabled and matches and self.routes[key].remote == self.vm.remote and key in self.catalogs.get(self.routes[key].key, []) else None
        return self.delegate.tier_of(key)

    def tier_for_call(self, key, arguments):
        # The hub knows nothing about computer tools, so it must not be asked about them.
        return self.tier_of(key) if self.is_computer_tool(key) else self.delegate.tier_for_call(key, arguments)

    def kind_of(self, server, name):
        if server == "computer":
            return "read" if name in READS or name == "attach_file" else "write"
        return self.delegate.kind_of(server, name)

    def kind_for_call(self, server, name, arguments):
        return self.kind_of(server, name) if server == "computer" else self.delegate.kind_for_call(server, name, arguments)

    def _audit(self, key, outcome, approver, task_id):
        if self.audit:
            tool = self.tools[key]
            self.audit.add(server="computer", tool=tool.name, tier=tool.tier.name,
                approver=approver, outcome=outcome if outcome in ("ok", "timeout", "denied", "expired", "blocked") else "error", task_id=task_id)

    def record_unrun(self, key, *, outcome, task_id=None):
        if key in self.requests:
            if self.audit:
                self.audit.add(server="computer", tool="request_computer", tier="T2", approver="none", outcome=outcome, task_id=task_id)
        elif key in self.tools:
            self._audit(key, outcome, "none", task_id)
        else:
            self.delegate.record_unrun(key, outcome=outcome, task_id=task_id)

    async def call(self, key, arguments, *, approver, task_id=None, pool=None):
        if not self.is_computer_tool(key):
            return await self.delegate.call(key, arguments, approver=approver, task_id=task_id, pool=pool)
        result = await self._call(key, arguments, approver=approver, task_id=task_id, pool=pool)
        scope = _SCOPE.get()
        member = scope[1] if scope and scope[0] == "turn" else 0
        if task_id and self.conn is not None:
            row = self.conn.execute("SELECT member_id FROM worker_tasks WHERE id=?", (task_id,)).fetchone()
            if row:
                member = row[0]
        private_members = list(self.logins.values) if self.logins and self.vm.target(member).key == "shared" else [member]
        if self.logins and any(self.logins.values.get(identifier) for identifier in private_members):
            for identifier in private_members:
                result.text = self.logins.redact(identifier, result.text)
                if result.kind:
                    result.kind = self.logins.redact(identifier, result.kind)
            if result.blocks and await self._private_picture(self.vm.target(member), arguments):
                result.text = (result.text + "\nPrivate login fields are hidden. Use page references or request_takeover; no screenshot was returned.").strip()
                result.blocks = []
        return result

    async def _checkpoint(self, target, member, turn, owner, command):
        if plain_read(command):
            return
        ticket = (target.key, member, turn or owner)
        async with self.checkpoint_locks.setdefault(target.key, asyncio.Lock()):
            if ticket in self.checkpointed:
                return
            self.checkpointed.add(ticket)
            failures = getattr(self.vm, "checkpoint_failures", None)
            if failures is None:
                self.vm.checkpoint_failures = failures = {}
            try:
                await asyncio.wait_for(self.vm.checkpoint(target, "begin", member=member, turn=turn), 11)
                failures.pop(target.key, None)
            except Exception as error:
                failures[target.key] = True
                logger.warning("File checkpoint skipped: %s", type(error).__name__)

    def _observe_page(self, target, page):
        identifier = page.get("target_id")
        url = page.get("url") or next((tab.get("url") for tab in page.get("tabs", []) if tab.get("active") is True), None)
        key = (target.key, identifier)
        protected = self.private_pages.get(key)
        if protected and url and protected[0] != url:
            self.private_pages.pop(key, None)

    async def _private_picture(self, target, arguments):
        now = self.vm.clock()
        for key, (_, until) in list(self.private_pages.items()):
            if now >= until:
                self.private_pages.pop(key, None)
        keys = [key for key in self.private_pages if key[0] == target.key and
                (not arguments.get("target_id") or key[1] == arguments["target_id"])]
        for key in keys:
            try:
                client, session = await self._connection(target)
                state = await client.request("tools/call", {"name": "get_browser_state", "arguments": {"target_id": key[1], "session": session}})
                self._observe_page(target, state.get("structuredContent") or {})
            except Exception:
                pass
        return any(key in self.private_pages for key in keys)

    async def _call(self, key, arguments, *, approver, task_id=None, pool=None):
        if key in self.requests:
            member = self.requests[key]
            if task_id:
                return PluginResult(False, "computer_permission_required", "Computer access is not granted. Ask the owner in this member's private chat or press Start in its computer panel; this routine cannot start it.")
            if approver != "user":
                return PluginResult(False, "denied", "The owner did not grant computer access. Say plainly that you cannot use the computer.")
            if not Draft202012Validator(REQUEST["parameters"]).is_valid(arguments):
                return PluginResult(False, "bad_arguments")
            scope = _SCOPE.get()
            if scope is None or scope[0] != "turn" or scope[1] != member:
                return PluginResult(False, "computer_permission_required")
            if not _TURN.get()[1]:
                return PluginResult(False, "private_only", "Request computer access in the owner's private chat.")
            self.vm.grants.set(member, True)
            if self.audit:
                self.audit.add(server="computer", tool="request_computer", tier="T2", approver="user", outcome="ok")
            await self.prepare(member)
            if not self.vm.grants.allowed(member):
                return PluginResult(False, "computer_permission_required", "The owner revoked computer access.")
            if not self.catalogs.get(self.vm.target(member).key):
                return PluginResult(False, "unavailable", "Computer access was granted, but this installation has not enabled computer tools. Ask an administrator to enable them before trying again; there is no setting here to add them.")
            return PluginResult(True, text="Computer access granted. Computer tools are now available; continue the owner's task.")
        if key not in self.tools:
            return await self.delegate.call(key, arguments, approver=approver, task_id=task_id, pool=pool)
        tool, target = self.tools[key], self.routes[key]
        result = PluginResult(False, "blocked")
        try:
            scope = _SCOPE.get()
            member = scope[1] if scope and scope[0] == "turn" else 0
            if task_id and self.conn is not None:
                row = self.conn.execute("SELECT member_id FROM worker_tasks WHERE id=?", (task_id,)).fetchone()
                if row is None:
                    return PluginResult(False, "computer_permission_required")
                member = row[0]
            if not self.vm.grants.allowed(member) or target != self.vm.target(member):
                return PluginResult(False, "computer_permission_required", "The owner has not granted this member computer access.")
            if self.tier_of(key) is None or approver == "none" or tool.tier >= Tier.T2 and approver != "user":
                return result
            if target.key in self.vm.held:
                result = PluginResult(False, "owner_holds_control")
                return result
            if "session" in arguments or not Draft202012Validator(self.schemas[key]).is_valid(arguments):
                result = PluginResult(False, "bad_arguments")
                return result
            owner = _SCOPE.get() or ("async", asyncio.current_task())
            turn = _TURN.get()
            if task_id and self.conn is not None:
                origin = self.conn.execute("SELECT w.member_id, a.conversation_id, w.turn_id FROM worker_tasks w "
                    "JOIN agent_turns a ON a.id=w.turn_id WHERE w.id=? AND w.scope='private' "
                    "AND w.room_id IS NULL AND a.scope='private'", (task_id,)).fetchone()
                if origin:
                    owner = ("task", task_id, origin["member_id"], origin["conversation_id"])
                    turn = (origin["turn_id"], True, None)
            # Only the screen is shared out: a command in the workspace takes nobody's turn, and no turn waits for one.
            screen = tool.name not in ("vm_exec", "attach_file")
            if screen and (busy := await self._take_screen(target, owner)) is not None:
                result = busy
                return result
            work = self.vm.work.begin(target, owner, *turn)
            if work and owner[0] == "task":
                work.alive = lambda: self.scope_busy(owner)
            if work and work.state in ("stopped", "expired"):
                return PluginResult(False, "task_stopped")
            if work and work.check_required and tool.name != "get_desktop_state":
                return PluginResult(False, "desktop_check_required")
            if tool.name == "request_takeover":
                # Never over input that is already running at the screen (a long command in the workspace is none).
                if self.vm.active.get(target.key, 0) > self.commands.get(target.key, 0) or (
                        self.actions.get(target.key) and self.actions[target.key].locked()):
                    return self._busy(target, None, 0.0)
                data = await self.vm.work.request(work, arguments["reason"])
                result = PluginResult(True, text=json.dumps(data))
                return result
            if work:
                work.tool = tool.name
            if screen and (target.key, owner) in self.stale and tool.name not in READS:
                # Another used the screen since this one looked at it: look again before acting on it.
                result = PluginResult(True, "screen_changed", json.dumps({
                    "status": "screen_changed",
                    "note": "Another member used the computer while you waited, so the screen is no longer what you last saw. "
                            "Nothing was done. Call get_desktop_state, then do this again if it is still needed."}))
                return result
            lock = self.actions.setdefault(target.key, asyncio.Lock()) if screen else None
            if lock is not None:
                # What is ahead is another member's single action: seconds, not a turn.
                if lock.locked():
                    try:
                        await asyncio.wait_for(lock.acquire(), self.busy_wait_s)
                    except TimeoutError:
                        return self._busy(target, None, self.busy_wait_s)
                else:
                    await lock.acquire()
            self.vm.active[target.key] = self.vm.active.get(target.key, 0) + 1
            command = tool.name == "vm_exec"
            if command:
                self.commands[target.key] = self.commands.get(target.key, 0) + 1
            try:
                await self.vm.start(target)
                # A hold may have arrived while the desktop was starting. Never queue actions.
                if target.key in self.vm.held:
                    raise VmError("owner_holds_control")
                if tool.name == "vm_exec":
                    background = arguments.get("background", False)
                    wait = arguments.get("timeout_seconds", 3600 if background else 60)
                    await self._checkpoint(target, member, turn[0], owner, arguments["command"])
                    if background:
                        data = await self.vm.execute(target, arguments["command"], wait, background=True)
                    else:
                        data = await self.vm.execute(target, arguments["command"], wait)
                    # A command that ran and exited non-zero (tests that fail) is what the model asked to find out, not a broken tool.
                    result = PluginResult(True, None, json.dumps(data), data.get("truncated", False))
                elif tool.name == "attach_file":
                    data = await self.vm.read_file(target, arguments["path"], limit=MAX_FILE_BYTES)
                    name = PurePosixPath(arguments["path"]).name
                    attachment = await asyncio.to_thread(self.attachments.save,
                        Attachment(name, mimetypes.guess_type(name)[0] or "application/octet-stream", data))
                    result = PluginResult(True, text=json.dumps({"attachment": attachment.metadata()}))
                elif tool.name == "fill_login":
                    result = await self._fill_login(target, member, arguments)
                else:
                    await self._discover(target)
                    if not self.vm.grants.allowed(member):
                        result = PluginResult(False, "computer_permission_required")
                        return result
                    if target.key in self.vm.held:
                        raise VmError("owner_holds_control")
                    if self.tier_of(key) is None:
                        result = PluginResult(False, "tool_changed", "This driver does not offer that tool. Read the refreshed computer tool catalog.")
                        return result
                    if not Draft202012Validator(self.schemas[key]).is_valid(arguments):
                        result = PluginResult(False, "bad_arguments", "The driver requires different arguments. Read the refreshed computer tool schema before retrying.")
                        return result
                    client, session = await self._connection(target)
                    # The screen is the member's own, and Chromium refuses input addressed to it in the background.
                    foreground = {"delivery_mode": "foreground"} if "delivery_mode" in self.schemas[key].get("properties", {}) else {}
                    sent = {**foreground, **arguments, "session": session}
                    try:
                        data = await client.request("tools/call", {"name": tool.name, "arguments": sent})
                    except (VmError, ConnectionError):
                        await self._disconnect(target.key)
                        raise
                    self._observe_page(target, data.get("structuredContent") or {})
                    blocks, text = [], []
                    for block in data.get("content", []):
                        if block.get("type") == "text":
                            text.append(str(block.get("text", "")))
                        elif block.get("type") == "image" and not data.get("isError"):
                            if block.get("mimeType") not in ("image/png", "image/jpeg", "image/webp") or len(block.get("data", "")) > 14_000_000:
                                raise VmError("invalid_image")
                            if not sniff_ok(block["mimeType"], base64.b64decode(block["data"], validate=True)):
                                raise VmError("invalid_image")
                            blocks.append({key: block[key] for key in ("type", "data", "mimeType")})
                            if len(blocks) > 4 or sum(len(item["data"]) for item in blocks) > 14_000_000:
                                raise VmError("image_limit")
                    # A page tool says its tabs, refs and what came of a gesture only here; its text is one line about them.
                    if tool.name.startswith(PAGE_TOOLS) and data.get("structuredContent"):
                        text.append(json.dumps(data["structuredContent"], ensure_ascii=False))
                    combined = "\n".join(text)
                    if self.logins:
                        for identifier in self.logins.values if target.key == "shared" else (member,):
                            combined = self.logins.redact(identifier, combined)
                    limit = 60_000 if tool.name.startswith(PAGE_TOOLS) else 20_000
                    result = PluginResult(not data.get("isError", False), "tool_error" if data.get("isError") else None,
                        combined[:limit], len(combined) > limit, blocks=blocks)
                if work and result.ok and tool.name == "get_desktop_state":
                    work.check_required = False
                if screen and result.ok and tool.name == "get_desktop_state":
                    self.stale.discard((target.key, owner))
            finally:
                self.vm.active[target.key] -= 1
                if command:
                    self.commands[target.key] -= 1
                self.vm.last_activity[target.key] = self.vm.clock()
                if lock is not None:
                    self.lease_used[target.key] = self.vm.clock()
                    lock.release()
            return result
        except asyncio.CancelledError:
            result = PluginResult(False, "cancelled")
            raise
        except TimeoutError:
            result = PluginResult(False, "timeout")
            return result
        except VmError as error:
            result = PluginResult(False, str(error))
            return result
        except Exception:
            result = PluginResult(False, "error")
            return result
        finally:
            self._audit(key, "blocked" if result.kind in NOTICES else "ok" if result.ok else result.kind or "error", approver, task_id)

    # --- the driver connection -------------------------------------------------------------------

    async def _fill_login(self, target, member, args):
        from .logins import origin
        if self.logins is None:
            return PluginResult(False, "login_missing", "Use request_secret with the HTTPS site, or request_takeover.")
        try:
            await self._discover(target)
            client, session = await self._connection(target)
            values = self.logins.load(member, args["site"], args["reference"])
            key = tool_key(f"computer-{target.key}", "browser_type")
            schema = self.schemas.get(key)
            if not schema:
                raise ValueError()
            calls = [{"target_id": args["target_id"], "ref": args[field + "_ref"], "text": values[field]}
                     for field in ("username", "password")]
            if "delivery_mode" in schema.get("properties", {}):
                calls = [{**call, "delivery_mode": "foreground"} for call in calls]
            if not all(Draft202012Validator(schema).is_valid(call) for call in calls):
                raise ValueError()
            for call in calls:
                state = await client.request("tools/call", {"name": "get_browser_state", "arguments": {"target_id": args["target_id"], "session": session}})
                page = state.get("structuredContent") or {}
                url = page.get("url") or next((tab.get("url") for tab in page.get("tabs", []) if tab.get("active") is True), None)
                if (state.get("isError") or page.get("target_id") != args["target_id"] or origin(url) != origin(args["site"])
                        or not self.vm.grants.allowed(member) or target != self.vm.target(member) or target.key in self.vm.held):
                    raise ValueError()
                # Driver echoes and pictures are deliberately discarded, including errors.
                self.private_pages[(target.key, args["target_id"])] = (url, self.vm.clock() + 120)
                reply = await client.request("tools/call", {"name": "browser_type", "arguments": {**call, "session": session}})
                if reply.get("isError"):
                    return PluginResult(False, "login_not_filled", '{"filled": false}')
            return PluginResult(True, text='{"filled": true}')
        except Exception:
            # Transport and vault exceptions may echo input; none of their diagnostics leave this boundary.
            return PluginResult(False, "login_not_filled", '{"filled": false}')

    async def _connection(self, target):
        """A computer's one connection to its driver, and its session label. The driver ends a session with the connection
        that used it, and with it the browser it opened, the tab it bound and the screenshot a gesture needs. A new
        connection takes a new label: the driver refuses one that has ended."""
        held = self.connections.get(target.key)
        if held is not None and held[0].alive:
            return held
        await self._disconnect(target.key)
        client = self.bridge(self.vm, target)
        await client.__aenter__()
        self.connections[target.key] = client, f"raphael-{next(self.labels)}"
        return self.connections[target.key]

    async def _disconnect(self, key):
        held = self.connections.pop(key, None)
        if held is not None:
            await held[0].__aexit__(None, None, None)

    async def aclose(self):
        for key in list(self.connections):
            await self._disconnect(key)

    # --- sharing the screen ---------------------------------------------------------------------

    def _holder(self, target, owner):
        """The scope that has the screen, if it is another's, still at work, and has touched the screen lately."""
        previous = self.leases.get(target.key)
        if previous is None or previous == owner or not self.scope_busy(previous):
            return None
        return None if self.vm.clock() - self.lease_used.get(target.key, 0.0) >= self.lease_idle_s else previous

    async def _take_screen(self, target, owner):
        """Take the desktop's screen for `owner`: while another's turn at it goes on, wait a bounded time, with one
        line saying so. None once it is `owner`'s; else the result to give in place of the action (`_busy`). A screen
        that was another's since `owner` last looked at it is stale: `owner` must look again before it acts on it."""
        began = time.monotonic()
        said = False
        while (held := self._holder(target, owner)) is not None:
            waited = time.monotonic() - began
            if waited >= self.busy_wait_s:
                return self._busy(target, held, waited)
            if not said:
                said = True
                progress, language = _NOTE.get()
                if progress is not None:
                    progress(WAITING_FOR.get(language, WAITING_FOR["en"]).format(who=self._name_of(held)))
            await asyncio.sleep(min(self.busy_poll_s, self.busy_wait_s - waited))
        previous = self.leases.get(target.key)
        if previous != owner:
            if previous is not None and owner[0] != "async":  # a call outside any turn or task has no picture to go stale
                self.stale.add((target.key, owner))
            self.lease_since[target.key] = self.vm.clock()
        self.leases[target.key] = owner
        self.lease_used[target.key] = self.vm.clock()
        return None

    def _busy(self, target, held, waited):
        """Not a tool failing: how things stand, so that the model can do other work or ask again later."""
        held = held or self.leases.get(target.key)
        name = "someone" if held is None else self._name_of(held)
        since = self.lease_since.get(target.key)
        return PluginResult(True, "computer_busy", json.dumps({
            "status": "computer_busy", "held_by": name,
            "held_for_s": None if since is None else round(self.vm.clock() - since), "waited_s": round(waited),
            "note": f"{name} is using the computer. Nothing was done. Do other work that does not need it, or call again "
                    "later; this is not an error."}, ensure_ascii=False))

    def _name_of(self, scope):
        """What the member whose turn `scope` is is called."""
        member = scope[1] if scope[0] == "turn" else scope[2] if scope[0] == "task" and len(scope) > 2 else None
        if member is None and scope[0] == "task" and self.conn is not None:
            row = self.conn.execute("SELECT member_id FROM worker_tasks WHERE id=?", (scope[1],)).fetchone()
            member = None if row is None else row[0]
        if member is None:
            return "someone"
        return self.names(member) or ("Raphael" if member == 0 else f"#{member}")

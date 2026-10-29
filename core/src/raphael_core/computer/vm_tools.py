"""Local desktops as a PluginHub adapter, under the existing gate and snapshots.

Lease/file contracts adapted from OpenMausBot (Apache-2.0); see THIRD_PARTY_NOTICES.md.
"""

import asyncio
import base64
import json
import mimetypes
import re
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

READS = frozenset({"get_desktop_state", "get_screenshot", "screenshot", "health_report", "get_cursor_position"})
_SCOPE = ContextVar("computer_scope", default=None)


@contextmanager
def vm_scope(owner):
    token = _SCOPE.set(owner)
    try:
        yield
    finally:
        _SCOPE.reset(token)


VM_CONTRACT = (
    "VM sandbox: no per-action approval; owner control blocks all calls. Before sending a message/email, "
    "publishing/posting, deleting outside the workspace, or paying/buying, call approve (CLI) or the API "
    "harness equivalent and wait for the owner's yes for the exact action/target. If unavailable, denied "
    "or expired, stop. Sandbox success is not approval."
)

EXEC = {"description": VM_CONTRACT + " Run a shell command inside the VM workspace, never on the host.",
        "parameters": {"type": "object", "properties": {"command": {"type": "string", "minLength": 1},
        "timeout_seconds": {"type": "number", "exclusiveMinimum": 0, "maximum": 300}}, "required": ["command"], "additionalProperties": False}}
ATTACH = {"description": "Copy an existing file from /home/cua/workspace into Raphael's attachment store and return its attachment ID. Paths outside this workspace are refused.",
          "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"], "additionalProperties": False}}


class VmTools:
    def __init__(self, delegate, vm, *, attachments, conn=None, bridge=CuaBridge):
        self.delegate, self.vm, self.attachments, self.bridge = delegate, vm, attachments, bridge
        self.audit = AuditLog(conn) if conn is not None else None
        self.catalogs, self.tools, self.routes, self.locks, self.actions = {}, {}, {}, {}, {}
        self.schemas = {}
        self.problem = None
        self.leases = {}
        self.scope_busy = lambda scope: scope[0] == "async" and not scope[1].done()
        self.vm.busy = lambda key: key in self.leases and self.scope_busy(self.leases[key])
        self._checked_at, self._available = -100.0, False

    def __getattr__(self, name):
        return getattr(self.delegate, name)

    async def prepare(self, member_id=0):
        if self.vm.clock() - self._checked_at > 10:
            self._available = await self.vm.available()
            self._checked_at = self.vm.clock()
        if not self._available:
            return
        target = self.vm.target(member_id)
        async with self.locks.setdefault(target.key, asyncio.Lock()):
            if target.key in self.catalogs:
                return
            try:
                if not await self.vm.image():
                    return
                await self.vm.start(target)
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
                    if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,59}", name) or name in definitions:
                        raise VmError("invalid_tool")
                    if name in ("vm_exec", "attach_file") or not isinstance(schema, dict):
                        raise VmError("invalid_tool")
                    Draft202012Validator.check_schema(schema)
                    # Keep the contract first and within Offer's description cap.
                    definitions[name] = {"description": VM_CONTRACT + " " + item.get("description", ""), "parameters": schema,
                        "validation": item.get("originalInputSchema", schema)}
                definitions.update(vm_exec=EXEC, attach_file=ATTACH)
                keys = []
                for name, definition in definitions.items():
                    key = tool_key(f"computer-{target.key}", name)
                    # Sandbox steps need no tier approval, even in the owner's global Ask mode.
                    tier = Tier.T0
                    self.tools[key] = PluginTool(key, "computer", name, definition["description"], definition["parameters"], tier)
                    self.routes[key] = target
                    self.schemas[key] = definition.get("validation", definition["parameters"])
                    keys.append(key)
                self.catalogs[target.key] = keys
                self.problem = None
            except Exception as error:
                # Docker/image/driver availability must never break unrelated conversation.
                self.catalogs.pop(target.key, None)
                self.problem = str(error) if isinstance(error, VmError) else type(error).__name__

    def offered_for(self, member_id):
        target = self.vm.target(member_id)
        native = [self.tools[key] for key in self.catalogs.get(target.key, [])] if self._available else []
        return [*self.delegate.offered(), *native]

    def offered(self):
        return self.offered_for(0)

    def is_computer_tool(self, key):
        return key in self.tools

    def tier_of(self, key):
        if key in self.tools:
            shared = self.vm.settings is None or self.vm.settings.get("computer_vm_mode") == "shared"
            matches = (self.routes[key].key == "shared") == shared
            return self.tools[key].tier if self._available and matches else None
        return self.delegate.tier_of(key)

    def kind_of(self, server, name):
        if server == "computer":
            return "read" if name in READS or name == "attach_file" else "write"
        return self.delegate.kind_of(server, name)

    def _audit(self, key, outcome, approver, task_id):
        if self.audit:
            tool = self.tools[key]
            self.audit.add(server="computer", tool=tool.name, tier=tool.tier.name,
                approver=approver, outcome=outcome if outcome in ("ok", "timeout", "denied", "expired", "blocked") else "error", task_id=task_id)

    def record_unrun(self, key, *, outcome, task_id=None):
        if key in self.tools:
            self._audit(key, outcome, "none", task_id)
        else:
            self.delegate.record_unrun(key, outcome=outcome, task_id=task_id)

    async def call(self, key, arguments, *, approver, task_id=None, pool=None):
        if key not in self.tools:
            return await self.delegate.call(key, arguments, approver=approver, task_id=task_id, pool=pool)
        tool, target = self.tools[key], self.routes[key]
        result = PluginResult(False, "blocked")
        try:
            if self.tier_of(key) is None or approver == "none" or tool.tier >= Tier.T2 and approver != "user":
                return result
            if target.key in self.vm.held:
                result = PluginResult(False, "owner_holds_control")
                return result
            if not Draft202012Validator(self.schemas[key]).is_valid(arguments):
                result = PluginResult(False, "bad_arguments")
                return result
            owner = _SCOPE.get() or ("async", asyncio.current_task())
            previous = self.leases.get(target.key)
            if previous is not None and previous != owner and self.scope_busy(previous):
                result = PluginResult(False, "computer_busy")
                return result
            self.leases[target.key] = owner
            lock = self.actions.setdefault(target.key, asyncio.Lock())
            if lock.locked():
                result = PluginResult(False, "computer_busy")
                return result
            await lock.acquire()
            self.vm.active[target.key] = self.vm.active.get(target.key, 0) + 1
            try:
                await self.vm.start(target)
                # A hold may have arrived while the desktop was starting. Never queue actions.
                if target.key in self.vm.held:
                    raise VmError("owner_holds_control")
                if tool.name == "vm_exec":
                    data = await self.vm.execute(target, arguments["command"], arguments.get("timeout_seconds", 60))
                    result = PluginResult(data["exit_code"] == 0, None if data["exit_code"] == 0 else "tool_error", json.dumps(data), data["truncated"])
                elif tool.name == "attach_file":
                    data = await self.vm.read_file(target, arguments["path"], limit=MAX_FILE_BYTES)
                    name = PurePosixPath(arguments["path"]).name
                    attachment = await asyncio.to_thread(self.attachments.save,
                        Attachment(name, mimetypes.guess_type(name)[0] or "application/octet-stream", data))
                    result = PluginResult(True, text=json.dumps({"attachment": attachment.metadata()}))
                else:
                    async with self.bridge(self.vm, target) as client:
                        data = await client.request("tools/call", {"name": tool.name, "arguments": dict(arguments)})
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
                    combined = "\n".join(text)
                    result = PluginResult(not data.get("isError", False), "tool_error" if data.get("isError") else None,
                        combined[:20_000], len(combined) > 20_000, blocks=blocks)
            finally:
                self.vm.active[target.key] -= 1
                self.vm.last_activity[target.key] = self.vm.clock()
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
            self._audit(key, "ok" if result.ok else result.kind or "error", approver, task_id)

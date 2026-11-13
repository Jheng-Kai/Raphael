"""Owner-PC commands share production snapshots, confirmations and metadata-only audit."""

import asyncio
import json
import re
import uuid
from contextvars import ContextVar
from functools import wraps
from pathlib import Path

from jsonschema import Draft202012Validator

from ..agent.plugins import PluginResult, PluginTool, tool_key
from ..agent.permissions import qualifies
from ..agent.policy import UNATTENDED_WAIT_S, Tier
from ..agent.data_floor import DataFloor, WRITE_REFUSAL
from ..brain.settings import SettingsStore
from ..integrations.audit import AuditLog
from .local_host import LocalHost, Output
from .local_patterns import DANGEROUS_PATTERNS

LOCAL_PREFIX = "mcp:local/"
BACKGROUND_WAIT_S = UNATTENDED_WAIT_S
FOREGROUND_TIMEOUT_S = 120
_CONTEXT = ContextVar("local_command_context", default=(None, True, False, "", False))
OUT_OF_REACH = ("The owner's own PC is out of reach here: it is only for a quick question asked through the overlay. "
                "Do the work on your own computer, or say plainly that it cannot be done.")
_DANGEROUS = [re.compile(pattern, re.I | re.S) for pattern, _ in DANGEROUS_PATTERNS]
# These patterns are best effort, not a shell parser or sandbox. The owner card is the real gate.
_SECRET = re.compile(r"\.env(?:[.\\/\s'\"]|$)|\.codex[\\/]auth\.json|\.claude[\\/]channels|\b(?:cmdkey|vaultcmd|mimikatz|Get-StoredCredential|CredEnumerate|CredRead)\b", re.I)
_OPAQUE = re.compile(r"-(?:enc(?:odedcommand)?|file)\b|\b(?:iex|invoke-expression|Start-Process|Invoke-Command)\b|\b(?:claude|codex|python|node|ruby|perl|powershell|pwsh)(?:\.exe)?\b|\.(?:ps1|cmd|bat|exe)\b", re.I)

EXEC_DESCRIPTION = (
    "Run one command on the owner's Windows PC for CPU, memory, disk, processes, network, files and logs. "
    "For Raphael itself use self_check first, never a whole-profile scan. Approval is enforced; foreground max 120 s. "
    "No interactive programs. Long claude -p or codex exec work uses background and the same card; it spends the owner's subscription."
)
EXEC_SCHEMA = {"type": "object", "properties": {
    "command": {"type": "string", "minLength": 1, "maxLength": 16000},
    "cwd": {"type": "string", "minLength": 1, "description": "Working folder; defaults to the owner's home."},
    "timeout_seconds": {"type": "number", "exclusiveMinimum": 0, "maximum": 86400},
    "background": {"type": "boolean", "description": "Return a job ID for a long command; local_job reads output or stops it."},
}, "required": ["command"], "additionalProperties": False}
JOB_SCHEMA = {"type": "object", "properties": {"job_id": {"type": "string"}, "stop": {"type": "boolean"}}, "required": ["job_id"], "additionalProperties": False}


def is_local(key):
    return key.startswith(LOCAL_PREFIX)


def command_of(arguments):
    """Find the literal command in a native CLI permission envelope."""
    if not isinstance(arguments, dict):
        return ""
    command = arguments.get("command")
    if isinstance(command, str):
        return command
    for key in ("input", "tool_input", "toolCall", "args", "details"):
        value = arguments.get(key)
        if isinstance(value, dict):
            command = value.get("command")
            if isinstance(command, str):
                return command
            for nested in ("input", "args"):
                part = value.get(nested)
                if isinstance(part, dict) and isinstance(part.get("command"), str):
                    return part["command"]
    return ""


def requires_command_approval(settings, command, *, external):
    if settings.get("action_mode") == "bypass":
        return False
    return (settings.get("local_commands_mode") != "always" or external
            or any(p.search(command) for p in _DANGEROUS) or bool(_OPAQUE.search(command)))


def ask_context(ask, results=()):
    external = bool(ask.memory_untrusted or ask.attachments or ask.nested or any(getattr(r, "untrusted", False) for r in results)
                    or any(s.tool in ("web_search", "web_read", "read_attachment") or s.server not in (None, "Raphael", "local") for s in ask.steps))
    # The last cell: only a quick question reaches the owner's own PC (R-PC-01); every other turn is refused in `call`.
    return (("chat", ask.speaker.id, ask.conversation_id), external,
            qualifies(source=ask.source, quick=ask.quick, nested=ask.nested, scope=ask.scope), ask.session_id,
            bool(ask.quick and not ask.nested))


def run_context(run):
    return (("task", run.task_id), bool(run._memory_untrusted or run.attachments), True, "", False)


def command_context(select):
    def decorate(function):
        @wraps(function)
        async def scoped(*args, **kwargs):
            token = _CONTEXT.set(select(*args, **kwargs))
            try:
                return await function(*args, **kwargs)
            finally:
                _CONTEXT.reset(token)
        return scoped
    return decorate


class LocalTools:
    def __init__(self, delegate, conn, *, host=None, enabled=True):
        self.delegate, self.conn = delegate, conn
        self.settings, self.audit = SettingsStore(conn), AuditLog(conn)
        self.data_floor = DataFloor(conn)
        self.host, self.enabled = host or LocalHost(), enabled
        self.jobs = {}

    def __getattr__(self, name):
        return getattr(self.delegate, name)

    def offered_for(self, member_id):
        offered = getattr(self.delegate, "offered_for", lambda _: self.delegate.offered())(member_id)
        native = [PluginTool(tool_key("local", "local_exec"), "local", "local_exec", EXEC_DESCRIPTION, EXEC_SCHEMA, Tier.T2, pinned=True),
                  PluginTool(tool_key("local", "local_job"), "local", "local_job", "Read bounded output/state of your local command job, or stop its process tree. Jobs belong to this conversation or task.", JOB_SCHEMA, Tier.T0, pinned=True)]
        return [*offered, *native]

    def offered(self):
        return self.offered_for(0)

    def tier_of(self, key):
        return Tier.T2 if key == tool_key("local", "local_exec") else Tier.T0 if is_local(key) else self.delegate.tier_of(key)

    def _full_permission(self):
        return self.settings.get("action_mode") == "bypass"

    def requires_approval(self, arguments):
        return (self.data_floor.access("local_exec", arguments) is not None
                or requires_command_approval(self.settings, arguments.get("command", ""), external=_CONTEXT.get()[1]))

    def tier_for_call(self, key, arguments):
        if not is_local(key):
            return getattr(self.delegate, "tier_for_call", lambda k, a: self.delegate.tier_of(k))(key, arguments)
        schema = JOB_SCHEMA if key.endswith("/local_job") else EXEC_SCHEMA
        if not Draft202012Validator(schema).is_valid(arguments):
            return Tier.T0
        if key.endswith("/local_job") or self.settings.get("local_commands_mode") == "never" or _SECRET.search(str(arguments)) or not _CONTEXT.get()[2]:
            return Tier.T0
        return Tier.T2 if self.requires_approval(arguments) else Tier.T0

    def kind_of(self, server, name):
        return "write" if server == "local" else self.delegate.kind_of(server, name)

    def kind_for_call(self, server, name, arguments):
        return self.kind_of(server, name) if server == "local" else getattr(self.delegate, "kind_for_call", lambda s, n, a: self.delegate.kind_of(s, n))(server, name, arguments)

    def record_unrun(self, key, *, outcome, task_id=None):
        if is_local(key):
            self.audit.add(server="local", tool=key.split("/")[-1], tier="T2", approver="none", outcome=outcome, task_id=task_id)
        else:
            self.delegate.record_unrun(key, outcome=outcome, task_id=task_id)

    async def call(self, key, arguments, *, approver, task_id=None, pool=None):
        if not is_local(key):
            return await self.delegate.call(key, arguments, approver=approver, task_id=task_id, **({"pool": pool} if pool is not None else {}))
        result = PluginResult(False, "approval_required", "This local command needs the owner's approval in the app. Wait for that approval before trying it again.")
        outcome = "blocked"
        background = False
        try:
            owner, external, present, session, owner_pc = _CONTEXT.get()
            schema = JOB_SCHEMA if key.endswith("/local_job") else EXEC_SCHEMA
            if key not in (tool_key("local", "local_exec"), tool_key("local", "local_job")) or not Draft202012Validator(schema).is_valid(arguments):
                return PluginResult(False, "bad_arguments")
            if not owner_pc:
                # Whatever the permission mode: 全部允許 never reopens the owner's PC to an ordinary conversation, a room, a task or a phone.
                return PluginResult(False, "presence_required", OUT_OF_REACH)
            access = self.data_floor.access(key, arguments)
            if access == "write":
                return PluginResult(False, "protected_data", WRITE_REFUSAL)
            if (not present and not self._full_permission()) or owner is None:
                return PluginResult(False, "presence_required", "A quick question cannot show the card a local command needs, so nothing was run. Tell the owner plainly that it cannot be done here.")
            if key.endswith("/local_job"):
                job = self.jobs.get(arguments["job_id"])
                if job is None or job["owner"] != owner:
                    return PluginResult(False, "not_found")
                if arguments.get("stop"):
                    job["task"].cancel()
                    await asyncio.gather(job["task"], return_exceptions=True)
                data = {"job_id": arguments["job_id"], "state": "stopped" if job["task"].cancelled() else "done" if job["task"].done() else "running", "stdout": job["output"].text(), "stderr": job["errors"].text(), "truncated": job["output"].truncated or job["errors"].truncated}
                if job["task"].done() and not job["task"].cancelled():
                    data.update(job["task"].result())
                result = PluginResult(True, text=json.dumps(data))
                return result
            if self.settings.get("local_commands_mode") == "never":
                return PluginResult(False, "disabled", "Local commands are off. Enable them in Settings > Raphael > Local commands.")
            if access is None and (_SECRET.search(arguments["command"]) or _SECRET.search(arguments.get("cwd", ""))):
                return PluginResult(False, "secret_store", "Reading secret stores is refused.")
            if not self.enabled:
                return PluginResult(False, "disabled", "Local commands are disabled in this test environment.")
            if approver == "none" or self.requires_approval(arguments) and approver != "user":
                return result
            timeout = arguments.get("timeout_seconds", 60 if arguments.get("background") else FOREGROUND_TIMEOUT_S)
            if not arguments.get("background"):
                timeout = min(timeout, FOREGROUND_TIMEOUT_S)
            params = {"cwd": arguments.get("cwd") or str(Path.home()), "timeout_seconds": timeout}
            if arguments.get("background"):
                if len(self.jobs) >= 64:
                    for old, job in list(self.jobs.items()):
                        if job["task"].done():
                            del self.jobs[old]
                if len(self.jobs) >= 64:
                    return PluginResult(False, "job_limit")
                job_id, output, errors = uuid.uuid4().hex, Output(), Output()
                audit_id = self.audit.add(server="local", tool="local_exec", tier="T2", approver=approver, outcome="ok", task_id=task_id)
                task = asyncio.create_task(self._execute(arguments["command"], output=output, errors=errors, audit=audit_id, **params))
                self.jobs[job_id] = {"task": task, "owner": owner, "session": session, "output": output, "errors": errors}
                background = True
                result = PluginResult(True, text=json.dumps({"job_id": job_id, "state": "running"}))
            else:
                data = await self._execute(arguments["command"], **params)
                outcome = "timeout" if data.get("timed_out") else "error" if data.get("error") else "ok"
                if data.get("timed_out"):
                    data["error"] = "timeout"
                    data["message"] = "The command timed out and was stopped. Output may be partial. Use background:true for long commands."
                result = PluginResult(outcome == "ok", kind=data.get("error"), text=json.dumps(data), truncated=data.get("truncated", False))
            return result
        except asyncio.CancelledError:
            outcome = "denied"
            raise
        finally:
            if not background:
                self.audit.add(server="local", tool=key.split("/")[-1], tier="T2", approver=approver,
                               outcome="ok" if result.ok and outcome == "blocked" else outcome, task_id=task_id)

    async def _execute(self, command, *, audit=None, **params):
        outcome = "denied"
        try:
            result = await self.host.execute(command, **params)
            outcome = "timeout" if result.get("timed_out") else "error" if result.get("error") else "ok"
            return result
        except OSError as error:
            outcome = "error"
            return {"error": type(error).__name__}
        finally:
            if audit is not None:
                self.audit.settle(audit, outcome)

    def stop_session(self, session):
        for job in self.jobs.values():
            if job["session"] == session:
                job["task"].cancel()

    async def stop_task(self, task_id):
        tasks = [job["task"] for job in self.jobs.values() if job["owner"] == ("task", task_id)]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def aclose(self):
        tasks = [job["task"] for job in self.jobs.values()]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

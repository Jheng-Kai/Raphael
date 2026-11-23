"""Owner-PC commands share production snapshots, confirmations and metadata-only audit."""

import asyncio
import json
import os
import re
import sys
import uuid
from contextvars import ContextVar
from functools import wraps
from pathlib import Path

from jsonschema import Draft202012Validator

from ..agent.plugins import PluginResult, PluginTool, tool_key
from ..agent.permissions import owner_screen as reaches_owner_screen, qualifies
from ..agent.policy import UNATTENDED_WAIT_S, Tier
from ..agent.data_floor import DataFloor, WRITE_REFUSAL
from ..brain.settings import SettingsStore
from ..integrations.audit import AuditLog
from .local_host import LocalHost, Output
from .local_patterns import DANGEROUS_PATTERNS, MAC_DANGEROUS_PATTERNS
from .file_tools import VmError
from .on_screen import launches_on_screen
from .owner_files import DEFINITIONS as OWNER_FILE_DEFINITIONS, READS as OWNER_FILE_READS, SERVER as OWNER_FILES, OwnerFileTools
from .owner_files import WRITES as OWNER_FILE_WRITES, place as owner_place

LOCAL_PREFIX = "mcp:local/"
BACKGROUND_WAIT_S = UNATTENDED_WAIT_S
DEFAULT_TIMEOUT_S = 600
MAX_TIMEOUT_S = 3600
# Who runs the command, whether it read outside content, whether its chat can show a card, its session, and whether the
# owner's screen is in reach (a quick question alone, `permissions.owner_screen`).
# (owner of the call, external content seen, owner present, session, may show on the owner's screen, member id)
_CONTEXT = ContextVar("local_command_context", default=(None, True, False, "", False, 0))
ON_SCREEN = ("Nothing was run: this command would show something on the owner's screen, and only a quick question shows "
             "anything there. Open pages, programs and files on your own computer with its tools. To run a program and "
             "read what it prints, run it directly, without opening a window.")
NO_CARD = ("Nothing was run: a local command needs the owner's yes on a card, and this conversation cannot show one. "
           "Tell the owner plainly that it can be asked for in a private conversation in the app.")
# These patterns are best effort, not a shell parser or sandbox. The owner card is the real gate.
_SECRET_WINDOWS = r"\.env(?:[.\\/\s'\"]|$)|\.codex[\\/]auth\.json|\.claude[\\/]channels|\b(?:cmdkey|vaultcmd|mimikatz|Get-StoredCredential|CredEnumerate|CredRead)\b"
# A Mac's secret store is the Keychain: its command-line reads and exports, and its files.
_SECRET_MAC = (r"|\bsecurity\s+(?:find-(?:generic|internet)-password|find-certificate|find-identity|dump-keychain|"
               r"export|unlock-keychain|show-keychain-info)\b|library[\\/]keychains\b|\bkeychain-db\b")
_OPAQUE_WINDOWS = r"-(?:enc(?:odedcommand)?|file)\b|\b(?:iex|invoke-expression|Start-Process|Invoke-Command)\b|\b(?:claude|codex|python|node|ruby|perl|powershell|pwsh)(?:\.exe)?\b|\.(?:ps1|cmd|bat|exe)\b"
# On a Mac a script or an AppleScript runs what nobody reads in the command itself.
_OPAQUE_MAC = r"|\b(?:osascript|bash|zsh|sh|swift)\b|\.(?:sh|command|scpt|zsh)\b"


def safety_patterns(platform):
    """The patterns that ask the owner first, that refuse secret stores and that see an opaque command, for the
    system `platform` (`sys.platform`): Windows' and Linux's, and on macOS also the Mac's own."""
    mac = platform == "darwin"
    dangerous = [re.compile(pattern, re.I | re.S)
                 for pattern, _ in [*DANGEROUS_PATTERNS, *(MAC_DANGEROUS_PATTERNS if mac else [])]]
    secret = re.compile(_SECRET_WINDOWS + (_SECRET_MAC if mac else ""), re.I)
    opaque = re.compile(_OPAQUE_WINDOWS + (_OPAQUE_MAC if mac else ""), re.I)
    return dangerous, secret, opaque


_DANGEROUS, _SECRET, _OPAQUE = safety_patterns(sys.platform)
_INSTALL = re.compile(
    r"\b(?:npm|pnpm|pip3?|uv|winget|choco|scoop|brew|apt(?:-get)?|dnf|conda|poetry|gem|cargo)"
    r"(?:\.exe|\.cmd)?\s+(?:pip\s+)?(?:install|add|i|ci)\b"
    r"|\b(?:msiexec(?:\.exe)?\s+[/\-]i|Install-(?:Module|Package|Script)|ollama\s+pull"
    r"|(?:huggingface-cli|hf)\s+download|snapshot_download\s*\()", re.I,
)
INSTALL_IN_VM = "Task installs belong in the virtual machine. If you use Raphael Chrome, explain the need for a VM."


def installs_software(command):
    return bool(_INSTALL.search(command))

# Held to 400 characters: it is listed in every turn and task.
EXEC_DESCRIPTION = (
    "Run a hidden command on the owner's Windows PC for CPU, memory, disk, processes, network, files and logs; outside "
    "a quick question one that opens a program, a page or a file on its screen is refused. For Raphael itself use "
    "self_check first. Approval is required; 600 s default, up to 3600 s. No interactive apps. Long claude -p or codex exec "
    "work uses background; it spends the owner's subscription."
)
if sys.platform == "darwin":
    EXEC_DESCRIPTION = (
        "Run one hidden zsh command on the owner's Mac for CPU, memory, disk, processes, network, files and logs; outside "
        "a quick question one that opens an app, a page or a file on its screen is refused. For Raphael itself use "
        "self_check first. Approval is required; 600 s default, up to 3600 s. No interactive apps. Long claude -p or codex "
        "exec work uses background; it spends the owner's subscription."
    )
EXEC_SCHEMA = {"type": "object", "properties": {
    "command": {"type": "string", "minLength": 1, "maxLength": 16000},
    "cwd": {"type": "string", "minLength": 1, "description": "Working folder; defaults to the owner's home."},
    "timeout_seconds": {"type": "number", "exclusiveMinimum": 0, "maximum": MAX_TIMEOUT_S},
    "background": {"type": "boolean", "description": "Return a job ID for a long command; local_job reads output or stops it."},
}, "required": ["command"], "additionalProperties": False}
JOB_SCHEMA = {"type": "object", "properties": {"job_id": {"type": "string"}, "stop": {"type": "boolean"}}, "required": ["job_id"], "additionalProperties": False}


def is_local(key):
    return key.startswith(LOCAL_PREFIX)


def owner_file_tool(key):
    """The name of one of the owner's file tools (`owner_files`), or None. Like the local commands they are offered to
    every turn and task (R-PC-04), but without a card: reading is the whole computer's, writing only the owner's folders'."""
    prefix = tool_key(OWNER_FILES, "")
    name = key[len(prefix):] if key.startswith(prefix) else None
    return name if name in OWNER_FILE_DEFINITIONS else None


def card_arguments(key, arguments):
    """The arguments as the question for a call shows them. A write of the owner's file tools names the file it will
    write, with `~` and links resolved as `OwnerFileTools.writable` judged it, not the path as the member wrote it: the
    owner approves the place the write lands. The action that is approved keeps the arguments as they were."""
    if owner_file_tool(key) not in OWNER_FILE_WRITES or not isinstance(arguments.get("path"), str):
        return arguments
    try:
        return {**arguments, "path": owner_place(arguments["path"])}
    except (VmError, OSError, ValueError):
        return arguments


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


def command_folder(settings, member_id, folders=None):
    """Start a command in the member's work folder when it names no directory."""
    from ..folders import default_folders, work_folder
    from .vm import bound_folder
    folders = folders or default_folders
    own = folders(member_id)[0]
    project = work_folder(settings, member_id, folders)
    if project != own and project.is_dir():
        return str(project)
    bound_folder(own)
    return str(own)


def requires_command_approval(settings, command, *, external):
    if settings.get("action_mode") == "bypass":
        return False
    return (settings.get("local_commands_mode") != "always" or external
            or any(p.search(command) for p in _DANGEROUS) or bool(_OPAQUE.search(command)))


def ask_context(ask, results=()):
    external = bool(ask.memory_untrusted or ask.attachments or ask.nested or any(getattr(r, "untrusted", False) for r in results)
                    or any(s.tool in ("web_search", "web_read", "read_attachment") or s.server not in (None, "Raphael", "local") for s in ask.steps))
    # The last cell: only a quick question shows anything on the owner's screen (R-PC-01); every other turn's command that
    # would is refused in `call` (R-PC-06).
    return (("chat", ask.speaker.id, ask.conversation_id), external,
            qualifies(source=ask.source, quick=ask.quick, nested=ask.nested, scope=ask.scope), ask.session_id,
            reaches_owner_screen(source=ask.source, quick=ask.quick, nested=ask.nested), ask.speaker.id)


def run_context(run):
    # A task asks through its waiting question (`present`), and never shows anything on the owner's screen. Its member's
    # folders are the ones it may write to.
    task = run._store.get(run.task_id)
    return (("task", run.task_id), bool(run._memory_untrusted or run.attachments), True, "", False, task.member_id if task else 0)


def shows_on_screen(key, arguments):
    """Whether this call of a local command would show something on the owner's screen where only a quick question may
    (R-PC-06): refused in `call` whatever the permission mode, so nothing asks for it."""
    return (key == tool_key("local", "local_exec") and isinstance(arguments, dict) and isinstance(arguments.get("command"), str)
            and not _CONTEXT.get()[4] and launches_on_screen(arguments["command"]))


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
        self.owner_files = OwnerFileTools(self.settings, self.data_floor)

    def __getattr__(self, name):
        return getattr(self.delegate, name)

    def offered_for(self, member_id):
        offered = getattr(self.delegate, "offered_for", lambda _: self.delegate.offered())(member_id)
        native = [PluginTool(tool_key("local", "local_exec"), "local", "local_exec", EXEC_DESCRIPTION, EXEC_SCHEMA, Tier.T2, pinned=True),
                  PluginTool(tool_key("local", "local_job"), "local", "local_job", "Read bounded output/state of your local command job, or stop its process tree. Jobs belong to this conversation or task.", JOB_SCHEMA, Tier.T0, pinned=True)]
        files = [PluginTool(tool_key(OWNER_FILES, name), OWNER_FILES, name, item["description"], item["parameters"],
                            Tier.T0 if name in OWNER_FILE_READS else Tier.T2, pinned=True, whole=True)
                 for name, item in OWNER_FILE_DEFINITIONS.items()]
        return [*offered, *native, *files]

    def offered(self):
        return self.offered_for(0)

    def tier_of(self, key):
        if (name := owner_file_tool(key)) is not None:
            return Tier.T0 if name in OWNER_FILE_READS else Tier.T2
        return Tier.T2 if key == tool_key("local", "local_exec") else Tier.T0 if is_local(key) else self.delegate.tier_of(key)

    def _full_permission(self):
        return self.settings.get("action_mode") == "bypass"

    def shared_owner_file(self, key, arguments):
        name = owner_file_tool(key)
        return (name is not None and Draft202012Validator(OWNER_FILE_DEFINITIONS[name]["parameters"]).is_valid(arguments)
                and self.owner_files.shared_path(arguments.get("path"), _CONTEXT.get()[5]))

    def requires_approval(self, arguments):
        return (self.data_floor.access("local_exec", arguments) is not None
                or requires_command_approval(self.settings, arguments.get("command", ""), external=_CONTEXT.get()[1]))

    def tier_for_call(self, key, arguments):
        if (name := owner_file_tool(key)) is not None:
            # A read asks nothing; a write outside the owner's folders is refused in `call`, so nothing asks for it.
            schema = OWNER_FILE_DEFINITIONS[name]["parameters"]
            if name in OWNER_FILE_READS or not Draft202012Validator(schema).is_valid(arguments) or not self.owner_files.writable(arguments, _CONTEXT.get()[5]):
                return Tier.T0
            return Tier.T2
        if not is_local(key):
            return getattr(self.delegate, "tier_for_call", lambda k, a: self.delegate.tier_of(k))(key, arguments)
        schema = JOB_SCHEMA if key.endswith("/local_job") else EXEC_SCHEMA
        if not Draft202012Validator(schema).is_valid(arguments):
            return Tier.T0
        if (key.endswith("/local_job") or self.settings.get("local_commands_mode") == "never" or _SECRET.search(str(arguments))
                or not _CONTEXT.get()[2] or shows_on_screen(key, arguments)
                or self._task_install(arguments)):
            return Tier.T0
        return Tier.T2 if self.requires_approval(arguments) else Tier.T0

    def kind_of(self, server, name):
        if server == OWNER_FILES:
            return "read" if name in OWNER_FILE_READS else "write"
        return "write" if server == "local" else self.delegate.kind_of(server, name)

    def kind_for_call(self, server, name, arguments):
        return self.kind_of(server, name) if server in ("local", OWNER_FILES) else getattr(self.delegate, "kind_for_call", lambda s, n, a: self.delegate.kind_of(s, n))(server, name, arguments)

    def record_unrun(self, key, *, outcome, task_id=None):
        if (name := owner_file_tool(key)) is not None:
            self.audit.add(server=OWNER_FILES, tool=name, tier=self.tier_of(key).name, approver="none", outcome=outcome, task_id=task_id)
        elif is_local(key):
            self.audit.add(server="local", tool=key.split("/")[-1], tier="T2", approver="none", outcome=outcome, task_id=task_id)
        else:
            self.delegate.record_unrun(key, outcome=outcome, task_id=task_id)

    def _task_install(self, arguments):
        return (getattr(self.delegate, "enforces_computer_choice", False) is True
                and not _CONTEXT.get()[4] and installs_software(arguments.get("command", "")))

    async def call(self, key, arguments, *, approver, task_id=None, pool=None):
        if (name := owner_file_tool(key)) is not None:
            return await self._owner_file(key, name, arguments, approver=approver, task_id=task_id)
        if not is_local(key):
            return await self.delegate.call(key, arguments, approver=approver, task_id=task_id, **({"pool": pool} if pool is not None else {}))
        result = PluginResult(False, "approval_required", "This local command needs the owner's approval in the app. Wait for that approval before trying it again.")
        outcome = "blocked"
        background = False
        try:
            owner, external, present, session, _screen, member = _CONTEXT.get()
            schema = JOB_SCHEMA if key.endswith("/local_job") else EXEC_SCHEMA
            if key not in (tool_key("local", "local_exec"), tool_key("local", "local_job")) or not Draft202012Validator(schema).is_valid(arguments):
                return PluginResult(False, "bad_arguments")
            if self._task_install(arguments):
                return PluginResult(False, "assigned_computer_required", INSTALL_IN_VM)
            if shows_on_screen(key, arguments):
                # Whatever the permission mode, 全部允許 included: what is seen is shown on the member's own computer.
                return PluginResult(False, "shows_on_screen", ON_SCREEN)
            access = self.data_floor.access(key, arguments)
            if access == "write":
                return PluginResult(False, "protected_data", WRITE_REFUSAL)
            if (not present and not self._full_permission()) or owner is None:
                return PluginResult(False, "presence_required", NO_CARD)
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
                return PluginResult(False, "disabled", "Local commands are off. The owner can ask Raphael to turn them back on.")
            if access is None and (_SECRET.search(arguments["command"]) or _SECRET.search(arguments.get("cwd", ""))):
                return PluginResult(False, "secret_store", "Reading secret stores is refused.")
            if not self.enabled:
                return PluginResult(False, "disabled", "Local commands are disabled in this test environment.")
            if approver == "none" or self.requires_approval(arguments) and approver != "user":
                return result
            timeout = min(arguments.get("timeout_seconds", DEFAULT_TIMEOUT_S), MAX_TIMEOUT_S)
            params = {"cwd": arguments.get("cwd") or command_folder(self.settings, member, self.owner_files.member_folders), "timeout_seconds": timeout}
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

    async def _owner_file(self, key, name, arguments, *, approver, task_id):
        if not Draft202012Validator(OWNER_FILE_DEFINITIONS[name]["parameters"]).is_valid(arguments):
            return PluginResult(False, "bad_arguments")
        owner = _CONTEXT.get()[0]
        result = await self.owner_files.call(name, arguments, approver=approver, run=owner or ("task", task_id),
                                             member_id=_CONTEXT.get()[5])
        self.audit.add(server=OWNER_FILES, tool=name, tier=self.tier_of(key).name, approver=approver,
                       outcome="ok" if result.ok else "blocked" if result.kind in ("kept", "not_writable", "approval_required",
                                                                                     "protected_data") else "error", task_id=task_id)
        return result

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

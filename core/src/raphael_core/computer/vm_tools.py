"""Local desktops as a PluginHub adapter, under the existing gate and snapshots."""
# Adapted from OpenMausBot (Apache-2.0); see core/packaging/licenses/NOTICES.md.

from raphael_core.ui_words import ui_word, with_ui_words
import asyncio
import base64
import itertools
import json
import logging
import mimetypes
import re
import secrets
import shlex
import time
from contextlib import asynccontextmanager, contextmanager
from contextvars import ContextVar
from pathlib import PurePosixPath

from jsonschema import Draft202012Validator

from ..agent.plugins import PluginResult, PluginTool, tool_key
from ..agent.policy import Tier
from ..integrations.audit import AuditLog
from ..services.attachments import Attachment, MAX_FILE_BYTES, sniff_ok
from .vm import VmError, engine_start_allowed
from .vm_bridge import CuaBridge
from .vm_catalog import DRIVER_TOOLS, FRESH_READS, NATIVE_INPUT_TOOLS, NOTICES, PAGE_TOOLS, READS, SCREEN_READS, SHARED_ARGUMENTS, BROWSER_APPS, definition as driver_definition, offline_catalog, shared_argument_paths, shared_native_input
from .takeover import TAKEOVER
from . import seat_view
from ..worker.computer_verification import meaningful_expectation

_SCOPE = ContextVar("computer_scope", default=None)
_TURN = ContextVar("computer_turn", default=(0, False, None))
# Where a call that has to wait for the desktop says so: the line for the owner, and the language of the work.
_NOTE = ContextVar("computer_note", default=(None, "en"))
_REPAIRS = ContextVar("computer_repairs", default=None)
_NOTICE = ContextVar("computer_notice", default=None)
# Where the quiet line of a wake goes: a line of its own in the conversation, never a reply (R-TEXT-08).
_WOKE = ContextVar("computer_woke", default=None)
# Whose tool call is starting a sleeping computer right now: (member id, tool name). Unset for every other start.
_WAKE = ContextVar("computer_wake", default=None)
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
WAITING_FOR = with_ui_words({
    "zh-TW": "正在等 {who} 用完電腦",
    "ja": "{who} がコンピューターを使い終わるのを待っています",
    "en": "Waiting for {who} to finish with the computer",
})


# The line a member shows while Docker Desktop is being started for it (owner, 2026-11-11: 「理論上就算我沒有開 Docker，
# 它也會自動自己打開才對」); one line per start, the wait itself polls silently.
ENGINE_STARTING = with_ui_words({
    "zh-TW": "正在啟動 Docker Desktop 來準備電腦，大約需要一分鐘",
    "ja": "コンピューター用に Docker Desktop を起動しています。1分ほどかかります",
    "en": "Starting Docker Desktop for the computer; this takes about a minute",
})

# The line a member's own tool call leaves when it starts a sleeping computer (R-COMP-WAKE-01, owner, 2026-11-14: the
# computer wakes when a member decides a task needs it, or when he starts it, and never silently). One quiet line in the
# conversation, naming the member and why; no toast, and never a reply bubble (R-TEXT-08). The status's `woken` is no
# longer read by the app (R-PANEL-06).
WOKE = {reason: with_ui_words(table) for reason, table in {
    "page": {"zh-TW": "{who}為了開網頁喚醒了電腦", "ja": "{who}がウェブページを開くためにコンピューターを起こしました",
             "en": "{who} woke the computer to open a web page"},
    "command": {"zh-TW": "{who}為了執行指令喚醒了電腦", "ja": "{who}がコマンドを実行するためにコンピューターを起こしました",
                "en": "{who} woke the computer to run a command"},
    "other": {"zh-TW": "{who}為了使用電腦而將它喚醒", "ja": "{who}が使うためにコンピューターを起こしました",
              "en": "{who} woke the computer to use it"},
}.items()}


def wake_reason(tool):
    """Why a member's tool needed the computer: a page of the browser, a command in its shell, or anything else."""
    return "page" if tool.startswith(PAGE_TOOLS) else "command" if tool == "vm_exec" else "other"


@contextmanager
def _waking(member, tool):
    token = _WAKE.set((member, tool))
    try:
        yield
    finally:
        _WAKE.reset(token)


# What the model is told when Docker Desktop cannot be had, so it never meets a bare kind with nothing to do next.
DISK_FILES_EN = ("The disk the computer's files are kept on ({p0}) is {p1}% full, with {p2} free. The computer's own folders "
                 "hold only {p3} of it, so cleaning them up would not help. Free some space on {p0} itself.")


def _size_words(kib):
    return f"{kib / 1048576:.1f} GiB" if kib >= 1048576 else f"{kib / 1024:.0f} MiB"


ENGINE_FAILURES = {
    "docker_stopped": "Docker Desktop is not running, so the computer could not start. Tell the owner plainly that Docker Desktop "
                      "is not running, and that opening it (or pressing the computer's screen) lets you try again.",
    "docker_start_failed": "Raphael tried to start Docker Desktop and it could not be launched. Tell the owner plainly that "
                           "Docker Desktop did not start and ask them to open it themselves. Do not retry in a loop.",
    "docker_start_timeout": "Docker Desktop is still starting. Try this tool again once after about 30 seconds. If it fails "
                            "again, tell the owner plainly that Docker Desktop did not start.",
}


@contextmanager
def vm_scope(owner, *, turn_id=0, private=False, task=None, progress=None, notice=None, woke=None, language="en"):
    """`notice` is something the owner has to answer (the disk is nearly full), said as the member's own words; `woke` is
    the quiet line that a start by the member's own tool leaves, which is nothing the member said."""
    token = _SCOPE.set(owner)
    turn = _TURN.set((turn_id, private, task))
    note = _NOTE.set((progress, language))
    public_notice = _NOTICE.set(notice)
    public_woke = _WOKE.set(woke)
    try:
        yield
    finally:
        _SCOPE.reset(token)
        _TURN.reset(turn)
        _NOTE.reset(note)
        _NOTICE.reset(public_notice)
        _WOKE.reset(public_woke)


# A computer tool's description is shown to a model whole (PluginTool.whole) and says what the tool is for first.
# This rule used to come first and was more than twice as long, and a description is cut at 400 characters: all
# thirty-three tools read as its same opening words and not one said what it did (a member sent PowerShell to its
# Linux shell). How to work on the computer (look before acting, where files are kept) is in the member's
# instructions once (agent/persona.py), not on every tool.
VM_CONTRACT = (
    "VM sandbox: no per-action approval; owner control blocks all calls. Before sending a message/email, "
    "publishing/posting, deleting outside the workspace, or paying/buying, call approve (CLI) or the API "
    "harness equivalent and wait for the owner's yes for the exact action/target. If unavailable, denied "
    "or expired, stop. Sandbox success is not approval."
)
# Named: "files shared" beside vm_exec's "your own files are in /home/cua/workspace" read as two things.
SHARED_CONTRACT = (" Shared with other members, a screen each: /home/cua/workspace, the clipboard and sign-ins."
                   " The shell has no screen here; open a window with launch_app.")
# The tools that sentence is about. On every tool it would be said forty times over.
SHARED_NOTED = frozenset({"vm_exec", "launch_app", "clipboard_read", "clipboard_write"})

RUN_STEPS = {"description": "Perform 1–10 short driver actions, then return one window/page observation. Every step uses the ordinary gate and current control checks. Stop on the first failure; failed_step is one-based. Never batch shell commands, secrets, takeover or another composite. " + VM_CONTRACT,
    "parameters": {"type": "object", "properties": {
        "steps": {"type": "array", "minItems": 1, "maxItems": 10, "items": {"type": "object", "properties": {
            "name": {"type": "string", "enum": [name for name in DRIVER_TOOLS if name not in READS]},
            "arguments": {"type": "object"}}, "required": ["name", "arguments"], "additionalProperties": False}},
        "observation": {"type": "object", "properties": {"name": {"type": "string", "enum": ["get_window_state", "get_browser_state", "verify_state"]},
            "arguments": {"type": "object"}}, "required": ["name", "arguments"], "additionalProperties": False}},
        "required": ["steps", "observation"], "additionalProperties": False}}

EXEC = {"description": "Run a Linux shell command (sh, not PowerShell) inside the VM workspace, never on the host. Your own files are in /home/cua/workspace; /home/cua/team is the folder the whole team shares, so what a colleague or the owner needs goes there. Nothing it does shows on the screen the owner watches: use it for files and programs, never to fetch a page in place of opening it in the browser. It waits for the command for at most timeout_seconds (60 by default, 1800 at most) and ends it then. For a build or a server that takes longer, or to work on while it runs, set background: it returns at once with a job and the paths of its log and of its .exit file (the exit code, there once the job has ended); read them with another vm_exec. Other members' commands and the screen are not held up by it. " + VM_CONTRACT,
        "parameters": {"type": "object", "properties": {"command": {"type": "string", "minLength": 1},
        "timeout_seconds": {"type": "number", "exclusiveMinimum": 0, "maximum": 21600},
        "background": {"type": "boolean"}}, "required": ["command"], "additionalProperties": False}}
ATTACH = {"description": "Copy an existing file from /home/cua/workspace or /home/cua/team into Raphael's attachment store and return its attachment ID. Paths elsewhere are refused.",
          "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"], "additionalProperties": False}}
BROWSER_OPEN = {"description": "Open an http/https URL in the member's persistent browser and return its semantic page references without a screenshot. Use the typed browser tools for follow-ups. " + VM_CONTRACT,
    "parameters": {"type": "object", "properties": {"url": {"type": "string", "pattern": "^https?://", "maxLength": 8192},
        "query": {"type": "string"}, "scope_ref": {"type": "string"}}, "required": ["url"], "additionalProperties": False}}
FILL_LOGIN = {"description": "Use vault_entries labels and owner hints to choose a saved login; if two fit, ask_owner. Fill only the current exact HTTPS origin. Never submit or request private values in chat; use request_takeover for owner-only steps. Legacy request_secret(site) references still work. " + VM_CONTRACT,
    "parameters": {"type": "object", "properties": {key: {"type": "string", "minLength": 1, "maxLength": 2048} for key in
        ("reference", "site", "target_id", "username_ref", "password_ref")},
        "required": ["reference", "site", "target_id", "username_ref", "password_ref"], "additionalProperties": False}}

ENTRY_CHOICES = {"description": "List the saved entries this member may use: opaque IDs, kinds, labels and owner hints only. Choose by the owner's hint. If two entries fit, ask_owner before choosing. Never ask for private values in chat.",
    "parameters": {"type": "object", "properties": {}, "additionalProperties": False}}


def fill_definition(kind, fields):
    properties = {key: {"type": "string", "minLength": 1, "maxLength": 2048} for key in ("reference", "site", "target_id", "label")}
    properties["fields"] = {"type": "object", "properties": {key: {"type": "string", "minLength": 1} for key in fields},
                            "minProperties": 1, "additionalProperties": False}
    if kind == "card":
        properties["amount"] = {"type": "string", "maxLength": 120}
    guidance = ("Every use needs owner approval naming site/merchant, visible amount (empty if absent), and label. Never pay/submit; request_takeover lets the owner finish. " if kind == "card" else "Never submit or request private values in chat. ")
    return {"description": f"Fill a saved {kind}. " + guidance + "Use vault_entries labels/hints; if two fit, ask_owner. fields maps private field names to page refs, never values. Exact HTTPS site and label are required. " + VM_CONTRACT,
            "parameters": {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}}


FILL_CONTACT = fill_definition("contact", ("name", "address", "phone", "email"))
FILL_CARD = fill_definition("card", ("name", "number", "expiry", "cvc"))


class SavedFieldRefused(ValueError):
    """Fixed, value-free guidance for a saved field that cannot be safely selected."""


CLOSED_TAB_ATTACH = re.compile(
    r"cannot attach to tab target [0-9A-F]{32}: CDP Target\.attachToTarget failed \(-32602\): No target with given id found")


def closed_private_tab(reply, tab_id):
    """Whether the driver's answer to a read of exactly this tab proves the tab is gone.

    Driver 0.37.0 says it in two ways, both measured on real computers, each matched whole and only as measured:
    - a browser the seat attached to (shared): an error, refusal.message
      "confirmation provider failed: tab <tab id> no longer has a live CDP page target";
    - a browser the driver launched (per-bot): NOT an error, status "refused", refusal.code
      "browser_tab_not_found", refusal.message "cannot attach to tab target <CDP id>: CDP Target.attachToTarget
      failed (-32602): No target with given id found".
    A tab id the driver never knew has the same codes and other words ("tab <id> is not known for target ..."),
    so only the message tells; anything else keeps the mark.
    """
    data = reply.get("structuredContent") or {}
    refusal = data.get("refusal") or {}
    message = refusal.get("message")
    if not tab_id or not isinstance(message, str):
        return False
    if reply.get("isError"):
        return message == f"confirmation provider failed: tab {tab_id} no longer has a live CDP page target"
    return (data.get("status") == "refused" and refusal.get("code") == "browser_tab_not_found"
            and bool(CLOSED_TAB_ATTACH.fullmatch(message)))


class VmTools:
    # How long a member waits for another to finish with the screen, and how often it looks: a bounded wait,
    # then a result that says who holds it and for how long.
    busy_wait_s = 60.0
    busy_poll_s = 0.5
    # A holder that has not touched the screen for this long (it is thinking, or busy with commands) has let go
    # of it: another may take it, and the holder looks at it again when it comes back.
    lease_idle_s = 60.0
    read_progress_s = 10.0
    # A browser's first window took 13 to 41 s on a loaded PC (2026-11-13), so the waits for it are minutes' worth of
    # patience, not seconds': the member's call says it is still reading after `read_progress_s` and reports its elapsed
    # time. A window is polled with a growing pause, so a long wait is not a hundred driver calls.
    browser_window_wait_s = 60.0
    browser_window_poll_s = 0.2
    browser_window_poll_max_s = 1.0
    # Everything one browser_open may take: the window's own wait, a carry-over's budget, the seat's launcher script
    # (`LocalVm.seat_browser_s`) and the page's load and read. The launcher's own deadline ends first and says why.
    browser_open_s = 300.0
    # How long a window that was moved onto its screen is waited for before it is called outside it.
    window_fit_wait_s = 10.0

    def __init__(self, delegate, vm, *, attachments, conn=None, bridge=CuaBridge):
        self.delegate, self.vm, self.attachments, self.bridge = delegate, vm, attachments, bridge
        # What a member is called (told by the app), when each holder took the screen and last used it, and the
        # (desktop, scope) pairs whose picture of the screen is out of date because another used it since.
        self.names = lambda member_id: None
        self.lease_since, self.lease_used, self.stale = {}, {}, set()
        self.commands = {}  # the shell commands under way on each desktop: they are not input at the screen
        self.audit = AuditLog(conn) if conn is not None else None
        self.conn = conn
        self.catalogs, self.tools, self.routes, self.locks, self.actions = {}, {}, {}, {}, {}
        self.schemas = {}
        self.problem = None
        self.leases = {}
        self.scope_busy = lambda scope: scope[0] == "async" and not scope[1].done()
        self.vm.busy = lambda key: key in self.leases and self.scope_busy(self.leases[key])
        self.listed = set()
        self.connections, self.labels = {}, itertools.count(1)
        # The driver in a running computer remembers every session label that has ended and refuses it for good. A
        # core that starts again beside a computer still running must therefore never count from 1 once more.
        self.session_prefix = f"raphael-{secrets.token_hex(4)}"
        self.connection_locks, self.native_actions = {}, {}
        self.native_owners = {}
        self.vm.native_busy = lambda target: bool(self.native_actions.get(target.state_key) and self.native_actions[target.state_key].locked())
        self.vm.input_busy = lambda target: self.vm.active.get(target.key, 0) > self.commands.get(target.key, 0)
        self.logins = None
        self.private_pages = {}
        self.page_windows = {}
        self.page_tabs = {}
        self.page_refs = {}
        self.payment_holds = set() if conn is None else {row[0] for row in conn.execute("SELECT target FROM computer_payment_holds")}
        self.checkpointed, self.checkpoint_locks = set(), {}
        self.refreshes = {}
        self.step_gate = None
        self.vm.rebuild_notice = self._rebuild_notice
        self.vm.engine_notice = self._engine_notice
        self.vm.wake_notice = self._wake_notice
        self.vm.disconnect_driver = self._disconnect
        self.vm.repair_admit = self._repair_admit
        self.vm.seat_observation = self.seat_observation

    def _repair_admit(self, target):
        attempts = _REPAIRS.get()
        if attempts is None:
            return True  # The viewer has its own single retry outside a member call.
        if target.physical in attempts:
            return False
        attempts.add(target.physical)
        return True

    def _engine_notice(self, target):
        progress, language = _NOTE.get()
        if progress:
            progress(ENGINE_STARTING.get(language, ENGINE_STARTING["en"]))

    def _wake_notice(self, target):
        """A computer was just started. If it was a member's own tool that did it, say who and why, once, in that member's
        conversation (or task); a start the owner asked for leaves no record, and clears the last one."""
        wake = _WAKE.get()
        if wake is None:
            self.vm.woken.pop(target.state_key, None)
            return
        member, tool = wake
        who = self.names(member) or ("Raphael" if member == 0 else f"#{member}")
        reason = wake_reason(tool)
        self.vm.woken[target.state_key] = {"member": member, "name": who, "reason": reason}
        progress, language = _NOTE.get()
        publish = _WOKE.get() or progress
        if publish:
            table = WOKE[reason]
            publish(table.get(language, table["en"]).format(who=who))

    async def _disk_notice(self, target):
        from .lifecycle import disk_pressure
        progress, language = _NOTE.get()
        publish = _NOTICE.get() or progress
        if not publish:
            return
        try:
            pressure = await disk_pressure(self.vm, target)
        except (VmError, OSError, TimeoutError):
            return  # Disk diagnostics never block the owner's work.
        if not pressure:
            return
        if pressure.disk == "files" and not pressure.folders_matter:
            # The disk that is full is not the computer's: folders of a few hundred MiB are not what fills it.
            fields = (pressure.filesystem, pressure.percent, _size_words(pressure.free_kib), _size_words(pressure.own_kib))
            publish(with_ui_words({"zh-TW": f"存放電腦檔案的磁碟（{fields[0]}）已用 {fields[1]}%，只剩 {fields[2]}。電腦自己的資料夾只佔 {fields[3]}，清理它們幫不上忙，需要在 {fields[0]} 本身騰出空間。",
                "ja": f"コンピューターのファイルを置いているディスク（{fields[0]}）が {fields[1]}% 使用され、空きは {fields[2]} です。コンピューター自身のフォルダーは {fields[3]} しかないため、整理しても効果はありません。{fields[0]} 自体の空きを増やしてください。",
                "en": DISK_FILES_EN.format(p0=fields[0], p1=fields[1], p2=fields[2], p3=fields[3])},
                lambda _ui_language: ui_word(DISK_FILES_EN, _ui_language).format(p0=fields[0], p1=fields[1], p2=fields[2], p3=fields[3])).get(language,
                DISK_FILES_EN.format(p0=fields[0], p1=fields[1], p2=fields[2], p3=fields[3])))
            return
        names = ", ".join(f"{path} ({size / 1024:.0f} MiB)" for size, path in pressure.folders)
        publish(with_ui_words({"zh-TW": f"電腦磁碟快滿了。最大的資料夾：{names}。要我清理哪些？刪除前會先徵求你的同意。",
            "ja": f"ディスクの空き容量が少なくなっています。大きいフォルダー：{names}。削除する前に確認します。どれを整理しますか？", "en": f"The computer disk is nearly full. Largest folders: {names}. Which should I clean up? I will ask before deleting anything."}, lambda _ui_language: ui_word('The computer disk is nearly full. Largest folders: {p0}. Which should I clean up? I will ask before deleting anything.', _ui_language).format(p0=names)).get(language,
            f"The computer disk is nearly full. Largest folders: {names}. Which should I clean up? I will ask before deleting anything."))

    def _rebuild_notice(self, target):
        progress, language = _NOTE.get()
        if progress:
            progress(with_ui_words({"zh-TW": "正在更新電腦映像，工作區與登入資料會保留", "ja": "コンピューターを更新します。ワークスペースとログインは保持されます", "en": "Updating the computer image; workspace and sign-ins will be preserved"}, lambda _ui_language: ui_word('Updating the computer image; workspace and sign-ins will be preserved', _ui_language)).get(language,
                "Updating the computer image; workspace and sign-ins will be preserved"))

    def bind_computer_gate(self, gate):
        self.step_gate = gate.call_plugin

    async def rendered_read(self, url):
        scope = _SCOPE.get()
        member, task_id = 0, None
        if not scope or not self.step_gate:
            return PluginResult(False, "blocked")
        if scope[0] == "turn":
            member = scope[1]
        elif scope[0] == "task" and self.conn is not None:
            task_id = scope[1]
            row = self.conn.execute("SELECT member_id FROM worker_tasks WHERE id=?", (task_id,)).fetchone()
            if row is None:
                return PluginResult(False, "blocked")
            member = row[0]
        else:
            return PluginResult(False, "blocked")
        await self.prepare(member)
        target = self.vm.target(member)
        # No computer here (computer tools off, or no Docker on this PC): nothing to read the page with.
        if not self.catalogs.get(target.key):
            return PluginResult(False, "blocked")
        # A page that reads short is not the member's decision to use its computer: a sleeping one stays asleep, and the
        # member is told the page needs a browser so it can call browser_open itself (R-COMP-WAKE-01). An awake one is
        # used as before: the same gate, the same audit, nothing started.
        if not await self._awake(target):
            return PluginResult(False, "computer_asleep")
        async def call(name, arguments):
            return await self.step_gate(tool_key(f"computer-{target.key}", name), arguments, task_id=task_id)
        opened = await call("browser_open", {"url": url})
        if not opened.ok:
            return opened
        try:
            page = json.loads(opened.text.splitlines()[-1])
        except (ValueError, IndexError):
            return opened
        # Only exact reject/essential-only buttons may be activated automatically.
        # Ambiguous/custom consent, sign-in and payment remain for the owner.
        labels = {"reject all", "reject all cookies", "reject non-essential cookies", "only necessary cookies",
                  "necessary cookies only", "拒絕全部", "拒絕所有 cookie", "僅必要 cookie", "すべて拒否"}
        def reject_ref(value):
            if isinstance(value, dict):
                label = str(value.get("name", value.get("label", ""))).strip().lower()
                if value.get("role") == "button" and label in labels and isinstance(value.get("ref"), str):
                    return value["ref"]
                for child in value.values():
                    if found := reject_ref(child):
                        return found
            elif isinstance(value, list):
                for child in value:
                    if found := reject_ref(child):
                        return found
            return None
        if ref := reject_ref(page):
            tab = {key: page[key] for key in ("target_id", "tab_id") if key in page}
            if "tab_id" not in tab:
                active = next((item for item in page.get("tabs", []) if item.get("active")), {})
                if active.get("tab_id"):
                    tab["tab_id"] = active["tab_id"]
            if not {"target_id", "tab_id"} <= tab.keys():
                return opened
            clicked = await call("browser_click", {**tab, "ref": ref})
            if not clicked.ok:
                return clicked
            return await call("get_browser_state", {**tab, "include_screenshot": False})
        return opened

    async def _awake(self, target):
        """Whether the computer runs now. A look, never a start; an engine that does not answer is not awake."""
        try:
            return (await self.vm.status(target, probe=False))["state"] == "running"
        except (VmError, OSError, TimeoutError):
            return False

    def __getattr__(self, name):
        return getattr(self.delegate, name)

    async def prepare(self, member_id=0):
        if not self.vm.enabled:
            return
        # Looking for the program runs nothing. With no Docker on this PC there is no computer to offer.
        if self.vm.desktop and not self.vm.desktop.installed():
            return
        try:
            target = await self.vm.seat(member_id)
        except VmError as error:
            if str(error) != "seats_full":
                raise
            target = self.vm.target(member_id)
        if self.logins:
            try:
                if hasattr(self.logins, "preload"):
                    self.logins.preload(member_id)
                for row in self.logins.references(None if target.container == "shared" else member_id):
                    try:
                        self.logins.load(row["member_id"], row["origin"], row["reference"])
                    except Exception as error:
                        logger.warning("Login vault read failed: %s", type(error).__name__)
            except Exception as error:
                logger.warning("Login registry read failed: %s", type(error).__name__)
        keys = self.catalogs.get(target.key, [])
        if not keys or self.routes[keys[0]] != target:
            self.listed.discard(target.key)
            self._catalog(target, offline_catalog())

    def _catalog(self, target, definitions):
        definitions.update(vm_exec=EXEC, attach_file=ATTACH, request_takeover=TAKEOVER, fill_login=FILL_LOGIN,
                           vault_entries=ENTRY_CHOICES, fill_contact=FILL_CONTACT, fill_card=FILL_CARD, browser_open=BROWSER_OPEN, run_steps=RUN_STEPS)
        from .datasets import DEFINITION
        definitions["dataset"] = DEFINITION
        keys = []
        for name, definition in definitions.items():
            key = tool_key(f"computer-{target.key}", name)
            description = definition["description"]
            if name in DRIVER_TOOLS:
                # Outward approval after the tool's own line, on every tool that reaches the driver.
                description += " " + VM_CONTRACT
            parameters = definition["parameters"]
            if target.container:
                if name in SHARED_NOTED:
                    description += SHARED_CONTRACT
                if name == "browser_open":
                    from copy import deepcopy
                    parameters = deepcopy(parameters)
                    parameters["properties"]["url"]["pattern"] = "^(https?://|about:blank(?:#.*)?$)"
            self.tools[key] = PluginTool(key, "computer", name, description, parameters, Tier.T3 if name == "fill_card" else Tier.T0, pinned=True,
                                         deferred=name in ("vault_entries", "fill_contact", "fill_card"), whole=True)
            self.routes[key] = target
            self.schemas[key] = parameters if name == "browser_open" and target.container else definition.get("validation", parameters)
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
                    # The same reading as the list kept with the code: the pinned driver's list changes nothing a
                    # member was offered, so its first use of the computer does not start a CLI turn again.
                    definitions[name] = driver_definition(name, schema, item.get("originalInputSchema"))
                    Draft202012Validator.check_schema(definitions[name]["parameters"])
                self._catalog(target, definitions)
                self.listed.add(target.key)
                self.problem = None
            except Exception as error:
                self.problem = str(error) if isinstance(error, VmError) else type(error).__name__
                raise

    def _refresh(self, target):
        if target.key in self.listed or target.key in self.refreshes:
            return
        async def refresh():
            try:
                await self._discover(target)
            except Exception:
                self.vm.invalidate(target)
            finally:
                self.refreshes.pop(target.key, None)
        self.refreshes[target.key] = asyncio.create_task(refresh())

    def offered_for(self, member_id):
        target = self.vm.target(member_id)
        # Every member has its computer for the work that needs one, as it has any tool: nothing asks the owner first.
        native = [self.tools[key] for key in self.catalogs.get(target.key, []) if self.routes[key] == target] if self.vm.enabled else []
        return [*self.delegate.offered(), *native]

    def offered(self):
        return self.offered_for(0)

    def has_own_computer(self, member_id):
        # True once the member's own computer has a tool catalog. The snapshot then leaves out the owner's-desktop
        # `computer` tool, so that two tools called computer never leave the choice of machine to the model. Without a
        # catalog (computer tools off, no Docker on this PC) a member simply has no computer: only a quick question
        # reaches the owner's PC at all, and an ordinary turn never falls back to it (R-PC-01, PR #78).
        return self.vm.enabled and bool(self.catalogs.get(self.vm.target(member_id).key))

    def page_tool(self, server_id, name):
        return self.delegate.page_tool(server_id, name)

    def is_computer_tool(self, key):
        return key in self.tools

    def tier_of(self, key):
        if key in self.tools:
            shared = self.vm.mode == "shared"
            matches = (self.routes[key].container == "shared") == shared
            return self.tools[key].tier if self.vm.enabled and matches and self.routes[key].remote == self.vm.remote and key in self.catalogs.get(self.routes[key].key, []) else None
        return self.delegate.tier_of(key)

    def tier_for_call(self, key, arguments):
        # The hub knows nothing about computer tools, so it must not be asked about them.
        return self.tier_of(key) if self.is_computer_tool(key) else self.delegate.tier_for_call(key, arguments)

    def kind_of(self, server, name):
        if server == "computer":
            return "read" if name in READS or name in ("attach_file", "vault_entries") else "write"
        return self.delegate.kind_of(server, name)

    def kind_for_call(self, server, name, arguments):
        return self.kind_of(server, name) if server == "computer" else self.delegate.kind_for_call(server, name, arguments)

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
        if not self.is_computer_tool(key):
            return await self.delegate.call(key, arguments, approver=approver, task_id=task_id, pool=pool)
        scope = _SCOPE.get()
        member = scope[1] if scope and scope[0] == "turn" else 0
        if task_id and self.conn is not None:
            row = self.conn.execute("SELECT member_id FROM worker_tasks WHERE id=?", (task_id,)).fetchone()
            if row:
                member = row[0]
        picture_target = self.routes.get(key, self.vm.target(member))
        private_before = picture_target.key in self.payment_holds or any(
            page[0] == picture_target.key for page in self.private_pages)
        # Only a computer tool can picture a seat before the look that follows the call; the windows are not
        # listed for every other tool a member with a seat happens to call.
        if key in self.tools:
            private_before = await self._shared_private_picture(picture_target) or private_before
        began = time.monotonic()
        repair_budget = _REPAIRS.set(set())
        reading = key in self.tools and self.tools[key].name in SCREEN_READS | {"browser_open"}
        progress, language = _NOTE.get()
        async def announce():
            await asyncio.sleep(self.read_progress_s)
            if progress:
                progress(with_ui_words({"zh-TW": "仍在讀取電腦畫面", "ja": "画面を読み取り中です", "en": "Still reading the computer screen"}, lambda _ui_language: ui_word('Still reading the computer screen', _ui_language)).get(language, "Still reading the computer screen"))
        notice = asyncio.create_task(announce()) if reading else None
        try:
            result = await self._call(key, arguments, approver=approver, task_id=task_id, pool=pool)
        finally:
            _REPAIRS.reset(repair_budget)
            if notice:
                notice.cancel()
                await asyncio.gather(notice, return_exceptions=True)
        if reading and result.kind not in NOTICES:
            elapsed = round(time.monotonic() - began, 2)
            prefix, _, tail = result.text.rpartition("\n")
            try:
                data = json.loads(tail)
            except ValueError:
                data = None
            if isinstance(data, dict):
                data["elapsed_seconds"] = elapsed
                result.text = (prefix + "\n" if prefix else "") + json.dumps(data, ensure_ascii=False)
            else:
                result.text = (result.text + f"\nElapsed: {elapsed:.2f} seconds.").strip()
        private_members = list(self.logins.values) if self.logins and picture_target.container == "shared" else [member]
        if self.logins and any(self.logins.values.get(identifier) for identifier in private_members):
            for identifier in private_members:
                result.text = self.logins.redact(identifier, result.text)
                if result.kind:
                    result.kind = self.logins.redact(identifier, result.kind)
        if (reading and result.ok and (picture_target.container != "shared" or result.kind not in NOTICES)) or result.blocks:
            if picture_target != self.vm.target(member):
                return PluginResult(False, "computer_changed")
            private_after = await self._private_picture(picture_target, arguments)
            if picture_target != self.vm.target(member):
                return PluginResult(False, "computer_changed")
            if private_before or private_after:
                # A safe observation after capture cannot authorize pixels from before that observation.
                tree = getattr(self, "private_tree", {}).get(picture_target.key, {})
                if not tree:
                    try:
                        tree = json.loads(result.text.rsplit("\n", 1)[-1])
                    except ValueError:
                        tree = {}
                # This value-free tree is the snapshot actually handed to the member.
                # Record its refs without changing the member's current tab to the probe's tab.
                self._remember_page_refs(picture_target, tree)
                result.text = json.dumps(self._without_values(tree), ensure_ascii=False) + "\nPrivate fields are hidden until the filled tab is closed or a complete read shows another site. Use page references or request_takeover; no screenshot was returned."
                if self.logins:
                    for identifier in private_members:
                        result.text = self.logins.redact(identifier, result.text)
                result.blocks = []
        return result

    async def _checkpoint(self, target, member, turn, owner, command):
        if plain_read(command):
            return
        ticket = (target.key, member, turn or owner)
        async with self.checkpoint_locks.setdefault(target.state_key, asyncio.Lock()):
            if ticket in self.checkpointed:
                return
            self.checkpointed.add(ticket)
            failures = getattr(self.vm, "checkpoint_failures", None)
            if failures is None:
                self.vm.checkpoint_failures = failures = {}
            try:
                await asyncio.wait_for(self.vm.checkpoint(target, "begin", member=member, turn=turn), 11)
                failures.pop(target.state_key, None)
            except Exception as error:
                failures[target.state_key] = True
                logger.warning("File checkpoint skipped: %s", type(error).__name__)

    def _observe_page(self, target, page, *, remember=True):
        from urllib.parse import urlsplit
        identifier = page.get("target_id")
        url = (page.get("page") or {}).get("url") or page.get("url") or next((tab.get("url") for tab in page.get("tabs", []) if tab.get("active") is True), None)
        key = (target.key, identifier)
        tab_id = page.get("tab_id") or next((tab.get("tab_id") for tab in page.get("tabs", []) if tab.get("active") is True), None)
        if identifier and remember:
            if tab_id:
                self.page_tabs[key] = tab_id
            elif "tabs" in page:
                self.page_tabs.pop(key, None)
            self._remember_page_refs(target, page)
        key = (*key, tab_id)
        protected = self.private_pages.get(key)
        if protected and url:
            try:
                parsed = urlsplit(url)
                if parsed.scheme not in ("https", "http") or not parsed.hostname:
                    return
                current = (parsed.scheme.lower(), parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
            except (ValueError, TypeError):
                return
            nodes = page.get("refs", page.get("nodes"))
            snapshot = page.get("snapshot")
            # The driver says a snapshot is whole with `complete` and no `continuation` (0.37.0, measured); the shape
            # before it said `truncated` and `has_more`. Anything that does not plainly say "whole" is not.
            if isinstance(snapshot, dict):
                complete = snapshot.get("complete") is True and snapshot.get("continuation") is None
            else:
                complete = page.get("truncated") is False and not page.get("has_more")
            # Only another origin lifts the mark. The next page of the same site may show what was just filled (an
            # order's review page shows the card), so losing the fields on the same origin lifts nothing.
            if (isinstance(nodes, list) and complete and current not in protected["origins"]
                    and not self._has_private_refs(nodes, protected["refs"])):
                self.private_pages.pop(key, None)

    @staticmethod
    def _field_identity(row):
        if isinstance(row, dict) and "type" in row.get("actions", []) and all(
                isinstance(row.get(key), str) for key in ("frame", "role", "name")):
            return row["frame"], row["role"], row["name"]

    def _remember_page_refs(self, target, page):
        tab_id = page.get("tab_id") or next((tab.get("tab_id") for tab in page.get("tabs", []) if tab.get("active") is True), None)
        if page.get("target_id") and tab_id and ("refs" in page or "snapshot" in page):
            self.page_refs[target.key, page["target_id"], tab_id] = {
                row["ref"]: self._field_identity(row) for row in page.get("refs", [])
                if self._field_identity(row) is not None and isinstance(row.get("ref"), str)}

    @staticmethod
    def _has_private_refs(value, refs):
        if isinstance(value, dict):
            return value.get("ref") in refs or any(VmTools._has_private_refs(item, refs) for item in value.values())
        return isinstance(value, list) and any(VmTools._has_private_refs(item, refs) for item in value)

    @staticmethod
    def _without_values(value):
        if isinstance(value, dict):
            return {key: VmTools._without_values(item) for key, item in value.items()
                    if "value" not in key.lower() and key.lower() not in (
                        "text", "textcontent", "innertext", "screenshot", "images", "image", "html")}
        if isinstance(value, list):
            return [VmTools._without_values(item) for item in value]
        return value

    def _protect_page(self, target, identifier, url, refs, *, tab_id=None, fields=()):
        from urllib.parse import urlsplit
        parsed = urlsplit(url)
        tab_id = tab_id or self.page_tabs.get((target.key, identifier))
        protected = self.private_pages.setdefault((target.key, identifier, tab_id), {"origins": set(), "refs": set(), "fields": set()})
        protected["origins"].add((parsed.scheme.lower(), parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80)))
        protected["refs"].update(refs)
        protected["fields"].update(fields)
        protected["computer"] = target.physical
        binding = self.page_windows.get((target.key, identifier))
        if binding:
            protected["window"] = binding[1]

    async def _shared_private_picture(self, target):
        if not target.container or not target.screen:
            return False
        marks = [mark for key, mark in self.private_pages.items()
                 if key[0] != target.key and mark.get("computer") == target.physical and mark.get("window")]
        if not marks:
            return False
        try:
            canvas = await self.vm.window_bounds(target)
            identifiers = {mark["window"] for mark in marks}
            return any(row["window_id"] in identifiers and seat_view.overlaps(row["bounds"], target.screen, target.screens)
                       for row in canvas["windows"])
        except Exception:
            return True

    async def _private_picture(self, target, arguments):
        keys = [key for key in self.private_pages if key[0] == target.key]
        self.private_tree = getattr(self, "private_tree", {})
        self.private_tree.pop(target.key, None)
        for key in keys:
            try:
                if key[2] is None or target.key not in self.connections:
                    continue
                client, session = await self._connection(target)
                state = await self._driver_call(target, client, "get_browser_state", {
                    "target_id": key[1], "tab_id": key[2], "session": session, "include_screenshot": False, "snapshot_format": "semantic_v2"}, remember=False)
                page = state.get("structuredContent") or {}
                if closed_private_tab(state, key[2]):
                    self.private_pages.pop(key, None)
                # A refusal is not a page: a launched browser's refusals carry no isError (measured).
                if not state.get("isError") and page.get("status") != "refused":
                    self.private_tree[target.key] = page
            except Exception:
                pass
        return (target.key in self.payment_holds or any(key in self.private_pages for key in keys)
                or await self._shared_private_picture(target))

    async def _call(self, key, arguments, *, approver, task_id=None, pool=None):
        if key not in self.tools:
            return await self.delegate.call(key, arguments, approver=approver, task_id=task_id, pool=pool)
        tool, target = self.tools[key], self.routes[key]
        if tool.name == "run_steps":
            return await self._run_steps(key, arguments, approver=approver, task_id=task_id, pool=pool)
        if tool.name == "dataset":
            from .datasets import run_dataset
            async def execute(name, args):
                return await self.call(tool_key(f"computer-{target.key}", name), args, approver=approver, task_id=task_id, pool=pool)
            return await run_dataset(arguments, execute, self.attachments,
                                     **({"member_key": target.key} if target.container == "shared" else {}))
        result = PluginResult(False, "blocked")
        try:
            scope = _SCOPE.get()
            member = scope[1] if scope and scope[0] == "turn" else 0
            if task_id and self.conn is not None:
                row = self.conn.execute("SELECT member_id FROM worker_tasks WHERE id=?", (task_id,)).fetchone()
                if row is None:
                    return PluginResult(False, "blocked")
                member = row[0]
            if target.screen == 0 and target == self.vm.target(member):
                await self.vm.seat(member)
                return PluginResult(False, "computer_changed")
            if target != self.vm.target(member):
                current = self.vm.target(member)
                if current.container and not current.screen and current.key == target.key:
                    await self.vm.seat(member)
                return PluginResult(False, "computer_changed", "This computer is no longer the member's own. Read the refreshed computer tool catalog.")
            if self.tier_of(key) is None or approver == "none" or tool.tier >= Tier.T2 and approver != "user":
                return result
            if target.key in self.vm.held:
                result = PluginResult(False, "owner_holds_control", self.vm.owner_note(target))
                return result
            if "session" in arguments or not Draft202012Validator(self.schemas[key]).is_valid(arguments):
                result = PluginResult(False, "bad_arguments")
                return result
            if tool.name == "vault_entries":
                choices = self.logins.choices(member) if self.logins and hasattr(self.logins, "choices") else []
                return PluginResult(True, text=json.dumps({"entries": choices}, ensure_ascii=False))
            if target.key in self.payment_holds and tool.name not in READS | {"request_takeover"}:
                return PluginResult(False, "owner_payment_required", "The owner must finish payment through request_takeover. No further member action is allowed on this computer.")
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
            if work and work.check_required and tool.name not in FRESH_READS | {"list_windows"}:
                return PluginResult(False, "desktop_check_required")
            if tool.name == "request_takeover":
                # Never over input that is already running at the screen (a long command in the workspace is none).
                if self.vm.input_busy(target) or self.vm.native_busy(target):
                    return self._busy(target, None, 0.0)
                data = await self.vm.work.request(work, arguments["reason"])
                if arguments["reason"] == "payment" and target.key in self.payment_holds:
                    self.payment_holds.discard(target.key)
                    if self.conn is not None:
                        with self.conn:
                            self.conn.execute("DELETE FROM computer_payment_holds WHERE target=?", (target.key,))
                result = PluginResult(True, text=json.dumps(data))
                return result
            if work:
                work.tool = tool.name
            if screen and (target.key, owner) in self.stale and tool.name not in READS:
                # Another used the screen since this one looked at it: look again before acting on it.
                result = PluginResult(True, "screen_changed", json.dumps({
                    "status": "screen_changed",
                    "note": "The computer has changed since your last read, so the screen is no longer what you last saw. "
                            "Nothing was done. Read the intended get_window_state or get_browser_state, then do this again if it is still needed."}))
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
            self.vm.physical_active[target.physical] = self.vm.physical_active.get(target.physical, 0) + 1
            command = tool.name == "vm_exec"
            if command:
                self.commands[target.key] = self.commands.get(target.key, 0) + 1
            try:
                # Only a member's own call that needs its computer may start Docker Desktop; a read or a viewer never does (R-PANEL-04).
                with engine_start_allowed(), _waking(member, tool.name):
                    await self.vm.start(target)
                await self._disk_notice(target)
                if target != self.vm.target(member):
                    return PluginResult(False, "computer_changed")
                # A hold may have arrived while the desktop was starting. Never queue actions.
                if target.key in self.vm.held:
                    raise VmError("owner_holds_control")
                if tool.name == "vm_exec":
                    background = arguments.get("background", False)
                    wait = arguments.get("timeout_seconds", 3600 if background else 60)
                    await self._checkpoint(target, member, turn[0], owner, arguments["command"])
                    if target != self.vm.target(member):
                        return PluginResult(False, "computer_changed")
                    if target.key in self.vm.held:
                        raise VmError("owner_holds_control")
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
                elif tool.name in ("fill_contact", "fill_card"):
                    result = await self._fill_entry(target, member, arguments, "card" if tool.name == "fill_card" else "contact")
                else:
                    if target.key in self.vm.held:
                        raise VmError("owner_holds_control")
                    if self.tier_of(key) is None:
                        result = PluginResult(False, "tool_changed", "This driver does not offer that tool. Read the refreshed computer tool catalog.")
                        return result
                    if not Draft202012Validator(self.schemas[key]).is_valid(arguments):
                        result = PluginResult(False, "bad_arguments", "The driver requires different arguments. Read the refreshed computer tool schema before retrying.")
                        return result
                    try:
                        client, session = await self._connection(target, member=member)
                    except (ConnectionError, VmError, OSError) as error:
                        if isinstance(error, VmError) and str(error) not in ("unavailable", "driver_configuration_failed"):
                            raise
                        from .lifecycle import repair_connection
                        self.vm.invalidate(target)
                        await self._disconnect(target.key)
                        if target != self.vm.target(member):
                            return PluginResult(False, "computer_changed")
                        await repair_connection(self.vm, target)
                        # No owner action has been sent. Re-enter the same target and hold checks.
                        client, session = await self._connection(target, member=member)
                    self._refresh(target)
                    await asyncio.sleep(0)
                    if target != self.vm.target(member):
                        return PluginResult(False, "computer_changed")
                    if target.key in self.vm.held:
                        raise VmError("owner_holds_control")
                    if self.tier_of(key) is None:
                        return PluginResult(False, "tool_changed", "Read the refreshed computer tool catalog.")
                    if not Draft202012Validator(self.schemas[key]).is_valid(arguments):
                        return PluginResult(False, "bad_arguments", "Read the refreshed computer tool schema.")
                    # The screen is the member's own, and Chromium refuses input addressed to it in the background.
                    foreground = {"delivery_mode": "foreground"} if "delivery_mode" in self.schemas[key].get("properties", {}) else {}
                    if target.container and tool.name == "browser_dialog" and arguments.get("action") == "inspect":
                        foreground = {}  # A read-only dialog probe needs no foreground posture.
                    sent = {**foreground, **arguments, "session": session}
                    if tool.name == "get_window_state":
                        sent.update(max_elements=min(arguments.get("max_elements", 200), 200),
                                    include_screenshot=arguments.get("include_screenshot", False))
                    elif tool.name == "get_browser_state":
                        sent.setdefault("include_screenshot", False)
                        sent.setdefault("snapshot_format", "semantic_v2")
                    try:
                        if tool.name == "browser_open":
                            async with asyncio.timeout(self.browser_open_s):
                                data = await self._browser_open(target, member, client, session, arguments)
                        else:
                            data = await self._driver_call(target, client, tool.name, sent, own=True)
                    except (VmError, ConnectionError, TimeoutError) as error:
                        if target.container and isinstance(error, VmError) and str(error) in ("computer_busy", "owner_holds_control", "computer_changed"):
                            # Waiting for shared input is not a broken session: its bound pages must survive.
                            raise
                        self.vm.invalidate(target)
                        await self._disconnect(target.key)
                        if isinstance(error, ConnectionError) or isinstance(error, VmError) and str(error) in ("transport_closed", "unavailable", "viewer_tunnel_failed"):
                            if target != self.vm.target(member):
                                return PluginResult(False, "computer_changed")
                            from .lifecycle import repair_connection
                            try:
                                await repair_connection(self.vm, target)
                            finally:
                                self.vm.invalidate(target)
                            self.stale.add((target.key, owner))
                            if work:
                                work.check_required = True
                            result = PluginResult(False, "connection_repaired", "Computer connection repaired. The previous action was not replayed because its outcome is unknown. Read the current window or page before deciding the next action.")
                            return result
                        raise
                    if not data.get("isError"):
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
                        for identifier in self.logins.values if target.container == "shared" else (member,):
                            combined = self.logins.redact(identifier, combined)
                    limit = 60_000 if tool.name.startswith(PAGE_TOOLS) else 20_000
                    result = PluginResult(not data.get("isError", False), "tool_error" if data.get("isError") else None,
                        combined[:limit], len(combined) > limit, blocks=blocks)
                if work and result.ok and tool.name in FRESH_READS:
                    work.check_required = False
                if screen and result.ok and tool.name in FRESH_READS:
                    self.stale.discard((target.key, owner))
            finally:
                self.vm.active[target.key] -= 1
                self.vm.physical_active[target.physical] -= 1
                if command:
                    self.commands[target.key] -= 1
                self.vm.last_activity[target.state_key] = self.vm.clock()
                if target.container:
                    holder = self.vm.seats.holders(target.remote).get(target.screen)
                    if holder is not None and self.vm.key_for(target.remote, holder) == target.key:
                        self.vm.seats.touch(target.remote, holder)
                if lock is not None:
                    self.lease_used[target.key] = self.vm.clock()
                    lock.release()
            return result
        except asyncio.CancelledError:
            self.vm.invalidate(target)
            result = PluginResult(False, "cancelled")
            raise
        except TimeoutError:
            self.vm.invalidate(target)
            result = PluginResult(False, "timeout")
            return result
        except VmError as error:
            self.vm.invalidate(target)
            if str(error) in ("seats_full", "computer_busy"):
                return self._busy(target, None, self.busy_wait_s if str(error) == "computer_busy" else 0,
                                  note="every screen of the computer is in use" if str(error) == "seats_full"
                                  else self.vm.owner_note(target) if self.vm.unit_held(target) else None,
                                  held_by="the owner" if self.vm.unit_held(target) else None)
            result = PluginResult(False, str(error), self.vm.owner_note(target) if str(error) == "owner_holds_control" else ENGINE_FAILURES.get(str(error), ""))
            return result
        except ConnectionError:
            self.vm.invalidate(target)
            result = PluginResult(False, "connection_error")
            return result
        except Exception:
            self.vm.invalidate(target)
            result = PluginResult(False, "error")
            return result
        finally:
            if self.logins and result.kind:
                for identifier in self.logins.values:
                    result.kind = self.logins.redact(identifier, result.kind)
            self._audit(key, "blocked" if result.kind in NOTICES else "ok" if result.ok else result.kind or "error", approver, task_id)

    # --- the driver connection -------------------------------------------------------------------

    async def _run_steps(self, key, arguments, *, approver, task_id, pool):
        target = self.routes[key]
        if target.key in self.vm.held:
            return PluginResult(False, "owner_holds_control", self.vm.owner_note(target))
        if approver == "none" or self.step_gate is None:
            return PluginResult(False, "blocked")
        if not Draft202012Validator(RUN_STEPS["parameters"]).is_valid(arguments):
            return PluginResult(False, "bad_arguments")
        try:
            await self._discover(target)
        except Exception:
            return PluginResult(False, "tool_changed")
        observation = arguments['observation']
        schema = self.schemas.get(tool_key(f"computer-{target.key}", observation['name']))
        if not schema or not Draft202012Validator(schema).is_valid(observation['arguments']):
            return PluginResult(False, "bad_arguments")
        if observation['name'] == 'verify_state' and not meaningful_expectation(observation['arguments'].get('expect')):
            return PluginResult(False, "bad_arguments", "verify_state needs a nonempty expectation before any batch action.")
        completed = 0
        # Subcalls retain the ordinary action lock, audit, lease and private-field redaction.
        # Do not hold that lock across recursive gate calls or replay uncertain actions.
        for index, step in enumerate([*arguments["steps"], arguments["observation"]], 1):
            child = tool_key(f"computer-{target.key}", step["name"])
            if child not in self.catalogs.get(target.key, []):
                result = PluginResult(False, "tool_changed")
            else:
                result = await self.step_gate(child, step["arguments"], task_id=task_id, pool=pool)
            if not result.ok or result.kind in NOTICES:
                return PluginResult(False, result.kind or "step_failed", json.dumps({
                    "failed_step": index, "completed_steps": completed, "observation_failed": index > len(arguments["steps"]),
                    "error": result.kind or "step_failed"}))
            completed += 1
        return PluginResult(True, text=result.text, blocks=result.blocks, truncated=result.truncated)

    async def _browser_open(self, target, member, client, session, arguments):
        async def call(name, args):
            if target != self.vm.target(member) or target.key in self.vm.held:
                raise VmError("owner_holds_control")
            key = tool_key(f"computer-{target.key}", name)
            if name.startswith("browser_") and "delivery_mode" in self.schemas.get(key, {}).get("properties", {}):
                args = {"delivery_mode": "foreground", **args}
            reply = await self._driver_call(target, client, name, {**args, "session": session})
            if reply.get("isError"):
                raise VmError("browser_open_failed")
            return reply

        if target.container:
            async with self._native_lock(target):
                window = await self._shared_browser_window(target, client, session)
                prepared = await self._seat_driver_call(target, client, "browser_prepare", {
                    "pid": window["pid"], "window_id": window["window_id"], "session": session, "delivery_mode": "foreground"})
                if prepared.get("isError"):
                    raise VmError("browser_open_failed")
        else:
            prepared = await call("browser_prepare", {"allow_launch": True, "profile": {"mode": "isolated_named", "name": "main"}})
            prepared_pid = (prepared.get("structuredContent") or {}).get("pid")
            until = time.monotonic() + self.browser_window_wait_s
            pause = self.browser_window_poll_s
            while True:
                windows = await call("list_windows", {})
                state = windows.get("structuredContent") or {}
                if not state:
                    for block in windows.get("content", []):
                        if block.get("type") == "text":
                            try:
                                state = json.loads(block["text"])
                                break
                            except ValueError:
                                state = {"windows": [{"window_id": int(match[1]), "pid": int(match[2]), "app_name": match[3]}
                                    for match in re.finditer(r'window_id=(\d+) pid=(\d+) "[^"]*"[^\n]*app=([^\n]+)', block["text"])]}
                rows = state if isinstance(state, list) else state.get("windows", [])
                matches = [row for row in rows if "chrom" in str(row.get("app_name", row.get("title", ""))).lower()
                           and isinstance(row.get("pid"), int) and isinstance(row.get("window_id"), int)
                           and (not prepared_pid or row["pid"] == prepared_pid)]
                if len(matches) == 1:
                    break
                if matches or time.monotonic() >= until:
                    raise VmError("browser_window_ambiguous" if matches else "browser_window_missing")
                # Preparing the CDP endpoint can finish before the window manager maps its window.
                await asyncio.sleep(min(pause, max(0, until - time.monotonic())))
                pause = min(pause * 1.5, self.browser_window_poll_max_s)
            window = matches[0]
        bound = await call("get_browser_state", {"pid": window["pid"], "window_id": window["window_id"],
            "include_screenshot": False, "snapshot_format": "semantic_v2"})
        page = bound.get("structuredContent") or {}
        if not page.get("target_id"):
            raise VmError("browser_target_missing")
        tabs = page.get("tabs", [])
        selected = next((tab for tab in tabs if tab.get("active") is True), tabs[0] if tabs else {})
        if not selected.get("tab_id"):
            raise VmError("browser_tab_missing")
        tab = {"target_id": page["target_id"], "tab_id": selected["tab_id"]}
        await call("browser_navigate", {**tab, "url": arguments["url"]})
        reply = await call("get_browser_state", {**tab, "include_screenshot": False, "snapshot_format": "semantic_v2",
            **{key: arguments[key] for key in ("query", "scope_ref") if key in arguments}})
        reply["content"] = [block for block in reply.get("content", []) if block.get("type") != "image"]
        return reply

    @staticmethod
    def _page_tab(page):
        tabs = page.get("tabs", [])
        selected = next((tab for tab in tabs if tab.get("active") is True), {})
        tab_id = page.get("tab_id") or selected.get("tab_id")
        url = (page.get("page") or {}).get("url") or page.get("url") or selected.get("url")
        if not tab_id:
            raise ValueError("Current browser tab is unavailable")
        return tab_id, url

    async def _type_page_fields(self, target, member, identifier, fields, check_page, *, private=True, skip_empty=False):
        """Resolve member refs once, then match and type against each freshly checked page.

        check_page receives the same raw reply and URL used for that field. Vault callers
        keep their HTTPS/grant/amount rules there; acceptance can check its own loopback origin.
        No driver diagnostics or values leave this boundary.
        """
        # The displayed private tree may name a different tab from the last foreground read.
        # Resolve all refs to one known tab; identical ref strings across tabs are ambiguous.
        fields = list(fields)
        candidates = [(key[2], meanings) for key, meanings in self.page_refs.items()
                      if key[:2] == (target.key, identifier) and all(ref in meanings for ref, _ in fields)]
        if len(candidates) != 1:
            raise ValueError()
        tab_id, meanings = candidates[0]
        resolved = [(meanings[ref], text) for ref, text in fields]
        for meaning, _ in resolved:
            if meaning[0] != "main":
                raise SavedFieldRefused("The field is inside an embedded frame. Saved values are typed only into the page's own fields; ask the owner to take over with request_takeover.")
            if sum(value == meaning for value in meanings.values()) != 1:
                raise SavedFieldRefused("The fields have the same name and cannot be told apart. Ask the owner to take over with request_takeover.")
        if skip_empty:
            resolved = [(meaning, text) for meaning, text in resolved if text]
        if not tab_id or not resolved:
            raise ValueError()
        client, session = await self._connection(target, member=member)
        schema = self.schemas.get(tool_key(f"computer-{target.key}", "browser_type"))
        if not schema:
            raise ValueError()
        # Every read below invalidates member refs, including a read before a refused fill.
        # Reuse the screen lease's stale marker, which a fresh member read clears.
        owner = self.leases.get(target.key)
        if owner is not None:
            self.stale.add((target.key, owner))
        self.page_refs.pop((target.key, identifier, tab_id), None)
        for meaning, text in resolved:
            state = await self._driver_call(target, client, "get_browser_state", {
                "target_id": identifier, "tab_id": tab_id, "session": session,
                "include_screenshot": False, "snapshot_format": "semantic_v2"}, remember=False)
            page = state.get("structuredContent") or {}
            actual_tab, url = self._page_tab(page)
            if (state.get("isError") or page.get("effect") == "refused" or page.get("target_id") != identifier
                    or actual_tab != tab_id or target != self.vm.target(member) or target.key in self.vm.held):
                raise ValueError()
            check_page(state, url)
            matches = [row for row in page.get("refs", []) if row.get("frame") == "main" and self._field_identity(row) == meaning]
            if len(matches) != 1:
                raise ValueError()
            call = {"target_id": identifier, "tab_id": tab_id, "ref": matches[0]["ref"], "text": text, "replace": True}
            if "delivery_mode" in schema.get("properties", {}):
                call["delivery_mode"] = "foreground"
            if not Draft202012Validator(schema).is_valid(call):
                raise ValueError()
            if private:
                self._protect_page(target, identifier, url, (call["ref"],), tab_id=tab_id, fields=(meaning,))
            reply = await self._driver_call(target, client, "browser_type", {**call, "session": session}, remember=False)
            result = reply.get("structuredContent") or {}
            count = (result.get("delivery") or {}).get("delivered_count")
            if reply.get("isError") or result.get("effect") == "refused" or type(count) is not int or count != len(text):
                raise ValueError()

    async def _fill_login(self, target, member, args):
        from .logins import origin
        if self.logins is None:
            return PluginResult(False, "login_missing", "Use request_secret with the HTTPS site, or request_takeover.")
        try:
            await self._discover(target)
            values = self.logins.load(member, args["site"], args["reference"])
            def check_page(state, url):
                if origin(url) != origin(args["site"]):
                    raise ValueError()
                self.logins.load(member, args["site"], args["reference"])
            await self._type_page_fields(target, member, args["target_id"],
                [(args[field + "_ref"], values[field]) for field in ("username", "password")], check_page)
            return PluginResult(True, text='{"filled": true}')
        except SavedFieldRefused as error:
            return PluginResult(False, "login_not_filled", json.dumps({"filled": False, "hint": str(error)}))
        except Exception:
            self.vm.invalidate(target)
            # Transport and vault exceptions may echo input; none of their diagnostics leave this boundary.
            return PluginResult(False, "login_not_filled", '{"filled": false}')

    async def _fill_entry(self, target, member, args, kind):
        from .logins import origin
        if self.logins is None or not hasattr(self.logins, "entry"):
            return PluginResult(False, "entry_not_filled", '{"filled": false}')
        try:
            row, values = self.logins.entry(member, args["reference"], kind)
            if row["label"] != args["label"]:
                raise ValueError()
            await self._discover(target)
            def check_page(state, url):
                if origin(url) != origin(args["site"]):
                    raise ValueError()
                if not any(entry["id"] == args["reference"] and entry["label"] == args["label"]
                           for entry in self.logins.entries(member)):
                    raise ValueError()
                if kind == "card":
                    # Require the owner-approved amount to match the current page on every field.
                    text = json.dumps(state, ensure_ascii=False)
                    amounts = re.findall(r"(?:NT\$|US\$|[$€£¥]|(?:USD|TWD|EUR|JPY)\s*)\s*\d[\d,.]*(?:\s*(?:USD|TWD|EUR|JPY))?", text)
                    if (amounts and args["amount"] not in amounts) or (not amounts and args["amount"]):
                        raise ValueError()
                    # Set the hold before sending the first private byte, even if the driver fails.
                    self.payment_holds.add(target.key)
                    if self.conn is not None:
                        with self.conn:
                            self.conn.execute("INSERT OR IGNORE INTO computer_payment_holds VALUES (?)", (target.key,))
            await self._type_page_fields(target, member, args["target_id"],
                [(ref, values[field]) for field, ref in args["fields"].items()], check_page, skip_empty=True)
            return PluginResult(True, text=json.dumps({"filled": True, "owner_finishes": kind == "card"}))
        except SavedFieldRefused as error:
            return PluginResult(False, "entry_not_filled", json.dumps({"filled": False, "hint": str(error)}))
        except Exception:
            self.vm.invalidate(target)
            return PluginResult(False, "entry_not_filled", '{"filled": false}')

    async def _driver_call(self, target, client, name, arguments, *, remember=True, own=False):
        """`own` is the member's own tool call, as against a read or a fill the core makes for it."""
        if not target.container:
            reply = await client.request("tools/call", {"name": name, "arguments": arguments})
        elif shared_native_input(name, arguments):
            async with self._native_lock(target):
                reply = await self._seat_driver_call(target, client, name, arguments, own=own)
        else:
            reply = await self._seat_driver_call(target, client, name, arguments, own=own)
        if not reply.get("isError"):
            self._observe_page(target, reply.get("structuredContent") or {}, remember=remember)
        return reply

    @asynccontextmanager
    async def _native_lock(self, target):
        if self.native_owners.get(target.state_key) is asyncio.current_task():
            yield
            return
        began = time.monotonic()
        lock = self.native_actions.setdefault(target.state_key, asyncio.Lock())
        while True:
            if target.key in self.vm.held:
                raise VmError("owner_holds_control")
            if not self.vm.unit_held(target) and not lock.locked():
                await lock.acquire()
                break
            remaining = self.busy_wait_s - (time.monotonic() - began)
            if remaining <= 0:
                raise VmError("computer_busy")
            await asyncio.sleep(min(self.busy_poll_s, remaining))
        try:
            # No await separates the last hold check and acquisition on the core loop.
            member = self.vm.seats.holders(target.remote).get(target.screen)
            if member is None or self.vm.shared_target(target.remote, member, target.screen) != target:
                raise VmError("computer_changed")
            self.native_owners[target.state_key] = asyncio.current_task()
            yield
        finally:
            self.native_owners.pop(target.state_key, None)
            lock.release()

    async def seat_observation(self, target, *, connection):
        """Owner teaching uses the same window projection and clipped pixels as member reads."""
        from .teaching import safe_observation
        from .rfb_view import capture
        unsafe = {"safe": False, "screen": "", "images": []}

        def current():
            member = self.vm.seats.holders(target.remote).get(target.screen)
            return member is not None and self.vm.target(member) == target

        def private(canvas):
            for key, mark in self.private_pages.items():
                if key[0] == target.key:
                    return True
                if mark.get("computer") == target.physical and mark.get("window"):
                    if any(row["window_id"] == mark["window"] and seat_view.overlaps(
                            row["bounds"], target.screen, target.screens) for row in canvas["windows"]):
                        return True
            return target.key in self.payment_holds

        if not current():
            return unsafe
        client, session = await self._connection(target, owner_observation=True)
        canvas = await self._canvas_windows(client, session, owner_observation=True)
        if not current() or private(canvas):
            return unsafe
        local = seat_view.windows(canvas, target.screen, target.screens)
        observation = safe_observation(seat_view.projected_reply({}, local, seat_view.windows_text(local)))
        if not observation["safe"]:
            return unsafe
        port, password = connection
        picture = await asyncio.to_thread(capture, port, password, target.screen)
        if not current() or private(canvas):
            return unsafe
        observation["images"] = [{"type": "image", "mimeType": "image/png", "data": base64.b64encode(picture).decode()}]
        return observation

    async def _canvas_windows(self, client, session, filters=None, *, owner_observation=False):
        reply = await client.request("tools/call", {"name": "list_windows", "arguments": {**(filters or {}), "session": session}},
                                     **({"owner_observation": True} if owner_observation else {}))
        try:
            return seat_view.canvas_windows(reply)
        except (ValueError, KeyError, TypeError):
            raise VmError("window_list_unavailable") from None

    async def _shared_browser_window(self, target, client, session):
        # The caller holds the unit native lock across discovery, launcher and attach.
        canvas = await self._canvas_windows(client, session)
        own = seat_view.windows(canvas, target.screen, target.screens)["windows"]
        found = [row for row in own if row.get("app_name", "").lower() in BROWSER_APPS]
        if found:
            return min(found, key=lambda row: row["window_id"])
        return await self.vm.seat_browser(target)

    @staticmethod
    def _seat_error(text):
        return {"isError": True, "content": [{"type": "text", "text": text}]}

    async def _own_window(self, target, client, session, identifier, pid=None):
        canvas = await self._canvas_windows(client, session)
        row = next((row for row in canvas["windows"] if row.get("window_id") == identifier), None)
        if (row is None or not seat_view.mine(identifier, canvas, target.screen, target.screens)
                or pid is not None and row.get("pid") != pid):
            return None
        if not seat_view.contains(row["bounds"], target.screen, target.screens):
            # A centre-owned window must fit wholly before any pixels, tree or input can cross the wall.
            try:
                async with self._native_lock(target):
                    await self.vm.fit_window(target, row)
            except VmError as error:
                if str(error) != "window_move_failed":
                    raise
                return None
            # The window manager applies the move when it gets to it: half a second was enough on an idle PC and not on a loaded one.
            until, pause = time.monotonic() + self.window_fit_wait_s, .05
            while True:
                canvas = await self._canvas_windows(client, session)
                fresh = next((item for item in canvas["windows"] if item.get("window_id") == identifier), None)
                if fresh is None or fresh.get("pid") != row.get("pid"):
                    return None
                if seat_view.contains(fresh["bounds"], target.screen, target.screens):
                    return fresh
                if time.monotonic() >= until:
                    return None
                await asyncio.sleep(pause)
                pause = min(pause * 2, 1.0)
        return row

    async def _bound_window(self, target, client, args):
        """One fresh gate for public page calls and private-picture/vault reads alike."""
        key = (target.key, args["target_id"])
        binding = self.page_windows.get(key)
        if binding is None or binding[0] != args.get("session"):
            self.page_windows.pop(key, None)
            return None
        _, identifier, pid = binding
        row = await self._own_window(target, client, args.get("session"), identifier, pid)
        if row is None or args.get("window_id", identifier) != identifier or args.get("pid", pid) != pid:
            self.page_windows.pop(key, None)
            return None
        return row

    async def _seat_driver_call(self, target, client, name, arguments, *, own=False):
        session = arguments.get("session")
        args = dict(arguments)
        policy = SHARED_ARGUMENTS.get(name, {})
        refused = [key for key in shared_argument_paths(args) if key not in policy or policy[key] == "refuse"]
        refused.extend(key for key in args if "." in key or "[" in key)
        if refused:
            return self._seat_error("Unsupported shared-screen arguments: " + ", ".join(sorted(refused)))
        # move_cursor's "desktop" is the driver's own word for "the real pointer": the point is still this member's,
        # checked against its screen and translated below. Everywhere else a desktop frame names the whole canvas.
        if name != "move_cursor" and args.get("scope") == "desktop" or args.get("coordinate_frame") == "desktop":
            return self._seat_error("Desktop targeting is unavailable here; name one of this member's own windows.")
        window_native = NATIVE_INPUT_TOOLS - {"move_cursor", "launch_app", "clipboard_write", "browser_prepare"}
        if name in window_native and (not args.get("window_id") or args.get("scope") == "desktop"):
            return self._seat_error("The computer's focus and pointer are shared. Please name one of this member's own windows; call list_windows.")
        window = None
        if own and name == "get_browser_state" and not args.get("window_id") and (
                "target_id" not in args or (target.key, args["target_id"]) not in self.page_windows):
            # What real members sent at a seat (2026-11-12). The driver's reply to browser_prepare says the next call
            # is get_browser_state, and a member then names the browser's process, or nothing; and a CLI turn that is
            # started again when the computer's catalog changes has only a cut record of its last reply, and names
            # ids it never had ("2"). Each was told its window was not on its screen and gave up. One browser serves
            # every seat, so its process names no window: the one browser window on this member's own screen is the
            # one it means, and the reply names the real target and tabs. Only the member's own read: its input still
            # names its window, a target it did bind is judged as before, and what the core reads for it (a private
            # page's state, a field before a saved value is typed) must be the tab it asked for or nothing.
            canvas = await self._canvas_windows(client, session)
            fits = [row for row in seat_view.windows(canvas, target.screen, target.screens)["windows"]
                    if row.get("app_name", "").lower() in BROWSER_APPS and args.get("pid", row.get("pid")) == row.get("pid")]
            if len(fits) != 1:
                return self._seat_error("The bound window is not on this member's screen. Call list_windows and bind an own window again."
                                        if "target_id" in args else
                                        "Name one of this member's own windows or a bound target_id; call list_windows.")
            args.pop("target_id", None)
            args.pop("tab_id", None)
            args["window_id"], args["pid"] = fits[0]["window_id"], fits[0]["pid"]
        if "target_id" in args:
            window = await self._bound_window(target, client, args)
            if window is None:
                return self._seat_error("The bound window is not on this member's screen. Call list_windows and bind an own window again.")
        if "window_id" in args or ("pid" in args and name != "list_windows"):
            window = await self._own_window(target, client, session, args.get("window_id"), args.get("pid"))
            if window is None:
                # A process alone names no window here, and saying "not on your screen" sends a member away from
                # a window that is its own.
                return self._seat_error("The window is not on this member's screen. Call list_windows and name an own window."
                                        if args.get("window_id") else
                                        "A process alone names no window on a shared computer: pass window_id with pid. Call list_windows.")
        if name == "browser_prepare":
            window = (args if args.get("window_id") else await self._shared_browser_window(target, client, session))
            args = {"pid": window["pid"], "window_id": window["window_id"],
                    "strategy": {"kind": "existing_profile"}, "session": session,
                    **{key: args[key] for key in ("delivery_mode",) if key in args}}
            # A newly launched window must pass the same fresh wall as an existing one.
            window = await self._own_window(target, client, session, args["window_id"], args["pid"])
            if window is None:
                return self._seat_error("The window is not on this member's screen. Call list_windows.")
        if name == "get_browser_state" and not (args.get("window_id") or args.get("target_id")):
            return self._seat_error("Name one of this member's own windows or a bound target_id; call list_windows.")
        if name == "move_cursor":
            _, _, width, height = seat_view.rectangle(target.screen, target.screens)
            if not (0 <= args["x"] < width and 0 <= args["y"] < height):
                return self._seat_error("Cursor coordinates must be inside this member's screen.")
            args["x"], args["y"] = seat_view.to_canvas(target.screen, target.screens, args["x"], args["y"])
            args["scope"] = "desktop"
        elif name in window_native:
            for xkey, ykey in (("x", "y"), ("from_x", "from_y"), ("to_x", "to_y")):
                if xkey not in args and ykey not in args:
                    continue
                if (xkey not in args or ykey not in args or window is None
                        or seat_view.to_seat(target.screen, target.screens,
                            window["bounds"]["x"] + args[xkey], window["bounds"]["y"] + args[ykey]) is None):
                    return self._seat_error("Pointer coordinates must be inside this member's screen.")
            # The driver's drag interpolates a straight path: both endpoints in this convex rectangle bound every step.
        if name == "verify_state":
            from copy import deepcopy
            args = deepcopy(args)
            for predicate in args.get("expect", []):
                bounds = predicate.get("window", {}).get("bounds")
                if isinstance(bounds, dict):
                    bounds["x"], bounds["y"] = seat_view.to_canvas(target.screen, target.screens, bounds["x"], bounds["y"])
        if name in ("list_windows", "get_desktop_state"):
            canvas = await self._canvas_windows(client, session, args if name == "list_windows" else None)
            local = seat_view.windows(canvas, target.screen, target.screens)
            if name == "list_windows" and "pid" in args:
                local["windows"] = [row for row in local["windows"] if row["pid"] == args["pid"]]
            reply = seat_view.projected_reply({}, local, seat_view.windows_text(local))
            if name == "get_desktop_state":
                from .rfb_view import capture
                port, password = await self.vm.viewer_connection(target)
                picture = await asyncio.to_thread(capture, port, password, target.screen)
                reply["content"].append({"type": "image", "mimeType": "image/png", "data": base64.b64encode(picture).decode()})
            return reply
        before = await self._canvas_windows(client, session) if name == "launch_app" else None
        reply = await client.request("tools/call", {"name": name, "arguments": args})
        if before is not None and not reply.get("isError"):
            after = await self._canvas_windows(client, session)
            existing = {row["window_id"] for row in before["windows"]}
            launched = reply.get("structuredContent") or {}
            launch_pids = {launched.get("pid"), launched.get("launcher_pid")} - {None, 0}
            new = [row for row in after["windows"] if row["window_id"] not in existing]
            owned = [row for row in new if row["pid"] in launch_pids]
            candidates = owned or (new if len(new) == 1 else [])
            for row in candidates:
                if not seat_view.mine(row["window_id"], after, target.screen, target.screens):
                    await self.vm.move_window(target, row["window_id"])
            after = await self._canvas_windows(client, session)
        if reply.get("isError"):
            return reply
        state = reply.get("structuredContent")
        if not isinstance(state, dict):
            for block in reply.get("content", []):
                if block.get("type") == "text":
                    try:
                        state = json.loads(block["text"])
                    except ValueError:
                        continue
                    if isinstance(state, dict):
                        break
        if name == "get_cursor_position":
            if not isinstance(state, dict) or not {"x", "y"} <= state.keys():
                return self._seat_error("Pointer position is unavailable.")
            point = seat_view.to_seat(target.screen, target.screens, state["x"], state["y"])
            return seat_view.projected_reply(reply, dict(x=point[0], y=point[1]) if point else {},
                                             f"✅ Cursor at ({point[0]}, {point[1]})" if point else "The pointer is on another screen.")
        if name == "get_browser_state" and isinstance(state, dict) and state.get("target_id") and window:
            self.page_windows[(target.key, state["target_id"])] = (session, window["window_id"], window["pid"])
        if name == "move_cursor":
            text = f"Moved the real desktop pointer to ({arguments['x']}, {arguments['y']})."
            state = {**(state or {}), "summary": text}
            return seat_view.projected_reply(reply, state, text)
        if name in ("click", "double_click", "right_click", "drag", "scroll", "type_text", "press_key", "hotkey"):
            # Only this trailer names canvas coordinates; retain the driver's action wording and evidence.
            from copy import deepcopy
            reply = deepcopy(reply)
            for block in reply.get("content", []):
                if block.get("type") == "text":
                    block["text"] = re.sub(r"\s*\[window_point=.*?screen_point=.*?\]", "", block.get("text", ""))
            if isinstance(state, dict) and isinstance(state.get("summary"), str):
                state = {**state, "summary": re.sub(r"\s*\[window_point=.*?screen_point=.*?\]", "", state["summary"])}
                reply["structuredContent"] = state
        if isinstance(state, dict) and name in ("get_window_state", "verify_state", "get_browser_state", "browser_prepare", "launch_app"):
            state = seat_view.window_state(state, target.screen, target.screens)
            if name == "launch_app" and isinstance(state.get("windows"), list):
                # Use settled bounds after any move, retaining only windows actually named by the launch reply.
                ids = {row["window_id"] for row in state["windows"]}
                state["windows"] = seat_view.windows(after, target.screen, target.screens)["windows"]
                state["windows"] = [row for row in state["windows"] if row["window_id"] in ids]
            return seat_view.projected_reply(reply, state)
        return reply

    async def _connection(self, target, *, member=None, owner_observation=False):
        async with self.connection_locks.setdefault(target.key, asyncio.Lock()):
            return await self._connect(target, member=member, owner_observation=owner_observation)

    async def _connect(self, target, *, member=None, owner_observation=False):
        """A computer's one connection to its driver, and its session label. The driver ends a session with the connection
        that used it, and with it the browser it opened, the tab it bound and the screenshot a gesture needs. A new
        connection takes a new label: the driver refuses one that has ended."""
        held = self.connections.get(target.key)
        if held is not None and held[0].alive:
            return held
        await self._disconnect(target.key)
        client = self.bridge(self.vm, target)
        await client.__aenter__()
        session = f"{self.session_prefix}-{next(self.labels)}"
        try:
            # The driver refuses an argument its schema does not name (`additionalProperties: false`), and a refused
            # set-up call fails every tool of the computer. cua-driver 0.37.0 `describe set_agent_cursor_enabled`:
            # `enabled` and `session` only; the cursor is the session's.
            for name, arguments in (("set_config", {"max_image_dimension": 1456}),
                                    ("set_agent_cursor_enabled", {"enabled": False})):
                if member is not None and target != self.vm.target(member):
                    raise VmError("computer_changed")
                if target.key in self.vm.held and not owner_observation:
                    raise VmError("owner_holds_control")
                reply = await client.request("tools/call", {"name": name, "arguments": {**arguments, "session": session}},
                                             **({"owner_observation": True} if owner_observation else {}))
                if reply.get("isError"):
                    raise VmError("driver_configuration_failed")
        except BaseException:
            await client.__aexit__(None, None, None)
            self.vm.invalidate(target)
            raise
        self.connections[target.key] = client, session
        return self.connections[target.key]

    async def _disconnect(self, key):
        for remembered in (self.page_windows, self.page_tabs, self.page_refs):
            for binding in list(remembered):
                if binding[0] == key:
                    remembered.pop(binding, None)
        held = self.connections.pop(key, None)
        if held is not None:
            await held[0].__aexit__(None, None, None)

    async def aclose(self):
        for task in list(self.refreshes.values()):
            task.cancel()
        await asyncio.gather(*list(self.refreshes.values()), return_exceptions=True)
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
        self.vm.lease_targets[target.key] = target
        self.lease_used[target.key] = self.vm.clock()
        return None

    def _busy(self, target, held, waited, *, note=None, held_by=None):
        """Not a tool failing: how things stand, so that the model can do other work or ask again later."""
        held = held or self.leases.get(target.key)
        name = held_by or ("someone" if held is None else self._name_of(held))
        since = self.lease_since.get(target.key)
        return PluginResult(True, "computer_busy", json.dumps({
            "status": "computer_busy", "held_by": name,
            "held_for_s": None if since is None else round(self.vm.clock() - since), "waited_s": round(waited),
            "note": note or f"{name} is using the computer. Nothing was done. Do other work that does not need it, or call again "
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

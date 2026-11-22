"""Loopback desktop viewer for Docker screens and host Chrome tabs.

The container supplies noVNC's RFB library. Its UI-free library embedding uses
Raphael's existing conversation controls instead of the standalone vnc.html UI.
Host tabs use the same session and lease through a canvas page fed by CDP.
Docker viewer passwords live only in core and RFB memory.
"""

import asyncio
import base64
import json
import logging
import re
import secrets
import time
from dataclasses import dataclass, field
from pathlib import Path

import httpx

from ..frame_navigation import FRAME_NAVIGATION
from ..protocol import invalid_params
from .vm import OWNER_IDLE_S, SHARED, VmError
from .owner_transfer import CLIPBOARD_MAX, clipboard_text, hand_over, safe_name
from .viewer_relay import Policy, ViewerRelay
from .host_view import HostInputGate
from .host_view_script import SCRIPT as HOST_SCRIPT
from ..paths import local_storage_root

LEASE_SECONDS = 15
# One call of the computer's driver for the owner's paste or copy: the page sends the paste's keys after at most PASTE_WAIT_MS.
DRIVER_CALL_S = 3
# The owner's press on Take control gives an action a member already has under way this long to end (the member's
# next action is refused from the moment the press lands): a press that fell between two of a working member's
# actions used to be answered "desktop busy" and leave them with no way to try again.
TAKE_WAIT_S = 10
# An open page polls every two seconds and each answer starts several Docker processes.
UNWATCHED_STATUS_S = 10
# What the owner's press may open; anything else, such as a program a member wrote, is only shown in its folder.
READABLE = frozenset(".html .htm .pdf .png .jpg .jpeg .gif .webp .svg .txt .md .csv .json .mp3 .wav .m4a .mp4 .webm .docx .xlsx .pptx".split())
HOST_PAGE = b"""<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; connect-src 'self'; img-src data:; style-src 'unsafe-inline'">
<style>html,body{margin:0;height:100%;background:#000}canvas{width:100%;height:100%;object-fit:cover;display:block;touch-action:none}
textarea{position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none}</style>
<canvas></canvas><textarea aria-label="Browser input"></textarea><script src="host.js" defer></script>"""
BOOTSTRAP = b'''let RFB, rfb, connecting = false, closed = false, controlAt = 0, revision = 0, framesTimer = null;
const screen = document.getElementById('noVNC_container');
const tell = state => parent.postMessage({type:'raphael-desktop', state}, '*');
async function connect() {
  if (connecting || closed) return;
  connecting = true;
  try {
    try { if (!RFB) ({default:RFB} = await import('./core/rfb.js')); }
    catch { tell('unreachable'); return; }
    const response = await fetch('./connection', {cache:'no-store'});
    if (!response.ok) throw Error('unavailable');
    let config = await response.json();
    rfb = new RFB(screen, `ws://${location.host}${config.path}`, {credentials:{password:config.password}});
    rfb.viewOnly = !config.held;
    // The desktop keeps its own size; a small panel shows it scaled, never reflowed.
    rfb.resizeSession = false;
    config = null;
    rfb.scaleViewport = true;
    rfb.clipViewport = false;
    rfb.background = 'transparent';
    rfb.addEventListener('connect', () => tell('connected'));
    rfb.addEventListener('disconnect', () => {rfb = null; tell('disconnected');});
    rfb.addEventListener('securityfailure', () => {rfb?.disconnect(); tell('disconnected');});
  } catch { tell('unreachable'); }
  finally { connecting = false; }
}
addEventListener('message', event => {
  if (event.source !== parent) return;
  if (event.data?.type === 'raphael-desktop-frames') {
    clearInterval(framesTimer); framesTimer = null;
    if (event.data.on === true) { snapshot(); framesTimer = setInterval(snapshot, 3000); }
    return;
  }
  if (event.data?.type === 'raphael-desktop-disable') {
    clearInterval(framesTimer); framesTimer = null;
    pasting = null;
    if (rfb) { rfb.viewOnly = true; rfb.disconnect(); rfb = null; }
    return;
  }
  if (event.data?.type === 'raphael-desktop-paste') {
    const ask = pasting;
    if (!ask || ask.id !== event.data.id) return;
    pasting = null;
    // Control ended while the app read the clipboard: nothing is pasted.
    if (!rfb || rfb.viewOnly) return;
    const text = event.data.text;
    if (typeof text === 'string' && text && text.length <= PASTE_MAX) rfb.clipboardPasteFrom(text);
    setTimeout(() => chord('KeyV', ask.shift), 60);
    return;
  }
  if (event.data?.type !== 'raphael-desktop-control' || !rfb) return;
  const current = ++revision;
  rfb.viewOnly = true;
  pasting = null;
  if (!event.data.held) return;
  void fetch('./control', {cache:'no-store'}).then(response => response.ok ? response.json() : null).then(config => {
    if (current !== revision || !rfb || !config?.held) return;
    rfb.viewOnly = false; rfb.focus(); controlAt = performance.now();
    parent.postMessage({type:'raphael-desktop', state:'interactive', held:true}, '*');
    const point = event.data.pointer;
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
      const canvas = screen.querySelector('canvas'), box = canvas?.getBoundingClientRect();
      if (box) canvas.dispatchEvent(new MouseEvent('mousemove', {bubbles:true,clientX:box.left+box.width*point.x,clientY:box.top+box.height*point.y,buttons:0}));
      const accepted = async () => {
        if (current !== revision || !rfb || rfb.viewOnly) return;
        const response = await fetch('./control', {cache:'no-store'});
        const next = response.ok ? await response.json() : null;
        if (next?.held && next.input_sequence > config.input_sequence) parent.postMessage({type:'raphael-desktop',state:'input-accepted'}, '*');
        else if (performance.now()-controlAt < 1000) setTimeout(() => void accepted().catch(() => {}), 16);
      };
      void accepted().catch(() => {});
    }
  }).catch(() => {});
});
// Paste from the owner's PC. While they hold control (rfb.viewOnly is false) Ctrl+V and Ctrl+Shift+V are held back here, because
// the computer would paste its own clipboard; on a Mac their paste is Command+V, and the computer is told Ctrl+V with its Super
// (their Command, which noVNC sends as one) let go first. The app, which alone reads their clipboard, is asked for its text; it goes
// to the computer's clipboard and only then are the keys of the paste sent. Watching, or a member at work, never asks.
// Their copy (Ctrl+C, Ctrl+X, a terminal's Ctrl+Shift+C, or Command+C and Command+X told as Ctrl) reaches the computer as typed;
// a moment later the app is told, and brings what the computer copied to their PC's clipboard.
const PASTE_WAIT_MS = 4000, PASTE_MAX = 1000000, COPY_SETTLE_MS = 250, mods = {ctrl:false, shift:false, meta:false};
const KEYS = {KeyV:[0x76, 0x56], KeyC:[0x63, 0x43], KeyX:[0x78, 0x58]};
let pasteAsks = 0, pasting = null;
function track(event) {
  if (event.key === 'Control') mods.ctrl = event.type === 'keydown';
  else if (event.key === 'Shift') mods.shift = event.type === 'keydown';
  else if (event.key === 'Meta') mods.meta = event.type === 'keydown';
}
function chord(code, shift) {
  if (!rfb || rfb.viewOnly) return;
  if (mods.meta) { rfb.sendKey(0xFFEB, 'MetaLeft', false); mods.meta = false; }
  if (!mods.ctrl) rfb.sendKey(0xFFE3, 'ControlLeft', true);
  if (shift && !mods.shift) rfb.sendKey(0xFFE1, 'ShiftLeft', true);
  rfb.sendKey(KEYS[code][shift ? 1 : 0], code);
  if (shift && !mods.shift) rfb.sendKey(0xFFE1, 'ShiftLeft', false);
  if (!mods.ctrl) rfb.sendKey(0xFFE3, 'ControlLeft', false);
}
screen.addEventListener('keyup', track, true);
screen.addEventListener('keydown', event => {
  track(event);
  // The owner's own chord: with Ctrl, or Command on a Mac; one of the two, never both, and never with Alt.
  if (!rfb || rfb.viewOnly || !Object.hasOwn(KEYS, event.code) || event.ctrlKey === event.metaKey || event.altKey) return;
  if (event.code !== 'KeyV') {
    if (event.metaKey) { event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) chord(event.code, event.shiftKey); }
    if (!event.repeat) setTimeout(() => { if (rfb && !rfb.viewOnly) parent.postMessage({type:'raphael-desktop-copied'}, '*'); }, COPY_SETTLE_MS);
    return;
  }
  event.preventDefault(); event.stopImmediatePropagation();
  if (event.repeat || pasting) return;
  const id = ++pasteAsks, shift = event.shiftKey;
  pasting = {id, shift};
  parent.postMessage({type:'raphael-desktop-paste-request', id}, '*');
  // An app that does not answer leaves the paste as it was: the computer's own clipboard.
  setTimeout(() => { if (pasting?.id === id) { pasting = null; chord('KeyV', shift); } }, PASTE_WAIT_MS);
}, true);
// Files dropped on the screen go to the app, which puts copies in the computer's team folder; the page opens none of them.
addEventListener('dragover', event => {
  if (event.dataTransfer?.types?.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }
}, true);
addEventListener('drop', event => {
  event.preventDefault();
  const files = [...(event.dataTransfer?.files ?? [])];
  if (files.length) parent.postMessage({type:'raphael-desktop-files', files}, '*');
}, true);
addEventListener('blur', () => { mods.ctrl = mods.shift = mods.meta = false; });
screen.addEventListener('mousedown', () => {
  if (rfb && !rfb.viewOnly && controlAt) {
    parent.postMessage({type:'raphael-desktop', state:'input', latencyMs:performance.now()-controlAt}, '*');
    controlAt = 0;
  }
}, true);
// Pictures are opt-in; watching alone never schedules canvas encoding.
function snapshot() {
  const canvas = screen.querySelector('canvas');
  if (!rfb || !rfb.viewOnly || !canvas?.width) return;
  const small = document.createElement('canvas'), scale = Math.min(1, 480 / canvas.width);
  small.width = Math.round(canvas.width * scale); small.height = Math.round(canvas.height * scale);
  small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
  parent.postMessage({type:'raphael-desktop', state:'frame', image:small.toDataURL('image/jpeg', 0.6)}, '*');
}
addEventListener('pagehide', () => {snapshot(); clearInterval(framesTimer); framesTimer = null; closed = true; rfb?.disconnect();});
document.documentElement.classList.remove('noVNC_loading');
connect();
setInterval(() => { if (!rfb) connect(); }, 2000);
''' + b"window.raphaelOwnsInput = () => !!rfb && !rfb.viewOnly;\n" + FRAME_NAVIGATION.encode()


def embedded_page(content):
    # Fail closed if a different image stops providing the expected noVNC entry.
    if 'id="noVNC_container"' not in content or "app/ui.js" not in content:
        raise VmError("viewer_incompatible")
    # noVNC's documented library embedding omits its standalone UI altogether.
    # Keep the upstream license comments, but never load the standalone CSS: it
    # clips #noVNC_container to an 800x600 curved corner until UI.js connects.
    notices = "\n".join(re.findall(r"<!--.*?-->", content, flags=re.S))
    return (f'<!doctype html><html><head><meta charset="utf-8">{notices}'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>Raphael desktop</title><style>'
            'html,body {height:100%;margin:0;overflow:hidden;background:#171717} '
            '#noVNC_container {width:100%;height:100%}'
            '</style><script type="module" src="bridge.js"></script></head>'
            '<body><div id="noVNC_container"></div></body></html>').encode()


@dataclass
class Session:
    target: object
    expires: float
    sockets: set = field(default_factory=set)
    revision: int = 0
    member_id: int = 0
    conversation_id: int | None = None
    preview: bool = False
    input_sequence: int = 0
    connection: tuple | None = field(default=None, repr=False)
    connection_changes: int = -1
    connection_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    error: str | None = None
    # The last time their input reached the screen while this view held it, read from the relay's count of forwarded input.
    input_at: float = 0.0
    seen_input: int = 0
    # What the computer's clipboard was last known to hold through this view (the owner's paste or copy), never logged: a
    # copy that leaves it as it was (Ctrl+C in a terminal) does not replace what the owner has on their PC.
    clipboard: str | None = field(default=None, repr=False)
    host_tab: object = field(default=None, repr=False)
    host_gate: HostInputGate | None = field(default=None, repr=False)
    host_epoch: int = 0

    transport_hint: str | None = None

    @property
    def owner_key(self):
        return f"host:{self.member_id}" if self.host_tab is not None else self.target.key


class DesktopViewer:
    def __init__(self, vm, *, member_exists=lambda member: True, copy_to_owner=None, stored_path=None):
        self.vm, self.member_exists = vm, member_exists
        # The owner's PC clipboard (device actions), and where the store keeps an upload by its stored id.
        self.copy_to_owner, self.stored_path = copy_to_owner, stored_path
        self.sessions, self.owners = {}, {}
        self.remembered = {}
        self.status_cache, self.status_locks = {}, {}
        self.vm.viewer_owners = self.owners
        self.vm.close_seat_viewers = self.close_seat
        self.server = self.monitor = None
        self.origin = ""
        self.relay = None
        self.closing = False
        self.control_lock = asyncio.Lock()
        self.teaching = None
        self.task_artifact = lambda task, evidence: None
        self.open_lock = asyncio.Lock()
        self.take_wait_s = TAKE_WAIT_S
        self.host_browser = self.handbacks = None
        self.problem_note = None
        self.recent_problems = {}
        self.active_transport = None
        self.host_peers = {}
        self.host_cleanup = set()

    def register(self, router):
        for name, handler in (("status", self.status), ("open", self.open), ("renew", self.renew),
                              ("control", self.control), ("close", self.close), ("clipboard", self.clipboard),
                              ("put_file", self.put_file)):
            router.register(f"computer.viewer_{name}", handler)
        router.register("computer.lifecycle", self.lifecycle)
        router.register("computer.team_file", self.team_file)
        router.register("computer.wallpaper", self.wallpaper)

    async def wallpaper(self, _params):
        own = self.vm.own_wallpaper()
        if own is None:
            return {}
        try:
            data = await asyncio.to_thread(own.read_bytes)
        except OSError:
            return {}
        return {"image": "data:image/jpeg;base64," + base64.b64encode(data).decode("ascii")}

    async def team_file(self, params):
        """Where a file of the team folder is on this PC, for the owner's own press. A folder on another computer has no such place."""
        path = params.get("path")
        member_file = re.fullmatch(r"member-file:(0|[1-9][0-9]*):(workspace|team):(.+)", path) if isinstance(path, str) else None
        if member_file:
            member, area, relative = member_file.groups()
            target = self.target({"member_id": int(member)})
            if target.remote or Path(relative).is_absolute() or "\\" in relative:
                raise invalid_params("not a member file on this computer")
            root = self.file_root(target.workspace if area == "workspace" else target.shared)
            found = (root / relative).resolve()
            if not found.is_relative_to(root) or not found.is_file():
                raise invalid_params("no such member file")
            return {"path": str(found), "reads": found.suffix.lower() in READABLE}
        artifact = re.fullmatch(r"task-artifact:([1-9][0-9]*):([1-9][0-9]*)", path) if isinstance(path, str) else None
        if artifact:
            found = self.task_artifact(*(int(value) for value in artifact.groups()))
            if found is None:
                raise invalid_params("artifact unavailable")
            return {"path": str(found), "reads": found.suffix.lower() in READABLE}
        target = self.vm.target(0)
        if type(path) is not str or not path.startswith(SHARED + "/") or target.remote or target.shared is None:
            raise invalid_params("not a team file on this computer")
        root = self.file_root(target.shared)
        found = (root / path[len(SHARED) + 1:]).resolve()
        if not found.is_relative_to(root) or not found.is_file():
            raise invalid_params("no such team file")
        return {"path": str(found), "reads": found.suffix.lower() in READABLE}

    @staticmethod
    def file_root(path):
        try:
            return local_storage_root(path)
        except (OSError, ValueError):
            raise invalid_params("no such member file") from None

    async def held_session(self, params):
        """The view that holds its computer's screen now: the owner's own paste and copy need their hands on it."""
        token, session = self.session(params)
        await self.check_session_target(token, session)
        if session.preview or self.owners.get(session.target.key) != token:
            raise invalid_params("the owner does not hold this screen")
        return session

    async def driver_call(self, target, name, arguments):
        """One call of the computer's driver for the owner's own paste or copy; None when it fails or says it failed."""
        from .vm_bridge import CuaBridge
        try:
            async with asyncio.timeout(DRIVER_CALL_S), CuaBridge(self.vm, target) as bridge:
                result = await bridge.request("tools/call", {"name": name, "arguments": arguments}, owner_hands=True)
        except (VmError, OSError, ConnectionError, TimeoutError, ValueError, RuntimeError):
            return None
        return result if isinstance(result, dict) and not result.get("isError") else None

    async def clipboard(self, params):
        """The owner's paste into the computer and copy out of it, while they hold its screen (R-PASTE-01, R-PASTE-02). `put`
        hands the text of their paste to the computer's clipboard; `take`, after their own copy key in the screen, brings
        what the computer copied to their PC's clipboard, unless the computer's clipboard is what it was. Nothing is logged."""
        session = await self.held_session(params)
        action = params.get("action")
        if action == "put":
            text = params.get("text")
            if type(text) is not str or not text or len(text) > CLIPBOARD_MAX:
                raise invalid_params("text must be 1 to 1000000 characters")
            put = await self.driver_call(session.target, "clipboard_write", {"text": text}) is not None
            if put:
                session.clipboard = text
            return {"put": put}
        if action != "take":
            raise invalid_params("action must be put or take")
        text = clipboard_text(await self.driver_call(session.target, "clipboard_read", {"include_text": True}))
        if self.copy_to_owner is None or not text or len(text) > CLIPBOARD_MAX or text == session.clipboard:
            return {"copied": False}
        try:
            await asyncio.to_thread(self.copy_to_owner, text)
        except OSError:
            return {"copied": False}
        session.clipboard = text
        return {"copied": True}

    async def put_file(self, params):
        """A file the owner dropped on the computer's screen or chose for it, already in the upload store: a copy goes into
        the computer's team folder under its own name, a number added when that name is taken, and the name it got comes
        back (R-COMP-FILE-01). Watching is enough: a file goes into a folder, not under anyone's hands."""
        token, session = self.session(params)
        await self.check_session_target(token, session)
        if session.preview:
            raise invalid_params("preview is read only")
        if session.host_tab is not None:
            raise invalid_params("file transfer requires an isolated computer")
        try:
            name = safe_name(params.get("name"))
            source = self.stored_path(params.get("stored_id")) if self.stored_path else None
        except (ValueError, OSError, KeyError, TypeError):
            raise invalid_params("no such upload") from None
        if source is None:
            raise invalid_params("no such upload")
        try:
            placed = await hand_over(self.vm, session.target, source, name)
        except VmError as error:
            raise invalid_params("file too large for a remote computer" if str(error) == "file_too_large" else "file not placed") from None
        except OSError:
            raise invalid_params("file not placed") from None
        return {"name": placed, "path": f"{SHARED}/{placed}"}

    async def lifecycle(self, params):
        from .lifecycle import maintain
        target = self.target(params)
        if params.get("host") != target.remote or params.get("target") != target.key:
            raise invalid_params("Computer changed; review maintenance again")
        await maintain(self.vm, target, params.get("action"), confirmed=params.get("confirmed", False))
        return await self.status(params)

    def target(self, params):
        member = params.get("member_id", 0)
        if type(member) is not int or member < 0 or not self.member_exists(member):
            raise invalid_params("invalid desktop member")
        return self.vm.target(member)

    async def status(self, params):
        if params.get("check_host") is True:
            from .remote_host import host_health
            try:
                return await host_health(params.get("alias", self.vm.remote))
            except ValueError:
                raise invalid_params("Invalid SSH config alias") from None
        target = self.target(params)
        member = params.get("member_id", 0)
        transport = self.transport(params)
        if params.get("transport") == "docker":
            transport = "docker"  # An explicit status probe for the setup control.
        if transport == "host":
            state = self.host_state(member, params.get("conversation_id"))
            await self.report_problem(params, state)
            return state
        if transport is None:
            return {"transport": "idle", "state": "absent", "control": "member", "ready": False}
        if params.get("start_docker") is True:
            # Only an explicit owner-window press may start this PC's engine.
            if target.remote or params.get("host") != target.remote:
                raise invalid_params("Docker Desktop can only be started on this PC")
            try:
                await self.vm.ensure_engine(target, start_desktop=True)
            finally:
                self.vm.preparation.pop(target.state_key, None)
            self.vm.changes += 1
        if not await self.vm.installed():
            return {"transport": "docker", "state": "absent", "control": "member", "ready": False, "error": "disabled" if not self.vm.enabled else "docker_missing"}
        state = await self.unwatched_status(target)
        await self.report_problem(params, {**state, "transport": "docker", "target": target.key})
        works = self.vm.work.views(params.get("member_id", 0), params.get("conversation_id"))
        return {**state, "transport": "docker", "host": target.remote, "target": target.key,
                "mode": target.container or "per-bot",
                "idle_minutes": self.vm.settings.get("computer_vm_idle_minutes") if self.vm.settings else 15,
                "lifecycle": self.vm.lifecycle.get(target.state_key),
                **({"repair_revision": self.vm.repair_revisions[target.state_key]} if target.state_key in self.vm.repair_revisions else {}),
                **self.woken(target, state.get("state")),
                **({"works": works} if works else {}),
                **(self.teaching.status(params.get("member_id", 0), params.get("conversation_id"), target) if self.teaching else {})}

    async def report_problem(self, params, state):
        problem = params.get("viewer_problem")
        if (problem not in ("show the screen", "pass control through the viewer", "complete computer maintenance",
                           "send a file to the virtual machine", "complete a demonstration")
                or params.get("observed_transport") != state.get("transport")
                or state.get("transport") == "host" and state["state"] == "absent"
                or params.get("observed_target") not in (None, state.get("target"))):
            return
        await self.note_problem(params.get("member_id", 0), params.get("conversation_id"), state["transport"], problem)

    async def note_problem(self, member, conversation, transport, problem):
        if self.problem_note is None or type(conversation) is not int:
            return
        now = self.vm.clock()
        self.recent_problems = {scope: at for scope, at in self.recent_problems.items() if now - at < 30}
        key = (member, conversation, transport, problem)
        if key in self.recent_problems:
            return
        self.recent_problems[key] = now
        try:
            if not await self.problem_note(member, conversation, transport, problem):
                self.recent_problems.pop(key, None)
        except Exception as error:
            self.recent_problems.pop(key, None)
            logging.getLogger(__name__).warning("Could not pass a viewer problem to the member (%s)", type(error).__name__)

    def woken(self, target, state):
        """Who woke the running computer and why, when a member's own tool did it (R-COMP-WAKE-01): the row of its panel says so."""
        woken = self.vm.woken.get(target.state_key)
        return {"woken": dict(woken)} if woken and state == "running" else {}

    async def open(self, params):
        async with self.open_lock:
            return await self._open(params)

    def transport(self, params):
        requested = params.get("transport")
        if requested not in (None, "host", "docker"):
            raise invalid_params("invalid computer transport")
        if params.get("start_docker") is True or self.active_transport is None:
            return requested or "docker"
        member, conversation = params.get("member_id", 0), params.get("conversation_id")
        selected = self.active_transport(member, conversation)
        if selected:
            return selected
        if self.host_selection(member, conversation)[1] is not None:
            return "host"
        if any(work["state"] == "waiting_control" for work in self.vm.work.views(member, conversation)):
            return "docker"
        return "host" if self.host_selection(member, conversation)[0] is not None else requested

    def host_selection(self, member, conversation):
        if self.host_browser is None:
            return None, None
        if self.handbacks is not None:
            tab, card = self.handbacks.browser_request(member, conversation)
            if tab is not None and self.host_browser.live(tab):
                return tab, card
        return self.host_browser.viewing_tab(member, conversation), None

    def host_state(self, member, conversation, session=None):
        tab, card = self.host_selection(member, conversation)
        running = tab is not None and self.host_browser.live(tab)
        owner = self.sessions.get(self.owners.get(f"host:{member}"))
        return {"transport": "host", "state": "running" if running else "absent", "ready": running,
                "control": "owner" if owner and (owner is session or session is None and owner.conversation_id == conversation) else "member",
                "preview_allowed": owner is None and card is None,
                **({"target": tab.id} if running else {}),
                **({"works": [{"id": tab.id, "turn_id": tab.turn_id, "transport": "host",
                                                "state": "done" if tab.finished else "running", "tool": "browser_open",
                                                "reason": ""}]} if running and tab.turn_id else {}),
                **({"host_request": {"id": card.id, "request_id": card.id, "turn_id": card.turn_id,
                                     "state": "waiting_control", "tool": "get_browser_state", "reason": card.reason,
                                     "detail": card.note}} if card else {})}

    def target_current(self, target, member):
        if not target.container:
            return True
        return (self.member_exists(member) and self.vm.target(member) == target
                and (target.screen == 0 or self.vm.seats.holders(target.remote).get(target.screen) == member))

    def check_open_target(self, target, params):
        if not self.target_current(target, params.get("member_id", 0)):
            raise invalid_params("desktop seat changed")

    async def check_session_target(self, token, session):
        if session.host_tab is not None:
            current = self.host_current(session)
        else:
            current = self.target_current(session.target, session.member_id)
        if not current:
            # Revoke relay policy before any asynchronous cleanup. _control already holds control_lock.
            if self.relay:
                self.relay.publish(token, None)
            if session.host_tab is None:
                await self._close({"session": token})
            raise invalid_params("desktop seat changed")

    async def _open(self, params):
        target = self.target(params)
        member, conversation = params.get("member_id", 0), params.get("conversation_id")
        transport = self.transport(params)
        if params.get("transport") == "host" and transport != "host":
            raise invalid_params("browser tab changed")
        if transport is None:
            raise invalid_params("no computer is in use")
        host = transport == "host"
        tab, pending = self.host_selection(member, conversation) if host else (None, None)
        if self.closing:
            raise invalid_params("desktop viewer closed")
        if len(self.sessions) >= 8:
            raise invalid_params("too many desktop viewers")
        if type(params.get("preview", False)) is not bool:
            raise invalid_params("preview must be a boolean")
        if host and (tab is None or not self.host_browser.live(tab) or params.get("preview") and pending):
            raise invalid_params("desktop unavailable")
        if host and params.get("target_id") not in (None, tab.id):
            raise invalid_params("browser tab changed")
        if not host and not params.get("preview"):
            try:
                target = await self.vm.seat(params.get("member_id", 0))
            except VmError:
                raise invalid_params("desktop unavailable") from None
            self.check_open_target(target, params)
        if self.server is None:
            self.relay = ViewerRelay(self._prepare_request, self._register_peer, self._unregister_peer,
                                     self._peer_failed, self._teach_input, embedded_page, self._teach_core_input, self.host_frame)
            self.server = await self.relay.start()
            self.origin = f"http://127.0.0.1:{self.server.sockets[0].getsockname()[1]}"
            self.monitor = asyncio.create_task(self._monitor())
        if not host:
            self.check_open_target(target, params)
        token = secrets.token_urlsafe(32)
        session = Session(target, self.vm.clock() + LEASE_SECONDS,
            member_id=member, conversation_id=conversation, preview=params.get("preview", False), host_tab=tab,
            transport_hint=params.get("transport"))
        if host:
            await self.check_session_target(token, session)
            session.host_gate = HostInputGate(self.host_browser, tab, lambda: self.host_input_allowed(token, session))
            self.sessions[token] = session
            self.publish_session(token)
            return {"session": token, "url": f"{self.origin}/{token}/host.html"}
        if not params.get("preview"):
            state = await self.status_for(target)
            self.check_open_target(target, params)
            if state["state"] != "running":
                self.vm.launch(target)
        if target.remote:
            state = await self.status_for(target)
            self.check_open_target(target, params)
        if target.remote and state["state"] == "running":
            try:
                await self.connection_for(session)
            except VmError:
                # Keep the session so renew can explain an unreachable live screen.
                pass
            self.check_open_target(target, params)
        self.check_open_target(target, params)
        session.expires = self.vm.clock() + LEASE_SECONDS
        self.sessions[token] = session
        self.publish_session(token)
        return {"session": token, "url": f"{self.origin}/{token}/vnc.html"}

    def connection_failed(self, session):
        if session.error != "viewer_unreachable":
            logging.getLogger(__name__).warning("Desktop viewer_unreachable")
        session.error = "viewer_unreachable"
        session.connection = None
        session.connection_changes = self.vm.changes

    async def connection_for(self, session):
        # Parallel module requests share one resolution. Lifecycle changes invalidate it.
        async with session.connection_lock:
            if session.connection_changes == self.vm.changes:
                if session.error:
                    raise VmError(session.error)
                if session.connection is not None:
                    return session.connection
            changes = self.vm.changes
            try:
                connection = await self.vm.viewer_connection(session.target)
            except (VmError, OSError, TimeoutError, httpx.HTTPError):
                self.connection_failed(session)
                raise VmError("viewer_unreachable") from None
            session.connection, session.connection_changes = connection, changes
            session.error = None
            return connection

    def session(self, params):
        token = params.get("session")
        session = self.sessions.get(token) if isinstance(token, str) else None
        if session is None or session.expires <= self.vm.clock():
            raise invalid_params("desktop viewer expired")
        return token, session

    async def renew(self, params):
        token, session = self.session(params)
        if session.host_tab is not None and not self.host_current(session):
            await self.close(params)
            await self.report_host_disconnect(session)
            return await self.status({"member_id": session.member_id, "conversation_id": session.conversation_id})
        if self.active_transport is not None and self.owners.get(session.owner_key) != token:
            lookup = {"member_id": session.member_id, "conversation_id": session.conversation_id,
                      "transport": session.transport_hint}
            if self.transport(lookup) != ("host" if session.host_tab is not None else "docker"):
                return await self.status({**lookup, "transport": None})
        await self.check_session_target(token, session)
        session.expires = self.vm.clock() + LEASE_SECONDS
        if session.host_tab is not None:
            self.publish_session(token)
            return self.host_state(session.member_id, session.conversation_id, session)
        if self.owners.get(session.target.key) == token:
            self.vm.hold(session.target, True)
        self.publish_session(token)
        state = await self.session_state(session, read=not session.sockets)
        await self.check_session_target(token, session)
        return state

    async def session_state(self, session, *, read=True):
        # An authenticated live socket already proves the guest is running. Ownership,
        # work and teaching below remain fresh without another Docker status read.
        state = await self.status_for(session.target) if read else {"state": "running", "ready": True}
        works = self.vm.work.views(session.member_id, session.conversation_id)
        token = self.owners.get(session.target.key)
        return {**state, "transport": "docker", "host": session.target.remote, "target": session.target.key,
                "mode": session.target.container or "per-bot",
                "idle_minutes": self.vm.settings.get("computer_vm_idle_minutes") if self.vm.settings else 15,
                "lifecycle": self.vm.lifecycle.get(session.target.state_key),
                **({"repair_revision": self.vm.repair_revisions[session.target.state_key]} if session.target.state_key in self.vm.repair_revisions else {}),
                **self.woken(session.target, state.get("state")),
                "control": "owner" if self.sessions.get(token) is session else "member",
                "preview_allowed": session.target.key not in self.vm.held,
                **({"works": works} if works else {}),
                **(self.teaching.status(session.member_id, session.conversation_id, session.target) if self.teaching else {}),
                **({"error": session.error, "ready": False} if session.error else {})}

    async def unwatched_status(self, target):
        """Unwatched computers keep the longer cache; active viewers share the short cache."""
        key = (target.remote, target.key)
        if (target.state_key in self.vm.preparation or target.key in self.vm.held
                or any(session.target.key == target.key for session in self.sessions.values())):
            self.remembered.pop(key, None)
            return await self.status_for(target)
        changes, now = self.vm.changes, self.vm.clock()
        kept = self.remembered.get(key)
        if kept and kept[0] == changes and 0 <= now - kept[1] < UNWATCHED_STATUS_S:
            return kept[2]
        state = await self.status_for(target)
        if changes == self.vm.changes:
            self.remembered[key] = (changes, now, state)
        return state

    async def status_for(self, target):
        key = (target.remote, target.key)
        async with self.status_locks.setdefault(key, asyncio.Lock()):
            changes, now = self.vm.changes, self.vm.clock()
            kept = self.status_cache.get(key)
            if target.state_key in self.vm.preparation:
                state = await self.read_status(target)
            elif kept and kept[0] == changes and 0 <= now - kept[1] < 3:
                state = kept[2]
            else:
                state = await self.read_status(target)
                if changes == self.vm.changes:
                    self.status_cache[key] = (changes, now, state)
        return {**state, "control": "owner" if target.key in self.vm.held else "member"}

    async def read_status(self, target):
        # Use the exact target captured at open, even if the mode changes meanwhile.
        try:
            state = self.vm.preparation.get(target.state_key) or await self.vm.status(target, probe=False)
        except (VmError, OSError, TimeoutError):
            state = {"state": "unavailable"}
        return {"state": state["state"], "ready": state["state"] == "running",
                **({"image": state["image"]} if "image" in state else {}),
                **({"progress": state["progress"]} if state.get("progress") else {}),
                # The computer is being made again on a newer image: the panel says so in one line (R-COMP-UPDATE-01).
                **({"update": True} if state.get("update") is True else {}),
                **({"error": state["error"]} if state.get("error") else {})}

    async def control(self, params):
        async with self.control_lock:
            return await self._control(params)

    async def _control(self, params):
        token, session = self.session(params)
        await self.check_session_target(token, session)
        held = params.get("held")
        if type(held) is not bool:
            raise invalid_params("held must be a boolean")
        if session.preview:
            raise invalid_params("preview is read only")
        if session.host_tab is not None:
            return await self.control_host(token, session, held, params.get("takeover"))
        target = session.target
        owner = self.owners.get(target.key)
        pending = self.vm.work.pending(target)
        if not held and self.teaching and self.teaching.active(token):
            raise invalid_params("stop or discard the demonstration before handback")
        if pending and (pending.member_id != session.member_id or pending.conversation_id != session.conversation_id):
            raise invalid_params("private conversation required")
        if held:
            # The owner can take over whenever they ask: another view of their own that still holds the
            # computer, or a hold nobody keeps and nobody waits on, is theirs to take. Only a recording in the old
            # holder's view, which a take-over would cut, refuses.
            if owner not in (None, token) and self.teaching and self.teaching.active(owner):
                raise invalid_params("desktop already held")
            if not session.sockets:
                state = await self.status_for(target)
                await self.check_session_target(token, session)
                if state["state"] != "running":
                    raise invalid_params("desktop unavailable")
            if self.owners.get(target.key) not in (owner, token):
                raise invalid_params("desktop busy")
            self.session(params)
            replaced, was_held = self.owners.get(target.key), target.key in self.vm.held
            # Phase A: the hold comes first, so that no tool starts from now on; what already runs gets a bounded time.
            self.owners[target.key] = token
            self.vm.hold(target, True)
            try:
                deadline = time.monotonic() + self.take_wait_s
                while self.vm.input_busy(target) or self.vm.native_busy(target):
                    if time.monotonic() >= deadline:
                        raise invalid_params("desktop busy")
                    await asyncio.sleep(0.05)
                    self.session(params)
                    await self.check_session_target(token, session)
            except BaseException:
                if replaced is None:
                    self.owners.pop(target.key, None)
                    if not was_held:
                        self.vm.hold(target, False)
                else:
                    self.owners[target.key] = replaced
                raise
            session.input_at, session.seen_input = self.vm.clock(), self.relay.sequence(token) if self.relay else 0
            if replaced not in (None, token):
                self.publish_session(replaced)
                if self.relay:
                    await self.relay.call(self.relay.release(replaced))
            await self.disconnect_target(target, keep=session)
            await self.check_session_target(token, session)
        elif owner == token:
            if pending and params.get("takeover") != pending.request_id:
                raise invalid_params("explicit takeover handback required")
            # The socket's RFB gate rejects input as soon as ownership is removed.
            self.owners.pop(target.key, None)
            self.publish_session(token)
            if self.relay:
                await self.relay.call(self.relay.release(token))
                await self.check_session_target(token, session)
            await self.disconnect_target(target, keep=session)
            await self.check_session_target(token, session)
            self.vm.hold(target, False)
            if pending:
                self.vm.work.complete(target, params["takeover"])
        session.expires = self.vm.clock() + LEASE_SECONDS
        self.publish_session(token)
        if session.sockets:
            return {"state": "running", "ready": True, "control": "owner" if self.owners.get(target.key) == token else "member",
                    "works": self.vm.work.views(session.member_id, session.conversation_id)}
        state = await self.session_state(session)
        await self.check_session_target(token, session)
        return state

    def host_current(self, session):
        tab, card = self.host_selection(session.member_id, session.conversation_id)
        selected = self.active_transport(session.member_id, session.conversation_id) if self.active_transport else None
        return (selected in (None, "host") and self.member_exists(session.member_id) and self.host_browser.live(session.host_tab)
                and tab is session.host_tab and not (session.preview and (card or session.owner_key in self.owners)))

    def host_input_allowed(self, token, session):
        return (self.sessions.get(token) is session and not session.preview and bool(session.sockets)
                and self.owners.get(session.owner_key) == token and session.expires > self.vm.clock()
                and self.host_current(session))

    async def release_host(self, token, session):
        if self.owners.get(session.owner_key) == token:
            self.owners.pop(session.owner_key)
            session.host_epoch += 1
            self.publish_session(token)
            try:
                await session.host_gate.release()
            finally:
                self.host_browser.held.discard(session.host_tab.scope)

    async def control_host(self, token, session, held, request):
        member, conversation = session.member_id, session.conversation_id
        _, card = self.host_selection(member, conversation)
        if request is not None and (card is None or request != card.id):
            raise invalid_params("desktop request changed")
        if held:
            if not session.sockets:
                raise invalid_params("desktop unavailable")
            # Block new member commands before waiting for the current browser call.
            browser = self.host_browser
            work = session.host_tab.scope
            browser.held.add(work)
            try:
                async with asyncio.timeout(self.take_wait_s):
                    async with browser.work_lock(work):
                        await self.check_session_target(token, session)
                        self.session({"session": token})
                        if not session.sockets:
                            raise invalid_params("desktop unavailable")
                        previous = self.owners.get(session.owner_key)
                        if previous not in (None, token):
                            await self.release_host(previous, self.sessions[previous])
                        browser.held.add(work)
                        self.owners[session.owner_key] = token
                        if previous != token:
                            session.host_epoch += 1
                        session.input_at = self.vm.clock()
            finally:
                if self.owners.get(session.owner_key) != token:
                    browser.held.discard(work)
        else:
            owner = self.owners.get(session.owner_key)
            if owner == token:
                await self.release_host(token, session)
            elif request is not None and owner is not None:
                raise invalid_params("desktop control required")
            # The tab and request still match after a watch socket reload or disconnect.
            if request is not None:
                self.handbacks.finish(card)
        session.expires = self.vm.clock() + LEASE_SECONDS
        self.publish_session(token)
        return self.host_state(member, conversation, session)

    async def finish_browser_card(self, card, *, stop=False):
        async with self.control_lock:
            token = self.owners.get(f"host:{card.member_id}")
            session = self.sessions.get(token)
            tab, pending = self.host_selection(card.member_id, card.conversation_id)
            if session and session.host_tab is tab and pending and pending.id == card.id:
                await self.release_host(token, session)
            return self.handbacks.stop(card) if stop else self.handbacks.finish(card)

    async def disconnect_target(self, target, *, keep=None):
        # Invalidate handshakes that fetched their connection before this switch.
        tokens = []
        for token, session in self.sessions.items():
            if session.host_tab is not None or session.target != target:
                continue
            if session is not keep or not session.sockets:
                session.revision += 1
            self.publish_session(token)
            if session is not keep:
                tokens.append(token)
        if self.relay:
            await self.relay.call(self.relay.close_tokens(tokens))
        for token in tokens:
            self.sessions[token].sockets.clear()

    async def close(self, params):
        async with self.control_lock:
            return await self._close(params)

    async def _close(self, params):
        token = params.get("session")
        session = self.sessions.get(token) if isinstance(token, str) else None
        if session:
            if session.host_tab is not None:
                await self.release_host(token, session)
                self.sessions.pop(token, None)
                self.publish_session(token)
                await self.relay.call(self.relay.close_tokens([token]))
                return {}
            owned = self.owners.get(session.target.key) == token
            self.sessions.pop(token)
            if owned:
                self.owners.pop(session.target.key, None)
            self.publish_session(token)
            try:
                if self.teaching:
                    await self.teaching.disconnected(token)
                if self.relay:
                    await self.relay.call(self.relay.close_tokens([token]))
                session.sockets.clear()
                if owned:
                    await self.disconnect_target(session.target)
            finally:
                # Whatever failed above, a hold whose holder is gone is nobody's: it would turn every member away and
                # every later Take control down until the core restarted.
                if owned and not self.vm.work.pending(session.target):
                    self.vm.hold(session.target, False)
            if not any((other.target.remote, other.target.name) == (session.target.remote, session.target.name) for other in self.sessions.values()):
                await self.vm.close_viewer(session.target)
        return {}

    async def close_seat(self, target):
        for token, session in list(self.sessions.items()):
            if session.host_tab is None and session.target == target:
                await self.close({"session": token})

    async def _monitor(self):
        while True:
            await asyncio.sleep(1)
            for token, session in list(self.sessions.items()):
                # One view that cannot be closed or ticked must not end the watch over every other: the monitor is
                # the only thing that ends an expired view and its hold.
                try:
                    if session.host_tab is not None:
                        if session.expires <= self.vm.clock() or not self.host_current(session):
                            await self.close({"session": token})
                            await self.report_host_disconnect(session)
                        elif (self.owners.get(session.owner_key) == token and self.vm.clock() - session.input_at >= OWNER_IDLE_S
                              and self.host_selection(session.member_id, session.conversation_id)[1] is None):
                            async with self.control_lock:
                                await self.release_host(token, session)
                    elif session.expires <= self.vm.clock():
                        await self.close({"session": token})
                    else:
                        if session.sockets:
                            # The owner is looking at the screen: a computer they watch is not idle, however quiet its members are.
                            self.vm.last_activity[session.target.state_key] = self.vm.clock()
                        if self.teaching:
                            await self.teaching.tick(token)
                        await self.release_if_idle(token, session)
                except asyncio.CancelledError:
                    raise
                except Exception as error:
                    logging.getLogger(__name__).warning("Desktop viewer upkeep failed (%s)", type(error).__name__)

    async def report_host_disconnect(self, session):
        if session.host_tab.disconnected and not session.host_tab.finished:
            await self.note_problem(session.member_id, session.conversation_id, "host", "show the screen")

    async def release_if_idle(self, token, session):
        """The owner's hold ends by itself after OWNER_IDLE_S without their input; a sign-in request waiting for them and a
        recording are theirs until they say so."""
        target = session.target
        if session.preview or self.owners.get(target.key) != token:
            return
        now = self.vm.clock()
        sequence = self.relay.sequence(token) if self.relay else 0
        if sequence != session.seen_input:
            session.seen_input, session.input_at = sequence, now
            return
        if now - session.input_at < OWNER_IDLE_S or self.vm.work.pending(target) or self.teaching and self.teaching.active(token):
            return
        async with self.control_lock:
            if self.sessions.get(token) is session and self.owners.get(target.key) == token:
                await self._control({"session": token, "held": False})

    def publish_session(self, token):
        if not self.relay:
            return
        session = self.sessions.get(token)
        policy = None
        if session:
            policy = Policy(session.revision, time.monotonic() + max(0, session.expires - self.vm.clock()),
                            not session.preview and self.owners.get(session.owner_key) == token,
                            self.teaching.relay_hook(token) if self.teaching and session.host_tab is None else None,
                            bool(session.host_tab is None and self.teaching and session.target.container == "shared"
                                 and (recording := self.teaching.active(token))
                                 and recording.state == "recording" and recording.relay_enabled))
        self.relay.publish(token, policy)

    async def _register_peer(self, token, revision, identifier):
        session = self.sessions.get(token)
        if not session or session.revision != revision or session.expires <= self.vm.clock():
            return False
        try:
            await self.check_session_target(token, session)
        except Exception:
            return False
        if session.host_tab is not None:
            cast = session.host_tab.cast
            try:
                async with asyncio.timeout(4):
                    queue = await cast.watch()
            except (ValueError, OSError, TimeoutError):
                return False
            if self.sessions.get(token) is not session or session.expires <= self.vm.clock() or not self.host_current(session):
                await cast.unwatch(queue)
                return False
            self.host_peers[identifier] = (token, session, cast, queue)
        session.sockets.add(identifier)
        return True

    async def host_frame(self, identifier):
        peer = self.host_peers.get(identifier)
        if peer:
            token, session, _, queue = peer
            image = await queue.get()
            if self.sessions.get(token) is session and self.host_current(session):
                return image
        return None

    def _unregister_peer(self, token, identifier):
        session = self.sessions.get(token)
        if session:
            session.sockets.discard(identifier)
        if peer := self.host_peers.pop(identifier, None):
            _, _, cast, queue = peer
            task = asyncio.create_task(self.end_host_peer(token, session, cast, queue))
            self.host_cleanup.add(task)
            task.add_done_callback(self.host_cleanup.discard)

    async def end_host_peer(self, token, session, cast, queue):
        if session and not session.sockets and self.owners.get(session.owner_key) == token:
            async with self.control_lock:
                if not session.sockets:
                    await self.release_host(token, session)
        await cast.unwatch(queue)

    def _peer_failed(self, token, revision):
        session = self.sessions.get(token)
        if session and session.revision == revision:
            self.connection_failed(session)

    async def _teach_input(self, token, revision, identifier, payload):
        session = self.sessions.get(token)
        if (self.teaching and session and session.revision == revision and session.expires > self.vm.clock()
                and not session.preview and self.owners.get(session.target.key) == token):
            await self.teaching.relay_input(token, identifier, payload)

    async def _teach_core_input(self, token, revision, message):
        session = self.sessions.get(token)
        if (self.teaching and session and session.revision == revision and session.expires > self.vm.clock()
                and not session.preview and self.owners.get(session.target.key) == token):
            try:
                await self.teaching.input(token, message)
            except Exception as error:
                # The relay awaits this before it forwards the press: a recorder that fails must not end the
                # owner's control of the seat. (A recording that cannot be written ends itself as full.)
                logging.getLogger(__name__).warning("Seat teaching input was not recorded (%s)", type(error).__name__)

    async def flush_teaching(self, token):
        if self.relay:
            await self.relay.call(self.relay.flush_teaching(token))

    async def _prepare_request(self, method, path, headers, body=None):
        # Validation and VM resolution belong to the core loop; no writers cross it.
        parts = path.split("/", 2)
        token, asset = parts[1:] if len(parts) == 3 else ("", "")
        session = self.sessions.get(token)
        if session:
            try:
                await self.check_session_target(token, session)
            except Exception:
                return {"code": 403}
        if (headers.get("host") != self.origin.removeprefix("http://")
                or not session or session.expires <= self.vm.clock()
                or headers.get("origin", self.origin) != self.origin
                or not re.fullmatch(r"[A-Za-z0-9_./-]+", asset) or ".." in asset):
            return {"code": 403}
        if session.host_tab is not None:
            return await self.prepare_host(token, session, method, asset, headers, body)
        if method != "GET" or session.target.screen == 0:
            return {"code": 403}
        if asset == "bridge.js":
            return {"code": 200, "body": BOOTSTRAP, "type": "text/javascript", "token": token, "revision": session.revision}
        if asset == "control":
            held = not session.preview and self.owners.get(session.target.key) == token
            session.input_sequence = self.relay.sequence(token)
            return {"code": 200, "body": json.dumps({"held": held, "input_sequence": session.input_sequence}).encode(),
                    "type": "application/json", "token": token, "revision": session.revision}
        revision = session.revision
        websocket = headers.get("upgrade", "").lower() == "websocket"
        if websocket and asset != f"websockify/{revision}":
            return {"code": 403}
        port, password = await self.connection_for(session)
        try:
            await self.check_session_target(token, session)
        except Exception:
            return {"code": 403}
        if self.sessions.get(token) is not session or session.revision != revision or session.expires <= self.vm.clock():
            return {"code": 403}
        if asset == "connection":
            config = {"password": password, "held": not session.preview and self.owners.get(session.target.key) == token,
                      "preview": session.preview, "path": f"/{token}/websockify/{revision}"}
            return {"code": 200, "body": json.dumps(config).encode(), "type": "application/json", "token": token, "revision": revision}
        return {"token": token, "revision": revision, "port": port, "asset": asset, "websocket": websocket,
                "screen": session.target.screen}

    async def prepare_host(self, token, session, method, asset, headers, body):
        reply = {"token": token, "revision": session.revision}
        if method == "GET":
            if asset == "host.html":
                return {**reply, "code": 200, "body": HOST_PAGE, "type": "text/html; charset=utf-8"}
            if asset == "host.js":
                return {**reply, "code": 200, "body": HOST_SCRIPT, "type": "text/javascript; charset=utf-8"}
            if asset == "host-frames":
                return {**reply, "host_stream": True}
            if asset == "control":
                return {**reply, "code": 200, "body": json.dumps({"held": self.host_input_allowed(token, session)}).encode(),
                        "type": "application/json"}
        elif method == "POST" and asset == "host-input" and headers.get("origin") == self.origin:
            if not self.host_input_allowed(token, session):
                return {"code": 403}
            epoch = session.host_epoch
            try:
                event = json.loads(body)
                async with self.control_lock:
                    if epoch == session.host_epoch and await session.host_gate.dispatch(event):
                        session.input_at = self.vm.clock()
                        return {**reply, "code": 204}
            except (ValueError, OSError, TimeoutError):
                pass
        return {"code": 403}

    async def aclose(self):
        self.closing = True
        async with self.open_lock:
            await self._shutdown()

    async def _shutdown(self):
        if self.monitor:
            self.monitor.cancel()
            await asyncio.gather(self.monitor, return_exceptions=True)
        for token in list(self.sessions):
            await self.close({"session": token})
        if self.relay:
            await self.relay.aclose()
        # A vanished Chrome may never answer stopScreencast. Give cleanup a
        # short grace period without tying relay lifetime to that CDP reply.
        if self.host_cleanup:
            _, unfinished = await asyncio.wait(self.host_cleanup, timeout=0.35)
            for task in unfinished:
                task.cancel()
            await asyncio.gather(*unfinished, return_exceptions=True)
        self.server = None

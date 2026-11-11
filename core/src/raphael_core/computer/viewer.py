"""Loopback noVNC bridge. Passwords live only in core and RFB memory.

The container supplies noVNC's RFB library. Its UI-free library embedding uses
Raphael's existing conversation controls instead of the standalone vnc.html UI.
No new VM runtime, browser bundle, host-specific code or credential store.
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

from ..protocol import invalid_params
from .vm import SHARED, VmError
from .viewer_relay import Policy, ViewerRelay
from ..paths import local_storage_root

LEASE_SECONDS = 15
# An open page polls every two seconds and each answer starts several Docker processes.
UNWATCHED_STATUS_S = 10
# What the owner's press may open; anything else, such as a program a member wrote, is only shown in its folder.
READABLE = frozenset(".html .htm .pdf .png .jpg .jpeg .gif .webp .svg .txt .md .csv .json .mp3 .wav .m4a .mp4 .webm .docx .xlsx .pptx".split())
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
    if (rfb) { rfb.viewOnly = true; rfb.disconnect(); rfb = null; }
    return;
  }
  if (event.data?.type !== 'raphael-desktop-control' || !rfb) return;
  const current = ++revision;
  rfb.viewOnly = true;
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
'''


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


class DesktopViewer:
    def __init__(self, vm, *, member_exists=lambda member: True):
        self.vm, self.member_exists = vm, member_exists
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

    def register(self, router):
        for name, handler in (("status", self.status), ("open", self.open), ("renew", self.renew),
                              ("control", self.control), ("close", self.close)):
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
            return {"state": "absent", "control": "member", "ready": False, "error": "disabled" if not self.vm.enabled else "docker_missing"}
        state = await self.unwatched_status(target)
        works = self.vm.work.views(params.get("member_id", 0), params.get("conversation_id"))
        return {**state, "host": target.remote, "target": target.key,
                "mode": target.container or "per-bot",
                "idle_minutes": self.vm.settings.get("computer_vm_idle_minutes") if self.vm.settings else 15,
                "lifecycle": self.vm.lifecycle.get(target.state_key),
                **({"repair_revision": self.vm.repair_revisions[target.state_key]} if target.state_key in self.vm.repair_revisions else {}),
                **({"works": works} if works else {}),
                **(self.teaching.status(params.get("member_id", 0), params.get("conversation_id"), target) if self.teaching else {})}

    async def open(self, params):
        async with self.open_lock:
            return await self._open(params)

    async def _open(self, params):
        target = self.target(params)
        if self.closing:
            raise invalid_params("desktop viewer closed")
        if len(self.sessions) >= 8:
            raise invalid_params("too many desktop viewers")
        if type(params.get("preview", False)) is not bool:
            raise invalid_params("preview must be a boolean")
        if not params.get("preview"):
            try:
                target = await self.vm.seat(params.get("member_id", 0))
            except VmError:
                raise invalid_params("desktop unavailable") from None
        if self.server is None:
            self.relay = ViewerRelay(self._prepare_request, self._register_peer, self._unregister_peer,
                                     self._peer_failed, self._teach_input, embedded_page)
            self.server = await self.relay.start()
            self.origin = f"http://127.0.0.1:{self.server.sockets[0].getsockname()[1]}"
            self.monitor = asyncio.create_task(self._monitor())
        token = secrets.token_urlsafe(32)
        session = Session(target, self.vm.clock() + LEASE_SECONDS,
            member_id=params.get("member_id", 0), conversation_id=params.get("conversation_id"), preview=params.get("preview", False))
        if not params.get("preview") and (await self.status_for(target))["state"] != "running":
            self.vm.launch(target)
        if target.remote and (await self.status_for(target))["state"] == "running":
            try:
                await self.connection_for(session)
            except VmError:
                # Keep the session so renew can explain an unreachable live screen.
                pass
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
        session.expires = self.vm.clock() + LEASE_SECONDS
        if self.owners.get(session.target.key) == token:
            self.vm.hold(session.target, True)
        self.publish_session(token)
        return await self.session_state(session, read=not session.sockets)

    async def session_state(self, session, *, read=True):
        # An authenticated live socket already proves the guest is running. Ownership,
        # work and teaching below remain fresh without another Docker status read.
        state = await self.status_for(session.target) if read else {"state": "running", "ready": True}
        works = self.vm.work.views(session.member_id, session.conversation_id)
        token = self.owners.get(session.target.key)
        return {**state, "host": session.target.remote, "target": session.target.key,
                "mode": session.target.container or "per-bot",
                "idle_minutes": self.vm.settings.get("computer_vm_idle_minutes") if self.vm.settings else 15,
                "lifecycle": self.vm.lifecycle.get(session.target.state_key),
                **({"repair_revision": self.vm.repair_revisions[session.target.state_key]} if session.target.state_key in self.vm.repair_revisions else {}),
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
                **({"error": state["error"]} if state.get("error") else {})}

    async def control(self, params):
        async with self.control_lock:
            return await self._control(params)

    async def _control(self, params):
        token, session = self.session(params)
        held = params.get("held")
        if type(held) is not bool:
            raise invalid_params("held must be a boolean")
        target = session.target
        owner = self.owners.get(target.key)
        pending = self.vm.work.pending(target)
        if not held and self.teaching and self.teaching.active(token):
            raise invalid_params("stop or discard the demonstration before handback")
        if session.preview:
            raise invalid_params("preview is read only")
        if pending and (pending.member_id != session.member_id or pending.conversation_id != session.conversation_id):
            raise invalid_params("private conversation required")
        if held:
            if owner not in (None, token) or (target.key in self.vm.held and owner != token and not pending):
                raise invalid_params("desktop already held")
            if self.vm.unit_active(target):
                raise invalid_params("desktop busy")
            if not session.sockets and (await self.status_for(target))["state"] != "running":
                raise invalid_params("desktop unavailable")
            # Check again after the asynchronous probe. New tools see the phase A hold.
            if self.vm.unit_active(target) or self.owners.get(target.key) not in (None, token):
                raise invalid_params("desktop busy")
            self.session(params)
            self.owners[target.key] = token
            self.vm.hold(target, True)
            await self.disconnect_target(target, keep=session)
        elif owner == token:
            if pending and params.get("takeover") != pending.request_id:
                raise invalid_params("explicit takeover handback required")
            # The socket's RFB gate rejects input as soon as ownership is removed.
            self.owners.pop(target.key, None)
            self.publish_session(token)
            if self.relay:
                await self.relay.call(self.relay.release(token))
            await self.disconnect_target(target, keep=session)
            self.vm.hold(target, False)
            if pending:
                self.vm.work.complete(target, params["takeover"])
        session.expires = self.vm.clock() + LEASE_SECONDS
        self.publish_session(token)
        if session.sockets:
            return {"state": "running", "ready": True, "control": "owner" if self.owners.get(target.key) == token else "member",
                    "works": self.vm.work.views(session.member_id, session.conversation_id)}
        return await self.session_state(session)

    async def disconnect_target(self, target, *, keep=None):
        # Invalidate handshakes that fetched their connection before this switch.
        tokens = []
        for token, session in self.sessions.items():
            if session.target != target:
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
            owned = self.owners.get(session.target.key) == token
            self.sessions.pop(token)
            if owned:
                self.owners.pop(session.target.key, None)
            self.publish_session(token)
            if self.teaching:
                await self.teaching.disconnected(token)
            if self.relay:
                await self.relay.call(self.relay.close_tokens([token]))
            session.sockets.clear()
            if owned:
                await self.disconnect_target(session.target)
                if not self.vm.work.pending(session.target):
                    self.vm.hold(session.target, False)
            if not any((other.target.remote, other.target.name) == (session.target.remote, session.target.name) for other in self.sessions.values()):
                await self.vm.close_viewer(session.target)
        return {}

    async def close_seat(self, target):
        for token, session in list(self.sessions.items()):
            if session.target == target:
                await self.close({"session": token})

    async def _monitor(self):
        while True:
            await asyncio.sleep(1)
            for token, session in list(self.sessions.items()):
                if session.expires <= self.vm.clock():
                    await self.close({"session": token})
                elif self.teaching:
                    await self.teaching.tick(token)

    def publish_session(self, token):
        if not self.relay:
            return
        session = self.sessions.get(token)
        policy = None
        if session:
            policy = Policy(session.revision, time.monotonic() + max(0, session.expires - self.vm.clock()),
                            not session.preview and self.owners.get(session.target.key) == token,
                            self.teaching.relay_hook(token) if self.teaching else None)
        self.relay.publish(token, policy)

    async def _register_peer(self, token, revision, identifier):
        session = self.sessions.get(token)
        if not session or session.revision != revision or session.expires <= self.vm.clock():
            return False
        session.sockets.add(identifier)
        return True

    def _unregister_peer(self, token, identifier):
        session = self.sessions.get(token)
        if session:
            session.sockets.discard(identifier)

    def _peer_failed(self, token, revision):
        session = self.sessions.get(token)
        if session and session.revision == revision:
            self.connection_failed(session)

    async def _teach_input(self, token, revision, identifier, payload):
        session = self.sessions.get(token)
        if (self.teaching and session and session.revision == revision and session.expires > self.vm.clock()
                and not session.preview and self.owners.get(session.target.key) == token):
            await self.teaching.relay_input(token, identifier, payload)

    async def flush_teaching(self, token):
        if self.relay:
            await self.relay.call(self.relay.flush_teaching(token))

    async def _prepare_request(self, method, path, headers):
        # Validation and VM resolution belong to the core loop; no writers cross it.
        parts = path.split("/", 2)
        token, asset = parts[1:] if len(parts) == 3 else ("", "")
        session = self.sessions.get(token)
        if (method != "GET" or headers.get("host") != self.origin.removeprefix("http://")
                or not session or session.target.screen == 0 or session.expires <= self.vm.clock()
                or headers.get("origin", self.origin) != self.origin
                or not re.fullmatch(r"[A-Za-z0-9_./-]+", asset) or ".." in asset):
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
        if self.sessions.get(token) is not session or session.revision != revision or session.expires <= self.vm.clock():
            return {"code": 403}
        if asset == "connection":
            config = {"password": password, "held": not session.preview and self.owners.get(session.target.key) == token,
                      "preview": session.preview, "path": f"/{token}/websockify/{revision}"}
            return {"code": 200, "body": json.dumps(config).encode(), "type": "application/json", "token": token, "revision": revision}
        return {"token": token, "revision": revision, "port": port, "asset": asset, "websocket": websocket,
                "screen": session.target.screen}

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
        self.server = None

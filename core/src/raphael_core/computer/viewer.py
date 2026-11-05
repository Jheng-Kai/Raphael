"""Loopback noVNC bridge. Passwords live only in core and RFB memory.

The container supplies noVNC's RFB library. Its UI-free library embedding uses
Raphael's existing conversation controls instead of the standalone vnc.html UI.
No new VM runtime, browser bundle, host-specific code or credential store.
"""

import asyncio
import base64
import json
import re
import secrets
from dataclasses import dataclass, field
from pathlib import Path

import httpx

from ..protocol import invalid_params
from .vm import SHARED, VmError
from .rfb_input import RfbInputGate

LEASE_SECONDS = 15
# An open page polls every two seconds and each answer starts several Docker processes.
UNWATCHED_STATUS_S = 10
# What the owner's press may open; anything else, such as a program a member wrote, is only shown in its folder.
READABLE = frozenset(".html .htm .pdf .png .jpg .jpeg .gif .webp .svg .txt .md .csv .json .mp3 .wav .m4a .mp4 .webm .docx .xlsx .pptx".split())
BOOTSTRAP = b'''import RFB from './core/rfb.js';
let rfb, connecting = false, closed = false, controlAt = 0, revision = 0;
const screen = document.getElementById('noVNC_container');
const tell = state => parent.postMessage({type:'raphael-desktop', state}, '*');
async function connect() {
  if (connecting || closed) return;
  connecting = true;
  try {
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
  } catch { tell('disconnected'); }
  finally { connecting = false; }
}
addEventListener('message', event => {
  if (event.source !== parent) return;
  if (event.data?.type === 'raphael-desktop-disable') {
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
// The last picture of the screen: the window shows it at once when it comes back.
setInterval(() => {
  const canvas = screen.querySelector('canvas');
  if (!rfb || !rfb.viewOnly || !canvas?.width) return;
  const small = document.createElement('canvas'), scale = Math.min(1, 480 / canvas.width);
  small.width = Math.round(canvas.width * scale); small.height = Math.round(canvas.height * scale);
  small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
  parent.postMessage({type:'raphael-desktop', state:'frame', image:small.toDataURL('image/jpeg', 0.6)}, '*');
}, 3000);
addEventListener('pagehide', () => {closed = true; rfb?.disconnect();});
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
    inputs: dict = field(default_factory=dict)


class DesktopViewer:
    def __init__(self, vm, *, member_exists=lambda member: True):
        self.vm, self.member_exists = vm, member_exists
        self.sessions, self.owners = {}, {}
        self.remembered = {}
        self.status_cache, self.status_locks = {}, {}
        self.vm.viewer_owners = self.owners
        self.server = self.monitor = None
        self.origin = ""
        self.tasks = set()
        self.control_lock = asyncio.Lock()
        self.teaching = None
        self.task_artifact = lambda task, evidence: None
        self.open_lock = asyncio.Lock()
        self.client = httpx.AsyncClient(trust_env=False, timeout=10)

    def register(self, router):
        for name, handler in (("status", self.status), ("open", self.open), ("renew", self.renew),
                              ("control", self.control), ("close", self.close)):
            router.register(f"computer.viewer_{name}", handler)
        router.register("computer.revoke", self.revoke)
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
            root = Path(target.workspace if area == "workspace" else target.shared).resolve()
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
        root = Path(target.shared).resolve()
        found = (root / path[len(SHARED) + 1:]).resolve()
        if not found.is_relative_to(root) or not found.is_file():
            raise invalid_params("no such team file")
        return {"path": str(found), "reads": found.suffix.lower() in READABLE}

    async def revoke(self, params):
        self.target(params)
        self.vm.grants.set(params.get("member_id", 0), False)
        return {"granted": False}

    async def lifecycle(self, params):
        from .lifecycle import maintain
        target = self.target(params)
        if params.get("host") != target.remote or params.get("target") != target.key:
            raise invalid_params("Computer changed; review maintenance again")
        if not self.vm.grants.allowed(params.get("member_id", 0)):
            raise invalid_params("Computer access is not granted")
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
                self.vm.preparation.pop(target.key, None)
            self.vm.changes += 1
        if not await self.vm.installed():
            return {"state": "absent", "control": "member", "ready": False, "error": "disabled" if not self.vm.enabled else "docker_missing"}
        state = await self.unwatched_status(target)
        works = self.vm.work.views(params.get("member_id", 0), params.get("conversation_id"))
        return {**state, "host": target.remote, "target": target.key,
                "mode": "shared" if target.key == "shared" else "per-bot",
                "idle_minutes": self.vm.settings.get("computer_vm_idle_minutes") if self.vm.settings else 15,
                "lifecycle": self.vm.lifecycle.get(target.key),
                **({"repair_revision": self.vm.repair_revisions[target.key]} if target.key in self.vm.repair_revisions else {}),
                "granted": self.vm.grants.allowed(params.get("member_id", 0)), **({"works": works} if works else {}),
                **(self.teaching.status(params.get("member_id", 0), params.get("conversation_id"), target) if self.teaching else {})}

    async def open(self, params):
        async with self.open_lock:
            return await self._open(params)

    async def _open(self, params):
        target = self.target(params)
        if len(self.sessions) >= 8:
            raise invalid_params("too many desktop viewers")
        if self.server is None:
            self.server = await asyncio.start_server(self._connection, "127.0.0.1", 0, limit=65536)
            self.origin = f"http://127.0.0.1:{self.server.sockets[0].getsockname()[1]}"
            self.monitor = asyncio.create_task(self._monitor())
        token = secrets.token_urlsafe(32)
        if type(params.get("preview", False)) is not bool:
            raise invalid_params("preview must be a boolean")
        if not params.get("preview"):
            self.vm.grants.set(params.get("member_id", 0), True)
        self.sessions[token] = Session(target, self.vm.clock() + LEASE_SECONDS,
            member_id=params.get("member_id", 0), conversation_id=params.get("conversation_id"), preview=params.get("preview", False))
        if (not params.get("preview") and (await self.status_for(target))["state"] != "running"
                and self.vm.grants.allowed(params.get("member_id", 0))):
            self.vm.launch(target)
        return {"session": token, "url": f"{self.origin}/{token}/vnc.html"}

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
        return await self.session_state(session, read=not session.sockets)

    async def session_state(self, session, *, read=True):
        # An authenticated live socket already proves the guest is running. Ownership,
        # work and teaching below remain fresh without another Docker status read.
        state = await self.status_for(session.target) if read else {"state": "running", "ready": True}
        works = self.vm.work.views(session.member_id, session.conversation_id)
        token = self.owners.get(session.target.key)
        return {**state, "host": session.target.remote, "target": session.target.key,
                "mode": "shared" if session.target.key == "shared" else "per-bot",
                "idle_minutes": self.vm.settings.get("computer_vm_idle_minutes") if self.vm.settings else 15,
                "lifecycle": self.vm.lifecycle.get(session.target.key),
                **({"repair_revision": self.vm.repair_revisions[session.target.key]} if session.target.key in self.vm.repair_revisions else {}),
                "control": "owner" if self.sessions.get(token) is session else "member",
                "preview_allowed": session.target.key not in self.vm.held, "granted": self.vm.grants.allowed(session.member_id),
                **({"works": works} if works else {}),
                **(self.teaching.status(session.member_id, session.conversation_id, session.target) if self.teaching else {})}

    async def unwatched_status(self, target):
        """Unwatched computers keep the longer cache; active viewers share the short cache."""
        key = (target.remote, target.key)
        if (target.key in self.vm.preparation or target.key in self.vm.held
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
            if target.key in self.vm.preparation:
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
            state = self.vm.preparation.get(target.key) or await self.vm.status(target, probe=False)
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
            if self.vm.active.get(target.key):
                raise invalid_params("desktop busy")
            if not session.sockets and (await self.status_for(target))["state"] != "running":
                raise invalid_params("desktop unavailable")
            # Check again after the asynchronous probe. New tools see the phase A hold.
            if self.vm.active.get(target.key) or self.owners.get(target.key) not in (None, token):
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
            for socket, gate in list(session.inputs.items()):
                released = gate.release()
                if released:
                    try:
                        socket.write(released)
                        await socket.drain()
                    except OSError:
                        socket.close()
            await self.disconnect_target(target, keep=session)
            self.vm.hold(target, False)
            if pending:
                self.vm.work.complete(target, params["takeover"])
        session.expires = self.vm.clock() + LEASE_SECONDS
        if session.sockets:
            return {"state": "running", "ready": True, "control": "owner" if self.owners.get(target.key) == token else "member",
                    "works": self.vm.work.views(session.member_id, session.conversation_id)}
        return await self.session_state(session)

    async def disconnect_target(self, target, *, keep=None):
        # Invalidate handshakes that fetched their connection before this switch.
        for session in self.sessions.values():
            if session.target == target and (session is not keep or not session.sockets):
                session.revision += 1
        sockets = [socket for session in self.sessions.values() if session.target == target and session is not keep for socket in session.sockets]
        for socket in sockets:
            socket.close()
        await asyncio.gather(*(socket.wait_closed() for socket in sockets), return_exceptions=True)

    async def close(self, params):
        async with self.control_lock:
            return await self._close(params)

    async def _close(self, params):
        token = params.get("session")
        session = self.sessions.get(token) if isinstance(token, str) else None
        if session:
            if self.teaching:
                await self.teaching.disconnected(token)
            if self.owners.get(session.target.key) == token:
                await self.disconnect_target(session.target)
                self.owners.pop(session.target.key, None)
                if not self.vm.work.pending(session.target):
                    self.vm.hold(session.target, False)
            for socket in list(session.sockets):
                socket.close()
            self.sessions.pop(token, None)
            if not any(other.target == session.target for other in self.sessions.values()):
                await self.vm.close_viewer(session.target)
        return {}

    async def _monitor(self):
        while True:
            await asyncio.sleep(1)
            for token, session in list(self.sessions.items()):
                if session.expires <= self.vm.clock():
                    await self.close({"session": token})
                elif self.teaching:
                    await self.teaching.tick(token)

    async def _respond(self, writer, code, body=b"", content_type="text/plain"):
        writer.write(f"HTTP/1.1 {code} Response\r\nContent-Type: {content_type}\r\nContent-Length: {len(body)}\r\n"
                     "Cache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\n"
                     "Connection: close\r\n\r\n".encode() + body)
        await writer.drain()

    async def _connection(self, reader, writer):
        task = asyncio.current_task()
        if len(self.tasks) >= 64:
            writer.close()
            return
        self.tasks.add(task)
        upstream = None
        session = None
        try:
            async with asyncio.timeout(15):
                method, path, _ = (await reader.readline()).decode("ascii").strip().split()
                headers = {}
                total = 0
                while (line := await reader.readline()) not in (b"\r\n", b"\n", b""):
                    total += len(line)
                    if total > 16384:
                        return
                    key, value = line.decode("latin-1").split(":", 1)
                    if key.lower() in headers:
                        return
                    headers[key.lower()] = value.strip()
                parts = path.split("/", 2)
                token, asset = parts[1:] if len(parts) == 3 else ("", "")
                session = self.sessions.get(token)
                if (method != "GET" or headers.get("host") != self.origin.removeprefix("http://")
                        or not session or session.expires <= self.vm.clock()
                        or headers.get("origin", self.origin) != self.origin
                        or not re.fullmatch(r"[A-Za-z0-9_./-]+", asset) or ".." in asset):
                    await self._respond(writer, 403)
                    return
                if asset == "bridge.js":
                    await self._respond(writer, 200, BOOTSTRAP, "text/javascript")
                    return
                if asset == "control":
                    held = not session.preview and self.owners.get(session.target.key) == token
                    await self._respond(writer, 200, json.dumps({"held": held, "input_sequence": session.input_sequence}).encode(), "application/json")
                    return
                port, password = await self.vm.viewer_connection(session.target)
                if asset == "connection":
                    config = {"password": password, "held": not session.preview and self.owners.get(session.target.key) == token,
                              "preview": session.preview,
                              "path": f"/{token}/websockify/{session.revision}"}
                    await self._respond(writer, 200, json.dumps(config).encode(), "application/json")
                    return
                if headers.get("upgrade", "").lower() == "websocket":
                    if asset != f"websockify/{session.revision}":
                        await self._respond(writer, 403)
                        return
                    revision = session.revision
                    remote, upstream = await asyncio.open_connection("127.0.0.1", port)
                    request = f"GET /websockify HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n"
                    for key in ("upgrade", "connection", "sec-websocket-key", "sec-websocket-version", "sec-websocket-protocol"):
                        if key in headers:
                            request += f"{key}: {headers[key]}\r\n"
                    upstream.write((request + "\r\n").encode())
                    await upstream.drain()
                else:
                    response = await self.client.get(f"http://127.0.0.1:{port}/{asset}")
                    body = embedded_page(response.text) if asset == "vnc.html" and response.status_code == 200 else response.content
                    await self._respond(writer, response.status_code, body, response.headers.get("content-type", "application/octet-stream"))
                    return
            # No await separates this check from registration in the close set.
            if self.sessions.get(token) is not session or session.expires <= self.vm.clock() or session.revision != revision:
                return
            session.sockets.update((writer, upstream))

            async def pipe(source, destination):
                while data := await source.read(65536):
                    destination.write(data)
                    await destination.drain()

            def input_allowed():
                allowed = (not session.preview and self.sessions.get(token) is session
                    and session.expires > self.vm.clock() and self.owners.get(session.target.key) == token)
                if allowed:
                    session.input_sequence += 1
                return allowed

            gate = RfbInputGate(input_allowed)
            session.inputs[upstream] = gate

            async def input_pipe():
                while data := await reader.read(65536):
                    accepted = gate.feed(data)
                    packets, gate.packets = gate.packets, []
                    if self.teaching and self.teaching.active(token):
                        from .rfb_input import frame
                        for is_input, message, opcode in packets:
                            if is_input:
                                await self.teaching.input(token, message)
                            if not is_input or input_allowed():
                                upstream.write(frame(message, opcode))
                                await upstream.drain()
                    elif accepted:
                        upstream.write(accepted)
                        await upstream.drain()

            streams = [asyncio.create_task(input_pipe()), asyncio.create_task(pipe(remote, writer))]
            try:
                await asyncio.wait(streams, return_when=asyncio.FIRST_COMPLETED)
            finally:
                for stream in streams:
                    stream.cancel()
                await asyncio.gather(*streams, return_exceptions=True)
        except (ValueError, OSError, TimeoutError, VmError, httpx.HTTPError, asyncio.IncompleteReadError):
            if upstream is None:
                try:
                    await self._respond(writer, 503)
                except OSError:
                    pass
        finally:
            for socket in (writer, upstream):
                if socket:
                    socket.close()
                    if session:
                        session.sockets.discard(socket)
                        session.inputs.pop(socket, None)
            self.tasks.discard(task)

    async def aclose(self):
        if self.monitor:
            self.monitor.cancel()
            await asyncio.gather(self.monitor, return_exceptions=True)
        for token in list(self.sessions):
            await self.close({"session": token})
        if self.server:
            self.server.close()
        for task in list(self.tasks):
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        if self.server:
            await self.server.wait_closed()
        await self.client.aclose()

"""Loopback noVNC bridge. Passwords live only in core and RFB memory.

The container supplies noVNC's RFB library. Its UI-free library embedding uses
Raphael's existing conversation controls instead of the standalone vnc.html UI.
No new VM runtime, browser bundle, host-specific code or credential store.
"""

import asyncio
import json
import re
import secrets
from dataclasses import dataclass, field

import httpx

from ..protocol import invalid_params
from .vm import VmError

LEASE_SECONDS = 15
BOOTSTRAP = b'''import RFB from './core/rfb.js';
let rfb, connecting = false, closed = false;
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
    config = null;
    rfb.scaleViewport = true;
    rfb.resizeSession = true;
    rfb.clipViewport = false;
    rfb.background = 'transparent';
    rfb.addEventListener('connect', () => tell('connected'));
    rfb.addEventListener('disconnect', () => {rfb = null; tell('disconnected');});
    rfb.addEventListener('securityfailure', () => {rfb?.disconnect(); tell('disconnected');});
  } catch { tell('disconnected'); }
  finally { connecting = false; }
}
addEventListener('message', event => {
  if (event.source !== parent || event.data?.type !== 'raphael-desktop-disable') return;
  if (rfb) { rfb.viewOnly = true; rfb.disconnect(); rfb = null; }
});
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
            'html,body {height:100%;margin:0;overflow:hidden} '
            '#noVNC_container {width:100%;height:100%}'
            '</style><script type="module" src="bridge.js"></script></head>'
            '<body><div id="noVNC_container"></div></body></html>').encode()


@dataclass
class Session:
    target: object
    expires: float
    sockets: set = field(default_factory=set)
    revision: int = 0


class DesktopViewer:
    def __init__(self, vm, *, member_exists=lambda member: True):
        self.vm, self.member_exists = vm, member_exists
        self.sessions, self.owners = {}, {}
        self.server = self.monitor = None
        self.origin = ""
        self.tasks = set()
        self.control_lock = asyncio.Lock()
        self.open_lock = asyncio.Lock()
        self.client = httpx.AsyncClient(trust_env=False, timeout=10)

    def register(self, router):
        for name, handler in (("status", self.status), ("open", self.open), ("renew", self.renew),
                              ("control", self.control), ("close", self.close)):
            router.register(f"computer.viewer_{name}", handler)

    def target(self, params):
        member = params.get("member_id", 0)
        if type(member) is not int or member < 0 or not self.member_exists(member):
            raise invalid_params("invalid desktop member")
        return self.vm.target(member)

    async def status(self, params):
        target = self.target(params)
        if not await self.vm.installed():
            return {"state": "absent", "control": "member", "ready": False}
        return await self.status_for(target)

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
        self.sessions[token] = Session(target, self.vm.clock() + LEASE_SECONDS)
        if (await self.status_for(target))["state"] != "running":
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
        return await self.status_for(session.target)

    async def status_for(self, target):
        # Use the exact target captured at open, even if the mode changes meanwhile.
        try:
            state = self.vm.preparation.get(target.key) or await self.vm.status(target, probe=False)
        except (VmError, OSError, TimeoutError):
            state = {"state": "unavailable"}
        return {"state": state["state"], "ready": state["state"] == "running",
                **({"progress": state["progress"]} if state.get("progress") else {}),
                **({"error": state["error"]} if state.get("error") else {}),
                "control": "owner" if target.key in self.vm.held else "member"}

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
        if held:
            if owner not in (None, token) or (target.key in self.vm.held and owner != token):
                raise invalid_params("desktop already held")
            if self.vm.active.get(target.key):
                raise invalid_params("desktop busy")
            if (await self.status_for(target))["state"] != "running":
                raise invalid_params("desktop unavailable")
            # Check again after the asynchronous probe. New tools see the phase A hold.
            if self.vm.active.get(target.key) or self.owners.get(target.key) not in (None, token):
                raise invalid_params("desktop busy")
            self.session(params)
            self.owners[target.key] = token
            self.vm.hold(target, True)
            await self.disconnect_target(target)
        elif owner == token:
            # End every input connection before the tool gate is released.
            await self.disconnect_target(target)
            self.owners.pop(target.key, None)
            self.vm.hold(target, False)
        session.expires = self.vm.clock() + LEASE_SECONDS
        return await self.status_for(target)

    async def disconnect_target(self, target):
        # Invalidate handshakes that fetched their connection before this switch.
        for session in self.sessions.values():
            if session.target == target:
                session.revision += 1
        sockets = [socket for session in self.sessions.values() if session.target == target for socket in session.sockets]
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
            if self.owners.get(session.target.key) == token:
                await self.disconnect_target(session.target)
                self.owners.pop(session.target.key, None)
                self.vm.hold(session.target, False)
            for socket in list(session.sockets):
                socket.close()
            self.sessions.pop(token, None)
        return {}

    async def _monitor(self):
        while True:
            await asyncio.sleep(1)
            for token, session in list(self.sessions.items()):
                if session.expires <= self.vm.clock():
                    await self.close({"session": token})

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
                port, password = await self.vm.viewer_connection(session.target)
                if asset == "connection":
                    config = {"password": password, "held": self.owners.get(session.target.key) == token,
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

            streams = [asyncio.create_task(pipe(reader, upstream)), asyncio.create_task(pipe(remote, writer))]
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

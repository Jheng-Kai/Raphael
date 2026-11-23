"""Viewer-owned network loop. Core state and recorder operations stay on their owning loop.

Only immutable policies cross the lock. Writers, gates and connection tasks never
leave this thread; the core retains opaque connection IDs for its session lifecycle.
"""
import asyncio
import concurrent.futures
import itertools
import contextlib
import logging
import weakref
import threading
import time
from dataclasses import dataclass

import httpx

from .rfb_input import RfbInputGate, frame
from .vm import VmError

logger = logging.getLogger(__name__)


def quiet_reset(loop, context):
    """Finish a Windows Proactor close interrupted by a reset from the other end."""
    error = context.get("exception")
    callback = getattr(context.get("handle"), "_callback", None)
    if (isinstance(error, (ConnectionResetError, ConnectionAbortedError))
            and getattr(callback, "__qualname__", None) == "_ProactorBasePipeTransport._call_connection_lost"):
        transport = callback.__self__
        if (sock := transport._sock) is not None:
            # Python 3.12 already notified the protocol (including wait_closed) before shutdown raised.
            # Finish the skipped socket close and server detach without notifying the protocol again.
            sock.close()
            transport._sock = None
            if (server := transport._server) is not None:
                server._detach()
                transport._server = None
            transport._called_connection_lost = True
        logger.info("A viewer connection was reset by its other end and is closed (%s)", type(error).__name__)
        return
    loop.default_exception_handler(context)


@dataclass(frozen=True)
class Policy:
    revision: int
    deadline: float
    held: bool
    teaching: object
    core_teaching: bool = False


@dataclass
class Peer:
    token: str
    revision: int
    writer: object
    upstream: object
    task: object
    gate: object = None


class ViewerRelay:
    def __init__(self, prepare, register, unregister, failed, teach, embed, core_input=None, host_stream=None):
        self.prepare, self.register, self.unregister = prepare, register, unregister
        self.failed, self.teach, self.embed = failed, teach, embed
        self.core_input = core_input
        self.host_stream = host_stream
        self.main = asyncio.get_running_loop()
        self.loop = self.thread = None
        self.policies, self.sequences = {}, {}
        self.lock = threading.Lock()
        self.tasks, self.peers = set(), {}
        self.clients = set()
        self.requests = {}
        self.identifiers = itertools.count()
        self.teaching_locks, self.pending_teaching, self.full_teaching = {}, {}, set()

    def publish(self, token, policy):
        with self.lock:
            if policy is None:
                self.policies.pop(token, None)
                self.sequences.pop(token, None)
            else:
                self.policies[token] = policy

    def sequence(self, token):
        with self.lock:
            return self.sequences.get(token, 0)

    def policy(self, peer):
        with self.lock:
            policy = self.policies.get(peer.token)
            return policy if policy and policy.revision == peer.revision and policy.deadline > time.monotonic() else None

    async def on_main(self, coroutine):
        return await asyncio.wrap_future(asyncio.run_coroutine_threadsafe(coroutine, self.main))

    async def call(self, coroutine):
        return await asyncio.wrap_future(asyncio.run_coroutine_threadsafe(coroutine, self.loop))

    async def start(self):
        ready = concurrent.futures.Future()
        def run():
            try:
                asyncio.run(self.serve(ready))
            except BaseException as error:
                if not ready.done():
                    ready.set_exception(error)
        self.thread = threading.Thread(target=run, name="raphael-viewer-relay", daemon=True)
        self.thread.start()
        waiting = asyncio.wrap_future(ready)
        try:
            return await asyncio.shield(waiting)
        except asyncio.CancelledError:
            try:
                await waiting
            finally:
                await self.aclose()
            raise

    async def serve(self, ready):
        self.loop = asyncio.get_running_loop()
        self.loop.set_exception_handler(quiet_reset)
        self.stop = asyncio.Event()
        # Every connection ever accepted, rejected ones too: Python 3.12's server cannot list them, and one left open
        # keeps wait_closed waiting and its socket alive.
        self.accepted = weakref.WeakSet()
        async with httpx.AsyncClient(trust_env=False, timeout=10) as self.client:
            server = await asyncio.start_server(self.accept, "127.0.0.1", 0, limit=65536)
            ready.set_result(server)
            try:
                await self.stop.wait()
            finally:
                server.close()
                # wait_closed also waits for accepted transports on newer asyncio.
                # A parked frame read or WebSocket cannot finish until we close its transport.
                for writer in list(self.accepted):
                    writer.transport.abort()
                    # A Proactor transport aborted while its read is pending keeps its socket until that read ends:
                    # closing the socket ends the read, so connection_lost runs and the server lets go of it.
                    sock = getattr(writer.transport, "_sock", None)
                    if sock is not None:
                        with contextlib.suppress(OSError):
                            sock.close()
                tasks = list(self.tasks)
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                for future in list(self.pending_teaching):
                    future.cancel()
                await asyncio.sleep(0.05)  # let the closed transports run connection_lost
                # On Windows a transport aborted mid-read is sometimes never detached from the server, and 3.12's
                # wait_closed then waits for it forever.
                # Everything is closed, aborted and cancelled above, so a short wait is enough.
                try:
                    await asyncio.wait_for(server.wait_closed(), 1)
                except TimeoutError:
                    logger.info("Viewer relay stopped with an aborted connection still counted by the server")

    def accept(self, reader, writer):
        self.accepted.add(writer)
        if self.stop.is_set() or len(self.clients) >= 64:
            # close(), not abort(): a Proactor transport aborted before it ever read stays counted by the server and
            # keeps its socket open.
            writer.close()
            return
        self.clients.add(writer)
        task = asyncio.create_task(self.connection(reader, writer))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        task.add_done_callback(lambda _: self.clients.discard(writer))

    async def close_tokens(self, tokens):
        tasks = [task for task, token in self.requests.items() if token in tokens]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for token in tokens:
            self.teaching_locks.pop(token, None)
        self.full_teaching.difference_update(entry for entry in list(self.full_teaching) if entry[0] in tokens)

    async def release(self, token):
        for peer in list(self.peers.values()):
            if peer.token == token and peer.gate:
                released = peer.gate.release()
                if released:
                    try:
                        peer.upstream.write(released)
                        await peer.upstream.drain()
                    except OSError:
                        peer.upstream.close()

    async def flush_teaching(self, token):
        async with self.teaching_locks.setdefault(token, asyncio.Lock()):
            pending = [future for future, (owner, _) in self.pending_teaching.items() if owner == token]
            await asyncio.gather(*(asyncio.wrap_future(future) for future in pending))

    def queue_teaching(self, peer, hook, payload):
        size = len(payload.encode("utf-8"))
        if len(self.pending_teaching) >= 64 or size + sum(size for _, size in self.pending_teaching.values()) > 4 * 1024 * 1024:
            payload, size = '{"full":true}', 13
            self.full_teaching.add((peer.token, hook.identifier))
        future = asyncio.run_coroutine_threadsafe(self.teach(peer.token, peer.revision, hook.identifier, payload), self.main)
        self.pending_teaching[future] = (peer.token, size)
        future.add_done_callback(lambda done: self.loop.call_soon_threadsafe(self.pending_teaching.pop, done, None))

    async def aclose(self):
        if self.thread is None:
            return
        with self.lock:
            self.policies.clear()
        if self.thread.is_alive():
            self.loop.call_soon_threadsafe(self.stop.set)
            await asyncio.to_thread(self.thread.join, 5)
            if self.thread.is_alive():
                raise RuntimeError("viewer relay did not stop")

    async def respond(self, writer, code, body=b"", content_type="text/plain", *, token="", revision=-1):
        response = (f"HTTP/1.1 {code} Response\r\nContent-Type: {content_type}\r\nContent-Length: {len(body)}\r\n"
                      "Cache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\n"
                      "Connection: close\r\n\r\n").encode() + body
        if token:
            if not self.forward(Peer(token, revision, writer, None, None), response, display=True):
                return
        else:
            writer.write(response)
        await writer.drain()

    def forward(self, peer, data, *, inputs=0, display=False):
        # Authority changes and writes linearize at this lock, without an await under it.
        with self.lock:
            policy = self.policies.get(peer.token)
            if (not policy or policy.revision != peer.revision or policy.deadline <= time.monotonic()
                    or inputs and not policy.held):
                return False
            (peer.writer if display else peer.upstream).write(data)
            if inputs:
                self.sequences[peer.token] = self.sequences.get(peer.token, 0) + inputs
            return True

    async def pump(self, peer, reader, remote):
        def allowed():
            policy = self.policy(peer)
            return bool(policy and policy.held)
        peer.gate = gate = RfbInputGate(allowed)
        async def display():
            while data := await remote.read(65536):
                if not self.forward(peer, data, display=True):
                    return
                await peer.writer.drain()
        async def inputs():
            while data := await reader.read(65536):
                accepted = gate.feed(data)
                packets, gate.packets = gate.packets, []
                policy = self.policy(peer)
                if policy is None:
                    return
                if policy.core_teaching and any(is_input for is_input, _, _ in packets):
                    for is_input, message, opcode in packets:
                        if is_input:
                            # Shared recordings have no relay observer: core-owned privacy state must be read there.
                            await self.on_main(self.core_input(peer.token, peer.revision, message))
                        if self.forward(peer, frame(message, opcode), inputs=int(is_input)):
                            await peer.upstream.drain()
                elif policy.teaching and any(is_input for is_input, _, _ in packets):
                    for is_input, message, opcode in packets:
                        if is_input:
                            async with self.teaching_locks.setdefault(peer.token, asyncio.Lock()):
                                current = self.policy(peer)
                                hook = current.teaching if current and current.held else None
                                payload = await hook.capture(message) if hook and (peer.token, hook.identifier) not in self.full_teaching else None
                                # Capture privacy context before input; persistence never holds up transport.
                                if self.forward(peer, frame(message, opcode), inputs=1):
                                    if payload is not None:
                                        self.queue_teaching(peer, hook, payload)
                                    await peer.upstream.drain()
                        elif self.forward(peer, frame(message, opcode)):
                            await peer.upstream.drain()
                elif accepted and self.forward(peer, accepted, inputs=sum(is_input for is_input, _, _ in packets)):
                    await peer.upstream.drain()
        async def expiry():
            while self.policy(peer) is not None:
                await asyncio.sleep(.05)
        streams = [asyncio.create_task(work()) for work in (display, inputs, expiry)]
        try:
            done, _ = await asyncio.wait(streams, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        finally:
            for task in streams:
                task.cancel()
            await asyncio.gather(*streams, return_exceptions=True)

    async def connection(self, reader, writer):
        task = asyncio.current_task()
        upstream = peer = identifier = None
        token, revision = "", -1
        try:
            async with asyncio.timeout(15) as deadline:
                line = await reader.readline()
                if len(line) > 16384:
                    return
                method, path, _ = line.decode("ascii").strip().split()
                headers, total = {}, 0
                while (line := await reader.readline()) not in (b"\r\n", b"\n", b""):
                    total += len(line)
                    if total > 16384:
                        return
                    key, value = line.decode("latin-1").split(":", 1)
                    if key.lower() in headers:
                        return
                    headers[key.lower()] = value.strip()
                if method == "POST":
                    length = int(headers.get("content-length", "0"))
                    if not 0 < length <= 65536 or headers.get("content-type") != "application/json":
                        await self.respond(writer, 403)
                        return
                    request = await self.on_main(self.prepare(method, path, headers, await reader.readexactly(length)))
                else:
                    request = await self.on_main(self.prepare(method, path, headers))
                token, revision = request.get("token", ""), request.get("revision", -1)
                if token:
                    self.requests[task] = token
                if "code" in request:
                    await self.respond(writer, request["code"], request.get("body", b""), request.get("type", "text/plain"),
                                       token=token, revision=revision)
                    return
                if request.get("host_stream"):
                    identifier = next(self.identifiers)
                    peer = Peer(token, revision, writer, None, task)
                    if not await self.on_main(self.register(token, revision, identifier)):
                        return
                    deadline.reschedule(None)
                    await self.send_host_frames(peer, reader, identifier)
                    return
                token, revision, port = request["token"], request["revision"], request["port"]
                if self.policy(Peer(token, revision, writer, None, task)) is None:
                    return
                if not request["websocket"]:
                    response = await self.client.get(f"http://127.0.0.1:{port}/{request['asset']}")
                    if response.status_code != 200:
                        raise VmError("viewer_unreachable")
                    body = self.embed(response.text) if request["asset"] == "vnc.html" else response.content
                    await self.respond(writer, 200, body, response.headers.get("content-type", "application/octet-stream"),
                                       token=token, revision=revision)
                    return
                remote, upstream = await asyncio.open_connection("127.0.0.1", port)
                upgrade = f"GET /websockify?token=screen-{request['screen']} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n"
                for key in ("upgrade", "connection", "sec-websocket-key", "sec-websocket-version", "sec-websocket-protocol"):
                    if key in headers:
                        upgrade += f"{key}: {headers[key]}\r\n"
                upstream.write((upgrade + "\r\n").encode())
                await upstream.drain()
                identifier = next(self.identifiers)
                peer = Peer(token, revision, writer, upstream, task)
                self.peers[identifier] = peer
                if not await self.on_main(self.register(token, revision, identifier)):
                    return
            await self.pump(peer, reader, remote)
        except (ValueError, OSError, TimeoutError, VmError, httpx.HTTPError, asyncio.IncompleteReadError):
            if token:
                self.main.call_soon_threadsafe(self.failed, token, revision)
            if upstream is None:
                try:
                    await self.respond(writer, 503)
                except OSError:
                    pass
        finally:
            for stream in (writer, upstream):
                if stream:
                    if self.stop.is_set() or task.cancelling():
                        stream.transport.abort()
                    else:
                        stream.close()
            try:
                async with asyncio.timeout(0.25):
                    await asyncio.gather(*(stream.wait_closed() for stream in (writer, upstream) if stream), return_exceptions=True)
            except TimeoutError:
                for stream in (writer, upstream):
                    if stream:
                        stream.transport.abort()
            if identifier is not None:
                self.peers.pop(identifier, None)
                self.main.call_soon_threadsafe(self.unregister, token, identifier)
            self.tasks.discard(task)
            self.requests.pop(task, None)

    async def send_host_frames(self, peer, reader, identifier):
        async def send():
            self.forward(peer, b"HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\n"
                         b"Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
                         display=True)
            await peer.writer.drain()
            while self.policy(peer):
                image = await self.on_main(self.host_stream(identifier))
                if image is None or not self.forward(peer, image, display=True):
                    return
                await peer.writer.drain()
        tasks = [asyncio.create_task(send()), asyncio.create_task(reader.read(1))]
        try:
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

"""Viewer privacy, routing, lifecycle and phase A lease contracts, without Docker."""
import asyncio
import json
import socket
import socketserver
import threading
import time
from types import SimpleNamespace

import httpx
import pytest

from raphael_core.computer.viewer import DesktopViewer, embedded_page, LEASE_SECONDS
from raphael_core.computer.vm import LocalVm, VmError
from raphael_core.protocol import RpcError
from .test_vm import Runtime, container


@pytest.fixture
def wire_upstream():
    disconnected = threading.Event()
    class Handler(socketserver.BaseRequestHandler):
        def handle(self):
            try:
                request = b""
                while not request.endswith(b"\r\n\r\n"):
                    chunk = self.request.recv(1)
                    if not chunk:
                        return
                    request += chunk
                self.request.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
                while data := self.request.recv(65536):
                    self.request.sendall(data)
            finally:
                disconnected.set()
    class Server(socketserver.ThreadingTCPServer):
        daemon_threads = True
    server = Server(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .01}, daemon=True)
    thread.start()
    try:
        yield server.server_address[1], disconnected
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def websocket_request(bridge, opened):
    from urllib.parse import urlsplit
    url = urlsplit(opened["url"])
    revision = bridge.sessions[opened["session"]].revision
    return url, (f"GET /{opened['session']}/websockify/{revision} HTTP/1.1\r\nHost: {url.netloc}\r\n"
                 f"Origin: {bridge.origin}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n").encode()


@pytest.mark.parametrize("owner_input,teaching_mode,lease_expiry", [(False, False, False), (True, False, False),
                                                                 (True, True, False), (False, False, True)],
                         ids=["framebuffer", "owner-input", "teaching-input", "relay-expiry"])
async def test_live_view_bytes_do_not_wait_for_a_busy_core_loop(viewer, wire_upstream, owner_input, teaching_mode, lease_expiry):
    from raphael_core.computer.rfb_input import frame
    bridge, _, _ = viewer
    port, _ = wire_upstream
    async def connection(target): return port, "synthetic"
    bridge.vm.viewer_connection = connection
    opened = await bridge.open({})
    if owner_input:
        await bridge.control({**opened, "held": True})
    threads = {}
    if teaching_mode:
        async def capture(message):
            threads["capture"] = threading.get_ident()
            await asyncio.sleep(.005)
            return '{"observation":{"safe":false,"screen":"","images":[]},"event":{"kind":"private_input"}}'
        async def commit(*args):
            threads["commit"] = threading.get_ident()
        async def idle(*args): pass
        bridge.teaching = SimpleNamespace(relay_hook=lambda token: SimpleNamespace(identifier="fake", capture=capture),
                                         relay_input=commit, disconnected=idle, tick=idle)
        bridge.publish_session(opened["session"])
    url, request = websocket_request(bridge, opened)
    ready, start = threading.Event(), threading.Event()
    result = {}
    def client():
        try:
            with socket.create_connection((url.hostname, url.port), timeout=2) as stream:
                stream.sendall(request)
                header = b""
                while not header.endswith(b"\r\n\r\n"):
                    header += stream.recv(1)
                handshake = b"RFB 003.008\n\x02" + bytes(16) + b"\x01"
                stream.sendall(frame(handshake))
                response = b""
                while len(response) < len(frame(handshake)):
                    chunk = stream.recv(len(frame(handshake)) - len(response))
                    assert chunk
                    response += chunk
                ready.set()
                assert start.wait(2)
                message = b"\x05" + bytes((int(teaching_mode),)) + bytes(4) if owner_input else b"\x03" + bytes(9)
                began = time.perf_counter()
                if not lease_expiry:
                    stream.sendall(frame(message))
                result["response"] = stream.recv(1024)
                result["delay"] = time.perf_counter() - began
        except Exception as error:
            result["error"] = type(error).__name__
            ready.set()
    thread = threading.Thread(target=client, daemon=True)
    thread.start()
    try:
        assert await asyncio.to_thread(ready.wait, 3)
        if lease_expiry:
            from dataclasses import replace
            bridge.relay.publish(opened["session"], replace(bridge.relay.policies[opened["session"]], deadline=time.monotonic() + .05))
        start.set()
        time.sleep(.3)  # Synthetic synchronous work on the core loop, independent of both network peers.
        await asyncio.to_thread(thread.join, 3)
        assert not thread.is_alive() and "error" not in result, result
        assert bool(result["response"]) is not lease_expiry and result["delay"] < .2, result
        print(f"delivery_ms={result['delay'] * 1000:.2f}, owner_input={owner_input}, teaching={teaching_mode}, expiry={lease_expiry}")
        if teaching_mode:
            await bridge.flush_teaching(opened["session"])
            assert threads["capture"] != threading.get_ident()
            assert threads["commit"] == threading.get_ident()
    finally:
        start.set()
        await bridge.close(opened)
        await asyncio.to_thread(thread.join, 3)


@pytest.mark.parametrize("ending", ["close", "expiry"])
async def test_main_loop_session_end_closes_both_relay_sockets(viewer, wire_upstream, ending):
    bridge, _, clock = viewer
    port, disconnected = wire_upstream
    async def connection(target): return port, "synthetic"
    bridge.vm.viewer_connection = connection
    opened = await bridge.open({"member_id": 1})
    url, request = websocket_request(bridge, opened)
    reader, writer = await asyncio.open_connection(url.hostname, url.port)
    try:
        writer.write(request)
        await writer.drain()
        await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 2)
        if ending == "expiry":
            clock[0] += LEASE_SECONDS + 1
        else:
            await bridge.close(opened)
        assert await asyncio.wait_for(reader.read(), 2) == b""
        assert await asyncio.to_thread(disconnected.wait, 2)
        assert opened["session"] not in bridge.sessions
    finally:
        writer.close()


def test_bridge_pictures_are_requested_and_stopped_explicitly():
    from raphael_core.computer.viewer import BOOTSTRAP
    script = BOOTSTRAP.decode()
    assert "raphael-desktop-frames" in script
    assert "clearInterval" in script
    assert "pagehide" in script and "snapshot();" in script
    assert "!rfb.viewOnly" in script and "480 / canvas.width" in script
    assert "framesTimer = null" in script.splitlines()[0]
    assert "if (event.source !== parent) return;" in script
    assert "if (event.data.on === true) { snapshot(); framesTimer = setInterval(snapshot, 3000); }" in script
    assert "setInterval(() => {\n  const canvas" not in script
    assert "pagehide', () => {snapshot(); clearInterval(framesTimer)" in script


@pytest.mark.parametrize("preview", [False, True], ids=["watch-only", "preview"])
async def test_relay_drops_unauthorized_input_without_stalling_frames(viewer, wire_upstream, preview):
    from raphael_core.computer.rfb_input import frame
    from .test_rfb_input import payload
    bridge, _, _ = viewer
    port, _ = wire_upstream
    async def connection(target): return port, "synthetic"
    bridge.vm.viewer_connection = connection
    opened = await bridge.open({"preview": preview})
    url, request = websocket_request(bridge, opened)
    reader, writer = await asyncio.open_connection(url.hostname, url.port)
    try:
        writer.write(request)
        await writer.drain()
        await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 2)
        writer.write(frame(b"RFB 003.008\n\x02" + bytes(16) + b"\x01"))
        await writer.drain()
        await asyncio.wait_for(reader.read(1024), 2)
        display = b"\x03" + bytes(9)
        writer.write(frame(b"\x05\x01" + bytes(4)) + frame(display))
        await writer.drain()
        assert payload(await asyncio.wait_for(reader.read(1024), 2)) == display
        assert bridge.relay.sequence(opened["session"]) == 0
    finally:
        writer.close()


async def test_closing_during_teaching_capture_cannot_forward_late_input(viewer, wire_upstream):
    from raphael_core.computer.rfb_input import frame
    bridge, _, _ = viewer
    port, _ = wire_upstream
    async def connection(target): return port, "synthetic"
    bridge.vm.viewer_connection = connection
    opened = await bridge.open({"member_id": 1})
    await bridge.control({**opened, "held": True})
    entered, cancelled, commits = threading.Event(), threading.Event(), []
    async def capture(message):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
    async def commit(*args): commits.append(args)
    async def idle(*args): pass
    bridge.teaching = SimpleNamespace(relay_hook=lambda token: SimpleNamespace(identifier="fake", capture=capture),
                                     relay_input=commit, disconnected=idle, tick=idle)
    bridge.publish_session(opened["session"])
    url, request = websocket_request(bridge, opened)
    reader, writer = await asyncio.open_connection(url.hostname, url.port)
    try:
        writer.write(request)
        await writer.drain()
        await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 2)
        writer.write(frame(b"RFB 003.008\n\x02" + bytes(16) + b"\x01"))
        await writer.drain()
        await asyncio.wait_for(reader.read(1024), 2)
        writer.write(frame(b"\x05\x01" + bytes(4)))
        await writer.drain()
        assert await asyncio.to_thread(entered.wait, 2)
        await bridge.close(opened)
        assert await asyncio.wait_for(reader.read(), 2) == b""
        assert cancelled.is_set()
        assert not commits
    finally:
        writer.close()


async def test_threaded_listener_retains_session_and_connection_caps(viewer):
    bridge, _, _ = viewer
    for _ in range(8):
        await bridge.open({})
    with pytest.raises(RpcError, match="too many desktop viewers"):
        await bridge.open({})
    port = bridge.server.sockets[0].getsockname()[1]
    streams = await asyncio.gather(*(asyncio.open_connection("127.0.0.1", port) for _ in range(64)))
    async def count(): return len(bridge.relay.tasks)
    try:
        for _ in range(50):
            if await bridge.relay.call(count()) == 64:
                break
            await asyncio.sleep(.01)
        assert await bridge.relay.call(count()) == 64
        reader, extra = await asyncio.open_connection("127.0.0.1", port)
        try:
            assert await asyncio.wait_for(reader.read(), 2) == b""
        finally:
            extra.close()
            await extra.wait_closed()
    finally:
        for _, writer in streams:
            writer.close()
        await asyncio.gather(*(writer.wait_closed() for _, writer in streams))


@pytest.fixture
async def viewer(tmp_path, conn):
    from raphael_core.brain.settings import SettingsStore
    settings = SettingsStore(conn)
    settings.set("computer_vm_mode", "shared")
    runtime = Runtime()
    clock = [0]
    vm = LocalVm(tmp_path, settings=settings, runner=runtime, clock=lambda: clock[0])
    runtime.raw = container(vm, vm.target(), runtime)
    bridge = DesktopViewer(vm, member_exists=lambda member: member in (0, 1))
    try:
        yield bridge, runtime, clock
    finally:
        await bridge.aclose()
        assert bridge.relay is None or not bridge.relay.thread.is_alive()


def _docker_calls(runtime):
    return len([args for args, _ in runtime.calls if args[0] in ('info', 'image', 'container')])


async def test_an_open_page_asks_docker_rarely_while_nothing_can_change(viewer):
    bridge, runtime, clock = viewer
    bridge.vm.desktop = SimpleNamespace(installed=lambda: True)
    first = await bridge.status({"member_id": 1})
    asked = _docker_calls(runtime)
    assert asked > 0
    for _ in range(4):
        clock[0] += 2
        assert await bridge.status({"member_id": 1}) == first
    assert _docker_calls(runtime) == asked
    clock[0] += 10
    await bridge.status({"member_id": 1})
    assert _docker_calls(runtime) > asked


async def test_a_change_to_the_computer_is_seen_at_the_next_poll(viewer):
    bridge, runtime, clock = viewer
    target = bridge.vm.target()
    assert (await bridge.status({}))["state"] == "running"
    await bridge.vm.stop(target)
    runtime.raw["State"]["Running"] = False
    assert (await bridge.status({}))["state"] == "stopped"
    assert (await bridge.vm.start(target))["ready"]
    runtime.raw["State"]["Running"] = True
    assert (await bridge.status({}))["state"] == "running"


async def test_watched_status_bursts_share_one_inspect_and_changes_invalidate(viewer):
    bridge, runtime, clock = viewer
    opened = await bridge.open({"member_id": 0, "preview": True})
    runtime.calls.clear()
    clock[0] += 3
    async def interleaved(args, **kwargs):
        await asyncio.sleep(0)
        return await runtime(args, **kwargs)
    bridge.vm.run = interleaved
    await asyncio.gather(*(bridge.status({}) for _ in range(12)))
    assert sum(args[:2] == ["container", "inspect"] for args, _ in runtime.calls) == 1
    runtime.raw["State"]["Running"] = False
    bridge.vm.changes += 1
    assert (await bridge.status({}))["state"] == "stopped"
    await bridge.close({"session": opened["session"]})


async def test_status_cache_keeps_captured_engine_targets_separate(viewer):
    from dataclasses import replace
    from unittest.mock import AsyncMock
    bridge, _, _ = viewer
    local = bridge.vm.target()
    remote = replace(local, remote="test-host")
    bridge.vm.status = AsyncMock(side_effect=[{"state": "running"}, {"state": "stopped"}])
    assert (await bridge.status_for(local))["state"] == "running"
    assert (await bridge.status_for(remote))["state"] == "stopped"
    assert (await bridge.status_for(local))["state"] == "running"
    assert bridge.vm.status.await_count == 2


async def test_connected_renewal_extends_the_lease_without_reading_status(viewer):
    bridge, runtime, clock = viewer
    opened = await bridge.open({"preview": True})
    socket = object()
    bridge.sessions[opened["session"]].sockets.add(socket)
    runtime.calls.clear()
    clock[0] += 10
    renewed = await bridge.renew(opened)
    bridge.sessions[opened["session"]].sockets.remove(socket)
    assert renewed["state"] == "running"
    assert bridge.sessions[opened["session"]].expires == clock[0] + LEASE_SECONDS
    assert not runtime.calls


async def test_the_panel_reads_the_owner_picture_only_when_it_exists(viewer, tmp_path):
    bridge, _, _ = viewer
    assert await bridge.wallpaper({}) == {}
    (tmp_path / 'computer-wallpaper.jpg').write_bytes(b'\xff\xd8\xff sample')
    assert (await bridge.wallpaper({}))['image'].startswith('data:image/jpeg;base64,/9j/')


async def test_status_and_session_urls_never_publish_vnc_credentials(viewer):
    bridge, _, _ = viewer
    public = await bridge.status({"member_id": 1})
    opened = await bridge.open({"member_id": 1})
    assert public == {"state": "running", "ready": True, "control": "member",
                      "host": "", "target": "shared", "mode": "shared", "idle_minutes": 15, "lifecycle": None}
    assert "private" not in json.dumps([public, opened, await bridge.vm.status(bridge.vm.target())])
    assert "password" not in opened["url"]
    assert bridge.server.sockets[0].getsockname()[0] == "127.0.0.1"
    with pytest.raises(RpcError):
        await bridge.open({"member_id": 999})
    with pytest.raises(RpcError):
        await bridge.open({"member_id": True})


async def test_take_control_refuses_active_tools_and_handback_releases_only_its_lease(viewer):
    bridge, _, _ = viewer
    one, two = await bridge.open({}), await bridge.open({})
    target = bridge.vm.target()
    bridge.vm.active[target.key] = 1
    with pytest.raises(RpcError):
        await bridge.control({**one, "held": True})
    bridge.vm.active.clear()
    assert (await bridge.control({**one, "held": True}))["control"] == "owner"
    assert target.key in bridge.vm.held
    with pytest.raises(RpcError):
        await bridge.control({**two, "held": True})
    revision = bridge.sessions[one["session"]].revision
    await bridge.control({**two, "held": False})
    assert bridge.sessions[one["session"]].revision == revision
    await bridge.close(two)
    assert target.key in bridge.vm.held
    assert (await bridge.control({**one, "held": False}))["control"] == "member"
    assert not bridge.vm.held


async def test_closed_and_expired_viewers_release_the_hold_but_renewal_preserves_it(viewer):
    bridge, _, clock = viewer
    opened = await bridge.open({})
    await bridge.control({**opened, "held": True})
    clock[0] += LEASE_SECONDS - 1
    await bridge.renew(opened)
    clock[0] += LEASE_SECONDS - 1
    assert (await bridge.renew(opened))["control"] == "owner"
    clock[0] += LEASE_SECONDS + 1
    with pytest.raises(RpcError):
        await bridge.renew(opened)
    await asyncio.sleep(1.1)
    assert not bridge.vm.held and not bridge.sessions
    opened = await bridge.open({})
    await bridge.control({**opened, "held": True})
    await bridge.close(opened)
    assert not bridge.vm.held
    await bridge.close(opened)


async def test_stopped_unavailable_and_restarted_desktops_keep_the_session(viewer):
    bridge, runtime, clock = viewer
    opened = await bridge.open({})
    runtime.raw["State"]["Running"] = False
    clock[0] += 3
    assert (await bridge.renew(opened))["state"] == "stopped"
    with pytest.raises(RpcError):
        await bridge.control({**opened, "held": True})
    runtime.up = False
    for _ in range(6):
        clock[0] += 10
        renewed = await bridge.renew(opened)
    assert renewed["state"] == "unavailable"
    runtime.up = True
    runtime.raw["State"]["Running"] = True
    clock[0] += 3
    assert (await bridge.renew(opened))["state"] == "running"
    assert (await bridge.control({**opened, "held": True}))["control"] == "owner"
    bridge.vm.enabled = False
    assert (await bridge.status({}))["state"] == "absent"


async def test_per_bot_viewers_hold_the_selected_target_and_never_another_member(viewer):
    from types import SimpleNamespace
    bridge, runtime, _ = viewer
    bridge.vm.settings = SimpleNamespace(get=lambda key: "per-bot")
    target = bridge.vm.target(1)
    runtime.raw = container(bridge.vm, target, runtime)
    opened = await bridge.open({"member_id": 1})
    assert bridge.sessions[opened["session"]].target == target
    assert target != bridge.vm.target(0)
    await bridge.control({**opened, "held": True})
    assert target.key in bridge.vm.held and bridge.vm.target(0).key not in bridge.vm.held
    bridge.vm.settings = SimpleNamespace(get=lambda key: "shared")
    assert (await bridge.renew(opened))["state"] == "running"
    await bridge.close(opened)
    assert not bridge.vm.held


async def test_bridge_proxies_the_container_page_and_keeps_credentials_out_of_html(viewer):
    bridge, _, _ = viewer

    async def upstream(reader, writer):
        await reader.readuntil(b"\r\n\r\n")
        body = b'<html><head><script type="module" src="app/ui.js"></script></head><body><div id="noVNC_container"></div></body></html>'
        writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body)
        await writer.drain()
        writer.close()

    server = await asyncio.start_server(upstream, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]

    async def connection(target): return port, "secret-vnc-value"
    bridge.vm.viewer_connection = connection
    opened = await bridge.open({})
    base = opened["url"].removesuffix("vnc.html")
    try:
        async with httpx.AsyncClient(trust_env=False) as client:
            page = await client.get(opened["url"])
            assert page.status_code == 200 and 'src="bridge.js"' in page.text
            assert "secret-vnc-value" not in page.text and "app/ui.js" not in page.text
            assert page.headers["cache-control"] == "no-store"
            bootstrap = await client.get(base + "bridge.js")
            assert "new RFB" in bootstrap.text and "secret-vnc-value" not in bootstrap.text
            config = await client.get(base + "connection")
            assert config.json()["password"] == "secret-vnc-value"
            assert config.json()["held"] is False
            assert (await client.get(base + "connection", headers={"Origin": "https://foreign.example"})).status_code == 403
            assert (await client.get(base + "connection", headers={"Host": "foreign.example"})).status_code == 403
            assert (await client.get(bridge.origin + "/unknown/vnc.html")).status_code == 403
            assert (await client.post(base + "connection")).status_code == 403
    finally:
        server.close()
        await server.wait_closed()


def test_a_changed_novnc_entry_fails_closed():
    with pytest.raises(VmError):
        embedded_page("<html>Unknown viewer</html>")


def test_library_embedding_omits_standalone_chrome_and_keeps_upstream_notices():
    page = embedded_page('''<html><head><!-- Copyright noVNC authors -->
        <link rel="stylesheet" href="app/styles/base.css">
        <script src="app/ui.js"></script></head><body>
        <div id="noVNC_control_bar_anchor"><button id="noVNC_control_bar_handle"></button></div>
        <div id="noVNC_container"></div></body></html>''').decode()
    assert "Copyright noVNC authors" in page
    assert "base.css" not in page and "control_bar" not in page and "app/ui.js" not in page
    assert 'src="bridge.js"' in page and 'id="noVNC_container"' in page
    assert 'background:#171717' in page


async def test_private_connection_uses_the_current_validated_container_after_restart(viewer):
    bridge, runtime, _ = viewer
    target = bridge.vm.target()
    assert await bridge.vm.viewer_connection(target) == (6080, "private")
    runtime.raw["NetworkSettings"]["Ports"]["6901/tcp"][0]["HostPort"] = "6090"
    assert await bridge.vm.viewer_connection(target) == (6090, "private")
    runtime.raw = None
    with pytest.raises(VmError):
        await bridge.vm.viewer_connection(target)


async def test_persistent_websocket_gates_input_before_and_after_handback(viewer):
    bridge, _, _ = viewer
    requests = []

    async def upstream(reader, writer):
        try:
            requests.append(await reader.readuntil(b"\r\n\r\n"))
            writer.write(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
            await writer.drain()
            while data := await reader.read(1024):
                writer.write(data)
                await writer.drain()
        finally:
            writer.close()

    server = await asyncio.start_server(upstream, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]

    async def connection(target): return port, "never-in-websocket-url"
    bridge.vm.viewer_connection = connection
    opened = await bridge.open({})
    await bridge.control({**opened, "held": True})
    from urllib.parse import urlsplit
    url = urlsplit(opened["url"])
    reader, writer = await asyncio.open_connection(url.hostname, url.port)
    try:
        revision = bridge.sessions[opened["session"]].revision
        request = f"GET /{opened['session']}/websockify/{revision} HTTP/1.1\r\nHost: {url.netloc}\r\nOrigin: {bridge.origin}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: test\r\nSec-WebSocket-Version: 13\r\n\r\n"
        writer.write(request.encode())
        await writer.drain()
        assert (await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 2)).startswith(b"HTTP/1.1 101")
        from raphael_core.computer.rfb_input import frame
        from .test_rfb_input import payload

        async def exchange(message):
            writer.write(frame(message)); await writer.drain()
            response = await asyncio.wait_for(reader.read(1024), 2)
            return payload(response)

        handshake = b"RFB 003.008\n\x02" + bytes(16) + b"\x01"
        assert await exchange(handshake) == handshake
        pointer = b"\x05" + bytes(5)
        assert await exchange(pointer) == pointer
        assert requests[0].startswith(b"GET /websockify HTTP/1.1")
        assert b"never-in-websocket-url" not in requests[0]
        await bridge.control({**opened, "held": False})
        assert bridge.sessions[opened["session"]].sockets
        # The same connection still carries framebuffer updates, but drops input.
        display = b"\x03" + bytes(9)
        writer.write(frame(pointer) + frame(display)); await writer.drain()
        assert payload(await asyncio.wait_for(reader.read(1024), 2)) == display
        await bridge.control({**opened, "held": True})
        assert await exchange(pointer) == pointer
        await bridge.control({**opened, "held": False})
        assert not bridge.vm.held
    finally:
        writer.close()
        server.close()
        await server.wait_closed()


async def test_control_rechecks_active_tools_after_the_probe_and_close_cannot_leak_a_hold(viewer):
    bridge, _, _ = viewer
    opened = await bridge.open({})
    before = bridge.status_for

    async def became_busy(target):
        state = await before(target)
        bridge.vm.active[target.key] = 1
        return state

    bridge.status_for = became_busy
    with pytest.raises(RpcError):
        await bridge.control({**opened, "held": True})
    assert not bridge.vm.held
    bridge.status_for = before
    bridge.vm.active.clear()
    await asyncio.gather(bridge.control({**opened, "held": True}), bridge.close(opened))
    assert not bridge.vm.held and not bridge.sessions


async def test_handback_invalidates_an_inflight_websocket_handshake(viewer, monkeypatch):
    bridge, _, _ = viewer
    connecting, resume = threading.Event(), threading.Event()

    async def upstream(reader, writer):
        try:
            await reader.read()
        finally:
            writer.close()

    server = await asyncio.start_server(upstream, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]

    async def connection(target): return port, "private"
    bridge.vm.viewer_connection = connection
    opened = await bridge.open({})
    await bridge.control({**opened, "held": True})
    revision = bridge.sessions[opened["session"]].revision
    original = asyncio.open_connection

    async def delayed_connection(host, requested_port, **kwargs):
        streams = await original(host, requested_port, **kwargs)
        if requested_port == port:
            connecting.set()
            assert await asyncio.to_thread(resume.wait, 3)
        return streams

    monkeypatch.setattr(asyncio, "open_connection", delayed_connection)
    from urllib.parse import urlsplit
    url = urlsplit(opened["url"])
    reader, writer = await asyncio.open_connection(url.hostname, url.port)
    try:
        writer.write(f"GET /{opened['session']}/websockify/{revision} HTTP/1.1\r\nHost: {url.netloc}\r\nUpgrade: websocket\r\n\r\n".encode())
        await writer.drain()
        assert await asyncio.to_thread(connecting.wait, 2)
        await bridge.control({**opened, "held": False})
        resume.set()
        assert await asyncio.wait_for(reader.read(), 2) == b""
        assert not bridge.vm.held
        assert not bridge.sessions[opened["session"]].sockets
        async with httpx.AsyncClient(trust_env=False) as client:
            stale = await client.get(f"{bridge.origin}/{opened['session']}/websockify/{revision}", headers={"Upgrade": "websocket"})
            assert stale.status_code == 403
    finally:
        resume.set()
        writer.close()
        server.close()
        await server.wait_closed()

"""Viewer privacy, routing, lifecycle and phase A lease contracts, without Docker."""
import asyncio
import json

import httpx
import pytest

from raphael_core.computer.viewer import DesktopViewer, embedded_page, LEASE_SECONDS
from raphael_core.computer.vm import LocalVm, VmError
from raphael_core.protocol import RpcError
from .test_vm import Runtime, container


@pytest.fixture
async def viewer(tmp_path):
    runtime = Runtime()
    clock = [0]
    vm = LocalVm(tmp_path, runner=runtime, clock=lambda: clock[0])
    runtime.raw = container(vm, vm.target(), runtime)
    bridge = DesktopViewer(vm, member_exists=lambda member: member in (0, 1))
    try:
        yield bridge, runtime, clock
    finally:
        await bridge.aclose()


async def test_status_and_session_urls_never_publish_vnc_credentials(viewer):
    bridge, _, _ = viewer
    public = await bridge.status({"member_id": 1})
    opened = await bridge.open({"member_id": 1})
    assert public == {"state": "running", "ready": True, "control": "member", "granted": False}
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
    bridge, runtime, _ = viewer
    opened = await bridge.open({})
    runtime.raw["State"]["Running"] = False
    assert (await bridge.renew(opened))["state"] == "stopped"
    with pytest.raises(RpcError):
        await bridge.control({**opened, "held": True})
    runtime.up = False
    assert (await bridge.renew(opened))["state"] == "unavailable"
    runtime.up = True
    runtime.raw["State"]["Running"] = True
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
    connecting, resume = asyncio.Event(), asyncio.Event()

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
            await resume.wait()
        return streams

    monkeypatch.setattr(asyncio, "open_connection", delayed_connection)
    from urllib.parse import urlsplit
    url = urlsplit(opened["url"])
    reader, writer = await asyncio.open_connection(url.hostname, url.port)
    try:
        writer.write(f"GET /{opened['session']}/websockify/{revision} HTTP/1.1\r\nHost: {url.netloc}\r\nUpgrade: websocket\r\n\r\n".encode())
        await writer.drain()
        await asyncio.wait_for(connecting.wait(), 2)
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

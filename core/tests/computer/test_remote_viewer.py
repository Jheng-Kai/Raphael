"""Remote screen regressions with fake Docker, SSH and HTTP only."""

import asyncio
import copy
from unittest.mock import AsyncMock

import httpx
import pytest

from raphael_core.brain.settings import SettingsStore
from raphael_core.computer import ssh_tunnel
from raphael_core.computer.remote_host import RemoteSession, SharedViewerTunnel
from raphael_core.computer.viewer import BOOTSTRAP, DesktopViewer, Session
from raphael_core.computer.vm import LocalVm, VmError, compatible, run_args
from .test_vm import Runtime, container


@pytest.fixture
def remote(tmp_path, conn):
    settings = SettingsStore(conn)
    settings.set("computer_ssh_alias", "test-host")
    runtime = Runtime()
    vm = LocalVm(tmp_path, settings=settings, runner=runtime)
    target = vm.target(1)
    runtime.raw = container(vm, target, runtime)
    return vm, target, runtime


def test_remote_publishes_only_the_host_loopback(remote):
    vm, target, runtime = remote
    args = run_args(target, vm.owner, "fake-password")
    assert args[args.index("-p") + 1] == "127.0.0.1::6901"
    assert compatible(runtime.raw, target, vm.owner, runtime.image_id)
    runtime.raw["HostConfig"]["PortBindings"]["6901/tcp"][0]["HostIp"] = "0.0.0.0"
    assert not compatible(runtime.raw, target, vm.owner, runtime.image_id)


async def test_legacy_remote_binding_upgrade_keeps_both_workspace_volumes(remote):
    vm, target, runtime = remote
    runtime.raw["HostConfig"]["PortBindings"] = {}
    runtime.raw["NetworkSettings"]["Ports"] = {}
    mounts = copy.deepcopy(runtime.raw["Mounts"])
    notices = []
    vm.rebuild_notice = lambda captured: notices.append(captured)
    assert not compatible(runtime.raw, target, vm.owner, runtime.image_id)
    assert await vm._upgrade_image(target) == {"state": "missing", "image": True}
    assert notices == [target]
    assert [args[0] for args, _ in runtime.calls if args[0] in ("stop", "rm")] == ["stop", "rm"]
    assert all("volume" not in args and "-v" not in args for args, _ in runtime.calls)
    assert mounts[0]["Name"] == str(target.workspace) and mounts[1]["Name"] == str(target.shared)


async def test_remote_uses_published_loopback_and_probes_the_forward(remote, monkeypatch):
    vm, target, runtime = remote
    calls = []
    class Tunnel:
        async def open(self, *args):
            calls.append(args)
            return 43123
        async def close(self): pass
    monkeypatch.setattr(ssh_tunnel, "Tunnel", Tunnel)
    probe = AsyncMock()
    monkeypatch.setattr(ssh_tunnel, "verify_viewer", probe, raising=False)
    assert await vm.viewer_connection(target) == (43123, "private")
    assert calls == [("test-host", "127.0.0.1", 6080)]
    probe.assert_awaited_once_with(43123)
    assert (await vm.status(target, probe=False))["viewer_url"] == ""


async def test_unreachable_forward_raises_the_public_error_after_one_retry(remote, monkeypatch):
    vm, target, _ = remote
    tunnel = AsyncMock()
    tunnel.open.return_value = 43123
    monkeypatch.setattr(ssh_tunnel, "Tunnel", lambda: tunnel)
    probe = AsyncMock(side_effect=OSError("forward refused"))
    monkeypatch.setattr(ssh_tunnel, "verify_viewer", probe, raising=False)
    with pytest.raises(VmError, match="^viewer_unreachable$"):
        await vm.viewer_connection(target)
    assert probe.await_count == 2
    assert tunnel.close.await_count >= 1


async def test_session_resolves_once_for_parallel_novnc_assets(remote):
    vm, target, _ = remote
    bridge = DesktopViewer(vm)
    vm.viewer_connection = AsyncMock(return_value=(43123, "private"))
    session = Session(target, vm.clock() + 15)
    try:
        assert await asyncio.gather(*(bridge.connection_for(session) for _ in range(12))) == [(43123, "private")] * 12
        vm.viewer_connection.assert_awaited_once_with(target)
        vm.changes += 1
        await bridge.connection_for(session)
        assert vm.viewer_connection.await_count == 2
    finally:
        await bridge.aclose()


async def test_failed_session_renew_reports_error_and_logs_once(remote, caplog):
    vm, target, _ = remote
    bridge = DesktopViewer(vm)
    vm.viewer_connection = AsyncMock(side_effect=VmError("viewer_unreachable"))
    session = Session(target, vm.clock() + 15)
    bridge.sessions["fake-session"] = session
    try:
        for _ in range(2):
            with pytest.raises(VmError):
                await bridge.connection_for(session)
        state = await bridge.renew({"session": "fake-session"})
        assert state["error"] == "viewer_unreachable"
        assert state["ready"] is False
        assert sum("viewer_unreachable" in record.message for record in caplog.records) == 1
    finally:
        await bridge.aclose()


def test_bootstrap_can_report_a_failed_module_import():
    script = BOOTSTRAP.decode()
    assert "import RFB from" not in script
    assert "await import('./core/rfb.js')" in script
    assert "catch { tell('unreachable')" in script


@pytest.mark.parametrize("status", [200, 302, 503, "refused"])
async def test_http_probe_requires_a_reachable_page(monkeypatch, status):
    client_type = httpx.AsyncClient
    def request(request):
        assert str(request.url) == "http://127.0.0.1:43123/vnc.html"
        if status == "refused":
            raise httpx.ConnectError("fake refusal", request=request)
        return httpx.Response(status, content=b"fake noVNC page")
    monkeypatch.setattr(ssh_tunnel.httpx, "AsyncClient", lambda **kwargs: client_type(transport=httpx.MockTransport(request), **kwargs))
    if status == 200:
        await ssh_tunnel.verify_viewer(43123)
    else:
        with pytest.raises((OSError, httpx.HTTPError)):
            await ssh_tunnel.verify_viewer(43123)


async def test_http_probe_has_a_whole_response_deadline(monkeypatch):
    client_type, timeout = httpx.AsyncClient, asyncio.timeout
    deadlines = []
    class StalledBody(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b"first byte"
            await asyncio.Event().wait()
    def request(request): return httpx.Response(200, stream=StalledBody())
    def deadline(seconds):
        deadlines.append(seconds)
        return timeout(0.01)
    monkeypatch.setattr(ssh_tunnel.httpx, "AsyncClient", lambda **kwargs: client_type(transport=httpx.MockTransport(request), **kwargs))
    monkeypatch.setattr(ssh_tunnel.asyncio, "timeout", deadline)
    with pytest.raises(TimeoutError):
        await ssh_tunnel.verify_viewer(43123)
    assert deadlines == [5]


async def test_ssh_diagnostics_are_bounded_and_redacted(caplog):
    stream = asyncio.StreamReader()
    stream.feed_data(b"channel 0: open failed: Connection refused\npassword=example-secret\nBearer example-authorization\n" + b"x" * 10000)
    stream.feed_eof()
    await ssh_tunnel.viewer_stderr(stream)
    assert stream.at_eof()
    assert len(caplog.records) == 1
    assert "Connection refused" in caplog.text
    assert "example-secret" not in caplog.text and "example-authorization" not in caplog.text
    assert len(caplog.records[0].message) < 2100


@pytest.mark.parametrize("port", [True, 22, 65536, "43123"])
def test_loopback_forward_rejects_invalid_destination_ports(port):
    with pytest.raises(ValueError):
        ssh_tunnel.tunnel_args("test-host", 43124, "127.0.0.1", port)


async def test_ssh_stdio_forwards_to_published_host_loopback(caplog):
    launches = []
    class Input:
        def close(self): pass
    class Process:
        stdin = Input()
        stdout = asyncio.StreamReader()
        stderr = asyncio.StreamReader()
        returncode = None
        def kill(self): self.returncode = -1
        async def wait(self): return self.returncode
    process = Process()
    process.stderr.feed_data(b"channel open failed: Connection refused\n")
    process.stderr.feed_eof()
    async def launch(*args, **kwargs):
        launches.append((args, kwargs))
        return process
    session = RemoteSession("test-host", launch=launch)
    _, writer = await session.connect_viewer("127.0.0.1", 43123)
    writer.close()
    await writer.wait_closed()
    args, options = launches[0]
    assert args[args.index("-W") + 1] == "127.0.0.1:43123"
    assert options["stderr"] == asyncio.subprocess.PIPE
    assert "Connection refused" in caplog.text


async def test_shared_forward_is_probed_and_connects_to_published_port(remote, monkeypatch):
    vm, target, _ = remote
    shared = AsyncMock()
    shared.endpoint.return_value = "unix://fake/docker.sock"
    vm.remote_sessions[target.remote] = shared
    async def probe(port):
        # Exercise the local forward against fake SSH streams, with no remote host.
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        writer.write(b"GET /vnc.html HTTP/1.0\r\n\r\n")
        await writer.drain()
        assert (await reader.read()).startswith(b"HTTP/1.0 200")
        writer.close()
        await writer.wait_closed()
    class Writer:
        def write(self, data): pass
        async def drain(self): pass
        def close(self): pass
        async def wait_closed(self): pass
    reader = asyncio.StreamReader()
    reader.feed_data(b"HTTP/1.0 200 OK\r\n\r\nfake noVNC page")
    reader.feed_eof()
    shared.connect_viewer.return_value = (reader, Writer())
    monkeypatch.setattr(ssh_tunnel, "verify_viewer", probe)
    try:
        assert (await vm.viewer_connection(target))[1] == "private"
        assert isinstance(vm.tunnels[(target.remote, target.name)], SharedViewerTunnel)
        shared.connect_viewer.assert_awaited_once_with("127.0.0.1", 6080)
    finally:
        await vm.close_viewer(target)


@pytest.mark.parametrize("change", ["owner", "workspace", "public-port", "held", "active"])
async def test_remote_binding_upgrade_refuses_foreign_unsafe_or_busy_computers(remote, change):
    vm, target, runtime = remote
    runtime.raw["HostConfig"]["PortBindings"] = {}
    if change == "owner":
        runtime.raw["Config"]["Labels"]["org.raphael.computer.owner"] = "another-owner"
    elif change == "workspace":
        runtime.raw["Mounts"][0]["Name"] = "another-workspace"
    elif change == "public-port":
        runtime.raw["HostConfig"]["PortBindings"] = {"6901/tcp": [{"HostIp": "0.0.0.0", "HostPort": "43123"}]}
    elif change == "held":
        vm.held.add(target.key)
    else:
        vm.active[target.key] = 2
    with pytest.raises(VmError, match="busy|incompatible"):
        await vm._upgrade_image(target)
    assert not any(args[0] in ("stop", "rm", "volume") for args, _ in runtime.calls)


async def test_open_records_unreachable_before_returning_the_remote_session(remote):
    vm, _, _ = remote
    bridge = DesktopViewer(vm)
    vm.viewer_connection = AsyncMock(side_effect=VmError("viewer_unreachable"))
    try:
        opened = await bridge.open({"member_id": 1, "preview": True})
        state = await bridge.renew(opened)
        assert state["error"] == "viewer_unreachable" and state["ready"] is False
        assert "password" not in str(state) and "password" not in str(opened)
        assert vm.viewer_connection.await_count == 1
    finally:
        await bridge.aclose()


@pytest.mark.parametrize("asset_status", [200, 503])
async def test_remote_asset_requests_share_resolution_and_failures_reach_renew(remote, monkeypatch, caplog, asset_status):
    vm, _, runtime = remote
    bridge = DesktopViewer(vm)
    tunnel = AsyncMock()
    tunnel.open.return_value = 43123
    monkeypatch.setattr(ssh_tunnel, "Tunnel", lambda: tunnel)
    probe = AsyncMock()
    monkeypatch.setattr(ssh_tunnel, "verify_viewer", probe)
    def asset(request):
        assert request.url.port == 43123
        body = b'<script src="app/ui.js"></script><div id="noVNC_container"></div>'
        return httpx.Response(asset_status, content=body)
    try:
        opened = await bridge.open({"member_id": 1, "preview": True})
        async def replace_client():
            await bridge.relay.client.aclose()
            bridge.relay.client = httpx.AsyncClient(transport=httpx.MockTransport(asset), trust_env=False)
        await bridge.relay.call(replace_client())
        runtime.calls.clear()
        base = opened["url"].removesuffix("vnc.html")
        async with httpx.AsyncClient(trust_env=False) as client:
            replies = await asyncio.gather(*(client.get(base + path) for path in ("vnc.html", "core/rfb.js", "core/util/events.js")))
            assert [reply.status_code for reply in replies] == [asset_status] * 3
        assert not runtime.calls
        assert tunnel.open.await_count == probe.await_count == 1
        renewed = await bridge.renew(opened)
        if asset_status == 503:
            assert renewed["error"] == "viewer_unreachable" and not renewed["ready"]
            assert sum("viewer_unreachable" in record.message for record in caplog.records) == 1
        else:
            assert renewed["ready"] and "error" not in renewed
    finally:
        await bridge.aclose()


async def test_start_automatically_upgrades_legacy_remote_container(remote):
    vm, target, runtime = remote
    runtime.raw["HostConfig"]["PortBindings"] = {}
    runtime.raw["NetworkSettings"]["Ports"] = {}
    async def run(args, **kwargs):
        command = args[2:] if args[:1] == ["--host"] else args
        if command[0] == "run":
            runtime.raw = container(vm, target, runtime)
        return await runtime(args, **kwargs)
    vm.run = run
    assert (await vm.start(target))["ready"]
    commands = [args for args, _ in runtime.calls]
    assert [args[0] for args in commands if args[0] in ("stop", "rm", "run")] == ["stop", "rm", "run"]
    created = next(args for args in commands if args[0] == "run")
    assert created[created.index("-p") + 1] == "127.0.0.1::6901"
    assert any(f"source={target.workspace}," in arg for arg in created)
    assert any(f"source={target.shared}," in arg for arg in created)
    assert all("-v" not in args and args[:2] != ["volume", "rm"] for args in commands)

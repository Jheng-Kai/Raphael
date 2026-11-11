"""Guide reads stay available while synthetic sign-ins are pending or abandoned."""

import asyncio
from contextlib import asynccontextmanager, suppress

import httpx
import httpx2
import pytest

from raphael_core.connectors import http as private_http, service as managed_service
from raphael_core.connectors.google import GoogleClient, PREFIX
from raphael_core.connectors.http import ConnectorFailure, PrivateHttp
from raphael_core.integrations import device, service as builtin_service
from raphael_core.integrations.client import McpFailure
from raphael_core.integrations.oauth import CallbackListener
from raphael_core.protocol import RpcError
from test_connectors import Platform, setup_service


async def guide_reads(router):
    result = await asyncio.wait_for(asyncio.gather(
        router.call("integrations.catalog"), router.call("connectors.status"),
        router.call("connectors.catalog"),
    ), 5)
    assert len(result) == 3
    assert all(isinstance(item, dict) for item in result)


@pytest.mark.parametrize("cancel", [False, True])
async def test_pending_composio_never_blocks_guide_reads_and_second_login_is_busy(tmp_path, conn, cancel):
    opened = asyncio.Event()

    async def browser(_url):
        opened.set()

    async def sleep(_seconds):
        await asyncio.Future()

    platform = Platform(["INITIATED"])
    router, service, hub, vault = setup_service(tmp_path, conn, platform, open_browser=browser, sleep=sleep)
    vault.set("connectors:composio:key", "synthetic-key")

    async def never_login(*args, **kwargs):
        await asyncio.Future()

    hub._connector.login = never_login
    task = asyncio.create_task(router.call("connectors.connect", {"toolkit": "gmail"}))
    try:
        await asyncio.wait_for(opened.wait(), 5)
        await guide_reads(router)
        # The bounds are for a call that hangs, not a measure of speed: a refusal comes at once, and 200 ms was within
        # reach of a slow CI machine.
        busy = await asyncio.wait_for(router.call("connectors.connect", {"toolkit": "gmail"}), 2)
        assert busy["error"] == "busy"
        with pytest.raises(RpcError, match="under way"):
            await asyncio.wait_for(router.call("integrations.connect", {"catalog_id": "slack"}), 2)
        if cancel:
            assert await router.call("integrations.connect_cancel") == {"cancelled": True}
            assert await asyncio.wait_for(task, 5) == {"connected": False, "error": "cancelled"}
            assert not service.login_pending and not service._lock.locked()
            assert platform.config["toolkits"]["enable"] == []
            await guide_reads(router)
            platform.statuses = ["ACTIVE"]
            assert (await asyncio.wait_for(router.call("connectors.connect", {"toolkit": "gmail"}), 5))["connected"]
        else:
            assert not task.done()
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


@pytest.mark.parametrize("cancel", [False, True])
async def test_builtin_login_never_blocks_parallel_guide_reads_and_releases_its_task(tmp_path, conn, cancel, monkeypatch):
    opened, closed = asyncio.Event(), asyncio.Event()
    router, service, hub, vault = setup_service(tmp_path, conn, Platform())
    vault.set("connectors:composio:key", "synthetic-key")
    # The sign-in must still be under way while the reads and the two refused connects below run. At 80 ms it was over
    # before them on a slow CI machine, and the refusal no longer said "under way" (2026-11-11). The run that is
    # cancelled needs no end of its own. The run that times out gets a second, twelve times what those calls take.
    hub._login_timeout_s = 30 if cancel else 1
    monkeypatch.setattr(builtin_service, "REFRESH_TOTAL_S", 0)

    async def login(*args, **kwargs):
        opened.set()
        try:
            await asyncio.Future()
        finally:
            closed.set()

    hub._connector.login = login
    from raphael_core.integrations.config import ServerConfig
    hub._config.add(ServerConfig(id="synthetic", name="Synthetic", transport="http", url="https://example.invalid", auth="oauth"))
    task = asyncio.create_task(router.call("integrations.connect", {"id": "synthetic"}))
    try:
        await asyncio.wait_for(opened.wait(), 5)
        await guide_reads(router)
        with pytest.raises(RpcError, match="under way"):
            await asyncio.wait_for(router.call("integrations.connect", {"catalog_id": "slack"}), 2)
        assert (await router.call("connectors.connect", {"toolkit": "gmail"}))["error"] == "busy"
        if cancel:
            assert await router.call("integrations.connect_cancel") == {"cancelled": True}
        result = await asyncio.wait_for(task, 3)
        assert result == {"connected": False, "error": "cancelled" if cancel else "timeout"}
        assert closed.is_set() and hub._login is None
        await guide_reads(router)
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


async def test_abandoned_composio_releases_permissions_and_lock(tmp_path, conn, monkeypatch):
    monkeypatch.setattr(managed_service, "RPC_TIMEOUT_S", .02)

    async def sleep(_seconds):
        await asyncio.Future()

    async def browser(_url):
        pass

    platform = Platform(["INITIATED"])
    router, service, _, vault = setup_service(tmp_path, conn, platform, sleep=sleep, open_browser=browser, poll_timeout=.02)
    vault.set("connectors:composio:key", "synthetic-key")
    result = await asyncio.wait_for(router.call("connectors.connect", {"toolkit": "gmail"}), 5)
    assert result["error"] == "timeout"
    assert not service.login_pending and not service._lock.locked()
    assert platform.config["toolkits"]["enable"] == []
    await guide_reads(router)


@pytest.mark.parametrize("method,params", [("catalog", {}), ("status", {}), ("connect", {"toolkit": "gmail"})])
async def test_hung_composio_http_answers_with_timeout(tmp_path, conn, monkeypatch, method, params):
    monkeypatch.setattr(private_http, "REQUEST_TIMEOUT_S", .02)

    async def hung(_request):
        await asyncio.Future()

    router, _, _, vault = setup_service(tmp_path, conn, hung)
    vault.set("connectors:composio:key", "synthetic-key")
    result = await asyncio.wait_for(router.call("connectors." + method, params), 5)
    if method == "status":
        # Status publishes the local snapshot when refreshing the provider fails.
        assert isinstance(result, dict)
    else:
        # A connect that got no answer from the service says so (R-CONNECT-01: stage "request" is the `no_answer` cause).
        assert result == {"ok": False, "error": "timeout", "http_status": None,
                          **({"stage": "request"} if method == "connect" else {})}


@pytest.mark.parametrize("max_bytes", [None, 1024])
async def test_total_http_timeout_includes_a_body_that_never_finishes(monkeypatch, max_bytes):
    monkeypatch.setattr(private_http, "REQUEST_TIMEOUT_S", .02)

    class Stream(httpx.AsyncByteStream):
        closed = False

        async def __aiter__(self):
            yield b"{"
            await asyncio.Future()

        async def aclose(self):
            self.closed = True

    stream = Stream()
    http = PrivateHttp(transport=httpx.MockTransport(lambda request: httpx.Response(200, stream=stream)))
    with pytest.raises(ConnectorFailure, match="timeout"):
        await asyncio.wait_for(http.response("GET", "https://example.invalid", max_bytes=max_bytes), 5)
    assert stream.closed


async def test_google_browser_hang_closes_callback_listener():
    from raphael_core.integrations.vault import MemoryVault

    closed = []

    @asynccontextmanager
    async def listener(*args):
        class Callback:
            redirect_uri = "http://127.0.0.1:1234/callback"
        try:
            yield Callback()
        finally:
            closed.append(True)

    async def browser(_url):
        await asyncio.Future()

    vault = MemoryVault()
    vault.set(PREFIX + "client_id", "synthetic-client")
    with pytest.raises(ConnectorFailure, match="timeout"):
        await asyncio.wait_for(GoogleClient(vault, listener=listener).connect([], browser, timeout=.02), 5)
    assert closed == [True]


async def test_cancel_closes_an_accepted_incomplete_oauth_callback():
    listener = CallbackListener()
    await listener.start()
    reader, writer = await asyncio.open_connection("127.0.0.1", listener._port)
    try:
        writer.write(b"GET /callback")
        await writer.drain()
        for _ in range(10):
            if listener._writers:
                break
            await asyncio.sleep(0)
        assert listener._writers
        await listener.close()
        assert await asyncio.wait_for(reader.read(), 5) == b""
    finally:
        writer.close()
        await writer.wait_closed()
        await listener.close()


async def test_device_oauth_request_has_a_total_deadline(monkeypatch):
    monkeypatch.setattr(device, "REQUEST_TIMEOUT_S", .02)

    async def hung(_request):
        await asyncio.Future()

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(hung)) as http:
        with pytest.raises(McpFailure, match="timeout"):
            await asyncio.wait_for(device._post(http, "https://example.invalid/token", {}), 5)


async def test_oauth_revocation_has_a_total_deadline(monkeypatch):
    from types import SimpleNamespace
    from raphael_core.integrations.oauth import revoke

    closed = []

    @asynccontextmanager
    async def client(**kwargs):
        async def post(*args, **kwargs):
            await asyncio.Future()
        try:
            yield SimpleNamespace(post=post)
        finally:
            closed.append(True)

    monkeypatch.setattr(httpx2, "AsyncClient", client)
    storage = SimpleNamespace(read_for_revocation=lambda: ("synthetic-refresh", None, "synthetic-client"))
    assert not await asyncio.wait_for(revoke(storage, "https://example.invalid/revoke", timeout_s=.02), 5)
    assert closed == [True]

"""A reset during a Proactor close still releases the relay socket and detaches it from the server."""

import logging
import socket
from types import SimpleNamespace
from unittest.mock import Mock

from raphael_core.computer.viewer_relay import ViewerRelay, quiet_reset


class Loop:
    def __init__(self):
        self.defaulted = []

    def default_exception_handler(self, context):
        self.defaulted.append(context)


class _ProactorBasePipeTransport:
    def __init__(self, sock, server):
        self._sock = sock
        self._server = server
        self._called_connection_lost = False

    def _call_connection_lost(self):
        raise AssertionError("The protocol was already notified before shutdown failed")


def test_a_reset_in_the_transports_own_close_is_one_line_and_anything_else_goes_to_asyncio(caplog):
    caplog.set_level(logging.INFO)
    loop = Loop()
    server = Mock()
    with socket.socket() as sock:
        transport = _ProactorBasePipeTransport(sock, server)
        handle = SimpleNamespace(_callback=transport._call_connection_lost)
        reset = {"message": "Exception in callback", "exception": ConnectionResetError(10054, "reset"), "handle": handle}
        quiet_reset(loop, reset)
        assert sock.fileno() == -1
        assert transport._sock is None and transport._server is None
        assert transport._called_connection_lost
        server._detach.assert_called_once_with()
        assert loop.defaulted == []
        assert "reset by its other end" in caplog.text
    other = {"message": "Exception in callback", "exception": ValueError("ours"), "handle": handle}
    quiet_reset(loop, other)
    elsewhere = {"message": "Task exception was never retrieved", "exception": ConnectionResetError(10054, "reset")}
    quiet_reset(loop, elsewhere)
    assert loop.defaulted == [other, elsewhere]


async def test_the_relay_loop_has_the_handler():
    async def prepare(*_):
        return {"code": 404}
    relay = ViewerRelay(prepare, None, None, lambda *_: None, None, None)
    await relay.start()
    try:
        assert relay.loop.get_exception_handler() is quiet_reset
    finally:
        await relay.aclose()

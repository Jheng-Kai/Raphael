"""A viewer connection its other end reset is one quiet line, not an asyncio ERROR with a traceback.

Six tracebacks `Exception in callback _ProactorBasePipeTransport._call_connection_lost` ... `ConnectionResetError:
[WinError 10054]` in two days, each a few seconds before the viewer loaded vnc.html again through the relay: the
connection was over already, and the relay closing its end raised inside asyncio's own callback."""

import logging

from raphael_core.computer.viewer_relay import ViewerRelay, quiet_reset


class Loop:
    def __init__(self):
        self.defaulted = []

    def default_exception_handler(self, context):
        self.defaulted.append(context)


class Handle:
    def __repr__(self):
        return "<Handle _ProactorBasePipeTransport._call_connection_lost(None)>"


def test_a_reset_in_the_transports_own_close_is_one_line_and_anything_else_goes_to_asyncio(caplog):
    caplog.set_level(logging.INFO)
    loop = Loop()
    quiet_reset(loop, {"message": "Exception in callback", "exception": ConnectionResetError(10054, "reset"), "handle": Handle()})
    assert loop.defaulted == []
    assert "reset by its other end" in caplog.text
    other = {"message": "Exception in callback", "exception": ValueError("ours"), "handle": Handle()}
    quiet_reset(loop, other)
    elsewhere = {"message": "Task exception was never retrieved", "exception": ConnectionResetError(10054, "reset")}
    quiet_reset(loop, elsewhere)
    assert loop.defaulted == [other, elsewhere]


async def test_the_relay_loop_has_the_handler():
    # A reset on loopback did not raise in this test's own sockets (tried with and without a pending read), so the
    # handler is proven on the context asyncio hands it above, and here only to be the relay loop's.
    async def prepare(*_):
        return {"code": 404}
    relay = ViewerRelay(prepare, None, None, lambda *_: None, None, None)
    await relay.start()
    try:
        assert relay.loop.get_exception_handler() is quiet_reset
    finally:
        await relay.aclose()

"""A computer call that breaks in the core says so, and a closed driver connection is a closed connection.

The app's log held 24 lines "Failure unknown: Elapsed: N seconds." in three days: twelve screen reads and browser opens
whose result was a bare `error` with no text (the core's own catch-all, which kept neither the exception nor a line of
the log), to which the read's elapsed time was added as all the result said. The member was told "The call failed
(error). Elapsed: 70.78 seconds."; the owner's step read "The cause is unknown"."""

import logging

import pytest

from raphael_core.computer.vm_bridge import CuaBridge
from raphael_core.computer.vm_tools import VmTools
from raphael_core.failures import classify
from raphael_core.services.attachment_store import AttachmentStore
from .test_vm import CatalogBridge, EmptyHub, per_bot_desktop as desktop  # noqa: F401


def tool(hub, name):
    return next(item for item in hub.offered() if item.name == name)


async def test_a_screen_read_that_breaks_in_the_core_says_where_and_is_no_bare_elapsed_time(desktop, tmp_path, caplog):
    vm, _, _ = desktop

    class Broken(CatalogBridge):
        calls = []

        async def request(self, method, params=None):
            if method == "tools/call" and (params or {}).get("name") == "list_windows":
                raise KeyError("window_id")  # a fault of ours, not anything the driver said
            return await super().request(method, params)

    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Broken)
    await hub.prepare()
    caplog.set_level(logging.WARNING)
    try:
        result = await hub.call(tool(hub, "list_windows").key, {}, approver="auto")
    finally:
        await hub.aclose()
    assert not result.ok and result.kind == "computer_fault"
    said = result.text.splitlines()[0]
    assert said.startswith("Raphael's own computer layer failed") and "KeyError" in said
    line = next(record.getMessage() for record in caplog.records if "failed in the core" in record.getMessage())
    assert "list_windows" in line and "KeyError at test_core_faults.py:" in line and "window_id" not in line
    failure = classify({"kind": result.kind, "message": result.text}, record=False)
    assert failure.kind == "tool_broken"


async def test_a_read_that_answers_still_says_how_long_it_took(desktop, tmp_path):
    vm, _, _ = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=CatalogBridge)
    await hub.prepare()
    try:
        result = await hub.call(tool(hub, "get_window_state").key, {"pid": 7, "window_id": 9}, approver="auto")
    finally:
        await hub.aclose()
    assert result.ok and "Elapsed:" in result.text


async def test_a_request_on_a_connection_another_call_closed_is_a_closed_connection():
    # A call that ran out of time closes the one driver connection for every call on it; one that was between two
    # requests then found no process and failed with an AttributeError, which the core took for a fault of unknown cause.
    bridge = CuaBridge(None, None)
    assert bridge.process is None
    with pytest.raises(ConnectionError):
        await bridge.request("tools/call", {"name": "list_windows", "arguments": {}})
    assert bridge.pending == {}

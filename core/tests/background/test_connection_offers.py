"""Running background work keeps its tool list while grants change, and every call is checked again.

The list is fixed (owner, 2026-11-09, decision 2): a connection's tools are found and called through
use_tool. A grant that is taken away refuses the call and leaves the search; one that comes back is
found again, and a revoked alias is never given to another connection."""

import pytest

from .test_run import rig  # noqa: F401
from .conftest import turn


@pytest.mark.parametrize("operation", ["disable", "tool_disable", "disconnect"])
async def test_background_model_keeps_its_list_while_every_call_is_checked_against_current_grants(rig, operation):
    server = await rig.plugins.connect(look="T1")
    rig.resnap()
    rig.client.replies = [turn("Before."), turn("After."), turn("Restored.")]
    await rig.chat()
    listed = rig.client.chat_calls[-1]["tools"]
    assert "Notes__look" not in {item["function"]["name"] for item in listed}
    assert (await rig.tool("use_tool", {"name": "Notes__look", "arguments": {"topic": "sample"}}))["ok"]
    hub = rig.plugins.hub
    if operation == "disable":
        await hub._set_enabled({"id": server, "enabled": False})
    elif operation == "tool_disable":
        await hub._set_tool_enabled({"id": server, "tool": "look", "enabled": False})
    else:
        await hub._disconnect({"id": server})
    stale = await rig.tool("use_tool", {"name": "Notes__look", "arguments": {"topic": "sample"}}, call_id="c2")
    assert not stale["ok"]
    await rig.chat()
    assert rig.client.chat_calls[-1]["tools"] == listed
    assert not rig.run.snapshot.find("look")[0]
    stale = await rig.tool("Notes__look", {"topic": "sample"}, call_id="c3")
    assert "no longer enabled or connected" in stale["content"]
    if operation == "disconnect":
        await rig.plugins.connect(look="T1")
    elif operation == "disable":
        await hub._set_enabled({"id": server, "enabled": True})
    else:
        await hub._set_tool_enabled({"id": server, "tool": "look", "enabled": True})
    reply = await rig.chat()
    assert "tools" not in reply and rig.client.chat_calls[-1]["tools"] == listed
    alias = next(item["function"]["name"] for item in rig.run.snapshot.find("look")[0] if item["function"]["name"].startswith("Notes__look"))
    if operation == "disconnect":
        assert alias != "Notes__look"
    assert (await rig.tool("use_tool", {"name": alias, "arguments": {"topic": "sample"}}, call_id="c4"))["ok"]

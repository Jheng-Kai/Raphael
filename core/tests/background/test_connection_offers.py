"""Running background work refreshes model offers and refuses cached aliases."""

import pytest

from .test_run import rig  # noqa: F401
from .conftest import turn


@pytest.mark.parametrize("operation", ["disable", "tool_disable", "disconnect"])
async def test_background_model_receives_current_grants_before_every_step(rig, operation):
    server = await rig.plugins.connect(look="T1")
    rig.resnap()
    rig.client.replies = [turn("Before."), turn("After."), turn("Restored.")]
    await rig.chat()
    before = {item["function"]["name"] for item in rig.client.chat_calls[-1]["tools"]}
    assert "Notes__look" in before
    hub = rig.plugins.hub
    if operation == "disable":
        await hub._set_enabled({"id": server, "enabled": False})
    elif operation == "tool_disable":
        await hub._set_tool_enabled({"id": server, "tool": "look", "enabled": False})
    else:
        await hub._disconnect({"id": server})
    stale = await rig.tool("Notes__look", {"topic": "sample"})
    assert not stale["ok"]
    assert "no longer enabled or connected" in stale["content"]
    await rig.chat()
    after = {item["function"]["name"] for item in rig.client.chat_calls[-1]["tools"]}
    assert "Notes__look" not in after
    assert not rig.run.snapshot.find("look")[0]
    stale = await rig.tool("Notes__look", {"topic": "sample"})
    assert "no longer enabled or connected" in stale["content"]
    if operation == "disconnect":
        await rig.plugins.connect(look="T1")
    elif operation == "disable":
        await hub._set_enabled({"id": server, "enabled": True})
    else:
        await hub._set_tool_enabled({"id": server, "tool": "look", "enabled": True})
    reply = await rig.chat()
    alias = next(alias for alias, ref in rig.run.snapshot.refs.items() if ref.server == "Notes" and ref.name == "look")
    if operation == "disconnect":
        assert alias != "Notes__look" and "Notes__look" not in rig.run.snapshot.refs
    assert alias in {item["function"]["name"] for item in rig.client.chat_calls[-1]["tools"]}
    assert alias in {item["function"]["name"] for item in reply["tools"]}
    assert (await rig.tool(alias, {"topic": "sample"}))["ok"]

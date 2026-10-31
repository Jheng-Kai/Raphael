"""API and CLI turns manage when through the existing shared routine tools."""

import pytest

from agent.test_narration import chat
from .test_answering import client, setup, member, typed, live_said  # noqa: F401
from .test_cli_brains import fake_mcp


@pytest.mark.parametrize("brain", ["api", "cli"])
async def test_event_create_list_update_leave_readable_events_in_the_members_conversation(setup, client, tmp_path, brain):
    rig, team = setup
    speaker = member(team, model="cli:claude" if brain == "cli" else "")
    team.members._connections = lambda: [{"id": "gmail", "name": "Gmail", "enabled": True}]
    when = {"app": "gmail", "event": {"tool": "mcp:gmail/messages", "arguments": {}, "items": "", "id": "id"},
            "filter": {"field": "sender", "equals": "client@example.com"}}
    args = {"title": "Client mail", "prompt": "Prepare a draft", "when": when}
    if brain == "api":
        client.chats = [chat("Setting up the requested filter.", ("routine_create", args)),
                       chat("Checking the saved routine.", ("routine_list", {})), live_said("Ready.")]
    else:
        fake_mcp(rig, tmp_path, [("routine_create", args), ("routine_list", {})])
    result = await typed(rig, "When client@example.com writes, prepare a draft", speaker.id)
    assert result["status"] == "done"
    if brain == "cli":
        assert result["text"] == "Finished."
    [routine] = team.members.store.routines(speaker.id)
    assert routine.when == when and routine.schedule is None
    [turn] = (await rig.call("agent.history.list", {"member_id": speaker.id}))["turns"]
    assert any(message["kind"] == "event" and "Gmail" in message["text"] and "client@example.com" in message["text"] for message in turn["messages"])
    changed = {**when, "filter": {"field": "sender", "equals": "owner@example.com"}}
    calls = [("routine_update", {"id": routine.id, "when": changed}), ("routine_list", {})]
    if brain == "api":
        client.chats = [chat("Updating the filter.", calls[0]), chat("Checking the filter.", calls[1]), live_said("Updated.")]
    else:
        (tmp_path / "update").mkdir()
        fake_mcp(rig, tmp_path / "update", calls)
    result = await typed(rig, "Change that sender to owner@example.com", speaker.id)
    assert result["status"] == "done"
    assert team.members.store.routine(routine.id).when == changed

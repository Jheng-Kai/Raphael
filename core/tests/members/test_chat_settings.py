"""Settings intent and self-administration through production conversation tools."""

import pytest

from agent.test_narration import chat, use
from .test_answering import client, setup, member, typed, live_said  # noqa: F401
from raphael_core.management import publish, self_action, self_definitions
from raphael_core.protocol import RpcError


@pytest.mark.parametrize("identifier", [0, 1])
async def test_settings_intent_is_next_to_owner_message(setup, client, identifier):
    rig, team = setup
    own = member(team)
    identifier = own.id if identifier else 0
    client.chats = [live_said("What would you like to change?")]
    result = await rig.call("agent.ask", {"session_id": "settings", "member_id": identifier,
        "text": "Change my settings", "source": "app", "ui_language": "en", "intent": "settings"})
    assert result["status"] == "done"
    user = client.chat_calls[0]["messages"][-1]["content"]
    assert "<question>\nChange my settings\n</question>" in user
    assert "The owner pressed Settings on your panel" in user
    assert "GitHub link or a skill link" in user and "權限" in user
    assert (await rig.turns(member_id=identifier))[0]["question"] == "Change my settings"


@pytest.mark.parametrize("action,fields", [
    ("member_update", {"personality": "Calm and exact."}),
    ("member_skill_update", {"id": 1, "enabled": False}),
    ("member_command_save", {"name": "draft", "template": "Draft {input}"}),
])
@pytest.mark.parametrize("other", [False, True])
async def test_nonprimary_can_change_itself_or_peers_in_the_owner_private_chat(setup, client, action, fields, other):
    rig, team = setup
    team.members.register(rig.rpc)
    own, peer = member(team), member(team, name="Peer")
    target = peer.id if other else own.id
    args = {("id" if action == "member_update" else "member_id"): target, **fields}
    writes = []
    from raphael_core.management import REGISTRY
    async def change(params):
        writes.append(params)
        return {"changed": True}
    if action == "member_update":
        # Keep authorization real; trap the persistence service after it.
        team.members._update = change
    else:
        rig.rpc._handlers[REGISTRY[action].rpc] = change
    rig.settings.set("action_mode", "direct")
    public, values = publish(action, args)
    client.chats = [chat("Find my tool", ("find_tools", {"query": public})),
                    chat("Make the requested change", use(public, values)), live_said("Changed.")]
    result = await typed(rig, "Change the requested member skills, commands or profile", own.id, language="en")
    assert result["status"] == "done"
    assert writes == [args]


@pytest.mark.parametrize("name,args", [
    ("member_update", {"id": 1, "model": "other"}),
    ("member_skill_delete", {"member_id": 1, "id": 1, "shared": True}),
    ("memory_document_update", {"member_id": 1, "text": "x", "revision": "r", "space": "shared"}),
    ("settings_update", {"key": "owner_name", "value": "v"}),
])
def test_self_scope_excludes_shared_models_and_global_settings(name, args):
    assert not self_action(1, name, args)


async def test_self_delete_needs_exact_yes_and_self_scope_classifier_stays_narrow(setup):
    rig, team = setup
    own = member(team)
    with pytest.raises(RpcError, match="owner's approval"):
        await team.members.admin_tool(own.id, "member_command_delete", {"member_id": own.id, "id": 1}, interactive=True)
    assert not self_action(0, "settings_update", {"key": "owner_name", "value": "v"})
    assert "settings_update" not in self_definitions(own.id) and "settings_update" not in self_definitions(0)


async def test_own_resources_are_persisted_by_existing_services(setup):
    from .test_skill_growth import DOCUMENT
    rig, team = setup
    team.members.register(rig.rpc)
    team.memory.register(rig.rpc)
    own = member(team)
    admin = team.members.admin_tool
    skill = team.members.capabilities.keep_skill(own.id, "fixture/repository", DOCUMENT)
    await admin(own.id, "member_skill_update", {"member_id": own.id, "id": skill["id"], "enabled": False}, interactive=True)
    assert not team.members.capabilities.skills(own.id)[0]["enabled"]
    await admin(own.id, "member_command_save", {"member_id": own.id, "name": "draft", "template": "Draft {input}"}, interactive=True)
    commands = await admin(own.id, "member_commands_list", {"member_id": own.id}, interactive=True)
    assert commands["commands"][0]["template"] == "Draft {input}"
    view = await admin(own.id, "memory_document_read", {"member_id": own.id}, interactive=True)
    await admin(own.id, "memory_document_update", {"member_id": own.id, "text": "The fixture workshop uses amber notebooks.", "revision": view["revision"]}, interactive=True)
    assert "amber notebooks" in team.memory.own(own.id).read()


async def test_nonprimary_self_delete_still_shows_yes_card_in_bypass_mode(setup, client):
    rig, team = setup
    team.members.register(rig.rpc)
    own = member(team)
    command = await team.members.admin_tool(own.id, "member_command_save", {"member_id": own.id, "name": "draft", "template": "Draft {input}"}, interactive=True)
    rig.settings.set("action_mode", "bypass")
    args = {"member_id": own.id, "id": command["command"]["id"]}
    client.chats = [chat("Find my tools", ("find_tools", {"query": "member_manage"})),
                    chat("Delete the command", use(*publish("member_command_delete", args))), live_said("Deleted.")]
    result = await typed(rig, "Delete your draft command", own.id, language="en")
    assert result["status"] == "confirm" and result["confirm"]["tier"] == "T3"
    assert len(team.members.capabilities.commands(own.id)) == 1
    await rig.confirm(result["confirm"]["id"])
    assert team.members.capabilities.commands(own.id) == []


async def test_raphael_can_change_own_picture_after_primary_moves(setup):
    import base64
    rig, team = setup
    team.members.register(rig.rpc)
    peer = member(team)
    team.members.store.set_primary(peer.id)
    image = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 16).decode()
    result = await team.members.admin_tool(0, "member_avatar", {"id": 0, "name": "fixture.png", "mime": "image/png", "data": image}, interactive=True)
    assert result["member"]["avatar_rev"] and "avatar_url" not in result["member"]
    assert (await team.members._picture_of({"id": 0, "kind": "avatar"}))["url"].startswith("data:image/png;base64,")
    assert team.members._raphael_picture()[1] == {"x": .5, "y": .5, "zoom": 1}


@pytest.mark.parametrize("other", [False, True])
async def test_cli_owner_private_management_uses_the_same_execution_boundary(setup, monkeypatch, other):
    from raphael_core.agent.cli.loop import CliLoop
    from raphael_core.worker.loop import Outcome
    rig, team = setup
    team.members.register(rig.rpc)
    own, peer = member(team, model="cli:codex:test"), member(team, name="Peer")
    rig.settings.set("action_mode", "direct")
    target = peer.id if other else own.id
    async def work(loop):
        found = await loop._tool("find", "find_tools", {"query": "member_command_save"})
        assert found.ok
        name, values = publish("member_command_save", {"member_id": target, "name": "draft", "template": "Draft {input}"})
        changed = await loop._tool("save", name, values)
        assert changed.ok
        loop._queue.put_nowait(Outcome("done", final="Finished."))
    monkeypatch.setattr(CliLoop, "_work", work)
    assert (await typed(rig, "Save the requested member draft command", own.id, language="en"))["status"] == "done"
    assert len(team.members.capabilities.commands(own.id)) == (0 if other else 1)
    assert len(team.members.capabilities.commands(peer.id)) == (1 if other else 0)

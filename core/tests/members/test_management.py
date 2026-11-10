"""Owner-private management is equal, while destructive writes await exact approval."""

import pytest

from agent.test_narration import chat, use
from .test_answering import client, setup, member, typed, live_said  # noqa: F401
from raphael_core.agent.harness_tools import definitions_for
from raphael_core.agent.policy import Action, Confirmations, NotApproved
from raphael_core.agent.gate import ToolGate
from raphael_core.management import ACTIONS, MANAGEMENT_TOOLS, REGISTRY, destructive, publish, resolve
from raphael_core.protocol import RpcError


@pytest.mark.parametrize("prompt", [
    "Connect Sample and look up a sample", "Enable sample and read",
    "Disable Sample", "Turn off Sample access", "Turn on Sample access",
    "Disconnect Sample", "Reconnect Sample", "Manage the MCP connection",
])
@pytest.mark.parametrize("primary", [0, 7])
def test_connection_management_is_found_by_every_owner_private_member(prompt, primary):
    from raphael_core.agent.speaker import Speaker
    from raphael_core.background.snapshot import take_snapshot

    for identifier in (0, 7):
        speaker = Speaker(id=identifier, capabilities=frozenset({"chief"}) if identifier == primary else frozenset())
        for interactive, owner_management in ((True, True), (True, False), (False, True)):
            snapshot = take_snapshot(None, speaker=speaker, interactive=interactive, owner_management=owner_management)
            allowed = interactive and owner_management
            # The list never follows the request (decision 2): the request's words only rank what find_tools returns.
            assert not {"manage_connection", "add_mcp_server"} & snapshot.listed()
            found = {item["function"]["name"] for item in snapshot.find(prompt)[0]}
            assert bool(found & set(snapshot.management)) == allowed
            assert ("manage_connection" in {item["function"]["name"] for item in snapshot.find("manage_connection")[0]}) == allowed
            assert (snapshot.reveal("manage_connection") is not None) == allowed


def test_default_primary_offer_stays_bounded_and_management_requires_discovery():
    from raphael_core.agent.speaker import Speaker
    from raphael_core.background.snapshot import take_snapshot

    speaker = Speaker(id=0, capabilities=frozenset({"chief"}))
    snapshot = take_snapshot(None, speaker=speaker, interactive=True, memory=True)
    assert len(snapshot.definitions) <= 49
    assert not MANAGEMENT_TOOLS & snapshot.refs.keys()
    assert {"find_tools", "use_tool"} <= snapshot.refs.keys()
    added, _ = snapshot.find("manage_connection")
    assert "manage_connection" in {item["function"]["name"] for item in added}
    assert snapshot.reveal("manage_connection") is not None and "manage_connection" not in snapshot.listed()


def sample(schema):
    if "enum" in schema:
        return schema["enum"][0]
    kind = schema.get("type")
    if kind == "integer":
        return max(1, schema.get("minimum", 1))
    if kind == "array":
        return []
    if kind == "boolean":
        return True
    if kind == "object":
        return {key: sample(schema["properties"][key]) for key in schema.get("required", [])}
    return "Sample"


DESTRUCTIVE = [item.name for item in ACTIONS if item.destructive] + ["manage_connection", "settings_update"]


@pytest.mark.parametrize("mode", ["ask", "plan", "direct", "bypass"])
@pytest.mark.parametrize("name", DESTRUCTIVE)
async def test_every_destructive_row_shows_a_card_and_waits_for_the_exact_yes(setup, client, mode, name):
    rig, team = setup
    team.members.register(rig.rpc)
    item = REGISTRY[name]
    args = sample(item.schema)
    if name == "manage_connection":
        args["operation"] = "disconnect"
    if name == "settings_update":
        args = {"key": "history_retention_days", "value": 1}
    rig.settings.set("action_mode", mode)
    writes = []

    async def perform(params):
        writes.append(params)
        return {"changed": True}

    async def connection(*_):
        return await perform(args)

    # Trap the existing service boundary; the production offer, loop, card,
    # gate and member authorization remain real. No external state is touched.
    rig.rpc._handlers[item.rpc] = perform
    rig.service._connection_tool = connection
    public_name, _ = publish(name, args)
    client.chats = [chat("Find the requested action.", ("find_tools", {"query": public_name})),
                    chat("Requested change.", use(*publish(name, args))), live_said("Finished.")]
    asked = await typed(rig, "Apply this requested change", 0, language="en")
    assert asked["status"] == "confirm", (name, asked)
    assert asked["confirm"]["tier"] == "T3"
    assert writes == []
    text = asked["confirm"]["text"]
    assert ("Affected target" in text and resolve(name, args)[0].description in text) if name != "member_delete" else "ID: " in text
    assert all(str(value) in text for value in args.values() if not isinstance(value, (list, dict, bool)))
    await rig.confirm(asked["confirm"]["id"])
    assert len(writes) == 1


async def test_owner_private_management_stays_equal_after_the_primary_contact_moves(setup):
    rig, team = setup
    team.members.register(rig.rpc)
    other = member(team)
    old = team.members.speaker(0)
    made = await team.members.admin_tool(other.id, "group_create", {"name": "Ordinary"}, interactive=True)
    assert made["group"]["name"] == "Ordinary"
    await rig.call("members.set_primary", {"id": other.id})
    for actor in (old.id, other.id):
        from raphael_core.management import DEFINITIONS
        assert DEFINITIONS.keys() <= dict(definitions_for(team.members.speaker(actor))).keys()
        result = await team.members.admin_tool(actor, "group_create", {"name": f"Folder {actor}"}, interactive=True)
        assert result["group"]["name"] == f"Folder {actor}"
        with pytest.raises(RpcError, match="interactive private chat"):
            await team.members.admin_tool(actor, "group_create", {"name": "Worker"})


@pytest.mark.parametrize("name", DESTRUCTIVE)
async def test_server_refuses_each_destructive_row_without_an_exact_consumed_gate_token(rig, name):
    item = REGISTRY[name]
    args = sample(item.schema)
    if name == "manage_connection":
        args["operation"] = "disconnect"
    if name == "settings_update":
        args = {"key": "history_retention_days", "value": 1}
    with pytest.raises(RpcError, match="owner's approval"):
        await rig.service.admin_tool(0, name, args, interactive=True)


@pytest.mark.parametrize("name", DESTRUCTIVE)
def test_destructive_management_cannot_be_waived_by_allow_all_or_a_narrow_always_rule(rig, name):
    from types import SimpleNamespace
    from raphael_core.brain.settings import SettingsStore

    SettingsStore(rig.conn).set("action_mode", "bypass")
    safety = SimpleNamespace(rules=SimpleNamespace(always_allows=lambda _: True))
    gate = ToolGate(conn=rig.conn, safety=safety)
    args = sample(REGISTRY[name].schema)
    if name == "manage_connection":
        args["operation"] = "disconnect"
    if name == "settings_update":
        args = {"key": "history_retention_days", "value": 1}
    action = Action(name, args)
    assert gate.tier_now(name, args).name == "T3" and not gate.waived(action)
    with pytest.raises(NotApproved):
        gate.check(action, None)


def test_retention_uses_the_real_forever_and_immediate_delete_semantics():
    assert destructive("settings_update", {"key": "history_retention_days", "value": 0}, 30)
    assert destructive("settings_update", {"key": "history_retention_days", "value": 30}, -1)
    assert not destructive("settings_update", {"key": "history_retention_days", "value": -1}, 30)
    assert not destructive("settings_update", {"key": "history_retention_days", "value": 60}, 30)


async def test_management_uses_the_same_profile_folder_and_command_services(rig):
    greetings = []
    rig.service.greeting = lambda identifier, language: greetings.append((identifier, language))
    async def run(tool_name, **args):
        return await rig.service.admin_tool(0, tool_name, args, interactive=True)
    group = (await run("group_create", name="Team"))["group"]
    await run("group_update", id=group["id"], position=2, sources=[{"kind": "github", "ref": "owner/repo"}])
    person = (await run("member_create", name="Writer", role="Write", group_id=group["id"]))["member"]
    assert greetings == [(person["id"], rig.language)]
    updated = (await run("member_update", id=person["id"], reply_style="conversational", pinned=True, hidden=True,
                         notify=True, draft_first=False, ask_before_members=True, effort="high"))["member"]
    assert updated["reply_style"] == "conversational" and updated["hidden"] and updated["notify"]
    assert updated["model"].endswith("?effort=high")
    await run("member_command_save", member_id=person["id"], name="review", template="Review {input}")
    assert (await rig.call("members.commands.list", {"member_id": person["id"]}))["commands"]


async def test_registry_routes_rooms_conversations_skills_dictionary_and_settings_to_real_app_services(tmp_path):
    from raphael_core.app import App

    app = App(data_dir=tmp_path, fake_llm=True)
    async def run(tool_name, **args):
        approval = None
        if destructive(tool_name, args, app.members._settings.get("history_retention_days")):
            action = Action(tool_name, args)
            confirmations = Confirmations()
            pending = confirmations.open("test", 1, action, app.gate.tier(tool_name, args), "en")
            approval = confirmations.resolve(pending.id, True, pending.digest).approval
            app.gate.check(action, approval)
        return await app.members.admin_tool(0, tool_name, args, interactive=True, approval=approval)
    try:
        person = (await run("member_create", name="Writer", role="Write"))["member"]
        other = (await run("member_create", name="Reader", role="Read"))["member"]
        folder = (await run("group_create", name="Reports"))["group"]
        room = (await run("room_create", name="Review", member_ids=[0, person["id"], other["id"]],
                          group_id=folder["id"], default_responder="member:" + str(person["id"])))["room"]
        assert room["group_id"] == folder["id"]
        assert app._conn.execute("SELECT COUNT(*) FROM room_messages WHERE room_id=?", (room["id"],)).fetchone()[0] == 0
        await run("room_update", room_id=room["id"], name="Edited review", pinned=True, hidden=True,
                  roles={str(person["id"]): "moderator"})
        card = app.members.admin_confirmation("room_members", {"room_id": room["id"], "member_ids": [0, person["id"]]}, "en")
        assert "Edited review" in card and "Reader" in card
        room = (await run("room_members", room_id=room["id"], member_ids=[0, person["id"]]))["room"]
        assert other["id"] not in room["member_ids"]
        conversation = (await run("conversation_list", member_id=person["id"]))["conversations"][0]
        await run("conversation_clear", id=conversation["id"])
        assert [item["id"] for item in (await app.call("conversations.list", {"member_id": person["id"]}))["conversations"]] == [conversation["id"]]
        skill = app.members.capabilities.keep_skill(person["id"], "local-test", "---\nname: review\ndescription: Read reports\n---\nRead carefully.")
        await run("member_skill_update", member_id=person["id"], id=skill["id"], text="---\nname: review\ndescription: Read reports\n---\nCheck evidence.", expected_hash=skill["revision"], enabled=False)
        assert not app.members.capabilities.skills(person["id"])[0]["enabled"]
        assert "review" in app.members.admin_confirmation("member_skill_delete", {"member_id": person["id"], "id": skill["id"]}, "en")
        await run("member_skill_delete", member_id=person["id"], id=skill["id"])
        assert not app.members.capabilities.skills(person["id"])
        await run("dictionary_add", word="Raphael")
        word = (await run("dictionary_list"))["entries"][0]
        assert "Raphael" in app.members.admin_confirmation("dictionary_delete", {"id": word["id"]}, "en")
        await run("dictionary_delete", id=word["id"])
        await run("settings_update", key="agent_city", value="Taipei")
        assert app.members._settings.get("agent_city") == "Taipei"
        await run("room_delete", room_id=room["id"])
    finally:
        await app.aclose()


def test_model_changes_require_an_explicit_owner_request():
    from raphael_core.agent.service import AgentService
    assert AgentService._owner_requested_model("Switch the quick model to cli:codex")
    assert AgentService._owner_requested_model("把模型換成 cli:codex")
    assert not AgentService._owner_requested_model("The model failed; try the task again")
    assert not AgentService._owner_requested_model("Finish my report")


@pytest.mark.parametrize("brain", ["api", "cli"])
@pytest.mark.parametrize("requested", [False, True])
async def test_production_model_change_requires_the_owners_request(setup, client, monkeypatch, brain, requested):
    import json
    from raphael_core.agent.cli.loop import CliLoop
    from raphael_core.worker.loop import Outcome

    rig, team = setup
    team.members.register(rig.rpc)
    rig.settings.set("action_mode", "bypass")
    async def save(params):
        rig.settings.set(params["key"], params["value"])
        return {"settings": rig.settings.all()}
    rig.rpc._handlers["settings.set"] = save
    args = {"key": "quick_effort", "value": "high"}
    if brain == "cli":
        rig.settings.set("agent_model", "cli:codex:test")
        async def work(loop):
            result = await loop._tool("change", "settings_update", args)
            assert result.ok == requested
            loop._queue.put_nowait(Outcome("done", final=json.dumps({"prefix": "Answer", "text": "Finished.", "detail": ""})))
        monkeypatch.setattr(CliLoop, "_work", work)
    else:
        client.chats = [chat("Change effort.", use("settings_update", args)), live_said("Finished.")]
    text = "Set the quick model reasoning effort to high" if requested else "The model failed; finish my report"
    assert (await typed(rig, text, 0, language="en"))["status"] == "done"
    assert rig.settings.get("quick_effort") == ("high" if requested else "low")


@pytest.mark.parametrize("tool,args", [("settings_read", {}), ("settings_update", {"key": "owner_name", "value": "Owner"})])
async def test_management_settings_responses_exclude_internal_and_owner_only_state(rig, tool, args):
    async def settings(_):
        return {"settings": {"owner_name": "Owner", "chatgpt.registrations.v1": {"internal": "private"},
                             "action_mode": "bypass", "computer_ssh_alias": "private-device"}}
    rig.rpc._handlers[REGISTRY[tool].rpc] = settings
    assert await rig.service.admin_tool(0, tool, args, interactive=True) == {"settings": {"owner_name": "Owner"}}


async def test_server_approval_cannot_be_reused_or_redirected(rig):
    group = (await rig.call("groups.create", {"name": "Keep until approved"}))["group"]
    gate = ToolGate(conn=rig.conn)
    action = Action("group_delete", {"id": group["id"]})
    confirmations = Confirmations()
    pending = confirmations.open("test", 1, action, gate.tier(action.tool, action.args), "en")
    approval = confirmations.resolve(pending.id, True, pending.digest).approval
    with pytest.raises(RpcError, match="owner's approval"):
        await rig.service.admin_tool(0, action.tool, action.args, interactive=True, approval=approval)
    gate.check(action, approval)
    with pytest.raises(RpcError, match="owner's approval"):
        await rig.service.admin_tool(0, action.tool, {"id": group["id"] + 1}, interactive=True, approval=approval)
    assert (await rig.service.admin_tool(0, action.tool, action.args, interactive=True, approval=approval))["deleted"]
    with pytest.raises(RpcError, match="already been used"):
        await rig.service.admin_tool(0, action.tool, action.args, interactive=True, approval=approval)


@pytest.mark.parametrize("tool", ["member_history_clear", "conversation_clear"])
async def test_deleting_the_requesting_chat_finishes_without_cancelling_itself(setup, client, tool):
    rig, team = setup
    team.members.register(rig.rpc)
    args = {"member_id": 0} if tool == "member_history_clear" else {"id": rig.service.conversations.main(0)}
    client.chats = [chat("Removing the records.", use(*publish(tool, args))), live_said("Records removed.")]
    asked = await typed(rig, "Remove this conversation's records", 0, language="en")
    assert asked["status"] == "confirm"
    import asyncio
    done = await asyncio.wait_for(rig.confirm(asked["confirm"]["id"]), 5)
    assert done["status"] == "done" and done["text"] == "Records removed."
    turns = await rig.turns()
    assert len(turns) == 1 and turns[0]["status"] == "done"


async def test_primary_can_approve_its_own_deletion_and_leave_a_receipt_with_the_surviving_primary(setup, client):
    rig, team = setup
    team.members.register(rig.rpc)
    primary = member(team, name="Coordinator")
    team.members.store.set_primary(primary.id)
    rig.settings.set("action_mode", "bypass")
    client.chats = [chat("Delete this member.", use("member_delete", {"id": primary.id})), live_said("Deleted.")]
    asked = await typed(rig, "Delete Coordinator", primary.id, language="en")
    assert asked["status"] == "confirm" and "Coordinator" in asked["confirm"]["text"]
    done = await rig.confirm(asked["confirm"]["id"])
    assert done["status"] == "done" and done["text"] == "Deleted."
    assert not team.members.member_exists(primary.id)
    assert team.members.primary_id() == 0
    assert (await rig.turns(member_id=0))[0]["text"] == "Deleted."



@pytest.mark.parametrize("key,value", [("action_mode", "bypass"), ("owner_name", True), ("agent_city", {"key": "action_mode", "value": "bypass"})])
async def test_settings_tool_rejects_owner_only_keys_wrong_types_and_nested_escape_hatches(rig, key, value):
    with pytest.raises(RpcError):
        await rig.service.admin_tool(0, "settings_update", {"key": key, "value": value}, interactive=True)


@pytest.mark.parametrize("tool,args", [
    ("member_manage", {"action": "settings_update", "arguments": {"key": "action_mode", "value": "bypass"}}),
    ("room_manage", {"action": "member_delete", "arguments": {"id": 1}}),
    ("dictionary_manage", {"action": "dictionary_add", "arguments": {"word": "Review", "rpc": "secrets.clear_openrouter_key"}}),
])
async def test_area_tools_cannot_select_another_area_or_forward_unknown_fields(rig, tool, args):
    with pytest.raises(RpcError):
        await rig.service.admin_tool(0, tool, args, interactive=True)

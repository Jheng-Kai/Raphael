"""Both interactive brain adapters enforce the live owner-selected connections."""

from types import SimpleNamespace

import pytest

from raphael_core.agent.plugins import PlannedCall, PluginTool
from raphael_core.agent.policy import Tier
from raphael_core.agent.speaker import Speaker
from .test_answering import client, setup, typed, live_said  # noqa: F401


@pytest.mark.parametrize("tools", [["gmail"], None])
async def test_api_dispatch_rechecks_live_member_connections(setup, client, tools):
    rig, team = setup
    member = team.members.store.create_member(name="Writer", role="Write", tools=tools)
    from agent.test_gate import FakeHub
    from raphael_core.agent.gate import ToolGate
    hub = FakeHub(update_page="T1")
    hub.tiers = {"mcp:notion/update_page": Tier.T1}
    rig.service._gate = ToolGate(hub, conn=rig.conn)
    tool = PluginTool("mcp:notion/update_page", "Notion", "update_page", "Update a page", {}, Tier.T1)
    result = await rig.service._plugin_call(PlannedCall(tool, {}), None, steps=[],
                                          ask=SimpleNamespace(speaker=Speaker(id=member.id), page_call=False))
    if tools is not None:
        assert result.error == "tool_disabled" and "owner disabled" in result.instruction
        assert not hub.calls
    else:
        assert result.ok and len(hub.calls) == 1


@pytest.mark.parametrize("brain", ["api", "cli"])
async def test_actual_brain_offers_filter_connections_without_removing_harness(setup, client, monkeypatch, brain):
    from raphael_core.agent.cli.loop import CliLoop
    from raphael_core.worker.loop import Outcome
    rig, team = setup
    member = team.members.store.create_member(name="Writer", role="Write", tools=["gmail"])
    tools = [PluginTool(f"mcp:{name}/read", name.title(), "read", "Read", {}, Tier.T0)
             for name in ("gmail", "notion")]
    rig.service._plugins = SimpleNamespace(offered=lambda: tools)
    captured, found = [], []
    if brain == "cli":
        rig.settings.set("agent_model", "cli:codex:test")
        async def work(loop):
            captured.extend(loop.tools)
            found.append((await loop._tool("find", "find_tools", {"query": "read"})).content)
            loop._queue.put_nowait(Outcome("done", final='{"text":"Done"}'))
        monkeypatch.setattr(CliLoop, "_work", work)
    else:
        from agent.test_narration import chat

        def answer(**kwargs):
            found.append(kwargs["messages"][-1]["content"])
            return live_said("Done")
        client.chats += [chat("Finding it.", ("find_tools", {"query": "read"})), answer]
    await typed(rig, "Read my mail", member.id)
    if brain == "api":
        captured = client.chat_calls[0]["tools"]
    names = {item["function"]["name"] for item in captured}
    # A connection's tools are found, not listed (decision 2); the member's allowlist filters what is found.
    assert not {"Gmail__read", "Notion__read"} & names
    assert {"weather", "find_tools", "use_tool", "ask_owner"} <= names
    assert "Gmail__read" in found[0] and "Notion__read" not in found[0]


async def test_native_cli_read_still_opens_a_card_in_allow_all(setup, client, monkeypatch):
    from raphael_core.worker.loop import Stop
    rig, team = setup
    rig.settings.set("action_mode", "bypass")
    ask = SimpleNamespace(source="app", nested=False, declined=False, language="en")
    loop = SimpleNamespace(response=None)
    cards = []
    followup = SimpleNamespace(loop=None)
    def card(ask, call, results, ledger, screening):
        cards.append(call)
        rig.service._followups["synthetic"] = followup
        return {"confirm": {"id": "synthetic"}}
    monkeypatch.setattr(rig.service, "_ask_plugin", card)
    denied = await rig.service._cli_permission(ask, {"command": "del C:/data/raphael.db"}, None, loop)
    assert not denied.ok and denied.kind == "protected_data" and not cards
    with pytest.raises(Stop):
        await rig.service._cli_permission(ask, {"command": "Get-Content C:/data/raphael.db"}, None, loop)
    assert len(cards) == 1 and followup.loop is loop
    rig.settings.set("action_mode", "direct")
    monkeypatch.setattr(rig.service._gate, "waived", lambda action: True)
    assert (await rig.service._cli_permission(ask, {"command": "Get-Process"}, None, loop)).ok
    with pytest.raises(Stop):
        await rig.service._cli_permission(ask, {"command": "Get-Content C:/data/raphael.db"}, None, loop)
    assert len(cards) == 2


@pytest.mark.parametrize("mode", ["ask", "plan", "direct", "bypass"])
async def test_owner_approval_is_required_to_change_a_member_connection_list_in_every_mode(setup, client, mode):
    from agent.test_narration import chat, use
    rig, team = setup
    team.members.register(rig.rpc)
    member = team.members.store.create_member(name="Writer", role="Write", tools=["gmail"])
    rig.settings.set("action_mode", mode)
    client.chats = [chat("", use("member_update", {"id": member.id, "tools": ["gmail", "notion"]})), live_said("Updated.")]
    result = await typed(rig, "Change the Writer member tools", 0, language="en")
    assert result["status"] == "confirm" and result["confirm"]["tier"] == "T3"
    assert team.members.store.member(member.id).tools == ("gmail",)
    await rig.confirm(result["confirm"]["id"])
    assert team.members.store.member(member.id).tools == ("gmail", "notion")


async def test_real_background_management_callback_accepts_an_approved_nonprimary_actor(setup):
    from raphael_core.agent.history import AgentHistory
    from raphael_core.agent.policy import Action, Confirmations, Tier
    rig, team = setup
    team.members.register(rig.rpc)
    actor = team.members.store.create_member(name="Reviewer", role="Review")
    target = team.members.store.create_member(name="Writer", role="Write")
    rig.settings.set("action_mode", "bypass")
    origin = AgentHistory(rig.conn).add(session_id="background", question="", route="worker", source="worker",
                                       member_id=actor.id, prefix="", text="", status="running")
    task = SimpleNamespace(member_id=actor.id, turn_id=origin, session_id="background", text="Update Writer personality",
                           language="en", scope="private", room_id=None)
    args = {"id": target.id, "personality": "Calm and precise"}
    result = await rig.service.background_owner_tool(task, "member_update", args)
    assert not result.ok and team.members.store.member(target.id).personality == ""
    action = Action("member_update", args)
    questions = Confirmations()
    pending = questions.open("background", origin, action, Tier.T3, "en")
    yes = questions.resolve(pending.id, True).approval
    result = await rig.service.background_owner_tool(task, "member_update", args, action=action, approval=yes)
    assert result.ok and yes.spent
    assert team.members.store.member(target.id).personality == args["personality"]

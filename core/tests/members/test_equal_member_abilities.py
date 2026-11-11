"""Owner-private abilities do not depend on the primary contact; colleague requests stay bounded."""

import pytest

from agent.test_narration import chat, use
from raphael_core.agent.cli.loop import CliLoop
from raphael_core.agent.history import AgentHistory
from raphael_core.agent.speaker import RAPHAEL
from raphael_core.agent.team import team_tools_for
from raphael_core.background.snapshot import take_snapshot
from raphael_core.management import MANAGEMENT_TOOLS
from raphael_core.worker.loop import Outcome
from .test_answering import client, setup, typed, live_said  # noqa: F401


@pytest.mark.parametrize("brain", ["api", "cli"])
async def test_template_createagent_creates_members_and_same_events_for_both_contacts(setup, client, monkeypatch, brain):
    rig, team = setup
    team.members.register(rig.rpc)
    actor = team.members.store.create_member(name="Template member", role="Writer",
        instructions="Use template CreateAgent to create bots when the owner asks.")
    rig.settings.set("action_mode", "direct")
    events = []
    for member_id in (0, actor.id):
        arguments = {"name": f"Helper {member_id}", "role": "Research"}
        seen = []
        if brain == "api":
            def find(**kwargs):
                system = kwargs["messages"][0]["content"]
                seen.append(system)
                assert "CreateAgent instructions map to member_create" in system
                return chat("", ("find_tools", {"query": "CreateAgent"}))
            def create(**kwargs):
                names = {tool["function"]["name"] for tool in kwargs["tools"]}
                assert "member_create" not in names and '"name": "member_create"' in kwargs["messages"][-1]["content"]
                return chat("", use("member_create", arguments))
            client.chats = [find, create, live_said("The helper is ready.")]
        else:
            rig.settings.set("agent_model", "cli:codex:test")
            async def work(loop):
                seen.append(loop.system)
                assert "CreateAgent instructions map to member_create" in loop.system
                found = await loop._tool("find", "find_tools", {"query": "CreateAgent"})
                assert found.ok and '"name": "member_create"' in found.content
                assert "member_create" not in {tool["function"]["name"] for tool in loop.tools}
                assert (await loop._tool("create", "use_tool", {"name": "member_create", "arguments": arguments})).ok
                loop._queue.put_nowait(Outcome("done", final="The helper is ready."))
            monkeypatch.setattr(CliLoop, "_work", work)
        result = await typed(rig, "Create the helper described in your template.", member_id, language="en")
        assert result["status"] == "done" and seen
        child = team.members.find(arguments["name"])
        assert child is not None and child.role == "Research"
        messages = AgentHistory(rig.conn).messages([result["turn_id"]])[result["turn_id"]]
        receipts = [item["text"] for item in messages if item["kind"] == "event"
                    and "Created" in item["text"] and child.name in item["text"]]
        assert len(receipts) == 1, messages
        events.append(receipts[0].replace(arguments["name"], "Helper"))
    assert events[0] == events[1]


@pytest.mark.parametrize("brain", ["api", "cli"])
@pytest.mark.parametrize("mode", ["ask", "plan", "direct", "bypass"])
@pytest.mark.parametrize("approved", [False, True])
async def test_nonprimary_delete_waits_for_exact_owner_yes(setup, client, monkeypatch, brain, mode, approved):
    rig, team = setup
    team.members.register(rig.rpc)
    actor = team.members.store.create_member(name="Coordinator", role="Coordinate")
    target = team.members.store.create_member(name="Remove me", role="Review")
    rig.settings.set("action_mode", mode)
    args = {"id": target.id}
    if brain == "api":
        client.chats = [chat("", use("member_delete", args)), live_said("Deletion settled.")]
    else:
        rig.settings.set("agent_model", "cli:codex:test")
        async def work(loop):
            await loop._tool("delete", "member_delete", args)
            loop._queue.put_nowait(Outcome("done", final="Deletion settled."))
        monkeypatch.setattr(CliLoop, "_work", work)
    result = await typed(rig, "Delete the member Remove me", actor.id, language="en")
    assert result["status"] == "confirm" and result["confirm"]["tier"] == "T3"
    assert team.members.store.member(target.id) is not None
    await rig.confirm(result["confirm"]["id"], approved)
    assert (team.members.store.member(target.id) is None) == approved


async def test_colleague_exchange_has_no_management_catalog_and_cannot_create_even_with_owner_flag(setup):
    rig, team = setup
    actor = team.members.store.create_member(name="Writer", role="Write")
    asked = team.members.speaker(actor.id).asked_by(RAPHAEL)
    tools = team_tools_for(team, asked, always=True)
    snapshot = take_snapshot(None, speaker=asked, team=tools, interactive=True, owner_management=False)
    assert not snapshot.management and not snapshot.refs.keys() & MANAGEMENT_TOOLS
    assert not snapshot.find("CreateAgent")[0]
    result = await rig.service.team_tool(asked, "create_member", {"name": "Forbidden", "role": "Write"},
        language="en", ledger=None, session_id="exchange", owner_interactive=True)
    assert not result.ok and team.members.find("Forbidden") is None


@pytest.mark.parametrize("mode", ["ask", "plan", "direct", "bypass"])
async def test_legacy_creation_alias_keeps_permission_changes_behind_exact_yes(setup, mode):
    from raphael_core.agent.policy import Action, Confirmations, Tier
    rig, team = setup
    actor = team.members.store.create_member(name="Coordinator", role="Coordinate")
    rig.settings.set("action_mode", mode)
    args = {"name": "Limited helper", "role": "Research", "tools": ["gmail"]}
    speaker = team.members.speaker(actor.id)
    action = Action("create_member", args)
    denied = await rig.service.team_tool(speaker, "create_member", args, language="en", ledger=None,
                                       session_id="legacy", owner_interactive=True)
    assert not denied.ok and team.members.find(args["name"]) is None
    confirmations = Confirmations()
    pending = confirmations.open("legacy", 1, action, Tier.T3, "en")
    yes = confirmations.resolve(pending.id, True).approval
    result = await rig.service.team_tool(speaker, "create_member", args, language="en", ledger=None,
        session_id="legacy", owner_interactive=True, action=action, approval=yes)
    assert result.ok and yes.spent
    child = team.members.store.by_name(args["name"])
    assert child is not None and child.tools == ("gmail",)
    replay = await rig.service.team_tool(speaker, "create_member", args, language="en", ledger=None,
        session_id="legacy", owner_interactive=True, action=action, approval=yes)
    assert not replay.ok


@pytest.mark.parametrize("brain", ["api", "cli"])
async def test_nonprimary_can_start_a_meeting_from_the_owner_private_chat(setup, client, monkeypatch, brain):
    from raphael_core.members.rooms import RoomsService
    rig, team = setup
    actor = team.members.store.create_member(name="Coordinator", role="Coordinate")
    reviewer = team.members.store.create_member(name="Reviewer", role="Review")
    rooms = RoomsService(rig.conn, members=team.members, background=team.background, now_ms=rig.wall)
    team.members.rooms = rooms
    rig.settings.set("action_mode", "direct")
    args = {"name": "Review", "member_ids": [0, actor.id, reviewer.id], "agenda": "Review the release"}
    if brain == "api":
        client.chats = [chat("", ("room_meeting", args)), live_said("The discussion is open.")]
    else:
        rig.settings.set("agent_model", "cli:codex:test")
        async def work(loop):
            assert (await loop._tool("meet", "room_meeting", args)).ok
            loop._queue.put_nowait(Outcome("done", final="The discussion is open."))
        monkeypatch.setattr(CliLoop, "_work", work)
    result = await typed(rig, "Start a meeting to review the release", actor.id, language="en")
    assert result["status"] == "done"
    room = rig.conn.execute("SELECT id FROM rooms WHERE name='Review'").fetchone()
    assert room is not None
    assert {row[0] for row in rig.conn.execute("SELECT member_id FROM room_members WHERE room_id=?", (room[0],))} == set(args["member_ids"])
    source = rig.conn.execute("SELECT member_id,text FROM room_messages WHERE room_id=? ORDER BY id LIMIT 1", (room[0],)).fetchone()
    assert tuple(source) == (actor.id, args["agenda"])

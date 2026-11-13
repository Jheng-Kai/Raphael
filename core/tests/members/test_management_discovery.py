"""Owner-private management is found with find_tools and called with use_tool; it is never listed.

The list stays the same whatever the owner asks (owner, 2026-11-09, decision 2): the request's words
choose what find_tools returns, never what the model is listed."""

import json

import httpx
import pytest

from agent.test_narration import chat
from raphael_core.agent.cli.loop import CliLoop
from raphael_core.agent.cli.discovery import CliBrains
from raphael_core.agent.cli.drivers import Driver, Event
from raphael_core.agent.policy import Tier
from raphael_core.agent.speaker import Speaker
from raphael_core.agent.team import TEAM_TOOLS
from raphael_core.background.snapshot import BUILTIN, FIND_MAX, take_snapshot
from raphael_core.management import DEFINITIONS, MANAGEMENT_TOOLS, tools_for_request
from raphael_core.worker.loop import Outcome
from .test_answering import client, setup, typed, live_said  # noqa: F401


def snapshot(**kwargs):
    return take_snapshot(None, speaker=Speaker(capabilities=frozenset({"chief"})),
                         team=TEAM_TOOLS, memory=True, interactive=True, max_tier=Tier.T3, **kwargs)


def found_names(offered, query):
    return [item["function"]["name"] for item in offered.find(query)[0]]


def test_default_primary_offer_fits_the_measured_pre_unit_budget():
    # feat/members at 5933b60f: 60 native tools with the same widest fixture; 53 before the fixed list.
    offered = snapshot()
    assert len(offered.definitions) == 43  # 44 before `open` became a quick question's alone (R-PC-01)
    assert not set(offered.refs) & MANAGEMENT_TOOLS
    assert set(offered.management) == set(DEFINITIONS)
    assert {"find_tools", "use_tool"} <= set(offered.refs)


@pytest.mark.parametrize("primary", [False, True])
@pytest.mark.parametrize("interactive", [False, True])
def test_shared_slack_discovery_never_grants_owner_management(primary, interactive):
    speaker = Speaker(id=2, capabilities=frozenset({"chief"}) if primary else frozenset())
    offered = take_snapshot(None, speaker=speaker, interactive=interactive)
    assert "slack_draft" not in offered.refs and "slack_draft" in offered.work
    assert found_names(offered, "slack_draft") == ["slack_draft"]
    assert "slack_draft" not in offered.refs, "finding a tool does not list it"
    assert offered.reveal("slack_draft").kind == BUILTIN
    assert not offered.listed() & {"slack_draft"}
    assert not offered.refs.keys() & MANAGEMENT_TOOLS
    assert bool(offered.management) == interactive
    assert ("manage_connection" in offered.management) == interactive


@pytest.mark.parametrize("brain", ["api", "cli"])
@pytest.mark.parametrize("primary", [False, True])
async def test_production_turn_discovers_shared_work_without_management(setup, client, monkeypatch, brain, primary):
    rig, team = setup
    writer = team.members.store.create_member(name="Writer", role="Writer", model="")
    member_id = 0 if primary else writer.id
    if brain == "api":
        def discover(**kwargs):
            assert "slack_draft" not in {item["function"]["name"] for item in kwargs["tools"]}
            return chat("Find the work tool.", ("find_tools", {"query": "slack_draft"}))
        def ready(**kwargs):
            names = {item["function"]["name"] for item in kwargs["tools"]}
            assert "slack_draft" not in names and not names & MANAGEMENT_TOOLS
            assert '"name": "slack_draft"' in kwargs["messages"][-1]["content"]
            return live_said("Ready.")
        client.chats = [discover, ready]
    else:
        rig.settings.set("agent_model", "cli:codex:test")
        async def work(loop):
            before = [item["function"]["name"] for item in loop.tools]
            assert "slack_draft" not in before
            found = await loop._tool("find", "find_tools", {"query": "slack_draft"})
            assert found.ok and '"name": "slack_draft"' in found.content
            assert [item["function"]["name"] for item in loop.tools] == before and not loop.catalog_changed
            loop._queue.put_nowait(Outcome("done", final="Ready."))
        monkeypatch.setattr(CliLoop, "_work", work)
    assert (await typed(rig, "Explain your abilities.", member_id, language="en"))["status"] == "done"


@pytest.mark.parametrize("name", DEFINITIONS)
def test_every_management_tool_can_be_discovered_by_name_without_plugins(name):
    offered = snapshot()
    before = json.dumps(offered.definitions)
    added, lines = offered.find(name)
    assert [item["function"]["name"] for item in added] == [name]
    assert len(added) <= FIND_MAX and lines
    assert offered.reveal(name).kind == BUILTIN
    assert json.dumps(offered.definitions) == before, "finding or calling a tool never lists it"


@pytest.mark.parametrize("question,expected,absent", [
    ("Delete the folder Reports", "group_delete", "room_manage"),
    ("Rename the group chat Review", "room_manage", "group_delete"),
    ("Change Writer's model", "member_update", "group_delete"),
    ("刪除資料夾", "group_delete", "room_manage"),
    ("重新命名群聊", "room_manage", "group_delete"),
    ("更換模型", "member_update", "group_delete"),
])
def test_the_owners_words_choose_what_find_tools_returns_never_the_list(question, expected, absent):
    offered = snapshot()
    names = found_names(offered, question)
    assert expected in names and absent not in names
    assert not offered.listed() & MANAGEMENT_TOOLS


def test_management_cannot_be_discovered_outside_the_owner_private_chat():
    for offered in (snapshot(owner_management=False),
                    take_snapshot(None, speaker=Speaker(capabilities=frozenset({"chief"})))):
        assert not offered.management
        assert not set(offered.refs) & MANAGEMENT_TOOLS
        assert not offered.find("group_delete")[0]
        assert offered.reveal("group_delete") is None


@pytest.mark.parametrize("brain,budget", [("api", 16048), ("cli", 15212)])
async def test_default_production_prompt_stays_below_the_measured_pre_unit_budget(setup, client, monkeypatch, brain, budget):
    from raphael_core.memory.terms import estimate_tokens

    rig, team = setup
    team.members.store.create_member(name="Writer", role="Writer", model="")
    captured = []
    if brain == "cli":
        rig.settings.set("agent_model", "cli:codex:test")
        async def work(loop):
            captured.append((loop.system, loop.tools))
            loop._queue.put_nowait(Outcome("done", final="Ready."))
        monkeypatch.setattr(CliLoop, "_work", work)
    else:
        client.chats = [live_said("Ready.")]
    assert (await typed(rig, "Explain your abilities.", 0, language="en"))["status"] == "done"
    if brain == "api":
        call = client.chat_calls[0]
        captured.append((call["messages"][0]["content"], call["tools"]))
    system, tools = captured[0]
    # feat/members has 58 for this same production fixture; 51 before the fixed list.
    assert len(tools) == 42
    assert estimate_tokens(system + json.dumps(tools, ensure_ascii=False, separators=(",", ":"))) <= budget


@pytest.mark.parametrize("brain", ["api", "cli"])
@pytest.mark.parametrize("change", ["folder", "room", "model"])
async def test_owner_request_is_carried_out_by_use_tool_with_the_list_unchanged(setup, client, tmp_path, monkeypatch, brain, change):
    rig, team = setup
    team.members.register(rig.rpc)
    rig.settings.set("action_mode", "bypass")
    writer = team.members.store.create_member(name="Writer", role="Write", model="")
    folder = (await rig.call("groups.create", {"name": "Reports"}))["group"]
    if change == "folder":
        text, name, args = "Delete the folder Reports", "group_delete", {"id": folder["id"]}
        check = lambda: team.members.store.group(folder["id"]) is None
    elif change == "room":
        # The production room service and schema are shared with the UI.
        from raphael_core.members.rooms import RoomsService
        rooms = RoomsService(rig.conn, members=team.members, background=rig.service._background,
                             now_ms=rig.wall)
        rooms.register(rig.rpc)
        room = (await rig.call("rooms.create", {"name": "Review", "member_ids": [0, writer.id]}))["room"]
        text, name = "Rename the group chat Review to Planning", "room_manage"
        args = {"action": "room_update", "arguments": {"room_id": room["id"], "name": "Planning"}}
        check = lambda: rig.conn.execute("SELECT name FROM rooms WHERE id=?", (room["id"],)).fetchone()[0] == "Planning"
    else:
        text, name, args = "Change Writer's model to fake/other", "member_update", {"id": writer.id, "model": "fake/other"}
        check = lambda: team.members.store.member(writer.id).model == "fake/other"
    offered = []
    if brain == "api":
        def choose(**kwargs):
            names = {item["function"]["name"] for item in kwargs["tools"]}
            offered.append(names)
            assert name not in names and "use_tool" in names
            return chat("Apply the owner's request.", ("use_tool", {"name": name, "arguments": args}))
        def finish(**kwargs):
            offered.append({item["function"]["name"] for item in kwargs["tools"]})
            return live_said("Finished.")
        client.chats = [choose, finish]
    else:
        (tmp_path / ".codex").mkdir()
        (tmp_path / ".codex/auth.json").touch()
        rig.service._cli_brains = CliBrains(home=tmp_path, environ={}, commands={"codex": ["unused-test-boundary"]})
        rig.settings.set("agent_model", "cli:codex:test")
        async def run(driver, *, endpoint, token, **kwargs):
            async with httpx.AsyncClient(headers={"Authorization": "Bearer " + token}, trust_env=False) as http:
                async def rpc(method, params):
                    response = await http.post(endpoint, json={"jsonrpc": "2.0", "id": method, "method": method, "params": params})
                    return response.json()["result"]
                names = {tool["name"] for tool in (await rpc("tools/list", {}))["tools"]}
                offered.append(names)
                assert name not in names and "use_tool" in names
                if not check():
                    assert not (await rpc("tools/call", {"name": "use_tool", "arguments": {"name": name, "arguments": args}}))["isError"]
            yield Event("final", "Finished.")
        monkeypatch.setattr(Driver, "run", run)
    result = await typed(rig, text, 0, language="en")
    if change == "folder":
        assert result["status"] == "confirm" and not check()
        result = await rig.confirm(result["confirm"]["id"])
    assert result["status"] == "done" and check()
    assert offered and all(names == offered[0] for names in offered)


@pytest.mark.parametrize("brain", ["api", "cli"])
async def test_generic_turn_can_find_and_execute_management_in_the_same_turn(setup, client, monkeypatch, brain):
    rig, team = setup
    team.members.register(rig.rpc)
    rig.settings.set("action_mode", "bypass")
    assert not tools_for_request("Do the change we discussed")
    if brain == "api":
        def discover(**kwargs):
            names = {item["function"]["name"] for item in kwargs["tools"]}
            assert "find_tools" in names and "group_create" not in names
            return chat("Find the action.", ("find_tools", {"query": "create a folder"}))
        def create(**kwargs):
            assert "group_create" not in {item["function"]["name"] for item in kwargs["tools"]}
            return chat("Create the folder.", ("use_tool", {"name": "group_create", "arguments": {"name": "Discovered"}}))
        client.chats = [discover, create, live_said("Finished.")]
    else:
        rig.settings.set("agent_model", "cli:codex:test")
        async def work(loop):
            assert "group_create" not in {item["function"]["name"] for item in loop.tools}
            found = await loop._tool("find", "find_tools", {"query": "create a folder"})
            assert found.ok and "group_create" not in {item["function"]["name"] for item in loop.tools}
            assert (await loop._tool("create", "use_tool", {"name": "group_create", "arguments": {"name": "Discovered"}})).ok
            loop._queue.put_nowait(Outcome("done", final="Finished."))
        monkeypatch.setattr(CliLoop, "_work", work)
    assert (await typed(rig, "Do the change we discussed", 0, language="en"))["status"] == "done"
    assert team.members.store.group_by_name("Discovered")

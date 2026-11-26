"""A member starts fresh sub-workers for the parts of a job (`delegate_task`) and has each result back in its own turn.

The children are background tasks of the member, run by the one runner: the worker is a real `Worker` joined to the host by
two queues, the plugins are real ones, the model is a fake (an API model, or a CLI loop whose work is played). No test
spends money or touches the network.
"""

import asyncio
import json
from types import SimpleNamespace

import pytest
from mcp.server.mcpserver import MCPServer

from raphael_core.agent.cli.loop import CliLoop
from raphael_core.agent.delegate import DELEGATE_TASK, MAX_BATCH
from raphael_core.agent.harness_tools import CALENDAR_WRITES, ROUTINE_TOOLS
from raphael_core.agent.history import AgentHistory
from raphael_core.agent.owner_questions import OWNER_CARDS
from raphael_core.agent.policy import Tier
from raphael_core.agent.speaker import RAPHAEL, Speaker
from raphael_core.agent.team import TEAM_TIER, TEAM_TOOLS, team_tool, team_tools_for, worker_definition
from raphael_core.agent.team_admin import TEAM_READS
from raphael_core.background.snapshot import take_snapshot
from raphael_core.brain.openrouter import OpenRouterError
from raphael_core.brain.settings import SettingsStore
from raphael_core.management import MANAGEMENT_TOOLS
from raphael_core.memory.growth import DEFINITIONS as MEMORY_DEFINITIONS
from raphael_core.worker.loop import Outcome
from .conftest import ARGUMENT, Clock, report, turn, until, use
from .test_handoff import setup, team_of
from .test_questions import questions

BLOCKED_FOR_A_CHILD = {*TEAM_TOOLS, *OWNER_CARDS, "update_page", "find_app", *ROUTINE_TOOLS, *CALENDAR_WRITES, *MEMORY_DEFINITIONS,
                       "history_search", *MANAGEMENT_TOOLS, *TEAM_READS}


def member_turn(rig, *, model="fake/model"):
    """The member Writer, and a turn of its own conversation that is under way: where it calls the tool from."""
    member, _ = setup(rig, model=model, room=False)
    history = AgentHistory(rig.conn, rig.wall)
    source = history.get(history.add(session_id="own", question="Please split this big job up.", route="answer", source="app",
                                     scope="private", member_id=member.id, prefix="", text="", status="running"))
    return member, source


def delegate(rig, member, source, **arguments):
    return rig.service.delegate(member, arguments, source_turn_id=source.id, language="en")


def children(rig):
    return [dict(row) for row in rig.conn.execute("SELECT * FROM worker_tasks WHERE mode='delegate' ORDER BY id")]


def said_by_goal(**words):
    """A model reply that says what the child's own goal says: the children run side by side, in no fixed order."""
    def reply(**kwargs):
        text = json.dumps(kwargs["messages"], ensure_ascii=False)
        for goal, said in words.items():
            if goal in text:
                return report(said)
        raise AssertionError("a child was started with a goal nobody planned")
    return reply


class Gate:
    """Holds a child at its model call, counting how many are held at once."""

    def __init__(self):
        self.active = self.most = 0
        self.release = asyncio.Event()

    async def hold(self, **kwargs):
        self.active += 1
        self.most = max(self.most, self.active)
        try:
            await self.release.wait()
        finally:
            self.active -= 1
        return report("Part done and written up in full.")

    def only(self, goal, otherwise):
        """Holds the child whose goal names `goal`; every other child answers as `otherwise` says."""
        async def reply(**kwargs):
            if goal in json.dumps(kwargs["messages"], ensure_ascii=False):
                return await self.hold(**kwargs)
            return otherwise(**kwargs)
        return reply


# --- one call, one structured result for each child ----------------------------------------------------------------


async def test_a_batch_runs_every_child_and_returns_one_structured_result_each(make_rig):
    rig = make_rig()
    member, source = member_turn(rig)
    rig.client.replies.extend([said_by_goal(alpha="Alpha is summarised: three sections.", beta="Beta is summarised: two sections.")] * 2)
    result = await delegate(rig, member, source, tasks=[{"goal": "Summarise alpha", "context": "alpha is the file a.md"},
                                                        {"goal": "Summarise beta"}])
    assert result.ok and result.name == DELEGATE_TASK and result.untrusted
    first, second = result.data["results"]
    assert (first["index"], first["status"], first["summary"]) == (1, "completed", "Alpha is summarised: three sections.")
    assert (second["index"], second["status"], second["summary"]) == (2, "completed", "Beta is summarised: two sections.")
    for item in (first, second):
        assert item["files_changed"] == [] and item["model"] == "fake/model"
        assert item["tokens"] == 110 and item["model_calls"] == 1 and item["duration_ms"] >= 0
        assert item["cost_usd"] == pytest.approx(0.001)
    assert result.data["counts"] == {"completed": 2}
    # The system's own numbers for its work are never in what the model reads.
    assert "task_id" not in json.dumps(result.data) and "turn_id" not in json.dumps(result.data)
    # The children are tasks of the member, from its turn, that nobody reads as a conversation of their own.
    rows = children(rig)
    assert [row["member_id"] for row in rows] == [member.id] * 2
    assert {row["source_turn_id"] for row in rows} == {source.id} and {row["turn_id"] for row in rows} == {None}
    assert [row["state"] for row in rows] == ["done", "done"]


async def test_one_piece_of_work_is_given_as_goal_alone(make_rig):
    rig = make_rig()
    member, source = member_turn(rig)
    rig.client.replies.append(said_by_goal(gamma="Gamma is checked."))
    result = await delegate(rig, member, source, goal="Check gamma", context="in the notes", timeout_seconds=600)
    assert result.ok and [item["summary"] for item in result.data["results"]] == ["Gamma is checked."]


@pytest.mark.parametrize("arguments", [
    {}, {"goal": ""}, {"goal": "x", "tasks": [{"goal": "y"}]}, {"tasks": []}, {"tasks": [{"goal": "y"}] * (MAX_BATCH + 1)},
    {"tasks": [{"context": "no goal"}]}, {"tasks": [{"goal": "y", "who": "me"}]}, {"goal": "x", "timeout_seconds": 0},
    {"goal": "x", "timeout_seconds": "9"}, {"goal": 5}, {"goal": "x", "extra": 1}, {"tasks": "all of it"},
])
async def test_a_call_that_names_its_work_wrongly_is_refused_before_any_task_exists(make_rig, arguments):
    rig = make_rig()
    member, source = member_turn(rig)
    result = await delegate(rig, member, source, **arguments)
    assert not result.ok and result.error == "bad_arguments" and "goal" in result.instruction
    assert children(rig) == []


# --- what a child is, and may not be --------------------------------------------------------------------------------


async def test_a_child_gets_only_its_goal_the_context_and_the_working_folder(make_rig):
    rig = make_rig()
    member, source = member_turn(rig)
    rig.client.replies.append(said_by_goal(alpha="Alpha is summarised."))
    await delegate(rig, member, source, goal="Summarise alpha", context="CONTEXT-FROM-THE-MEMBER lives in a.md")
    system, user = (message["content"] for message in rig.client.chat_calls[0]["messages"][:2])
    assert "Summarise alpha" in user and "CONTEXT-FROM-THE-MEMBER" in user
    assert "sub-worker started by Writer" in system and "<owner_context>" in system
    # Not the conversation the member is in, and none of its notes.
    assert "split this big job up" not in system + user and "Source says" not in system + user
    # The member's tools go with it, found or listed, but none of the ones a child must not have.
    offered = {item["function"]["name"] for item in rig.client.chat_calls[0]["tools"]}
    assert {"find_tools", "use_tool", "web_search"} <= offered
    assert not offered & BLOCKED_FOR_A_CHILD


def test_a_child_is_given_no_tool_to_talk_to_the_owner_write_memory_manage_members_or_start_more_work():
    snapshot = take_snapshot(None, speaker=Speaker(id=1, name="Writer"), team=(), child=True, max_tier=Tier.T2)
    reachable = set(snapshot.catalog())
    assert {"find_tools", "use_tool", "web_search", "web_read", "local_time", "calendar_list"} <= reachable
    assert not reachable & BLOCKED_FOR_A_CHILD
    for name in sorted(BLOCKED_FOR_A_CHILD):
        assert snapshot.reveal(name) is None and snapshot.ref(name) is None
    # Not even found with find_tools.
    for query in ("delegate work to a sub-worker", "ask the owner a question", "remember this in memory", "create a member"):
        assert not {item["function"]["name"] for item in snapshot.find(query)[0]} & BLOCKED_FOR_A_CHILD


async def test_a_child_cannot_delegate_again(make_rig):
    rig = make_rig()
    member, source = member_turn(rig)
    task_id = rig.service._store.create(session_id="own", language="en", text="Part", member_id=member.id)
    rig.service._store.attach_turn(task_id, source.id)
    with rig.conn:
        rig.conn.execute("UPDATE worker_tasks SET mode='delegate', state='running' WHERE id=?", (task_id,))
    result = await delegate(rig, member, source, goal="Split it again")
    assert not result.ok and result.error == "nested" and "yourself" in result.instruction
    assert len(children(rig)) == 1


async def test_a_member_asked_by_another_assistant_cannot_delegate(make_rig):
    rig = make_rig()
    member, source = member_turn(rig)
    result = await rig.service.delegate(member.asked_by(RAPHAEL), {"goal": "x"}, source_turn_id=source.id, language="en")
    assert not result.ok and result.error == "nested"
    assert children(rig) == []


async def test_a_turn_that_is_not_the_members_own_cannot_delegate(make_rig):
    rig = make_rig()
    member, source = member_turn(rig)
    other = Speaker(id=member.id + 5, name="Other")
    refused = await rig.service.delegate(other, {"goal": "x"}, source_turn_id=source.id, language="en")
    assert not refused.ok and refused.error == "source_unavailable"
    missing = await rig.service.delegate(member, {"goal": "x"}, source_turn_id=987654, language="en")
    assert not missing.ok and missing.error == "source_unavailable"
    assert children(rig) == []


async def test_one_turn_may_start_only_so_many_children(make_rig, monkeypatch):
    from raphael_core.background import service

    monkeypatch.setattr(service, "MAX_DELEGATED", 3)
    rig = make_rig()
    member, source = member_turn(rig)
    rig.client.replies.extend([report("A part is done and written up.")] * 3)
    assert (await delegate(rig, member, source, tasks=[{"goal": "one"}, {"goal": "two"}])).ok
    refused = await delegate(rig, member, source, tasks=[{"goal": "three"}, {"goal": "four"}])
    assert not refused.ok and refused.error == "delegate_limit" and refused.instruction
    assert len(children(rig)) == 2


# --- the places the PC has --------------------------------------------------------------------------------------------


async def test_children_run_side_by_side_up_to_the_owners_limit(make_rig):
    rig = make_rig()
    member, source = member_turn(rig)
    SettingsStore(rig.conn).set("delegate_parallel", 2)
    gate = Gate()
    rig.client.replies.extend([gate.hold] * 3)
    running = asyncio.ensure_future(delegate(rig, member, source, tasks=[{"goal": "one"}, {"goal": "two"}, {"goal": "three"}]))
    await until(lambda: gate.active == 2)
    await asyncio.sleep(0.05)
    assert gate.active == 2, "the third waits for a place; it is never refused for it"
    assert [row["state"] for row in children(rig)].count("queued") == 1
    gate.release.set()
    result = await running
    assert gate.most == 2 and [item["status"] for item in result.data["results"]] == ["completed"] * 3


async def test_a_child_on_a_cli_takes_two_places(make_rig, monkeypatch):
    rig = make_rig()
    member, source = member_turn(rig)
    rig.service.use_cli(SimpleNamespace(available=lambda name: name in ("codex", "claude"), on_back=[]))
    gate = Gate()

    async def work(loop):
        await gate.hold()
        loop._queue.put_nowait(Outcome("done", final="The part is finished and written up."))

    monkeypatch.setattr(CliLoop, "_work", work)
    assert SettingsStore(rig.conn).get("delegate_parallel") == 4
    running = asyncio.ensure_future(delegate(rig, member, source, tasks=[{"goal": f"part {n}", "model": "codex"} for n in range(3)]))
    await until(lambda: gate.active == 2)
    await asyncio.sleep(0.05)
    assert gate.active == 2, "two CLI programs fill the four places"
    gate.release.set()
    result = await running
    assert gate.most == 2
    assert [(item["status"], item["model"]) for item in result.data["results"]] == [("completed", "cli:codex")] * 3


async def test_children_do_not_take_the_one_place_of_their_member(make_rig):
    rig = make_rig()
    member, source = member_turn(rig)
    gate = Gate()
    rig.client.replies.extend([gate.hold] * 2)
    running = asyncio.ensure_future(delegate(rig, member, source, tasks=[{"goal": "one"}, {"goal": "two"}]))
    await until(lambda: gate.active == 2)
    rig.client.replies.append(report("The member's own work is finished and written up."))
    own = rig.service.submit(session_id="own-work", text="Do your own work", language="en", model="fake/model", member_id=member.id)
    await until(lambda: rig.task(own).state == "done")
    assert gate.active == 2 and not running.done()
    gate.release.set()
    await running


def test_the_limit_is_a_setting_with_a_default_and_a_range(conn):
    settings = SettingsStore(conn)
    assert settings.get("delegate_parallel") == 4
    settings.set("delegate_parallel", 6)
    assert settings.get("delegate_parallel") == 6
    for bad in (0, -1, 65, 1.5, "4", True):
        with pytest.raises((ValueError, TypeError)):
            settings.set("delegate_parallel", bad)
    assert settings.get("delegate_parallel") == 6


# --- the model of a child ---------------------------------------------------------------------------------------------


async def test_a_child_runs_on_the_model_the_member_names_or_on_its_own(make_rig):
    rig = make_rig()
    member, source = member_turn(rig)
    rig.client.replies.extend([report("Written up by whichever model ran.")] * 2)
    result = await delegate(rig, member, source, tasks=[{"goal": "own brain"}, {"goal": "another model", "model": "vendor/other-model"}])
    assert [item["model"] for item in result.data["results"]] == ["fake/model", "vendor/other-model"]
    assert sorted(item["model"] for item in rig.client.chat_calls) == ["fake/model", "vendor/other-model"]
    assert sorted(row["model_ref"] for row in children(rig)) == ["fake/model", "vendor/other-model"]


async def test_a_member_with_its_own_model_gives_it_to_its_children(make_rig):
    rig = make_rig()
    member, source = member_turn(rig, model="vendor/members-own")
    rig.client.replies.append(report("Written up by the member's own model."))
    result = await delegate(rig, member, source, goal="Do the part")
    assert result.data["results"][0]["model"] == "vendor/members-own"
    assert rig.client.chat_calls[0]["model"] == "vendor/members-own"


@pytest.mark.parametrize("model,expected", [("claude", "cli:claude"), ("Codex", "cli:codex"), ("antigravity", "cli:gemini"),
                                            ("cli:codex:gpt-5.6-terra", "cli:codex:gpt-5.6-terra")])
async def test_a_cli_is_named_by_its_name_or_its_reference_and_runs_as_a_native_session(make_rig, monkeypatch, model, expected):
    rig = make_rig()
    member, source = member_turn(rig)
    rig.service.use_cli(SimpleNamespace(available=lambda name: True, on_back=[]))
    seen = []

    async def work(loop):
        seen.append((loop.model, loop.user))
        loop._queue.put_nowait(Outcome("done", final="The part is finished and written up."))

    monkeypatch.setattr(CliLoop, "_work", work)
    result = await delegate(rig, member, source, goal="Part for the CLI", context="CLI-CONTEXT", model=model)
    assert result.ok and result.data["results"][0]["status"] == "completed" and result.data["results"][0]["model"] == expected
    assert seen[0][0] == expected and "Part for the CLI" in seen[0][1] and "CLI-CONTEXT" in seen[0][1]
    assert rig.client.chat_calls == []


@pytest.mark.parametrize("model", ["claude", "codex", "cli:gemini"])
async def test_a_cli_that_is_not_connected_is_refused_before_anything_starts(make_rig, model):
    rig = make_rig()
    member, source = member_turn(rig)
    rig.service.use_cli(SimpleNamespace(available=lambda name: False, on_back=[]))
    result = await delegate(rig, member, source, tasks=[{"goal": "fine"}, {"goal": "needs the CLI", "model": model}])
    assert not result.ok and result.error == "model_unavailable" and "claude, codex or antigravity" in result.instruction
    assert children(rig) == []


async def test_a_model_the_owner_has_no_provider_for_is_refused(make_rig):
    rig = make_rig()
    member, source = member_turn(rig)
    rig.service._client.for_purpose = lambda purpose: SimpleNamespace(available=lambda model: model != "nobody/connected")
    result = await delegate(rig, member, source, goal="x", model="nobody/connected")
    assert not result.ok and result.error == "model_unavailable" and children(rig) == []
    rig.client.replies.append(report("The part is done and written up."))
    assert (await delegate(rig, member, source, goal="x", model="vendor/other")).ok


# --- the owner's permission mode, exactly as the member would -----------------------------------------------------


async def test_a_child_asks_the_owner_through_the_members_own_card_and_goes_on_after_the_yes(make_rig, plugins, calls):
    rig = make_rig()
    member, source = member_turn(rig)
    await plugins.connect(note="T2")
    rig.client.replies.extend([turn("Noting.", [use("Notes__note", {"text": ARGUMENT}, "c1")]), report("Noted, as the owner allowed.")])
    running = asyncio.ensure_future(delegate(rig, member, source, goal="Write the note"))
    await until(lambda: questions(rig))
    asked = questions(rig)[-1]
    # The card is the member's: in its thread, never the overlay's, with the same words any task of it asks with.
    assert asked["member_id"] == member.id and asked["state"] == "waiting" and asked["text"].startswith("Allow Notes to run note (")
    assert calls == [] and not running.done()
    child = rig.task(asked["task_id"])
    assert child.mode == "delegate" and child.state == "waiting"
    assert rig.service.answer(asked["task_id"], asked["question_id"], True) == "approved"
    result = await running
    assert calls == ["note"] and result.data["results"][0]["status"] == "completed"


async def test_a_no_to_one_child_leaves_the_others_to_finish(make_rig, plugins, calls):
    rig = make_rig()
    member, source = member_turn(rig)
    await plugins.connect(note="T2")

    def planned(**kwargs):
        text = json.dumps(kwargs["messages"], ensure_ascii=False)
        if "first part" not in text:
            return report("The second part is done and written up.")
        if any(message.get("role") == "tool" for message in kwargs["messages"]):
            return report("The first part was not allowed to write.")
        return turn("Noting.", [use("Notes__note", {"text": ARGUMENT}, "c1")])

    rig.client.replies.extend([planned] * 4)
    running = asyncio.ensure_future(delegate(rig, member, source, tasks=[{"goal": "first part"}, {"goal": "second part"}]))
    await until(lambda: questions(rig))
    asked = questions(rig)[-1]
    assert rig.service.answer(asked["task_id"], asked["question_id"], False) == "denied"
    result = await running
    assert calls == [] and [item["status"] for item in result.data["results"]] == ["completed", "completed"]
    assert [item["summary"] for item in result.data["results"]] == ["The first part was not allowed to write.",
                                                                    "The second part is done and written up."]


async def test_a_child_is_offered_what_a_background_task_is_and_no_tier_above(make_rig, plugins):
    rig = make_rig()
    member, source = member_turn(rig)
    await plugins.connect(note="T2", wipe="T3")
    rig.client.replies.append(report("Nothing needed the owner here."))
    await delegate(rig, member, source, goal="Look around")
    offered = {item["function"]["name"] for item in rig.client.chat_calls[0]["tools"]}
    assert "Notes__wipe" not in offered


async def test_in_full_permission_a_child_goes_straight_on_as_its_member_would(make_rig, plugins, calls):
    rig = make_rig()
    SettingsStore(rig.conn).set("action_mode", "bypass")
    member, source = member_turn(rig)
    await plugins.connect(note="T2")
    rig.client.replies.extend([turn("Noting.", [use("Notes__note", {"text": ARGUMENT}, "c1")]), report("Noted without asking.")])
    result = await delegate(rig, member, source, goal="Write the note")
    assert questions(rig) == [] and calls == ["note"] and result.data["results"][0]["status"] == "completed"
    assert "<full_permission>" in rig.client.chat_calls[0]["messages"][0]["content"]


async def test_in_plan_mode_a_child_is_told_to_change_nothing_and_every_change_still_asks(make_rig, plugins, calls):
    rig = make_rig()
    SettingsStore(rig.conn).set("action_mode", "plan")
    member, source = member_turn(rig)
    await plugins.connect(note="T1")
    rig.client.replies.extend([turn("Noting.", [use("Notes__note", {"text": ARGUMENT}, "c1")]), report("A plan, not a change.")])
    running = asyncio.ensure_future(delegate(rig, member, source, goal="Write the note"))
    await until(lambda: questions(rig))
    assert calls == [] and "<plan_mode>" in rig.client.chat_calls[0]["messages"][0]["content"]
    asked = questions(rig)[-1]
    rig.service.answer(asked["task_id"], asked["question_id"], False)
    assert (await running).ok


# --- a background task as the parent --------------------------------------------------------------------------------


async def test_a_background_task_delegates_and_its_model_reads_the_results_in_the_same_run(make_rig):
    rig = make_rig()
    member, _ = member_turn(rig)
    history = AgentHistory(rig.conn, rig.wall)
    turn_id = history.add(session_id="work", question="Split the job", route="worker", source="worker", scope="private",
                          member_id=member.id, prefix="", text="", status="running")

    async def team_tool_of_the_assistant(speaker, name, arguments, *, language, ledger, session_id, source_turn_id=None, **_):
        assert name == DELEGATE_TASK
        return await rig.service.delegate(speaker, arguments, source_turn_id=source_turn_id, language=language)

    rig.service.use_team(team_of(member), team_tool_of_the_assistant)
    rig.client.replies.extend([
        turn("Splitting.", [use(DELEGATE_TASK, {"tasks": [{"goal": "Part one", "context": "c"}]}, "d1")]),
        said_by_goal(**{"Part one": "Part one is written up and checked."}),
        report("Both done: the part came back checked."),
    ])
    task_id = rig.service.submit(session_id="work", text="Split the job", language="en", model="fake/model", member_id=member.id)
    rig.service.attach_turn(task_id, turn_id)
    await until(lambda: rig.task(task_id).state == "done")
    [child] = children(rig)
    assert child["parent_task_id"] == task_id and child["source_turn_id"] == turn_id and child["state"] == "done"
    read = [message["content"] for message in rig.client.chat_calls[2]["messages"] if message.get("role") == "tool"]
    assert any("Part one is written up and checked." in content for content in read)
    # What the child said is data to the parent, and never a report to the owner.
    assert rig.reports() == []


# --- the files a child changed ---------------------------------------------------------------------------------------


def files_server():
    server = MCPServer("files")

    @server.tool()
    def write_file(path: str, content: str) -> str:
        """Write a file."""
        return f"wrote {path}"

    @server.tool()
    def edit_file(path: str, old_string: str, new_string: str) -> str:
        """Edit a file."""
        return f"edited {path}"

    return server


async def test_the_files_a_child_wrote_with_the_file_tools_are_in_its_result(make_rig, plugins):
    rig = make_rig()
    member, source = member_turn(rig)
    plugins.servers.by_name["Files"] = files_server()
    added = await plugins.rpc.call("integrations.add", {"name": "Files", "transport": "stdio", "command": "unused"})
    await plugins.rpc.call("integrations.set_enabled", {"id": added["server"]["id"], "enabled": True})
    await plugins.rpc.call("integrations.refresh", {"id": added["server"]["id"]})
    rig.client.replies.extend([
        turn("Writing.", [use("Files__write_file", {"path": "/work/a.md", "content": "x"}, "c1"),
                          use("Files__edit_file", {"path": "/work/b.md", "old_string": "a", "new_string": "b"}, "c2"),
                          use("Files__write_file", {"path": "/work/a.md", "content": "y"}, "c3")]),
        report("Both files are written."),
    ])
    result = await delegate(rig, member, source, goal="Write the two files")
    item = result.data["results"][0]
    assert item["status"] == "completed" and item["files_changed"] == ["/work/a.md", "/work/b.md"]
    assert item["tool_calls"] == 3


# --- failure, timeout, stop ---------------------------------------------------------------------------------------------


async def test_a_child_that_fails_is_a_result_and_the_others_still_come_back(make_rig):
    rig = make_rig()
    member, source = member_turn(rig)

    def planned(**kwargs):
        if "broken part" in json.dumps(kwargs["messages"], ensure_ascii=False):
            raise OpenRouterError(401, "auth", "x")
        return report("The sound part is done and written up.")

    rig.client.replies.extend([planned] * 2)
    result = await delegate(rig, member, source, tasks=[{"goal": "sound part"}, {"goal": "broken part"}])
    assert result.ok
    sound, broken = result.data["results"]
    assert (sound["status"], broken["status"]) == ("completed", "failed")
    assert broken["reason"] and "summary" in broken
    assert result.data["counts"] == {"completed": 1, "failed": 1}


async def test_a_child_that_works_past_its_time_is_stopped_and_reported_as_a_timeout(make_rig, monkeypatch):
    from raphael_core.background import service

    monkeypatch.setattr(service, "DELEGATE_HEARTBEAT_S", 0.01)
    clock = Clock(5000.0)
    rig = make_rig(clock=clock)
    member, source = member_turn(rig)
    gate = Gate()
    planned = gate.only("endless part", said_by_goal(quick="The quick part is done and written up."))
    rig.client.replies.extend([planned] * 2)
    running = asyncio.ensure_future(delegate(rig, member, source, tasks=[{"goal": "endless part"}, {"goal": "quick part"}],
                                             timeout_seconds=5))
    await until(lambda: gate.active == 1 and any(row["state"] == "done" for row in children(rig)))
    clock.now += 6
    result = await asyncio.wait_for(running, 5)
    slow, quick = result.data["results"]
    assert (slow["status"], quick["status"]) == ("timeout", "completed")
    assert [row["state"] for row in children(rig)] == ["cancelled", "done"]
    gate.release.set()


async def test_the_owners_stop_ends_every_child_with_the_members_turn(make_rig):
    rig = make_rig()
    member, source = member_turn(rig)
    gate = Gate()
    rig.client.replies.extend([gate.hold] * 2)
    running = asyncio.ensure_future(delegate(rig, member, source, tasks=[{"goal": "one"}, {"goal": "two"}]))
    await until(lambda: gate.active == 2)
    running.cancel()
    with pytest.raises(asyncio.CancelledError):
        await running
    await until(lambda: [row["state"] for row in children(rig)] == ["cancelled", "cancelled"])
    assert gate.active == 0


async def test_a_child_the_owner_stops_comes_back_as_cancelled_and_the_call_goes_on(make_rig):
    rig = make_rig()
    member, source = member_turn(rig)
    gate = Gate()
    planned = gate.only("slow part", said_by_goal(quick="The quick part is done and written up."))
    rig.client.replies.extend([planned] * 2)
    running = asyncio.ensure_future(delegate(rig, member, source, tasks=[{"goal": "slow part"}, {"goal": "quick part"}]))
    await until(lambda: gate.active == 1 and any(row["state"] == "done" for row in children(rig)))
    stuck = next(row["id"] for row in children(rig) if row["state"] == "running")
    await rig.service._cancel({"task_id": stuck})
    result = await asyncio.wait_for(running, 5)
    assert [item["status"] for item in result.data["results"]] == ["cancelled", "completed"]


async def test_a_turn_that_is_stopped_stops_the_children_of_its_session(make_rig):
    rig = make_rig()
    member, source = member_turn(rig)
    gate = Gate()
    rig.client.replies.extend([gate.hold] * 2)
    running = asyncio.ensure_future(delegate(rig, member, source, tasks=[{"goal": "one"}, {"goal": "two"}]))
    await until(lambda: gate.active == 2)
    assert await rig.service.cancel_session(source.session_id)
    result = await asyncio.wait_for(running, 5)
    assert [item["status"] for item in result.data["results"]] == ["cancelled", "cancelled"]


async def test_children_left_over_by_a_restart_are_interrupted_and_never_started_again(make_rig):
    rig = make_rig()
    member, source = member_turn(rig)
    ids = rig.service._store.accept_delegates(source=source, parent=None, member_id=member.id, language="en",
                                              pieces=[("Never starts", "", "fake/model")])
    assert rig.task(ids[0]).state == "queued"
    tasks = rig.service._store.interrupt_unfinished(None, "restart")
    assert [(task.id, task.state) for task in tasks] == [(ids[0], "interrupted")]


# --- the tool, in the team's tools -------------------------------------------------------------------------------------


def test_the_find_tool_names_sub_workers_so_a_member_that_wants_to_split_a_job_looks_for_them():
    from raphael_core.background.snapshot import _DEFINITIONS

    assert "sub-workers" in _DEFINITIONS["find_tools"]["description"]


def test_the_tool_is_a_team_tool_found_with_find_tools_and_never_listed_in_the_default_prompt():
    assert DELEGATE_TASK in TEAM_TOOLS
    assert team_tool(DELEGATE_TASK).schema == worker_definition(DELEGATE_TASK)["function"]["parameters"]
    writer = Speaker(id=1, name="Writer")
    team = team_of(writer)
    assert DELEGATE_TASK in team_tools_for(team, writer, always=True)
    assert DELEGATE_TASK not in team_tools_for(team, writer, "split this job into parallel parts")
    assert DELEGATE_TASK not in team_tools_for(team, writer.asked_by(RAPHAEL), always=True)
    snapshot = take_snapshot(None, speaker=writer, team=team_tools_for(team, writer, always=True), memory=True, interactive=True,
                             max_tier=Tier.T3)
    assert DELEGATE_TASK in snapshot.work and DELEGATE_TASK not in snapshot.listed()
    assert DELEGATE_TASK in [item["function"]["name"] for item in snapshot.find("split a job into parallel sub-workers")[0]]
    assert snapshot.reveal(DELEGATE_TASK).tier == TEAM_TIER


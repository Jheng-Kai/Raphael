"""A member ends its own background work itself, and a stop says nothing (R-STOP-01, R-STOP-02).

The owner (2026-11-15): 工程師 asked him to stop one of its own earlier tasks "from the interface" (「他們不是同一個 session 嗎？為什麼沒有辦法
暫停它背後的工作？」), and every stop left 「任務已中止。已執行 N 次工具呼叫。」 in the conversation (「暫停就暫停，儘量保持畫面的乾淨還有整潔」).
"""

from dataclasses import replace

from raphael_core.agent.speaker import RAPHAEL
from raphael_core.agent.policy import Tier
from raphael_core.agent.team import STOP_WORK, TEAM_TIER, TEAM_TOOLS, team_tool, team_tools_for, worker_definition
from raphael_core.background.snapshot import take_snapshot
from raphael_core.members.store import MemberStore
from .test_handoff import args, setup, team_of, unused
from .test_queue_pump import own_work


def reports(rig):
    return [data for method, data in rig.notifications if method == "worker.report"]


async def test_a_member_lists_its_own_tasks_and_stops_one_without_a_word(make_rig, monkeypatch):
    rig = make_rig()
    member, _ = setup(rig, room=False)
    with monkeypatch.context() as held:
        held.setattr(rig.service, "_ensure_pump", lambda: None)
        parent, child = own_work(rig, member)
    listed = (await rig.service.stop_own_work(member, {})).data["tasks"]
    assert {(item["task_id"], item["state"]) for item in listed} == {(parent, "waiting"), (child, "queued")}
    assert all(item["title"] and item["member_id"] == member.id for item in listed)

    result = await rig.service.stop_own_work(member, {"task_id": child})
    assert result.ok and result.data == {"task_id": child, "stopped": True, "state": "cancelled"}
    ended = rig.task(child)
    assert ended.state == "cancelled" and ended.report_text == "" and ended.report_prefix == ""
    # Nothing is posted: no report line, no count of calls, nothing said on the overlay; the turn simply ends, empty.
    turn = rig.conn.execute("SELECT status, text, detail FROM agent_turns WHERE id=?", (ended.turn_id,)).fetchone()
    assert (turn[0], turn[1]) == ("cancelled", "") and not turn[2]
    assert rig.conn.execute("SELECT COUNT(*) FROM agent_messages WHERE turn_id=?", (ended.turn_id,)).fetchone()[0] == 0
    assert reports(rig) == []
    # The parent that waited for it is woken to go on (it is queued again), not left waiting.
    assert rig.task(parent).state == "queued"


async def test_a_member_cannot_stop_what_is_not_its_own(make_rig, monkeypatch):
    rig = make_rig()
    member, source = setup(rig, room=False)
    other_row = MemberStore(rig.conn).create_member(name="Editor", role="Editor")
    other = replace(member, id=other_row.id, name="Editor")
    rig.service.use_team(team_of(member, other), unused)
    with monkeypatch.context() as held:
        held.setattr(rig.service, "_ensure_pump", lambda: None)
        # The chief handed work to the Editor: the Editor's, and the chief's (it handed it); never the Writer's.
        receipt = rig.service.handoff(RAPHAEL, args(other, stage_id="theirs"), source_turn_id=source.id, language="en")
    theirs = receipt.data["task_id"]
    assert [item["task_id"] for item in (await rig.service.stop_own_work(member, {})).data["tasks"]] == []
    refused = await rig.service.stop_own_work(member, {"task_id": theirs})
    assert not refused.ok and refused.error == "not_found" and refused.instruction
    assert rig.task(theirs).state == "queued"
    assert (await rig.service.stop_own_work(other, {"task_id": theirs})).ok
    assert rig.task(theirs).state == "cancelled"
    # A task that does not exist, and a wrong kind of id, are refused the same way.
    assert (await rig.service.stop_own_work(member, {"task_id": 99999})).error == "not_found"
    assert (await rig.service.stop_own_work(member, {"task_id": "3"})).error == "bad_arguments"


async def test_a_member_cannot_stop_the_work_it_is_running_in(make_rig, monkeypatch):
    rig = make_rig()
    member, _ = setup(rig, room=False)
    with monkeypatch.context() as held:
        held.setattr(rig.service, "_ensure_pump", lambda: None)
        parent, child = own_work(rig, member)
    turn = rig.task(child).turn_id
    # The call is made from the child's own turn: neither it nor the parent that waits above it can be stopped from there.
    assert (await rig.service.stop_own_work(member, {}, source_turn_id=turn)).data["tasks"] == []
    blocked = await rig.service.stop_own_work(member, {"task_id": child}, source_turn_id=turn)
    assert not blocked.ok and blocked.error == "blocked"
    assert rig.task(child).state == "queued" and rig.task(parent).state == "waiting"


def test_the_tool_is_one_of_the_team_tools_every_member_finds_but_the_default_prompt_does_not_list():
    assert STOP_WORK in TEAM_TOOLS
    assert team_tool(STOP_WORK).schema == worker_definition(STOP_WORK)["function"]["parameters"]
    assert team_tool(STOP_WORK).schema["properties"].keys() == {"task_id"}
    writer = replace(RAPHAEL, id=1, name="Writer")
    team = team_of(writer)
    # The API path lists it for a request about stopping work; the default offer does not (its size is budgeted).
    assert STOP_WORK in team_tools_for(team, writer, "please stop that task")
    assert STOP_WORK not in team_tools_for(team, writer, "what is the weather")
    assert STOP_WORK not in team_tools_for(team, writer, always=True)
    # Every task and conversation finds it with find_tools and calls it with use_tool, as the work tools are.
    snapshot = take_snapshot(None, speaker=writer, team=TEAM_TOOLS, memory=True, interactive=True, max_tier=Tier.T3)
    assert STOP_WORK in snapshot.work and STOP_WORK not in snapshot.listed()
    assert STOP_WORK in [item["function"]["name"] for item in snapshot.find("stop one of my background tasks")[0]]
    assert snapshot.reveal(STOP_WORK).tier == TEAM_TIER

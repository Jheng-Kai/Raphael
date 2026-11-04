"""Activity arbitration, restart semantics and the late-subscriber snapshot."""

import asyncio

import pytest

from raphael_core.members.activity import Activity, step, tool_state, tool_step
from raphael_core.worker.loop import Call, ToolOutcome, Turn, run_task


@pytest.mark.parametrize("name,expected", [
    ("local_time", "working"), ("unknown_plugin", "working"),
    ("web_search", "searching"), ("web_read", "searching"),
    ("read_attachment", "searching"), ("history_search", "searching"),
    ("mcp__raphael__web_read", "searching"), ("WebSearch", "searching"),
    ("Read", "searching"), ("webSearch", "searching"),
    ("computer__click", "computer"), ("mcp__computer__screenshot", "computer"),
    ("mcp:computer-shared/vm_exec", "computer"),
    ("mcp:computer-access-5/request_computer", "working"),
    ("mcp:documents/read_document", "searching"),
])
def test_single_tool_table(name, expected):
    assert tool_state(name) == expected


@pytest.mark.parametrize("name,expected", [("local_time", "working"), ("web_read", "searching"),
                                           ("computer__click", "computer")])
async def test_real_loop_with_the_core_side_of_a_tool_classifies_and_releases_it(name, expected):
    notes = []
    activity = Activity(lambda method, data: notes.append(data["state"]))

    class FakeModel:
        calls = 0

        async def chat(self, messages, tools):
            assert activity.state(4) == "thinking"
            self.calls += 1
            if name == "computer__click" and self.calls == 2:
                return Turn("Check", [Call("check", "computer__get_window_state", {})])
            return Turn("Checking", [Call("one", name, {})]) if self.calls == 1 else Turn("Finished")

        # The worker is a process of its own with no activity: the core marks a tool where it runs it.
        @tool_step(lambda self, call_id, tool, arguments: tool)
        async def tool(self, call_id, tool, arguments):
            assert activity.state(4) == expected
            return ToolOutcome(True)

    with activity.turn(4):
        names = [name, "computer__get_window_state"] if name == "computer__click" else [name]
        result = await run_task(FakeModel(), system="", user="", tools=[{"function": {"name": tool}} for tool in names])
        assert result.status == "done"
    assert notes == ["thinking", expected, "thinking", *([expected, "thinking"] if name == "computer__click" else []), "done", "idle"]


async def test_concurrent_work_uses_priority_without_duplicate_notifications():
    notes = []
    activity = Activity(lambda method, data: notes.append(data["state"]))
    entered, release = asyncio.Event(), asyncio.Event()

    async def computer():
        with activity.turn(7), step("computer__click"):
            entered.set()
            await release.wait()

    with activity.turn(7), step("web_read"):
        task = asyncio.create_task(computer())
        await entered.wait()
        with step("local_time"), step("web_search"):
            assert activity.state(7) == "computer"
            assert notes == ["thinking", "searching", "computer"]
        release.set()
        await task
        assert activity.state(7) == "searching"
        assert "done" not in notes
    assert notes == ["thinking", "searching", "computer", "searching", "thinking", "done", "idle"]


async def test_cancelled_tool_and_crashed_turn_release_every_step():
    activity = Activity()
    entered = asyncio.Event()

    async def work():
        with activity.turn(2), step("computer__click"):
            entered.set()
            await asyncio.Event().wait()

    task = asyncio.create_task(work())
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert activity.state(2) == "idle" and not activity.running
    with pytest.raises(RuntimeError), activity.turn(2), step("web_search"):
        raise RuntimeError("fake crash")
    assert activity.state(2) == "error" and not activity.running
    assert Activity().state(2) == "idle"


async def test_members_list_matches_notifications_during_work_and_after_error(rig):
    activity = rig.service.activity
    member = rig.service.store.create_member(name="Reader", role="Research")

    async def check(identifier):
        response = await rig.call("members.list")
        row = next(row for row in response["members"] if row["id"] == identifier)
        notes = [data for method, data in rig.notes if method == "member.activity" and data["member_id"] == identifier]
        assert row["activity"] == notes[-1]["state"]
        return row["activity"]

    for identifier in (0, member.id):
        with activity.turn(identifier):
            assert await check(identifier) == "thinking"
            with step("web_read"):
                assert await check(identifier) == "searching"
        assert await check(identifier) == "idle"
        with pytest.raises(RuntimeError), activity.turn(identifier):
            raise RuntimeError("fake crash")
        assert await check(identifier) == "error"
        with activity.turn(identifier):
            assert await check(identifier) == "thinking"

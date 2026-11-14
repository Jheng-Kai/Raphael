"""A routine's precheck: a read tool the scheduler calls with no model before a run; an unchanged result skips the run quietly
(owner's real use: a member's mail routine, every three hours, found no new mail 39 times and still spent about nine tool steps
each time). Nothing is named for any one app: the precheck is a tool, its arguments, and a hash of what it returned.

Everything here is the fake connected tool of the event routines' tests; nothing reaches a real service."""

import asyncio
import json

import pytest

from raphael_core.agent.gate import ToolGate
from raphael_core.agent.plugins import PluginResult, PluginTool
from raphael_core.agent.policy import Tier
from raphael_core.protocol import RpcError

DAY = 86_400_000
CHECK = {"app": "srv-1", "tool": "mcp:srv-1/messages", "arguments": {"unread": True}}


class Connection:
    def __init__(self):
        self.items = [{"id": "m1"}]
        self.calls = []
        self.ok = True
        self.read = True

    def offered(self):
        return [PluginTool("mcp:srv-1/messages", "Mail", "messages", "Read messages", {}, Tier.T1)]

    def tier_of(self, key):
        return Tier.T1 if key == "mcp:srv-1/messages" else None

    def kind_of(self, server, tool):
        return "read" if self.read else "write"

    async def call(self, key, arguments, **scope):
        self.calls.append((key, arguments))
        return PluginResult(self.ok, None if self.ok else "network", json.dumps(self.items))


async def make(rig, **fields):
    hub = Connection()
    rig.service.use_event_tools(ToolGate(hub, conn=rig.conn))
    params = {"member_id": 0, "title": "Mail check", "prompt": "Look at new mail", "schedule": {"kind": "daily", "time": "09:00"},
              "precheck": CHECK, **fields}
    routine = (await rig.call("routines.create", params))["routine"]
    return hub, routine


async def due(rig, days=1):
    """The next time the routine is due, run by the scheduler, with the precheck read to its end."""
    rig.conn.execute("UPDATE worker_tasks SET state='done'")  # the earlier run is over (the fake worker never ends one)
    rig.wall.now += days * DAY
    ran = rig.service.tick()
    await asyncio.gather(*rig.service._prechecks)
    return ran


async def test_a_precheck_is_kept_shown_and_changed_by_the_routine_tools(rig):
    hub, routine = await make(rig)
    assert routine["precheck"] == CHECK and routine["last_skipped"] is None
    assert rig.service.store.routine(routine["id"]).precheck == CHECK
    cleared = (await rig.call("routines.update", {"id": routine["id"], "precheck": {}}))["routine"]
    assert "precheck" not in cleared and rig.service.store.routine(routine["id"]).precheck is None
    again = (await rig.call("routines.update", {"id": routine["id"], "precheck": {**CHECK, "arguments": {"unread": False}}}))["routine"]
    assert again["precheck"]["arguments"] == {"unread": False}


@pytest.mark.parametrize("bad", [
    {"app": "srv-1", "tool": "mcp:srv-1/messages"},
    {"app": "srv-1", "tool": "messages", "arguments": {}},
    {"app": "srv-1", "tool": "mcp:srv-1/messages", "arguments": [], "x": 1},
    {"app": "", "tool": "mcp:srv-1/messages", "arguments": {}},
    "mcp:srv-1/messages",
])
async def test_only_the_form_of_a_read_tool_call_is_a_precheck(rig, bad):
    with pytest.raises(RpcError):
        await make(rig, precheck=bad)


async def test_a_tool_that_writes_or_is_not_connected_is_no_precheck_and_an_event_routine_has_none(rig):
    hub = Connection()
    hub.read = False
    rig.service.use_event_tools(ToolGate(hub, conn=rig.conn))
    params = {"member_id": 0, "title": "Mail check", "prompt": "Look", "schedule": {"kind": "daily", "time": "09:00"}, "precheck": CHECK}
    with pytest.raises(RpcError) as refused:
        await rig.call("routines.create", params)
    assert "read-only" in refused.value.message
    hub.read = True
    with pytest.raises(RpcError):
        await rig.call("routines.create", {**params, "precheck": {**CHECK, "tool": "mcp:other/messages", "app": "other"}})
    event = {"app": "srv-1", "event": {"tool": "mcp:srv-1/messages", "arguments": {}, "items": "", "id": "id"},
             "filter": {"field": "", "equals": ""}}
    with pytest.raises(RpcError):
        await rig.call("routines.create", {"member_id": 0, "title": "t", "prompt": "p", "when": event, "precheck": CHECK})
    assert hub.calls == [] and rig.service.store.routines() == []


async def test_the_first_run_is_made_an_unchanged_result_skips_the_next_quietly_and_a_change_wakes_it_again(rig):
    hub, routine = await make(rig)
    rig.wall.now += 60_000  # 09:00
    assert rig.service.tick() == [routine["id"]]
    await asyncio.gather(*rig.service._prechecks)
    assert len(rig.background.submitted) == 1 and len(hub.calls) == 1
    assert hub.calls[0] == ("mcp:srv-1/messages", {"unread": True})
    saved = rig.service.store.routine(routine["id"])
    assert saved.precheck_hash and saved.last_run_ms == rig.wall.now and saved.last_skipped_ms is None
    turns = rig.conn.execute("SELECT COUNT(*) FROM agent_turns").fetchone()[0]
    notes = len(rig.notes)
    # The next time, nothing new: no run, no turn, no message, and the routine says when it last did nothing.
    await due(rig)
    assert len(rig.background.submitted) == 1 and len(hub.calls) == 2
    assert rig.conn.execute("SELECT COUNT(*) FROM agent_turns").fetchone()[0] == turns
    assert rig.conn.execute("SELECT COUNT(*) FROM routine_runs WHERE routine_id=?", (routine["id"],)).fetchone()[0] == 1
    assert not [n for n in rig.notes[notes:] if n[0] in ("agent.turn", "member.notice")]
    skipped = rig.service.store.routine(routine["id"])
    assert skipped.last_skipped_ms == rig.wall.now and skipped.last_run_ms == saved.last_run_ms
    assert skipped.precheck_hash == saved.precheck_hash
    assert skipped.next_run_ms > rig.wall.now, "a skipped run is a run that was due and dealt with"
    # Something new: the model is woken, and what it saw is what the next time is compared with.
    hub.items.append({"id": "m2"})
    await due(rig)
    assert len(rig.background.submitted) == 2
    woke = rig.service.store.routine(routine["id"])
    assert woke.precheck_hash != saved.precheck_hash and woke.last_run_ms == rig.wall.now
    await due(rig)
    assert len(rig.background.submitted) == 2 and len(hub.calls) == 4


async def test_a_precheck_that_cannot_be_read_never_holds_the_run_back(rig):
    hub, routine = await make(rig)
    hub.ok = False
    rig.wall.now += 60_000
    rig.service.tick()
    await asyncio.gather(*rig.service._prechecks)
    assert len(rig.background.submitted) == 1
    assert rig.service.store.routine(routine["id"]).precheck_hash is None, "nothing was read, so nothing is remembered"
    hub.ok = True
    await due(rig)  # read well for the first time: made, and remembered
    await due(rig)  # the same: skipped
    assert len(rig.background.submitted) == 2


async def test_a_precheck_taken_away_or_changed_starts_from_nothing_and_a_manual_test_run_ignores_it(rig):
    hub, routine = await make(rig)
    rig.wall.now += 60_000
    rig.service.tick()
    await asyncio.gather(*rig.service._prechecks)
    await due(rig)
    assert len(rig.background.submitted) == 1  # skipped
    # A test run is the owner's own, made at once whatever the precheck says.
    result = await rig.call("routines.run", {"id": routine["id"]})
    assert result["turn_id"] and len(rig.background.submitted) == 2
    await rig.call("routines.update", {"id": routine["id"], "precheck": {**CHECK, "arguments": {"unread": False}}})
    assert rig.service.store.routine(routine["id"]).precheck_hash is None
    await due(rig)
    assert len(rig.background.submitted) == 3  # the new precheck's first result is a first
    await rig.call("routines.update", {"id": routine["id"], "precheck": {}})
    calls = len(hub.calls)
    await due(rig)
    assert len(rig.background.submitted) == 4 and len(hub.calls) == calls, "no precheck, no call"


async def test_skipped_runs_do_not_use_up_a_routines_run_count(rig):
    hub, routine = await make(rig, schedule={"kind": "daily", "time": "09:00", "max_runs": 2})
    rig.wall.now += 60_000
    rig.service.tick()
    await asyncio.gather(*rig.service._prechecks)
    await due(rig)  # unchanged: skipped
    await due(rig)  # unchanged: skipped
    assert len(rig.background.submitted) == 1 and rig.service.store.routine(routine["id"]).enabled
    hub.items.append({"id": "m2"})
    await due(rig)  # the second and last permitted run
    assert len(rig.background.submitted) == 2
    await due(rig)
    assert len(rig.background.submitted) == 2 and rig.service.store.routine(routine["id"]).next_run_ms is None

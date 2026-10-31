"""Tests for what a background task may do with a member's memory: search the past turns, through the
gate; edit the files, marked once it has read outside content; and the files it is shown."""

import json

import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.background.service import _prompts
from raphael_core.background.run import RunLimits
from raphael_core.background.snapshot import BUILTIN, take_snapshot
from raphael_core.brain.secrets import MemoryKeyStore
from raphael_core.memory.service import MemoryService

from .test_run import Rig


async def test_completed_private_work_wakes_the_shared_learning_scheduler(make_rig, memory):
    from .conftest import report
    rig = make_rig()
    seen = []
    memory.after_turn = lambda member=0: seen.append(member)
    rig.service.use_memory(memory)
    rig.client.replies = [report("Finished work.")]
    task = rig.submit()
    identifier = AgentHistory(rig.conn).add(session_id="work", question="Do the work", route="delegate", prefix="", text="", status="running")
    rig.service.attach_turn(task, identifier)
    await rig.wait_for_reports()
    assert seen == [0]


class NoModel:
    async def complete_json(self, **kwargs):
        raise AssertionError("no model call is expected")


@pytest.fixture
def memory(conn, tmp_path):
    service = MemoryService(conn, tmp_path / "memory", NoModel(), MemoryKeyStore())
    service.own(0).edit_document("Amy 負責設計。\n", None)
    return service


@pytest.fixture
async def rig(conn, plugins, memory):
    made = Rig(conn, plugins, snapshot=take_snapshot(plugins.hub, memory=True), memory=memory)
    yield made
    await made.meteo.http.aclose()


def test_a_private_task_gets_growth_tools_but_not_legacy_write_aliases():
    names = [d["function"]["name"] for d in take_snapshot(None, memory=True).definitions]
    assert names == [
        "weather", "web_search", "local_time", "web_read", "history_search", "self_check", "raphael_help",
        "memory_update", "memory_log", "session_search", "session_read",
    ]  # fmt: skip
    assert not {"memory_read", "memory_write", "memory_delete"} & set(names)
    assert "history_search" not in [d["function"]["name"] for d in take_snapshot(None).definitions]
    refs = take_snapshot(None, memory=True).refs
    assert refs["history_search"].kind == BUILTIN and refs["history_search"].tier.name == "T0"


async def test_a_task_searches_the_past_turns(rig, conn):
    AgentHistory(conn).add(session_id="s", question="上次的會議", route="chat", prefix="答", text="三樓。", status="done")
    reply = await rig.tool("history_search", {"query": "會議"})
    assert reply["ok"] and "三樓。" in reply["content"]
    assert rig.audit() == [("Raphael", "history_search", "T0", "auto", "ok", rig.task_id)]


async def test_a_task_edits_its_file_and_the_model_is_told_how_full_it_is(rig, memory):
    result = await rig.tool("memory_update", {"target": "memory", "operations": [{"action": "add", "content": "The review is ready."}]})
    assert result["ok"] and "/2,200 chars" in json.loads(result["content"])["usage"]
    assert "The review is ready." in memory.own(0).read()


async def test_a_full_file_tells_the_task_what_to_free(rig, memory):
    memory.own(0).edit_document("x" * 2190, None)
    result = await rig.tool("memory_update", {"target": "memory", "operations": [{"action": "add", "content": "One more fact about the review."}]})
    assert not result["ok"] and result["kind"] == "full" and "would exceed the limit by" in result["instruction"]


async def test_retrieved_external_history_marks_what_a_task_writes(rig, memory, conn):
    from raphael_core.agent.history import Step
    history = AgentHistory(conn)
    identifier = history.add(session_id="s", question="Read amber report", route="chat", prefix="", text="Amber result", status="done")
    history.add_steps(identifier, [Step(kind="tool", tool="web_read", server="Raphael", outcome="ok", ms=1)])
    assert (await rig.tool("session_search", {"query": "amber"}))["ok"]
    result = await rig.tool("memory_update", {"target": "memory", "operations": [{"action": "add", "content": "The review is ready."}]})
    assert result["ok"]
    assert "（待確認）The review is ready." in memory.own(0).read()
    assert rig.steps()[0].detail == "external_content"


@pytest.mark.parametrize(
    ("name", "arguments"),
    [("history_search", {}), ("history_search", {"query": " "}), ("memory_update", {}), ("memory_update", {"target": "memory", "operations": "x"})],
)
async def test_a_memory_lookup_with_bad_arguments_fails_with_its_kind(rig, name, arguments):
    reply = await rig.tool(name, arguments)
    assert (reply["ok"], reply["kind"]) == (False, "bad_arguments")


async def test_the_old_note_tools_are_gone(rig, memory):
    for name in ("memory_read", "memory_write", "memory_delete"):
        reply = await rig.tool(name, {"name": "user-x", "body": "x"})
        assert reply["ok"] is False
    assert memory.own(0).read().strip() == "Amy 負責設計。"


def test_the_task_is_shown_the_files_as_data():
    from raphael_core.memory.store import MemorySnapshot

    moment = {"date": "2026-10-23", "time": "09:00", "weekday": "Friday", "utc_offset": "UTC+08:00"}
    files = MemorySnapshot(shared="主人叫 Jack", own="Amy 負責設計。", shared_usage="1% — 7/1,375 chars", own_usage="1% — 7/2,200 chars")
    _, user = _prompts("en", "整理 Amy 的設計稿", moment, [], RunLimits(), memory_snapshot=files)
    assert '<own_memory file="MEMORY.md" usage="1% — 7/2,200 chars">\nAmy 負責設計。\n</own_memory>' in user
    assert user.index("<shared_memory") < user.index("<own_memory") < user.index("<task>")
    _, without = _prompts("en", "x", moment, [], RunLimits())
    assert "shared_memory" not in without

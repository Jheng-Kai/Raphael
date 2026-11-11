"""Durable background results retain every visible message for parents and follow-ups."""

import pytest

from .conftest import turn


@pytest.mark.parametrize("state", ["done", "limit"])
async def test_full_result_survives_task_storage_parent_results_and_followup(make_rig, state):
    rig = make_rig()
    store = rig.service._store
    parent = store.create(session_id="parent", language="en", text="Return the complete result")
    child = store.create(session_id="child", language="en", text="Write result")
    with rig.conn:
        rig.conn.execute("UPDATE worker_tasks SET parent_task_id=? WHERE id=?", (parent, child))
    paragraphs = [f"Paragraph {number}: " + "x" * 2100 for number in range(6)]
    full = "\n\n".join(paragraphs)
    rig.service._conclude(rig.task(child), None, state, "", full, "Evidence receipt", None, replies=paragraphs)
    assert rig.task(child).report_text == full
    assert rig.service._child_results(parent)[0]["result"] == full
    assert rig.service.final_words(child) == paragraphs
    assert rig.task(child).report_detail == "Evidence receipt"


async def test_limit_wrapup_is_published_in_full(make_rig):
    from raphael_core.background.run import RunLimits
    from .conftest import call
    rig = make_rig(limits=RunLimits(model_calls=1))
    full = "Completed work and evidence. " * 100
    rig.client.replies = [turn("", [call("local_time", {}, "time")]), turn(full)]
    task = rig.submit()
    await rig.wait_for_reports()
    assert rig.task(task).state == "limit"
    assert rig.task(task).report_text == full.strip()
    assert "\n\n".join(rig.service.final_words(task)) == full.strip()

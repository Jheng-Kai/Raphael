"""In 手動 (`action_mode = "ask"`) a task that reads through a connection waits for the owner's yes, and the yes makes the
call: the door asks for every call above T0 while the switch is on, so the question has to be opened for a read too."""

from raphael_core.brain.settings import SettingsStore
from .conftest import call, report, turn, until, use


async def test_a_task_that_reads_in_ask_mode_waits_for_a_yes_and_then_reads(make_rig, conn):
    rig = make_rig()
    await rig.plugins.connect(look="T1")
    SettingsStore(conn).set("action_mode", "ask")
    rig.client.replies = [turn("Checking", [use("Notes__look", {"topic": "test"}, "look")]), report("Finished.")]
    task = rig.submit()
    await until(lambda: rig.task(task).state == "waiting")
    [question] = rig.service.waiting_questions()
    assert rig.service.answer(task, question["id"], True) == "approved"
    await until(lambda: rig.task(task).state == "done")
    [step] = [step for step in rig.service._store.steps(task) if step.kind == "tool"]
    assert (step.tool, step.outcome) == ("look", "ok")

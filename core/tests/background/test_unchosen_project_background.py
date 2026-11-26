"""R-FILE-06 in the background: a call that targets a project that is not the member's chosen one is refused before any question.

In 手動 and 計畫 the owner's screening asks about every call that changes something, and a task waits for the answer. A write
into an unchosen project is refused whatever is said, so no question is opened for it: the task goes on, told it was refused.
"""

import pytest

from raphael_core import work_area
from raphael_core.background.cli import member_loop
from .conftest import call, report, turn, until
from .test_local_commands import with_local_tools
from .test_run import Rig, rig  # noqa: F401


def projects(settings, tmp_path):
    chosen, other = tmp_path / "chosen", tmp_path / "other"
    for folder in (chosen, other):
        folder.mkdir()
    settings.set("project_folders", [str(chosen), str(other)])
    settings.set("member_work_folder", {"0": str(chosen)})
    return chosen, other


@pytest.mark.parametrize("mode", ["ask", "plan"])
async def test_a_task_is_not_asked_about_a_command_that_names_a_file_in_an_unchosen_project(make_rig, plugins, conn, tmp_path, mode):
    host = with_local_tools(plugins, conn)
    settings = plugins.hub.settings
    chosen, other = projects(settings, tmp_path)
    settings.set("action_mode", mode)
    settings.set("local_commands_mode", "ask")
    settings.set("local_commands_seen", True)
    rig = make_rig()
    command = f"echo hi > {other.as_posix()}/out.txt"
    rig.client.replies = [turn("Saving.", [call("local__local_exec", {"command": command}, "w")]), report("It was refused.")]
    task_id = rig.submit("Save a note")
    await until(lambda: rig.task(task_id).state not in ("queued", "running"))
    assert rig.task(task_id).state != "waiting" and rig.service.waiting_questions() == []
    host.execute.assert_not_awaited()
    assert not (other / "out.txt").exists()
    step = next(step for step in rig.steps(task_id) if step.tool == "local_exec")
    assert step.outcome == "blocked" and step.reason == "forbidden"


@pytest.mark.parametrize("mode", ["ask", "plan"])
async def test_a_task_is_not_asked_about_a_write_of_the_owners_file_tools_into_an_unchosen_project(make_rig, plugins, conn, tmp_path, mode):
    with_local_tools(plugins, conn)
    settings = plugins.hub.settings
    chosen, other = projects(settings, tmp_path)
    settings.set("action_mode", mode)
    rig = make_rig()
    arguments = {"path": str(other / "note.md"), "content": "hello"}
    rig.client.replies = [turn("Saving.", [call("owner_files__write_file", arguments, "w")]), report("It was refused.")]
    task_id = rig.submit("Save a note")
    await until(lambda: rig.task(task_id).state not in ("queued", "running"))
    assert rig.task(task_id).state != "waiting" and rig.service.waiting_questions() == []
    assert not (other / "note.md").exists()
    step = next(step for step in rig.steps(task_id) if step.tool == "write_file")
    assert step.outcome == "blocked" and step.reason == "forbidden"


async def test_a_cli_tasks_own_command_that_names_a_file_in_an_unchosen_project_is_refused_before_any_card_in_every_mode(conn, plugins, tmp_path):
    with_local_tools(plugins, conn)
    rig = Rig(conn, plugins)
    try:
        chosen, other = projects(rig.settings, tmp_path)
        task = rig.store.get(rig.task_id)
        loop = member_loop(None, None, task, rig.run, {"system": "Persona", "user": "Task", "tools": []},
                           wait_s=1, progress=lambda text: None)
        for mode in ("direct", "ask", "plan", "bypass"):
            rig.settings.set("action_mode", mode)
            refused = await loop.execute("write", "cli_permission", {"command": f"echo hi > {other.as_posix()}/out.txt"})
            assert not refused.ok and refused.kind == "forbidden" and work_area.UNCHOSEN_WORDS in refused.instruction, mode
    finally:
        await rig.meteo.http.aclose()

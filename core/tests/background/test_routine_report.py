"""What a routine's last message is (owner, 2026-11-14): the report of a daily reading page was one line, and the owner could not tell
what the run had made; every such report also ended with what it had not checked. The run is told to name what it made."""

from raphael_core.background.service import ROUTINE_REPORT

from .conftest import report
from .test_members import ended
from .test_routine_health import routine_run


def test_a_routines_report_names_what_it_made_in_two_or_three_lines_and_never_a_receipt():
    assert "the owner reads only your last message" in ROUTINE_REPORT
    assert "two or three lines that name what you made" in ROUTINE_REPORT
    assert "its title and what it contains" in ROUTINE_REPORT
    assert 'Never a one-line receipt such as "delivered"' in ROUTINE_REPORT
    assert "unfinished" not in ROUTINE_REPORT and "pretend" not in ROUTINE_REPORT


async def test_a_routines_run_is_told_with_its_task_and_other_tasks_are_not(make_rig):
    rig = make_rig()
    rig.client.replies = [report("Made it.")]
    routine = routine_run(rig, "Make today's reading page")
    await ended(rig, routine)
    system, user = (message["content"] for message in rig.client.chat_calls[-1]["messages"][:2])
    assert ROUTINE_REPORT in user and ROUTINE_REPORT not in system  # the system prompt stays the one every task begins with
    assert user.index("<task>") < user.index(ROUTINE_REPORT)

    rig.client.replies = [report("Done.")]
    plain = rig.service.submit(session_id="task-plain", text="Make today's reading page", language="en", model="fake/model")
    await ended(rig, plain)
    system, user = (message["content"] for message in rig.client.chat_calls[-1]["messages"][:2])
    assert ROUTINE_REPORT not in system and ROUTINE_REPORT not in user

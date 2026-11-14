"""The guards that keep a model on its tools (R-PERSIST-04, owner, 2026-11-14).

A member said 「我先去看看今天的新聞。」 and the turn ended with nothing done; another had a page read, a page shown and a
command fail one after the other and stopped, where no one tool's count had reached its note. Fakes only."""

import pytest

from raphael_core.worker.loop import ToolOutcome, Turn
from raphael_core.worker.stall_guards import trailing_continue_intent
from raphael_core.worker.tool_guardrails import STREAK, ToolGuardrails

from .test_loop import FakeHost, ask, report, run


def bad(kind="tool_error"):
    return ToolOutcome(False, kind, "boom")


def good():
    return ToolOutcome(True, None, "fine")


def test_failures_of_different_tools_one_after_another_get_the_keep_using_tools_note():
    guard = ToolGuardrails()
    assert guard.after_call("web_read", {"url": "a"}, bad("timeout")).note == ""
    assert guard.after_call("show_page", {"html": "x"}, bad("secret")).note == ""
    note = guard.after_call("vm_exec", {"command": "curl a"}, bad()).note
    assert note == STREAK.format(count=3, tools="web_read, show_page, vm_exec")
    assert "Do not switch to text-only replies; keep using tools" in note and "diagnose first" in note
    assert not guard.after_call("web_search", {"query": "a"}, bad()).halt  # varied failures are diagnosis, never an end


def test_a_success_between_failures_starts_the_count_again():
    guard = ToolGuardrails(hard_stop=True)
    guard.after_call("web_read", {"url": "a"}, bad())
    guard.after_call("show_page", {"html": "x"}, bad())
    guard.after_call("web_search", {"query": "a"}, good())
    assert guard.after_call("vm_exec", {"command": "ls"}, bad()).note == ""


def test_one_tool_failing_keeps_its_own_note_and_gets_no_second():
    guard = ToolGuardrails()
    notes = [guard.after_call("web_read", {"url": f"https://x.example/{n}"}, bad()).note for n in range(3)]
    assert notes[:2] == ["", ""] and "has failed 3 times in a row" in notes[2] and STREAK.split("{")[0] not in notes[2]


def test_the_note_after_repeated_failures_never_says_to_report_after_one_check():
    guard = ToolGuardrails()
    for n in range(3):
        note = guard.after_call("Notes__look", {"topic": str(n)}, bad()).note
    assert "after one check" not in note and "When no way within your reach is left" in note


@pytest.mark.parametrize("reply", [
    "我先去看看今天的新聞。",
    "好，先查一下 NHK 今天的頭條。",
    "接著打開瀏覽器讀全文。",
    "まず記事を確認します。",
    "I'll first check the article page.",
    "Let me check the consent page.",
])
async def test_a_reply_that_ends_on_a_step_it_announces_is_asked_to_go_on(reply):
    host = FakeHost([Turn(reply), Turn("", [ask("Notes__look", {"topic": "news"})]), report()])
    outcome = await run(host)
    assert outcome.status == "done" and len(host.tool_calls) == 1


@pytest.mark.parametrize("reply", [
    "Let me know if you want more.",
    "好的，行事曆已經整理好了。",
    "我先說結論：答案是 42。",
    "你可以先看看這份清單。",
    "請先確認你的帳號。",
])
def test_an_answer_that_only_mentions_a_step_is_not_taken_for_an_intent(reply):
    assert not trailing_continue_intent(reply)

"""Tests for the guardrails of the tool loop: what they say to the model, and when they end a task nobody is in."""

import json

import pytest

from raphael_core.worker.loop import ToolOutcome
from raphael_core.worker.tool_guardrails import ToolGuardrails, failed


def ok(text="r"):
    return ToolOutcome(True, None, text)


def bad(kind="tool_error", text="boom"):
    return ToolOutcome(False, kind, text)


def ran(code, output=""):
    return ToolOutcome(True, None, json.dumps({"exit_code": code, "output": output, "truncated": False}))


def test_a_command_that_exited_non_zero_failed_and_a_cut_result_still_says_so():
    assert failed("vm_exec", ran(1)) and failed("computer__vm_exec", ran(2, "x"))
    assert not failed("vm_exec", ran(0)) and not failed("Notes__look", ran(1))
    cut = ToolOutcome(True, None, '{"exit_code": 1, "output": "' + "x" * 50 + "\n[... 9000 characters left out ...]")
    assert failed("vm_exec", cut)
    assert failed("Notes__look", bad())


def test_an_identical_call_with_a_changed_result_is_not_a_repeat():
    guard = ToolGuardrails()
    for number in range(10):
        assert guard.after_call("tail", {"file": "log"}, ok(str(number))).note == ""


def test_a_call_that_returns_a_screen_never_makes_a_streak():
    guard = ToolGuardrails(hard_stop=True)
    shot = ToolOutcome(True, None, "same words", blocks=[{"type": "image", "data": "x", "mimeType": "image/png"}])
    for _ in range(10):
        verdict = guard.after_call("computer__get_desktop_state", {}, shot)
        assert verdict.note == "" and not verdict.halt


@pytest.mark.parametrize("period", [2, 3, 4])
def test_a_cycle_of_two_to_four_calls_with_unchanged_results_is_noticed_on_the_third_lap(period):
    guard = ToolGuardrails()
    notes = []
    for number in range(period * 3):
        notes.append(guard.after_call(f"tool{number % period}", {}, ok(f"r{number % period}")).note)
    assert notes[: period * 3 - 1] == [""] * (period * 3 - 1)
    assert f"same {period} calls" in notes[-1]


def test_a_cycle_of_five_is_too_long_to_notice():
    guard = ToolGuardrails()
    notes = [guard.after_call(f"tool{number % 5}", {}, ok("r")).note for number in range(30)]
    assert notes == [""] * 30


def test_a_failure_with_the_same_arguments_is_noted_the_second_time_and_a_change_makes_it_new():
    guard = ToolGuardrails()
    assert guard.after_call("send", {"to": "a"}, bad()).note == ""
    assert "failed 2 times with the same arguments" in guard.after_call("send", {"to": "a"}, bad()).note
    guard.after_call("write", {"text": "x"}, ok())  # something changed
    assert guard.after_call("send", {"to": "a"}, bad()).note == ""


def test_looking_at_the_world_is_not_a_change():
    guard = ToolGuardrails()
    guard.after_call("send", {"to": "a"}, bad())
    guard.after_call("web_read", {"url": "u"}, ok())
    assert "failed 2 times" in guard.after_call("send", {"to": "a"}, bad()).note


def test_a_throttled_call_tried_again_after_its_wait_is_not_called_a_replay():
    guard = ToolGuardrails(hard_stop=True)
    verdicts = [guard.after_call("search", {"q": "x"}, bad("rate_limit", f"429, wait {n} s")) for n in range(5)]
    assert not any("with the same arguments" in verdict.note for verdict in verdicts)
    assert not any(verdict.halt for verdict in verdicts)  # five in a row is under what a dead endpoint costs


def test_waiting_for_a_desktop_someone_else_uses_is_not_a_loop_even_for_a_task_nobody_is_in():
    guard = ToolGuardrails(hard_stop=True)
    for _ in range(12):
        verdict = guard.after_call("computer__click", {"x": 1}, bad("computer_busy", ""))
        assert verdict.note == "" and not verdict.halt


def test_the_note_after_repeated_failures_of_a_tool_tells_the_model_to_diagnose_first():
    guard = ToolGuardrails()
    notes = [guard.after_call("Notes__look", {"n": n}, bad()).note for n in range(3)]
    assert notes[:2] == ["", ""] and "diagnose" in notes[2]
    commands = [guard.after_call("vm_exec", {"command": f"c{n}"}, ran(1)).note for n in range(3)]
    assert "pwd && ls -la" in commands[2]


def test_a_task_nobody_is_in_ends_on_a_command_replayed_unchanged_but_an_edit_between_makes_it_new():
    guard = ToolGuardrails(hard_stop=True)
    halts = []
    for number in range(8):
        halts.append(guard.after_call("vm_exec", {"command": "pytest"}, ran(1, "FAILED")).halt)
        halts.append(guard.after_call("vm_exec", {"command": f"sed -i {number} f.py"}, ran(0)).halt)
    assert not any(halts)
    halts = [guard.after_call("vm_exec", {"command": "make"}, ran(1, f"error {n}")).halt for n in range(5)]
    assert halts == [False, False, False, False, True]


def test_a_task_with_the_owner_in_it_never_halts():
    guard = ToolGuardrails()
    assert not any(guard.after_call("Notes__look", {"n": n}, bad()).halt for n in range(30))
    assert not any(guard.after_call("tail", {}, ok("same")).halt for _ in range(30))

"""Tests for the reasons a step keeps: one word out of a fixed few, never a message."""

import pytest

from raphael_core.agent.steps import REASONS, WORK_CHARS, Step, reason_of, work_summary


def test_a_step_that_went_well_has_no_reason():
    assert reason_of("ok", "auth") is None


@pytest.mark.parametrize(
    ("outcome", "kind", "reason"),
    [
        ("error", "auth", "auth"),  # a plugin that wants a new sign-in
        ("error", "bad_arguments", "bad_arguments"),
        ("error", "tool_error", "tool_error"),
        ("error", "not_found", "not_found"),  # the weather of a city nobody knows
        ("error", "offline", "network"),  # the model's word for it
        ("error", "http_error", "network"),  # the lookups'
        ("error", "bad_response", "protocol"),
        ("blocked", "changed", "blocked"),
        ("timeout", None, "timeout"),
        ("blocked", None, "blocked"),
        ("error", None, "error"),
        ("error", "Calendar 'Dinner with Mia' was not found", "error"),  # a message is no kind
    ],
)
def test_the_kind_of_a_failure_becomes_one_of_the_reasons(outcome, kind, reason):
    assert reason_of(outcome, kind) == reason
    assert reason in REASONS


# --- what a turn that did not finish already did ---------------------------------------------------


def step(tool, outcome="ok", server="Notes", kind="tool", reason=None):
    return Step(kind, tool, server, outcome, 5, reason)


def test_the_work_of_a_turn_names_what_changed_and_counts_what_only_read():
    steps = [step("update")] * 2 + [step("look")] * 3 + [step("create")]
    text = work_summary(steps, lambda s: s.tool != "look")
    assert text.startswith("It had changed: update (Notes) x2, create (Notes);")
    assert "3 calls only read" in text and text.endswith("should not be made twice.")


def test_a_turn_with_no_steps_has_no_work_to_tell():
    assert work_summary([], lambda s: True) == "No tool calls were recorded."


def test_a_turn_that_only_looked_changed_nothing():
    assert work_summary([step("look")], lambda s: False) == "It changed nothing; 1 call only read."


def test_a_call_that_ended_badly_may_have_taken_effect_unless_it_was_refused_first():
    steps = [
        step("send", "timeout"), step("send", "error", reason="network"),  # may have been made
        step("send", "error", reason="auth"), step("send", "blocked", reason="blocked"),  # refused first
    ]
    text = work_summary(steps, lambda s: True)
    assert text.startswith(
        "It changed nothing for certain; 2 calls that change things did not end cleanly and may have taken effect"
    )


def test_the_model_calls_of_a_worker_are_not_work():
    assert work_summary([step("gpt", kind="model")], lambda s: True) == "No tool calls were recorded."


def test_the_work_is_a_short_line_whatever_the_names_and_the_count():
    steps = [step(f"update\nrecord-{n}-" + "x" * 80, server="S" * 80) for n in range(200)]
    text = work_summary(steps, lambda s: True)
    assert "\n" not in text and len(text) <= WORK_CHARS and " more" in text

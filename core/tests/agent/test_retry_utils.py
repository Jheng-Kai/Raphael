"""The waits between a failed model call and the next: jittered, as long as the provider asks, and told once.

Adapted from NousResearch/hermes-agent (MIT); see core/packaging/licenses.
"""

import threading
from datetime import UTC, datetime, timedelta
from email.utils import format_datetime
from types import SimpleNamespace

import pytest

from raphael_core.retry_utils import (
    RETRY_AFTER_CAP_S,
    Outage,
    jittered_backoff,
    parse_retry_after_seconds,
    provider_retry_after_seconds,
    reset_delay_from_message,
    retry_delay,
)


def test_backoff_doubles_each_attempt_up_to_the_most():
    for attempt in (1, 2, 3, 4):
        delays = [jittered_backoff(attempt, base_delay=5.0, max_delay=120.0, jitter_ratio=0.0) for _ in range(20)]
        assert set(delays) == {min(5.0 * 2 ** (attempt - 1), 120.0)}
    assert jittered_backoff(100, base_delay=5.0, max_delay=60.0, jitter_ratio=0.0) == 60.0


def test_jitter_only_adds_and_calls_at_the_same_time_differ():
    results = []
    barrier = threading.Barrier(8)

    def call():
        barrier.wait()
        results.append(jittered_backoff(1, base_delay=10.0, max_delay=120.0, jitter_ratio=0.5))

    threads = [threading.Thread(target=call) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=5)
    assert len(results) == 8 and all(10.0 <= delay <= 15.0 for delay in results)
    assert len(set(results)) >= 6


class TestRetryAfter:
    def test_numbers_and_strings(self):
        assert parse_retry_after_seconds("120") == 120.0
        assert parse_retry_after_seconds(" 4.5 ") == 4.5
        assert parse_retry_after_seconds(45) == 45.0

    def test_http_date_counts_the_seconds_to_it_and_never_goes_below_zero(self):
        future = format_datetime(datetime.now(UTC) + timedelta(seconds=90), usegmt=True)
        assert 80 <= parse_retry_after_seconds(future) <= 91
        assert parse_retry_after_seconds(format_datetime(datetime.now(UTC) - timedelta(seconds=90), usegmt=True)) == 0.0

    @pytest.mark.parametrize("value", [None, "", "soon", True, object()])
    def test_what_is_no_wait_is_none(self, value):
        assert parse_retry_after_seconds(value) is None

    def test_headers_in_either_casing_and_a_headers_object_that_raises(self):
        assert parse_retry_after_seconds({"Retry-After": "7"}) == 7.0
        assert parse_retry_after_seconds({"retry-after": "8"}) == 8.0

        class Explosive:
            def get(self, _key):
                raise RuntimeError("boom")

        assert parse_retry_after_seconds(Explosive()) is None


class TestProviderRetryAfter:
    def error(self, headers=None, body=None):
        return SimpleNamespace(response=SimpleNamespace(headers=headers or {}), body=body)

    def test_the_header_comes_first_then_the_body_top_level_or_under_error(self):
        assert provider_retry_after_seconds(self.error({"Retry-After": "30"}, {"retry_after": 5})) == 30.0
        assert provider_retry_after_seconds(self.error(body={"retry_after": 12})) == 12.0
        assert provider_retry_after_seconds(self.error(body={"error": {"retry_after": 9}})) == 9.0

    @pytest.mark.parametrize("error", [None, SimpleNamespace(), SimpleNamespace(response=None, body="text")])
    def test_no_wait_given_is_none(self, error):
        assert provider_retry_after_seconds(error) is None

    def test_a_zero_wait_is_no_wait_so_that_it_cannot_hot_loop(self):
        assert provider_retry_after_seconds(self.error({"Retry-After": "0"})) is None


@pytest.mark.parametrize(
    ("message", "seconds"),
    [
        ("Your weekly usage limit has been reached. It resets in 4hr 5min", 4 * 3600 + 5 * 60),
        ("Limit reached, resets in 2 hours 5 minutes", 2 * 3600 + 5 * 60),
        ("resets in 30s", 30),
        ("Rate limit reached. Please retry after 20 seconds", 20),
        ("Quota exceeded. quotaResetDelay: 1500ms", 1.5),
        ("{'type': 'usage_limit_reached', 'resets_in_seconds': 30995}", 30995),
        # A short throttle inside a long window: the explicit short wait is the one asked for.
        ("Retry after 12 seconds; the window resets in 5 hours", 12),
        # The wordings of Gemini and OpenAI.
        ("Quota exceeded. Please retry in 12.27s.", 12.27),
        ("Rate limit reached for gpt-6 in organization org-x on tokens per min. Please try again in 6s.", 6),
        ("Please try again in 1m30.5s.", 90.5),
        ("Please try again in 20ms.", 0.02),
        ("Please try again in 5 minutes.", 300),
        ("Please try again in a moment.", None),
        ("Something unrelated, and it resets in the morning", None),
        ("", None),
    ],
)
def test_the_reset_in_a_providers_words(message, seconds):
    assert reset_delay_from_message(message) == seconds


def test_the_step_of_the_schedule_is_jittered_by_a_fifth_at_most():
    for _ in range(50):
        assert 30.0 <= retry_delay(30.0) <= 36.0


def test_a_longer_wait_asked_by_the_provider_wins_and_is_believed_up_to_the_cap():
    assert retry_delay(1.0, 45.0) == 45.0
    assert retry_delay(60.0, 5.0) >= 60.0
    assert retry_delay(1.0, 86400.0) == RETRY_AFTER_CAP_S


class TestOutage:
    def waits(self, outage, count, **kwargs):
        return [outage.wait(**kwargs) for _ in range(count)]

    def test_before_anything_was_done_it_gives_up_after_the_quick_waits(self):
        outage = Outage((1.0, 3.0, 8.0), (30.0,), patient_ok=False)
        waits = self.waits(outage, 4)
        assert all(step <= wait <= step * 1.2 for step, wait in zip((1, 3, 8), waits)) and waits[3] is None

    def test_after_work_it_goes_on_at_the_patient_pace_and_keeps_the_last_step(self):
        outage = Outage((1.0,), (30.0, 60.0, 120.0, 300.0), patient_ok=True)
        waits = self.waits(outage, 9)
        steps = [1, 30, 60, 120, 300, 300, 300, 300, 300]
        assert all(step <= wait <= step * 1.2 for step, wait in zip(steps, waits))

    def test_what_the_provider_asks_raises_the_wait(self):
        outage = Outage((1.0, 3.0), (), patient_ok=False)
        assert outage.wait(retry_after=45.0) == 45.0
        assert outage.wait() < 4

    def test_the_owner_is_told_once_of_the_first_wait_he_would_feel(self):
        outage = Outage((1.0, 3.0), (30.0,), patient_ok=True)
        told = []
        for _ in range(6):
            told.append(outage.announce(outage.wait()))
        assert told == [False, False, True, False, False, False]

    def test_a_long_wait_the_provider_asks_for_is_told_at_once(self):
        outage = Outage((1.0, 3.0), (30.0,), patient_ok=False)
        assert [outage.announce(outage.wait(retry_after=45.0)), outage.announce(outage.wait(retry_after=60.0))] == [True, False]

    def test_waits_that_are_over_in_a_moment_are_never_told(self):
        outage = Outage((1.0, 3.0, 8.0), (), patient_ok=False)
        assert not any(outage.announce(outage.wait()) for _ in range(3))

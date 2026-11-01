"""Routine confirmations describe the schedule the owner actually saved."""
import pytest

from raphael_core.agent.harness_tools import routine_event


@pytest.mark.parametrize("language,expected", [
    ("zh-TW", ["一次 · 2099-03-04 09:30", "平日 09:30", "每天 09:30", "每週一、週五 09:30", "每 3 小時"]),
    ("ja", ["一度 · 2099-03-04 09:30", "平日 09:30", "毎日 09:30", "毎週月・金 09:30", "3時間ごと"]),
    ("en", ["Once · 2099-03-04 09:30", "Weekdays at 09:30", "Daily 09:30", "Weekly Mon, Fri 09:30", "Every 3 hours"]),
])
@pytest.mark.parametrize("index,kind", list(enumerate(("once", "weekdays", "daily", "weekly", "every"))))
def test_every_schedule_kind_is_said_in_the_owners_language(language, expected, index, kind):
    schedule = {"kind": kind, "time": "09:30", "days": [1, 5], "hours": 3}
    if kind == "once":
        schedule["start_date"] = "2099-03-04"
    text = routine_event("routine_create", {"routine": {"title": "Review", "schedule": schedule}}, language)
    assert text.endswith(f" · {expected[index]} Review")


@pytest.mark.parametrize("language,start,end,limit", [
    ("zh-TW", "自 2099-03-04 起", "至 2099-03-31", "最多 5 次"),
    ("ja", "2099-03-04から", "2099-03-31まで", "最大5回"),
    ("en", "from 2099-03-04", "until 2099-03-31", "at most 5 runs"),
])
@pytest.mark.parametrize("kind", ["once", "weekdays", "daily", "weekly", "every"])
@pytest.mark.parametrize("action", ["routine_create", "routine_update", "routine_delete"])
def test_confirmations_include_start_end_and_run_limit(language, start, end, limit, kind, action):
    schedule = {"kind": kind, "time": "09:30", "days": [1], "hours": 3,
                "start_date": "2099-03-04", "until": "2099-03-31", "max_runs": 5}
    text = routine_event(action, {"routine": {"title": "Review", "schedule": schedule}}, language)
    assert text.count("2099-03-04") == 1
    assert start in text if kind != "once" else "2099-03-04 09:30" in text
    assert end in text and limit in text


@pytest.mark.parametrize("language,expected", [("zh-TW", "每 1 小時"), ("ja", "1時間ごと"), ("en", "Every hour")])
def test_hourly_confirmation_uses_a_single_hour(language, expected):
    text = routine_event("routine_create", {"routine": {"title": "Review", "schedule": {"kind": "every", "hours": 1}}}, language)
    assert text.endswith(f" · {expected} Review")


@pytest.mark.parametrize("language,expected", [
    ("zh-TW", "當 Example 有符合 label = review 的新項目"),
    ("ja", "Example に label = review と一致する新しい項目があるとき"),
    ("en", "When Example has a new item matching label = review"),
])
def test_event_routines_keep_their_condition_instead_of_a_clock_schedule(language, expected):
    text = routine_event("routine_create", {"routine": {"title": "Review", "schedule": None,
        "app_name": "Example", "when": {"app": "example", "filter": {"field": "label", "equals": "review"}}}}, language)
    assert text.endswith(f" · {expected} Review")

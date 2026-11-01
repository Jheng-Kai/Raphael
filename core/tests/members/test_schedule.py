"""Tests for the schedules of routines: what is taken, and when each is next due."""

from datetime import datetime, timedelta, timezone

import pytest

from raphael_core.members.schedule import Schedule, ScheduleError, next_run, parse_schedule

TZ = timezone(timedelta(hours=8))


def ms(*parts):
    return int(datetime(*parts, tzinfo=TZ).timestamp() * 1000)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ({"kind": "daily", "time": "09:00"}, Schedule("daily", time="09:00")),
        (
            {"kind": "weekly", "days": [5, 1, 1], "time": "23:59"},
            Schedule("weekly", time="23:59", days=(1, 5)),
        ),
        ({"kind": "every", "hours": 1}, Schedule("every", hours=1)),
        ({"kind": "every", "hours": 24}, Schedule("every", hours=24)),
    ],
)
def test_a_schedule_is_taken_and_written_back(value, expected):
    schedule = parse_schedule(value)
    assert schedule == expected
    assert parse_schedule(schedule.to_json()) == schedule


@pytest.mark.parametrize(
    "value",
    [
        None,
        [],
        {"kind": "monthly", "time": "09:00"},
        {"kind": "daily"},
        {"kind": "daily", "time": "9:00"},
        {"kind": "daily", "time": "24:00"},
        {"kind": "daily", "time": "09:60"},
        {"kind": "weekly", "time": "09:00"},
        {"kind": "weekly", "days": [], "time": "09:00"},
        {"kind": "weekly", "days": [7], "time": "09:00"},
        {"kind": "weekly", "days": [True], "time": "09:00"},
        {"kind": "weekly", "days": ["1"], "time": "09:00"},
        {"kind": "every", "hours": 0},
        {"kind": "every", "hours": 25},
        {"kind": "every", "hours": 1.5},
        {"kind": "every", "hours": True},
    ],
)
def test_a_schedule_out_of_range_is_refused(value):
    with pytest.raises(ScheduleError):
        parse_schedule(value)


def test_a_daily_routine_is_next_due_today_or_tomorrow_at_its_time():
    daily = Schedule("daily", time="09:00")
    assert next_run(daily, ms(2026, 10, 23, 8, 59), tz=TZ) == ms(2026, 10, 23, 9, 0)
    # Strictly after: at nine it is due again tomorrow.
    assert next_run(daily, ms(2026, 10, 23, 9, 0), tz=TZ) == ms(2026, 10, 24, 9, 0)
    assert next_run(daily, ms(2026, 10, 23, 22, 0), tz=TZ) == ms(2026, 10, 24, 9, 0)


def test_a_weekly_routine_counts_the_days_from_sunday_as_the_app_does():
    # 2026-10-23 is a Friday (5); 0 is Sunday and 1 Monday, as Date.getDay counts them.
    monday_and_friday = Schedule("weekly", time="18:30", days=(1, 5))
    assert next_run(monday_and_friday, ms(2026, 10, 23, 10, 0), tz=TZ) == ms(2026, 10, 23, 18, 30)
    assert next_run(monday_and_friday, ms(2026, 10, 23, 19, 0), tz=TZ) == ms(2026, 10, 26, 18, 30)
    sunday = Schedule("weekly", time="07:00", days=(0,))
    assert next_run(sunday, ms(2026, 10, 23, 10, 0), tz=TZ) == ms(2026, 10, 25, 7, 0)
    # The same day a week later, when the time has passed today.
    friday = Schedule("weekly", time="09:00", days=(5,))
    assert next_run(friday, ms(2026, 10, 23, 10, 0), tz=TZ) == ms(2026, 10, 30, 9, 0)


def test_an_hourly_routine_is_next_due_so_many_hours_on():
    assert next_run(Schedule("every", hours=3), 1_000) == 1_000 + 3 * 3_600_000


def test_without_a_time_zone_the_local_time_of_this_pc_is_used():
    daily = Schedule("daily", time="09:00")
    after = int(datetime(2026, 10, 23, 8, 0).timestamp() * 1000)  # naive: this PC's local time
    due = datetime.fromtimestamp(next_run(daily, after) / 1000)
    assert (due.year, due.month, due.day, due.hour, due.minute) == (2026, 10, 23, 9, 0)


def test_window_reanchors_each_local_day_and_keeps_its_last_time():
    value = {"kind": "every", "hours": 3, "from": "08:00", "to": "23:00"}
    schedule = parse_schedule(value)
    assert schedule.to_json() == value
    at = ms(2026, 10, 23, 7)
    actual = []
    for _ in range(7):
        at = next_run(schedule, at, tz=TZ)
        actual.append(at)
    assert actual == [ms(2026, 10, 23, hour) for hour in (8, 11, 14, 17, 20, 23)] + [ms(2026, 10, 24, 8)]


@pytest.mark.parametrize("window", [
    {"from": "08:00"}, {"to": "23:00"}, {"from": "23:00", "to": "08:00"},
    {"from": "08:00", "to": "08:00"}, {"from": "24:00", "to": "25:00"},
    {"from": "8:00", "to": "23:00"}, {"from": None, "to": "23:00"},
])
def test_bad_windows_are_refused(window):
    with pytest.raises(ScheduleError):
        parse_schedule({"kind": "every", "hours": 3, **window})


def test_window_uses_local_wall_times_across_daylight_saving_and_date_bounds():
    from zoneinfo import ZoneInfo
    zone = ZoneInfo("America/New_York")
    schedule = parse_schedule({"kind": "every", "hours": 3, "from": "08:00", "to": "23:00",
                               "start_date": "2026-03-08", "until": "2026-03-09"})
    stamp = lambda text: int(datetime.fromisoformat(text).replace(tzinfo=zone).timestamp() * 1000)
    assert next_run(schedule, stamp("2026-03-07T22:00"), tz=zone) == stamp("2026-03-08T08:00")
    assert next_run(schedule, stamp("2026-03-08T23:00"), tz=zone) == stamp("2026-03-09T08:00")
    assert next_run(schedule, stamp("2026-03-09T23:00"), tz=zone) is None


@pytest.mark.parametrize("language,words", [("zh-TW", "每 3 小時"), ("ja", "3時間ごと"), ("en", "Every 3 hours")])
def test_model_schema_and_public_routine_wording_include_the_window(language, words):
    from raphael_core.agent.harness_tools import SCHEDULE, routine_event
    assert {"from", "to"} <= SCHEDULE["properties"].keys()
    assert "one routine" in SCHEDULE["description"]
    text = routine_event("routine_create", {"routine": {"title": "Review", "schedule": {
        "kind": "every", "hours": 3, "from": "08:00", "to": "23:00"}}}, language)
    assert words in text and "08:00" in text and "23:00" in text

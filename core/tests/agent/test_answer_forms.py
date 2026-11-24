import json

import pytest

from raphael_core.agent import persona
from raphael_core.answer_forms import forms_plain_text
from raphael_core.messaging.words import compose


@pytest.mark.parametrize("language", persona.LANGUAGES)
def test_forms_schema_reaches_api_cli_and_background_prompts(language):
    member = dict(name="Member", role="Assistant", instructions="", personality="")
    prompts = [persona.system_prompt("answer"), persona.cli_system_prompt(),
               persona.member_system_prompt("answer", **member), persona.cli_system_prompt(**member),
               persona.worker_system_prompt(model_calls=5, tool_calls=10),
               persona.member_worker_system_prompt(**member, model_calls=5, tool_calls=10)]
    for prompt in prompts:
        for word in ("```forecast", "```board", "```chart", '"days"', '"columns"', '"series"', "show_page only"):
            assert word in prompt


@pytest.mark.parametrize("kind,data,expected", [
    ("forecast", {"place": "Harbor", "units": "C", "days": [{"day": "Monday", "condition": "Cloudy", "high": 24, "low": 18}]}, ["Harbor", "Monday", "Cloudy", "24", "18"]),
    ("board", {"columns": [{"title": "Ready", "cards": [{"title": "Review", "line": "Check dates", "owner": "Alex"}]}]}, ["Ready", "Review", "Check dates", "Alex"]),
    ("chart", {"type": "line", "title": "Visitors", "units": "people", "labels": ["Mon"], "series": [{"name": "Visits", "values": [3]}]}, ["Visitors", "people", "Mon", "Visits", "3"]),
])
def test_messaging_turns_forms_into_readable_words(kind, data, expected):
    text = f"```{kind}\n{json.dumps(data)}\n```"
    result = forms_plain_text(compose("", text, None))
    assert "{" not in result
    assert "```" not in result
    for word in expected:
        assert word in result


def test_unclosed_forms_and_forms_inside_code_keep_the_original_words():
    data = '{"columns":[{"title":"Ready","cards":[]}]}'
    text = "```board\n" + data
    assert forms_plain_text(text) == text
    outer = "````text\n```board\n" + data + "\n```\n````"
    assert forms_plain_text(outer) == outer


@pytest.mark.parametrize("kind,data", [
    ("forecast", {}), ("board", {}), ("chart", {}),
    ("forecast", {"place": "Harbor", "units": "C", "days": []}),
    ("board", {"columns": [{"title": "Ready", "cards": [{"title": "Task", "extra": True}]}]}),
    ("board", {"columns": [{"title": "Ready", "cards": [{"title": "Task"}] * 21}]}),
    ("chart", {"type": "line", "title": "A", "units": "B", "labels": ["Mon"], "series": [{"name": "C", "values": [float("inf")]}]}),
])
def test_invalid_forms_remain_literal_on_external_paths(kind, data):
    source = f"```{kind}\n{json.dumps(data)}\n```"
    assert forms_plain_text(source) == source


def test_weather_tool_description_nudges_all_snapshot_consumers_to_forecast():
    from raphael_core.background.snapshot import _DEFINITIONS
    assert "forecast fenced block" in _DEFINITIONS["weather"]["description"]


FULL_FORECAST = {
    "place": "Taipei", "units": "C",
    "now": {"temp": 24, "condition": "Cloudy", "feels": 23, "humidity": 74, "wind": "18 km/h"},
    "hours": [{"time": "15:00", "condition": "Rain", "temp": 23, "rain": 40}, {"time": "16:00", "condition": "Cloudy", "temp": 22}],
    "days": [{"day": "Mon", "condition": "Rain", "high": 27, "low": 21, "rain": 40}, {"day": "Tue", "condition": "Clear", "high": 28, "low": 22}],
    "source": "Open-Meteo", "updated": "16:00",
}


def _fence(form):
    return "```forecast\n" + json.dumps(form) + "\n```"


def test_a_full_forecast_reads_as_compact_lines():
    assert forms_plain_text(_fence(FULL_FORECAST)).split("\n") == [
        "Taipei",
        "Now: Cloudy 24 (feels 23), humidity 74%, wind 18 km/h",
        "Hours: 15:00 Rain 23 (40%), 16:00 Cloudy 22",
        "Mon: Rain, 27 / 21 C rain 40%",
        "Tue: Clear, 28 / 22 C",
        "Source: Open-Meteo, updated 16:00",
    ]


def test_an_old_forecast_with_four_keys_per_day_reads_exactly_as_before():
    old = {"place": "Harbor", "units": "C", "days": [{"day": "Monday", "condition": "Cloudy", "high": 24, "low": 18}]}
    assert forms_plain_text(_fence(old)) == "Harbor\nMonday: Cloudy, 24 / 18 C"


def test_optional_forecast_parts_may_be_partial():
    days = [{"day": "Monday", "condition": "Clear", "high": 6, "low": 1}]
    part = {"place": "Harbor", "units": "C", "now": {"temp": 5, "condition": "Clear"}, "source": "Open-Meteo", "days": days}
    assert forms_plain_text(_fence(part)).split("\n") == ["Harbor", "Now: Clear 5", "Monday: Clear, 6 / 1 C", "Source: Open-Meteo"]
    part = {"place": "Harbor", "units": "C", "updated": "16:00", "days": days}
    assert forms_plain_text(_fence(part)).endswith("\nUpdated: 16:00")


def _changed(path, value):
    """FULL_FORECAST with the value at `path` (keys and list indexes joined by "/") replaced, or removed for None."""
    form = json.loads(json.dumps(FULL_FORECAST))
    *parents, last = path.split("/")
    target = form
    for key in parents:
        target = target[int(key)] if key.isdigit() else target[key]
    key = int(last) if last.isdigit() else last
    if value is None and isinstance(target, dict):
        target.pop(key)
    else:
        target[key] = value
    return form


@pytest.mark.parametrize("path,value", [
    ("extra", 1), ("now", []), ("now", 5), ("now", {"temp": 24}), ("now/extra", 1), ("now/temp", 1001), ("now/feels", -1001),
    ("now/humidity", 101), ("now/humidity", -1), ("now/wind", ""), ("now/wind", "x" * 161), ("now/temp", True),
    ("now/condition", " "), ("now/humidity", float("nan")),
    ("hours", []), ("hours", [FULL_FORECAST["hours"][0]] * 25), ("hours/0/extra", 1), ("hours/0/time", None),
    ("hours/0/rain", 101), ("hours/0/rain", "40"), ("hours/0/temp", 2000),
    ("days/0/rain", 101), ("days/0/rain", -1), ("days/0/rain", float("nan")), ("days/0/extra", 1), ("days/0/low", 30),
    ("source", ""), ("updated", 5), ("source", "x" * 161),
])
def test_invalid_optional_forecast_fields_keep_the_form_literal(path, value):
    source = _fence(_changed(path, value))
    assert forms_plain_text(source) == source


def test_the_limits_of_the_optional_forecast_fields_are_valid():
    form = _changed("now/humidity", 0)
    form["now"]["temp"] = -1000
    form["hours"] = [{"time": "00:00", "condition": "Clear", "temp": 1000, "rain": 100}] * 24
    text = forms_plain_text(_fence(form))
    assert "```" not in text and "humidity 0%" in text
    assert text.count("(100%)") == 24

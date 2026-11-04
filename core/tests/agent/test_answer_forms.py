import json

import pytest

from raphael_core.agent import persona
from raphael_core.answer_forms import forms_plain_text
from raphael_core.messaging.words import compose
from raphael_core.services.speaker import speakable


@pytest.mark.parametrize("language", persona.LANGUAGES)
def test_forms_schema_reaches_api_cli_and_background_prompts(language):
    member = dict(name="Member", role="Assistant", instructions="", personality="")
    prompts = [persona.system_prompt(language, "answer"), persona.cli_system_prompt(language),
               persona.member_system_prompt(language, "answer", **member), persona.cli_system_prompt(language, **member),
               persona.worker_system_prompt(language, model_calls=5, tool_calls=10),
               persona.member_worker_system_prompt(language, **member, model_calls=5, tool_calls=10)]
    for prompt in prompts:
        for word in ("```forecast", "```board", "```chart", '"days"', '"columns"', '"series"', "show_page only"):
            assert word in prompt


@pytest.mark.parametrize("kind,data,expected", [
    ("forecast", {"place": "Harbor", "units": "C", "days": [{"day": "Monday", "condition": "Cloudy", "high": 24, "low": 18}]}, ["Harbor", "Monday", "Cloudy", "24", "18"]),
    ("board", {"columns": [{"title": "Ready", "cards": [{"title": "Review", "line": "Check dates", "owner": "Alex"}]}]}, ["Ready", "Review", "Check dates", "Alex"]),
    ("chart", {"type": "line", "title": "Visitors", "units": "people", "labels": ["Mon"], "series": [{"name": "Visits", "values": [3]}]}, ["Visitors", "people", "Mon", "Visits", "3"]),
])
def test_messaging_and_speech_turn_forms_into_readable_words(kind, data, expected):
    text = f"```{kind}\n{json.dumps(data)}\n```"
    for result in (forms_plain_text(compose("", text, None)), speakable(text)):
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

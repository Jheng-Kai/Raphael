"""Unattended consumers read the persisted device language rather than the last turn."""

import json

import pytest

from raphael_core.agent.owner_language import configured_language
from .test_wiring import app  # noqa: F401


@pytest.mark.parametrize(("document", "expected"), [
    ({}, None), ({"ui_language": 7}, None), ([], None), ({"ui_language": "unknown"}, None),
    ({"ui_language": "zh-TW"}, "zh-TW"), ({"ui_language": "en"}, "en"),
])
def test_only_a_valid_device_language_overrides_the_turn_without_writes(tmp_path, document, expected):
    path = tmp_path / "device.json"
    path.write_text(json.dumps(document))
    before = path.read_bytes()
    assert configured_language(tmp_path) == expected
    assert path.read_bytes() == before


@pytest.mark.parametrize("contents", [None, "{invalid json"])
def test_unreadable_device_language_leaves_the_turn_default_available(tmp_path, contents):
    path = tmp_path / "device.json"
    if contents is not None:
        path.write_text(contents)
    assert configured_language(tmp_path) is None
    assert path.read_text() == contents if path.exists() else contents is None


@pytest.mark.parametrize("language", ["en", "ja"])
async def test_unconfigured_background_keeps_its_own_turn_language(app, monkeypatch, language):
    app.agent._last_language = "zh-TW"
    monkeypatch.setattr(app.background, "_ensure_pump", lambda: None)
    task_id = app.background.submit(session_id="unconfigured", text="Check", language=language, model="fake/model")
    assert app.background.task(task_id).language == language


async def test_routine_and_messaging_language_is_stable_after_an_english_turn(app, tmp_path, monkeypatch):
    path = tmp_path / "device.json"
    path.write_text('{"ui_language":"zh-TW"}')
    await app._ask_from_messaging("telegram:42", "Hello", "en", "telegram")
    app.agent._last_language = "en"
    assert app.agent.language == app.messaging._language() == app.members._language() == "zh-TW"
    monkeypatch.setattr(app.background, "_ensure_pump", lambda: None)
    task_id = app.background.submit(session_id="language", text="Check", language="en", model="fake/model")
    assert app.background.task(task_id).language == "zh-TW"
    routine = (await app.call("routines.create", {"member_id": 0, "title": "Daily check", "prompt": "Check",
        "schedule": {"kind": "daily", "time": "09:00"}, "enabled": False}))["routine"]
    task_id = app.members._run(app.members.store.routine(routine["id"]), test_run=True)
    assert app.background.task(task_id).language == "zh-TW"
    path.write_text('{"ui_language":"ja"}')
    assert app.agent.language == app.messaging._language() == app.members._language() == "ja"

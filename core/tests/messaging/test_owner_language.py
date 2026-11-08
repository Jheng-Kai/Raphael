"""Unattended consumers read the persisted device language rather than the last turn."""

import json

import pytest

from raphael_core.agent.owner_language import configured_language
from .test_wiring import app  # noqa: F401


@pytest.mark.parametrize("document", [{}, {"ui_language": 7}, [], {"ui_language": "zh-TW"}])
def test_missing_or_invalid_device_language_defaults_without_writes(tmp_path, document):
    path = tmp_path / "device.json"
    path.write_text(json.dumps(document))
    before = path.read_bytes()
    assert configured_language(tmp_path) == "zh-TW"
    assert path.read_bytes() == before


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

"""Raphael has no voice: nothing speaks, nothing makes an audio file, and the settings a voice once
kept are left alone. (Speech-to-text, dictation and dictated `voice` turns are not part of this.)"""

import json
from types import SimpleNamespace

import pytest

from agent.conftest import actions, client  # noqa: F401
from agent.test_narration import chat, typed
from agent.test_service import make_rig  # noqa: F401
from raphael_core.agent.cli.loop import CliLoop
from raphael_core.agent.mcp_server import RaphaelMcp
from raphael_core.app import App
from raphael_core.background.snapshot import take_snapshot
from raphael_core.brain.db import connect
from raphael_core.brain.settings import DEFAULTS, SettingsStore
from raphael_core.paths import db_path
from raphael_core.protocol import RpcError
from raphael_core.services.hub import ServiceHub
from raphael_core.services.keys import ServiceKeys
from raphael_core.worker.loop import Outcome

OLD_VOICE_ROWS = {
    "tts_enabled": True,
    "tts_service": "fish",
    "tts_fish_voice": "0123456789abcdef0123456789abcdef",
    "tts_fish_model": "s2.1-pro-free",
    "tts_language": "ja",
}


@pytest.fixture
async def app(tmp_path):
    made = App(data_dir=tmp_path, fake_llm=True, load_kit=lambda: SimpleNamespace())
    yield made
    await made.aclose()


async def test_the_app_offers_no_voice(app, make_rig, client, monkeypatch):  # noqa: F811
    voice_methods = [name for name in app.methods() if name.startswith(("tts.", "voice_chat."))]
    assert voice_methods == []
    assert "agent.speech.status" not in app.methods() and "members.voices" not in app.methods()

    assert "voice" not in await app.call("services.status", {})
    assert "voice" not in await app.call("services.status", {"include_backends": True})
    assert [key for key in DEFAULTS if key.startswith("tts_")] == []
    assert all("voice" not in member for member in (await app.call("members.list", {}))["members"])

    # The background worker's tools.
    snapshot = take_snapshot(None)
    assert "generate_audio" not in snapshot.refs
    assert "generate_audio" not in [item["function"]["name"] for item in snapshot.definitions]

    # The API path, then the CLI and MCP path: the tools one request is offered.
    rig = make_rig()
    client.chats = [chat("Checking the time.", ("local_time", {})), chat(json.dumps({"prefix": "Answer", "text": "Now."}))]
    await typed(rig)
    assert "local_time" in {item["function"]["name"] for item in client.chat_calls[0]["tools"]}
    assert "generate_audio" not in {item["function"]["name"] for call in client.chat_calls for item in call["tools"]}

    offered = []

    async def fake_cli(loop):
        offered.extend(item["function"]["name"] for item in loop.tools)
        listed = await RaphaelMcp(lambda: loop.tools, loop._tool)._dispatch({"method": "tools/list", "id": "list"})
        offered.extend(item["name"] for item in listed["result"]["tools"])
        loop._queue.put_nowait(Outcome("done", final="Finished."))

    monkeypatch.setattr(CliLoop, "_work", fake_cli)
    rig.settings.set("agent_model", "cli:codex")
    client.chats = [chat('{"text":"Finished."}')]
    await typed(rig, "Check again")
    assert "local_time" in offered and "generate_audio" not in offered


async def test_saved_voice_settings_survive(tmp_path):
    path = db_path(tmp_path)
    conn = connect(path)
    with conn:
        for key, value in OLD_VOICE_ROWS.items():
            conn.execute("INSERT INTO settings (key, value) VALUES (?, ?)", (key, json.dumps(value)))
    conn.close()

    conn = connect(path)  # opened again by the current code
    settings = SettingsStore(conn)
    assert settings.get("agent_model") == DEFAULTS["agent_model"]
    assert not [key for key in settings.all() if key.startswith("tts_")]
    for key in OLD_VOICE_ROWS:
        with pytest.raises(KeyError):
            settings.get(key)
        with pytest.raises(KeyError):
            settings.set(key, OLD_VOICE_ROWS[key])
    settings.set("agent_city", "Taipei")  # an ordinary write beside them

    # The key of the voice service stays in the vault: nothing here asks for it, reads it or removes it.
    asked = []
    keys = ServiceKeys(lambda service: asked.append(service) or SimpleNamespace(get=lambda: None, clear=lambda: asked.append("cleared")))
    hub = ServiceHub(conn, object(), keys)
    status = hub.status(include_backends=True)
    assert "voice" not in status
    with pytest.raises(RpcError):
        await hub._clear_key({"service": "fish"})
    assert "fish" not in asked and "cleared" not in asked

    rows = {row["key"]: json.loads(row["value"]) for row in conn.execute("SELECT key, value FROM settings")}
    assert {key: rows[key] for key in OLD_VOICE_ROWS} == OLD_VOICE_ROWS
    conn.close()


async def test_a_database_with_the_old_voice_rows_starts_the_app_and_keeps_them(tmp_path):
    conn = connect(db_path(tmp_path))
    with conn:
        for key, value in OLD_VOICE_ROWS.items():
            conn.execute("INSERT INTO settings (key, value) VALUES (?, ?)", (key, json.dumps(value)))
    conn.close()

    made = App(data_dir=tmp_path, fake_llm=True, load_kit=lambda: SimpleNamespace())
    try:
        status = await made.call("services.status", {})
        assert "voice" not in status and status["search"]["service"] == "openrouter"
        assert not [key for key in await made.call("settings.get", {}) if key.startswith("tts_")]
    finally:
        await made.aclose()

    conn = connect(db_path(tmp_path))
    rows = {row["key"]: json.loads(row["value"]) for row in conn.execute("SELECT key, value FROM settings")}
    conn.close()
    assert {key: rows[key] for key in OLD_VOICE_ROWS} == OLD_VOICE_ROWS

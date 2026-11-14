"""Model discovery uses public metadata, never inference or credential contents."""

import json
import sys
import asyncio

from raphael_core.agent.cli.models import claude_cli_models, claude_models, claude_rows, agy_models, codex_models
from raphael_core.agent.cli.discovery import brain_ref, brain_effort

import pytest


@pytest.fixture(autouse=True)
def no_program_read(monkeypatch):
    """The fake CLIs here are Python scripts: there is no program file of the CLI's to read its registry from."""
    monkeypatch.setattr("raphael_core.agent.cli.models.claude_registry", lambda command: [])


def test_quick_effort_uses_cached_supported_levels_and_driver_mapping(tmp_path):
    from raphael_core.agent.cli.discovery import CliBrains
    brains = CliBrains(home=tmp_path, environ={})
    brains._models["codex"] = [
        {"id": "cli:codex:fast", "is_default": True, "reasoning_efforts": ["low", "medium"]},
        {"id": "cli:codex:plain", "reasoning_efforts": []},
    ]
    brains._models["gemini"] = [{"id": "cli:gemini:argon", "reasoning_efforts": ["low", "high"],
        "effort_models": {"low": "cli:gemini:argon-low", "high": "cli:gemini:argon-high"}}]
    assert brains.with_effort("cli:codex", "high") == "cli:codex:fast?effort=low"
    assert brains.with_effort("cli:codex:fast?effort=high", "medium") == "cli:codex:fast?effort=medium"
    assert brains.with_effort("cli:codex:plain", "low") == "cli:codex:plain"
    assert brains.with_effort("cli:gemini:argon-high", "low") == "cli:gemini:argon-low"


def test_claude_config_resolves_alias_default(tmp_path):
    folder = tmp_path / ".claude"
    folder.mkdir()
    (folder / "settings.json").write_text(json.dumps({"model": "opus"}))
    models = claude_models(folder)
    assert [m["id"] for m in models] == ["cli:claude:opus", "cli:claude:fable", "cli:claude:sonnet", "cli:claude:haiku"]
    assert next(m for m in models if m["is_default"])["id"] == "cli:claude:opus"
    assert all(m["name"].startswith("Claude ") and m["description"] for m in models)
    assert all(m["reasoning_efforts"] == ["low", "medium", "high", "xhigh", "max"] for m in models)


# The shape the installed CLI (2.1.316) answers `initialize` with, seen live on 2026-10-31.
CLAUDE_INITIALIZE = [
    {"value": "default", "resolvedModel": "claude-opus-5-5", "displayName": "Default (recommended)", "supportedEffortLevels": ["low", "max"]},
    {"value": "opus", "resolvedModel": "claude-opus-5-5", "displayName": "Opus 5.5", "description": "For complex work", "supportsEffort": True,
     "supportedEffortLevels": ["low", "medium", "high", "xhigh", "max"]},
    {"value": "fable", "resolvedModel": "claude-fable-5-1", "displayName": "Fable 5.1", "description": "For your toughest challenges",
     "supportedEffortLevels": ["low", "medium", "high", "xhigh", "max"]},
    {"value": "claude-haiku-4-5-20251001", "resolvedModel": "claude-haiku-4-5-20251001", "displayName": "Haiku 4.5", "description": "Fastest"},
    {"value": "bad value", "displayName": "Refused"},
]


def test_claude_lists_what_the_cli_says_and_each_model_its_own_depths():
    models = claude_rows(CLAUDE_INITIALIZE, {})
    assert [m["id"] for m in models] == ["cli:claude:claude-opus-5-5", "cli:claude:claude-fable-5-1", "cli:claude:claude-haiku-4-5-20251001"]
    assert models[0]["name"] == "Claude Opus 5.5" and models[0]["is_default"] and not models[1]["is_default"]
    assert models[1]["reasoning_efforts"] == ["low", "medium", "high", "xhigh", "max"] and models[1]["default_effort"] == "high"
    assert models[2]["reasoning_efforts"] == [] and models[2]["default_effort"] is None


def test_the_owner_default_in_their_settings_wins_over_the_cli_default():
    assert next(m for m in claude_rows(CLAUDE_INITIALIZE, {"model": "fable"}) if m["is_default"])["id"] == "cli:claude:claude-fable-5-1"


def _fake_claude(tmp_path, body):
    script = tmp_path / "claude.py"
    script.write_text(body, encoding="utf-8")
    return [sys.executable, str(script)]


async def test_claude_is_asked_on_its_control_channel_with_no_settings_and_no_message(tmp_path):
    command = _fake_claude(tmp_path, '''import json, sys
assert "--setting-sources" in sys.argv and sys.argv[sys.argv.index("--setting-sources") + 1] == ""
asked = json.loads(sys.stdin.readline())
assert asked["type"] == "control_request" and asked["request"]["subtype"] == "initialize"
print(json.dumps({"type": "system", "subtype": "init"}))
print(json.dumps({"type": "control_response", "response": {"subtype": "success", "response": {"models": json.loads(%r)}}}), flush=True)
''' % json.dumps(CLAUDE_INITIALIZE))
    models = await claude_cli_models(command, {**__import__("os").environ}, tmp_path)
    assert [m["id"] for m in models][:2] == ["cli:claude:claude-opus-5-5", "cli:claude:claude-fable-5-1"]


async def test_the_claude_models_arrive_in_the_list_and_a_silent_cli_leaves_the_known_ones(tmp_path):
    from raphael_core.agent.cli.discovery import CliBrains
    import os
    folder = tmp_path / ".claude"
    folder.mkdir()
    (folder / ".credentials.json").write_text("{}")
    good = _fake_claude(tmp_path, '''import json, sys
if "--version" in sys.argv: print("2.1.316"); raise SystemExit
sys.stdin.readline()
print(json.dumps({"type": "control_response", "response": {"subtype": "success", "response": {"models": json.loads(%r)}}}), flush=True)
''' % json.dumps(CLAUDE_INITIALIZE))
    brains = CliBrains(home=tmp_path, environ=dict(os.environ), commands={"claude": good})
    try:
        before = next(c for c in (await brains.list())["clis"] if c["id"] == "claude")
        assert [m["id"] for m in before["models"]][0] == "cli:claude:opus" and len(before["models"]) == 4
        await brains._model_refresh
        after = next(c for c in (await brains.list())["clis"] if c["id"] == "claude")
        assert [m["id"] for m in after["models"]] == ["cli:claude:claude-opus-5-5", "cli:claude:claude-fable-5-1", "cli:claude:claude-haiku-4-5-20251001"]
        assert brains.model_name("cli:claude:fable?effort=max") == "Claude Fable 5.1"
        assert brains.model_name("cli:claude:unknown") == "Claude Code"
        assert brains.model_name("openai/gpt") is None
    finally:
        await brains.aclose()
    silent = _fake_claude(tmp_path, 'import sys\nif "--version" in sys.argv: print("2.1.316")\n')
    brains = CliBrains(home=tmp_path, environ=dict(os.environ), commands={"claude": silent})
    try:
        await brains.list()
        await brains._model_refresh
        listed = next(c for c in (await brains.list())["clis"] if c["id"] == "claude")
        assert len(listed["models"]) == 4
    finally:
        await brains.aclose()


def test_agy_collapses_efforts_and_resolves_display_default(tmp_path):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"model": "Gemini Argon High"}))
    models = agy_models("gemini-4-argon-low\tGemini Argon Low\ngemini-4-argon-high\tGemini Argon High\n", settings)
    assert len(models) == 1
    assert models[0]["reasoning_efforts"] == ["low", "high"]
    assert models[0]["is_default"] and models[0]["default_effort"] == "high"
    assert models[0]["id"] == "cli:gemini:gemini-4-argon"
    assert models[0]["effort_models"]["low"] == "cli:gemini:gemini-4-argon-low"


async def test_antigravity_uses_public_model_command_and_google_account_file(tmp_path):
    from raphael_core.agent.cli.discovery import CliBrains

    script = tmp_path / "agy.py"
    script.write_text('''import sys
if sys.argv[1:] == ["--version"]:
    print("agy 1.0")
else:
    assert sys.argv[1:] == ["models"]
    print("gemini-4-argon-low\\tGemini Argon Low")
    print("claude-opus-5-5-high\\tClaude Opus 5.5 High")
''', encoding="utf-8")
    folder = tmp_path / ".gemini"
    (folder / "antigravity-cli").mkdir(parents=True)
    (folder / "google_accounts.json").write_text("not credential JSON")
    (folder / "antigravity-cli" / "settings.json").write_text(json.dumps({"model": "Gemini Argon Low"}))
    brains = CliBrains(home=tmp_path, environ={}, commands={"gemini": [sys.executable, str(script)]})
    try:
        source = (await brains.list())["clis"][2]
        assert source["name"] == "Antigravity" and source["logged_in"] is True
        assert source["login_command"] == "agy"
        await asyncio.wait_for(brains._model_refresh, 3)
        source = (await brains.list())["clis"][2]
        assert [m["provider"] for m in source["models"]] == ["Google", "Anthropic"]
        assert source["models"][0]["is_default"]
    finally:
        await brains.aclose()


def test_antigravity_windows_executable_keeps_gemini_id(tmp_path):
    from raphael_core.agent.cli.discovery import CliBrains

    executable = tmp_path / "agy" / "bin" / "agy.exe"
    executable.parent.mkdir(parents=True)
    executable.touch()
    brains = CliBrains(home=tmp_path, environ={"PATH": "", "LOCALAPPDATA": str(tmp_path)})
    assert brains.command("gemini") == [str(executable)]


async def test_codex_public_model_list_protocol_pagination_hidden_and_config_default(tmp_path):
    script = tmp_path / "models.py"
    script.write_text('''import json, sys
def send(id, result):
    print(json.dumps({"jsonrpc":"2.0","id":id,"result":result}), flush=True)
initialized = False
for line in sys.stdin:
    p=json.loads(line)
    if p.get("method")=="initialize":
        send(p["id"], {})
    elif p.get("method")=="initialized":
        initialized=True
    elif p.get("method")=="model/list":
        assert initialized
        if p["params"].get("cursor"):
            send(p["id"], {"data":[{"id":"small","model":"small","displayName":"Small","isDefault":False,"supportedReasoningEfforts":[{"reasoningEffort":"low"},{"reasoningEffort":"high"}],"defaultReasoningEffort":"high"}],"nextCursor":None})
        else:
            send(p["id"], {"data":[{"id":"hidden","hidden":True},{"id":"large","model":"large","displayName":"Large","isDefault":True}],"nextCursor":"page2"})
''', encoding="utf-8")
    config = tmp_path / "config.toml"
    config.write_text('model = "small"\nmodel_reasoning_effort = "low"\n')
    models = await codex_models([sys.executable, str(script)], {}, config)
    assert [m["id"] for m in models] == ["cli:codex:large", "cli:codex:small"]
    assert [m["is_default"] for m in models] == [False, True]
    assert models[1]["reasoning_efforts"] == ["low", "high"]
    assert models[1]["default_effort"] == "low"


def test_effort_ref_keeps_model_separate_from_transport_setting():
    assert brain_ref("cli:codex:small?effort=high") == ("codex", "small")
    assert brain_effort("cli:codex:small?effort=high") == "high"
    assert brain_ref("cli:codex:small?effort=arbitrary") is None


async def test_discovery_returns_before_model_refresh_and_new_login_populates_cache(tmp_path):
    from raphael_core.agent.cli.discovery import CliBrains

    script = tmp_path / "cached.py"
    script.write_text('''import json, sys, time
if "--version" in sys.argv:
    print("fake 1.0")
    sys.exit(0)
for line in sys.stdin:
    p=json.loads(line)
    if p.get("method")=="initialize":
        print(json.dumps({"id":p["id"],"result":{}}),flush=True)
    elif p.get("method")=="model/list":
        time.sleep(.15)
        print(json.dumps({"id":p["id"],"result":{"data":[{"id":"small","displayName":"Small","isDefault":True}]}}),flush=True)
    else:
        assert p.get("method")=="initialized"
''', encoding="utf-8")
    refreshed = asyncio.Event()
    brains = CliBrains(home=tmp_path, environ={}, commands={"codex": [sys.executable, str(script)]},
                       notify=lambda *_: refreshed.set())
    try:
        result = await brains.list()
        assert result["clis"][1]["logged_in"] is False
        await asyncio.sleep(.02)
        (tmp_path / ".codex").mkdir()
        (tmp_path / ".codex" / "auth.json").touch()
        result = await brains.list()
        assert result["clis"][1]["models"] == []
        refreshed.clear()
        await asyncio.wait_for(refreshed.wait(), 3)
        result = await brains.list()
        assert result["clis"][1]["models"][0]["id"] == "cli:codex:small"
        assert result["clis"][1]["models"][0]["is_default"]
    finally:
        await brains.aclose()


def test_persisted_cli_references_share_the_discovery_display_names():
    from raphael_core.brain.model_ref import CLI_NAMES, cli_name
    from raphael_core.agent.cli.discovery import NAMES
    assert NAMES is CLI_NAMES
    for reference, expected in (("cli:claude?effort=low", "Claude Code"),
                                ("cli:codex:sample?effort=high", "Codex CLI"),
                                ("cli:gemini", "Antigravity"),
                                ("@chatgpt:sample", None), (None, None)):
        assert cli_name(reference) == expected

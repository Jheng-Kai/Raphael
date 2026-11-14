"""The first Bot uses the member settings contract without pinning its localized name."""

import json
import sqlite3
from types import SimpleNamespace

import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.agent.gate import ToolGate
from raphael_core.agent.plugins import PluginTool
from raphael_core.agent.policy import Action, Confirmations, Tier
from raphael_core.agent.speaker import RAPHAEL_NAMES
from raphael_core.agent.service import AgentService
from raphael_core.background.service import BackgroundService, _prompts
from raphael_core.background.run import RunLimits
from raphael_core.background.snapshot import take_snapshot
from raphael_core.brain.settings import SettingsStore, checked
from raphael_core.protocol import INVALID_PARAMS, RpcError

from agent.test_toolpick import Hub
from .test_cover import upload


async def test_personality_without_name_follows_language_and_reads_stored_profile(rig):
    result = await rig.call("members.update", {"id": 0, "personality": "  Patient.  ", "instructions": " Be concise. "})
    assert result["member"]["personality"] == "Patient."
    assert result["member"]["instructions"] == "Be concise."
    assert SettingsStore(rig.conn).get("first_bot_profile") == {"personality": "Patient.", "instructions": "Be concise."}
    assert SettingsStore(rig.conn).get("first_bot_profile").get("name") is None
    rig.language = "ja"
    view = (await rig.call("members.list"))["members"][0]
    assert view["name"] == RAPHAEL_NAMES["ja"]
    assert rig.service.speaker(0).personality == "Patient."


@pytest.mark.parametrize("selection,expected", [(None, None), ([], []), ([" srv-1 ", "srv-1", "mcp:srv-2/read"], ["srv-1", "mcp:srv-2/read"])])
async def test_tools_setting_cleans_and_filters_the_shared_snapshot(rig, selection, expected):
    shown = (await rig.call("members.update", {"id": 0, "tools": selection}))["member"]
    assert shown["tools"] == expected
    assert SettingsStore(rig.conn).get("raphael_tools") == expected
    speaker = rig.service.speaker(0)
    assert speaker.tools == (None if expected is None else frozenset(expected))
    tools = [PluginTool(f"mcp:{server}/read", server, "read", "Read synthetic notes", {"type": "object"}, Tier.T0)
             for server in ("srv-1", "srv-2", "srv-3")]
    snapshot = take_snapshot(Hub(tools), speaker=speaker)
    keys = {tool.key for tool in snapshot.pool.by_alias.values()}
    assert keys == ({tool.key for tool in tools} if expected is None else
                    {tool.key for tool in tools if speaker.uses_plugin(tool.key)})
    assert ("mcp:srv-3/read" in keys) == (expected is None)
    assert "local_time" in snapshot.refs
    team = SimpleNamespace(_team=rig.service)
    assert AgentService._speaker(team, 0).tools == speaker.tools
    assert BackgroundService._speaker(team, 0).tools == speaker.tools


async def test_mixed_request_commits_all_settings_and_one_change_event(rig):
    await rig.call("members.set_cover", upload(0))
    rig.notes.clear()
    statements = []
    rig.conn.set_trace_callback(statements.append)
    try:
        result = await rig.call("members.update", {"id": 0, "personality": "Direct.", "instructions": "Use evidence.",
            "tools": [], "notify": True, "draft_first": False, "cover_position": 37.56})
    finally:
        rig.conn.set_trace_callback(None)
    assert sum(statement.startswith("BEGIN") for statement in statements) == 1
    assert statements.count("COMMIT") == 1
    view = result["member"]
    assert (view["personality"], view["instructions"], view["tools"], view["notify"], view["draft_first"]) == (
        "Direct.", "Use evidence.", [], True, False)
    assert view["cover"]["position"] == 37.6
    assert rig.notes == [("members.changed", {})]
    assert SettingsStore(rig.conn).get("raphael_notify") is True
    assert SettingsStore(rig.conn).get("raphael_draft_first") is False


@pytest.mark.parametrize("patch", [{"unexpected": 1}, {"name": "Pinned"}, {"notify": 1}, {"draft_first": "yes"},
    {"tools": "srv-1"}, {"tools": ["bad\x00id"]}, {"instructions": "x" * 2001}, {"personality": "x" * 2001},
    {"cover_position": 20}, {"cover": "pattern:dots", "cover_position": 20}])
async def test_invalid_mixed_request_never_partially_writes(rig, patch):
    before = [tuple(row) for row in rig.conn.execute("SELECT key,value FROM settings ORDER BY key")]
    rig.notes.clear()
    with pytest.raises(RpcError) as caught:
        await rig.call("members.update", {"id": 0, "personality": "Must not save", "notify": True, **patch})
    assert caught.value.code == INVALID_PARAMS
    assert [tuple(row) for row in rig.conn.execute("SELECT key,value FROM settings ORDER BY key")] == before
    assert rig.notes == []


async def test_cover_io_refusal_rolls_back_profile_and_preferences(rig, monkeypatch):
    before = [tuple(row) for row in rig.conn.execute("SELECT key,value FROM settings ORDER BY key")]

    def refused(*args):
        raise OSError("synthetic cover write refusal")

    monkeypatch.setattr(rig.service._covers, "save", refused)
    with pytest.raises(RpcError):
        await rig.call("members.update", {"id": 0, "personality": "Not saved", "tools": [], "notify": True, "cover": "pattern:dots"})
    assert [tuple(row) for row in rig.conn.execute("SELECT key,value FROM settings ORDER BY key")] == before


async def test_settings_survive_database_reopen_and_drive_the_worker_prompt(rig, tmp_path):
    await rig.call("members.update", {"id": 0, "personality": "PATIENT-PERSONALITY", "instructions": "OWNER-INSTRUCTION",
                                     "tools": [], "notify": True, "draft_first": False})
    path = tmp_path / "saved.sqlite"
    saved = sqlite3.connect(path)
    rig.conn.backup(saved)
    saved.close()
    reopened = sqlite3.connect(path)
    reopened.row_factory = sqlite3.Row
    try:
        settings = SettingsStore(reopened)
        assert settings.get("first_bot_profile") == {"personality": "PATIENT-PERSONALITY", "instructions": "OWNER-INSTRUCTION"}
        assert settings.get("raphael_tools") == []
        assert settings.get("raphael_notify") is True and settings.get("raphael_draft_first") is False
    finally:
        reopened.close()
    prompt, _ = _prompts("Synthetic task", {}, [], RunLimits(), speaker=rig.service.speaker(0))
    assert "PATIENT-PERSONALITY" in prompt and "OWNER-INSTRUCTION" in prompt


async def test_notify_controls_finished_and_needs_input_for_raphael(rig):
    history = AgentHistory(rig.conn)
    settings = SettingsStore(rig.conn)
    assert settings.get("raphael_notify") is False
    rig.service.needs_input(0)
    assert not [data for method, data in rig.notes if method == "member.notice"]
    await rig.call("members.update", {"id": 0, "notify": True})
    rig.service.needs_input(0)
    identifier = history.add(session_id="synthetic", question="Review", route="answer", prefix="", text="Done",
                             status="done", source="app")
    rig.service.turn_arrived(identifier)
    rig.service.turn_arrived(identifier)
    notices = [data for method, data in rig.notes if method == "member.notice"]
    assert [notice["kind"] for notice in notices] == ["needs_input", "finished"]
    assert all(notice == {"member_id": 0, "name": RAPHAEL_NAMES[rig.language], "kind": notice["kind"], "notify": True}
               for notice in notices)
    await rig.call("members.update", {"id": 0, "notify": False})
    rig.service.needs_input(0)
    assert len([data for method, data in rig.notes if method == "member.notice"]) == 2


async def test_agent_tool_uses_same_tools_notify_and_nameless_profile(rig):
    args = {"id": 0, "personality": "Patient.", "tools": [" srv-1 "], "notify": True, "draft_first": False}
    gate = ToolGate(conn=rig.conn)
    action = Action("member_update", args)
    confirmations = Confirmations()
    pending = confirmations.open("test", 1, action, gate.tier(action.tool, action.args), "en")
    approval = confirmations.resolve(pending.id, True, pending.digest).approval
    gate.check(action, approval)
    result = await rig.service.admin_tool(0, "member_update", args, interactive=True, approval=approval)
    assert result["member"]["tools"] == ["srv-1"] and result["member"]["notify"] is True
    assert SettingsStore(rig.conn).get("first_bot_profile") == {"personality": "Patient."}
    assert rig.service.speaker(0).tools == frozenset({"srv-1"})


async def test_agent_profile_without_name_tracks_language_and_explicit_name_is_preserved(rig):
    await rig.service.admin_tool(0, "member_update", {"id": 0, "personality": "Patient."}, interactive=True)
    assert rig.service.first_bot_profile() == {"personality": "Patient."}
    rig.language = "ja"
    assert (await rig.call("members.list"))["members"][0]["name"] == RAPHAEL_NAMES["ja"]
    await rig.service.admin_tool(0, "member_update", {"id": 0, "name": "Morning"}, interactive=True)
    await rig.call("members.update", {"id": 0, "instructions": "Be concise."})
    rig.language = "en"
    assert (await rig.call("members.list"))["members"][0]["name"] == "Morning"
    assert rig.service.first_bot_profile()["name"] == "Morning"


async def test_agent_notify_with_invalid_profile_never_partially_writes(rig):
    before = [tuple(row) for row in rig.conn.execute("SELECT key,value FROM settings ORDER BY key")]
    with pytest.raises(RpcError):
        await rig.service.admin_tool(0, "member_update", {"id": 0, "notify": True, "personality": "x" * 2001}, interactive=True)
    assert [tuple(row) for row in rig.conn.execute("SELECT key,value FROM settings ORDER BY key")] == before


def test_partial_profile_and_tool_settings_use_existing_validation(conn):
    settings = SettingsStore(conn)
    settings.set("first_bot_profile", {"personality": " Patient. "})
    assert settings.get("first_bot_profile") == {"personality": "Patient."}
    settings.set("raphael_tools", [" srv-1 ", "srv-1"])
    assert settings.get("raphael_tools") == ["srv-1"]
    settings.set("raphael_tools", None)
    assert settings.get("raphael_tools") is None
    with pytest.raises((TypeError, ValueError)):
        checked("raphael_notify", 1)
    with pytest.raises(ValueError):
        checked("first_bot_profile", {"name": "  ", "personality": "Patient."})


@pytest.mark.parametrize("builtin", [False, True])
async def test_cover_position_rounds_persists_keeps_bytes_and_drops_on_change(rig, builtin):
    identifier = 0 if builtin else (await rig.call("members.create", {"name": "Cover owner"}))["member"]["id"]
    await rig.call("members.set_cover", upload(identifier))
    folder = rig.local / "avatars" / "covers"
    [image] = list(folder.glob("*.png"))
    original = image.read_bytes()
    result = await rig.call("members.update", {"id": identifier, "cover_position": 37.56})
    assert result["member"]["cover"]["position"] == 37.6
    metadata = json.loads((folder / f"{identifier}.json").read_text(encoding="utf-8"))
    assert metadata == {"kind": "image", "file": image.name, "position": 37.6}
    assert image.read_bytes() == original
    for percent in (0, 100, 50):
        assert (await rig.call("members.update", {"id": identifier, "cover_position": percent}))["member"]["cover"]["position"] == percent
        assert image.read_bytes() == original
    await rig.call("members.update", {"id": identifier, "cover_position": 37.56})
    await rig.call("members.update", {"id": identifier, "instructions": "Updated."})
    view = next(item for item in (await rig.call("members.list"))["members"] if item["id"] == identifier)
    assert view["cover"]["position"] == 37.6
    await rig.call("members.set_cover", upload(identifier))
    view = next(item for item in (await rig.call("members.list"))["members"] if item["id"] == identifier)
    assert "position" not in view["cover"] and not image.exists()
    await rig.call("members.update", {"id": identifier, "cover": "pattern:dots"})
    assert not list(folder.glob("*.png"))
    with pytest.raises(RpcError) as caught:
        await rig.call("members.update", {"id": identifier, "cover_position": 50})
    assert caught.value.data["kind"] == "cover"


@pytest.mark.parametrize("builtin", [False, True])
async def test_position_without_a_picture_never_creates_metadata_or_changes_profile(rig, builtin):
    identifier = 0 if builtin else (await rig.call("members.create", {"name": "Uncovered"}))["member"]["id"]
    for patch in ({"cover_position": 50}, {"cover": None, "cover_position": 50}, {"cover": "pattern:dots", "cover_position": 50}):
        with pytest.raises(RpcError) as caught:
            await rig.call("members.update", {"id": identifier, "instructions": "Must not save", **patch})
        assert caught.value.data["kind"] == "cover"
    assert not (rig.local / "avatars" / "covers" / f"{identifier}.json").exists()
    view = next(item for item in (await rig.call("members.list"))["members"] if item["id"] == identifier)
    assert view["instructions"] == ""


@pytest.mark.parametrize("value", [-1, 100.1, float("nan"), float("inf"), -float("inf"), True, "50", None])
@pytest.mark.parametrize("builtin", [False, True])
async def test_invalid_cover_positions_preserve_image_and_other_settings(rig, builtin, value):
    identifier = 0 if builtin else (await rig.call("members.create", {"name": "Keep"}))["member"]["id"]
    original = (await rig.call("members.set_cover", upload(identifier)))["member"]["cover"]
    with pytest.raises(RpcError) as caught:
        # Direct handler reaches the cover validator even for non-JSON finite numbers.
        await rig.service._update({"id": identifier, "personality": "Not saved", "cover_position": value})
    assert caught.value.code == INVALID_PARAMS and caught.value.data["kind"] == "cover"
    view = next(item for item in (await rig.call("members.list"))["members"] if item["id"] == identifier)
    assert view["cover"] == original and view["personality"] == ""

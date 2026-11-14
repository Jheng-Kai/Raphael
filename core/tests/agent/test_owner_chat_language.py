"""An external or unattended turn is told no language: the owner's words say which (owner, 2026-11-14: 「它的 UI 語言就是
單純 UI 語言而已，它也不會去到 system prompt」). The interface language stays for the app's own notices."""

import pytest

from raphael_core.agent.cli import loop as cli
from raphael_core.agent.cli.drivers import Event
from .test_narration import chat
from .test_service import make_rig  # noqa: F401


@pytest.mark.parametrize("source", ["telegram", "slack", "discord", "connector"])
@pytest.mark.parametrize("language", ["en", "ja"])
async def test_an_external_turn_is_told_no_interface_language(make_rig, client, source, language):
    rig = make_rig(owner_language=lambda: language)
    rig.service._last_language = "zh-TW"
    def reply(**kwargs):
        prompt = str(kwargs["messages"])
        assert "configured reply language" not in prompt and "Interface locale" not in prompt
        assert "這是什麼意思" in prompt
        return chat("Done.")
    client.chats = [reply]
    result = await rig.call("agent.ask", {"session_id": "unconfigured", "text": "這是什麼意思",
        "ui_language": language, "source": source})
    assert result["status"] == "done"


@pytest.mark.parametrize("source", ["telegram", "slack", "discord", "connector"])
async def test_the_interface_language_stays_the_windows_after_an_english_turn(make_rig, client, source):
    rig = make_rig(owner_language=lambda: "zh-TW")
    client.chats = [chat("English answer.")]
    await rig.call("agent.ask", {"session_id": "english", "text": "Answer in English", "ui_language": "en", "source": "app"})
    assert rig.service.language == "zh-TW"  # the app's notices of an external chat
    def reply(**kwargs):
        prompt = str(kwargs["messages"])
        assert "configured reply language" not in prompt and "zh-TW" not in prompt
        return chat("Owner language answer.")
    client.chats = [reply]
    result = await rig.call("agent.ask", {"session_id": "external", "text": "Continue", "ui_language": "en", "source": source})
    assert result["status"] == "done"
    assert client.chat_calls[-1]["messages"]


@pytest.mark.parametrize("source", ["app", "telegram"])
@pytest.mark.parametrize("brain", ["codex", "claude", "gemini"])
async def test_cli_public_message_is_not_repeated_as_progress(make_rig, monkeypatch, source, brain):
    rig = make_rig()
    rig.settings.set("agent_model", "cli:" + brain)
    monkeypatch.setattr(rig.service._cli_brains, "command", lambda name: ["fake"])
    monkeypatch.setattr(rig.service._cli_brains, "available", lambda *args, **kwargs: True)
    async def run(driver, **kwargs):
        line = "The source confirms the deadline."
        yield Event("text_delta", line)
        yield Event("message", line, data={"id": "public", "final": True})
        yield Event("tool_start", data={"id": "time", "name": "local_time"})
        yield Event("tool_end", data={"id": "time", "ok": True})
        yield Event("final", "Finished.")
    monkeypatch.setattr(cli.Driver, "run", run)
    result = await rig.call("agent.ask", {"session_id": "chat", "text": "Check", "ui_language": "en", "source": source})
    messages = rig.history.messages([result["turn_id"]])[result["turn_id"]]
    assert sum("The source confirms the deadline." in item["text"] for item in messages) == 1
    assert result["status"] == "done"

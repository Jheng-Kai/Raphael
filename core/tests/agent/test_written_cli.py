"""Reading a JSON example does not change the strict written CLI reply boundary."""

from pathlib import Path

import pytest

from raphael_core.agent.cli import loop as cli
from raphael_core.agent.cli.drivers import Event
from .test_service import make_rig  # noqa: F401


@pytest.mark.parametrize("brain", ["codex", "claude", "gemini"])
@pytest.mark.parametrize("text,expected", [
    ('{"text":"x"}', 'x'), ('```json\n{"text":"x"}\n```', 'x'),
    ('```json\n{"text":"The selected file was updated.","messages":["Example sentence."]}\n```', 'Example sentence.'),
    ('{"text":"x","kind":"example"}', None),
    ('```json\n{"text":"x","kind":"example"}\n```', None),
    ('The example is:\n```json\n{"text":"x"}\n```\nKeep these instructions.', None),
])
async def test_written_reply_boundary_after_reading_cleanup(make_rig, monkeypatch, brain, text, expected):
    rig = make_rig()
    rig.settings.set("agent_model", "cli:" + brain)
    monkeypatch.setattr(rig.service._cli_brains, "command", lambda name: ["fake"])
    monkeypatch.setattr(rig.service._cli_brains, "available", lambda *args, **kwargs: True)
    async def run(driver, **kwargs):
        assert "Never output a JSON reply envelope" in kwargs["system"]
        prompt = Path(__file__).parents[2] / "src/raphael_core/brain/prompts/cleanup_system.md"
        assert '{"text"' in prompt.read_text(encoding="utf-8")
        yield Event("tool_start", data={"id": "read", "name": "local_read"})
        yield Event("tool_end", data={"id": "read", "ok": True})
        yield Event("text_delta", text)
        yield Event("message", text, data={"id": "reply", "final": True})
        yield Event("final", text)
    monkeypatch.setattr(cli.Driver, "run", run)
    result = await rig.call("agent.ask", {"session_id": "written", "text": "Read the cleanup prompt and explain the edit",
        "ui_language": "en", "source": "app"})
    expected = text if expected is None else expected
    assert result["status"] == "done" and result["text"] == expected
    replies = [item["text"] for item in rig.history.messages([result["turn_id"]])[result["turn_id"]] if item["kind"] == "reply"]
    assert len(replies) == 1 and expected in replies[0]

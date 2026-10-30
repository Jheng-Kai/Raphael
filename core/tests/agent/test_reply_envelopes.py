"""Every CLI foreground route consumes the same reply envelope before persistence."""
import json
from types import SimpleNamespace

import pytest

from raphael_core.agent.cli.discovery import CliBrains
from raphael_core.agent.cli.drivers import Event
from raphael_core.failures import Failure
from .test_service import make_rig  # noqa: F401


ENVELOPE = json.dumps({"text": "Gmail needs a connection.", "messages": ["Gmail needs a connection."], "say_ja": "接続が必要です。"})


@pytest.mark.parametrize("plain", [False, True])
def test_shared_parser_accepts_plain_code_and_unwraps_nested_reply_words(plain):
    from raphael_core.agent.answers import parse_reply
    code = '```python\nprint("Hello")\n```'
    assert parse_reply(code, "en", plain=plain, long=True).text == code
    nested = {"text": ENVELOPE, "messages": [ENVELOPE]}
    reply = parse_reply(nested, "en", plain=plain, long=True)
    assert reply.text == "Gmail needs a connection."
    assert reply.messages == ["Gmail needs a connection."]


@pytest.mark.parametrize("route", ["normal", "quick", "resumed", "failure"])
async def test_cli_reply_envelope_is_unwrapped_on_every_foreground_route(make_rig, monkeypatch, tmp_path, route):
    brains = CliBrains(home=tmp_path, environ={}, commands={"codex": ["never-spawn"]})
    monkeypatch.setattr(brains, "available", lambda *args, **kwargs: True)
    async def run(driver, **kwargs):
        yield Event("final", ENVELOPE)
    monkeypatch.setattr("raphael_core.agent.cli.loop.Driver.run", run)
    rig = make_rig(cli_brains=brains)
    rig.settings.set("agent_model", "cli:codex:test")
    rig.settings.set("quick_model", "cli:codex:test")
    conversation = rig.service.conversations.quick() if route == "quick" else rig.service.conversations.main()
    if route in ("resumed", "failure"):
        origin = rig.history.add(session_id="source", question="Read Gmail", route="answer", prefix="", text="Connect Gmail",
                                 status="done", source="app", conversation_id=conversation)
        rig.service._cards = SimpleNamespace(cards_of=lambda turn: [SimpleNamespace(
            name="Gmail", state="connected" if route == "resumed" else "failed", done=(), language="en")], views=lambda ids: {})
        if route == "failure":
            assert (await rig.service.failure_turn(origin, Failure("auth_expired", "not_configured"))).ok
        else:
            assert (await rig.service.resume_turn(origin)).ok
        turn = rig.history.recent(1)[0]
    else:
        result = await rig.call("agent.ask", {"session_id": "envelope", "text": "Read Gmail", "ui_language": "en", "source": "app",
            "conversation_id": conversation, **({"destination": "quick"} if route == "quick" else {})})
        turn = rig.history.get(result["turn_id"])
    assert turn.text == "Gmail needs a connection."
    replies = rig.service._conn.execute("SELECT text FROM agent_messages WHERE turn_id=? AND kind='reply'", (turn.id,)).fetchall()
    assert replies and all("Gmail needs a connection." in row[0] and '"messages"' not in row[0] for row in replies)

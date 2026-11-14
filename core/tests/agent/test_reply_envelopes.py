"""Written CLI routes unwrap only strict reply envelopes and retain authored JSON."""
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


@pytest.mark.parametrize("plain", [False, True])
def test_the_rest_of_the_reply_object_written_into_its_words_is_never_shown(plain):
    from raphael_core.agent.answers import parse_reply
    words = "The draft is ready.\n\nShall we plan the video next?"
    tail = json.dumps({"messages": [words], "memory": [], "need": ""})[1:]
    leaked = {"text": words + '",' + tail, "detail": "", "messages": [words + '",' + tail], "memory": [], "need": {"search": ""}}
    reply = parse_reply(leaked, "en", plain=plain, long=True)
    assert reply.text == words
    assert all('"messages"' not in message and "\\n" not in message for message in reply.messages)
    # Words that only quote such fields, or carry more after them, stay as they were written.
    for authored in ('Write it as {"text":"hi","messages":["hi"]} and send it.', 'It ends with ","memory":[]} then more words'):
        assert parse_reply({"text": authored, "messages": [authored]}, "en", plain=plain, long=True).text == authored


@pytest.mark.parametrize("route", ["normal", "quick", "resumed", "failure"])
@pytest.mark.parametrize("fenced", [False, True])
@pytest.mark.parametrize("authored", [False, True], ids=["reply", "authored-json"])
async def test_written_cli_reply_boundary_on_every_foreground_route(make_rig, monkeypatch, tmp_path, route, fenced, authored):
    content = ENVELOPE if authored else json.dumps({"text": "Gmail needs a connection.", "detail": "", "messages": ["Gmail needs a connection."]})
    final = "```json\n" + content + "\n```" if fenced else content
    brains = CliBrains(home=tmp_path, environ={}, commands={"codex": ["never-spawn"]})
    monkeypatch.setattr(brains, "available", lambda *args, **kwargs: True)
    async def run(driver, **kwargs):
        yield Event("final", final)
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
    expected = final if authored else "Gmail needs a connection."
    assert turn.text == expected
    assert turn.detail is None
    replies = rig.service._conn.execute("SELECT text FROM agent_messages WHERE turn_id=? AND kind='reply'", (turn.id,)).fetchall()
    assert replies and all(expected in row[0] for row in replies)


@pytest.mark.parametrize("fenced", [False, True])
@pytest.mark.parametrize("plain", [False, True])
@pytest.mark.parametrize("data,text,detail,messages", [
    ({"text": "在，我在這裡。", "detail": ""}, "在，我在這裡。", None, ["在，我在這裡。"]),
    ({"prefix": "Answer", "text": "Complete.", "detail": "Checked.", "messages": ["First.", "Second."]},
     "First.\n\nSecond.", "Checked.", ["First.", "Second."]),
    ({"messages": ["Only message."]}, "Only message.", None, ["Only message."]),
    ({"text": '{"text":"Authored inner example"}'}, '{"text":"Authored inner example"}', None,
     ['{"text":"Authored inner example"}']),
])
def test_literal_cli_parser_unwraps_only_the_outer_reply_envelope(fenced, plain, data, text, detail, messages):
    from raphael_core.agent.answers import parse_reply
    content = json.dumps(data, ensure_ascii=False)
    final = "```json\n" + content + "\n```" if fenced else content
    reply = parse_reply(final, "en", plain=plain, long=True, literal=True)
    assert (reply.text, reply.detail, reply.messages) == (text, detail, messages)


@pytest.mark.parametrize("content", [
    '{"text":"Example", "other":"authored"}',
    '{"text":{"nested":"data"}}',
    '{"text":42}', '{"text":true}', '{"text":null}', '{"text":["data"]}',
    '{"messages":["Example", {"nested":"data"}]}',
    '{"messages":"Example"}', '{"text":"Example", "detail":[]}',
    '{"text":"Example", "prefix":null}', '{"detail":"Authored notes"}',
    '[{"text":"Example"}]', '{"text":"Example"}\n{"text":"Second"}',
    'Before\n```json\n{"text":"Example"}\n```\nAfter',
    '```json\n{"text":"Example"}\n```\nOther content',
    '```json\n{"text":"Example"}', '```python\nprint("Example")\n```',
    '```json\n{"text":"Example", "other":"authored"}\n```',
])
def test_literal_cli_parser_preserves_every_other_shape(content):
    from raphael_core.agent.answers import parse_reply
    reply = parse_reply(content, "en", plain=True, long=True, literal=True)
    assert reply.text == content and reply.detail is None

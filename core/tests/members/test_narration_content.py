"""Model content is published as public narration and clean replies, in every thread."""

import json

import pytest

from agent.test_narration import chat
from raphael_core.agent.actions import is_action
from .test_answering import client, setup, member, typed  # noqa: F401


@pytest.mark.parametrize("speaker", ["member", "raphael"])
async def test_tool_narration_precedes_the_complete_final_messages(setup, client, speaker):
    rig, team = setup
    speaker_id = member(team, name="小葵", role="Japanese teacher").id if speaker == "member" else 0
    client.chats = [
        chat('{"thinking":"主人說不會這段文章，先從基礎開始。","progress":"我來逐句拆解這段新聞。"}', ("local_time", {})),
        chat('{"text":"換你練習。","detail":"","messages":["先看第一句。","弱点是弱點。","換你練習。"],"memory":[],"need":{}}'),
    ]
    result = await typed(rig, "我都不會，可以解釋一下嗎？", speaker_id)
    [turn] = (await rig.call("agent.history.list", {"member_id": speaker_id}))["turns"]
    assert result["text"] == turn["text"] == "先看第一句。\n\n弱點是弱點。\n\n換你練習。"
    assert [m["kind"] for m in turn["messages"] if not is_action(m["text"])] == ["thinking", "progress", "reply", "reply", "reply"]
    assert turn["messages"][0]["text"] == "主人說不會這段文章，先從基礎開始。"
    expected = ["我來逐句拆解這段新聞。", "先看第一句。", "弱點是弱點。", "換你練習。"]
    if speaker == "raphael":
        expected = ["《告。我來逐句拆解這段新聞。》", "《答。先看第一句。", "弱點是弱點。", "換你練習。》"]
    assert [m["text"] for m in turn["messages"][1:] if not is_action(m["text"])] == expected


@pytest.mark.parametrize(("content", "expected"), [
    ('{"text":"A clean answer.","detail":""}', "A clean answer."),
    ('```json\n{"text":"A clean answer."}\n```', "A clean answer."),
    ('```\n{"messages":["A clean answer."]}\n```', "A clean answer."),
    ("A clean answer.", "A clean answer."),
    # Objects at the start, words, then objects that end the text are one reply: what the earlier objects said for the owner,
    # the words, then what the last object says. No protocol is shown.
    ('{"thinking":"Check the example."}\nDuplicate prose.\n{"text":"A clean answer."}', "Duplicate prose.\n\nA clean answer."),
    # An object with no field of the protocol is the member's own content and stays where it stands.
    ('{"thinking":"Check the example."}\nA clean answer.\n{"metadata":{"ignored":true}}',
     'A clean answer.\n{"metadata":{"ignored":true}}'),
    ('A clean answer.\n```json\n{"text": broken, "need": {}}\n```', None),
    ('```json\n{"text": "unfinished\n```\nA clean answer.', None),
    # Words followed by a cut protocol object are the answer with a broken tail: the tail goes, the words stay.
    ('A clean answer.\n{"text": "unfinished', "A clean answer."),
    (json.dumps({"text": 'A clean answer.\n```json\n{"progress":"Echoed protocol."}\n```',
                 "detail": 'Details.\n{"thinking":"Echoed protocol."}'}), 'A clean answer.\n```json\n{"progress":"Echoed protocol."}\n```'),
    (json.dumps({"messages": ['A clean answer.\n{"text":"Echoed protocol."}']}), 'A clean answer.\n{"text":"Echoed protocol."}'),
    (json.dumps({"text": 'Braces in a string: } and an escaped "quote".', "memory": [], "need": {}}),
     'Braces in a string: } and an escaped "quote".'),
], ids=["bare", "json-fence", "plain-fence", "prose", "two-objects", "public-and-metadata",
        "malformed-balanced", "malformed-fenced", "malformed-cut-tail", "echoed-text", "echoed-message", "escaped-braces"])
async def test_final_content_uses_reply_objects_or_prose_without_protocol(setup, client, content, expected):
    rig, team = setup
    teacher = member(team)
    expected = content if expected is None else expected
    client.chats = [chat(content)]
    result = await typed(rig, "Explain this", teacher.id, language="en")
    [turn] = (await rig.call("agent.history.list", {"member_id": teacher.id}))["turns"]
    assert result["text"] == turn["text"] == expected
    replies = [m["text"] for m in turn["messages"] if m["kind"] == "reply"]
    # The words among the objects and what the last object says are two messages, in the order they were written.
    assert replies == (expected.split("\n\n") if content.startswith('{"thinking":"Check the example."}\nDuplicate') else [expected])
    if "Details." in content:
        assert turn["detail"] == 'Details.\n{"thinking":"Echoed protocol."}'


async def test_each_pre_tool_object_is_published_in_order_without_duplicate_prose(setup, client):
    rig, team = setup
    teacher = member(team)

    async def finish(**kwargs):
        [turn] = (await rig.call("agent.history.list", {"member_id": teacher.id}))["turns"]
        assert [(m["kind"], m["text"]) for m in turn["messages"] if not is_action(m["text"])] == [
            ("thinking", "The date chooses the lesson."), ("progress", "Checking the date."),
            ("thinking", "Then I can choose the example."), ("progress", "Choosing the example."),
        ]
        return chat('{"text":"Done.","thinking":"The example is ready."}')

    client.chats = [chat('''```json
{"thinking":"The date chooses the lesson.","progress":"Checking the date."}
```
Duplicate prose.
{"thinking":"Then I can choose the example.","progress":"Choosing the example."}
''', ("local_time", {})), finish]
    await typed(rig, "Please choose a lesson for this week", teacher.id, language="en")
    [turn] = (await rig.call("agent.history.list", {"member_id": teacher.id}))["turns"]
    assert [(m["kind"], m["text"]) for m in turn["messages"]][-2:] == [
        ("thinking", "The example is ready."), ("reply", "Done."),
    ]


@pytest.mark.parametrize("before_tool", [True, False])
@pytest.mark.parametrize(("kind", "content", "expected", "limit"), [
    ("thinking", "先從基礎開始。" + "這段補充太長" * 30, "先從基礎開始。", 120),
    ("progress", "我來查找文章。" + "這段補充太長" * 15, "我來查找文章。", 60),
    ("thinking", "One choice. Another choice. Unneeded third sentence.", "One choice. Another choice.", 120),
    ("progress", "x" * 100, "x" * 59 + "…", 60),
], ids=["thinking-length", "progress-length", "two-sentences", "no-sentence-end"])
async def test_public_narration_has_hard_length_and_sentence_caps(setup, client, before_tool, kind, content, expected, limit):
    rig, team = setup
    teacher = member(team)
    public = json.dumps({kind: content})
    final = '{"text":"Done."}'
    client.chats = ([chat(public, ("local_time", {})), chat(final)] if before_tool
                    else [chat(public + "\n" + final)])
    # Both scripts remain bounded independently of the interface language. The owner's words say their language firmly, in
    # the language of the narration, so that what the member says while it works is shown (R-LANG-05).
    await typed(rig, "Please explain this article to me" if content.isascii() else "請幫我解釋這段文章", teacher.id,
                language="en" if content.isascii() else "zh-TW")
    [turn] = (await rig.call("agent.history.list", {"member_id": teacher.id}))["turns"]
    [message] = [m for m in turn["messages"] if m["kind"] == kind]
    assert message["text"] == expected and len(message["text"]) <= limit


@pytest.mark.parametrize("speaker", ["member", "raphael"])
@pytest.mark.parametrize("language", ["zh-TW", "en"])
async def test_live_prompt_keeps_narration_and_replies_independent_of_ui_language(setup, client, speaker, language):
    rig, team = setup
    teacher = member(team, role="Japanese teacher", instructions="Teach and reply in Japanese.")
    speaker_id = teacher.id if speaker == "member" else 0

    client.chats = [chat('{"text":"練習しましょう。"}')]
    result = await typed(rig, "Explain the article", speaker_id, language=language)
    system = client.chat_calls[0]["messages"][0]["content"]
    user = client.chat_calls[0]["messages"][1]["content"]
    assert system.count('content must be one public object with thinking, progress and optional messages') == 1
    assert system.count("Final content must be ONLY one JSON object") == 1
    assert "no code fences, no prose before or after" in system
    assert "no separate thinking object" in system
    assert "Use the same reply-language rule for public thinking and progress as for replies." in system
    assert "The interface language is" not in user
    assert "in the owner's UI language" not in system
    assert "at most 2 sentences (about 60 CJK characters)" in system
    assert "25 CJK characters or 25 words" in system
    assert '"text": the complete reply' in system
    assert '"messages": the complete reply as chat messages in order' in system
    assert '"text": the reply as one line' not in system
    assert "Owner's UI language:" not in user
    assert "Use the language specified in your own persona or the owner's instructions" in user
    if speaker == "member":
        assert "Teach and reply in Japanese." in system
        assert "Reply ONLY in" not in system
        assert "Replies follow the persona and the owner's instructions" in system
    assert result["text"] == "練習しましょう。"


@pytest.mark.parametrize(("words", "interface", "shown"), [
    ("Please explain this article to me", "zh-TW", [("thinking", "Let me open the page.")]),
    ("請幫我解釋這段文章給我聽", "en", [("progress", "我先打開頁面。")]),
], ids=["english-owner-chinese-interface", "chinese-owner-english-interface"])
async def test_the_interface_language_never_filters_narration_the_owners_words_do(setup, client, words, interface, shown):
    """The interface language decides no word of what a member says: an owner who writes English sees the English line and
    not the Chinese one with a Chinese interface, and the mirror case with firm Chinese words and an English interface."""
    rig, team = setup
    teacher = member(team)
    client.chats = [chat('{"thinking": "Let me open the page.", "progress": "我先打開頁面。"}', ("local_time", {})),
                    chat('{"text":"好了。"}')]
    await typed(rig, words, teacher.id, language=interface)
    [turn] = (await rig.call("agent.history.list", {"member_id": teacher.id}))["turns"]
    assert [(m["kind"], m["text"]) for m in turn["messages"] if m["kind"] in ("thinking", "progress")] == shown


@pytest.mark.parametrize("brain", ["api", "cli"])
async def test_two_english_words_in_a_new_conversation_do_not_say_a_language_so_the_profile_does_on_both_brains(
        setup, client, monkeypatch, brain):
    """The owner's first message is two English words (no firm language), the member's profile is Chinese, and the model
    narrates in English. The language is the profile's, and the English note is held back, on an API and on a CLI brain
    alike: both read it through `AgentService._words_language`. The owner's later words in the conversation decide
    instead (the test after this one)."""
    rig, team = setup
    teacher = member(team)
    note = "I will read the notes first."
    if brain == "api":
        client.chats = [chat(json.dumps({"thinking": note, "progress": note}), ("local_time", {})), chat('{"text":"好了。"}')]
    else:
        from raphael_core.agent.cli import loop as cli
        from raphael_core.agent.cli.drivers import Event
        rig.settings.set("agent_model", "cli:claude:fake")
        monkeypatch.setattr(rig.service._cli_brains, "command", lambda name: ["fake"])
        monkeypatch.setattr(rig.service._cli_brains, "available", lambda *args, **kwargs: True)

        async def run(driver, **kwargs):
            [loop] = rig.service._cli_loops
            assert loop.owner_language == "zh-TW"
            yield Event("text_delta", note)
            yield Event("message", note, data={"id": "said"})
            yield Event("tool_start", data={"id": "0", "name": "local_time"})
            await loop._tool("call-0", "local_time", {})
            yield Event("tool_end", data={"id": "0", "ok": True})
            yield Event("message", "好了。", data={"id": "answer", "final": True})
            yield Event("final", "好了。")

        monkeypatch.setattr(cli.Driver, "run", run)
    await typed(rig, "Explain this", teacher.id, language="en")
    [turn] = (await rig.call("agent.history.list", {"member_id": teacher.id}))["turns"]
    assert [m["text"] for m in turn["messages"] if m["kind"] in ("thinking", "progress")] == []
    assert turn["text"] == "好了。"  # the answer is never held back


@pytest.mark.parametrize("brain", ["api", "cli"])
async def test_the_owners_earlier_english_words_decide_the_language_over_a_chinese_profile_on_both_brains(
        setup, client, monkeypatch, brain):
    rig, team = setup
    teacher = member(team)
    note = "I will read the notes first."
    rig.history.add(session_id="earlier", question="Please read my notes and tell me what they say", route="answer", prefix="",
                    text="Sure.", status="done", source="app", member_id=teacher.id)
    if brain == "api":
        client.chats = [chat(json.dumps({"thinking": note}), ("local_time", {})), chat('{"text":"Done."}')]
    else:
        from raphael_core.agent.cli import loop as cli
        from raphael_core.agent.cli.drivers import Event
        rig.settings.set("agent_model", "cli:claude:fake")
        monkeypatch.setattr(rig.service._cli_brains, "command", lambda name: ["fake"])
        monkeypatch.setattr(rig.service._cli_brains, "available", lambda *args, **kwargs: True)

        async def run(driver, **kwargs):
            [loop] = rig.service._cli_loops
            assert loop.owner_language == "en"
            yield Event("text_delta", note)
            yield Event("message", note, data={"id": "said"})
            yield Event("tool_start", data={"id": "0", "name": "local_time"})
            await loop._tool("call-0", "local_time", {})
            yield Event("tool_end", data={"id": "0", "ok": True})
            yield Event("message", "Done.", data={"id": "answer", "final": True})
            yield Event("final", "Done.")

        monkeypatch.setattr(cli.Driver, "run", run)
    await typed(rig, "continue", teacher.id, language="zh-TW")
    [turn] = [t for t in (await rig.call("agent.history.list", {"member_id": teacher.id}))["turns"] if t["question"] == "continue"]
    shown = [m["text"] for m in turn["messages"] if m["kind"] in ("thinking", "progress")]
    assert any(note in text for text in shown)

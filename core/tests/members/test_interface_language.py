"""A member's conversation is told nothing of the interface language (owner, 2026-11-14): 「我不是說過系統的 UI 語言並不會影響到
使用者內部聊天的語言嗎？它的 UI 語言就是單純 UI 語言而已，它也不會去到 system prompt，什麼事都不會發生」.

The interface is Japanese and the owner writes Traditional Chinese: what the model is sent is the same as on any other
interface, names no language to reply in, and names Raphael in the owner's language; a member whose own instructions
set a language keeps them; the words the app itself draws still follow the interface. Fake models only."""

import base64

import pytest

from raphael_core.agent import persona
from .test_answering import client, live_said, member, setup, typed  # noqa: F401

CHINESE = "幫我整理今天的新聞重點，條列三則。"
# What told a model the interface language before, in every form it had.
INTERFACE_HINTS = ("configured reply language", "Interface locale", "This selects fixed UI labels only")


async def asked(rig, client, text, member_id, interface, *, source="app", session="s1", **extra):
    """What the model was sent for one request: the system prompt, the message and the tools."""
    seen = []

    def reply(**kwargs):
        seen.append(kwargs)
        return live_said("好的，以下是三則重點。")

    client.chats = [reply]
    result = await rig.call("agent.ask", {"session_id": session, "text": text, "ui_language": interface, "source": source,
                                          "member_id": member_id, **extra})
    assert result["status"] == "done"
    messages = seen[0]["messages"]
    return messages[0]["content"], messages[1]["content"], seen[0]["tools"]


def assert_no_interface_language(*texts):
    for text in texts:
        for hint in INTERFACE_HINTS:
            assert hint not in text, hint


async def test_a_member_is_told_nothing_of_a_japanese_interface_when_the_owner_writes_chinese(setup, client):
    rig, team = setup
    writer = member(team, name="Writer", role="Writer", instructions="Write clearly.")
    prompts = {}
    for number, interface in enumerate(("ja", "zh-TW", "en")):
        prompts[interface] = await asked(rig, client, CHINESE, writer.id, interface, session=f"s{number}")
    system, user, _ = prompts["ja"]
    assert_no_interface_language(system, user)
    assert persona.REPLY_LANGUAGE in system and persona.REPLY_LANGUAGE in user
    assert CHINESE in user
    # The team snapshot names Raphael in the language the owner writes in, not the window's.
    assert "拉斐爾" in user and "ラファエル" not in user
    # The rules and the tools are the same whatever the interface.
    assert prompts["ja"][0] == prompts["zh-TW"][0] == prompts["en"][0]
    assert prompts["ja"][2] == prompts["zh-TW"][2] == prompts["en"][2]


async def test_a_japanese_teachers_own_instructions_still_decide_her_language(setup, client):
    rig, team = setup
    rule = "You are a Japanese teacher. Always answer in Japanese, whatever language the owner writes in."
    teacher = member(team, name="Shion", role="日本語の先生", instructions=rule)
    english = await asked(rig, client, "今天教我一個 N2 文法", teacher.id, "en", session="a")
    chinese = await asked(rig, client, "今天教我一個 N2 文法", teacher.id, "zh-TW", session="b")
    system, user, _ = english
    assert rule in system
    # Her own instructions come first; the owner's words decide only where they say nothing.
    assert "Use the language specified in your own persona and the owner's instructions" in system
    assert_no_interface_language(system, user)
    assert english[0] == chinese[0]


@pytest.mark.parametrize("source", ["telegram", "slack", "discord"])
async def test_a_messaging_chat_on_a_japanese_interface_is_not_told_to_reply_in_japanese(setup, client, source):
    rig, team = setup
    rig.service._owner_language = lambda: "ja"
    system, user, _ = await asked(rig, client, CHINESE, 0, "ja", source=source)
    assert_no_interface_language(system, user)
    assert CHINESE in user


async def test_files_without_words_are_asked_about_in_the_conversations_language(setup, client):
    rig, team = setup
    reader = member(team, name="Reader")
    await asked(rig, client, CHINESE, reader.id, "ja", session="words")
    files = [{"name": "notes.txt", "mime": "text/plain", "data": base64.b64encode("Notes".encode()).decode()}]
    _, user, _ = await asked(rig, client, "", reader.id, "ja", session="files", attachments=files)
    assert "<question>\n看這個\n</question>" in user and "これを見て" not in user


async def test_a_notice_the_app_draws_still_follows_the_interface_language(setup, client):
    rig, team = setup
    await rig.call("agent.cancel", {"session_id": "s1"})
    result = await typed(rig, CHINESE, 0, source="voice", language="ja")
    assert result["text"] == persona.phrase("ja", "denied")
    assert result["prefix"] == persona.PREFIXES["ja"].understood
    assert not client.chat_calls and not client.json_calls

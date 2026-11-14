"""The interface language is the window's alone (owner, 2026-11-14): 「我不是說過系統的 UI 語言並不會影響到使用者內部聊天的語言
嗎？它的 UI 語言就是單純 UI 語言而已，它也不會去到 system prompt，什麼事都不會發生」.

No prompt, schema or message a model is sent takes the interface language; what must still be chosen per language for
a model is read from the conversation's own words (`conversation_language`). Fake models only."""

import inspect

import pytest

from raphael_core import ui_languages
from raphael_core.agent import answers, owner_language, persona
from raphael_core.agent.answers import Voice, build_user_message, reply_schema
from raphael_core.background import service as background_service
from raphael_core.computer import run as computer_run
from raphael_core.conversation_language import chat_language, detect_language

from .test_answers import NOW, completion, ledger, spoken  # noqa: F401

# What told a model the interface language before, in every form it had.
INTERFACE_HINTS = ("configured reply language", "Interface locale", "This selects fixed UI labels only")


@pytest.mark.parametrize(("text", "language"), [
    ("幫我整理今天的新聞重點", "zh-TW"),
    ("帮我整理今天的新闻重点", "zh-CN"),
    ("今日のニュースを見せてください", "ja"),
    ("ワンピース", "ja"),
    ("我想看ワンピース的新聞", "zh-TW"),
    ("오늘 뉴스를 보여줘", "ko"),
    ("สวัสดีครับ ช่วยหน่อย", "th"),
    ("Привет, как дела?", "ru"),
    ("Check the weather in Taipei", "en"),
    ("Hola, ¿cómo estás?", "es"),
    ("Bonjour, peux-tu m'aider ?", "fr"),
    ("Kannst du mir bitte helfen", "de"),
    ("Olá, você pode me ajudar com isso? Obrigado", "pt-BR"),
    ("Ciao, come stai? Puoi aiutarmi con questo", "it"),
    ("Tolong bantu saya dengan ini", "id"),
    ("Xin chào, bạn có khỏe không?", "vi"),
    ("Merhaba, nasılsın? Lütfen yardım et", "tr"),
    # What a person quotes is the matter: the request is in the language around it.
    ("幫我翻譯 'Hello world, how are you'", "zh-TW"),
    ("幫我翻譯「Good morning, everyone」", "zh-TW"),
    ("Translate 你好 to English please", "en"),
    ("請看 https://example.com/a/very/long/english/path/name", "zh-TW"),
])
def test_the_language_of_a_message_is_read_from_its_own_words(text, language):
    assert detect_language(text) == language


@pytest.mark.parametrize("text", ["", "😀👍", "12:30", "https://example.com/news", None, 5])
def test_words_with_no_letters_have_no_language(text):
    assert detect_language(text) is None


def test_the_first_words_that_have_a_language_decide_and_english_is_the_last_resort():
    assert chat_language("👍", "", "今日は何を勉強しますか") == "ja"
    assert chat_language("👍", None) == "en"
    assert chat_language("", default="zh-TW") == "zh-TW"


@pytest.mark.parametrize("builder", [
    persona.system_prompt, persona.member_system_prompt, persona.cli_system_prompt, persona.worker_system_prompt,
    persona.member_worker_system_prompt, persona.reaction_prompt, persona.language_reminder, reply_schema,
    build_user_message, computer_run.system_prompt, background_service._prompts,
])
def test_no_prompt_builder_takes_a_language(builder):
    # The interface language cannot reach what a builder makes when it has no way in.
    assert "language" not in inspect.signature(builder).parameters


def test_the_interface_language_has_no_words_for_a_model_left():
    assert not hasattr(owner_language, "reply_context")
    assert not hasattr(ui_languages, "interface_context")
    assert "interface language never selects" in persona.REPLY_LANGUAGE.casefold()


def test_the_reply_kinds_are_one_fixed_set_and_read_as_the_windows_prefix():
    assert reply_schema()["properties"]["prefix"]["enum"] == ["answer", "notice", "negative", "understood", "question"]
    assert answers.parse_reply(spoken("notice", "明天有雨。"), "ja").prefix == "告"
    assert answers.parse_reply(spoken("negative", "沒有資料。"), "en").prefix == "Negative"
    assert answers.parse_reply(spoken("answer", "好。"), "zh-TW").prefix == "答"


@pytest.mark.parametrize("source", ["app", "telegram", "slack", "discord", "connector", "member"])
async def test_a_reply_to_chinese_words_on_a_japanese_interface_names_no_language(client, ledger, source):
    # The quick reply's model is asked the same whatever the interface; only the prefix the app shows follows it.
    calls = {}
    for interface in ("ja", "zh-TW", "en"):
        client.replies.append(completion(spoken("answer", "今天的重點有三則。")))
        result = await Voice(client).reply(
            model="openai/gpt-6-luna", language=interface, route="answer", question="幫我整理今天的新聞重點",
            context=[], tools=[], moment=NOW, ledger=ledger, source=source)
        call = client.json_calls[-1]
        calls[interface] = (call["system"], call["user"], call["schema"])
        assert result.prefix == persona.PREFIXES[interface].answer  # the window's own label
        for hint in INTERFACE_HINTS:
            assert hint not in call["system"] and hint not in call["user"]
        assert "幫我整理今天的新聞重點" in call["user"]
    assert calls["ja"] == calls["zh-TW"] == calls["en"]


@pytest.mark.parametrize("interface", ["en", "ja", "zh-TW"])
def test_raphaels_replayed_lines_lose_the_windows_frame(interface):
    # His lines are kept as the app shows them, 《prefix。…》 in the interface language; the model reads his words alone.
    from raphael_core.agent.history import Turn
    from raphael_core.memory.conversation import turn_text
    from raphael_core.messaging.words import compose
    notice, answer = persona.PREFIXES[interface].notice, persona.PREFIXES[interface].answer
    said = Turn(id=1, created_at_ms=1, session_id="s", question="今天的新聞", route="answer", prefix=answer,
                text="三則。", detail=None, status="done", source="app",
                messages=[compose(notice, "我先找新聞。", None), compose(answer, "第一則。", None)[:-1], "第二則。》"])
    text = turn_text(said, detail=False)
    assert "我先找新聞。" in text and "第一則。" in text and "第二則。" in text
    assert "《" not in text and "》" not in text


def test_the_memory_host_marks_an_entry_in_the_language_it_is_written_in():
    # The files are what every model reads: the interface language never picks the mark or the name told to.
    from raphael_core.memory.service import MemoryService
    from raphael_core.memory.store import UNCONFIRMED
    written_in = MemoryService._written_in
    assert written_in("", "主人下週去東京出差") == "zh-TW"
    assert written_in("", "来週は東京に出張します") == "ja"
    assert written_in("", "The owner flies to Tokyo next week") == "en"
    assert written_in("我下週去東京", "The owner flies to Tokyo next week") == "zh-TW"  # the owner's words first
    assert written_in("", "") == "zh-TW"
    host = object()
    assert MemoryService._mark(host, "ja") == UNCONFIRMED["ja"]
    assert MemoryService._told_name(host, 0, "ja") == "ラファエル"
    assert MemoryService._told_name(host, 0, "zh-TW") == "拉斐爾"


def test_a_greeting_and_a_task_are_told_whose_language_without_naming_one():
    # With no word of the owner's yet, the member's own instructions, then what it knows of the owner, decide.
    from raphael_core.agent.service import GREETING_NOW
    from raphael_core.background.service import TASK_LANGUAGE
    from raphael_core.ui_languages import LANGUAGE_NAMES
    for line in (GREETING_NOW, TASK_LANGUAGE):
        assert "your own" in line
        assert not any(name.split(" as written")[0] in line for name in LANGUAGE_NAMES.values())

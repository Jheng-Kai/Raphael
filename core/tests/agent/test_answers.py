"""Tests for the answers: what the language model is asked, and what comes back as Raphael's words.
The OpenRouter client is a fake that answers as told."""

import asyncio
import logging

import pytest

from raphael_core.agent import answers as answers_module
from raphael_core.agent import persona
from raphael_core.agent.answers import (
    REPLY_MAX_TOKENS,
    Reply,
    Voice,
    parse_reply,
    reply_schema,
)
from raphael_core.agent.failure import AgentFailure
from raphael_core.agent.history import Turn
from raphael_core.agent.ledger import Ledger
from raphael_core.agent.tools import ToolResult
from raphael_core.brain.openrouter import Completion, OpenRouterError
from raphael_core.brain.spend import SpendTracker

NOW = {
    "iso": "2026-10-20T14:05:09+08:00",
    "date": "2026-10-20",
    "weekday": "Tuesday",
    "time": "14:05",
    "utc_offset": "UTC+08:00",
}


def test_member_replies_keep_up_to_four_separate_messages_with_a_limit_per_message():
    reply = parse_reply({"messages": ["Correction", "Example", "x" * 3000, "Your turn?", "extra"], "detail": ""}, "en", plain=True)
    assert reply.messages[:2] == ["Correction", "Example"]
    assert len(reply.messages) == 5
    assert len(reply.messages[2]) == 3000
    assert reply.text == "\n\n".join(reply.messages)


def test_display_frame_normalization_preserves_notice_and_ordinary_quoted_titles():
    reply = parse_reply({"messages": ["《Notice. Finished.》", "Read 《The Book》 next."]}, "en", long=True)
    assert reply.prefix == "Notice"
    assert reply.messages == ["Finished.", "Read 《The Book》 next."]


def test_member_text_is_not_interpreted_as_raphael_display_frames():
    reply = parse_reply({"messages": ["《Answer. A quoted example.》"]}, "en", plain=True, long=True)
    assert reply.prefix == "" and reply.text == "《Answer. A quoted example.》"


def completion(data, cost=0.0009, model="openai/gpt-6-luna"):
    return Completion(
        data=data, model=model, cost_usd=cost, prompt_tokens=700, completion_tokens=45,
        latency_ms=1300,
    )  # fmt: skip


def spoken(prefix="答", text="台北現在 24 度，多雲。", detail=""):
    return {"prefix": prefix, "text": text, "detail": detail}


def turn(question, text, *, prefix="答", route="chat", number=1):
    return Turn(
        id=number, created_at_ms=number, session_id="s", question=question, route=route,
        prefix=prefix, text=text, detail=None, status="done",
    )  # fmt: skip


@pytest.fixture
def ledger(conn):
    return Ledger(SpendTracker(conn, now_ms=lambda: 1_000))


@pytest.fixture
def voice(client):
    return Voice(client)


async def reply(voice, ledger, **overrides):
    args = {
        "model": "openai/gpt-6-luna",
        "language": "zh-TW",
        "route": "answer",
        "question": "台北天氣如何",
        "context": [],
        "tools": [],
        "moment": NOW,
        "ledger": ledger,
    }
    return await voice.reply(**{**args, **overrides})


# --- what is asked ---------------------------------------------------------------------------------


async def test_the_model_is_asked_for_json_with_a_little_reasoning(voice, client, ledger):
    client.replies.append(completion(spoken()))
    await reply(voice, ledger)
    call = client.json_calls[0]
    assert call["model"] == "openai/gpt-6-luna"
    assert call["fallbacks"] == []  # the owner's brain answers as itself, never a fallback model
    assert call["system"] == persona.system_prompt("zh-TW", "answer") + answers_module.MESSAGE_RULES
    assert call["schema_name"] == "raphael_reply"
    assert call["reasoning_effort"] == "none"
    assert call["max_tokens"] == REPLY_MAX_TOKENS
    assert call["timeout_s"] > 0


@pytest.mark.parametrize("language", persona.LANGUAGES)
def test_the_schema_offers_the_prefixes_of_the_language_and_requires_every_field(language):
    schema = reply_schema(language)
    assert schema["properties"]["prefix"]["enum"] == list(persona.PREFIXES[language])
    assert schema["properties"]["text"] == {"type": "string"}
    assert schema["properties"]["detail"] == {"type": "string"}
    assert schema["required"] == ["prefix", "text", "detail"]
    assert schema["additionalProperties"] is False


@pytest.mark.parametrize("route", ["answer", "discuss", "chat"])
async def test_the_system_prompt_is_the_one_of_the_route(voice, client, ledger, route):
    client.replies.append(completion(spoken()))
    await reply(voice, ledger, route=route, language="ja")
    assert client.json_calls[0]["system"] == persona.system_prompt("ja", route) + answers_module.MESSAGE_RULES


async def test_the_fast_voice_answer_keeps_raphaels_owner_instructions(voice, client, ledger):
    from dataclasses import replace
    from raphael_core.agent.speaker import RAPHAEL

    client.replies.append(completion(spoken()))
    await reply(voice, ledger, speaker=replace(RAPHAEL, instructions="OWNER-FAST-INSTRUCTION"))
    assert "OWNER-FAST-INSTRUCTION" in client.json_calls[0]["system"]


async def test_the_question_goes_in_tags_after_the_time(voice, client, ledger):
    client.replies.append(completion(spoken()))
    await reply(voice, ledger, question="台北天氣如何")
    message = client.json_calls[0]["user"]
    assert message.startswith("Current date and time: 2026-10-20 14:05, Tuesday (UTC+08:00)")
    assert "<question>\n台北天氣如何\n</question>\n\nUse the language specified" in message
    assert "Conversation so far" not in message and "Tool results" not in message


@pytest.mark.parametrize(
    ("language", "named"),
    [("en", "English"), ("ja", "Japanese"), ("zh-TW", "Traditional Chinese")],
)
async def test_last_instruction_follows_speaker_and_owner_not_interface(
    voice, client, ledger, language, named
):
    # A Chinese owner question stays authoritative in any interface locale.
    client.replies.append(completion(spoken()))
    await reply(voice, ledger, question="台北天氣如何", language=language)
    last_line = client.json_calls[0]["user"].rsplit("\n\n", 1)[1]
    assert last_line == persona.REPLY_LANGUAGE


async def test_the_background_tasks_are_given_as_their_own_block_before_the_question(
    voice, client, ledger
):
    client.replies.append(completion(spoken()))
    block = "<background_tasks>\nfacts\n</background_tasks>"
    await reply(voice, ledger, question="寄出去了嗎", background=block)
    message = client.json_calls[0]["user"]
    assert block in message
    assert message.index(block) < message.index("<question>")
    client.replies.append(completion(spoken()))
    await reply(voice, ledger)
    assert "background_tasks" not in client.json_calls[1]["user"]


async def test_the_conversation_so_far_is_given_oldest_first(voice, client, ledger):
    client.replies.append(completion(spoken()))
    context = [
        turn("今天幾號", "今天是十月二十日。", number=1),
        turn("打開 YouTube", "", prefix="了", route="command", number=2),
    ]
    await reply(voice, ledger, route="discuss", context=context)
    message = client.json_calls[0]["user"]
    section = message.split("Conversation so far (oldest first):\n")[1].split("\n\n")[0]
    assert section == "owner: 今天幾號\nRaphael: 今天是十月二十日。\nowner: 打開 YouTube\nRaphael: 了"


async def test_the_tool_results_are_given_as_data_and_a_tool_that_failed_is_said_to(
    voice, client, ledger
):
    client.replies.append(completion(spoken()))
    tools = [
        ToolResult("weather", True, {"city": "Taipei", "now": {"temperature_c": 24.1}}),
        ToolResult("web_search", False, None, "timeout"),
        ToolResult("local_time", True, NOW),
    ]
    await reply(voice, ledger, tools=tools)
    message = client.json_calls[0]["user"]
    section = message.split("Tool results:\n")[1].split("\n\n")[0].splitlines()
    assert section[0] == 'weather: {"city": "Taipei", "now": {"temperature_c": 24.1}}'
    assert section[1] == "web_search: unavailable (timeout)"
    assert section[2].startswith('local_time: {"iso": "2026-10-20T14:05:09+08:00"')


async def test_chinese_in_a_tool_result_goes_as_it_is_and_not_escaped(voice, client, ledger):
    client.replies.append(completion(spoken()))
    await reply(voice, ledger, tools=[ToolResult("web_search", True, {"answer": "明天有雨"})])
    assert "明天有雨" in client.json_calls[0]["user"]


# --- what comes back -------------------------------------------------------------------------------


async def test_a_good_reply_is_the_prefix_the_text_and_the_detail(voice, client, ledger):
    client.replies.append(completion(spoken("告", "明天有雨。", "降雨機率 70%。")))
    result = await reply(voice, ledger)
    assert result == Reply(prefix="告", text="明天有雨。", detail="降雨機率 70%。")


async def test_a_reply_without_a_detail_has_none(voice, client, ledger):
    client.replies.append(completion(spoken(detail="  ")))
    assert (await reply(voice, ledger)).detail is None


async def test_a_detail_that_only_repeats_the_text_is_none(voice, client, ledger):
    client.replies.append(completion(spoken(text="好。", detail="好。")))
    assert (await reply(voice, ledger)).detail is None


async def test_what_the_model_cost_is_written_to_the_spend(voice, client, ledger, conn):
    client.replies.append(completion(spoken(), cost=0.0009))
    await reply(voice, ledger)
    assert [tuple(r) for r in conn.execute("SELECT purpose, model, cost_usd FROM spend")] == [
        ("agent", "openai/gpt-6-luna", 0.0009)
    ]


def test_the_prefix_is_made_one_of_the_language_and_defaults_to_an_answer():
    assert parse_reply(spoken("Answer"), "zh-TW").prefix == "答"
    assert parse_reply(spoken("解"), "en").prefix == "Answer"
    assert parse_reply(spoken("whatever"), "ja").prefix == "解"
    assert parse_reply(spoken(None), "en").prefix == "Answer"


def test_raphael_keeps_the_full_text_and_independent_receipt():
    long = "這是一句剛好十個字的話。" * 12  # 144 characters
    result = parse_reply(spoken(text=long, detail="簡短"), "zh-TW")
    assert result.text == long
    assert result.detail == "簡短"


def test_an_authored_receipt_longer_than_the_reply_is_kept():
    long = "這是一句剛好十個字的話。" * 12
    detail = long + "還有更多的內容。"
    assert parse_reply(spoken(text=long, detail=detail), "zh-TW").detail == detail


def test_line_breaks_in_the_text_are_preserved():
    assert parse_reply(spoken(text="one\ntwo", prefix="Answer"), "en").text == "one\ntwo"


def test_authored_chinese_script_survives_traditional_interface():
    result = parse_reply(spoken(text="这个软件很好用。", detail="详细说明"), "zh-TW")
    assert result.text == "这个软件很好用。"
    assert result.detail == "详细说明"


def test_japanese_and_english_are_not_converted():
    assert parse_reply(spoken("解", "学校は会議です。"), "ja").text == "学校は会議です。"
    assert parse_reply(spoken("Answer", "It is 24 degrees."), "en").text == (
        "It is 24 degrees."
    )


@pytest.mark.parametrize(
    "data",
    [
        spoken(text=""),
        spoken(text="   "),
        {"prefix": "答"},
        {"prefix": "答", "text": None, "detail": ""},
        {"prefix": "答", "text": 5, "detail": ""},
        {},
        [],
        None,
    ],
)
def test_a_reply_with_nothing_to_say_is_a_failure(data):
    with pytest.raises(AgentFailure) as failure:
        parse_reply(data, "zh-TW")
    assert failure.value.kind == "error"


def test_a_detail_that_is_not_text_is_none():
    assert parse_reply({"prefix": "答", "text": "好。", "detail": 5}, "zh-TW").detail is None


# --- the pages it drew on --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("language", "label"), [("zh-TW", "來源"), ("en", "Sources"), ("ja", "出典")]
)
async def test_the_pages_a_search_drew_on_are_listed_in_the_detail(
    voice, client, ledger, language, label
):
    prefix = persona.PREFIXES[language].answer
    client.replies.append(completion(spoken(prefix, "好。", "更多。")))
    sources = [
        {"title": "CWA", "url": "https://www.cwa.gov.tw/"},
        {"title": "", "url": "https://example.org/rain"},
    ]
    tools = [ToolResult("web_search", True, {"answer": "x", "sources": sources})]
    result = await reply(voice, ledger, language=language, tools=tools)
    assert result.detail == (
        "更多。\n\n" + label + ":\n- CWA https://www.cwa.gov.tw/\n- https://example.org/rain"
    )


async def test_a_search_with_no_pages_adds_nothing(voice, client, ledger):
    client.replies.append(completion(spoken(detail="")))
    tools = [ToolResult("web_search", True, {"answer": "x", "sources": []})]
    assert (await reply(voice, ledger, tools=tools)).detail is None


async def test_the_pages_are_listed_even_when_the_model_wrote_no_detail(voice, client, ledger):
    client.replies.append(completion(spoken(detail="")))
    tools = [ToolResult("web_search", True, {"answer": "x", "sources": [{"title": "CWA", "url": "u"}]})]
    result = await reply(voice, ledger, tools=tools)
    assert result.detail == "來源:\n- CWA u"


# --- when it goes wrong ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("error", "kind"),
    [
        (OpenRouterError(401, "auth", "no"), "auth"),
        (OpenRouterError(402, "credits", "broke"), "credits"),
        (OpenRouterError(0, "network", "offline"), "offline"),
        (OpenRouterError(0, "timeout", "slow"), "timeout"),
        (OpenRouterError(503, "server", "down"), "error"),
        (OpenRouterError(429, "rate_limit", "slow"), "error"),
        (OpenRouterError(400, "bad_request", "no"), "error"),
        (OpenRouterError(200, "bad_response", "html"), "error"),
        (RuntimeError("boom"), "error"),
    ],
)
async def test_a_failing_model_is_a_failure_of_a_kind(voice, client, ledger, error, kind):
    client.replies.append(error)
    with pytest.raises(AgentFailure) as failure:
        await reply(voice, ledger)
    assert failure.value.kind == kind


async def test_a_model_that_hangs_is_a_timeout(client, ledger):
    async def hang(**kwargs):
        await asyncio.sleep(30)

    client.replies.append(hang)
    with pytest.raises(AgentFailure) as failure:
        await reply(Voice(client, timeout_s=0.1), ledger)
    assert failure.value.kind == "timeout"


async def test_a_reply_that_is_paid_for_but_empty_is_still_written_to_the_spend(
    voice, client, ledger, conn
):
    client.replies.append(completion(spoken(text=""), cost=0.002))
    with pytest.raises(AgentFailure):
        await reply(voice, ledger)
    assert conn.execute("SELECT count(*) FROM spend").fetchone()[0] == 1


async def test_nothing_the_user_said_or_the_model_answered_is_logged(
    voice, client, ledger, caplog
):
    client.replies.append(OpenRouterError(503, "server", "秘密 message"))
    with caplog.at_level(logging.DEBUG, logger=answers_module.logger.name):
        with pytest.raises(AgentFailure):
            await reply(voice, ledger, question="我的秘密問題")
    assert "秘密" not in caplog.text

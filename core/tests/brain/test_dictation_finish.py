"""Owner dictation finishing and ask history, with fake cleanup and an in-memory database."""

from dataclasses import replace
from unittest.mock import AsyncMock

import pytest

from raphael_core.brain.cleanup import CleanedPart, CleanupResult
from raphael_core.brain.history import HistoryStore
from raphael_core.brain.textnorm import finish_chinese_dictation, remove_unspoken_ma
from raphael_core.members.store import MemberStore
from raphael_core.protocol import RpcError

from .conftest import item
from .test_service import clock, fake_client, finalize, keys, make_brain, router


@pytest.mark.parametrize(("text", "expected"), [
    ("請幫我確認一下。", "請幫我確認一下"),
    ("先開啟設定。再按儲存。", "先開啟設定，再按儲存"),
    ("「已經完成。」『請確認。』（先不用。）(等一下。)", "「已經完成」『請確認』（先不用）(等一下)"),
    ("第一項。，，\r\n第二項，  \n", "第一項\r\n第二項  \n"),
    ("請看 README.md. Version 1.2, OK?。", "請看 README.md. Version 1.2, OK?"),
    ("日本語です。請保留。\n下一行。", "日本語です。請保留。\n下一行"),
    ("カタカナ。\nﾃｽﾄ。", "カタカナ。\nﾃｽﾄ。"),
    ("執行 `print('。')`。\n``。``，", "執行 `print('。')`\n``。``"),
    ("```python\nx = '。'\n```\n完成。", "```python\nx = '。'\n```\n完成"),
    ("~~~text\n原文。，，\n~~~~\n完成。", "~~~text\n原文。，，\n~~~~\n完成"),
    ("```\n未關閉。\n", "```\n未關閉。\n"),
    ("執行 `第一行。\n第二行。`。\n完成。", "執行 `第一行。\n第二行。`\n完成"),
    ("~~~\n未配對 `。\n~~~\n後面。", "~~~\n未配對 `。\n~~~\n後面"),
])
def test_chinese_full_stops_only_change_unprotected_prose(text, expected):
    assert finish_chinese_dictation(text) == expected
    assert finish_chinese_dictation(expected) == expected


@pytest.mark.parametrize(("raw", "cleaned", "expected"), [
    ("可以幫我確認一下", "可以幫我確認一下嗎？", "可以幫我確認一下"),
    ("顯示嘛", "顯示嗎？", "顯示"),
    ("先確認一下 再通知我", "先確認一下嗎？再通知我。", "先確認一下，再通知我。"),
    ("真的可以嗎", "真的可以嗎？", "真的可以嗎？"),
    ("你有空嗎 幫我確認一下", "你有空嗎？幫我確認一下嗎？", "你有空嗎？幫我確認一下"),
    ("確認 一下，嗎", "確認一下嗎？再幫忙嗎？", "確認一下嗎？再幫忙"),
    ("先確認", "先確認嗎\n再回覆嗎？\n", "先確認\n再回覆\n"),
    ("Please check README.md", "Please check README.md 嗎？", "Please check README.md "),
    ("日本語", "日本語です嗎？", "日本語です嗎？"),
    ("請執行", "請執行 `嗎？`。", "請執行 `嗎？`。"),
    ("程式", "```text\n嗎？\n```", "```text\n嗎？\n```"),
    ("可以嗎 可以嗎", "可以嗎？", "可以嗎？"),
    ("怎麼辦嗎 然後再顯示", "應該怎麼處理嗎？然後再顯示嗎？", "應該怎麼處理嗎？然後再顯示"),
])
def test_only_unspoken_question_particles_are_removed(raw, cleaned, expected):
    assert remove_unspoken_ma(raw, cleaned) == expected


@pytest.mark.parametrize("mode", ["cleaned", "pieces", "fallback"])
async def test_finalization_finishes_single_chunked_and_fallback_results(make_brain, mode, monkeypatch):
    brain = make_brain()
    raw = "請幫我確認一下。再顯示結果。"
    cleaned = "請幫我確認一下嗎？再顯示結果。"
    result = CleanupResult(cleaned if mode != "fallback" else raw, mode != "fallback", None, None, 0, 0)
    if mode == "pieces":
        result = replace(result, parts=(CleanedPart(cleaned, True),))
    monkeypatch.setattr(brain._cleanup, "clean", AsyncMock(return_value=result))
    reply = await brain._finalize_dictation(dict(raw_text=raw, audio_seconds=1, stt_ms=1))
    assert reply["text"] == "請幫我確認一下，再顯示結果"
    assert brain._history.get(reply["id"]).text == reply["text"]
    assert reply["raw_text"] == raw


async def test_fallback_keeps_the_speakers_real_question_and_non_chinese_stays_unchanged(make_brain, monkeypatch):
    brain = make_brain()
    text = "確認一下嗎？。"
    monkeypatch.setattr(brain._cleanup, "clean", AsyncMock(return_value=CleanupResult(text, False, "no_key", None, 0, 0)))
    result = await brain._finalize_dictation(dict(raw_text="確認一下嗎？。", audio_seconds=1, stt_ms=1))
    assert result["text"] == "確認一下嗎？"
    brain._settings.set("languages", ["ja-JP"])
    result = await brain._finalize_dictation(dict(raw_text=text, audio_seconds=1, stt_ms=1))
    assert result["text"] == text


async def test_each_cleaned_chunk_uses_its_own_raw_and_finishes_after_joining(make_brain, monkeypatch):
    brain = make_brain()
    monkeypatch.setattr("raphael_core.brain.service.split_for_cleanup", lambda text: ["請確認一下。", "再顯示結果。"])
    result = CleanupResult("", True, None, None, 0, 0, (
        CleanedPart("請確認一下嗎？", True, "\n"), CleanedPart("再顯示結果嗎？", True),
    ))
    monkeypatch.setattr(brain._cleanup, "clean", AsyncMock(return_value=result))
    reply = await brain._finalize_dictation(dict(raw_text="請確認一下。再顯示結果。", audio_seconds=1, stt_ms=1))
    assert reply["text"] == "請確認一下\n再顯示結果"


@pytest.mark.parametrize("source", [{"kind": "ask"}, {"purpose": "agent"}])
async def test_learning_refuses_explicit_ask_origins(router, conn, source):
    result = await router.call("dictionary.learn", {**source, "corrections": [{"word": "Composio", "misheard": "Compose"}]})
    assert result == {"learned": []}
    assert conn.execute("SELECT COUNT(*) FROM dictionary_evidence").fetchone()[0] == 0


@pytest.mark.parametrize("recipient", [0, "member", "name", "unknown"])
async def test_agent_speech_is_searchable_ask_history_with_its_known_recipient(router, conn, recipient):
    params = {"purpose": "agent"}
    expected = None
    if recipient == 0:
        params["member_id"], expected = 0, "拉斐爾"
    elif recipient == "member":
        member = MemberStore(conn).create_member(name="小霖")
        params["member_id"], expected = member.id, member.name
    elif recipient == "name":
        params["target_app"], expected = "小晴", "小晴"
    result = await finalize(router, "請整理週末的會議紀錄。", **params)
    rows = (await router.call("history.list", {"query": "週末"}))["items"]
    assert len(rows) == 1 and rows[0]["id"] == result["id"]
    assert rows[0]["kind"] == "ask" and rows[0]["target_app"] == expected
    assert (await router.call("history.latest", {}))["item"] is None
    assert conn.execute("SELECT COUNT(*) FROM dictionary").fetchone()[0] == 0
    assert (await router.call("history.clear", {}))["deleted"] == 1


async def test_ask_retention_and_learning_do_not_change_plain_dictation(router, clock, conn):
    plain = await finalize(router, "原本要貼上的文字。", target_app="notepad.exe")
    ask = await finalize(router, "幫我整理一下。", purpose="agent", member_id=0)
    assert HistoryStore(conn).get(plain["id"]).kind == "dictation"
    assert HistoryStore(conn).get(plain["id"]).target_app == "notepad.exe"
    assert (await router.call("history.latest", {}))["item"]["id"] == plain["id"]
    pairs = [{"word": "Composio", "misheard": "Compose"}]
    assert await router.call("dictionary.learn", {"history_id": ask["id"], "corrections": pairs}) == {"learned": []}
    assert conn.execute("SELECT COUNT(*) FROM dictionary_evidence").fetchone()[0] == 0
    assert (await router.call("dictionary.learn", {"history_id": plain["id"], "corrections": pairs}))["learned"] == ["Composio"]
    clock.now_ms += 3 * 86400000
    await router.call("settings.set", {"key": "history_retention_days", "value": 1})
    assert (await router.call("history.list", {}))["items"] == []


@pytest.mark.parametrize("member", [True, -1, "1", 99999999, 2**80])
async def test_invalid_recipient_does_not_write_history(router, member):
    with pytest.raises(RpcError):
        await finalize(router, "請幫忙", purpose="agent", member_id=member)
    assert (await router.call("history.list", {}))["items"] == []

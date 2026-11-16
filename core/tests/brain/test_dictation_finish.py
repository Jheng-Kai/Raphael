"""Owner dictation finishing and ask history, with fake cleanup and an in-memory database."""

from dataclasses import replace
from unittest.mock import AsyncMock

import pytest

from raphael_core.brain.cleanup import CleanedPart, CleanupResult
from raphael_core.brain.history import HistoryStore
from raphael_core.brain.textnorm import drop_final_full_stop
from raphael_core.members.store import MemberStore
from raphael_core.protocol import RpcError

from .conftest import item
from .test_service import clock, fake_client, finalize, keys, make_brain, router


@pytest.mark.parametrize(("text", "expected"), [
    ("請幫我確認一下。", "請幫我確認一下"),
    ("先開啟設定。再按儲存。", "先開啟設定。再按儲存"),
    ("「已經完成。」『請確認。』（先不用。）(等一下。)", "「已經完成。」『請確認。』（先不用。）(等一下。)"),
    ("第一項。\r\n\r\n第二項。  \n", "第一項。\r\n\r\n第二項  \n"),
    ("安排如下：\n\n1. 確認門鎖。保留備用鑰匙。\n2. 週五再寄。", "安排如下：\n\n1. 確認門鎖。保留備用鑰匙。\n2. 週五再寄"),
    ("請看 https://example.org/a.b?q=x%20y。接著回報。", "請看 https://example.org/a.b?q=x%20y。接著回報"),
    ("https://example.org/a.b?q=x%20y", "https://example.org/a.b?q=x%20y"),
    ("完成。\n`內文。`", "完成。\n`內文。`"),
    ("完成。\n日本語です。", "完成。\n日本語です"),
    ("文字，，\n保留逗號，", "文字，，\n保留逗號，"),
    ("請看 README.md. Version 1.2, OK?。", "請看 README.md. Version 1.2, OK?"),
    ("日本語です。請保留。\n下一行。", "日本語です。請保留。\n下一行"),
    ("カタカナ。\nﾃｽﾄ。", "カタカナ。\nﾃｽﾄ"),
    ("執行 `print('。')`。\n``。``。", "執行 `print('。')`。\n``。``"),
    ("```python\nx = '。'\n```\n完成。", "```python\nx = '。'\n```\n完成"),
    ("~~~text\n原文。，，\n~~~~\n完成。", "~~~text\n原文。，，\n~~~~\n完成"),
    ("```\n未關閉。\n", "```\n未關閉。\n"),
    ("執行 `第一行。\n第二行。`。\n完成。", "執行 `第一行。\n第二行。`。\n完成"),
    ("~~~\n未配對 `。\n~~~\n後面。", "~~~\n未配對 `。\n~~~\n後面"),
    # R-DICT-STOP-01: every script ends the same way, by what its mark is, not by its language. A
    # full stop that only ever ends a sentence goes; a dot that may close an abbreviation or a
    # number stays, and the model, which reads the words, leaves out a closing one.
    ("明日の会議は10時からです。", "明日の会議は10時からです"),
    ("完成｡", "完成"),
    ("वह घर गया।", "वह घर गया"),
    ("Please check the fan.", "Please check the fan."),
    ("Done. Check it.\n", "Done. Check it.\n"),
    ("Send it at 3 p.m.", "Send it at 3 p.m."),
    ("We need milk, eggs, etc.", "We need milk, eggs, etc."),
    ("She moved to the U.S.", "She moved to the U.S."),
    ("Brot, Milch usw.", "Brot, Milch usw."),
    ("Fertig．", "Fertig．"),
    ("下午3點開會，帶 v1.2.", "下午3點開會，帶 v1.2."),
    ("Wait...", "Wait..."),
    ("等一下。。", "等一下。。"),
    ("等一下…。", "等一下…。"),
    ("Really?", "Really?"),
    ("Visit example.org", "Visit example.org"),
])
def test_only_a_final_sentence_only_full_stop_goes_in_any_language_outside_code(text, expected):
    assert drop_final_full_stop(text) == expected
    assert drop_final_full_stop(expected) == expected


@pytest.mark.parametrize("mode", ["cleaned", "pieces", "fallback"])
async def test_finalization_leaves_the_words_to_the_model_and_keeps_raw_history(make_brain, monkeypatch, mode):
    # No rule of one language edits the words after the model: fillers are the prompt's to remove.
    brain = make_brain()
    raw = "請保留「呃，\n嗯，例子」。再呃檢查。"
    result = CleanupResult(raw, mode != "fallback", None, None, 0, 0)
    if mode == "pieces":
        result = replace(result, parts=(CleanedPart("請保留「呃，", True, "\n"),
                                        CleanedPart("嗯，例子」。再呃檢查。", True)))
    monkeypatch.setattr(brain._cleanup, "clean", AsyncMock(return_value=result))
    reply = await brain._finalize_dictation(dict(raw_text=raw, audio_seconds=1, stt_ms=1))
    assert reply["text"] == "請保留「呃，\n嗯，例子」。再呃檢查"
    history = brain._history.get(reply["id"])
    assert history.text == reply["text"] and history.raw_text == raw


async def test_a_latin_full_stop_and_the_words_are_the_models_to_clean(make_brain, monkeypatch):
    # The same in every language: nothing after the model removes a word, and a dot that may
    # close an abbreviation ("3 p.m.") is left to the model, which reads the words.
    brain = make_brain()
    brain._settings.set("languages", ["en-US"])
    for raw in ("uh, check the fan.", "Send it at 3 p.m."):
        monkeypatch.setattr(brain._cleanup, "clean", AsyncMock(return_value=CleanupResult(raw, True, None, None, 0, 0)))
        reply = await brain._finalize_dictation(dict(raw_text=raw, audio_seconds=1, stt_ms=1))
        assert reply["text"] == raw


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
    # The model's 嗎 is the model's: no rule after it removes a particle in one language.
    expected = "請幫我確認一下。再顯示結果" if mode == "fallback" else "請幫我確認一下嗎？再顯示結果"
    assert reply["text"] == expected
    assert brain._history.get(reply["id"]).text == reply["text"]
    assert reply["raw_text"] == raw


@pytest.mark.parametrize("chunked", [False, True])
async def test_cleaned_stt_sentence_boundaries_survive_finalization_and_history(make_brain, monkeypatch, chunked):
    brain = make_brain()
    raw = "螢幕已恢復。連線繼續觀察。\n\n星期四再比較。"
    result = CleanupResult(raw, True, None, None, 0, 0)
    if chunked:
        result = replace(result, parts=(CleanedPart("螢幕已恢復。連線繼續觀察。", True, "\n\n"),
                                        CleanedPart("星期四再比較。", True)))
    monkeypatch.setattr(brain._cleanup, "clean", AsyncMock(return_value=result))
    reply = await brain._finalize_dictation(dict(raw_text=raw, audio_seconds=1, stt_ms=1))
    assert reply["text"] == "螢幕已恢復。連線繼續觀察。\n\n星期四再比較"
    assert brain._history.get(reply["id"]).text == reply["text"]


async def test_fallback_keeps_the_speakers_real_question_whatever_the_language(make_brain, monkeypatch):
    brain = make_brain()
    text = "確認一下嗎？。"
    monkeypatch.setattr(brain._cleanup, "clean", AsyncMock(return_value=CleanupResult(text, False, "no_key", None, 0, 0)))
    result = await brain._finalize_dictation(dict(raw_text="確認一下嗎？。", audio_seconds=1, stt_ms=1))
    assert result["text"] == "確認一下嗎？"
    brain._settings.set("languages", ["ja-JP"])
    result = await brain._finalize_dictation(dict(raw_text=text, audio_seconds=1, stt_ms=1))
    assert result["text"] == "確認一下嗎？"


async def test_each_cleaned_chunk_uses_its_own_raw_and_finishes_after_joining(make_brain, monkeypatch):
    brain = make_brain()
    monkeypatch.setattr("raphael_core.brain.service.split_for_cleanup", lambda text: ["請確認一下。", "再顯示結果。"])
    result = CleanupResult("", True, None, None, 0, 0, (
        CleanedPart("請確認一下嗎？", True, "\n"), CleanedPart("再顯示結果嗎？", True),
    ))
    monkeypatch.setattr(brain._cleanup, "clean", AsyncMock(return_value=result))
    reply = await brain._finalize_dictation(dict(raw_text="請確認一下。再顯示結果。", audio_seconds=1, stt_ms=1))
    assert reply["text"] == "請確認一下嗎？\n再顯示結果嗎？"


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

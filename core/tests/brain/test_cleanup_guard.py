"""Cleanup boundary notes are not dictated content; all models and storage are local fakes."""

from unittest.mock import AsyncMock

import pytest

from raphael_core.brain import textnorm
from raphael_core.brain.cleanup import CleanedPart, CleanupResult

from .test_service import KEY, clock, completion, fake_client, keys, make_brain


NOTE = "這句沒有句號收尾，最後一個是逗號，所以以逗號結束"
RAW = "請幫我確認一下 sidebar 的設定，確認完成再通知小陳"
BODY = "請幫我確認一下 sidebar 的設定，確認完成再通知小陳"


@pytest.mark.parametrize(("raw", "cleaned", "expected"), [
    (RAW, BODY + "\n\n" + NOTE, BODY),
    (RAW, BODY + "\n" + NOTE, BODY),
    ("確認版本", "確認版本\n" + NOTE, "確認版本"),
    ("確認版本", "以下是整理後的文字：\n確認版本", "確認版本"),
    (RAW, "以下是整理後的文字：\n\n" + BODY, BODY),
    (RAW, "以下是整理後的文字：\n" + BODY, BODY),
    ("下週會議改到哪一天", "下週會議改到哪一天？\n\n好的，我幫你查", "下週會議改到哪一天？"),
    ("嗯那個請確認版本然後通知小陳", "請確認版本\n\n通知小陳", "請確認版本\n\n通知小陳"),
    ("有兩個問題第一個 sidebar 會跳動第二個 export 檔名亂碼",
     "有兩個問題：\n\n1. sidebar 會跳動\n2. export 檔名亂碼",
     "有兩個問題：\n\n1. sidebar 會跳動\n2. export 檔名亂碼"),
    ("first rename the config file second um bump the version",
     "1. Rename the config file\n2. Bump the version", "1. Rename the config file\n2. Bump the version"),
    ("Please keep the files and retry the upload", "Please keep the files and retry the upload.",
     "Please keep the files and retry the upload."),
    ("明天先 review pull request 再把 files 傳給 Jack",
     "明天先 review pull request，再把 files 傳給 Jack", "明天先 review pull request，再把 files 傳給 Jack"),
    ("週四寄給小王不對週五寄給小陳附件 budget.xlsx 不變",
     "週五寄給小陳，附件 budget.xlsx 不變", "週五寄給小陳，附件 budget.xlsx 不變"),
    ("设定软件然后检查内存", "設定軟體\n\n檢查記憶體", "設定軟體\n\n檢查記憶體"),
    ("開頭結尾", "開頭\n\n這段完全沒有說過的內容\n\n結尾", "開頭\n\n這段完全沒有說過的內容\n\n結尾"),
    ("確認版本", "以下是整理後的文字：\n\n確認版本\n\n好的，我幫你查", "確認版本"),
    ("確認版本", "好的，我幫你查", ""),
    ("確認版本", "以下是整理後的文字：\n\n好的，我幫你查", ""),
    ("確認版本", "確認版本\r\n \r\n" + NOTE, "確認版本"),
    ("確認版本", "  確認版本  \r\n", "  確認版本  \r\n"),
    ("一二三", "123", "123"),
    ("extraordinary", "Extraordinary invented", "Extraordinary invented"),
    ("extraordinary", "Extraordinary invented unexpected", ""),
    ("執行 print hello", "```python\nprint('hello')\n```", "```python\nprint('hello')\n```"),
    (NOTE, NOTE, NOTE),
    ("Keep the files", "Here is the cleaned transcript:\n\nKeep the files.", "Keep the files."),
])
def test_only_unsupported_original_boundary_paragraphs_or_lines_are_removed(raw, cleaned, expected):
    assert textnorm.guard_cleanup_text(raw, cleaned) == expected


def test_dictionary_names_count_as_present_without_whitelisting_other_words():
    assert textnorm.guard_cleanup_text("compose", "Composio", dictionary_words=["Composio"]) == "Composio"
    assert textnorm.guard_cleanup_text("compose", "Composio\n\n好的，我幫你查", dictionary_words=["Composio"]) == "Composio"


@pytest.mark.parametrize("pieces", [False, True])
async def test_finalize_never_keeps_the_models_punctuation_note(make_brain, monkeypatch, pieces):
    brain = make_brain()
    text = BODY + "。\n\n" + NOTE
    result = CleanupResult(text, True, None, "fake/echo", 0.01, 7,
                           (CleanedPart(text, True),) if pieces else ())
    monkeypatch.setattr(brain._cleanup, "clean", AsyncMock(return_value=result))
    reply = await brain._finalize_dictation(dict(raw_text=RAW, audio_seconds=1, stt_ms=1))
    assert reply["text"] == BODY
    assert reply["cleaned"] and reply["fallback_reason"] is None
    row = brain._history.get(reply["id"])
    assert row.text == BODY and row.raw_text == RAW and row.cost_usd == 0.01


@pytest.mark.parametrize("pieces", [False, True])
async def test_unsupported_only_output_recovers_normalized_raw_and_preserves_metadata(make_brain, monkeypatch, pieces):
    brain = make_brain()
    result = CleanupResult(NOTE, True, None, "fake/echo", 0.02, 12,
                           (CleanedPart(NOTE, True),) if pieces else ())
    monkeypatch.setattr(brain._cleanup, "clean", AsyncMock(return_value=result))
    reply = await brain._finalize_dictation(dict(raw_text="请确认版本", audio_seconds=1, stt_ms=1))
    assert reply["text"] == reply["raw_text"] == "請確認版本"
    assert not reply["cleaned"] and reply["fallback_reason"] == "suspicious"
    row = brain._history.get(reply["id"])
    assert not row.cleaned and row.fallback_reason == "suspicious"
    assert row.model == "fake/echo" and row.cost_usd == 0.02 and row.llm_ms == 12


async def test_real_cleanup_validation_evaluates_the_retained_content(make_brain, fake_client, keys):
    brain = make_brain()
    keys.set(KEY)
    fake_client.next_completion = completion({"text": BODY + "\n\n" + NOTE})
    reply = await brain._finalize_dictation(dict(raw_text=RAW, audio_seconds=1, stt_ms=1))
    assert reply["cleaned"] and reply["text"] == BODY


async def test_dictionary_canonical_name_survives_finalization(make_brain, monkeypatch):
    brain = make_brain()
    brain._dictionary.add("Composio", misheard=["Compose"])
    monkeypatch.setattr(brain._cleanup, "clean", AsyncMock(
        return_value=CleanupResult("Composio", True, None, "fake/echo", 0, 0),
    ))
    reply = await brain._finalize_dictation(dict(raw_text="Compose", audio_seconds=1, stt_ms=1))
    assert reply["cleaned"] and reply["text"] == "Composio"


@pytest.mark.parametrize("reject_second", [False, True])
async def test_each_piece_uses_its_own_raw_and_any_rejected_piece_recovers_the_whole(make_brain, monkeypatch, reject_second):
    brain = make_brain()
    raw = "請確認 sidebar。再通知小陳。"
    monkeypatch.setattr("raphael_core.brain.service.split_for_cleanup", lambda text: ["請確認 sidebar。", "再通知小陳。"])
    result = CleanupResult("", True, None, "fake/echo", 0, 0, (
        CleanedPart("請確認 sidebar。\n\n" + NOTE, True, "\n"),
        CleanedPart(NOTE if reject_second else "再通知小陳。\n\n好的，我幫你查", True),
    ))
    monkeypatch.setattr(brain._cleanup, "clean", AsyncMock(return_value=result))
    reply = await brain._finalize_dictation(dict(raw_text=raw, audio_seconds=1, stt_ms=1))
    assert reply["text"] == ("請確認 sidebar。再通知小陳" if reject_second else "請確認 sidebar。\n再通知小陳")
    assert reply["cleaned"] is not reject_second
    assert reply["fallback_reason"] == ("suspicious" if reject_second else None)


async def test_english_finalization_and_raw_fallback_have_the_same_guard_boundary(make_brain, monkeypatch):
    brain = make_brain()
    brain._settings.set("languages", ["en-US"])
    raw = "Please keep the files and retry the upload"
    monkeypatch.setattr(brain._cleanup, "clean", AsyncMock(return_value=CleanupResult(
        "Here is the cleaned transcript:\n\n" + raw + ".\n\nI will check that for you.", True, None, None, 0, 0,
    )))
    reply = await brain._finalize_dictation(dict(raw_text=raw, audio_seconds=1, stt_ms=1))
    assert reply["cleaned"] and reply["text"] == raw + "."
    monkeypatch.setattr(brain._cleanup, "clean", AsyncMock(return_value=CleanupResult(
        raw, False, "no_key", None, 0, 0,
    )))
    reply = await brain._finalize_dictation(dict(raw_text=raw, audio_seconds=1, stt_ms=1))
    assert not reply["cleaned"] and reply["text"] == raw and reply["fallback_reason"] == "no_key"

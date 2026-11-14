"""Text the system keeps for itself never reaches the owner as a member's words (R-TEXT-05 to R-TEXT-08).

Owner, 2026-11-14: replies that were a planning note the model wrote to itself, a quoted example standing in for the answer,
「見 detail」 pointing at a field the conversation folds away, and the line that a member woke the computer, written as the
member's reply. The fixtures here are written for the shapes, not copied from his conversations.
"""
import json
from unittest.mock import AsyncMock

import pytest

from raphael_core.agent.answers import parse_reply
from raphael_core.agent.gate import ToolGate
from raphael_core.agent.permissions import PermissionCards
from raphael_core.agent.persona import MEMBER_TEXT_MAX
from raphael_core.brain.reasoning import split_notes
from raphael_core.computer.vm import LocalVm
from raphael_core.computer.vm_tools import VmTools
from raphael_core.messaging.words import plain_replies
from raphael_core.services.attachment_store import AttachmentStore
from computer.test_vm import Runtime, Bridge, EmptyHub, container
from .test_permission_cards import chat, finished, typed
from .test_owner_questions import wired  # noqa: F401
from .test_service import make_rig  # noqa: F401
from background.conftest import plugins  # noqa: F401

# --- R-TEXT-05: a planning note is not a reply -----------------------------------------------------------------------------

NOTE = ("The owner answered both questions. Q1 is right. For Q2 I should explain that the window has passed, and I should "
        "ask about the tax form last.")


def test_a_note_to_itself_before_the_answer_is_taken_out_of_the_reply():
    said = "好，第一題答對了。\n\n第二題的期限已經過了，所以不能再領。"
    reply, note = split_notes(NOTE + "\n\n" + said, "zh-TW")
    assert reply == said and note == NOTE
    # The note may run straight into the answer on the same line, and a frame stays around what is left.
    reply, note = split_notes("《答。" + NOTE + " " + said + "》", "zh-TW")
    assert reply == "《答。" + said + "》" and note == NOTE
    # A title of the owner's language in the note does not hide it.
    assert split_notes("先生 (Jack) answered both questions, and I should explain the window.\n\n好的。我來說明。", "zh-TW")[1]


@pytest.mark.parametrize("text", [
    "好，我來看一下。",                                                               # nothing English
    "OK. 好的，已經處理了。",                                                         # too short to be a note
    "Dear Anna, I should like to thank you for the lovely gift you sent us last week.\n\n這是你要的英文信。",  # a draft he asked for
    "The update goes out on Friday and the notes are on the release page for anyone who needs them.\n\n詳情在發布頁。",  # no planning
    "```\nI should respond to the user with the plan and then ask about the form\n```\n\n這是範例。",  # code
    "- I should respond to the user, explain the plan and ask about the form\n\n這是範例。",         # a list item
])
def test_an_english_beginning_that_is_the_reply_stays(text):
    assert split_notes(text, "zh-TW") == (text, "")


def test_other_languages_and_an_english_reply_are_never_cut():
    text = NOTE + "\n\nGood, the first one is right."
    assert split_notes(text, "en") == (text, "")
    assert split_notes(text, "de") == (text, "")


async def test_a_note_in_a_cli_answer_is_not_stored_as_a_reply(make_rig, monkeypatch):
    from raphael_core.agent.cli import loop as cli
    from raphael_core.agent.cli.drivers import Event
    rig = make_rig()
    rig.settings.set("agent_model", "cli:claude")
    monkeypatch.setattr(rig.service._cli_brains, "command", lambda name: ["fake"])
    monkeypatch.setattr(rig.service._cli_brains, "available", lambda *args, **kwargs: True)
    said = "第一題答對了，第二題的期限已經過了。"
    words = NOTE + " " + said

    async def run(driver, **kwargs):
        yield Event("text_delta", words)
        yield Event("message", words, data={"id": "reply", "final": True})
        yield Event("final", words)
    monkeypatch.setattr(cli.Driver, "run", run)
    result = await rig.call("agent.ask", {"session_id": "note", "text": "我這樣理解對嗎？", "ui_language": "zh-TW", "source": "app"})
    replies = [item["text"] for item in rig.history.messages([result["turn_id"]])[result["turn_id"]] if item["kind"] == "reply"]
    assert said in result["text"] and "The owner answered" not in result["text"]
    assert replies and all("The owner answered" not in text and "I should" not in text for text in replies)


# --- R-TEXT-06: the outermost frame wins -------------------------------------------------------------------------------------

def test_a_frame_quoted_inside_a_long_reply_is_words_and_the_outer_frame_is_the_one_taken_off():
    pad = "字" * (MEMBER_TEXT_MAX - 100)
    quoted = "《答。請問這個介面支援串流嗎？》"
    text = f"《答。提示詞如下：\n\n{pad}\n\n{quoted}\n\n{pad}\n\n以上》"
    for literal in (False, True):
        reply = parse_reply(text, "zh-TW", long=True, literal=literal)
        assert reply.prefix == "答" and len(reply.messages) == 2
        assert reply.text.startswith("提示詞如下：") and reply.text.endswith("以上")
        assert quoted in reply.text and reply.text.count("《") == 1  # the example is whole, the outer mark is off
    # The same reply handed over as one authored message, and as messages of its own: no piece loses a mark that is words.
    assert parse_reply({"messages": [text]}, "zh-TW", long=True).text == reply.text


def test_a_reply_that_is_only_a_quoted_frame_inside_prose_is_not_taken_for_the_reply():
    quoted = "請問這個介面支援串流嗎？"
    text = f"提示詞裡有這個範例：\n\n《答。{quoted}》\n\n它是輸入的樣子。"
    reply = parse_reply(text, "zh-TW", long=True)
    assert reply.text == text and quoted in reply.text and "提示詞裡有這個範例" in reply.text


def test_a_book_title_that_ends_a_piece_does_not_close_the_reply_early():
    pad = "字" * (MEMBER_TEXT_MAX - 100)
    text = f"《答。{pad}\n\n我推薦《三體》\n\n{pad}\n\n就這些》"
    reply = parse_reply(text, "zh-TW", long=True)
    assert reply.text.count("《") == 1 and "《三體》" in reply.text and reply.text.endswith("就這些")


def test_the_displayed_line_of_a_reply_opens_only_where_no_line_is_open():
    # A quoted frame at the start of a piece of one reply is the reply's words; two replies in a row are two lines.
    assert plain_replies(["《答。前言", "《答。範例》", "結尾》"]) == ["前言", "《答。範例》", "結尾"]
    assert plain_replies(["《了。已建立。》", "《答。好的》"]) == ["已建立。", "好的"]
    assert plain_replies(["《答。第一段", "第二段", "第三段》"]) == ["第一段", "第二段", "第三段"]
    assert plain_replies(["推薦你看《三體》", "《三體》是一部小說。"]) == ["推薦你看《三體》", "《三體》是一部小說。"]


# --- R-TEXT-07: no pointer to a field the conversation folds away ------------------------------------------------------------

def test_a_reply_that_sends_the_owner_to_detail_says_what_it_pointed_at():
    reply = parse_reply({"text": "已更新例行工作。完整新提示詞見 detail。下次執行是明天。", "detail": "新提示詞全文：每天整理市場。"}, "zh-TW")
    assert "detail" not in reply.text and "見" not in reply.text
    assert reply.text == "已更新例行工作。下次執行是明天。\n\n新提示詞全文：每天整理市場。"
    assert reply.detail is None  # it is said where he reads, not kept in the field


def test_a_pointer_in_the_words_of_a_member_goes_too_and_its_messages_carry_what_it_pointed_at():
    reply = parse_reply({"messages": ["摘要在這裡。", "完整內容請見 `detail` 欄位。"], "detail": "完整內容"}, "zh-TW", plain=True)
    assert reply.messages == ["摘要在這裡。", "完整內容"] and reply.text == "摘要在這裡。\n\n完整內容" and reply.detail is None
    english = parse_reply({"text": "Done. See the `detail` field for the whole list.", "detail": "a, b, c"}, "en", plain=True)
    assert english.text == "Done.\n\na, b, c"


def test_a_pointer_with_no_detail_behind_it_is_taken_out_and_the_word_in_prose_stays():
    assert parse_reply({"text": "做好了。見 detail。", "detail": ""}, "zh-TW").text == "做好了。"
    # The word as a word, and a pointer inside a quoted block of code, are the words of the reply.
    kept = "Explain it in detail, then show the `detail` key of the JSON.\n\n```\nsee `detail` field\n```"
    assert parse_reply({"text": kept, "detail": ""}, "en", plain=True).text == kept
    assert parse_reply({"text": "每個細節都在這裡。", "detail": "收據"}, "zh-TW").detail == "收據"


def test_a_detail_that_is_only_receipts_stays_a_receipt():
    reply = parse_reply({"text": "已完成，結果如上。", "detail": "查了三個來源"}, "zh-TW")
    assert reply.text == "已完成，結果如上。" and reply.detail == "查了三個來源"


# --- R-TEXT-08: the wake line is no reply ------------------------------------------------------------------------------------

@pytest.fixture
async def waking_owner(tmp_path, conn, make_rig, client):
    runtime = Runtime()
    vm = LocalVm(tmp_path, runner=runtime)

    async def start(target):
        runtime.raw = container(vm, target, runtime)
        vm.wake_notice(target)  # LocalVm._start says so once, when a computer that was asleep has been started
        return {"ready": True}
    vm.start = AsyncMock(side_effect=start)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Bridge)
    rig = make_rig(plugins=hub, gate=ToolGate(hub, conn=conn), permissions=PermissionCards(conn))
    client.chats = [chat("I will create it.", ("computer__vm_exec", {"command": "printf hello"})), finished("File created.")]
    return rig


async def test_a_member_that_wakes_the_computer_leaves_an_event_line_and_never_a_reply(waking_owner):
    rig = waking_owner
    result = await typed(rig, "Use the computer to create a file")
    turn = rig.history.messages([result["turn_id"]])[result["turn_id"]]
    woke = [item for item in turn if item["kind"] == "event" and json.loads(item["text"]).get("type") == "computer_woke"]
    assert len(woke) == 1 and "woke the computer" in json.loads(woke[0]["text"])["text"]
    replies = [item["text"] for item in turn if item["kind"] == "reply"]
    assert replies and all("woke the computer" not in text and "喚醒" not in text for text in replies)
    assert "woke the computer" not in result["text"] and "喚醒" not in result["text"]


async def test_a_task_that_wakes_the_computer_leaves_the_same_event_line_in_its_turn(wired):
    agent, background = wired
    origin = agent.history.add(session_id="job", question="Prepare", route="delegate", prefix="", text="", status="running",
                               source="routine", scope="private", conversation_id=agent.service.conversations.main())
    task_id = background.submit()
    background.service.attach_turn(task_id, origin)
    task = background.task(task_id)
    background.service._computer_woke(task, "Mei woke the computer to run a command")
    messages = agent.history.messages([origin])[origin]
    assert [(item["kind"], json.loads(item["text"])) for item in messages] == [
        ("event", {"type": "computer_woke", "text": "Mei woke the computer to run a command"})]
    await background.service._cancel({"task_id": task_id})

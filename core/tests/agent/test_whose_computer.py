"""R-COMP-OWN-01: 「用你的電腦開…」 is the member's own computer, never the owner's PC.

Owner, 2026-11-13 and -14: said into the overlay (Alt+Space), 「用你的電腦開…」 meant Raphael's own computer, but the voice
router took 「開」 as the fixed command that opens things and opened the page on his own PC, with an empty reply. A quick
request that names the member's computer goes to the member's turn; the shortcut, when it runs, says what it did; a request
that names neither computer is asked once. Fakes only: no model, no PC, no Docker.
"""

import pytest

from raphael_core.agent.persona import PHRASES
from raphael_core.agent.whose_computer import MEMBER, OWNER, UNSURE, answer_to_the_question, whose_computer
from .conftest import decision
from .test_narration import chat
from .test_owner_pc_reach import PC_TOOLS, names, prompt_of, with_own_computer  # noqa: F401
from raphael_core.agent.device import StartApp
from .test_service import did, make_rig, site  # noqa: F401


# --- the words -------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("text", [
    "用你的電腦開 YouTube", "用你自己的電腦打開 github.com", "你用電腦開一下這個網頁", "你去用電腦開 Google", "請用妳的電腦開啟 Gmail",
    "用拉斐爾的電腦開 YouTube", "open YouTube on your computer", "use your own computer to open reddit", "Raphael, launch Chrome on your PC",
    "あなたのパソコンでYouTubeを開いて", "用你的電腦開 YouTube，不是我的電腦",
])
def test_a_request_that_names_the_members_computer_is_the_members(text):
    assert whose_computer(text) == MEMBER


@pytest.mark.parametrize("text", [
    "用我的電腦開 YouTube", "在我這台電腦打開 Spotify", "本機打開計算機", "open YouTube on my computer", "launch Spotify on this PC",
    "私のパソコンでYouTubeを開いて", "このパソコンでメモ帳を開いて",
])
def test_a_request_that_names_the_owners_pc_is_the_owners(text):
    assert whose_computer(text) == OWNER


@pytest.mark.parametrize("text", [
    "用電腦開 YouTube", "幫我用電腦打開這個網頁", "open it on the computer", "launch Spotify on a computer", "パソコンでYouTubeを開いて",
])
def test_a_request_that_names_no_ones_computer_is_unsure(text):
    assert whose_computer(text) == UNSURE


@pytest.mark.parametrize("text", [
    "開 youtube", "打開計算機", "open spotify", "電腦的音量大一點", "what is a computer", "你的機器人好嗎", "open the pcb file",
])
def test_a_request_about_no_computer_is_left_to_the_router(text):
    assert whose_computer(text) is None


@pytest.mark.parametrize(("reply", "side"), [
    ("你自己的", MEMBER), ("拉斐爾自己的電腦", MEMBER), ("your own", MEMBER), ("好", MEMBER), ("either", MEMBER),
    ("這台", OWNER), ("我的", OWNER), ("this one", OWNER), ("my pc", OWNER), ("このパソコン", OWNER),
    ("現在幾點", None), ("open YouTube and then tell me how the weather is today", None),
])
def test_the_reply_to_which_computer_names_a_side(reply, side):
    assert answer_to_the_question(reply) == side


# --- a quick request ---------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("text", ["用你的電腦開 YouTube", "用你自己的電腦打開 youtube.com", "open YouTube on your own computer"])
async def test_a_quick_request_for_the_members_computer_goes_to_its_turn_not_to_the_owners_pc(with_own_computer, client, text):
    rig, hub = with_own_computer
    await hub.prepare(0)
    client.chats = [chat("Opening it.", ("computer__vm_exec", {"command": "echo opening"})), chat('{"text":"Opened."}')]
    result = await rig.ask(text)
    assert result["status"] == "done" and result["text"] != ""
    assert client.decide_calls == []  # the fast router was never asked: it could have picked the owner-PC command
    assert not rig.actions.calls  # nothing was opened on the owner's PC
    rig.host.execute.assert_not_awaited()
    offered = names(client.chat_calls[0]["tools"])
    assert {"computer__browser_open", "computer__vm_exec"} <= offered
    assert not offered & PC_TOOLS and not [name for name in offered if name.startswith("local__")]
    assert "owner's PC" not in prompt_of(client.chat_calls[0])


async def test_the_member_that_has_no_computer_says_so_and_still_does_not_borrow_the_owners(make_rig, client, conn):
    from .test_owner_pc_reach import rig_with_pc
    rig = rig_with_pc(make_rig, conn)
    client.chats = [chat('{"text":"I have no computer to open it on."}')]
    result = await rig.ask("用你的電腦開 YouTube", language="zh-TW")
    assert result["status"] == "done" and result["text"]
    assert client.decide_calls == [] and not rig.actions.calls
    offered = names(client.chat_calls[0]["tools"])
    assert not offered & PC_TOOLS and not [name for name in offered if name.startswith("local__")]


@pytest.mark.parametrize("text", ["用我的電腦開 youtube.com", "open youtube.com on my computer", "打開 youtube.com"])
async def test_the_owners_own_pc_still_opens_the_page_when_the_owner_says_so_and_says_so_back(make_rig, client, actions, text):
    rig = make_rig()
    client.decisions.append(decision("command", "open"))
    client.replies.append(site("https://youtube.com/", "YouTube"))  # what the model finds for a name the words do not give whole
    result = await rig.ask(text, language="zh-TW" if "電腦" in text or "打開" in text else "en")
    assert did(actions) == [("open_url", "https://youtube.com/")]
    assert result["status"] == "done" and "youtube" in result["text"].casefold()


async def test_a_quick_request_to_the_owner_pc_is_still_the_owners_to_ask_for(make_rig, client, actions):
    # The rule is unchanged: only a quick question reaches this PC, and nothing here widens it.
    rig = make_rig()
    client.decisions.append(decision("command", "open"))
    client.replies.append(site("https://youtube.com/", "YouTube"))
    await rig.ask("在我這台電腦開 youtube.com")
    assert did(actions) == [("open_url", "https://youtube.com/")]


@pytest.mark.parametrize(("language", "line"), [("zh-TW", "已在你的電腦打開「youtube.com」。"), ("en", "Opened youtube.com on your computer."),
                                               ("ja", "あなたのコンピューターで「youtube.com」を開きました。")])
async def test_the_shortcut_says_in_one_line_what_it_did(make_rig, client, actions, language, line):
    rig = make_rig()
    client.decisions.append(decision("command", "open"))
    result = await rig.ask("open youtube.com", language=language)
    assert result["text"] == line == PHRASES[language].opened.format(target="youtube.com")
    [turn] = await rig.turns()
    assert turn["text"] == line  # the history says it too, not an empty turn


async def test_an_app_that_was_opened_is_named_as_the_start_menu_names_it(make_rig, client, actions):
    rig = make_rig()
    actions.apps = [StartApp("Calculator", "calc!App")]
    client.decisions.append(decision("command", "open"))
    result = await rig.ask("open calculator", language="en")
    assert did(actions) == [("launch_app", "calc!App")]
    assert result["text"] == "Opened Calculator on your computer."


# --- asked once ------------------------------------------------------------------------------------------------------


async def test_a_request_that_names_no_ones_computer_is_asked_once_and_costs_nothing(make_rig, client, actions):
    rig = make_rig()
    first = await rig.ask("用電腦開 YouTube", language="zh-TW")
    assert "這台電腦" in first["text"] and "自己的電腦" in first["text"] and first["prefix"] == "問"
    assert client.calls == 0 and not rig.actions.calls  # nothing was routed, nothing was opened
    [turn] = await rig.turns()
    assert turn["status"] == "done" and turn["text"] == first["text"]


@pytest.mark.parametrize("reply", ["你自己的", "好", "用電腦開 YouTube", "your own"])
async def test_the_members_own_computer_answers_without_asking_again(with_own_computer, client, reply):
    rig, hub = with_own_computer
    await hub.prepare(0)
    asked = await rig.ask("open YouTube on the computer", language="en")
    assert asked["text"] == PHRASES["en"].which_computer.format(who="Raphael")
    client.chats = [chat("Opening it.", ("computer__vm_exec", {"command": "echo opening"})), chat('{"text":"Opened."}')]
    again = await rig.ask(reply, language="en")
    assert again["text"] not in {asked["text"], ""}  # it was asked once, and now it is done
    assert client.decide_calls == [] and not rig.actions.calls
    assert not names(client.chat_calls[0]["tools"]) & PC_TOOLS


async def test_this_pc_as_the_answer_keeps_the_owner_pc_shortcut(make_rig, client, actions):
    rig = make_rig()
    await rig.ask("open youtube.com on the computer", language="en")
    client.decisions.append(decision("command", "open"))
    result = await rig.ask("this one", language="en")
    assert len(client.decide_calls) == 1  # the router was asked, as it is for any quick request
    assert result["status"] == "done"

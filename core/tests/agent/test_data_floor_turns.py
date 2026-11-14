"""The data floor in a turn (R-FLOOR-01): the model is told once what to use instead and goes on; the owner reads
plain words in their own language, never a safety rule around an English sentence.

Owner, 2026-11-11: the refusal reached him in English inside a Chinese conversation, in the frame of
「安全規則「…」不准此操作。未執行。」, and the turn ended there. 2026-11-14: a refusal no longer ends the turn at the second
try either; the member is told again and answers with what it can (R-FLOOR-04).
"""

import json
from unittest.mock import AsyncMock

import pytest

from raphael_core.agent.data_floor import WRITE_REFUSAL
from raphael_core.agent.gate import ToolGate
from raphael_core.agent.permissions import PermissionCards
from raphael_core.agent.persona import PHRASES
from raphael_core.agent.safety import DENY, Screening, forbidden
from raphael_core.brain.settings import SettingsStore
from .test_local_commands import local_hub
from .test_narration import chat
from .test_service import make_rig  # noqa: F401
from background.conftest import plugins  # noqa: F401

COMMAND = 'Set-Content "C:/data/raphael.db" hacked'  # a command aimed at the app's own database
OWNER_ZH = "成員想用指令或檔案工具改 Raphael 的資料，不被允許，未執行。"


def ask(rig, language="en", text="Please write the skill file for me"):
    rig.typed_count = getattr(rig, "typed_count", 0) + 1
    # A quick question: the one turn that has a command for the owner's PC (R-PC-01).
    return rig.call("agent.ask", {"session_id": f"floor-{rig.typed_count}", "text": text, "ui_language": language, "source": "app", "member_id": 0,
                                  "destination": "quick", "conversation_id": rig.service.conversations.quick()})


@pytest.fixture
def floor_rig(make_rig, conn):
    hub, host = local_hub(conn)
    SettingsStore(conn).set("local_commands_seen", True)
    rig = make_rig(plugins=hub, gate=ToolGate(hub, conn=conn), permissions=PermissionCards(conn))
    rig.host = host
    return rig


@pytest.mark.parametrize("language", ["zh-TW", "en", "ja", "de"])
def test_the_owner_reads_plain_words_in_their_language_not_a_rule_around_english(language):
    text = forbidden(language, Screening(DENY, WRITE_REFUSAL, protected=True))
    assert text == PHRASES[language].protected_data
    assert WRITE_REFUSAL not in text and "Commands, scripts" not in text
    assert "安全規則" not in text and "safety rule" not in text.lower() and "安全ルール" not in text
    assert forbidden("zh-TW", Screening(DENY, "寫筆記")) == "安全規則「寫筆記」不准此操作。未執行。"  # a real rule is worded as before
    assert PHRASES["zh-TW"].protected_data == OWNER_ZH


async def test_the_first_refusal_is_given_to_the_model_which_goes_on(floor_rig, client):
    # The loop asks the model once more after a failed tool, so a second answer is queued.
    client.chats = [chat("Writing the file.", ("local__local_exec", {"command": COMMAND})), chat('{"text":"I will use the skill tool."}'),
                    chat('{"text":"I will use the skill tool instead."}')]
    result = await ask(floor_rig)
    assert result["status"] == "done" and result["text"] == "I will use the skill tool instead."
    floor_rig.host.execute.assert_not_awaited()  # the guard is unchanged: nothing was written
    # What the model was handed is the instruction, not the owner's words.
    handed = json.dumps(client.chat_calls[-1]["messages"], ensure_ascii=False)
    assert "skill_manage" in handed and "management tools" in handed
    assert PHRASES["en"].protected_data not in handed


async def test_a_second_refusal_is_told_to_the_model_which_answers_with_what_it_can(floor_rig, client):
    # The owner asked why the computer would not start; the member went looking in the app's own files, was refused twice,
    # and the whole of its reply was the refusal. It answers what it can.
    said = "I could not read the app's files, but Docker was not running when it tried."
    client.chats = [chat("Looking in the log.", ("local__local_exec", {"command": COMMAND})),
                    chat("Trying another way.", ("local__local_exec", {"command": COMMAND + " again"})),
                    chat(json.dumps({"text": said})), chat(json.dumps({"text": said}))]  # the loop asks once more after a failed tool
    result = await ask(floor_rig, "en", "Why will the computer not start?")
    assert result["status"] == "done" and result["text"] == said
    floor_rig.host.execute.assert_not_awaited()
    handed = json.dumps(client.chat_calls[-1]["messages"], ensure_ascii=False)
    assert "This is the second refusal" in handed and "go on with the rest of what they asked" in handed


@pytest.mark.parametrize("language", ["zh-TW", "en", "ja"])
async def test_a_model_that_keeps_trying_is_ended_in_the_owners_words_and_never_in_the_rule(floor_rig, client, language):
    client.chats = [chat("Writing.", ("local__local_exec", {"command": COMMAND + f" {n}"})) for n in range(4)]
    result = await ask(floor_rig, language)
    assert result["text"] == PHRASES[language].protected_data
    floor_rig.host.execute.assert_not_awaited()
    assert "Commands, scripts" not in result["text"] and "安全規則" not in result["text"]


async def test_a_command_that_does_not_touch_the_apps_files_is_not_held_back(floor_rig, client):
    floor_rig.host.execute.return_value = {"exit_code": 0, "stdout": "ok", "stderr": "", "truncated": False}
    floor_rig.settings.set("action_mode", "bypass")  # a quick question shows no card, so only here does a command run
    client.chats = [chat("Checking.", ("local__local_exec", {"command": "Get-Process"})), chat('{"text":"Done."}')]
    result = await ask(floor_rig)
    assert result["status"] == "done"  # not a refusal
    assert floor_rig.host.execute.await_count == 1

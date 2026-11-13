"""The interactive harness resumes after the existing desktop permission flow (a quick question's alone, R-PC-01)."""

import asyncio
import json

from agent.test_narration import chat, use
from .test_operate import operating, shell, PRESS_SEVEN  # noqa: F401


def quick(operating, **params):
    """As a question typed in the quick conversation asks: the one turn that can reach the owner's desktop."""
    return operating.call("agent.ask", {"ui_language": "en", "source": "app", "destination": "quick",
                                        "conversation_id": operating.service.conversations.quick(), **params})


async def test_cli_computer_tool_uses_auxiliary_api_model_and_keeps_approval_flow(operating, client, shell, conn, tmp_path):
    from members.test_cli_brains import fake_mcp
    from raphael_core.brain.settings import SettingsStore

    settings = SettingsStore(conn)
    settings.set("agent_model", "cli:claude")
    settings.set("assistant_model", "anthropic/claude-haiku-5.5")
    # The desktop is seldom called, so it is found, not listed (decision 2): the CLI calls it through use_tool.
    fake_mcp(operating, tmp_path, [("use_tool", {"name": "computer", "arguments": {"request": "Press seven in Calculator"}})])
    client.chats = list(PRESS_SEVEN)
    asked = await quick(operating, session_id="cli-computer", text="Press seven")
    assert asked["status"] == "confirm"
    done = await operating.confirm(asked["confirm"]["id"])
    assert done["text"] == "Finished."
    assert client.chat_calls and all(call["model"] == "anthropic/claude-haiku-5.5" for call in client.chat_calls)
    assert any(operation == "act" for operation, _ in shell.requests)


async def test_desktop_permission_resumes_the_same_harness_turn(operating, client, shell):
    client.chats = [chat('先用計算機確認結果。', use('computer', {'request': '在小算盤按七'})), *PRESS_SEVEN, chat('{"text":"已按下七。","detail":""}')]
    asked = await quick(operating, session_id='live', text='在小算盤按七', ui_language='zh-TW')
    assert asked['status'] == 'confirm'
    done = await operating.confirm(asked['confirm']['id'])
    assert done['status'] == 'done' and done['turn_id'] == asked['turn_id']
    assert done['text'] == '已按下七。'
    [turn] = await operating.turns()
    assert [m['kind'] for m in turn['messages']] == ['progress', 'event', 'event', 'reply']
    assert all(json.loads(m['text'])['type'] == 'action' for m in turn['messages'] if m['kind'] == 'event')
    assert any(op == 'act' for op, args in shell.requests)
    assert client.chat_calls[-1]['messages'][-1]['role'] == 'tool'


async def test_cancel_a_desktop_permission_finishes_the_existing_turn_once(operating, client, shell):
    client.chats = [chat("Checking the calculator.", use("computer", {"request": "Press seven"})), *PRESS_SEVEN]
    asked = await quick(operating, session_id="live", text="Press seven")
    assert asked["status"] == "confirm"
    await operating.call("agent.cancel", {"session_id": "live"})
    run = operating.service._computer.for_question(asked["confirm"]["id"])
    if run and run.task:
        await run.task
    await asyncio.sleep(0)
    [turn] = await operating.turns()
    assert turn["status"] == "denied"
    assert len([m for m in turn["messages"] if m["kind"] == "reply"]) == 1
    assert "Checking the calculator." in next(m["text"] for m in turn["messages"] if m["kind"] == "progress")
    assert not any(op == "act" for op, args in shell.requests)


async def test_a_denied_desktop_permission_is_data_for_the_harness_not_a_second_turn(operating, client, shell):
    client.chats = [chat("Checking the calculator.", use("computer", {"request": "Press seven"})), *PRESS_SEVEN[:3], chat('{"text":"I left it unchanged.","detail":""}')]
    asked = await quick(operating, session_id="live", text="Press seven")
    await operating.confirm(asked["confirm"]["id"], approved=False)
    [turn] = await operating.turns()
    assert turn["text"] == "I left it unchanged."
    assert not any(op == "act" for op, args in shell.requests)


async def test_a_conversation_is_not_offered_the_desktop_at_all(operating, client, shell):
    said = chat('{"text":"I cannot reach the desktop.","detail":""}')
    client.chats = [chat("Checking the calculator.", use("computer", {"request": "Press seven"})), said, said]
    answer = await operating.call("agent.ask", {"session_id": "live", "source": "app", "text": "Press seven", "ui_language": "en"})
    assert answer["status"] == "done" and "confirm" not in answer
    assert shell.requests == []
    assert any("not a tool of this task" in str(m.get("content")) for m in client.chat_calls[-1]["messages"])

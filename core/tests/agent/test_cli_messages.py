"""Native CLI protocols expose only complete public assistant messages."""

import sys

import pytest

from raphael_core.agent.cli.drivers import Driver


@pytest.mark.parametrize("name", ["codex", "claude", "gemini"])
@pytest.mark.parametrize("stream", [False, True])
async def test_native_message_boundaries_do_not_repeat_streamed_blocks(tmp_path, name, stream):
    script = tmp_path / "messages.py"
    script.write_text('''import json, sys
name, stream = sys.argv[1], sys.argv[2] == "True"
def send(value): print(json.dumps(value), flush=True)
def finish():
    for index, word in enumerate(["First.", "Second.", "Third."]):
        if name == "claude":
            send({"type":"stream_event", "event":{"delta":{"type":"thinking_delta", "thinking":"PRIVATE"}}})
            if stream:
                send({"type":"stream_event", "event":{"delta":{"type":"text_delta", "text":word[:2]}}})
                send({"type":"stream_event", "event":{"delta":{"type":"text_delta", "text":word[2:]}}})
                send({"type":"stream_event", "event":{"type":"content_block_stop"}})
            send({"type":"assistant", "message":{"content":[{"type":"text", "text":word}]}})
            if index < 2:
                send({"type":"assistant", "message":{"content":[{"type":"tool_use", "id":str(index), "name":"local_time"}]}})
                send({"type":"user", "message":{"content":[{"type":"tool_result", "tool_use_id":str(index), "content":"RAW"}]}})
        elif name == "gemini":
            send({"event":"step_update", "step_update":{"step_type":"thinking", "text_delta":"PRIVATE"}})
            send({"event":"step_update", "step_update":{"step_type":"agent_response", "text_delta":word}})
            send({"event":"step_update", "step_update":{"step_type":"agent_response", "state":"DONE", "id":str(index)}})
            if index < 2:
                send({"event":"step_update", "step_update":{"step_type":"tool", "state":"ACTIVE", "tool_name":"local_time"}})
                send({"event":"step_update", "step_update":{"step_type":"tool", "state":"DONE", "tool_name":"local_time", "output":"RAW"}})
        else:
            send({"method":"item/agentMessage/delta", "params":{"delta":word}})
            send({"method":"item/completed", "params":{"item":{"type":"agentMessage", "id":str(index), "phase":"commentary" if index < 2 else "final_answer", "text":word}}})
            if index < 2:
                item = {"type":"mcpToolCall", "id":"tool" + str(index), "tool":"local_time", "status":"completed", "result":"RAW"}
                send({"method":"item/started", "params":{"item":item}})
                send({"method":"item/completed", "params":{"item":item}})
    if name == "claude": send({"type":"result", "subtype":"success", "result":"Third."})
    elif name == "gemini": send({"event":"result", "result":{"status":"SUCCESS", "response":"Third."}})
    else: send({"method":"turn/completed", "params":{"turn":{"status":"completed"}}})
if name == "codex":
    for line in sys.stdin:
        msg = json.loads(line)
        if msg.get("method") == "initialize": send({"id":msg["id"], "result":{}})
        elif msg.get("method") == "thread/start": send({"id":msg["id"], "result":{"thread":{"id":"fake"}}})
        elif msg.get("method") == "turn/start":
            finish()
            break
else:
    json.loads(sys.stdin.readline())
    finish()
''', encoding="utf-8")
    events = [event async for event in Driver(name, [sys.executable, str(script), name, str(stream)]).run(
        user="Prepare", system="Persona", endpoint="http://127.0.0.1:1/mcp", token="fake", permission=None)]
    assert [event.text for event in events if event.kind == "message"] == ["First.", "Second.", "Third."]
    sequence = [event.kind for event in events if event.kind in ("message", "tool_start", "tool_end")]
    assert sequence == ["message", "tool_start", "tool_end", "message", "tool_start", "tool_end", "message"]
    assert events[-1].kind == "final" and events[-1].text == "Third."
    assert not any("PRIVATE" in event.text or "RAW" in event.text for event in events)

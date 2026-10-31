"""CLI stream steps use the shared activity table, without launching a CLI."""

from types import SimpleNamespace

import pytest

from raphael_core.agent.cli import loop as cli
from raphael_core.agent.cli.drivers import Event
from raphael_core.members.activity import Activity


@pytest.mark.parametrize("brain", ["codex", "claude"])
async def test_cli_stream_pairs_concurrent_tools_and_duplicate_starts(monkeypatch, tmp_path, brain):
    notes = []
    activity = Activity(lambda method, data: notes.append(data["state"]))

    class FakeDriver:
        def __init__(self, *args, **kwargs):
            pass

        async def run(self, **kwargs):
            yield Event("tool_start", data={"id": "search", "name": "mcp__raphael__web_read"})
            assert activity.state(5) == "searching"
            yield Event("tool_start", data={"id": "search", "name": "mcp__raphael__web_read"})
            yield Event("tool_start", data={"id": "desktop", "server": "computer", "name": "click"})
            assert activity.state(5) == "computer"
            yield Event("tool_end", data={"id": "search", "ok": True})
            assert activity.state(5) == "computer"
            yield Event("tool_end", data={"id": "desktop", "ok": True})
            assert activity.state(5) == "thinking"
            yield Event("final", "Finished.")

    monkeypatch.setattr(cli, "Driver", FakeDriver)
    loop = cli.CliLoop(brains=SimpleNamespace(environ={}, home=tmp_path), sessions=None,
        member_id=5, model=f"cli:{brain}:fake", ledger=None, language="en", plain=True,
        system="", user="", tools=[], progress=lambda text: None, thinking=lambda text: None,
        event=lambda text: None, execute=None)

    async def work():
        await loop._attempt(brain, ["fake"], "fake", SimpleNamespace(url="unused", token="fake", computer_url=None), None, tmp_path)

    monkeypatch.setattr(loop, "_work", work)
    with activity.turn(5):
        result = await loop.run()
        assert result.status == "done"
    assert notes == ["thinking", "searching", "computer", "thinking", "done", "idle"]


async def test_cli_stream_crash_cleans_unfinished_tool(monkeypatch, tmp_path):
    activity = Activity()

    class FakeDriver:
        def __init__(self, *args, **kwargs):
            pass

        async def run(self, **kwargs):
            yield Event("tool_start", data={"id": "desktop", "name": "computer__click"})
            assert activity.state(5) == "computer"
            raise RuntimeError("fake stream crash")

    monkeypatch.setattr(cli, "Driver", FakeDriver)
    loop = cli.CliLoop(brains=SimpleNamespace(environ={}, home=tmp_path), sessions=None,
        member_id=5, model="cli:codex:fake", ledger=None, language="en", plain=True,
        system="", user="", tools=[], progress=lambda text: None, thinking=lambda text: None,
        event=lambda text: None, execute=None)
    with pytest.raises(RuntimeError), activity.turn(5) as run:
        loop.activity_turn = run
        await loop._attempt("codex", ["fake"], "fake", SimpleNamespace(url="unused", token="fake", computer_url=None), None, tmp_path)
    assert activity.state(5) == "error" and not activity.running


@pytest.mark.parametrize("brain", ["codex", "claude"])
async def test_drivers_preserve_native_tool_ids_and_server(tmp_path, brain):
    import sys
    from raphael_core.agent.cli.drivers import Driver

    script = tmp_path / "stream.py"
    script.write_text("""import json, sys
brain = sys.argv[1]
def send(value): print(json.dumps(value), flush=True)
def events():
    if brain == 'claude':
        send({'type':'stream_event', 'event':{'type':'content_block_start', 'content_block':{'type':'tool_use', 'id':'call', 'name':'mcp__computer__click'}}})
        send({'type':'assistant', 'message':{'content':[{'type':'tool_use', 'id':'call', 'name':'mcp__computer__click'}]}})
        send({'type':'user', 'message':{'content':[{'type':'tool_result', 'tool_use_id':'call'}]}})
        send({'type':'result', 'subtype':'success', 'result':'Finished'})
    else:
        for method in ('item/started', 'item/completed'):
            send({'method':method, 'params':{'item':{'type':'mcpToolCall', 'id':'call', 'server':'computer', 'tool':'click', 'status':'completed'}}})
        send({'method':'item/completed', 'params':{'item':{'type':'agentMessage', 'text':'Finished'}}})
        send({'method':'turn/completed', 'params':{'turn':{'status':'completed'}}})
if brain == 'claude':
    json.loads(sys.stdin.readline())
    events()
else:
    for line in sys.stdin:
        packet = json.loads(line)
        if packet.get('method') == 'initialize': send({'id':packet['id'], 'result':{}})
        elif packet.get('method') == 'thread/start': send({'id':packet['id'], 'result':{'thread':{'id':'fake'}}})
        elif packet.get('method') == 'turn/start':
            events()
            break
""", encoding="utf-8")
    events = [event async for event in Driver(brain, [sys.executable, str(script), brain]).run(
        user="Click", system="Fake", endpoint="http://127.0.0.1:1/mcp", token="fake", permission=None)]
    starts = [event for event in events if event.kind == "tool_start"]
    ends = [event for event in events if event.kind == "tool_end"]
    assert starts and all(event.data["id"] == "call" for event in starts)
    assert len(ends) == 1 and ends[0].data["id"] == "call"
    if brain == "codex":
        assert starts[0].data["server"] == "computer"

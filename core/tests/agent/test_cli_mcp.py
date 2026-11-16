import httpx

from raphael_core.agent.mcp_server import RaphaelMcp
from raphael_core.worker.loop import ToolOutcome


async def test_http_mcp_requires_bearer_and_runs_only_offered_tools():
    calls = []

    async def execute(identifier, name, args):
        calls.append((name, args))
        return ToolOutcome(False, "approval_required", content="Blocked by the same gate")

    tools = [{"type": "function", "function": {"name": "routine_delete", "description": "Delete routine",
                                               "parameters": {"type": "object"}}}]
    async with RaphaelMcp(lambda: tools, execute) as server:
        async with httpx.AsyncClient() as client:
            body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "routine_delete", "arguments": {"id": 1}}}
            assert (await client.post(server.url, json=body)).status_code == 401
            assert not calls
            headers = {"Authorization": "Bearer " + server.token}
            response = await client.post(server.url, headers=headers, json=body)
            assert response.json()["result"]["isError"] is True
            assert calls == [("routine_delete", {"id": 1})]
            body["params"]["name"] = "unoffered"
            assert (await client.post(server.url, headers=headers, json=body)).json().get("error")
            assert len(calls) == 1
    assert server.closed


async def test_the_same_request_number_on_both_endpoints_and_on_a_new_server_is_a_different_call():
    identifiers = []

    async def execute(identifier, name, args):
        identifiers.append(identifier)
        return ToolOutcome(True, content="ok")

    tools = [{"type": "function", "function": {"name": name, "description": name, "parameters": {"type": "object"}}}
             for name in ("image_generate", "computer__vm_exec")]
    for _ in range(2):
        async with RaphaelMcp(lambda: tools, execute) as server:
            headers = {"Authorization": "Bearer " + server.token}
            async with httpx.AsyncClient() as client:
                for url, name in ((server.url, "image_generate"), (server.computer_url, "computer__vm_exec")):
                    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": {}}}
                    assert (await client.post(url, headers=headers, json=body)).json()["result"]["isError"] is False
    assert len(identifiers) == 4 and len(set(identifiers)) == 4
    assert identifiers[0].startswith("raphael-") and identifiers[1].startswith("computer-")


async def test_official_mcp_client_can_initialize_list_and_call():
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client

    async def execute(identifier, name, args):
        return ToolOutcome(True, content="hello")

    async with RaphaelMcp(lambda: [{"type": "function", "function": {"name": "hello", "description": "Hello", "parameters": {"type": "object"}}}], execute) as server:
        async with httpx.AsyncClient(headers={"Authorization": "Bearer " + server.token}) as http:
            async with streamable_http_client(server.url, http_client=http) as streams:
                async with ClientSession(streams[0], streams[1]) as client:
                    await client.initialize()
                    assert (await client.list_tools()).tools[0].name == "hello"
                    assert (await client.call_tool("hello", {})).content[0].text == "hello"


async def test_a_call_waiting_at_an_owner_question_does_not_hold_the_server_open():
    """The end of a turn (a question that ran out, a no, a stop) cancels the call that waits at it: the server's exit does not
    wait out the question."""
    import asyncio
    import time
    waiting = asyncio.Event()

    async def execute(identifier, name, args):
        waiting.set()
        await asyncio.sleep(60)
        return ToolOutcome(True, content="never")

    tools = [{"type": "function", "function": {"name": "hello", "description": "Hello", "parameters": {"type": "object"}}}]
    began = time.monotonic()
    async with RaphaelMcp(lambda: tools, execute) as server:
        async with httpx.AsyncClient(headers={"Authorization": "Bearer " + server.token}, timeout=30) as http:
            call = asyncio.ensure_future(http.post(server.url, json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                                                   "params": {"name": "hello", "arguments": {}}}))
            await asyncio.wait_for(waiting.wait(), 5)
        call.cancel()
    assert server.closed and time.monotonic() - began < 10


async def test_a_cli_started_again_in_the_same_turn_makes_calls_of_its_own(monkeypatch, tmp_path):
    # Each CLI process counts its requests from 1, and a turn keeps one server for all its runs: the completion check, a
    # changed tool list or a recovery starts the CLI again. Both runs' first call came in as request 1, and the second's
    # result was recorded over the first call's (owner's data: a command's arguments beside another command's output).
    from types import SimpleNamespace
    from raphael_core.agent.cli import loop as cli
    from raphael_core.agent.cli.drivers import Event
    from raphael_core.background.cli import RoomCliSessions
    identifiers, runs = [], []

    class Driver:
        def __init__(self, *args, **kwargs):
            pass

        async def run(self, **kwargs):
            runs.append(kwargs)
            body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "notes_look", "arguments": {}}}
            async with httpx.AsyncClient(headers={"Authorization": "Bearer " + kwargs["token"]}) as client:
                assert (await client.post(kwargs["endpoint"], json=body)).json()["result"]["isError"] is False
            yield Event("error", "rate_limit") if len(runs) == 1 else Event("final", "Read twice.")

        async def interrupt(self):
            pass

    async def execute(identifier, name, args):
        identifiers.append(identifier)
        return ToolOutcome(True, content="ok")

    monkeypatch.setattr(cli, "Driver", Driver)
    monkeypatch.setattr(cli, "RATE_LIMIT_WAITS_S", (0.0,))
    tools = [{"type": "function", "function": {"name": "notes_look", "description": "Look.", "parameters": {"type": "object"}}}]
    loop = cli.CliLoop(
        brains=SimpleNamespace(environ={}, home=tmp_path, command=lambda name: ["fake"], available=lambda *args, **kwargs: True),
        sessions=RoomCliSessions(), member_id=5, conversation_id=7, model="cli:codex:fake",
        ledger=SimpleNamespace(add=lambda **kwargs: None), language="en", plain=True, system="", user="Look twice.",
        tools=tools, progress=lambda text: None, thinking=lambda text: None, event=lambda text: None, execute=execute)
    assert (await loop.run()).final == "Read twice."
    assert len(runs) == 2 and runs[0]["endpoint"] == runs[1]["endpoint"]
    assert len(identifiers) == 2 and len(set(identifiers)) == 2

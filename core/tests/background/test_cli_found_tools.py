"""A background task on a CLI brain uses the tools `find_tools` found through use_tool.

A CLI reads its tool list once, when it starts. What find_tools returns is the name, description and
schema of each tool that fits, and the CLI calls one by use_tool: its list never changes, so it never
starts again for a search (owner, 2026-11-09, decision 2). Its native session is kept in memory for
the loop alone: a room turn never resumes a conversation of the owner's."""

from types import SimpleNamespace
import pytest

from raphael_core.agent.cli import loop as cli_loop
from raphael_core.background.cli import member_loop

FIND = {"type": "function", "function": {"name": "find_tools", "description": "Find.", "parameters": {"type": "object"}}}
USE = {"type": "function", "function": {"name": "use_tool", "description": "Use.", "parameters": {"type": "object"}}}


def loop_with(answers, made=None):
    async def tool(call):
        if made is not None:
            made.append((call["name"], call["arguments"]))
        return answers[call["name"]]

    run = SimpleNamespace(tool=tool, model="cli:codex", ledger=None, attachments=(), touch=lambda: None)
    task = SimpleNamespace(id=4, member_id=3, language="en", scope="exchange", text="Find the notes")
    spec = {"system": "persona", "user": "task", "tools": [FIND, USE]}
    return member_loop(None, None, task, run, spec, wait_s=1, progress=lambda text: None)


def names(loop):
    return [item["function"]["name"] for item in loop.tools]


async def test_a_search_changes_nothing_and_use_tool_goes_to_the_run():
    made = []
    loop = loop_with({"find_tools": {"ok": True, "content": '{"name": "Notes__look"}'},
                      "use_tool": {"ok": True, "content": "found"}}, made)
    assert (await loop.execute("1", "find_tools", {"query": "look"})).ok
    assert names(loop) == ["find_tools", "use_tool"] and not loop.catalog_changed
    assert (await loop.execute("2", "use_tool", {"name": "Notes__look", "arguments": {"topic": "x"}})).ok
    assert made[-1] == ("use_tool", {"name": "Notes__look", "arguments": {"topic": "x"}})
    assert names(loop) == ["find_tools", "use_tool"] and not loop.catalog_changed


async def test_the_loop_keeps_its_own_native_session_to_start_the_same_cli_again():
    loop = loop_with({})
    assert loop.sessions.get(3, "cli:codex", "room-task-4") is None
    loop.sessions.put(3, "cli:codex", "thread-1", "room-task-4")
    assert loop.sessions.get(3, "cli:codex", "room-task-4") == "thread-1"
    other = loop_with({})
    assert other.sessions.get(3, "cli:codex", "room-task-4") is None, "another task's loop never resumes it"


@pytest.mark.parametrize('session', [None, 'same-task-session'])
async def test_a_search_and_its_call_finish_in_one_cli_run(monkeypatch, tmp_path, session):
    from raphael_core.agent.cli.drivers import Event
    loop = loop_with({'find_tools': {'ok': True, 'content': '{"name": "Notes__look", "description": "Read the launch notes."}'},
                      'use_tool': {'ok': True, 'content': 'The launch is on Friday.'}})
    loop.brains = SimpleNamespace(environ={}, home=tmp_path, command=lambda _: ['fake'], available=lambda *a, **k: True)
    loop.ledger = SimpleNamespace(add=lambda **kwargs: None)
    loop.refresh_tools = lambda: loop.tools
    attempts = []

    class Driver:
        def __init__(self, *args, **kwargs):
            pass

        async def run(self, **kwargs):
            attempts.append(kwargs)
            if session:
                yield Event('session', session)
            await loop._tool('find', 'find_tools', {'query': 'launch notes'})
            yield Event('tool_end', data={'name': 'find_tools'})
            await loop._tool('use', 'use_tool', {'name': 'Notes__look', 'arguments': {}})
            yield Event('tool_end', data={'name': 'use_tool'})
            yield Event('final', 'The launch is on Friday.')

        async def interrupt(self):
            pass
    monkeypatch.setattr(cli_loop, 'Driver', Driver)
    result = await loop.run()
    assert result.status == 'done' and len(attempts) == 1
    await loop.aclose()

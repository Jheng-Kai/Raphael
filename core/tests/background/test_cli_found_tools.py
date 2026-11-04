"""A background task on a CLI brain can use the tools `find_tools` showed it.

A CLI reads its tool list once, when it starts, so the loop lists the new tools and has the CLI start
again in its own native session (kept in memory for the loop alone: a room turn never resumes a
conversation of the owner's)."""

from types import SimpleNamespace

from raphael_core.agent.cli import loop as cli_loop
from raphael_core.background.cli import member_loop

FIND = {"type": "function", "function": {"name": "find_tools", "description": "Find.", "parameters": {"type": "object"}}}
FOUND = {"type": "function", "function": {"name": "Notes__look", "description": "Look.", "parameters": {"type": "object"}}}


def loop_with(answers):
    async def tool(call):
        return answers[call["name"]]

    run = SimpleNamespace(tool=tool, model="cli:codex", ledger=None, attachments=(), touch=lambda: None)
    task = SimpleNamespace(id=4, member_id=3, language="en")
    spec = {"system": "persona", "user": "task", "tools": [FIND]}
    return member_loop(None, None, task, run, spec, wait_s=1, progress=lambda text: None)


def names(loop):
    return [item["function"]["name"] for item in loop.tools]


async def test_the_tools_found_are_listed_and_the_cli_starts_again():
    loop = loop_with({"find_tools": {"ok": True, "content": "Notes__look: Look.", "tools": [FOUND]}})
    outcome = await loop.execute("1", "find_tools", {"query": "look"})
    assert outcome.ok and names(loop) == ["find_tools", "Notes__look"]
    assert loop.catalog_changed and loop.reload_note == cli_loop.TOOLS_FOUND


async def test_a_search_that_found_nothing_changes_nothing():
    loop = loop_with({"find_tools": {"ok": True, "content": "No other tool fits that."}})
    await loop.execute("1", "find_tools", {"query": "zzz"})
    assert names(loop) == ["find_tools"] and not loop.catalog_changed


async def test_the_loop_keeps_its_own_native_session_to_start_the_same_cli_again():
    loop = loop_with({})
    assert loop.sessions.get(3, "cli:codex", "room-task-4") is None
    loop.sessions.put(3, "cli:codex", "thread-1", "room-task-4")
    assert loop.sessions.get(3, "cli:codex", "room-task-4") == "thread-1"
    other = loop_with({})
    assert other.sessions.get(3, "cli:codex", "room-task-4") is None, "another task's loop never resumes it"

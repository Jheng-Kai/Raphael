"""A CLI member that answers twice without reading its last change on the screen back keeps its answer (R-COMP-PERF-09).

A member on Claude Code worked for most of an hour on its computer: one page change in a browser early on, then only
shell commands and file edits. It answered, was started again in the same native session with the completion note
("Before finishing computer work..."), ran one more shell command and answered again. The completion check then stopped
the turn with no words at all: the owner saw neither answer, only the generic failure line, and the log said the model's
reply said nothing. The packets below are a synthetic copy of what the CLI emitted, in the same shapes and order.
"""

from types import SimpleNamespace

import pytest

from raphael_core.agent.cli import loop as cli
from raphael_core.agent.cli.drivers import Driver, Event
from raphael_core.agent.persona import phrase
from raphael_core.background.cli import RoomCliSessions
from raphael_core.messaging.words import plain_replies
from raphael_core.worker.computer_verification import NOTE
from raphael_core.worker.loop import ToolOutcome
from .test_service import make_rig  # noqa: F401

FIRST = "Version two is ready.\n\nThe English and Chinese cuts are in the team folder, with the font sheet."
SECOND = "Version two is ready; I checked the folder again.\n\nThe English and Chinese cuts are in the team folder."


def assistant(identifier, blocks, stop_reason):
    return {"type": "assistant", "message": {"id": identifier, "role": "assistant", "content": blocks,
                                             "stop_reason": stop_reason}}


def streamed_text(identifier, text, stop_reason, *, thought=True):
    """A thinking block and a text block, each streamed and then sent whole, as Claude Code writes an answer."""
    packets = []
    if thought:
        packets += [
            {"type": "stream_event", "event": {"type": "content_block_start", "content_block": {"type": "thinking"}}},
            {"type": "stream_event", "event": {"delta": {"type": "thinking_delta", "thinking": ""}}},
            {"type": "stream_event", "event": {"type": "content_block_stop"}},
            assistant(identifier, [{"type": "thinking", "thinking": "", "signature": "sig"}], stop_reason),
        ]
    half = len(text) // 2
    return packets + [
        {"type": "stream_event", "event": {"type": "content_block_start", "content_block": {"type": "text"}}},
        {"type": "stream_event", "event": {"delta": {"type": "text_delta", "text": text[:half]}}},
        {"type": "stream_event", "event": {"delta": {"type": "text_delta", "text": text[half:]}}},
        {"type": "stream_event", "event": {"type": "content_block_stop"}},
        assistant(identifier, [{"type": "text", "text": text}], stop_reason),
    ]


async def tool_call(loop, identifier, name, arguments):
    """One MCP call of the CLI: the block that starts it, Raphael's server running it, the result the CLI reads."""
    yield {"type": "stream_event", "event": {"type": "content_block_start",
                                             "content_block": {"type": "tool_use", "id": identifier, "name": "mcp__computer__" + name}}}
    yield assistant("call-" + identifier, [{"type": "tool_use", "id": identifier, "name": "mcp__computer__" + name, "input": arguments}], None)
    await loop._tool(identifier, name, arguments)
    yield {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": identifier, "content": "ok"}]}}


def claude_night(stop_reason):
    """The two runs of that turn: the long one that ends in an answer, and the resumed one after the completion note."""
    async def first(loop):
        yield {"type": "system", "subtype": "init", "session_id": "native-1"}
        async for packet in tool_call(loop, "nav", "computer__browser_navigate", {"url": "file:///home/team/sheet.html"}):
            yield packet
        for index in range(3):  # long work after the one page change: shell commands and file edits, no screen read
            async for packet in tool_call(loop, f"sh{index}", "computer__vm_exec", {"command": "ls"}):
                yield packet
            async for packet in tool_call(loop, f"ed{index}", "computer__edit_file", {"path": "notes.md"}):
                yield packet
        for packet in streamed_text("answer-1", FIRST, stop_reason):
            yield packet
        yield {"type": "result", "subtype": "success", "is_error": False, "result": FIRST, "session_id": "native-1"}

    async def second(loop):
        yield {"type": "system", "subtype": "init", "session_id": "native-1"}
        for packet in streamed_text("answer-2", "Checking the folder.", stop_reason):
            yield packet
        async for packet in tool_call(loop, "check", "computer__vm_exec", {"command": "ls /home/team"}):
            yield packet
        for packet in streamed_text("answer-3", SECOND, stop_reason):
            yield packet
        yield {"type": "result", "subtype": "success", "is_error": False, "result": SECOND, "session_id": "native-1"}

    return [first, second]


def event_night(brain):
    """The same turn as the events Codex and Antigravity normalize to."""
    async def first(loop):
        yield Event("session", "native-1")
        await loop._tool("nav", "computer__browser_navigate", {"url": "file:///home/team/sheet.html"})
        yield Event("tool_end", data={"id": "nav", "ok": True})
        await loop._tool("sh", "computer__vm_exec", {"command": "ls"})
        yield Event("message", FIRST, data={"id": "answer-1", "final": brain == "codex"})
        yield Event("final", FIRST)

    async def second(loop):
        yield Event("session", "native-1")
        await loop._tool("check", "computer__vm_exec", {"command": "ls /home/team"})
        yield Event("tool_end", data={"id": "check", "ok": True})
        yield Event("message", SECOND, data={"id": "answer-2", "final": brain == "codex"})
        yield Event("final", SECOND)

    return [first, second]


def rig(monkeypatch, tmp_path, brain, runs, language="en"):
    calls, shown = [], []
    loops = []

    class Fake(Driver):
        async def run(self, **kwargs):
            calls.append(kwargs)
            play = runs[len(calls) - 1](loops[0])
            if brain != "claude":
                async for event in play:
                    yield event
                return
            self._read = play.__anext__
            async for event in self._claude():
                yield event

        async def interrupt(self):
            pass

    async def execute(identifier, name, arguments):
        return ToolOutcome(True, content="ok")

    monkeypatch.setattr(cli, "Driver", Fake)
    loop = cli.CliLoop(
        brains=SimpleNamespace(environ={}, home=tmp_path, command=lambda name: ["fake"], available=lambda *args, **kwargs: True),
        sessions=RoomCliSessions(), member_id=5, conversation_id=7, model=f"cli:{brain}:fake",
        ledger=SimpleNamespace(add=lambda **kwargs: None), language=language, plain=True, system="", user="Go on.",
        tools=[], progress=lambda text: None, thinking=lambda text: None, event=lambda text: None, execute=execute,
        reply=lambda reply: shown.extend(reply.messages), stall_s=cli.CLI_SILENCE_S, tool_s=cli.CLI_TOOL_S)
    loops.append(loop)
    return SimpleNamespace(loop=loop, calls=calls, shown=shown)


def assert_answer_kept(turn, outcome, language="en"):
    # The CLI was started once more, in the same native session, and told why.
    assert len(turn.calls) == 2 and turn.calls[1]["session"] == "native-1"
    assert turn.calls[1]["user"].startswith(NOTE.partition(".")[0])
    # What it answered after the note is in front of the owner, whole.
    assert SECOND in "\n\n".join(turn.shown)
    # The turn does not count as done, and says why in the turn's language: never the line of an unknown failure.
    reply = turn.loop.reply(outcome)
    assert turn.loop.failure and reply.text == phrase(language, "computer_unchecked")


@pytest.mark.parametrize("stop_reason", [None, "end_turn"])
async def test_a_claude_member_that_answers_again_without_reading_the_screen_keeps_its_answer(monkeypatch, tmp_path, stop_reason):
    turn = rig(monkeypatch, tmp_path, "claude", claude_night(stop_reason))
    outcome = await turn.loop.run()
    assert_answer_kept(turn, outcome)
    # The first answer stood alone only where the CLI marked it final itself; the check started the CLI again either way.
    assert (FIRST in "\n\n".join(turn.shown)) == (stop_reason == "end_turn")


@pytest.mark.parametrize("brain", ["codex", "gemini"])
async def test_every_cli_brain_keeps_an_answer_the_completion_check_does_not_count(monkeypatch, tmp_path, brain):
    turn = rig(monkeypatch, tmp_path, brain, event_night(brain))
    assert_answer_kept(turn, await turn.loop.run())


async def test_a_member_that_reads_the_screen_after_the_note_ends_done(monkeypatch, tmp_path):
    async def first(loop):
        yield Event("session", "native-1")
        await loop._tool("nav", "computer__browser_navigate", {"url": "file:///home/team/sheet.html"})
        yield Event("final", FIRST)

    async def second(loop):
        await loop._tool("look", "computer__get_browser_state", {})
        yield Event("final", SECOND)

    turn = rig(monkeypatch, tmp_path, "codex", [first, second])
    outcome = await turn.loop.run()
    assert outcome.status == "done" and outcome.final == SECOND and turn.loop.failure is None
    assert turn.loop.reply(outcome).text == SECOND


# --- the owner's conversation ---------------------------------------------------------------------------------------


async def test_the_conversation_shows_the_answer_and_why_it_does_not_count_never_the_unknown_failure(make_rig, monkeypatch):
    rig_ = make_rig()
    rig_.settings.set("agent_model", "cli:claude:fake")
    monkeypatch.setattr(rig_.service._cli_brains, "command", lambda name: ["fake"])
    monkeypatch.setattr(rig_.service._cli_brains, "available", lambda *args, **kwargs: True)
    runs = claude_night(None)
    played = []

    async def execute(identifier, name, arguments):
        return ToolOutcome(True, content="ok")

    async def run(driver, **kwargs):
        [loop] = rig_.service._cli_loops
        loop.execute = execute  # the member's computer answers every call
        driver._read = runs[len(played)](loop).__anext__
        played.append(kwargs)
        async for event in driver._claude():
            yield event

    monkeypatch.setattr(cli.Driver, "run", run)
    reply = await rig_.call("agent.ask", {"session_id": "s", "text": "可以繼續了", "ui_language": "zh-TW",
                                          "source": "app", "member_id": 0})
    assert len(played) == 2
    said = plain_replies([row[0] for row in rig_.conn.execute(
        "SELECT text FROM agent_messages WHERE kind='reply' ORDER BY turn_id, seq")])
    status, text = rig_.conn.execute("SELECT status, text FROM agent_turns WHERE id=?", (reply["turn_id"],)).fetchone()
    unchecked = phrase("zh-TW", "computer_unchecked")
    # The answer once, then why it does not count; the line of an unknown failure ("try again") nowhere.
    assert "\n\n".join(said).count(SECOND) == 1 and said[-1] == unchecked
    assert status == "error" and text == unchecked
    assert phrase("zh-TW", "error") not in said

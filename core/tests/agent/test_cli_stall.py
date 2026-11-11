"""A private CLI turn has a watchdog: a CLI that says nothing, with no call out, for the stall window is hung. It is asked again
once while nothing outside was done in the turn; after an outside action it is never run again, and the owner is told what
was done and that it stopped. A call in flight, and a wait for the owner's yes, are no silence."""

import asyncio
import sys

import pytest

from raphael_core.agent.cli import drivers
from raphael_core.agent.cli import loop as cli
from raphael_core.agent.cli.drivers import Driver, Event
from raphael_core.retry_utils import MODEL_SILENCE_S
from raphael_core.worker.loop import Stop, ToolOutcome, WAITING

from .test_cli_recovery import recovery_rig

STALL = 0.05


def silent():
    """What a hung CLI does: nothing, for longer than any test waits."""
    return asyncio.sleep(30)


async def finished(rig):
    return await asyncio.wait_for(rig.loop.run(), 10)


def test_the_windows_are_the_models_silence_and_a_longer_one_for_a_call_out():
    assert cli.CLI_SILENCE_S == MODEL_SILENCE_S
    assert cli.CLI_TOOL_S > cli.CLI_SILENCE_S
    # A read of the child never waits for ever, and gives a call in flight all of its window first.
    assert cli.CLI_TOOL_S < drivers.READ_LIMIT_S < float("inf")


async def test_a_silent_cli_with_nothing_done_is_asked_again_once(monkeypatch, tmp_path):
    async def play(loop, attempt):
        if attempt == 1:
            yield Event("session", "native-session")
            await silent()
        yield Event("final", "Here is the answer.")

    rig = recovery_rig(monkeypatch, tmp_path, play, stall_s=STALL, tool_s=1.0)
    result = await finished(rig)
    assert result.final == "Here is the answer." and rig.loop.failure is None
    assert len(rig.calls) == 2 and rig.calls[1]["session"] == "native-session"
    assert len(rig.lines) == 1 and "not answering" in rig.lines[0] and "intact" in rig.lines[0]


async def test_a_cli_that_stalls_again_ends_the_turn_and_says_so(monkeypatch, tmp_path):
    async def play(loop, attempt):
        await silent()
        yield Event("final", "Never.")

    rig = recovery_rig(monkeypatch, tmp_path, play, stall_s=STALL, tool_s=1.0)
    result = await finished(rig)
    assert len(rig.calls) == 2 and rig.loop.failure == "timeout"
    assert "took too long" in result.final and "Recorded steps" not in result.final


async def test_after_an_outside_action_a_silent_cli_is_never_run_again(monkeypatch, tmp_path):
    async def play(loop, attempt):
        await loop._tool("save", "save_draft", {"path": "draft.txt"})
        await silent()
        yield Event("final", "Never.")

    rig = recovery_rig(monkeypatch, tmp_path, play, stall_s=STALL, tool_s=1.0)
    result = await finished(rig)
    assert len(rig.calls) == 1 and len(rig.effects) == 1 and rig.loop.acted
    # The owner is told that it stopped, and what the receipts say was done and what was not.
    assert "took too long" in result.final and "1 completed or answered, 0 failed, 0 unconfirmed" in result.final
    assert "Check whether failed or unconfirmed actions took effect before repeating them" in result.final
    assert not rig.lines  # nothing was waited for


async def test_after_reads_alone_a_silent_cli_has_done_nothing_and_is_asked_again(monkeypatch, tmp_path):
    async def play(loop, attempt):
        if attempt == 1:
            await loop._tool("look", "notes_look", {"topic": "tea"})
            await silent()
        yield Event("final", "Tea, then.")

    rig = recovery_rig(monkeypatch, tmp_path, play, stall_s=STALL, tool_s=1.0)
    result = await finished(rig)
    assert result.final == "Tea, then." and len(rig.calls) == 2 and not rig.loop.acted
    # What it read goes with the second asking.
    assert "notes_look" in rig.calls[1]["user"]


async def test_a_command_of_the_clis_own_is_an_action_and_its_reading_is_not(monkeypatch, tmp_path):
    async def codex_runs_a_command(loop, attempt):
        yield Event("tool_start", data={"id": "c1", "name": "commandExecution"})
        yield Event("tool_end", data={"id": "c1", "ok": True})
        await silent()
        yield Event("final", "Never.")

    rig = recovery_rig(monkeypatch, tmp_path, codex_runs_a_command, stall_s=STALL, tool_s=1.0)
    assert "took too long" in (await finished(rig)).final and len(rig.calls) == 1

    async def claude_reads_a_file(loop, attempt):
        if attempt == 1:
            yield Event("tool_start", data={"id": "r1", "name": "Read"})
            yield Event("tool_end", data={"id": "r1", "ok": True})
            await silent()
        yield Event("final", "Read it.")

    rig = recovery_rig(monkeypatch, tmp_path, claude_reads_a_file, brain="claude", stall_s=STALL, tool_s=1.0)
    assert (await finished(rig)).final == "Read it." and len(rig.calls) == 2


async def test_a_call_in_flight_is_no_stall_for_as_long_as_its_own_window(monkeypatch, tmp_path):
    async def play(loop, attempt):
        yield Event("tool_start", data={"id": "t1", "name": "mcp__raphael__save_draft"})
        await loop._tool("t1", "save_draft", {})
        yield Event("tool_end", data={"id": "t1", "ok": True})
        yield Event("final", "Saved.")

    rig = recovery_rig(monkeypatch, tmp_path, play, stall_s=STALL, tool_s=2.0)

    async def slow(identifier, name, arguments):
        await asyncio.sleep(10 * STALL)  # ten stall windows out, inside its own
        return ToolOutcome(True, content="Saved.")

    rig.loop.execute = slow
    assert (await finished(rig)).final == "Saved." and len(rig.calls) == 1


async def test_a_call_that_outlasts_its_window_ends_the_turn_and_is_never_run_again(monkeypatch, tmp_path):
    async def play(loop, attempt):
        yield Event("tool_start", data={"id": "t1", "name": "mcp__raphael__save_draft"})
        await loop._tool("t1", "save_draft", {})
        yield Event("final", "Never.")

    rig = recovery_rig(monkeypatch, tmp_path, play, stall_s=STALL, tool_s=0.2)

    async def hangs(identifier, name, arguments):
        await silent()

    rig.loop.execute = hangs
    result = await finished(rig)
    # It may have been made: the call is among the unconfirmed, and the CLI is not run again.
    assert len(rig.calls) == 1 and "took too long" in result.final and "1 unconfirmed" in result.final


async def test_what_the_cli_says_starts_the_window_again(monkeypatch, tmp_path):
    async def play(loop, attempt):
        for _ in range(8):
            await asyncio.sleep(0.1)  # eight gaps, none of them a window, together more than two
            yield Event("text_delta", "Working. ")
        yield Event("final", "Done.")

    rig = recovery_rig(monkeypatch, tmp_path, play, stall_s=0.3, tool_s=1.0)
    assert (await finished(rig)).final == "Done." and len(rig.calls) == 1


async def test_a_wait_for_the_owners_yes_is_no_silence(monkeypatch, tmp_path):
    async def play(loop, attempt):
        outcome = await loop._tool("question", "ask_owner", {"question": "Which folder?"})
        assert "team folder" in outcome.content
        yield Event("final", "Saved in the team folder.")

    rig = recovery_rig(monkeypatch, tmp_path, play, stall_s=0.1, tool_s=0.1)

    async def ask(*args):
        raise Stop(WAITING)

    rig.loop.execute = ask
    assert (await asyncio.wait_for(rig.loop.run(), 10)).kind == WAITING
    await asyncio.sleep(0.8)  # the owner takes their time: eight windows
    rig.loop.continue_with(ToolOutcome(True, content="Use the team folder"))
    assert (await finished(rig)).final == "Saved in the team folder." and len(rig.calls) == 1


async def test_a_turn_that_may_not_ask_again_ends_at_the_first_stall(monkeypatch, tmp_path):
    async def play(loop, attempt):
        await silent()
        yield Event("final", "Never.")

    rig = recovery_rig(monkeypatch, tmp_path, play, stall_s=STALL, tool_s=1.0, rate_limit_waits=())
    result = await finished(rig)
    assert len(rig.calls) == 1 and "took too long" in result.final


async def test_a_loop_with_no_window_of_its_own_is_left_to_whoever_watches_it(monkeypatch, tmp_path):
    async def play(loop, attempt):
        await asyncio.sleep(10 * STALL)
        yield Event("final", "Slowly.")

    rig = recovery_rig(monkeypatch, tmp_path, play)
    assert (await finished(rig)).final == "Slowly." and len(rig.calls) == 1


async def test_a_read_of_the_child_does_not_wait_for_ever(monkeypatch, tmp_path):
    async def hangs():
        await silent()

    driver = Driver("claude", ["unused"])
    driver.child = type("Child", (), {"process": type("Process", (), {"stdout": type("Stdout", (), {"readline": staticmethod(hangs)})})})
    monkeypatch.setattr(drivers, "READ_LIMIT_S", STALL)
    with pytest.raises(TimeoutError):
        await driver._read()


async def test_a_child_that_goes_silent_ends_the_run_as_a_timeout(monkeypatch, tmp_path):
    script = tmp_path / "hung_cli.py"
    script.write_text("import sys, time\nsys.stdin.readline()\ntime.sleep(60)\n", encoding="utf-8")
    monkeypatch.setattr(drivers, "READ_LIMIT_S", 0.5)
    events = [event async for event in Driver("claude", [sys.executable, str(script)], environ={}).run(
        user="Save the draft", system="Test", endpoint="http://127.0.0.1:1/mcp", token="fake", permission=None)]
    assert events[-1].kind == "error" and events[-1].text == "timeout"


async def test_a_second_cancel_does_not_cut_short_what_the_read_does_as_it_stops(monkeypatch, tmp_path):
    """The read of the child runs as a task of its own (`CliLoop._events`). Stopping a turn cancels it and waits; a shutdown that
    cancels the turn again meanwhile must not reach the read, whose stopping (the child killed, its pipes closed) is what the
    wait is for. `gather` passed the second cancel on to the read; the wait does not."""
    rig = recovery_rig(monkeypatch, tmp_path, None, stall_s=30, tool_s=30)
    stopping, stopped = asyncio.Event(), []

    async def stream():
        try:
            await silent()
            yield Event("final", "Never.")
        finally:
            stopping.set()
            await asyncio.sleep(0.05)  # killing the child and closing its pipes takes turns of the event loop
            stopped.append(True)

    async def consume():
        async for _ in rig.loop._events(stream()):
            pass

    turn = asyncio.create_task(consume())
    await asyncio.sleep(0.02)
    turn.cancel()
    await asyncio.wait_for(stopping.wait(), 5)
    turn.cancel()  # the second, while the read is still stopping
    await asyncio.gather(turn, return_exceptions=True)
    assert turn.cancelled() and stopped == [True]

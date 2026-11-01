"""A broken CLI continues from receipts, never by replaying tools in the harness."""

import asyncio
import json
from types import SimpleNamespace

import pytest

from raphael_core.agent.cli import loop as cli
from raphael_core.agent.cli.drivers import Event
from raphael_core.background.cli import RoomCliSessions
from raphael_core.worker.loop import Stop, ToolOutcome, WAITING


def recovery_rig(monkeypatch, tmp_path, play, *, brain="codex", **options):
    calls, effects, lines, events, interrupted = [], [], [], [], []
    loops = []

    class Driver:
        def __init__(self, name, command, **kwargs):
            assert name == brain and kwargs["model"] == "fake"

        async def run(self, **kwargs):
            calls.append(kwargs)
            async for event in play(loops[0], len(calls)):
                yield event

        async def interrupt(self):
            interrupted.append(True)

    async def execute(identifier, name, arguments):
        effects.append((name, arguments))
        return ToolOutcome(True, content="Saved receipt 17; file draft.txt exists.")

    monkeypatch.setattr(cli, "Driver", Driver)
    monkeypatch.setattr(cli, "RATE_LIMIT_WAITS_S", (0.0,))
    monkeypatch.setattr(cli, "PATIENT_WAITS", (0.0, 0.0), raising=False)
    loop = cli.CliLoop(
        brains=SimpleNamespace(environ={}, home=tmp_path, command=lambda name: ["fake"],
                               available=lambda *args, **kwargs: True),
        sessions=RoomCliSessions(), member_id=5, conversation_id=7, model=f"cli:{brain}:fake",
        ledger=SimpleNamespace(add=lambda **kwargs: None), language="en", plain=True,
        system="Keep the owner's scope.", user="Save a draft, then check it.", tools=[],
        progress=lines.append, thinking=lambda text: None, event=events.append,
        execute=execute, **options)
    loops.append(loop)
    return SimpleNamespace(loop=loop, calls=calls, effects=effects, lines=lines,
                           events=events, interrupted=interrupted)


@pytest.mark.parametrize("brain", ["codex", "claude"])
@pytest.mark.parametrize("session", [None, "native-session"])
@pytest.mark.parametrize("failure", ["rate_limit", "overloaded", "network", "eof", "exit"])
async def test_after_a_tool_the_same_brain_continues_from_its_receipt(monkeypatch, tmp_path, brain, session, failure):
    async def play(loop, attempt):
        if attempt == 1:
            if session:
                yield Event("session", session)
            await loop._tool("save", "save_draft", {"path": "draft.txt"})
            if failure == "eof":
                raise EOFError("cli_exited")
            if failure != "exit":
                yield Event("error", failure)
        else:
            yield Event("final", "The draft is saved and checked.")

    rig = recovery_rig(monkeypatch, tmp_path, play, brain=brain)
    result = await rig.loop.run()
    assert result.final == "The draft is saved and checked."
    assert len(rig.calls) == 2 and len(rig.effects) == 1
    assert rig.calls[1]["session"] == session
    prompt = rig.calls[1]["user"]
    assert "Save a draft, then check it." in prompt
    assert all(word in prompt for word in ("save_draft", "draft.txt", "Saved receipt 17", "untrusted"))
    assert "Do not repeat" in prompt and "check" in prompt
    assert len(rig.lines) == 1 and "try again" in rig.lines[0].lower()
    assert not rig.events and rig.loop.failure is None


async def test_recovery_is_bounded_and_final_failure_accounts_for_work(monkeypatch, tmp_path):
    async def play(loop, attempt):
        if attempt == 1:
            await loop._tool("save", "save_draft", {"path": "private-command-text"})
        yield Event("error", "overloaded")

    rig = recovery_rig(monkeypatch, tmp_path, play)
    result = await rig.loop.run()
    assert len(rig.calls) == 4 and len(rig.effects) == 1
    assert len(rig.lines) == 3 and all("try again" in line.lower() for line in rig.lines)
    assert "1" in result.final and "not completed" in result.final
    assert "private-command-text" not in result.final
    assert rig.events == [result.final] and rig.loop.failure == "overloaded"


@pytest.mark.parametrize("failure", ["auth_expired", "usage_limit", "credits", "context_overflow"])
async def test_permanent_failure_after_work_stops_immediately(monkeypatch, tmp_path, failure):
    async def play(loop, attempt):
        await loop._tool("save", "save_draft", {})
        yield Event("error", failure)

    rig = recovery_rig(monkeypatch, tmp_path, play)
    result = await rig.loop.run()
    assert len(rig.calls) == 1 and not rig.lines
    assert rig.loop.failure == failure
    assert "not completed" in result.final


async def test_answered_card_is_in_recovery_and_is_not_asked_again(monkeypatch, tmp_path):
    async def play(loop, attempt):
        if attempt == 1:
            result = await loop._tool("question", "ask_owner", {"question": "Which folder?"})
            assert "Use the team folder" in result.content
            yield Event("error", "network")
        else:
            assert "Use the team folder" in rig.calls[-1]["user"]
            yield Event("final", "Saved in the team folder.")

    rig = recovery_rig(monkeypatch, tmp_path, play)
    questions = []

    async def ask(*args):
        questions.append(args)
        raise Stop(WAITING)

    rig.loop.execute = ask
    assert (await rig.loop.run()).kind == WAITING
    rig.loop.continue_with(ToolOutcome(True, content="Use the team folder"))
    assert (await rig.loop.run()).final == "Saved in the team folder."
    assert len(questions) == 1


async def test_stop_during_recovery_wait_cancels_everything(monkeypatch, tmp_path):
    async def play(loop, attempt):
        await loop._tool("save", "save_draft", {})
        yield Event("error", "network")

    rig = recovery_rig(monkeypatch, tmp_path, play)
    monkeypatch.setattr(cli, "RATE_LIMIT_WAITS_S", (30.0,))
    running = asyncio.create_task(rig.loop.run())
    for _ in range(1000):
        if rig.lines:
            break
        await asyncio.sleep(.001)
    assert rig.lines and not running.done()
    running.cancel()
    with pytest.raises(asyncio.CancelledError):
        await running
    assert len(rig.calls) == 1 and len(rig.effects) == 1
    assert rig.loop.task.done() and rig.interrupted


async def test_stream_only_unfinished_action_is_reported_as_unknown(monkeypatch, tmp_path):
    async def play(loop, attempt):
        if attempt == 1:
            yield Event("tool_start", data={"id": "click", "server": "computer", "name": "click"})
        yield Event("error", "network")

    rig = recovery_rig(monkeypatch, tmp_path, play)
    result = await rig.loop.run()
    assert len(rig.calls) == 4
    assert "click" in rig.calls[1]["user"] and "unknown" in rig.calls[1]["user"]
    assert "unconfirmed" in result.final and "not completed" in result.final


async def test_driver_classifies_a_dead_fake_cli_as_a_passing_transport_failure(tmp_path):
    import sys
    from raphael_core.agent.cli.drivers import Driver

    script = tmp_path / "dead_cli.py"
    script.write_text('import sys\nsys.stdin.readline()\n', encoding="utf-8")
    events = [event async for event in Driver("claude", [sys.executable, str(script)], environ={}).run(
        user="Save the draft", system="Test", endpoint="http://127.0.0.1:1/mcp", token="fake", permission=None)]
    assert events[-1].kind == "error" and events[-1].text == "network"


async def test_recovery_uses_api_waits_and_preserves_provider_delay(monkeypatch, tmp_path):
    async def play(loop, attempt):
        if attempt == 1:
            await loop._tool("save", "save_draft", {})
        yield Event("error", "rate_limit", {"reason": "Too many requests; retry after 45 seconds."})

    rig = recovery_rig(monkeypatch, tmp_path, play)
    monkeypatch.setattr(cli, "RATE_LIMIT_WAITS_S", (1., 3., 8.))
    monkeypatch.setattr(cli, "PATIENT_WAITS", (30., 60., 120., 300.))
    waited = []
    real_sleep = asyncio.sleep

    async def sleep(seconds):
        waited.append(seconds)
        await real_sleep(0)

    monkeypatch.setattr(asyncio, "sleep", sleep)
    await rig.loop.run()
    assert len(rig.calls) == 8
    assert all(44 <= seconds <= 46 for seconds in waited[:4])
    assert all(step <= seconds <= step * 1.2 for step, seconds in zip((60, 120, 300), waited[4:]))
    assert len(rig.lines) == 7


async def test_recovery_keeps_original_work_after_owner_steering(monkeypatch, tmp_path):
    async def play(loop, attempt):
        if attempt == 1:
            await loop._tool("save", "save_draft", {})
            loop.owner_input.add("Also include a source link.")
            yield Event("final", "Saved.")
        elif attempt == 2:
            yield Event("error", "network")
        else:
            yield Event("final", "Saved and checked, with a source link.")

    rig = recovery_rig(monkeypatch, tmp_path, play, resume_session=False)
    await rig.loop.run()
    assert "Save a draft, then check it." in rig.calls[2]["user"]
    assert "Also include a source link." in rig.calls[2]["user"]


async def test_later_receipt_cannot_confirm_an_earlier_unfinished_native_action(monkeypatch, tmp_path):
    async def play(loop, attempt):
        yield Event("tool_start", data={"id": "click", "server": "computer", "name": "click"})
        if attempt == 2:
            await loop._tool("click", "computer__click", {"target": "draft"})
            yield Event("tool_end", data={"id": "click", "ok": True})
        yield Event("error", "network")

    rig = recovery_rig(monkeypatch, tmp_path, play)
    result = await rig.loop.run()
    assert "1 completed or answered, 0 failed, 3 unconfirmed" in result.final


async def test_child_dies_while_a_tool_is_still_returning(monkeypatch, tmp_path):
    tool_task = None
    started = asyncio.Event()

    async def execute(*args):
        started.set()
        await asyncio.sleep(.02)
        return ToolOutcome(True, content="Saved receipt after the CLI died.")

    async def play(loop, attempt):
        nonlocal tool_task
        if attempt == 1:
            tool_task = asyncio.create_task(loop._tool("save", "save_draft", {}))
            await started.wait()
            yield Event("error", "network")
        else:
            assert tool_task.done()
            assert "Saved receipt after the CLI died." in rig.calls[-1]["user"]
            yield Event("final", "Checked the saved draft.")

    rig = recovery_rig(monkeypatch, tmp_path, play)
    rig.loop.execute = execute
    assert (await rig.loop.run()).final == "Checked the saved draft."


async def test_nonpersistent_turn_keeps_its_own_native_session_on_recovery(monkeypatch, tmp_path):
    async def play(loop, attempt):
        if attempt == 1:
            yield Event("session", "temporary-session")
            await loop._tool("save", "save_draft", {})
            yield Event("error", "network")
        else:
            yield Event("final", "Checked.")

    rig = recovery_rig(monkeypatch, tmp_path, play, resume_session=False)
    await rig.loop.run()
    assert rig.calls[1]["session"] == "temporary-session"
    assert rig.loop.sessions.get(5, rig.loop.model, 7) is None


async def test_catalog_changes_cannot_hide_errors_or_bypass_recovery_budget(monkeypatch, tmp_path):
    async def play(loop, attempt):
        await asyncio.sleep(0)
        if attempt == 1:
            await loop._tool("save", "save_draft", {})
        loop.catalog_changed = True
        yield Event("error", "network")

    rig = recovery_rig(monkeypatch, tmp_path, play)
    await asyncio.wait_for(rig.loop.run(), 1)
    assert len(rig.calls) == 4 and len(rig.lines) == 3


@pytest.mark.parametrize("uncertain_count,payload", [(2, '"\\\n' * 4000), (16, "x" * 12000)], ids=["escaped", "many-uncertain"])
async def test_large_recovery_context_is_bounded_and_preserves_uncertain_steps(monkeypatch, tmp_path, uncertain_count, payload):
    async def play(loop, attempt):
        if attempt == 1:
            yield Event("session", "native-history-already-present")
            loop._receipts.extend({
                "attempt": 1, "name": f"draft_step_{index}",
                "status": "unknown" if index == 0 else "failed" if index < uncertain_count else "completed",
                "arguments": {"draft": payload}, "result": payload,
            } for index in range(200))
            loop._acted = True
            yield Event("error", "network")
        else:
            yield Event("final", "Checked the uncertain actions and finished.")

    rig = recovery_rig(monkeypatch, tmp_path, play)
    assert (await rig.loop.run()).final == "Checked the uncertain actions and finished."
    assert rig.calls[1]["session"] == "native-history-already-present"
    prompt = rig.calls[1]["user"]
    block = prompt[prompt.index('<tool_result untrusted="true"'):]
    assert len(block) <= 40000 and len(prompt) <= 41000
    records = json.loads(block.split("\n", 1)[1].rsplit("\n</tool_result>", 1)[0])
    kept = records["steps"] + records["native_steps"]
    assert records["omitted_steps"] == 200 - len(kept) > 0
    names = {record["name"] for record in kept}
    assert all(f"draft_step_{index}" in names for index in range(uncertain_count))
    assert "draft_step_199" in names
    assert next(record for record in kept if record["name"] == "draft_step_0")["status"] == "unknown"
    assert all(len(record["arguments"]) + len(record["result"]) <= 2000 for record in kept)
    assert all(record["truncated"] for record in kept)

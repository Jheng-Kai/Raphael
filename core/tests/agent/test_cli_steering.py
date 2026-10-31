import asyncio
from types import SimpleNamespace

from raphael_core.agent.cli import loop as cli
from raphael_core.agent.cli.drivers import Event
from raphael_core.background.cli import RoomCliSessions


async def test_cli_input_resumes_at_the_turn_boundary_in_the_existing_session(monkeypatch, tmp_path):
    started, release = asyncio.Event(), asyncio.Event()
    calls = []

    class Driver:
        def __init__(self, *args, **kwargs):
            pass

        async def interrupt(self):
            pass

        async def run(self, **kwargs):
            calls.append(kwargs)
            if len(calls) == 1:
                yield Event("session", "existing-session")
                yield Event("tool_start", data={"id": "one", "name": "local_time"})
                started.set()
                await release.wait()
                yield Event("tool_end", data={"id": "one", "ok": True})
                yield Event("final", "Original result")
            else:
                yield Event("final", "Result with the owner's addition")

    monkeypatch.setattr(cli, "Driver", Driver)
    brains = SimpleNamespace(environ={}, home=tmp_path, command=lambda name: ["fake"], available=lambda *args, **kwargs: True)
    loop = cli.CliLoop(brains=brains, sessions=RoomCliSessions(), member_id=1, conversation_id=11,
                      model="cli:codex:fake", ledger=SimpleNamespace(add=lambda **kwargs: None), language="en", plain=True,
                      system="", user="Original request", tools=[], progress=lambda text: None,
                      thinking=lambda text: None, event=lambda text: None, execute=None)
    running = asyncio.create_task(loop.run())
    await asyncio.wait_for(started.wait(), 2)
    assert loop.owner_input.add("The owner's new condition")
    assert not running.done()
    release.set()
    assert (await running).final == "Result with the owner's addition"
    assert len(calls) == 2
    assert calls[1]["session"] == "existing-session"
    assert calls[1]["user"] == "The owner's new condition"
    assert not loop.owner_input.add("After completion")


def test_cli_handoff_keeps_accepted_owner_input_in_the_saved_continuation(tmp_path):
    loop = cli.CliLoop(brains=SimpleNamespace(environ={}, home=tmp_path), sessions=RoomCliSessions(), member_id=1,
                      conversation_id=11, model="cli:codex:fake", ledger=SimpleNamespace(add=lambda **kwargs: None),
                      language="en", plain=True, system="", user="Work", tools=[], progress=lambda text: None,
                      thinking=lambda text: None, event=lambda text: None, execute=None)
    loop._handoff_pending = True
    assert loop.owner_input.add("Keep the prices in the final report")
    assert loop._handed_off()
    assert loop.tool_messages[-1] == {"role": "user", "content": "Keep the prices in the final report"}
    assert not loop.owner_input.add("After handoff")

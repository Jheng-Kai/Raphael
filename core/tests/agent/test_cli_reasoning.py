"""A CLI brain's reasoning never becomes its reply: written into the answer's channel it is taken out of the answer and
shown as thinking, and an answer that was only reasoning is no answer. The CLIs are scripted; none runs."""

from raphael_core.agent.cli.drivers import Event

from .test_cli_recovery import recovery_rig

THOUGHT = "The user wants the AAPL price, so I should answer with the last close."


async def test_reasoning_in_the_final_answer_is_thinking_and_not_the_reply(monkeypatch, tmp_path):
    async def play(loop, attempt):
        yield Event("final", f"<think>{THOUGHT}</think>AAPL closed at 190.")

    rig = recovery_rig(monkeypatch, tmp_path, play)
    thoughts = []
    rig.loop.thinking = thoughts.append
    result = await rig.loop.run()
    assert result.status == "done" and result.final == "AAPL closed at 190."
    assert thoughts == [THOUGHT]


async def test_reasoning_in_a_message_is_not_published_as_speech(monkeypatch, tmp_path):
    spoken = []

    async def play(loop, attempt):
        yield Event("message", f"<think>{THOUGHT}</think>AAPL closed at 190.", data={"id": "m1", "final": True})
        yield Event("final", "AAPL closed at 190.")

    rig = recovery_rig(monkeypatch, tmp_path, play, reply=spoken.append)
    thoughts = []
    rig.loop.thinking = thoughts.append
    result = await rig.loop.run()
    assert result.final == "AAPL closed at 190."
    assert spoken and all(THOUGHT not in "\n".join(reply.messages or [reply.text]) for reply in spoken)
    assert THOUGHT in thoughts


async def test_an_answer_that_was_only_reasoning_is_not_shown_as_one(monkeypatch, tmp_path):
    async def play(loop, attempt):
        yield Event("final", f"<think>{THOUGHT}")

    rig = recovery_rig(monkeypatch, tmp_path, play)
    result = await rig.loop.run()
    assert (result.status, result.kind, result.final) == ("stopped", "missing_terminal", "")
    assert len(rig.calls) == 2  # it was asked once more for the answer
    reply = rig.loop.reply(result)
    assert reply.text == "Codex CLI stopped before finishing its answer."

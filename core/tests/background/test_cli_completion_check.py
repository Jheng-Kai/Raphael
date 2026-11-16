"""A background CLI task whose member answers again without reading its screen back keeps its words (R-COMP-PERF-09).

The conversation's turn and a background task share the CLI loop: when the completion check does not count an answer, the
task ends failed on why, and the answer stays in its thread. Before, the task ended interrupted with no word of it.
"""

from raphael_core.agent.cli.drivers import Event
from raphael_core.agent.history import AgentHistory
from raphael_core.agent.persona import phrase
from raphael_core.messaging.words import plain_replies
from raphael_core.worker.loop import ToolOutcome
from .conftest import until
from .test_room_cli import Brains

ANSWER = "The cut is ready; the team folder holds both files."


async def test_a_background_cli_task_keeps_the_answer_the_completion_check_does_not_count(make_rig, monkeypatch, tmp_path):
    rig = make_rig()
    rig.service.use_cli(Brains(tmp_path))
    history = AgentHistory(rig.conn)
    turn = history.add(session_id="work", question="Make the cut", route="answer", prefix="", text="", status="running")
    task = rig.service.submit(session_id="work", text="Make the cut", language="en", model="cli:codex:test")
    rig.service.attach_turn(task, turn)
    runs = []

    async def computer(identifier, name, arguments):
        return ToolOutcome(True, content="ok")

    async def run(driver, **kwargs):
        loop = rig.service._cli_loops[task]
        loop.execute = computer  # the member's computer answers every call
        runs.append(kwargs)
        yield Event("session", "native-1")
        if len(runs) == 1:
            await loop._tool("nav", "computer__browser_navigate", {"url": "file:///home/team/sheet.html"})
            yield Event("final", "The cut is ready.")
        else:
            await loop._tool("check", "computer__vm_exec", {"command": "ls /home/team"})
            yield Event("final", ANSWER)

    monkeypatch.setattr("raphael_core.agent.cli.loop.Driver.run", run)
    await until(lambda: rig.task(task).state not in ("queued", "running"))
    assert len(runs) == 2 and runs[1]["session"] == "native-1"
    assert rig.task(task).state == "failed" and rig.task(task).reason == "cli_computer_unchecked"
    said = plain_replies([item["text"] for item in history.messages([turn])[turn] if item["kind"] == "reply"])
    assert ANSWER in said and said[-1] == phrase("en", "computer_unchecked")
    assert history.get(turn).text == phrase("en", "computer_unchecked")

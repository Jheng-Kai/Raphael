"""What the core's start-up does to the turns of work it keeps across a restart (R-PUMP-01).

The background service is built first and settles what the last run left: a task that ran is interrupted and its turn closed,
while a hand-off still queued, and a task that waits for its colleagues or for the owner's answer, are kept to go on. The
agent service is built next and expires the turns that were still running or waiting for a yes in the process that is gone.
A turn kept work still holds is that work's to end: expired, the colleague's brief a hand-off answers never took its hand-back
once the work was done, and the member read its own queued work as a request that did not finish.
"""

import asyncio

from raphael_core.agent.history import AgentHistory
from raphael_core.agent.speaker import RAPHAEL
from background.conftest import Rig as BackgroundRig, plugins, report, until  # noqa: F401
from background.test_handoff import args, setup, team_of, unused
from .test_service import Rig as AgentRig

JOB = "The completed review documents the design, verified behavior and remaining acceptance boundaries. " * 5
HANDBACK = "Done: the review is in my conversation."


def status(conn, turn_id):
    return conn.execute("SELECT status, text FROM agent_turns WHERE id=?", (turn_id,)).fetchone()


def test_a_restart_leaves_the_turns_of_kept_work_to_that_work(conn, plugins, client, actions, monkeypatch):
    # The last run: the owner's turn with Raphael handed work to the Writer, and the app ended before the Writer began.
    first = BackgroundRig(conn, plugins)
    monkeypatch.setattr(first.service, "_ensure_pump", lambda: None)
    writer, source = setup(first, room=False)
    receipt = first.service.handoff(RAPHAEL, args(writer), source_turn_id=source.id, language="en")
    assert receipt.ok, receipt.error
    AgentHistory(conn, first.wall).resolve(source.id, prefix="", text="On it.", status="done")
    first.service.settle_asker(source.id, answered=True)
    child = first.task(receipt.data["task_id"])
    brief = first.service._store.exchange_turn_id(child.id)
    assert child.state == "queued" and status(conn, brief)[0] == status(conn, child.turn_id)[0] == "running"

    # The next start, in the app's order (`app.build_app`): the background service, then the agent service, then the team,
    # all before the loop runs.
    nowhere = asyncio.new_event_loop()
    asyncio.set_event_loop(nowhere)
    try:
        second = BackgroundRig(conn, plugins)
        agent = AgentRig(conn, client, actions, background=second.service, plugins=plugins.hub, gate=second.gate)
        second.service.use_team(team_of(writer), unused)
    finally:
        asyncio.set_event_loop(None)
        nowhere.close()
    assert second.task(child.id).state == "queued"
    # The work still holds its turn and the brief it answers: neither is a request that ended.
    assert status(conn, child.turn_id)[0] == "running" and status(conn, brief)[0] == "running"
    readable = [turn.id for turn in AgentHistory(conn, second.wall).recent(10, member_id=writer.id, unfinished=True)]
    assert child.turn_id not in readable

    async def go():
        second.client.replies.extend([report(JOB + f"<handback>{HANDBACK}</handback>"), report(JOB)])
        second.service.start()
        await until(lambda: second.task(child.id).state == "done")
        await until(lambda: not second.service._active)
        # The brief takes the Writer's hand-back as it would have without the restart.
        assert tuple(status(conn, brief)) == ("done", HANDBACK)
        assert status(conn, child.turn_id)[0] == "done"
        await second.close()
        await agent.aclose()

    asyncio.run(go())

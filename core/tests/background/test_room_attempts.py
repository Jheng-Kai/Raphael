"""A room reply has no clock of its own (Hermes, tools/delegate_tool.py: progress, not total seconds): each attempt has
the whole no-progress window, a chosen wait before the next attempt is not a stall, and only silence ends a reply. A total
of 60 seconds used to end long rooms as 「未能回覆：發生錯誤」."""
import asyncio

from raphael_core.agent.cli.drivers import Event
from raphael_core.agent.history import AgentHistory
from raphael_core.background.run import RunLimits
from raphael_core.brain.openrouter import OpenRouterError
from .conftest import report, until
from .test_room_cli import Brains, scripted_cli, submit_room

# The rooms' no-progress window in these tests: every case runs longer than it in all. Starting a CLI turn takes part of
# it, so it is wide enough for a busy machine.
WINDOW = 2.0


async def ended(rig, task):
    await until(lambda: rig.task(task).state in ("done", "failed", "limit", "cancelled", "interrupted"), timeout=WINDOW * 8)


async def test_a_cli_room_reply_waits_out_a_rate_limit_longer_than_its_window(make_rig, monkeypatch, tmp_path):
    rig = make_rig(limits=RunLimits(seconds=WINDOW))
    played = scripted_cli(monkeypatch, [Event("error", "rate_limited")], [Event("final", "The plan is ready.")],
                          waits=(WINDOW * 2,))
    task, turn = submit_room(rig)
    rig.service.use_cli(Brains(tmp_path))
    await ended(rig, task)
    assert rig.task(task).state == "done" and AgentHistory(rig.conn).get(turn).text == "The plan is ready."
    assert len(played) == 2


async def test_a_cli_room_reply_that_keeps_working_is_never_cut_off(make_rig, monkeypatch, tmp_path):
    rig = make_rig(limits=RunLimits(seconds=WINDOW))
    async def run(driver, **kwargs):
        for _ in range(6):
            await asyncio.sleep(WINDOW / 2)
            yield Event("thinking", "Weighing the plan")
        yield Event("final", "The plan is ready.")
    monkeypatch.setattr("raphael_core.agent.cli.loop.Driver.run", run)
    task, turn = submit_room(rig)
    rig.service.use_cli(Brains(tmp_path))
    await ended(rig, task)
    assert rig.task(task).state == "done" and AgentHistory(rig.conn).get(turn).text == "The plan is ready."


async def test_a_cli_room_reply_that_goes_silent_ends_at_its_window(make_rig, monkeypatch, tmp_path):
    rig = make_rig(limits=RunLimits(seconds=WINDOW))
    async def run(driver, **kwargs):
        yield Event("thinking", "Starting")
        await asyncio.Event().wait()
        yield Event("final", "Never said.")
    monkeypatch.setattr("raphael_core.agent.cli.loop.Driver.run", run)
    task, turn = submit_room(rig)
    rig.service.use_cli(Brains(tmp_path))
    await ended(rig, task)
    assert (rig.task(task).state, rig.task(task).reason) == ("limit", "limit_time")
    assert not rig.service._cli_loops


async def test_an_api_room_reply_tries_again_with_a_whole_window_for_each_attempt(make_rig, monkeypatch):
    monkeypatch.setattr("raphael_core.failures.RETRY_WAITS", (0.0, 0.0, 0.0))
    rig = make_rig(limits=RunLimits(seconds=WINDOW))
    async def busy(**kwargs):
        await asyncio.sleep(WINDOW * 0.75)
        raise OpenRouterError(503, "server", "Service unavailable")
    async def answers(**kwargs):
        await asyncio.sleep(WINDOW * 0.75)
        return report("The plan is ready.")
    rig.client.replies.extend([busy, answers])
    task, turn = submit_room(rig, model="fake/model")
    await ended(rig, task)
    assert rig.task(task).state == "done" and AgentHistory(rig.conn).get(turn).text == "The plan is ready."
    assert len(rig.client.chat_calls) == 2


async def test_an_api_room_reply_that_hears_nothing_for_its_window_ends_without_trying_again(make_rig):
    rig = make_rig(limits=RunLimits(seconds=WINDOW))
    async def silent(**kwargs):
        await asyncio.Event().wait()
    rig.client.replies.extend([silent, silent])
    task, turn = submit_room(rig, model="fake/model")
    await ended(rig, task)
    assert (rig.task(task).state, rig.task(task).reason) == ("limit", "limit_time")
    assert len(rig.client.chat_calls) == 1
    assert all(not link.killed for link in rig.links.made)

"""A task that keeps working has no clock; one that reaches a ceiling says where it stands."""

import asyncio

from raphael_core.worker import loop as loop_module
from raphael_core.worker.loop import Limits, Stop, ToolOutcome, Turn

from .test_loop import FakeHost, ask, report, run

SUMMARY = "Done: two topics looked up. Not done: the report. Next: write the report from the notes."


class Recording(FakeHost):
    """A host that notes the tools every model call was offered."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.offered = []

    async def chat(self, messages, tools):
        self.offered.append(list(tools))
        return await super().chat(messages, tools)


def looking(n):
    return Turn("", [ask("Notes__look", {"topic": f"t{n}"}, f"c{n}")])


async def test_a_task_that_keeps_making_progress_is_never_out_of_time():
    # Each step takes less than the stall time and the whole takes more: only silence is a limit.
    def step(n):
        async def slow():
            await asyncio.sleep(0.06)
            return looking(n)

        return slow

    host = FakeHost([*(step(n) for n in range(6)), report()])
    outcome = await run(host, limits=Limits(model_calls=50, tool_calls=50, seconds=0.2))
    assert outcome.status == "done" and outcome.model_calls == 7


async def test_a_step_that_never_answers_is_a_stall_and_ends_the_task():
    async def hang():
        await asyncio.sleep(30)

    host = FakeHost([hang])
    outcome = await run(host, limits=Limits(seconds=0.05))
    assert (outcome.status, outcome.kind, outcome.final) == ("stopped", "limit_time", "")


async def test_reaching_the_model_limit_asks_once_for_a_summary_without_tools():
    host = Recording([looking(0), looking(1), Turn(SUMMARY)])
    outcome = await run(host, limits=Limits(model_calls=2, tool_calls=25, seconds=60))
    assert (outcome.status, outcome.kind, outcome.final) == ("stopped", "limit_model", SUMMARY)
    assert host.offered[-1] == [] and all(host.offered[:-1])
    asked = host.conversations[-1][-1]
    assert asked["role"] == "user" and asked["content"] == loop_module.WRAP_UP
    assert len(host.conversations) == 3


async def test_reaching_the_tool_limit_and_the_money_cap_end_the_same_way():
    host = Recording([looking(0), looking(1), Turn(SUMMARY)])
    outcome = await run(host, limits=Limits(model_calls=15, tool_calls=1, seconds=60))
    assert (outcome.kind, outcome.final) == ("limit_tool", SUMMARY)
    host = Recording([looking(0), Turn(SUMMARY)], answer=lambda name, arguments: Stop("limit_cost"))
    outcome = await run(host, limits=Limits(model_calls=15, tool_calls=25, seconds=60))
    assert (outcome.kind, outcome.final) == ("limit_cost", SUMMARY)
    assert host.offered[-1] == []


async def test_a_summary_that_cannot_be_had_leaves_the_limit_as_the_end():
    host = FakeHost([looking(0), Stop("failed", "offline")])
    outcome = await run(host, limits=Limits(model_calls=1, tool_calls=25, seconds=60))
    assert (outcome.status, outcome.kind, outcome.final) == ("stopped", "limit_model", "")


async def test_a_stop_of_the_owner_or_the_model_asks_for_no_summary():
    host = FakeHost([Stop("failed", "offline")])
    assert (await run(host)).kind == "failed" and len(host.conversations) == 1
    cancelled = asyncio.Event()
    host = FakeHost([looking(0)], answer=lambda name, arguments: cancelled.set() or ToolOutcome(True, None, "r"))
    outcome = await run(host, cancelled=cancelled)
    assert outcome.status == "cancelled" and len(host.conversations) == 1

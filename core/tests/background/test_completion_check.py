"""A background task whose member answers again without reading its screen back keeps its words (R-COMP-PERF-09).

When the completion check does not count an answer, the task ends failed on why, and the answer stays in its thread, on a
CLI brain and an API model alike. Before, the task ended interrupted with no word of it.
"""

from unittest.mock import AsyncMock

from raphael_core.agent.cli.drivers import Event
from raphael_core.agent.gate import ToolGate
from raphael_core.agent.history import AgentHistory
from raphael_core.agent.persona import phrase
from raphael_core.messaging.words import plain_replies
from raphael_core.computer.vm import LocalVm
from raphael_core.computer.vm_tools import VmTools
from raphael_core.services.attachment_store import AttachmentStore
from raphael_core.worker.loop import ToolOutcome
from computer.test_vm import Bridge, Runtime, container
from .conftest import call, report, turn, until
from .test_room_cli import Brains

ANSWER = "The cut is ready; the team folder holds both files."


async def test_a_background_cli_task_keeps_the_answer_the_completion_check_does_not_count(make_rig, monkeypatch, tmp_path):
    rig = make_rig()
    rig.service.use_cli(Brains(tmp_path))
    history, task, linked = linked_task(rig, "cli:codex:test")
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
    assert_kept(history, linked)


def linked_task(rig, model):
    history = AgentHistory(rig.conn)
    linked = history.add(session_id="work", question="Make the cut", route="answer", prefix="", text="", status="running")
    task = rig.service.submit(session_id="work", text="Make the cut", language="en", model=model)
    rig.service.attach_turn(task, linked)
    return history, task, linked


def assert_kept(history, linked):
    said = plain_replies([item["text"] for item in history.messages([linked])[linked] if item["kind"] == "reply"])
    assert ANSWER in " ".join(said) and said[-1] == phrase("en", "computer_unchecked")
    assert history.get(linked).text == phrase("en", "computer_unchecked")


async def test_a_background_api_task_keeps_the_answer_the_completion_check_does_not_count(make_rig, tmp_path):
    rig = make_rig()
    runtime = Runtime()
    vm = LocalVm(tmp_path, runner=runtime)

    async def start(target):
        runtime.raw = container(vm, target, runtime)
    vm.start = AsyncMock(side_effect=start)
    hub = VmTools(rig.plugins.hub, vm, attachments=AttachmentStore(tmp_path), conn=rig.conn, bridge=Bridge)
    rig.gate = rig.service._gate = ToolGate(hub, conn=rig.conn)
    rig.client.replies = [turn("Look.", [call("computer__get_desktop_state", {})]), turn("Click.", [call("computer__click", {})]),
                          report("The cut is ready.", prefix=""), report(ANSWER, prefix="")]
    history, task, linked = linked_task(rig, "fake/model")
    await until(lambda: rig.task(task).state not in ("queued", "running"))
    assert rig.task(task).state == "failed" and rig.task(task).reason == "computer_unchecked"
    assert any("Before finishing computer work" in str(message.get("content"))
               for message in rig.client.chat_calls[-1]["messages"])
    assert_kept(history, linked)

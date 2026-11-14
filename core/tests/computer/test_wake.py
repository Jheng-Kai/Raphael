"""R-COMP-WAKE-01: a computer wakes when a member's own tool needs it or when the owner starts it, never silently and
never because a page read short. Docker and the driver are fakes."""

import json

import pytest

from raphael_core.agent.plugins import PluginResult
from raphael_core.computer.vm_tools import VmTools, WOKE, vm_scope, wake_reason
from raphael_core.services.attachment_store import AttachmentStore
from raphael_core.ui_languages import LANGUAGES
from .test_vm import Bridge, EmptyHub, container, per_bot_desktop as desktop  # noqa: F401


def named(hub, name):
    return next(item for item in hub.offered_for(1) if item.name == name)


async def sleeping(desktop, tmp_path):
    vm, _, runtime = desktop
    target = vm.target(1)
    runtime.raw = container(vm, target, runtime)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    hub.names = lambda member: {1: "小晴"}.get(member)
    await hub.prepare(1)
    runtime.raw["State"]["Running"] = False
    vm.invalidate(target)
    return vm, hub, runtime, target


async def test_a_members_tool_that_wakes_the_computer_says_who_and_why_once(desktop, tmp_path):
    vm, hub, runtime, target = await sleeping(desktop, tmp_path)
    lines, notices, progress = [], [], []
    with vm_scope(("turn", 1, 1), woke=lines.append, notice=notices.append, progress=progress.append, language="zh-TW"):
        result = await hub.call(named(hub, "vm_exec").key, {"command": "ls"}, approver="auto")
        assert result.ok and lines == ["小晴為了執行指令喚醒了電腦"]
        # The computer is awake now: a second call starts nothing and says nothing.
        again = await hub.call(named(hub, "vm_exec").key, {"command": "ls"}, approver="auto")
    # The quiet line is its own channel: never the notice channel a member's own words (a question to the owner) go through (R-TEXT-08).
    assert again.ok and lines == ["小晴為了執行指令喚醒了電腦"] and notices == [] and progress == []
    assert vm.woken[target.state_key] == {"member": 1, "name": "小晴", "reason": "command"}
    assert sum(args[0] == "start" for args, _ in runtime.calls) == 1


async def test_a_task_without_a_notice_channel_says_it_in_its_progress_line(desktop, tmp_path):
    vm, hub, runtime, _ = await sleeping(desktop, tmp_path)
    progress = []
    with vm_scope(("turn", 1, 1), progress=progress.append, language="en"):
        await hub.call(named(hub, "get_desktop_state").key, {}, approver="auto")
    assert progress == ["小晴 woke the computer to use it"]


async def test_the_owners_own_start_is_silent_and_clears_the_last_wake(desktop, tmp_path):
    vm, hub, runtime, target = await sleeping(desktop, tmp_path)
    notices = []
    with vm_scope(("turn", 1, 1), woke=notices.append, language="en"):
        await hub.call(named(hub, "get_desktop_state").key, {}, approver="auto")
    assert target.state_key in vm.woken
    runtime.raw["State"]["Running"] = False
    vm.invalidate(target)
    notices.clear()
    await vm.start(target)
    assert notices == [] and target.state_key not in vm.woken


async def test_a_computer_that_sleeps_forgets_who_woke_it(desktop, tmp_path):
    vm, hub, _, target = await sleeping(desktop, tmp_path)
    with vm_scope(("turn", 1, 1), woke=lambda text: None, language="en"):
        await hub.call(named(hub, "get_desktop_state").key, {}, approver="auto")
    assert target.state_key in vm.woken
    await vm.stop(target)
    assert target.state_key not in vm.woken


@pytest.mark.parametrize(("tool", "reason"), [("browser_open", "page"), ("get_browser_state", "page"), ("browser_click", "page"),
                                              ("vm_exec", "command"), ("get_desktop_state", "other"), ("attach_file", "other")])
def test_a_tool_is_one_of_three_reasons(tool, reason):
    assert wake_reason(tool) == reason


@pytest.mark.parametrize("language", LANGUAGES)
def test_the_wake_line_is_written_in_every_interface_language(language):
    for reason, table in WOKE.items():
        line = table.get(language, table["en"]).format(who="Mei")
        assert "Mei" in line and "{" not in line
        if language != "en":
            assert line != WOKE[reason]["en"].format(who="Mei")


async def test_reading_a_page_never_wakes_a_sleeping_computer(desktop, tmp_path):
    vm, hub, runtime, _ = await sleeping(desktop, tmp_path)
    hub.bind_computer_gate(type("Gate", (), {"call_plugin": staticmethod(lambda *a, **k: pytest.fail("the gate was used"))}))
    with vm_scope(("turn", 1, 1), woke=lambda text: pytest.fail("a read said it woke the computer"), language="en"):
        result = await hub.rendered_read("https://news.example/item")
    assert (result.ok, result.kind) == (False, "computer_asleep")
    assert not any(args[0] in ("start", "run") for args, _ in runtime.calls)
    assert runtime.raw["State"]["Running"] is False


async def test_reading_a_page_uses_a_computer_that_is_already_awake(desktop, tmp_path):
    vm, target, runtime = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare(0)
    seen = []
    async def gate(key, arguments, task_id=None, pool=None):
        seen.append((key.rsplit("/", 1)[-1], arguments))
        return PluginResult(True, text=json.dumps({"page": {"url": arguments["url"]}}))
    hub.step_gate = gate
    with vm_scope(("turn", 0, 1), language="en"):
        result = await hub.rendered_read("https://news.example/item")
    assert result.ok and seen and seen[0][0] == "browser_open"
    assert not any(args[0] == "start" for args, _ in runtime.calls)

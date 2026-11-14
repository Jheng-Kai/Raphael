"""R-PC-01: the owner's own PC is in reach of a quick question (Alt+Space) and of nothing else.

Owner, 2026-11-13: 「正常對話的時候，不會有操控我電腦的邏輯…操控我電腦的邏輯只會在快速問答的部分」. An ordinary turn
(typed or said into a conversation, Raphael's or a member's, a room, a phone, a task, a routine) is offered no tool that
sees or drives the PC, its prompt says nothing of that PC, and no permission mode reopens it; work that needs a computer
goes to the member's own. Fakes only: no model, no PC, no Docker.
"""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from raphael_core.agent.cli.loop import CliLoop
from raphael_core.agent.commands import COMMANDS
from raphael_core.agent.gate import ToolGate
from raphael_core.agent.permissions import PermissionCards
from raphael_core.agent.policy import Tier
from raphael_core.agent.speaker import RAPHAEL
from raphael_core.background.snapshot import take_snapshot
from raphael_core.brain.settings import SettingsStore
from raphael_core.worker.loop import Outcome
from .conftest import decision
from .test_local_commands import local_hub
from .test_narration import chat, typed
from .test_service import make_rig  # noqa: F401

# Every tool by which a turn reaches the owner's PC: the local command tools, the run on the desktop, the fixed commands.
PC_TOOLS = {"local__local_exec", "local__local_job", "computer", *COMMANDS}
# Words that would send a model to that PC from its prompt.
PC_WORDS = ("local_exec", "local__", "owner's PC", "owner's Windows", "Windows PC", "Windows computer", "Local commands",
            "claude -p", "codex exec", "local command tool")
MODES = ["ask", "direct", "plan", "bypass"]


def names(tools):
    return {tool["function"]["name"] for tool in tools}


def prompt_of(call):
    return "\n".join(str(message["content"]) for message in call["messages"] if message["role"] == "system")


def rig_with_pc(make_rig, conn, **more):
    hub, host = local_hub(conn)
    SettingsStore(conn).set("local_commands_seen", True)
    rig = make_rig(plugins=hub, gate=ToolGate(hub, conn=conn), permissions=PermissionCards(conn), **more)
    rig.host = host
    return rig


def ask(rig, session, text="Open Chrome on my computer and check my CPU", **more):
    return rig.call("agent.ask", {"session_id": session, "text": text, "ui_language": "en", "member_id": 0, **more})


# --- the lists -----------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("owner_pc", [False, True])
@pytest.mark.parametrize("interactive", [False, True])
def test_the_snapshot_holds_the_owners_pc_only_when_it_is_told_it_is_in_reach(conn, owner_pc, interactive):
    hub, _ = local_hub(conn)
    snapshot = take_snapshot(hub, speaker=RAPHAEL, memory=True, interactive=interactive, max_tier=Tier.T3, owner_pc=owner_pc)
    reachable = set(snapshot.catalog()) | set(snapshot.refs) | set(snapshot.work)
    held = {name for name in reachable if name in PC_TOOLS or name.startswith("local__")}
    if owner_pc and interactive:
        assert {"local__local_exec", "local__local_job", "computer", "open", "lock_screen"} <= held
    elif owner_pc:
        assert {"local__local_exec", "local__local_job"} <= held
    else:
        assert held == set()
    assert (snapshot.owner_pc is owner_pc)


def test_a_list_read_again_before_a_call_does_not_bring_the_owners_pc_back(conn):
    hub, _ = local_hub(conn)
    snapshot = take_snapshot(hub, speaker=RAPHAEL, interactive=True, max_tier=Tier.T3)
    snapshot.refresh_plugins(hub, 0)
    assert not [alias for alias in snapshot.pool.by_alias if alias.startswith("local__")]
    assert snapshot.ref("local__local_exec") is None and snapshot.reveal("local__local_exec") is None


@pytest.mark.parametrize("mode", MODES)
def test_no_permission_mode_lists_the_owners_pc_for_a_task_or_a_routine(conn, mode):
    SettingsStore(conn).set("action_mode", mode)
    hub, _ = local_hub(conn)
    for routine in (False, True):
        snapshot = take_snapshot(hub, speaker=RAPHAEL, memory=True, max_tier=Tier.T3 if mode == "bypass" else Tier.T2,
                                 routine=routine, background_management=routine)
        assert not [name for name in snapshot.catalog() if name.startswith("local__") or name in PC_TOOLS]


# --- an ordinary turn, whole ---------------------------------------------------------------------------------------


@pytest.mark.parametrize("mode", MODES)
@pytest.mark.parametrize("where", ["typed", "said into a conversation", "telegram"])
async def test_an_ordinary_turn_is_offered_nothing_of_the_owners_pc_and_nothing_it_tries_reaches_it(make_rig, client, conn, mode, where):
    rig = rig_with_pc(make_rig, conn)
    rig.settings.set("action_mode", mode)
    tries = [("local__local_exec", {"command": "Get-Process"}), ("local__local_job", {"job_id": "x"}),
             ("computer", {"request": "open Chrome"}), ("open", {"target_kind": "app", "target": "Chrome"}),
             ("lock_screen", {}), ("use_tool", {"name": "volume_up", "arguments": {}}), ("find_tools", {"query": "lock the screen, volume, open an app"})]
    client.chats = [chat("Trying.", call) for call in tries] + [chat('{"text":"I cannot reach that."}')]
    main = rig.service.conversations.main()
    source = {"typed": "app", "said into a conversation": "voice", "telegram": "telegram"}[where]
    result = await ask(rig, "ordinary", source=source, **({"conversation_id": main} if where == "said into a conversation" else {}))
    assert result["status"] == "done"
    first = client.chat_calls[0]
    assert not names(first["tools"]) & PC_TOOLS and not [n for n in names(first["tools"]) if n.startswith("local__")]
    system = prompt_of(first)
    assert not [word for word in PC_WORDS if word in system]
    assert client.decide_calls == []  # no fast router: it could pick a command or a run on the desktop
    rig.host.execute.assert_not_awaited()
    assert not rig.actions.calls
    # What the finder returned is no tool of the PC either.
    results = [message["content"] for message in client.chat_calls[-1]["messages"] if message["role"] == "tool"]
    [finder] = [text for text in results if 'tool="find_tools"' in text]
    assert not [name for name in ("lock_screen", "volume_up", "local_exec", "open_url", '"computer"') if name in finder]
    # Every try was refused as a tool that is not there, none of them ran.
    assert len([text for text in results if 'status="error"' in text]) >= len(tries) - 2


@pytest.mark.parametrize("mode", MODES)
async def test_a_cli_brain_in_an_ordinary_turn_has_no_tool_or_word_of_the_owners_pc(make_rig, conn, monkeypatch, mode):
    rig = rig_with_pc(make_rig, conn)
    rig.settings.set("agent_model", "cli:claude")
    rig.settings.set("action_mode", mode)
    seen = []

    async def work(loop):
        seen.append((loop.system, loop.user, names(loop.tools)))
        loop._queue.put_nowait(Outcome("done", final="Finished."))
    monkeypatch.setattr(CliLoop, "_work", work)
    result = await typed(rig, "Open Chrome on my computer")
    assert result["status"] == "done"
    [(system, user, tools)] = seen
    assert not tools & PC_TOOLS and not [n for n in tools if n.startswith("local__")]
    assert not [word for word in PC_WORDS if word in system]


async def test_a_call_that_names_the_tool_anyway_is_refused_by_every_door(make_rig, conn):
    rig = rig_with_pc(make_rig, conn)
    rig.settings.set("action_mode", "bypass")
    context = ((("chat", 0, 1), False, True, "s", False))
    from raphael_core.computer.local_tools import _CONTEXT
    token = _CONTEXT.set(context)
    try:
        result = await rig.service._gate.call_plugin("mcp:local/local_exec", {"command": "Get-Process"})
    finally:
        _CONTEXT.reset(token)
    assert not result.ok and result.kind == "presence_required"
    rig.host.execute.assert_not_awaited()


def test_the_local_tools_door_asks_the_services_question():
    # One question for both doors: a request marked quick that was not asked at this computer (a phone, a resumed task)
    # never reaches the owner's PC, even by a call that names the tool under 全部允許.
    from types import SimpleNamespace
    from raphael_core.agent.permissions import AT_THIS_COMPUTER
    from raphael_core.agent.service import _AT_THIS_COMPUTER
    from raphael_core.computer.local_tools import ask_context

    def asked(source, quick=True, nested=False):
        return SimpleNamespace(memory_untrusted=False, attachments=(), nested=nested, steps=(), speaker=SimpleNamespace(id=0),
                               conversation_id=1, source=source, quick=quick, scope="private", session_id="s", own_computer=False)
    assert set(AT_THIS_COMPUTER) == set(_AT_THIS_COMPUTER)
    assert all(ask_context(asked(source))[4] for source in ("voice", "overlay", "app"))
    assert not any(ask_context(request)[4] for request in (asked("telegram"), asked("connector"), asked("discord"),
                                                           asked("app", quick=False), asked("overlay", nested=True)))


# --- a quick question -----------------------------------------------------------------------------------------------


@pytest.mark.parametrize("brain", ["api", "cli"])
async def test_a_quick_question_still_has_the_owners_pc_and_the_words_for_it(make_rig, client, conn, monkeypatch, brain):
    rig = rig_with_pc(make_rig, conn)
    quick = rig.service.conversations.quick()
    if brain == "api":
        client.chats = [chat('{"text":"Done."}')]
        result = await ask(rig, "quick", source="app", destination="quick", conversation_id=quick)
        tools, system = names(client.chat_calls[0]["tools"]), prompt_of(client.chat_calls[0])
    else:
        rig.settings.set("agent_model", "cli:claude")
        seen = []

        async def work(loop):
            seen.append((loop.system, names(loop.tools)))
            loop._queue.put_nowait(Outcome("done", final="Finished."))
        monkeypatch.setattr(CliLoop, "_work", work)
        result = await ask(rig, "quick", source="app", destination="quick", conversation_id=quick)
        [(system, tools)] = seen
    assert result["status"] == "done"
    assert {"local__local_exec", "local__local_job", "open"} <= tools
    assert "local__local_exec" in system and "owner's PC" in system


async def test_a_quick_question_is_still_routed_by_the_fast_router_and_may_run_a_command(make_rig, client, conn):
    rig = rig_with_pc(make_rig, conn)
    client.decisions.append(decision("command", "volume_mute"))
    result = await rig.ask("mute")
    assert result["status"] == "done" and ("press_key", "volume_mute", 5) not in rig.actions.calls and rig.actions.calls
    assert len(client.decide_calls) == 1


@pytest.mark.parametrize("mode,runs", [("ask", False), ("direct", False), ("plan", False), ("bypass", True)])
async def test_a_quick_question_keeps_the_rule_it_had_for_a_local_command(make_rig, client, conn, mode, runs):
    # Unchanged: no card can be shown in a quick question, so a command runs only where nothing waits for a yes.
    rig = rig_with_pc(make_rig, conn)
    rig.settings.set("action_mode", mode)
    client.chats = [chat("Checking.", ("local__local_exec", {"command": "Get-Process"})), chat('{"text":"Done."}')]
    result = await ask(rig, "quick", source="app", destination="quick", conversation_id=rig.service.conversations.quick())
    assert result["status"] == "done"
    assert rig.host.execute.await_count == (1 if runs else 0)


# --- work that needs a computer goes to the member's own -------------------------------------------------------------


@pytest.fixture
async def with_own_computer(tmp_path, conn, make_rig):
    from computer.test_vm import Runtime, Bridge, EmptyHub, container
    from raphael_core.computer.local_tools import LocalTools
    from raphael_core.computer.vm import LocalVm
    from raphael_core.computer.vm_tools import VmTools
    from raphael_core.services.attachment_store import AttachmentStore
    runtime = Runtime()
    vm = LocalVm(tmp_path, runner=runtime)

    async def start(target):
        runtime.raw = container(vm, target, runtime)
        return {"ready": True}
    vm.start = AsyncMock(side_effect=start)
    host = AsyncMock()
    hub = LocalTools(VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), conn=conn, bridge=Bridge), conn, host=host)
    rig = make_rig(plugins=hub, gate=ToolGate(hub, conn=conn), permissions=PermissionCards(conn))
    rig.host = host
    return rig, hub


@pytest.mark.parametrize("mode", MODES)
async def test_open_chrome_on_my_computer_in_an_ordinary_thread_goes_to_the_members_own_computer(with_own_computer, client, mode):
    rig, hub = with_own_computer
    rig.settings.set("action_mode", mode)
    await hub.prepare(0)
    client.chats = [chat("Opening it.", ("computer__browser_open", {"url": "https://example.com/"})), chat('{"text":"Opened."}')]
    result = await typed(rig, "Open Chrome on my computer")
    assert result["status"] == "done"
    offered = names(client.chat_calls[0]["tools"])
    assert {"computer__browser_open", "computer__vm_exec"} <= offered
    assert not offered & PC_TOOLS and not [n for n in offered if n.startswith("local__")]
    assert "your own computer" in prompt_of(client.chat_calls[0])
    rig.host.execute.assert_not_awaited()
    assert not rig.actions.calls


async def test_without_a_computer_of_its_own_the_member_is_told_to_say_so_and_has_no_other_machine(make_rig, client, conn):
    rig = rig_with_pc(make_rig, conn)
    client.chats = [chat('{"text":"I have no computer to open it on."}')]
    result = await typed(rig, "Open Chrome on my computer")
    assert result["status"] == "done"
    offered = names(client.chat_calls[0]["tools"])
    assert not offered & PC_TOOLS and not [n for n in offered if n.startswith(("local__", "computer__"))]
    system = prompt_of(client.chat_calls[0])
    assert "say so plainly" in system and "never look for another machine" in system

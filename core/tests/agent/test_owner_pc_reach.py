"""R-PC-01, R-PC-02 and R-PC-06: what of the owner's own PC each turn reaches.

A quick question (Alt+Space) has the owner's whole PC, its screen included: the run on the desktop, the fixed commands that
open, lock, copy and change the volume, the fast router's shortcuts and the local commands, and the member's own computer
beside them for when the owner's words name it. Every other turn (typed or said into a conversation, Raphael's or a
member's, a room, a phone, a task, a routine) runs hidden commands on the owner's PC with the card and shows nothing on its
screen: no desktop, no fixed command, no router, and a command that would open something there is refused in every
permission mode. Fakes only: no model, no PC, no Docker.
"""

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

# What shows things on the owner's screen or drives it: the run on the desktop and the fixed commands.
PC_TOOLS = {"computer", *COMMANDS}
# The hidden commands on the owner's PC, every turn's and task's with the card.
LOCAL = {"local__local_exec", "local__local_job"}
# Words of the quick question's own rules, which no other prompt carries.
QUICK_WORDS = ("The owner's PC (quick question)", "default for everything")
# What every prompt says of the owner's PC.
HIDDEN = "Commands may run hidden on the owner's PC (local__local_exec) with the owner's approval."
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


@pytest.mark.parametrize("owner_screen", [False, True])
@pytest.mark.parametrize("interactive", [False, True])
def test_the_snapshot_holds_the_owners_screen_only_when_told_and_the_hidden_commands_always(conn, owner_screen, interactive):
    hub, _ = local_hub(conn)
    snapshot = take_snapshot(hub, speaker=RAPHAEL, memory=True, interactive=interactive, max_tier=Tier.T3, owner_screen=owner_screen)
    reachable = set(snapshot.catalog()) | set(snapshot.refs) | set(snapshot.work)
    assert LOCAL <= reachable and LOCAL <= snapshot.listed()
    screen = reachable & PC_TOOLS
    if owner_screen and interactive:
        assert {"computer", "open", "lock_screen"} <= screen
    else:
        assert screen == set()
    assert snapshot.owner_screen is owner_screen


def test_a_list_read_again_before_a_call_keeps_the_hidden_commands_and_brings_no_screen(conn):
    hub, _ = local_hub(conn)
    snapshot = take_snapshot(hub, speaker=RAPHAEL, interactive=True, max_tier=Tier.T3)
    snapshot.refresh_plugins(hub, 0)
    assert LOCAL <= set(snapshot.pool.by_alias)
    assert snapshot.ref("local__local_exec") is not None and snapshot.ref("computer") is None


@pytest.mark.parametrize("mode", MODES)
def test_every_mode_lists_the_hidden_commands_and_nothing_of_the_screen_for_a_task_or_a_routine(conn, mode):
    SettingsStore(conn).set("action_mode", mode)
    hub, _ = local_hub(conn)
    for routine in (False, True):
        snapshot = take_snapshot(hub, speaker=RAPHAEL, memory=True, max_tier=Tier.T3 if mode == "bypass" else Tier.T2,
                                 routine=routine, background_management=routine)
        assert LOCAL <= snapshot.listed()
        assert not set(snapshot.catalog()) & PC_TOOLS


# --- an ordinary turn, whole ---------------------------------------------------------------------------------------


@pytest.mark.parametrize("mode", MODES)
@pytest.mark.parametrize("where", ["typed", "said into a conversation", "telegram"])
async def test_an_ordinary_turn_has_the_hidden_commands_and_nothing_it_tries_reaches_the_owners_screen(make_rig, client, conn, mode, where):
    rig = rig_with_pc(make_rig, conn)
    rig.settings.set("action_mode", mode)
    tries = [("local__local_exec", {"command": "Start-Process chrome"}), ("local__local_exec", {"command": "cmd /c start https://www.youtube.com"}),
             ("computer", {"request": "open Chrome"}), ("open", {"target_kind": "app", "target": "Chrome"}),
             ("lock_screen", {}), ("use_tool", {"name": "volume_up", "arguments": {}}), ("find_tools", {"query": "lock the screen, volume, open an app"})]
    client.chats = [chat("Trying.", call) for call in tries] + [chat('{"text":"I opened nothing on your screen."}')]
    main = rig.service.conversations.main()
    source = {"typed": "app", "said into a conversation": "voice", "telegram": "telegram"}[where]
    result = await ask(rig, "ordinary", source=source, **({"conversation_id": main} if where == "said into a conversation" else {}))
    assert result["status"] == "done"
    first = client.chat_calls[0]
    assert LOCAL <= names(first["tools"]) and not names(first["tools"]) & PC_TOOLS
    system = prompt_of(first)
    assert HIDDEN in system
    assert not [word for word in QUICK_WORDS if word in system]
    assert client.decide_calls == []  # no fast router: it could pick a command or a run on the desktop
    rig.host.execute.assert_not_awaited()
    assert not rig.actions.calls
    results = [message["content"] for message in client.chat_calls[-1]["messages"] if message["role"] == "tool"]
    # What the finder returned is nothing of the owner's screen either.
    [finder] = [text for text in results if 'tool="find_tools"' in text]
    assert not [name for name in ("lock_screen", "volume_up", "open_url", '"computer"') if name in finder]
    # Every try was refused, none of them ran, and the two commands were sent to the member's own computer.
    assert len([text for text in results if 'status="error"' in text]) >= len(tries) - 1
    assert len([text for text in results if "your own computer" in text]) == 2


@pytest.mark.parametrize("mode", MODES)
async def test_a_cli_brain_in_an_ordinary_turn_has_the_hidden_commands_and_nothing_of_the_owners_screen(make_rig, conn, monkeypatch, mode):
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
    assert LOCAL <= tools and not tools & PC_TOOLS
    assert HIDDEN in system and not [word for word in QUICK_WORDS if word in system]


async def test_a_command_that_would_open_something_is_refused_by_the_door_under_allow_all(make_rig, conn):
    rig = rig_with_pc(make_rig, conn)
    rig.settings.set("action_mode", "bypass")
    from raphael_core.computer.local_tools import _CONTEXT
    token = _CONTEXT.set((("chat", 0, 1), False, True, "s", False, 0))
    try:
        refused = await rig.service._gate.call_plugin("mcp:local/local_exec", {"command": "Start-Process https://www.youtube.com"})
        hidden = await rig.service._gate.call_plugin("mcp:local/local_exec", {"command": "Get-Process"})
    finally:
        _CONTEXT.reset(token)
    assert not refused.ok and refused.kind == "shows_on_screen"
    assert hidden.ok and rig.host.execute.await_count == 1


def test_the_local_tools_door_asks_the_services_question():
    # One question for both doors: a request marked quick that was not asked at this computer (a phone, a resumed task)
    # never shows anything on the owner's screen, even by a call that names a command under 全部允許.
    from raphael_core.agent.permissions import AT_THIS_COMPUTER
    from raphael_core.agent.service import _AT_THIS_COMPUTER
    from raphael_core.computer.local_tools import ask_context

    def asked(source, quick=True, nested=False):
        return SimpleNamespace(memory_untrusted=False, attachments=(), nested=nested, steps=(), speaker=SimpleNamespace(id=0),
                               conversation_id=1, source=source, quick=quick, scope="private", session_id="s")
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
        rig.settings.set("quick_model", "cli:claude")
        seen = []

        async def work(loop):
            seen.append((loop.system, names(loop.tools)))
            loop._queue.put_nowait(Outcome("done", final="Finished."))
        monkeypatch.setattr(CliLoop, "_work", work)
        result = await ask(rig, "quick", source="app", destination="quick", conversation_id=quick)
        [(system, tools)] = seen
    assert result["status"] == "done"
    assert {*LOCAL, "open"} <= tools
    assert all(word in system for word in QUICK_WORDS) and "your computer" in system


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


# --- what is seen goes to the member's own computer -------------------------------------------------------------------


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
    assert {"computer__browser_open", "computer__vm_exec", *LOCAL} <= offered
    assert not offered & PC_TOOLS
    assert "your own computer" in prompt_of(client.chat_calls[0])
    rig.host.execute.assert_not_awaited()
    assert not rig.actions.calls


async def test_a_quick_question_offers_the_owners_pc_beside_the_members_own_computer(with_own_computer, client):
    # The owner's PC is the default; the member's own computer is there for when the owner's words name it. Both are
    # offered and the model picks: nothing in the code matches the words to take one away.
    rig, hub = with_own_computer
    await hub.prepare(0)
    client.chats = [chat('{"text":"Done."}')]
    result = await ask(rig, "quick", text="Use your computer to open YouTube", source="app", destination="quick",
                       conversation_id=rig.service.conversations.quick())
    assert result["status"] == "done"
    offered = names(client.chat_calls[0]["tools"])
    assert {"computer__browser_open", "open", *LOCAL} <= offered
    system = prompt_of(client.chat_calls[0])
    assert all(word in system for word in QUICK_WORDS) and "only when the owner's words name it" in system


async def test_without_a_computer_of_its_own_the_member_is_told_to_say_so_and_never_to_use_the_owners_screen(make_rig, client, conn):
    rig = rig_with_pc(make_rig, conn)
    client.chats = [chat('{"text":"I have no computer to open it on."}')]
    result = await typed(rig, "Open Chrome on my computer")
    assert result["status"] == "done"
    offered = names(client.chat_calls[0]["tools"])
    assert not offered & PC_TOOLS and not [n for n in offered if n.startswith("computer__")]
    system = prompt_of(client.chat_calls[0])
    assert "say so plainly; promise none" in system and "your own isolated computer, never on the owner's screen" in system

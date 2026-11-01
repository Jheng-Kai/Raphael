"""Owner-PC commands through the production harness, MCP and worker snapshot."""

import json
import asyncio
from unittest.mock import AsyncMock

import pytest

from raphael_core.agent.gate import ToolGate
from raphael_core.agent.permissions import PermissionCards
from raphael_core.brain.settings import SettingsStore
from .test_narration import chat, typed
from .test_service import make_rig  # noqa: F401
from background.conftest import plugins  # noqa: F401


def local_hub(conn):
    from raphael_core.computer.local_tools import LocalTools
    from computer.test_vm import EmptyHub
    host = AsyncMock()
    host.execute.return_value = {"exit_code": 0, "stdout": "cpu data", "stderr": "", "truncated": False}
    return LocalTools(EmptyHub(), conn, host=host), host


@pytest.mark.parametrize("mode,command,external,waiting", [
    ("ask", "Get-Process", False, True),
    ("always", "Get-Process", False, False),
    ("never", "Get-Process", False, False),
    ("always", "Remove-Item C:\\work -Recurse", False, True),
    ("always", "Get-Process", True, True),
])
async def test_cpu_question_calls_local_command_without_a_desktop(make_rig, client, conn, mode, command, external, waiting):
    hub, host = local_hub(conn)
    settings = SettingsStore(conn)
    settings.set("local_commands_mode", mode)
    settings.set("local_commands_seen", True)
    rig = make_rig(plugins=hub, gate=ToolGate(hub, conn=conn), permissions=PermissionCards(conn))
    if external:
        rig.seed("Read a page", "Outside text", conversation_id=rig.service.conversations.main())
        client.chats = [chat("Checking the page.", ("web_search", {"query": "cpu"}))]
        from raphael_core.agent.tools import ToolResult
        rig.service._tools.web_search = AsyncMock(return_value=ToolResult("web_search", True, {"text": "outside"}, untrusted=True))
    else:
        client.chats = []
    client.chats += [chat("Checking CPU usage.", ("local__local_exec", {"command": command})), chat('{"text":"Checked."}')]
    result = await typed(rig, "幫我看一下為甚麼我電腦 CPU 使用率這麼高")
    assert (result["status"] == "confirm") == waiting
    offered = client.chat_calls[0]["tools"]
    assert any(t["function"]["name"] == "local__local_exec" for t in offered)
    assert not rig.actions.calls
    if waiting:
        host.execute.assert_not_awaited()
        card = rig.service._permissions.get(result["confirm"]["id"])
        assert command in card.summary and card.expires_at_ms == 0
        await rig.confirm(result["confirm"]["id"])
    assert host.execute.await_count == (0 if mode == "never" else 1)
    turn = (await rig.turns())[0]
    assert command not in json.dumps(turn["steps"])
    if mode == "never":
        assert "Settings" in str(client.chat_calls[-1]["messages"])


async def test_a_question_said_into_a_conversation_gets_the_card_a_typed_one_gets(make_rig, client, conn):
    # Live, the owner said it at this computer and was told a phone cannot approve: only typing counted as being here.
    hub, host = local_hub(conn)
    SettingsStore(conn).set("local_commands_seen", True)
    rig = make_rig(plugins=hub, gate=ToolGate(hub, conn=conn), permissions=PermissionCards(conn))
    client.chats = [chat("Checking CPU usage.", ("local__local_exec", {"command": "Get-Process"})), chat('{"text":"Checked."}')]
    result = await rig.call("agent.ask", {"session_id": "live", "text": "CPU?", "ui_language": "en", "source": "voice", "member_id": 0,
                                          "conversation_id": rig.service.conversations.main()})
    assert result["status"] == "confirm"
    host.execute.assert_not_awaited()
    assert rig.service._permissions.get(result["confirm"]["id"]).view()["kind"] == "local_command"
    await rig.confirm(result["confirm"]["id"])
    assert host.execute.await_count == 1


@pytest.mark.parametrize("source,quick,nested,scope,shown", [
    ("app", False, False, "private", True),
    ("connector", False, False, "private", True),
    ("voice", False, False, "private", True),
    ("voice", True, False, "private", False),
    ("voice", False, True, "private", False),
    ("voice", False, False, "room", False),
    ("telegram", False, False, "private", False),
])
def test_a_card_goes_to_a_chat_the_owner_is_at(source, quick, nested, scope, shown):
    from raphael_core.agent.permissions import qualifies
    assert qualifies(source=source, quick=quick, nested=nested, scope=scope) is shown


async def test_cli_mcp_calls_the_same_command_gate(make_rig, conn, tmp_path, monkeypatch):
    from members.test_cli_brains import fake_mcp
    hub, host = local_hub(conn)
    rig = make_rig(plugins=hub, gate=ToolGate(hub, conn=conn), permissions=PermissionCards(conn))
    rig.settings.set("agent_model", "cli:claude")
    monkeypatch.setattr("raphael_core.agent.cli.loop.CONFIRM_TIMEOUT_S", .01)
    fake_mcp(rig, tmp_path, [("local__local_exec", {"command": "Get-Process"})])
    asked = await typed(rig, "幫我看一下為甚麼我電腦 CPU 使用率這麼高")
    assert asked["status"] == "confirm"
    host.execute.assert_not_awaited()
    await asyncio.sleep(.18)
    assert all(not loop._resume.done() for loop in rig.service._cli_loops)
    await rig.confirm(asked["confirm"]["id"])
    host.execute.assert_awaited_once()


@pytest.mark.parametrize("choice", ["once", "always", "never", "deny"])
async def test_first_chat_consent_is_shared_has_no_timer_and_refuses_remote_answers(make_rig, client, conn, choice):
    from raphael_core.protocol import RpcError
    hub, host = local_hub(conn)
    rig = make_rig(plugins=hub, gate=ToolGate(hub, conn=conn), permissions=PermissionCards(conn))
    client.chats = [chat("Checking CPU.", ("local__local_exec", {"command": "Get-Process"})), chat('{"text":"Checked."}')]
    asked = await typed(rig, "幫我看一下為甚麼我電腦 CPU 使用率這麼高")
    qid = asked["confirm"]["id"]
    assert asked["confirm"]["timeout_ms"] == 0
    card = rig.service._permissions.get(qid)
    assert card.view()["kind"] == "local_access" and card.expires_at_ms == 0
    with pytest.raises(RpcError):
        await rig.call("agent.confirm", {"id": qid, "approved": True, "source": "telegram"})
    await rig.call("agent.confirm", {"id": qid, "approved": choice in ("once", "always"), "always": choice == "always", "never": choice == "never"})
    assert hub.settings.get("local_commands_seen")
    assert hub.settings.get("local_commands_mode") == {"once": "ask", "always": "always", "never": "never", "deny": "ask"}[choice]
    assert host.execute.await_count == (1 if choice in ("once", "always") else 0)


@pytest.mark.parametrize("mode,waiting", [("ask", True), ("always", False), ("never", False)])
async def test_background_model_calls_local_tool(conn, plugins, mode, waiting):
    from background.test_run import Rig, MESSAGES
    from background.conftest import turn, call
    from raphael_core.background.snapshot import take_snapshot
    from raphael_core.protocol import RpcError
    hub, host = local_hub(conn)
    SettingsStore(conn).set("local_commands_mode", mode)
    rig = Rig(conn, plugins, gate=ToolGate(hub, conn=conn), snapshot=take_snapshot(hub), can_wait=True)
    rig.client.replies = [turn("Checking CPU.", [call("local__local_exec", {"command": "Get-Process"}, "cpu")])]
    try:
        response = await rig.chat(MESSAGES)
        [proposed] = response["calls"]
        if waiting:
            with pytest.raises(RpcError) as error:
                await rig.tool(proposed["name"], proposed["arguments"])
            assert error.value.data["stop"] == "waiting"
            host.execute.assert_not_awaited()
        else:
            await rig.tool(proposed["name"], proposed["arguments"])
            assert host.execute.await_count == (1 if mode == "always" else 0)
    finally:
        await rig.meteo.http.aclose()


def test_driver_schema_never_offers_a_model_session():
    from raphael_core.computer.vm_catalog import without_session
    schema = {"type": "object", "properties": {"session": {"type": "string"}, "pid": {"type": "integer"}}, "required": ["session", "pid"]}
    clean = without_session(schema)
    assert "session" not in clean["properties"] and clean["required"] == ["pid"]
    assert "session" in schema["properties"]

"""A named member has no tool for the owner's PC on either brain path (R-PC-01); its work that needs a computer is its own."""

import pytest

from agent.conftest import client, actions  # noqa: F401
from agent.test_local_commands import local_hub
from agent.test_narration import chat
from agent.test_service import make_rig  # noqa: F401
from raphael_core.agent.gate import ToolGate
from raphael_core.agent.permissions import PermissionCards
from .test_answering import Team, member, typed
from .test_cli_brains import fake_mcp


@pytest.mark.parametrize("brain", ["api", "cli"])
async def test_named_member_cpu_question_has_no_local_command_and_no_card(make_rig, client, conn, tmp_path, brain):
    team = Team(conn, tmp_path)
    hub, host = local_hub(conn)
    rig = make_rig(plugins=hub, gate=ToolGate(hub, conn=conn), permissions=PermissionCards(conn),
                   team=team.members, memory=team.memory)
    who = member(team, name="CPU helper", model="cli:claude" if brain == "cli" else "openai/gpt-6-sol")
    if brain == "cli":
        fake_mcp(rig, tmp_path, [("local__local_exec", {"command": "Get-Process"})], allowed=False)
    else:
        client.chats = [chat("Checking CPU.", ("local__local_exec", {"command": "Get-Process"})), chat('{"text":"I cannot reach the PC."}')]
    try:
        asked = await typed(rig, "幫我看一下為甚麼我電腦 CPU 使用率這麼高", who.id)
        assert asked["status"] == "done" and "confirm" not in asked
        if brain == "api":
            offered = {tool["function"]["name"] for tool in client.chat_calls[0]["tools"]}
            assert not [name for name in offered if name.startswith("local__") or name in ("computer", "open")]
        host.execute.assert_not_awaited()
        assert not rig.actions.calls
    finally:
        await team.memory.aclose()

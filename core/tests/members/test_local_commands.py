"""A named member uses the owner-PC command boundary on both brain paths."""

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
async def test_named_member_cpu_question_uses_local_card_and_not_desktop(make_rig, client, conn, tmp_path, brain):
    team = Team(conn, tmp_path)
    hub, host = local_hub(conn)
    rig = make_rig(plugins=hub, gate=ToolGate(hub, conn=conn), permissions=PermissionCards(conn),
                   team=team.members, memory=team.memory)
    who = member(team, name="CPU helper", model="cli:claude" if brain == "cli" else "openai/gpt-6-sol")
    if brain == "cli":
        fake_mcp(rig, tmp_path, [("local__local_exec", {"command": "Get-Process"})])
    else:
        client.chats = [chat("Checking CPU.", ("local__local_exec", {"command": "Get-Process"})), chat('{"text":"Checked."}')]
    try:
        asked = await typed(rig, "幫我看一下為甚麼我電腦 CPU 使用率這麼高", who.id)
        assert asked["status"] == "confirm"
        card = rig.service._permissions.get(asked["confirm"]["id"])
        assert card.member_id == who.id and card.service == who.name and card.view()["kind"] == "local_access"
        host.execute.assert_not_awaited()
        await rig.confirm(card.id)
        host.execute.assert_awaited_once()
        assert not rig.actions.calls
    finally:
        await team.memory.aclose()

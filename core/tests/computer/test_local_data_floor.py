"""Allow-all and local-command Always never waive the app-data boundary."""

import pytest

from raphael_core.agent.policy import Action, Confirmations, Tier
from .test_local_commands import local  # noqa: F401


@pytest.mark.parametrize("mode", ["ask", "plan", "direct", "bypass"])
async def test_local_executor_refuses_database_writes_even_with_user_approval(local, mode):
    hub, host, gate = local
    hub.settings.set("action_mode", mode)
    hub.settings.set("local_commands_mode", "always")
    args = {"command": 'python -c "import sqlite3; sqlite3.connect(\'C:/data/raphael.db\')"'}
    result = await hub.call("mcp:local/local_exec", args, approver="user")
    assert result.kind == "protected_data" and "management tools" in result.text
    host.execute.assert_not_awaited()


async def test_local_read_waits_for_each_card_even_in_bypass(local):
    hub, host, gate = local
    hub.settings.set("action_mode", "bypass")
    hub.settings.set("local_commands_mode", "always")
    key = "mcp:local/local_exec"
    args = {"command": 'Get-Content "C:/data/raphael.db"'}
    assert gate.needs_confirmation(key, args) and gate.tier(key, args) == Tier.T3
    assert not (await gate.call_plugin(key, args)).ok
    host.execute.assert_not_awaited()
    action = Action(key, args)
    confirmations = Confirmations()
    pending = confirmations.open("s", 1, action, Tier.T3, "en")
    yes = confirmations.resolve(pending.id, True).approval
    assert (await gate.call_plugin(key, args, action=action, approval=yes)).ok
    assert not (await gate.call_plugin(key, args)).ok
    assert host.execute.await_count == 1

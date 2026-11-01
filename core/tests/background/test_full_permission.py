"""全部允許: nothing waits for a yes, and what the owner forbade stays forbidden (R-AG-35)."""
import pytest

from raphael_core.agent.gate import ToolGate
from raphael_core.agent.policy import Action
from raphael_core.agent.safety import DENY, SafetyGuard, SafetyRules
from raphael_core.brain.settings import SettingsStore
from raphael_core.protocol import RpcError

from .test_questions import ScriptedJudge, note_then_report, questions


@pytest.mark.parametrize("tier", ["T2", "T3"])
async def test_a_task_that_would_have_asked_goes_straight_on(make_rig, plugins, calls, conn, tier):
    SettingsStore(conn).set("action_mode", "bypass")
    rig = make_rig()
    await plugins.connect(note=tier)
    note_then_report(rig)
    rig.submit()
    await rig.wait_for_reports()
    assert questions(rig) == []
    assert calls, "the call was made"


async def test_a_rule_that_forbids_still_forbids(make_rig, plugins, calls, conn):
    SettingsStore(conn).set("action_mode", "bypass")
    rules = SafetyRules(conn)
    rules.create("寫筆記", DENY)
    rig = make_rig(safety=SafetyGuard(rules, ScriptedJudge({1})))
    await plugins.connect(note="T2")
    note_then_report(rig)
    rig.submit()
    await rig.wait_for_reports()
    assert calls == []


def test_the_door_stands_open_only_in_this_mode(conn):
    gate, settings = ToolGate(conn=conn), SettingsStore(conn)
    action = Action("team_admin_batch", {})
    assert gate.needs_confirmation("team_admin_batch")
    settings.set("action_mode", "bypass")
    assert gate.full_permission and not gate.ask_first and not gate.plan_first
    assert not gate.needs_confirmation("team_admin_batch")
    assert gate._door(action, None) == "user"
    settings.set("action_mode", "direct")
    assert not gate.full_permission and gate.needs_confirmation("team_admin_batch")


def test_only_a_known_mode_can_be_set(conn):
    settings = SettingsStore(conn)
    settings.set("action_mode", "bypass")
    with pytest.raises((RpcError, ValueError)):
        settings.set("action_mode", "anything")

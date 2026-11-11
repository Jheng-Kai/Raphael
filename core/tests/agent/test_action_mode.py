"""The global quick switch adds confirmation for mutations without weakening any rules."""

import json

import pytest

from raphael_core.agent.gate import ToolGate
from raphael_core.agent.ledger import Ledger
from raphael_core.agent.policy import Action, Confirmations, NotApproved, Tier
from raphael_core.agent.safety import ASK, Proposed
from raphael_core.brain.settings import SettingsStore
from .test_service import make_rig  # noqa: F401
from .test_narration import chat, typed, use
from .test_plugins import plugins, calls  # noqa: F401
from .conftest import decision


def test_global_mode_is_live_and_reads_do_not_ask(conn):
    gate = ToolGate(conn=conn)
    settings = SettingsStore(conn)
    assert not gate.needs_confirmation("lock_screen")
    settings.set("action_mode", "ask")
    assert gate.needs_confirmation("lock_screen")
    assert not gate.needs_confirmation("local_time")
    with pytest.raises(NotApproved):
        gate.check(Action("lock_screen"), None)
    action = Action("lock_screen")
    confirmations = Confirmations()
    pending = confirmations.open("s", 1, action, Tier.T1, "en")
    approval = confirmations.resolve(pending.id, True).approval
    gate.check(action, approval)
    with pytest.raises(NotApproved):
        gate.check(action, approval)
    settings.set("action_mode", "direct")
    gate.check(Action("lock_screen"), None)


async def test_desktop_changes_ask_without_a_model_judge(conn):
    SettingsStore(conn).set("action_mode", "ask")
    gate = ToolGate(conn=conn)
    result = await gate.screen(Proposed("computer_act", "Click Save"), language="en", ledger=None)
    assert result.verdict == ASK


async def test_voice_command_waits_then_runs_once(make_rig, client, actions):
    rig = make_rig()
    rig.settings.set("action_mode", "ask")
    rig.keys.clear()
    result = await rig.ask("鎖定電腦")
    assert result["status"] == "confirm"
    assert actions.calls == []
    await rig.confirm(result["confirm"]["id"])
    assert actions.calls == [("lock_screen",)]


def test_plan_mode_keeps_the_door_of_manual_and_tells_the_model_to_plan(conn):
    gate = ToolGate(conn=conn)
    assert not gate.plan_first
    SettingsStore(conn).set("action_mode", "plan")
    assert gate.plan_first and gate.ask_first
    assert gate.needs_confirmation("lock_screen") and not gate.needs_confirmation("local_time")
    with pytest.raises(NotApproved):
        gate.check(Action("lock_screen"), None)


@pytest.mark.parametrize("mode", [True, "other", None])
def test_invalid_modes_are_refused(conn, mode):
    with pytest.raises((TypeError, ValueError)):
        SettingsStore(conn).set("action_mode", mode)


@pytest.mark.parametrize("tier", ["T2", "T3"])
async def test_allow_all_does_the_whole_job_in_a_conversation_without_a_card(make_rig, plugins, calls, client, tier):
    await plugins.connect(note=tier)
    rig = make_rig(plugins=plugins.hub)
    rig.settings.set("action_mode", "bypass")
    client.decisions.append(decision("answer"))
    client.chats = [chat("Doing it.", use("Notes__note", {"text": "example"})),
                    chat(json.dumps({"prefix": "Answer", "text": "Done.", "detail": ""}))]
    done = await typed(rig, "Save an example")
    assert done["status"] != "confirm" and done["text"] == "Done."
    assert calls == ["note"]
    assert "<full_permission>" in client.chat_calls[0]["messages"][0]["content"]

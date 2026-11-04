"""A reviewed demonstration becomes an ordinary skill on both production brain paths."""
from unittest.mock import AsyncMock

import pytest

from p15a_brains import Stage
from raphael_core.brain.openrouter import Completion
from raphael_core.computer.viewer import Session
from raphael_core.background.host import WorkerHost
from background.conftest import Links, until

DOCUMENT = "---\nname: checked-report\ndescription: Prepare a checked report\n---\n" + "\n".join(
    f"## {section}\nUse the new input and verify DEMO-5521." for section in
    ("When to use", "Inputs", "Procedure", "Pitfalls", "Verification"))


@pytest.mark.parametrize("brain", ["A", "C"])
async def test_owner_saved_demonstration_reaches_api_cli_and_routine_turns(tmp_path, monkeypatch, brain):
    def act(user, tools, results):
        if not results:
            return "", [("skill_read", {"name": "checked-report"})]
        return ("DEMO-5521" if "DEMO-5521" in results[-1] else "No saved skill"), []

    owner = Stage(tmp_path, monkeypatch, brain, act)
    try:
        app = owner.app
        app.background._host = WorkerHost(connect=Links(), grace_s=.1)
        member = (await app.call("members.create", {"name": "Learner"}))["member"]["id"]
        viewer = app.desktop_viewer
        target = viewer.vm.target(member)
        viewer.sessions["demo-viewer"] = Session(target, viewer.vm.clock() + 600, member_id=member)
        monkeypatch.setattr(viewer, "status_for", AsyncMock(return_value={"state":"running", "ready":True, "control":"member"}))
        monkeypatch.setattr(viewer.teaching, "observe", AsyncMock(return_value={"safe":True,"screen":"Report editor","images":[]}))
        monkeypatch.setattr(app.memory, "may_spend", lambda member: True)
        class Brain:
            async def complete_json(self, **kwargs):
                return Completion(data={"text":DOCUMENT}, model=kwargs["model"], cost_usd=0,
                                  prompt_tokens=0, completion_tokens=0, latency_ms=0)
        monkeypatch.setattr(app.memory, "_brain", lambda member: Brain())
        recording = await app.call("computer.teach", {"action":"start","session":"demo-viewer"})
        await viewer.teaching.input("demo-viewer", b"\x05\x01\x00\x0a\x00\x14")
        await app.call("computer.teach", {"action":"stop","session":"demo-viewer"})
        assert not app.members.enabled_skills(member)
        await app.call("computer.teach", {"action":"save","member_id":member,"id":recording["id"],"text":DOCUMENT})
        result = await owner.driver.ask("Try checked-report with new input: quarter two", member=member, session="try")
        assert result["status"] == "done" and "DEMO-5521" in result["text"]
        assert "skill_read" in owner.offered[-1] and "Prepare a checked report" in owner.prompts[-1]
        assert app.members.enabled_skills(0) == []
        routine = (await app.call("routines.create", {"member_id":member,"title":"Checked report",
            "prompt":"Use checked-report for quarter three", "schedule":{"kind":"daily","time":"09:00"}}))["routine"]
        task_id = app.members._run(app.members.store.routine(routine["id"]))
        assert task_id
        await until(lambda: app.background.task(task_id).state in ("done", "failed", "cancelled"))
        assert app.background.task(task_id).state == "done"
        assert "DEMO-5521" in (app.background.task(task_id).report_text or '')
    finally:
        await owner.aclose()

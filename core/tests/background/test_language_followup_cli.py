"""CLI reports and public progress share the owner's Chinese script boundary."""

import json

import pytest

from raphael_core.agent.cli.loop import CliLoop
from raphael_core.agent.history import AgentHistory
from raphael_core.brain.settings import SettingsStore
from raphael_core.worker.loop import Outcome


@pytest.mark.parametrize("brain", ["codex", "claude", "gemini"])
@pytest.mark.parametrize(("variant", "authored", "expected"), [
    ("zh-TW", "软件资料已检查。", "軟體資料已檢查。"),
    ("zh-HK", "软件资料已检查。", "軟件資料已檢查。"),
    ("zh-CN", "資料已檢查。", "资料已检查。"),
    ("zh-TW", "日本の学校へ行きます。", "日本の学校へ行きます。"),
])
async def test_cli_background_report_and_progress_use_owner_script(make_rig, monkeypatch, brain, variant, authored, expected):
    rig = make_rig()
    SettingsStore(rig.conn).set("languages", [variant])
    rig.service.use_cli(object())
    history = AgentHistory(rig.conn)
    turn_id = history.add(session_id="cli-script", question="Check", route="delegate", prefix="",
                          text="", status="running")

    async def work(loop):
        loop.progress(authored)
        assert [data["text"] for method, data in rig.notifications if method == "worker.progress"] == [expected]
        loop._queue.put_nowait(Outcome("done", final=json.dumps({
            "text": authored, "messages": [authored, "学校へ行きます。"], "detail": authored,
        })))

    monkeypatch.setattr(CliLoop, "_work", work)
    task_id = rig.service.submit(session_id="cli-script", text="Check", language="en", model="cli:" + brain)
    rig.service.attach_turn(task_id, turn_id)
    [done] = await rig.wait_for_reports()
    expected_text = expected + "\n\n学校へ行きます。"
    task = rig.task(task_id)
    assert task.state == "done"
    assert done["text"] == expected + " 学校へ行きます。"
    assert task.report_text == history.get(turn_id).text == expected_text
    assert task.report_detail == history.get(turn_id).detail == expected

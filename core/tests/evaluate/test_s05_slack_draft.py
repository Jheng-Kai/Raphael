"""Slack Guardian coverage uses production loops and draft RPCs with fake model and connector I/O."""
import re

import pytest

from raphael_core.evaluate.guardian import Budget
from raphael_core.evaluate.guardian_registry import inventory
from raphael_core.evaluate.guardian_scenarios import cells
from raphael_core.evaluate.guardian_suite import run_cell

from card_brains import API, CLI, Brain, FakeBrains, cli_brain, question_of


CELL = next(cell for cell in cells() if cell.id == "S05.slack-draft")


def act(user, tools, results, *, claims=False):
    if claims:
        return "訊息已經傳送到 Slack。", []
    if results:
        return "回覆已經擬好，請確認後再傳送。", []
    channel = re.search(r"#guardian-[\w-]+", question_of(user)).group()
    return "", [("slack_draft", {"to": channel, "body": "Thursday at 3pm works."})]


@pytest.mark.parametrize("brain", ["A", "C"])
@pytest.mark.parametrize("claims", [False, True])
async def test_slack_cell_requires_an_editable_draft_and_one_version_bound_send(tmp_path, monkeypatch, brain, claims):
    cli_brain(monkeypatch, [], act, claims=claims)
    registry = await inventory()
    slack = next(tool for tool in registry if tool.tool_key == "raphael/core/slack_draft")
    assert slack.api_names == slack.mcp_names == ["slack_draft"]
    assert set(slack.roles) == {"chief", "member"}
    result = await run_cell(CELL, brain, API if brain == "A" else CLI, tmp_path, client=Brain(act, claims=claims),
                            brains=FakeBrains(tmp_path), budget=Budget(40), seconds=60,
                            run_id="offline-slack", head="test-head", registry=registry)
    assert result["status"] == ("FAIL" if claims else "PASS"), result["reason"]
    if claims:
        assert "editable_slack" in result["reason"]
    else:
        assert result["assertions"] == list(CELL.assertions)
        assert any(tool["tool_key"] == "raphael/core/slack_draft" and tool["outcome"] == "ok" for tool in result["tools"])

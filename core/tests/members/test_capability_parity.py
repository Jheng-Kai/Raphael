"""Capture the actual interactive API and CLI offers after the primary contact moves."""

import json

import pytest

from raphael_core.agent.capabilities import COORDINATION_TOOLS, MEMBER_ONLY_TOOLS, PARITY_EXCEPTIONS, SHARED_CAPABILITIES
from raphael_core.agent.cli.loop import CliLoop
from raphael_core.worker.loop import Outcome
from raphael_core.management import MANAGEMENT_TOOLS
from .test_answering import client, setup, typed, live_said  # noqa: F401


@pytest.mark.parametrize("brain", ["api", "cli"])
async def test_production_turns_offer_every_speaker_the_same_abilities(setup, client, monkeypatch, brain):
    rig, team = setup
    ordinary = team.members.store.create_member(name="Writer", role="Writer", model="")
    primary = team.members.store.create_member(name="Teacher", role="Teacher", model="")
    team.members.store.set_primary(primary.id)
    rig.settings.set("first_bot_profile", {"name": "Raphael", "instructions": "OWNER-WORK-CONTRACT"})
    captured = []
    if brain == "cli":
        rig.settings.set("agent_model", "cli:codex:test")
        async def work(loop):
            captured.append((loop.system, loop.tools))
            loop._queue.put_nowait(Outcome("done", final=json.dumps({"prefix": "Answer", "text": "Ready.", "detail": ""})))
        monkeypatch.setattr(CliLoop, "_work", work)
    for identifier in (0, ordinary.id, primary.id):
        if brain == "api":
            client.chats = [live_said("Ready.")]
        result = await typed(rig, "Explain your abilities.", identifier, language="en")
        assert result["status"] == "done"
        if brain == "api":
            call = client.chat_calls[-1]
            captured.append((call["messages"][0]["content"], call["tools"]))
    offers = []
    for index, (system, tools) in enumerate(captured):
        assert system.count(SHARED_CAPABILITIES) == 1
        names = {item["function"]["name"] for item in tools}
        for tool, duty in MEMBER_ONLY_TOOLS.items():
            assert duty in PARITY_EXCEPTIONS
            assert (tool in names) == (index > 0)
        assert "set_my_job" not in names
        assert ("room_meeting" in names) == (index == 2)
        assert not names & MANAGEMENT_TOOLS
        assert "find_tools" in names  # Every speaker can discover deferred shared work tools.
        offers.append({item["function"]["name"]: item["function"] for item in tools
                       if item["function"]["name"] not in set(COORDINATION_TOOLS) | MEMBER_ONLY_TOOLS.keys() | MANAGEMENT_TOOLS | {"find_tools"}})
    assert offers[0] == offers[1] == offers[2]
    assert "OWNER-WORK-CONTRACT" in captured[0][0]
    assert team.members.store.member(ordinary.id).model == team.members.store.member(primary.id).model == ""

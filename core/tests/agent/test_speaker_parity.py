"""Speaker identity must never silently remove shared abilities."""

from dataclasses import replace
from types import SimpleNamespace

import pytest

from raphael_core.agent import persona
from raphael_core.agent.capabilities import COORDINATION_TOOLS, MEMBER_ONLY_TOOLS, PARITY_EXCEPTIONS, SHARED_CAPABILITIES
from raphael_core.agent.speaker import RAPHAEL, Speaker
from raphael_core.agent.team import team_tools_for
from raphael_core.background.service import _prompts
from raphael_core.background.run import RunLimits
from raphael_core.background.snapshot import take_snapshot
from raphael_core.management import MANAGEMENT_TOOLS


def speakers(primary):
    return [replace(speaker, capabilities=frozenset({"chief"}) if speaker.id == primary else frozenset())
            for speaker in (RAPHAEL, Speaker(id=1, name="Writer", role="Writer"),
                            Speaker(id=2, name="Teacher", role="Teacher"))]


@pytest.mark.parametrize("path", ["api", "cli", "worker"])
@pytest.mark.parametrize("primary", [0, 2])
def test_every_speaker_gets_the_same_tools_and_capabilities(path, primary):
    people = speakers(primary)
    team = SimpleNamespace(roster=lambda: people, has_members=lambda: True)
    offers = []
    prompts = []
    for speaker in people:
        tools = team_tools_for(team, speaker, always=True)
        offered = take_snapshot(None, speaker=speaker, team=tools, memory=True,
                                attachments=True, interactive=path != "worker")
        offers.append({item["function"]["name"]: item["function"] for item in offered.definitions
                       if item["function"]["name"] not in COORDINATION_TOOLS | MEMBER_ONLY_TOOLS and item["function"]["name"] not in MANAGEMENT_TOOLS | {"find_tools"}})
        assert "owner_management" in PARITY_EXCEPTIONS
        assert not set(offered.refs) & MANAGEMENT_TOOLS
        assert bool(offered.management) == (speaker.is_chief and path != "worker")
        for tool, duty in COORDINATION_TOOLS.items():
            assert duty in PARITY_EXCEPTIONS
            assert (tool in offered.refs) == speaker.is_chief
        for tool, duty in MEMBER_ONLY_TOOLS.items():
            assert duty in PARITY_EXCEPTIONS
            assert (tool in offered.refs) == (speaker.id > 0 and path != "worker")
        fields = dict(name=speaker.name, role=speaker.role, instructions=speaker.instructions)
        if path == "cli":
            prompt = persona.cli_system_prompt("en", **{**fields, "name": None if speaker.is_raphael else speaker.name})
        elif path == "api":
            prompt = (persona.system_prompt("en", "answer") if speaker.is_raphael else
                      persona.member_system_prompt("en", "answer", **fields))
        else:
            prompt, _ = _prompts("en", "Work", {}, [], RunLimits(), speaker=speaker)
        prompts.append(prompt)
    assert offers[0] == offers[1] == offers[2]
    for prompt in prompts:
        assert prompt.count(SHARED_CAPABILITIES) == 1
        assert "Ordinary chat replies are text" in prompt
        assert "generate_audio" in prompt
        assert "owner's Windows computer" in prompt
    for offered in offers:
        assert all("[Raphael]" not in item["description"] for item in offered.values())


def test_raphael_never_enters_new_member_setup_after_primary_moves():
    assert not replace(RAPHAEL, capabilities=frozenset()).has_no_job


def test_raphael_worker_keeps_owner_instructions_and_member_report_space():
    system, _ = _prompts("en", "Work", {}, [], RunLimits(),
                             speaker=replace(RAPHAEL, instructions="OWNER-INSTRUCTION"))
    assert "OWNER-INSTRUCTION" in system
    assert "120 words" in system
    assert "one line of plain text" not in system

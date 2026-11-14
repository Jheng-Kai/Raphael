"""What a member is told about writing skills, and when the tool for it is offered (R-SKILL-11).

Owner, 2026-11-11: "他現在一直建立 skills，我覺得可能不太好…參考一下 Hermes agents，然後把他們的邏輯行為拿過來".
"""

from types import SimpleNamespace

from raphael_core.agent import persona
from raphael_core.agent.speaker import Speaker
from raphael_core.agent.team import SKILL_MANAGE, SKILL_READ, SKILLS_LIST, _definition, team_tools_for
from raphael_core.memory.doctrine import SKILL_DOCTRINE

WRITER = Speaker(id=1, name="Writer", role="Writer")


def team(skills):
    return SimpleNamespace(named_in=lambda text: [], has_members=lambda: False, enabled_skills=lambda member_id: skills)


def test_skill_manage_is_not_offered_merely_because_a_skill_is_enabled():
    enabled = [{"name": "research-summary", "description": "d"}]
    assert team_tools_for(team(enabled), WRITER, "Please look up the weather") == [SKILL_READ, SKILLS_LIST]  # reading, never writing
    assert team_tools_for(team([]), WRITER, "Please look up the weather") == []


def test_skill_manage_is_offered_for_a_request_about_skills_and_on_the_fixed_tool_sets():
    for text in ("Save this procedure as a skill", "把這個存成技能", "記下這個技巧"):
        assert SKILL_MANAGE in team_tools_for(team([]), WRITER, text), text
    # The CLI brains and the workers have one fixed tool set whatever the request is (owner, 2026-11-09, decision 2).
    assert SKILL_MANAGE in team_tools_for(team([]), WRITER, always=True)


def test_the_tool_says_patch_is_preferred_and_lessons_not_logs():
    description = _definition(SKILL_MANAGE)["description"]
    for phrase in ("Patching an existing skill is preferred", "write lessons, not logs", "Unless the owner asked for a skill",
                   "never for routine or one-off work", "second new one within a day"):
        assert phrase in description


def test_the_persona_carries_the_skill_line_beside_the_memory_doctrine():
    flat = " ".join(SKILL_DOCTRINE.split())
    for phrase in ("offer to save it as a skill rather than writing one unasked", "never write a skill for routine work",
                   "patch that skill (do not add a second one)", "changed only through their own tools",
                   "corrects a fact that your own instructions state", "member_update on your own id"):
        assert phrase in flat
    assert SKILL_DOCTRINE in persona._MEMORY_EDITS and persona.MEMORY_DOCTRINE in persona._MEMORY_EDITS
    assert SKILL_DOCTRINE in persona.cli_system_prompt("en", name="Writer", role="Writer", memory=True)
    assert SKILL_DOCTRINE in persona._MEMORY_RULES

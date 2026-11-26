"""The assistant hands `delegate_task` to the background for the member that called it (R-DELEGATE-01)."""

from raphael_core.agent.tools import ToolResult

from .test_answering import client, member, setup  # noqa: F401  (fixtures)


async def test_the_assistant_hands_the_tool_to_the_background_for_the_speaker_its_turn_and_its_language(setup):
    rig, team = setup
    writer = member(team, name="Writer").speaker()
    seen = []

    async def delegate(speaker, arguments, *, source_turn_id, language):
        seen.append((speaker.id, arguments, source_turn_id, language))
        return ToolResult("delegate_task", True, {"results": []}, untrusted=True)

    rig.service._background.delegate = delegate
    result = await rig.service.team_tool(writer, "delegate_task", {"goal": "x"}, language="en", ledger=None, session_id="s",
                                         source_turn_id=7)
    assert result.ok and seen == [(writer.id, {"goal": "x"}, 7, "en")]


async def test_a_member_asked_by_another_assistant_is_refused_without_reaching_the_background(setup):
    rig, team = setup
    a, b = (member(team, name=name).speaker() for name in ("Manager", "Writer"))

    async def delegate(*args, **kwargs):
        raise AssertionError("an asked member starts no work of its own")

    rig.service._background.delegate = delegate
    result = await rig.service.team_tool(b.asked_by(a), "delegate_task", {"goal": "x"}, language="en", ledger=None,
                                         session_id="s", source_turn_id=7)
    assert not result.ok and result.error == "nested" and result.instruction

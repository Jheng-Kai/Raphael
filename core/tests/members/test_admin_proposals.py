"""Owner-editable proposals exercise both production loops and authenticated MCP."""

import httpx
import pytest

from agent.test_narration import chat
from .test_answering import client, setup, typed, live_said, member  # noqa: F401
from .test_admin import member_rpc  # noqa: F401


@pytest.fixture(autouse=True)
def asks_first(setup):
    """Proposals are what the mode that asks first makes; the automatic mode creates at once."""
    rig, team = setup
    rig.settings.set("action_mode", "ask")


@pytest.fixture(params=["api", "cli"])
def brain(request, setup, client, tmp_path, monkeypatch):
    rig, team = setup
    operations, runs = [], []
    if request.param == "cli":
        from raphael_core.agent.cli.discovery import CliBrains
        from raphael_core.agent.cli.drivers import Driver, Event

        (tmp_path / ".codex").mkdir()
        (tmp_path / ".codex/auth.json").touch()
        rig.service._cli_brains = CliBrains(home=tmp_path, environ={}, commands={"codex": ["fake-driver"]})
        rig.settings.set("agent_model", "cli:codex:test")

        async def run(driver, **kwargs):
            runs.append(kwargs["user"])
            if "team_changes" in kwargs["user"]:  # the turn going on after the owner's yes
                yield Event("session", "codex-thread-1")
                yield Event("final", prepare.then)
                return
            before = await rig.call("members.list", {})
            proposing = rig.settings.get("action_mode") != "direct"
            async with httpx.AsyncClient(headers={"Authorization": "Bearer " + kwargs["token"]}, trust_env=False) as http:
                for index, (name, args) in enumerate(operations):
                    response = await http.post(kwargs["endpoint"], json={"jsonrpc": "2.0", "id": index,
                        "method": "tools/call", "params": {"name": name, "arguments": args}})
                    result = response.json()["result"]
                    assert not result["isError"]
                    assert ("pending_approval" in str(result)) == proposing
                    assert (await rig.call("members.list", {}) == before) == proposing
            yield Event("session", "codex-thread-1")
            yield Event("final", "草稿已準備好，等待確認。" if proposing else prepare.then)

        monkeypatch.setattr(Driver, "run", run)

    def prepare(*calls, then="工作已交辦。"):
        operations[:] = calls
        prepare.then = then
        if request.param == "api":
            client.chats = [chat("Preparing proposals.", *calls), live_said("草稿已準備好，等待確認。"), live_said(then)]
            if rig.settings.get("action_mode") == "direct":
                client.chats = [chat("Preparing proposals.", *calls), live_said(then)]

    def continued():
        """What the brain was shown when the turn went on."""
        return runs[-1] if request.param == "cli" else str(client.chat_calls[-1]["messages"])
    prepare.cli = request.param == "cli"
    prepare.continued = continued
    return prepare


async def test_after_the_owner_says_yes_the_turn_goes_on_with_the_real_ids(setup, brain):
    rig, team = setup
    rig.settings.set("action_mode", "ask")
    brain(("member_create", {"name": "Research", "role": "Research"}), ("member_create", {"name": "Writer", "role": "Writer"}))
    asked = await typed(rig, "Create a team and give them work", 0)
    done = await rig.call("agent.confirm", {"id": asked["confirm"]["id"], "approved": True, "drafts": asked["confirm"]["drafts"]})
    # The model's own words, not a fixed 「已建立」: the turn did not end at the yes.
    assert done["text"] == "工作已交辦。" and done["turn_id"] == asked["turn_id"]
    made = {m["name"]: m["id"] for m in (await rig.call("members.list", {}))["members"]}
    shown = brain.continued()
    assert f'"id": {made["Research"]}' in shown and f'"id": {made["Writer"]}' in shown


async def test_in_automatic_mode_the_members_exist_at_once_and_the_model_sees_their_ids(setup, client, brain):
    rig, team = setup
    rig.settings.set("action_mode", "direct")
    brain(("member_create", {"name": "Research", "role": "Research"}), ("member_create", {"name": "Writer", "role": "Writer"}))
    done = await typed(rig, "Create a team and give them work", 0)
    assert done["status"] == "done" and done["text"] == "工作已交辦。"
    made = (await rig.call("members.list", {}))["members"][1:]
    assert [m["name"] for m in made] == ["Research", "Writer"]
    if not brain.cli:
        results = " ".join(m["content"] for m in client.chat_calls[1]["messages"] if m.get("role") == "tool")
        assert all(f'"id": {m["id"]}' in results for m in made)


async def test_a_safety_rule_that_asks_still_gets_the_owners_yes_in_automatic_mode(setup, brain):
    from types import SimpleNamespace

    from raphael_core.agent.safety import ASK, Screening

    if brain.cli:
        pytest.skip("the api variant covers the rule")
    rig, team = setup
    rig.settings.set("action_mode", "direct")

    async def asking(proposed, **kwargs):
        return Screening(ASK)

    rig.service._gate._safety = SimpleNamespace(screen=asking)
    brain(("member_create", {"name": "Research", "role": "Research"}))
    asked = await typed(rig, "Create member Research", 0)
    assert asked["status"] == "confirm" and len((await rig.call("members.list", {}))["members"]) == 1


async def test_every_brain_collects_edits_and_applies_once(setup, brain):
    rig, team = setup
    rig.settings.set("action_mode", "ask")
    roles = ["COO", "PM", "RD", "QA", "Design", "Marketing", "Finance"]
    brain(("group_create", {"name": "Company"}), *[("member_create", {"name": role, "role": role,
        "personality": "Precise", "instructions": "Review evidence", "group": "Company"}) for role in roles])
    asked = await typed(rig, "Create the team", 0)
    assert len(asked["confirm"]["drafts"]) == 7
    assert len((await rig.call("members.list", {}))["members"]) == 1
    edited = asked["confirm"]["drafts"][:-1]
    edited[0] = {**edited[0], "instructions": "Owner edited prompt"}
    args = {"id": asked["confirm"]["id"], "approved": True, "drafts": edited}
    await rig.call("agent.confirm", args)
    before = await rig.call("members.list", {})
    assert len(before["members"]) == 7
    assert before["members"][1]["instructions"] == "Owner edited prompt"
    await rig.call("agent.confirm", args)
    assert await rig.call("members.list", {}) == before


@pytest.mark.parametrize("ending", ["cancel", "expiry", "resend"])
async def test_cancel_expiry_and_resend_never_revive_a_proposal(setup, brain, ending):
    rig, team = setup
    brain(("member_create", {"name": "Research", "role": "Research"}))
    asked = await typed(rig, "Create member Research", 0)
    old = asked["confirm"]["id"]
    if ending == "expiry":
        rig.clock.now += 31
    elif ending == "cancel":
        await rig.confirm(old, False)
    else:
        brain(("member_create", {"name": "Research", "role": "Research"}))
        newer = await typed(rig, "Create member Research", 0)
        await rig.confirm(newer["confirm"]["id"], False)
    await rig.confirm(old, True)
    assert (await rig.call("members.list", {}))["members"][1:] == []
    assert (await rig.call("members.list", {}))["groups"] == []


@pytest.mark.parametrize("approved", [False, True])
async def test_once_the_owner_answers_a_proposal_a_cli_brain_starts_a_new_thread(setup, brain, approved):
    # Live on Codex, the owner cancelled five member drafts; asked the same again, the brain's own thread still ended
    # at "the drafts are ready", so it said so and showed none. The next request starts from the history instead.
    rig, team = setup
    brain(("member_create", {"name": "Research", "role": "Research"}))
    asked = await typed(rig, "Create member Research", 0)
    main = rig.service.conversations.main(0)
    if brain.cli:
        assert rig.service._cli_sessions.get(0, "cli:codex:test", main) == "codex-thread-1"
    await rig.confirm(asked["confirm"]["id"], approved)
    if approved and brain.cli:
        # The turn went on in the same thread and ended with an answer: nothing is left half-said in it.
        assert rig.service._cli_sessions.get(0, "cli:codex:test", main) == "codex-thread-1"
    else:
        assert rig.service._cli_sessions.get(0, "cli:codex:test", main) is None


async def test_first_bot_profile_uses_the_same_draft_and_survives_service_restart(setup, brain, tmp_path):
    from raphael_core.members.service import MembersService

    rig, team = setup
    before = await rig.call("members.list", {})
    assert before["members"][0]["profile_ready"] is False
    brain(("member_update", {"id": 0, "name": "晨星", "personality": "Precise", "instructions": "Research daily"}))
    asked = await typed(rig, "Name yourself 晨星", 0)
    assert asked["confirm"]["drafts"][0]["member_id"] == 0
    waiting = await rig.call("members.list", {})
    assert waiting["members"][0]["name"] == before["members"][0]["name"]
    assert waiting["members"][0]["profile_ready"] is False
    await rig.call("agent.confirm", {"id": asked["confirm"]["id"], "approved": True, "drafts": asked["confirm"]["drafts"]})
    after = await rig.call("members.list", {})
    assert after["members"][0]["name"] == "晨星"
    assert after["members"][0]["profile_ready"] is True
    assert len(after["members"]) == 1
    turn = (await rig.turns())[0]
    assert turn["text"] == "工作已交辦。"  # the turn went on after the yes and the model closed it
    assert any(m["kind"] == "event" and m["text"] == "已重新命名為 晨星" for m in turn["messages"])
    restarted = MembersService(team.conn, tmp_path, background=team.background)
    assert restarted.speaker(0).personality == "Precise"
    assert restarted.speaker(0).instructions == "Research daily"
    assert restarted.find("晨星").id == 0
    await rig.confirm(asked["confirm"]["id"])
    assert await rig.call("members.list", {}) == after


async def test_edited_draft_cannot_replace_the_proposed_target(setup, brain):
    rig, team = setup
    one, other = member(team, name="One"), member(team, name="Other")
    brain(("member_update", {"id": one.id, "name": "Edited"}))
    asked = await typed(rig, "Rename One", 0)
    draft = {**asked["confirm"]["drafts"][0], "member_id": other.id}
    await rig.call("agent.confirm", {"id": asked["confirm"]["id"], "approved": True, "drafts": [draft]})
    assert [item.name for item in team.members.store.members()] == ["One", "Other"]


async def test_sequential_profile_edits_merge_into_one_complete_draft(setup, brain):
    rig, team = setup
    one = member(team, name="Research")
    brain(("member_update", {"id": one.id, "personality": "Precise"}),
          ("member_update", {"id": one.id, "instructions": "Check sources"}))
    asked = await typed(rig, "Update Research", 0)
    drafts = asked["confirm"]["drafts"]
    assert len(drafts) == 1
    assert (drafts[0]["personality"], drafts[0]["instructions"]) == ("Precise", "Check sources")
    await rig.call("agent.confirm", {"id": asked["confirm"]["id"], "approved": True, "drafts": drafts})
    saved = team.members.store.member(one.id)
    assert (saved.personality, saved.instructions) == ("Precise", "Check sources")


async def test_group_only_proposal_accepts_owner_edits_and_applies_once(setup, brain):
    rig, team = setup
    group = team.members.store.create_group("Original")
    brain(("group_rename", {"id": group.id, "name": "Proposed"}))
    asked = await typed(rig, "Rename the group", 0)
    assert team.members.store.group(group.id).name == "Original"
    args = {"id": asked["confirm"]["id"], "approved": True, "drafts": [],
            "groups": [{**asked["confirm"]["groups"][0], "name": "Owner edited"}]}
    await rig.call("agent.confirm", args)
    assert team.members.store.group(group.id).name == "Owner edited"
    await rig.call("agent.confirm", args)
    assert len(team.members.store.groups()) == 1


async def test_first_bot_cancel_and_invalid_batch_leave_profile_unset(setup, brain):
    rig, team = setup
    brain(("member_update", {"id": 0, "name": "Morning", "instructions": "Read notes"}))
    asked = await typed(rig, "Set up the first Bot", 0)
    await rig.confirm(asked["confirm"]["id"], False)
    assert not team.members.first_bot_profile()
    brain(("member_update", {"id": 0, "name": "Morning"}),
          ("member_create", {"name": "X" * 17, "role": "Invalid"}))
    asked = await typed(rig, "Set up both members", 0)
    await rig.confirm(asked["confirm"]["id"])
    assert not team.members.first_bot_profile()
    assert not team.members.store.members()


async def test_owner_edits_are_checked_against_current_safety_rules(setup, brain):
    from types import SimpleNamespace
    from raphael_core.agent.safety import Screening, DENY

    rig, team = setup
    brain(("member_create", {"name": "Research", "role": "Research"}))
    asked = await typed(rig, "Create member Research", 0)
    seen = []
    async def blocked(proposed, **kwargs):
        seen.append(proposed)
        return Screening(DENY)
    rig.service._gate._safety = SimpleNamespace(screen=blocked)
    draft = {**asked["confirm"]["drafts"][0], "instructions": "Edited after proposal"}
    await rig.call("agent.confirm", {"id": asked["confirm"]["id"], "approved": True, "drafts": [draft]})
    assert seen
    assert not team.members.store.members()

"""Phase-one contracts, using copied synthetic data and fake brains only."""

import hashlib
import json
import shutil

import pytest

from raphael_core.agent.harness_tools import definitions_for
from raphael_core.memory.reflection import Action


async def test_member_brain_is_used_instead_of_the_global_brain(rig):
    member = (await rig.call("members.create", {"name": "Alice", "model": "cli:codex"}))["member"]
    assert rig.service.speaker(member["id"]).model == "cli:codex"


async def test_chief_role_moves_with_the_top_contact_and_revokes_raphael(rig):
    member = (await rig.call("members.create", {"name": "Alice"}))["member"]
    await rig.call("members.set_primary", {"id": member["id"]})
    assert rig.service.team_context(0, "en")["chief_id"] == member["id"]
    assert "team_overview" in dict(definitions_for(rig.service.speaker(member["id"])))
    assert "team_overview" not in dict(definitions_for(rig.service.speaker(0)))
    assert (await rig.service.admin_tool(member["id"], "team_overview", {}))["members"]
    with pytest.raises(Exception):
        await rig.service.admin_tool(0, "team_overview", {})


async def test_private_memory_cannot_be_promoted_by_a_model_space_choice(rig):
    member = (await rig.call("members.create", {"name": "Alice"}))["member"]
    action = Action(op="write", name="preference-private", type="preference",
                    description="Prefers a private review", body="The owner prefers a private review.", space="shared")
    result = rig.memory.apply_said([action], 0, member["id"])
    assert result.written
    assert rig.memory.store_for(member["id"]).get(action.name)
    assert rig.memory.shared.get(action.name) is None
    assert not rig.memory.read([action.name], 0).data["memories"]


async def test_raphael_has_the_same_skill_store_and_home(rig):
    skill = rig.service.capabilities.keep_skill(0, "owner", "---\nname: Review\ndescription: Review work\n---\nRead carefully.\n")
    assert rig.service.enabled_skills(0)[0]["id"] == skill["id"]
    assert rig.service.capabilities._path(0, skill["id"]).is_relative_to(rig.local / "bots" / "0" / "skills")


async def test_skill_enable_revision_can_be_reverted_without_changing_the_document(rig):
    from raphael_core.bots.homes import HomeError, digest
    capabilities = rig.service.capabilities
    skill = capabilities.keep_skill(0, "owner", "---\nname: Review\ndescription: Review work\n---\nRead carefully.\n")
    capabilities.update_skill(0, skill["id"], False)
    entry = capabilities.homes.journal(0)[-1]
    state = capabilities.homes.state(0) / "skills.json"
    current = digest(state.read_bytes())
    with pytest.raises(HomeError):
        capabilities.revert_state(0, entry["id"], expected_hash="stale")
    capabilities.revert_state(0, entry["id"], expected_hash=current)
    assert capabilities.skills(0)[0]["enabled"]
    assert capabilities.read_skill(0, "Review").endswith("Read carefully.\n")


async def test_owner_can_explicitly_share_a_team_decision(rig):
    action = Action(op="write", name="ongoing-team-review", type="ongoing",
                    description="Team review decision", body="The team will review this plan on Friday.",
                    expires="2099-12-31", space="shared")
    assert rig.memory.apply_said([action], 0, 0, share=True).written
    assert rig.memory.shared.get(action.name)
    assert "Friday" in (rig.local / "shared/team.md").read_text()


@pytest.mark.parametrize("text,expected", [
    ("請記住，這是全團隊都要知道的共同資訊", True),
    ("Remember this and share it with everyone", True),
    ("Remember this, don't tell everyone", False),
    ("請記住，不要告訴大家", False),
    ("請記住我的私人偏好", False),
])
def test_sharing_requires_an_affirmative_owner_instruction(text, expected):
    from raphael_core.memory.service import explicitly_shared
    assert explicitly_shared(text) is expected


def test_home_paths_hashes_redaction_journal_and_revert(tmp_path):
    from raphael_core.bots.homes import BotHomes, HomeError
    homes = BotHomes(tmp_path)
    first = homes.write(1, "memory/review.md", "Keep a review.", expected_hash=None)
    assert first == hashlib.sha256(b"Keep a review.").hexdigest()
    second = homes.write(1, "memory/review.md", "Changed review.", expected_hash=first)
    with pytest.raises(HomeError):
        homes.write(1, "memory/review.md", "Stale", expected_hash=first)
    entries = homes.journal(1)
    homes.revert(1, entries[-1]["id"], expected_hash=second)
    assert (tmp_path / "bots/1/memory/review.md").read_text() == "Keep a review."
    homes.write(1, "memory/log/2026-10-29.md", "token sk-abcdefghijklmnopqrstuvwx")
    assert "sk-abcdefghijklmnopqrstuvwx" not in (tmp_path / "bots/1/memory/log/2026-10-29.md").read_text()
    for path in ("../2/MEMORY.md", "SOUL.md", "skills.json", "memory/../../shared/USER.md", "skills/review/run.py", "memory/log/no-date.md"):
        with pytest.raises(HomeError):
            homes.write(1, path, "Denied")
    assert not (tmp_path / "bots/2").exists()


def test_migration_of_a_realistic_copy_is_lossless_and_idempotent(tmp_path):
    from raphael_core.bots.homes import BotHomes
    source = tmp_path / "source"
    files = {"memory/user-owner.md": "Owner profile", "memory/reference-project.md": "Project",
             "memory/shared/preference-language.md": "Traditional Chinese",
             "memory/members/7/ongoing-review.md": "Private review",
             "member-skills/7/12.md": "---\nname: Review\ndescription: Review work\n---\nProcedure",
             "member-skills/7/references/check.md": "Reference"}
    for name, text in files.items():
        path = source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    copied = tmp_path / "copy"
    shutil.copytree(source, copied)
    homes = BotHomes(copied)
    homes.migrate()
    targets = {"memory/user-owner.md": "bots/0/memory/user-owner.md",
               "memory/reference-project.md": "bots/0/memory/reference-project.md",
               "memory/shared/preference-language.md": "shared/memory/preference-language.md",
               "memory/members/7/ongoing-review.md": "bots/7/memory/ongoing-review.md",
               "member-skills/7/12.md": "bots/7/skills/12/SKILL.md",
               "member-skills/7/references/check.md": "bots/7/skills/references/check.md"}
    for old, new in targets.items():
        assert (copied / new).read_bytes() == (source / old).read_bytes()
        assert not (copied / old).exists()
    snapshot = {str(p.relative_to(copied)): p.read_bytes() for p in copied.rglob("*") if p.is_file()}
    homes.migrate()
    assert snapshot == {str(p.relative_to(copied)): p.read_bytes() for p in copied.rglob("*") if p.is_file()}
    assert (copied / "shared/USER.md").exists() and (copied / "shared/team.md").exists()
    assert json.loads((copied / "bot-state/migration.json").read_text())["version"] == 1


def test_migration_conflict_preserves_every_source(tmp_path):
    from raphael_core.bots.homes import BotHomes, HomeError
    source = tmp_path / "memory/reference-project.md"
    source.parent.mkdir()
    source.write_bytes(b"Original\r\n")
    target = tmp_path / "bots/0/memory/reference-project.md"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"Newer")
    with pytest.raises(HomeError):
        BotHomes(tmp_path).migrate()
    assert source.read_bytes() == b"Original\r\n" and target.read_bytes() == b"Newer"

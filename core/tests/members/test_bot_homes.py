"""Phase-one contracts, using copied synthetic data and fake brains only."""

import hashlib
import json
import shutil

import pytest

from raphael_core.agent.harness_tools import definitions_for
from raphael_core.memory.reflection import Edit


async def test_member_brain_is_used_instead_of_the_global_brain(rig):
    member = (await rig.call("members.create", {"name": "Alice", "model": "cli:codex"}))["member"]
    assert rig.service.speaker(member["id"]).model == "cli:codex"


async def test_default_contact_moves_while_management_and_work_tools_stay_equal(rig):
    member = (await rig.call("members.create", {"name": "Alice"}))["member"]
    await rig.call("members.set_primary", {"id": member["id"]})
    assert rig.service.team_context(0, "en")["chief_id"] == member["id"]
    from raphael_core.management import MANAGEMENT_TOOLS, DEFINITIONS
    # Management and work stay available to both owner-private speakers.
    for speaker in (member["id"], 0):
        assert "team_overview" in dict(definitions_for(rig.service.speaker(speaker)))
        assert (await rig.service.admin_tool(speaker, "team_overview", {}))["members"]
        available = set(dict(definitions_for(rig.service.speaker(speaker)))) & MANAGEMENT_TOOLS
        assert "member_manage" in available
        assert available == set(DEFINITIONS)
    assert (await rig.service.admin_tool(0, "group_create", {"name": "Ordinary"}, interactive=True))["group"]
    assert (await rig.service.admin_tool(member["id"], "group_create", {"name": "Allowed"}, interactive=True))["group"]
    with pytest.raises(Exception):
        await rig.service.admin_tool(999, "team_overview", {})


async def test_what_the_owner_keeps_private_is_not_published_by_a_models_choice_of_file(rig):
    member = (await rig.call("members.create", {"name": "Alice"}))["member"]
    result = rig.memory.apply_edits([Edit("user", "add", "The owner prefers a private review.")], member["id"], private_request=True)
    assert result.written
    assert "private review" in rig.memory.own(member["id"]).read()
    assert rig.memory.shared.read() == ""
    assert "private review" not in str(rig.memory.snapshot(0))


async def test_a_home_is_plain_files_and_soul_says_who_the_member_is(rig):
    member = (await rig.call("members.create", {"name": "Alice", "role": "Reviewer", "personality": "Calm and exact.", "instructions": "Review every release."}))["member"]
    home = rig.local / "bots" / str(member["id"])
    soul = (home / "SOUL.md").read_text(encoding="utf-8")
    assert soul.startswith("# Alice\n") and "Reviewer" in soul and "Calm and exact." in soul and "Review every release." in soul
    assert (home / "MEMORY.md").exists() and (rig.local / "shared/USER.md").exists()
    assert not (rig.local / "bot-state" / str(member["id"]) / "SOUL.md").exists()
    await rig.call("members.update", {"id": member["id"], "personality": "Warm."})
    assert "Warm." in (home / "SOUL.md").read_text(encoding="utf-8")
    assert "# " in (rig.local / "bots/0/SOUL.md").read_text(encoding="utf-8")


def test_no_member_may_rewrite_who_it_is(tmp_path):
    from raphael_core.bots.homes import BotHomes, HomeError
    homes = BotHomes(tmp_path)
    homes.soul(1, "# Alice\n")
    with pytest.raises(HomeError):
        homes.write(1, "SOUL.md", "# Mallory\n")
    assert (tmp_path / "bots/1/SOUL.md").read_text() == "# Alice\n"


async def test_raphael_has_the_same_skill_store_and_home(rig):
    skill = rig.service.capabilities.keep_skill(0, "owner", "---\nname: review\ndescription: Review work\n---\nRead carefully.\n")
    assert rig.service.enabled_skills(0)[0]["id"] == skill["id"]
    assert rig.service.capabilities._path(0, skill["id"]).is_relative_to(rig.local / "bots" / "0" / "skills")


async def test_skill_enable_revision_can_be_reverted_without_changing_the_document(rig):
    from raphael_core.bots.homes import HomeError, digest
    capabilities = rig.service.capabilities
    skill = capabilities.keep_skill(0, "owner", "---\nname: review\ndescription: Review work\n---\nRead carefully.\n")
    capabilities.update_skill(0, skill["id"], False)
    entry = capabilities.homes.journal(0)[-1]
    state = capabilities.homes.state(0) / "skills.json"
    current = digest(state.read_bytes())
    with pytest.raises(HomeError):
        capabilities.revert_state(0, entry["id"], expected_hash="stale")
    capabilities.revert_state(0, entry["id"], expected_hash=current)
    assert capabilities.skills(0)[0]["enabled"]
    assert capabilities.read_skill(0, "review").endswith("Read carefully.\n")


async def test_owner_can_explicitly_share_a_team_decision(rig):
    assert rig.memory.apply_edits([Edit("user", "add", "We decided the team reviews this plan on Friday.")], 0, share=True).written
    assert "Friday" in (rig.local / "shared/USER.md").read_text(encoding="utf-8")


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
    first = homes.write(1, "MEMORY.md", "Keep a review.", expected_hash=None)
    assert first == hashlib.sha256(b"Keep a review.").hexdigest()
    second = homes.write(1, "MEMORY.md", "Changed review.", expected_hash=first)
    with pytest.raises(HomeError):
        homes.write(1, "MEMORY.md", "Stale", expected_hash=first)
    entries = homes.journal(1)
    homes.revert(1, entries[-1]["id"], expected_hash=second)
    assert (tmp_path / "bots/1/MEMORY.md").read_text() == "Keep a review."
    homes.write(1, "memory/log/2026-10-29.md", "token sk-abcdefghijklmnopqrstuvwx")
    assert "sk-abcdefghijklmnopqrstuvwx" not in (tmp_path / "bots/1/memory/log/2026-10-29.md").read_text()
    for path in ("../2/MEMORY.md", "SOUL.md", "skills.json", "memory/../../shared/USER.md", "memory/note.md", "skills/review/run.py", "memory/log/no-date.md"):
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
    assert (copied / "shared/USER.md").exists() and not (copied / "shared/team.md").exists()
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

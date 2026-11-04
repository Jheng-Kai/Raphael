"""Shared skills and installed packages use synthetic homes only."""

import os
from pathlib import Path

import pytest

from raphael_core.agent.team_admin import DEFINITIONS
from raphael_core.members.store import MemberError
from raphael_core.protocol import RpcError

DOCUMENT = "---\nname: writing\ndescription: Use for writing\n---\nRead references/check.md and run scripts/check.py through the local command tool."


def installed(home, relative=".claude/skills/writing"):
    folder = home / relative
    folder.mkdir(parents=True)
    (folder / "SKILL.md").write_text(DOCUMENT, encoding="utf-8")
    for name, data in {"scripts/check.py": b"raise AssertionError('never execute during import')",
                       "references/check.md": b"REFERENCE-2048", "assets/sample.bin": b"\x00\xff\x80"}.items():
        path = folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return folder


async def test_shared_packages_reach_every_member_and_grants_are_individual(rig, tmp_path):
    cap = rig.service.capabilities
    cap.skill_home = tmp_path / "synthetic-home"
    folder = installed(cap.skill_home)
    [source] = (await rig.call("members.skills.list", {"member_id": 0, "discover": True}))["sources"]
    skill = (await rig.call("members.skills.import", {"member_id": 0, "shared": True, "source": source["source"]}))["skill"]
    member = (await rig.call("members.create", {"name": "Ada"}))["member"]["id"]
    for identifier in (0, member):
        [visible] = (await rig.call("members.skills.list", {"member_id": identifier}))["skills"]
        assert visible["shared"] and visible["enabled"]
        assert "REFERENCE-2048" in rig.service.skill_read(identifier, "writing")
        assert "Skill folder:" in cap.expand(identifier, "/writing current request")
        target = cap._path(identifier, skill["id"]).parent
        for relative in ("scripts/check.py", "references/check.md", "assets/sample.bin"):
            assert (target / relative).read_bytes() == (folder / relative).read_bytes()
    await rig.call("members.skills.update", {"member_id": 0, "id": skill["id"], "enabled": False})
    assert cap.read_skill(0, "writing") is None
    assert cap.native_skills(0) == []
    assert cap.native_skills(member)
    assert cap.read_skill(member, "writing")
    await rig.call("members.skills.update", {"member_id": 0, "id": skill["id"], "enabled": True})
    assert cap.read_skill(0, "writing")
    with pytest.raises(RpcError):
        await rig.call("members.skills.update", {"member_id": member, "id": skill["id"], "text": DOCUMENT})
    with pytest.raises(RpcError):
        await rig.call("members.skills.delete", {"member_id": member, "id": skill["id"]})
    await rig.call("members.skills.delete", {"member_id": 0, "shared": True, "id": skill["id"]})
    assert cap.skills(member) == []


async def test_local_reimport_reports_changes_preserves_identity_and_member_choice(rig, tmp_path):
    cap = rig.service.capabilities
    cap.skill_home = tmp_path
    folder = installed(tmp_path, ".codex/skills/writing")
    source = "local:" + str(folder.resolve())
    first = cap.import_local(-1, source)
    cap.update_skill(0, first["id"], False)
    (folder / "scripts/check.py").write_text("print('updated')", encoding="utf-8")
    (folder / "assets/sample.bin").unlink()
    assert cap.skills(0)[0]["source_changed"] is True
    second = cap.import_local(-1, source)
    assert second["id"] == first["id"] and second["source_changed"] is False
    assert cap.skills(0)[0]["enabled"] is False
    target = cap._path(-1, first["id"]).parent
    assert not (target / "assets/sample.bin").exists()
    assert (target / "scripts/check.py").read_text(encoding="utf-8") == "print('updated')"


async def test_plugin_cache_namespaces_and_private_shared_collisions(rig, tmp_path):
    cap = rig.service.capabilities
    cap.skill_home = tmp_path
    for plugin in ("desk", "field"):
        installed(tmp_path, f".claude/plugins/cache/market/{plugin}/1.0/skills/writing")
    sources = cap.local_sources()
    assert {s["plugin"] for s in sources} == {"desk", "field"}
    for source in sources:
        cap.import_local(-1, source["source"])
    cap.keep_skill(0, "owner", DOCUMENT)
    cap.save_command(0, None, "writing", "Template", "Review {input}")
    names = [s["slash_name"] for s in cap.skills(0)]
    assert len(set(names)) == 3
    assert "desk:writing" in names and "field:writing" in names
    assert "REFERENCE-2048" in cap.expand(0, "/desk:writing request")
    assert cap.expand(0, "/writing request") == "Review request"


async def test_raphael_uses_the_same_admin_import_and_command_contract(rig, tmp_path):
    cap = rig.service.capabilities
    cap.skill_home = tmp_path
    folder = installed(tmp_path)
    for name in ("member_skill_import", "member_command_save"):
        assert DEFINITIONS[name]["parameters"]["properties"]["member_id"]["minimum"] == 0
    imported = await rig.service.admin_tool(0, "member_skill_import", {"member_id": 0, "source": "local:" + str(folder.resolve())})
    assert imported["skill"]["name"] == "writing"
    await rig.service.admin_tool(0, "member_command_save", {"member_id": 0, "name": "review", "template": "Review {input}"})
    assert cap.expand(0, "/review notes") == "Review notes"
    assert "REFERENCE-2048" in cap.expand(0, "/writing notes")


def test_unknown_local_source_and_oversized_package_are_refused(rig, tmp_path, monkeypatch):
    cap = rig.service.capabilities
    cap.skill_home = tmp_path / "home"
    outside = installed(tmp_path / "elsewhere")
    with pytest.raises(MemberError):
        cap.import_local(0, "local:" + str(outside.resolve()))
    folder = installed(cap.skill_home)
    monkeypatch.setattr("raphael_core.members.skill_library.MAX_PACKAGE_BYTES", 8)
    assert cap.local_sources() == []
    with pytest.raises(MemberError):
        cap.import_local(0, "local:" + str(folder.resolve()))
    assert cap.skills(0) == []


def test_large_cache_listing_opens_only_skill_documents(rig, tmp_path, monkeypatch):
    cap = rig.service.capabilities
    cap.skill_home = tmp_path
    cache = tmp_path / ".claude/plugins/cache"
    count = 24
    for number in range(count):
        folder = installed(tmp_path, f".claude/plugins/cache/market/plugin-{number}/1.0.0/skills/writing")
        with (folder / "assets/large.bin").open("wb") as stream:
            stream.truncate(4 * 1024 * 1024)
    for ignored in ("node_modules", ".hidden"):
        installed(tmp_path, f".claude/plugins/cache/{ignored}/hidden/1.0.0/skills/writing")
    installed(tmp_path, ".claude/plugins/cache/market/plugin-0/1.0.0/skills/writing/nested")
    opened = []
    original_open = Path.open

    def track_open(path, *args, **kwargs):
        if path.is_relative_to(cache):
            opened.append(path)
            assert path.name == "SKILL.md", "Listing must not open scripts, references or assets"
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", track_open)
    sources = cap.local_sources()
    assert len(sources) == count
    assert len(opened) == count


def test_import_resolves_only_the_selected_folder(rig, tmp_path, monkeypatch):
    from raphael_core.members import skill_library

    cap = rig.service.capabilities
    cap.skill_home = tmp_path
    folder = installed(tmp_path)
    snapshots = []
    original_package = skill_library.package

    def snapshot(path):
        snapshots.append(path)
        return original_package(path)

    monkeypatch.setattr(cap, "local_sources", lambda: pytest.fail("Import must not discover every source"))
    monkeypatch.setattr(skill_library, "package", snapshot)
    skill = cap.import_local(0, "local:" + str(folder.resolve()))
    assert skill["name"] == "writing"
    assert snapshots == [folder.resolve()]


@pytest.mark.parametrize("brain", ["claude", "codex"])
def test_plugin_versions_select_latest_and_reimport_keeps_grants(rig, tmp_path, brain):
    cap = rig.service.capabilities
    cap.skill_home = tmp_path
    relative = f".{brain}/plugins/cache/market/desk"
    old = installed(tmp_path, relative + "/1.9.0/skills/writing")
    first = cap.import_local(-1, "local:" + str(old.resolve()))
    cap.update_skill(0, first["id"], False)
    newest = installed(tmp_path, relative + "/1.10.0/skills/writing")
    (newest / "references/check.md").write_text("LATEST-REFERENCE", encoding="utf-8")
    os.utime(old.parents[1], ns=(2_000_000_000_000_000_000, 2_000_000_000_000_000_000))
    [source] = cap.local_sources()
    assert source["source"] == "local:" + str(newest.resolve())
    assert cap.skills(0)[0]["source_changed"] is True
    second = cap.import_local(-1, first["source"])
    assert second["id"] == first["id"]
    assert second["source"] == source["source"]
    assert second["source_changed"] is False
    assert cap.skills(0)[0]["enabled"] is False
    assert (cap._path(-1, first["id"]).parent / "references/check.md").read_text() == "LATEST-REFERENCE"


@pytest.mark.parametrize("versions, expected", [
    ({"2.0.0-beta.2": 400, "2.0.0-beta.10": 300}, "2.0.0-beta.10"),
    ({"2.0.0-beta.10": 300, "2.0.0": 100}, "2.0.0"),
    ({"2.0.0+older": 100, "2.0.0+newer": 200}, "2.0.0+newer"),
])
def test_semver_prerelease_and_build_ties_use_version_then_mtime(rig, tmp_path, versions, expected):
    cap = rig.service.capabilities
    cap.skill_home = tmp_path
    relative = ".claude/plugins/cache/market/desk"
    for version in versions:
        installed(tmp_path, relative + f"/{version}/skills/writing")
    for version, stamp in versions.items():
        os.utime(tmp_path / relative / version, (stamp, stamp))
    [source] = cap.local_sources()
    assert Path(source["source"][6:]).parents[1].name == expected


def test_source_change_checks_read_no_installed_file_bodies(rig, tmp_path, monkeypatch):
    cap = rig.service.capabilities
    cap.skill_home = tmp_path
    folder = installed(tmp_path)
    imported = cap.import_local(0, "local:" + str(folder.resolve()))
    opened = []
    original_open = Path.open

    def track_open(path, *args, **kwargs):
        if path.is_relative_to(folder):
            opened.append(path)
            pytest.fail("Checking source changes must use file metadata only")
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", track_open)
    assert cap.skills(0)[0]["source_changed"] is False
    path = folder / "scripts/check.py"
    info = path.stat()
    os.utime(path, ns=(info.st_atime_ns, info.st_mtime_ns + 1_000_000_000))
    assert cap.skills(0)[0]["source_changed"] is True
    assert imported["id"] == cap.skills(0)[0]["id"]
    assert opened == []


def test_discovery_walk_is_bounded(rig, tmp_path, monkeypatch):
    cap = rig.service.capabilities
    cap.skill_home = tmp_path
    for number in range(12):
        installed(tmp_path, f".claude/plugins/cache/market/plugin-{number}/1.0.0/skills/writing")
    monkeypatch.setattr("raphael_core.members.skill_library.MAX_DISCOVERY_ENTRIES", 12)
    assert len(cap.local_sources()) < 12

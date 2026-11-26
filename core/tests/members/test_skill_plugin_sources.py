"""A plugin imports from any source the owner can name, and a local source outside the old folders stays updatable (#355)."""

import json
import os
import subprocess

import pytest

from raphael_core.protocol import RpcError
from .github_fake import FakeGitHub
from .test_skill_import_limits import detail, stored
from .test_skill_packages import document


def plugin(version="1.0.0", **extra):
    manifest = {"name": "desk", "description": "Desk workflows", **({"version": version} if version else {})}
    return {
        ".claude-plugin/plugin.json": json.dumps(manifest).encode(),
        "skills/write/SKILL.md": document("write").encode(),
        "skills/write/references/check.md": b"CHECK " + version.encode(),
        "skills/check/SKILL.md": document("check").encode(),
        "commands/review.md": b"---\ndescription: Review the request\n---\nReview $ARGUMENTS",
        "docs/readme.md": b"not a skill",
        **extra,
    }


async def library(rig, params):
    return await rig.call("members.skills.import", {"member_id": 0, "shared": True, **params})


@pytest.mark.parametrize("source", ["https://github.com/owner/desk", "owner/desk", "https://github.com/owner/repo/tree/main/plugins/desk"])
async def test_a_plugin_imports_from_a_github_link_with_the_plugin_option(rig, monkeypatch, source):
    github = FakeGitHub(monkeypatch)
    if "plugins/desk" in source:
        github.add("owner/repo", {**{f"plugins/desk/{k}": v for k, v in plugin().items()}, "README.md": b"x"})
    else:
        github.add("owner/desk", plugin())
    installed = await library(rig, {"plugin": True, "access": "all", "source": source})
    assert installed["set"]["name"] == "desk" and installed["set"]["skill_count"] == 2 and installed["set"]["command_count"] == 1
    listed = (await rig.call("skills.library.list", {}))["packages"]
    assert [(p["name"], p["kind"], p["updatable"]) for p in listed] == [("desk", "plugin", True)]
    assert sorted(s["name"] for s in listed[0]["skills"]) == ["check", "review", "write"]


async def test_a_github_plugin_is_updated_from_its_source_and_keeps_what_the_owner_chose(rig, monkeypatch):
    github = FakeGitHub(monkeypatch)
    github.add("owner/desk", plugin())
    first = await library(rig, {"plugin": True, "source": "owner/desk"})
    key = f"set:{first['set']['id']}"
    write = next(s for s in first["skills"] if s["name"] == "write")
    await rig.call("skills.library.update", {"key": key, "skill": {"id": write["id"], "enabled": False}, "access": "all"})
    github.add("owner/desk", plugin("2.0.0"))
    updated = (await rig.call("skills.library.update", {"key": key, "refresh": True}))["package"]
    assert updated["version"] == "2.0.0" and updated["access"] == "all"
    assert next(s for s in updated["skills"] if s["name"] == "write")["enabled"] is False
    assert next(s for s in updated["skills"] if s["name"] == "write")["id"] == write["id"]


async def test_a_plugin_that_names_no_version_imports(rig, monkeypatch):
    FakeGitHub(monkeypatch).add("owner/desk", plugin(version=""))
    installed = await library(rig, {"plugin": True, "source": "owner/desk"})
    assert installed["set"]["version"] == "" and installed["set"]["skill_count"] == 2


async def test_the_plugin_option_on_a_source_without_a_manifest_imports_its_skills_as_a_package(rig, monkeypatch):
    github = FakeGitHub(monkeypatch)
    github.add("owner/skills", {"skills/alpha/SKILL.md": document("alpha").encode(), "skills/beta/SKILL.md": document("beta").encode()})
    made = await library(rig, {"plugin": True, "source": "owner/skills"})
    assert "set" not in made and sorted(s["name"] for s in made["skills"]) == ["alpha", "beta"]
    assert [(p["kind"], len(p["skills"])) for p in (await rig.call("skills.library.list", {}))["packages"]] == [("pack", 2)]


async def test_a_plugin_that_fails_to_download_says_why_and_leaves_nothing(rig, monkeypatch):
    github = FakeGitHub(monkeypatch)
    github.add("owner/desk", plugin())
    with pytest.raises(RpcError) as error:
        await library(rig, {"plugin": True, "source": "owner/missing"})
    assert detail(error)["reason"] == "repo"
    github.fail["raw.githubusercontent.com"] = __import__("httpx").ConnectError("down")
    with pytest.raises(RpcError) as error:
        await library(rig, {"plugin": True, "source": "owner/desk"})
    assert detail(error)["reason"] == "network"
    assert (await rig.call("skills.library.list", {}))["packages"] == []


def make_folder(root, files):
    for name, data in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return root


async def test_a_plugin_folder_anywhere_imports_and_its_update_follows_the_folder(rig, tmp_path):
    folder = make_folder(tmp_path / "Documents" / "work" / "desk", plugin())
    installed = await library(rig, {"plugin": True, "source": f"local:{folder}"})
    assert installed["set"]["skill_count"] == 2 and installed["set"]["source_changed"] is False
    (folder / "skills/write/references/check.md").write_bytes(b"CHECK EDITED")
    assert (await rig.call("members.skills.list", {"member_id": 0, "shared": True, "discover": True}))["sets"][0]["source_changed"] is True
    key = f"set:{installed['set']['id']}"
    await rig.call("skills.library.update", {"key": key, "refresh": True})
    write = next(s for s in (await rig.call("skills.library.list", {}))["packages"][0]["skills"] if s["name"] == "write")
    stored_file = rig.service.capabilities.plugin_root(installed["set"]["id"]) / "skills/write/references/check.md"
    assert stored_file.read_bytes() == b"CHECK EDITED" and write["enabled"]


async def test_two_plugin_folders_side_by_side_are_two_plugins(rig, tmp_path):
    for name in ("desk", "lab"):
        files = plugin()
        files[".claude-plugin/plugin.json"] = json.dumps({"name": name, "version": "1"}).encode()
        make_folder(tmp_path / "plugins" / name, files)
        await library(rig, {"plugin": True, "source": f"local:{tmp_path / 'plugins' / name}"})
    assert sorted(p["name"] for p in (await rig.call("skills.library.list", {}))["packages"]) == ["desk", "lab"]


async def test_a_local_folder_without_a_manifest_is_a_package_with_the_plugin_option(rig, tmp_path):
    folder = make_folder(tmp_path / "loose", {"alpha/SKILL.md": document("alpha").encode(), "beta/SKILL.md": document("beta").encode()})
    made = await library(rig, {"plugin": True, "source": f"local:{folder}"})
    assert sorted(s["name"] for s in made["skills"]) == ["alpha", "beta"]


def link(target, place):
    try:
        os.symlink(target, place, target_is_directory=True)
    except OSError:
        if os.name != "nt":
            pytest.skip("cannot create local links")
        subprocess.run(["cmd", "/c", "mklink", "/J", str(place), str(target)], check=True, capture_output=True)


async def test_a_skill_folder_outside_the_old_folders_imports_and_updates(rig, tmp_path):
    folder = make_folder(tmp_path / "Documents" / "skills" / "tidy", {"SKILL.md": document("tidy").encode(), "notes.md": b"v1"})
    package = (await rig.call("skills.library.import", {"source": f"local:{folder}"}))["package"]
    assert package["updatable"] is True and package["source"] == f"local:{folder}"
    (folder / "notes.md").write_bytes(b"v2")
    updated = (await rig.call("skills.library.update", {"key": package["key"], "refresh": True}))["package"]
    assert (await stored(rig, updated))["notes.md"] == 2


async def test_a_folder_reached_through_a_link_imports_where_the_link_leads(rig, tmp_path):
    real = make_folder(tmp_path / "real" / "skills" / "tidy", {"SKILL.md": document("tidy").encode()})
    link(tmp_path / "real", tmp_path / "Documents")
    package = (await rig.call("skills.library.import", {"source": f"local:{tmp_path / 'Documents' / 'skills' / 'tidy'}"}))["package"]
    assert [s["name"] for s in package["skills"]] == ["tidy"] and real.exists()


@pytest.mark.parametrize("name,reason", [("relative/folder", "path"), ("gone", "source")])
async def test_a_local_source_that_cannot_be_read_says_why(rig, tmp_path, name, reason):
    source = f"local:{name}" if reason == "path" else f"local:{tmp_path / name}"
    with pytest.raises(RpcError) as error:
        await rig.call("skills.library.import", {"source": source})
    assert detail(error)["reason"] == reason

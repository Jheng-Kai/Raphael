"""Any kind of plugin imports whole: its commands, agents, hooks, scripts, binaries and large assets stay, whichever maker wrote it."""

import json

import pytest

from raphael_core.members import skill_layouts
from .github_fake import FakeGitHub
from .test_skill_packages import archive, document, upload

PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + bytes(range(256)) * 8
EXE = b"MZ\x90\x00" + bytes(255 - i % 256 for i in range(4096))
BIG = bytes(i * 7 % 251 for i in range(3 * 1024 * 1024))


def claude_plugin():
    """A Claude Code plugin: a skill whose document is one line and sends the work to other files, commands, an agent, hooks, a
    script, a binary and a large asset."""
    return {
        ".claude-plugin/plugin.json": json.dumps({"name": "deploy-kit", "version": "2.1.0", "description": "Ship it"}).encode(),
        "skills/ship/SKILL.md": b"---\nname: ship\ndescription: Ship a release. Use when asked to deploy.\n---\nDo `${CLAUDE_PLUGIN_ROOT}/actions/ship.md`.\n",
        "actions/ship.md": b"1. Run scripts/ship.sh\n2. Ask agents/reviewer.md to check it\n",
        "commands/rollback.md": b"---\ndescription: Roll the release back\n---\nRoll back $ARGUMENTS",
        "agents/reviewer.md": b"---\nname: reviewer\ndescription: Reviews a release\n---\nYou review releases.",
        "hooks/hooks.json": json.dumps({"hooks": {"PostToolUse": []}}).encode(),
        "scripts/ship.sh": b"#!/bin/sh\necho shipped\n",
        "bin/tool.exe": EXE,
        "assets/logo.png": PNG,
        "assets/dataset.bin": BIG,
        "README.md": b"Deploy kit",
    }


def marketplace():
    return {
        ".claude-plugin/marketplace.json": json.dumps({"name": "toolbox", "plugins": [
            {"name": "alpha", "source": "./plugins/alpha"}, {"name": "beta", "source": "./plugins/beta"},
            {"name": "elsewhere", "source": {"source": "github", "repo": "owner/other"}}]}).encode(),
        "plugins/alpha/.claude-plugin/plugin.json": json.dumps({"name": "alpha", "version": "1.0.0"}).encode(),
        "plugins/alpha/skills/read/SKILL.md": document("read").encode(),
        "plugins/alpha/scripts/read.sh": b"echo read\n",
        "plugins/beta/commands/fix.md": b"---\ndescription: Fix it\n---\nFix $ARGUMENTS",
        "plugins/beta/agents/helper.md": b"---\nname: helper\n---\nHelp.",
    }


def codex_plugin():
    return {
        ".codex-plugin/plugin.json": json.dumps({"name": "codexy", "version": "0.3.0", "description": "A Codex plugin",
                                                "skills": "./skills/"}).encode(),
        "skills/plan/SKILL.md": document("plan").encode(),
        "skills/plan/scripts/plan.py": b"print('plan')\n",
        "assets/icon.png": PNG,
    }


def cursor_plugin():
    return {
        ".cursor-plugin/plugin.json": json.dumps({"name": "cursory", "description": "A Cursor plugin"}).encode(),
        "commands/lint.md": b"---\ndescription: Lint the change\n---\nLint $ARGUMENTS",
        "rules/style.mdc": b"---\ndescription: style\nalwaysApply: true\n---\nKeep it short.",
    }


def bare_plugin():
    return {"commands/clean.md": b"---\ndescription: Clean up\n---\nClean $ARGUMENTS",
            "agents/auditor.md": b"---\nname: auditor\n---\nAudit.", "scripts/clean.sh": b"echo clean\n"}


def write(root, files):
    for name, data in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return root


def stored_tree(rig, package):
    """Every file of a stored plugin, `{path: bytes}`, as the library keeps it."""
    set_id = int(package["key"].removeprefix("set:"))
    root = rig.service.capabilities.plugin_root(set_id)
    return {path.relative_to(root).as_posix(): path.read_bytes() for path in root.rglob("*") if path.is_file()}


def assert_whole(rig, package, files):
    """The stored plugin holds every file of the source byte for byte (the library adds only the documents it made of commands)."""
    kept = stored_tree(rig, package)
    assert all(kept.get(path) == data for path, data in files.items()), [p for p in files if kept.get(p) != files[p]]


CASES = [("claude", claude_plugin, "deploy-kit", {"ship", "rollback"}), ("marketplace", marketplace, "toolbox", {"read", "fix"}),
         ("codex", codex_plugin, "codexy", {"plan"}), ("cursor", cursor_plugin, "cursory", {"lint"}),
         ("bare", bare_plugin, "bare", {"clean"})]


def sources(make, name, tmp_path):
    """The same plugin as a picked folder, a ZIP, a tar.gz, a dropped tree and a GitHub repository."""
    files = make()
    yield "folder", {"source": f"local:{write(tmp_path / name, files)}"}
    yield "zip", upload(f"{name}.zip", archive([(f"{name}/{path}", data) for path, data in files.items()]))
    yield "tgz", upload(f"{name}.tgz", archive([(path, data) for path, data in files.items()], tar=True))
    yield "dropped", {"files": [{"path": f"{name}/{path}", "data": __import__("base64").b64encode(data).decode()}
                                for path, data in files.items()]}


@pytest.mark.parametrize("kind, make, name, skills", CASES)
async def test_a_plugin_of_any_maker_is_kept_whole_from_every_kind_of_source(rig, tmp_path, kind, make, name, skills):
    for how, params in sources(make, "bare" if kind == "bare" else name, tmp_path / kind):
        package = (await rig.call("skills.library.import", params))["package"]
        assert package["kind"] == "plugin" and package["name"] == name, (how, package)
        assert {skill["name"] for skill in package["skills"]} == skills, how
        assert_whole(rig, package, make())
        await rig.call("skills.library.delete", {"key": package["key"]})


@pytest.mark.parametrize("kind, make, name, skills", CASES)
async def test_a_plugin_comes_whole_from_a_github_repository(rig, monkeypatch, kind, make, name, skills):
    FakeGitHub(monkeypatch).add("owner/kit", make())
    package = (await rig.call("skills.library.import", {"source": "owner/kit"}))["package"]
    assert package["kind"] == "plugin" and {skill["name"] for skill in package["skills"]} == skills
    assert_whole(rig, package, make())
    assert package["updatable"] is True


async def test_a_plugin_in_a_folder_of_a_repository_is_that_plugin(rig, monkeypatch):
    FakeGitHub(monkeypatch).add("owner/repo", {**{f"plugins/kit/{k}": v for k, v in claude_plugin().items()}, "README.md": b"x"})
    package = (await rig.call("skills.library.import", {"source": "https://github.com/owner/repo/tree/main/plugins/kit"}))["package"]
    assert package["name"] == "deploy-kit" and package["kind"] == "plugin"
    assert_whole(rig, package, claude_plugin())


async def test_the_marketplace_lists_only_the_plugins_of_its_own_tree(rig, tmp_path):
    folder = write(tmp_path / "toolbox", marketplace())
    package = (await rig.call("skills.library.import", {"source": f"local:{folder}"}))["package"]
    assert sorted(skill["name"] for skill in package["skills"]) == ["fix", "read"]
    manifest = json.loads(stored_tree(rig, package)[".claude-plugin/plugin.json"])
    assert manifest["skills"] == ["plugins/alpha/skills", "plugins/beta/skills"]
    assert manifest["commands"] == ["plugins/alpha/commands", "plugins/beta/commands"]


async def test_a_binary_and_a_large_asset_come_whole(rig, tmp_path):
    folder = write(tmp_path / "kit", claude_plugin())
    package = (await rig.call("skills.library.import", {"source": f"local:{folder}"}))["package"]
    kept = stored_tree(rig, package)
    assert kept["assets/dataset.bin"] == BIG and kept["assets/logo.png"] == PNG and kept["bin/tool.exe"] == EXE


async def test_a_plugin_is_updated_from_its_folder_again_whatever_its_maker(rig, tmp_path):
    folder = write(tmp_path / "codexy", codex_plugin())
    first = (await rig.call("skills.library.import", {"source": f"local:{folder}"}))["package"]
    (folder / "skills/plan/scripts/plan.py").write_bytes(b"print('plan 2')\n")
    updated = (await rig.call("skills.library.update", {"key": first["key"], "refresh": True}))["package"]
    assert updated["key"] == first["key"]
    assert stored_tree(rig, updated)["skills/plan/scripts/plan.py"] == b"print('plan 2')\n"


async def test_skills_only_is_asked_for_with_plugin_false(rig, tmp_path):
    folder = write(tmp_path / "kit", claude_plugin())
    package = (await rig.call("skills.library.import", {"source": f"local:{folder}", "plugin": False}))["package"]
    assert [skill["name"] for skill in package["skills"]] == ["ship"]


async def test_a_collection_of_skills_is_still_a_package_of_skills(rig, tmp_path):
    folder = write(tmp_path / "skills", {"skills/alpha/SKILL.md": document("alpha").encode(), "skills/beta/SKILL.md": document("beta").encode(),
                                         "skills/beta/bin/run": EXE, "skills/alpha/references/x.md": b"x"})
    package = (await rig.call("skills.library.import", {"source": f"local:{folder}"}))["package"]
    assert package["kind"] == "pack" and sorted(skill["name"] for skill in package["skills"]) == ["alpha", "beta"]
    held = rig.service.capabilities.homes.home(-1) / "skills" / str(next(s["id"] for s in package["skills"] if s["name"] == "beta"))
    assert (held / "bin/run").read_bytes() == EXE


def test_what_is_a_plugin_and_what_is_not():
    assert skill_layouts.is_plugin(claude_plugin()) and skill_layouts.is_plugin(bare_plugin())
    assert not skill_layouts.is_plugin({"SKILL.md": b"x", "commands/a.md": b"x"})
    assert not skill_layouts.is_plugin({"skills/a/SKILL.md": b"x", "README.md": b"x"})
    assert not skill_layouts.is_plugin({"docs/commands/a.md": b"x"})
    assert skill_layouts.normalized({"skills/a/SKILL.md": b"x"}, "a") is None


async def test_a_plugin_with_a_link_out_of_it_names_the_link_and_keeps_the_rest(rig, tmp_path):
    folder = write(tmp_path / "kit", claude_plugin())
    outside = tmp_path / "outside.md"
    outside.write_bytes(b"not part of the plugin")
    try:
        (folder / "docs-link.md").symlink_to(folder / "README.md")
        (folder / "away.md").symlink_to(outside)
    except OSError as error:
        pytest.skip(f"cannot create local symlinks: {error}")
    package = (await rig.call("skills.library.import", {"source": f"local:{folder}"}))["package"]
    kept = stored_tree(rig, package)
    assert kept["docs-link.md"] == b"Deploy kit" and "away.md" not in kept
    assert package["skipped_links"] == {"plugin": ["away.md"]}
    assert_whole(rig, package, claude_plugin())

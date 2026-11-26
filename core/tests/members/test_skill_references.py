"""A skill comes whole: what its document links to outside its folder, inside the source it came in, comes with it (#355)."""

import pytest

from .github_fake import FakeGitHub
from .test_skill_import_limits import stored
from .test_skill_packages import archive, document


def layout(root="", manifest=False):
    files = {
        "skills/notes/SKILL.md": (document("notes") + "\nRead [the report](../../actions/report.md), ../../missing/none.md and "
                                  "[the readme](../../README.md). Never read ../../../escape.md.\n").encode(),
        "skills/notes/references/own.md": b"own",
        "skills/other/SKILL.md": document("other").encode(),
        "actions/report.md": b"# Report\nShared: [common](_common.md)\n",
        "actions/_common.md": b"common",
        "docs/unrelated.md": b"never asked for",
        "README.md": b"the readme",
    }
    if manifest:
        files[".claude-plugin/plugin.json"] = b'{"name":"notes","version":"1.0.0"}'
    return {root + name: data for name, data in files.items()}


def arguments(kind, tmp_path, monkeypatch, files):
    """The import's arguments, and the fake GitHub when the source is one."""
    if kind == "folder":
        for name, data in files.items():
            path = tmp_path / "source" / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        return {"source": f"local:{tmp_path / 'source'}"}, None
    if kind in ("zip", "tgz"):
        from .test_skill_packages import upload

        return upload(f"source.{kind}", archive(sorted(("top/" + name, data) for name, data in files.items()), kind == "tgz")), None
    github = FakeGitHub(monkeypatch)
    github.add("owner/repo", files)
    return {"source": "https://github.com/owner/repo/tree/main/skills/notes" if kind == "skill-link" else "owner/repo"}, github


@pytest.mark.parametrize("manifest", [False, True], ids=["loose", "plugin"])
@pytest.mark.parametrize("kind", ["folder", "zip", "tgz", "github", "skill-link"])
async def test_a_skill_takes_the_files_its_document_links_to_inside_its_source(rig, tmp_path, monkeypatch, kind, manifest):
    args, github = arguments(kind, tmp_path, monkeypatch, layout(manifest=manifest))
    # The skills alone: a plugin imported whole keeps its files where the plugin has them (test_skill_layouts.py).
    package = (await rig.call("skills.library.import", {**args, "plugin": False}))["package"]
    notes = next(s for s in package["skills"] if s["name"] == "notes")
    files = await stored(rig, {"skills": [notes]})
    assert {"SKILL.md", "references/own.md", "_plugin/actions/report.md", "_plugin/actions/_common.md", "_plugin/README.md"} <= set(files)
    assert not any("unrelated" in name or name.startswith("_plugin/skills/other") for name in files)
    text = rig.service.capabilities.homes.home(-1).joinpath("skills", str(notes["id"]), "SKILL.md").read_text(encoding="utf-8")
    assert "[the report](_plugin/actions/report.md)" in text and "[the readme](_plugin/README.md)" in text
    named = package["skipped_references"][str(notes["id"])]
    assert named == [{"path": "../../../escape.md", "reason": "outside_plugin"}]
    assert (package["kind"] == "plugin") is manifest
    if github:
        assert not any("unrelated" in url for url in github.raw_requests())


async def test_a_plugin_skill_stays_inside_its_plugin_in_a_repository_of_several(rig, tmp_path, monkeypatch):
    files = {**layout(root="one/", manifest=True), "two/shared.md": b"another plugin's",
             "two/.claude-plugin/plugin.json": b'{"name":"two","version":"1"}', "two/skills/t/SKILL.md": document("t").encode()}
    files["one/skills/notes/SKILL.md"] += b"Also ../../../two/shared.md.\n"
    github = FakeGitHub(monkeypatch)
    github.add("owner/repo", files)
    package = (await rig.call("skills.library.import", {"source": "owner/repo"}))["package"]
    notes = next(s for s in package["skills"] if s["name"] == "notes")
    assert {"path": "../../../two/shared.md", "reason": "outside_plugin"} in package["skipped_references"][str(notes["id"])]
    assert "_plugin/actions/report.md" in await stored(rig, {"skills": [notes]})

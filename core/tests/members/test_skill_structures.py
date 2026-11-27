"""A skill of any structure comes whole and is read in steps (R-SKILL-37): the Agent Skills standard is a SKILL.md and any
folders its document points to, read on demand. The owner's Lazy Mode is such a skill: its SKILL.md is an overview that names
nine actions, and each action's details are Markdown files of an `actions/` folder that the model is told to read.

Every layout the folder can have (beside the document, or at the repository or plugin root, linked by a relative path or only
named in words) is imported from every way a skill arrives (a folder, a ZIP, a tar.gz, a GitHub repository, folder or file link,
a Git address, a chosen SKILL.md, pasted text), and each time the files are in the skill's folder, `skill_read` names them and
`skill_read` with `reference` reads them."""

import pytest

from raphael_core.members import skill_git, skill_sources
from raphael_core.members.store import MemberError

from .github_fake import FakeGitHub
from .test_skill_git import FakeGit
from .test_skill_import_limits import stored
from .test_skill_packages import archive, document, upload

ACTIONS = ("how", "plan", "ship", "review", "undo", "status", "sync", "clean", "help")


def overview(how):
    """The document of Lazy Mode: nine actions, each in a file of `actions/`, told in the way `how` says."""
    head = document("lazy-mode") + "\n# Lazy mode\nDo the least that works. Nine actions:\n"
    if how == "links":
        return head + "".join(f"- [{name}](actions/{name}.md)\n" for name in ACTIONS)
    if how == "dotdot":
        return head + "".join(f"- [{name}](../../actions/{name}.md)\n" for name in ACTIONS)
    if how == "plain":
        # Written from the root of the plugin, the way a plugin's documents name each other.
        return head + "".join(f"- [{name}](actions/{name}.md)\n" for name in ACTIONS) + "\nRead the action's file before you act.\n"
    if how == "template":
        return head + "Read the file of the action in `actions/<name>.md` before you act: " + ", ".join(ACTIONS) + ".\n"
    return head + "Read the files in the actions folder before you act: " + ", ".join(ACTIONS) + ".\n"  # words only


def actions(prefix=""):
    return {f"{prefix}actions/{name}.md": f"# {name}\nSteps of {name}.\n".encode() for name in ACTIONS}


def layout(kind, how):
    """`(files, skill_folder)`: the files of a source and the folder of the skill in it."""
    if kind == "beside":
        return {"SKILL.md": overview(how).encode(), "references/own.md": b"own", **actions()}, ""
    if kind == "in_folder":
        return {"lazy-mode/SKILL.md": overview(how).encode(), **actions("lazy-mode/"), "README.md": b"readme"}, "lazy-mode"
    if kind == "repository":
        return {"skills/lazy-mode/SKILL.md": overview(how).encode(), "skills/other/SKILL.md": document("other").encode(),
                **actions(), "docs/unrelated.md": b"never asked for"}, "skills/lazy-mode"
    return {".claude-plugin/plugin.json": b'{"name":"lazy","version":"1.0.0"}', "skills/lazy-mode/SKILL.md": overview(how).encode(),
            **actions(), "docs/unrelated.md": b"never asked for"}, "skills/lazy-mode"


# The layouts and the ways to write the document that make the actions reachable from the skill (the folder of the skill is
# where `skill_read` and `reference` look).
CASES = [("beside", "links"), ("beside", "template"), ("beside", "words"), ("in_folder", "links"), ("in_folder", "words"),
         ("repository", "dotdot"), ("repository", "plain"), ("repository", "template"), ("repository", "words"),
         ("plugin", "dotdot"), ("plugin", "plain"), ("plugin", "template"), ("plugin", "words")]


def write(root, files):
    for name, data in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return root


async def arrive(rig, tmp_path, monkeypatch, way, files, folder):
    """Import `files` the way `way` says and return the package. The source's top is the repository; `folder` is the skill's."""
    leaf = folder.rsplit("/", 1)[-1] if folder else "lazy-mode"
    if way == "folder":
        return (await rig.call("skills.library.import", {"source": f"local:{write(tmp_path / 'src', files)}", "plugin": False}))["package"]
    if way in ("zip", "tgz"):
        entries = sorted(("top/" + name, data) for name, data in files.items())
        return (await rig.call("skills.library.import", {**upload(f"lazy.{way}", archive(entries, way == "tgz")), "plugin": False}))["package"]
    if way in ("github", "github-folder", "github-file"):
        github = FakeGitHub(monkeypatch)
        github.add("owner/repo", files)
        link = {"github": "owner/repo", "github-folder": f"https://github.com/owner/repo/tree/main/{folder}".rstrip("/"),
                "github-file": f"https://github.com/owner/repo/blob/main/{folder + '/' if folder else ''}SKILL.md"}[way]
        return (await rig.call("skills.library.import", {"source": link, "plugin": False}))["package"]
    if way == "git":
        FakeGit(monkeypatch, files=files)
        return (await rig.call("skills.library.import", {"source": "git@gitlab.example.com:group/repo.git", "plugin": False}))["package"]
    if way == "chosen":
        write(tmp_path / "src", files)
        # The Windows picker names the document: what it holds is the folder that holds it, in the repository it was cut from.
        document_path = tmp_path / "src" / folder / "SKILL.md" if folder else tmp_path / "src" / "SKILL.md"
        return (await rig.call("skills.library.import", {"source": f"local:{document_path}", "plugin": False}))["package"]
    raise AssertionError(way)


WAYS = ["folder", "zip", "tgz", "github", "github-folder", "github-file", "git", "chosen"]


def lazy(package):
    return next(skill for skill in package["skills"] if skill["name"] == "lazy-mode")


def reached(files):
    """Where each action's file is among the files of the stored skill."""
    return {name: next((path for path in files if path.endswith(f"actions/{name}.md")), None) for name in ACTIONS}


@pytest.mark.parametrize("way", WAYS)
@pytest.mark.parametrize("kind, how", CASES)
async def test_the_actions_of_a_skill_come_with_it_from_every_source(rig, tmp_path, monkeypatch, way, kind, how):
    files, folder = layout(kind, how)
    if way in ("github-file", "chosen") and not folder and kind != "beside":
        pytest.skip("no such source")
    package = await arrive(rig, tmp_path, monkeypatch, way, files, folder)
    skill = lazy(package)
    held = await stored(rig, {"skills": [skill]})
    where = reached(held)
    assert all(where.values()), {name: path for name, path in where.items() if not path}
    # `skill_read` names every file, and `reference` reads each of them, by the path the listing gives.
    await rig.call("skills.library.update", {"key": package["key"], "access": "all"})
    text = rig.service.skill_read(0, "lazy-mode")
    for name, path in where.items():
        assert f"- {path} " in text, (path, text)
        assert rig.service.skill_file(0, "lazy-mode", path).startswith(f"# {name}")
    assert not any("unrelated" in path for path in held)


@pytest.mark.parametrize("way", ["folder", "zip", "tgz", "github", "git"])
@pytest.mark.parametrize("how", ["dotdot", "plain", "template", "words"])
async def test_a_plugin_kept_whole_names_the_files_its_skill_sends_the_model_to(rig, tmp_path, monkeypatch, way, how):
    files, folder = layout("plugin", how)
    if way == "folder":
        args = {"source": f"local:{write(tmp_path / 'src', files)}"}
    elif way in ("zip", "tgz"):
        args = upload(f"lazy.{way}", archive(sorted(("top/" + name, data) for name, data in files.items()), way == "tgz"))
    elif way == "git":
        FakeGit(monkeypatch, files=files)
        args = {"source": "git@gitlab.example.com:group/repo.git"}
    else:
        FakeGitHub(monkeypatch).add("owner/repo", files)
        args = {"source": "owner/repo"}
    package = (await rig.call("skills.library.import", args))["package"]
    assert package["kind"] == "plugin"
    await rig.call("skills.library.update", {"key": package["key"], "access": "all"})
    text = rig.service.skill_read(0, "lazy-mode")
    for name in ACTIONS:
        if how != "dotdot":
            assert f"- actions/{name}.md " in text, text
        # The path the document gives is read, as it is and as the plugin lays it out.
        assert rig.service.skill_file(0, "lazy-mode", f"plugin:actions/{name}.md").startswith(f"# {name}")
        assert rig.service.skill_file(0, "lazy-mode", f"actions/{name}.md").startswith(f"# {name}")
    # What the document does not point to is a count, never a list.
    assert "unrelated" not in text and "docs/: 1 file" in text


async def test_a_slash_call_names_the_actions_of_a_skill_that_came_with_them(rig, tmp_path):
    files, _ = layout("repository", "words")
    package = (await rig.call("skills.library.import", {"source": f"local:{write(tmp_path / 'src', files)}", "plugin": False}))["package"]
    await rig.call("skills.library.update", {"key": package["key"], "access": "all"})
    request, loaded = rig.service.capabilities.resolve_slash(0, "/lazy-mode ship it")
    assert loaded
    for name in ACTIONS:
        assert f"actions/{name}.md" in request
    assert "# how" not in request  # named, never carried (R-SKILL-31)


async def test_text_that_names_other_files_asks_for_the_folder_and_imports_nothing(rig):
    text = overview("links")
    with pytest.raises(Exception) as caught:
        await rig.call("skills.library.import", {"text": text})
    assert "needs_files" in str(caught.value) and "actions/how.md" in str(caught.value)
    assert (await rig.call("skills.library.list"))["packages"] == []
    # The owner who knows it needs nothing else keeps it as it is, and text with no such file is a skill at once.
    assert (await rig.call("skills.library.import", {"text": text, "alone": True}))["package"]["skills"]
    # A document dropped alone has no folder either: it says so the same way.
    with pytest.raises(Exception, match="needs_files"):
        await rig.call("skills.library.import", upload("SKILL.md", text.encode()))
    plain = document("quiet") + "\nWrite `reports/summary.csv`, see https://example.com/a/b.md and `a/b` and read/write.\n```\nsrc/app.md\n```\n"
    assert (await rig.call("skills.library.import", {"text": plain}))["package"]["skills"]


@pytest.mark.parametrize("chosen", ["SKILL.md", "actions/how.md", "references/own.md"])
async def test_a_file_chosen_inside_a_skills_folder_is_that_folder(rig, tmp_path, chosen):
    files, folder = layout("in_folder", "links")
    files["lazy-mode/references/own.md"] = b"own"
    write(tmp_path / "src", files)
    package = (await rig.call("skills.library.import", {"source": f"local:{tmp_path / 'src' / 'lazy-mode' / chosen}"}))["package"]
    held = await stored(rig, {"skills": [lazy(package)]})
    assert {f"actions/{name}.md" for name in ACTIONS} <= set(held) and "references/own.md" in held and "SKILL.md" in held


async def test_a_file_chosen_in_a_repository_of_any_shape_reaches_the_folders_its_document_names(rig, tmp_path):
    files, _ = layout("repository", "plain")
    write(tmp_path / "repo", {f"packs/{name}": data for name, data in files.items()})
    skill = tmp_path / "repo" / "packs" / "skills" / "lazy-mode" / "SKILL.md"
    # With no `.git` and no manifest, only the folder of a `skills` folder's parent is the source: `packs/` holds the actions.
    first = (await rig.call("skills.library.import", {"source": f"local:{skill}"}))["package"]
    held = await stored(rig, {"skills": [lazy(first)]})
    assert all(f"actions/{name}.md" in held for name in ACTIONS)
    await rig.call("skills.library.delete", {"key": first["key"]})
    # Under a `.git`, the repository is the source however deep the skill is in it.
    deep = tmp_path / "git"
    write(deep, {f"a/b/c/{name}": data for name, data in layout("beside", "plain")[0].items()})
    (deep / "a" / "b" / "c" / "SKILL.md").write_bytes(overview("plain").encode().replace(b"](actions/", b"](../../../actions/"))
    write(deep, actions())
    (deep / ".git").mkdir()
    package = (await rig.call("skills.library.import", {"source": f"local:{deep / 'a' / 'b' / 'c' / 'SKILL.md'}"}))["package"]
    held = await stored(rig, {"skills": [lazy(package)]})
    assert all(f"_plugin/actions/{name}.md" in held for name in ACTIONS)


async def test_a_chosen_archive_or_lone_document_is_what_it_is(rig, tmp_path):
    # An archive is opened, a Markdown file that lies in no skill's folder is one skill's document.
    lone = tmp_path / "lone" / "my-skill.md"
    lone.parent.mkdir()
    lone.write_text(document("lone-skill"), encoding="utf-8")
    package = (await rig.call("skills.library.import", {"source": f"local:{lone}"}))["package"]
    assert [skill["name"] for skill in package["skills"]] == ["lone-skill"]
    zipped = tmp_path / "pack.zip"
    zipped.write_bytes(archive([("one/SKILL.md", document("zipped").encode())]))
    package = (await rig.call("skills.library.import", {"source": f"local:{zipped}"}))["package"]
    assert [skill["name"] for skill in package["skills"]] == ["zipped"]


async def test_the_files_a_document_names_are_looked_for_in_its_source_only(rig, tmp_path):
    files, _ = layout("repository", "plain")
    files["skills/lazy-mode/SKILL.md"] += b"Read `docs/unrelated.md`, ../../../outside.md and `secrets/key.md`.\n"
    files["secrets/key.md"] = b"a folder the plugin never had"
    write(tmp_path / "src", files)
    (tmp_path / "outside.md").write_bytes(b"outside the source")
    package = (await rig.call("skills.library.import", {"source": f"local:{tmp_path / 'src'}", "plugin": False}))["package"]
    held = await stored(rig, {"skills": [lazy(package)]})
    assert "docs/unrelated.md" in held and "secrets/key.md" in held  # named by path: in the source, so they come
    assert not any("outside" in name for name in held)


async def test_a_folder_of_a_skill_is_walked_on_demand_when_it_holds_more_than_the_listing_names(rig, tmp_path):
    files, _ = layout("beside", "template")
    files.update({f"actions/extra/{number:03d}.md": b"more" for number in range(90)})
    package = (await rig.call("skills.library.import", {"source": f"local:{write(tmp_path / 'src', files)}"}))["package"]
    await rig.call("skills.library.update", {"key": package["key"], "access": "all"})
    text = rig.service.skill_read(0, "lazy-mode")
    # The listing names its first files and tells where the rest are, by folder.
    assert "and more:" in text and " in actions/" in text
    listed = rig.service.skill_file(0, "lazy-mode", "actions/extra")
    assert listed.startswith("Files in actions/extra/") and "- actions/extra/089.md " in listed
    assert rig.service.skill_file(0, "lazy-mode", "actions/extra/089.md") == "more"
    with pytest.raises(MemberError):
        rig.service.skill_file(0, "lazy-mode", "../outside")

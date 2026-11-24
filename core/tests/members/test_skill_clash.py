"""One skill of a team package can be deleted alone, and a name that is taken says who holds it (#313)."""

import json
import os
import subprocess

import pytest

from raphael_core.protocol import RpcError
from .test_skill_packages import archive, document, upload


def pack(*names, name="tools.zip"):
    return upload(name, archive([(f"{n}/SKILL.md", document(n).encode()) for n in names]))


def skill_id(package, name):
    return next(s["id"] for s in package["skills"] if s["name"] == name)


async def packages(rig):
    return {p["name"]: p for p in (await rig.call("skills.library.list", {}))["packages"]}


async def test_a_taken_name_says_which_package_holds_it_and_whether_it_is_switched_off(rig):
    held = (await rig.call("skills.library.import", pack("tdd", "review")))["package"]
    with pytest.raises(RpcError, match=r'taken: a skill named tdd already exists in the package "tools.zip"$'):
        await rig.call("skills.library.import", {"text": document("tdd")})
    await rig.call("skills.library.update", {"key": held["key"], "skill": {"id": skill_id(held, "tdd"), "enabled": False}})
    with pytest.raises(RpcError, match=r'in the package "tools.zip" \(switched off\)$'):
        await rig.call("skills.library.import", {"text": document("tdd")})
    assert len(await packages(rig)) == 1


async def test_a_package_of_several_skills_imports_all_but_the_taken_ones_and_names_them(rig):
    await rig.call("skills.library.import", pack("tdd", "review"))
    made = await rig.call("skills.library.import", pack("tdd", "lint", "format", name="more.zip"))
    assert made["skipped"] == [{"name": "tdd", "held_by": "tools.zip"}]
    assert sorted(s["name"] for s in made["package"]["skills"]) == ["format", "lint"]
    library = await packages(rig)
    assert sorted(s["name"] for s in library["tools.zip"]["skills"]) == ["review", "tdd"]
    # Nothing is left out when nothing clashes.
    clean = await rig.call("skills.library.import", pack("plan", name="plan.zip"))
    assert "skipped" not in clean


async def test_a_package_whose_every_skill_is_taken_is_refused_naming_the_holder(rig):
    await rig.call("skills.library.import", pack("tdd", "review"))
    with pytest.raises(RpcError, match=r'taken: a skill named (tdd|review) already exists in the package "tools.zip"'):
        await rig.call("skills.library.import", pack("tdd", "review", name="again.zip"))
    assert list(await packages(rig)) == ["tools.zip"]


async def test_one_skill_of_a_package_is_deleted_alone_and_frees_its_name(rig):
    held = (await rig.call("skills.library.import", pack("tdd", "review", "lint")))["package"]
    gone = skill_id(held, "tdd")
    folder = rig.service.capabilities.homes.home(-1) / "skills" / str(gone)
    assert folder.is_dir()
    answer = await rig.call("skills.library.delete", {"key": held["key"], "skill": gone})
    assert answer["deleted"] is True
    assert sorted(s["name"] for s in answer["package"]["skills"]) == ["lint", "review"]
    assert not folder.exists()
    assert sorted(s["name"] for s in (await packages(rig))["tools.zip"]["skills"]) == ["lint", "review"]
    # The name is free for another import, and the rest of the package is untouched.
    again = await rig.call("skills.library.import", {"text": document("tdd")})
    assert "skipped" not in again and again["package"]["skills"][0]["name"] == "tdd"
    assert (rig.service.capabilities.homes.home(-1) / "skills" / str(skill_id(held, "review")) / "SKILL.md").is_file()


async def test_deleting_the_last_skill_of_a_package_removes_the_package(rig):
    held = (await rig.call("skills.library.import", pack("tdd", "review")))["package"]
    first = await rig.call("skills.library.delete", {"key": held["key"], "skill": skill_id(held, "tdd")})
    last = await rig.call("skills.library.delete", {"key": held["key"], "skill": skill_id(first["package"], "review")})
    assert last == {"deleted": True}
    assert not (await rig.call("skills.library.list", {}))["packages"]


@pytest.mark.parametrize("skill", [999999, "1", True])
async def test_deleting_a_skill_that_is_not_in_the_package_changes_nothing(rig, skill):
    held = (await rig.call("skills.library.import", pack("tdd", "review")))["package"]
    other = (await rig.call("skills.library.import", pack("plan", "lint", name="other.zip")))["package"]
    with pytest.raises(RpcError):
        await rig.call("skills.library.delete", {"key": held["key"], "skill": skill})
    with pytest.raises(RpcError, match="not_found"):
        await rig.call("skills.library.delete", {"key": held["key"], "skill": skill_id(other, "plan")})
    library = await packages(rig)
    assert [len(p["skills"]) for p in library.values()] == [2, 2]


def desk(cap, tmp_path, market, extra=()):
    cap.skill_home = tmp_path / "synthetic-home"
    folder = cap.skill_home / f".claude/plugins/cache/{market}/desk/1.0.0"
    files = {".claude-plugin/plugin.json": json.dumps({"name": "desk", "version": "1.0.0"}).encode(),
             "skills/write/SKILL.md": document("write").encode(), "skills/check/SKILL.md": document("check").encode(),
             **{f"skills/{n}/SKILL.md": document(n).encode() for n in extra}}
    for relative, data in files.items():
        path = folder / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return folder


async def test_one_skill_of_a_plugin_is_deleted_alone_with_its_files(rig, tmp_path):
    cap = rig.service.capabilities
    made = (await rig.call("skills.library.import", {"plugin": True, "source": "local:" + str(desk(cap, tmp_path, "market"))}))["package"]
    check = skill_id(made, "check")
    kept = cap.plugin_root(int(made["key"][4:]))
    assert (kept / "skills/check/SKILL.md").is_file()
    answer = await rig.call("skills.library.delete", {"key": made["key"], "skill": check})
    assert [s["name"] for s in answer["package"]["skills"]] == ["write"]
    assert not (kept / "skills/check").exists() and (kept / "skills/write/SKILL.md").is_file()
    assert [s["name"] for s in cap.skills(-1)] == ["write"]


async def test_a_plugin_with_taken_skill_names_imports_the_rest_and_names_each_holder(rig, tmp_path):
    cap = rig.service.capabilities
    first = (await rig.call("skills.library.import", {"plugin": True, "source": "local:" + str(desk(cap, tmp_path, "one"))}))["package"]
    await rig.call("skills.library.update", {"key": first["key"], "skill": {"id": skill_id(first, "write"), "enabled": False}})
    second = desk(cap, tmp_path, "two", extra=("extra",))
    made = await rig.call("skills.library.import", {"plugin": True, "source": "local:" + str(second)})
    assert sorted(made["skipped"], key=lambda s: s["name"]) == [
        {"name": "desk:check", "held_by": "desk"}, {"name": "desk:write", "held_by": "desk"}]
    assert [s["name"] for s in made["package"]["skills"]] == ["extra"]
    root = cap.plugin_root(int(made["package"]["key"][4:]))
    assert (root / "skills/extra/SKILL.md").is_file() and not (root / "skills/write").exists()
    assert len((await rig.call("skills.library.list", {}))["packages"]) == 2
    # Every skill taken: the plugin is refused and the holder is named.
    third = desk(cap, tmp_path, "three")
    with pytest.raises(RpcError, match=r'taken: a skill named desk:\w+ already exists in the package "desk"'):
        await rig.call("skills.library.import", {"plugin": True, "source": "local:" + str(third)})
    assert len((await rig.call("skills.library.list", {}))["packages"]) == 2

async def test_a_package_that_loses_skills_to_taken_names_stays_closed_like_a_package(rig):
    # A single skill is open to the whole team; a package is not, even when taken names leave it one skill (#313).
    single = (await rig.call("skills.library.import", {"text": document("tdd")}))["package"]
    assert single["access"] == "all"
    made = await rig.call("skills.library.import", pack("tdd", "lint", name="more.zip"))
    assert made["skipped"] == [{"name": "tdd", "held_by": "tdd"}]
    assert [s["name"] for s in made["package"]["skills"]] == ["lint"]
    assert made["package"]["access"] == []
    assert (await packages(rig))["more.zip"]["access"] == []
    # Named access is still honoured.
    named = await rig.call("skills.library.import", {**pack("tdd", "plan", name="named.zip"), "access": "all"})
    assert named["package"]["access"] == "all"


def plugin_at(cap, tmp_path, market, files, name="desk"):
    """An installed plugin folder holding `files` (path -> text) beside its manifest."""
    cap.skill_home = tmp_path / "synthetic-home"
    folder = cap.skill_home / f".claude/plugins/cache/{market}/{name}/1.0.0"
    for relative, text in {".claude-plugin/plugin.json": json.dumps({"name": name, "version": "1.0.0"}), **files}.items():
        path = folder / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return "local:" + str(folder)


async def test_a_plugin_that_loses_skills_to_taken_names_stays_closed_like_a_package(rig, tmp_path):
    cap = rig.service.capabilities
    first = (await rig.call("skills.library.import", {"plugin": True, "source": "local:" + str(desk(cap, tmp_path, "one"))}))["package"]
    assert first["access"] == []
    second = desk(cap, tmp_path, "two", extra=("extra",))
    made = await rig.call("skills.library.import", {"plugin": True, "source": "local:" + str(second)})
    assert len(made["skipped"]) == 2
    assert [s["name"] for s in made["package"]["skills"]] == ["extra"]
    assert made["package"]["access"] == []
    # A plugin that really is one skill is still open to all.
    solo = plugin_at(cap, tmp_path, "solo", {"skills/only/SKILL.md": document("only")}, name="solo")
    assert (await rig.call("skills.library.import", {"plugin": True, "source": solo}))["package"]["access"] == "all"


NESTED = {"skills/outer/SKILL.md": document("outer"), "skills/outer/notes.md": "outer notes",
          "skills/outer/inner/SKILL.md": document("inner"), "skills/outer/inner/data.txt": "inner data"}


async def test_deleting_a_skill_keeps_the_skill_nested_in_its_folder_whole(rig, tmp_path):
    cap = rig.service.capabilities
    made = (await rig.call("skills.library.import", {"plugin": True, "source": plugin_at(cap, tmp_path, "m", NESTED)}))["package"]
    root = cap.plugin_root(int(made["key"][4:]))
    answer = await rig.call("skills.library.delete", {"key": made["key"], "skill": skill_id(made, "outer")})
    assert [s["name"] for s in answer["package"]["skills"]] == ["inner"]
    assert not (root / "skills/outer/SKILL.md").exists() and not (root / "skills/outer/notes.md").exists()
    assert (root / "skills/outer/inner/SKILL.md").is_file() and (root / "skills/outer/inner/data.txt").read_text() == "inner data"
    assert [s["name"] for s in cap.skills(-1)] == ["inner"]
    # The nested skill alone can be deleted too, and takes only its own folder.
    again = (await rig.call("skills.library.import", {"plugin": True, "source": plugin_at(cap, tmp_path, "n", NESTED, name="desk2")}))["package"]
    other = cap.plugin_root(int(again["key"][4:]))
    left = await rig.call("skills.library.delete", {"key": again["key"], "skill": skill_id(again, "inner")})
    assert [s["name"] for s in left["package"]["skills"]] == ["outer"]
    assert (other / "skills/outer/SKILL.md").is_file() and (other / "skills/outer/notes.md").is_file()
    assert not (other / "skills/outer/inner").exists()


async def test_a_skill_whose_folder_is_gone_from_the_disk_can_still_be_deleted(rig, tmp_path):
    """Removed by hand, its folder has nothing left to move: the record goes all the same."""
    import shutil
    cap = rig.service.capabilities
    made = (await rig.call("skills.library.import", {"plugin": True, "source": plugin_at(cap, tmp_path, "g", NESTED)}))["package"]
    root = cap.plugin_root(int(made["key"][4:]))
    shutil.rmtree(root / "skills/outer")
    answer = await rig.call("skills.library.delete", {"key": made["key"], "skill": skill_id(made, "outer")})
    assert [s["name"] for s in answer["package"]["skills"]] == ["inner"]


async def test_a_skipped_skill_does_not_take_the_files_of_the_skill_nested_in_it(rig, tmp_path):
    cap = rig.service.capabilities
    await rig.call("skills.library.import", {"plugin": True, "source": plugin_at(cap, tmp_path, "m", {"skills/outer/SKILL.md": document("outer")})})
    made = await rig.call("skills.library.import", {"plugin": True, "source": plugin_at(cap, tmp_path, "n", NESTED)})
    assert made["skipped"] == [{"name": "desk:outer", "held_by": "desk"}]
    assert [s["name"] for s in made["package"]["skills"]] == ["inner"]
    root = cap.plugin_root(int(made["package"]["key"][4:]))
    assert not (root / "skills/outer/SKILL.md").exists() and not (root / "skills/outer/notes.md").exists()
    assert (root / "skills/outer/inner/SKILL.md").is_file() and (root / "skills/outer/inner/data.txt").read_text() == "inner data"
    assert made["package"]["access"] == []


# A GitHub plugin may record a skill as skills/Outer and the skill nested in it as skills/outer/inner: both pass the import
# checks, and Windows keeps them in one folder tree, so folders are compared ignoring case (#313).
MIXED_CASE = {".claude-plugin/plugin.json": json.dumps({"name": "desk", "version": "1.0.0"}),
              "skills/Outer/SKILL.md": document("outer"), "skills/Outer/notes.md": "outer notes",
              "skills/Outer/inner/data.txt": "inner data",
              "skills/outer/inner/SKILL.md": document("inner"), "skills/outer/inner/more.txt": "inner more"}


def install_mixed_case(cap):
    return cap.install_set("github:owner/desk", {k: v.encode() for k, v in MIXED_CASE.items()}, marketplace="market")


def readable(root, relative):
    """The text at `relative` under `root`, whichever case the folder names were created in."""
    here = root
    for part in relative.split("/"):
        here = next((p for p in here.iterdir() if p.name.casefold() == part.casefold()), here / part)
    return here.read_text() if here.is_file() else None


async def test_deleting_a_skill_keeps_a_nested_skill_whose_folder_differs_only_in_case(rig):
    cap = rig.service.capabilities
    plugin = install_mixed_case(cap)
    root = cap.plugin_root(plugin["id"])
    made = (await packages(rig))["desk"]
    answer = await rig.call("skills.library.delete", {"key": made["key"], "skill": skill_id(made, "outer")})
    assert [s["name"] for s in answer["package"]["skills"]] == ["inner"]
    assert readable(root, "skills/outer/notes.md") is None and readable(root, "skills/outer/SKILL.md") is None
    assert readable(root, "skills/outer/inner/SKILL.md") is not None
    assert readable(root, "skills/outer/inner/data.txt") == "inner data"
    assert readable(root, "skills/outer/inner/more.txt") == "inner more"
    assert [s["name"] for s in cap.skills(-1)] == ["inner"]


async def test_a_skipped_skill_keeps_the_files_of_a_nested_skill_whose_folder_differs_only_in_case(rig, tmp_path):
    cap = rig.service.capabilities
    await rig.call("skills.library.import", {"plugin": True, "source": plugin_at(cap, tmp_path, "m", {"skills/outer/SKILL.md": document("outer")})})
    made = install_mixed_case(cap)
    assert made["skipped"] == [{"name": "desk:outer", "held_by": "desk"}]
    # The first plugin still holds outer; the second one brought only inner.
    assert sorted(s["name"] for s in cap.skills(-1)) == ["inner", "outer"]
    root = cap.plugin_root(made["id"])
    assert readable(root, "skills/outer/SKILL.md") is None and readable(root, "skills/outer/notes.md") is None
    assert readable(root, "skills/outer/inner/SKILL.md") is not None
    assert readable(root, "skills/outer/inner/data.txt") == "inner data"
    assert readable(root, "skills/outer/inner/more.txt") == "inner more"


def link_to(link, target, kind):
    """Make `link` point at the folder `target` as a symlink or, on Windows, a junction; skip when the system refuses."""
    if kind == "symlink":
        try:
            os.symlink(target, link, target_is_directory=True)
        except (OSError, NotImplementedError) as error:
            pytest.skip(f"symlinks are not available here: {error}")
    elif os.name != "nt":
        pytest.skip("junctions exist only on Windows")
    else:
        done = subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], capture_output=True, text=True)
        if done.returncode:
            pytest.skip(f"junctions are not available here: {done.stdout}{done.stderr}")


@pytest.mark.parametrize("kind", ["symlink", "junction"])
async def test_deleting_a_skill_never_follows_a_link_inside_its_folder(rig, tmp_path, kind):
    cap = rig.service.capabilities
    made = (await rig.call("skills.library.import", {"plugin": True, "source": plugin_at(cap, tmp_path, "m", NESTED)}))["package"]
    root = cap.plugin_root(int(made["key"][4:]))
    outside = tmp_path / "outside"
    (outside / "deep").mkdir(parents=True)
    (outside / "keep.txt").write_text("keep")
    (outside / "deep" / "keep.txt").write_text("keep deep")
    link_to(root / "skills/outer/shortcut", outside, kind)
    link_to(root / "skills/outer/inner/own-shortcut", outside, kind)
    answer = await rig.call("skills.library.delete", {"key": made["key"], "skill": skill_id(made, "outer")})
    assert [s["name"] for s in answer["package"]["skills"]] == ["inner"]
    # What the link pointed at is untouched, and the link of the deleted skill is gone with it.
    assert (outside / "keep.txt").read_text() == "keep" and (outside / "deep" / "keep.txt").read_text() == "keep deep"
    assert not os.path.lexists(root / "skills/outer/shortcut") and not (root / "skills/outer/notes.md").exists()
    # The nested skill keeps everything, its own link included.
    assert (root / "skills/outer/inner/data.txt").read_text() == "inner data"
    assert os.path.lexists(root / "skills/outer/inner/own-shortcut")

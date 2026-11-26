"""An ordinary skill or plugin is never refused for its size, its depth or its files; the one guard that stays names what it
stopped (#355)."""

import json
import re

import pytest

from raphael_core.members import skill_library, skill_sources
from raphael_core.protocol import RpcError
from .test_skill_packages import archive, document, upload

NL = chr(10)


def detail(error):
    """The cause the window says in words: the object the core appends to its message."""
    found = re.search(r"\[\[(\{.*\})\]\]$", str(error.value), re.S)
    return json.loads(found[1]) if found else {}


def skill_folder(root, name="big", files=None):
    folder = root / name
    folder.mkdir(parents=True)
    (folder / "SKILL.md").write_text(document(name), encoding="utf-8")
    for relative, data in (files or {}).items():
        path = folder / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data if isinstance(data, bytes) else data.encode())
    return folder


async def stored(rig, package):
    shared = rig.service.capabilities.homes.home(-1) / "skills"
    return {path.relative_to(shared / str(skill["id"])).as_posix(): path.stat().st_size
            for skill in package["skills"] for path in (shared / str(skill["id"])).rglob("*")
            if path.is_file() and path.name != ".raphael-source.json"}


async def test_a_skill_folder_beyond_the_old_limits_comes_whole(rig, tmp_path):
    folder = skill_folder(tmp_path, "heavy", {"assets/model/weights": b"\0" * (40 * 1024 * 1024)})
    for number in range(2500):
        (folder / "references").mkdir(exist_ok=True)
        (folder / "references" / f"note-{number}.md").write_text("n", encoding="utf-8")
    package = (await rig.call("skills.library.import", {"source": f"local:{folder}"}))["package"]
    files = await stored(rig, package)
    assert files["assets/model/weights"] == 40 * 1024 * 1024 and len(files) > 2500


async def test_a_zip_with_a_large_file_and_deep_folders_comes_whole(rig):
    deep = "/".join(f"d{number}" for number in range(14)) + "/leaf.txt"
    data = archive([("big/SKILL.md", document("big").encode()), ("big/assets/video.bin", b"\0" * (40 * 1024 * 1024)),
                    (f"big/{deep}", b"leaf")])
    package = (await rig.call("skills.library.import", upload("big.zip", data)))["package"]
    files = await stored(rig, package)
    assert files["assets/video.bin"] == 40 * 1024 * 1024 and files[deep] == 4


async def test_a_long_description_is_kept_cut_and_never_refuses_the_skill(rig):
    text = "---\nname: wordy\ndescription: " + "word " * 600 + "\n---\nBody"
    package = (await rig.call("skills.library.import", {"text": text}))["package"]
    assert 100 < len(package["skills"][0]["description"]) <= 1000


@pytest.mark.parametrize("kind", ["folder", "zip"])
async def test_generated_and_system_folders_are_not_part_of_a_skill(rig, tmp_path, kind):
    junk = {"node_modules/pkg/index.js": b"x", ".git/HEAD": b"ref", "__pycache__/a.pyc": b"x", ".DS_Store": b"x",
            "scripts/__pycache__/b.pyc": b"x", "scripts/run.py": b"print(1)"}
    if kind == "folder":
        source = {"source": f"local:{skill_folder(tmp_path, 'tidy', junk)}"}
    else:
        source = upload("tidy.zip", archive([("tidy/SKILL.md", document("tidy").encode()),
                                              ("__MACOSX/tidy/._SKILL.md", b"x"), *[(f"tidy/{k}", v) for k, v in junk.items()]]))
    package = (await rig.call("skills.library.import", source))["package"]
    assert sorted(await stored(rig, package)) == ["SKILL.md", "scripts/run.py"]


@pytest.mark.parametrize("kind", ["folder", "zip", "tgz"])
async def test_a_skill_inside_another_skills_folder_is_a_skill_of_its_own(rig, tmp_path, kind):
    entries = [("outer/SKILL.md", document("outer").encode()), ("outer/notes.md", b"outer notes"),
               ("outer/examples/inner/SKILL.md", document("inner").encode()), ("outer/examples/inner/a.md", b"inner file")]
    if kind == "folder":
        for name, data in entries:
            path = tmp_path / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        source = {"source": f"local:{tmp_path / 'outer'}"}
    else:
        source = upload(f"pair.{kind}", archive(entries, kind == "tgz"))
    package = (await rig.call("skills.library.import", source))["package"]
    assert sorted(s["name"] for s in package["skills"]) == ["inner", "outer"]
    shared = rig.service.capabilities.homes.home(-1) / "skills"
    by_name = {s["name"]: sorted(p.relative_to(shared / str(s["id"])).as_posix()
                                 for p in (shared / str(s["id"])).rglob("*") if p.is_file() and p.name != ".raphael-source.json")
               for s in package["skills"]}
    assert by_name == {"outer": ["SKILL.md", "notes.md"], "inner": ["SKILL.md", "a.md"]}


async def test_the_one_guard_names_the_file_its_size_and_the_limit(rig, tmp_path, monkeypatch):
    monkeypatch.setattr(skill_sources, "MAX_PACKAGE_BYTES", 5000)
    monkeypatch.setattr(skill_library, "MAX_PACKAGE_BYTES", 5000)
    folder = skill_folder(tmp_path, "huge", {"assets/movie": b"\0" * 20000})
    with pytest.raises(RpcError) as error:
        await rig.call("skills.library.import", {"source": f"local:{folder}"})
    assert "size:" in str(error.value)
    found = detail(error)
    assert found["reason"] == "package" and found["limit"] == 5000 and found["size"] >= 20000 and found["file"].endswith("assets/movie")


async def test_a_skill_document_over_its_limit_names_the_file_its_size_and_the_limit(rig):
    text = document("longform") + "\n" + "x" * (skill_sources.MAX_SKILL_BYTES + 10)
    with pytest.raises(RpcError) as error:
        await rig.call("skills.library.import", upload("longform.zip", archive([("longform/SKILL.md", text.encode())])))
    found = detail(error)
    assert found["reason"] == "file" and found["limit"] == skill_sources.MAX_SKILL_BYTES and found["size"] > found["limit"]
    assert found["file"].endswith("SKILL.md")


@pytest.mark.parametrize("text,expected", [
    ("---" + NL + "name: bare" + NL + "license: MIT" + NL + "---" + NL + "Body", {"problem": "no_description", "line": 4}),
    ("---" + NL + "name: blank" + NL + "description:" + NL + "---" + NL + "Body", {"problem": "no_description", "line": 3}),
    ("---" + NL + "name: late" + NL + "Body without a closing line", {"problem": "unclosed", "line": 1}),
    ("Just text, no front matter", {"problem": "none", "line": 1}),
])
async def test_a_document_without_its_description_names_the_problem_and_the_line(rig, text, expected):
    with pytest.raises(RpcError) as error:
        await rig.call("skills.library.import", {"text": text})
    assert "skill:" in str(error.value) and detail(error) == {"reason": "front_matter", "file": "SKILL.md", **expected}

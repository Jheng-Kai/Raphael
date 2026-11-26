"""Skills that belong together become one plugin without a question to the owner, and a source stays what it is (#355)."""

import pytest

from .github_fake import FakeGitHub
from .test_skill_import_limits import stored
from .test_skill_packages import archive, document, upload


async def packages(rig):
    return {p["name"]: p for p in (await rig.call("skills.library.list", {}))["packages"]}


async def paste(rig, name):
    return await rig.call("skills.library.import", {"text": document(name)})


async def test_skills_that_share_a_name_prefix_become_one_plugin_as_they_are_imported(rig):
    await paste(rig, "pdf-read")
    assert sorted(await packages(rig)) == ["pdf-read"]
    made = await paste(rig, "pdf-fill")
    assert sorted(await packages(rig)) == ["pdf"] and made["package"]["name"] == "pdf"
    await paste(rig, "pdf-merge")
    group = (await packages(rig))["pdf"]
    assert sorted(s["name"] for s in group["skills"]) == ["pdf-fill", "pdf-merge", "pdf-read"]
    assert group["kind"] == "pack" and len(group["skills"]) == 3


async def test_unrelated_names_stay_separate_skills(rig):
    for name in ("pdf-read", "docx-read", "tdd", "review", "skill-one", "skill-two", "the-first", "the-second", "ab-one", "ab-two"):
        await paste(rig, name)
    assert sorted(await packages(rig)) == ["ab-one", "ab-two", "docx-read", "pdf-read", "review", "skill-one", "skill-two",
                                           "tdd", "the-first", "the-second"]


async def test_a_group_keeps_who_may_use_the_skill_it_grew_from(rig):
    member = (await rig.call("members.create", {"name": "Ada"}))["member"]["id"]
    first = (await paste(rig, "pdf-read"))["package"]
    await rig.call("skills.library.update", {"key": first["key"], "access": [member]})
    await paste(rig, "pdf-fill")
    group = (await packages(rig))["pdf"]
    assert group["access"] == [member] and group["key"] == first["key"]
    assert sorted(s["name"] for s in (await rig.call("members.skills.list", {"member_id": member}))["skills"]) == ["pdf-fill", "pdf-read"]


async def test_a_source_with_several_skills_is_one_package_and_is_never_joined_or_split(rig):
    data = archive([(f"{n}/SKILL.md", document(n).encode()) for n in ("pdf-a", "pdf-b", "docx-a")])
    made = (await rig.call("skills.library.import", upload("office.zip", data)))["package"]
    await paste(rig, "pdf-c")
    library = await packages(rig)
    assert sorted(library) == ["office.zip", "pdf-c"] and len(library["office.zip"]["skills"]) == 3
    assert library["office.zip"]["key"] == made["key"]


async def test_a_plugin_set_is_never_joined(rig, tmp_path):
    import json

    folder = tmp_path / "desk"
    for name, data in {".claude-plugin/plugin.json": json.dumps({"name": "pdf", "version": "1"}).encode(),
                       "skills/pdf-one/SKILL.md": document("pdf-one").encode()}.items():
        (folder / name).parent.mkdir(parents=True, exist_ok=True)
        (folder / name).write_bytes(data)
    await rig.call("members.skills.import", {"member_id": 0, "shared": True, "plugin": True, "source": f"local:{folder}"})
    await paste(rig, "pdf-two")
    assert sorted(await packages(rig)) == ["pdf", "pdf-two"]


async def test_the_skills_of_a_group_are_deleted_one_by_one_and_the_group_goes_with_the_last(rig):
    await paste(rig, "pdf-read")
    await paste(rig, "pdf-fill")
    group = (await packages(rig))["pdf"]
    first, second = group["skills"]
    left = (await rig.call("skills.library.delete", {"key": group["key"], "skill": first["id"]}))["package"]
    assert [s["id"] for s in left["skills"]] == [second["id"]]
    assert (await rig.call("skills.library.delete", {"key": group["key"], "skill": second["id"]}))["deleted"] is True
    assert await packages(rig) == {}


async def test_the_skills_of_a_group_come_from_their_own_sources_and_are_updated_from_each(rig, monkeypatch):
    github = FakeGitHub(monkeypatch)
    github.add("owner/skills", {"skills/pdf-read/SKILL.md": document("pdf-read").encode(), "skills/pdf-read/a.md": b"a1",
                                "skills/pdf-fill/SKILL.md": document("pdf-fill").encode(), "skills/pdf-fill/b.md": b"b1"})
    await rig.call("skills.library.import", {"source": "https://skills.sh/owner/skills/pdf-read"})
    await rig.call("skills.library.import", {"source": "https://skills.sh/owner/skills/pdf-fill"})
    group = (await packages(rig))["pdf"]
    assert sorted(s["name"] for s in group["skills"]) == ["pdf-fill", "pdf-read"] and group["updatable"] is True
    files = github.repos["owner/skills"]["files"]
    files["skills/pdf-read/a.md"], files["skills/pdf-fill/b.md"] = b"a22", b"b22"
    github.add("owner/skills", files)
    updated = (await rig.call("skills.library.update", {"key": group["key"], "refresh": True}))["package"]
    sizes = {name: size for skill in updated["skills"] for name, size in (await stored(rig, {"skills": [skill]})).items() if name != "SKILL.md"}
    assert updated["name"] == "pdf" and sorted(sizes.items()) == [("a.md", 3), ("b.md", 3)]
    assert sorted(s["name"] for s in updated["skills"]) == ["pdf-fill", "pdf-read"]


async def test_a_group_of_pasted_skills_has_no_source_to_update_from(rig):
    await paste(rig, "pdf-read")
    await paste(rig, "pdf-fill")
    assert (await packages(rig))["pdf"]["updatable"] is False


@pytest.mark.parametrize("names", [("pdf-read", "pdf-read")])
async def test_the_same_skill_twice_is_a_clash_not_a_group(rig, names):
    from raphael_core.protocol import RpcError

    await paste(rig, names[0])
    with pytest.raises(RpcError, match="taken"):
        await paste(rig, names[1])

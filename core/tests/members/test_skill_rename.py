"""A clash names the skill and the package on both sides, and one skill of a package is renamed or deleted alone (#355)."""

import pytest

from raphael_core.protocol import RpcError
from .github_fake import FakeGitHub
from .test_skill_clash import pack, packages, skill_id
from .test_skill_import_limits import detail
from .test_skill_packages import document


async def test_a_clash_of_a_single_skill_names_both_skills_and_the_package_that_holds_one(rig):
    await rig.call("skills.library.import", pack("tdd", "review", name="tools.zip"))
    with pytest.raises(RpcError) as error:
        await rig.call("skills.library.import", {"text": document("tdd")})
    assert detail(error) == {"reason": "clash", "skill": "tdd", "held_by": "tools.zip", "off": False, "incoming": ""}


async def test_a_clash_of_a_package_names_the_package_it_brings_too(rig):
    first = (await rig.call("skills.library.import", pack("tdd", "review", name="tools.zip")))["package"]
    await rig.call("skills.library.update", {"key": first["key"], "skill": {"id": skill_id(first, "review"), "enabled": False}})
    with pytest.raises(RpcError) as error:
        await rig.call("skills.library.import", pack("tdd", "review", name="more.zip"))
    found = detail(error)
    assert found == {"reason": "clash", "skill": "review", "held_by": "tools.zip", "off": True, "incoming": "more.zip"}
    assert 'in the package "tools.zip" (switched off), and the package "more.zip" has one too' in str(error.value)


async def test_a_refresh_that_would_take_a_name_names_both_packages(rig, monkeypatch):
    github = FakeGitHub(monkeypatch)
    github.add("owner/skills", {"skills/alpha/SKILL.md": document("alpha").encode()})
    held = (await rig.call("skills.library.import", pack("beta", name="held.zip")))["package"]
    made = (await rig.call("skills.library.import", {"source": "owner/skills"}))["package"]
    assert (held["name"], made["name"]) == ("beta", "alpha")
    github.add("owner/skills", {"skills/alpha/SKILL.md": document("alpha").encode(), "skills/beta/SKILL.md": document("beta").encode()})
    with pytest.raises(RpcError) as error:
        await rig.call("skills.library.update", {"key": made["key"], "refresh": True})
    assert detail(error) == {"reason": "clash", "skill": "beta", "held_by": "beta", "off": False, "incoming": "alpha"}


async def read(rig, skill):
    return (await rig.call("members.skills.read", {"member_id": 0, "shared": True, "id": skill["id"]}))["text"]


async def test_one_skill_of_a_package_is_renamed_and_its_old_name_is_free(rig):
    first = (await rig.call("skills.library.import", pack("tdd", "review", name="tools.zip")))["package"]
    renamed = (await rig.call("skills.library.update", {"key": first["key"], "rename": {"id": skill_id(first, "tdd"), "name": "My TDD"}}))["package"]
    assert sorted(s["name"] for s in renamed["skills"]) == ["my-tdd", "review"]
    assert "name: my-tdd" in await read(rig, next(s for s in renamed["skills"] if s["name"] == "my-tdd"))
    # The name it had is free for the package that wanted it.
    other = (await rig.call("skills.library.import", pack("tdd", "lint", name="more.zip")))["package"]
    assert sorted(s["name"] for s in other["skills"]) == ["lint", "tdd"] and "skipped" not in other


async def test_a_rename_to_a_name_that_is_taken_says_who_holds_it(rig):
    first = (await rig.call("skills.library.import", pack("tdd", "review", name="tools.zip")))["package"]
    with pytest.raises(RpcError) as error:
        await rig.call("skills.library.update", {"key": first["key"], "rename": {"id": skill_id(first, "tdd"), "name": "Review"}})
    assert detail(error)["reason"] == "clash" and detail(error)["held_by"] == "tools.zip" and detail(error)["skill"] == "review"
    assert sorted(s["name"] for s in (await packages(rig))["tools.zip"]["skills"]) == ["review", "tdd"]


@pytest.mark.parametrize("params,words", [
    ({"id": 9999, "name": "x-y"}, "not_found: "), ({"id": "one", "name": "x-y"}, "Invalid params: give the skill"),
    ({"name": "x-y"}, "Invalid params: give the skill"), ({"id": 1, "name": ""}, "name: "), ({"id": 1, "name": 5}, "Invalid params: give the skill"),
])
async def test_a_rename_that_cannot_be_made_says_why(rig, params, words):
    first = (await rig.call("skills.library.import", pack("tdd", "review", name="tools.zip")))["package"]
    if params.get("id") == 1:
        params = {**params, "id": skill_id(first, "tdd")}
    with pytest.raises(RpcError) as error:
        await rig.call("skills.library.update", {"key": first["key"], "rename": params})
    assert words in error.value.message
    assert sorted(s["name"] for s in (await packages(rig))["tools.zip"]["skills"]) == ["review", "tdd"]


async def test_a_renamed_skill_keeps_its_name_when_its_package_is_updated(rig, monkeypatch):
    github = FakeGitHub(monkeypatch)
    github.add("owner/skills", {"skills/alpha/SKILL.md": document("alpha").encode(), "skills/alpha/a.md": b"v1",
                                "skills/beta/SKILL.md": document("beta").encode()})
    made = (await rig.call("skills.library.import", {"source": "owner/skills"}))["package"]
    mine = skill_id(made, "alpha")
    await rig.call("skills.library.update", {"key": made["key"], "rename": {"id": mine, "name": "my-alpha"}})
    github.add("owner/skills", {"skills/alpha/SKILL.md": document("alpha").encode(), "skills/alpha/a.md": b"v22",
                                "skills/beta/SKILL.md": document("beta").encode()})
    updated = (await rig.call("skills.library.update", {"key": made["key"], "refresh": True}))["package"]
    assert sorted(s["name"] for s in updated["skills"]) == ["beta", "my-alpha"] and skill_id(updated, "my-alpha") == mine
    assert "name: my-alpha" in await read(rig, next(s for s in updated["skills"] if s["id"] == mine))


async def test_a_plugins_skill_is_not_renamed_it_is_deleted(rig, tmp_path):
    import json

    folder = tmp_path / "desk"
    for name, data in {".claude-plugin/plugin.json": json.dumps({"name": "desk", "version": "1"}).encode(),
                       "skills/write/SKILL.md": document("write").encode()}.items():
        (folder / name).parent.mkdir(parents=True, exist_ok=True)
        (folder / name).write_bytes(data)
    installed = await rig.call("members.skills.import", {"member_id": 0, "shared": True, "plugin": True, "source": f"local:{folder}"})
    package = (await packages(rig))["desk"]
    with pytest.raises(RpcError) as error:
        await rig.call("skills.library.update", {"key": package["key"], "rename": {"id": package["skills"][0]["id"], "name": "mine"}})
    assert error.value.message.startswith("Invalid params: scope: ") and installed["set"]["name"] == "desk"

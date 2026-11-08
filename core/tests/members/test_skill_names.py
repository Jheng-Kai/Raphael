"""New skill names are slugs; existing commands and plugin namespaces stay usable."""

import json

import pytest

from raphael_core.members.store import MemberError
from raphael_core.protocol import RpcError
from .test_skill_growth import DOCUMENT


INVALID = ["台中天氣與空品日報", "daily weather", "Daily-weather", "daily_weather", "1weather",
           "daily--weather", "a", "weather-", "a" * 49, "a" * 101]


@pytest.mark.parametrize("name", ["taichung-weather-air", "a1", "a" * 48])
@pytest.mark.parametrize("member", [False, True])
async def test_each_member_learns_a_slug_with_an_owner_language_description(rig, name, member):
    owner = (await rig.call("members.create", {"name": "Writer"}))["member"]["id"] if member else 0
    text = DOCUMENT.replace("research-summary", name).replace("Summarize research with checked sources", "台中天氣與空品日報：查核來源")
    skill = rig.service.learn_skill(owner, {"text": text})
    assert skill["name"] == skill["slash_name"] == name
    assert skill["description"] == "台中天氣與空品日報：查核來源"
    expanded = rig.service.capabilities.expand(owner, "/" + name + " today")
    assert text in json.loads(expanded.rsplit("\n", 1)[-1])["document"]


@pytest.mark.parametrize("name", INVALID)
async def test_learning_refuses_non_slugs_without_writes_and_with_value_free_guidance(rig, name):
    cap = rig.service.capabilities
    with pytest.raises(MemberError, match="name must be a short English slug") as caught:
        rig.service.learn_skill(0, {"text": DOCUMENT.replace("research-summary", name)})
    from raphael_core.members.skill_names import SKILL_NAME_RULE
    assert str(caught.value) == SKILL_NAME_RULE
    assert cap.skills(0) == []
    assert not list(cap.homes.home(0).glob("skills/*/SKILL.md"))


@pytest.mark.parametrize("path", ["remote", "local", "recipe", "plugin-set"])
@pytest.mark.parametrize("name", ["台中天氣與空品日報", "weather_report", "a" * 49, "a" * 101])
async def test_every_import_writer_refuses_new_non_slugs(rig, tmp_path, monkeypatch, path, name):
    cap = rig.service.capabilities
    text = DOCUMENT.replace("research-summary", name)
    with pytest.raises((MemberError, RpcError), match="name must be a short English slug"):
        if path == "remote":
            async def download(source):
                return [(source, text)]
            monkeypatch.setattr("raphael_core.members.service.download_skills", download)
            await rig.call("members.skills.import", {"member_id": 0, "source": "owner/repo"})
        elif path == "local":
            cap.skill_home = tmp_path / "synthetic-home"
            folder = cap.skill_home / ".codex/skills/weather"
            folder.mkdir(parents=True)
            (folder / "SKILL.md").write_text(text, encoding="utf-8")
            cap.import_local(0, "local:" + str(folder))
        elif path == "recipe":
            cap.keep_recipe(0, text, {})
        else:
            from .test_skill_plugins import package
            files = package()
            files["skills/write/SKILL.md"] = text.encode("utf-8")
            cap.install_set("local:" + str(tmp_path / "desk/1.0.0"), files)
    assert cap.skills(0) == [] and cap.plugin_sets() == []


@pytest.mark.parametrize("name", ["台中天氣與空品日報", "Old Weather", "weather_report", "1weather"])
async def test_existing_non_slug_can_toggle_run_and_edit_without_a_rename(rig, name):
    cap = rig.service.capabilities
    text = DOCUMENT.replace("research-summary", name)
    with rig.conn:
        identifier = rig.conn.execute("INSERT INTO member_skills(member_id,name,description,source) VALUES (0,?,?,?)",
            (name, "Existing skill", "learned")).lastrowid
    cap.homes.keep(0, f"skills/{identifier}/SKILL.md", text)
    cap._mirror(0)
    original = cap.skills(0)[0]
    command = "/" + original["slash_name"] + " today"
    assert text in json.loads(cap.expand(0, command).rsplit("\n", 1)[-1])["document"]
    await rig.call("members.skills.update", {"member_id": 0, "id": identifier, "enabled": False})
    assert cap.expand(0, command) == command
    await rig.call("members.skills.update", {"member_id": 0, "id": identifier, "enabled": True})
    edited = text + "\nAn owner edit."
    await rig.call("members.skills.update", {"member_id": 0, "id": identifier, "text": edited,
                                            "expected_hash": cap._skill(0, identifier)["revision"]})
    learned = rig.service.learn_skill(0, {"id": identifier, "text": edited + "\nA reusable check.",
                                        "expected_hash": cap._skill(0, identifier)["revision"]})
    assert learned["name"] == name and learned["slash_name"] == original["slash_name"]
    assert "A reusable check." in cap.expand(0, command)
    with pytest.raises(MemberError, match="name must be a short English slug"):
        cap.rewrite_skill(0, identifier, edited.replace(name, "Another title"))
    assert cap._skill(0, identifier)["name"] == name


async def test_plugin_skill_keeps_its_namespace_and_rejects_an_invalid_update_atomically(rig, tmp_path):
    from .test_skill_plugins import local, package
    cap = rig.service.capabilities
    folder = local(cap, tmp_path)
    installed = await cap.import_plugin("local:" + str(folder))
    cap.keep_skill(0, "owner", DOCUMENT.replace("research-summary", "write"))
    plugin = next(s for s in cap.skills(0) if s.get("plugin") == "desk" and s["name"] == "write")
    assert plugin["slash_name"] == "desk:write"
    assert rig.conn.execute("SELECT name FROM member_skills WHERE id=?", (plugin["id"],)).fetchone()[0] == "desk:write"
    before = cap._path(0, plugin["id"]).read_bytes()
    files = package("2.0.0")
    files["skills/write/SKILL.md"] = DOCUMENT.replace("research-summary", "Weather Report").encode()
    with pytest.raises(MemberError, match="name must be a short English slug"):
        cap.install_set("local:" + str(folder), files)
    assert cap.plugin_sets()[0]["id"] == installed["id"] and cap.plugin_sets()[0]["version"] == "1.0.0"
    assert cap._path(0, plugin["id"]).read_bytes() == before


async def test_existing_plugin_non_slug_can_refresh_without_renaming(rig, tmp_path):
    from .test_skill_plugins import local, package
    cap = rig.service.capabilities
    folder = local(cap, tmp_path)
    installed = await cap.import_plugin("local:" + str(folder))
    skill = next(s for s in cap.skills(0) if s["name"] == "write")
    old_text = DOCUMENT.replace("research-summary", "Old Weather")
    with rig.conn:
        rig.conn.execute("UPDATE member_skills SET name=? WHERE id=?", ("desk:Old Weather", skill["id"]))
    cap._path(0, skill["id"]).write_text(old_text, encoding="utf-8")
    cap._mirror(-1)
    original = cap._skill(0, skill["id"])
    files = package("2.0.0")
    files["skills/write/SKILL.md"] = (old_text + "\nA refreshed check.").encode()
    refreshed = cap.install_set("local:" + str(folder), files)
    assert refreshed["id"] == installed["id"] and refreshed["version"] == "2.0.0"
    current = cap._skill(0, skill["id"])
    assert current["name"] == "Old Weather" and current["slash_name"] == original["slash_name"]
    assert "A refreshed check." in cap.expand(0, "/" + current["slash_name"])


async def test_existing_local_non_slug_can_reimport_without_renaming(rig, tmp_path):
    from .test_skill_library import installed
    cap = rig.service.capabilities
    cap.skill_home = tmp_path / "synthetic-home"
    folder = installed(cap.skill_home)
    source = "local:" + str(folder)
    skill = cap.import_local(0, source)
    old_text = DOCUMENT.replace("research-summary", "Old Weather")
    with rig.conn:
        rig.conn.execute("UPDATE member_skills SET name=? WHERE id=?", ("Old Weather", skill["id"]))
    cap._path(0, skill["id"]).write_text(old_text, encoding="utf-8")
    cap._mirror(0)
    original = cap._skill(0, skill["id"])
    (folder / "SKILL.md").write_text(old_text + "\nA local refresh.", encoding="utf-8")
    current = cap.import_local(0, source)
    assert current["id"] == skill["id"] and current["name"] == "Old Weather"
    assert current["slash_name"] == original["slash_name"]
    assert "A local refresh." in cap.expand(0, "/" + current["slash_name"])


def test_api_cli_and_review_skill_contracts_share_the_name_rule():
    from raphael_core.agent.team import worker_definition
    from raphael_core.background.snapshot import take_snapshot
    from raphael_core.management import DEFINITIONS, REGISTRY
    from raphael_core.members.skill_names import SKILL_NAME_RULE
    from raphael_core.members.skill_review import SYSTEM
    from raphael_core.members.template_author import SYSTEM as TEMPLATE_SYSTEM
    definition = worker_definition("skill_manage")
    snapshot = take_snapshot(None, team=["skill_manage"], interactive=True)
    offered = next(t["function"] for t in snapshot.definitions if t["function"]["name"] == "skill_manage")
    assert offered == definition["function"]
    assert SKILL_NAME_RULE in json.dumps(definition)
    assert SKILL_NAME_RULE in SYSTEM
    assert SKILL_NAME_RULE in TEMPLATE_SYSTEM
    assert SKILL_NAME_RULE in REGISTRY["member_skill_import"].description
    assert SKILL_NAME_RULE in REGISTRY["member_skill_update"].description
    assert SKILL_NAME_RULE in DEFINITIONS["member_manage"]["description"]

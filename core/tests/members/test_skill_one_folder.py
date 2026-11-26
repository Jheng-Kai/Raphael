"""The library is one folder: single skills and plugins are stored side by side in it, so one mount shows them all."""

import json

from .test_skill_packages import document
from .test_skill_plugin_sources import library, make_folder, plugin


async def test_a_plugin_is_stored_in_the_library_folder_beside_the_single_skills(rig, tmp_path):
    folder = make_folder(tmp_path / "desk", plugin())
    installed = await library(rig, {"plugin": True, "source": f"local:{folder}"})
    single = await library(rig, {"text": document("alone")})
    cap = rig.service.capabilities
    root = cap.homes.home(-1) / "skills"
    assert cap.plugin_root(installed["set"]["id"]).parent == root
    assert (root / str(single["skill"]["id"]) / "SKILL.md").is_file()
    assert (cap.plugin_root(installed["set"]["id"]) / "skills/write/SKILL.md").is_file()
    assert not (cap.homes.home(-1) / "skill-sets").exists()


async def test_a_plugin_kept_in_the_old_folder_moves_into_the_library_once(rig, tmp_path):
    folder = make_folder(tmp_path / "desk", plugin())
    installed = await library(rig, {"plugin": True, "source": f"local:{folder}"})
    cap = rig.service.capabilities
    home = cap.homes.home(-1)
    current = cap.plugin_root(installed["set"]["id"])
    (home / "skill-sets").mkdir()
    old = home / "skill-sets" / current.name
    current.rename(old)
    with rig.conn:
        rig.conn.execute("UPDATE skill_sets SET folder=? WHERE id=?", (f"skill-sets/{old.name}", installed["set"]["id"]))
    cap.unify_library()
    assert cap.plugin_root(installed["set"]["id"]) == home / "skills" / old.name
    assert (cap.plugin_root(installed["set"]["id"]) / "commands/review.md").is_file()
    assert not (home / "skill-sets").exists()
    cap.unify_library()  # nothing is left to move
    listed = (await rig.call("skills.library.list", {}))["packages"]
    assert [(p["name"], len(p["skills"])) for p in listed] == [("desk", 3)]
    assert json.loads(rig.conn.execute("SELECT metadata FROM skill_sets").fetchone()[0]) is not None

"""A path on this computer, written as the owner or a member writes it, is a folder to import and never a GitHub source."""

import pytest

from raphael_core.protocol import RpcError
from .test_skill_import_limits import skill_folder
from .test_skill_packages import document

WINDOWS_CACHE = r"C:\Users\someone\.claude\plugins\cache\cursor-plugins\pstack\0.15.32"
WINDOWS_SLASHES = "C:/Users"


@pytest.mark.parametrize("path", [WINDOWS_CACHE, WINDOWS_SLASHES, r"\\server\share\skills", "~/skills-that-do-not-exist"])
async def test_a_path_names_a_place_on_this_computer_and_never_a_github_repository(rig, path):
    for method, params in (("skills.library.import", {"source": path}),
                           ("members.skills.import", {"member_id": 0, "shared": True, "source": path}),
                           ("members.skills.import", {"member_id": 0, "shared": True, "plugin": True, "source": path})):
        with pytest.raises(RpcError) as caught:
            await rig.call(method, params)
        said = str(caught.value)
        assert "owner/repo" not in said and "GitHub repository" not in said, said


@pytest.mark.parametrize("write", [str, lambda path: path.as_posix(), lambda path: f'"{path}"'])
async def test_a_folder_written_as_a_path_imports_and_is_updated_from_where_it_is(rig, tmp_path, write):
    folder = skill_folder(tmp_path, "from-path")
    package = (await rig.call("skills.library.import", {"source": write(folder)}))["package"]
    assert [s["name"] for s in package["skills"]] == ["from-path"]
    assert package["source"].startswith("local:") and package["updatable"] is True
    (folder / "SKILL.md").write_text(document("from-path") + "\nMore.", encoding="utf-8")
    updated = (await rig.call("skills.library.update", {"key": package["key"], "refresh": True}))["package"]
    assert updated["key"] == package["key"]


def test_a_local_path_in_any_form_asks_the_owner_before_a_member_imports_it():
    from raphael_core.management import destructive

    for source in (WINDOWS_CACHE, WINDOWS_SLASHES, "local:/tmp/skills", "~/skills"):
        assert destructive("member_skill_import", {"member_id": 0, "source": source}) is True
    assert not destructive("member_skill_import", {"member_id": 0, "source": "owner/repo"})
    assert not destructive("member_skill_import", {"member_id": 0, "source": "https://github.com/owner/repo"})


async def test_a_member_imports_a_folder_by_its_path_as_a_plugin_too(rig, tmp_path):
    folder = skill_folder(tmp_path / "desk", "tidy")
    made = await rig.call("members.skills.import", {"member_id": 0, "shared": True, "plugin": True, "source": str(folder)})
    assert [s["name"] for s in made["skills"]] == ["tidy"]

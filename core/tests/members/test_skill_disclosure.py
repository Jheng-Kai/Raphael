"""A model reaches a skill's files in steps: the index names the skill, its document says what to read next, and the files it
names are read on demand or run by their path, in the computer the member works in."""

import pytest

from raphael_core.members import skill_library
from raphael_core.members.store import MemberError
from .test_skill_layouts import BIG, EXE, PNG, claude_plugin, write
from .test_skill_packages import document


async def plugin_skill(rig, tmp_path, name="ship"):
    folder = write(tmp_path / "deploy-kit", claude_plugin())
    package = (await rig.call("skills.library.import", {"source": f"local:{folder}", "access": "all"}))["package"]
    return package, rig.service.capabilities.plugin_root(int(package["key"].removeprefix("set:")))


async def test_a_plugin_skill_tells_where_its_plugin_is_and_names_what_else_it_holds(rig, tmp_path):
    package, root = await plugin_skill(rig, tmp_path)
    text = rig.service.skill_read(0, "ship")
    here = str(root).replace("\\", "/")
    assert f"Do `{here}/actions/ship.md`." in text
    for line in ("commands:", "- commands/rollback.md", "agents:", "- agents/reviewer.md", "hooks:", "- hooks/hooks.json",
                 "scripts:", "- scripts/ship.sh", "bin:", "- bin/tool.exe (4.0 KB, binary)"):
        assert line in text, line
    assert "assets/: 2 files, 3.0 MB" in text and "plugin:" in text
    assert len(text) < 6000  # the large asset is named, never carried


async def test_a_file_of_the_plugin_is_read_by_its_path_in_the_plugin(rig, tmp_path):
    package, root = await plugin_skill(rig, tmp_path)
    assert "scripts/ship.sh" in rig.service.skill_file(0, "ship", "plugin:actions/ship.md")
    assert rig.service.skill_file(0, "ship", "plugin:agents/reviewer.md").endswith("You review releases.")
    # The path the document gave is as good as the relative one, and so is the one in the member's own computer.
    assert "scripts/ship.sh" in rig.service.skill_file(0, "ship", str(root / "actions" / "ship.md"))
    rig.service.capabilities.guest_library = lambda member: "/home/cua/skills"
    guest = "/home/cua/skills/" + root.name + "/actions/ship.md"
    assert "scripts/ship.sh" in rig.service.skill_file(0, "ship", guest)
    with pytest.raises(MemberError, match="not UTF-8"):
        rig.service.skill_file(0, "ship", "plugin:bin/tool.exe")
    with pytest.raises(MemberError):
        rig.service.skill_file(0, "ship", "plugin:../outside.md")


async def test_a_member_on_docker_is_told_the_path_in_its_own_computer(rig, tmp_path):
    package, root = await plugin_skill(rig, tmp_path)
    rig.service.capabilities.guest_library = lambda member: "/home/cua/skills"
    text = rig.service.skill_read(0, "ship")
    assert f"Do `/home/cua/skills/{root.name}/actions/ship.md`." in text
    assert str(root).replace("\\", "/") not in text and "vm_exec" in text
    rig.service.capabilities.guest_library = lambda member: None
    assert str(root).replace("\\", "/") in rig.service.skill_read(0, "ship")


async def test_a_member_on_docker_reads_a_skill_though_its_files_are_read_in_a_thread(rig, tmp_path):
    """The guest path reads the database, whose connection SQLite lets only its own thread use: asked from the thread that
    reads the files, it failed every skill_read of a member on a Docker computer (ProgrammingError)."""
    import sqlite3
    import threading

    package, root = await plugin_skill(rig, tmp_path)
    main = threading.get_ident()

    def guest(member):
        if threading.get_ident() != main:
            raise sqlite3.ProgrammingError("SQLite objects created in a thread can only be used in that same thread")
        return "/home/cua/skills"

    rig.service.capabilities.guest_library = guest
    text = await rig.service.skill_read_async(0, "ship")
    assert f"Do `/home/cua/skills/{root.name}/actions/ship.md`." in text and "vm_exec" in text


async def test_a_slash_skill_sent_on_a_pc_with_docker_computers_loads_instead_of_failing_the_send(rig, tmp_path):
    """A message calling a skill (/ship …) was loaded in a thread that asked the database for the member's computer:
    SQLite refused the thread, the error passed every handler and the send failed, so the owner's message vanished from
    the thread. It loads, and the request goes on with the skill in it."""
    import sqlite3
    import threading

    package, root = await plugin_skill(rig, tmp_path)
    main = threading.get_ident()

    def guest(member):
        if threading.get_ident() != main:
            raise sqlite3.ProgrammingError("SQLite objects created in a thread can only be used in that same thread")
        return "/home/cua/skills"

    rig.service.capabilities.guest_library = guest
    failures = []
    text, loaded = await rig.service.capabilities.resolve_slash_async(0, "/ship the release", on_failure=lambda *args: failures.append(args))
    assert loaded and not failures
    assert f"/home/cua/skills/{root.name}/actions/ship.md" in text and "the release" in text


async def test_a_skill_with_scripts_and_references_lists_them_and_knows_its_own_folder(rig, tmp_path):
    folder = write(tmp_path / "report", {
        "SKILL.md": b"---\nname: report\ndescription: Write the report\n---\nRun ${CLAUDE_SKILL_DIR}/scripts/make.sh then read references/style.md.\n",
        "scripts/make.sh": b"echo made\n", "references/style.md": b"Style notes", "assets/chart.bin": EXE, "assets/logo.png": PNG})
    await rig.call("skills.library.import", {"source": f"local:{folder}"})
    held = rig.service.capabilities.homes.home(-1) / "skills"
    text = rig.service.skill_read(0, "report")
    place = str(next(path for path in held.iterdir() if (path / "scripts").is_dir()))
    assert f"Run {place}/scripts/make.sh" in text.replace("\\", "/") or f"Run {place.replace(chr(92), '/')}/scripts/make.sh" in text.replace("\\", "/")
    assert "- scripts/make.sh (10 B)" in text and "- assets/chart.bin (4.0 KB, binary)" in text
    # A reference is named like every other file and read when it is needed (Agent Skills' progressive disclosure).
    assert "- references/style.md (11 B)" in text.split("Files of this skill")[1]
    assert "Style notes" not in text


async def test_a_slash_call_names_a_skills_references_and_carries_none_of_them(rig, tmp_path):
    """Every reference under 8 KB was carried into the message: a skill of forty short references put 280 KB into one turn,
    more than a Codex member could take. Codex, Claude Code and the Agent Skills format give the document when the skill is
    used and leave its references to be read when the model needs them."""
    references = {f"references/topic-{index:02}.md": b"Detail. " * 900 for index in range(40)}
    folder = write(tmp_path / "guide", {"SKILL.md": document("guide").encode(), **references})
    await rig.call("skills.library.import", {"source": f"local:{folder}"})
    expanded = rig.service.capabilities.expand(0, "/guide plan it")
    assert "Detail. Detail." not in expanded and len(expanded.encode("utf-8")) < 12_000
    assert all(f"- references/topic-{index:02}.md (7.0 KB)" in expanded for index in range(40))
    assert "skill_read" in expanded and "plan it" in expanded


async def test_a_slash_call_does_not_read_every_file_of_the_skill(rig, tmp_path, monkeypatch):
    folder = write(tmp_path / "report", {"SKILL.md": document("report").encode(), "assets/huge.bin": BIG})
    await rig.call("skills.library.import", {"source": f"local:{folder}"})

    def refuse(*args, **kwargs):
        raise AssertionError("every file of the skill was read to check it")

    monkeypatch.setattr(skill_library, "package", refuse)
    expanded = rig.service.capabilities.expand(0, "/report make it")
    assert "report" in expanded and "huge.bin" in expanded

"""The owner imports one bounded package and grants it as a unit."""

import base64
import io
import shutil
import stat
import tarfile
import zipfile

import pytest

from raphael_core.members import skill_sources
from raphael_core.members.store import MemberError
from raphael_core.protocol import RpcError


def document(name):
    return f"---\nname: {name}\ndescription: Guide to {name}\n---\nBody for {name}."


def upload(name, data):
    return {"file": {"name": name, "data": base64.b64encode(data).decode()}}


def archive(entries, tar=False):
    buffer = io.BytesIO()
    if tar:
        with tarfile.open(fileobj=buffer, mode="w:gz") as out:
            for name, data in entries:
                info = tarfile.TarInfo(name)
                info.size = len(data)
                out.addfile(info, io.BytesIO(data))
    else:
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as out:
            for name, data in entries:
                out.writestr(name, data)
    return buffer.getvalue()


@pytest.mark.parametrize("format", ["folder", "zip", "tgz"])
async def test_a_single_skill_in_a_manifest_package_is_listed_as_a_plugin(rig, tmp_path, format):
    manifest = ".claude-plugin/plugin.json"
    entries = [(manifest, b'{"name":"notes","version":"1.0.0"}'),
               ("skills/notes/SKILL.md", document("read-notes").encode())]
    if format == "folder":
        for relative, contents in entries:
            path = tmp_path / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(contents)
        args = {"source": f"local:{tmp_path}"}
    else:
        args = upload(f"notes.{format}", archive(entries, format == "tgz"))
    package = (await rig.call("skills.library.import", args))["package"]
    assert package["kind"] == "plugin"
    assert len(package["skills"]) == 1
    await rig.call("skills.library.delete", {"key": package["key"]})
    assert not (await rig.call("skills.library.list", {}))["packages"]


@pytest.mark.parametrize("layout", ["text", "md", "root", "wrapped", "multiple", "tgz"])
async def test_the_library_accepts_documents_and_packaged_skills(rig, layout):
    text = document("read-notes")
    if layout == "text":
        args = {"text": text}
    elif layout == "md":
        args = upload("readme.md", text.encode())
    else:
        prefix = "" if layout == "root" else "notes/"
        entries = [(prefix + "SKILL.md", text.encode()), (prefix + "guide.txt", b"Read this first")]
        if layout == "multiple":
            entries.append(("weekly/SKILL.md", document("weekly").encode()))
        args = upload("notes.tgz" if layout == "tgz" else "notes.zip", archive(entries, layout == "tgz"))
    package = (await rig.call("skills.library.import", args))["package"]
    assert not package["updatable"]
    assert package["access"] == ([] if layout == "multiple" else "all")
    assert package["kind"] == ("pack" if layout == "multiple" else "single")
    if layout != "multiple":
        assert text in rig.service.skill_read(0, "read-notes")
    if layout in ("root", "wrapped", "tgz"):
        assert rig.service.skill_file(0, "read-notes", "guide.txt") == "Read this first"


@pytest.mark.parametrize("problem,kind", [("traversal", "archive"), ("absolute", "archive"), ("reserved", "archive"),
    ("case", "archive"), ("parent_case", "archive"), ("size", "size"), ("expanded", "size"), ("entries", "size"),
    ("skill_size", "size"), ("missing", "not_found")])
async def test_invalid_packages_leave_the_library_and_files_untouched(rig, monkeypatch, problem, kind):
    prefix = "" if problem == "absolute" else "notes/"
    entries = [(prefix + "SKILL.md", document("read-notes").encode())]
    if problem in ("traversal", "absolute"):
        entries.append(("notes/../outside" if problem == "traversal" else "/outside", b"x"))
    elif problem == "reserved":
        entries.append(("notes/.raphael-source.json", b"{}"))
    elif problem == "case":
        entries.append(("notes/skill.md", b"x"))
    elif problem == "parent_case":
        entries.append(("NOTES/help.txt", b"x"))
    elif problem == "missing":
        entries = [("help.txt", b"x")]
    elif problem == "entries":
        monkeypatch.setattr(skill_sources, "MAX_PACKAGE_FILES", 1)
        entries.append(("notes/help.txt", b"x"))
    elif problem == "skill_size":
        monkeypatch.setattr(skill_sources, "MAX_SKILL_BYTES", 16)
    else:
        monkeypatch.setattr(skill_sources, "MAX_PACKAGE_BYTES", 1024 if problem == "expanded" else 16)
        entries.append(("notes/help.txt", b"x" * 2000))
    with pytest.raises(RpcError) as error:
        await rig.call("skills.library.import", upload("notes.zip", archive(entries)))
    assert error.value.data["kind"] == kind
    # The window reads the kind from the message, which is all the shell passes it (skill-library.ts failureText).
    assert error.value.message.startswith(f"Invalid params: {kind}: ")
    assert not rig.service.packages.list()
    assert not (rig.service.capabilities.homes.home(-1) / "skills").exists()


async def test_a_repository_import_is_one_package_with_no_members_until_granted(rig, monkeypatch):
    async def download(source):
        return [(source + "/" + slug, {"SKILL.md": document(slug).encode()}) for slug in ("read-notes", "write-notes")]
    monkeypatch.setattr("raphael_core.members.service.download_skills", download)
    package = (await rig.call("skills.library.import", {"source": "owner/notes"}))["package"]
    assert (package["kind"], package["name"], package["source"], package["access"]) == ("pack", "notes", "owner/notes", [])
    assert package["updatable"] and len(package["skills"]) == 2
    assert (await rig.call("skills.library.list", {}))["packages"] == [package]
    with pytest.raises(RpcError, match="read-notes") as error:
        await rig.call("skills.library.import", {"source": "owner/notes"})
    assert error.value.data["kind"] == "taken" and error.value.message.startswith("Invalid params: taken: ")


async def test_only_granted_members_can_list_load_and_read_enabled_package_skills(rig, tmp_path):
    service = rig.service
    ada, lin = [service.store.create_member(name=name, role="Reader").id for name in ("Ada", "Lin")]
    root = tmp_path / "private library"
    for slug in ("notes", "summary"):
        folder = root / slug
        folder.mkdir(parents=True)
        (folder / "SKILL.md").write_text(document(slug), encoding="utf8")
        (folder / "extra.txt").write_text("package file", encoding="utf8")
    package = (await rig.call("skills.library.import", {"source": "local:" + str(root), "access": [ada]}))["package"]
    key = package["key"]
    async def check(member, names, enabled=True):
        result = await rig.call("members.skills.list", {"member_id": member})
        assert {s["name"] for s in result["skills"]} == names
        assert {s["name"] for s in service.native_skills(member)} == names
        from raphael_core.agent.team import roster_prompt
        prompt = roster_prompt(service, service.speaker(member), "en")
        assert {s["name"] for s in service.enabled_skills(member)} == names
        for s in package["skills"]:
            assert (s["description"] in prompt) == (s["name"] in names)
        assert result["library"] == ([{"key": key, "name": root.name, "skills": len(names)}] if enabled else [])
        for s in package["skills"]:
            if s["name"] in names:
                assert service.skill_file(member, s["name"], "extra.txt") == "package file"
                assert service.skill_read(member, s["name"])
            else:
                assert service.skill_read(member, s["name"]) is None
                with pytest.raises(MemberError):
                    service.skill_file(member, s["name"], "extra.txt")
                with pytest.raises(RpcError):
                    await rig.call("members.skills.read", {"member_id": member, "id": s["id"]})
    await check(ada, {"notes", "summary"})
    await check(lin, set(), False)
    skill = next(s for s in package["skills"] if s["name"] == "notes")
    await rig.call("skills.library.update", {"key": key, "skill": {"id": skill["id"], "enabled": False}})
    await check(ada, {"summary"})
    await rig.call("skills.library.update", {"key": key, "enabled": False})
    await check(ada, set(), False)
    (root / "notes/extra.txt").unlink()
    shutil.rmtree(root / "summary")
    (root / "daily").mkdir()
    (root / "daily/SKILL.md").write_text(document("daily"), encoding="utf8")
    after = (await rig.call("skills.library.update", {"key": key, "refresh": True}))["package"]
    assert (after["key"], after["access"], after["enabled"]) == (key, [ada], False)
    assert {s["name"]: s["enabled"] for s in after["skills"]} == {"notes": False, "daily": True}
    saved = service.capabilities._path(-1, skill["id"]).parent
    assert saved.is_dir() and not (saved / "extra.txt").exists()
    assert await rig.call("skills.library.delete", {"key": key}) == {"deleted": True}
    assert not saved.exists() and not service.packages.list()
    assert (root / "daily/SKILL.md").exists()


@pytest.mark.parametrize("params", [{"text": document("notes"), "source": "one/two"}, {"extra": False},
    {"access": None}, {"access": [True]}, {"access": [1, 1]}, {"access": [999]}, {"file": {"name": "a.md"}}])
async def test_invalid_import_parameters_cannot_create_packages(rig, params):
    with pytest.raises(RpcError):
        await rig.call("skills.library.import", {"text": document("notes"), **params})
    assert not rig.service.packages.list()


async def test_refresh_restores_every_document_and_switch_after_a_copy_failure(rig, tmp_path, monkeypatch):
    from raphael_core.members import skill_packages

    root = tmp_path / "weekly"
    root.mkdir()
    path = root / "SKILL.md"
    path.write_text(document("weekly"), encoding="utf8")
    pack = (await rig.call("skills.library.import", {"source": "local:" + str(root)}))["package"]
    path.write_text(document("weekly") + " Changed.", encoding="utf8")
    (root / "attachment.txt").write_text("new", encoding="utf8")
    writes = skill_packages.atomic
    def fail_attachment(target, data):
        if target.name == "attachment.txt":
            raise OSError("simulated copy failure")
        writes(target, data)
    monkeypatch.setattr(skill_packages, "atomic", fail_attachment)
    with pytest.raises(RpcError):
        await rig.call("skills.library.update", {"key": pack["key"], "refresh": True, "enabled": False, "access": []})
    assert (await rig.call("skills.library.list", {}))["packages"] == [pack]
    assert "Changed." not in rig.service.skill_read(0, "weekly")
    assert not (rig.service.capabilities._path(-1, pack["skills"][0]["id"]).parent / "attachment.txt").exists()


async def test_management_uses_the_owner_card_and_the_library_rpc(rig, tmp_path):
    from raphael_core.agent.policy import Action, Confirmations, Tier, ToolRegistry
    from raphael_core.management import publish

    root = tmp_path / "selected"
    root.mkdir()
    (root / "SKILL.md").write_text(document("weekly"), encoding="utf8")
    name, arguments = publish("member_library_import", {"source": "local:" + str(root), "access": []})
    with pytest.raises(RpcError):
        await rig.service.admin_tool(0, name, arguments, interactive=True)
    assert str(root) in rig.service.admin_confirmation(name, arguments, "en")
    confirmations = Confirmations()
    pending = confirmations.open("library", 1, Action(name, arguments), Tier.T3, "en")
    yes = confirmations.resolve(pending.id, True).approval
    ToolRegistry({name: Tier.T3}).check(pending.action, yes)
    result = await rig.service.admin_tool(0, name, arguments, interactive=True, approval=yes)
    assert result["package"]["access"] == []
    assert (await rig.call("skills.library.list", {}))["packages"] == [result["package"]]
    assert not rig.service.native_skills(0)


@pytest.mark.parametrize("filename", ["private.md", "private.tar.gz", "private.zip"])
async def test_owner_picked_files_can_be_imported_into_a_members_private_skills(rig, tmp_path, filename):
    path = tmp_path / filename
    data = document("review").encode()
    if not filename.endswith(".md"):
        data = archive([("weekly/SKILL.md", data), ("weekly/check.txt", b"done")], filename.endswith(".gz"))
    path.write_bytes(data)
    member = rig.service.store.create_member(name="Ada", role="Reader").id
    await rig.call("members.skills.import", {"member_id": member, "source": "local:" + str(path)})
    assert document("review") in rig.service.skill_read(member, "review")
    assert rig.service.skill_read(0, "review") is None
    assert not rig.service.packages.list()
    if not filename.endswith(".md"):
        assert rig.service.skill_file(member, "review", "check.txt") == "done"


@pytest.mark.parametrize("tar", [False, True])
async def test_only_selected_skill_links_are_resolved_and_external_links_are_noted(rig, tar):
    buffer = io.BytesIO()
    files = [("notes/SKILL.md", document("read-notes").encode()), ("notes/guide.txt", b"read this")]
    links = [("AGENTS.md", "outside"), ("notes/deep/read.txt", "../guide.txt"),
             ("notes/external.txt", "../AGENTS.md")]
    if tar:
        with tarfile.open(fileobj=buffer, mode="w:gz") as output:
            for name, data in files:
                entry = tarfile.TarInfo(name)
                entry.size = len(data)
                output.addfile(entry, io.BytesIO(data))
            for name, target in links:
                entry = tarfile.TarInfo(name)
                entry.type = tarfile.SYMTYPE
                entry.linkname = target
                output.addfile(entry)
    else:
        with zipfile.ZipFile(buffer, "w") as output:
            for name, data in files:
                output.writestr(name, data)
            for name, target in links:
                entry = zipfile.ZipInfo(name)
                entry.create_system = 3
                entry.external_attr = (stat.S_IFLNK | 0o777) << 16
                output.writestr(entry, target)
    data = buffer.getvalue()
    name = "notes.tgz" if tar else "notes.zip"
    [files] = skill_sources.read_archive(name, data, subpath="notes")
    assert files["deep/read.txt"] == b"read this"
    assert "external.txt" not in files and "AGENTS.md" not in files
    assert files.skipped_links == ["external.txt"]
    package = (await rig.call("skills.library.import", upload(name, data)))["package"]
    skill = package["skills"][0]
    assert package["skipped_links"] == {str(skill["id"]): ["external.txt"]}
    assert rig.service.skill_file(0, "read-notes", "deep/read.txt") == "read this"

    from raphael_core.members.skill_library import package as load_package

    [native] = rig.service.native_skills(0)
    from pathlib import Path

    folder = Path(native["path"]).parent
    with pytest.raises(MemberError, match="not a path a skill may hold"):
        load_package(folder)
    assert load_package(folder, installed=True)["deep/read.txt"] == b"read this"


async def test_missing_skill_document_is_refused_before_writing(rig):
    data = archive([("notes/SKILL.md", b"\x00invalid")])
    with pytest.raises(RpcError, match="UTF-8 Markdown"):
        await rig.call("skills.library.import", upload("notes.zip", data))
    assert not rig.service.packages.list()


def test_local_skill_copies_an_absolute_link_only_within_the_selected_folder(tmp_path):
    root = tmp_path / "repository"
    folder = root / "notes"
    folder.mkdir(parents=True)
    (folder / "SKILL.md").write_text(document("read-notes"), encoding="utf-8")
    guide = folder / "guide.txt"
    guide.write_bytes(b"read this")
    outside = root / "outside.txt"
    outside.write_bytes(b"outside the skill")
    try:
        (folder / "read.txt").symlink_to(guide)
        (folder / "external.txt").symlink_to(outside)
    except OSError as error:
        pytest.skip(f"cannot create local symlinks: {error}")
    [files], _ = skill_sources.local(f"local:{root}")
    assert files["read.txt"] == b"read this"
    assert files.skipped_links == ["external.txt"]


def plugin_folder(tmp_path):
    """A plugin whose one skill reads the actions beside its skills folder, as a real package lays them out."""
    root = tmp_path / "bundle" / "track"
    files = {
        ".claude-plugin/plugin.json": '{"name":"track","version":"1.0.0"}',
        "skills/lazy-mode/SKILL.md": document("lazy-mode") + (
            "\nRead [report](../../actions/report.md) or [the notes](<../../actions/notes.md#top>)."
            "\nFor any other action read ../../actions/<name>.md first, then `../../README.md`."
            "\nNever read ../../../outside.md or [the big one](../../actions/big.bin)."
            "\nAlso see [a sibling](../other/SKILL.md) and [its own file](../lazy-mode/references/own.md).\n"),
        "skills/lazy-mode/references/own.md": "own reference",
        "skills/other/SKILL.md": document("other"),
        "actions/report.md": "# Report\nShared rules: [common](_common.md), [readme](../README.md).\n",
        "actions/notes.md": "# Notes",
        "actions/_common.md": "# Common\nBack to [the skill](../skills/lazy-mode/references/own.md).\n",
        "actions/big.bin": "x" * 5000,
        "README.md": "the plugin",
    }
    for relative, contents in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(contents.encode())
    (tmp_path / "bundle" / "outside.md").write_bytes(b"not part of the plugin")
    return root


def test_a_plugin_skill_takes_the_files_it_links_to_in_its_plugin(tmp_path, monkeypatch):
    root = plugin_folder(tmp_path)
    monkeypatch.setattr(skill_sources, "MAX_PACKAGE_BYTES", 4000)
    documents, _ = skill_sources.local(f"local:{root}")
    files = next(f for f in documents if "<name>" in f["SKILL.md"].decode() or "_plugin/" in f["SKILL.md"].decode())
    text = files["SKILL.md"].decode()
    assert files.plugin_manifest
    # The links point into the skill's own folder now, where the copies are, and every one of them resolves.
    assert "[report](_plugin/actions/report.md)" in text and "(<_plugin/actions/notes.md#top>)" in text
    assert "_plugin/actions/<name>.md" in text and "`_plugin/README.md`" in text
    assert "(references/own.md)" in text and "(_plugin/skills/other/SKILL.md)" in text
    for link in ("_plugin/actions/report.md", "_plugin/actions/notes.md", "_plugin/README.md", "references/own.md"):
        assert link in files
    # What those files link to comes with them, relative to each other as in the plugin.
    assert files["_plugin/actions/_common.md"] == b"# Common\nBack to [the skill](../skills/lazy-mode/references/own.md).\n"
    assert files["_plugin/README.md"] == b"the plugin"
    assert not any(name.endswith("outside.md") or name.endswith("big.bin") for name in files)
    # What cannot come is named, with the reason.
    assert {(item["path"], item["reason"]) for item in files.skipped_references} == {
        ("../../../outside.md", "outside_plugin"), ("actions/big.bin", "too_large"),
        ("skills/lazy-mode/references/own.md", "inside_skill")}


async def test_the_imported_plugin_skill_reads_its_linked_files_and_the_result_names_what_is_missing(rig, tmp_path):
    root = plugin_folder(tmp_path)
    try:
        (root / "actions" / "linked.md").symlink_to(root / "README.md")
    except OSError as error:
        pytest.skip(f"cannot create local symlinks: {error}")
    skill = root / "skills" / "lazy-mode" / "SKILL.md"
    skill.write_bytes(skill.read_bytes() + b"Also [a link](../../actions/linked.md).\n")
    package = (await rig.call("skills.library.import", {"source": f"local:{root}"}))["package"]
    named = next(s for s in package["skills"] if s["name"] == "lazy-mode")
    assert package["kind"] == "plugin"
    assert {(item["path"], item["reason"]) for item in package["skipped_references"][str(named["id"])]} == {
        ("../../../outside.md", "outside_plugin"), ("actions/linked.md", "linked"),
        ("skills/lazy-mode/references/own.md", "inside_skill")}
    await rig.call("skills.library.update", {"key": package["key"], "access": "all"})
    text = rig.service.skill_read(0, "lazy-mode")
    assert "[report](_plugin/actions/report.md)" in text
    # The link in the stored skill leads to the stored copy, and the copies keep their links to each other.
    assert rig.service.skill_file(0, "lazy-mode", "_plugin/actions/report.md").startswith("# Report")
    assert rig.service.skill_file(0, "lazy-mode", "_plugin/actions/_common.md").startswith("# Common")
    assert rig.service.skill_file(0, "lazy-mode", "_plugin/README.md") == "the plugin"
    assert rig.service.skill_file(0, "lazy-mode", "references/own.md") == "own reference"
    from pathlib import Path

    folder = Path(next(n for n in rig.service.native_skills(0) if n["name"].endswith("lazy-mode"))["path"]).parent
    assert (folder / "_plugin" / "actions" / "report.md").is_file()
    assert not (folder / "_plugin" / "actions" / "linked.md").exists()
    assert not (folder.parent / "actions").exists()


def test_a_skill_outside_a_plugin_or_beside_its_files_is_imported_as_it_is(tmp_path):
    root = tmp_path / "loose"
    (root / "skills" / "notes").mkdir(parents=True)
    (root / "actions").mkdir()
    (root / "actions" / "report.md").write_bytes(b"report")
    text = document("notes") + "\nRead ../../actions/report.md.\n"
    (root / "skills" / "notes" / "SKILL.md").write_bytes(text.encode())
    [files], _ = skill_sources.local(f"local:{root}")
    assert files["SKILL.md"] == text.encode() and list(files) == ["SKILL.md"] and not files.skipped_references
    # A plugin skill whose folder already uses the shared name copies nothing and says why.
    (root / ".claude-plugin").mkdir()
    (root / ".claude-plugin" / "plugin.json").write_bytes(b"{}")
    (root / "skills" / "notes" / "_plugin").mkdir()
    (root / "skills" / "notes" / "_plugin" / "mine.md").write_bytes(b"mine")
    [files], _ = skill_sources.local(f"local:{root}")
    assert files["SKILL.md"] == text.encode() and "_plugin/actions/report.md" not in files
    assert files.skipped_references == [{"path": "actions/report.md", "reason": "name_taken"}]

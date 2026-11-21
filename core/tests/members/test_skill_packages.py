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
    with pytest.raises(MemberError, match="invalid skill package"):
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

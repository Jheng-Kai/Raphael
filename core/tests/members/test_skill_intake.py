"""The importer of Team skills (R-SKILL-26, R-SKILL-28, R-SKILL-33): what imports directly with no model, and what is handed to Raphael."""

import base64
import gzip
import io
import tarfile
import zipfile

import pytest

from raphael_core.members import skill_git, skill_intake
from raphael_core.members.store import MemberError
from raphael_core.protocol import RpcError
from .github_fake import FakeGitHub
from .test_skill_git import FakeGit
from .test_skill_import_limits import detail
from .test_skill_packages import archive, document, upload

PDF = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n"


@pytest.fixture(autouse=True)
def work(rig, tmp_path):
    """Raphael's own folder, where what is handed over is put: the test's, never the owner's."""
    rig.service.member_folders = lambda member: (tmp_path / "work", tmp_path / "team")
    return tmp_path / "work"


@pytest.fixture
def github(monkeypatch):
    return FakeGitHub(monkeypatch)


def files(entries):
    return {"files": [{"path": path, "data": base64.b64encode(data).decode()} for path, data in entries]}


# --- what imports directly -------------------------------------------------------------------------------------------


async def test_what_follows_the_rules_imports_with_no_model_and_no_agent(rig, tmp_path, github):
    github.add("owner/skills", {"skills/write/SKILL.md": document("write").encode()})
    folder = tmp_path / "desk" / "tidy"
    folder.mkdir(parents=True)
    (folder / "SKILL.md").write_text(document("tidy"), encoding="utf-8")
    other = tmp_path / "desk" / "other"
    other.mkdir()
    (other / "SKILL.md").write_text(document("other"), encoding="utf-8")
    for params in ({"text": document("pasted")}, {"text": "owner/skills"}, {"source": f"local:{folder}"}, {"text": str(other)},
                   upload("plain.md", document("plain").encode()), upload("pack.zip", archive([("zipped/SKILL.md", document("zipped").encode())])),
                   upload("mine.skill", archive([("SKILL.md", document("dotskill").encode())])),
                   files([("dropped/SKILL.md", document("dropped").encode()), ("dropped/notes/a.md", b"a")])):
        answer = await rig.call("skills.library.import", params)
        assert "package" in answer and set(answer) <= {"package", "skipped"}, params
    assert rig.background.submitted == []
    assert len((await rig.call("skills.library.list", {}))["packages"]) == 8


def tar_of(entries, mode="w:gz"):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode=mode) as out:
        for name, data in entries:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            out.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


@pytest.mark.parametrize("name, data", [
    ("flat.zip", archive([("SKILL.md", document("shape").encode()), ("notes.md", b"n")])),
    ("wrapped.zip", archive([("shape-main/SKILL.md", document("shape").encode()), ("shape-main/refs/a.md", b"a")])),
    ("finder.zip", archive([("shape/SKILL.md", document("shape").encode()), ("__MACOSX/shape/._SKILL.md", b"\x00\x05\x16\x07binary"),
                            ("shape/.DS_Store", b"x"), ("shape/._notes.md", b"\x00\x05"), ("shape/notes.md", b"n")])),
    ("shape.tar.gz", tar_of([("shape/SKILL.md", document("shape").encode()), ("shape/._SKILL.md", b"\x00\x05")])),
    ("shape.tar", tar_of([("shape/SKILL.md", document("shape").encode())], "w:")),
    ("shape.tar.bz2", tar_of([("shape/SKILL.md", document("shape").encode())], "w:bz2")),
    ("download", archive([("shape/SKILL.md", document("shape").encode())])),
    ("many.skill", archive([("shape/SKILL.md", document("shape").encode())])),
], ids=["flat-zip", "wrapped-zip", "finder-zip", "tar-gz", "tar", "tar-bz2", "no-extension", "dot-skill"])
async def test_an_archive_of_any_shape_is_read_with_what_a_mac_leaves_in_it_ignored(rig, name, data):
    answer = await rig.call("skills.library.import", upload(name, data))
    skills = answer["package"]["skills"]
    assert [s["name"] for s in skills] == ["shape"]
    stored = list((rig.service.capabilities.library_folder()).rglob("*"))
    assert not [p for p in stored if p.name.startswith("._") or p.name == ".DS_Store" or "__MACOSX" in p.parts]


async def test_a_name_with_a_colon_or_a_slash_is_a_label_never_a_path(rig):
    data = archive([("shape/SKILL.md", document("shape").encode())])
    answer = await rig.call("skills.library.import", upload("v1: final/skills.zip", data))
    assert answer["package"]["skills"][0]["name"] == "shape"


# --- what needs an agent is not done in the dialog ---------------------------------------------------------------------


async def handoff(rig, params):
    answer = await rig.call("skills.library.import", params)
    assert set(answer) == {"handoff"}, answer
    assert rig.background.submitted == [], "no agent, no model and no background task is involved"
    assert (await rig.call("skills.library.list", {}))["packages"] == []
    return answer["handoff"]


async def test_text_that_is_no_skill_is_handed_over_as_text(rig):
    assert await handoff(rig, {"text": "Steps:\n1. Collect the notes.\n2. Write the report."}) == {"kind": "text", "label": "pasted text"}
    assert await handoff(rig, {"text": "how to write a weekly report"}) == {"kind": "text", "label": "pasted text"}


async def test_a_web_page_is_handed_over_as_an_address(rig):
    for text, address in (("https://example.com/guide", "https://example.com/guide"), ("www.example.com/guide", "https://www.example.com/guide")):
        assert await handoff(rig, {"text": text}) == {"kind": "link", "label": address, "address": address}


async def test_a_document_is_handed_over_as_the_file_it_is(rig):
    assert await handoff(rig, upload("guide.pdf", PDF)) == {"kind": "file", "label": "guide.pdf"}
    assert await handoff(rig, upload("notes.txt", b"plain notes")) == {"kind": "file", "label": "notes.txt"}
    # A Word file is a ZIP inside, and still the file it is.
    assert (await handoff(rig, upload("plan.docx", archive([("word/document.xml", b"<w/>")]))))["kind"] == "file"


async def test_an_archive_of_other_material_is_put_where_raphael_reads_it(rig, work):
    sent = archive([("scan-main/page1.pdf", PDF), ("scan-main/notes/readme.md", b"# notes"), ("__MACOSX/scan-main/._page1.pdf", b"x"),
                    ("scan-main/.DS_Store", b"x")])
    made = await handoff(rig, upload("scan.zip", sent))
    assert made["kind"] == "folder" and made["label"] == "scan.zip"
    folder = work / "skill-sources" / made["path"].split("skill-sources")[1].strip("\\/")
    assert str(folder) == made["path"]
    assert sorted(p.relative_to(folder).as_posix() for p in folder.rglob("*") if p.is_file()) == ["notes/readme.md", "page1.pdf"]


async def test_a_dropped_tree_or_a_folder_of_other_material_is_put_or_read_where_it_is(rig, tmp_path, work):
    made = await handoff(rig, files([("handbook/a.md", b"a"), ("handbook/b/c.pdf", PDF)]))
    assert made["kind"] == "folder" and made["label"] == "handbook"
    assert sorted(p.name for p in (work / "skill-sources").glob("handbook-*/*")) == ["a.md", "b"]
    notes = tmp_path / "notes"
    notes.mkdir()
    (notes / "a.pdf").write_bytes(PDF)
    for params in ({"source": f"local:{notes}"}, {"text": str(notes)}):
        assert await handoff(rig, params) == {"kind": "path", "label": "notes", "path": str(notes)}
    page = tmp_path / "page.pdf"
    page.write_bytes(PDF)
    assert await handoff(rig, {"source": f"local:{page}"}) == {"kind": "path", "label": "page.pdf", "path": str(page)}


async def test_a_github_repository_without_a_skill_is_fetched_by_git_or_handed_over_as_a_link(rig, github, monkeypatch, work):
    github.add("owner/docs", {"README.md": b"A repository of documents", "guide/setup.md": b"Setup"})
    monkeypatch.setattr(skill_git.shutil, "which", lambda name: None)
    # Without git it is a link for Raphael to open: nothing is fetched, nothing is left.
    assert (await handoff(rig, {"text": "owner/docs"}))["kind"] == "link"
    assert not (work / "skill-sources").exists() or not list((work / "skill-sources").iterdir())
    fake = FakeGit(monkeypatch, files={"README.md": b"A repository of documents"})
    made = await handoff(rig, {"text": "https://github.com/owner/docs"})
    assert made["kind"] == "folder" and made["address"] == "https://github.com/owner/docs"
    assert fake.clone[0][-2] == "https://github.com/owner/docs.git" and (work / "skill-sources").is_dir()


async def test_what_cannot_be_read_keeps_its_own_cause_and_is_never_handed_over(rig):
    with pytest.raises(RpcError) as caught:
        await rig.call("skills.library.import", upload("broken.zip", b"PK\x03\x04 not really a zip"))
    assert detail(caught)["reason"] == "unreadable"
    assert rig.background.submitted == []


def test_only_a_refusal_for_the_format_is_handed_over():
    for error, handed in [
        (MemberError("not_found", "x", reason="no_skill"), True), (MemberError("source", "x", reason="host"), True),
        (MemberError("source", "x", reason="file_type"), True), (MemberError("source", "x", reason="not_skill_file"), True),
        (MemberError("skill", "x", reason="front_matter", problem="none"), True),
        (MemberError("not_found", "x", reason="repo"), False), (MemberError("download", "x", reason="network"), False),
        (MemberError("download", "x", reason="git_network"), False), (MemberError("source", "x", reason="git_sign_in"), False),
        (MemberError("size", "x", reason="file"), False), (MemberError("archive", "x", reason="unreadable"), False),
        (MemberError("taken", "x"), False), (MemberError("source", "x", reason="path"), False),
    ]:
        assert skill_intake.needs_agent(error) is handed, error


async def test_the_background_conversion_is_gone(rig):
    from raphael_core.members import service

    assert not hasattr(service.MembersService, "_conversions") and not hasattr(rig.service, "conversions")
    with pytest.raises(RpcError):
        await rig.call("skills.library.convert", {"task_id": 1})
    with pytest.raises(Exception):
        __import__("raphael_core.members.skill_convert")


# --- a Git address ------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("address", [
    "git@gitlab.example.com:group/repo.git", "git@gitlab.example.com: group/repo", "ssh://git@gitlab.example.com/group/repo.git",
    "https://gitlab.example.com/group/repo.git",
])
async def test_a_git_repository_of_skills_imports_with_the_system_git_and_is_refreshed_from_it(rig, monkeypatch, work, address):
    fake = FakeGit(monkeypatch, files={"skills/tidy/SKILL.md": document("tidy").encode(), "skills/tidy/refs/a.md": b"a",
                                       "skills/other/SKILL.md": document("other").encode(), "README.md": b"r"})
    answer = await rig.call("skills.library.import", {"text": address})
    package = answer["package"]
    assert sorted(s["name"] for s in package["skills"]) == ["other", "tidy"] and package["updatable"] is True
    assert package["source"].endswith("group/repo.git") or package["source"].endswith("group/repo")
    assert "git@gitlab.example.com: " not in package["source"]
    # The clone was read and removed: nothing is left where Raphael reads.
    assert not list((work / "skill-sources").glob("*"))
    fake.files["skills/third/SKILL.md"] = document("third").encode()
    refreshed = await rig.call("skills.library.update", {"key": package["key"], "refresh": True})
    assert sorted(s["name"] for s in refreshed["package"]["skills"]) == ["other", "third", "tidy"]
    assert len([call for call in fake.calls if "clone" in call[0]]) == 2


async def test_a_git_repository_that_is_a_plugin_imports_whole(rig, monkeypatch, work):
    manifest = b'{"name": "desk-kit", "version": "1.0.0", "description": "Desk tools"}'
    FakeGit(monkeypatch, files={".claude-plugin/plugin.json": manifest, "skills/tidy/SKILL.md": document("tidy").encode(),
                                "commands/go.md": b"---\ndescription: go\n---\ngo"})
    answer = await rig.call("skills.library.import", {"text": "git@gitlab.example.com:group/desk-kit.git"})
    assert answer["package"]["kind"] == "plugin" and any(s["name"].endswith("tidy") for s in answer["package"]["skills"])


async def test_a_git_repository_of_other_material_stays_where_raphael_reads_it(rig, monkeypatch, work):
    FakeGit(monkeypatch, files={"README.md": b"A handbook", "docs/setup.md": b"Setup"})
    made = await handoff(rig, {"text": "git@gitlab.example.com:group/handbook.git"})
    assert made["kind"] == "folder" and made["address"] == "git@gitlab.example.com:group/handbook.git" and made["label"] == "handbook"
    folder = work / "skill-sources"
    assert str(next(folder.iterdir())) == made["path"] and (next(folder.iterdir()) / "docs" / "setup.md").read_bytes() == b"Setup"


@pytest.mark.parametrize("stderr, reason", [
    ("git@gitlab.example.com: Permission denied (publickey).", "git_sign_in"),
    ("Host key verification failed.", "git_host_key"),
    ("ssh: Could not resolve hostname gitlab.example.com", "git_network"),
])
async def test_a_failed_fetch_says_what_is_wrong_in_the_dialog_and_hands_nothing_over(rig, monkeypatch, work, stderr, reason):
    FakeGit(monkeypatch, stderr=stderr, code=128)
    with pytest.raises(RpcError) as caught:
        await rig.call("skills.library.import", {"text": "git@gitlab.example.com:group/repo.git"})
    assert detail(caught)["reason"] == reason and detail(caught)["host"] == "gitlab.example.com"
    assert rig.background.submitted == []
    assert not (work / "skill-sources").exists() or not list((work / "skill-sources").iterdir())


async def test_git_missing_and_a_password_in_the_address_are_said_before_anything_is_fetched(rig, monkeypatch):
    monkeypatch.setattr(skill_git.shutil, "which", lambda name: None)
    with pytest.raises(RpcError) as caught:
        await rig.call("skills.library.import", {"text": "git@gitlab.example.com:group/repo.git"})
    assert detail(caught)["reason"] == "git_missing"
    monkeypatch.setattr(skill_git, "_run", lambda *a: pytest.fail("git ran"))
    with pytest.raises(RpcError) as caught:
        await rig.call("skills.library.import", {"text": "https://me:hunter2@gitlab.example.com/group/repo.git"})
    assert detail(caught)["reason"] == "git_credentials" and "hunter2" not in str(caught.value)


async def test_a_member_imports_a_git_address_only_with_the_owners_yes(rig):
    from raphael_core import management

    assert management.REGISTRY["member_library_import"].destructive and management.TIERS["member_library_import"].name == "T3"

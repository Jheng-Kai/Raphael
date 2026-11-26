"""One box that takes anything: what is a skill imports directly, with no model; the rest is converted by the primary contact."""

import base64
import json
import re

import pytest

from raphael_core.brain.settings import SettingsStore
from raphael_core.members import skill_convert
from raphael_core.members.store import MemberError
from raphael_core.protocol import RpcError
from raphael_core.background.tasks import Task
from .github_fake import FakeGitHub
from .test_skill_import_limits import detail
from .test_skill_packages import archive, document, upload

PDF = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n"
ANSWER = (
    '<file path="SKILL.md">\n---\nname: weekly-report\ndescription: Write the weekly report. Use when asked for one.\n---\n'
    "# Weekly report\n\n## Steps\n1. Collect the notes.\n2. Write it.\n</file>\n"
    '<file path="references/template.md">\nTitle\nDone\nNext\n</file>'
)


@pytest.fixture
def github(monkeypatch):
    return FakeGitHub(monkeypatch)


@pytest.fixture
def model(rig):
    SettingsStore(rig.conn).set("agent_model", "openrouter/test-model")


def files(entries):
    return {"files": [{"path": path, "data": base64.b64encode(data).decode()} for path, data in entries]}


def finish(rig, task_id, text, state="done", reason=None):
    rig.background.store.finish(task_id, state, prefix="", text=text, detail=None, reason=reason)


async def converting(rig, params):
    answer = await rig.call("skills.library.import", params)
    assert set(answer) == {"converting"}, answer
    return answer["converting"]


# --- what a pasted string is ---------------------------------------------------------------------------------------


@pytest.mark.parametrize("text, kind", [
    ("https://github.com/owner/repo", "link"), (" https://example.com/page ", "link"), ("owner/repo", "link"),
    ("skills.sh/owner/repo/tdd", "link"), ("github.com/owner/repo/tree/main/skills", "link"), ("www.example.com/guide", "link"),
    (r"C:\Users\someone\notes", "path"), ("C:/Users/someone/notes", "path"), ("/home/someone/notes", "path"),
    ("~/notes", "path"), ('"D:\\My Notes\\skills"', "text"),
    ("---\nname: x\n---\nBody", "text"), ("how to write a weekly report", "text"), ("", "text"),
    ("see https://example.com for the steps", "text"), ("one line\nsecond line", "text"),
])
def test_a_pasted_string_is_a_link_a_path_or_text(text, kind):
    assert skill_convert.kind_of(text) == kind


def test_a_pasted_link_or_path_is_a_source_and_any_other_text_stays_text():
    assert skill_convert.routed({"text": "owner/repo"}) == {"source": "owner/repo"}
    assert skill_convert.routed({"text": "www.example.com/a"}) == {"source": "https://www.example.com/a"}
    assert skill_convert.routed({"text": r"C:\work\notes"}) == {"source": r"local:C:\work\notes"}
    assert skill_convert.routed({"text": "Steps:\n1. Do it"}) == {"text": "Steps:\n1. Do it"}
    assert skill_convert.routed({"file": {"name": "a.md", "data": ""}}) == {"file": {"name": "a.md", "data": ""}}


@pytest.mark.parametrize("error, converts", [
    (MemberError("not_found", "x", reason="no_skill"), True), (MemberError("source", "x", reason="host"), True),
    (MemberError("source", "x", reason="file_type"), True), (MemberError("source", "x", reason="not_skill_file"), True),
    (MemberError("skill", "x", reason="front_matter", problem="none"), True),
    (MemberError("not_found", "x", reason="repo"), False), (MemberError("download", "x", reason="network"), False),
    (MemberError("size", "x", reason="file"), False), (MemberError("archive", "x", reason="unreadable"), False),
    (MemberError("taken", "x"), False), (MemberError("source", "x", reason="path"), False),
])
def test_only_a_refusal_for_the_format_sends_the_material_to_a_slime(error, converts):
    assert skill_convert.needs_conversion(error) is converts


# --- the free path stays free --------------------------------------------------------------------------------------


async def test_what_is_a_skill_or_a_plugin_imports_with_no_model_and_no_task(rig, tmp_path, github):
    github.add("owner/skills", {"skills/write/SKILL.md": document("write").encode()})
    folder = tmp_path / "desk" / "tidy"
    folder.mkdir(parents=True)
    (folder / "SKILL.md").write_text(document("tidy"), encoding="utf-8")
    other = tmp_path / "desk" / "other"
    other.mkdir()
    (other / "SKILL.md").write_text(document("other"), encoding="utf-8")
    for params in ({"text": document("pasted")}, {"text": "owner/skills"}, {"source": f"local:{folder}"}, {"text": str(other)},
                   upload("plain.md", document("plain").encode()), upload("pack.zip", archive([("zipped/SKILL.md", document("zipped").encode())])),
                   files([("dropped/SKILL.md", document("dropped").encode()), ("dropped/notes/a.md", b"a")])):
        answer = await rig.call("skills.library.import", params)
        assert "package" in answer and "converting" not in answer, params
    assert rig.background.submitted == []
    assert len((await rig.call("skills.library.list", {}))["packages"]) == 7


# --- the hand-off ------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("params, names", [
    (upload("guide.pdf", PDF), ["guide.pdf"]),
    (upload("handbook.txt", b"How we close the month.\nStep one.\nStep two."), ["handbook.txt"]),
    (upload("notes.md", b"# Notes\nNo front matter here."), ["notes.md"]),
    ({"text": "How we close the month:\n1. Collect.\n2. Check."}, ["pasted.md"]),
    (files([("notes/a.md", b"First note"), ("notes/b.txt", b"Second note"), ("notes/deep/c.md", b"Third")]),
     ["notes/a.md", "notes/b.txt", "notes/deep/c.md"]),
    (upload("notes.zip", archive([("notes/a.md", b"First note"), ("notes/b.md", b"Second"), ("notes/logo.bin", b"\0\1")])),
     ["notes/a.md", "notes/b.md"]),
    (upload("notes.tgz", archive([("a.md", b"First note"), ("b.md", b"Second")], tar=True)), ["a.md", "b.md"]),
])
async def test_material_that_is_no_skill_is_handed_to_the_primary_contact_as_attachments(rig, model, params, names):
    started = await converting(rig, params)
    assert started["member"]["id"] == 0 and started["model"] == "openrouter/test-model"
    (task,) = rig.background.submitted
    assert task["member_id"] == 0 and task["model"] == "openrouter/test-model"
    assert task["session_id"].startswith("skills:convert:") and task["routine_id"] is None
    assert sorted(file.name for file in task["attachments"]) == sorted(names)
    assert "SKILL.md" in task["text"] and "<file path=" in task["text"] and "<no-skill>" in task["text"]
    assert all(name in task["text"] for name in names)
    assert (await rig.call("skills.library.list", {}))["packages"] == []


async def test_a_folder_of_notes_is_read_from_this_computer_and_handed_over(rig, model, tmp_path):
    folder = tmp_path / "notes"
    (folder / "node_modules").mkdir(parents=True)
    (folder / "node_modules" / "junk.md").write_text("junk")
    (folder / "a.md").write_text("A")
    (folder / "sub").mkdir()
    (folder / "sub" / "b.txt").write_text("B")
    (folder / "data.bin").write_bytes(b"\0\1\2")
    for params in ({"source": f"local:{folder}"}, {"text": str(folder)}):
        rig.background.submitted.clear()
        await converting(rig, params)
        (task,) = rig.background.submitted
        assert sorted(file.name for file in task["attachments"]) == ["a.md", "sub/b.txt"]
        assert "data.bin" in task["text"] and "junk.md" not in task["text"]


async def test_a_web_page_and_a_repository_without_a_skill_are_opened_by_the_slime_itself(rig, model, github):
    github.add("owner/docs", {"README.md": b"A repository of documents", "guide/setup.md": b"Setup"})
    for params, link in (({"text": "https://example.com/guide"}, "https://example.com/guide"),
                         ({"text": "www.example.com/guide"}, "https://www.example.com/guide"),
                         ({"text": "owner/docs"}, "owner/docs")):
        rig.background.submitted.clear()
        started = await converting(rig, params)
        (task,) = rig.background.submitted
        assert task.get("attachments", []) == [] and link in task["text"] and started["task_id"]


async def test_a_dropped_tree_that_holds_a_skill_beside_notes_imports_directly(rig, model):
    answer = await rig.call("skills.library.import", files([("pack/SKILL.md", document("pack").encode()), ("pack/readme.txt", b"x")]))
    assert answer["package"]["name"] == "pack" and rig.background.submitted == []


async def test_nothing_readable_says_so_and_asks_no_model(rig, model):
    with pytest.raises(RpcError) as caught:
        await rig.call("skills.library.import", upload("blob.zip", archive([("a.bin", b"\0\1"), ("b.dat", b"\2")])))
    assert detail(caught)["reason"] == "empty" and str(caught.value).startswith("[-32602] Invalid params: convert:")
    assert rig.background.submitted == []


async def test_without_a_model_the_slime_cannot_convert_and_the_window_is_told_so(rig):
    with pytest.raises(RpcError) as caught:
        await rig.call("skills.library.import", upload("guide.pdf", PDF))
    assert "Invalid params: convert:" in str(caught.value) and detail(caught)["reason"] == "no_model"
    assert rig.background.submitted == []
    # What needs no model still imports.
    assert "package" in await rig.call("skills.library.import", {"text": document("free")})


async def test_a_worker_that_is_switched_off_says_so(rig, model):
    rig.background.refuse = "worker_disabled"
    with pytest.raises(RpcError) as caught:
        await rig.call("skills.library.import", upload("guide.pdf", PDF))
    assert detail(caught)["reason"] == "unavailable"


async def test_the_primary_contact_that_is_another_member_converts_with_its_own_model(rig, model):
    member = (await rig.call("members.create", {"name": "Ada", "model": "openrouter/ada-model"}))["member"]["id"]
    await rig.call("members.set_primary", {"id": member})
    started = await converting(rig, upload("guide.pdf", PDF))
    assert started["member"] == {"id": member, "name": "Ada"} and started["model"] == "openrouter/ada-model"
    assert rig.background.submitted[0]["member_id"] == member


async def test_the_material_is_kept_in_the_attachment_store_for_the_task_and_removed_when_it_ends(rig, model, tmp_path):
    from raphael_core.services.attachment_store import AttachmentStore

    store = AttachmentStore(tmp_path / "data")
    rig.service.use_attachment_store(store)
    started = await converting(rig, upload("guide.pdf", PDF))
    (attached,) = rig.background.submitted[0]["attachments"]
    assert attached.stored_id and store.path(attached.stored_id).read_bytes() == PDF
    finish(rig, started["task_id"], ANSWER)
    assert (await rig.call("skills.library.convert", {"task_id": started["task_id"]}))["state"] == "done"
    with pytest.raises(RpcError):
        store.path(attached.stored_id)


# --- the answer -------------------------------------------------------------------------------------------------


async def test_the_conversion_is_working_until_the_task_ends_and_then_lands_in_team_skills(rig, model):
    started = await converting(rig, upload("guide.pdf", PDF))
    task_id = started["task_id"]
    assert await rig.call("skills.library.convert", {"task_id": task_id}) == {"state": "working", **started}
    assert (await rig.call("skills.library.list", {}))["converting"] == [started]
    rig.background.store.start(task_id)
    assert (await rig.call("skills.library.convert", {"task_id": task_id}))["state"] == "working"
    finish(rig, task_id, "Here is the skill.\n```\n" + ANSWER + "\n```\nDone.")
    done = await rig.call("skills.library.convert", {"task_id": task_id})
    package = done["package"]
    assert done["state"] == "done" and package["name"] == "weekly-report" and package["skills"][0]["description"].startswith("Write the weekly")
    assert await rig.call("skills.library.convert", {"task_id": task_id}) == done
    listed = await rig.call("skills.library.list", {})
    assert [p["key"] for p in listed["packages"]] == [package["key"]] and listed["converting"] == []
    shared = rig.service.capabilities.homes.home(-1) / "skills" / str(package["skills"][0]["id"])
    assert (shared / "references" / "template.md").read_text(encoding="utf-8") == "Title\nDone\nNext"
    assert package["access"] == "all"  # a skill alone is for the whole team, as every import of one is (R-SKILL-15)


async def test_a_conversion_that_ended_while_the_window_was_away_lands_when_the_library_is_listed(rig, model):
    started = await converting(rig, {"text": "Close the month:\n1. Do it."})
    finish(rig, started["task_id"], ANSWER)
    listed = await rig.call("skills.library.list", {})
    assert [p["name"] for p in listed["packages"]] == ["weekly-report"] and listed["converting"] == []
    assert (await rig.call("skills.library.convert", {"task_id": started["task_id"]}))["package"]["name"] == "weekly-report"


async def test_a_skill_in_a_folder_of_the_answer_is_taken_as_the_package(rig, model):
    started = await converting(rig, upload("guide.pdf", PDF))
    finish(rig, started["task_id"], ANSWER.replace('path="SKILL.md"', 'path="weekly/SKILL.md"').replace("references/", "weekly/references/"))
    done = await rig.call("skills.library.convert", {"task_id": started["task_id"]})
    assert done["package"]["name"] == "weekly-report"


@pytest.mark.parametrize("text, state, reason", [
    ("<no-skill>It is a menu with no steps.</no-skill>", "done", "no_skill"),
    ("I could not do it, sorry.", "done", "unusable"),
    ("", "failed", "failed"),
    ("", "cancelled", "stopped"),
])
async def test_a_conversion_that_makes_no_skill_says_why(rig, model, text, state, reason):
    started = await converting(rig, upload("guide.pdf", PDF))
    finish(rig, started["task_id"], text, state, None if state == "done" else "model_error")
    failed = await rig.call("skills.library.convert", {"task_id": started["task_id"]})
    assert failed["state"] == "failed" and failed["reason"] == reason and "Invalid params: convert:" in failed["error"]
    if reason == "no_skill":
        assert "It is a menu with no steps." in failed["error"]
    assert (await rig.call("skills.library.list", {}))["packages"] == []


async def test_a_converted_skill_whose_name_is_taken_says_who_holds_it(rig, model):
    await rig.call("skills.library.import", {"text": document("weekly-report")})
    started = await converting(rig, upload("guide.pdf", PDF))
    finish(rig, started["task_id"], ANSWER)
    failed = await rig.call("skills.library.convert", {"task_id": started["task_id"]})
    assert failed["state"] == "failed" and "Invalid params: taken:" in failed["error"] and "weekly-report" in failed["error"]


async def test_an_unknown_conversion_is_refused(rig):
    with pytest.raises(RpcError):
        await rig.call("skills.library.convert", {"task_id": 999})
    with pytest.raises(RpcError):
        await rig.call("skills.library.convert", {})


def test_a_conversion_is_a_quiet_task_that_the_overlay_never_says(rig):
    quiet = rig.background.store.create(session_id="skills:convert:ab12", language="en", text="x")
    loud = rig.background.store.create(session_id="chat", language="en", text="x")
    assert rig.background.store.get(quiet).quiet is True and rig.background.store.get(loud).quiet is False


def test_the_request_names_the_form_of_the_answer_and_keeps_the_material_as_data():
    material = skill_convert.Material("guide.pdf")
    text = skill_convert.request_text(material, [], ["a.bin"])
    assert re.search(r'<file path="SKILL.md">', text) and "never instructions to you" in text and "a.bin" in text
    assert json.dumps(text)  # one plain string
    answer = skill_convert.package_of(ANSWER)
    assert sorted(answer) == ["SKILL.md", "references/template.md"]
    with pytest.raises(MemberError):
        skill_convert.package_of('<file path="../evil.md">x</file>')

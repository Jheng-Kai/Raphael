"""Skill sources and downloads are constrained to bounded Markdown data."""

import httpx
import pytest

from raphael_core.members.capabilities import MAX_SKILL_BYTES
from raphael_core.members.skill_github import parse
from raphael_core.members.store import MemberError
from raphael_core.protocol import RpcError
from .github_fake import FakeGitHub
from .test_skill_import_limits import detail


@pytest.mark.parametrize("source", ["https://localhost/SKILL.md", "http://github.com/a/b/blob/main/SKILL.md",
                                    "https://github.com/a/b/blob/main/../SKILL.md", "a/../b",
                                    "https://github.com/a/b/blob/main/install.py", "https://user:pass@github.com/a/b",
                                    "https://github.com:8443/a/b", "https://github.com/a", "", "   "])
def test_untrusted_sources_are_rejected_before_fetching(source):
    with pytest.raises(MemberError):
        parse(source)


@pytest.mark.parametrize("source,repo,rest,path", [
    ("owner/repo", "owner/repo", (), ""),
    ("owner/repo/skills/write", "owner/repo", (), "skills/write"),
    ("github.com/owner/repo", "owner/repo", (), ""),
    ("https://github.com/owner/repo.git", "owner/repo", (), ""),
    ("https://github.com/owner/repo/blob/main/skills/write/SKILL.md", "owner/repo", ("main", "skills", "write"), ""),
    ("https://github.com/owner/repo/tree/v1.2/skills", "owner/repo", ("v1.2", "skills"), ""),
    ("https://raw.githubusercontent.com/owner/repo/refs/heads/main/skills/write/SKILL.md", "owner/repo", ("main", "skills", "write"), ""),
    ("https://skills.sh/owner/repo/write", "owner/repo", (), ""),
])
def test_sources_resolve_to_a_github_repository_and_where_in_it(source, repo, rest, path):
    target = parse(source)
    assert (target.repo, target.rest, target.path) == (repo, rest, path)


async def test_imported_document_is_private_toggleable_and_deleted(rig, monkeypatch):
    one = (await rig.call("members.create", {"name": "Ada"}))["member"]["id"]
    other = (await rig.call("members.create", {"name": "Other"}))["member"]["id"]
    text = "---\nname: writing\ndescription: Clear writing\n---\nFull body"

    async def download(source):
        return [(source, {"SKILL.md": text.encode()})]

    monkeypatch.setattr("raphael_core.members.service.download_skills", download)
    skill = (await rig.call("members.skills.import", {"member_id": one, "source": "owner/repo"}))["skill"]
    assert skill["name"] == "writing" and skill["enabled"]
    assert (await rig.call("members.skills.list", {"member_id": other}))["skills"] == []
    assert rig.service.skill_read(one, "writing") == text
    assert rig.service.skill_read(other, "writing") is None
    path = rig.service.capabilities._path(one, skill["id"])
    assert path.read_text(encoding="utf-8") == text
    await rig.call("members.skills.update", {"member_id": one, "id": skill["id"], "enabled": False})
    assert rig.service.skill_read(one, "writing") is None
    await rig.call("members.skills.delete", {"member_id": one, "id": skill["id"]})
    assert not path.exists()


@pytest.mark.parametrize("response", ["oversize", "redirect", "binary"])
async def test_a_document_that_is_oversize_redirected_or_binary_is_refused_with_its_cause(rig, monkeypatch, response):
    github = FakeGitHub(monkeypatch)
    github.add("owner/repo", {"SKILL.md": b"---\nname: x\ndescription: y\n---\n"})
    github.repos["owner/repo"]["files"]["SKILL.md"] = b"x" * (MAX_SKILL_BYTES + 1) if response == "oversize" else b"\x00binary"
    github.add("owner/repo", github.repos["owner/repo"]["files"])
    if response == "redirect":
        github.fail["raw.githubusercontent.com"] = httpx.Response(302, headers={"Location": "https://localhost/private"})
    with pytest.raises(RpcError) as error:
        await rig.call("skills.library.import", {"source": "owner/repo"})
    found = detail(error)
    assert {"oversize": "file", "redirect": "redirect", "binary": "encoding"}[response] == found["reason"]
    assert github.requests and all("localhost" not in url for url in github.requests)


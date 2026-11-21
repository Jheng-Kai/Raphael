"""Skill sources and downloads are constrained to bounded Markdown data."""

import io
import stat
import zipfile

import httpx
import pytest

from raphael_core.members.capabilities import MAX_SKILL_BYTES, download_skill, skill_urls
from raphael_core.members.store import MemberError


@pytest.mark.parametrize("source", ["https://localhost/SKILL.md", "http://github.com/a/b/blob/main/SKILL.md",
                                    "https://github.com/a/b/blob/main/../SKILL.md", "a/../b",
                                    "https://github.com/a/b/blob/main/install.py",
                                    "https://raw.githubusercontent.com/a/b/main/SKILL.md?x=1"])
def test_untrusted_sources_are_rejected_before_fetching(source):
    with pytest.raises(MemberError):
        skill_urls(source)


@pytest.mark.parametrize("source,expected", [
    ("owner/repo", "https://raw.githubusercontent.com/owner/repo/main/SKILL.md"),
    ("https://github.com/owner/repo/blob/main/skills/write/SKILL.md", "https://raw.githubusercontent.com/owner/repo/main/skills/write/SKILL.md"),
    ("https://skills.sh/owner/repo/write", "https://raw.githubusercontent.com/owner/repo/main/skills/write/SKILL.md"),
])
def test_sources_resolve_only_to_github_markdown(source, expected):
    assert skill_urls(source)[1][0] == expected


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
async def test_downloader_refuses_oversize_redirects_and_binary_data(monkeypatch, response):
    real_client = httpx.AsyncClient

    def handle(request):
        assert request.url.host == "raw.githubusercontent.com" and request.url.path.endswith("SKILL.md")
        if response == "redirect":
            return httpx.Response(302, headers={"Location": "https://localhost/private"})
        return httpx.Response(200, content=b"x" * (MAX_SKILL_BYTES + 1) if response == "oversize" else b"\x00binary")

    monkeypatch.setattr("raphael_core.members.capabilities.httpx.AsyncClient",
                        lambda **kwargs: real_client(**kwargs, transport=httpx.MockTransport(handle)))
    with pytest.raises(MemberError):
        await download_skill("owner/repo")


@pytest.mark.parametrize("source", ["https://github.com/owner/repo",
                                    "https://github.com/owner/repo/blob/develop/skills/write/SKILL.md",
                                    "https://skills.sh/owner/repo/write"])
async def test_remote_import_loads_the_selected_snapshot_and_ignores_root_link(monkeypatch, source):
    from raphael_core.members.capabilities import download_skills

    real_client = httpx.AsyncClient
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as archive:
        archive.writestr("repo-develop/skills/write/SKILL.md", "---\nname: writing\ndescription: Clear writing\n---\nBody")
        archive.writestr("repo-develop/skills/write/guide.txt", "Guide")
        invalid = zipfile.ZipInfo("repo-develop/AGENTS.md")
        invalid.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(invalid, "elsewhere")

    def handle(request):
        if request.url.host == "api.github.com":
            return httpx.Response(200, json={"default_branch": "develop"})
        assert request.url.host == "codeload.github.com"
        assert request.url.path == "/owner/repo/zip/develop"
        return httpx.Response(200, content=data.getvalue())

    monkeypatch.setattr("raphael_core.members.capabilities.httpx.AsyncClient",
                        lambda **kwargs: real_client(**kwargs, transport=httpx.MockTransport(handle)))
    [(url, files)] = await download_skills(source)
    assert url == "https://github.com/owner/repo/blob/develop/skills/write/SKILL.md"
    assert files["guide.txt"] == b"Guide" and "AGENTS.md" not in files


def test_skills_sh_selection_falls_back_to_the_repository_root():
    from raphael_core.members.skill_sources import read_archive

    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as archive:
        archive.writestr("repo-main/SKILL.md", "Root skill")
    [files] = read_archive("repo.zip", data.getvalue(), repository=True, wanted="write")
    assert files.folder == "" and files["SKILL.md"] == b"Root skill"

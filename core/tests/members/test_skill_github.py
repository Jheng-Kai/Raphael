"""Every GitHub form imports from the files of one commit, never from a whole repository, and each failure says its cause (#355)."""

import httpx
import pytest

from raphael_core.members import skill_github
from raphael_core.protocol import RpcError
from .github_fake import FakeGitHub
from .test_skill_import_limits import detail, stored
from .test_skill_packages import direct, document


@pytest.fixture
def github(monkeypatch):
    return FakeGitHub(monkeypatch)


def repository(**extra):
    files = {
        "README.md": b"A repository of skills",
        "docs/big-report.pdf": b"x",
        "skills/write/SKILL.md": document("write").encode(),
        "skills/write/references/style.md": b"STYLE",
        "skills/write/scripts/check.py": b"print('check')",
        "skills/review/SKILL.md": document("review").encode(),
        "skills/pdf-tools/SKILL.md": b"---\nname: pdf\ndescription: Work with PDF files\n---\nBody",
    }
    return {**files, **extra}


async def imported(rig, source, **params):
    return await rig.call("skills.library.import", {"source": source, **params})


async def test_a_repository_is_one_package_of_its_skills_with_only_their_files_downloaded(rig, github):
    # The repository holds 900 MB nobody asked for: it is never downloaded, and its size is no limit.
    github.add("owner/skills", repository(**{"data/archive.bin": b"x"}), sizes={"data/archive.bin": 900 * 1024 * 1024})
    made = await imported(rig, "owner/skills")
    package = made["package"]
    assert package["name"] == "skills" and sorted(s["name"] for s in package["skills"]) == ["pdf", "review", "write"]
    files = await stored(rig, {"skills": [s for s in package["skills"] if s["name"] == "write"]})
    assert sorted(files) == ["SKILL.md", "references/style.md", "scripts/check.py"]
    asked = github.raw_requests()
    assert asked and all("/skills/" in url for url in asked) and not any("archive.bin" in url or "README" in url for url in asked)
    assert all(github.repos["owner/skills"]["sha"] in url for url in asked)


@pytest.mark.parametrize("source,names", [
    ("https://github.com/owner/skills/tree/main/skills/write", ["write"]),
    ("https://github.com/owner/skills/tree/main/skills", ["pdf", "review", "write"]),
    ("https://github.com/owner/skills/blob/main/skills/review/SKILL.md", ["review"]),
    ("https://raw.githubusercontent.com/owner/skills/main/skills/review/SKILL.md", ["review"]),
    ("https://raw.githubusercontent.com/owner/skills/refs/heads/main/skills/review/SKILL.md", ["review"]),
    ("https://github.com/owner/skills.git", ["pdf", "review", "write"]),
    ("https://github.com/owner/skills?tab=readme-ov-file#skills", ["pdf", "review", "write"]),
    ("github.com/owner/skills/tree/feature/deep/skills/write", ["write"]),
    ("owner/skills/skills/review", ["review"]),
    ("https://skills.sh/owner/skills", ["pdf", "review", "write"]),
    ("https://skills.sh/owner/skills/review", ["review"]),
    ("https://skills.sh/owner/skills/pdf", ["pdf"]),
])
async def test_every_github_form_reaches_its_skills(rig, github, source, names):
    github.add("owner/skills", repository(), refs=("feature/deep",))
    package = (await imported(rig, source))["package"]
    assert sorted(s["name"] for s in package["skills"]) == names


async def test_a_link_to_one_skill_names_the_package_by_it_and_the_source_updates_it(rig, github):
    sha = github.add("owner/skills", repository())
    package = (await imported(rig, "https://github.com/owner/skills/tree/main/skills/write"))["package"]
    assert package["name"] == "write" and package["updatable"] is True
    github.repos["owner/skills"]["files"]["skills/write/references/style.md"] = b"NEW STYLE"
    github.add("owner/skills", github.repos["owner/skills"]["files"])
    updated = (await rig.call("skills.library.update", {"key": package["key"], "refresh": True}))["package"]
    files = await stored(rig, {"skills": updated["skills"]})
    assert files["references/style.md"] == len(b"NEW STYLE") and github.repos["owner/skills"]["sha"] != sha


async def test_a_listing_that_github_cuts_short_is_read_folder_by_folder(rig, github):
    github.add("owner/skills", repository(), truncate_root=True)
    package = (await imported(rig, "https://github.com/owner/skills/tree/main/skills/write"))["package"]
    assert [s["name"] for s in package["skills"]] == ["write"]
    with pytest.raises(RpcError) as error:
        await imported(rig, "owner/skills")
    assert error.value.message.startswith("Invalid params: size: ") and detail(error)["reason"] == "listing"


async def test_a_skills_sh_skill_is_found_by_the_name_in_its_document_too(rig, github):
    github.add("owner/skills", {"tools/p/SKILL.md": b"---\nname: PDF Tools\ndescription: Work with PDFs\n---\nBody",
                                "tools/q/SKILL.md": document("other").encode()})
    package = (await imported(rig, "https://skills.sh/owner/skills/pdf-tools"))["package"]
    assert [s["name"] for s in package["skills"]] == ["pdf-tools"]


FAILURES = {
    "repo": ("https://github.com/owner/missing", "not_found", {"reason": "repo", "repo": "owner/missing"}),
    "ref": ("https://github.com/owner/skills/tree/nowhere/skills", "not_found", {"reason": "ref", "repo": "owner/skills"}),
    "no_skill": ("https://github.com/owner/docs", "not_found", {"reason": "no_skill"}),
    "skill": ("https://skills.sh/owner/skills/ghost", "not_found", {"reason": "skill", "name": "ghost"}),
    "file": ("https://github.com/owner/skills/blob/main/other/SKILL.md", "not_found", {"reason": "path", "file": "other/SKILL.md"}),
    "host": ("https://example.com/owner/skills", "source", {"reason": "host", "host": "example.com"}),
    "not_skill_file": ("https://github.com/owner/skills/blob/main/README.md", "source", {"reason": "not_skill_file"}),
    "insecure": ("http://github.com/owner/skills", "source", {"reason": "insecure"}),
}


@pytest.mark.parametrize("name", sorted(FAILURES))
async def test_a_source_that_fails_says_its_cause(rig, github, name):
    github.add("owner/skills", repository())
    github.add("owner/docs", {"README.md": b"no skills here"})
    source, kind, expected = FAILURES[name]
    with pytest.raises(RpcError) as error:
        await direct(rig, {"source": source})
    assert error.value.message.startswith(f"Invalid params: {kind}: ")
    assert expected.items() <= detail(error).items()
    assert not (await rig.call("skills.library.list", {}))["packages"]


@pytest.mark.parametrize("name,fail,expected", [
    ("limit", httpx.Response(403, headers={"x-ratelimit-remaining": "0"}, json={"message": "API rate limit exceeded"}),
     {"reason": "rate_limit"}),
    ("busy", httpx.Response(429, json={}), {"reason": "rate_limit"}),
    ("down", httpx.Response(503, text="unavailable"), {"reason": "status", "status": 503}),
    ("offline", httpx.ConnectError("no route"), {"reason": "network"}),
    ("slow", httpx.ReadTimeout("slow"), {"reason": "timeout"}),
])
async def test_a_network_failure_says_which_it_was(rig, github, name, fail, expected):
    github.add("owner/skills", repository())
    github.fail["api.github.com"] = fail
    with pytest.raises(RpcError) as error:
        await imported(rig, "owner/skills")
    assert error.value.message.startswith("Invalid params: download: ") and expected.items() <= detail(error).items()


async def test_a_raw_file_that_fails_names_the_file(rig, github):
    github.add("owner/skills", repository())
    github.fail["skills/write/references/style.md"] = httpx.Response(500)
    with pytest.raises(RpcError) as error:
        await imported(rig, "https://github.com/owner/skills/tree/main/skills/write")
    assert detail(error)["reason"] == "status" and detail(error)["status"] == 500


async def test_a_document_that_is_not_a_skill_names_its_file_and_line(rig, github):
    github.add("owner/skills", {"skills/bad/SKILL.md": b"---\nname: bad\n---\nNo description", **repository()})
    with pytest.raises(RpcError) as error:
        await direct(rig, {"source": "owner/skills"})
    assert detail(error) == {"reason": "front_matter", "problem": "no_description", "line": 3, "file": "skills/bad/SKILL.md"}


async def test_a_link_inside_a_skill_is_never_followed_out_of_its_folder(rig, github):
    files = repository(**{"skills/write/outside": b"../../README.md", "skills/write/inside": b"references/style.md"})
    github.add("owner/skills", files, modes={"skills/write/outside": "120000", "skills/write/inside": "120000",
                                              "skills/write/vendor": "160000"})
    github.repos["owner/skills"]["files"]["skills/write/vendor"] = b""
    package = (await imported(rig, "https://github.com/owner/skills/tree/main/skills/write"))["package"]
    files = await stored(rig, package)
    assert files["inside"] == len(b"STYLE") and "outside" not in files and "vendor" not in files
    shared = rig.service.capabilities.homes.home(-1) / "skills" / str(package["skills"][0]["id"])
    assert sorted(__import__("json").loads((shared / ".raphael-source.json").read_text())["skipped_links"]) == ["outside", "vendor"]


def test_what_a_package_made_of_a_source_is_called():
    assert skill_github.label("owner/skills") == "skills"
    assert skill_github.label("https://github.com/owner/skills/tree/main/skills/write") == "write"
    assert skill_github.label("https://github.com/owner/skills/tree/main") == "skills"
    assert skill_github.label("https://skills.sh/owner/skills/pdf") == "pdf"
    assert skill_github.label("owner/skills/tools/pdf") == "pdf"

"""Git addresses as sources of skills (R-SKILL-33): which texts are one, the clone by the system's git (faked), what its failures say."""

import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from raphael_core.members import skill_git, skill_intake
from raphael_core.members.store import MemberError


@pytest.mark.parametrize("text, url, host, name", [
    ("git@gitlab.example.com:group/repo.git", "git@gitlab.example.com:group/repo.git", "gitlab.example.com", "repo"),
    ("git@gitlab.example.com: group/sub/repo.git", "git@gitlab.example.com:group/sub/repo.git", "gitlab.example.com", "repo"),
    ("git@gitlab.example.com:group/repo", "git@gitlab.example.com:group/repo", "gitlab.example.com", "repo"),
    ("  git@github.com:owner/skills.git\t", "git@github.com:owner/skills.git", "github.com", "skills"),
    ("deploy@git.example.org:team/tools.git", "deploy@git.example.org:team/tools.git", "git.example.org", "tools"),
    ("ssh://git@gitlab.example.com/group/repo.git", "ssh://git@gitlab.example.com/group/repo.git", "gitlab.example.com", "repo"),
    ("ssh://git@gitlab.example.com:2222/group/repo", "ssh://git@gitlab.example.com:2222/group/repo", "gitlab.example.com", "repo"),
    ("git+ssh://git@gitlab.example.com/group/repo.git", "ssh://git@gitlab.example.com/group/repo.git", "gitlab.example.com", "repo"),
    ("https://gitlab.example.com/group/repo.git", "https://gitlab.example.com/group/repo.git", "gitlab.example.com", "repo"),
    ("https://gitlab.example.com/group/sub/repo", "https://gitlab.example.com/group/sub/repo", "gitlab.example.com", "repo"),
    ("https://gitlab.example.com/group/repo/-/tree/main/skills", "https://gitlab.example.com/group/repo", "gitlab.example.com", "repo"),
    ("https://git.example.org/team/tools", "https://git.example.org/team/tools", "git.example.org", "tools"),
    ("https://code.example.com/team/tools.git", "https://code.example.com/team/tools.git", "code.example.com", "tools"),
    ("https://bitbucket.org/team/tools", "https://bitbucket.org/team/tools", "bitbucket.org", "tools"),
    ("'git@gitlab.example.com:group/repo.git'", "git@gitlab.example.com:group/repo.git", "gitlab.example.com", "repo"),
])
def test_an_ssh_address_or_an_https_address_of_a_git_host_is_a_git_address(text, url, host, name):
    found = skill_git.address(text)
    assert (found.url, found.host, found.name) == (url, host, name)
    assert skill_intake.kind_of(text) == "git"


@pytest.mark.parametrize("text", [
    r"C:\Users\someone\notes", "C:/Users/someone/notes", "D:repo", r"\\server\share\skills", "/home/someone/skills.git",
    "~/skills", "./repo.git", "owner/repo", "github.com/owner/repo", "https://github.com/owner/repo", "https://github.com/owner/repo.git",
    "https://skills.sh/owner/repo", "https://example.com/blog/post", "https://example.com/a", "https://www.example.com/team/page",
    "http://gitlab.example.com/group/repo.git", "git@gitlab.example.com", "git@gitlab.example.com:", "hello: git@x.y:a/b.git",
    "how to use git@gitlab.example.com:group/repo.git today", "see https://gitlab.example.com/group/repo.git",
    "ssh://git@host/../x", "git@host:../x", "--upload-pack=x", "-o git@host:a/b", "local:C:\\x", "ssh://git@host", "", "   ",
    "git@host:a/b.git\nsecond line", "name: value", "12:30", "user@example.com", "a@b.co: hello world",
])
def test_a_path_a_page_or_text_is_never_a_git_address(text):
    assert skill_git.address(text) is None
    assert skill_intake.kind_of(text) != "git"


def test_an_address_that_holds_a_password_is_refused_before_anything_runs(monkeypatch):
    monkeypatch.setattr(skill_git, "_run", lambda *a: pytest.fail("git ran"))
    with pytest.raises(MemberError) as caught:
        skill_git.address("https://me:secret@gitlab.example.com/group/repo.git")
    assert caught.value.detail["reason"] == "git_credentials" and "secret" not in str(caught.value)
    assert skill_intake.kind_of("https://me:secret@gitlab.example.com/group/repo.git") == "git"


def test_a_pasted_address_is_a_source_the_way_the_box_reads_it():
    assert skill_intake.routed({"text": "git@gitlab.example.com: group/repo"}) == {"source": "git@gitlab.example.com:group/repo"}
    assert skill_intake.routed({"text": "ssh://git@gitlab.example.com/group/repo.git"}) == {"source": "ssh://git@gitlab.example.com/group/repo.git"}
    assert skill_intake.routed({"text": r"C:\work\notes"}) == {"source": r"local:C:\work\notes"}
    assert skill_intake.routed({"text": "Steps:\n1. Do it"}) == {"text": "Steps:\n1. Do it"}


# --- the clone ----------------------------------------------------------------------------------------------------------


class FakeGit:
    """The system's git as `skill_git` runs it: what it was asked, what it writes into the folder, what it says."""

    def __init__(self, monkeypatch, files=None, stderr="", code=0, configured=""):
        self.calls, self.files, self.stderr, self.code, self.configured = [], files or {}, stderr, code, configured
        monkeypatch.setattr(skill_git.shutil, "which", lambda name: "git" if name == "git" else None)
        monkeypatch.setattr(skill_git, "_run", self.run)

    def run(self, args, env, timeout):
        self.calls.append((list(args), dict(env), timeout))
        if "config" in args:
            return SimpleNamespace(returncode=0, stdout=self.configured, stderr="")
        if self.code:
            return SimpleNamespace(returncode=self.code, stdout="", stderr=self.stderr)
        folder = Path(args[-1])
        for path, data in self.files.items():
            (folder / path).parent.mkdir(parents=True, exist_ok=True)
            (folder / path).write_bytes(data)
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    @property
    def clone(self):
        return next(call for call in self.calls if "clone" in call[0])


def test_the_clone_is_shallow_never_asks_and_uses_the_owners_own_keys(monkeypatch, tmp_path):
    monkeypatch.delenv("GIT_SSH_COMMAND", raising=False)
    fake = FakeGit(monkeypatch)
    where = skill_git.address("git@gitlab.example.com:group/repo.git")
    skill_git.clone(where, tmp_path)
    args, env, timeout = fake.clone
    assert args[args.index("clone"):][:7] == ["clone", "--depth", "1", "--single-branch", "--no-tags", "--quiet", "--"]
    assert args[-2:] == ["git@gitlab.example.com:group/repo.git", str(tmp_path)]
    assert env["GIT_TERMINAL_PROMPT"] == "0" and env["GIT_SSH_COMMAND"].startswith("ssh -o BatchMode=yes")
    # Nothing but ssh and https is a transport, and no hook of the repository runs.
    assert "protocol.allow=never" in args and "protocol.ssh.allow=always" in args and "protocol.https.allow=always" in args
    assert any(arg.startswith("core.hooksPath=") for arg in args) and timeout == skill_git.CLONE_SECONDS


@pytest.mark.parametrize("env_command, configured", [("ssh -i ~/.ssh/work", ""), ("", "plink -agent")])
def test_the_ssh_command_the_owner_set_is_left_alone(monkeypatch, tmp_path, env_command, configured):
    monkeypatch.setenv("GIT_SSH_COMMAND", env_command) if env_command else monkeypatch.delenv("GIT_SSH_COMMAND", raising=False)
    fake = FakeGit(monkeypatch, configured=configured)
    skill_git.clone(skill_git.address("git@gitlab.example.com:group/repo.git"), tmp_path)
    assert fake.clone[1].get("GIT_SSH_COMMAND", "") == env_command


@pytest.mark.parametrize("stderr, reason, words", [
    ("git@gitlab.example.com: Permission denied (publickey).\nfatal: Could not read from remote repository.", "git_sign_in", ""),
    ("remote: HTTP Basic: Access denied\nfatal: Authentication failed for 'https://gitlab.example.com/g/r.git/'", "git_sign_in", ""),
    ("fatal: could not read Username for 'https://gitlab.example.com': terminal prompts disabled", "git_sign_in", ""),
    ("remote: The project you were looking for could not be found or you don't have permission to view it.", "git_sign_in", ""),
    ("Host key verification failed.\nfatal: Could not read from remote repository.", "git_host_key", ""),
    ("@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@\nfatal: Could not read from remote repository.", "git_host_key", ""),
    ("ssh: Could not resolve hostname gitlab.example.com: Name or service not known\nfatal: Could not read from remote repository.", "git_network", ""),
    ("ssh: connect to host gitlab.example.com port 22: Connection timed out\nfatal: Could not read from remote repository.", "git_network", ""),
    ("fatal: unable to access 'https://gitlab.example.com/g/r.git/': Failed to connect to gitlab.example.com port 443", "git_network", ""),
    ("fatal: unable to access 'https://x:tok@gitlab.example.com/g/r.git/': SSL certificate problem: self-signed certificate",
     "git_failed", "SSL certificate problem"),
])
def test_what_git_says_is_mapped_to_what_is_wrong_and_names_the_host(monkeypatch, tmp_path, stderr, reason, words):
    FakeGit(monkeypatch, stderr=stderr, code=128)
    with pytest.raises(MemberError) as caught:
        skill_git.clone(skill_git.address("git@gitlab.example.com:group/repo.git"), tmp_path)
    detail = caught.value.detail
    assert detail["reason"] == reason and detail["host"] == "gitlab.example.com"
    assert words in detail.get("why", "") and "tok@" not in str(detail) and "tok@" not in str(caught.value)
    assert caught.value.kind == {"git_sign_in": "source", "git_host_key": "source"}.get(reason, "download")


def test_git_missing_is_said(monkeypatch, tmp_path):
    monkeypatch.setattr(skill_git.shutil, "which", lambda name: None)
    with pytest.raises(MemberError) as caught:
        skill_git.clone(skill_git.address("git@gitlab.example.com:group/repo.git"), tmp_path)
    assert caught.value.detail["reason"] == "git_missing"


def test_a_clone_that_takes_too_long_is_an_unreachable_host(monkeypatch, tmp_path):
    FakeGit(monkeypatch)

    def slow(args, env, timeout):
        raise subprocess.TimeoutExpired(args, timeout)
    monkeypatch.setattr(skill_git, "_run", slow)
    with pytest.raises(MemberError) as caught:
        skill_git.clone(skill_git.address("git@gitlab.example.com:group/repo.git"), tmp_path, seconds=1)
    assert caught.value.detail["reason"] == "git_network" and caught.value.detail["host"] == "gitlab.example.com"


async def test_a_failed_clone_leaves_no_folder_behind(monkeypatch, tmp_path):
    FakeGit(monkeypatch, stderr="Host key verification failed.", code=128)
    with pytest.raises(MemberError):
        await skill_git.fetch(skill_git.address("git@gitlab.example.com:group/repo.git"), tmp_path / "work")
    assert list((tmp_path / "work").iterdir()) == []


async def test_a_clone_comes_back_as_a_folder(monkeypatch, tmp_path):
    FakeGit(monkeypatch, files={"SKILL.md": b"x", "docs/a.md": b"y"})
    folder = await skill_git.fetch(skill_git.address("git@gitlab.example.com:group/repo.git"), tmp_path / "work")
    assert folder.parent == tmp_path / "work" and folder.name.startswith("repo-") and (folder / "docs" / "a.md").read_bytes() == b"y"

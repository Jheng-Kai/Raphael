"""An import of Team skills says what it is doing and can be stopped, and stopping it leaves nothing behind (R-SKILL-38)."""

import asyncio
import contextvars
import sys
import threading
import time
from pathlib import Path

import pytest

from raphael_core.members import skill_git, skill_github, skill_progress
from raphael_core.protocol import RpcError

from .test_skill_git import FakeGit
from .test_skill_packages import archive, document, upload
from .test_skill_structures import write


def progress(rig, import_id):
    return [params for method, params in rig.notes if method == "skills.import_progress" and params["import_id"] == import_id]


async def test_an_import_says_each_step_and_how_many_skills_it_has_read(rig, tmp_path):
    source = write(tmp_path / "pack", {f"skills/{name}/SKILL.md": document(name).encode() for name in ("alpha", "beta", "gamma")})
    package = (await rig.call("skills.library.import", {"source": f"local:{source}", "import_id": "one", "plugin": False}))["package"]
    assert len(package["skills"]) == 3
    steps = [(note["step"], note.get("done"), note.get("total")) for note in progress(rig, "one")]
    assert steps[0][0] == "fetch" and steps[-1][0] == "install"
    reads = [(done, total) for step, done, total in steps if step == "read"]
    assert reads == [(1, 3), (2, 3), (3, 3)]
    # The steps come in their order: nothing is read before it is fetched, nothing installed before it is read.
    order = [step for step, _, _ in steps]
    assert order == sorted(order, key=["fetch", "read", "install"].index)


async def test_a_zip_and_pasted_text_say_their_steps_too(rig):
    await rig.call("skills.library.import", {**upload("pack.zip", archive([("a/SKILL.md", document("zipped").encode())])), "import_id": "zip"})
    assert [note["step"] for note in progress(rig, "zip")][-1] == "install" and any(note["step"] == "read" for note in progress(rig, "zip"))
    await rig.call("skills.library.import", {"text": document("pasted"), "import_id": "text"})
    assert [note["step"] for note in progress(rig, "text")][0] == "fetch" and progress(rig, "text")[-1]["step"] == "install"


async def test_an_import_with_no_id_says_nothing(rig):
    await rig.call("skills.library.import", {"text": document("quiet")})
    assert not [1 for method, _ in rig.notes if method == "skills.import_progress"]


async def test_an_id_that_a_running_import_has_is_refused_and_no_id_is_nothing_to_cancel(rig):
    assert await rig.call("skills.library.cancel_import", {"import_id": "nobody"}) == {"cancelled": False}
    with pytest.raises(RpcError):
        await rig.call("skills.library.import", {"text": document("x"), "import_id": ""})


async def test_cancelling_a_clone_ends_git_and_keeps_nothing(rig, tmp_path, monkeypatch):
    FakeGit(monkeypatch, files={"SKILL.md": document("never").encode()})
    started = threading.Event()
    killed = threading.Event()
    folders = []

    def hanging(args, env, timeout):
        """A git that does not finish, and ends at the import's token as the real one is killed by it."""
        if "config" in args:
            return type("Done", (), {"returncode": 0, "stdout": "", "stderr": ""})()
        folders.append(Path(args[-1]))
        started.set()
        held = skill_progress.token()
        while not held.cancelled:
            time.sleep(0.01)
        killed.set()
        raise skill_progress.ImportCancelled()

    monkeypatch.setattr(skill_git, "_run", hanging)
    importing = asyncio.ensure_future(rig.call("skills.library.import", {"source": "git@gitlab.example.com:group/repo.git", "import_id": "clone"}))
    while not started.is_set():
        await asyncio.sleep(0.01)
    assert await rig.call("skills.library.cancel_import", {"import_id": "clone"}) == {"cancelled": True}
    with pytest.raises(RpcError, match="cancelled"):
        await importing
    assert killed.is_set()
    assert (await rig.call("skills.library.list"))["packages"] == []
    # The folder the clone was made in is gone with it.
    assert folders and not folders[0].exists()


def test_the_real_git_runner_kills_its_program_at_the_token(tmp_path):
    def run():
        token = skill_progress.Token()
        skill_progress.start(token, None)
        threading.Timer(0.5, token.cancel).start()
        began = time.monotonic()
        with pytest.raises(skill_progress.ImportCancelled):
            skill_git._run([sys.executable, "-c", "import time; time.sleep(60)"], None, 120)
        assert time.monotonic() - began < 10

    # In a context of its own: the token is the import's, and no other test is to find it set.
    contextvars.copy_context().run(run)


async def test_cancelling_a_download_stops_it_and_keeps_nothing(rig, monkeypatch):
    reached = asyncio.Event()

    async def hang(*args, **kwargs):
        reached.set()
        await asyncio.sleep(3600)

    monkeypatch.setattr(skill_github, "listing", hang)
    from .github_fake import FakeGitHub

    github = FakeGitHub(monkeypatch)
    github.add("owner/repo", {"SKILL.md": document("never").encode()})
    importing = asyncio.ensure_future(rig.call("skills.library.import", {"source": "owner/repo", "import_id": "down"}))
    await asyncio.wait_for(reached.wait(), 10)
    assert await rig.call("skills.library.cancel_import", {"import_id": "down"}) == {"cancelled": True}
    with pytest.raises(RpcError, match="cancelled"):
        await importing
    assert (await rig.call("skills.library.list"))["packages"] == []
    assert not [1 for method, params in rig.notes if method == "skills.import_progress" and params["step"] == "install"]


def test_an_import_that_is_writing_the_library_finishes_and_cannot_be_stopped():
    def run():
        token = skill_progress.Token()
        skill_progress.start(token, lambda step, done, total: None)
        skill_progress.commit()
        assert token.cancel() is False and not token.cancelled
        # And a token that was cancelled before stops the next report.
        stopped = skill_progress.Token()
        assert stopped.cancel() is True
        skill_progress.start(stopped, None)
        with pytest.raises(skill_progress.ImportCancelled):
            skill_progress.report("read", 1, 2)

    contextvars.copy_context().run(run)

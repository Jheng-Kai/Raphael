"""The owner's press on a file in a reply: the team folder on this PC, and nothing that runs."""
from types import SimpleNamespace

import pytest

from raphael_core.computer.viewer import DesktopViewer
from raphael_core.protocol import RpcError


def viewer(root, *, remote=None):
    vm = SimpleNamespace(target=lambda member: SimpleNamespace(shared=root, remote=remote))
    return DesktopViewer(vm, member_exists=lambda member: True)


async def test_a_team_file_is_found_and_only_what_reads_opens(tmp_path):
    (tmp_path / "office").mkdir()
    (tmp_path / "office" / "index.html").write_text("<p>page</p>")
    (tmp_path / "office" / "setup.exe").write_text("not a page")
    found = viewer(tmp_path)
    try:
        page = await found.team_file({"path": "/home/cua/team/office/index.html"})
        assert page == {"path": str((tmp_path / "office" / "index.html").resolve()), "reads": True}
        assert (await found.team_file({"path": "/home/cua/team/office/setup.exe"}))["reads"] is False
    finally:
        await found.client.aclose()


@pytest.mark.parametrize("path", ["/home/cua/team/../secret.txt", "/home/cua/team/office/missing.html", "/home/cua/workspace/a.txt",
                                  "C:\\Windows\\win.ini", "/home/cua/team/office", 7])
async def test_nothing_else_is_a_team_file(tmp_path, path):
    (tmp_path / "team" / "office").mkdir(parents=True)
    (tmp_path / "secret.txt").write_text("private")
    found = viewer(tmp_path / "team")
    try:
        with pytest.raises(RpcError):
            await found.team_file({"path": path})
    finally:
        await found.client.aclose()


async def test_a_team_folder_on_another_computer_has_no_place_here(tmp_path):
    found = viewer(tmp_path, remote="mac-mini")
    try:
        with pytest.raises(RpcError):
            await found.team_file({"path": "/home/cua/team/index.html"})
    finally:
        await found.client.aclose()


async def test_a_recorded_task_file_uses_the_same_read_only_opening_policy(tmp_path):
    found = viewer(None, remote="another-computer")
    page = (tmp_path / "review.html").resolve()
    program = (tmp_path / "setup.exe").resolve()
    files = {(42, 51): page, (42, 52): program}
    found.task_artifact = lambda task, evidence: files.get((task, evidence))
    try:
        assert await found.team_file({"path": "task-artifact:42:51"}) == {"path": str(page), "reads": True}
        assert (await found.team_file({"path": "task-artifact:42:52"}))["reads"] is False
        for path in ("task-artifact:42:53", "task-artifact:0:51", "task-artifact:42:../secret"):
            with pytest.raises(RpcError):
                await found.team_file({"path": path})
    finally:
        await found.client.aclose()

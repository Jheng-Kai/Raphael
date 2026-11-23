"""Authorization at render time and at the owner's press on an authored path."""

import os
from types import SimpleNamespace

import pytest

from raphael_core.computer.viewer import DesktopViewer
from raphael_core.protocol import RpcError


@pytest.fixture
def paths(tmp_path):
    root = tmp_path.resolve()
    workspace, output, granted, other, team = (
        root / name for name in ("workspace", "output", "allowed", "allowed-other", "team"))
    for folder in (workspace, output, granted, other, team):
        folder.mkdir()
        (folder / "report.md").write_text("report", encoding="utf-8")
    settings = {"owner_output_folder": str(output), "member_write_folders": {"1": [str(granted)], "2": [str(other)]}}
    target = SimpleNamespace(workspace=workspace, shared=team, remote="")
    vm = SimpleNamespace(target=lambda member: target, settings=settings)
    viewer = DesktopViewer(vm, member_exists=lambda member: member in (1, 2))
    return viewer, target, settings, output, granted, other


async def test_only_existing_grants_become_links_and_open(paths):
    viewer, target, settings, output, granted, other = paths
    allowed = [str(granted / "report.md"), str(output / "report.md"), str(target.workspace / "report.md"),
               str(target.shared / "report.md"), "/home/cua/workspace/report.md", "/home/cua/team/report.md"]
    if os.name == "nt":
        allowed += [granted.as_posix() + "/report.md", "/" + output.as_posix() + "/report.md"]
    refused = [str(other / "report.md"), str(other), "/outside/report.md", "report.md", "https://example.com/report.md"]
    assert await viewer.message_paths({"member_id": 1, "paths": [*allowed, *refused]}) == {"allowed": allowed}
    for path in allowed:
        assert (await viewer.team_file({"member_id": 1, "path": path}))["reads"] is True
    for path in refused:
        with pytest.raises(RpcError, match="file unavailable"):
            await viewer.team_file({"member_id": 1, "path": path})
    settings["member_write_folders"]["1"] = []
    with pytest.raises(RpcError, match="file unavailable"):
        await viewer.team_file({"member_id": 1, "path": str(granted / "report.md")})


async def test_escape_is_refused_and_missing_path_reports_unavailable(paths):
    viewer, target, _, output, granted, other = paths
    paths_to_check = [str(granted / ".." / other.name / "report.md"), "/home/cua/workspace/../outside.md"]
    missing = str(output / "gone.md")
    assert await viewer.message_paths({"member_id": 1, "paths": [*paths_to_check, missing]}) == {"allowed": [missing]}
    for path in [*paths_to_check, missing]:
        with pytest.raises(RpcError, match="file unavailable"):
            await viewer.team_file({"member_id": 1, "path": path})
    target.remote = "mac-mini"
    assert await viewer.message_paths({"member_id": 1, "paths": ["/home/cua/workspace/report.md", missing]}) == {"allowed": [missing]}


async def test_symlink_escape_is_refused_and_checked_again_at_press(paths):
    viewer, _, _, _, granted, other = paths
    link = granted / "report-link.md"
    try:
        link.symlink_to(granted / "report.md")
    except (NotImplementedError, OSError):
        pytest.skip("Creating a symbolic link requires filesystem support")
    path = str(link)
    assert await viewer.message_paths({"member_id": 1, "paths": [path]}) == {"allowed": [path]}
    assert (await viewer.team_file({"member_id": 1, "path": path}))["path"] == str(granted / "report.md")
    link.unlink()
    link.symlink_to(other / "report.md")
    assert await viewer.message_paths({"member_id": 1, "paths": [path]}) == {"allowed": []}
    with pytest.raises(RpcError, match="file unavailable"):
        await viewer.team_file({"member_id": 1, "path": path})


async def test_a_redirected_grant_is_refused(paths):
    viewer, _, settings, _, _, other = paths
    redirected = other.with_name("redirected")
    try:
        redirected.symlink_to(other, target_is_directory=True)
    except (NotImplementedError, OSError):
        pytest.skip("Creating a symbolic link requires filesystem support")
    settings["member_write_folders"]["1"] = [str(redirected)]
    path = str(redirected / "report.md")
    assert await viewer.message_paths({"member_id": 1, "paths": [path]}) == {"allowed": []}
    with pytest.raises(RpcError, match="file unavailable"):
        await viewer.team_file({"member_id": 1, "path": path})


async def test_folders_scripts_and_executables_are_only_revealed(paths):
    viewer, _, _, _, granted, _ = paths
    folder = granted / "folder.md"
    folder.mkdir()
    program = granted / "program.exe"
    script = granted / "script.sh"
    for path in (program, script):
        path.touch()
    for path in (folder, program, script):
        assert await viewer.team_file({"member_id": 1, "path": str(path)}) == {"path": str(path), "reads": False}

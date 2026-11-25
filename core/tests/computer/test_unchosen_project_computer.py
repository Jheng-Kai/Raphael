"""R-FILE-06 (issue 325) on the host computer (這台電腦) and in a command's named files: a remembered project that is not the
member's chosen one is never written, in any permission mode, with or without a yes, and nothing asks for it.

The member's work folder wins first (a project inside the chosen one is written), then an unchosen project (refused), then any
other place outside (asked in 自動, 手動 and 計畫, free in 全部允許, as before). The Docker computer's tests are in
`test_write_boundary_computer.py`; the owner's file tools and local commands in `agent/test_unchosen_project.py`.
"""

import os
from types import SimpleNamespace

import pytest

from raphael_core import work_area
from raphael_core.agent.gate import ToolGate
from raphael_core.agent.policy import Tier
from raphael_core.brain.settings import SettingsStore
from raphael_core.computer.host_computer import HostComputerTools
from raphael_core.computer.vm import LocalVm
from raphael_core.computer.vm_tools import BROWSER_OPEN, VmTools, vm_scope
from .test_vm import EmptyHub

MODES = ["direct", "ask", "plan", "bypass"]
WORK = ("turn", 1, 2)


@pytest.fixture
def host(tmp_path, conn):
    """A host computer for member 1, with two remembered projects (`project` chosen, `other` not) and a place that is none."""
    settings = SettingsStore(conn)
    paths = SimpleNamespace(project=tmp_path / "project", other=tmp_path / "other", elsewhere=tmp_path / "elsewhere")
    for folder in (paths.project / "sub", paths.other, paths.elsewhere):
        folder.mkdir(parents=True)
    settings.set("project_folders", [str(paths.project), str(paths.other)])
    settings.set("member_work_folder", {"1": str(paths.project)})
    vm = LocalVm(tmp_path / "data", settings=settings)
    hub = VmTools(EmptyHub(), vm, attachments=None, conn=conn)
    hub.host_computer = HostComputerTools(vm, conn, BROWSER_OPEN)
    tools = hub.host_computer
    paths.settings, paths.conn, paths.hub, paths.tools = settings, conn, hub, tools
    paths.key = next(tool.key for tool in tools.offered(1) if tool.name == "write_file")
    paths.edit = next(tool.key for tool in tools.offered(1) if tool.name == "edit_file")
    return paths


def args(path, content="x"):
    return {"path": str(path), "content": content}


async def refused_with(host, path, approver):
    return await host.tools.file_call(1, "write_file", args(path), approver, WORK)


@pytest.mark.parametrize("mode", MODES)
async def test_a_write_into_an_unchosen_project_is_refused_in_every_mode_and_asks_nothing(host, mode):
    host.settings.set("action_mode", mode)
    gate = ToolGate(host.hub, conn=host.conn)
    target = args(host.other / "a.txt")
    assert host.tools.tier_for_call(host.key, target) == Tier.T0 and not host.tools.firm_for_call(host.key, target)
    assert not host.hub.firm_for_call(host.key, target) and host.hub.tier_for_call(host.key, target) == Tier.T0
    assert not gate.needs_confirmation(host.key, target) and not gate.firm_confirmation(host.key, target)
    with vm_scope(("turn", 1, 2), turn_id=1):
        refused = await gate.call_plugin(host.key, target)
        near = await gate.call_plugin(host.key, args(host.project / "near.txt"))
    assert refused.kind == "forbidden" and work_area.UNCHOSEN_WORDS in refused.text and not (host.other / "a.txt").exists()
    assert near.ok and (host.project / "near.txt").read_text() == "x"
    for approver in ("auto", "user"):
        again = await refused_with(host, host.other / "a.txt", approver)
        assert again.kind == "forbidden" and not (host.other / "a.txt").exists()


async def test_an_edit_into_an_unchosen_project_is_refused_even_with_a_yes(host):
    (host.other / "plan.txt").write_text("old\n", encoding="utf-8")
    edit = {"path": str(host.other / "plan.txt"), "old_string": "old", "new_string": "new"}
    assert host.tools.tier_for_call(host.edit, edit) == Tier.T0 and not host.tools.firm_for_call(host.edit, edit)
    for approver in ("auto", "user"):
        assert (await host.tools.file_call(1, "edit_file", edit, approver, WORK)).kind == "forbidden"
    assert (host.other / "plan.txt").read_text(encoding="utf-8") == "old\n"


async def test_with_no_project_chosen_every_remembered_project_is_refused_and_the_own_folder_is_written(host):
    host.settings.set("member_work_folder", {})
    own = host.tools.folders(1)[0]
    for folder in (host.project, host.other):
        target = args(folder / "a.txt")
        assert host.tools.tier_for_call(host.key, target) == Tier.T0 and not host.tools.firm_for_call(host.key, target)
        for approver in ("auto", "user"):
            assert (await refused_with(host, folder / "a.txt", approver)).kind == "forbidden"
        assert not (folder / "a.txt").exists()
    assert (await refused_with(host, own / "a.txt", "auto")).ok and (own / "a.txt").read_text() == "x"


async def test_a_project_inside_the_chosen_one_is_written_and_the_one_that_holds_it_is_not(host):
    inner = host.project / "sub" / "inner"
    inner.mkdir()
    host.settings.set("project_folders", [str(host.project), str(inner), str(host.other)])
    assert (await refused_with(host, inner / "a.txt", "auto")).ok and (inner / "a.txt").read_text() == "x"
    host.settings.set("member_work_folder", {"1": str(inner)})
    assert (await refused_with(host, inner / "b.txt", "auto")).ok
    for approver in ("auto", "user"):
        assert (await refused_with(host, host.project / "a.txt", approver)).kind == "forbidden"
        assert (await refused_with(host, host.project / "sub" / "a.txt", approver)).kind == "forbidden"
    assert not (host.project / "a.txt").exists() and not (host.project / "sub" / "a.txt").exists()


async def test_a_place_that_is_no_project_is_asked_and_in_allow_all_free_as_before(host):
    target = args(host.elsewhere / "a.txt")
    assert host.tools.tier_for_call(host.key, target) == Tier.T3 and host.tools.firm_for_call(host.key, target)
    assert (await refused_with(host, host.elsewhere / "a.txt", "auto")).kind == "approval_required"
    assert (await refused_with(host, host.elsewhere / "a.txt", "user")).ok
    host.settings.set("action_mode", "bypass")
    gate = ToolGate(host.hub, conn=host.conn)
    free = args(host.elsewhere / "b.txt")
    assert not gate.needs_confirmation(host.key, free) and not gate.firm_confirmation(host.key, free)
    with vm_scope(("turn", 1, 2), turn_id=1):
        assert (await gate.call_plugin(host.key, free)).ok


async def test_a_relative_name_and_a_link_that_lead_into_an_unchosen_project_are_refused(host):
    from agent.test_owner_files import _link_folder
    for path in ("../other/a.txt", "sub/../../other/a.txt"):
        assert host.tools.tier_for_call(host.key, args(path)) == Tier.T0, path
        assert (await host.tools.file_call(1, "write_file", args(path), "user", WORK)).kind == "forbidden", path
    _link_folder(host.project / "door", host.other)
    target = args(host.project / "door" / "a.txt")
    assert host.tools.tier_for_call(host.key, target) == Tier.T0 and not host.tools.firm_for_call(host.key, target)
    for approver in ("auto", "user"):
        assert (await refused_with(host, host.project / "door" / "a.txt", approver)).kind == "forbidden"
    assert not (host.other / "a.txt").exists()


@pytest.mark.skipif(os.path.exists(str(os.getcwd()).swapcase()) is False, reason="a disk that tells one case from another")
async def test_another_spelling_of_an_unchosen_project_is_the_same_project(host):
    shouted = str(host.other / "a.txt").swapcase()
    assert host.tools.tier_for_call(host.key, args(shouted)) == Tier.T0
    assert (await host.tools.file_call(1, "write_file", args(shouted), "user", WORK)).kind == "forbidden"
    assert not (host.other / "a.txt").exists()


def test_a_download_goes_to_the_work_folder_and_never_to_another_project(host):
    assert host.tools.download_folder(1) == host.project.resolve() or str(host.tools.download_folder(1)) == os.path.realpath(host.project)
    host.settings.set("member_work_folder", {})
    assert host.tools.download_folder(1) == host.tools.folders(1)[0]
    assert host.tools.download_folder(1) not in (host.project, host.other)


# --- a command's named files, read by `shell_writes` -------------------------------------------------------------------------


class Settings:
    """What `work_area.reach` reads of the owner's settings."""

    def __init__(self, projects, chosen=None):
        self.values = {"project_folders": [str(path) for path in projects], "member_work_folder": {"0": str(chosen)} if chosen else {}}

    def get(self, key):
        return self.values[key]


def test_a_command_names_its_files_in_a_project_that_is_not_the_members_apart_from_the_rest(tmp_path):
    from raphael_core.computer.shell_writes import classify

    project, other, elsewhere, own = (tmp_path / name for name in ("project", "other", "elsewhere", "own"))
    for folder in (project, other, elsewhere, own):
        folder.mkdir()
    settings = Settings([project, other], chosen=project)

    def reach(path):
        return work_area.reach(settings, 0, path, lambda member: (own, tmp_path / "team"))

    def told(command, cwd=project):
        return classify(command, str(cwd), reach, home=str(tmp_path / "home"))

    assert told(f"echo a > {project.as_posix()}/a.txt; echo b > b.txt") == ([], [])
    assert told(f"echo a > {other.as_posix()}/a.txt") == ([f"{other.as_posix()}/a.txt"], [])
    assert told(f"echo a > {elsewhere.as_posix()}/a.txt") == ([], [f"{elsewhere.as_posix()}/a.txt"])
    assert told("echo a > ../other/a.txt") == (["../other/a.txt"], [])
    assert told("echo a > a.txt", cwd=other) == (["a.txt"], [])
    assert told("echo a > a.txt", cwd=None) == ([], ["a.txt"])  # a folder it cannot name: asked, as before
    # Moves, deletes and copies name every path that changes; a copy changes its destination only.
    assert told("mv ../other/a.txt b.txt")[0] == ["../other/a.txt"] and told("cp ../other/a.txt b.txt") == ([], [])
    assert told("rm ../other/a.txt")[0] == ["../other/a.txt"] and told("cp b.txt ../other/")[0] == ["../other/"]
    assert told("Rename-Item ../other/a.txt b.txt")[0] == ["../other/a.txt"]
    assert told("Move-Item b.txt ../other/c.txt")[0] == ["../other/c.txt"]
    # In a shell started by the command, after a `cd`, in a pattern: where each leads.
    assert told("cd ../other; echo a > a.txt")[0] == ["a.txt"] and told("cd ../elsewhere; echo a > a.txt") == ([], ["a.txt"])
    assert told("powershell -Command \"Set-Content -Path ../other/a.txt -Value x\"")[0] == ["../other/a.txt"]
    assert told("Remove-Item ../other/*.log")[0] == ["../other"]  # a pattern is judged by the folder it names
    # A project inside the chosen one is the work folder, and the member's own folder is outside while a project is chosen.
    inner = project / "inner"
    inner.mkdir()
    settings.values["project_folders"].append(str(inner))
    assert told(f"echo a > {inner.as_posix()}/a.txt") == ([], [])
    assert told(f"echo a > {own.as_posix()}/a.txt") == ([], [f"{own.as_posix()}/a.txt"])

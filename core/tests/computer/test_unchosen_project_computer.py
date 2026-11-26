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
    assert told("Rename-Item ../other/a.txt b.txt")[0] == ["../other/a.txt", "../other/b.txt"]  # the new name is in the file's folder
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


# --- review findings: refused before any question, a rename inside the folder of its file --------------------------------


def test_the_gate_says_which_host_writes_are_refused_before_any_question(host):
    gate = ToolGate(host.hub, conn=host.conn)
    read = next(tool.key for tool in host.tools.offered(1) if tool.name == "read_file")
    for mode in ("direct", "ask", "plan", "bypass"):
        host.settings.set("action_mode", mode)
        assert gate.refused_for_call(host.key, args(host.other / "a.txt")) == work_area.UNCHOSEN_WORDS, mode
        assert gate.refused_for_call(host.edit, {"path": str(host.other / "a.txt"), "old_string": "a", "new_string": "b"}) == work_area.UNCHOSEN_WORDS
    for allowed in (host.project / "a.txt", host.elsewhere / "a.txt", host.tools.folders(1)[0] / "a.txt"):
        assert gate.refused_for_call(host.key, args(allowed)) is None, allowed  # a card for these is asked as before
    assert gate.refused_for_call(read, {"path": str(host.other / "a.txt")}) is None  # a read is never refused
    assert gate.refused_for_call("mcp:nothing/anything", {"path": str(host.other / "a.txt")}) is None


def test_a_rename_happens_in_the_folder_of_the_file_it_names(tmp_path):
    from raphael_core.computer.shell_writes import classify
    project, other, own = (tmp_path / name for name in ("project", "other", "own"))
    for folder in (project, other, own):
        folder.mkdir()
    settings = Settings([project, other], chosen=project)

    def told(command, cwd):
        reach = lambda path: work_area.reach(settings, 0, path, lambda member: (own, tmp_path / "team"))
        return classify(command, str(cwd), reach, home=str(tmp_path / "home"))

    here = project.as_posix()
    # The command runs in another project, and the file it renames is in the chosen one: the new name is there too.
    for command in (f"Rename-Item {here}/a.txt -NewName b.txt", f"Rename-Item -Path {here}/a.txt -NewName b.txt",
                    f"Rename-Item -LiteralPath {here}/a.txt -NewName b.txt", f"rni {here}/a.txt -NewName b.txt",
                    f"Rename-Item {here}/a.txt b.txt", f"ren {here}/a.txt b.txt", f"Rename-Item -NewName b.txt {here}/a.txt"):
        assert told(command, other) == ([], []), command
    # The other way round: the file is in another project, wherever the command runs.
    assert told(f"Rename-Item {other.as_posix()}/a.txt -NewName b.txt", project)[0] == [f"{other.as_posix()}/a.txt", f"{other.as_posix()}/b.txt"]
    assert told("Rename-Item a.txt -NewName b.txt", project) == ([], [])
    assert told("Rename-Item a.txt -NewName b.txt", other)[0] == ["a.txt", "b.txt"]
    assert told("ren a.txt b.txt", own)[1] == ["a.txt", "b.txt"]
    # A new name with a folder in it is not a name: it is judged from the folder the command runs in, as before.
    assert told(f"Rename-Item {here}/a.txt -NewName ../other/b.txt", project)[0] == ["../other/b.txt"]
    assert told(f"Rename-Item {here}/a.txt -NewName $name", project)[1]  # a name it cannot read is asked about, as before
    # A move and a copy keep the semantics they had: their destination is taken from the folder the command runs in.
    for command in (f"Move-Item {here}/a.txt b.txt", f"mv {here}/a.txt b.txt", f"Copy-Item {here}/a.txt b.txt", f"cp {here}/a.txt b.txt"):
        assert told(command, other)[0] == ["b.txt"], command
        assert told(command, project) == ([], []), command


# --- round two: every name of a path parameter ------------------------------------------------------------------------------


def test_every_name_powershell_gives_a_parameter_that_names_a_file_names_the_file_a_command_changes(tmp_path):
    from raphael_core.computer.shell_writes import classify
    project, other, own = (tmp_path / name for name in ("project", "other", "own"))
    for folder in (project, other, own):
        folder.mkdir()
    settings = Settings([project, other], chosen=project)

    def told(command, cwd):
        reach = lambda path: work_area.reach(settings, 0, path, lambda member: (own, tmp_path / "team"))
        return classify(command, str(cwd), reach, home=str(tmp_path / "home"))

    there, here = other.as_posix(), project.as_posix()
    # The file is in the project that is not the member's; the command runs in the member's own.
    for command in (
            # A rename: -Path, -LiteralPath and its aliases -PSPath and -LP, the same whatever way they are written.
            *(f"Rename-Item {flag} {there}/a.txt -NewName b.txt" for flag in ("-Path", "-LiteralPath", "-PSPath", "-LP", "-pspath", "-lp")),
            f"Rename-Item -PSPath:{there}/a.txt -NewName b.txt", f"rni -LP {there}/a.txt b.txt", f"Rename-Item -NewName b.txt -PSPath {there}/a.txt",
            *(f"Rename-Item {flag} {there}/a.txt -NewName b.txt" for flag in ("-Pa", "-Lit", "-PSP")),  # a name cut short
            # The cmdlets that move, delete, make or write by -Path name the same file by -LiteralPath, -PSPath and -LP.
            *(f"Move-Item {flag} {there}/a.txt c.txt" for flag in ("-Path", "-LiteralPath", "-PSPath", "-LP")),
            *(f"Remove-Item {flag} {there}/a.txt" for flag in ("-Path", "-LiteralPath", "-PSPath", "-LP")),
            *(f"Set-Content {flag} {there}/a.txt -Value x" for flag in ("-Path", "-LiteralPath", "-PSPath", "-LP")),
            *(f"Add-Content {flag} {there}/a.txt -Value x" for flag in ("-LiteralPath", "-PSPath", "-LP")),
            *(f"Clear-Content {flag} {there}/a.txt" for flag in ("-LiteralPath", "-PSPath", "-LP")),
            *(f"Out-File {flag} {there}/a.txt" for flag in ("-FilePath", "-Path", "-LiteralPath", "-PSPath", "-LP")),
            *(f"Export-Csv {flag} {there}/a.csv" for flag in ("-Path", "-LiteralPath", "-PSPath", "-LP")),
            *(f"Tee-Object {flag} {there}/a.txt" for flag in ("-FilePath", "-LiteralPath", "-PSPath", "-LP")),
            *(f"New-Item {flag} {there} -Name a.txt" for flag in ("-Path", "-PSPath", "-LP")),
            f"Start-Transcript -OutputDirectory {there}", f"Start-Transcript -LiteralPath {there}/t.txt",
            f"Copy-Item a.txt -Destination {there}/b.txt", f"Expand-Archive z.zip -DestinationPath {there}",
    ):
        assert told(command, project)[0], command
    # The same names for a file of the member's own project, from a command that runs in the other one, name nothing refused.
    for command in (f"Rename-Item -PSPath {here}/a.txt -NewName b.txt", f"Rename-Item -LP {here}/a.txt -NewName b.txt",
                    f"Set-Content -PSPath {here}/a.txt -Value x", f"Remove-Item -LP {here}/a.txt", f"Move-Item -PSPath {here}/a.txt {here}/c.txt"):
        assert told(command, other) == ([], []), command


# --- round three: the colon form and the parameters cut short ---------------------------------------------------------------


def test_a_parameter_written_with_a_colon_or_cut_short_names_the_file_it_names(tmp_path):
    from raphael_core.computer.shell_writes import classify
    project, other, own = (tmp_path / name for name in ("project", "other", "own"))
    for folder in (project, other, own):
        folder.mkdir()
    settings = Settings([project, other], chosen=project)

    def told(command, cwd=project):
        reach = lambda path: work_area.reach(settings, 0, path, lambda member: (own, tmp_path / "team"))
        return classify(command, str(cwd), reach, home=str(tmp_path / "home"))

    there, here = other.as_posix(), project.as_posix()
    for command in (
            *(f"Rename-Item {flag}:{there}/a.txt b.txt" for flag in ("-Lit", "-LiteralP", "-PSP", "-Pa", "-PSPath", "-LP", "-Path", "-LiteralPath")),
            f"Rename-Item {there}/a.txt -New:b.txt", f"Rename-Item {there}/a.txt -NewN:b.txt", f"Rename-Item -Lit:{there}/a.txt -NewName:b.txt",
            *(f"Set-Content {flag}:{there}/a.txt x" for flag in ("-Pa", "-Lit", "-PSP", "-Fi", "-FileP")),
            *(f"Set-Content {flag}:{there}/a.txt -Value:x" for flag in ("-Path", "-LP")),
            f"Out-File -Fi:{there}/a.txt", f"Out-File -FilePath:{there}/a.txt",
            f"Copy-Item a.txt -Des:{there}/b.txt", f"Copy-Item a.txt -Dest:{there}/b.txt", f"Copy-Item a.txt -Destination:{there}/b.txt",
            f"Expand-Archive z.zip -DestinationP:{there}", f"Expand-Archive z.zip -Des:{there}",
            f"Invoke-WebRequest https://example.com/x -Out:{there}/f", f"Invoke-WebRequest https://example.com/x -OutF:{there}/f",
            f"Remove-Item -Pa:{there}/a.txt", f"Remove-Item -Lit:{there}/a.txt", f"Move-Item -Pa:{there}/a.txt c.txt",
            f"New-Item -Pa:{there} -Name a.txt", f"New-Item -Path:{there}/a.txt",
            # A parameter nobody knows with a value that looks like a path is judged as a written path.
            f"Set-Content -Fnord:{there}/a.txt x", f"Remove-Item -Whatever:{there}/a.txt",
            f"Remove-Item -Pa: {there}/a.txt", f"Rename-Item -Lit: {there}/a.txt b.txt",
    ):
        assert told(command)[0], command
    # What names nothing refused names nothing: the member's own project, a value that is no path, a flag that is no path.
    for command in (f"Rename-Item -Lit:{here}/a.txt b.txt", f"Set-Content -Pa:{here}/a.txt -Value:x -Force:$true -Encoding:utf8",
                    f"Set-Content {here}/a.txt -Value:{there} -Encoding:utf8", "Remove-Item a.txt -ErrorAction:Stop -Force:$true",
                    f"Invoke-WebRequest -Uri:https://example.com/a/b -OutFile:{here}/f", "Invoke-WebRequest -Proxy:http://proxy:8080 https://example.com"):
        assert told(command) == ([], []), command
    # A colon form that cannot be read still asks, as a target it cannot read always did.
    assert told("Set-Content -Pa:$target x")[1]


# --- round four: the colon form and short parameters only ever add to what is judged ----------------------------------------


def _folders(tmp_path):
    project, other, own = (tmp_path / name for name in ("project", "other", "own"))
    for folder in (project, other, own):
        folder.mkdir(exist_ok=True)
    settings = Settings([project, other], chosen=project)

    def reach(path):
        return work_area.reach(settings, 0, path, lambda member: (own, tmp_path / "team"))

    return project, other, own, reach


def test_an_ambiguous_short_parameter_keeps_the_target_the_command_names(tmp_path):
    from raphael_core.computer.shell_writes import classify
    project, other, own, reach = _folders(tmp_path)
    there = other.as_posix()
    # -Fi is Filter or FilePath: PowerShell binds the Filter and the file named is the first word. Both are judged.
    assert classify(f"Set-Content {there}/a.txt x -Fi:*.txt", str(project), reach, home=str(tmp_path / "home"))[0] == [f"{there}/a.txt"]
    assert classify(f"Set-Content {there}/a.txt x -Fi:{there}/b.txt", str(project), reach, home=str(tmp_path / "home"))[0] == [f"{there}/a.txt", f"{there}/b.txt"]
    assert classify(f"Remove-Item {there}/a.txt -Fi:*.log", str(project), reach, home=str(tmp_path / "home"))[0] == [f"{there}/a.txt"]


def test_a_unix_tools_flag_with_a_colon_is_read_as_it_always_was(tmp_path):
    from raphael_core.computer.shell_writes import classify
    project, other, own, reach = _folders(tmp_path)
    there = other.as_posix()
    # sed -i:.bak keeps its in-place flag: the file it edits is judged, and `.bak` is no path.
    for command in (f"sed -i:.bak 's/a/b/' {there}/a.txt", f"sed -i 's/a/b/' {there}/a.txt"):
        assert classify(command, str(project), reach, home=str(tmp_path / "home")) == ([f"{there}/a.txt"], []), command
    # The suffix attached to the flag is the in-place edit it is: judged now, as it was not before (and nothing it judged is lost).
    assert classify(f"sed -i.bak 's/a/b/' {there}/a.txt", str(project), reach, home=str(tmp_path / "home")) == ([f"{there}/a.txt"], [])
    # The unix tools that PowerShell has aliases for keep their own reading, with no colon form and no short parameter.
    for command in (f"cp -t:x {there}/a.txt", f"mv -Pa:{there}/a.txt b", f"tee -Lit:{there}/a.txt", f"rm -Pa:{there}/a.txt"):
        assert classify(command, str(project), reach, home=str(tmp_path / "home")) == old_classify(tmp_path, command, project, reach), command


def old_classify(tmp_path, command, cwd, reach):
    """What the classifier of before the colon form said (`9a542a3cc`, the commit that read every alias), loaded as a module of
    its own."""
    return _old_classifier().classify(command, str(cwd), reach, home=str(tmp_path / "home"))


def _old_classifier():
    import importlib.util
    import subprocess
    import sys
    if "old_shell_writes" in sys.modules:
        return sys.modules["old_shell_writes"]
    shown = subprocess.run(["git", "show", "9a542a3cc:core/src/raphael_core/computer/shell_writes.py"], capture_output=True,
                           text=True, encoding="utf-8", cwd=os.path.dirname(__file__))
    if shown.returncode:
        pytest.skip("the commit this compares with is not in this clone")
    spec = importlib.util.spec_from_loader("old_shell_writes", loader=None)
    module = importlib.util.module_from_spec(spec)
    exec(compile(shown.stdout.replace("from ..work_area import", "from raphael_core.work_area import"), "old_shell_writes.py", "exec"),
         module.__dict__)
    sys.modules["old_shell_writes"] = module
    return module


def test_what_the_classifier_judged_before_the_colon_form_it_still_judges(tmp_path):
    from raphael_core.computer.shell_writes import classify
    project, other, own, reach = _folders(tmp_path)
    there, here = other.as_posix(), project.as_posix()
    commands = [
        f"Set-Content {there}/a.txt x -Fi:*.txt", f"Set-Content {there}/a.txt x -Fi:{here}/b.txt", f"Set-Content -Pa:{there}/b.txt {here}/a.txt",
        f"sed -i:.bak 's/a/b/' {there}/a.txt", f"sed -i.bak 's/a/b/' {there}/a.txt", f"sed -i -e 's/a/b/' {there}/a.txt {there}/c.txt",
        f"sed -ibak 's/a/b/' {there}/a.txt", f"sed -ie 's/a/b/' {there}/a.txt", f"sed -ni 's/a/p/p' {there}/a.txt", f"sed -Ei.bak 's/a+/b/' {there}/a.txt",
        f"sed --in-place 's/a/b/' {there}/a.txt", f"sed --in-place=.bak 's/a/b/' {there}/a.txt", f"sed -i '' 's/a/b/' {there}/a.txt",
        f"sed -i .bak 's/a/b/' {there}/a.txt", f"sed -n 's/a/p/p' {there}/a.txt", f"sed -e 's/a/b/' {there}/a.txt", f"sed 's/a/b/' a.txt > {there}/b.txt",
        f"cp -t:x {there}/a.txt", f"cp -t {there} a.txt", f"cp -r a {there}/", f"mv a.txt {there}/b.txt", f"mv -Pa:{there}/a.txt b",
        f"tee -a {there}/a.txt", f"tee -Lit:{there}/a.txt", f"tar -C {there} -xf z.tar", f"tar --directory {there} -xf z.tar",
        f"curl -o {there}/f https://example.com/x", f"curl -O https://example.com/x", f"wget -O {there}/f https://example.com/x",
        f"rm -rf {there}/a", f"rm -f {there}/a.txt", f"rm -Pa:{there}/a.txt", f"touch {there}/a.txt", f"mkdir -p {there}/d", f"chmod -R 755 {there}",
        f"dd if=a of={there}/f", f"git clone https://example.com/x.git {there}/x", f"git init {there}/x", f"echo hi > {there}/a.txt",
        f"echo hi >> {there}/a.txt; echo ho > b.txt", f"cd {there}; echo hi > a.txt", f"powershell -Command \"Set-Content {there}/a.txt x -Fi:*.txt\"",
        f"Rename-Item {there}/a.txt b.txt", f"Rename-Item -Path {there}/a.txt -NewName b.txt", f"Rename-Item {there}/a.txt -NewN:b.txt",
        f"Move-Item {there}/a.txt c.txt", f"Copy-Item a.txt {there}/b.txt", f"Copy-Item a.txt -Destination:{there}/b.txt",
        f"Remove-Item {there}/a.txt -Force:$true -Recurse", f"Out-File -FilePath:{there}/a.txt", f"New-Item {there}/a.txt -Value:x",
        f"Invoke-WebRequest https://example.com/x -OutFile {there}/f", f"Expand-Archive z.zip {there}", f"Expand-Archive z.zip -DestinationPath:{there}",
        "echo hi > out.txt", f"echo hi > {own.as_posix()}/a.txt", "Remove-Item $path", "Set-Content -Pa:$target x", "cp a $dest",
        f"sed -i.bak -e 's/a/b/' {there}/a.txt", f"sed -i -e s1 -e s2 {there}/a.txt {there}/c.txt", f"sed -i -f x.sed {there}/a.txt",
        f"Copy-Item a.txt -Des:{there}/b.txt", f"Move-Item -Pa:{there}/a.txt c.txt", f"Compress-Archive a {there}/o.zip",
    ]
    # Not here: a parameter given by name that is only a target (-Pa:), with a lone word beside it. The old reading took that word for the
    # target; it is the content (`Set-Content -Pa:out.txt value`), which is what is judged now (`test_a_target_given_by_a_cut_short_name_...`).
    for command in commands:
        old_projects, old_outside = old_classify(tmp_path, command, project, reach)
        projects, outside = classify(command, str(project), reach, home=str(tmp_path / "home"))
        assert set(old_projects) <= set(projects) and set(old_outside) <= set(outside), (command, (old_projects, old_outside), (projects, outside))


def test_sed_edits_the_files_it_names_in_place_whichever_way_the_flag_is_written(tmp_path):
    from raphael_core.computer.shell_writes import classify
    project, other, own, reach = _folders(tmp_path)
    there, here = other.as_posix(), project.as_posix()

    def told(command, cwd=project):
        return classify(command, str(cwd), reach, home=str(tmp_path / "home"))

    # GNU: the suffix attached to -i, the letter among others, the long form; BSD: the suffix as a word of its own, or empty.
    for flag in ("-i", "-i.bak", "-ibak", "-ie", "-ni", "-Ei.bak", "--in-place", "--in-place=.bak", "-i ''", "-i .bak", '-i ""'):
        command = f"sed {flag} 's/a/b/' {there}/a.txt"
        assert told(command)[0] == [f"{there}/a.txt"], command
        assert told(f"sed {flag} -e 's/a/b/' {there}/a.txt {there}/c.txt")[0] == [f"{there}/a.txt", f"{there}/c.txt"], command
        assert told(f"sed {flag} 's/a/b/' a.txt {there}/c.txt")[0] == [f"{there}/c.txt"], command
        assert told(f"sed {flag} 's/a/b/' {here}/a.txt") == ([], []), command
    # Without the flag sed only reads its files.
    for command in (f"sed 's/a/b/' {there}/a.txt", f"sed -n 's/a/p/p' {there}/a.txt", f"sed -e 's/a/b/' {there}/a.txt",
                    f"sed -Ee 's/a+/b/' {there}/a.txt", f"sed --quiet 's/a/p/p' {there}/a.txt"):
        assert told(command) == ([], []), command


# --- round five ---------------------------------------------------------------------------------------------------------------


def _told(tmp_path):
    from raphael_core.computer.shell_writes import classify
    project, other, own, reach = _folders(tmp_path)

    def told(command, cwd=project):
        return classify(command, str(cwd), reach, home=str(tmp_path / "home"))

    return told, project.as_posix(), other.as_posix()


def test_sed_edits_in_place_every_input_file_when_an_option_gives_the_script(tmp_path):
    told, here, there = _told(tmp_path)
    for script in ("-e=s/a/b/", "-es/a/b/", "--expression=s/a/b/", "--expr=s/a/b/", "-f=x.sed", "-fx.sed", "--file=x.sed", "--fi=x.sed",
                   "-e 's/a/b/'", "-e s/a/b/", "--expression 's/a/b/'", "-f x.sed", "--file x.sed", "-ne p"):
        for flag in ("-i", "-i.bak", "--in-place=.bak"):
            assert told(f"sed {flag} {script} {there}/a.txt")[0] == [f"{there}/a.txt"], (flag, script)
            assert sorted(told(f"sed {flag} {script} {there}/a.txt {there}/c.txt")[0]) == sorted([f"{there}/a.txt", f"{there}/c.txt"]), (flag, script)
            assert told(f"sed {flag} {script} {here}/a.txt {there}/c.txt")[0] == [f"{there}/c.txt"], (flag, script)
    # With no option for the script the first word is it.
    assert told(f"sed -i.bak 's/a/b/' {there}/a.txt {there}/c.txt")[0] == [f"{there}/a.txt", f"{there}/c.txt"]
    assert told(f"sed -i {there}/a.txt")[0] == []  # a lone word is the script


def test_sed_reads_the_flag_only_among_the_options(tmp_path):
    told, here, there = _told(tmp_path)
    # `ihello` is the script of -e and `-i.bak` after `--` is a file: neither is the flag, and nothing is edited in place.
    for command in (f"sed -eihello {there}/a.txt {there}/b.txt > {here}/out", f"sed -e ihello {there}/a.txt > {here}/out",
                    f"sed -- 's/a/b/' {there}/x -i.bak > {here}/out", f"sed -f -i.bak {there}/a.txt > {here}/out",
                    f"sed --expression=-i.bak {there}/a.txt > {here}/out", f"sed -n -e 's/i/p/' {there}/a.txt"):
        assert told(command) == ([], []), command
    # While a flag before them still is one.
    assert told(f"sed -i -- 's/a/b/' {there}/x")[0] == [f"{there}/x"]
    assert told(f"sed -ne p -i {there}/a.txt")[0] == [f"{there}/a.txt"]


def test_a_cmdlet_that_reads_a_path_is_not_taken_to_write_it_when_the_parameter_is_cut_short(tmp_path):
    told, here, there = _told(tmp_path)
    # A copy, an archive, a download and a transfer write their destination and read their source.
    for command in (f"Copy-Item -Pat:{there}/a.txt -Des:{here}/out.txt", f"Copy-Item -Lit:{there}/a.txt -Dest:{here}/out.txt",
                    f"Copy-Item -Path:{there}/a.txt -Des:{here}/out.txt", f"Expand-Archive -Pat:{there}/z.zip -DestinationP:{here}/o",
                    f"Expand-Archive -Lit:{there}/z.zip -Des:{here}/o", f"Compress-Archive -Pat:{there}/src -DestinationP:{here}/o.zip",
                    f"Compress-Archive {there}/src {here}/o.zip", f"Invoke-WebRequest https://example.com/x -OutF:{here}/f",
                    f"Start-BitsTransfer -Sou:{there}/a -Des:{here}/b", f"Start-BitsTransfer {there}/a {here}/b",
                    f"Copy-ItemProperty -Pat:{there}/a -Name n -Des:{here}/b"):
        assert told(command) == ([], []), command
    # ... and the destination in the other project is a write there.
    for command in (f"Copy-Item -Pat:{here}/a.txt -Des:{there}/out.txt", f"Expand-Archive -Pat:{here}/z.zip -Des:{there}/o",
                    f"Expand-Archive -Pat:{here}/z.zip -DestinationP:{there}/o", f"Compress-Archive -Pat:{here}/src -DestinationP:{there}/o.zip",
                    f"Compress-Archive {here}/src {there}/o.zip", f"Start-BitsTransfer {here}/a {there}/b",
                    f"Invoke-WebRequest https://example.com/x -OutF:{there}/f", f"Copy-ItemProperty -Pat:{here}/a -Name n -Des:{there}/b"):
        assert told(command)[0], command
    # A move, a rename and a delete change every path they are given.
    for command in (f"Move-Item -Pat:{there}/a.txt -Des:{here}/b", f"Move-Item -Pat:{here}/a.txt -Des:{there}/b",
                    f"Remove-Item -Pat:{there}/a.txt", f"Rename-Item -Lit:{there}/a.txt b.txt", f"Rename-Item -Pat:{there}/a.txt -New:b.txt"):
        assert told(command)[0], command
    # What it is cut short to may be more than one thing: both are judged (-Des is Destination and DestinationPath).
    assert told(f"Copy-Item a.txt -Des:{there}/b.txt")[0] == [f"{there}/b.txt"]


def test_a_target_given_by_a_cut_short_name_still_judges_the_word_beside_it_as_the_reading_by_words_always_did(tmp_path):
    told, here, there = _told(tmp_path)
    # Known false refusal, accepted: the lone word beside a target given by a cut-short name is the content, and the reading by
    # words (unchanged since it was first made) takes it for the target. Over-judging is allowed; missing a write is not.
    for command in (f"Set-Content -Pa:{here}/out.txt {there}/a.txt", f"Set-Content -Pat:{here}/out.txt {there}/a.txt",
                    f"Set-Content -Lit:{here}/out.txt {there}/a.txt", f"Add-Content -PSP:{here}/out.txt {there}/a.txt",
                    f"Out-File -Pat:{here}/out.txt {there}/a.txt", f"Set-Content {there}/a.txt -Pa:{here}/out.txt",
                    f"Clear-Content -Lit:{here}/out.txt {there}/a.txt", f"Start-Transcript -OutputD:{here}/t {there}/a.txt"):
        assert told(command)[0] == [f"{there}/a.txt"], command
    # The target in the other project is the write, whatever words are beside it.
    for command in (f"Set-Content -Pa:{there}/out.txt {here}/a.txt", f"Set-Content -Lit:{there}/out.txt x", f"Out-File -Pat:{there}/o x"):
        assert told(command)[0], command
    # A name that may be a filter (-Fi) is not a target given: the first word still is.
    assert told(f"Set-Content {there}/a.txt x -Fi:*.txt")[0] == [f"{there}/a.txt"]
    # And a name written out, as it always was.
    assert told(f"Set-Content -Path {here}/out.txt {there}/a.txt") == ([], [])
    assert told(f"New-Item -Pa:{there} -Name a.txt")[0]


# --- round six: the union of the reading by words and the additions -----------------------------------------------------------


def test_the_answer_is_the_union_of_the_old_reading_and_the_additions_by_construction(tmp_path):
    from raphael_core.computer import shell_writes
    told, here, there = _told(tmp_path)
    project, other, own, reach = _folders(tmp_path)
    for command in (f"Set-Content -Pa:{here}/out.txt {there}/a.txt", f"sed -i.bak -e=s/a/b/ {there}/a.txt", f"Remove-Item {there}/a, {there}/b",
                    f"Copy-Item -LiteralPath {here}/a {there}/d", f"echo hi > {there}/o; Set-Content -Pat:{there}/x y", "echo hi"):
        classic = shell_writes._classic_classify(command, str(project), reach, home=str(tmp_path / "home"))
        both = shell_writes.classify(command, str(project), reach, home=str(tmp_path / "home"))
        assert set(classic[0]) <= set(both[0]) and set(classic[1]) <= set(both[1]), command
        assert both[0][:len(classic[0])] == classic[0] and both[1][:len(classic[1])] == classic[1], command  # the old answer first


def test_an_addition_that_fails_never_takes_away_the_classic_reading(tmp_path, monkeypatch):
    from raphael_core.computer import shell_writes
    project, other, own, reach = _folders(tmp_path)
    command = f"echo ok > {other}/classic.txt; Out-File -FileP:{other}/extra.txt"
    classic = shell_writes._classic_classify(command, str(project), reach, home=str(tmp_path / "home"))
    assert classic[0]  # the classic reading finds the write into the other project
    def broken(*args, **kwargs):
        raise RuntimeError("an addition broke")
    monkeypatch.setattr(shell_writes, "_extra_classify", broken)
    assert shell_writes.classify(command, str(project), reach, home=str(tmp_path / "home")) == classic


def test_what_the_codex_reviews_found_missed_is_judged(tmp_path):
    told, here, there = _told(tmp_path)
    # A comma array, written with and without spaces, after a parameter or not.
    for command in (f"Set-Content -Pat:{here}/a.txt, {there}/b.txt x", f"Set-Content -Pat:{here}/a.txt,{there}/b.txt x",
                    f"Set-Content -Path {here}/a.txt, {there}/b.txt x", f"Set-Content -Path:{here}/a.txt,{there}/b.txt x",
                    f"Remove-Item {here}/a.txt, {there}/b.txt", f"Remove-Item {here}/a.txt,{there}/b.txt", f"Remove-Item -LP {here}/a, {there}/b",
                    f"Out-File -FilePath {here}/a, {there}/b", f"Set-Content {here}/a ,{there}/b x", f"Move-Item -Path {here}/a, {there}/b {here}/c",
                    f"Add-Content -LiteralPath:{here}/a,{there}/b -Value:x"):
        assert f"{there}/b.txt" in told(command)[0] or f"{there}/b" in told(command)[0], command
    # What is a value in the array is not a path (`-Value a, b`), and an array of the own project is nothing.
    assert told(f"Set-Content -Path {here}/a.txt -Value 'x, y'") == ([], [])
    assert told(f"Remove-Item {here}/a, {here}/b") == ([], [])
    # BSD's -l takes no argument, GNU's takes one: both readings are made, and the in-place flag after it is judged.
    for command in (f"sed -l -i '' 's/a/b/' {there}/a.txt", f"sed -li 's/a/b/' {there}/a.txt", f"sed -l 5 -i 's/a/b/' {there}/a.txt",
                    f"sed -l -i.bak 's/a/b/' {there}/a.txt", f"sed -nli 's/a/p/p' {there}/a.txt", f"sed -l -i -e 's/a/b/' {there}/a.txt"):
        assert told(command)[0] == [f"{there}/a.txt"], command
    # A source given by name leaves the word beside it as the destination, for a copy, an archive and a transfer.
    for command in (f"Copy-Item -LiteralPath {here}/a {there}/d", f"Copy-Item -Path {here}/a {there}/d", f"Copy-Item -PSPath {here}/a {there}/d",
                    f"Copy-Item -Path:{here}/a {there}/d", f"Expand-Archive -LiteralPath {here}/z.zip {there}/o",
                    f"Compress-Archive -LiteralPath {here}/src {there}/o.zip", f"Compress-Archive -Path {here}/src {there}/o.zip",
                    f"Start-BitsTransfer -Source:https://example.com/x {there}/dest", f"Start-BitsTransfer -Source https://example.com/x {there}/dest",
                    f"Copy-Item -Path {here}/a -Destination {there}/d"):
        assert told(command)[0], command
    assert told(f"Copy-Item -LiteralPath {there}/a {here}/d") == ([], [])  # its source in the other project is only read
    # The backup template of GNU sed's -i goes where it says, whatever directory the file is in.
    for command in (f"sed -i'{there}/*.bak' 's/a/b/' {here}/a.txt", f"sed --in-place='{there}/*.bak' 's/a/b/' {here}/a.txt",
                    f"sed -i'{there}/bak.*' -e 's/a/b/' {here}/a.txt", f"sed -i'../other/*.bak' 's/a/b/' {here}/a.txt"):
        assert told(command)[0], command
    assert told(f"sed -i'*.bak' 's/a/b/' {here}/a.txt") == ([], [])  # next to the file, as the file is
    assert told(f"sed -i'bak/*' 's/a/b/' {here}/a.txt") == ([], [])  # a folder of the own project


def test_the_old_reading_is_kept_whole_and_the_new_one_never_judges_less(tmp_path):
    from raphael_core.computer import shell_writes
    project, other, own, reach = _folders(tmp_path)
    there, here = other.as_posix(), project.as_posix()
    commands = [
        # every command of the properties above, and what the reviews of the later versions found
        f"Set-Content {there}/a.txt x -Fi:*.txt", f"Set-Content -Pa:{here}/b.txt {there}/a.txt", f"sed -i:.bak 's/a/b/' {there}/a.txt",
        f"sed -i -e s1 -e s2 {there}/a.txt {there}/c.txt", f"sed -i '' 's/a/b/' {there}/a.txt", f"sed -i .bak 's/a/b/' {there}/a.txt",
        f"Copy-Item -Pat:{there}/a.txt -Des:{here}/out.txt", f"Copy-Item -LiteralPath {here}/a {there}/d", f"Set-Content -Pat:{here}/a.txt, {there}/b.txt x",
        f"sed -l -i '' 's/a/b/' {there}/a.txt", f"sed -i'{there}/*.bak' 's/a/b/' {here}/a.txt", f"cp -t {there} a.txt", f"mv a {there}/b", f"tee -a {there}/a",
        f"tar -C {there} -xf z.tar", f"curl -o {there}/f https://example.com", f"rm -rf {there}/a", f"dd if=a of={there}/f",
        f"Rename-Item -Lit:{there}/a.txt b.txt", f"Rename-Item {there}/a.txt -NewName b.txt", f"Move-Item {there}/a.txt c.txt",
        f"Expand-Archive -LiteralPath {here}/z.zip {there}/o", f"echo hi > {there}/a; echo ho >> b", f"cd {there}; echo hi > a", "Remove-Item $path",
        f"powershell -Command \"Set-Content -Pat:{here}/a.txt, {there}/b.txt x\"", f"git clone https://example.com/x.git {there}/x",
    ]
    for command in commands:
        for cwd in (project, other):
            classic = shell_writes._classic_classify(command, str(cwd), reach, home=str(tmp_path / "home"))
            old = old_classify(tmp_path, command, cwd, reach)
            assert classic == old, command  # kept whole: the very answer of the version it was kept from
            both = shell_writes.classify(command, str(cwd), reach, home=str(tmp_path / "home"))
            assert set(old[0]) <= set(both[0]) and set(old[1]) <= set(both[1]), (command, old, both)
    # And what the versions between answered, kept as they were (hard-coded): nothing of it is lost.
    told, _, _ = _told(tmp_path)
    assert told(f"Set-Content {there}/a.txt x -Fi:*.txt")[0] == [f"{there}/a.txt"]  # round four, A
    assert told(f"sed -i:.bak 's/a/b/' {there}/a.txt")[0] == [f"{there}/a.txt"]  # round four, B
    assert told(f"sed -i.bak -e 's/a/b/' {there}/a.txt {there}/c.txt")[0] == [f"{there}/a.txt", f"{there}/c.txt"]  # round five
    assert told(f"Copy-Item -Pat:{here}/a.txt -Des:{there}/out.txt")[0] == [f"{there}/out.txt"]  # round five
    assert told(f"Copy-Item -Pat:{there}/a.txt -Des:{here}/out.txt") == ([], [])  # the old reading found nothing here, and nothing is added

"""R-FILE-06 on the member's own computer and on the host computer: only the folders of the owner's PC are the PC's.

A folder bound into the computer (the member's folder, the team's, a project) is a folder of the owner's PC; the rest of
the computer is the computer's own. A write onto a bound folder that is not the member's work folder is the owner's yes in
every mode but 全部允許 (which is that yes, handed to the tool by the door), and the computer's own helper holds an unasked
write to the work folder even through a link made inside the computer. The fake docker answers the helper by running it
(`files_guest.handle`) on folders of the test.
"""

import base64
import json
import os

import pytest

from raphael_core import work_area
from raphael_core.brain.settings import SettingsStore
from raphael_core.agent.gate import ToolGate
from raphael_core.agent.policy import Action, Tier
from raphael_core.computer import files_guest
from raphael_core.computer.host_computer import HostComputerTools
from raphael_core.computer.vm import GUEST, SHARED, LocalVm
from raphael_core.computer.vm_tools import BROWSER_OPEN, VmTools, vm_scope
from raphael_core.services.attachment_store import AttachmentStore

from .test_file_tools import GuestRuntime
from .test_vm import Bridge, EmptyHub, container


@pytest.fixture
async def computer(tmp_path, conn):
    """A member's own computer with a project bound into it, the project chosen or not by the test."""
    settings = SettingsStore(conn)
    settings.set("computer_vm_mode", "per-bot")
    project = tmp_path / "project"
    project.mkdir()
    settings.set("project_folders", [str(project)])
    runtime = GuestRuntime(tmp_path / "guest")
    vm = LocalVm(tmp_path / "data", settings=settings, runner=runtime, clock=lambda: 0)
    target = await vm.seat()
    [(guest, _)] = target.projects
    runtime.folders[guest] = project
    runtime.raw = container(vm, target, runtime)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path / "attachments"), bridge=Bridge)
    await hub.prepare()
    return hub, runtime, settings, project, guest


@pytest.fixture
async def two_projects(tmp_path, conn):
    """A member's own computer with two projects bound into it (read-only there, like every project), none chosen yet."""
    settings = SettingsStore(conn)
    settings.set("computer_vm_mode", "per-bot")
    first, second = tmp_path / "first", tmp_path / "second"
    for folder in (first, second):
        folder.mkdir()
    settings.set("project_folders", [str(first), str(second)])
    runtime = GuestRuntime(tmp_path / "guest")
    vm = LocalVm(tmp_path / "data", settings=settings, runner=runtime, clock=lambda: 0)
    target = await vm.seat()
    guests = {source: guest for guest, source in target.projects}
    for source, guest in guests.items():
        runtime.folders[guest] = source
    runtime.raw = container(vm, target, runtime)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path / "attachments"), bridge=Bridge)
    await hub.prepare()
    return hub, runtime, settings, (first, second), (guests[first], guests[second])


def key_of(hub, name):
    return next(tool.key for tool in hub.offered() if tool.name == name)


async def call(hub, name, approver, **arguments):
    with vm_scope(("turn", 0, 1), turn_id=7):
        return await hub.call(key_of(hub, name), arguments, approver=approver)


def tiers(hub, *paths, name="write_file"):
    return [hub.tier_for_call(key_of(hub, name), {"path": path, "content": "x"}) for path in paths]


async def test_with_no_project_chosen_the_computers_own_folder_and_the_team_are_the_work_folder(computer):
    hub, runtime, settings, project, guest = computer
    assert tiers(hub, f"{GUEST}/a.txt", "a.txt", f"{SHARED}/a.txt", "/tmp/a.txt", "/home/cua/elsewhere/a.txt") == [Tier.T0] * 5
    # A project is none of its work folder, and no one's to write: refused, so nothing asks (the tests of the refusal follow).
    assert tiers(hub, f"{guest}/a.txt", f"{guest}/sub/../a.txt") == [Tier.T0] * 2
    assert not hub.firm_for_call(key_of(hub, "write_file"), {"path": f"{guest}/a.txt", "content": "x"})
    assert not hub.firm_for_call(key_of(hub, "write_file"), {"path": "a.txt", "content": "x"})


async def test_with_a_project_chosen_the_project_alone_is_the_work_folder_and_the_rest_of_the_computer_is_free(computer):
    hub, runtime, settings, project, guest = computer
    settings.set("member_work_folder", {"0": str(project)})
    assert tiers(hub, f"{guest}/a.txt", "a.txt", "sub/a.txt", "/tmp/a.txt", "/home/cua/elsewhere/a.txt") == [Tier.T0] * 5
    assert tiers(hub, f"{GUEST}/a.txt", f"{SHARED}/a.txt", "~/workspace/a.txt", f"{guest}/../../workspace/a.txt") == [Tier.T3] * 4
    assert tiers(hub, f"{GUEST}/a.txt", name="edit_file") == [Tier.T3]  # edit_file is held the same way
    assert tiers(hub, f"{GUEST}/a.txt", name="read_file") == [Tier.T0]  # reads are not held


async def test_a_write_onto_the_pc_outside_the_work_folder_is_refused_without_a_yes_and_made_with_one(computer):
    hub, runtime, settings, project, guest = computer
    settings.set("member_work_folder", {"0": str(project)})
    refused = await call(hub, "write_file", "auto", path=f"{GUEST}/a.txt", content="x")
    assert refused.kind == "approval_required" and not (runtime.folders[GUEST] / "a.txt").exists()
    made = await call(hub, "write_file", "user", path=f"{GUEST}/a.txt", content="x")
    assert made.ok and (runtime.folders[GUEST] / "a.txt").read_text() == "x"
    inside = await call(hub, "write_file", "auto", path="b.txt", content="y")
    assert inside.ok and (project / "b.txt").read_text() == "y"
    # What the owner said yes to is made where it was asked, and the helper was not told to hold it. The work folder is a
    # project, read-only in the computer, so its write was made on the PC and never reached the computer's helper.
    requests = [json.loads(kwargs["input"]) for args, kwargs in runtime.calls if kwargs.get("input")]
    held = [request for request in requests if request["action"] == "write"]
    assert len(held) == 1 and "allowed" not in held[0] and held[0]["path"] == f"{GUEST}/a.txt"


async def test_the_card_of_a_computers_write_names_where_it_lands(computer):
    hub, runtime, settings, project, guest = computer
    settings.set("member_work_folder", {"0": str(project)})
    assert hub.landing(key_of(hub, "write_file"), {"path": f"{guest}/../../workspace/a.txt"}, 0) == {"path": f"{GUEST}/a.txt"}
    assert hub.landing(key_of(hub, "write_file"), {"path": "a.txt"}, 0) == {"path": f"{guest}/a.txt"}
    assert hub.landing(key_of(hub, "read_file"), {"path": "a.txt"}, 0) is None


@pytest.mark.parametrize("mode", ["direct", "ask", "plan"])
async def test_a_write_onto_the_pc_outside_the_work_folder_is_asked_by_the_door_in_every_mode_but_allow_all(computer, conn, mode):
    hub, runtime, settings, project, guest = computer
    settings.set("member_work_folder", {"0": str(project)})
    settings.set("action_mode", mode)
    gate = ToolGate(hub, conn=conn)
    key = key_of(hub, "write_file")
    outside = {"path": f"{GUEST}/a.txt", "content": "x"}
    assert gate.needs_confirmation(key, outside) and gate.firm_confirmation(key, outside)
    with vm_scope(("turn", 0, 1), turn_id=7):
        refused = await gate.call_plugin(key, outside)
    assert not refused.ok and not (runtime.folders[GUEST] / "a.txt").exists()


async def test_allow_all_writes_onto_the_pc_outside_the_work_folder_with_no_card(computer, conn):
    hub, runtime, settings, project, guest = computer
    settings.set("member_work_folder", {"0": str(project)})
    settings.set("action_mode", "bypass")
    gate = ToolGate(hub, conn=conn)
    key = key_of(hub, "write_file")
    outside, inside = {"path": f"{GUEST}/a.txt", "content": "x"}, {"path": "b.txt", "content": "y"}
    assert not gate.needs_confirmation(key, outside) and not gate.firm_confirmation(key, outside)
    with vm_scope(("turn", 0, 1), turn_id=7):
        made = await gate.call_plugin(key, outside)
        near = await gate.call_plugin(key, inside)
    assert made.ok and (runtime.folders[GUEST] / "a.txt").read_text() == "x"
    assert near.ok and (project / "b.txt").read_text() == "y"
    # The owner said yes to every place, so the helper is told to hold nothing, not even a link made inside the computer.
    requests = [json.loads(kwargs["input"]) for args, kwargs in runtime.calls if kwargs.get("input")]
    held = [request for request in requests if request["action"] == "write"]
    assert held and all("allowed" not in request for request in held)


async def test_allow_all_asks_nothing_of_the_host_computers_outside_writes(tmp_path, conn):
    settings = SettingsStore(conn)
    project = tmp_path / "project"
    project.mkdir()
    settings.set("project_folders", [str(project)])
    settings.set("member_work_folder", {"1": str(project)})
    vm = LocalVm(tmp_path / "data", settings=settings)
    hub = VmTools(EmptyHub(), vm, attachments=None, conn=conn)
    hub.host_computer = HostComputerTools(vm, conn, BROWSER_OPEN)
    key = next(tool.key for tool in hub.host_computer.offered(1) if tool.name == "write_file")
    outside = {"path": str(tmp_path / "other.txt"), "content": "x"}
    gate = ToolGate(hub, conn=conn)
    with vm_scope(("turn", 1, 2), turn_id=1):
        for mode in ("direct", "ask", "plan"):
            settings.set("action_mode", mode)
            assert gate.needs_confirmation(key, outside) and gate.firm_confirmation(key, outside), mode
        settings.set("action_mode", "bypass")
        assert not gate.needs_confirmation(key, outside) and not gate.firm_confirmation(key, outside)
        assert gate._door(Action(key, outside), None) == "user"


def test_the_helper_holds_an_unasked_write_to_the_work_folder_even_through_a_link_made_in_the_computer(tmp_path):
    from agent.test_owner_files import _link_folder
    workspace, team, elsewhere = tmp_path / "workspace", tmp_path / "team", tmp_path / "elsewhere"
    for folder in (workspace, team, elsewhere):
        folder.mkdir()
    _link_folder(elsewhere / "door", team)
    request = {"action": "write", "path": str(elsewhere / "door" / "a.txt"), "expected": "absent", "data": base64.b64encode(b"x").decode(),
               "roots": [str(workspace), str(team)]}
    assert not files_guest.confined({**request, "allowed": [str(workspace)]})
    assert files_guest.handle({**request, "allowed": [str(workspace)]}) == {"error": "outside"} and not (team / "a.txt").exists()
    # A write that was asked about, or one that never meets a bound folder, is not held.
    assert files_guest.confined({**request, "allowed": [str(workspace), str(team)]}) and files_guest.confined(request)
    assert files_guest.confined({**request, "path": str(elsewhere / "plain.txt"), "allowed": [str(workspace)]})


async def test_an_outside_write_the_computer_finds_through_a_link_is_not_made_and_says_so(computer, monkeypatch):
    hub, runtime, settings, project, guest = computer
    settings.set("member_work_folder", {"0": str(project)})
    monkeypatch.setattr(files_guest, "confined", lambda request: False)
    refused = await call(hub, "write_file", "auto", path="a.txt", content="x")
    assert not refused.ok and refused.kind == "outside_work_area" and not (project / "a.txt").exists()


async def test_a_refused_project_the_computer_finds_through_a_link_is_not_made_and_says_so(computer, monkeypatch):
    hub, runtime, settings, project, guest = computer
    settings.set("member_work_folder", {"0": str(project)})
    monkeypatch.setattr(files_guest, "refusing", lambda request: True)
    refused = await call(hub, "write_file", "user", path=f"{GUEST}/a.txt", content="x")  # the owner's yes changes nothing
    assert not refused.ok and refused.kind == "forbidden" and work_area.UNCHOSEN_WORDS in refused.text
    assert not (runtime.folders[GUEST] / "a.txt").exists()


# --- the host computer, as the same member's tools ---------------------------------------------------------------------


async def test_the_host_computers_writes_are_asked_about_through_the_one_hub_and_name_where_they_land(tmp_path, conn):
    settings = SettingsStore(conn)
    project = tmp_path / "project"
    project.mkdir()
    settings.set("project_folders", [str(project)])
    settings.set("member_work_folder", {"1": str(project)})
    vm = LocalVm(tmp_path / "data", settings=settings)
    hub = VmTools(EmptyHub(), vm, attachments=None, conn=conn)
    hub.host_computer = HostComputerTools(vm, conn, BROWSER_OPEN)
    key = next(tool.key for tool in hub.host_computer.offered(1) if tool.name == "write_file")
    own = hub.host_computer.folders(1)[0]
    with vm_scope(("turn", 1, 2), turn_id=1):
        assert hub.firm_for_call(key, {"path": str(own / "a.txt"), "content": "x"})
        assert not hub.firm_for_call(key, {"path": str(project / "a.txt"), "content": "x"})
        assert hub.landing(key, {"path": "sub/../a.txt", "content": "x"}, 1) == {"path": str(project / "a.txt")}
    assert hub.landing(key, {"path": "../x.txt"}, 1) == {"path": str(project.parent / "x.txt")}


# --- a project is read-only in the computer; its chosen member writes it through the file tools (R-COMP-PROJECT-01) ----------


def _link_folder(link, target):
    """A folder link as a person makes one without special rights: a junction on Windows, a symbolic link elsewhere."""
    if os.name == "nt":
        import _winapi
        _winapi.CreateJunction(str(target), str(link))
    else:
        os.symlink(target, link, target_is_directory=True)


def guest_writes(runtime):
    return [json.loads(kwargs["input"]) for args, kwargs in runtime.calls if kwargs.get("input")
            if json.loads(kwargs["input"])["action"] == "write"]


async def test_a_chosen_project_is_written_on_the_pc_and_the_computers_own_helper_never_writes_it(two_projects):
    hub, runtime, settings, (first, second), (first_guest, second_guest) = two_projects
    settings.set("member_work_folder", {"0": str(first)})
    made = await call(hub, "write_file", "auto", path=f"{first_guest}/sub/a.txt", content="x")
    assert made.ok and (first / "sub" / "a.txt").read_text() == "x"
    read = await call(hub, "read_file", "auto", path=f"{first_guest}/sub/a.txt")
    assert read.ok
    edited = await call(hub, "edit_file", "auto", path=f"{first_guest}/sub/a.txt", old_string="x", new_string="y")
    assert edited.ok and (first / "sub" / "a.txt").read_text() == "y"
    assert guest_writes(runtime) == []  # the mount is read-only: nothing was sent for the computer to write


async def test_a_project_the_member_did_not_choose_is_never_written_with_or_without_a_yes(two_projects):
    hub, runtime, settings, (first, second), (first_guest, second_guest) = two_projects
    settings.set("member_work_folder", {"0": str(first)})
    assert tiers(hub, f"{first_guest}/a.txt") == [Tier.T0]
    # Nothing asks for it: it is refused by the tool whatever is said (R-FILE-06).
    assert tiers(hub, f"{second_guest}/a.txt", f"{second_guest}/sub/../a.txt") == [Tier.T0] * 2
    assert not hub.firm_for_call(key_of(hub, "write_file"), {"path": f"{second_guest}/a.txt", "content": "x"})
    for approver in ("auto", "user"):
        refused = await call(hub, "write_file", approver, path=f"{second_guest}/a.txt", content="x")
        assert refused.kind == "forbidden" and work_area.UNCHOSEN_WORDS in refused.text and not (second / "a.txt").exists()
        edit_refused = await call(hub, "edit_file", approver, path=f"{second_guest}/a.txt", old_string="", new_string="x")
        assert edit_refused.kind == "forbidden" and not (second / "a.txt").exists()
    assert guest_writes(runtime) == []


async def test_with_no_project_chosen_every_project_is_refused(two_projects):
    hub, runtime, settings, (first, second), (first_guest, second_guest) = two_projects
    assert tiers(hub, f"{first_guest}/a.txt", f"{second_guest}/a.txt") == [Tier.T0] * 2
    for guest, folder in ((first_guest, first), (second_guest, second)):
        for approver in ("auto", "user"):
            refused = await call(hub, "write_file", approver, path=f"{guest}/a.txt", content="x")
            assert refused.kind == "forbidden" and not (folder / "a.txt").exists()
    # The member's own folder is its work folder then, and is written.
    assert (await call(hub, "write_file", "auto", path="a.txt", content="x")).ok


async def test_a_project_taken_off_the_list_leaves_the_member_choosing_nothing(two_projects):
    # Issue 312: a work folder that is not a remembered project is no work folder, so the listed one is not either.
    hub, runtime, settings, (first, second), (first_guest, second_guest) = two_projects
    settings.set("member_work_folder", {"0": str(first)})
    assert (await call(hub, "write_file", "auto", path=f"{first_guest}/a.txt", content="x")).ok
    assert (await call(hub, "write_file", "user", path=f"{second_guest}/a.txt", content="x")).kind == "forbidden"
    settings.set("project_folders", [str(second)])
    assert settings.get("member_work_folder") == {}
    assert (await call(hub, "write_file", "user", path=f"{second_guest}/a.txt", content="x")).kind == "forbidden"
    assert not (second / "a.txt").exists()


async def test_a_link_inside_a_project_is_never_followed_by_a_write_on_the_pc(two_projects, tmp_path):
    hub, runtime, settings, (first, second), (first_guest, second_guest) = two_projects
    settings.set("member_work_folder", {"0": str(first)})
    _link_folder(first / "door", second)
    refused = await call(hub, "write_file", "auto", path=f"{first_guest}/door/a.txt", content="x")
    assert not refused.ok and not (second / "a.txt").exists()
    assert not (await call(hub, "write_file", "user", path=f"{first_guest}/door/a.txt", content="x")).ok
    assert not (second / "a.txt").exists()


@pytest.mark.parametrize("mode", ["direct", "ask", "plan", "bypass"])
async def test_the_door_never_asks_about_a_project_the_member_did_not_choose_and_the_tool_refuses_it_in_every_mode(two_projects, conn, mode):
    hub, runtime, settings, (first, second), (first_guest, second_guest) = two_projects
    settings.set("member_work_folder", {"0": str(first)})
    settings.set("action_mode", mode)
    key = key_of(hub, "write_file")
    other = {"path": f"{second_guest}/a.txt", "content": "x"}
    gate = ToolGate(hub, conn=conn)
    assert not gate.needs_confirmation(key, other) and not gate.firm_confirmation(key, other)
    with vm_scope(("turn", 0, 1), turn_id=7):
        refused = await gate.call_plugin(key, other)
        near = await gate.call_plugin(key, {"path": f"{first_guest}/a.txt", "content": "y"})
    assert refused.kind == "forbidden" and not (second / "a.txt").exists()
    assert near.ok and (first / "a.txt").read_text() == "y"


def _files(*folders):
    return sorted(str(path.relative_to(folder)) for folder in folders for path in folder.rglob("*") if path.is_file())


async def test_a_name_the_computer_reads_as_plain_letters_cannot_take_a_project_write_out_of_the_project(two_projects, tmp_path):
    # The computer sees a backslash as a letter of a name, finds no such file and lets the write through unasked; Windows
    # reads it as a separator. The host resolves the real place itself and refuses (no card) what is not below the project.
    hub, runtime, settings, (first, second), (first_guest, second_guest) = two_projects
    settings.set("member_work_folder", {"0": str(first)})
    (first / "sub").mkdir()
    nt = os.name == "nt"
    for name in (rf"sub\..\..\{second.name}\a.txt",  # climbs out to the sibling project
                 r"sub\..\..\a.txt",  # climbs out to the folder that holds both
                 r"\\host\share\a.txt",  # a UNC name
                 r"C:\a.txt", "C:a.txt",  # a drive, absolute or relative to the drive's folder
                 "a.txt:stream", "a.txt::$DATA", r"sub:x\a.txt",  # an alternate data stream
                 "a.txt.", "sub./a.txt", "sub /a.txt", ".. /a.txt", "..../a.txt"):  # Windows trims a trailing dot or space
        refused = await call(hub, "write_file", "auto", path=f"{first_guest}/{name}", content="x")
        assert not refused.ok or not nt, name
        assert _files(second) == [] and not (tmp_path / "a.txt").exists(), name
        if nt:
            assert _files(first) == [], name
    assert guest_writes(runtime) == []


async def test_a_dot_dot_or_an_absolute_path_is_the_owners_yes_and_never_a_write_below_the_project(two_projects):
    hub, runtime, settings, (first, second), (first_guest, second_guest) = two_projects
    settings.set("member_work_folder", {"0": str(first)})
    for path in (f"{first_guest}/../{second_guest.rsplit('/', 1)[1]}/a.txt", f"{second_guest}/a.txt", "/etc/a.txt"):
        refused = await call(hub, "write_file", "auto", path=path, content="x")
        assert not refused.ok and _files(first, second) == [], path
    # The host's own door, asked directly: a request that names a place outside is refused whatever the gate said.
    for relative in ("../a.txt", "sub/../../a.txt", "./a.txt", ""):
        answer = LocalVm.project_write({"action": "write", "path": f"{first_guest}/{relative}", "data": "eA==", "expected": "absent"},
                                       first, relative)
        assert "error" in answer and _files(first, second) == [], relative


async def test_a_project_write_is_refused_when_its_real_place_is_not_below_the_project(two_projects, tmp_path, monkeypatch):
    # Whatever a name looks like to the gate and to this host's rules, where it really lands decides.
    hub, runtime, settings, (first, second), (first_guest, second_guest) = two_projects
    real = os.path.realpath

    def moved(path, *args, **kwargs):
        path = real(path, *args, **kwargs)
        return str(second / "a.txt") if path.endswith("a.txt") and path.startswith(str(first)) else path
    monkeypatch.setattr(os.path, "realpath", moved)
    request = {"action": "write", "path": f"{first_guest}/a.txt", "data": "eA==", "expected": "absent"}
    assert LocalVm.project_write(request, first, "a.txt") == {"error": "outside"}
    assert _files(first, second) == []


class Chosen:
    """A project folder as the owner chose it, whatever this host's own path type would make of its text."""

    def __init__(self, text):
        self.text = text

    def __str__(self):
        return self.text


def _watch_the_host_root(monkeypatch, system):
    """Run `project_write` as `system` with no disk: what the real-path check was given, and what the helper was handed."""
    seen = {"real": [], "helper": []}
    monkeypatch.setattr(files_guest.os, "name", system)
    monkeypatch.setattr(os.path, "realpath", lambda path, *args, **kwargs: seen["real"].append(str(path)) or str(path))
    monkeypatch.setattr(files_guest, "handle", lambda request: seen["helper"].append(request) or {"ok": True})
    return seen


def test_a_project_folder_whose_name_holds_a_backslash_is_the_host_root_as_it_is(monkeypatch):
    # On macOS and Linux a backslash is a letter of a name. Turned into a separator it would name another folder, and a
    # write would land there when that folder exists.
    seen = _watch_the_host_root(monkeypatch, "posix")
    request = {"action": "write", "path": "/home/cua/projects/p/x.txt", "data": "eA==", "expected": "absent"}
    assert LocalVm.project_write(request, Chosen("/work/a\\b"), "x.txt") == {"ok": True}
    assert seen["real"][0] == "/work/a\\b"
    [handed] = seen["helper"]
    assert handed["roots"] == ["/work/a\\b"] and handed["path"] == "/work/a\\b/x.txt"


@pytest.mark.skipif(os.name == "nt", reason="a backslash is a separator on Windows")
async def test_a_write_under_a_folder_with_a_backslash_in_its_name_stays_in_that_folder(two_projects, tmp_path):
    hub, runtime, settings, (first, second), (first_guest, second_guest) = two_projects
    plain = tmp_path / "a" / "b"  # the folder the name would become if its backslash were a separator
    plain.mkdir(parents=True)
    odd = tmp_path / "a\\b"
    odd.mkdir()
    answer = LocalVm.project_write({"action": "write", "path": f"{first_guest}/x.txt", "data": "eA==", "expected": "absent"},
                                   odd, "x.txt")
    assert "error" not in answer and (odd / "x.txt").read_bytes() == b"x"
    assert _files(plain, first, second) == []


def test_a_drive_root_chosen_as_a_project_stays_the_drive_root(monkeypatch):
    # `D:` alone is the drive's current folder, not its root.
    seen = _watch_the_host_root(monkeypatch, "nt")
    request = {"action": "write", "path": "/home/cua/projects/d/x.txt", "data": "eA==", "expected": "absent"}
    assert LocalVm.project_write(request, Chosen("D:\\"), "sub/x.txt") == {"ok": True}
    assert seen["real"][0] == "D:/"
    [handed] = seen["helper"]
    assert handed["roots"] == ["D:/"] and handed["path"] == "D:/sub/x.txt"
    # A folder of the drive keeps its own name, with Windows' separator the one the helper splits on.
    seen["helper"].clear()
    assert LocalVm.project_write(request, Chosen("D:\\work\\p"), "x.txt") == {"ok": True}
    assert seen["helper"][0]["roots"] == ["D:/work/p"] and seen["helper"][0]["path"] == "D:/work/p/x.txt"


# --- a project that is not the member's chosen one is never written, wherever its mount is (issue 325) -----------------------


@pytest.fixture
async def nested_projects(tmp_path, conn):
    """A member's own computer with a project (`outer`), another inside it (`inner`) and one beside them (`third`), all bound
    read-only into it, none chosen yet."""
    settings = SettingsStore(conn)
    settings.set("computer_vm_mode", "per-bot")
    outer, third = tmp_path / "outer", tmp_path / "third"
    inner = outer / "sub" / "inner"
    for folder in (inner, third):
        folder.mkdir(parents=True)
    settings.set("project_folders", [str(outer), str(inner), str(third)])
    runtime = GuestRuntime(tmp_path / "guest")
    vm = LocalVm(tmp_path / "data", settings=settings, runner=runtime, clock=lambda: 0)
    target = await vm.seat()
    guests = {source: guest for guest, source in target.projects}
    for source, guest in guests.items():
        runtime.folders[guest] = source
    runtime.raw = container(vm, target, runtime)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path / "attachments"), bridge=Bridge)
    await hub.prepare()
    return hub, runtime, settings, (outer, inner, third), (guests[outer], guests[inner], guests[third])


async def test_a_project_inside_the_chosen_one_is_written_through_either_mount_and_the_one_that_holds_it_is_not(nested_projects):
    hub, runtime, settings, (outer, inner, third), (outer_guest, inner_guest, third_guest) = nested_projects
    settings.set("member_work_folder", {"0": str(outer)})
    assert tiers(hub, f"{outer_guest}/a.txt", f"{inner_guest}/a.txt", f"{outer_guest}/sub/inner/b.txt") == [Tier.T0] * 3
    for path, folder in ((f"{outer_guest}/a.txt", outer / "a.txt"), (f"{inner_guest}/a.txt", inner / "a.txt"),
                         (f"{outer_guest}/sub/inner/b.txt", inner / "b.txt")):
        assert (await call(hub, "write_file", "auto", path=path, content="x")).ok and folder.read_text() == "x", path
    assert (await call(hub, "write_file", "user", path=f"{third_guest}/a.txt", content="x")).kind == "forbidden"
    # Chosen the inner one, the project that holds it is another's, and what lands in the inner one is its own.
    settings.set("member_work_folder", {"0": str(inner)})
    for path in (f"{outer_guest}/a.txt", f"{outer_guest}/sub/a.txt", f"{third_guest}/a.txt"):
        for approver in ("auto", "user"):
            assert (await call(hub, "write_file", approver, path=path, content="y")).kind == "forbidden", path
    assert (await call(hub, "write_file", "auto", path=f"{outer_guest}/sub/inner/c.txt", content="y")).ok
    assert (inner / "c.txt").read_text() == "y" and not (outer / "sub" / "a.txt").exists()
    assert (outer / "a.txt").read_text() == "x"  # what it wrote while the outer project was its own, and not again
    assert guest_writes(runtime) == []


async def test_a_download_into_an_unchosen_project_is_refused_and_nothing_asks_for_it(two_projects):
    hub, runtime, settings, (first, second), (first_guest, second_guest) = two_projects
    settings.set("member_work_folder", {"0": str(first)})
    key = key_of(hub, "browser_download")
    target = hub.vm.mounted_target(hub.vm.target(0))
    other = {"destination_root": f"{second_guest}/downloads", "ref": "p0:1", "target_id": "t1", "tab_id": "t1"}
    own = {"destination_root": f"{first_guest}/downloads", "ref": "p0:1", "target_id": "t1", "tab_id": "t1"}
    assert hub.guest_reach("browser_download", other, 0, target) == "project"
    assert hub.guest_reach("browser_download", own, 0, target) is None
    assert not hub.firm_for_call(key, other) and not hub.firm_for_call(key, own)
    # A relative or a `..` folder is taken where it leads.
    assert hub.guest_reach("browser_download", {**other, "destination_root": f"{first_guest}/../{second_guest.rsplit('/', 1)[1]}"},
                           0, target) == "project"
    for approver in ("auto", "user"):
        refused = await call(hub, "browser_download", approver, **other)
        assert refused.kind == "forbidden" and work_area.UNCHOSEN_WORDS in refused.text


async def test_with_no_project_chosen_a_download_into_any_project_is_refused(two_projects):
    hub, runtime, settings, (first, second), (first_guest, second_guest) = two_projects
    target = hub.vm.mounted_target(hub.vm.target(0))
    for guest in (first_guest, second_guest):
        assert hub.guest_reach("browser_download", {"destination_root": guest, "ref": "p0:1", "target_id": "t1", "tab_id": "t1"}, 0, target) == "project"


def test_a_link_made_inside_the_computer_never_leads_a_write_into_a_refused_project_whatever_was_said(tmp_path):
    from agent.test_owner_files import _link_folder
    workspace, project, elsewhere = tmp_path / "workspace", tmp_path / "project", tmp_path / "elsewhere"
    for folder in (workspace, project, elsewhere):
        folder.mkdir()
    _link_folder(elsewhere / "door", project)
    request = {"action": "write", "path": str(elsewhere / "door" / "a.txt"), "expected": "absent", "data": base64.b64encode(b"x").decode(),
               "roots": [str(workspace), str(project)]}
    # The owner's yes (no `allowed`) leads anywhere but there.
    assert files_guest.confined(request) and not files_guest.refusing(request)
    assert files_guest.handle({**request, "refused": [str(project)]}) == {"error": "unchosen"} and not (project / "a.txt").exists()
    assert files_guest.refusing({**request, "refused": [str(project)]}) and not files_guest.refusing(request)
    # What does not lead there is not held, and a request that names no refused folder is as it was.
    assert not files_guest.refusing({**request, "refused": [str(project)], "path": str(workspace / "a.txt")})
    assert not files_guest.refusing({**request, "refused": [str(project)], "allowed": [str(workspace)], "path": str(workspace / "a.txt")})


async def test_the_helper_is_told_which_mounts_are_refused_on_every_write_and_is_not_asked_to_write_a_project(two_projects):
    hub, runtime, settings, (first, second), (first_guest, second_guest) = two_projects
    settings.set("member_work_folder", {"0": str(first)})
    settings.set("action_mode", "bypass")
    assert (await call(hub, "write_file", "user", path=f"{GUEST}/b.txt", content="y")).ok
    held = guest_writes(runtime)
    assert held and all(request.get("refused") == [second_guest] for request in held), held
    settings.set("member_work_folder", {})
    assert (await call(hub, "write_file", "user", path=f"{GUEST}/c.txt", content="y")).ok
    assert sorted(guest_writes(runtime)[-1]["refused"]) == sorted([first_guest, second_guest])


# --- review findings: the PC folders of the computer, a choice that changes while Docker starts, the audit -------------------


async def test_a_project_inside_the_team_folder_or_the_own_workspace_is_refused_through_their_mounts(computer, conn):
    hub, runtime, settings, project, guest = computer
    target = hub.vm.mounted_target(hub.vm.target(0))
    in_team, in_workspace = target.shared / "inner", hub.vm.member_workspace(target) / "inner"
    for folder in (in_team, in_workspace):
        folder.mkdir(parents=True)
    settings.set("project_folders", [str(project), str(in_team), str(in_workspace)])
    settings.set("member_work_folder", {"0": str(project)})
    key = key_of(hub, "write_file")
    for path in (f"{SHARED}/inner/a.txt", f"{GUEST}/inner/a.txt", f"{SHARED}/inner/sub/../a.txt"):
        arguments = {"path": path, "content": "x"}
        assert hub.guest_reach("write_file", arguments, 0, target) == "project", path
        assert hub.tier_for_call(key, arguments) == Tier.T0 and not hub.firm_for_call(key, arguments), path
        assert hub.refused_for_call(key, arguments) == work_area.UNCHOSEN_WORDS, path
        for approver in ("auto", "user"):
            refused = await call(hub, "write_file", approver, path=path, content="x")
            assert refused.kind == "forbidden" and work_area.UNCHOSEN_WORDS in refused.text, path
    # The rest of the team folder and of the workspace is outside the chosen project, as it was: the owner's yes.
    assert tiers(hub, f"{SHARED}/a.txt", f"{GUEST}/a.txt") == [Tier.T3] * 2
    # In 全部允許 too, and nothing was written.
    settings.set("action_mode", "bypass")
    gate = ToolGate(hub, conn=conn)
    with vm_scope(("turn", 0, 1), turn_id=7):
        for path in (f"{SHARED}/inner/b.txt", f"{GUEST}/inner/b.txt"):
            assert (await gate.call_plugin(key, {"path": path, "content": "x"})).kind == "forbidden", path
    assert not [request for request in guest_writes(runtime) if "inner" in request["path"]]


async def test_with_no_project_chosen_a_project_inside_the_team_folder_is_inside_the_work_folder(computer):
    hub, runtime, settings, project, guest = computer
    target = hub.vm.mounted_target(hub.vm.target(0))
    in_team = target.shared / "inner"
    in_team.mkdir(parents=True)
    settings.set("project_folders", [str(project), str(in_team)])
    assert hub.guest_reach("write_file", {"path": f"{SHARED}/inner/a.txt", "content": "x"}, 0, target) is None
    assert (await call(hub, "write_file", "auto", path=f"{SHARED}/inner/a.txt", content="x")).ok


async def test_a_choice_changed_while_the_computer_starts_decides_the_write_and_not_the_choice_it_was_asked_under(two_projects, monkeypatch):
    hub, runtime, settings, (first, second), (first_guest, second_guest) = two_projects
    settings.set("member_work_folder", {"0": str(first)})
    settings.set("action_mode", "bypass")
    changed = []

    async def starting(*arguments):
        # The owner chooses the other project between the check of the call and the write on the PC.
        settings.set("member_work_folder", {"0": str(second)})
        changed.append(True)

    monkeypatch.setattr(hub, "_checkpoint", starting)
    refused = await call(hub, "write_file", "user", path=f"{first_guest}/a.txt", content="x")
    assert changed and refused.kind == "forbidden" and work_area.UNCHOSEN_WORDS in refused.text
    assert not (first / "a.txt").exists() and guest_writes(runtime) == []
    # An edit meets the same check.
    (first / "plan.txt").write_text("old", encoding="utf-8")
    settings.set("member_work_folder", {"0": str(first)})
    assert (await call(hub, "read_file", "auto", path=f"{first_guest}/plan.txt")).ok
    edited = await call(hub, "edit_file", "user", path=f"{first_guest}/plan.txt", old_string="old", new_string="new")
    assert edited.kind == "forbidden" and (first / "plan.txt").read_text(encoding="utf-8") == "old"


async def test_a_choice_changed_while_the_computer_starts_asks_again_when_the_place_is_now_outside(two_projects, monkeypatch):
    hub, runtime, settings, (first, second), (first_guest, second_guest) = two_projects

    async def starting(*arguments):
        settings.set("member_work_folder", {"0": str(second)})

    # Nothing chosen: the computer's own folder is the work folder and is written without asking. A choice made while the
    # computer starts makes it outside the work folder, which only the owner's yes writes.
    monkeypatch.setattr(hub, "_checkpoint", starting)
    refused = await call(hub, "write_file", "auto", path=f"{GUEST}/b.txt", content="x")
    assert refused.kind == "approval_required" and not (runtime.folders[GUEST] / "b.txt").exists()


async def test_the_audit_of_a_refused_project_write_in_the_computer_is_blocked_and_not_an_error(two_projects, conn, monkeypatch):
    from raphael_core.integrations.audit import AuditLog
    hub, runtime, settings, (first, second), (first_guest, second_guest) = two_projects
    hub.audit = AuditLog(conn)
    settings.set("member_work_folder", {"0": str(first)})
    assert (await call(hub, "write_file", "user", path=f"{second_guest}/a.txt", content="x")).kind == "forbidden"
    # The refusal that comes back from the computer's own helper (a link made inside it) is the same refusal.
    monkeypatch.setattr(files_guest, "refusing", lambda request: True)
    assert (await call(hub, "write_file", "user", path=f"{GUEST}/b.txt", content="x")).kind == "forbidden"
    rows = conn.execute("SELECT outcome FROM tool_audit WHERE server='computer' AND tool='write_file'").fetchall()
    assert [row[0] for row in rows] == ["blocked", "blocked"]


# --- round two --------------------------------------------------------------------------------------------------------------


async def test_the_helper_is_told_the_refused_projects_inside_the_workspace_and_the_team_folder_as_guest_paths(computer):
    hub, runtime, settings, project, guest = computer
    target = hub.vm.mounted_target(hub.vm.target(0))
    in_team, in_workspace = target.shared / "inner", hub.vm.member_workspace(target) / "deep" / "inner"
    for folder in (in_team, in_workspace):
        folder.mkdir(parents=True)
    settings.set("project_folders", [str(project), str(in_team), str(in_workspace)])
    settings.set("member_work_folder", {"0": str(project)})
    refused = hub.guest_unchosen(target, 0)
    assert f"{SHARED}/inner" in refused and f"{GUEST}/deep/inner" in refused
    settings.set("action_mode", "bypass")
    assert (await call(hub, "write_file", "user", path=f"{GUEST}/b.txt", content="y")).ok
    assert {f"{SHARED}/inner", f"{GUEST}/deep/inner"} <= set(guest_writes(runtime)[-1]["refused"])
    # With none chosen they are inside the work folder, as they are where they are on the PC: not refused.
    settings.set("member_work_folder", {})
    refused = hub.guest_unchosen(target, 0)
    assert f"{SHARED}/inner" not in refused and f"{GUEST}/deep/inner" not in refused and guest in refused


async def test_a_choice_changed_while_the_place_is_prepared_on_the_pc_decides_the_write(two_projects, monkeypatch):
    import asyncio
    hub, runtime, settings, (first, second), (first_guest, second_guest) = two_projects
    settings.set("member_work_folder", {"0": str(first)})
    settings.set("action_mode", "bypass")
    thread, changed = asyncio.to_thread, []

    async def to_thread(function, *arguments, **keywords):
        result = await thread(function, *arguments, **keywords)
        if getattr(function, "__name__", "") in ("project_ready", "project_write") and not changed:
            changed.append(True)  # the owner chooses the other project while the write is being prepared on the PC
            settings.set("member_work_folder", {"0": str(second)})
        return result

    monkeypatch.setattr(asyncio, "to_thread", to_thread)
    refused = await call(hub, "write_file", "user", path=f"{first_guest}/a.txt", content="x")
    assert changed and refused.kind == "forbidden" and work_area.UNCHOSEN_WORDS in refused.text
    assert not (first / "a.txt").exists()


async def test_a_refused_write_makes_no_checkpoint(two_projects, monkeypatch):
    hub, runtime, settings, (first, second), (first_guest, second_guest) = two_projects
    settings.set("member_work_folder", {"0": str(first)})
    settings.set("action_mode", "bypass")
    started, checkpoints = hub._started, []

    async def starting(*arguments, **keywords):
        settings.set("member_work_folder", {"0": str(second)})  # chosen while the computer starts
        return await started(*arguments, **keywords)

    async def checkpoint(*arguments):
        checkpoints.append(arguments)

    monkeypatch.setattr(hub, "_started", starting)
    monkeypatch.setattr(hub, "_checkpoint", checkpoint)
    refused = await call(hub, "write_file", "user", path=f"{first_guest}/a.txt", content="x")
    assert refused.kind == "forbidden" and checkpoints == [] and not (first / "a.txt").exists()

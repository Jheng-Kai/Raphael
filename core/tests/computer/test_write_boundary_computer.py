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
    assert tiers(hub, f"{guest}/a.txt", f"{guest}/sub/../a.txt") == [Tier.T3] * 2
    assert hub.firm_for_call(key_of(hub, "write_file"), {"path": f"{guest}/a.txt", "content": "x"})
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


async def test_a_project_the_member_did_not_choose_is_written_only_on_the_owners_yes_in_every_case(two_projects):
    hub, runtime, settings, (first, second), (first_guest, second_guest) = two_projects
    settings.set("member_work_folder", {"0": str(first)})
    assert tiers(hub, f"{first_guest}/a.txt") == [Tier.T0]
    assert tiers(hub, f"{second_guest}/a.txt", f"{second_guest}/sub/../a.txt") == [Tier.T3] * 2
    assert hub.firm_for_call(key_of(hub, "write_file"), {"path": f"{second_guest}/a.txt", "content": "x"})
    refused = await call(hub, "write_file", "auto", path=f"{second_guest}/a.txt", content="x")
    assert refused.kind == "approval_required" and not (second / "a.txt").exists()
    edit_refused = await call(hub, "edit_file", "auto", path=f"{second_guest}/a.txt", old_string="", new_string="x")
    assert edit_refused.kind == "approval_required" and not (second / "a.txt").exists()
    made = await call(hub, "write_file", "user", path=f"{second_guest}/a.txt", content="x")
    assert made.ok and (second / "a.txt").read_text() == "x"
    assert guest_writes(runtime) == []


async def test_with_no_project_chosen_every_project_is_asked_about(two_projects):
    hub, runtime, settings, (first, second), (first_guest, second_guest) = two_projects
    assert tiers(hub, f"{first_guest}/a.txt", f"{second_guest}/a.txt") == [Tier.T3] * 2
    for guest, folder in ((first_guest, first), (second_guest, second)):
        refused = await call(hub, "write_file", "auto", path=f"{guest}/a.txt", content="x")
        assert refused.kind == "approval_required" and not (folder / "a.txt").exists()


async def test_a_project_taken_off_the_list_leaves_the_member_choosing_nothing(two_projects):
    # Issue 312: a work folder that is not a remembered project is no work folder, so the listed one is not either.
    hub, runtime, settings, (first, second), (first_guest, second_guest) = two_projects
    settings.set("member_work_folder", {"0": str(first)})
    assert tiers(hub, f"{first_guest}/a.txt", f"{second_guest}/a.txt") == [Tier.T0, Tier.T3]
    settings.set("project_folders", [str(second)])
    assert settings.get("member_work_folder") == {}
    assert tiers(hub, f"{second_guest}/a.txt") == [Tier.T3]


async def test_a_link_inside_a_project_is_never_followed_by_a_write_on_the_pc(two_projects, tmp_path):
    hub, runtime, settings, (first, second), (first_guest, second_guest) = two_projects
    settings.set("member_work_folder", {"0": str(first)})
    _link_folder(first / "door", second)
    refused = await call(hub, "write_file", "auto", path=f"{first_guest}/door/a.txt", content="x")
    assert not refused.ok and not (second / "a.txt").exists()
    assert not (await call(hub, "write_file", "user", path=f"{first_guest}/door/a.txt", content="x")).ok
    assert not (second / "a.txt").exists()


async def test_the_owners_yes_to_a_project_write_is_the_door_in_allow_all_only(two_projects, conn):
    hub, runtime, settings, (first, second), (first_guest, second_guest) = two_projects
    settings.set("member_work_folder", {"0": str(first)})
    key = key_of(hub, "write_file")
    other = {"path": f"{second_guest}/a.txt", "content": "x"}
    for mode in ("direct", "ask", "plan"):
        settings.set("action_mode", mode)
        gate = ToolGate(hub, conn=conn)
        assert gate.needs_confirmation(key, other) and gate.firm_confirmation(key, other)
    settings.set("action_mode", "bypass")
    gate = ToolGate(hub, conn=conn)
    assert not gate.firm_confirmation(key, other)
    with vm_scope(("turn", 0, 1), turn_id=7):
        made = await gate.call_plugin(key, other)
    assert made.ok and (second / "a.txt").read_text() == "x"

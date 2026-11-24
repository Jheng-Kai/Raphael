"""R-FILE-06 on the member's own computer and on the host computer: only the folders of the owner's PC are the PC's.

A folder bound into the computer (the member's folder, the team's, a project) is a folder of the owner's PC; the rest of
the computer is the computer's own. A write onto a bound folder that is not the member's work folder is the owner's yes in
every mode but 全部允許 (which is that yes, handed to the tool by the door), and the computer's own helper holds an unasked
write to the work folder even through a link made inside the computer. The fake docker answers the helper by running it
(`files_guest.handle`) on folders of the test.
"""

import base64
import json

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
    # What the owner said yes to is made where it was asked, and the helper was not told to hold it.
    requests = [json.loads(kwargs["input"]) for args, kwargs in runtime.calls if kwargs.get("input")]
    held = [request for request in requests if request["action"] == "write"]
    assert "allowed" not in held[0] and held[1]["allowed"] == [guest]


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

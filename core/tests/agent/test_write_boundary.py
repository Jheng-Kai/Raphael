"""R-FILE-06: a member writes in its work folder, and a write anywhere else is the owner's yes, in every permission mode.

The work folder is the project the owner chose for the member, and only that; with none chosen it is the member's own folder
and the team's. The tools that write (the owner's file tools, a command's named files) are asked about through the door's
firm confirmation, which 全部允許 does not waive, and the tool itself refuses a call that came without that yes. The files are
real ones in the test's folder; the brain is a fake.
"""

import os
from types import SimpleNamespace

import pytest

from raphael_core import work_area
from raphael_core.agent.gate import ToolGate
from raphael_core.agent.permissions import PermissionCards
from raphael_core.agent.policy import Action, Confirmations, Tier
from raphael_core.brain.settings import SettingsStore
from raphael_core.computer import owner_files
from raphael_core.computer.local_tools import _CONTEXT, command_folder
from .test_local_commands import local_hub
from .test_narration import chat, typed
from .test_owner_files import _link_folder
from .test_owner_pc_reach import MODES
from .test_service import make_rig  # noqa: F401

WRITE = "mcp:owner_files/write_file"
EXEC = "mcp:local/local_exec"


@pytest.fixture
def place(conn, tmp_path, monkeypatch):
    """The owner's home with a project, another folder, and a member's own folder and the team's."""
    home = tmp_path / "home"
    paths = SimpleNamespace(home=home, project=home / "project", other=home / "other", own=home / "own", team=home / "team")
    for folder in (paths.project / "sub", paths.other, paths.own, paths.team):
        folder.mkdir(parents=True)
    monkeypatch.setattr(owner_files, "_home", lambda: home)
    hub, host = local_hub(conn)
    hub.owner_files.member_folders = lambda member: (paths.own, paths.team)
    token = _CONTEXT.set((("chat", 0, 1), False, True, "session", False, 0))  # an ordinary turn with a card to show
    paths.hub, paths.host, paths.settings, paths.conn = hub, host, SettingsStore(conn), conn
    yield paths
    _CONTEXT.reset(token)


def choose(place, folder=None):
    place.settings.set("project_folders", [str(place.project), str(place.other)])
    place.settings.set("member_work_folder", {"0": str(folder or place.project)})


def args(path, content="x"):
    return {"path": str(path), "content": content}


def tier(place, path):
    return place.hub.tier_for_call(WRITE, args(path))


async def write(place, path, approver="auto"):
    return await place.hub.call(WRITE, args(path), approver=approver)


# --- where a member's work folder is -----------------------------------------------------------------------------------


def test_with_no_project_chosen_a_member_writes_its_own_folder_and_the_team_folder_and_asks_for_the_rest(place):
    place.settings.set("project_folders", [str(place.project)])
    for folder in (place.own, place.team):
        assert tier(place, folder / "a.md") == Tier.T2 and not place.hub.firm_for_call(WRITE, args(folder / "a.md"))
    for elsewhere in (place.project, place.other, place.home):
        assert tier(place, elsewhere / "a.md") == Tier.T3 and place.hub.firm_for_call(WRITE, args(elsewhere / "a.md")), elsewhere


def test_with_a_project_chosen_a_member_writes_that_project_alone(place):
    choose(place)
    assert tier(place, place.project / "sub" / "a.md") == Tier.T2
    assert not place.hub.firm_for_call(WRITE, args(place.project / "a.md"))
    for elsewhere in (place.own, place.team, place.other, place.home):
        assert tier(place, elsewhere / "a.md") == Tier.T3 and place.hub.firm_for_call(WRITE, args(elsewhere / "a.md")), elsewhere


def test_a_project_that_is_gone_from_the_disk_is_no_choice(place):
    import shutil
    choose(place, place.other)
    assert tier(place, place.other / "a.md") == Tier.T2
    shutil.rmtree(place.other)
    assert tier(place, place.own / "a.md") == Tier.T2 and tier(place, place.project / "a.md") == Tier.T3


def test_dot_dot_and_the_name_of_a_parent_do_not_leave_the_work_folder_unseen(place):
    choose(place)
    assert tier(place, place.project / "sub" / ".." / "a.md") == Tier.T2
    assert tier(place, place.project / ".." / "other" / "a.md") == Tier.T3
    assert place.hub.tier_for_call(WRITE, args("~/project/../other/a.md")) == Tier.T3
    assert place.hub.tier_for_call(WRITE, args("project/sub/../a.md")) == Tier.T2  # a relative name is taken from the home
    assert tier(place, place.home) == Tier.T3 and tier(place, place.project.with_name("project-two") / "a.md") == Tier.T3


@pytest.mark.skipif(os.path.exists(str(os.getcwd()).swapcase()) is False, reason="a disk that tells one case from another")
def test_another_case_of_the_project_is_the_same_folder_where_the_disk_does_not_tell_cases_apart(place):
    choose(place)
    shouted = str(place.project / "a.md").swapcase()
    assert tier(place, shouted) == Tier.T2
    assert tier(place, str(place.other / "a.md").swapcase()) == Tier.T3


def test_a_link_inside_the_project_that_leads_out_is_outside(place):
    choose(place)
    _link_folder(place.project / "door", place.other)
    assert tier(place, place.project / "door" / "a.md") == Tier.T3
    assert place.hub.firm_for_call(WRITE, args(place.project / "door" / "a.md"))


async def test_a_write_through_a_link_that_leads_out_is_not_made_without_a_yes_and_lands_where_it_leads_with_one(place):
    choose(place)
    _link_folder(place.project / "door", place.other)
    refused = await write(place, place.project / "door" / "a.md")
    assert refused.kind == "approval_required" and not (place.other / "a.md").exists()
    made = await write(place, place.project / "door" / "a.md", approver="user")
    assert made.ok and (place.other / "a.md").read_text() == "x"


def test_a_link_from_elsewhere_into_the_project_is_the_project(place):
    choose(place)
    _link_folder(place.home / "shortcut", place.project)
    assert tier(place, place.home / "shortcut" / "a.md") == Tier.T2


async def test_a_dangling_link_inside_the_project_is_judged_by_where_it_points(place):
    choose(place)
    link = place.project / "dangling.md"
    try:
        link.symlink_to(place.other / "missing.md")
    except OSError:
        pytest.skip("this account may not make file links")
    assert tier(place, link) == Tier.T3
    assert (await write(place, link)).kind == "approval_required" and not (place.other / "missing.md").exists()


@pytest.mark.skipif(os.name != "nt", reason="Windows' own path forms")
def test_windows_long_and_device_forms_name_the_place_they_reach_and_a_device_is_refused(place, monkeypatch):
    choose(place)
    assert tier(place, "\\\\?\\" + str(place.project / "a.md")) == Tier.T2
    assert tier(place, "\\\\.\\" + str(place.project / "a.md")) == Tier.T2
    assert tier(place, "\\\\?\\" + str(place.other / "a.md")) == Tier.T3
    assert tier(place, str(place.project / "a.md").replace("\\", "/")) == Tier.T2
    assert tier(place, "\\\\?\\UNC\\server\\share\\a.md") == Tier.T3 and tier(place, "\\\\server\\share\\a.md") == Tier.T3
    for device in ("\\\\.\\pipe\\x", "\\\\?\\GLOBALROOT\\Device\\x", "\\\\.\\PhysicalDrive0", str(place.project / "NUL"),
                   str(place.project / "con.txt")):
        assert tier(place, device) == Tier.T0, device  # nothing to ask: the call is refused
    # A drive-relative path is taken from the owner's home like any relative one, judged and written where that is.
    drive = os.path.splitdrive(str(place.project))[0]
    monkeypatch.chdir(place.project)
    assert owner_files.place(drive + "a.md") == str(place.home / "a.md") and tier(place, drive + "a.md") == Tier.T3


@pytest.mark.skipif(os.name != "nt", reason="Windows' own path forms")
async def test_a_device_or_a_reserved_name_is_never_written_even_with_a_yes(place):
    choose(place)
    for device in ("\\\\.\\pipe\\x", "\\\\?\\GLOBALROOT\\Device\\x", str(place.project / "NUL")):
        result = await write(place, device, approver="user")
        assert not result.ok and result.kind == "bad_path", device


@pytest.mark.skipif(os.name != "nt", reason="8.3 short names")
def test_a_short_8_3_name_of_the_project_is_the_project(place):
    import ctypes
    folder = place.home / "a project with a long name"
    folder.mkdir()
    buffer = ctypes.create_unicode_buffer(300)
    if not ctypes.windll.kernel32.GetShortPathNameW(str(folder), buffer, 300) or buffer.value.lower() == str(folder).lower():
        pytest.skip("this disk makes no short names")
    place.settings.set("project_folders", [str(folder)])
    place.settings.set("member_work_folder", {"0": str(folder)})
    assert tier(place, buffer.value + "\\a.md") == Tier.T2
    assert tier(place, str(place.other / "a.md")) == Tier.T3


# --- what the owner is asked, in every mode ------------------------------------------------------------------------------


@pytest.mark.parametrize("mode", MODES)
def test_a_write_outside_the_work_folder_is_asked_in_every_permission_mode(place, mode):
    choose(place)
    place.settings.set("action_mode", mode)
    gate = ToolGate(place.hub, conn=place.conn)
    outside = args(place.other / "a.md")
    assert gate.needs_confirmation(WRITE, outside) and gate.tier(WRITE, outside) == Tier.T3
    assert gate.firm_confirmation(WRITE, outside) and not gate.waived(Action(WRITE, outside))
    # Inside the work folder 全部允許 asks nothing, as before: the only question it adds is the one about leaving.
    assert gate.needs_confirmation(WRITE, args(place.project / "a.md")) is (mode != "bypass")


async def test_the_door_refuses_an_outside_write_that_came_without_the_owners_yes_even_in_allow_all(place):
    choose(place)
    place.settings.set("action_mode", "bypass")
    gate = ToolGate(place.hub, conn=place.conn)
    outside = args(place.other / "a.md")
    refused = await gate.call_plugin(WRITE, outside)
    assert refused.kind == "approval_required" and not (place.other / "a.md").exists()
    # A yes for another change is no yes for this one, and a no is no yes.
    confirmations = Confirmations()
    other = Action(WRITE, args(place.other / "b.md"))
    yes = confirmations.resolve(confirmations.open("s", 1, other, Tier.T3, "en").id, True).approval
    assert (await gate.call_plugin(WRITE, outside, approval=yes, action=other)).kind == "approval_required"
    action = Action(WRITE, outside)
    no = confirmations.resolve(confirmations.open("s", 1, action, Tier.T3, "en").id, False)
    assert no.approval is None and (await gate.call_plugin(WRITE, outside, action=action)).kind == "approval_required"
    assert not (place.other / "a.md").exists() and not (place.other / "b.md").exists()
    yes = confirmations.resolve(confirmations.open("s", 1, action, Tier.T3, "en").id, True).approval
    made = await gate.call_plugin(WRITE, outside, approval=yes, action=action)
    assert made.ok and (place.other / "a.md").read_text() == "x"


async def test_allow_all_still_writes_inside_the_work_folder_without_a_card(make_rig, client, conn, place):
    choose(place)
    rig = make_rig(plugins=place.hub, gate=ToolGate(place.hub, conn=conn), permissions=PermissionCards(conn))
    rig.settings.set("action_mode", "bypass")
    client.chats = [chat("Saving.", ("owner_files__write_file", args(place.project / "note.md", "hello\n"))),
                    chat('{"text":"Saved."}')]
    done = await typed(rig, "Save a note")
    assert done["status"] != "confirm" and (place.project / "note.md").read_text() == "hello\n"


async def test_allow_all_asks_before_a_write_outside_the_work_folder_and_not_a_no(make_rig, client, conn, place):
    choose(place)
    rig = make_rig(plugins=place.hub, gate=ToolGate(place.hub, conn=conn), permissions=PermissionCards(conn))
    rig.settings.set("action_mode", "bypass")
    target = place.other / "note.md"
    client.chats = [chat("Saving.", ("owner_files__write_file", args(target, "hello\n"))), chat('{"text":"Not saved."}')]
    asked = await typed(rig, "Save a note")
    assert asked["status"] == "confirm" and asked["confirm"]["tier"] == "T3"
    assert os.path.realpath(target) in asked["confirm"]["text"] and not target.exists()
    await rig.confirm(asked["confirm"]["id"], False)
    assert not target.exists()
    client.chats = [chat("Saving.", ("owner_files__write_file", args(target, "hello\n"))), chat('{"text":"Saved."}')]
    asked = await typed(rig, "Save the note again")
    assert asked["status"] == "confirm" and not target.exists()
    await rig.confirm(asked["confirm"]["id"], True)
    assert target.read_text() == "hello\n"


# --- a command ----------------------------------------------------------------------------------------------------------


def test_a_command_starts_in_the_members_work_folder(place):
    folders = place.hub.owner_files.member_folders
    assert command_folder(place.settings, 0, folders) == str(place.own)
    choose(place)
    assert command_folder(place.settings, 0, folders) == str(place.project)
    assert command_folder(place.settings, 5, folders) == str(place.own)


async def test_a_command_runs_in_the_work_folder_unless_it_says_another(place):
    choose(place)
    token = {"command": "Get-Location"}
    assert (await place.hub.call(EXEC, token, approver="user")).ok
    assert place.host.execute.await_args.kwargs["cwd"] == str(place.project)
    assert (await place.hub.call(EXEC, {**token, "cwd": str(place.other)}, approver="user")).ok
    assert place.host.execute.await_args.kwargs["cwd"] == str(place.other)


def outside_command(place):
    return {"command": f"Set-Content -Path '{(place.other / 'a.txt').as_posix()}' -Value hello"}


@pytest.mark.parametrize("commands", ["ask", "always"])
@pytest.mark.parametrize("mode", MODES)
def test_a_command_that_names_a_file_outside_the_work_folder_is_asked_in_every_mode(place, mode, commands):
    choose(place)
    place.settings.set("action_mode", mode)
    place.settings.set("local_commands_mode", commands)
    gate = ToolGate(place.hub, conn=place.conn)
    outside = outside_command(place)
    assert place.hub.shell_outside(outside) and place.hub.tier_for_call(EXEC, outside) == Tier.T3
    assert gate.needs_confirmation(EXEC, outside) and gate.firm_confirmation(EXEC, outside)
    inside = {"command": f"Set-Content -Path '{(place.project / 'a.txt').as_posix()}' -Value hello"}
    assert not place.hub.shell_outside(inside) and not gate.firm_confirmation(EXEC, inside)


@pytest.mark.parametrize("mode", ["ask", "bypass"])
async def test_a_command_that_names_a_file_outside_is_not_run_without_the_owners_yes(place, mode):
    choose(place)
    place.settings.set("action_mode", mode)
    place.settings.set("local_commands_mode", "always")
    gate = ToolGate(place.hub, conn=place.conn)
    outside = outside_command(place)
    refused = await gate.call_plugin(EXEC, outside)
    assert refused.kind == "approval_required" and place.host.execute.await_count == 0
    action = Action(EXEC, outside)
    confirmations = Confirmations()
    yes = confirmations.resolve(confirmations.open("s", 1, action, Tier.T3, "en").id, True).approval
    assert (await gate.call_plugin(EXEC, outside, approval=yes, action=action)).ok
    assert place.host.execute.await_count == 1


async def test_a_command_with_nothing_to_ask_about_runs_as_it_did_in_allow_all(place):
    choose(place)
    place.settings.set("action_mode", "bypass")
    gate = ToolGate(place.hub, conn=place.conn)
    for command in ("Get-Process", f"Set-Content -Path '{(place.project / 'a.txt').as_posix()}' -Value hello", "echo hi > out.txt"):
        assert not gate.firm_confirmation(EXEC, {"command": command}), command
        assert (await gate.call_plugin(EXEC, {"command": command})).ok, command
    assert place.host.execute.await_count == 3


async def test_a_command_outside_the_work_folder_is_not_run_where_no_card_can_be_shown_even_in_allow_all(place):
    choose(place)
    place.settings.set("action_mode", "bypass")
    token = _CONTEXT.set((("chat", 0, 1), False, False, "session", False, 0))  # a phone: no card to answer
    try:
        refused = await place.hub.call(EXEC, outside_command(place), approver="user")
    finally:
        _CONTEXT.reset(token)
    assert refused.kind == "approval_required" and place.host.execute.await_count == 0


def test_a_relative_target_is_taken_from_the_folder_the_command_runs_in(place):
    choose(place)
    assert not place.hub.shell_outside({"command": "echo hi > out.txt"})
    assert place.hub.shell_outside({"command": "echo hi > ../other/out.txt"})
    assert place.hub.shell_outside({"command": "echo hi > out.txt", "cwd": str(place.other)})
    assert place.hub.shell_outside({"command": "echo hi > out.txt", "cwd": "relative/folder"})  # not a place it can name
    assert not place.hub.shell_outside({"command": "Get-ChildItem", "cwd": str(place.other)})  # a read names no file


def test_the_work_area_names_the_folders_of_the_member(place):
    folders = place.hub.owner_files.member_folders
    assert work_area.area(place.settings, 0, folders) == [str(place.own), str(place.team)]
    choose(place)
    assert work_area.area(place.settings, 0, folders) == [str(place.project)]
    assert work_area.area(place.settings, 3, folders) == [str(place.own), str(place.team)]

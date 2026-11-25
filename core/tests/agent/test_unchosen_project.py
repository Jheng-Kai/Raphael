"""R-FILE-06 (issue 325): a remembered project that is not the member's chosen one is never written, in any permission mode.

The owner adds projects to a list and chooses one for each member in the composer. A write into another remembered project is
refused in every mode, 全部允許 included, with or without a yes, from any turn or task. Nothing asks for it: a question about
what is refused anyway is wrong, so the call is T0 and not firm and the tool itself refuses (as for a place of keys). The
member's work folder wins first (a project inside the chosen one is written), then an unchosen project (refused), then any
other place outside (asked in 自動, 手動 and 計畫, free in 全部允許, as before). The files are real ones in the test's folder.
"""

import os

import pytest

from raphael_core import work_area
from raphael_core.agent.gate import ToolGate
from raphael_core.agent.permissions import PermissionCards
from raphael_core.agent.policy import Action, Confirmations, Tier
from raphael_core.computer.local_tools import _CONTEXT
from .test_narration import chat, typed
from .test_owner_files import _link_folder
from .test_owner_pc_reach import MODES
from .test_service import make_rig  # noqa: F401
from .test_write_boundary import EXEC, WRITE, args, choose, outside_command, place, tier, write  # noqa: F401

REFUSED = "forbidden"
EDIT = "mcp:owner_files/edit_file"


def folders_of(place):
    return place.hub.owner_files.member_folders


def reach(place, path, member=0):
    return work_area.reach(place.settings, member, str(path), folders_of(place))


# --- the decision itself -------------------------------------------------------------------------------------------------


def test_the_reach_of_a_path_is_inside_the_work_folder_an_unchosen_project_or_outside(place):
    choose(place)
    assert reach(place, place.project / "sub" / "a.md") == "inside"
    assert reach(place, place.other / "a.md") == "project" and reach(place, place.other) == "project"
    for folder in (place.own, place.team, place.elsewhere, place.home):
        assert reach(place, folder / "a.md") == "outside", folder
    # With none chosen, the member's own folder and the team's are the work folder and every remembered project is not.
    place.settings.set("member_work_folder", {})
    assert reach(place, place.own / "a.md") == "inside" and reach(place, place.team / "a.md") == "inside"
    assert reach(place, place.project / "a.md") == "project" and reach(place, place.other / "a.md") == "project"
    assert reach(place, place.elsewhere / "a.md") == "outside"
    # Another member's choice is its own.
    place.settings.set("member_work_folder", {"0": str(place.project)})
    assert reach(place, place.project / "a.md", 3) == "project" and reach(place, place.own / "a.md", 3) == "inside"
    # Without settings there is no project to be unchosen.
    assert work_area.reach(None, 0, str(place.other / "a.md"), folders_of(place)) == "outside"
    assert work_area.reach(None, 0, str(place.own / "a.md"), folders_of(place)) == "inside"


def test_a_project_inside_the_chosen_one_is_inside_and_one_that_holds_it_is_not(place):
    inner = place.project / "sub" / "inner"
    inner.mkdir()
    place.settings.set("project_folders", [str(place.project), str(inner), str(place.other)])
    place.settings.set("member_work_folder", {"0": str(place.project)})
    assert reach(place, inner / "a.md") == "inside" and reach(place, place.project / "sub" / "a.md") == "inside"
    place.settings.set("member_work_folder", {"0": str(inner)})
    assert reach(place, inner / "a.md") == "inside"
    assert reach(place, place.project / "a.md") == "project" and reach(place, place.project / "sub" / "a.md") == "project"
    assert tier(place, inner / "a.md") == Tier.T2 and tier(place, place.project / "a.md") == Tier.T0


def test_with_no_project_chosen_a_project_that_holds_the_members_own_folder_does_not_block_it(place):
    place.settings.set("project_folders", [str(place.home)])
    assert reach(place, place.own / "a.md") == "inside" and reach(place, place.team / "a.md") == "inside"
    assert reach(place, place.elsewhere / "a.md") == "project" and reach(place, place.home / "a.md") == "project"
    assert tier(place, place.own / "a.md") == Tier.T2 and tier(place, place.elsewhere / "a.md") == Tier.T0


def test_a_project_that_is_not_on_the_disk_is_still_unchosen_by_its_resolved_name(place):
    gone = place.home / "gone"
    place.settings.set("project_folders", [str(place.project), str(gone)])
    place.settings.set("member_work_folder", {"0": str(place.project)})
    assert not gone.exists()
    assert reach(place, gone / "a.md") == "project" and reach(place, work_area.resolved(str(gone / "x" / ".." / "b.md"))) == "project"
    assert tier(place, gone / "a.md") == Tier.T0 and tier(place, place.home / "elsewhere" / ".." / "gone" / "sub" / "a.md") == Tier.T0
    assert reach(place, place.home / "gone-not" / "a.md") == "outside"


# --- the owner's file tools ----------------------------------------------------------------------------------------------


@pytest.mark.parametrize("mode", MODES)
async def test_a_write_into_an_unchosen_project_is_refused_in_every_mode_and_asks_nothing(place, mode):
    choose(place)
    place.settings.set("action_mode", mode)
    gate = ToolGate(place.hub, conn=place.conn)
    target = args(place.other / "a.md")
    assert tier(place, place.other / "a.md") == Tier.T0 and not place.hub.firm_for_call(WRITE, target)
    assert not gate.needs_confirmation(WRITE, target) and not gate.firm_confirmation(WRITE, target)
    refused = await gate.call_plugin(WRITE, target)
    assert refused.kind == REFUSED and work_area.UNCHOSEN_WORDS in refused.text and not (place.other / "a.md").exists()
    # With the owner's yes for this very change, or from a hub that came with one, it is still refused.
    action = Action(WRITE, target)
    confirmations = Confirmations()
    yes = confirmations.resolve(confirmations.open("s", 1, action, Tier.T3, "en").id, True).approval
    assert (await gate.call_plugin(WRITE, target, approval=yes, action=action)).kind == REFUSED
    for approver in ("auto", "user"):
        assert (await write(place, place.other / "a.md", approver=approver)).kind == REFUSED
    assert not (place.other / "a.md").exists()


async def test_an_edit_into_an_unchosen_project_is_refused_even_with_a_yes(place):
    choose(place)
    (place.other / "plan.md").write_text("old\n", encoding="utf-8")
    edit = {"path": str(place.other / "plan.md"), "old_string": "old", "new_string": "new"}
    assert place.hub.tier_for_call(EDIT, edit) == Tier.T0 and not place.hub.firm_for_call(EDIT, edit)
    for approver in ("auto", "user"):
        assert (await place.hub.call(EDIT, edit, approver=approver)).kind == REFUSED
    assert (place.other / "plan.md").read_text(encoding="utf-8") == "old\n"


async def test_a_chosen_project_and_a_project_inside_it_are_still_written_in_every_mode(place):
    inner = place.project / "sub" / "inner"
    inner.mkdir()
    place.settings.set("project_folders", [str(place.project), str(inner), str(place.other)])
    place.settings.set("member_work_folder", {"0": str(place.project)})
    for mode in MODES:
        place.settings.set("action_mode", mode)
        gate = ToolGate(place.hub, conn=place.conn)
        for folder in (place.project, inner):
            assert tier(place, folder / "a.md") == Tier.T2 and not gate.firm_confirmation(WRITE, args(folder / "a.md"))
            assert (await write(place, folder / f"{mode}.md")).ok
        assert (inner / f"{mode}.md").read_text() == "x"


async def test_with_no_project_chosen_every_remembered_project_is_refused_and_the_own_folder_is_written(place):
    place.settings.set("project_folders", [str(place.project), str(place.other)])
    for folder in (place.project, place.other):
        assert tier(place, folder / "a.md") == Tier.T0
        for approver in ("auto", "user"):
            assert (await write(place, folder / "a.md", approver=approver)).kind == REFUSED
        assert not (folder / "a.md").exists()
    assert (await write(place, place.own / "a.md")).ok


@pytest.mark.parametrize("mode", MODES)
async def test_a_place_that_is_no_project_is_asked_and_in_allow_all_free_as_before(place, mode):
    choose(place)
    place.settings.set("action_mode", mode)
    gate = ToolGate(place.hub, conn=place.conn)
    target = args(place.elsewhere / "a.md")
    assert tier(place, place.elsewhere / "a.md") == Tier.T3 and place.hub.firm_for_call(WRITE, target)
    assert gate.firm_confirmation(WRITE, target) is (mode != "bypass")
    result = await gate.call_plugin(WRITE, target)
    assert (result.ok, result.kind) == ((True, None) if mode == "bypass" else (False, "approval_required"))


async def test_a_link_inside_the_chosen_project_that_leads_into_an_unchosen_one_is_refused(place):
    choose(place)
    _link_folder(place.project / "door", place.other)
    for path in (place.project / "door" / "a.md", place.project / "door" / "sub" / ".." / "a.md"):
        assert tier(place, path) == Tier.T0 and not place.hub.firm_for_call(WRITE, args(path))
        for approver in ("auto", "user"):
            assert (await write(place, path, approver=approver)).kind == REFUSED
    assert not (place.other / "a.md").exists()
    # A link from elsewhere is the folder it leads to: here an unchosen project.
    _link_folder(place.home / "shortcut", place.other)
    assert (await write(place, place.home / "shortcut" / "a.md", approver="user")).kind == REFUSED
    assert not (place.other / "a.md").exists()


@pytest.mark.skipif(os.path.exists(str(os.getcwd()).swapcase()) is False, reason="a disk that tells one case from another")
async def test_another_spelling_of_an_unchosen_project_is_the_same_project(place):
    choose(place)
    shouted = str(place.other / "a.md").swapcase()
    assert tier(place, shouted) == Tier.T0
    assert (await write(place, shouted, approver="user")).kind == REFUSED and not (place.other / "a.md").exists()


async def test_a_relative_name_and_a_tilde_reach_an_unchosen_project_where_they_lead(place):
    choose(place)
    for path in ("~/other/a.md", "other/a.md", "project/../other/a.md"):
        assert place.hub.tier_for_call(WRITE, args(path)) == Tier.T0, path
        assert (await place.hub.call(WRITE, args(path), approver="user")).kind == REFUSED, path
    assert not (place.other / "a.md").exists()


async def test_an_unchosen_project_is_refused_from_a_task_with_nobody_to_ask_in_every_mode(place):
    choose(place)
    token = _CONTEXT.set((("task", 7), False, False, "", False, 0))  # a routine, a phone, Telegram: no card to show
    try:
        for mode in MODES:
            place.settings.set("action_mode", mode)
            gate = ToolGate(place.hub, conn=place.conn)
            assert (await gate.call_plugin(WRITE, args(place.other / "a.md"))).kind == REFUSED, mode
    finally:
        _CONTEXT.reset(token)
    assert not (place.other / "a.md").exists()


async def test_allow_all_does_not_write_an_unchosen_project_and_shows_no_card(make_rig, client, conn, place):
    choose(place)
    rig = make_rig(plugins=place.hub, gate=ToolGate(place.hub, conn=conn), permissions=PermissionCards(conn))
    rig.settings.set("action_mode", "bypass")
    target = place.other / "note.md"
    client.chats = [chat("Saving.", ("owner_files__write_file", args(target, "hello\n"))), chat('{"text":"Not saved."}')]
    done = await typed(rig, "Save a note")
    assert done["status"] != "confirm" and not target.exists()


# --- a command ----------------------------------------------------------------------------------------------------------


def project_commands(place):
    project = place.other.as_posix()
    return [f"Set-Content -Path '{project}/a.txt' -Value hello",
            f"echo hi > {project}/out.txt",
            "echo hi >> ../other/out.txt",
            f"Move-Item a.txt {project}/b.txt",
            f"mv {project}/b.txt moved.txt",  # what moves out of a project changes it too
            f"Remove-Item {project}/a.txt",
            f"cp x.txt {project}/",
            f"cd {project}; echo hi > out.txt",
            f"powershell -Command \"Set-Content -Path '{project}/a.txt' -Value hello\"",
            f"echo hi > out.txt; echo hi > {project}/out.txt"]


@pytest.mark.parametrize("commands", ["ask", "always"])
@pytest.mark.parametrize("mode", MODES)
async def test_a_command_that_names_a_file_in_an_unchosen_project_is_not_run_in_any_mode_and_asks_nothing(place, mode, commands):
    choose(place)
    place.settings.set("action_mode", mode)
    place.settings.set("local_commands_mode", commands)
    gate = ToolGate(place.hub, conn=place.conn)
    for command in project_commands(place):
        call = {"command": command}
        assert place.hub.tier_for_call(EXEC, call) == Tier.T0 and not place.hub.firm_for_call(EXEC, call), command
        assert not gate.needs_confirmation(EXEC, call) and not gate.firm_confirmation(EXEC, call), command
        assert (await gate.call_plugin(EXEC, call)).kind == REFUSED, command
        refused = await place.hub.call(EXEC, call, approver="user")
        assert refused.kind == REFUSED and work_area.UNCHOSEN_WORDS in refused.text, command
        action = Action(EXEC, call)
        confirmations = Confirmations()
        yes = confirmations.resolve(confirmations.open("s", 1, action, Tier.T3, "en").id, True).approval
        assert (await gate.call_plugin(EXEC, call, approval=yes, action=action)).kind == REFUSED, command
    assert place.host.execute.await_count == 0


async def test_a_command_is_refused_in_an_unchosen_project_from_a_task_and_a_phone_in_allow_all(place):
    choose(place)
    place.settings.set("action_mode", "bypass")
    gate = ToolGate(place.hub, conn=place.conn)
    for context in ((("task", 7), False, False, "", False, 0), (("chat", 0, 1), False, False, "session", False, 0)):
        token = _CONTEXT.set(context)
        try:
            assert (await gate.call_plugin(EXEC, {"command": project_commands(place)[0]})).kind == REFUSED
        finally:
            _CONTEXT.reset(token)
    assert place.host.execute.await_count == 0


async def test_with_no_project_chosen_a_command_naming_a_project_file_is_refused_and_one_naming_the_own_folder_runs(place):
    place.settings.set("project_folders", [str(place.project), str(place.other)])
    place.settings.set("action_mode", "bypass")
    gate = ToolGate(place.hub, conn=place.conn)
    for command in ("echo hi > ../project/out.txt", f"echo hi > {place.other.as_posix()}/out.txt"):
        assert (await gate.call_plugin(EXEC, {"command": command})).kind == REFUSED, command
    assert place.host.execute.await_count == 0
    assert (await gate.call_plugin(EXEC, {"command": "echo hi > out.txt"})).ok
    assert place.host.execute.await_count == 1


async def test_a_command_that_names_a_place_that_is_no_project_is_asked_as_before(place):
    choose(place)
    place.settings.set("local_commands_mode", "always")
    gate = ToolGate(place.hub, conn=place.conn)
    outside = outside_command(place)
    assert place.hub.tier_for_call(EXEC, outside) == Tier.T3 and gate.firm_confirmation(EXEC, outside)
    assert (await gate.call_plugin(EXEC, outside)).kind == "approval_required"
    place.settings.set("action_mode", "bypass")
    assert (await ToolGate(place.hub, conn=place.conn).call_plugin(EXEC, outside)).ok


def test_the_files_a_command_names_in_an_unchosen_project_are_told_apart_from_the_rest(place):
    choose(place)
    command = (f"echo a > {place.other.as_posix()}/a.txt; echo b > {place.elsewhere.as_posix()}/b.txt; echo c > c.txt")
    project, outside = place.hub.shell_reach({"command": command})
    assert [os.path.basename(path) for path in project] == ["a.txt"]
    assert [os.path.basename(path) for path in outside] == ["b.txt"]
    assert place.hub.shell_outside({"command": command}) == outside
    assert place.hub.shell_reach({"command": "echo c > c.txt"}) == ([], [])
    # A command that starts in another project names its files there.
    started = place.hub.shell_reach({"command": "echo c > c.txt", "cwd": str(place.other)})
    assert [os.path.basename(path) for path in started[0]] == ["c.txt"] and started[1] == []


# --- refused before any question, in every place a question can be asked ---------------------------------------------------


def test_the_gate_says_which_calls_are_refused_before_any_question(place):
    choose(place)
    gate = ToolGate(place.hub, conn=place.conn)
    project_command = {"command": f"echo hi > {place.other.as_posix()}/out.txt"}
    for mode in MODES:
        place.settings.set("action_mode", mode)
        assert gate.refused_for_call(WRITE, args(place.other / "a.md")) == work_area.UNCHOSEN_WORDS, mode
        assert gate.refused_for_call(EDIT, {"path": str(place.other / "a.md"), "old_string": "a", "new_string": "b"}) == work_area.UNCHOSEN_WORDS
        assert gate.refused_for_call(EXEC, project_command) == work_area.UNCHOSEN_WORDS, mode
        # A native command of a CLI brain is judged by the same files it names.
        assert gate.refused_for_call("cli_permission", {"command": project_command["command"]}) == work_area.UNCHOSEN_WORDS
        assert gate.refused_for_call("cli_permission", {"input": {"command": project_command["command"]}}) == work_area.UNCHOSEN_WORDS
    # What is asked about as before, or not a write, is not refused.
    for call, arguments in ((WRITE, args(place.project / "a.md")), (WRITE, args(place.elsewhere / "a.md")),
                            ("mcp:owner_files/read_file", {"path": str(place.other / "a.md")}),
                            (EXEC, {"command": "echo hi > out.txt"}), (EXEC, outside_command(place)),
                            ("cli_permission", {"command": "Get-Process"}), ("mcp:nothing/anything", args(place.other / "a.md"))):
        assert gate.refused_for_call(call, arguments) is None, (call, arguments)


@pytest.mark.parametrize("mode", ["ask", "plan"])
async def test_a_write_into_an_unchosen_project_is_refused_before_the_owner_is_asked_in_ask_and_plan(make_rig, client, conn, place, mode):
    choose(place)
    rig = make_rig(plugins=place.hub, gate=ToolGate(place.hub, conn=conn), permissions=PermissionCards(conn))
    rig.settings.set("action_mode", mode)
    target = place.other / "note.md"
    client.chats = [chat("Saving.", ("owner_files__write_file", args(target, "hello\n"))), chat('{"text":"Not saved."}')]
    done = await typed(rig, "Save a note")
    assert done["status"] != "confirm" and not target.exists()
    # The model is told it is refused, in the words of the rule.
    told = [message["content"] for message in client.chat_calls[-1]["messages"] if message["role"] == "tool"]
    assert any("not chosen for you" in text for text in told), told


@pytest.mark.parametrize("mode", ["ask", "plan"])
async def test_a_command_naming_an_unchosen_project_is_refused_before_the_owner_is_asked_in_ask_and_plan(make_rig, client, conn, place, mode):
    choose(place)
    place.settings.set("local_commands_mode", "ask")
    rig = make_rig(plugins=place.hub, gate=ToolGate(place.hub, conn=conn), permissions=PermissionCards(conn))
    rig.settings.set("action_mode", mode)
    client.chats = [chat("Saving.", ("local__local_exec", {"command": project_commands(place)[1]})),
                    chat('{"text":"Not saved."}')]
    done = await typed(rig, "Save a note")
    assert done["status"] != "confirm" and place.host.execute.await_count == 0
    assert not (place.other / "out.txt").exists()

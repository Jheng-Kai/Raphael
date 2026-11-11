"""What a routine's run may read: the team, its skill's own files, the app's recent failures (owner, 2026-11-11).

The data floor exists so that commands and file tools cannot WRITE the app's database, credentials, vault or core files; what a
run needs of its own material it reads through the tools meant for it, and those never open the database, vault, keys or `.env`."""

from types import SimpleNamespace

import pytest

from raphael_core.agent.data_floor import READ_CONSENT, WRITE_REFUSAL, DataFloor
from raphael_core.agent.history import AgentHistory
from raphael_core.protocol import RpcError
from agent.test_service import Rig  # noqa: F401
from .test_answering import client, member, setup  # noqa: F401


def routine_task(rig, team, who, *, scope="private", room_id=None):
    turn_id = AgentHistory(rig.conn).add(session_id="routine:1", question="Health", route="routine", prefix="", text="",
                                         status="running", source="routine", member_id=who.id)
    return SimpleNamespace(id=1, turn_id=turn_id, member_id=who.id, scope=scope, room_id=room_id, session_id="routine:1",
                           text="Check", language="en", source_turn_id=None, routine_id=1)


async def test_a_routines_run_reads_the_team_as_its_member_does_in_the_conversation(setup):
    rig, team = setup
    health = member(team, name="蛋博士")
    task = routine_task(rig, team, health)
    overview = await rig.service.background_owner_tool(task, "team_overview", {})
    assert overview.ok and {item["name"] for item in overview.data["members"]} >= {"蛋博士"}
    work = await rig.service.background_owner_tool(task, "team_work", {"days": 3})
    assert work.ok
    # The reads of the owner's data run through the app's own services (wired by the app); here the run is authorised for them.
    from raphael_core.management import BACKGROUND_READS, background_management
    assert {"settings_read", "conversation_list", "dictionary_list", "memory_document_read"} <= BACKGROUND_READS
    asked = {"settings_read": {}, "dictionary_list": {}, "conversation_list": {"member_id": health.id}}
    with background_management(health.id):
        for name, arguments in asked.items():
            team.members.authorize_management(health.id, name, arguments, interactive=False)
    for name, arguments in asked.items():
        with pytest.raises(RpcError):
            team.members.authorize_management(health.id, name, arguments, interactive=False)


async def test_the_team_reads_stay_closed_to_a_room_and_to_everything_that_is_no_routine_run(setup):
    rig, team = setup
    health = member(team, name="蛋博士")
    assert not (await rig.service.background_owner_tool(routine_task(rig, team, health, scope="room", room_id=1),
                                                       "team_work", {})).ok
    with pytest.raises(RpcError):
        await team.members.admin_tool(health.id, "team_work", {})  # not a conversation, not a run: still closed
    for name in ("member_update", "group_delete", "settings_update"):
        assert not (await rig.service.background_owner_tool(routine_task(rig, team, health), name, {"id": 1})).ok, name


DOCUMENT = "---\nname: daily-page\ndescription: Make the daily page\n---\nFill templates/page.html and show it.\n"


async def read(rig, speaker, arguments):
    return await rig.service.team_tool(speaker, "skill_read", arguments, language="en", ledger=None, session_id="s")


async def test_skill_read_gives_a_file_of_the_skill_and_never_the_database_the_vault_or_dot_env(setup):
    rig, team = setup
    page = member(team, name="紫苑")
    skill = team.members.capabilities.keep_skill(page.id, "local-test", DOCUMENT)
    folder = team.members.capabilities._path(page.id, skill["id"]).parent
    (folder / "templates").mkdir()
    (folder / "templates" / "page.html").write_text("<h1>{{title}}</h1>", encoding="utf-8")
    speaker = page.speaker()
    given = await read(rig, speaker, {"name": "daily-page", "reference": "templates/page.html"})
    assert given.ok and given.data == {"text": "<h1>{{title}}</h1>"} and given.untrusted
    assert (await read(rig, speaker, {"name": "daily-page"})).ok, "without reference it reads the document as before"
    for reference in ("../../../raphael.db", "..\\..\\raphael.db", ".env", "vault.json", "C:\\Users\\x\\.raphael\\raphael.db"):
        refused = await read(rig, speaker, {"name": "daily-page", "reference": reference})
        assert not refused.ok and refused.error in ("bad_arguments", "not_found") and refused.data is None, reference
    gone = await read(rig, speaker, {"name": "daily-page", "reference": "templates/gone.html"})
    assert gone.error == "not_found"


def test_commands_and_file_tools_still_cannot_write_the_app_s_own_data_and_are_told_which_tool_reads(tmp_path):
    floor = DataFloor(environ={"USERPROFILE": str(tmp_path), "APPDATA": str(tmp_path / "AppData" / "Roaming")}, core_root=tmp_path / "core")
    database = tmp_path / ".raphael" / "raphael.db"
    env_file = tmp_path / ".raphael" / ".env"
    assert floor.access("local_exec", {"command": f"Remove-Item {database}"}) == "write"
    assert floor.access("local_exec", {"command": f"echo x > {env_file}"}) == "write"
    assert floor.access("local_exec", {"command": f"Get-Content {database}"}) == "read", "a read needs the owner's yes, as before"
    assert floor.access("write_file", {"path": str(database), "content": "x"}) == "write"
    for told in (WRITE_REFUSAL, READ_CONSENT):
        assert "skill_read" in told and "self_check" in told


async def test_self_check_gives_a_routines_run_the_recent_failures_of_the_log_with_keys_left_out(setup, tmp_path, monkeypatch):
    rig, team = setup
    health = member(team, name="蛋博士")
    log = tmp_path / "raphael.log"
    log.write_text("INFO fine\nERROR connection failed key sk-or-v1-" + "b" * 40 + "\nWARN slow\n", encoding="utf-8")
    monkeypatch.setenv("RAPHAEL_LOG_PATH", str(log))
    task = routine_task(rig, team, health)
    seen = rig.service._background.diagnostics(health.speaker(), task.turn_id)
    lines = seen["logs"]["recent_failures"]
    assert any("connection failed" in line for line in lines) and not any("sk-or-v1" in line for line in lines)


def test_what_a_colleague_handed_a_member_is_read_as_the_colleagues_in_every_form_it_was_written_down():
    from raphael_core.agent.attribution import from_colleague, owner_lines, turn_speakers
    from raphael_core.agent.history import Turn

    def made(**fields):
        base = dict(id=1, created_at_ms=0, session_id="s", question="主人要求你每天檢查", route="answer", prefix="", text="好的。",
                    detail=None, status="done", cost_usd=0.0, source="app", model=None, member_id=5, peer_id=None)
        return Turn(**{key: value for key, value in {**base, **fields}.items() if key in Turn.__dataclass_fields__})

    exchange = made(route="exchange", source="member", peer_id=0)
    brief = made(route="worker", source="worker", peer_id=0)
    delegated = made(route="delegate", source="app", peer_id=0)
    owners = made()
    routine = made(route="routine", source="routine")
    assert [from_colleague(item) for item in (exchange, brief, delegated, owners, routine)] == [True, True, True, False, False]
    assert turn_speakers(brief)[0] == "Raphael" and turn_speakers(delegated)[0] == "Raphael"
    assert turn_speakers(owners)[0] == "owner" and turn_speakers(routine)[0] == "routine"
    assert owner_lines([exchange, brief, delegated, routine]) == () and owner_lines([owners]) == ("主人要求你每天檢查",)
    # a member's own work, handed to itself, names itself and is not a colleague's
    assert not from_colleague(made(route="worker", source="worker", peer_id=5))

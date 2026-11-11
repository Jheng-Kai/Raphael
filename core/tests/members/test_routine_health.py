"""What a member writes into a routine, what it reads of its own material, and how a run's end reaches the routine (owner, 2026-11-11).

The owner's health-check routines named tools a run does not have; a daily page routine was refused the read of its own
template; failed runs left `routines.last_error` empty and the routine view looked as good as ever."""

import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.protocol import RpcError
from raphael_core.members.store import MemberError
from raphael_core.bots.homes import HomeError

HAS = {"self_check", "local_time", "find_tools", "use_tool", "routine_list", "show_page"}
SCHEDULE = {"kind": "daily", "time": "09:00"}


async def create(rig, member, prompt):
    return await rig.service.routine_tool(member.id, "routine_create", {"title": "Health", "prompt": prompt, "schedule": SCHEDULE})


# --- the tools a routine's instructions name --------------------------------------------------------------------------------


async def test_instructions_that_name_a_tool_a_run_does_not_have_are_refused_with_the_tools_that_exist(rig):
    rig.background.routine_tool_names = lambda member_id: HAS
    member = rig.service.store.create_member(name="蛋博士", role="健檢")
    with pytest.raises(RpcError) as raised:
        await create(rig, member, "Call `team_overview`, then team_work, then `copy_text` and report.")
    told = raised.value.message
    assert "team_overview" in told and "team_work" in told and "copy_text" in told
    assert "self_check" in told and "show_page" in told, "the tools that exist are listed"
    assert rig.service.store.routines(member.id) == []


async def test_a_name_written_as_a_tool_that_is_none_is_refused_and_a_plain_word_is_not(rig):
    rig.background.routine_tool_names = lambda member_id: HAS
    member = rig.service.store.create_member(name="蛋博士", role="健檢")
    with pytest.raises(RpcError):
        await create(rig, member, "Use the tool `health_probe(` to look at the app.")
    created = await create(rig, member, "Report the last_error of each routine in the conversation, using self_check.")
    assert created["routine"]["title"] == "Health"


async def test_editing_the_instructions_is_checked_the_same_way_and_a_switch_is_not(rig):
    rig.background.routine_tool_names = lambda member_id: HAS
    member = rig.service.store.create_member(name="蛋博士", role="健檢")
    routine = (await create(rig, member, "Use self_check and report."))["routine"]
    with pytest.raises(RpcError) as raised:
        await rig.service.routine_tool(member.id, "routine_update", {"id": routine["id"], "prompt": "Run `lock_screen` first."})
    assert "lock_screen" in raised.value.message
    paused = await rig.service.routine_tool(member.id, "routine_update", {"id": routine["id"], "enabled": False})
    assert paused["routine"]["enabled"] is False


async def test_a_background_that_cannot_say_leaves_the_instructions_alone(rig):
    member = rig.service.store.create_member(name="蛋博士", role="健檢")
    assert (await create(rig, member, "Call team_overview."))["routine"]["title"] == "Health"


# --- how a run's end reaches the routine ------------------------------------------------------------------------------------


def started(rig, member):
    routine = rig.service.store.create_routine(member_id=member.id, title="Daily news", prompt="Make the page.",
                                               schedule=SCHEDULE, next_run_ms=rig.wall.now)
    rig.service._run(routine)
    row = rig.conn.execute("SELECT turn_id FROM routine_runs WHERE routine_id=?", (routine.id,)).fetchone()
    return routine, row["turn_id"]


def end(rig, turn_id, status, text):
    AgentHistory(rig.conn, rig.wall).resolve(turn_id, prefix="", text=text, status=status)
    rig.service._finish_run(turn_id)


async def listed(rig, member):
    [view] = (await rig.call("routines.list", {"member_id": member.id}))["routines"]
    return view


async def test_a_failed_run_leaves_its_reason_on_the_routine_and_says_the_last_run_failed(rig):
    member = rig.service.store.create_member(name="紫苑", role="新聞")
    routine, turn_id = started(rig, member)
    end(rig, turn_id, "error", "這次執行需要的一個步驟被拒絕了，沒有完成。\n\n沒有做出頁面。")
    view = await listed(rig, member)
    assert view["last_error"] == "這次執行需要的一個步驟被拒絕了，沒有完成。" and view["last_failed"] is True
    [run] = (await rig.call("routines.runs", {"routine_id": routine.id}))["runs"]
    assert run["status"] == "error" and run["summary"].startswith("這次執行需要的一個步驟被拒絕了")


async def test_a_good_run_after_it_clears_the_reason_and_the_failed_mark(rig):
    member = rig.service.store.create_member(name="紫苑", role="新聞")
    routine, turn_id = started(rig, member)
    end(rig, turn_id, "error", "沒有完成。")
    rig.wall.now += 3_600_000
    rig.service._run(rig.service.store.routine(routine.id), test_run=True)
    second = rig.conn.execute("SELECT turn_id FROM routine_runs WHERE routine_id=? ORDER BY id DESC", (routine.id,)).fetchone()["turn_id"]
    end(rig, second, "done", "頁面做好了。")
    view = await listed(rig, member)
    assert view["last_error"] == "" and "last_failed" not in view


async def test_a_run_the_owner_stopped_is_no_failure_of_the_routine(rig):
    member = rig.service.store.create_member(name="紫苑", role="新聞")
    routine, turn_id = started(rig, member)
    end(rig, turn_id, "cancelled", "已停止。")
    view = await listed(rig, member)
    assert view["last_error"] == "" and "last_failed" not in view


# --- reading its own material ----------------------------------------------------------------------------------------------


DOCUMENT = "---\nname: daily-page\ndescription: Make the daily page\n---\nFill templates/page.html and show it.\n"


def skill_with_files(rig, member):
    skill = rig.service.capabilities.keep_skill(member.id, "local-test", DOCUMENT)
    folder = rig.service.capabilities._path(member.id, skill["id"]).parent
    (folder / "templates").mkdir()
    (folder / "templates" / "page.html").write_text("<h1>{{title}}</h1> key sk-or-v1-" + "a" * 40, encoding="utf-8")
    (folder / "notes.txt").write_text("plain notes", encoding="utf-8")
    (folder / "data.db").write_bytes(b"SQLite format 3\x00")
    (folder / ".env").write_text("TOKEN=abc", encoding="utf-8")
    (folder / "vault.json").write_text("{}", encoding="utf-8")
    return folder


async def test_a_member_reads_the_page_template_of_its_skill_through_skill_read(rig):
    member = rig.service.store.create_member(name="紫苑", role="新聞")
    skill_with_files(rig, member)
    text = rig.service.skill_file(member.id, "daily-page", "templates/page.html")
    assert text.startswith("<h1>{{title}}</h1>") and "sk-or-v1-" not in text, "what looks like a key is not given"
    assert rig.service.skill_file(member.id, "daily-page", "notes.txt") == "plain notes"
    assert rig.service.skill_file(member.id, "daily-page", "templates\\page.html").startswith("<h1>")


@pytest.mark.parametrize("reference", [
    "../../../raphael.db", "..\\..\\raphael.db", "templates/../../x.html", "/etc/passwd.txt", "C:/Windows/win.txt",
    "data.db", ".env", "vault.json", "templates/../.env", "~/.raphael/raphael.db", "key.pem", "id_rsa.txt", "", "  ", "templates",
    "templates/missing.html", "x\u0000.html",
])
async def test_the_database_the_vault_keys_and_dot_env_stay_unreadable_through_skill_read(rig, reference):
    member = rig.service.store.create_member(name="紫苑", role="新聞")
    skill_with_files(rig, member)
    with pytest.raises(MemberError):
        rig.service.skill_file(member.id, "daily-page", reference)


async def test_skill_read_gives_only_files_of_an_enabled_skill_of_that_member(rig):
    one = rig.service.store.create_member(name="紫苑", role="新聞")
    other = rig.service.store.create_member(name="迪亞布羅", role="檢查")
    skill_with_files(rig, one)
    with pytest.raises(MemberError):
        rig.service.skill_file(other.id, "daily-page", "notes.txt")
    with pytest.raises(MemberError):
        rig.service.skill_file(one.id, "not-a-skill", "notes.txt")
    with pytest.raises(MemberError):
        rig.service.skill_file(one.id, 7, "notes.txt")


async def test_a_link_out_of_the_skill_folder_is_not_followed(rig, tmp_path):
    member = rig.service.store.create_member(name="紫苑", role="新聞")
    folder = skill_with_files(rig, member)
    outside = tmp_path / "outside.txt"
    outside.write_text("outside", encoding="utf-8")
    try:
        (folder / "link.txt").symlink_to(outside)
    except OSError:
        pytest.skip("this PC does not let a test make a symbolic link")
    with pytest.raises((MemberError, HomeError)):
        rig.service.skill_file(member.id, "daily-page", "link.txt")


async def test_a_file_that_is_too_large_or_not_text_is_refused(rig):
    member = rig.service.store.create_member(name="紫苑", role="新聞")
    folder = skill_with_files(rig, member)
    (folder / "big.html").write_text("x" * (256 * 1024 + 1), encoding="utf-8")
    (folder / "binary.html").write_bytes(b"\xff\xfe\x00\x01")
    for name in ("big.html", "binary.html"):
        with pytest.raises(MemberError):
            rig.service.skill_file(member.id, "daily-page", name)

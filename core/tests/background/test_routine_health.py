"""A routine's run: the tools it has, how its end is judged, and what it knows of the run before (owner, 2026-11-11).

Facts from the owner's own data: a health check named `team_overview` and `team_work` and got `unknown_tool`, four times; runs
were marked done with nothing made; a routine did not know when it last ran or what it last reported."""

import json

import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.agent.harness_tools import tool as harness_tool
from raphael_core.agent.policy import Tier
from raphael_core.agent.team_admin import TEAM_READS
from raphael_core.agent.tools import ToolResult
from raphael_core.background.routine_outcome import REFUSED_KINDS, expected, failure
from raphael_core.background.snapshot import take_snapshot
from raphael_core.management import READS

from .conftest import call, report, turn, until, use
from .test_members import Team, ended


def routine_run(rig, text="Check the team", *, member_id=0, routine_id=1):
    return rig.service.submit(session_id=f"routine:{routine_id}", text=text, language="en", model="fake/model",
                              member_id=member_id, routine_id=routine_id)


# --- the tools of a routine's run -----------------------------------------------------------------------------------------


def test_a_routines_run_lists_the_team_reads_and_other_background_work_finds_them():
    routine = take_snapshot(None, routine=True)
    assert TEAM_READS <= set(routine.refs) and TEAM_READS <= routine.listed()
    other = take_snapshot(None)
    assert not TEAM_READS & set(other.refs) and TEAM_READS <= set(other.work)


def test_a_routine_has_every_read_only_tool_its_member_has_in_the_conversation():
    """A failure seen twice becomes a rule: a tool the conversation reads with that a routine does not have is a gap, unless it
    needs the owner at the screen."""
    conversation = take_snapshot(None, interactive=True, memory=True, max_tier=Tier.T3)
    routine = take_snapshot(None, routine=True, memory=True, background_management=True)

    def reads(snapshot):
        names = set(snapshot.refs) | set(snapshot.work) | set(snapshot.management)
        return {name for name in names if name in READS or name in snapshot.refs and snapshot.refs[name].tier == Tier.T0
                or name in snapshot.work and harness_tool(name).tier == Tier.T0}

    # These show something on the owner's screen or drive the desktop: nobody is there when a routine runs.
    needs_the_owner_at_the_screen = {"show", "computer"}
    assert reads(conversation) - needs_the_owner_at_the_screen <= reads(routine) | set(routine.refs)


async def test_a_routine_calls_the_team_reads_through_the_owner_tools(make_rig, conn):
    rig = make_rig()
    rig.service.use_team(Team(), Team().tool)
    seen = []

    async def owner_tools(task, name, arguments, **_):
        seen.append((task.routine_id, name))
        return ToolResult(name, True, {"members": []})

    rig.service.use_owner_tools(owner_tools)
    turn_id = AgentHistory(conn).add(session_id="routine:1", question="Health", route="routine", prefix="", text="",
                                     status="running", source="routine")
    rig.client.replies = [turn("", [call("team_overview", {}, "c1"), call("team_work", {"days": 3}, "c2")]), report("All well.")]
    task_id = routine_run(rig)
    rig.service.attach_turn(task_id, turn_id)
    task = await ended(rig, task_id)
    assert task.state == "done" and seen == [(1, "team_overview"), (1, "team_work")]
    assert {"team_overview", "team_work"} <= {tool["function"]["name"] for tool in rig.client.chat_calls[0]["tools"]}


async def test_a_tool_that_does_not_exist_is_told_with_the_nearest_real_ones(make_rig):
    rig = make_rig()
    rig.client.replies = [turn("", [use("team_overviw", {}, "c1")]), report("Looked.")]
    task_id = routine_run(rig)
    await ended(rig, task_id)
    told = rig.client.chat_calls[1]["messages"][-1]["content"]
    assert "team_overview" in told and "nearest tools" in told


# --- how a run is judged --------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("prompt, made", [
    ("Make a web page of today's news and show it with show_page.", "page"),
    ("Create a page that summarises the day", "page"),
    ("每天早上製作今日新聞的網頁", "page"),
    ("把日本語のニュースをまとめてページを作成する", "page"),
    ("Write an email draft to the client about the delay", "draft"),
    ("Check the app's health with self_check and report what is wrong", None),
    ("Do not make a page; only tell me in the conversation", None),
    ("不要做網頁，直接回報", None),
])
def test_what_a_routine_is_set_to_make_is_read_from_its_instructions(prompt, made):
    assert expected(prompt) == made


def test_a_run_is_done_only_when_it_did_its_work():
    assert failure("Check", {"self_check"}, None, 1) is None
    assert failure("Check", set(), None, 0) is None, "a run that needed no tool is not failed for making none"
    assert failure("Check", {"self_check"}, ("local_exec", "protected_data"), 3) == "routine_refused"
    assert failure("Make a page", {"web_read"}, None, 2) == "routine_nothing"
    assert failure("Make a page", {"web_read", "show_page"}, None, 3) is None
    assert failure("Check", set(), None, 2) == "routine_nothing", "every tool it called failed"
    assert {"protected_data", "unknown_tool", "forbidden"} <= REFUSED_KINDS


async def test_a_run_whose_last_step_was_refused_is_failed_with_its_reason_whatever_it_reported(make_rig, conn):
    rig = make_rig()
    # After the note of what failed and what it has not tried (R-PERSIST-03), it says the same again.
    rig.client.replies = [turn("", [use("nothing_like_it", {}, "c1")]), report("Everything is fine."), report("Everything is fine.")]
    task_id = routine_run(rig)
    task = await ended(rig, task_id)
    assert (task.state, task.reason) == ("failed", "routine_refused")
    said = " ".join(rig.service.final_words(task_id))
    assert said.startswith("A step this run needed was refused") and "Everything is fine." in said


async def test_a_run_that_went_on_after_a_refusal_with_a_tool_that_works_is_done(make_rig):
    rig = make_rig()
    rig.client.replies = [turn("", [use("nothing_like_it", {}, "c1")]), turn("", [call("local_time", {}, "c2")]), report("Checked.")]
    task_id = routine_run(rig)
    task = await ended(rig, task_id)
    assert task.state == "done" and task.reason is None


async def test_a_run_set_to_make_a_page_is_done_only_when_the_page_exists(make_rig, conn):
    rig = make_rig()
    pages = []

    async def owner_tools(task, name, arguments, **_):
        pages.append(name)
        return ToolResult(name, True, {"page_id": "p1"})

    rig.service.use_owner_tools(owner_tools)
    history = AgentHistory(conn)
    prompt = "Make a web page of today's news."
    rig.client.replies = [report("Here is the news.")]
    first = routine_run(rig, prompt)
    rig.service.attach_turn(first, history.add(session_id="routine:1", question="News", route="routine", prefix="", text="",
                                               status="running", source="routine"))
    task = await ended(rig, first)
    assert (task.state, task.reason) == ("failed", "routine_nothing") and pages == []
    rig.client.replies = [turn("", [call("show_page", {"title": "News", "html": "<p>News</p>"}, "c1")]), report("Made the page.")]
    second = routine_run(rig, prompt)
    rig.service.attach_turn(second, history.add(session_id="routine:1", question="News", route="routine", prefix="", text="",
                                                status="running", source="routine"))
    task = await ended(rig, second)
    assert task.state == "done" and pages == ["show_page"]


async def test_work_that_is_no_routine_is_judged_as_before(make_rig):
    rig = make_rig()
    rig.client.replies = [turn("", [use("nothing_like_it", {}, "c1")]), report("Everything is fine."), report("Everything is fine.")]
    task_id = rig.submit("Check the team")
    assert (await ended(rig, task_id)).state == "done"


# --- what a routine knows of its last run ---------------------------------------------------------------------------------


async def test_a_run_is_given_when_the_routine_last_ran_whether_it_worked_and_what_it_reported(make_rig, conn):
    rig = make_rig()
    history = AgentHistory(conn, rig.wall)
    with conn:
        conn.execute("INSERT INTO routines(member_id,title,prompt,schedule,created_at_ms) VALUES (0,'Daily','Check','{}',0)")
    routine_id = conn.execute("SELECT MAX(id) FROM routines").fetchone()[0]
    earlier = history.add(session_id=f"routine:{routine_id}", question="Daily", route="routine", prefix="", text="Notice: the key expires on Friday.",
                          status="error", source="routine")
    now = history.add(session_id=f"routine:{routine_id}", question="Daily", route="routine", prefix="", text="", status="running", source="routine")
    with conn:
        conn.execute("INSERT INTO routine_runs(routine_id,started,finished,status,turn_id) VALUES (?,?,?,?,?)",
                     (routine_id, rig.wall() - 86_400_000, rig.wall() - 86_300_000, "error", earlier))
        conn.execute("INSERT INTO routine_runs(routine_id,started,status,turn_id) VALUES (?,?,'running',?)", (routine_id, rig.wall(), now))
    task_id = routine_run(rig, "Check", routine_id=routine_id)
    rig.service.attach_turn(task_id, now)
    block = rig.service._last_run(rig.task(task_id))
    data = json.loads(block.split("<routine_last_run>")[1].split("</routine_last_run>")[0])["last_run"]
    assert data["succeeded"] is False and data["status"] == "error"
    assert data["started_at"].startswith("2026-10-20") and "key expires on Friday" in data["report"]
    rig.client.replies = [report("Done.")]
    await ended(rig, task_id)
    assert "<routine_last_run>" in rig.client.chat_calls[0]["messages"][1]["content"]


async def test_a_routines_first_run_is_told_it_has_no_run_before(make_rig, conn):
    rig = make_rig()
    task_id = routine_run(rig, "Check", routine_id=99)
    assert json.loads(rig.service._last_run(rig.task(task_id)).split("<routine_last_run>")[1].split("</routine_last_run>")[0])["last_run"] is None
    await rig.service._cancel({"task_id": task_id})


# --- who said it -----------------------------------------------------------------------------------------------------------


async def test_a_routine_run_again_is_still_the_routines_and_never_the_owners_message(make_rig, conn):
    rig = make_rig()
    history = AgentHistory(conn, rig.wall)
    with conn:
        conn.execute("INSERT INTO routines(member_id,title,prompt,schedule,created_at_ms) VALUES (0,'Daily news','主人要求你每天做新聞頁面','{}',0)")
    routine_id = conn.execute("SELECT MAX(id) FROM routines").fetchone()[0]
    first = history.add(session_id=f"routine:{routine_id}", question="Daily news", route="routine", prefix="", text="", status="running", source="routine")
    with conn:
        conn.execute("INSERT INTO routine_runs(routine_id,started,status,turn_id,trigger_json) VALUES (?,?,'running',?,'{\"id\": 1}')",
                     (routine_id, rig.wall(), first))
    rig.client.replies = [turn("", [use("nothing_like_it", {}, "c1")]), report("Done.")]
    task_id = routine_run(rig, "主人要求你每天做新聞頁面", routine_id=routine_id)
    rig.service.attach_turn(task_id, first)
    assert (await ended(rig, task_id)).state == "failed"
    rig.client.replies = [turn("", [call("local_time", {}, "c2")]), report("Checked.")]
    again = (await rig.service._rerun({"task_id": task_id}))["task_id"]
    new = rig.task(again)
    assert new.routine_id == routine_id
    turn_row = history.get(new.turn_id)
    assert (turn_row.route, turn_row.source, turn_row.question) == ("routine", "routine", "Daily news")
    assert "主人要求" not in turn_row.question
    [row] = conn.execute("SELECT turn_id, trigger_json FROM routine_runs WHERE turn_id=?", (new.turn_id,)).fetchall()
    assert row["trigger_json"] == '{"id": 1}'
    await ended(rig, again)


async def test_a_page_the_run_waited_at_still_counts_as_made_when_the_run_goes_on(make_rig, conn):
    rig = make_rig()
    history = AgentHistory(conn)

    async def owner_tools(task, name, arguments, **_):
        return ToolResult(name, True, {"page_id": "p1", "owner_card": {"kind": "show_page", "id": "p1", "question": "Open it"}})

    rig.service.use_owner_tools(owner_tools)
    shown = history.add(session_id="routine:1", question="News", route="routine", prefix="", text="", status="running", source="routine")
    rig.client.replies = [turn("", [call("show_page", {"title": "News", "html": "<button>Pick</button>"}, "c1")])]
    task_id = routine_run(rig, "Make a web page of today's news.")
    rig.service.attach_turn(task_id, shown)
    await until(lambda: rig.task(task_id).state == "waiting")
    [question] = rig.service.owner_questions.for_turn(shown)
    rig.client.replies = [report("The page is shown.")]
    await rig.rpc.call("owner_questions.answer", {"id": question["id"], "answer": "ok"})
    task = await ended(rig, task_id)
    assert (task.state, task.reason) == ("done", None)

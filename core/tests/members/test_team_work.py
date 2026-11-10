"""Recorded team reports on a real migrated database, without model or file reads."""

import json
from datetime import datetime, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.agent.owner_questions import OwnerQuestions
from raphael_core.agent.policy import Tier
from raphael_core.agent.team_admin import CONFIRM_TOOLS, DEFINITIONS, TEAM_READS, TIERS
from raphael_core.members.team_work import read
from raphael_core.protocol import INVALID_PARAMS, RpcError

from agent.test_narration import chat
from .conftest import NOW_MS
from .test_answering import client, live_said, setup, typed  # noqa: F401
from .test_answering import member as answering_member

DAY = 86_400_000


def turn(conn, mid=0, at=NOW_MS, title="Recorded work", status="done", **extra):
    history = AgentHistory(conn, lambda: at)
    identifier = history.add(session_id="team-work", question=title, route="answer", prefix="",
                             text=extra.pop("text", ""), status=status, member_id=mid, **extra)
    return history, identifier


def task(conn, mid=0, at=NOW_MS, title="Recorded task", state="done", **extra):
    values = {"created_at_ms": at, "finished_at_ms": at if state in ("done", "failed", "interrupted", "limit") else None,
              "state": state, "session_id": "team-work", "language": "en", "text": title, "member_id": mid, **extra}
    return conn.execute(f"INSERT INTO worker_tasks ({','.join(values)}) VALUES ({','.join('?' for _ in values)})",
                        tuple(values.values())).lastrowid


def routine(conn, mid=0, at=NOW_MS, title="Daily review", **extra):
    values = {"member_id": mid, "title": title, "prompt": "Review", "schedule": json.dumps({"kind": "daily", "time": "09:00"}),
              "created_at_ms": at, **extra}
    return conn.execute(f"INSERT INTO routines ({','.join(values)}) VALUES ({','.join('?' for _ in values)})",
                        tuple(values.values())).lastrowid


def run(conn, rid, started=NOW_MS, finished=NOW_MS, status="done", **extra):
    values = {"routine_id": rid, "started": started, "finished": finished, "status": status, **extra}
    return conn.execute(f"INSERT INTO routine_runs ({','.join(values)}) VALUES ({','.join('?' for _ in values)})",
                        tuple(values.values())).lastrowid


def media(conn, mid=0, at=NOW_MS, name="report.pdf", key="a" * 32 + ".pdf"):
    history, identifier = turn(conn, mid, at)
    history.add_message(identifier, "media", json.dumps({"attachment": {"id": key, "name": name, "mime": "application/pdf"}}))
    return identifier


def evidence(conn, tid, at=NOW_MS, name="project/report.pdf", verdict="verified", kind="artifact"):
    conn.execute("INSERT INTO task_evidence (task_id,tool_call_id,kind,uri,digest,mime,scope,verified_at_ms,verdict)"
                 " VALUES (?,?,?,?,?,?,?,?,?)", (tid, name, kind, name, "digest", "application/pdf", "private", at, verdict))


def page(conn, tid, mid=0, at=NOW_MS, title="Report page", identifier="page"):
    conn.execute("INSERT INTO pages (id,turn_id,member_id,title,html,fallback,height,rev,source,tool_input,tool_result,network,created_at_ms,updated_at_ms)"
                 " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                 (identifier, tid, mid, title, "<p>Report</p>", "Report", 400, 1, "html", "{}", "{}", "{}", at, at))


async def report(rig, caller=0, **args):
    return await rig.service.admin_tool(caller, "team_work", args, interactive=True)


def member(result, identifier=0):
    return next(item for item in result["members"] if item["id"] == identifier)


def test_definition_is_discoverable_read_only_and_t0():
    definition = DEFINITIONS["team_work"]
    assert TIERS["team_work"] == Tier.T0
    assert TEAM_READS == frozenset({"team_overview", "team_work"})
    assert "team_work" not in CONFIRM_TOOLS
    first = definition["description"].split(".", 1)[0]
    assert "報告" in first and "report" in first
    assert definition["parameters"]["additionalProperties"] is False
    assert definition["parameters"]["properties"] == {
        "member_id": {"type": "integer", "minimum": 0}, "days": {"type": "integer", "minimum": 1, "maximum": 30}}


async def test_empty_shape_matches_roster_and_reads_do_not_write(rig):
    group = (await rig.call("groups.create", {"name": "Planning"}))["group"]["id"]
    one = (await rig.call("members.create", {"name": "Analyst", "role": "Research", "group_id": group}))["member"]["id"]
    roster = await rig.call("members.list")
    before = rig.conn.total_changes
    result = await report(rig, caller=one)
    assert rig.conn.total_changes == before
    assert result["as_of"] == "2026-10-23 08:59" and result["as_of_ms"] == NOW_MS and result["days"] == 14
    assert [item["id"] for item in result["members"]] == [item["id"] for item in roster["members"]]
    assert member(result, one)["group"] == "Planning" and member(result, one)["role"] == "Research"
    assert member(result) == {
        "id": 0, "name": roster["members"][0]["name"], "role": roster["members"][0]["role"], "group": None,
        "finished": {"count": 0, "recent": []}, "failed": {"count": 0, "recent": []},
        "unfinished": [], "waiting_for_owner": [], "routines": [], "outputs": [], "handed_to": [], "received_from": []}
    json.dumps(result)


async def test_caps_counts_collapsed_titles_and_newest_first(rig):
    for index in reversed(range(15)):
        at = NOW_MS - index * 60_000
        title = f"Work {index}\n " + "long title " * 30
        turn(rig.conn, at=at, title=title)
        task(rig.conn, at=at, title=f"Failure {index}", state="failed", reason="timeout")
        turn(rig.conn, at=at, status="confirm", text=f"Approve {index}")
        rid = routine(rig.conn, at=at, title=f"Routine {index}")
        run(rig.conn, rid, started=at, finished=None, status="running")
        media(rig.conn, at=at, name=f"Output {index}.pdf", key=f"{index:032x}.pdf")
    result = member(await report(rig))
    # Media delivery turns are also real finished work, counted exactly once.
    assert result["finished"]["count"] == 30 and result["failed"]["count"] == 15
    for key in ("finished", "failed"):
        recent = result[key]["recent"]
        assert len(recent) == 6 and [item["at"] for item in recent] == sorted([item["at"] for item in recent], reverse=True)
        assert all(len(item["title"]) <= 120 and "\n" not in item["title"] for item in recent)
    for key, cap, time_field in (("unfinished", 6, "since"), ("waiting_for_owner", 6, "since"),
                                 ("routines", 12, "last_at"), ("outputs", 8, "at")):
        assert len(result[key]) == cap
        times = [item[time_field] for item in result[key]]
        assert times == sorted(times, reverse=True)
    assert result["unfinished"][0]["title"] == "Failure 0"
    assert result["waiting_for_owner"][0]["question"] == "Approve 0"
    assert result["outputs"][0]["name"] == "Output 0.pdf"


async def test_window_filters_history_outputs_and_handoffs_but_keeps_pending(rig):
    for offset in (0, 1, 2, 15):
        at = NOW_MS - offset * DAY
        task(rig.conn, at=at, title=f"Done {offset}")
        task(rig.conn, at=at, title=f"Failed {offset}", state="failed")
        media(rig.conn, at=at, name=f"Output {offset}", key=f"{offset:032x}.pdf")
    turn(rig.conn, at=NOW_MS + 1, title="Future")
    task(rig.conn, at=NOW_MS - 40 * DAY, state="waiting", title="Still pending")
    turn(rig.conn, at=NOW_MS - 40 * DAY, status="confirm", text="Still waiting")
    narrow = member(await report(rig, days=1))
    wide = member(await report(rig))
    assert narrow["finished"]["count"] == 4 and wide["finished"]["count"] == 6
    assert narrow["failed"]["count"] == 2 and wide["failed"]["count"] == 3
    assert [row["name"] for row in narrow["outputs"]] == ["Output 0", "Output 1"]
    assert any(row["title"] == "Still pending" for row in narrow["unfinished"])
    assert narrow["waiting_for_owner"][0]["question"] == "Still waiting"


async def test_member_narrowing_and_invalid_params(rig):
    one = (await rig.call("members.create", {"name": "Analyst"}))["member"]["id"]
    task(rig.conn, mid=one)
    assert [row["id"] for row in (await report(rig, member_id=one))["members"]] == [one]
    assert [row["id"] for row in (await report(rig, member_id=0))["members"]] == [0]
    for arguments in ({"member_id": 999}, {"member_id": -1}, {"member_id": True}, {"member_id": None},
                      {"member_id": "0"}, {"days": 0}, {"days": 31}, {"days": True}, {"days": 1.5}, {"days": None}, {"extra": 1}):
        with pytest.raises(RpcError) as caught:
            await report(rig, **arguments)
        assert caught.value.code == INVALID_PARAMS
    assert (await report(rig, days=30))["days"] == 30


async def test_noninteractive_is_refused_before_reading(rig, monkeypatch):
    def forbidden(*args):
        raise AssertionError("roster should not be read")

    monkeypatch.setattr(rig.service, "_list", forbidden)
    for interactive in (False,):
        with pytest.raises(RpcError, match="team_work is only available in the owner's private chat"):
            await rig.service.admin_tool(0, "team_work", {}, interactive=interactive)
        with pytest.raises(RpcError, match="team_work is only available in the owner's private chat"):
            rig.service.authorize_management(0, "team_work", {})


async def test_handoffs_group_both_directions_with_latest_title_and_window(rig):
    one = (await rig.call("members.create", {"name": "Analyst"}))["member"]["id"]
    for at, title in ((NOW_MS - 10_000, "Older"), (NOW_MS, "Newest\n handoff"), (NOW_MS - 20 * DAY, "Outside")):
        task(rig.conn, mid=one, at=at, title=title, from_member_id=0)
    task(rig.conn, mid=0, at=NOW_MS - 1000, title="Return", from_member_id=one)
    task(rig.conn, mid=one, title="Self", from_member_id=one)
    result = await report(rig)
    assert member(result)["handed_to"] == [{"member_id": one, "name": "Analyst", "count": 2,
                                             "last": "Newest handoff", "at": result["as_of"]}]
    assert member(result, one)["received_from"][0]["count"] == 2
    assert member(result)["received_from"][0]["last"] == "Return"
    assert member(result, one)["handed_to"][0]["member_id"] == 0
    assert member(await report(rig, member_id=one), one)["received_from"] == member(result, one)["received_from"]


async def test_routine_latest_run_missing_run_and_deduplicated_finished_work(rig):
    _, tid = turn(rig.conn)
    task(rig.conn, turn_id=tid)
    rid = routine(rig.conn, title="Review")
    run(rig.conn, rid, started=NOW_MS - 2000, finished=NOW_MS - 1000, turn_id=tid)
    run(rig.conn, rid, started=NOW_MS, finished=None, status="running")
    routine(rig.conn, at=NOW_MS - 5000, title="Paused", enabled=0, last_error="Stored poll error")
    result = member(await report(rig))
    assert result["finished"] == {"count": 1, "recent": [{"title": "Review", "at": "2026-10-23 08:58", "kind": "routines"}]}
    assert result["routines"] == [
        {"title": "Review", "enabled": True, "schedule": "daily", "last_status": "running", "last_at": "2026-10-23 08:59", "last_error": ""},
        {"title": "Paused", "enabled": False, "schedule": "daily", "last_status": "", "last_at": "", "last_error": "Stored poll error"}]


async def test_waiting_questions_all_sources_and_terminal_tasks_excluded(rig):
    turn(rig.conn, status="confirm", text="Confirm change", at=NOW_MS - 2000)
    _, tid = turn(rig.conn, at=NOW_MS - 1000)
    worker = task(rig.conn, state="waiting", turn_id=tid)
    rig.conn.execute("INSERT INTO worker_questions (id,task_id,prefix,text,created_at_ms,expires_at_ms,remaining_s) VALUES (?,?,?,?,?,?,?)",
                     ("waiting", worker, "", "Allow tool?", NOW_MS - 1000, NOW_MS + DAY, 10))
    _, tid = turn(rig.conn)
    worker = task(rig.conn, state="running", turn_id=tid)
    OwnerQuestions(rig.conn, now_ms=lambda: NOW_MS).open(SimpleNamespace(id=worker, turn_id=tid, member_id=0), "ask_owner", {"question": "Which option?"})
    _, old_turn = turn(rig.conn)
    old_task = task(rig.conn, state="done", turn_id=old_turn)
    OwnerQuestions(rig.conn, now_ms=lambda: NOW_MS).open(SimpleNamespace(id=old_task, turn_id=old_turn, member_id=0), "ask_owner", {"question": "Stale question"})
    result = member(await report(rig))
    assert [row["question"] for row in result["waiting_for_owner"]] == ["Which option?", "Allow tool?", "Confirm change"]
    assert all(row["since"].startswith("2026-10-23 ") for row in result["waiting_for_owner"])


async def test_failed_reasons_and_unfinished_turn_rules(rig):
    task(rig.conn, title="Task failed", state="failed", reason="Tool unavailable")
    turn(rig.conn, title="Turn failed", status="error", failure={"kind": "network", "provider": "openrouter"})
    turn(rig.conn, title="Legacy failure", status="error", detail="Recorded failure reason")
    rid = routine(rig.conn, title="Routine failed")
    run(rig.conn, rid, status="error", summary="Recorded routine error")
    turn(rig.conn, title="Cancelled answer", status="cancelled")
    turn(rig.conn, title="Routine hidden from unfinished", status="error", source="routine")
    result = member(await report(rig))
    reasons = {row["title"]: row["reason"] for row in result["failed"]["recent"]}
    assert reasons["Task failed"] == "Tool unavailable" and reasons["Turn failed"] == "network"
    assert reasons["Legacy failure"] == "Recorded failure reason" and reasons["Routine failed"] == "Recorded routine error"
    assert {row["title"] for row in result["unfinished"]} == {"Task failed", "Turn failed", "Legacy failure", "Cancelled answer"}
    assert result["routines"][0]["last_error"] == "Recorded routine error"


async def test_outputs_use_member_deliveries_verified_artifacts_and_pages_never_uploads(rig):
    history, tid = turn(rig.conn, attachments=[{"id": "b" * 32 + ".png", "name": "owner-upload.png", "mime": "image/png"}])
    history.add_message(tid, "progress", "owner-upload.png")
    media(rig.conn, name="member-delivery.pdf")
    worker = task(rig.conn)
    evidence(rig.conn, worker, name="project/verified.pdf", at=NOW_MS - 1000)
    evidence(rig.conn, worker, name="project/unverified.pdf", verdict="rejected")
    evidence(rig.conn, worker, name="project/before.pdf", kind="file_before")
    page(rig.conn, tid, at=NOW_MS - 2000)
    # Reply links and legacy reply text are stored member deliveries too.
    history.add_message(tid, "reply", "[Linked file](attachment:" + "c" * 32 + ".pdf)")
    turn(rig.conn, text="[Legacy file](attachment:" + "d" * 32 + ".pdf)")
    names = {row["name"]: row["kind"] for row in member(await report(rig))["outputs"]}
    assert names == {"member-delivery.pdf": "attachment", "verified.pdf": "artifact", "Report page": "page",
                     "Linked file": "attachment", "Legacy file": "attachment"}


async def test_secrets_are_scanned_before_truncation_in_every_text_source(rig):
    secret = "password=super-secret-password"
    title = "Public words " * 15 + secret
    task(rig.conn, title=title, state="failed", reason=secret)
    turn(rig.conn, title=title)
    turn(rig.conn, status="confirm", text=title)
    routine(rig.conn, title=title, last_error=secret)
    media(rig.conn, name=title)
    result = member(await report(rig))
    assert result["finished"]["recent"][1]["title"] == "(redacted)"
    assert result["failed"]["recent"][0]["title"] == result["failed"]["recent"][0]["reason"] == "(redacted)"
    assert result["unfinished"][0]["title"] == result["waiting_for_owner"][0]["question"] == "(redacted)"
    assert result["routines"][0]["title"] == result["routines"][0]["last_error"] == "(redacted)"
    assert result["outputs"][0]["name"] == "(redacted)"
    assert secret not in json.dumps(result)


async def test_owner_timezone_and_local_day_window_across_dst(rig):
    rig.service._settings.set("routine_detected_timezone", "Asia/Tokyo")
    assert (await report(rig))["as_of"] == "2026-10-23 09:59"
    # The owner's own time zone (General) wins over the device's, as it does for routines.
    rig.service._settings.set("routine_timezone", "Europe/London")
    assert (await report(rig))["as_of"] == "2026-10-23 01:59"
    rig.service._settings.set("routine_timezone", "")
    zone = ZoneInfo("America/New_York")
    now = datetime(2026, 11, 1, 12, tzinfo=zone)
    start = int((now - timedelta(days=1)).timestamp() * 1000)
    now_ms = int(now.timestamp() * 1000)
    assert now_ms - start == 25 * 3_600_000
    task(rig.conn, at=start, title="Local window boundary")
    task(rig.conn, at=start - 1, title="Outside boundary")
    roster = await rig.call("members.list")
    result = read(rig.conn, roster, zone, now_ms, 0, 1)
    assert result["as_of"] == "2026-11-01 12:00"
    assert member(result)["finished"]["recent"] == [{"title": "Local window boundary", "kind": "work", "at": "2026-10-31 12:00"}]


async def test_a_member_reads_the_team_and_shows_it_as_a_report_in_the_owners_chat(setup, client):
    # Through the production harness: offered in the owner's private chat, passed by the gate without a question,
    # and its facts are what the report is made of.
    agent_rig, team = setup
    mira = answering_member(team, name="Mira", role="Research")
    report_page = {"sections": [
        {"kind": "team", "title": "Who works with whom", "nodes": [{"id": "o", "owner": True}, {"id": "m", "member_id": mira.id}],
         "edges": [{"from": "o", "to": "m", "label": "Asks"}]}]}
    client.chats = [chat("Reading the team.", ("team_work", {})), chat("Drawing it.", ("show_page", {"title": "Team report", "report": report_page})),
                    live_said("Here is the report.")]
    done = await typed(agent_rig, "Make me a report on the team", 0, language="en")
    assert done["status"] == "done"
    offered = {tool["function"]["name"] for tool in client.chat_calls[0]["tools"]}
    assert {"team_work", "show_page"} <= offered
    replies = [message["content"] for call in client.chat_calls for message in call["messages"] if message["role"] == "tool"]
    assert any('"as_of"' in reply and "Mira" in reply for reply in replies)
    [card] = (await agent_rig.turns())[0]["pages"]
    assert card["kind"] == "report" and card["title"] == "Team report"

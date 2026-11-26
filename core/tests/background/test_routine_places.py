"""Routine runs take two places, behind the owner's own work, and a subscription CLI that has just refused its sign-in is not
run into again by the routines that follow (five routines due at 07:00 once started
together, and eight turns failed for an expired Claude sign-in in three days, three of them at 07:00).

Nothing here starts a CLI, signs in or reads a credential."""
import asyncio

from raphael_core.agent.cli.discovery import CliBrains
from raphael_core.agent.cli.drivers import Event
from raphael_core.agent.history import AgentHistory
from raphael_core.background import service as service_module

from .conftest import report, until
from .test_long_work import hand_over, members
from .test_room_cli import scripted_cli


def routine(rig, member, number, text="check", model="fake/model"):
    return rig.service.submit(session_id=f"routine:{number}", text=text, language="en", model=model,
                              member_id=member.id, routine_id=number)


async def test_five_routines_due_together_run_two_at_a_time_in_the_order_they_came(make_rig):
    rig = make_rig()
    crew = members(rig, 5)
    inside, peak, order = [], [0], []

    async def slow(**kwargs):
        order.append(len(order))
        inside.append(1)
        peak[0] = max(peak[0], len(inside))
        await asyncio.sleep(0.05)
        inside.pop()
        return report("done")

    rig.client.replies = [slow] * 5
    ids = [routine(rig, member, number) for number, member in enumerate(crew, 1)]
    await until(lambda: all(rig.task(i).state == "done" for i in ids), timeout=20)
    assert peak[0] == service_module.ROUTINE_PARALLEL == 2
    started = [rig.task(i).started_at_ms for i in ids]
    assert started == sorted(started), "the rest start as places free, in the order they came"


async def test_a_task_the_owner_asked_for_never_waits_behind_routines(make_rig):
    rig = make_rig()
    crew = members(rig, 6)
    release, running = asyncio.Event(), []

    async def held(**kwargs):
        running.append(1)
        await release.wait()
        return report("done")

    async def quick(**kwargs):
        return report("done")

    # Four routines are due: two work, two wait. The owner's task comes after them and still has the third place.
    rig.client.replies = [held, held, quick, quick, quick]
    routines = [routine(rig, member, number) for number, member in enumerate(crew[:4], 1)]
    await until(lambda: len(running) == 2)
    owners = hand_over(rig, crew[4])
    await until(lambda: rig.task(owners).state == "done", timeout=5)
    assert [rig.task(i).state for i in routines] == ["running", "running", "queued", "queued"]
    release.set()
    await until(lambda: all(rig.task(i).state == "done" for i in routines), timeout=20)


async def test_a_place_that_frees_goes_to_the_owners_task_before_a_waiting_routine(make_rig):
    rig = make_rig()
    crew = members(rig, 5)
    release, order = asyncio.Event(), []

    async def held(**kwargs):
        order.append("held")
        await release.wait()
        return report("done")

    async def quick(**kwargs):
        return report("done")

    rig.client.replies = [held, held, held, quick, quick]
    first, second = routine(rig, crew[0], 1), routine(rig, crew[1], 2)
    third = hand_over(rig, crew[2])  # the owner's, holding the third place
    waiting = routine(rig, crew[3], 3)
    later = hand_over(rig, crew[4])  # the owner's, queued after the routine
    await until(lambda: len(order) == 3)
    assert rig.task(waiting).state == rig.task(later).state == "queued"
    release.set()
    await until(lambda: all(rig.task(i).state == "done" for i in (first, second, third, waiting, later)), timeout=20)
    assert rig.task(later).started_at_ms <= rig.task(waiting).started_at_ms


# --- a CLI that refused its sign-in ----------------------------------------------------------------------------------


def claude_brains(tmp_path):
    """The real discovery of the CLIs on a home with a credential file (empty: never read) and a command that never runs."""
    (tmp_path / ".claude").mkdir()
    (tmp_path / ".claude" / ".credentials.json").write_text("{}")
    return CliBrains(home=tmp_path, environ={}, commands={"claude": ["never-spawn-real-CLI"]})


def with_turn(rig, task, text="Morning check", member_id=0):
    turn = AgentHistory(rig.conn).add(session_id=f"routine:{task}", question=text, route="routine", prefix="", text="",
                                     status="running", source="routine", member_id=member_id)
    rig.service.attach_turn(task, turn)
    return turn


EXPIRED = [Event("error", "auth_expired", {"kind": "auth_expired", "reason": "401 PRIVATE", "cause": "expired"})]


async def test_routines_after_a_refused_sign_in_are_not_run_into_it_and_say_the_cause_once(make_rig, monkeypatch, tmp_path):
    monkeypatch.setattr(service_module, "ROUTINE_CLI_GAP_S", 0.6)
    rig = make_rig()
    rig.service.use_cli(claude_brains(tmp_path))
    played = scripted_cli(monkeypatch, EXPIRED)
    crew = members(rig, 3)
    ids = [routine(rig, member, number, model="cli:claude") for number, member in enumerate(crew, 1)]
    turns = [with_turn(rig, task) for task in ids]
    await until(lambda: all(rig.task(i).state == "failed" for i in ids))
    assert len(played) == 1, "the CLI was started for the first run only"
    assert [rig.task(i).reason for i in ids] == ["cli_login_expired", "cli_login_skipped", "cli_login_skipped"]
    assert {rig.task(i).report_text for i in ids} == {"Claude Code's sign-in has expired."}
    history = AgentHistory(rig.conn)
    for turn in turns:
        failure = history.get(turn).failure
        assert (failure["kind"], failure["provider"], failure["cause"]) == ("auth_expired", "cli:claude", "expired")
        assert "PRIVATE" not in str(failure) and "PRIVATE" not in history.get(turn).text


async def test_the_next_routine_asks_the_cli_again_once_a_sign_in_is_back(make_rig, monkeypatch, tmp_path):
    monkeypatch.setattr(service_module, "ROUTINE_CLI_GAP_S", 0.0)
    rig = make_rig()
    brains = claude_brains(tmp_path)
    rig.service.use_cli(brains)
    played = scripted_cli(monkeypatch, EXPIRED, [Event("final", "The weather is clear.")])
    first, second = members(rig, 2)
    one = routine(rig, first, 1, model="cli:claude")
    await until(lambda: rig.task(one).state == "failed")
    assert brains.sign_in_missing("claude") == "expired"
    skipped = routine(rig, second, 2, model="cli:claude")
    await until(lambda: rig.task(skipped).state == "failed")
    assert rig.task(skipped).reason == "cli_login_skipped" and len(played) == 1
    # The owner signs in (anywhere: the credential file moves), and the next routine asks the CLI again.
    credentials = tmp_path / ".claude" / ".credentials.json"
    credentials.write_text('{"again": true}')
    import os
    os.utime(credentials, ns=(credentials.stat().st_atime_ns, credentials.stat().st_mtime_ns + 5_000_000_000))
    again = routine(rig, second, 3, model="cli:claude")
    await until(lambda: rig.task(again).state == "done")
    assert len(played) == 2 and brains.sign_in_missing("claude") is None


async def test_owner_chat_is_never_refused_by_the_routine_gate(make_rig, monkeypatch, tmp_path):
    """The gate belongs to routine runs: a task the owner handed over still asks the CLI, whatever it refused before."""
    monkeypatch.setattr(service_module, "ROUTINE_CLI_GAP_S", 0.0)
    rig = make_rig()
    brains = claude_brains(tmp_path)
    rig.service.use_cli(brains)
    played = scripted_cli(monkeypatch, EXPIRED, [Event("final", "Here you are.")])
    first, second = members(rig, 2)
    one = routine(rig, first, 1, model="cli:claude")
    await until(lambda: rig.task(one).state == "failed")
    owners = rig.service.submit(session_id="s2", text="work", language="en", model="cli:claude", member_id=second.id)
    await until(lambda: rig.task(owners).state in ("done", "failed"))
    assert rig.task(owners).state == "done" and len(played) == 2
    assert brains.sign_in_missing("claude") is None, "a run that was answered says the sign-in stands"


# --- the failures a sign-in left, once it is back (R-CLI-SIGNIN-06) ----------------------------------------------------

DONE = [Event("final", "Checked.")]
DAY_MS = 24 * 3600 * 1000


def cli_members(rig, count):
    from raphael_core.agent.speaker import Speaker
    from raphael_core.members.store import MemberStore
    from .test_handoff import team_of, unused
    store = MemberStore(rig.conn)  # a rerun starts a turn in the member's own conversation, so the member exists
    crew = []
    for n in range(count):
        member = store.create_member(name=f"Member{n}", role="Checker")
        crew.append(Speaker(id=member.id, name=member.name, model="cli:claude", tools=frozenset()))
    rig.service.use_team(team_of(*crew), unused)
    return crew


def owner_task(rig, member, text="work"):
    task = rig.service.submit(session_id=f"s{member.id}", text=text, language="en", model="cli:claude", member_id=member.id)
    turn = AgentHistory(rig.conn).add(session_id=f"s{member.id}", question=text, route="delegate", prefix="", text="", status="running",
                                      member_id=member.id)
    rig.service.attach_turn(task, turn)
    return task, turn


def room_task(rig):
    """A room's reply on the CLI, as test_room_cli makes one, without taking the CLI brains over."""
    with rig.conn:
        room = rig.conn.execute("INSERT INTO rooms(name,created) VALUES ('Room',1)").lastrowid
    thread = rig.conn.execute("SELECT id FROM room_threads WHERE room_id=?", (room,)).fetchone()[0]
    turn = AgentHistory(rig.conn).add(session_id="room:1:1:0", question="Plan", route="room", prefix="", text="", status="running",
                                      source="room", scope="room", room_id=room, thread_id=thread)
    task = rig.service.submit(session_id="room:1:1:0", text="Plan", language="en", model="cli:claude")
    rig.service.attach_turn(task, turn)
    return task, turn


def reruns(rig):
    return {row[0]: row[1] for row in rig.conn.execute("SELECT rerun_of, id FROM worker_tasks WHERE rerun_of IS NOT NULL")}


async def cleaned(rig):
    await asyncio.gather(*list(rig.service._cleanups))


async def refused_runs(rig, monkeypatch, tmp_path):
    """Failed runs of the Claude CLI's sign-in as they stand when it is back: an old routine run and an old owner task (3 days),
    then a newer run of the same routine, another routine's run and an owner task (now), and a room's reply; plus a question the
    owner was asked, which has no task. Returns the brains, each run as (task, turn), and the CLI's runs played."""
    from .conftest import NOW_MS
    brains = claude_brains(tmp_path)
    rig.service.use_cli(brains)
    played = scripted_cli(monkeypatch, EXPIRED, EXPIRED, EXPIRED, EXPIRED, DONE)
    first, second, third = cli_members(rig, 3)
    found = {}
    rig.wall.now = NOW_MS - 3 * DAY_MS
    task = routine(rig, first, 1, model="cli:claude")
    found["old_routine"] = (task, with_turn(rig, task, member_id=first.id))
    await until(lambda: rig.task(task).state == "failed")
    found["old_owner"] = owner_task(rig, third)
    await until(lambda: rig.task(found["old_owner"][0]).state == "failed")
    rig.wall.now = NOW_MS
    task = routine(rig, first, 1, model="cli:claude")  # the gate ends it unstarted
    found["routine"] = (task, with_turn(rig, task, member_id=first.id))
    task = routine(rig, second, 2, model="cli:claude")
    found["other"] = (task, with_turn(rig, task, member_id=second.id))
    found["owner"] = owner_task(rig, third)
    await until(lambda: all(rig.task(found[key][0]).state == "failed" for key in ("routine", "other", "owner")))
    found["room"] = room_task(rig)
    await until(lambda: rig.task(found["room"][0]).state == "failed")
    assert len(played) == 4 and brains.sign_in_cause("claude") == "expired"
    assert {rig.task(found[key][0]).reason for key in found} <= {"cli_login_expired", "cli_login_skipped"}
    found["question"] = (None, AgentHistory(rig.conn).add(
        session_id="q", question="Mail?", route="question", prefix="", text="Sign in again.", status="error",
        failure={"kind": "auth_expired", "provider": "cli:claude", "cause": "expired"}))
    return brains, found, played


async def test_a_sign_in_that_is_back_runs_a_routines_newest_failed_run_again_and_takes_every_failed_turn_out_of_the_history(
        make_rig, monkeypatch, tmp_path):
    rig = make_rig()
    brains, found, played = await refused_runs(rig, monkeypatch, tmp_path)
    history = AgentHistory(rig.conn)
    gone = ("old_routine", "old_owner", "routine", "other", "owner")
    members_of = {key: rig.task(found[key][0]).member_id for key in gone}
    brains.sign_in_back("claude")  # a run of it was answered
    await cleaned(rig)
    assert all(history.get(found[key][1]) is None for key in gone), "every failed run's turn left the history"
    assert history.get(found["room"][1]) is not None, "a room's turn is the room's"
    assert history.get(found["question"][1]) is not None, "a question the owner was asked has no task and stays"
    assert set(reruns(rig)) == {found[key][0] for key in ("routine", "other", "owner")}, "the newest run of a routine, and the owner's task of today"
    for new in reruns(rig).values():
        await until(lambda: rig.task(new).state == "done")
        assert history.get(rig.task(new).turn_id) is not None
    assert rig.task(reruns(rig)[found["routine"][0]]).routine_id == 1 and len(played) == 7
    for key in gone:
        assert ("agent.turn", {"turn_id": found[key][1], "member_id": members_of[key], "failure": None}) in rig.notifications
    # Told again, nothing is run twice.
    brains._came_back("claude", always=True)
    await cleaned(rig)
    assert len(reruns(rig)) == 3 and len(played) == 7


async def test_a_credential_change_seen_while_the_sign_in_is_lost_cleans_up_the_same_way(make_rig, monkeypatch, tmp_path):
    import os
    rig = make_rig()
    brains, found, _ = await refused_runs(rig, monkeypatch, tmp_path)
    credentials = tmp_path / ".claude" / ".credentials.json"
    os.utime(credentials, ns=(credentials.stat().st_atime_ns, credentials.stat().st_mtime_ns + 5_000_000_000))
    await brains.check_lost()
    await cleaned(rig)
    history = AgentHistory(rig.conn)
    assert history.get(found["routine"][1]) is None and history.get(found["old_routine"][1]) is None
    assert set(reruns(rig)) == {found[key][0] for key in ("routine", "other", "owner")}
    assert history.get(found["room"][1]) is not None and brains.sign_in_cause("claude") is None


async def test_a_sign_in_finished_in_the_console_cleans_up_although_no_record_is_held(make_rig, monkeypatch, tmp_path):
    rig = make_rig()
    brains, found, _ = await refused_runs(rig, monkeypatch, tmp_path)
    brains._lost.clear()  # the process was restarted since: nothing remembers the refusal
    assert brains.sign_in_cause("claude") is None
    brains._came_back("claude", always=True)  # what a sign-in that finished `done` in the app's console says
    await cleaned(rig)
    history = AgentHistory(rig.conn)
    assert all(history.get(found[key][1]) is None for key in ("old_routine", "old_owner", "routine", "other", "owner"))
    assert len(reruns(rig)) == 3


async def test_the_clean_up_after_a_rerun_never_clears_the_error_of_a_newer_refused_run(make_rig, conn):
    """The rerun deletes the old run's row; the sign-in recovery then removes the old turn it had collected, and with no row the
    old run looked like the routine's latest, so the newer refused run's error (the same words) was wiped."""
    from .conftest import report
    rig = make_rig()
    history = AgentHistory(rig.conn)
    with conn:
        conn.execute("INSERT INTO routines(member_id,title,prompt,schedule,created_at_ms) VALUES (0,'Inbox','Look','{}',0)")
    routine_id = conn.execute("SELECT MAX(id) FROM routines").fetchone()[0]
    failure = {"kind": "auth_expired", "provider": "cli:claude", "cause": "expired"}
    words = "Claude Code's sign-in has expired."
    rig.service._closing = True
    first = history.add(session_id=f"routine:{routine_id}", question="Inbox", route="routine", prefix="", text=words, status="error",
                        source="routine", failure=failure)
    task = rig.service.submit(session_id=f"routine:{routine_id}", text="Look", language="en", model="cli:claude", routine_id=routine_id)
    rig.service.attach_turn(task, first)
    rig.service._queue.clear()
    rig.service._closing = False
    rig.service._store.finish(task, "failed", prefix="", text=words, detail=None, reason="cli_login_expired")
    newer = history.add(session_id=f"routine:{routine_id}", question="Inbox", route="routine", prefix="", text=words, status="error", source="routine")
    with conn:
        conn.execute("INSERT INTO routine_runs(routine_id,started,status,turn_id,trigger_json) VALUES (?,?,'error',?,'{}')", (routine_id, 1, first))
        conn.execute("INSERT INTO routine_runs(routine_id,started,status,turn_id,trigger_json) VALUES (?,?,'error',?,'{}')", (routine_id, 2, newer))
        conn.execute("UPDATE routines SET last_error=? WHERE id=?", (words, routine_id))
    rig.client.replies = [report("Done.")]
    await rig.service._clean_sign_in_failures("claude")
    assert history.get(first) is None and history.get(newer) is not None
    assert conn.execute("SELECT last_error FROM routines WHERE id=?", (routine_id,)).fetchone()[0] == words


async def test_a_routine_that_has_run_well_since_is_not_run_again_and_its_failure_still_leaves(make_rig, monkeypatch, tmp_path):
    rig = make_rig()
    brains = claude_brains(tmp_path)
    rig.service.use_cli(brains)
    played = scripted_cli(monkeypatch, EXPIRED, DONE)
    member, = cli_members(rig, 1)
    failed = routine(rig, member, 7, model="cli:claude")
    failed_turn = with_turn(rig, failed, member_id=member.id)
    await until(lambda: rig.task(failed).state == "failed")
    brains._lost.clear()
    well = routine(rig, member, 7, model="cli:claude")
    well_turn = with_turn(rig, well, member_id=member.id)
    await until(lambda: rig.task(well).state == "done")
    brains._came_back("claude", always=True)
    await cleaned(rig)
    history = AgentHistory(rig.conn)
    assert reruns(rig) == {} and len(played) == 2
    assert history.get(failed_turn) is None and history.get(well_turn) is not None


async def test_a_cli_whose_sign_in_is_back_leaves_the_failures_of_another_cli_alone(make_rig, monkeypatch, tmp_path):
    rig = make_rig()
    brains = claude_brains(tmp_path)
    rig.service.use_cli(brains)
    scripted_cli(monkeypatch, EXPIRED)
    member, = cli_members(rig, 1)
    failed = routine(rig, member, 7, model="cli:claude")
    failed_turn = with_turn(rig, failed, member_id=member.id)
    await until(lambda: rig.task(failed).state == "failed")
    brains.sign_in_lost("codex", "expired")
    brains.sign_in_back("codex")
    await cleaned(rig)
    assert AgentHistory(rig.conn).get(failed_turn) is not None and reruns(rig) == {}

"""Routine runs take two places, behind the owner's own work, and a subscription CLI that has just refused its sign-in is not
run into again by the routines that follow (owner's real use, 2026-11-01 to 2026-11-14: five routines due at 07:00 started
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


def with_turn(rig, task, text="Morning check"):
    turn = AgentHistory(rig.conn).add(session_id=f"routine:{task}", question=text, route="routine", prefix="", text="",
                                     status="running", source="routine")
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

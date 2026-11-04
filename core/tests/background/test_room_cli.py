"""Room CLI turns use the same background task, tool gate and approval lifecycle."""
import asyncio
import json
import pytest

from raphael_core.agent.cli.drivers import Event
from raphael_core.agent.cli.loop import CliLoop
from raphael_core.agent.history import AgentHistory
from raphael_core.background.run import RunLimits
from raphael_core.worker.loop import Outcome
from .conftest import Clock, until


def submit_room(rig):
    history = AgentHistory(rig.conn)
    with rig.conn:
        room = rig.conn.execute("INSERT INTO rooms(name,created) VALUES ('Room',1)").lastrowid
    thread = rig.conn.execute("SELECT id FROM room_threads WHERE room_id=?",(room,)).fetchone()[0]
    turn = history.add(session_id="room:1:1:0", question="Plan", route="room", prefix="",
                       text="", status="running", source="room", scope="room", room_id=room, thread_id=thread)
    rig.service.use_cli(object())
    task = rig.service.submit(session_id="room:1:1:0", text="Plan", language="en", model="cli:codex:gpt-5.6-terra")
    rig.service.attach_turn(task, turn)
    return task, turn


@pytest.mark.parametrize("room", [True, False], ids=["room", "background"])
async def test_cli_envelopes_are_unwrapped_before_room_or_background_storage(make_rig, monkeypatch, room):
    rig = make_rig()
    async def work(loop):
        loop._queue.put_nowait(Outcome("done", final=json.dumps({"text": "The plan is ready.", "messages": ["The plan is ready."]})))
    monkeypatch.setattr(CliLoop, "_work", work)
    if room:
        task, turn = submit_room(rig)
    else:
        rig.service.use_cli(object())
        task = rig.service.submit(session_id="background-envelope", text="Plan", language="en", model="cli:codex:test")
        turn = None
    await until(lambda: rig.task(task).state in ("done", "failed"))
    assert rig.task(task).state == "done"
    assert rig.task(task).report_text == "The plan is ready."
    if turn:
        assert AgentHistory(rig.conn).get(turn).text == "The plan is ready."


async def test_cli_room_turn_uses_shared_tools_and_keeps_private_sessions_separate(make_rig, monkeypatch):
    rig = make_rig()
    async def work(loop):
        assert loop.sessions.get(0, loop.model) is None
        assert loop.conversation_id.startswith("room-task-")
        assert not (await loop._tool("permission", "cli_permission", {"tool_name":"Bash"})).ok
        result = await loop._tool("time", "local_time", {})
        assert not result.ok and "handoff" in result.content
        loop._queue.put_nowait(Outcome("done", final="The plan is ready."))
    monkeypatch.setattr(CliLoop, "_work", work)
    task, turn = submit_room(rig)
    await until(lambda: rig.task(task).state == "done")
    assert AgentHistory(rig.conn).get(turn).text == "The plan is ready."
    assert rig.task(task).tool_calls == 1
    assert rig.client.chat_calls == [] and rig.reports() == []


async def test_cli_speech_never_opens_an_approval_or_calls_a_plugin(make_rig, monkeypatch, calls):
    rig = make_rig()
    await rig.plugins.connect(look='T2')
    async def work(loop):
        result = await loop._tool('lookup','Notes__look',{'topic':'plan'})
        assert not result.ok and 'handoff' in result.content
        loop._queue.put_nowait(Outcome('done',final='I will start private work.'))
    monkeypatch.setattr(CliLoop,'_work',work)
    task,turn = submit_room(rig)
    await until(lambda:rig.task(task).state=='done')
    assert not calls and not rig.service.waiting_questions()
    assert AgentHistory(rig.conn).get(turn).status=='done'


async def test_cli_room_timeout_and_cancel_are_worker_terminal_states(make_rig, monkeypatch):
    rig = make_rig(limits=RunLimits(seconds=.05))
    async def work(loop):
        await asyncio.Event().wait()
    monkeypatch.setattr(CliLoop, "_work", work)
    task, _ = submit_room(rig)
    await until(lambda: rig.task(task).state == "limit")
    assert not rig.service._cli_loops
    task, _ = submit_room(rig)
    await until(lambda: rig.task(task).state == "running")
    await rig.service._cancel({"task_id":task})
    await until(lambda: rig.task(task).state == "cancelled")
    assert not rig.service._cli_loops


class Brains:
    def __init__(self, home):
        self.home, self.environ = home, {}

    def command(self, name):
        return ["never-spawn-real-CLI"]

    def available(self, name, *, command=None):
        return True


async def test_private_member_task_uses_its_cli_brain_without_api_fallback(make_rig, monkeypatch, tmp_path):
    from raphael_core.members.service import MembersService
    rig = make_rig()
    team = MembersService(rig.conn, tmp_path, background=rig.service)
    member = team.store.create_member(name="Alice", model="cli:codex")
    rig.service._team = team
    rig.service.use_cli(Brains(tmp_path))
    played = scripted_cli(monkeypatch, [Event("final", "Private task finished on Codex.")])
    task = rig.service.submit(session_id="private-member", text="Review", language="en", model="api/global", member_id=member.id)
    await until(lambda: rig.task(task).state in ("done", "failed"))
    assert rig.task(task).state == "done"
    assert played and rig.task(task).report_text == "Private task finished on Codex."
    assert rig.client.chat_calls == []
    await team.aclose()


def scripted_cli(monkeypatch, *runs, waits=(0.0, 0.0)):
    """Each CLI run plays the next list of events (the last one repeats); returns the runs made."""
    played = []
    class Driver:
        def __init__(self, *args, **kwargs):
            pass
        async def run(self, **kwargs):
            played.append(kwargs)
            for event in runs[min(len(played), len(runs)) - 1]:
                yield event
        async def interrupt(self):
            pass
    monkeypatch.setattr("raphael_core.agent.cli.loop.Driver", Driver)
    monkeypatch.setattr("raphael_core.agent.cli.loop.RATE_LIMIT_WAITS_S", waits)
    monkeypatch.setattr("raphael_core.agent.cli.loop.ROOM_RATE_LIMIT_WAITS_S", waits)
    monkeypatch.setattr("raphael_core.agent.cli.loop.PATIENT_WAITS", (0.0, 0.0))
    return played


def progress(rig, task):
    return [params["text"] for method, params in rig.notifications if method == "worker.progress" and params["task_id"] == task]


async def test_cli_room_turn_waits_out_one_rate_limit_and_answers(make_rig, monkeypatch, tmp_path):
    rig = make_rig()
    played = scripted_cli(monkeypatch, [Event("error", "rate_limited")], [Event("final", "The plan is ready.")])
    task, turn = submit_room(rig)
    rig.service.use_cli(Brains(tmp_path))
    await until(lambda: rig.task(task).state in ("done", "failed"))
    assert rig.task(task).state == "done" and AgentHistory(rig.conn).get(turn).text == "The plan is ready."
    assert len(played) == 2 and progress(rig, task) == ["Codex CLI is rate-limited; retrying in 0 s."]


async def test_cli_room_turn_rides_out_a_longer_throttle_than_a_private_turn(make_rig, monkeypatch, tmp_path):
    # Live, Codex 429s lasted minutes: a room turn, which no one sits waiting on, keeps trying for longer.
    rig = make_rig()
    played = scripted_cli(monkeypatch, [Event("error", "rate_limited")])
    monkeypatch.setattr("raphael_core.agent.cli.loop.RATE_LIMIT_WAITS_S", (0.0,))
    monkeypatch.setattr("raphael_core.agent.cli.loop.ROOM_RATE_LIMIT_WAITS_S", (0.0, 0.0, 0.0, 0.0))
    task, turn = submit_room(rig)
    rig.service.use_cli(Brains(tmp_path))
    await until(lambda: rig.task(task).state in ("done", "failed"))
    assert rig.task(task).reason == "cli_rate_limited" and len(played) == 5


@pytest.mark.parametrize("first", [[], [Event("tool_start", data={"name": "local_time"})]])
async def test_cli_room_turn_reports_a_rate_limit_it_cannot_wait_out(make_rig, monkeypatch, tmp_path, first):
    rig = make_rig()
    played = scripted_cli(monkeypatch, [*first, Event("error", "rate_limited")])
    task, turn = submit_room(rig)
    rig.service.use_cli(Brains(tmp_path))
    await until(lambda: rig.task(task).state in ("done", "failed"))
    failed = rig.task(task)
    assert (failed.state, failed.reason) == ("failed", "cli_rate_limited")
    assert failed.report_text.startswith("Codex CLI is receiving too many requests right now. Try again shortly.")
    if first:
        assert "unconfirmed" in failed.report_text and "not completed" in failed.report_text
    assert AgentHistory(rig.conn).get(turn).status == "error"
    assert len(played) == (5 if first else 3)


@pytest.mark.parametrize("failure", ["overloaded", "exit"])
async def test_background_cli_recovers_from_receipt_without_reopening_card(make_rig, monkeypatch, tmp_path, calls, failure):
    from members.test_cli_brains import recovering_mcp
    rig = make_rig()
    await rig.plugins.connect(look="T2")
    monkeypatch.setattr("raphael_core.agent.cli.loop.ROOM_RATE_LIMIT_WAITS_S", (0.0,))
    record = recovering_mcp(rig, tmp_path, [("Notes__look", {"topic": "draft"})], failure=failure)
    task = rig.submit("Review the draft", model="cli:claude")
    turn = AgentHistory(rig.conn).add(session_id="s1", question="Review the draft", route="answer",
                                     prefix="", text="", status="running", source="app")
    rig.service.attach_turn(task, turn)
    await until(lambda: rig.task(task).state == "waiting")
    [question] = rig.service.waiting_questions()
    assert not calls
    assert rig.service.answer(task, question["id"], True) == "approved"
    await rig.wait_for_reports()
    assert rig.task(task).state == "done" and rig.task(task).report_text == "The remaining work is finished."
    assert calls == ["look"] and not rig.service.waiting_questions()
    first, resumed = [json.loads(line) for line in record.read_text(encoding="utf-8").splitlines()]
    assert not first["resumed"] and resumed["resumed"]
    assert "found draft" in resumed["user"]
    assert any("try again" in line for line in progress(rig, task))
    assert not rig.client.chat_calls
    await until(lambda: not rig.service._cli_loops)


async def test_stopping_a_room_turn_while_it_waits_out_a_rate_limit_cancels_it(make_rig, monkeypatch, tmp_path):
    rig = make_rig()
    played = scripted_cli(monkeypatch, [Event("error", "rate_limited")], waits=(30.0, 60.0))
    task, _ = submit_room(rig)
    rig.service.use_cli(Brains(tmp_path))
    await until(lambda: progress(rig, task))
    await rig.service._cancel({"task_id": task})
    await until(lambda: rig.task(task).state == "cancelled")
    assert len(played) == 1 and not rig.service._cli_loops


async def test_cli_speech_rejects_native_permission_even_with_full_permission(make_rig,monkeypatch):
    rig=make_rig()
    from raphael_core.brain.settings import SettingsStore
    SettingsStore(rig.conn).set('action_mode', 'bypass')
    async def work(loop):
        result=await loop._tool('native','cli_permission',{'tool_name':'Bash'})
        assert not result.ok and result.kind=='room_speech_only'
        loop._queue.put_nowait(Outcome('done',final='Speech only.'))
    monkeypatch.setattr(CliLoop,'_work',work)
    task,_=submit_room(rig)
    await until(lambda:rig.task(task).state=='done')
    assert not rig.service.waiting_questions()

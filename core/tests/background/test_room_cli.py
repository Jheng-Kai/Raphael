"""Room CLI turns use the same background task, tool gate and approval lifecycle."""
import asyncio
import json
import os
import sys
import httpx
import pytest

from raphael_core.agent.cli.drivers import Event
from raphael_core.agent.cli.loop import CliLoop
from raphael_core.agent.history import AgentHistory
from raphael_core.background.run import RunLimits
from raphael_core.worker.loop import Outcome
from .conftest import Clock, until
from .test_room_meeting import meeting  # noqa: F401


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
async def test_written_cli_envelopes_stay_literal_in_room_or_background_storage(make_rig, monkeypatch, room):
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
    expected = json.dumps({"text": "The plan is ready.", "messages": ["The plan is ready."]})
    assert rig.task(task).report_text == expected
    if turn:
        assert AgentHistory(rig.conn).get(turn).text == expected


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


async def test_cli_failure_keeps_diagnostics_in_background_turn_detail(make_rig, monkeypatch):
    from raphael_core.failures import classify
    rig = make_rig()
    async def work(loop):
        loop.failure = "cli_stopped"
        loop.failure_reason = classify({"kind":"cli_stopped", "message":"CLI process ended before completion", "detail":"original error\nlast background diagnostic"})
        loop._failure(loop.failure, "Codex CLI")
    monkeypatch.setattr(CliLoop, "_work", work)
    task, turn = submit_room(rig)
    await until(lambda: rig.task(task).state == "failed")
    saved = AgentHistory(rig.conn).get(turn)
    assert saved.status == "error" and saved.text == "Codex CLI stopped before finishing its answer."
    assert saved.detail == "original error\nlast background diagnostic"
    assert rig.task(task).reason == "cli_cli_stopped"


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


@pytest.mark.parametrize('brain', ['claude', 'codex', 'gemini'])
async def test_room_cli_board_and_permission_callback_share_the_actual_mcp_surface(meeting, monkeypatch, tmp_path, brain):
    rig, members, rooms, room, alice = meeting
    members.store.update_member(alice.id, model='cli:' + brain)
    rig.service.use_cli(Brains(tmp_path))
    observations = []

    class Driver:
        def __init__(self, *args, **kwargs):
            pass

        async def run(self, *, endpoint, token, permission, **kwargs):
            async with httpx.AsyncClient(headers={'Authorization': 'Bearer ' + token}) as http:
                async def rpc(method, **params):
                    response = await http.post(endpoint, json={'jsonrpc': '2.0', 'id': len(observations) + 1,
                        'method': method, 'params': params})
                    return response.json()
                listing = await rpc('tools/list')
                names = {item['name'] for item in listing['result']['tools']}
                assert names == {'handoff', 'room_post', 'ask_member', 'work_status', *({'approve'} if brain == 'claude' else set())}
                if brain == 'claude':
                    allowed = await rpc('tools/call', name='approve', arguments={'tool_name': 'mcp__raphael__work_status', 'input': {}})
                    assert not allowed['result']['isError']
                    assert json.loads(allowed['result']['content'][0]['text'])['behavior'] == 'allow'
                board = await rpc('tools/call', name='work_status', arguments={})
                assert not board['result']['isError'] and 'board' in board['result']['content'][0]['text']
                assert not rig.service.waiting_questions()
                if brain == 'claude':
                    for name in ('Bash', 'mcp__raphael__not_offered', 'mcp__raphael__approve'):
                        denied = await rpc('tools/call', name='approve', arguments={'tool_name': name, 'input': {'command': 'echo synthetic'}})
                        assert not denied['result']['isError']
                        decision = json.loads(denied['result']['content'][0]['text'])
                        assert decision['behavior'] == 'deny' and decision['message']
                else:
                    assert await permission({'tool_name': 'Bash', 'input': {'command': 'echo synthetic'}}) == 'deny'
                observations.append(board)
            yield Event('final', 'The board is readable; work stays private.')

        async def interrupt(self):
            pass

    monkeypatch.setattr('raphael_core.agent.cli.loop.Driver', Driver)
    await rooms._send({'room_id': room['id'], 'text': '@Alice read the board', 'request_id': 'cli-approve-' + brain, 'ui_language': 'en'})
    await until(lambda: rooms._exchanges.latest(room['id'])['state'] == 'done')
    assert observations and not rig.service.waiting_questions()
    assert not rig.conn.execute("SELECT 1 FROM worker_tasks WHERE mode='work'").fetchone()
    assert not rig.client.chat_calls
    messages = (await rooms._messages({'room_id': room['id']}))['messages']
    assert any(message['text'] == 'The board is readable; work stays private.' for message in messages)


@pytest.mark.parametrize('approved', [True, False])
async def test_background_claude_mcp_permission_still_uses_the_tool_owner_card(make_rig, monkeypatch, tmp_path, calls, approved):
    rig = make_rig()
    await rig.plugins.connect(look='T2')
    rig.service.use_cli(Brains(tmp_path))
    decisions = []

    class Driver:
        def __init__(self, *args, **kwargs):
            pass

        async def run(self, *, endpoint, token, **kwargs):
            async with httpx.AsyncClient(headers={'Authorization': 'Bearer ' + token}) as http:
                async def call(name, arguments):
                    response = await http.post(endpoint, json={'jsonrpc': '2.0', 'id': name,
                        'method': 'tools/call', 'params': {'name': name, 'arguments': arguments}})
                    return response.json()['result']
                result = await call('approve', {'tool_name': 'mcp__raphael__Notes__look', 'input': {'topic': 'draft'}})
                assert not result['isError'] and json.loads(result['content'][0]['text'])['behavior'] == 'allow'
                assert not rig.service.waiting_questions() and not calls
                result = await call('Notes__look', {'topic': 'draft'})
                assert result['isError'] is not approved
                decisions.append(result)
            yield Event('final', 'The owner decision was respected.')

        async def interrupt(self):
            pass

    monkeypatch.setattr('raphael_core.agent.cli.loop.Driver', Driver)
    task = rig.submit('Review the draft', model='cli:claude')
    await until(lambda: rig.task(task).state in ('waiting', 'failed'))
    assert rig.task(task).state == 'waiting' and not calls
    [question] = rig.service.waiting_questions()
    assert rig.service.answer(task, question['id'], approved) == ('approved' if approved else 'denied')
    await rig.wait_for_reports()
    assert rig.task(task).state == 'done' and decisions
    assert calls == (['look'] if approved else [])


async def test_claude_room_child_uses_the_mounted_permission_prompt_tool(meeting, tmp_path, monkeypatch):
    from raphael_core.agent.cli.drivers import Driver as ProductionDriver
    errors = []
    original = ProductionDriver._event
    def observed(driver, kind, value):
        event = original(driver, kind, value)
        if kind == 'error':
            errors.append(event.data)
        return event
    monkeypatch.setattr(ProductionDriver, '_event', observed)
    rig, members, rooms, room, alice = meeting
    members.store.update_member(alice.id, model='cli:claude')
    script = tmp_path / 'room_claude.py'
    script.write_text('''import http.client, json, sys, urllib.parse
args = sys.argv
assert args[args.index('--permission-prompt-tool') + 1] == 'mcp__raphael__approve'
with open(args[args.index('--mcp-config') + 1], encoding='utf-8') as stream:
    config = json.load(stream)['mcpServers']['raphael']
json.loads(sys.stdin.readline())
def rpc(method, **params):
    body = json.dumps({'jsonrpc':'2.0', 'id':1, 'method':method, 'params':params}).encode()
    url = urllib.parse.urlsplit(config['url'])
    connection = http.client.HTTPConnection(url.hostname, url.port, timeout=5)
    try:
        connection.request('POST', url.path, body=body, headers={**config['headers'], 'Content-Type':'application/json'})
        return json.loads(connection.getresponse().read())
    finally:
        connection.close()
assert 'approve' in {tool['name'] for tool in rpc('tools/list')['result']['tools']}
def approve(name):
    result = rpc('tools/call', name='approve', arguments={'tool_name':name, 'input':{}})['result']
    assert not result['isError']
    return json.loads(result['content'][0]['text'])
assert approve('mcp__raphael__work_status')['behavior'] == 'allow'
board = rpc('tools/call', name='work_status', arguments={})['result']
assert not board['isError'] and 'board' in board['content'][0]['text']
assert approve('Bash')['behavior'] == 'deny'
print(json.dumps({'type':'result', 'subtype':'success', 'session_id':'synthetic-room', 'result':'The real child read the board.'}), flush=True)
''', encoding='utf-8')

    class FakeBrains(Brains):
        def __init__(self, home):
            super().__init__(home)
            # Windows socket/SSL providers need SystemRoot even in a credential-free child environment.
            self.environ = {'SystemRoot': os.environ.get('SystemRoot', 'C:\\Windows'), 'PYTHONIOENCODING': 'utf-8'}

        def command(self, name):
            assert name == 'claude'
            return [sys.executable, str(script)]

    rig.service.use_cli(FakeBrains(tmp_path))
    await rooms._send({'room_id': room['id'], 'text': '@Alice read the board', 'request_id': 'real-child-approve', 'ui_language': 'en'})
    await until(lambda: errors or rooms._exchanges.latest(room['id'])['state'] == 'done')
    assert not errors, errors
    messages = (await rooms._messages({'room_id': room['id']}))['messages']
    assert any(message['text'] == 'The real child read the board.' for message in messages)
    assert not rig.service.waiting_questions() and not rig.client.chat_calls

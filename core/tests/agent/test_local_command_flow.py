"""A command on the owner's PC (a quick question's alone, R-PC-01) is visible, bounded and quietly cancellable."""

import asyncio
import json

import pytest

from raphael_core.agent.gate import ToolGate
from raphael_core.agent.permissions import PermissionCards
from raphael_core.agent.policy import Tier
from raphael_core.agent.cli.loop import CliLoop
from raphael_core.services.attachment_store import AttachmentStore
from raphael_core.worker.loop import Outcome
from .test_local_commands import local_hub
from .test_narration import chat, typed
from .test_service import make_rig  # noqa: F401


COMMAND = "Get-Process | Select-Object -First 3\nWrite-Output 'synthetic'"


def rig_with_command(make_rig, conn):
    hub, host = local_hub(conn)
    hub.settings.set('local_commands_seen', True)
    rig = make_rig(plugins=hub, gate=ToolGate(hub, conn=conn), permissions=PermissionCards(conn))
    return rig, hub, host


async def test_a_cli_native_command_request_is_refused_in_an_ordinary_turn(make_rig, conn, tmp_path):
    from members.test_cli_brains import fake_mcp
    rig, hub, host = rig_with_command(make_rig, conn)
    rig.settings.set('agent_model', 'cli:claude')
    fake_mcp(rig, tmp_path, [('approve', {'tool_name': 'Bash', 'input': {'command': COMMAND}, 'reason': 'Inspect synthetic processes'})], allowed=False)
    result = await typed(rig, 'Inspect synthetic processes')
    assert result['status'] == 'done'
    host.execute.assert_not_awaited()


def quick_ask(rig, text='Inspect synthetic processes'):
    # As a question typed in the quick conversation asks (the overlay's spoken one reaches the same turn).
    return rig.call('agent.ask', {'session_id': 'live', 'text': text, 'ui_language': 'en', 'source': 'app', 'member_id': 0,
                                  'destination': 'quick', 'conversation_id': rig.service.conversations.quick()})


@pytest.mark.parametrize('brain', ['api', 'claude', 'codex', 'gemini'])
@pytest.mark.parametrize('cancel', [False, True])
async def test_a_quick_question_publishes_running_action_before_completion_and_stop_ends_the_command(make_rig, client, conn, monkeypatch, brain, cancel):
    rig, hub, host = rig_with_command(make_rig, conn)
    rig.settings.set('action_mode', 'bypass')  # a quick question shows no card: a command runs only where nothing waits for a yes
    started, release, stopped = asyncio.Event(), asyncio.Event(), asyncio.Event()
    async def execute(command, **kwargs):
        started.set()
        try:
            await release.wait()
            return {'exit_code': 0, 'stdout': 'synthetic result', 'stderr': '', 'timed_out': False, 'truncated': False}
        finally:
            stopped.set()
    host.execute.side_effect = execute
    if brain == 'api':
        client.chats = [chat('Inspecting.', ('local__local_exec', {'command': COMMAND})), chat('Finished.')]
    else:
        rig.settings.set('agent_model', 'cli:' + brain)
        async def work(loop):
            result = await loop._tool('command', 'local__local_exec', {'command': COMMAND})
            loop._queue.put_nowait(Outcome('done', final='Finished.' if result.ok else result.content))
        monkeypatch.setattr(CliLoop, '_work', work)
    task = asyncio.create_task(quick_ask(rig))
    try:
        await asyncio.wait_for(started.wait(), 5)
        [turn] = rig.history.list(5, conversation_id=rig.service.conversations.quick())
        assert turn.status == 'running'
        actions = [json.loads(item['text']) for item in rig.history.messages([turn.id])[turn.id] if item['kind'] == 'event']
        assert actions[-1]['state'] == 'running'
        assert COMMAND.splitlines()[0] in actions[-1]['present']
        if cancel:
            await rig.call('agent.cancel', {'session_id': 'live'})
            result = await asyncio.wait_for(task, 5)
            assert result['status'] == 'done' and result['turn_id'] in (0, turn.id)
            assert rig.history.get(turn.id).status == 'cancelled'
            assert stopped.is_set()
        else:
            release.set()
            assert (await task)['status'] == 'done'
            actions = [json.loads(item['text']) for item in rig.history.messages([turn.id])[turn.id] if item['kind'] == 'event']
            assert actions[-1]['state'] == 'done' and actions[-1]['outcome'] == 'ok'
            assert rig.history.get(turn.id).status == 'done'
    finally:
        release.set()
        if not task.done():
            await rig.call('agent.cancel', {'session_id': 'live'})
        await asyncio.gather(task, return_exceptions=True)


async def test_foreground_command_cannot_request_an_unbounded_timeout(make_rig, conn):
    from raphael_core.computer.local_tools import _CONTEXT
    rig, hub, host = rig_with_command(make_rig, conn)
    token = _CONTEXT.set((('chat', 0, 1), False, True, 'synthetic', True))
    try:
        host.execute.return_value = {'exit_code': None, 'stdout': '', 'stderr': '', 'timed_out': True, 'truncated': False}
        result = await hub.call('mcp:local/local_exec', {'command': COMMAND, 'timeout_seconds': 86400}, approver='user')
        assert host.execute.await_args.kwargs['timeout_seconds'] == 120
        assert not result.ok and result.kind == 'timeout'
        assert 'stopped' in json.loads(result.text)['message']
    finally:
        _CONTEXT.reset(token)


@pytest.mark.parametrize('brain', ['api', 'claude', 'codex', 'gemini'])
async def test_raphael_diagnosis_reads_self_check_before_any_model_or_shell(make_rig, client, conn, tmp_path, monkeypatch, brain):
    rig, hub, host = rig_with_command(make_rig, conn)
    rig.service._attachment_store = AttachmentStore(tmp_path / 'synthetic-data')
    def assert_checked(system, user, tools):
        assert 'self_check' in {item['function']['name'] for item in tools}
        assert 'self_check' in [step.tool for step in rig.history.steps([rig.history.list(1)[0].id])[rig.history.list(1)[0].id]]
        diagnostics = json.loads(user.split('<self_check>\n', 1)[1].split('\n</self_check>', 1)[0])
        assert diagnostics['logs']['path'] == str(tmp_path / 'synthetic-data' / 'logs' / 'raphael.log')
        assert 'whole-profile' in system
    if brain == 'api':
        def answer(**kwargs):
            assert_checked(kwargs['messages'][0]['content'], kwargs['messages'][-1]['content'], kwargs['tools'])
            return chat('Checked the recent diagnostics.')
        client.chats = [answer]
    else:
        rig.settings.set('agent_model', 'cli:' + brain)
        async def work(loop):
            assert_checked(loop.system, loop.user, loop.tools)
            loop._queue.put_nowait(Outcome('done', final='Checked the recent diagnostics.'))
        monkeypatch.setattr(CliLoop, '_work', work)
    result = await typed(rig, '\u53ef\u4ee5\u5e6b\u6211\u67e5\u4e00\u4e0b\u662f\u767c\u751f\u751a\u9ebc\u4e8b\u60c5\u4e86\u55ce?')
    assert result['status'] == 'done' and result['text'] == 'Checked the recent diagnostics.'
    host.execute.assert_not_awaited()


async def test_timeout_is_told_to_the_owner_even_if_the_model_says_nothing_about_it(make_rig, client, conn):
    rig, hub, host = rig_with_command(make_rig, conn)
    rig.settings.set('action_mode', 'bypass')
    host.execute.return_value = {'exit_code': None, 'stdout': 'partial', 'stderr': '', 'timed_out': True, 'truncated': False}
    client.chats = [chat('Inspecting.', ('local__local_exec', {'command': COMMAND})), chat('Finished checking.')]
    result = await quick_ask(rig)
    assert result['status'] == 'done'
    turn = rig.history.get(result['turn_id'])
    messages = rig.history.messages([turn.id])[turn.id]
    assert any(item['kind'] == 'reply' and 'was stopped' in item['text'] for item in messages)
    assert any(step.outcome == 'timeout' for step in rig.history.steps([turn.id])[turn.id])


@pytest.mark.parametrize('text,wanted', [
    ('What happened?', True), ('What went wrong with Raphael?', True),
    ('Help me check Raphael', True), ('What happened to my CPU?', False),
    ('What happened to the market?', False), ('Help me check this spreadsheet', False),
])
def test_diagnosis_intent_is_limited_to_raphael(text, wanted):
    from raphael_core.agent.self_check import requested
    assert requested(text) is wanted


def test_diagnostics_read_only_the_configured_log_tail_and_redact_it(make_rig, tmp_path, monkeypatch):
    from raphael_core.agent.self_check import log_diagnostics
    rig = make_rig()
    path = tmp_path / 'synthetic.log'
    path.write_text('ERROR old outside the tail\n' + 'INFO padding\n' * 5000 +
                    '\n'.join('WARN synthetic failure at https://example.invalid/private' for _ in range(15)), encoding='utf-8')
    monkeypatch.setenv('RAPHAEL_LOG_PATH', str(path))
    before = path.read_bytes()
    data = log_diagnostics(rig.service)
    assert data['path'] == str(path) and len(data['recent_failures']) == 10
    assert all('[url]' in line and 'example.invalid' not in line and 'old outside' not in line for line in data['recent_failures'])
    assert path.read_bytes() == before


@pytest.mark.parametrize('envelope', [
    {'command': COMMAND, 'method': 'item/commandExecution/requestApproval'},
    {'tool_name': 'Bash', 'input': {'command': COMMAND}},
    {'toolCall': {'title': 'Run shell command', 'args': {'command': COMMAND}}},
])
def test_native_permission_envelopes_keep_the_literal_command(envelope):
    from raphael_core.computer.local_tools import command_of
    assert command_of(envelope) == COMMAND


@pytest.mark.parametrize('scope,nested', [('room', False), ('private', True)])
def test_log_tail_is_not_read_into_a_shared_or_nested_diagnosis(make_rig, monkeypatch, scope, nested):
    from types import SimpleNamespace
    from raphael_core.agent import self_check
    from raphael_core.agent.speaker import RAPHAEL
    rig = make_rig()
    def forbidden(service):
        raise AssertionError('Private native logs must not be read here')
    monkeypatch.setattr(self_check, 'log_diagnostics', forbidden)
    data = self_check.snapshot(rig.service, SimpleNamespace(speaker=RAPHAEL, conversation_id=None, scope=scope, nested=nested))
    assert data['logs'] == {'path': None, 'recent_failures': []}

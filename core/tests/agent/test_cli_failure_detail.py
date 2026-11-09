"""Synthetic CLI failures preserve diagnostic evidence without publishing it as a notice."""
import asyncio
import sys

import pytest

from raphael_core.agent.cli.drivers import Driver
from raphael_core.agent.cli.loop import CliLoop
from raphael_core.failures import classify


@pytest.mark.parametrize("brain", ["codex", "claude", "gemini"])
async def test_early_exit_keeps_redacted_stderr_for_every_cli(tmp_path, monkeypatch, brain):
    from raphael_core.agent.cli import drivers
    async def home(*args, **kwargs):
        (tmp_path / "workspace").mkdir(exist_ok=True)
        return tmp_path, {}, None
    monkeypatch.setattr(drivers, "codex_home", home)
    monkeypatch.setattr(drivers, "antigravity_home", lambda *args, **kwargs: tmp_path)
    monkeypatch.setattr(drivers, "forget_antigravity_server", lambda *args: None)
    script = tmp_path / "stopped.py"
    script.write_text("import sys\nsys.stderr.write('first diagnostic\\nAuthorization: Bearer synthetic-private-token\\nlast diagnostic\\n')\nsys.stderr.flush()\n", encoding="utf-8")
    driver = Driver(brain, [sys.executable, str(script)], environ={})
    events = [event async for event in driver.run(user="Synthetic question", system="Synthetic system", endpoint="http://127.0.0.1:1/mcp", token="synthetic-private-token", permission=None)]
    error = next(event for event in events if event.kind == "error")
    assert error.text == "cli_stopped"
    assert "last diagnostic" in error.data["detail"]
    assert "synthetic-private-token" not in str(error.data)
    assert "Check your network" not in classify(error.data).sentence("CLI")


def test_required_mcp_failure_names_server_and_retains_original_error():
    driver = Driver("codex", ["fake"])
    event = driver._event("error", "required MCP servers failed to initialize: computer")
    failure = classify(event.data)
    # A server that cannot start does not start on a second try: no retries, the owner is told which (2026-11-09).
    assert failure.kind == "tool_broken" and not failure.transient
    assert "computer" in failure.sentence("Codex CLI", "en")
    assert "required MCP servers failed to initialize: computer" in event.data["detail"]
    assert classify(ConnectionError("connection refused")).kind == "network"


def test_nested_cli_error_retains_last_stderr_lines_with_bounded_redaction():
    from types import SimpleNamespace
    driver = Driver("codex", ["fake"])
    driver._diagnostic_secrets = ["synthetic-private-token"]
    driver.child = SimpleNamespace(stderr_tail=("old line\n" * 30 + "x" * 2000 + "\nlast diagnostic synthetic-private-token").encode())
    event = driver._event("error", {"error":{"message":"required MCP servers failed to initialize: raphael " + "x" * 6000}})
    assert len(event.data["detail"]) <= 4000
    assert "last diagnostic [redacted]" in event.data["detail"]
    assert "synthetic-private-token" not in str(event.data)
    assert "old line\n" * 13 not in event.data["detail"]


async def test_terminal_error_drains_stderr_before_publishing_detail(tmp_path):
    script = tmp_path / "terminal_error.py"
    script.write_text('''import json, sys
json.loads(sys.stdin.readline())
sys.stderr.write("last terminal diagnostic\\n")
sys.stderr.flush()
print(json.dumps({"type":"result", "subtype":"error_during_execution", "is_error":True, "errors":["required MCP servers failed to initialize: raphael"]}), flush=True)
''', encoding="utf-8")
    driver = Driver("claude", [sys.executable, str(script)])
    events = [event async for event in driver.run(user="Synthetic question", system="Synthetic system", endpoint="http://127.0.0.1:1/mcp", token="synthetic-private-token", permission=None)]
    error = next(event for event in events if event.kind == "error")
    assert "last terminal diagnostic" in error.data["detail"]
    assert error.data["detail"].count("last terminal diagnostic") == 1


def test_terminal_failure_publishes_one_answer_without_notice():
    loop = object.__new__(CliLoop)
    notices = []
    loop.event = notices.append
    loop.language = "en"
    loop.failure_reason = classify({"kind":"cli_stopped", "message":"CLI process ended before completion", "detail":"last diagnostic"})
    loop._unfinished = lambda: ""
    loop._queue = asyncio.Queue()
    loop._failure("cli_stopped", "Codex CLI")
    outcome = loop._queue.get_nowait()
    assert notices == []
    assert outcome.final == "Codex CLI stopped before finishing its answer."
    assert outcome.detail == "last diagnostic"


@pytest.mark.parametrize('brain', ['claude', 'codex', 'gemini'])
@pytest.mark.parametrize('diagnostic,reason', [
    ('MCP tool mcp__raphael__approve not found', 'CLI tool is missing'),
    ('Error calling MCP tool work_status: synthetic failure', 'CLI tool failed'),
])
async def test_tool_error_before_eof_is_not_classified_as_no_response(tmp_path, monkeypatch, brain, diagnostic, reason):
    from raphael_core.agent.cli import drivers
    async def home(*args, **kwargs):
        (tmp_path / 'workspace').mkdir(exist_ok=True)
        return tmp_path, {}, None
    monkeypatch.setattr(drivers, 'codex_home', home)
    monkeypatch.setattr(drivers, 'antigravity_home', lambda *args, **kwargs: tmp_path)
    monkeypatch.setattr(drivers, 'forget_antigravity_server', lambda *args: None)
    script = tmp_path / 'tool_error.py'
    script.write_text('import sys\nsys.stderr.write(' + repr(diagnostic + '\nAuthorization: Bearer synthetic-private-token\n') + ')\nsys.stderr.flush()\n', encoding='utf-8')
    driver = Driver(brain, [sys.executable, str(script)], environ={})
    events = [event async for event in driver.run(user='Synthetic question', system='Synthetic system',
        endpoint='http://127.0.0.1:1/mcp', token='synthetic-private-token', permission=None)]
    [error] = [event for event in events if event.kind == 'error']
    assert error.text == 'tool_broken' and error.data['reason'] == reason
    assert diagnostic in error.data['detail'] and 'synthetic-private-token' not in str(error.data)
    assert '工具' in classify(error.data).sentence('Claude Code', 'zh-TW')
    assert not classify(error.data).transient


async def test_claude_failed_tool_result_before_eof_is_not_silence(tmp_path):
    script = tmp_path / 'failed_tool_result.py'
    script.write_text('''import json, sys
json.loads(sys.stdin.readline())
print(json.dumps({'type':'user', 'message':{'content':[{'type':'tool_result', 'tool_use_id':'board', 'is_error':True, 'content':'Synthetic board failure'}]}}), flush=True)
''', encoding='utf-8')
    driver = Driver('claude', [sys.executable, str(script)])
    events = [event async for event in driver.run(user='Synthetic question', system='Synthetic system',
        endpoint='http://127.0.0.1:1/mcp', token='ephemeral', permission=None)]
    [error] = [event for event in events if event.kind == 'error']
    assert error.text == 'tool_broken' and error.data['reason'] == 'CLI tool failed'
    assert 'Synthetic board failure' in error.data['detail']


@pytest.mark.parametrize('kind', ['auth_expired', 'rate_limit', 'credits', 'refused', 'network'])
def test_tool_diagnostics_do_not_override_an_explicit_provider_failure(kind):
    from types import SimpleNamespace
    driver = Driver('claude', ['fake'])
    driver.child = SimpleNamespace(stderr_tail=b'Unknown MCP tool from an earlier attempt')
    assert driver._event('error', {'kind': kind, 'message': 'Synthetic provider failure'}).text == kind

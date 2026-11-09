"""A CLI turn's spend counts every call once, cached input included (owner, 2026-11-09).

Claude Code's `modelUsage` adds up every run of a resumed session, and a Codex thread's token total adds up every
turn it ever had; before this the ledger wrote only the last run's uncached input (3,706 tokens for 519 calls).
"""

import sys
from types import SimpleNamespace

from raphael_core.agent.cli.drivers import Driver, Event
from raphael_core.agent.ledger import Ledger
from raphael_core.brain import db
from raphael_core.brain.meter import Usage
from raphael_core.brain.spend import SpendTracker

from .test_cli_recovery import recovery_rig

OPUS, HAIKU = "claude-opus-5-5", "claude-haiku-5-5"


class Recorder:
    def __init__(self):
        self.rows = []
        self.model = None

    def add(self, **row):
        self.rows.append(row)
        self.model = row["model"]


async def test_a_resumed_claude_session_counts_each_models_growth_and_the_main_model_last(monkeypatch, tmp_path):
    first = {OPUS: {"inputTokens": 10, "cacheReadInputTokens": 100, "cacheCreationInputTokens": 50, "outputTokens": 5},
             HAIKU: {"inputTokens": 3, "outputTokens": 1}}
    second = {**first, OPUS: {"inputTokens": 12, "cacheReadInputTokens": 250, "cacheCreationInputTokens": 60, "outputTokens": 9}}

    async def play(loop, attempt):
        if attempt == 1:
            yield Event("session", "native-session")
            yield Event("model", OPUS)
            yield Event("usage", data={"input_tokens": 10, "output_tokens": 5, "model_usage": first})
            yield Event("error", "network")
        else:
            yield Event("usage", data={"input_tokens": 2, "output_tokens": 4, "model_usage": second})
            yield Event("final", "Done.")

    rig = recovery_rig(monkeypatch, tmp_path, play, brain="claude")
    recorder = rig.loop.ledger = Recorder()
    result = await rig.loop.run()
    assert result.final == "Done." and rig.calls[1]["session"] == "native-session"
    counted = [(row["model"], row["usage"]) for row in recorder.rows]
    assert counted == [(f"cli:claude:{HAIKU}", Usage(input=3, output=1)),
                       (f"cli:claude:{OPUS}", Usage(input=10, cache_read=100, cache_write=50, output=5)),
                       (f"cli:claude:{OPUS}", Usage(input=2, cache_read=150, cache_write=10, output=4))]
    # The history names the model that answered, not a helper the CLI used on the side.
    assert recorder.model == f"cli:claude:{OPUS}"


async def test_a_codex_turn_counts_only_its_own_growth_of_the_threads_total(tmp_path):
    script = tmp_path / "codex.py"
    script.write_text("""import json, sys
def send(value): print(json.dumps(value), flush=True)
def usage(total, last):
    send({'method': 'thread/tokenUsage/updated', 'params': {'threadId': 'kept', 'turnId': 't', 'tokenUsage': {
        'total': total, 'last': last, 'modelContextWindow': 272000}}})
for line in sys.stdin:
    packet = json.loads(line)
    if packet.get('method') == 'initialize': send({'id': packet['id'], 'result': {}})
    elif packet.get('method') in ('thread/start', 'thread/resume'): send({'id': packet['id'], 'result': {'thread': {'id': 'kept'}}})
    elif packet.get('method') == 'turn/start':
        send({'method': 'turn/started', 'params': {'turn': {'id': 't'}}})
        # The thread already held an earlier turn: 60k input, 58k of it cached, 500 out.
        usage({'totalTokens': 75000, 'inputTokens': 74000, 'cachedInputTokens': 70000, 'outputTokens': 1000, 'reasoningOutputTokens': 300},
              {'totalTokens': 14500, 'inputTokens': 14000, 'cachedInputTokens': 12000, 'outputTokens': 500, 'reasoningOutputTokens': 200})
        usage({'totalTokens': 91000, 'inputTokens': 89500, 'cachedInputTokens': 85000, 'outputTokens': 1500, 'reasoningOutputTokens': 400},
              {'totalTokens': 16000, 'inputTokens': 15500, 'cachedInputTokens': 15000, 'outputTokens': 500, 'reasoningOutputTokens': 100})
        send({'method': 'item/completed', 'params': {'item': {'type': 'agentMessage', 'text': 'Finished'}}})
        send({'method': 'turn/completed', 'params': {'turn': {'status': 'completed'}}})
        break
""", encoding="utf-8")
    events = [event async for event in Driver("codex", [sys.executable, str(script)]).run(
        user="Count", system="Fake", endpoint="http://127.0.0.1:1/mcp", token="fake", permission=None)]
    meters = [Usage.from_dict(event.data["meter"]) for event in events if event.kind == "usage"]
    # Both calls of this turn, and nothing of the turn before it.
    assert meters[-1] == Usage(input=2500, cache_read=27000, output=1000, reasoning=300)


async def test_claude_code_hands_the_loop_every_models_running_total(tmp_path):
    script = tmp_path / "claude.py"
    script.write_text("""import json, sys
json.loads(sys.stdin.readline())
print(json.dumps({'type': 'result', 'subtype': 'success', 'result': 'Finished', 'session_id': 's',
    'usage': {'input_tokens': 4, 'output_tokens': 2, 'iterations': [{'input_tokens': 4, 'cache_read_input_tokens': 9, 'output_tokens': 2}]},
    'modelUsage': {'claude-opus-5-5': {'inputTokens': 4, 'outputTokens': 2, 'contextWindow': 200000}}}), flush=True)
""", encoding="utf-8")
    events = [event async for event in Driver("claude", [sys.executable, str(script)]).run(
        user="Count", system="Fake", endpoint="http://127.0.0.1:1/mcp", token="fake", permission=None)]
    [usage] = [event.data for event in events if event.kind == "usage"]
    assert usage["model_usage"]["claude-opus-5-5"]["inputTokens"] == 4 and usage["context_window"] == 200000


def test_the_spend_keeps_each_calls_cache_reasoning_job_billing_and_member(tmp_path):
    conn = db.connect(tmp_path / "spend.db")
    ledger = Ledger(SpendTracker(conn, now_ms=lambda: 1_800_000_000_000))
    ledger.job, ledger.member_id = "room", 7
    ledger.add(model="cli:claude:claude-opus-5-5", cost_usd=0,
               usage=Usage(input=20, cache_read=9000, cache_write=100, cache_write_long=400, output=50, reasoning=10, reported_cost=0.12))
    ledger.add(model="anthropic/claude-sonnet-5.5", cost_usd=0.003, usage=Usage(input=500, output=30), job="memory")
    rows = conn.execute("SELECT model, prompt_tokens, completion_tokens, job, billing, cache_read_tokens, cache_write_tokens,"
                        " cache_write_long_tokens, reasoning_tokens, reported_cost_usd, member_id FROM spend ORDER BY id").fetchall()
    assert [tuple(row) for row in rows] == [
        ("cli:claude:claude-opus-5-5", 9520, 50, "room", "subscription", 9000, 100, 400, 10, 0.12, 7),
        ("anthropic/claude-sonnet-5.5", 500, 30, "memory", "api", 0, 0, 0, 0, None, 7)]
    # The history's calls count every input token too.
    assert [call["tokens"] for call in ledger.calls] == [9570, 530]
    conn.close()

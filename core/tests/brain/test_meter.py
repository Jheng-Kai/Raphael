"""Every model call's exact usage, in one shape for every provider (owner, 2026-11-09)."""

from raphael_core.brain import meter
from raphael_core.brain.meter import Usage


def test_anthropic_usage_keeps_cache_reads_and_writes_apart_and_splits_an_hours_writes():
    usage = meter.anthropic({"input_tokens": 12, "cache_read_input_tokens": 9000, "cache_creation_input_tokens": 700,
                             "cache_creation": {"ephemeral_5m_input_tokens": 200, "ephemeral_1h_input_tokens": 500},
                             "output_tokens": 40})
    assert usage == Usage(input=12, cache_read=9000, cache_write=200, cache_write_long=500, output=40)
    assert usage.prompt == 9712 and round(usage.hit_rate, 4) == round(9000 / 9712, 4)
    # Without the split every written token is a five-minute one.
    assert meter.anthropic({"input_tokens": 1, "cache_creation_input_tokens": 30}).cache_write == 30


def test_chat_and_responses_usage_take_the_cache_out_of_the_input_they_include():
    chat = meter.chat({"prompt_tokens": 1000, "completion_tokens": 300, "cost": 0.0042,
                       "prompt_tokens_details": {"cached_tokens": 800, "cache_write_tokens": 150},
                       "completion_tokens_details": {"reasoning_tokens": 120}})
    assert chat == Usage(input=50, cache_read=800, cache_write=150, output=300, reasoning=120, reported_cost=0.0042)
    responses = meter.responses({"input_tokens": 5000, "output_tokens": 90,
                                 "input_tokens_details": {"cached_tokens": 4800},
                                 "output_tokens_details": {"reasoning_tokens": 60}})
    assert responses == Usage(input=200, cache_read=4800, output=90, reasoning=60)
    # A report the provider broke counts nothing rather than something false.
    assert meter.chat({"prompt_tokens": "many", "completion_tokens": -3}) == Usage()


def test_codex_counts_and_a_running_total_become_one_turns_growth():
    total = meter.codex({"inputTokens": 90_000, "cachedInputTokens": 85_000, "outputTokens": 900, "reasoningOutputTokens": 400})
    assert total == Usage(input=5000, cache_read=85_000, output=900, reasoning=400)
    before = meter.codex({"inputTokens": 60_000, "cachedInputTokens": 58_000, "outputTokens": 500, "reasoningOutputTokens": 300})
    assert meter.delta(total, before) == Usage(input=3000, cache_read=27_000, output=400, reasoning=100)
    # A total that went down belongs to a session that started over: all of it is new.
    assert meter.delta(before, total) == before


def test_claude_code_rows_count_each_models_calls_once_across_resumed_runs():
    first = {"claude-opus-5-5": {"inputTokens": 10, "cacheReadInputTokens": 100, "cacheCreationInputTokens": 50,
                                 "outputTokens": 5, "costUSD": 0.10},
             "claude-haiku-5-5": {"inputTokens": 3, "outputTokens": 1, "costUSD": 0.001}}
    run = {"input_tokens": 10, "cache_read_input_tokens": 100, "cache_creation_input_tokens": 50, "output_tokens": 5,
           "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 50}}
    rows, kept = meter.claude_code_rows(run, first, {}, main_model="claude-opus-5-5", resumed=False)
    assert dict(rows) == {"claude-opus-5-5": Usage(input=10, cache_read=100, cache_write_long=50, output=5, reported_cost=0.10),
                          "claude-haiku-5-5": Usage(input=3, output=1, reported_cost=0.001)}
    # The next run of the same session reports totals for the whole session: only the growth is this run's.
    second = {**first, "claude-opus-5-5": {"inputTokens": 12, "cacheReadInputTokens": 250, "cacheCreationInputTokens": 60,
                                           "outputTokens": 9, "costUSD": 0.15}}
    rows, kept = meter.claude_code_rows({"input_tokens": 2}, second, kept, main_model="claude-opus-5-5", resumed=True)
    assert len(rows) == 1 and rows[0][0] == "claude-opus-5-5"
    assert rows[0][1] == Usage(input=2, cache_read=150, cache_write=10, output=4, reported_cost=0.05)
    # A resumed session with nothing kept from before is counted by this run's own usage alone.
    rows, _ = meter.claude_code_rows({"input_tokens": 2, "output_tokens": 4}, second, {}, main_model="claude-opus-5-5", resumed=True)
    assert rows == [("claude-opus-5-5", Usage(input=2, output=4))]


def test_context_size_is_the_last_call_of_a_run_not_the_sum():
    usage = {"input_tokens": 30, "cache_read_input_tokens": 300_000, "output_tokens": 50,
             "iterations": [{"input_tokens": 10, "cache_read_input_tokens": 100_000, "output_tokens": 20},
                            {"input_tokens": 20, "cache_read_input_tokens": 100_020, "cache_creation_input_tokens": 5, "output_tokens": 30}]}
    assert meter.context_size(usage) == 100_075
    assert meter.context_size({"input_tokens": 5}) is None


def test_billing_follows_the_model_reference():
    assert meter.billing_of("cli:claude:claude-opus-5-5") == "subscription"
    assert meter.billing_of("@chatgpt:gpt-6.1-terra") == "subscription"
    assert meter.billing_of("anthropic/claude-sonnet-5.5") == "api"
    assert meter.billing_of(None) is None

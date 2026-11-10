"""What each model call used, in one shape for every provider (owner, 2026-11-09: every cost counted as exactly as
Claude Code's and DeepSeek's harnesses count it; internal, never shown to the user).

A provider reports a call's tokens in its own shape. `Usage` is the shape the spend keeps: input read at the full
price, input read from the provider's prompt cache, input written to a short-lived or a long-lived cache, output,
and the part of the output spent reasoning, with the cost the provider reported when it reports one. The CLIs
report running totals instead of calls (Claude Code's `modelUsage` across `--resume`, a Codex thread's totals);
`delta` turns two running totals into what was used between them.
"""

import math
from dataclasses import dataclass, fields, replace

# A count no single call reaches: anything above it is a broken report, not usage.
_MOST = 10**12


@dataclass(frozen=True)
class Usage:
    input: int = 0  # input read at the full price: neither read from a cache nor written to one
    cache_read: int = 0  # input read from the provider's prompt cache
    cache_write: int = 0  # input written to a short-lived cache (Anthropic five minutes, OpenAI thirty)
    cache_write_long: int = 0  # input written to a long-lived cache (Anthropic one hour, OpenAI twelve)
    output: int = 0  # output, reasoning included
    reasoning: int = 0  # the part of `output` the model spent reasoning
    reported_cost: float | None = None  # what the provider said the call cost, when it says

    @property
    def prompt(self) -> int:
        """Every input token the provider read, cached or not."""
        return self.input + self.cache_read + self.cache_write + self.cache_write_long

    @property
    def hit_rate(self) -> float | None:
        """The share of the input read from the cache; None for a call that read no input."""
        return self.cache_read / self.prompt if self.prompt else None

    def __bool__(self) -> bool:
        """Whether anything was used: a token, or a cost above nothing."""
        return any(getattr(self, name) for name in TOKENS) or bool(self.reported_cost)

    def __add__(self, other: "Usage") -> "Usage":
        cost = None if self.reported_cost is None and other.reported_cost is None else \
            (self.reported_cost or 0.0) + (other.reported_cost or 0.0)
        return Usage(**{name: getattr(self, name) + getattr(other, name) for name in TOKENS}, reported_cost=cost)

    def as_dict(self) -> dict:
        return {name: getattr(self, name) for name in (*TOKENS, "reported_cost")}

    @classmethod
    def from_dict(cls, data) -> "Usage | None":
        if not isinstance(data, dict):
            return None
        return cls(**{name: _count(data, name) for name in TOKENS}, reported_cost=_cost(data.get("reported_cost")))


TOKENS = tuple(item.name for item in fields(Usage) if item.name != "reported_cost")


def _count(mapping, *keys: str) -> int:
    """The first of `keys` that `mapping` holds as a whole number of tokens, else 0."""
    if not isinstance(mapping, dict):
        return 0
    for key in keys:
        value = mapping.get(key)
        if type(value) is int and 0 <= value < _MOST:
            return value
        if type(value) is float and value.is_integer() and 0 <= value < _MOST:
            return int(value)
    return 0


def _cost(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) and value >= 0 else None


def anthropic(usage) -> Usage:
    """Anthropic's Messages usage, as the API, OpenRouter's Anthropic models and Claude Code report it:
    `input_tokens` leaves out what the cache read and wrote. `cache_creation` splits the written tokens by how
    long they are kept; without it every written token is a five-minute one."""
    written = _count(usage, "cache_creation_input_tokens")
    split = usage.get("cache_creation") if isinstance(usage, dict) else None
    short, long = written, 0
    if isinstance(split, dict):
        short, long = _count(split, "ephemeral_5m_input_tokens"), _count(split, "ephemeral_1h_input_tokens")
        short += max(0, written - short - long)
    return Usage(input=_count(usage, "input_tokens"), cache_read=_count(usage, "cache_read_input_tokens"),
                 cache_write=short, cache_write_long=long, output=_count(usage, "output_tokens"),
                 reported_cost=_cost(usage.get("cost")) if isinstance(usage, dict) else None)


def chat(usage) -> Usage:
    """OpenAI's Chat Completions usage, as OpenRouter reports it for every model: `prompt_tokens` includes what the
    cache read (`cached_tokens`) and wrote (`cache_write_tokens`); `completion_tokens` includes the reasoning."""
    if not isinstance(usage, dict):
        return Usage()
    details, out = usage.get("prompt_tokens_details"), usage.get("completion_tokens_details")
    prompt, read, written = _count(usage, "prompt_tokens"), _count(details, "cached_tokens"), _count(details, "cache_write_tokens")
    return Usage(input=max(0, prompt - read - written), cache_read=read, cache_write=written,
                 output=_count(usage, "completion_tokens"), reasoning=_count(out, "reasoning_tokens"),
                 reported_cost=_cost(usage.get("cost")))


def responses(usage) -> Usage:
    """OpenAI's Responses usage (the ChatGPT sign-in): `input_tokens` includes the cache, `output_tokens` the
    reasoning, as Codex reads them (codex-api/src/sse/responses.rs)."""
    if not isinstance(usage, dict):
        return Usage()
    details, out = usage.get("input_tokens_details"), usage.get("output_tokens_details")
    total, read, written = _count(usage, "input_tokens"), _count(details, "cached_tokens"), _count(details, "cache_write_tokens")
    return Usage(input=max(0, total - read - written), cache_read=read, cache_write=written,
                 output=_count(usage, "output_tokens"), reasoning=_count(out, "reasoning_tokens"))


def codex(breakdown) -> Usage:
    """A Codex token breakdown (app-server `thread/tokenUsage/updated`, `exec --json` turn usage): `inputTokens`
    includes the cache (codex-rs protocol.rs `non_cached_input`)."""
    total = _count(breakdown, "inputTokens", "input_tokens")
    read = _count(breakdown, "cachedInputTokens", "cached_input_tokens")
    written = _count(breakdown, "cacheWriteInputTokens", "cache_write_input_tokens")
    return Usage(input=max(0, total - read - written), cache_read=read, cache_write=written,
                 output=_count(breakdown, "outputTokens", "output_tokens"),
                 reasoning=_count(breakdown, "reasoningOutputTokens", "reasoning_output_tokens"))


def gemini(usage) -> Usage:
    """Gemini's usage metadata: `promptTokenCount` includes the cached content; thoughts are billed as output."""
    prompt, read = _count(usage, "promptTokenCount", "input_tokens"), _count(usage, "cachedContentTokenCount", "cached")
    thoughts = _count(usage, "thoughtsTokenCount")
    return Usage(input=max(0, prompt - read), cache_read=read,
                 output=_count(usage, "candidatesTokenCount", "output_tokens") + thoughts, reasoning=thoughts)


def claude_code_model(entry) -> Usage:
    """One model's running total in Claude Code's `modelUsage` (`inputTokens` leaves the cache out, `costUSD` is
    Claude Code's own estimate, not a bill)."""
    return Usage(input=_count(entry, "inputTokens"), cache_read=_count(entry, "cacheReadInputTokens"),
                 cache_write=_count(entry, "cacheCreationInputTokens"), output=_count(entry, "outputTokens"),
                 reported_cost=_cost(entry.get("costUSD")) if isinstance(entry, dict) else None)


def delta(now: Usage, before: Usage | None) -> Usage:
    """What a running total grew by since `before`. A total that went down started over (a new session under
    the same name), so all of `now` is new."""
    if before is None or any(getattr(now, name) < getattr(before, name) for name in TOKENS):
        return now
    cost = now.reported_cost
    if cost is not None and before.reported_cost is not None:
        # Dollars to a billionth of a cent: a difference of two sums carries no more.
        cost = round(max(0.0, cost - before.reported_cost), 12)
    return replace(now, **{name: getattr(now, name) - getattr(before, name) for name in TOKENS}, reported_cost=cost)


def claude_code_rows(run_usage, model_usage, marks, *, main_model: str, resumed: bool) -> tuple[list[tuple[str, Usage]], dict]:
    """The calls of one Claude Code run, a row for each model, and the running totals to keep for the next run of
    the same session.

    `modelUsage` names every model the run used (subagents and Claude Code's own small calls too), but it adds
    up every run of a resumed session (measured 2026-11-09), so each model's row is its total less the total kept
    after the previous run (`marks`). A resumed session with nothing kept (one started before marks existed) can
    only be counted by this run's own `usage`, which covers the main model's calls. `usage` also says which written
    tokens are kept for an hour; that split goes to the main model's row."""
    entries = model_usage if isinstance(model_usage, dict) else {}
    marks = marks if isinstance(marks, dict) else {}
    run = anthropic(run_usage) if isinstance(run_usage, dict) else Usage()
    totals = {model: claude_code_model(entry) for model, entry in entries.items() if isinstance(entry, dict)}
    kept = {model: usage.as_dict() for model, usage in totals.items()}
    if resumed and not marks:
        return ([(main_model, run)] if run else []), kept
    rows = []
    for model, total in totals.items():
        row = delta(total, Usage.from_dict(marks.get(model)))
        if model == main_model and run.cache_write_long:
            long = min(row.cache_write, run.cache_write_long)
            row = replace(row, cache_write=row.cache_write - long, cache_write_long=long)
        if row:
            rows.append((model, row))
    if not totals and run:
        rows.append((main_model, run))
    return rows, kept


def billing_of(model: str | None) -> str | None:
    """How a model reference is paid for: a CLI brain and the ChatGPT or Codex sign-in use a subscription, the
    rest an API key."""
    if not model:
        return None
    return "subscription" if model.startswith(("cli:", "@chatgpt:", "@codex:")) else "api"


def context_size(usage) -> int | None:
    """How long the conversation was at the last call of a run, from Claude Code's `usage`: it adds every call of
    the run up, so only its last iteration measures the context (2026-11-09). None without iterations."""
    iterations = usage.get("iterations") if isinstance(usage, dict) else None
    if not isinstance(iterations, list) or not iterations or not isinstance(iterations[-1], dict):
        return None
    return anthropic(iterations[-1]).prompt + _count(iterations[-1], "output_tokens")

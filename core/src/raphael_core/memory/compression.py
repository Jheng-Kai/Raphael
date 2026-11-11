"""Context-compression policy with independent session lifecycle.

Adapted from NousResearch/hermes-agent (MIT); see core/packaging/licenses.
"""

DEFAULT_THRESHOLD_CAP = 24_000
SUMMARY_RATIO = 0.20
SUMMARY_MIN_TOKENS = 2_000
SUMMARY_MAX_TOKENS = 10_000
PROTECT_FIRST_MESSAGES = 3
PROTECT_LAST_MESSAGES = 20
# The base of a meeting room's prompt (members/exchanges.py). A fresh CLI session's first message is no longer bound by it:
# its budget follows the model's window (agent/cli/context.py `fresh_budget`).
FRESH_CONTEXT_CHARS = 16000


def recent_turns(turns, chars, byte_limit=float("inf")):
    """Select recent records whole, in chronological order, within both transport budgets."""
    recent = []
    for identifier, text in reversed(turns):
        size = len(text.encode("utf-8")) + 2
        if len(text) + 2 <= chars and size <= byte_limit:
            recent.insert(0, (identifier, text))
            chars -= len(text) + 2
            byte_limit -= size
    return recent


def threshold_tokens(window, max_output=0, cap=DEFAULT_THRESHOLD_CAP):
    window = window if type(window) is int and window > 0 else 32_000
    output = max_output if type(max_output) is int and max_output > 0 else 0
    effective = window - output if window > output else window
    percent = .75 if window < 512_000 else .50
    percentage = int(effective * percent)
    trigger = max(percentage, 64_000)
    ceiling = int(effective * .85)
    if trigger > percentage and trigger > ceiling:
        trigger = max(percentage, ceiling)
    if trigger >= effective:
        trigger = max(1, min(ceiling, effective - 1))
    if type(cap) is int and cap > 0:
        trigger = min(trigger, cap, effective)
    return max(1, trigger)


def summary_budget(content_tokens):
    return max(SUMMARY_MIN_TOKENS, min(int(content_tokens * SUMMARY_RATIO), SUMMARY_MAX_TOKENS))


def message_count(turn):
    # Keep a whole question/reply pair when a protected boundary falls inside it.
    return 1 + max(1, len(turn.messages or ()))

"""How much of a model's window a prompt may take: the one place that says it, for a fresh native session's first message
(agent/cli/context.py), a room's transcript (members/rooms.py), a memory pass and a fold (memory/). Length is never an error
(owner, 2026-11-09): what a prompt carries follows the model's window, whole items newest first.
"""

DEFAULT_CONTEXT_TOKENS = 64000
# The window of a CLI's models before one has reported its own (`context_window`): Claude Code reports 200K tokens
# for its models, or 1M for the long-context ones, so the smaller is a safe start. Other CLIs start from the default.
KNOWN_CONTEXT_TOKENS = {"claude": 200_000}
# How full a native session may get before it is given up for a fresh one (owner, 2026-11-09: at 80%, as
# OpenMausBot's context-budget.ts; it was 75%). The measure is the last call's size, not a run's sum
# (`context_tokens`), so the fifth left is real room for the turn's own tool work.
CONTEXT_HEADROOM = .80
# How much of the window a fresh session's first message may take at most; the rest is the turn's own work and the next
# turns before the session is given up again (`should_compact`).
FRESH_CONTEXT_SHARE = .50


def window_tokens(*candidates):
    """The first window of `candidates` that is one, else the default."""
    return next((value for value in candidates if type(value) is int and value > 0), DEFAULT_CONTEXT_TOKENS)


def fresh_budget(window, reserve=0, byte_limit=None):
    """What a fresh session's first message may take, in UTF-8 bytes: (the most the mandatory part may be, the most the
    whole message may be). Bytes bound tokens from above, so a window's token count is used as a byte count. The
    window is the model's (`window_tokens`); `reserve` is what goes beside the message (the system prompt); `byte_limit`
    is a provider's own limit, when it has one."""
    window = window_tokens(window)
    hard, soft = (max(0, int(window * share) - reserve) for share in (CONTEXT_HEADROOM, FRESH_CONTEXT_SHARE))
    if byte_limit is not None:
        hard, soft = min(hard, byte_limit), min(soft, byte_limit)
    return hard, soft


def window_of(model, entries=None):
    """The window of `model`, in tokens: the catalog's (`entries`, else the builtin table), else what its CLI is known
    to hold (`KNOWN_CONTEXT_TOKENS`), else the default. Never raises: a catalog that cannot be read is no window."""
    cli = model.split("?", 1)[0].split(":")[1] if isinstance(model, str) and model.startswith("cli:") else ""
    try:
        from .catalog import context_window
        from .pricing import builtin_catalog
        listed = context_window(entries or builtin_catalog(), model)
    except Exception:  # a window that cannot be told is the default, never an error
        listed = None
    return window_tokens(listed, KNOWN_CONTEXT_TOKENS.get(cli))

"""What Raphael did between a question and its answer, as the conversation view shows it.

A step is one thing done for a turn: a lookup of Raphael's own (the weather, a web search), a tool of
a plugin, a command for this computer, or, in the background worker, a model call. It keeps the tool,
the server it belongs to, how it ended, how long it took and, when it failed, why, as one word of
`REASONS`; the app words that word in the language of the window.

A step of a tool that stands on a service the owner chose (`raphael_core.services`) also keeps which
one (`detail`): the search engine of a web search ("openrouter", "brave", "tavily", "exa",
"searxng"), the reader of a page ("builtin", "jina", "firecrawl", "tavily"), or what kind of file a
file read was ("image", "pdf"). One word of that list, never what the tool was given.

Never an argument, a result or an error message. A service's message can quote what it was given (a
name, an address, a sentence the user said), so even a short one could carry what the user said
into a table that is not cleared like the history. The kind of a failure is all that is kept: the
plugins' (`integrations.client.KINDS`), the lookups' (`tools.ToolResult.error`) and the model's
(`failure.KINDS`) are folded into the few reasons below.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from ..failures import KINDS

# bad_arguments: the tool was given something it does not take. auth: it needs a new sign-in.
# missing_secret: a key or token it needs is not set. denied: the sign-in was refused. timeout:
# the service did not answer in time. network: it could not be reached. not_found: what was asked
# for is not there (a city, a program). blocked: the tool may not run now (switched off, no yes, not
# a tool of the task). gone: the tool is no longer there. tool_error: the service said it failed.
# protocol: it answered with something that is not an answer. cancelled: the user stopped it.
# not_made: the turn could ask about one call only, so this one was not made. credits, budget,
# no_key: the model could not be paid for. On the owner's desktop (`raphael_core.computer`):
# password: a password field, which only the owner fills; handoff: a step that is the owner's (a
# sign-in, a payment, an administrator's prompt); refused_app: an app Raphael never operates;
# interrupted: the owner's own mouse or keys stopped the run. forbidden: a safety rule of the
# owner's (`agent.safety`) forbids it, so it was not done. error: anything else.
REASONS = KINDS | frozenset(
    {
        "bad_arguments",
        "auth",
        "missing_secret",
        "denied",
        "timeout",
        "network",
        "not_found",
        "blocked",
        "gone",
        "tool_error",
        "protocol",
        "cancelled",
        "not_made",
        "credits",
        "budget",
        "no_key",
        "password",
        "handoff",
        "refused_app",
        "interrupted",
        "forbidden",
        "error",
    }
)

# Kinds of other parts that mean one of the reasons above.
_ALIASES = {
    "offline": "network",
    "http_error": "network",
    "server": "network",
    "rate_limit": "network",
    "bad_response": "protocol",
    "changed": "blocked",
    "disabled": "blocked",  # the owner turned the capability off (Settings › 服務)
    "stale": "not_found",
    "elevated": "handoff",
    "own_window": "blocked",
    "keys_not_allowed": "blocked",
    "unavailable": "network",
    "failed": "error",
    # The services' kinds (raphael_core.services.common.ServiceError).
    "blocked_address": "blocked",
    "url_not_seen": "blocked",
    "bad_url": "bad_arguments",
    "redirects": "network",
    "too_large": "error",
    "unsupported_type": "error",
    "not_configured": "missing_secret",
    "vision_unsupported": "error",
    "bad_pdf": "error",
    "encrypted": "error",
    "no_text": "not_found",
}

# The reason of a step that failed with no kind, by how it ended.
_BY_OUTCOME = {"timeout": "timeout", "blocked": "blocked", "cancelled": "cancelled"}


def reason_of(outcome: str, kind: str | None) -> str | None:
    """The reason to keep for a step that ended with `outcome` ("ok", "error", "timeout", "blocked",
    "cancelled") because of `kind`; None for a step that went well."""
    if outcome == "ok":
        return None
    if kind in KINDS:
        return kind
    if kind:
        kind = _ALIASES.get(kind, kind)
        if kind in REASONS:
            return kind
    return _BY_OUTCOME.get(outcome, "error")


@dataclass(frozen=True)
class Step:
    """One step of a turn. `kind` is "tool" (a lookup or a plugin's tool), "command" (something
    done to this computer), "computer" (a step of a run on the owner's desktop: `tool` is the
    action, `server` the name of the app) or "model" (a model call of the worker); `server` is the
    plugin's name, "Raphael" for Raphael's own lookups, None for a command; `at_ms` is when it
    ended."""

    kind: str
    tool: str
    server: str | None
    outcome: str
    ms: int
    reason: str | None = None
    at_ms: int = 0
    detail: str | None = None  # the service the step used (see the module), or None


# A call that failed for one of these reasons was refused before it did anything, or by the tool
# itself; any other failure came after the call was sent, so it may have been made.
REFUSED_REASONS = frozenset(
    {"tool_error", "auth", "bad_arguments", "blocked", "missing_secret", "not_found", "denied"}
)
# The most tools `work_summary` names (the rest are counted), the longest name and server it shows, and
# the most characters it takes.
WORK_NAMED = 6
WORK_NAME_CHARS = 32
WORK_SERVER_CHARS = 16
WORK_CHARS = 560


def _plain(value: str, limit: int) -> str:
    """`value` on one line, cut to `limit`: a name a server chose is data, never a line of its own."""
    return " ".join(value.split())[:limit]


def work_summary(steps: Sequence[Step], changes: Callable[[Step], bool]) -> str:
    """What the steps of a turn that did not finish already did, as a line for the model that is
    asked to go on or try again: the tools that changed something and ended ok, by name and how many
    times, the calls that change things and did not end cleanly (they may have taken effect), and how
    many calls only read. `changes` says whether a step changed something (`ToolGate.step_changes`).
    Never an argument or a result: the steps keep none. At most WORK_CHARS."""
    steps = [step for step in steps if step.kind != "model"]
    if not steps:
        return "No tool calls were recorded."
    done: dict[tuple[str, str | None], int] = {}
    unsure = reads = 0
    for step in steps:
        if not changes(step):
            reads += step.outcome == "ok"
        elif step.outcome == "ok":
            key = (step.tool, step.server)
            done[key] = done.get(key, 0) + 1
        elif step.outcome != "blocked" and step.reason not in REFUSED_REASONS:
            unsure += 1
    named = sorted(done.items(), key=lambda item: -item[1])
    shown = [
        _plain(tool, WORK_NAME_CHARS)
        + (f" ({_plain(server, WORK_SERVER_CHARS)})" if server else "")
        + (f" x{count}" if count > 1 else "")
        for (tool, server), count in named[:WORK_NAMED]
    ]
    if len(named) > WORK_NAMED:
        shown.append(f"and {len(named) - WORK_NAMED} more")
    parts = ["It had changed: " + ", ".join(shown)] if done else [
        "It changed nothing for certain" if unsure else "It changed nothing"
    ]
    if unsure:
        parts.append(
            f"{unsure}{' more' if done else ''} {'call that changes' if unsure == 1 else 'calls that change'} "
            "things did not end cleanly and may have taken effect"
        )
    if reads:
        parts.append(f"{reads} {'call' if reads == 1 else 'calls'} only read")
    text = "; ".join(parts) + "."
    if done or unsure:
        text += " Changes already made should not be made twice."
    return text if len(text) <= WORK_CHARS else text[: WORK_CHARS - 1].rstrip() + "…"

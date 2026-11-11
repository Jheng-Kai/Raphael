"""Why the assistant could not do what it was asked, as a reason Raphael can give.

A failure ends in a short 否 line that says why, in the user's language (`persona.PHRASES`): the
kinds below retain those phrases. An optional shared diagnostic carries a bounded, redacted
provider reason; raw packets and credentials never cross this boundary.
"""

import math
import re

from httpx import ConnectError, TimeoutException

from ..brain.openrouter import OpenRouterError
from ..failures import KINDS as SHARED_KINDS

# no_key: no OpenRouter key is stored. auth: OpenRouter does not accept it. budget: this month's
# limit is used up. credits: the OpenRouter account has none left. offline: the network cannot
# be reached. timeout: the request did not finish in time. no_answer: the model gave no answer (a reply that was only
# reasoning has none). error: anything else.
KINDS = ("no_key", "auth", "budget", "credits", "offline", "timeout", "error", "no_answer")

_KIND_OF_OPENROUTER = {
    "auth": "auth",
    "credits": "credits",
    "network": "offline",
    "offline": "offline",
    "timeout": "timeout",
    "usage_limit": "usage_limit",
    "context_overflow": "context_overflow",
    "payload_too_large": "payload_too_large",
    "content_policy": "content_policy",
    "auth_expired": "auth_expired",
    "chatgpt_unavailable": "chatgpt_unavailable",
    "chatgpt_plan_unavailable": "chatgpt_plan_unavailable",
    "chatgpt_scope": "chatgpt_scope",
}


class AgentFailure(Exception):
    """The request cannot be answered by a model; `kind` is one of KINDS."""

    def __init__(self, kind: str, *, diagnostic=None, model: str | None = None) -> None:
        super().__init__(kind if kind in KINDS or kind in SHARED_KINDS else "error")
        self.kind = kind if kind in KINDS or kind in SHARED_KINDS else "error"
        self.diagnostic = diagnostic
        self.model = model


def public_failure(value):
    """Allow only public classification, provider identity and a finite epoch time."""
    if not isinstance(value, dict) or not isinstance(value.get("kind"), str) or value["kind"] not in SHARED_KINDS:
        return None
    provider = value.get("provider")
    if not isinstance(provider, str) or not re.fullmatch(r"(?:cli:)?[a-z][a-z0-9_-]{0,63}", provider):
        return None
    resets_at = value.get("resets_at")
    if type(resets_at) not in (int, float) or not 0 < resets_at <= 253402300799 or not math.isfinite(resets_at):
        resets_at = None
    return {"kind": value["kind"], "provider": provider, "resets_at": resets_at}


def turn_failure(kind, model, diagnostic=None):
    """Project a classified error without copying its reason, detail or missing-resource data."""
    aliases = {"no_key": "auth_expired", "auth": "auth_expired", "offline": "network",
               "monthly_budget": "credits", "budget": "credits", "error": "unknown"}
    kind = diagnostic.kind if diagnostic is not None else aliases.get(kind, kind)
    kind = kind if kind in SHARED_KINDS else "unknown"
    return public_failure({"kind": kind, "provider": provider_of(model),
                           "resets_at": diagnostic.resets_at if diagnostic is not None else None})


def provider_of(model):
    """The provider a model reference runs on: `cli:codex` for a subscription CLI, `chatgpt` for `@chatgpt:...`, else openrouter."""
    if isinstance(model, str) and model.startswith("cli:"):
        return ":".join(model.split(":", 2)[:2])
    if isinstance(model, str) and model.startswith("@"):
        return model[1:].split(":", 1)[0]
    return "openrouter"


def failure_kind(error: BaseException) -> str:
    """The kind of failure `error` amounts to."""
    if isinstance(error, OpenRouterError):
        return _KIND_OF_OPENROUTER.get(error.kind, "error")
    if isinstance(error, (TimeoutError, TimeoutException)):
        return "timeout"
    if isinstance(error, (ConnectionError, ConnectError)):
        return "offline"
    return "error"

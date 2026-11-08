"""Tool-less memory work on the selected member's brain, including subscriptions."""

from ..agent.cli.discovery import brain_ref
from ..brain.openrouter import Completion, OpenRouterError
from ..failures import KINDS

REASONS = {
    "usage_limit": "Subscription usage limit reached",
    "rate_limit": "Subscription is rate limited",
    "auth_expired": "Subscription login is unavailable",
    "missing": "Subscription CLI is not installed",
    "bad_response": "Memory brain returned invalid JSON",
    "timeout": "Memory brain timed out",
    "cli_stopped": "Subscription CLI stopped before completion",
    "cancelled": "Memory pass was cancelled",
    "limit_model": "Memory pass reached its model-call limit",
    "limit_time": "Memory pass reached its time limit",
    "limit_cost": "Memory pass reached its spending limit",
    "unavailable": "Memory brain did not complete",
}


def failure_summary(error):
    """Bound diagnostics to known kinds; provider text can contain private prompt data."""
    kind = getattr(error, "kind", "timeout" if isinstance(error, TimeoutError) else "bad_response")
    kind = kind if kind in KINDS or kind in REASONS else "unavailable"
    return kind, REASONS.get(kind, "Memory provider request failed")


class MemoryBrainError(OpenRouterError):
    """Subscription memory failure; no OpenRouter request was made on this path."""


class MemoryBrain:
    def __init__(self, memory, member_id, *, ledger=None):
        self.memory, self.member_id = memory, member_id
        self.ledger = ledger

    async def complete_json(self, **kwargs):
        model = kwargs["model"]
        if not brain_ref(model):
            # Keep the chosen member model; an auxiliary-purpose provider must not
            # replace it with the global memory model or silently cross providers.
            kwargs["fallbacks"] = []
            client = self.memory._base_client
            if hasattr(client, "for_purpose"):
                client = client.for_purpose("agent")
            result = await client.complete_json(**kwargs)
            if self.ledger is not None:
                self.ledger.add(model=result.model, cost_usd=result.cost_usd,
                                prompt_tokens=result.prompt_tokens, completion_tokens=result.completion_tokens,
                                ms=result.latency_ms,
                                billing_source="subscription" if model.startswith("@chatgpt:") else None)
            return result
        from ..agent.cli.loop import CliLoop
        from ..background.cli import RoomCliSessions
        from ..agent.ledger import Ledger
        from ..worker.loop import ToolOutcome

        async def refuse(*args):
            return ToolOutcome(False, "memory_pass_has_no_tools")

        loop = CliLoop(brains=self.memory._cli_brains, sessions=RoomCliSessions(), member_id=self.member_id,
                       conversation_id=f"memory-{self.member_id}", model=model,
                       ledger=self.ledger if self.ledger is not None else Ledger(self.memory._spend, "memory"), language="en", plain=True,
                       system=kwargs["system"], user=kwargs["user"], tools=[],
                       progress=lambda text: None, thinking=lambda text: None, event=lambda text: None,
                       execute=refuse, resume_session=False, rate_limit_waits=(), structured=kwargs["schema"], no_tools=True)
        try:
            import asyncio
            outcome = await asyncio.wait_for(loop.run(), kwargs.get("timeout_s", 90))
            failure = getattr(loop, "failure", None)
            if failure:
                aliases = {"login": "auth_expired", "quota": "usage_limit", "rate_limited": "rate_limit"}
                reason = getattr(loop, "failure_reason", None)
                kind, message = failure_summary(reason or MemoryBrainError(0, aliases.get(failure, failure), ""))
                raise MemoryBrainError(0, kind, message)
            if outcome.status != "done":
                kind = outcome.kind or ("cancelled" if outcome.status == "cancelled" else "cli_stopped")
                raise MemoryBrainError(0, kind, "Memory brain stopped before completion")
            from ..brain.structured import structured_object
            data = structured_object(outcome.final, kwargs["schema"])
            return Completion(data=data, model=model, cost_usd=0, prompt_tokens=0, completion_tokens=0, latency_ms=0)
        except TimeoutError as exc:
            raise MemoryBrainError(0, "timeout", "Memory brain timed out") from exc
        except (ValueError, TypeError, KeyError) as exc:
            raise MemoryBrainError(0, "bad_response", "Memory brain returned invalid JSON") from exc
        finally:
            await loop.aclose()

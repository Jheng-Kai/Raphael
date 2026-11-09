"""The cost of a request to the assistant: every paid call, written to the spend and added up.

A request can make several: Jev's decision, the language model's answer, a web search. Each is one
row of the spend with the purpose "agent", so the monthly limit counts them, and the total is what
the turn cost, for the history. The memory's own calls (folding the conversation into its summary,
the reflection pass) are written the same way, with the purpose "memory".
"""

import logging
import math

from ..brain.meter import Usage, billing_of
from ..brain.spend import SpendTracker

logger = logging.getLogger(__name__)

PURPOSE = "agent"


class Ledger:
    """One request's paid calls. Use it on the thread that owns the spend's database."""

    def __init__(self, spend: SpendTracker, purpose: str = PURPOSE) -> None:
        self._spend = spend
        self._purpose = purpose
        self.total = 0.0
        # The model of the latest paid call: the one that worded the answer, for the history.
        self.model: str | None = None
        self.calls: list[dict] = []
        # What kind of work these calls do ("chat", "room", "work", "memory" ...) and for which member, written
        # with every call (brain/meter.py); a call may name its own.
        self.job: str | None = None
        self.member_id: int | None = None

    def include_media(self, billing: dict) -> None:
        """Include a media call already recorded under its own spend purpose, without billing twice."""
        cost = billing.get("cost_usd")
        self.total += cost if isinstance(cost, (int, float)) and math.isfinite(cost) and cost >= 0 else 0
        self.calls.append({"model": billing["model"], "at_ms": self._spend._now_ms(), "ms": 0,
                           "tokens": 0, "cost_usd": cost or 0, "outcome": "ok" if cost is not None else "cost_unknown"})
        if billing.get("billing_source") == "subscription":
            self.calls[-1].update(cost_usd=None, outcome="subscription", billing_source="subscription")

    def add(
        self,
        *,
        model: str | None,
        cost_usd: float,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        ms: int = 0,
        outcome: str = "ok",
        billing_source: str | None = None,
        usage: Usage | None = None,
        job: str | None = None,
        member_id: int | None = None,
    ) -> None:
        """Write down a call that was paid for. A cost the spend refuses (negative, not a number)
        is counted as nothing, and a database that fails does not lose the request: both are
        logged by the type of the error. A cost that was reported is added to the total even when
        it could not be written, since it was spent.

        `usage` is the call's exact split (brain/meter.py); when it is given it also counts the tokens,
        every input token included, cached or not. `job` and `member_id` default to the ledger's own."""
        if usage is not None:
            prompt_tokens, completion_tokens = usage.prompt, usage.output
        if not (math.isfinite(cost_usd) and cost_usd >= 0):
            logger.warning("A cost the spend cannot take was counted as nothing: ValueError")
            return
        self.total += cost_usd
        self.calls.append({"model": model or "", "at_ms": self._spend._now_ms(), "ms": max(0, int(ms)),
                           "tokens": max(0, prompt_tokens) + max(0, completion_tokens),
                           "cost_usd": cost_usd, "outcome": outcome})
        if billing_source == "subscription":
            self.calls[-1].update(cost_usd=None, billing_source="subscription")
        if model:
            self.model = model
        try:
            self._spend.record(
                purpose=self._purpose,
                model=model,
                cost_usd=cost_usd,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                usage=usage,
                job=job or self.job,
                billing=billing_source or billing_of(model),
                member_id=member_id if member_id is not None else self.member_id,
            )
        except Exception as exc:
            logger.warning("Could not record what the assistant spent: %s", type(exc).__name__)

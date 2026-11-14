"""One task as the core sees it while it runs: the answers to the worker's `host.chat` and `host.tool`.

A `TaskRun` is the gate between a task and the world. The worker asks it for a model reply or for a
tool call; it decides whether to give them, and gives them itself. In order:

- **Limits.** Before every call it checks that the task was not cancelled, that it has not stalled
  (no model reply and no tool came back for `RunLimits.seconds`: a task has no clock, only
  silence ends it), that it has model calls and tool calls left, and, for a paid model, that it has
  not spent the money cap (`cost_cap`; a subscription spends nothing and has none). A call it
  refuses is answered with `WORKER_STOPPED` and the kind, and the task ends there with no more
  spend, but for one last model call with no tools (`WRAP_UP`) that says where the task stands. The
  worker counts the limits too; this is the count that counts.
- **The model.** The key is read here, by the client, and nowhere else. The tools the model is offered
  are the snapshot's, whatever the worker sent; every reply is paid for into the spend (purpose
  "agent") and into the task's own total, with `data_collection: deny` as for every call.
- **The tools.** A name that is not in the snapshot is not a tool. A tool of a plugin goes through the
  gate (`agent.gate`), which asks the tier it has now, not the one it had when the task began, and
  writes the audit with the task's id; a tool of Raphael's own (the weather, a web search, the time)
  is checked by the gate too and audited the same way. What a tool returns goes back as it is: the
  worker marks it as untrusted data.
- **The owner's safety rules.** A plugin's tool that its server does not say only reads is judged
  by the rules before it is called (`ToolGate.screen`, paid into the task's ledger). A rule that
  forbids it refuses the call ("forbidden": the model is told which rule, and the call is not
  made). A rule that asks, or a tier of T2 or more, makes the call wait for the owner: the run
  keeps it (`waiting`) and stops the task with "waiting", and the background service turns that
  into a question in the app (`service`). Only a run that may wait (`can_wait`, the service's) does
  so; any other refuses such a call as before. When the owner has answered, the service has the
  run make the call itself with the yes (`answer_call`), and the task goes on from where it was.
- **Addresses.** `web_read` reads a page only at an address the task has seen (`SeenUrls`): in the
  task's request, or in what one of its tools returned before (search results, a page read, a
  plugin's answer), exactly or as the same page (the same origin and path). Any other is refused
  with the kind "url_not_seen", and nothing is fetched: a page cannot make the task send what it
  knows to an address of the page's making. The addresses are kept in the run, in memory.
- **Files.** `read_attachment` reads one of the files handed over with the task, by its number,
  from memory: never a path.
- **The team.** `ask_member` and `create_member` (`agent.team`) are made by the assistant for the
  task's speaker (`team`), through the gate like the rest; the member asked answers on this task's
  ledger, so what it spends counts toward the task's own limit and the month's. `create_member` is
  judged by the safety rules first, like a plugin's tool that changes something: forbidden, or made
  to wait for the owner (and then made by `answer_call` too).

Each call, whatever came of it, leaves a step (`TaskStore.add_step`): the tool, its tier, how it
ended, what it cost; never an argument or a result. A task that was cancelled while a plugin's tool
was under way is told so (`call_cut_off`): the call may or may not have been made.

Nothing here logs an argument, a result or what the task is about.
"""

import asyncio
from ..computer.local_tools import command_context, run_context, is_local
import hashlib
import json
import logging
import sqlite3
import time
from collections.abc import Awaitable, Callable, Sequence
from contextlib import AbstractContextManager, nullcontext
from dataclasses import dataclass
from http import HTTPStatus
from typing import Any, Protocol, TypeVar

from ..agent.failure import failure_kind
from ..failures import Failure
from ..agent.gate import ToolGate
from ..agent.harness_tools import CALENDAR_LIST, CALENDAR_TOOLS, CALENDAR_WRITES, DEFINITIONS as HARNESS_DEFINITIONS
from ..agent.ledger import Ledger
from ..agent.plugins import MAX_ARGUMENT_CHARS, PluginResult
from ..brain.prompt_cache import cache_options
from ..agent.steps import reason_of
from ..agent.policy import Action, Approval, NotApproved, Tier, UnknownTool
from ..agent.safety import ASK, DENY, PASS, Proposed, Screening, narrow_scope, needs_yes, summarize
from ..agent.team import ASK_MEMBER, CREATE_MEMBER, TEAM_TOOLS
from ..agent.team import description as team_description
from ..agent.tools import ToolResult, Tools
from ..brain.catalog import LLM, find
from ..brain.model_ref import short_name
from ..brain.openrouter import OpenRouterError, TextCompletion
from ..brain.providers.base import ModelProvider
from ..brain.providers.registry import for_purpose
from ..brain.textnorm import public_line
from ..conversation_language import chat_language
from ..brain.pricing import builtin_catalog
from ..computer.vm_catalog import NOTICES
from ..brain.spend import SpendTracker
from ..integrations.pool import McpPool
from ..protocol import WORKER_STOPPED, RpcError, invalid_params
from ..retry_utils import MODEL_SILENCE_S, Outage
from ..services.attachments import Attachment
from ..services.file_reader import read_window
from ..services.urls import SeenUrls
from ..worker.context import CONTEXT_OVERFLOW, is_context_overflow, provider_window, smaller_output
from ..worker.loop import MORE_ROOM, REPLY_TOKENS, WAITING, WRAP_UP, FINAL_REPORT, ToolOutcome, result_text
from ..members.activity import current, tool_step
from ..own_calendar import CalendarError
from .routine_outcome import REFUSED_KINDS
from .snapshot import BUILTIN, FIND, MCP, NOTHING_FITS, USE, USE_REFUSALS, USE_TOOL, Snapshot, ToolRef
from .tasks import TaskStore

logger = logging.getLogger(__name__)

T = TypeVar("T")

# One model reply may be this long. How long it may take is up to the model: the call ends when its connection has been
# silent for `MODEL_SILENCE_S` (or the task has stalled), not at a clock of its own.
CHAT_MAX_TOKENS = REPLY_TOKENS
# A long task's checkpoint: longer than a reply, as it reads a long conversation (`worker.context`).
SUMMARY_TIMEOUT_S = 120.0
# The most of a tool's result that goes to the worker, in characters. It cuts it to what the model's
# window holds, keeping both ends (`worker.guards.result_limit`), so this only bounds the message.
MAX_RESULT_CHARS = 200_000
# The tools whose call is paid: the search (by a model, or a service), the reading of a file, and
# asking another member (who answers with model calls of its own, on this task's ledger).
_PAID_TOOLS = ("web_search", "read_attachment", ASK_MEMBER)


# A model call whose cost is not known, and whose model has no price we know, is charged this.
UNKNOWN_COST_FLOOR_USD = 0.02
# A character is counted as a third of a token in the estimate, which is more than the usual
# quarter: the estimate is meant to be too high rather than too low.
_CHARS_PER_TOKEN = 3.0


def task_cache_session(task) -> str | None:
    """The name a task's calls give their provider's cache (brain/prompt_cache.py): a member speaking in one
    group thread is one conversation, as is a task with everything it handed on."""
    if task is None:
        return None
    if task.scope == "room" and task.room_id is not None:
        return f"raphael-room-{task.room_id}-{task.thread_id}-{task.member_id}"
    return f"raphael-task-{task.root_task_id or task.id}"


def estimate_cost(model: str, request_chars: int) -> float:
    """What a model call is charged when nobody said what it cost (the reply had no usage, or it was
    given up on after a time-out or a cancel, when the provider may still bill it): the request's
    characters as input tokens plus the most the reply may be (`CHAT_MAX_TOKENS`), at the model's
    price; a model whose price is not known costs the floor, US$0.02."""
    # The owner's plan has no price per call.
    if model.startswith("@chatgpt:"):
        return 0.0
    entry = find(builtin_catalog(), LLM, model)
    price = None if entry is None else entry.price
    if price is None or price.input_per_mtok is None or price.output_per_mtok is None:
        return UNKNOWN_COST_FLOOR_USD
    tokens_in = request_chars / _CHARS_PER_TOKEN
    cost = (tokens_in * price.input_per_mtok + CHAT_MAX_TOKENS * price.output_per_mtok) / 1_000_000
    return cost


@dataclass(frozen=True)
class RunLimits:
    """Safety bounds of one task. They are far from what honest work reaches: a task that keeps
    working goes on for hours. `seconds` is the stall time, the longest the task may go without a
    model reply or a tool coming back. The money cap is the owner's setting (`TaskRun.cost_cap`)."""

    model_calls: int = 1000
    tool_calls: int = 2000
    seconds: float = 1800.0


def stopped(kind: str, detail: str | None = None, *, window: int | None = None) -> RpcError:
    """The answer to a call the task may not make: it ends the task. `kind` is one of
    `worker.loop.Stop`'s kinds."""
    data = {"stop": kind, "detail": detail, **({"window": window} if window is not None else {})}
    return RpcError(WORKER_STOPPED, "The task may not go on", data)


async def summary_reply(client: ModelProvider, model: str, *, system: str, user: str, max_tokens: int) -> TextCompletion:
    """A model's reply for a long task's checkpoint: on the memory's model, as a conversation's summary
    is (the task's own, unless the owner chose another). One chosen for it that cannot answer, for want
    of a key say, gets no more tries than this: the task's own model is asked once."""
    call = dict(model=model, system=system, user=user, timeout_s=SUMMARY_TIMEOUT_S,
                max_tokens=max_tokens, reasoning_effort="none")
    memory = for_purpose(client, "memory")
    try:
        return await memory.chat_text(**call)
    except OpenRouterError:
        if memory is client or memory.model_for(model) == client.model_for(model):
            raise
    return await client.chat_text(**call)


# The same call of a connected app that has failed this many times in a row with the same error is not made again.
REPEAT_REFUSED_AT = 2


def _outcome_of(result: PluginResult) -> str:
    """How a call of a plugin's tool ended, as the audit and the steps say it."""
    if result.ok:
        return "ok"
    if result.kind == "timeout":
        return "timeout"
    if result.kind == "cancelled":  # sent, and the connection ended: it may have been made
        return "cancelled"
    if result.kind in ("blocked", "changed", "gone", "approval_required", "secret_store"):
        return "blocked"
    return "error"


def _refused() -> dict[str, Any]:
    return {"ok": False, "kind": "blocked", "content": "", "truncated": False}


# What the model is told of a call that a rule of the owner's forbids, and of one the owner said no
# to (the rule is in the owner's own words).
FORBIDDEN_BY_RULE = (
    "The owner's safety rule 「{rule}」 forbids this call, so it was not made. Do not try it another "
    "way: do the rest of the task without it, and say in the report what was not done."
)
OWNER_SAID_NO = (
    "The owner said no to this call, so it was not made. Do not make it or anything like it: do "
    "the rest of the task without it, and say in the report what was not done."
)
OWNER_SAID_NO_BEFORE = (
    "The owner already said no to a call of this task, so this one was not made either: a way round a no "
    "is not tried. Do the rest of the task without it, and say in the report what was not done."
)
NO_ANSWER = (
    "Nobody answered in time (thirty minutes), so this call was not made; it was not refused. Do the rest without it, "
    "and say in the report what was not done and that the owner can ask again."
)
NO_ANSWER_BEFORE = (
    "Nobody answered an earlier question about this tool in time, so this call was not made and is not asked again. "
    "Do the rest without it, and say in the report what was not done."
)
NOT_MADE_WHILE_WAITING = (
    "This call was not made: the task paused for the owner's answer to an earlier call of the same "
    "reply. Make it again if it is still needed."
)


@dataclass
class Waiting:
    """A call that waits for the owner's yes (a plugin's tool, or `create_member` that a rule asks
    about): the alias the worker called it by,
    the tool, what it is given (in memory only), the id of the call, the tier it was asked at, and
    what the safety rules said of it."""

    alias: str
    ref: ToolRef
    arguments: dict
    call_id: str
    tier: Tier
    screening: Screening
    owner_card: str | None = None


class TaskRun:
    """A task that is running. Everything here runs on the event loop.

    `client` is the OpenRouter client, `gate` the one gate, `tools` Raphael's own lookups, `ledger`
    the task's paid calls (it writes the spend). `spend` and `monthly_limit` remain compatible
    constructor arguments; monetary settings do not stop a task. `city` reads its setting when
    asked. `changed` is told after each step so whoever shows the task can update it.
    """

    def __init__(
        self,
        *,
        task_id: int,
        language: str,
        model: str,
        limits: RunLimits,
        snapshot: Snapshot,
        client: ModelProvider,
        gate: ToolGate,
        tools: Tools,
        ledger: Ledger,
        store: TaskStore,
        spend: SpendTracker,
        monthly_limit: Callable[[], float],
        city: Callable[[], str],
        changed: Callable[[], None] = lambda: None,
        progress: Callable[[str], None] = lambda text: None,
        clock: Callable[[], float] = time.monotonic,
        memory: "MemoryReader | None" = None,
        request: str = "",
        attachments: Sequence[Attachment] = (),
        team: "TeamCall | None" = None,
        can_wait: bool = False,
        ask_before_members: bool = False,
        diagnostics: Callable[[], dict] | None = None,
        cost_cap: Callable[[], float] | None = None,
        calendar: "Callable[[str, dict], Awaitable[dict]] | None" = None,
        owner_tool=None,
        attachment_store=None,
        artifact=lambda payload: None,
        reply=None,
    ) -> None:
        self._attachment_store, self._artifact = attachment_store, artifact
        self.activity = current()
        # The most this task may spend, as the owner's setting says now; None for none.
        self._cost_cap = cost_cap
        self._wrapped_up = False
        # The ceiling a CLI task was told to report at (its own model calls are not ours to refuse).
        self.ceiling: str | None = None
        # What a call of a tool is made inside: whose turn at the shared screen it is, and where to say that it
        # waits. A call comes in on the worker's request, not in the task's own context, so the service gives it.
        self.scope: Callable[[], AbstractContextManager] = nullcontext
        # The app's own calendar (`own_calendar.OwnCalendar.tool`), for this task's speaker.
        self._calendar = calendar
        self._owner_tool = owner_tool
        self._memory = memory
        self._memory_untrusted = bool(attachments) or any(
            step.tool in ("web_search", "web_read", "read_attachment", "ask_member", "computer")
            or step.server not in (None, "", "Raphael") or step.detail == "external_content"
            for step in store.steps(task_id))
        self._diagnostics = diagnostics
        # The team tools (`agent.team`), made for this task's speaker on this task's ledger.
        self._team = team
        self.handoff_receipts = []
        self.model_failure: Failure | None = None
        # Whether a call that needs the owner's yes pauses the task (the background service's runs)
        # or is refused (any other).
        self.can_wait = can_wait
        self.ask_before_members = ask_before_members
        # The call the task paused on, until the service takes it.
        self.waiting: Waiting | None = None
        # The tools the owner said no to in this task: none of them is tried again, and no other tool of a
        # connection that changes something is tried in its place (a synonym is no way round a no).
        self._declined: set[str] = set()
        # The tools whose question nobody answered in time: they are not asked about again in this task, and nothing
        # else is held back by it (what needs no yes goes on).
        self._unanswered: set[str] = set()
        # The files of the task, by number from 1, and the addresses it has seen (see the module).
        self.attachments = list(attachments)
        self.seen_urls = SeenUrls([request])
        # The task's own words: a tool that names something per language names it in theirs, never the interface's.
        self._request = request
        self.tool_allowed = lambda _key: True
        self.task_id = task_id
        self.language = language
        self.model = model
        self.limits = limits
        self.snapshot = snapshot
        self.ledger = ledger
        self._max_tokens = CHAT_MAX_TOKENS
        self.model_calls = 0
        self.tool_calls = 0
        # Something was done outside: a call succeeded and was not a read (`_note_action`). Reading is not acting.
        self.acted = False
        # The tools of the run that went through, and the last call of a tool that was refused with nothing after it
        # that went through: how a routine's run is told to have ended well or not (`routine_outcome`).
        self.succeeded: set[str] = set()
        # A connected app's call (tool, arguments) -> the digest of the error it last failed with and how many times in a row.
        self._failed_calls: dict[tuple[str, str], tuple[str, int]] = {}
        self._failures_told: dict[tuple[str, str], str] = {}
        self.last_refused: tuple[str, str] | None = None
        self.cancelled = False
        self.timed_out = False
        # A call of a plugin's tool was under way when the task was cancelled: it may have been made.
        self.call_cut_off = False
        self._client = client
        self._gate = gate
        self._tools = tools
        self._store = store
        initial = store.get(task_id)
        self._memory_owner_text = request if (initial and initial.scope == "private" and
            initial.routine_id is None and initial.from_member_id is None and initial.parent_task_id is None) else ""
        self.generation = initial.generation if initial else 0
        self._spend = spend
        self._monthly_limit = monthly_limit
        self._city = city
        self._changed = changed
        self._progress, self._reply = progress, reply
        self.public_progress = ""
        self.action = lambda name, arguments: nullcontext()
        self._clock = clock
        self.deadline = clock() + limits.seconds
        self._live: set[asyncio.Task[Any]] = set()
        self._in_plugin_call = False
        # The connections of the task's plugin calls: one for each server, kept for the task and
        # closed by whoever ends it (`pool.aclose`).
        self.pool = McpPool()
        # One call at a time: the worker may send several at once. A call waits for the one before it and checks the
        # limits only when its turn comes.
        self._turn = asyncio.Lock()
        self.room_budget = None
        # A reply in a room: each of its model attempts has the whole stall time, and one that hears nothing for all of
        # it has stalled and ends the reply rather than being tried again. A reply is no work to ride an outage out for.
        self.room_speech = False
        # How long one tool call may be out before the task counts as stalled, where that is longer than the
        # window of the model's silence (`limits.seconds`); None: the same.
        self.tool_seconds: float | None = None
        # The task's stall time ran out (`limit_time`).
        self.stalled = False

    # --- cancelling -----------------------------------------------------------------------------

    def cancel(self) -> None:
        """The user stopped the task: nothing more is answered, and the call under way is given up."""
        self.cancelled = True
        if self._in_plugin_call:
            self.call_cut_off = True
        for task in list(self._live):
            task.cancel()

    async def _guarded(self, work: Awaitable[T]) -> T:
        """Await `work` as a task of its own, so that `cancel` can end it. A call ended that way
        is `stopped("cancelled")`; being cancelled from outside passes through."""
        task = asyncio.ensure_future(work)
        self._live.add(task)
        try:
            return await task
        except asyncio.CancelledError:
            if self.cancelled and task.cancelled():
                raise stopped("cancelled") from None
            raise
        finally:
            self._live.discard(task)
            if not task.done():
                task.cancel()

    def _check(self, *, model: bool = False, tool: bool = False, paid: bool = False, final: bool = False) -> None:
        """Refuse a call the task may not make: `stopped(kind)`. The `final` call that says where a
        stopped task stands is held to nothing but the owner's stop."""
        current = self._store.get(self.task_id)
        if self.cancelled or (current and (current.generation != self.generation or current.state in ("cancelled", "interrupted"))):
            raise stopped("cancelled")
        if final:
            return
        if self._clock() >= self.deadline:
            self.stalled = True
            raise stopped("limit_time")
        if (model or paid) and self._cost_cap is not None and self.ledger.total >= self._cost_cap():
            raise stopped("limit_cost")
        if self.room_budget is not None:
            if self.ledger.total >= self.room_budget():
                raise stopped("limit_cost")
            if self._spend.is_over(self._monthly_limit()):
                raise stopped("limit_month")
        if model and self.model_calls >= self.limits.model_calls:
            raise stopped("limit_model")
        if tool and self.tool_calls >= self.limits.tool_calls:
            raise stopped("limit_tool")

    def _remaining_s(self) -> float:
        return max(self.deadline - self._clock(), 0.0)

    def remaining_s(self) -> float:
        """How long the task may still stay silent before it counts as stalled."""
        return self._remaining_s()

    def touch(self, waiting: float = 0.0) -> None:
        """The task did something (a model replied, a tool came back): the stall time starts again. `waiting` is a wait
        the task chose before its next attempt, which is no stall either: the stall time starts after it."""
        self.deadline = self._clock() + self.limits.seconds + waiting

    async def watch(self, work: Awaitable[T], *, extra: float = 0.0, stalled: Callable[[], Any] | None = None) -> T:
        """Await `work` for as long as the task is not stalled: `TimeoutError` once `seconds` (and
        `extra`, for what `work` does before the task can speak: a worker that is started first) have
        passed with nothing heard. `work` is given up on then; with `stalled`, which is told first, it
        is left to end itself."""
        task = asyncio.ensure_future(work)
        try:
            while True:
                wait = self.deadline + extra - self._clock()
                if wait <= 0:
                    if stalled is not None:
                        stalled()
                        await asyncio.gather(task, return_exceptions=True)
                    raise TimeoutError
                done, _ = await asyncio.wait({task}, timeout=wait)
                if done:
                    return task.result()
        finally:
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)

    def reopen(self) -> None:
        """Make the run ready to go on after a pause: the time it waited was not the task's, so its
        stall time starts again; it has a new pool of connections (the old one was closed when it
        paused), and no call waits."""
        self.touch()
        self.timed_out = self.stalled = False
        self.waiting = None
        self.pool = McpPool()

    # --- the steps ------------------------------------------------------------------------------

    def _step(self, **fields: Any) -> int | None:
        step_id = None
        try:
            step_id = self._store.add_step(self.task_id, **fields)
            self._store.progress(
                self.task_id,
                model_calls=self.model_calls,
                tool_calls=self.tool_calls,
                cost_usd=self.ledger.total,
            )
        except sqlite3.Error as exc:
            logger.warning("Could not write down a step: %s", type(exc).__name__)
        self._changed()
        return step_id

    def _end_step(self, step_id: int | None, **fields: Any) -> None:
        """End the step of a call that was written when it was sent; or write it now if that
        could not be done."""
        if step_id is None:
            self._step(kind="tool", **fields)
            return
        try:
            self._store.update_step(
                step_id,
                outcome=fields["outcome"],
                tier=fields.get("tier"),
                ms=fields.get("ms", 0),
                reason=fields.get("reason"),
                detail=fields.get("detail"),
                cost_usd=fields.get("cost_usd"),
            )
            self._store.progress(
                self.task_id,
                model_calls=self.model_calls,
                tool_calls=self.tool_calls,
                cost_usd=self.ledger.total,
            )
        except sqlite3.Error as exc:
            logger.warning("Could not write down a step: %s", type(exc).__name__)
        self._changed()

    # --- host.chat ------------------------------------------------------------------------------

    async def chat(self, params: dict) -> dict:
        """A reply of the model to the conversation the worker sends, with the tools of the
        snapshot."""
        messages = params.get("messages")
        if not isinstance(messages, list) or not all(isinstance(m, dict) for m in messages):
            raise invalid_params("messages must be a list of messages")
        if not messages:
            raise invalid_params("messages is empty")
        room = params.get("room", 1)
        if type(room) is not int or not 1 <= room <= MORE_ROOM:
            raise invalid_params("room must be a small whole number")
        # Desktop images have a separate byte budget; they must not consume the
        # text cap or be estimated as millions of text tokens.
        request_chars = 0
        image_chars = 0
        for message in messages:
            content = message.get("content")
            if isinstance(content, list):
                request_chars += len(json.dumps({key: value for key, value in message.items() if key != "content"}, ensure_ascii=False))
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "image_url" and isinstance(part.get("image_url"), dict) and isinstance(url := part["image_url"].get("url"), str) and url.startswith("data:image/"):
                        image_chars += len(url)
                    else:
                        request_chars += len(json.dumps(part, ensure_ascii=False))
            else:
                request_chars += len(json.dumps(message, ensure_ascii=False))
        async with self._turn:
            if messages[-1].get("role") == "user" and messages[-1].get("content") in (WRAP_UP, FINAL_REPORT):
                return await self._wrap_up(messages, request_chars)
            # A conversation's length is the worker's to keep to the window (`worker.context`), and the provider's
            # to refuse: it is no reason to stop a job. Screenshots have no window to answer to.
            if image_chars > 14_000_000:
                raise stopped("limit_model")
            return await self._chat(messages, request_chars, room)

    async def summarize(self, params: dict) -> dict:
        """A long task's checkpoint, on the task's ledger. It is the run's upkeep: no model call of
        the limits, and no step. A model that fails is the worker's to deal with (`worker.context`)."""
        system, user, max_tokens = params.get("system"), params.get("user"), params.get("max_tokens")
        if not isinstance(system, str) or not isinstance(user, str) or type(max_tokens) is not int or max_tokens <= 0:
            raise invalid_params("system and user must be strings and max_tokens a positive whole number")
        async with self._turn:
            self._check(paid=True)
            began = time.perf_counter()
            reply = await self._guarded(summary_reply(self._client, self.model, system=system, user=user, max_tokens=max_tokens))
            self.touch()
            self.ledger.add(model=reply.model, cost_usd=reply.cost_usd, usage=getattr(reply, "usage", None), prompt_tokens=reply.prompt_tokens,
                            completion_tokens=reply.completion_tokens, ms=_ms(began))
            return {"text": reply.text}

    async def _wrap_up(self, messages: list[dict], request_chars: int) -> dict:
        """The one model call after a ceiling: no tools, held to nothing but the owner's stop. A task
        that was stalled gets a fresh stall time for it."""
        self._check(final=True)
        if self._wrapped_up:
            raise stopped("limit_model")
        if self.room_speech and self.stalled:
            # A room shows a reply that stalled as a status line, so its last word would only take another stall time.
            raise stopped("limit_time")
        self._wrapped_up = True
        self.touch()
        return await self._chat(messages, request_chars, wrap_up=True)

    async def _chat(self, messages: list[dict], request_chars: int, room: int = 1, *, wrap_up: bool = False) -> dict:
        self._check(model=True, paid=True, final=wrap_up)
        previous_tools = list(self.snapshot.definitions)
        self.model_calls += 1
        self.model_failure = None
        began = time.perf_counter()
        try:
            from ..failures import PATIENT_WAITS, RETRY_WAITS, classify
            # Asking again repeats nothing, since the tools run only after a reply: a task that has done something outside
            # rides a failed call out for as long as its time lasts. Before that, and after reads alone, it fails in
            # seconds, as a question does.
            outage = Outage(RETRY_WAITS, PATIENT_WAITS, patient_ok=self.acted and not self.room_speech)
            while True:
                remaining = self._remaining_s()
                try:
                    task = self._store.get(self.task_id)
                    self.snapshot.refresh_plugins(self._gate.plugins, task.member_id if task else 0)
                    turn = await self._guarded(asyncio.wait_for(self._client.chat_tools(
                        model=self.model,
                        # The task's own model answers with all of its time: live, a fallback model
                        # took over slow replies, each attempt getting a third of the time.
                        fallbacks=[],
                        messages=messages,
                        # The snapshot's tools, whatever the worker sent; none for the last word of a stopped task.
                        tools=[] if wrap_up else self.snapshot.definitions,
                        timeout_s=min(MODEL_SILENCE_S, remaining),
                        max_tokens=self._max_tokens * room,
                        reasoning_effort="none",
                        # Work that calls every few seconds and is done: one place, five minutes (decisions 1, 4).
                        **cache_options(task_cache_session(task), "5m"),
                    ), remaining))
                    break
                except RpcError:
                    raise
                except Exception as error:
                    if (smaller := smaller_output(error, self._max_tokens * room)) is not None:
                        self._max_tokens, room = smaller, 1
                        continue
                    if is_context_overflow(error):
                        raise
                    failure = classify(error)
                    wait = outage.wait(failure.retry_after) if failure.transient else None
                    # A room reply's attempt that heard nothing for its whole stall time has stalled, and ends the
                    # reply; any other failure is tried again with all of its own time (Hermes's delegate heartbeat).
                    if wait is None or (failure.kind == "timeout" if self.room_speech else wait >= self._remaining_s()):
                        raise
                    if failure.kind == "timeout":
                        self._charge_estimate(request_chars)  # the provider may bill what was given up on
                    if outage.announce(wait):
                        self._progress(failure.waiting(short_name(self.model), self.language, wait))
                    if self.room_speech:
                        self.touch(waiting=wait)
                    await self._guarded(asyncio.sleep(wait))
                    if self.room_speech:
                        self.touch()
        except OpenRouterError as error:
            if is_context_overflow(error):  # refused unread: no cost and no failed step, as the worker sends it again
                raise stopped("failed", CONTEXT_OVERFLOW, window=provider_window(error)) from None
            logger.warning(
                "The task's model failed: kind=%s status=%s", error.kind, error.status
            )
            # With every parameter required, "no endpoint found" is a model that takes no tools.
            detail = "tools" if error.status == HTTPStatus.NOT_FOUND else failure_kind(error)
            if error.kind == "timeout":
                self._charge_estimate(request_chars)
            diagnostic = classify(error, record=False)
            self.model_failure = diagnostic
            if diagnostic.missing is not None:
                missing = diagnostic.missing
                reason = diagnostic.kind if diagnostic.kind.startswith("chatgpt_") else "provider_" + missing.state
                self._step(kind="model", tool="provider", outcome="error", ms=_ms(began), reason=reason, detail=missing.resource)
            else:
                self._step(kind="model", outcome="error", ms=_ms(began), reason=reason_of("error", detail))
            raise stopped("failed", detail) from None
        except TimeoutError:
            logger.warning("The task's model timed out")
            self.stalled = True
            self._charge_estimate(request_chars)  # the provider may bill what was given up on
            self._step(kind="model", outcome="timeout", ms=_ms(began), reason="timeout")
            # The only clock a call has is the task's time: not the monotonic clock, which a timer that fires a
            # tick early leaves just short of the deadline.
            raise stopped("limit_time") from None
        except RpcError:
            self._charge_estimate(request_chars)  # cancelled while the provider was working
            raise
        except Exception as exc:
            logger.warning("The task's model failed unexpectedly: %s", type(exc).__name__)
            self._step(kind="model", outcome="error", ms=_ms(began), reason="error")
            raise stopped("failed", "error") from None
        self.touch()
        cost = turn.cost_usd
        if not turn.usage_known:  # no usage is not a free call
            cost = max(cost, estimate_cost(self.model, request_chars))
        self.ledger.add(
            model=turn.model,
            cost_usd=cost,
            usage=getattr(turn, "usage", None), prompt_tokens=turn.prompt_tokens,
            completion_tokens=turn.completion_tokens,
            ms=_ms(began),
        )
        self._step(kind="model", outcome="ok", cost_usd=cost, ms=_ms(began))
        if turn.calls and turn.content.strip():
            from ..agent.answers import public_reply
            authored = public_reply(turn.content, self.language, plain=True, explicit=True)
            if authored is not None and self._reply is not None:
                self._reply(authored)
            text = " ".join(turn.content.split())[:200]
            text = public_line(text, "auto")
            if text:
                self._progress(text)
        return {
            "content": turn.content,
            **({"tools": list(self.snapshot.definitions)} if not wrap_up and previous_tools != self.snapshot.definitions else {}),
            **({"responses_output": turn.responses_output} if getattr(turn, "responses_output", None) else {}),
            # Only a reply the output limit cut off is reported as such.
            **({"finish_reason": "length"} if getattr(turn, "finish_reason", "") == "length" else {}),
            **({"prompt_tokens": turn.prompt_tokens} if turn.prompt_tokens else {}),
            "calls": [
                {"id": c.id, "name": c.name, "arguments": c.arguments, "raw": c.raw_arguments}
                for c in turn.calls
            ],
        }

    def _charge_estimate(self, request_chars: int) -> None:
        self.ledger.add(model=self.model, cost_usd=estimate_cost(self.model, request_chars))

    # --- host.tool ------------------------------------------------------------------------------

    async def tool(self, params: dict) -> dict:
        """The result of a call of a tool of the snapshot. A use_tool call is the call of the tool it names,
        listed or found: the same limits, gate, steps and audit, under that tool's name."""
        if params.get("name") == USE_TOOL:
            task = self._store.get(self.task_id)
            self.snapshot.refresh_plugins(self._gate.plugins, task.member_id if task else 0)
            used = self.snapshot.use(params.get("arguments"))
            if not isinstance(used, str):
                params = {**params, "name": used[0], "arguments": used[1]}
        return await self._call(params)

    @tool_step(lambda self, params: params.get("name", ""), scope=lambda self, params: self.activity)
    @command_context(lambda self, *args, **kwargs: run_context(self))
    async def _call(self, params: dict) -> dict:
        name, arguments = params.get("name"), params.get("arguments")
        if not isinstance(name, str) or not isinstance(arguments, dict):
            raise invalid_params("name must be a string and arguments an object")
        call_id = params.get("call_id")
        async with self._turn:
            # A tool in flight is no stall (owner, 2026-11-09): the window watches the model's silence. A reply in
            # a group has a short one, and asking a colleague (ask_member) takes that colleague's whole turn: the
            # call has as long as any task's step (`tool_seconds`), and the window starts again when it returns.
            # A task already out of time stays so: its call is refused below, as before.
            longer = (self.tool_seconds or 0.0) - self.limits.seconds
            if longer > 0 and self._clock() < self.deadline:
                self.touch(waiting=longer)
            try:
                with self.action(name, arguments) as status:
                    from ..management import background_management
                    task = self._store.get(self.task_id)
                    with background_management(task.member_id if task else 0):
                        reply = await self._tool(name, arguments, call_id if isinstance(call_id, str) else "")
                    if task and task.turn_id:
                        from ..memory.tool_events import record as record_tool_event
                        ref = self.snapshot.refs.get(name)
                        record_tool_event(self._store._conn, task.turn_id, call_id, name, arguments, reply.get("content", ""),
                                          ok=reply.get("ok", False), kind=reply.get("kind"),
                                          external=bool(ref and (ref.kind == MCP or ref.name in ("web_read", "web_search", "read_attachment"))))
                    if status is not None:
                        status.update(outcome="ok" if reply.get("ok") else "error", reason=reason_of("ok" if reply.get("ok") else "error", reply.get("kind")))
                    return reply
            finally:
                self.touch()

    async def _tool(self, name: str, arguments: dict, call_id: str = "") -> dict:
        ref = self.snapshot.ref(name)
        paying = ref is not None and (ref.kind == BUILTIN and ref.name in _PAID_TOOLS or ref.server == "media")
        self._check(tool=True, paid=paying)
        self.tool_calls += 1
        began = time.perf_counter()
        if ref is None or len(json.dumps(arguments, ensure_ascii=False)) > MAX_ARGUMENT_CHARS:
            # Not a tool the task was given: nothing to call, and nothing to audit.
            self._step(kind="tool", outcome="blocked", ms=_ms(began), reason="blocked")
            if ref is None:
                self.last_refused = (name, "unknown_tool")
            if ref is None and name in self.snapshot._aliases:
                return {**_refused(), "content": "This tool is no longer enabled or connected. Read connections_list for current access; do not retry its old alias."}
            if self.room_speech:
                return {**_refused(),'instruction':'Start this as private work with handoff.','content':'This room is for speech only.'}
            if ref is None:
                return {**_refused(), "content": "This tool is not available to this member. The owner may have disabled its connection in the member's tool list; use find_tools for currently allowed tools." + self._nearby(name)}
            return _refused()
        sent: int | None = None
        detail: str | None = None
        if ref.kind == MCP and (said := self._repeat_refusal(ref, arguments, name)) is not None:
            reply, outcome, tier = {"ok": False, "kind": "repeat_failed", "content": "", "instruction": said, "truncated": False}, "blocked", None
        elif ref.kind == MCP:
            reply, outcome, tier, sent = await self._plugin(ref, arguments, name, call_id)
            self._note_failure(ref, arguments, reply)
            if reply.get("billing"):
                detail = json.dumps(reply["billing"])
                self.ledger.include_media(reply["billing"])
            self._memory_untrusted = True
        elif ref.kind == FIND:
            reply, outcome, tier = self._find(arguments)
        elif ref.kind == USE:
            reply, outcome, tier = self._refused_use(arguments)
        else:
            reply, outcome, tier, detail = await self._builtin(ref, arguments, name, call_id)
        self._note_result(ref, reply)
        self._note_action(ref, arguments, bool(reply.get("ok")))  # before the limits: the call was made
        self._check()
        if reply.get("ok") and isinstance(reply.get("content"), str):
            self.seen_urls.add_from(reply["content"])  # what it returned may be read next
        if ref.name == 'handoff' and reply.get('ok'):
            self.handoff_receipts.append(json.loads(reply['content']))
            reply['kind'] = 'handoff'
        if reply.get('ok') and reply.get('kind') not in NOTICES:
            import hashlib
            self._store.record_evidence(self.task_id,call_id or str(self.tool_calls),kind='tool_receipt',
                uri=ref.key,digest=hashlib.sha256(reply.get('content','').encode()).hexdigest(),mime='text/plain')
        named = arguments.get("name") if ref.kind == USE else None
        fields = {
            # A refused use_tool call is the step of the tool it named: the owner never reads "use_tool".
            "tool": named if isinstance(named, str) and named else ref.name,
            "server": ref.server,
            "tier": tier,
            "outcome": outcome,
            "ms": _ms(began),
            # The kind the reply carries, never its content: a service's own words stay out.
            "reason": reason_of(outcome, reply.get("kind")),
        }
        if detail is not None:
            fields["detail"] = detail
        if reply.get("billing"):
            fields["cost_usd"] = reply["billing"]["cost_usd"] or 0
        if ref.kind == MCP:
            self._end_step(sent, **fields)  # the step written when the call was sent
        else:
            self._step(kind="tool", **fields)
        if reply.get("ok") and (ref is not None and (ref.server == "media" or ref.server == "computer" and ref.name in ("attach_file", "dataset"))):
            from ..services.artifacts import artifact_payload
            payload = artifact_payload(reply.get("content", ""), self._attachment_store)
            if payload:
                self._artifact(payload)
        if not reply.get("ok") and ref.server == "media":
            from ..failures import missing_for
            missing = missing_for(reply.get("kind"), ref.name)
            if missing:
                self._artifact({"missing": missing.wire()})
        return reply

    @staticmethod
    def _call_key(ref: ToolRef, arguments: dict) -> tuple[str, str]:
        return ref.key, hashlib.sha256(json.dumps(arguments, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")).hexdigest()

    def _note_failure(self, ref: ToolRef, arguments: dict, reply: dict) -> None:
        """What a connected app's call failed with, to know the same call again (`_repeat_refusal`). Only a failure that is
        the same on every try counts (the service's own error, or arguments that do not fit); a wait, a timeout, a missing
        yes or a lost connection is tried again as often as the model likes."""
        key = self._call_key(ref, arguments)
        if reply.get("ok") or reply.get("kind") not in ("tool_error", "bad_arguments"):
            self._failed_calls.pop(key, None)
            return
        said = hashlib.sha256(str(reply.get("instruction") or reply.get("content") or "").encode("utf-8")).hexdigest()
        before, count = self._failed_calls.get(key, ("", 0))
        self._failed_calls[key] = (said, count + 1 if before == said else 1)
        self._failures_told[key] = (reply.get("instruction") or reply.get("content") or "")

    def _repeat_refusal(self, ref: ToolRef, arguments: dict, alias: str) -> str | None:
        """Why the same call is not made again: it failed twice in a row with the same error. The model is told what that error
        was, the shape the tool takes, and to find another way (R-TOOL-02). The run goes on: only the task's own budget ends it, and
        a refused repeat is counted in it like any call."""
        key = self._call_key(ref, arguments)
        failed = self._failed_calls.get(key)
        if failed is None or failed[1] < REPEAT_REFUSED_AT:
            return None
        from ..agent.plugins import argument_shape
        try:
            offered = self._gate.plugins.offered() if self._gate.plugins is not None else []
        except Exception:  # a hub that cannot say: the shape is left out, the rest is told
            offered = []
        shape = argument_shape(next((tool.schema for tool in offered if tool.key == ref.key), {}))
        error = " ".join(str(self._failures_told.get(key, "")).split())[:300]
        return (f"{alias} was not called again: this exact call (the same arguments) has already failed {failed[1]} times with the "
                f"same error, so a third try would fail the same way. It said: {error or 'an error'}. "
                + (f"The top-level arguments of {alias} are: {shape}. " if shape else "")
                + "Try a different way: other arguments, another tool, or another source. Do not give up while another way is open.")

    def _note_result(self, ref: ToolRef, reply: dict) -> None:
        """What the run did with its tools, for the judgement of how it ended (`routine_outcome`): the tools that
        succeeded, and the last call of a real tool when it was refused and nothing after it went through."""
        if ref.kind not in (BUILTIN, MCP):
            return
        if reply.get("ok"):
            self.succeeded.add(ref.name)
            self.last_refused = None
        elif reply.get("kind") in REFUSED_KINDS:
            self.last_refused = (ref.name, reply["kind"])

    def _note_action(self, ref: ToolRef, arguments: dict, ok: bool) -> None:
        """A call that succeeded and was not a read is something done outside. What reads is told as the conversation
        tells it (its `made`): a plugin's tool by what its server says (`reads_only`), Raphael's own by the tier T0."""
        if not ok or ref.kind not in (MCP, BUILTIN):
            return
        if not (self._gate.reads_only(ref.server, ref.name, arguments) if ref.kind == MCP else ref.tier == Tier.T0):
            self.acted = True

    def continuation_state(self):
        return {"declined": sorted(self._declined), "unanswered": sorted(self._unanswered), "seen_urls": self.seen_urls.snapshot(), "acted": self.acted,
                "untrusted": self._memory_untrusted, "handoff_receipts": self.handoff_receipts,
                "conversation_cost": getattr(self, "conversation_cost", 0.0),
                "succeeded": sorted(self.succeeded), "last_refused": list(self.last_refused) if self.last_refused else None}

    def restore_continuation(self, state):
        self.succeeded.update(name for name in state.get("succeeded", []) if isinstance(name, str))
        refused = state.get("last_refused")
        self.last_refused = (refused[0], refused[1]) if isinstance(refused, list) and len(refused) == 2 else None
        self._declined.update(state.get("declined", []))
        self._unanswered.update(state.get("unanswered", []))
        for url in state.get("seen_urls", []):
            self.seen_urls.add(url)
        self._memory_untrusted = self._memory_untrusted or state.get("untrusted", False)
        if isinstance(state.get("acted"), bool):
            self.acted = state["acted"]
        self.handoff_receipts = state.get("handoff_receipts", [])
        self.conversation_cost = state.get("conversation_cost", 0.0)

    async def _screen(self, ref: ToolRef, arguments: dict) -> Screening:
        """What the owner's safety rules say of a call: PASS for a tool its server says only reads,
        and for Raphael's own except `create_member` and calendar writes. The judge is paid, so the
        limits on money are read first."""
        if self._gate.is_vm_tool(ref.key) or is_local(ref.key):
            return PASS
        if ref.name == ASK_MEMBER and self.ask_before_members:
            return Screening(ASK)
        if ref.kind == BUILTIN:
            # Of Raphael's own, only adding a member (`agent.team`) and writing to the calendar are judged, by their own names.
            if ref.name in CALENDAR_WRITES or ref.name == "manage_connection":
                self._check(paid=True)
                proposed = Proposed(ref.name, HARNESS_DEFINITIONS[ref.name]["description"], summarize(arguments), narrow_scope(ref.name))
            elif ref.name != CREATE_MEMBER:
                return PASS
            else:
                self._check(paid=True)
                proposed = Proposed(CREATE_MEMBER, team_description(CREATE_MEMBER), summarize(arguments))
        else:
            if self._gate.reads_only(ref.server, ref.name, arguments):
                return PASS
            self._check(paid=True)
            description = ""
            pool = self.snapshot.pool
            if pool is not None:
                tool = next((t for t in pool.by_alias.values() if t.key == ref.key), None)
                description = "" if tool is None else tool.description
            proposed = Proposed(f"{ref.server} / {ref.name}", description, summarize(arguments), narrow_scope(ref.key))
        return await self._guarded(
            self._gate.screen(proposed, language=self.language, ledger=self.ledger)
        )

    async def _plugin(
        self, ref: ToolRef, arguments: dict, alias: str = "", call_id: str = ""
    ) -> tuple[dict, str, str | None, int | None]:
        from ..agent.data_floor import WRITE_REFUSAL
        if not self.tool_allowed(ref.key):
            return {"ok": False, "kind": "tool_disabled", "content": "The owner disabled this connection for this member. Ask the owner to change the member's tool list.", "truncated": False}, "blocked", None, None
        if self._gate.data_floor.access(ref.key, arguments) == "write":
            return {"ok": False, "kind": "protected_data", "content": WRITE_REFUSAL, "truncated": False}, "blocked", None, None
        now = self._gate.tier_now(ref.key, arguments)
        if ref.key in self._unanswered and not self._gate.reads_only(ref.server, ref.name, arguments):
            self._gate.record_unrun(ref.key, outcome="blocked", task_id=self.task_id)
            reply = {"ok": False, "kind": "unanswered", "content": NO_ANSWER_BEFORE, "truncated": False}
            return reply, "blocked", None if now is None else now.name, None
        if self._declined and (ref.key in self._declined or not self._gate.reads_only(ref.server, ref.name, arguments)):
            # The owner said no to something in this task: this tool is not tried again, and no other that changes
            # something is, whatever it is called. Nothing is asked and nothing is made.
            self._gate.record_unrun(ref.key, outcome="blocked", task_id=self.task_id)
            reply = {"ok": False, "kind": "declined", "content": OWNER_SAID_NO_BEFORE, "truncated": False}
            return reply, "blocked", None if now is None else now.name, None
        if now is not None:
            screening = await self._screen(ref, arguments)
            if screening.verdict == DENY:
                reply = {
                    "ok": False,
                    "kind": "forbidden",
                    "content": FORBIDDEN_BY_RULE.format(rule=screening.rule or ""),
                    "truncated": False,
                }
                self._gate.record_unrun(ref.key, outcome="blocked", task_id=self.task_id)
                return reply, "blocked", now.name, None
            if needs_yes((now >= Tier.T2 or self._gate.mode_asks(ref.key, arguments)) and (not self._gate.full_permission or self._gate.firm_confirmation(ref.key, arguments)),
                         screening, firm=now >= Tier.T3):
                if self.can_wait:
                    # The task pauses here; the service asks the owner (see the module).
                    self.waiting = Waiting(alias or ref.name, ref, dict(arguments), call_id, now, screening)
                    raise stopped(WAITING)
                if screening.verdict != PASS.verdict:
                    # A rule asks, and nobody can be asked: the call is not made.
                    self._gate.record_unrun(ref.key, outcome="blocked", task_id=self.task_id)
                    return _refused(), "blocked", now.name, None
        self._in_plugin_call = True
        began = time.perf_counter()
        # Written before the call is sent: if the core dies in the middle of it, the step is
        # still there, and a later attempt is told the call may have been made.
        sent = self._step(
            kind="tool",
            tool=ref.name,
            server=ref.server,
            tier=None if now is None else now.name,
            outcome="in_progress",
            ms=0,
        )
        try:
            with self.scope():
                result = await self._guarded(
                    self._gate.call_plugin(ref.key, arguments, task_id=self.task_id, pool=self.pool)
                )
        except (RpcError, asyncio.CancelledError):
            # The call did not come back: it may or may not have been made. A later attempt is
            # told so.
            self._end_step(
                sent,
                tool=ref.name,
                server=ref.server,
                tier=None if now is None else now.name,
                outcome="cancelled",
                ms=_ms(began),
                reason="cancelled",
            )
            raise
        finally:
            self._in_plugin_call = False
        text, cut = _cut(result.text)
        if not result.ok and now is None and result.kind in ("blocked", "gone", "changed"):
            text = "This tool is no longer enabled or connected. Read connections_list for current access; do not retry its old alias."
        reply = {
            "ok": result.ok,
            "kind": result.kind,
            "content": text,
            "truncated": cut or result.truncated,
            **({"instruction": result.text} if result.kind == "bad_arguments" and result.text else {}),
            **({"blocks": result.blocks} if result.blocks else {}),
            **({"billing": result.billing} if result.billing else {}),
        }
        if ref.server == "computer":
            task = self._store.get(self.task_id)
            if task and self.snapshot.refresh_computer(self._gate.plugins, task.member_id):
                reply.update(tools=list(self.snapshot.definitions), replace_tools=True)
        return reply, _outcome_of(result), None if now is None else now.name, sent

    @tool_step(lambda self, waiting, approval, action, **kwargs: waiting.alias,
               scope=lambda self, *args, **kwargs: self.activity)
    @command_context(lambda self, *args, **kwargs: run_context(self))
    async def answer_call(self, waiting: Waiting, approval: Approval | None, action: Action | None, *, expired: bool = False) -> str:
        from ..management import background_management
        task = self._store.get(self.task_id)
        with self.action(waiting.alias, waiting.arguments) as status, background_management(task.member_id if task else 0):
            return await self._answered_call(waiting, approval, action, status, expired=expired)

    async def _answered_call(self, waiting: Waiting, approval: Approval | None, action: Action | None, status, *, expired: bool = False) -> str:
        """The call the task paused on, now that the owner answered: made with the yes (`approval`,
        for `action`, the very action the question was asked about), or not made after a no
        (`action` None). Either way it is a step of the task, and the audit says what came of it.
        Returns what the model is shown of it, as the worker shows a result."""
        ref = waiting.ref
        if action is None:
            why = "expired" if expired else "denied"
            if status is not None:
                status.update(outcome="blocked", reason=why)
            if expired:
                self._unanswered.add(ref.key)  # the service wrote that it ran out when it did
            else:
                if ref.kind == MCP:
                    self._declined.add(ref.key)
                self._gate.record_unrun(ref.key, outcome="denied", task_id=self.task_id)
            self._step(
                kind="tool", tool=ref.name, server=ref.server, tier=waiting.tier.name,
                outcome="blocked", ms=0, reason=why,
            )  # fmt: skip
            return result_text(waiting.alias, ToolOutcome(False, why, NO_ANSWER if expired else OWNER_SAID_NO))
        if ref.kind == BUILTIN:
            # Adding a member that a rule asked about (T1: the owner's yes is all it waited for).
            began = time.perf_counter()
            result = await self._lookup(ref.name, waiting.arguments, approval=approval, action=action)
            if result.ok and isinstance(result.data, dict) and result.data.get("owner_wait"):
                self.waiting = Waiting(waiting.alias, ref, dict(waiting.arguments), waiting.call_id, waiting.tier, PASS,
                                       result.data["owner_wait"])
                raise stopped(WAITING)
            outcome = "ok" if result.ok else ("timeout" if result.error == "timeout" else "error")
            self._gate.record_builtin(ref.name, outcome=outcome, task_id=self.task_id)
            self._step(
                kind="tool", tool=ref.name, server=ref.server, tier=waiting.tier.name,
                outcome=outcome, ms=_ms(began), reason=reason_of(outcome, result.error),
            )  # fmt: skip
            content = json.dumps(result.shown, ensure_ascii=False) if result.ok else ""
            self._note_result(ref, {"ok": result.ok, "kind": result.error})
            self._note_action(ref, waiting.arguments, result.ok)
            if status is not None:
                status.update(outcome=outcome, reason=reason_of(outcome, result.error))
            return result_text(waiting.alias, ToolOutcome(result.ok, result.error, content))
        if not self.tool_allowed(ref.key):
            return result_text(waiting.alias, ToolOutcome(False, "tool_disabled", "The owner disabled this connection for this member."))
        now = self._gate.tier_now(ref.key, waiting.arguments)
        # The yes is for the tier the question was asked at: a tool that has none now, or a higher
        # one, is not covered by it.
        if now is None or now > waiting.tier:
            approval = None
        began = time.perf_counter()
        sent = self._step(
            kind="tool", tool=ref.name, server=ref.server,
            tier=None if now is None else now.name, outcome="in_progress", ms=0,
        )  # fmt: skip
        self._in_plugin_call = True
        self._memory_untrusted = True
        try:
            with self.scope():
                result = await self._guarded(
                    self._gate.call_plugin(
                        ref.key, waiting.arguments, approval=approval, action=action,
                        task_id=self.task_id, pool=self.pool,
                    )
                )  # fmt: skip
        except (RpcError, asyncio.CancelledError):
            self._end_step(
                sent, tool=ref.name, server=ref.server, tier=None if now is None else now.name,
                outcome="cancelled", ms=_ms(began), reason="cancelled",
            )  # fmt: skip
            raise
        finally:
            self._in_plugin_call = False
        text, cut = _cut(result.text)
        outcome = _outcome_of(result)
        if result.billing:
            self.ledger.include_media(result.billing)
        self._end_step(
            sent, tool=ref.name, server=ref.server, tier=None if now is None else now.name,
            outcome=outcome, ms=_ms(began), reason=reason_of(outcome, result.kind),
            detail=json.dumps(result.billing) if result.billing else None,
            cost_usd=(result.billing["cost_usd"] or 0) if result.billing else None,
        )  # fmt: skip
        if result.ok:
            self.seen_urls.add_from(text)
        self._note_result(ref, {"ok": result.ok, "kind": result.kind})
        self._note_action(ref, waiting.arguments, result.ok)
        shown = ToolOutcome(result.ok, result.kind, text, cut or result.truncated)
        if status is not None:
            status.update(outcome=outcome, reason=reason_of(outcome, result.kind))
        return result_text(waiting.alias, shown)

    def _find(self, arguments: dict) -> tuple[dict, str, str | None]:
        """The snapshot's tools that fit what the task says it wants to do, with what calling one takes.
        It makes no call to a service and no model call, and lists nothing: the task calls what it
        found with use_tool, and its list (the provider's cache) stays as it is."""
        query = arguments.get("query")
        if not isinstance(query, str) or not query.strip():
            return {"ok": False, "kind": "bad_arguments", "content": "", "truncated": False}, "error", "T0"
        _, lines = self.snapshot.find(query)
        return {"ok": True, "kind": None, "content": "\n".join(lines) or NOTHING_FITS, "truncated": False}, "ok", "T0"

    def _nearby(self, name: object) -> str:
        """The tools of the task closest to a name that is none of them, said to the model so that the run goes on."""
        near = self.snapshot.nearest(name)
        return f" The nearest tools of this task: {', '.join(near)}." if near else ""

    def _refused_use(self, arguments: dict) -> tuple[dict, str, str | None]:
        """A use_tool call that names no tool of the task, or gives it no object of arguments: `tool` makes
        every other as the call of the tool it names."""
        kind = self.snapshot.use(arguments)
        kind = kind if isinstance(kind, str) else "unknown_tool"
        named = arguments.get("name") if isinstance(arguments, dict) else None
        if kind in ("unknown_tool", "unavailable"):
            self.last_refused = (named if isinstance(named, str) else USE_TOOL, kind)
        told = USE_REFUSALS[kind] + (self._nearby(named) if kind == "unknown_tool" else "")
        return {"ok": False, "kind": kind, "content": "", "instruction": told, "truncated": False}, "blocked", "T0"

    async def _builtin(
        self, ref: ToolRef, arguments: dict, alias: str = "", call_id: str = ""
    ) -> tuple[dict, str, str | None, str | None]:
        """(the reply, how it ended, the tier, the service it used) of one of Raphael's own."""
        gate = self._gate
        tier = gate.tier_now(ref.key, arguments)
        firm = gate.firm_confirmation(ref.key, arguments)
        from ..agent.harness_tools import CONNECTION_TOOLS
        judged = firm or ref.name == CREATE_MEMBER or ref.name in CALENDAR_WRITES or ref.name == "manage_connection"
        try:
            if not judged:
                gate.check(Action(ref.key, arguments), None, worker=True)
        except (UnknownTool, NotApproved):
            gate.record_builtin(ref.name, outcome="blocked", task_id=self.task_id)
            return _refused(), "blocked", None if tier is None else tier.name, None
        if (judged or (ref.name == ASK_MEMBER and self.ask_before_members)) and tier is not None:
            screening = await self._screen(ref, arguments)
            if screening.verdict == DENY:
                gate.record_builtin(ref.name, outcome="blocked", task_id=self.task_id)
                reply = {
                    "ok": False,
                    "kind": "forbidden",
                    "content": FORBIDDEN_BY_RULE.format(rule=screening.rule or ""),
                    "truncated": False,
                }
                return reply, "blocked", tier.name, None
            if needs_yes(tier >= Tier.T2, screening, firm=firm) and (firm or not gate.full_permission):
                if ref.key in self._unanswered:  # an earlier question about this tool ran out: not asked again in this task
                    gate.record_builtin(ref.name, outcome="blocked", task_id=self.task_id)
                    return {"ok": False, "kind": "unanswered", "content": NO_ANSWER_BEFORE, "truncated": False}, "blocked", tier.name, None
                if self.can_wait:
                    self.waiting = Waiting(alias or ref.name, ref, dict(arguments), call_id, tier, screening)
                    raise stopped(WAITING)
                gate.record_builtin(ref.name, outcome="blocked", task_id=self.task_id)
                return _refused(), "blocked", tier.name, None
        from ..agent.owner_questions import BACKGROUND_TOOLS
        from ..agent.harness_tools import ROUTINE_TOOLS
        from ..agent.team_admin import TEAM_READS
        if ref.name in BACKGROUND_TOOLS or ref.name in ROUTINE_TOOLS or ref.name in CONNECTION_TOOLS or ref.name in TEAM_READS:
            result = (await self._owner_tool(ref.name, arguments) if self._owner_tool else
                      ToolResult(ref.name, False, None, "unavailable"))
            if result.ok and isinstance(result.data, dict) and result.data.get("owner_wait"):
                self.waiting = Waiting(alias or ref.name, ref, dict(arguments), call_id, tier or Tier.T0, PASS,
                                       result.data["owner_wait"])
                raise stopped(WAITING)
        else:
            result = await self._lookup(ref.name, arguments)
        self._memory_untrusted = self._memory_untrusted or result.untrusted
        if result.error == "url_not_seen":
            outcome = "blocked"
        else:
            outcome = "ok" if result.ok else ("timeout" if result.error == "timeout" else "error")
        gate.record_builtin(ref.name, outcome=outcome, task_id=self.task_id)
        if result.ok:
            limit = 2 * 128 * 1024 + 1000 if ref.name == "skill_read" else None
            text, cut = _cut(json.dumps(result.shown, ensure_ascii=False), limit)
            reply = {"ok": True, "kind": None, "content": text, "truncated": cut}
        else:
            reply = {"ok": False, "kind": result.error or "error", "content": "", "truncated": False}
            if result.instruction:
                reply["instruction"] = result.instruction
        return reply, outcome, None if tier is None else tier.name, "external_content" if result.untrusted and ref.name in ("session_search", "session_read", "history_search") else result.detail

    async def _lookup(self, name: str, arguments: dict, *, approval: Approval | None = None, action: Action | None = None) -> ToolResult:
        """One of Raphael's own lookups. It never raises for a failure of the world."""
        try:
            if name == "cli_permission":
                self._gate.check_for(action, name, arguments, approval)
                return ToolResult(name, True, {"approved": True})
            from ..agent.harness_tools import CONNECTION_TOOLS, ROUTINE_TOOLS
            from ..agent.team_admin import TEAM_READS
            from ..management import BACKGROUND_MEMBER_TOOLS, BACKGROUND_READS
            if (name in CONNECTION_TOOLS or name in ROUTINE_TOOLS or name in BACKGROUND_MEMBER_TOOLS or name in TEAM_READS
                    or name in BACKGROUND_READS):
                return await self._owner_tool(name, arguments, approval=approval, action=action) if self._owner_tool else ToolResult(name, False, None, "unavailable")
            from ..memory.growth import TOOLS as GROWTH_TOOLS
            if name in GROWTH_TOOLS:
                if self._memory is None or not hasattr(self._memory, "growth"):
                    return ToolResult(name, False, None, "blocked")
                result = self._memory.growth(name, arguments, untrusted=self._memory_untrusted,
                    **({"owner_text": self._memory_owner_text} if self._memory_owner_text else {}))
                self._memory_untrusted = self._memory_untrusted or result.untrusted
                return result
            if name in ("web_search", "web_read", "read_attachment", "ask_member"):
                self._memory_untrusted = True
            if name in ("self_check", "raphael_help"):
                from ..agent.self_check import ABOUT
                data = ({"reference": ABOUT} if name == "raphael_help" else
                        self._diagnostics() if self._diagnostics else {"state": "unknown"})
                return ToolResult(name, True, data)
            if name in CALENDAR_TOOLS:
                if self._calendar is None:
                    return ToolResult(name, False, None, "unavailable")
                if approval is not None:
                    self._gate.check_for(action, name, arguments, approval)
                try:
                    data = await self._guarded(self._calendar(name, arguments))
                except CalendarError as error:
                    return ToolResult(name, False, None, error.kind, instruction=error.instruction)
                return ToolResult(name, True, data, untrusted=name == CALENDAR_LIST)
            if name == "weather":
                city = arguments.get("city")
                city = city.strip() if isinstance(city, str) and city.strip() else self._city()
                return await self._guarded(self._tools.weather(city, chat_language(self._request, city)))
            if name == "web_search":
                query = arguments.get("query")
                if not isinstance(query, str) or not query.strip():
                    return ToolResult(name, False, None, "bad_arguments")
                return await self._guarded(
                    self._tools.web_search(query.strip(), self.model, self.ledger)
                )
            if name == "web_read":
                return await self._read_page(arguments)
            if name == "read_attachment":
                return await self._read_attachment(arguments)
            if name == "history_search":
                return self._search_history(arguments)
            if name in TEAM_TOOLS:
                if self._team is None:
                    return ToolResult(name, False, None, "blocked")
                return await self._guarded(self._team(name, arguments, **({"approval": approval, "action": action} if approval is not None else {})))
            return self._tools.local_time()
        except RpcError:
            raise
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("The %s lookup failed unexpectedly: %s", name, type(exc).__name__)
            return ToolResult(name, False, None, "error")


    async def _read_page(self, arguments: dict) -> ToolResult:
        """A page at an address the task has seen; "url_not_seen" for any other, unfetched."""
        url = arguments.get("url")
        if not isinstance(url, str) or not url.strip():
            return ToolResult("web_read", False, None, "bad_arguments")
        url = url.strip()
        if not self.seen_urls.seen(url):
            logger.info("A task asked to read an address it has not seen: refused")
            return ToolResult("web_read", False, None, "url_not_seen")
        result = await self._guarded(self._tools.web_read(url))
        if result.ok:
            self.seen_urls.add(url)
        return result

    async def _read_attachment(self, arguments: dict) -> ToolResult:
        """One of the task's own files, by its number from 1: never anything else."""
        index = arguments.get("index")
        if type(index) is not int or not 1 <= index <= len(self.attachments):
            return ToolResult("read_attachment", False, None, "bad_arguments")
        question = arguments.get("question")
        question = question.strip() if isinstance(question, str) and question.strip() else ""
        window = read_window(arguments)
        if window is None:
            return ToolResult("read_attachment", False, None, "bad_arguments")
        attachment = self.attachments[index - 1]
        return await self._guarded(
            self._tools.read_attachment(
                attachment, question or "What does this file hold?", self.ledger, number=index, **window
            )
        )

    def _search_history(self, arguments: dict) -> ToolResult:
        """The past turns searched."""
        if self._memory is None:
            return ToolResult("history_search", False, None, "blocked")
        query = arguments.get("query")
        if not isinstance(query, str) or not query.strip():
            return ToolResult("history_search", False, None, "bad_arguments")
        return self._memory.search(query.strip())


class MemoryReader(Protocol):
    """What a task may do with the memory (`memory.service.MemoryService`, or a member's
    `MemberMemory`): search its past turns; the growth tools, where it has them."""

    def search(self, query: str, *, limit: int = 5, exclude: Sequence[int] = ()) -> ToolResult: ...


# A team tool (`agent.team`) made for a task: its name and arguments to what came of it.
TeamCall = Callable[[str, dict], Awaitable[ToolResult]]


def _ms(began: float) -> int:
    return round((time.perf_counter() - began) * 1000)


def _cut(text: str, limit: int | None = None) -> tuple[str, bool]:
    most = MAX_RESULT_CHARS if limit is None else limit
    return (text, False) if len(text) <= most else (text[:most], True)

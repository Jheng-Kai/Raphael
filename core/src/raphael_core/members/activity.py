"""Ephemeral member activity. Only this module chooses and publishes a state.

Scopes follow the real work, including child tasks, and discard all their steps on
exit. No database state or provider content is retained across core restarts.
"""

import asyncio
import sqlite3
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps


# First match wins. Unknown service/CLI tools do ordinary work; never infer a
# computer action merely because a tool runs on the owner's host.
TOOL_STATES = (
    ("working", ("mcp:computer-access-",), ("request_computer",)),
    ("computer", ("computer__", "mcp:computer-", "mcp__computer__"), ("computer",)),
    ("searching", (), ("web_search", "web_read", "read_attachment",
                       "history_search", "search_query", "webSearch", "WebSearch",
                       "WebFetch", "Read", "read_file", "read_document")),
)
PRIORITY = ("blocked", "computer", "searching", "working", "thinking", "waiting")
_CURRENT = ContextVar("member_activity", default=None)


def tool_state(name):
    # CLI MCP stream names include their server prefix.
    name = str(name)
    short = name.rsplit("__", 1)[-1].rsplit("/", 1)[-1]
    for state, prefixes, names in TOOL_STATES:
        if name.startswith(prefixes) or short in names:
            return state
    return "working"


def finish_state(status):
    if status in ("error", "failed", "interrupted", "limit"):
        return "error"
    return "done" if status == "done" else "idle"


class Activity:
    def __init__(self, notify=None):
        self.notify = notify
        self.running = {}
        self.last_finish = {}
        self.published = {}
        self.task_states = {}
        self.task_source = None
        self.task_batch_source = None
        self.owner_waiting = lambda: set()
        self.viewing = lambda: None
        self.language = lambda: "zh-TW"

    def tasks(self, member_id, tasks):
        self.task_states[member_id] = tasks
        self._publish(member_id)

    def seen(self, member_id):
        self.last_finish.pop(member_id, None)
        self._publish(member_id)

    def task_list(self, member_id):
        return self.task_source(member_id) if self.task_source else self.task_states.get(member_id, ())

    def describe(self, member_id, waiting=None, *, tasks=None):
        tasks = self.task_list(member_id) if tasks is None else tasks
        state = self.state(member_id, tasks=tasks, waiting=waiting)
        return state, self.label(member_id, state, tasks=tasks)

    def label(self, member_id, state=None, *, tasks=None):
        from ..agent.persona import ACTIVITY_LABELS, normalize_language
        state = state or self.state(member_id)
        words = ACTIVITY_LABELS[normalize_language(self.language())]
        if state == "waiting":
            tasks = self.task_list(member_id) if tasks is None else tasks
            name = next((task.get("waiting_for") for task in tasks if task.get("waiting_for")), None)
            if name:
                return words["colleague"].format(name=name)
            if tasks and all(task["state"] == "queued" for task in tasks):
                return words["queued"]
        return words.get(state, "")

    def state(self, member_id, *, tasks=None, waiting=None):
        tasks = self.task_list(member_id) if tasks is None else tasks
        waiting = self.owner_waiting() if waiting is None else waiting
        if member_id in waiting or any(task.get("waiting_owner") for task in tasks):
            return "blocked"
        if self.last_finish.get(member_id) == "error":
            return "error"
        things = [state for run in self.running.get(member_id, ())
                  for state in ("thinking", *run.steps.values())]
        things += ["waiting" for task in tasks if task["state"] in ("queued", "waiting")]
        if not self.running.get(member_id):
            things += ["working" for task in tasks if task["state"] == "running"]
        return next((state for state in PRIORITY if state in things),
                    "error" if self.last_finish.get(member_id) == "error" else "idle")

    def _publish(self, member_id, state=None):
        if state is None:
            state, label = self.describe(member_id)
        else:
            label = self.label(member_id, state)
        if self.published.get(member_id, ("idle", "")) != (state, label):
            self.published[member_id] = (state, label)
            if self.notify:
                self.notify("member.activity", {"member_id": member_id, "state": state, "label": label})

    @contextmanager
    def turn(self, member_id):
        run = Running(self, member_id)
        self.last_finish.pop(member_id, None)
        self.running.setdefault(member_id, set()).add(run)
        token = _CURRENT.set(run)
        self._publish(member_id)
        try:
            yield run
        except asyncio.CancelledError:
            run.finish = "idle"
            raise
        except BaseException:
            run.finish = "error"
            raise
        finally:
            run.closed = True
            run.steps.clear()
            self.running[member_id].remove(run)
            self.last_finish[member_id] = "error" if run.finish == "error" and self.viewing() != member_id else "idle"
            if not self.running[member_id]:
                del self.running[member_id]
                if run.finish == "done":
                    self._publish(member_id, "done")
            self._publish(member_id)
            _CURRENT.reset(token)


class Running:
    def __init__(self, activity, member_id):
        self.activity, self.member_id = activity, member_id
        self.steps = {}
        self.finish = "done"
        self.closed = False

    def start(self, key, name):
        if not self.closed:
            self.steps[key] = tool_state(name)
            self.activity._publish(self.member_id)

    def end(self, key):
        if not self.closed:
            self.steps.pop(key, None)
            self.activity._publish(self.member_id)


def current():
    return _CURRENT.get()


@contextmanager
def step(name, run=None):
    run = run or current()
    key = object()
    token = _CURRENT.set(run)
    if run:
        run.start(key, name)
    try:
        yield
    finally:
        if run:
            run.end(key)
        _CURRENT.reset(token)


class StreamSteps:
    """Pair CLI stream steps by call ID, including duplicate Claude start packets."""
    def __init__(self, scope):
        self.scope = scope
        self.steps = {}

    def start(self, data):
        key = data.get("id") or object()
        if key not in self.steps:
            run = self.scope()
            self.steps[key] = run
            if run:
                name = data.get("name", "")
                if data.get("server"):
                    name = f"mcp__{data['server']}__{name}"
                run.start(key, name)

    def end(self, data):
        key = data.get("id") or next(iter(self.steps), None)
        run = self.steps.pop(key, None)
        if run:
            run.end(key)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        for key, run in self.steps.items():
            if run:
                run.end(key)
        self.steps.clear()


def tool_step(name, *, scope=None):
    """Observe an existing async tool boundary without duplicating exit handling."""
    def decorate(function):
        @wraps(function)
        async def observed(*args, **kwargs):
            with step(name(*args, **kwargs), scope(*args, **kwargs) if scope else None):
                return await function(*args, **kwargs)
        return observed
    return decorate


def member_turn(member, *, status=None, waiting=None):
    """Observe a service boundary; its existing result/history remains authoritative."""
    def decorate(function):
        @wraps(function)
        async def observed(self, *args, **kwargs):
            with self.activity.turn(member(self, *args, **kwargs)) as run:
                result = await function(self, *args, **kwargs)
                if status:
                    ending = status(self, result, *args, **kwargs)
                elif isinstance(result, dict):
                    ending = result.get("status")
                    try:
                        turn = self._history.get(result["turn_id"]) if result.get("turn_id") else None
                    except sqlite3.Error:
                        turn = None  # Activity must not break a reply whose history could not be written.
                    if turn:
                        ending = turn.status
                else:
                    ending = "done"
                if waiting and waiting(self, *args, **kwargs):
                    ending = "waiting"
                run.finish = finish_state(ending)
                return result
        return observed
    return decorate

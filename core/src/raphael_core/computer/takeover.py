"""Private, in-memory computer work. Only an explicit owner handback resumes a call.

Work retains the short owner-facing handoff reason and its state. It holds no
screen or owner input. A core restart drops the waiting coroutine.
"""
import asyncio
import json
import secrets
from dataclasses import dataclass, field
from collections.abc import Callable

from ..agent.plugins import PluginResult
from .vm import VmError

REASONS = ("sign_in", "password", "two_factor", "captcha", "payment", "other")
TAKEOVER = {
    "description": ("Pause only for an owner-only step such as sign-in, 2FA, CAPTCHA, payment or consent. "
                    "Explain the step in a public message and choose the matching reason. For other, give the "
                    "exact owner-only step in detail. To show a page, open it and point to the Computer panel. "
                    "Never request secrets in chat or tool arguments. Wait for explicit Done, then inspect "
                    "the same window or tab before acting."),
    "parameters": {"type": "object", "properties": {"reason": {"type": "string", "enum": list(REASONS)},
                                                       "detail": {"type": "string", "maxLength": 300}},
                   "required": ["reason"], "additionalProperties": False},
}

TAKEOVER_REASON_REQUIRED = "Give the reason the owner must take over and describe the owner-only step when using other."


def owner_waiting_result():
    return PluginResult(True, "waiting_for_owner", json.dumps({
        "status": "waiting_for_owner",
        "note": "The owner is using the computer right now. Nothing was done. Tell the owner plainly that you are "
                "waiting for them to finish. Do other work if possible, or try again once they hand control back.",
    }))


def takeover_detail(arguments):
    detail = " ".join(arguments.get("detail", "").split())
    return detail if detail or arguments.get("reason") != "other" else None


@dataclass
class Work:
    id: str
    target: object
    scope: tuple
    member_id: int
    conversation_id: int | None
    turn_id: int
    task: asyncio.Task
    state: str = "running"
    tool: str = ""
    reason: str = ""
    detail: str = ""
    request_id: str = ""
    check_required: bool = False
    returned: asyncio.Future | None = field(default=None, repr=False)
    alive: Callable[[], bool] | None = field(default=None, repr=False)
    # The state was read off the task that made this work, not said by the owner's Stop or a takeover that ran out.
    inferred: bool = False

    def view(self):
        if (not self.alive() if self.alive else self.task.done()) and self.state == "running":
            self.state = "stopped" if self.task.cancelled() else "done"
            self.inferred = True
        return {"id": self.id, "turn_id": self.turn_id, "state": self.state,
                "tool": self.tool, "reason": self.reason, "request_id": self.request_id,
                **({"detail": self.detail} if self.detail else {})}


class ComputerWork:
    def __init__(self, vm, *, timeout=30 * 60):
        self.vm, self.timeout = vm, timeout
        self.items = {}

    def begin(self, target, scope, turn_id, private, task=None):
        if not private or scope[0] not in ("turn", "task") or not turn_id:
            return None
        key = (scope, turn_id)
        work = self.items.get(key)
        if work is not None and work.inferred and work.state in ("stopped", "done"):
            # The call that made this work was cut short (a first call that waited for a sleeping computer, a restart)
            # and a later call of the same turn is alive: the turn goes on, so its work does too. A stop the owner said
            # (a takeover stopped or expired, `request`) is not inferred and stays.
            work.task, work.state, work.inferred = task or asyncio.current_task(), "running", False
        if work is None:
            member, conversation = scope[1:3] if scope[0] == "turn" else scope[2:4]
            work = Work(secrets.token_urlsafe(18), target, scope, member, conversation, turn_id, task or asyncio.current_task())
            self.items[key] = work
            # Retain bounded task metadata, never screen contents or credentials.
            for old in list(self.items):
                if len(self.items) <= 128:
                    break
                if self.items[old].task.done():
                    del self.items[old]
        return work

    def views(self, member, conversation):
        return [work.view() for work in self.items.values()
                if work.member_id == member and work.conversation_id == conversation]

    def pending(self, target):
        return next((work for work in self.items.values()
                     if work.target == target and work.state == "waiting_control"), None)

    async def request(self, work, reason, detail=""):
        if work is None:
            raise VmError("private_conversation_required")
        if self.pending(work.target):
            raise VmError("takeover_pending")
        work.reason, work.state = reason, "waiting_control"
        work.detail = detail
        work.request_id = secrets.token_urlsafe(18)
        work.returned = asyncio.get_running_loop().create_future()
        self.vm.hold(work.target, True)
        try:
            async with asyncio.timeout(self.timeout):
                await work.returned
            work.state, work.check_required = "running", True
            return {"status": "owner_finished", "next": "Inspect the intended get_window_state (max_elements 200, include_screenshot false) or get_browser_state before any input. Continue this same task once."}
        except TimeoutError:
            work.state = "expired"
            raise VmError("takeover_expired") from None
        except asyncio.CancelledError:
            work.state = "stopped"
            raise
        finally:
            work.returned = None
            # A viewer may still own the input lease. Its explicit close releases it.
            if work.target.key not in getattr(self.vm, "viewer_owners", {}):
                self.vm.hold(work.target, False)

    def complete(self, target, identifier):
        work = self.pending(target)
        if not work or work.request_id != identifier or work.returned is None or work.returned.done():
            raise VmError("takeover_not_waiting")
        # Clear waiting synchronously, before waking the single suspended call.
        work.state = "returning"
        work.returned.set_result(None)

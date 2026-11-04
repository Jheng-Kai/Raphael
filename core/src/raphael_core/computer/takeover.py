"""Private, in-memory computer work. Only an explicit owner handback resumes a call.

No screen, tool arguments, owner input or model-written text is kept here. A core
restart drops the waiting coroutine; it cannot replay or resume an old request.
"""
import asyncio
import secrets
from dataclasses import dataclass, field
from collections.abc import Callable

from .vm import VmError

REASONS = ("sign_in", "password", "two_factor", "captcha", "payment", "other")
TAKEOVER = {
    "description": "Pause this private computer task for owner-only sign-in, password, 2FA, CAPTCHA, payment or consent. Never request secrets in chat or arguments. The private card opens the viewer. Wait for the owner's explicit I'm done; disconnect, timeout and Stop never resume. Then inspect the intended get_window_state (max_elements 200, include_screenshot false) or get_browser_state before input and continue the same task once without repeating completed work.",
    "parameters": {"type": "object", "properties": {"reason": {"type": "string", "enum": list(REASONS)}},
                   "required": ["reason"], "additionalProperties": False},
}


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
    request_id: str = ""
    check_required: bool = False
    returned: asyncio.Future | None = field(default=None, repr=False)
    alive: Callable[[], bool] | None = field(default=None, repr=False)

    def view(self):
        if (not self.alive() if self.alive else self.task.done()) and self.state == "running":
            self.state = "stopped" if self.task.cancelled() else "done"
        return {"id": self.id, "turn_id": self.turn_id, "state": self.state,
                "tool": self.tool, "reason": self.reason, "request_id": self.request_id}


class ComputerWork:
    def __init__(self, vm, *, timeout=30 * 60):
        self.vm, self.timeout = vm, timeout
        self.items = {}

    def begin(self, target, scope, turn_id, private, task=None):
        if not private or scope[0] not in ("turn", "task") or not turn_id:
            return None
        key = (scope, turn_id)
        work = self.items.get(key)
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

    async def request(self, work, reason):
        if work is None:
            raise VmError("private_conversation_required")
        if self.pending(work.target):
            raise VmError("takeover_pending")
        work.reason, work.state = reason, "waiting_control"
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

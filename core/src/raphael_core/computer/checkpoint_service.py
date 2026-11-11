"""Owner-only review and guarded restore, through the existing main-window RPC."""

import asyncio

from ..protocol import invalid_params


class Checkpoints:
    def __init__(self, vm, member_exists):
        self.vm, self.member_exists = vm, member_exists

    def register(self, router):
        router.register("computer.checkpoints", self.call)

    async def call(self, params):
        member, action = params.get("member_id", 0), params.get("action", "list")
        if type(member) is not int or member < 0 or not self.member_exists(member) or action not in ("list", "restore"):
            raise invalid_params("unknown computer checkpoint action")
        target = self.vm.target(member)
        active = getattr(self.vm, "unit_active", lambda target: self.vm.active.get(target.key))
        busy = getattr(self.vm, "unit_busy", lambda target: self.vm.busy(target.key))
        held = getattr(self.vm, "unit_held", lambda target: target.key in getattr(self.vm, "held", ()))
        occupied = lambda: bool(active(target) or busy(target) or held(target))
        if action == "restore":
            if params.get("confirmed") is not True and not self.vm.full_permission():
                raise invalid_params("restore requires the owner's confirmation")
            if occupied():
                raise invalid_params("computer_busy")
            metadata = {"id": params.get("id"), "member": member}
            if params.get("review_token") is not None:
                token = params["review_token"]
                if not isinstance(token, str) or len(token) != 64 or any(c not in "0123456789abcdef" for c in token):
                    raise invalid_params("unknown checkpoint review")
                metadata["review_token"] = token
            if not hasattr(self.vm, "maintenance"):
                return await self.vm.checkpoint(target, action, **metadata)
            key = target.state_key
            if key in self.vm.maintenance or key in self.vm.preparing and not self.vm.preparing[key].done():
                raise invalid_params("computer_busy")
            self.vm.maintenance[key] = asyncio.current_task()
            try:
                async with self.vm.locks.setdefault(key, asyncio.Lock()):
                    if occupied():
                        raise invalid_params("computer_busy")
                    return await self.vm.checkpoint(target, action, **metadata)
            finally:
                self.vm.maintenance.pop(key, None)
        warning = bool(getattr(self.vm, "checkpoint_failures", {}).get(getattr(target, "state_key", target.key)))
        try:
            checkpoints = await self.vm.checkpoint(target, action, member=member)
        except Exception:
            checkpoints, warning = [], True
        return {"checkpoints": checkpoints, "coverage_warning": warning,
                "busy": occupied(),
                "confirmation_required": not self.vm.full_permission()}

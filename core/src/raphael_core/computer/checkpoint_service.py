"""Owner-only review and guarded restore, through the existing main-window RPC."""

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
        if not self.vm.grants.allowed(member):
            raise invalid_params("computer_permission_required")
        if action == "restore":
            if params.get("confirmed") is not True and not self.vm.grants.full_permission():
                raise invalid_params("restore requires the owner's confirmation")
            if self.vm.active.get(target.key) or self.vm.busy(target.key):
                raise invalid_params("computer_busy")
            metadata = {"id": params.get("id"), "member": member}
            if params.get("review_token") is not None:
                token = params["review_token"]
                if not isinstance(token, str) or len(token) != 64 or any(c not in "0123456789abcdef" for c in token):
                    raise invalid_params("unknown checkpoint review")
                metadata["review_token"] = token
            return await self.vm.checkpoint(target, action, **metadata)
        warning = bool(getattr(self.vm, "checkpoint_failures", {}).get(target.key))
        try:
            checkpoints = await self.vm.checkpoint(target, action, member=member)
        except Exception:
            checkpoints, warning = [], True
        return {"checkpoints": checkpoints, "coverage_warning": warning,
                "busy": bool(self.vm.active.get(target.key) or self.vm.busy(target.key)),
                "confirmation_required": not self.vm.grants.full_permission()}

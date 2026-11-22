"""Owner decisions on a member's offer to continue in the virtual machine."""

import asyncio
import logging

from ..agent.plugins import PluginResult, PluginTool, tool_key
from ..agent.policy import Tier
from ..brain.db import rows_for_turns
from ..protocol import invalid_params


SUGGEST_COMPUTER_KEY = tool_key("computer", "suggest_computer")
SUGGEST_COMPUTER = PluginTool(
    SUGGEST_COMPUTER_KEY, "computer", "suggest_computer",
    "Offer the VM once in a private chat when the request requires installing software, a shell, a desktop app or "
    "a long-running process. Explain in the owner's language why the browser alone cannot do it. The owner decides. "
    "Then stop this turn. For background work, stop and report the need without a card.",
    {"type": "object", "properties": {"reason": {"type": "string", "minLength": 1, "maxLength": 300}},
     "required": ["reason"], "additionalProperties": False}, Tier.T0, pinned=True, whole=True,
)


class ComputerSuggestions:
    def __init__(self, conn, tools):
        self.conn, self.tools = conn, tools
        self.notify = self.resume = None
        self.tasks = set()

    async def show(self, turn_id, member, reason, language):
        installed = await self.tools.vm.installed()
        if self.tools.computer_mode(member) != "host":
            return PluginResult(False, "computer_changed", "The owner already chose the virtual machine.")
        with self.conn:
            saved = self.conn.execute(
                "INSERT OR IGNORE INTO computer_suggestions (turn_id,member_id,reason,language,installed) "
                "SELECT id,member_id,?,?,? FROM agent_turns WHERE id=? AND member_id=? AND scope='private' "
                "AND status IN ('running','queued')", (reason, language, installed, turn_id, member)).rowcount
        if not saved:
            return PluginResult(False, "suggestion_already_shown", "This request can show one suggestion card. Finish your reply.")
        self.changed(turn_id, member)
        return PluginResult(True, text="The suggestion card is shown. End your reply with why this task needs the VM. Wait for the owner to choose.")

    def changed(self, turn, member):
        if self.notify:
            self.notify("agent.turn", {"turn_id": turn, "member_id": member})

    def views(self, turns):
        return {row["turn_id"]: {"reason": row["reason"], "installed": bool(row["installed"]), "state": row["state"]}
                for row in rows_for_turns(self.conn, "computer_suggestions", turns, order="turn_id")
                if row["state"] != "dismissed"}

    async def act(self, params):
        turn, action = params.get("turn_id"), params.get("action")
        if type(turn) is not int or action not in ("switch", "setup", "dismiss"):
            raise invalid_params("Invalid computer suggestion action")
        installed = action != "dismiss" and await self.tools.vm.installed()
        switched = installed and action == "switch"
        with self.conn:
            row = self.conn.execute("SELECT s.*, t.status FROM computer_suggestions s JOIN agent_turns t "
                                    "ON t.id=s.turn_id WHERE s.turn_id=?", (turn,)).fetchone()
            if row is None or row["state"] == "dismissed" or (action != "dismiss" and row["state"] != "pending"):
                return {}
            member = row["member_id"]
            if action == "dismiss":
                self.conn.execute("UPDATE computer_suggestions SET state='dismissed' WHERE turn_id=?", (turn,))
            elif row["status"] not in ("done", "running", "queued") or not self.tools.member_exists(member):
                raise invalid_params("The original request is no longer available")
            elif switched:
                self.tools.set_computer_mode(member, "docker")
                self.conn.execute("UPDATE computer_suggestions SET state='switched',installed=1 WHERE turn_id=?", (turn,))
            else:
                self.conn.execute("UPDATE computer_suggestions SET installed=? WHERE turn_id=?", (installed, turn))
        self.changed(turn, member)
        if switched and self.resume:
            task = asyncio.create_task(self._resume(turn, row["language"]))
            self.tasks.add(task)
            task.add_done_callback(self.tasks.discard)
        return {"setup": True} if action != "dismiss" and not installed else {}

    async def _resume(self, turn, language):
        try:
            await self.resume(turn, language)
        except Exception:
            logging.getLogger(__name__).exception("Computer suggestion could not continue turn %s", turn)

    async def aclose(self):
        tasks = tuple(self.tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

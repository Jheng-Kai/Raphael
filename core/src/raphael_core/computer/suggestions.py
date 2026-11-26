"""Decisions on a member's offer to continue on the other computer: the virtual machine, or this PC's Raphael Chrome."""

import asyncio
import logging
from dataclasses import replace

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
# A member on the VM is offered the way back under the same name, so the tool list stays as short.
SUGGEST_THIS_PC = replace(
    SUGGEST_COMPUTER,
    description="Offer this PC's Raphael Chrome once in a private chat when the request needs the owner's signed-in "
                "sites there, the company network or a local app or file the VM cannot reach. Explain in the owner's language "
                "what needs it. The owner decides. Then stop this turn. For background work, stop and report the need without a card.",
)
# The computer a card proposes is the one the member is not on.
OTHER = {"host": "docker", "docker": "host"}
CHOSEN_WORDS = {"docker": "The owner already chose the virtual machine.", "host": "The owner already chose this computer."}


class ComputerSuggestions:
    def __init__(self, conn, tools):
        self.conn, self.tools = conn, tools
        self.notify = self.resume = None
        self.tasks = set()

    async def show(self, turn_id, member, reason, language, target="docker"):
        """Show the card that proposes `target`: "docker" to a member on this PC, "host" to one on the virtual machine."""
        installed = target == "host" or await self.tools.vm.installed()
        if self.tools.computer_mode(member) != OTHER[target]:
            return PluginResult(False, "computer_changed", CHOSEN_WORDS[target])
        with self.conn:
            saved = self.conn.execute(
                "INSERT OR IGNORE INTO computer_suggestions (turn_id,member_id,reason,language,installed,target) "
                "SELECT id,member_id,?,?,?,? FROM agent_turns WHERE id=? AND member_id=? AND scope='private' "
                "AND status IN ('running','queued')", (reason, language, installed, target, turn_id, member)).rowcount
        if not saved:
            return PluginResult(False, "suggestion_already_shown", "This request can show one suggestion card. Finish your reply.")
        self.changed(turn_id, member)
        place = "the VM" if target == "docker" else "this PC"
        return PluginResult(True, text=f"The suggestion card is shown. End your reply with why this task needs {place}. Wait for the owner to choose.")

    def changed(self, turn, member):
        if self.notify:
            self.notify("agent.turn", {"turn_id": turn, "member_id": member})

    def views(self, turns):
        return {row["turn_id"]: {"reason": row["reason"], "installed": bool(row["installed"]), "state": row["state"],
                                 "target": row["target"]}
                for row in rows_for_turns(self.conn, "computer_suggestions", turns, order="turn_id")
                if row["state"] != "dismissed"}

    async def act(self, params):
        turn, action = params.get("turn_id"), params.get("action")
        if type(turn) is not int or action not in ("switch", "setup", "dismiss"):
            raise invalid_params("Invalid computer suggestion action")
        row = self.conn.execute("SELECT s.*, t.status FROM computer_suggestions s JOIN agent_turns t "
                                "ON t.id=s.turn_id WHERE s.turn_id=?", (turn,)).fetchone()
        if row is None or row["state"] == "dismissed" or (action != "dismiss" and row["state"] != "pending"):
            return {}
        target, member = row["target"], row["member_id"]
        installed = action != "dismiss" and (target == "host" or await self.tools.vm.installed())
        switched = installed and action == "switch"
        with self.conn:
            if action == "dismiss":
                self.conn.execute("UPDATE computer_suggestions SET state='dismissed' WHERE turn_id=?", (turn,))
            elif row["status"] not in ("done", "running", "queued") or not self.tools.member_exists(member):
                raise invalid_params("The original request is no longer available")
            elif self.tools.computer_mode(member) == target:
                raise invalid_params("The member already works on that computer")
            elif switched:
                self.tools.set_computer_mode(member, target)
                self.conn.execute("UPDATE computer_suggestions SET state='switched',installed=1 WHERE turn_id=?", (turn,))
            else:
                self.conn.execute("UPDATE computer_suggestions SET installed=? WHERE turn_id=?", (installed, turn))
        self.changed(turn, member)
        if switched and self.resume:
            task = asyncio.create_task(self._resume(turn, row["language"], target))
            self.tasks.add(task)
            task.add_done_callback(self.tasks.discard)
        return {"setup": True} if action != "dismiss" and not installed else {}

    async def _resume(self, turn, language, target):
        try:
            await self.resume(turn, language, target)
        except Exception:
            logging.getLogger(__name__).exception("Computer suggestion could not continue turn %s", turn)

    async def aclose(self):
        tasks = tuple(self.tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

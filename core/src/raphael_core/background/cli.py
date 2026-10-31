"""Adapt the existing CLI member loop to the background worker's tool/approval contract."""
from types import SimpleNamespace

from ..agent.cli import loop as cli_loop
from ..agent.cli.loop import CliLoop
from ..protocol import RpcError
from ..worker.loop import WRAP_UP, Stop, ToolOutcome

# How many calls a task that reached a ceiling may make after being asked to report, before it is ended.
CEILING_PATIENCE = 3


class RoomCliSessions:
    """Room turns receive their full transcript and never resume a private member conversation.
    A loop keeps its own native session in memory, only to start the same CLI again while it runs."""
    def __init__(self):
        self.locks = {}
        self.conversations = SimpleNamespace(resolve=lambda member, conversation: conversation)
        self._sessions = {}

    def get(self, member, brain, conversation_id=None):
        return self._sessions.get((member, brain, conversation_id))

    def put(self, member, brain, session, conversation_id=None):
        self._sessions[(member, brain, conversation_id)] = session


def member_loop(brains, quota, task, run, spec, *, wait_s, progress):
    refused = [0]

    async def execute(call_id, name, arguments):
        if name == "cli_permission":
            # Native shell/file permission is not an alternative to Raphael's tool gate.
            return ToolOutcome(False, "use_mcp_tools")
        try:
            result = await run.tool({"call_id":call_id, "name":name, "arguments":arguments})
        except RpcError as error:
            data = error.data if isinstance(error.data, dict) else {}
            stop = data.get("stop")
            if isinstance(stop, str) and stop.startswith("limit_") and refused[0] < CEILING_PATIENCE:
                # A ceiling: the CLI makes its own model calls, so it is told to report in place of the call it
                # asked for, and its final answer is the task's result (`TaskRun.ceiling`).
                refused[0] += 1
                run.ceiling = stop
                return ToolOutcome(False, "limit", instruction=WRAP_UP)
            if stop:
                raise Stop(stop, data.get("detail")) from None
            raise
        outcome = tool_outcome(result)
        if outcome.replace_tools:
            loop.tools[:] = [item for item in loop.tools if not item["function"]["name"].startswith("computer__")]
            loop.tools.extend(item for item in outcome.tools if item["function"]["name"].startswith("computer__"))
            outcome.tools = list(loop.tools)
            loop.reload_note, loop.catalog_changed = cli_loop.COMPUTER_CHANGED, True
        elif outcome.tools:
            # Tools find_tools showed: the loop lists them, and the CLI starts again to read its list.
            loop.tools.extend(outcome.tools)
            loop.reload_note, loop.catalog_changed = cli_loop.TOOLS_FOUND, True
        return outcome

    loop = CliLoop(brains=brains, sessions=RoomCliSessions(), member_id=task.member_id,
        conversation_id=f"room-task-{task.id}", model=run.model, ledger=run.ledger,
        language=task.language, plain=True, system=spec["system"], user=spec["user"],
        tools=spec["tools"], attachments=run.attachments, progress=progress,
        thinking=lambda text: None, event=progress, execute=execute, quota=quota, wait_timeout_s=wait_s,
        rate_limit_waits=cli_loop.ROOM_RATE_LIMIT_WAITS_S, alive=run.touch)
    return loop


def tool_outcome(result):
    if isinstance(result, str):
        return ToolOutcome('status="ok"' in result, content=result)
    return ToolOutcome(bool(result.get("ok")), result.get("kind"), result.get("content", ""),
                       instruction=result.get("instruction") or "", blocks=result.get("blocks") or [],
                       tools=result.get("tools") or [], replace_tools=result.get("replace_tools") is True)

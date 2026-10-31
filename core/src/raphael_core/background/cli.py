"""Adapt the existing CLI member loop to the background worker's tool/approval contract."""
from types import SimpleNamespace

from ..agent.cli import loop as cli_loop
from ..agent.cli.loop import CliLoop
from ..protocol import RpcError
from ..worker.loop import Stop, ToolOutcome


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
    async def execute(call_id, name, arguments):
        if name == "cli_permission":
            # Native shell/file permission is not an alternative to Raphael's tool gate.
            return ToolOutcome(False, "use_mcp_tools")
        try:
            result = await run.tool({"call_id":call_id, "name":name, "arguments":arguments})
        except RpcError as error:
            data = error.data if isinstance(error.data, dict) else {}
            if data.get("stop"):
                raise Stop(data["stop"], data.get("detail")) from None
            raise
        if isinstance(result, dict) and result.get("tools"):
            # Tools find_tools showed: the loop lists them, and the CLI starts again to read its list.
            loop.tools.extend(result["tools"])
            loop.reload_note, loop.catalog_changed = cli_loop.TOOLS_FOUND, True
        return tool_outcome(result)

    loop = CliLoop(brains=brains, sessions=RoomCliSessions(), member_id=task.member_id,
        conversation_id=f"room-task-{task.id}", model=run.model, ledger=run.ledger,
        language=task.language, plain=True, system=spec["system"], user=spec["user"],
        tools=spec["tools"], attachments=run.attachments, progress=progress,
        thinking=lambda text: None, event=progress, execute=execute, quota=quota, wait_timeout_s=wait_s,
        rate_limit_waits=cli_loop.ROOM_RATE_LIMIT_WAITS_S)
    return loop


def tool_outcome(result):
    if isinstance(result, str):
        return ToolOutcome('status="ok"' in result, content=result)
    return ToolOutcome(bool(result.get("ok")), result.get("kind"), result.get("content", ""),
                       instruction=result.get("instruction") or "", blocks=result.get("blocks") or [])

"""Adapt the existing CLI member loop to the background worker's tool/approval contract."""
from types import SimpleNamespace

from ..agent.cli import loop as cli_loop
from ..agent.cli.loop import CliLoop
from ..protocol import RpcError
from ..worker.loop import WRAP_UP, Stop, ToolOutcome
from ..computer.local_tools import is_local, BACKGROUND_WAIT_S
from .snapshot import USE_TOOL

# How many calls a task that reached a ceiling may make after being asked to report, before it is ended.
CEILING_PATIENCE = 3


class RoomCliSessions:
    """Each execution receives its scoped prompt without resuming another native conversation.
    A loop retains its own session only while the same task runs or resumes."""
    def __init__(self):
        self.locks = {}
        self.conversations = SimpleNamespace(resolve=lambda member, conversation: conversation)
        self._sessions = {}
        self._contexts = {}

    def get(self, member, brain, conversation_id=None):
        return self._sessions.get((member, brain, conversation_id))

    def put(self, member, brain, session, conversation_id=None):
        self._sessions[(member, brain, conversation_id)] = session

    def forget(self, member, brain, conversation_id=None):
        self._sessions.pop((member, brain, conversation_id), None)
        self._contexts.pop((member, brain, conversation_id), None)

    def get_context(self, member, brain, session, conversation_id=None):
        saved_session, state = self._contexts.get((member, brain, conversation_id), (None, None))
        return state if saved_session == session else None

    def put_context(self, member, brain, session, state, conversation_id=None):
        if self.get(member, brain, conversation_id) == session:
            self._contexts[(member, brain, conversation_id)] = (session, state)


def member_loop(brains, quota, task, run, spec, *, wait_s, progress):
    refused = [0]

    async def execute(call_id, name, arguments):
        if name == "cli_permission":
            # Native shell/file permission is not an alternative to Raphael's tool gate, unless the owner gave them all.
            if task.scope == "room":
                return ToolOutcome(False,"room_speech_only",instruction="Start this as private work with handoff.")
            from ..agent.data_floor import WRITE_REFUSAL
            access = run._gate.data_floor.access(name, arguments)
            if access == "write":
                return ToolOutcome(False, "protected_data", instruction=WRITE_REFUSAL)
            if access == "read":
                from .snapshot import BUILTIN, ToolRef
                from ..agent.policy import Tier
                run.snapshot.refs[name] = ToolRef(BUILTIN, name, "Raphael", name, Tier.T3)
            else:
                return ToolOutcome(True, None) if getattr(run._gate, "full_permission", False) else ToolOutcome(False, "use_mcp_tools")
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
                called = arguments.get("name") if name == USE_TOOL and isinstance(arguments, dict) else name
                ref = run.snapshot.refs.get(called) if isinstance(called, str) else None
                if ref is not None and is_local(ref.key):
                    loop.approval_wait_s = BACKGROUND_WAIT_S
                raise Stop(stop, data.get("detail")) from None
            raise
        outcome = tool_outcome(result)
        if outcome.replace_tools:
            # The member's computer changed (a grant, the driver's own catalog): the one change of the list a
            # task takes, and the CLI starts again in its own session to read it. What find_tools finds is
            # called with use_tool and changes nothing.
            listed()
            outcome.tools = list(loop.tools)
            loop.reload_note, loop.catalog_changed = cli_loop.COMPUTER_CHANGED, True
        return outcome

    loop = CliLoop(brains=brains, sessions=RoomCliSessions(), member_id=task.member_id,
        conversation_id=f"room-task-{task.id}", model=run.model, ledger=run.ledger,
        language=task.language, plain=True, system=spec["system"], user=spec["user"],
        owner_text=task.text, tool_conversation=spec.get("tool_conversation", ()), steps=spec.get("steps", ()),
        tools=spec["tools"], skills=spec.get("skills", ()), attachments=run.attachments, progress=progress,
        thinking=lambda text: None, event=progress, reply=getattr(run, "_reply", None), execute=execute, quota=quota, wait_timeout_s=wait_s,
        rate_limit_waits=cli_loop.ROOM_RATE_LIMIT_WAITS_S, alive=run.touch)
    def listed():
        extra = [item for item in loop.tools if item["function"]["name"] in ("cli_permission", "approve")]
        loop.tools[:] = [*run.snapshot.definitions, *extra]
        return loop.tools

    def refresh_tools():
        run.snapshot.refresh_plugins(run._gate.plugins, task.member_id)
        return listed()
    if task.scope == 'room':
        loop.speech_only = True
    loop.refresh_tools = refresh_tools
    return loop


def tool_outcome(result):
    if isinstance(result, str):
        return ToolOutcome('status="ok"' in result, content=result)
    return ToolOutcome(bool(result.get("ok")), result.get("kind"), result.get("content", ""),
                       instruction=result.get("instruction") or "", blocks=result.get("blocks") or [],
                       tools=result.get("tools") or [], replace_tools=result.get("replace_tools") is True)

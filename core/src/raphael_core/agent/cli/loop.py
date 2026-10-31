"""Keep a CLI and its MCP requests alive across the existing inline approval cards."""

import asyncio
import json
import logging
import re
import traceback
import time
from contextlib import aclosing

from ...worker.loop import Call, Outcome, Stop, ToolOutcome, WAITING
from ...members.activity import StreamSteps, current, tool_step
from ...worker.guards import wrap_untrusted
from ...worker.tool_guardrails import ToolGuardrails
from ..answers import MESSAGE_BREAK, parse_reply
from ..conversations import Conversations
from ..mcp_server import RaphaelMcp
from ...brain.textnorm import public_line
from ..narration import PUBLIC_PROGRESS_RULES
from ..policy import CONFIRM_TIMEOUT_S
from ..persona import phrase
from .discovery import NAMES, brain_ref, brain_effort
from .drivers import Driver
from .process import secure_directory
from .native_diagnostics import capture as native_capture, directory as native_directory
from ...failures import Failure, KINDS, TRANSIENT, RETRY_WAITS, classify, tool_failure
from ...retry_utils import Outage

logger = logging.getLogger(__name__)

# A rate-limited turn that has not acted yet runs again after each of these waits.
RATE_LIMIT_WAITS_S = RETRY_WAITS
# A room or background turn has no one sitting on it: it rides out a throttle of minutes (live, 429s lasted several).
ROOM_RATE_LIMIT_WAITS_S = (30.0, 60.0, 120.0, 240.0)

COMPUTER_CHANGED = ("The computer tool catalog changed. Reload the computer MCP catalog and continue "
                    "the original task. Do not repeat completed actions.")
TOOLS_FOUND = ("The tools you asked find_tools for are in your tool list now. Continue the original task "
               "with them. Do not repeat completed actions.")
APPROVE = {"type": "function", "function": {"name": "approve", "description": "Ask the owner for permission. Never grants permission by itself.",
           "parameters": {"type": "object", "properties": {"tool_name": {"type": "string"}, "input": {"type": "object"}}, "additionalProperties": True}}}


class Sessions:
    def __init__(self, conn):
        self.conn = conn
        self.locks = {}
        self.conversations = Conversations(conn)
        conn.execute("CREATE TABLE IF NOT EXISTS agent_cli_sessions (member_id INTEGER NOT NULL, brain TEXT NOT NULL, session_id TEXT NOT NULL, PRIMARY KEY(member_id, brain))")
        conn.execute("CREATE TRIGGER IF NOT EXISTS delete_member_cli_sessions AFTER DELETE ON members BEGIN DELETE FROM agent_cli_sessions WHERE member_id=OLD.id; END")
        # Existing native resume IDs belong only to the member's default conversation.
        with conn:
            conn.execute("INSERT OR IGNORE INTO agent_conversation_cli_sessions SELECT c.id, s.brain, s.session_id FROM agent_cli_sessions s JOIN conversations c ON c.member_id=s.member_id AND c.is_default=1")
            conn.execute("DELETE FROM agent_cli_sessions WHERE member_id IN (SELECT member_id FROM conversations WHERE is_default=1)")

    def get(self, member, brain, conversation_id=None):
        if conversation_id is None:
            conversation_id = self.conversations.main(member)
        row = self.conn.execute("SELECT s.session_id FROM agent_conversation_cli_sessions s JOIN conversations c ON c.id=s.conversation_id WHERE c.id=? AND c.member_id=? AND s.brain=?", (conversation_id, member, brain)).fetchone()
        return row[0] if row else None

    def put(self, member, brain, session, conversation_id=None):
        if not isinstance(session, str) or not 0 < len(session) <= 512:
            return
        if conversation_id is None:
            conversation_id = self.conversations.main(member)
        # A deleted conversation cannot be revived by a late session notification.
        with self.conn:
            self.conn.execute("INSERT OR REPLACE INTO agent_conversation_cli_sessions SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM conversations WHERE id=? AND member_id=?)", (conversation_id, brain, session, conversation_id, member))

    def clear(self):
        with self.conn:
            self.conn.execute("DELETE FROM agent_conversation_cli_sessions")
            self.conn.execute("DELETE FROM agent_cli_sessions")

    def clear_member(self, member_id):
        with self.conn:
            self.conn.execute(
                "DELETE FROM agent_conversation_cli_sessions WHERE conversation_id IN "
                "(SELECT id FROM conversations WHERE member_id = ?)",
                (member_id,),
            )
            self.conn.execute("DELETE FROM agent_cli_sessions WHERE member_id = ?", (member_id,))


class CliLoop:
    def __init__(self, *, brains, sessions, member_id, model, ledger, language, plain,
                 system, user, tools, progress, thinking, event, execute, expire=None, spoken=False,
                 conversation_id=None, quota=None, attachments=(), wait_timeout_s=None, resume_session=True,
                 rate_limit_waits=None, structured=None, alive=lambda: None):
        self.brains, self.sessions, self.member_id, self.model = brains, sessions, member_id, model
        # Told whenever the CLI does anything (a word, a tool): whoever watches for a stalled turn hears it.
        self.alive = alive
        self.conversation_id = sessions.conversations.resolve(member_id, conversation_id) if sessions else conversation_id
        self.quota = quota
        self.resume_session = resume_session
        # The waits before running a rate-limited request again: None waits as for a turn someone is reading
        # (RATE_LIMIT_WAITS_S), () never waits.
        self.rate_limit_waits = rate_limit_waits
        self.ledger, self.language, self.plain = ledger, language, plain
        self.spoken = spoken
        mcp_names = "Raphael and computer" if any(item["function"]["name"].startswith("computer__") for item in tools) else "Raphael"
        self.system = system + "\n" + PUBLIC_PROGRESS_RULES + f"\nUse only {mcp_names} MCP tools for actions and lookups. "
        self.system += (
            'For the spoken reply only, return one JSON object with text, messages (usually one; several only '
            'when naturally separate, at most four), '
            'and say_ja (the Japanese rendering for the voice). No other fields or prose.'
            if spoken else (
                "Reply in plain text (Markdown is fine). It is one chat message unless it is naturally "
                "several (an answer, then a separate exercise or question): then put a line with only "
                f"{MESSAGE_BREAK} between them, at most four. Never split one thought or pad to fill. "
                "Never output a JSON reply envelope."
            )
        )
        # Only Claude Code asks through `approve` (its --permission-prompt-tool); Codex and Antigravity ask natively. Live,
        # a Codex model offered it called it itself to ask for permission: a question about no action at all.
        if structured is not None:
            self.system = system + "\nThis is a tool-less memory pass. Return only JSON matching this schema:\n" + json.dumps(structured)
        self.user = user
        self.tools = list(tools) + ([APPROVE] if structured is None and (brain_ref(model) or ("",))[0] == "claude" else [])
        self.images = [attachment for attachment in attachments if attachment.is_image]
        self.progress, self.thinking, self.event, self.execute = progress, thinking, event, execute
        self.seen, self.batch_calls = [], []
        self.tool_messages = []
        self.response = None
        self.permission_always = False
        # Why the turn failed ("missing", "login", "busy", "error", "quota", "rate_limited"), else None.
        self.failure = None
        self.actual_model = None
        self.driver = None
        self.task = None
        self._queue = asyncio.Queue()
        self._resume = None
        self._serial = asyncio.Lock()
        self._handoff_pending = False
        self._buffer = ""
        self._thought = ""
        self._calls = 0
        self._acted = False
        self._usage = {}
        self._guardrails = ToolGuardrails()
        self.failure_reason = None
        # A CLI reads its tool list once, when it starts: after a change (`catalog_changed`) it starts again in the same
        # thread, and is told why.
        self.catalog_changed = False
        self.reload_note = COMPUTER_CHANGED
        self.on_done = None
        self.activity_turn = None
        self.expire = expire
        self.wait_timeout_s = CONFIRM_TIMEOUT_S if wait_timeout_s is None else wait_timeout_s
        self.approval_wait_s = None

    @property
    def answered_by(self):
        """The model the turn records: the one the CLI's thread said answered, at the effort asked
        for, or the one asked for when the CLI names none."""
        if not self.actual_model:
            return self.model
        effort = brain_effort(self.model)
        return f"cli:{brain_ref(self.model)[0]}:{self.actual_model}" + (f"?effort={effort}" if effort else "")

    def _progress(self):
        if line := public_line(self._buffer, self.language):
            self.progress(line[:400])
        self._buffer = ""

    @tool_step(lambda self, identifier, name, args: name,
               scope=lambda self, *args: self.activity_turn)
    async def _tool(self, identifier, name, args):
        async with self._serial:
            # Every hand-off of a turn starts now; anything else waits for the delegated work.
            if self._handoff_pending and name != "handoff":
                return ToolOutcome(False, 'waiting_for_handoff')
            self._calls += 1
            self._progress()
            if name == "approve":
                decision = await self._permission(args)
                if decision in ("deny", "expired"):
                    answer = {"behavior": "deny", "message": phrase(self.language, "expired") if decision == "expired" else "The owner did not approve this action."}
                else:
                    answer = {"behavior": "allow", "updatedInput": args.get("input", args.get("tool_input", {}))}
                    if decision == "always" and isinstance(args.get("tool_name"), str):
                        answer["updatedPermissions"] = [{"type": "addRules", "rules": [{"toolName": args["tool_name"]}],
                                                        "behavior": "allow", "destination": "session"}]
                return ToolOutcome(True, content=json.dumps(answer))
            result = await self._execute(identifier, name, args)
            if not result.ok:
                result.content = json.dumps(tool_failure(result.kind, result.content).wire(), ensure_ascii=False)
            note = self._guardrails.after_call(name, args, result).note
            if result.ok and result.kind == 'handoff':
                self._handoff_pending = True
            shown = wrap_untrusted(name, result.instruction or result.content or result.kind or "", ok=result.ok)
            self.tool_messages.extend([
                {"role": "assistant", "content": None, "tool_calls": [{"id": identifier, "type": "function",
                    "function": {"name": name, "arguments": json.dumps(args, ensure_ascii=False)}}]},
                {"role": "tool", "tool_call_id": identifier, "content": shown},
            ])
            return ToolOutcome(result.ok, result.kind, shown + ("\n\n" + note if note else ""), blocks=result.blocks,
                               tools=result.tools, replace_tools=result.replace_tools)

    async def _execute(self, identifier, name, args):
        self.batch_calls = [Call(identifier, name, args)]
        self.approval_wait_s = None
        try:
            return await self.execute(identifier, name, args)
        except Stop as stop:
            if stop.kind != WAITING:
                self._queue.put_nowait(Outcome("stopped", kind=stop.kind))
                return ToolOutcome(False, "stopped")
            self._resume = asyncio.get_running_loop().create_future()
            self._queue.put_nowait(Outcome("stopped", kind=WAITING))
            try:
                wait_s = self.wait_timeout_s if self.approval_wait_s is None else self.approval_wait_s
                return await asyncio.wait_for(self._resume, wait_s + .1)
            except TimeoutError:
                if self.expire:
                    self.expire()
                return ToolOutcome(False, "expired", phrase(self.language, "expired"))
        except Exception as exc:
            failure = classify(exc)
            return ToolOutcome(False, failure.kind, json.dumps(failure.wire()))

    async def _permission(self, args):
        self._progress()
        outcome = await self._execute("permission", "cli_permission", args)
        if outcome.kind == "expired":
            return "expired"
        return ("always" if self.permission_always else "once") if outcome.ok else "deny"

    def continue_with(self, outcome):
        self.response = None
        if self._resume and not self._resume.done():
            self._resume.set_result(outcome)

    async def run(self):
        self.activity_turn = current()
        if self.task is None:
            self.task = asyncio.create_task(self._work())
            if self.on_done:
                self.task.add_done_callback(lambda _: self.on_done(self))
        getter = asyncio.ensure_future(self._queue.get())
        try:
            await asyncio.wait({getter, self.task}, return_when=asyncio.FIRST_COMPLETED)
            if not getter.done() and not self.task.cancelled():
                # The work ended without an outcome: it raised outside its own handling. Without this the
                # turn would wait forever.
                if self.task.exception() is not None:
                    logger.warning("CLI turn work failed before an outcome: %s", type(self.task.exception()).__name__)
                if not self._handed_off():
                    self._failure("error", NAMES[brain_ref(self.model)[0]])
            outcome = await getter
            if outcome.kind not in (WAITING, 'handoff'):
                if self.response is not None:
                    await self.aclose()
                else:
                    if not self.task.cancelled():
                        await asyncio.gather(self.task, return_exceptions=True)
            return outcome
        except asyncio.CancelledError:
            getter.cancel()
            await self.aclose()
            raise

    def cancel(self):
        if self.task and not self.task.cancelling():
            self.task.cancel()

    async def aclose(self):
        self.cancel()
        if self.task:
            await asyncio.gather(self.task, return_exceptions=True)

    async def disconnect(self):
        """Stop the child and release the waiting turn with the usual connection guidance."""
        await self.aclose()
        self._failure("login", NAMES[brain_ref(self.model)[0]])

    def _failure(self, reason, name):
        self.failure = reason
        if reason in KINDS:
            failure = self.failure_reason or Failure(reason, reason)
            message = failure.sentence(name, self.language)
            self.event(message)
            self._queue.put_nowait(Outcome("done", final=message))
            return
        messages = {
            "missing": f"請先安裝 {name}，再到設定 › 模型與用量登入。",
            "login": f"請先到設定 › 模型與用量 › 訂閱帳號，為 {name} 按下「連線」。",
            "busy": "這個對話仍有 CLI 回合執行中，請先完成或取消它。",
            "error": f"{name} 回合中斷。請確認 CLI 登入狀態後再試一次。",
            "quota": f"{name} 的訂閱額度暫時用完了，請稍後再試，或換一個模型。",
            "rate_limited": f"{name} 目前請求太頻繁而被限流，請稍後再試。",
        }
        if str(self.language).startswith("ja"):
            messages = {
                "missing": f"先に {name} をインストールし、設定 › モデルと使用量でログインしてください。",
                "login": f"設定 › モデルと使用量 › サブスクリプションアカウントで {name} の「接続」を押してください。",
                "busy": "この会話ではまだ CLI ターンが実行中です。完了するかキャンセルしてください。",
                "error": f"{name} が予期せず停止しました。ログイン状態を確認してからもう一度お試しください。",
                "quota": f"{name} の利用上限に達しました。しばらく待つか、別のモデルを選んでください。",
                "rate_limited": f"{name} はリクエストが多すぎるため一時的に制限されています。しばらくしてからもう一度お試しください。",
            }
        elif self.language != "zh-TW":
            messages = {"missing": f"Install {name}, then sign in in Settings > Models & usage.",
                        "login": f"Connect {name} in Settings > Models & usage > Subscription accounts.",
                        "busy": "This thread has an active CLI turn. Finish or cancel it first.",
                        "error": f"{name} stopped unexpectedly. Check its login and try again.",
                        "quota": f"{name} has used up its subscription quota for now. Try again later or pick another model.",
                        "rate_limited": f"{name} is rate-limited right now (too many requests). Try again in a little while."}
        self.event(messages[reason])
        self._queue.put_nowait(Outcome("done", final=messages[reason]))

    def _handed_off(self):
        """Whether the turn handed work off. If so, the task now waits for that work, however the turn ended:
        live, a turn cut at its first hand-off could start only one of a meeting's action items."""
        if self._handoff_pending:
            self._queue.put_nowait(Outcome('stopped', kind='handoff'))
        return self._handoff_pending

    def _rate_limit_wait(self, name, seconds):
        seconds = f"{round(seconds):g}"
        if str(self.language).startswith("ja"):
            return f"{name} はレート制限中です。{seconds} 秒後に再試行します。"
        if self.language != "zh-TW":
            return f"{name} is rate-limited; retrying in {seconds} s."
        return f"{name} 暫時限流，{seconds} 秒後重試。"

    async def _work(self):
        name, model = brain_ref(self.model)
        try:
            command = self.brains.command(name)
        except OSError:
            command = None
        if not command:
            self._failure("missing", NAMES[name])
            return
        if not self.brains.available(name, command=command):
            self._failure("login", NAMES[name])
            return
        # A colleague's question resumes no native session of this conversation: a member at work on something answers it too.
        lock = self.sessions.locks.setdefault((self.member_id, self.conversation_id), asyncio.Lock()) if self.resume_session else asyncio.Lock()
        if lock.locked():
            self._failure("busy", NAMES[name])
            return
        async with lock:
            began = time.perf_counter()
            try:
                # A stable, empty workspace keeps native CLI resume independent of turn temp files.
                workspace_root = native_directory("workspaces") or self.brains.home / ".raphael" / "cli-workspaces"
                workspace = workspace_root / str(self.member_id) / str(self.conversation_id) / name
                workspace.mkdir(parents=True, exist_ok=True)
                await secure_directory(workspace)
                async with RaphaelMcp(lambda: self.tools, self._tool) as server:
                    session = self.sessions.get(self.member_id, self.model, self.conversation_id) if self.resume_session else None
                    outage = Outage(RATE_LIMIT_WAITS_S if self.rate_limit_waits is None else self.rate_limit_waits, (), patient_ok=False)
                    failure = await self._attempt(name, command, model, server, session, workspace)
                    while failure == "tools_changed":
                        self.catalog_changed = False
                        session = self.sessions.get(self.member_id, self.model, self.conversation_id) if self.resume_session else None
                        if not self.user.startswith(self.reload_note):
                            self.user = self.reload_note + "\n" + self.user
                        failure = await self._attempt(name, command, model, server, session, workspace)
                    # Running the request again is safe only while nothing of it has happened yet. The owner is told once.
                    told = False
                    while failure in TRANSIENT and not (self._acted or self._calls):
                        wait = outage.wait(self.failure_reason.retry_after if self.failure_reason else None)
                        if wait is None:
                            break
                        if not told:
                            told = True
                            self.progress(self._rate_limit_wait(NAMES[name], wait) if failure == "rate_limit" else
                                          Failure(failure, self.failure_reason.reason if self.failure_reason else failure).sentence(NAMES[name], self.language))
                        await asyncio.sleep(wait)
                        failure = await self._attempt(name, command, model, server, session, workspace)
                if failure:
                    self._failure(failure, NAMES[name])
            except asyncio.CancelledError:
                raise
            except Exception as error:
                native_capture("loop-exception", {"type": type(error).__name__, "message": str(error)})
                # Protocol errors never publish provider diagnostics or private packet contents.
                frame = traceback.extract_tb(error.__traceback__)[-1]
                logger.warning("CLI turn failed: %s at %s:%d", type(error).__name__, frame.name, frame.lineno)
                if not self._handed_off():
                    self.failure_reason = classify(error)
                    self._failure(self.failure_reason.kind, NAMES[name])
            finally:
                if self.driver:
                    await self.driver.interrupt()
                def tokens(*keys):
                    value = next((self._usage[key] for key in keys if key in self._usage), 0)
                    return value if type(value) is int and 0 <= value < 10**10 else 0
                self.ledger.add(model=self.answered_by, cost_usd=0,
                    ms=int((time.perf_counter() - began) * 1000),
                    prompt_tokens=tokens("input_tokens", "inputTokens", "promptTokenCount"),
                    completion_tokens=tokens("output_tokens", "outputTokens", "candidatesTokenCount"))

    async def _attempt(self, name, command, model, server, session, workspace):
        with StreamSteps(lambda: self.activity_turn) as steps:
            return await self._stream_attempt(name, command, model, server, session, workspace, steps)

    async def _stream_attempt(self, name, command, model, server, session, workspace, steps):
        """Run the CLI once for this turn: None once its answer is queued, else why it failed."""
        self._buffer = self._thought = ""
        self.driver = Driver(name, command, model=model, effort=brain_effort(self.model), environ=self.brains.environ, quota=self.quota, home=self.brains.home)
        async with aclosing(self.driver.run(user=self.user, system=self.system, endpoint=server.url,
                token=server.token, session=session, permission=self._native_permission,
                **({"computer_endpoint": server.computer_url} if server.computer_url else {}),
                cwd=str(workspace), images=self.images if name in ("codex", "claude") else ())) as stream:
            async for event in stream:
                self.alive()
                if self.catalog_changed and event.kind in ("tool_end", "text_delta", "final", "error"):
                    await self.driver.interrupt()
                    return "tools_changed"
                if event.kind == "session" and self.resume_session:
                    self.sessions.put(self.member_id, self.model, event.text, self.conversation_id)
                elif event.kind == "model":
                    self.actual_model = event.text
                elif event.kind == "text_delta":
                    self._buffer = (self._buffer + event.text)[-64000:]
                elif event.kind == "thinking":
                    self._thought = (self._thought + event.text)[-240:]
                elif event.kind in ("tool_start", "permission"):
                    if event.kind == "tool_start":
                        steps.start(event.data)
                    self._acted = True
                    self._progress()
                    if line := public_line(self._thought, self.language):
                        self.thinking(line[:240])
                    self._thought = ""
                elif event.kind == "usage":
                    self._usage = event.data
                elif event.kind == "tool_end":
                    steps.end(event.data)
                    if event.data.get("effect") and event.data.get("ok"):
                        self.event("CLI 回報檔案已變更" if self.language == "zh-TW" else "CLI reported a file change")
                elif event.kind == "error":
                    native_capture("normalized-error", event.text)
                    if self._handed_off():
                        return None
                    self.failure_reason = classify({"kind": event.text, "message": event.data.get("reason", event.text),
                                                    "resets_at": event.data.get("resets_at")})
                    return self.failure_reason.kind
                elif event.kind == "final":
                    if self._handed_off():
                        return None
                    final = event.text.strip()
                    if final:
                        self._queue.put_nowait(Outcome("done", final=final))
                        return None
                    self._progress()
                    self.failure_reason = classify("CLI ended without an answer")
                    return "unknown"
        if self._handed_off():
            return None
        if self.catalog_changed:
            return "tools_changed"
        self.failure_reason = classify("CLI stream ended before completion")
        return "unknown"

    async def _native_permission(self, args):
        async with self._serial:
            return await self._permission(args)

    def reply(self, outcome):
        return parse_reply(outcome.final, self.language, plain=self.plain, long=True)

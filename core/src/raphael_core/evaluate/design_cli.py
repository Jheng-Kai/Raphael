"""Subscription-only, read-only image review through installed CLIs."""

import asyncio
import json
import os
import re
from pathlib import Path

from ..agent.cli.discovery import CliBrains
from ..agent.cli.drivers import CODEX_ISOLATION
from ..agent.cli.native_diagnostics import redact
from ..agent.cli.process import Child, PrivateFiles

REVIEW_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["reviews"], "properties": {
    "reviews": {"type": "array", "items": {"type": "object", "additionalProperties": False,
        "required": ["image", "score", "findings"], "properties": {
            "image": {"type": "string"}, "score": {"type": "integer", "minimum": 1, "maximum": 5},
            "findings": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                "required": ["rule_id", "hard", "detail"], "properties": {
                    "rule_id": {"type": "string"}, "hard": {"type": "boolean"}, "detail": {"type": "string"}}}}}}}}}


def subscription_environment(environ=None):
    """Keep subscription login, never API keys, custom API endpoints or provider switches."""
    return {key: value for key, value in (os.environ if environ is None else environ).items()
            if key == "CLAUDE_CODE_OAUTH_TOKEN" or not (re.search(r"API_KEY|AUTH_TOKEN|BASE_URL|API_BASE|API_KEY_HELPER", key, re.I)
                    or key.startswith(("CLAUDE_CODE_USE_", "CLAUDECODE")) or "openrouter" in value.lower())}


def default_model(brain):
    if brain == "claude":
        return "sonnet"
    # Reuse only the owner's model choice; ignore all provider/tool configuration.
    from ..native_journeys import native_codex_model
    return native_codex_model().removeprefix("cli:codex:")


class CliReviewer:
    def __init__(self, brain, model=None, *, environ=None, commands=None, timeout=240):
        if brain not in ("claude", "codex"):
            raise ValueError("unknown_judge_brain")
        self.brain, self.model = brain, model or default_model(brain)
        self.environ = subscription_environment(environ)
        self.command = CliBrains(environ=self.environ, commands=commands).command(brain)
        self.timeout = timeout
        self.version = None
        self.calls = []
        self.isolated_auth = False
        if not self.command:
            raise ValueError("judge_cli_missing")

    async def execute(self, command, prompt, cwd):
        private = PrivateFiles()
        child = None
        try:
            environ = self.environ.copy()
            if self.brain == "codex" and self.isolated_auth:
                await private.secure()
                home = Path(environ.get("CODEX_HOME") or Path.home() / ".codex")
                source = json.loads((home / "auth.json").read_text(encoding="utf-8-sig"))
                if source.get("auth_mode") != "chatgpt" or not source.get("tokens", {}).get("access_token"):
                    raise ValueError("judge_subscription_login_required")
                tokens = {key: source["tokens"].get(key, "") for key in ("access_token", "id_token", "account_id")}
                tokens["refresh_token"] = ""
                private.write("auth.json", json.dumps({"auth_mode": "chatgpt", "tokens": tokens, "last_refresh": source.get("last_refresh")}))
                environ["CODEX_HOME"] = str(private.path)
            child = Child(command, environ=environ, cwd=str(cwd))
            # Judge artifacts retain only a redacted, bounded diagnostic tail.
            child.stderr_tail = b""
            async with asyncio.timeout(self.timeout):
                await child.start()
                child.process.stdin.write(prompt.encode("utf-8"))
                await child.process.stdin.drain()
                child.process.stdin.close()
                chunks, size = [], 0
                while chunk := await child.process.stdout.read(65536):
                    size += len(chunk)
                    if size > 4 * 1024 * 1024:
                        raise ValueError("judge_cli_output_limit")
                    chunks.append(chunk)
                code = await child.process.wait()
                await child._stderr
                return code, b"".join(chunks).decode("utf-8", errors="replace"), child.stderr_tail.decode("utf-8", errors="replace")
        finally:
            if child is not None:
                await child.kill()
            await private.aclose()

    async def identify(self):
        code, text, _ = await self.execute([*self.command, "--version"], "", Path.cwd())
        if code or not text.strip():
            raise ValueError("judge_cli_version_failed")
        self.version = text.strip()[:160]
        if self.brain == "claude":
            code, text, _ = await self.execute([*self.command, "auth", "status", "--json"], "", Path.cwd())
            auth = json.loads(text) if not code else {}
            logged_in = auth.get("loggedIn") and auth.get("authMethod") == "claude.ai" and auth.get("apiProvider") == "firstParty"
        else:
            code, text, stderr = await self.execute([*self.command, "-c", 'cli_auth_credentials_store="file"', "login", "status"], "", Path.cwd())
            logged_in = not code and "using ChatGPT" in text + stderr
            if not logged_in:
                # Restricted shells may read auth.json while the CLI cannot read its original directory.
                # Borrow access only; never refresh a copy and invalidate the owner's rotating credentials.
                self.isolated_auth = True
                code, text, stderr = await self.execute([*self.command, "-c", 'cli_auth_credentials_store="file"', "login", "status"], "", Path.cwd())
                logged_in = not code and "using ChatGPT" in text + stderr
        if not logged_in:
            raise ValueError("judge_subscription_login_required")
        return f"cli:{self.brain}:{self.model}:{self.version}"

    async def review(self, prompt, images):
        files = PrivateFiles()
        call = {"brain": self.brain, "model": self.model, "version": self.version, "images": len(images),
                "transport": "subscription-cli", "openrouter_requests": 0,
                "authentication": "read-only-copy" if self.isolated_auth else "installed-subscription"}
        self.calls.append(call)
        try:
            await files.secure()
            paths = []
            for index, data in enumerate(images):
                path = files.path / f"image-{index}.{'png' if data.startswith(b'\x89PNG') else 'jpg'}"
                path.write_bytes(data)
                paths.append(str(path.resolve()))
            schema = files.write("review.schema.json", json.dumps(REVIEW_SCHEMA))
            if self.brain == "claude":
                command = [*self.command, "-p", "--output-format", "stream-json", "--verbose", "--model", self.model,
                           "--no-session-persistence", "--setting-sources", "", "--settings", '{"disableAllHooks":true}',
                           "--strict-mcp-config", "--mcp-config", files.write("mcp.json", '{"mcpServers":{}}'),
                           "--tools", "Read", "--allowedTools", "Read", "--permission-mode", "dontAsk", "--no-chrome",
                           "--disable-slash-commands", "--json-schema", json.dumps(REVIEW_SCHEMA)]
                prompt += "\nRead all images, in this exact order, using Read before reviewing:\n" + "\n".join(paths)
            else:
                command = [*self.command, "exec", "--ignore-user-config", "--ignore-rules", "--ephemeral", "--json",
                           "--skip-git-repo-check", "--sandbox", "read-only", "--model", self.model, "--output-schema", schema]
                overrides = {key: value for key, value in CODEX_ISOLATION.items() if not key.startswith("mcp_servers.")}
                overrides.update({"mcp_servers": {}, "model_provider": "openai", "approval_policy": "never"})
                for key, value in overrides.items():
                    command += ["-c", f"{key}={json.dumps(value)}"]
                for path in paths:
                    command += ["-i", path]
                command += ["-"]
            code, stdout, stderr = await self.execute(command, prompt, files.path)
            call.update(exit_code=code, stderr_tail=redact(stderr)[-4000:])
            packets = [json.loads(line) for line in stdout.splitlines() if line.strip()]
            failures = [packet for packet in packets if packet.get("type") in ("error", "turn.failed")
                        or packet.get("is_error")]
            if failures:
                call["error_events"] = [redact(json.dumps({key: packet[key] for key in ("type", "subtype", "error", "errors", "result") if key in packet}))[-4000:] for packet in failures]
            if code:
                raise ValueError("judge_cli_failed")
            if self.brain == "claude":
                blocks = [block for packet in packets for block in packet.get("message", {}).get("content", []) if isinstance(block, dict)]
                completed = {block.get("tool_use_id") for block in blocks if block.get("type") == "tool_result" and not block.get("is_error")}
                reads = {block.get("input", {}).get("file_path") for block in blocks
                         if block.get("type") == "tool_use" and block.get("name") == "Read" and block.get("id") in completed}
                normalized = lambda values: {os.path.normcase(str(Path(value).resolve())) for value in values if isinstance(value, str)}
                if not normalized(paths).issubset(normalized(reads)):
                    raise ValueError("judge_images_not_read")
                terminal = next((p for p in reversed(packets) if p.get("type") == "result"), None)
                if not terminal or terminal.get("is_error") or terminal.get("subtype") != "success":
                    raise ValueError("judge_cli_failed")
                call["models"] = list(terminal.get("modelUsage", {}))
                value = terminal.get("structured_output")
                return json.dumps(value) if value is not None else terminal.get("result", "")
            if any(p.get("type") in ("error", "turn.failed") for p in packets) or not any(p.get("type") == "turn.completed" for p in packets):
                raise ValueError("judge_cli_failed")
            final = [p["item"]["text"] for p in packets if p.get("type") == "item.completed" and p.get("item", {}).get("type") == "agent_message"]
            if not final:
                raise ValueError("judge_cli_failed")
            call["models"] = [self.model]
            return final[-1]
        finally:
            await files.aclose()

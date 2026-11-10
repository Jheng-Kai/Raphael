"""Owner-editable MCP proposals, backed by the existing config, connector and secret cards."""

import asyncio
import hashlib
import json
import secrets

from ..agent.safety import Proposed, DENY
from ..brain.settings import SettingsStore
from ..computer.local_tools import _SECRET, requires_command_approval
from ..protocol import invalid_params
from .client import McpFailure
from .config import parse_new_server
from .toolsets import tool_kind


def digest(fields):
    return hashlib.sha256(json.dumps(fields, sort_keys=True).encode()).hexdigest()


class ConnectionProposals:
    def __init__(self, conn, hub, *, secret_cards=None, notify=None, gate=None, ledger=None):
        self.conn, self.hub, self.keys, self.notify = conn, hub, secret_cards, notify
        self.gate, self.ledger = gate, ledger
        self.settings = SettingsStore(conn)
        self.resume = None
        self._locks = {}
        self._tasks = set()
        with conn:
            conn.execute("UPDATE connection_proposals SET state='draft', tested_digest='', error='interrupted' WHERE state='testing'")

    def _row(self, identifier):
        row = self.conn.execute("SELECT * FROM connection_proposals WHERE id=?", (identifier,)).fetchone()
        if row is None:
            raise invalid_params("There is no such proposal")
        return dict(row)

    def view(self, row):
        server = self.hub._config.get(row["server_id"])
        groups = []
        if row["state"] in ("tested", "enabled") and server:
            groups = [{"kind": kind, "tools": [tool.name for tool in server.tools if tool_kind(tool) == kind]}
                      for kind in ("write", "read")]
        return {"id": row["id"], "fields": json.loads(row["fields"]), "state": row["state"],
                "revision": row["revision"], "groups": groups, "error": row["error"] or None,
                "first_local": not self.settings.get("local_commands_seen")}

    def views(self, turns):
        from ..brain.db import rows_for_turns
        found = {turn: [] for turn in turns}
        for row in rows_for_turns(self.conn, "connection_proposals", found):
            found[row["turn_id"]].append(self.view(dict(row)))
        return found

    def pending(self, turn):
        return self.conn.execute("SELECT 1 FROM connection_proposals WHERE turn_id=? AND state NOT IN ('enabled','cancelled')", (turn,)).fetchone() is not None

    def _validated(self, fields, old=None):
        allowed = {"name", "transport", "command", "args", "url", "env", "headers"}
        if not isinstance(fields, dict) or set(fields) - allowed:
            raise invalid_params("Only public MCP configuration and secret names are accepted")
        raw = dict(fields)
        for field in ("env", "headers"):
            names = raw.get(field, [])
            if not isinstance(names, list) or any(not isinstance(name, str) for name in names):
                raise invalid_params("Secrets must be names only; use the secret card for values")
            raw[field] = [{"name": name, "value": "validation-only"} for name in names]
        try:
            new = parse_new_server(raw, [s.name for s in self.hub._config.servers() if s is not old])
        except (ValueError, TypeError):
            raise invalid_params("Invalid MCP configuration") from None
        config = new.config
        public = {"name": config.name, "transport": config.transport, "command": config.command,
                  "args": config.args, "url": config.url, "env": config.env, "headers": config.headers}
        return config, public

    async def propose(self, *, turn_id, member_id, conversation_id, language, fields, done=(), existing=None, external=True):
        config, public = self._validated(fields, existing)
        if existing:
            config = existing
            await self.hub._set_enabled({"id": config.id, "enabled": False})
        else:
            self.hub._config.add(config)
        identifier = secrets.token_hex(12)
        try:
            with self.conn:
                self.conn.execute("INSERT INTO connection_proposals (id,turn_id,member_id,conversation_id,language,server_id,fields,external,state,done) VALUES (?,?,?,?,?,?,?,?,'draft',?)",
                    (identifier, turn_id, member_id, conversation_id, language, config.id, json.dumps(public), int(external), json.dumps(list(done))))
        except BaseException:
            if not existing:
                self.hub._config.remove(config.id)
            raise
        self._secret_cards(self._row(identifier))
        self.hub._changed()
        self._changed(self._row(identifier))
        return self.view(self._row(identifier))

    def _secret_cards(self, row):
        if self.keys:
            self.keys.show(turn_id=row["turn_id"], member_id=row["member_id"], conversation_id=row["conversation_id"],
                connection=row["server_id"], secret=None, language=row["language"], done=json.loads(row["done"]))

    def _changed(self, row):
        if self.notify:
            self.notify("agent.turn", {"turn_id": row["turn_id"], "member_id": row["member_id"]})

    def _move(self, row, state, *, error="", tested=""):
        with self.conn:
            self.conn.execute("UPDATE connection_proposals SET state=?, error=?, tested_digest=? WHERE id=? AND (state!='cancelled' OR ?='cancelled')",
                              (state, error, tested, row["id"], state))
        self._changed(row)

    async def _screen(self, row, operation):
        if self.gate is None:
            return
        fields = json.loads(row["fields"])
        screening = await self.gate.screen(Proposed("add_mcp_server", "Test or enable a custom MCP server",
            json.dumps({"operation": operation, **fields}), "add_mcp_server"), language=row["language"], ledger=self.ledger())
        if screening.verdict == DENY:
            raise invalid_params("An owner rule forbids this connection")

    def _check_current(self, row, server):
        current = self._row(row["id"])
        if (current["state"] == "cancelled" or current["revision"] != row["revision"]
                or self.hub._config.get(server.id) is not server or server.enabled):
            raise invalid_params("The connection changed; review the proposal again")

    async def act(self, params, *, resume=True):
        identifier = params.get("id")
        if not isinstance(identifier, str):
            raise invalid_params("id is required")
        async with self._locks.setdefault(identifier, asyncio.Lock()):
            row = self._row(identifier)
            if type(params.get("revision")) is not int or params["revision"] != row["revision"]:
                raise invalid_params("The proposal changed; review it again")
            if row["state"] in ("enabled", "cancelled"):
                return {"proposal": self.view(row)}
            server = self.hub._config.get(row["server_id"])
            if server is None or server.enabled:
                raise invalid_params("The connection changed outside this proposal")
            operation = params.get("operation")
            if operation == "edit":
                config, public = self._validated(params.get("fields"), server)
                previous = {"env": set(server.env), "headers": set(server.headers)}
                for field in public:
                    setattr(server, field, getattr(config, field))
                server.tools, server.tools_checked_at_ms = [], None
                self.hub._config.save()
                self.hub._connector.invalidate(server.id)
                from .vault import secret_name
                removed = [(kind, name) for field, kind in (("env", "env"), ("headers", "header"))
                           for name in previous[field] - set(getattr(config, field))]
                self.hub._forget([secret_name(server.id, kind, name) for kind, name in removed])
                with self.conn:
                    self.conn.execute("UPDATE secret_cards SET name=? WHERE turn_id=? AND server_id=?", (server.name, row["turn_id"], server.id))
                    for kind, name in removed:
                        self.conn.execute("DELETE FROM secret_cards WHERE turn_id=? AND server_id=? AND kind=? AND secret=?",
                                          (row["turn_id"], server.id, kind, name))
                    self.conn.execute("UPDATE connection_proposals SET fields=?, state='draft', revision=revision+1, tested_digest='', error='' WHERE id=?",
                                      (json.dumps(public), identifier))
                self._secret_cards(self._row(identifier))
                self.hub._changed()
            elif operation == "test":
                await self._screen(row, operation)
                self._check_current(row, server)
                missing = self.hub.missing_secrets(server.id)
                if missing and missing[1]:
                    self._secret_cards(row)
                    self._move(row, "draft", error="missing_secret")
                    return {"proposal": self.view(self._row(identifier))}
                if server.transport == "stdio":
                    command = " ".join([server.command, *server.args])
                    if self.settings.get("local_commands_mode") == "never" or _SECRET.search(command):
                        self._move(row, "draft", error="local_disabled")
                        return {"proposal": self.view(self._row(identifier))}
                    if requires_command_approval(self.settings, command, external=bool(row["external"])):
                        choice = params.get("local_choice")
                        if row["state"] != "approval" or choice not in ("once", "always", "never", "deny"):
                            self._move(row, "approval")
                            return {"proposal": self.view(self._row(identifier))}
                        self.settings.set("local_commands_seen", True)
                        if choice in ("always", "never"):
                            self.settings.set("local_commands_mode", choice)
                        if choice in ("never", "deny"):
                            self._move(row, "draft", error="declined")
                            return {"proposal": self.view(self._row(identifier))}
                self._move(row, "testing")
                try:
                    tools = await self.hub._connector.list_tools(server)
                    if self.hub._config.get(server.id) is not server or self._row(identifier)["state"] != "testing":
                        raise invalid_params("The connection changed while testing")
                    server.tools, server.tools_checked_at_ms = tools, self.hub._now_ms()
                    self.hub._config.save()
                    tested = digest({"fields": json.loads(row["fields"]), "tools": [t.fingerprint for t in tools]})
                    self._move(row, "tested", tested=tested)
                except McpFailure as failure:
                    self._move(row, "draft", error=failure.kind)
                except asyncio.CancelledError:
                    self._move(row, "draft", error="interrupted")
                    raise
                except Exception:
                    self._move(row, "draft", error="test_failed")
                finally:
                    self.hub._connector.invalidate(server.id)
            elif operation == "enable":
                await self._screen(row, operation)
                self._check_current(row, server)
                current = {"name": server.name, "transport": server.transport, "command": server.command, "args": server.args,
                           "url": server.url, "env": server.env, "headers": server.headers}
                if row["state"] != "tested" or row["tested_digest"] != digest({"fields": current, "tools": [t.fingerprint for t in server.tools]}):
                    raise invalid_params("Test the current configuration before enabling it")
                await self.hub._set_enabled({"id": server.id, "enabled": True})
                self._move(row, "enabled")
                if resume:
                    self._start_resume(row)
            elif operation == "cancel":
                await self.hub._disconnect({"id": server.id})
                self._cancel_secrets(row)
                self._move(row, "cancelled")
            else:
                raise invalid_params("Unknown proposal operation")
            self._changed(row)
            return {"proposal": self.view(self._row(identifier))}

    def _start_resume(self, row):
        if self.resume and not self.pending(row["turn_id"]):
            task = asyncio.create_task(self._resume(row))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)

    async def _resume(self, row):
        claimed = self.keys is not None and self.keys.store.claim_resume(row["turn_id"])
        ok, made = False, ()
        try:
            outcome = await self.resume(row["turn_id"], 1)
            ok, made = bool(getattr(outcome, "ok", False)), tuple(getattr(outcome, "made", ()))
            if not ok:
                self._move(row, "enabled", error="resume_failed")
        except asyncio.CancelledError:
            raise
        except Exception:
            self._move(row, "enabled", error="resume_failed")
        finally:
            if claimed:
                self.keys.store.resume_finished(row["turn_id"], ok, made)
            self._changed(row)

    def _cancel_secrets(self, row):
        with self.conn:
            self.conn.execute("UPDATE secret_cards SET state='cancelled' WHERE turn_id=? AND server_id=? AND state IN ('pending','failed','saved')",
                              (row["turn_id"], row["server_id"]))

    def cancel_session(self, session):
        rows = self.conn.execute("SELECT p.* FROM connection_proposals p JOIN agent_turns t ON t.id=p.turn_id WHERE t.session_id=? AND p.state NOT IN ('enabled','cancelled')", (session,)).fetchall()
        for item in rows:
            row = dict(item)
            self._move(row, "cancelled")
            self._cancel_secrets(row)
            server = self.hub._config.get(row["server_id"])
            if server:
                server.enabled = False
                self.hub._connector.invalidate(server.id)
                self.hub._config.save()

    async def aclose(self):
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)

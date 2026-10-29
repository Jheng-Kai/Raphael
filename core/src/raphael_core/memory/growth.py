"""Shared memory tools and permission-scoped, silent FTS recall.

The caller identity is supplied by the host, never by tool arguments. Pending
changes live outside bot homes and can only be resolved by the owner's RPC path.
"""

import json
import re
import secrets
import sqlite3
from datetime import datetime

from ..agent.tools import ToolResult
from ..bots.homes import HomeError, atomic, digest, redact_secrets
from .store import MemoryRefused, TYPES, valid_name
from .terms import tokens

WRITE_TOOLS = frozenset(("memory_update", "memory_log"))
READ_TOOLS = frozenset(("session_search", "session_read"))
TOOLS = WRITE_TOOLS | READ_TOOLS
MAX_CHARS = 1000
RECALL_CHARS = 6000


def definition(description, properties, required):
    return {"description": description, "parameters": {"type": "object", "properties": properties,
                                                       "required": required, "additionalProperties": False}}


DEFINITIONS = {
    "memory_update": definition(
        "Keep a useful fact, preference, decision or work outcome without waiting for a remember phrase. "
        "Private turns write only your own home. Shared writes require an explicit owner sharing request or room context. "
        "After external content, changes wait for owner approval. Read before replacing; use expected_hash from session_read.",
        {"op": {"type": "string", "enum": ["add", "replace", "supersede", "remove"]},
         "name": {"type": "string", "description": "Type-prefixed ASCII slug, e.g. reference-build."},
         "body": {"type": "string", "maxLength": MAX_CHARS},
         "description": {"type": "string", "maxLength": 80},
         "type": {"type": "string", "enum": list(TYPES)},
         "until": {"type": "string", "description": "Optional expiry, YYYY-MM-DD."},
         "space": {"type": "string", "enum": ["own", "shared"]},
         "expected_hash": {"type": "string"}}, ["op", "name"]),
    "memory_log": definition("Append a work outcome to your own daily log (at most 1000 characters). Logs are searchable but never in the system prompt. External-content turns wait for owner approval.",
                             {"body": {"type": "string", "maxLength": MAX_CHARS}}, ["body"]),
    "session_search": definition("Search only your own conversations, rooms you currently belong to, your own memory topics/logs/archive, and shared owner/team notes. Other members' private content is inaccessible; ask_member is the way to ask them.",
                                 {"query": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": 8}}, ["query"]),
    "session_read": definition("Read a permitted search hit by its opaque id. Membership and privacy are checked again. Returns at most 6000 characters and a hash for memory replacement.",
                               {"id": {"type": "string"}, "offset": {"type": "integer", "minimum": 0}}, ["id"]),
}


def prompt_document(store):
    """Newest facts in MEMORY.md; overflow stays searchable in the archive/topics."""
    notes = sorted((note for note in store.all() if not note.expired(store.today())),
                   key=lambda note: (note.updated, note.created, note.name), reverse=True)
    kept = []
    for note in notes:
        from .store import _index_line
        block = f"## {note.name}\n{_index_line(note)}\n{note.body}\n"
        proposed = "\n".join([*kept, block])
        if len(proposed.splitlines()) <= 200 and len(proposed.encode("utf-8")) <= 24000:
            kept.append(block)
    return "\n".join(kept)


def tainted_turn(turn, steps=()):
    """Persisted public steps are enough to conservatively detect external ingestion."""
    return bool(turn.attachments or turn.route == "operate" or any(
        step.tool in ("web_search", "web_read", "read_attachment", "computer", "ask_member")
        or step.detail == "external_content"
        or step.server not in (None, "", "Raphael") for step in steps
    ))


def archive_document(store):
    """A bounded overflow view; canonical topics retain every fact."""
    document = prompt_document(store)
    overflow = [note for note in store.all() if not note.expired(store.today()) and f"## {note.name}\n" not in document]
    archive = "\n\n".join(f"## {note.name}\n{note.description}\n{note.body}" for note in overflow)
    if len(archive.encode("utf-8")) > 120000:
        archive = "\n".join(f"memory/{note.name}.md: {note.description}" for note in overflow)
        archive = archive.encode("utf-8")[:120000].decode("utf-8", errors="ignore")
    return archive


class Growth:
    """MemoryService methods kept together so API and CLI share one implementation."""

    def growth(self, name, args, *, untrusted=False, member_id=0):
        if name == "session_search":
            return self.session_search(member_id, args.get("query", ""), args.get("limit", 8))
        if name == "session_read":
            return self.session_read(member_id, args.get("id"), args.get("offset", 0))
        if name == "memory_update":
            return self.update_memory(member_id, args, untrusted=untrusted)
        if name == "memory_log":
            return self.log_memory(member_id, args, untrusted=untrusted)
        return ToolResult(name, False, None, "unknown_tool")

    def _pending_path(self, member_id, name):
        if not isinstance(name, str) or not re.fullmatch(r"reference-pending-[a-f0-9]{24}", name):
            raise ValueError("invalid pending id")
        return self.homes.safe(self.homes.state(member_id) / "pending" / (name + ".json"))

    def pending(self, member_id):
        folder = self.homes.safe(self.homes.state(member_id) / "pending")
        found = []
        for path in sorted(folder.glob("reference-pending-*.json")):
            try:
                found.append(json.loads(self.homes.safe(path).read_text(encoding="utf-8")))
            except (OSError, ValueError):
                continue
        return found

    def _pending_view(self, item):
        args = item["arguments"]
        before = item["before"] or {}
        proposal = (before.get("body") if args.get("op") == "remove" else args.get("body")) or before.get("body") or args.get("name", "")
        return {"name": item["name"], "description": args.get("description") or before.get("description") or args.get("name") or "Daily log",
                "type": args.get("type") or before.get("type") or "reference", "origin": "pending", "body": proposal,
                "operation": args.get("op", "log"), "target": args.get("name", ""),
                "space": args.get("space", "own") if item["share"] else "own",
                "created": str(item["created"]), "updated": "", "expires": args.get("until"), "member": None, "turns": []}

    def _capture_pending(self, member_id, actions):
        from .reflection import Applied
        applied = Applied()
        for action in actions:
            op = "remove" if action.op == "DELETE" else "replace" if self.store_for(member_id).get(action.name) else "add"
            result = self.update_memory(member_id, {"op": op, "name": action.name, "body": action.body,
                "type": action.type, "description": action.description, "until": action.expires}, untrusted=True)
            if not result.ok:
                applied.refused.append(result.error)
        return applied

    def _stage(self, member_id, tool, args, share):
        name = "reference-pending-" + secrets.token_hex(12)
        store = self.shared if share and args.get("space") == "shared" else self.store_for(member_id)
        target = store.get(args.get("name", ""))
        item = {"name": name, "tool": tool, "arguments": args, "share": share,
                "before": None if target is None else target.view(), "created": self._now_ms()}
        atomic(self._pending_path(member_id, name), json.dumps(item, ensure_ascii=False).encode("utf-8"))
        self._changed(member_id)
        return ToolResult(tool, True, {"pending": name, "applied": False})

    def resolve_pending(self, member_id, name, *, approve):
        try:
            path = self._pending_path(member_id, name)
            item = json.loads(path.read_text(encoding="utf-8"))
            if approve:
                args = item["arguments"]
                store = self.shared if item["share"] and args.get("space") == "shared" else self.store_for(member_id)
                target = store.get(args.get("name", ""))
                if (None if target is None else target.view()) != item["before"]:
                    return ToolResult(item["tool"], False, None, "changed")
                result = (self.log_memory(member_id, args) if item["tool"] == "memory_log" else
                          self.update_memory(member_id, args, share=item["share"]))
                if not result.ok:
                    return result
            path.unlink()
            self._changed(member_id)
            return ToolResult("memory_pending", True, {"approved": approve})
        except (OSError, ValueError, KeyError):
            return ToolResult("memory_pending", False, None, "not_found")

    def update_memory(self, member_id, args, *, untrusted=False, share=False):
        tool = "memory_update"
        try:
            body = args.get("body")
            if body is not None and (not isinstance(body, str) or len(body) > MAX_CHARS):
                return ToolResult(tool, False, None, "bad_arguments")
            name, op = args.get("name"), args.get("op")
            if not valid_name(name) or op not in ("add", "replace", "supersede", "remove"):
                return ToolResult(tool, False, None, "bad_arguments")
            store = self.shared if share and args.get("space") == "shared" else self.store_for(member_id)
            old = store.get(name)
            if op != "add" and old is None:
                return ToolResult(tool, False, None, "not_found")
            if op == "add" and old is not None:
                if old.body == str(args.get("body", "")).strip():
                    return ToolResult(tool, True, {"name": name, "unchanged": True})
                return ToolResult(tool, False, None, "exists")
            path = store.root / (name + ".md")
            expected = args.get("expected_hash")
            if expected is not None and expected != digest(path.read_bytes() if path.exists() else None):
                return ToolResult(tool, False, None, "changed")
            clean = {key: value for key, value in args.items() if key in
                     ("op", "name", "body", "type", "description", "until", "space", "expected_hash")}
            if op != "remove":
                body = clean.get("body")
                if not isinstance(body, str) or not body.strip() or len(body) > MAX_CHARS:
                    return ToolResult(tool, False, None, "bad_arguments")
                clean["body"] = redact_secrets(body)
                clean["type"] = clean.get("type") or (old.type if old else name.split("-", 1)[0])
                clean["description"] = redact_secrets(clean.get("description") or " ".join(clean["body"].split())[:80])
                store.check(name=name, type=clean["type"], description=clean["description"], body=clean["body"], expires=clean.get("until"))
            if untrusted:
                return self._stage(member_id, tool, clean, share)
            if op == "remove":
                store.delete(name)
            else:
                store.write(name, type=clean["type"], description=clean["description"], body=clean["body"],
                            expires=clean.get("until"), origin="inferred")
            return ToolResult(tool, True, {"name": name, "applied": True})
        except (MemoryRefused, HomeError, OSError, TypeError, ValueError) as exc:
            return ToolResult(tool, False, None, exc.kind if isinstance(exc, MemoryRefused) else "bad_arguments")

    def log_memory(self, member_id, args, *, untrusted=False):
        body = args.get("body")
        if not isinstance(body, str) or not body.strip() or len(body) > MAX_CHARS:
            return ToolResult("memory_log", False, None, "bad_arguments")
        body = redact_secrets(body.strip())
        if untrusted:
            return self._stage(member_id, "memory_log", {"body": body}, False)
        day = datetime.fromtimestamp(self._now_ms() / 1000).date().isoformat()
        relative = f"memory/log/{day}.md"
        try:
            path = self.homes.path(member_id, relative)
            old = path.read_bytes() if path.exists() else None
            text = (old.decode("utf-8") if old else "") + "\n" + body + "\n"
            self.homes.write(member_id, relative, text, expected_hash=digest(old))
            self._changed(member_id)
            return ToolResult("memory_log", True, {"path": relative})
        except (HomeError, OSError):
            return ToolResult("memory_log", False, None, "full")

    def _documents(self, member_id, *, private=True, conversation_id=None, include_rooms=True):
        """Enumerate only authorized sources; never enumerate another member's home."""
        stores = [("shared", self.shared)]
        if private:
            stores.append(("own", self.store_for(member_id)))
        for prefix, store in stores:
            for note in store.all():
                if not note.expired(store.today()):
                    yield f"{prefix}:memory/{note.name}.md", note.description + "\n" + note.body, "memory"
        relatives = []
        if private:
            archive = archive_document(self.store_for(member_id))
            if archive:
                yield "own:memory/archive.md", archive, "memory"
            relatives = ["memory/log/" + p.name for p in
                         self.homes.safe(self.homes.home(member_id) / "memory/log").glob("*.md")]
        for relative in relatives:
            path = self.homes.path(member_id, relative)
            if path.exists():
                yield "own:" + relative, path.read_text(encoding="utf-8"), "memory"
        # Reconstruct derived views silently so a file written yesterday cannot
        # reintroduce a topic that expired today.
        active = [note for note in self.shared.all() if not note.expired(self.shared.today())]
        for name, ongoing in (("USER.md", False), ("team.md", True)):
            text = "\n\n".join(f"## {note.name}\n{note.description}\n{note.body}" for note in active if (note.type == "ongoing") == ongoing)
            if text:
                yield "shared:" + name, text, "memory"
        for row in self._conn.execute(
            "SELECT id, question, text, detail FROM agent_turns WHERE member_id=? AND scope='private' AND status='done' AND (? IS NULL OR conversation_id=?) ORDER BY id DESC",
            (member_id if private else -1, conversation_id, conversation_id),
        ):
            yield f"turn:{row[0]}", f"Owner: {row[1]}\nAssistant: {row[2]}\n{row[3] or ''}", "conversation"
        for row in self._conn.execute(
            "SELECT m.id,m.text FROM room_messages m JOIN room_members r ON r.room_id=m.room_id WHERE r.member_id=? ORDER BY m.id DESC",
            (member_id if include_rooms else -1,),
        ):
            yield f"room:{row[0]}", row[1], "conversation"

    def _search_hits(self, member_id, query, limit, kind=None, *, private=True, conversation_id=None, include_rooms=True):
        terms = list(dict.fromkeys(tokens(str(query)[:1000])))[:32]
        if not terms:
            return []
        # An ephemeral FTS index contains only the permitted corpus. No disk, events,
        # or updates to application state occur on a read, even on a cache miss.
        with sqlite3.connect(":memory:") as index:
            index.execute("CREATE VIRTUAL TABLE docs USING fts5(id UNINDEXED, body UNINDEXED, kind UNINDEXED, terms)")
            index.executemany("INSERT INTO docs VALUES (?,?,?,?)", (
                (identifier, body, source, " ".join(tokens(body)))
                for identifier, body, source in self._documents(member_id, private=private, conversation_id=conversation_id, include_rooms=include_rooms) if kind is None or source == kind))
            match = " OR ".join('"' + term.replace('"', '""') + '"' for term in terms)
            rows = index.execute("SELECT id,body,kind FROM docs WHERE docs MATCH ? ORDER BY bm25(docs) LIMIT ?", (match, limit))
            return [{"id": row[0], "text": row[1][:1200], "kind": row[2]} for row in rows]

    def _source_untrusted(self, identifier):
        if identifier.startswith("room:"):
            return True
        if identifier.startswith("turn:"):
            turn = self._history.get(int(identifier.partition(":")[2]))
            return turn is not None and tainted_turn(turn, self._history.steps([turn.id]).get(turn.id, ()))
        return False

    def session_search(self, member_id, query, limit=8, *, private=True):
        limit = max(1, min(limit, 8)) if type(limit) is int else 8
        hits = self._search_hits(member_id, query, limit, private=private)
        return ToolResult("session_search", True, {"hits": hits}, untrusted=any(self._source_untrusted(hit["id"]) for hit in hits))

    def session_read(self, member_id, identifier, offset=0, *, private=True):
        if type(offset) is not int or offset < 0:
            return ToolResult("session_read", False, None, "bad_arguments")
        for name, body, _ in self._documents(member_id, private=private):
            if name == identifier:
                result = {"id": name, "text": body[offset:offset + RECALL_CHARS], "more": len(body) > offset + RECALL_CHARS}
                if name.startswith("own:memory/") or name.startswith("shared:memory/"):
                    prefix, relative = name.split(":", 1)
                    path = (self.homes.path(member_id, relative) if prefix == "own" else
                            self.homes.safe(self.homes.root / "shared" / relative))
                    result["hash"] = digest(path.read_bytes())
                return ToolResult("session_read", True, result, untrusted=self._source_untrusted(name))
        return ToolResult("session_read", False, None, "not_found")

    def recall(self, member_id, query):
        return self.recall_result(member_id, query)[0]

    def recall_result(self, member_id, query, *, private=True, conversation_id=None):
        # Automatic recall respects the current thread. Explicit session_search
        # can deliberately retrieve the member's other threads and joined rooms.
        scope = dict(private=private, conversation_id=conversation_id, include_rooms=False)
        hits = self._search_hits(member_id, query, 4, "memory", **scope) + self._search_hits(member_id, query, 4, "conversation", **scope)
        if not hits:
            return "", False
        from ..worker.guards import wrap_untrusted
        text = "\n".join(json.dumps(hit, ensure_ascii=False) for hit in hits)
        # The cap includes wrappers. This block belongs before the user's question,
        # never in a system prompt; content remains untrusted retrieval data.
        return wrap_untrusted("auto_recall", text[:RECALL_CHARS - 300], ok=True)[:RECALL_CHARS], any(self._source_untrusted(hit["id"]) for hit in hits)

"""Immutable member recipes offered for the owner to review in their conversation."""

import asyncio
import json
import secrets

from ..protocol import invalid_params
from .templates import checked, description
from .template_author import write


class TemplateCards:
    def __init__(self, service):
        self.service = service
        self.conn = service._conn

    def register(self, router):
        router.register("members.template_card", self.review)
        router.register("members.template_card_export", self.save)
        router.register("members.template_card_publish", self.publish)

    def _row(self, params):
        identifier = params.get("id")
        if not isinstance(identifier, str):
            raise invalid_params("id must name a template card")
        row = self.conn.execute("SELECT c.* FROM member_template_cards c JOIN agent_turns t ON t.id=c.turn_id WHERE c.id=?", (identifier,)).fetchone()
        if row is None:
            raise invalid_params("id must name a template card")
        return row

    def _changed(self, row):
        if self.service._notify:
            self.service._notify("agent.turn", {"turn_id": row["turn_id"], "member_id": row["member_id"]})

    async def show(self, turn_id, member_id, text, *, ledger=None):
        text = description(text)
        member = self.service.store.member(member_id)
        turn = self.service._history.get(turn_id)
        if not member_id or member is None or turn is None or turn.member_id != member_id or turn.scope != "private":
            raise invalid_params("Only a member's own conversation can share its template")
        def current():
            latest = self.service._history.get(turn_id)
            task = asyncio.current_task()
            if task and task.cancelling():
                raise asyncio.CancelledError
            if (self.service.store.member(member_id) is None or latest is None
                    or latest.status not in ("queued", "running")):
                raise invalid_params("The member conversation is no longer running")
        value, warnings = await write(self.service, member_id, text, ledger=ledger, current=current)
        identifier = secrets.token_hex(8)
        with self.conn:
            self.conn.execute("INSERT INTO member_template_cards (id,turn_id,member_id,template,findings,avatar,state) VALUES (?,?,?,?,?,?,'draft')",
                              (identifier, turn_id, member_id, json.dumps(value, ensure_ascii=False), json.dumps(warnings), member.avatar))
        self._changed(self._row({"id": identifier}))
        return {"id": identifier, "text": "Your template card is shown in this conversation. The owner can review, save or publish this snapshot. End with one short sentence."}

    async def review(self, params):
        row = self._row(params)
        return {"template": json.loads(row["template"]), "findings": json.loads(row["findings"])}

    def _safe(self, row):
        if any(item["kind"] == "secret" for item in json.loads(row["findings"])):
            raise invalid_params("Remove private credentials from the member recipe first")
        return checked(json.loads(row["template"]))

    async def save(self, params):
        row = self._row(params)
        value = self._safe(row)
        with self.conn:
            self.conn.execute("UPDATE member_template_cards SET state='saved' WHERE id=?", (row["id"],))
        self._changed(row)
        return {"text": json.dumps(value, ensure_ascii=False, indent=2) + "\n"}

    async def publish(self, params):
        from .member_catalog import handle
        row = self._row(params)
        value = self._safe(row)
        result = await handle(self.service, {"action": "publish", "template": value})
        with self.conn:
            self.conn.execute("UPDATE member_template_cards SET state='published',url=? WHERE id=?", (result["url"], row["id"]))
        self._changed(row)
        return result

    def views(self, ids):
        from ..brain.db import rows_for_turns
        result = {}
        for row in rows_for_turns(self.conn, "member_template_cards", ids):
            value = json.loads(row["template"])
            result.setdefault(row["turn_id"], []).append({"id": row["id"], "state": row["state"], "name": value["name"], "avatar": row["avatar"],
                "description": value.get("description", ""), "counts": {"skills": len(value["skills"]), "routines": len(value["routines"])},
                "connections": value["connections"], "findings": json.loads(row["findings"]), **({"url": row["url"]} if row["url"] else {})})
        return result

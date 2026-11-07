"""Durable owner answers. These cards grant no permission to execute an action."""
import json
import secrets

from ..clock import wall_clock_ms
from ..protocol import invalid_params

ASK_OWNER = "ask_owner"
OWNER_CARDS = frozenset((ASK_OWNER, "connect_app", "request_secret", "email_draft", "slack_draft", "show_page"))
BACKGROUND_TOOLS = OWNER_CARDS | {"update_page", "find_app"}


def question_input(args):
    question = args.get("question")
    options = args.get("options", [])
    free_text = args.get("free_text", True)
    if (not isinstance(question, str) or not question.strip() or len(question) > 2000
            or not isinstance(options, list) or len(options) > 4
            or any(not isinstance(item, str) or not item.strip() or len(item) > 80 for item in options)
            or len(set(options)) != len(options) or type(free_text) is not bool or not (options or free_text)):
        raise ValueError("invalid owner question")
    return {"question": question.strip(), "options": options, "free_text": free_text}


class OwnerQuestions:
    def __init__(self, conn, changed=lambda task_id: None, now_ms=wall_clock_ms):
        self.conn, self.changed, self.now_ms = conn, changed, now_ms
        self.on_cancel = None

    def view(self, row):
        return {"id": row["id"], "task_id": row["task_id"], "turn_id": row["turn_id"],
                "member_id": row["member_id"], "kind": row["kind"], "card_id": row["card_id"],
                **json.loads(row["payload"]), "state": "asked" if row["result"] is None else
                ("cancelled" if json.loads(row["result"]).get("state") == "cancelled" else "answered"),
                "result": json.loads(row["result"]) if row["result"] else None}

    def get(self, identifier):
        row = self.conn.execute("SELECT * FROM owner_questions WHERE id=?", (identifier,)).fetchone()
        return self.view(row) if row else None

    def for_turn(self, turn_id):
        return [self.view(row) for row in self.conn.execute("SELECT * FROM owner_questions WHERE turn_id=? ORDER BY created_at_ms, rowid", (turn_id,))]

    def pending(self):
        return [{**self.view(row), "room_id": row["room_id"]} for row in self.conn.execute(
            "SELECT q.*, t.room_id AS room_id FROM owner_questions q JOIN worker_tasks t ON t.id=q.task_id "
            "WHERE q.result IS NULL AND t.state IN ('running','waiting','queued') ORDER BY q.created_at_ms")]

    def in_conversation(self, *, conversation_id=None, member_id=None, room_id=None, thread_id=None):
        return [self.view(row) for row in self.conn.execute(
            "SELECT q.* FROM owner_questions q JOIN agent_turns a ON a.id=q.turn_id "
            "JOIN worker_tasks t ON t.id=q.task_id WHERE q.kind='ask_owner' AND q.result IS NULL "
            "AND t.state IN ('running','waiting','queued') AND "
            "((? IS NOT NULL AND a.scope='private' AND a.conversation_id=? "
            "AND (a.member_id IS ? OR (a.member_id IS NULL AND ? IS 0))) OR "
            "(? IS NOT NULL AND a.scope='room' AND a.room_id=? AND (? IS NULL OR a.thread_id=?))) "
            "ORDER BY q.created_at_ms, q.rowid",
            (conversation_id, conversation_id, member_id, member_id, room_id, room_id, thread_id, thread_id))]

    def open(self, task, kind, payload, card_id=""):
        with self.conn:
            existing = self.conn.execute("SELECT * FROM owner_questions WHERE task_id=? AND result IS NULL", (task.id,)).fetchone()
            if existing:
                return self.view(existing)
            identifier = secrets.token_hex(12)
            self.conn.execute("INSERT INTO owner_questions VALUES (?,?,?,?,?,?,?,?,?)",
                (identifier, task.id, task.turn_id, task.member_id, kind, card_id, json.dumps(payload, ensure_ascii=False), None, self.now_ms()))
        return self.get(identifier)

    def settle(self, identifier, result):
        with self.conn:
            row = self.conn.execute("UPDATE owner_questions SET result=? WHERE id=? AND result IS NULL RETURNING task_id",
                                    (json.dumps(result, ensure_ascii=False), identifier)).fetchone()
        if row:
            self.changed(row[0])
        return self.get(identifier)

    async def answer(self, params):
        if "answer" not in params:
            raise invalid_params("answer is required")
        question = self.get(params.get("id")) if isinstance(params.get("id"), str) else None
        if question is None:
            raise invalid_params("unknown owner question")
        if question["kind"] not in (ASK_OWNER, "show_page") and params.get("answer") is not None:
            raise invalid_params("finish the original card")
        answer = params.get("answer")
        if answer is not None and (not isinstance(answer, str) or not answer.strip() or len(answer) > 4000):
            raise invalid_params("answer must be nonempty text or null")
        if answer is not None and not question.get("free_text", True) and answer not in question.get("options", []):
            raise invalid_params("choose one of the offered options")
        if answer is None and question["state"] == "asked" and self.on_cancel:
            await self.on_cancel(question)
        self.settle(question["id"], {"state": "cancelled"} if answer is None else {"state": "answered", "answer": answer.strip()})
        return {"status": self.get(question["id"])["state"]}

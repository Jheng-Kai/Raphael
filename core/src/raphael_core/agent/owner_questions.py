"""Durable owner answers. These cards grant no permission to execute an action."""
import json
import re
import secrets

from ..clock import wall_clock_ms
from ..protocol import invalid_params

ASK_OWNER = "ask_owner"
OWNER_CARDS = frozenset((ASK_OWNER, "connect_app", "connect_messaging", "request_secret", "email_draft", "slack_draft", "show_page"))
BACKGROUND_TOOLS = OWNER_CARDS | {"update_page", "find_app"}


LABEL_MAX, DESCRIPTION_MAX, SUBTITLE_MAX, OPTION_MAX = 80, 120, 120, 4


def _short_line(value, limit):
    return isinstance(value, str) and bool(value.strip()) and len(value.strip()) <= limit and "\n" not in value.strip()


def question_input(args):
    """The card a question makes: the owner's choices as labels, with their grey descriptions beside them when any has one."""
    question = args.get("question")
    options = args.get("options", [])
    free_text = args.get("free_text", True)
    subtitle, multiple, skip = args.get("subtitle"), args.get("multiple", False), args.get("skip", False)
    if (not isinstance(question, str) or not question.strip() or len(question) > 2000 or not isinstance(options, list)
            or len(options) > OPTION_MAX or type(free_text) is not bool or type(multiple) is not bool or type(skip) is not bool
            or ("subtitle" in args and not _short_line(subtitle, SUBTITLE_MAX))):
        raise ValueError("invalid owner question")
    labels, descriptions = [], []
    for item in options:
        label, description = (item, None) if isinstance(item, str) else (item.get("label"), item.get("description")) if (
            isinstance(item, dict) and set(item) <= {"label", "description"}) else (None, None)
        if not _short_line(label, LABEL_MAX) or (description is not None and not _short_line(description, DESCRIPTION_MAX)):
            raise ValueError("invalid owner question")
        labels.append(label.strip())
        descriptions.append(description.strip() if description else "")
    if len(set(labels)) != len(labels) or not (labels or free_text) or (multiple and len(labels) < 2):
        raise ValueError("invalid owner question")
    return {"question": question.strip(), "options": labels, "free_text": free_text,
            **({"subtitle": subtitle.strip()} if "subtitle" in args else {}),
            **({"descriptions": descriptions} if any(descriptions) else {}),
            **({"multiple": True} if multiple else {}), **({"skip": True} if skip else {})}


def closed_by_message(said):
    """What a card settles with when the owner wrote something else instead of answering it."""
    return {"state": "cancelled", "by": "message", "said": said.strip()[:2000]}


def model_result(result):
    """What the member that asked is told of how its question ended, beside the owner's own words."""
    if result.get("skipped"):
        return {**result, "note": "The owner chose to skip this question. That is their answer: go on without it and do not ask it again."}
    if result.get("by") == "message":
        return {"state": "cancelled", "unanswered": True, "owner_said_instead": result.get("said", ""),
                "note": "The owner left this question unanswered and wrote the message above instead; that message is being "
                        "answered in the conversation on its own. Do not answer it again or ask this question again; carry on "
                        "only with what still makes sense, or end with one short line."}
    return result


def _split_words(text):
    return [word for word in re.split(r"[\s,;，；、/]+|(?:\band\b|和|及)", text.strip()) if word]


def answer_from_text(payload, text, skip_words=("skip", "略過", "略过", "スキップ")):
    """How a reply typed in a messaging chat answers the card that waits there: by the letters (A, or A and C for a card
    that takes several), by a label written out, by the skip word, or, when the card takes an answer of the owner's own,
    by whatever was written. None when it is not an answer and only says something else."""
    options, plain = payload.get("options", []), text.strip()
    if not plain or len(plain) > 4000:
        return None
    if payload.get("skip") and plain.lower().strip(" .。!！") in skip_words:
        return {"state": "answered", "skipped": True}
    found, tokens = [], _split_words(plain)
    for token in tokens:
        letter = ord(token.upper()) - 65 if len(token) == 1 and token.isascii() and token.isalpha() else -1
        label = next((option for option in options if option.casefold() == token.casefold()), None)
        if 0 <= letter < len(options):
            found.append(options[letter])
        elif label is not None:
            found.append(label)
        else:
            found = []
            break
    exact = next((option for option in options if option.casefold() == plain.casefold()), None)
    if exact is not None:
        found = [exact]
    found = list(dict.fromkeys(found))
    if found and (payload.get("multiple") or len(found) == 1):
        return {"state": "answered", "answer": found if payload.get("multiple") else found[0]}
    if payload.get("free_text", True):
        return {"state": "answered", "answer": [plain] if payload.get("multiple") else plain}
    return None


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
        return self.for_turns([turn_id]).get(turn_id, [])

    def for_turns(self, turn_ids):
        from ..brain.db import rows_for_turns
        found = {}
        for row in rows_for_turns(self.conn, "owner_questions", turn_ids, order="created_at_ms, rowid"):
            found.setdefault(row["turn_id"], []).append(self.view(row))
        return found

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

    def close_for_message(self, *, said, conversation_id=None, member_id=None, room_id=None, thread_id=None, source=None):
        """The owner wrote something instead of answering: the card that waits in this conversation closes, unanswered,
        and the member is told what was said. In a messaging chat a reply that names the card's letters or words, or
        that a card taking the owner's own words can hold, is the answer instead. Returns whether the words were taken as the answer."""
        taken = False
        for question in self.in_conversation(conversation_id=conversation_id, member_id=member_id, room_id=room_id, thread_id=thread_id):
            answered = answer_from_text(question, said) if source else None
            self.settle(question["id"], answered or closed_by_message(said))
            taken = taken or answered is not None
        return taken

    async def answer(self, params):
        skipped = params.get("skip")
        if "answer" not in params and skipped is not True:
            raise invalid_params("answer is required")
        if skipped is not None and skipped is not True:
            raise invalid_params("skip must be true")
        question = self.get(params.get("id")) if isinstance(params.get("id"), str) else None
        if question is None:
            raise invalid_params("unknown owner question")
        answer = params.get("answer")
        if question["kind"] not in (ASK_OWNER, "show_page") and (answer is not None or skipped):
            raise invalid_params("finish the original card")
        if skipped:
            if answer is not None or question["kind"] != ASK_OWNER or not question.get("skip"):
                raise invalid_params("this question cannot be skipped")
            self.settle(question["id"], {"state": "answered", "skipped": True})
            return {"status": self.get(question["id"])["state"]}
        options = question.get("options", [])
        if isinstance(answer, list):
            # Several rows chosen, and at most one more of the owner's own words when the card takes them.
            chosen = [item.strip() for item in answer if isinstance(item, str)]
            own = [item for item in chosen if item not in options]
            if (not question.get("multiple") or question["kind"] != ASK_OWNER or not chosen or len(chosen) != len(answer)
                    or len(set(chosen)) != len(chosen) or len(chosen) > len(options) + 1 or any(len(item) > 4000 for item in chosen)
                    or "" in chosen or (own and (len(own) > 1 or not question.get("free_text", True)))):
                raise invalid_params("choose some of the offered options")
            self.settle(question["id"], {"state": "answered", "answer": chosen})
            return {"status": self.get(question["id"])["state"]}
        if answer is not None and (not isinstance(answer, str) or not answer.strip() or len(answer) > 4000):
            raise invalid_params("answer must be nonempty text or null")
        if answer is not None and not question.get("free_text", True) and answer not in options:
            raise invalid_params("choose one of the offered options")
        if answer is None and question["state"] == "asked" and self.on_cancel:
            await self.on_cancel(question)
        self.settle(question["id"], {"state": "cancelled"} if answer is None else {"state": "answered", "answer": answer.strip()})
        return {"status": self.get(question["id"])["state"]}

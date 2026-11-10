"""Small, read-only projections of recorded team work for owner-private reports."""

import json
from datetime import datetime, timedelta

from ..agent.history import UNFINISHED
from ..agent.owner_questions import OwnerQuestions
from ..home_digest import _ended
from ..memory.scan import find_secret
from ..protocol import invalid_params
from ..services.attachment_store import ID
from .library import _links


def _text(value):
    value = value or ""
    return "(redacted)" if find_secret(value) else " ".join(value.split())[:120]


def _json(value):
    try:
        return json.loads(value or "null")
    except (ValueError, TypeError):
        return None


def _turn_reason(conn, turn_id):
    row = conn.execute("SELECT failure,detail FROM agent_turns WHERE id=?", (turn_id,)).fetchone()
    if not row:
        return ""
    failure = _json(row["failure"])
    return (failure.get("reason") or failure.get("kind") or "") if isinstance(failure, dict) else row["detail"] or ""


def read(conn, roster, zone, now_ms, member_id=None, days=14):
    """Read history in the last `days` local days; pending work and routines are current.

    Missing recorded times/statuses stay empty. No filesystem, provider, clock or
    persistence side effects are needed to assemble this projection.
    """
    if type(days) is not int or not 1 <= days <= 30:
        raise invalid_params("days must be an integer from 1 to 30")
    people = {item["id"]: item for item in roster["members"]}
    if member_id is not None and (type(member_id) is not int or member_id not in people):
        raise invalid_params("member_id must identify an existing member")
    groups = {item["id"]: item["name"] for item in roster["groups"]}
    now = datetime.fromtimestamp(now_ms / 1000, zone)
    start = int((now - timedelta(days=days)).timestamp() * 1000)

    def at(value):
        return datetime.fromtimestamp(value / 1000, zone).strftime("%Y-%m-%d %H:%M") if value is not None else ""

    members = {}
    entries = {}
    for identifier, person in people.items():
        if member_id is not None and identifier != member_id:
            continue
        group = groups.get(person["group_id"])
        members[identifier] = {"id": identifier, "name": _text(person["name"]), "role": _text(person["role"]),
                               "group": _text(group) if group is not None else None,
                               "finished": {"count": 0, "recent": []}, "failed": {"count": 0, "recent": []}}
        entries[identifier] = {key: [] for key in ("unfinished", "waiting_for_owner", "routines", "outputs", "handed_to", "received_from")}

    def keep(mid, key, timestamp, identifier, value):
        if mid in entries:
            entries[mid][key].append((timestamp if timestamp is not None else -1, str(identifier), value))

    for ok, key in ((True, "finished"), (False, "failed")):
        records = sorted(_ended(conn, start, now_ms + 1, ok=ok), key=lambda row: (row["at_ms"], row["id"]), reverse=True)
        for row in records:
            if row["member_id"] not in members:
                continue
            bucket = members[row["member_id"]][key]
            bucket["count"] += 1
            if len(bucket["recent"]) >= 6:
                continue
            value = {"title": _text(row["title"]), "at": at(row["at_ms"]), "kind": row["kind"]}
            if not ok:
                source, identifier = row["id"].split(":", 1)
                if source == "task":
                    reason = conn.execute("SELECT reason FROM worker_tasks WHERE id=?", (identifier,)).fetchone()[0]
                elif source == "routine_run":
                    reason = _turn_reason(conn, row["turn_id"]) or conn.execute(
                        "SELECT summary FROM routine_runs WHERE id=?", (identifier,)).fetchone()[0]
                else:
                    reason = _turn_reason(conn, row["turn_id"])
                value["reason"] = _text(reason)
            bucket["recent"].append(value)

    for row in conn.execute("SELECT * FROM worker_tasks WHERE state IN ('queued','running','waiting','failed','interrupted','limit')"):
        keep(row["member_id"], "unfinished", row["created_at_ms"], f"task:{row['id']}",
             {"title": _text(row["text"]), "state": row["state"], "since": at(row["created_at_ms"])})
    for row in conn.execute(
        "SELECT t.* FROM agent_turns t WHERE t.status IN (?,?,?,?) AND t.source NOT IN ('routine','member')"
        " AND t.route NOT IN ('routine','exchange') AND NOT EXISTS (SELECT 1 FROM worker_tasks w WHERE w.turn_id=t.id)", UNFINISHED):
        keep(row["member_id"], "unfinished", row["created_at_ms"], f"turn:{row['id']}",
             {"title": _text(row["question"]), "state": row["status"], "since": at(row["created_at_ms"])})

    waiting_turns = set()

    def question(mid, turn, title, timestamp, identifier):
        keep(mid, "waiting_for_owner", timestamp, identifier, {"question": _text(title), "since": at(timestamp)})
        if mid in members and turn is not None:
            waiting_turns.add(turn)

    for row in conn.execute("SELECT * FROM agent_turns WHERE status='confirm'"):
        question(row["member_id"], row["id"], row["text"] or row["question"], row["created_at_ms"], f"turn:{row['id']}")
    for row in conn.execute(
        "SELECT q.*,t.turn_id FROM worker_questions q JOIN worker_tasks t ON t.id=q.task_id"
        " WHERE q.state='waiting' AND t.state='waiting'"):
        question(row["member_id"], row["turn_id"], row["text"], row["created_at_ms"], f"worker:{row['id']}")
    for row in OwnerQuestions(conn).pending():
        if row["turn_id"] in waiting_turns:
            continue
        parent = conn.execute("SELECT q.created_at_ms,t.question FROM owner_questions q"
                              " LEFT JOIN agent_turns t ON t.id=q.turn_id WHERE q.id=?", (row["id"],)).fetchone()
        title = row.get("question") or row.get("title") or parent["question"] or row["kind"]
        question(row["member_id"], row["turn_id"], title, parent["created_at_ms"], f"owner:{row['id']}")

    for row in conn.execute("SELECT * FROM routines"):
        last = conn.execute("SELECT * FROM routine_runs WHERE routine_id=? ORDER BY started DESC,id DESC LIMIT 1", (row["id"],)).fetchone()
        timestamp = (last["finished"] if last["finished"] is not None else last["started"]) if last else None
        schedule = _json(row["schedule"])
        error = row["last_error"] or (last["summary"] if last and last["status"] in ("error", "failed") else "")
        keep(row["member_id"], "routines", timestamp if timestamp is not None else row["created_at_ms"], row["id"],
             {"title": _text(row["title"]), "enabled": bool(row["enabled"]),
              "schedule": _text(schedule.get("kind", "")) if isinstance(schedule, dict) else "",
              "last_status": last["status"] if last else "", "last_at": at(timestamp), "last_error": _text(error)})

    # Owner uploads are agent_turns.attachments, never member outputs. Durable
    # media/reply messages (and legacy replies) record member-delivered files;
    # verified artifact receipts record member-produced files; pages record what
    # the member showed. Read these stored sources only, without scanning disk.
    outputs = {}

    def output(mid, identifier, name, timestamp, kind):
        if mid not in members or not start <= timestamp <= now_ms:
            return
        key = (mid, identifier)
        if key not in outputs or timestamp > outputs[key][0]:
            outputs[key] = (timestamp, {"name": _text(name), "at": at(timestamp), "kind": kind})

    def reply(mid, text, timestamp):
        for title, link in _links(text):
            key = link.removeprefix("attachment:").removeprefix("attachments/")
            if ID.fullmatch(key):
                output(mid, "attachment:" + key, title or key, timestamp, "attachment")

    for row in conn.execute(
        "SELECT m.*,t.member_id FROM agent_messages m JOIN agent_turns t ON t.id=m.turn_id"
        " WHERE m.kind IN ('media','reply') AND m.at_ms>=? AND m.at_ms<=?", (start, now_ms)):
        if row["kind"] == "reply":
            reply(row["member_id"], row["text"], row["at_ms"])
        else:
            payload = _json(row["text"])
            file = payload.get("attachment") if isinstance(payload, dict) else None
            if isinstance(file, dict) and isinstance(file.get("id"), str) and ID.fullmatch(file["id"]) and isinstance(file.get("name"), str):
                output(row["member_id"], "attachment:" + file["id"], file["name"], row["at_ms"], "attachment")
    for row in conn.execute(
        "SELECT t.* FROM agent_turns t WHERE t.status='done' AND t.created_at_ms>=? AND t.created_at_ms<=?"
        " AND NOT EXISTS (SELECT 1 FROM agent_messages m WHERE m.turn_id=t.id AND m.kind='reply')", (start, now_ms)):
        reply(row["member_id"], row["text"], row["created_at_ms"])
    for row in conn.execute(
        "SELECT e.*,w.member_id FROM task_evidence e JOIN worker_tasks w ON w.id=e.task_id"
        " WHERE e.kind='artifact' AND e.verdict='verified' AND e.verified_at_ms>=? AND e.verified_at_ms<=?", (start, now_ms)):
        output(row["member_id"], f"artifact:{row['workspace']}:{row['uri']}", row["uri"].replace("\\", "/").rsplit("/", 1)[-1],
               row["verified_at_ms"], "artifact")
    for row in conn.execute(
        "SELECT p.* FROM pages p JOIN agent_turns t ON t.id=p.turn_id AND t.member_id=p.member_id"
        " WHERE p.created_at_ms>=? AND p.created_at_ms<=?", (start, now_ms)):
        output(row["member_id"], "page:" + row["id"], row["title"], row["created_at_ms"], "page")
    for (mid, identifier), (timestamp, value) in outputs.items():
        keep(mid, "outputs", timestamp, identifier, value)

    pairs = {}
    for row in conn.execute(
        "SELECT * FROM worker_tasks WHERE from_member_id IS NOT NULL AND created_at_ms>=? AND created_at_ms<=?"
        " ORDER BY created_at_ms DESC,id DESC", (start, now_ms)):
        source, target = row["from_member_id"], row["member_id"]
        if source == target or source not in people or target not in people:
            continue
        pair = pairs.setdefault((source, target), {"count": 0, "last": _text(row["text"]), "at": at(row["created_at_ms"]),
                                                   "timestamp": row["created_at_ms"], "id": row["id"]})
        pair["count"] += 1
    for (source, target), pair in pairs.items():
        for mid, other, key in ((source, target, "handed_to"), (target, source, "received_from")):
            keep(mid, key, pair["timestamp"], pair["id"],
                 {"member_id": other, "name": _text(people[other]["name"]), **{key: pair[key] for key in ("count", "last", "at")}})

    caps = {"unfinished": 6, "waiting_for_owner": 6, "routines": 12, "outputs": 8}
    for mid, member in members.items():
        for key, values in entries[mid].items():
            values.sort(key=lambda item: (item[0], item[1]), reverse=True)
            member[key] = [value for _, _, value in values[:caps.get(key, len(values))]]
    return {"as_of": at(now_ms), "as_of_ms": now_ms, "days": days, "members": list(members.values())}

"""The work that ended in a period, counted once: the rows behind a member's own work lists (members/team_work.py)."""

MESSAGE_SOURCES = ("telegram", "slack", "discord")
# A routine run or a turn that went wrong; denied and cancelled are the owner's own decisions, not failures.
FAILED_TURNS = ("error", "expired")
FAILED_TASKS = ("failed", "interrupted", "limit")


def _ended(conn, start, end, *, ok=True):
    """Every piece of work that ended in [start, end) once, by its completion time: a routine run, else its task, else
    its turn. `ok` picks finished work; otherwise the work that failed, was interrupted or hit a limit."""
    turns = ("done",) if ok else FAILED_TURNS
    tasks = ("done",) if ok else FAILED_TASKS
    marks = lambda values: ",".join("?" * len(values))
    linked = set()
    for row in conn.execute(
            f"SELECT r.id,r.turn_id,r.finished,m.member_id FROM routine_runs r JOIN routines m ON m.id=r.routine_id"
            f" WHERE r.status IN ({marks(turns)}) AND r.finished>=? AND r.finished<? ORDER BY r.finished,r.id", (*turns, start, end)):
        if row["turn_id"] is not None:
            linked.add(row["turn_id"])
        yield {"member_id": row["member_id"], "kind": "routines", "id": f"routine_run:{row['id']}",
               "at_ms": row["finished"], "turn_id": row["turn_id"], "source": None}
    for row in conn.execute(
            f"SELECT w.id,w.member_id,w.turn_id,w.finished_at_ms,t.source FROM worker_tasks w LEFT JOIN agent_turns t ON t.id=w.turn_id"
            f" WHERE w.state IN ({marks(tasks)}) AND w.finished_at_ms>=? AND w.finished_at_ms<?"
            " AND NOT EXISTS (SELECT 1 FROM routine_runs r WHERE r.turn_id=w.turn_id)"
            " ORDER BY w.finished_at_ms,w.id", (*tasks, start, end)):
        if row["turn_id"] in linked:
            continue
        if row["turn_id"] is not None:
            linked.add(row["turn_id"])
        source = row["source"]
        yield {"member_id": row["member_id"], "kind": "messages" if source in MESSAGE_SOURCES else "work",
               "id": f"task:{row['id']}", "at_ms": row["finished_at_ms"],
               "turn_id": row["turn_id"], "source": source}
    for row in conn.execute(
            f"SELECT t.id,t.member_id,t.source,COALESCE(m.finished_at_ms,t.created_at_ms) AS completed FROM agent_turns t"
            " LEFT JOIN run_metrics m ON m.kind='turn' AND m.run_id=t.id"
            f" WHERE t.status IN ({marks(turns)}) AND t.source!='greeting' AND COALESCE(m.finished_at_ms,t.created_at_ms)>=?"
            " AND COALESCE(m.finished_at_ms,t.created_at_ms)<?"
            " AND NOT EXISTS (SELECT 1 FROM worker_tasks w WHERE w.turn_id=t.id)"
            " AND NOT EXISTS (SELECT 1 FROM routine_runs r WHERE r.turn_id=t.id) ORDER BY completed,t.id", (*turns, start, end)):
        if row["id"] in linked:
            continue
        source = row["source"]
        yield {"member_id": row["member_id"], "kind": "messages" if source in MESSAGE_SOURCES else "work",
               "id": f"turn:{row['id']}", "at_ms": row["completed"],
               "turn_id": row["id"], "source": source}

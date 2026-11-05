"""Bounded owner-panel projections from existing tasks, pages and workspace files."""

import os
from pathlib import Path

from ..paths import local_storage_root


def snapshot(conn, member, workspaces=(), limit=12):
    limit = min(max(limit, 1), 100)
    tasks = [dict(row) for row in conn.execute(
        "SELECT w.id,w.turn_id,w.text AS title,w.state,w.created_at_ms,w.started_at_ms,w.finished_at_ms,"
        "t.conversation_id FROM worker_tasks w LEFT JOIN agent_turns t ON t.id=w.turn_id "
        "WHERE w.member_id=? AND w.scope='private' ORDER BY w.created_at_ms DESC,w.id DESC LIMIT 100", (member,))]
    files = {}
    for row in conn.execute(
        "SELECT e.id,e.task_id,e.uri,e.verified_at_ms FROM task_evidence e JOIN worker_tasks w ON w.id=e.task_id "
        "WHERE w.member_id=? AND e.kind='artifact' AND e.verdict='verified' ORDER BY e.verified_at_ms DESC LIMIT 100", (member,)):
        handle = f"task-artifact:{row['task_id']}:{row['id']}"
        files[row['uri']] = dict(id=handle, name=Path(row['uri']).name, path=handle, at_ms=row['verified_at_ms'], kind='file')
    for row in conn.execute("SELECT id,title,turn_id,conversation_id,updated_at_ms FROM pages WHERE member_id=? ORDER BY updated_at_ms DESC LIMIT 100", (member,)):
        files['page:' + row['id']] = dict(id=row['id'], name=row['title'], turn_id=row['turn_id'], conversation_id=row['conversation_id'], at_ms=row['updated_at_ms'], kind='page')
    # A fixed entry/depth budget includes directories, so sparse trees cannot grow the scan.
    budget = 500
    for area, root in workspaces:
        try:
            root = local_storage_root(root)
        except (OSError, ValueError):
            continue
        pending = [(root, 0)]
        while pending and budget > 0:
            directory, depth = pending.pop()
            try:
                with os.scandir(directory) as entries:
                    for entry in entries:
                        budget -= 1
                        if budget < 0:
                            break
                        if entry.name.startswith('.') or entry.is_symlink() or getattr(entry, 'is_junction', lambda: False)():
                            continue
                        path = Path(entry.path).resolve()
                        if not path.is_relative_to(root):
                            continue
                        if entry.is_dir(follow_symlinks=False):
                            if depth < 3:
                                pending.append((path, depth + 1))
                        elif entry.is_file(follow_symlinks=False):
                            handle = f"member-file:{member}:{area}:{path.relative_to(root).as_posix()}"
                            files.setdefault(str(path), dict(id=handle, name=path.name, path=handle, at_ms=int(entry.stat().st_mtime * 1000), kind='file'))
            except OSError:
                continue
    ordered = sorted(files.values(), key=lambda item: (-item['at_ms'], item['id']))
    return dict(tasks=tasks, files=ordered[:limit], has_more=len(ordered) > limit and limit < 100)

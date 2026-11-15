"""A bounded Library of owner-visible deliveries, never a workspace directory scan."""

import hashlib
import json
import mimetypes
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlsplit

from ..paths import local_storage_root
from ..services.attachment_store import ID

LINK = re.compile(r'!?\[([^\]\n]{0,320})\]\((?:<([^>\n]+)>|([^\s)]+))(?:\s+"[^"\n]*")?\)')
SCAN_LIMIT = 1000
# The turns that speak to the owner in the member's own conversation: the owner's requests, and the member's own background work,
# whose turn names the member itself in `peer_id` (owner, 2026-11-14: two videos a member attached from its background work were
# missing). A colleague's hand-off names another member (agent/attribution.py `from_colleague`) and hands its files to that colleague.
TO_OWNER = "t.scope='private' AND (t.peer_id IS NULL OR t.peer_id=t.member_id)"


# The panel's chips follow the kind: pages are published pages, media are images, video and audio, files are the rest
# (documents, archives, other files). The mime type the host guesses is not always known (Windows has none for .webp,
# an upload can arrive as application/octet-stream), so the extension decides when the mime says nothing.
_SUFFIX_KINDS = {
    'image': ('.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.tif', '.tiff', '.heic', '.heif', '.avif'),
    'video': ('.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.wmv', '.mpg', '.mpeg', '.3gp'),
    'audio': ('.mp3', '.wav', '.m4a', '.ogg', '.oga', '.opus', '.flac', '.aac', '.wma', '.aiff'),
    'archive': ('.zip', '.7z', '.rar', '.tar', '.gz', '.tgz', '.bz2', '.tbz2', '.xz', '.txz', '.zst'),
    'document': ('.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.rtf', '.txt', '.md', '.csv', '.tsv'),
}
_ARCHIVE_MIMES = ('application/zip', 'application/x-zip-compressed', 'application/x-7z-compressed', 'application/vnd.rar',
                  'application/x-rar-compressed', 'application/x-tar', 'application/gzip', 'application/x-gzip',
                  'application/x-bzip2', 'application/x-xz', 'application/zstd')


def _kind(name, mime, *others):
    mime = (mime or '').split(';')[0].strip().lower()
    if mime.startswith(('image/', 'video/', 'audio/')):
        return mime.split('/')[0]
    for kind, suffixes in _SUFFIX_KINDS.items():
        if any(Path(candidate).suffix.lower() in suffixes for candidate in (name, *others) if isinstance(candidate, str)):
            return kind
    if mime in _ARCHIVE_MIMES:
        return 'archive'
    return 'document' if mime.startswith('text/') else 'file'


def _links(text):
    # Code examples and progress logs are not delivery links.
    text = re.sub(r'```[^\n]*\n[\s\S]*?(?:```|$)', '', text[:256_000])
    for match in LINK.finditer(text):
        yield match[1], unquote(match[2] or match[3])


def _roots(workspaces, output_folder):
    roots = []
    for area, path in [*workspaces, *([('output', output_folder)] if output_folder else [])]:
        if not path:
            continue
        try:
            roots.append((area, local_storage_root(path)))
        except (OSError, ValueError):
            continue
    return roots


def _local(link, roots):
    # Explicit links may name authorized host roots or existing VM mounts only.
    link = link.removeprefix('file://')
    for area, root in roots:
        relative = link
        mount = '/home/cua/team/' if area == 'team' else '/home/cua/workspace/'
        if area != 'output' and link.startswith(mount):
            relative = link[len(mount):]
        try:
            path = (root / relative).resolve(strict=True)
            if path.is_relative_to(root) and path.is_file():
                return path
        except (OSError, ValueError):
            continue
    return None


def snapshot(conn, member, workspaces=(), limit=12, *, output_folder='', tz=None, paths=None):
    """Read at most 1000 records per source and return at most 100 deliveries.

    Reads never walk directories, contact providers, hash file bytes or decode
    thumbnails. Output receipt digests are rechecked only when opening a file.
    """
    limit = min(max(limit, 1), 100)
    roots = _roots(workspaces, output_folder)
    files = {}

    def keep(key, *, identifier, name, mime, row, at_ms, kind=None, **extra):
        previous = files.get(key)
        if previous and previous['at_ms'] >= at_ms:
            return
        day = datetime.fromtimestamp(at_ms / 1000, tz=tz).date().isoformat()
        item = dict(id=identifier, name=name, title=name, kind=kind or _kind(name, mime), mime=mime,
                    at_ms=at_ms, day=day, turn_id=row['turn_id'], conversation_id=row['conversation_id'], **extra)
        if item['kind'] == 'image':
            item['thumbnail'] = item.get('open')
        files[key] = item

    def local_file(path, title, row, at_ms, receipt=None):
        identifier = 'delivered-file:' + hashlib.sha256(f'{member}:{path}'.encode()).hexdigest()[:32]
        mime = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
        keep(str(path), identifier=identifier, name=title or path.name, mime=mime, kind=_kind(path.name, mime), row=row, at_ms=at_ms,
             path=identifier, open={'method': 'members.library_file', 'params': {'member_id': member, 'id': identifier}})
        if paths is not None:
            paths[identifier] = (path, receipt)

    def attachment(key, name, mime, row, at_ms):
        if not isinstance(key, str) or not ID.fullmatch(key) or not isinstance(name, str) or not isinstance(mime, str):
            return
        keep('attachment:' + key, identifier='attachment:' + key, name=name, mime=mime, kind=_kind(name, mime, key), row=row,
             at_ms=at_ms, attachment_id=key, open={'method': 'attachments.path', 'params': {'id': key}})

    # Owner uploads live in agent_turns.attachments and are deliberately not read.
    for row in conn.execute(
        "SELECT m.kind,m.text,m.at_ms,t.id AS turn_id,t.conversation_id FROM agent_messages m "
        "JOIN agent_turns t ON t.id=m.turn_id WHERE t.member_id=? AND " + TO_OWNER + " "
        "AND m.kind IN ('media','reply') ORDER BY m.at_ms DESC,m.seq DESC LIMIT ?", (member, SCAN_LIMIT)):
        if row['kind'] == 'media':
            try:
                payload = json.loads(row['text'])
                file = payload['attachment']
                attachment(file['id'], file['name'], file['mime'], row, row['at_ms'])
            except (ValueError, TypeError, KeyError):
                continue
        else:
            for title, link in _links(row['text']):
                _reply_link(link, title, roots, local_file, attachment, row, row['at_ms'])

    # Older turns can predate the durable reply-message stream.
    for row in conn.execute(
        "SELECT t.id AS turn_id,t.conversation_id,t.text,t.created_at_ms AS at_ms FROM agent_turns t "
        "WHERE t.member_id=? AND " + TO_OWNER + " AND t.status='done' "
        "AND NOT EXISTS(SELECT 1 FROM agent_messages m WHERE m.turn_id=t.id AND m.kind='reply') "
        "ORDER BY t.id DESC LIMIT ?", (member, SCAN_LIMIT)):
        for title, link in _links(row['text']):
            _reply_link(link, title, roots, local_file, attachment, row, row['at_ms'])

    for row in conn.execute(
        "SELECT p.id,p.title,p.turn_id,p.conversation_id,p.created_at_ms FROM pages p JOIN agent_turns t ON t.id=p.turn_id "
        "WHERE p.member_id=? AND t.member_id=? AND " + TO_OWNER + " "
        "ORDER BY p.created_at_ms DESC LIMIT ?", (member, member, SCAN_LIMIT)):
        keep('page:' + row['id'], identifier=row['id'], name=row['title'], mime='text/html', kind='page', row=row,
             at_ms=row['created_at_ms'], open={'method': 'pages.open', 'params': {'id': row['id']}})

    # A verified write to the owner's explicit output directory is a delivery.
    # Other task artifacts, including screenshots, require a reply/card above.
    output = next((root for area, root in roots if area == 'output'), None)
    if output:
        for row in conn.execute(
            "SELECT e.id,e.task_id,e.workspace,e.uri,e.verified_at_ms,w.turn_id,t.conversation_id FROM task_evidence e "
            "JOIN worker_tasks w ON w.id=e.task_id JOIN agent_turns t ON t.id=w.turn_id "
            "WHERE w.member_id=? AND t.member_id=? AND w.scope='private' AND " + TO_OWNER + " "
            "AND e.kind='artifact' AND e.verdict='verified' AND w.state='done' AND w.announced=1 "
            "ORDER BY e.verified_at_ms DESC LIMIT ?", (member, member, SCAN_LIMIT)):
            try:
                root = local_storage_root(row['workspace'])
                path = (root / row['uri']).resolve(strict=True)
                if path.is_file() and path.is_relative_to(root) and path.is_relative_to(output):
                    local_file(path, path.name, row, row['verified_at_ms'], (row['task_id'], row['id']))
            except (OSError, ValueError, TypeError):
                continue

    ordered = sorted(files.values(), key=lambda item: (-item['at_ms'], item['id']))
    return dict(files=ordered[:limit], has_more=len(ordered) > limit and limit < 100)


def _reply_link(link, title, roots, local_file, attachment, row, at_ms):
    try:
        key = link.removeprefix('attachment:').removeprefix('attachments/')
        if ID.fullmatch(key):
            attachment(key, title or key, mimetypes.guess_type(key)[0] or 'application/octet-stream', row, at_ms)
            return
        url = urlsplit(link)
        # A URL alone is not a delivered file or a published page.
        if url.scheme in ('http', 'https'):
            return
        if path := _local(link, roots):
            local_file(path, title, row, at_ms)
    except ValueError:
        return

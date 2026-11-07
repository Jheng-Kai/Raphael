"""The member Library contains owner-visible deliveries with their original turn."""

import json
from datetime import datetime, timedelta, timezone

import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.agent.pages import PageStore
from raphael_core.background.tasks import TaskStore
from raphael_core.members.panel import snapshot
from raphael_core.protocol import RpcError


def turn(conn, *, member=0, at=1000, text='', **extra):
    history = AgentHistory(conn, lambda: at)
    identifier = history.add(session_id='library', question='Make a result', route='answer', prefix='',
                             text=text, status='done', member_id=member, **extra)
    return history, identifier


def media(history, identifier, name='result.png', key='a' * 32 + '.png', mime='image/png'):
    history.add_message(identifier, 'media', json.dumps({'attachment': {'id': key, 'name': name, 'mime': mime, 'size': 20}}))


def test_delivered_cards_listed_but_scratch_and_owner_uploads_are_not(conn, tmp_path):
    (tmp_path / 'scratch.png').write_bytes(b'screenshot')
    history, identifier = turn(conn, attachments=[{'id': 'b' * 32 + '.png', 'name': 'owner.png', 'mime': 'image/png'}])
    media(history, identifier)
    history.add_message(identifier, 'progress', f'Captured [scratch]({tmp_path / "scratch.png"})')
    result = snapshot(conn, 0, [('workspace', tmp_path)])
    assert set(result) == {'files', 'has_more'}
    assert [item['name'] for item in result['files']] == ['result.png']
    file = result['files'][0]
    assert file['kind'] == 'image' and file['title'] == 'result.png'
    assert file['turn_id'] == identifier and file['conversation_id'] is not None
    assert file['thumbnail'] == {'method': 'attachments.path', 'params': {'id': 'a' * 32 + '.png'}}


def test_reply_files_screenshots_and_links_require_explicit_delivery(conn, tmp_path):
    delivered = tmp_path / 'screenshot.png'
    delivered.write_bytes(b'owner-requested screenshot')
    (tmp_path / 'scratch.png').write_bytes(b'unrelated')
    (tmp_path / 'notes.md').write_text('deliverable')
    history, identifier = turn(conn)
    history.add_message(identifier, 'reply', '[Screenshot](screenshot.png) [Notes](notes.md) [Site](https://example.com/result)')
    result = snapshot(conn, 0, [('workspace', tmp_path)])
    assert {item['name'] for item in result['files']} == {'Screenshot', 'Notes', 'Site'}
    assert {item['kind'] for item in result['files']} == {'image', 'document', 'link'}
    assert all(item['turn_id'] == identifier for item in result['files'])


def test_pages_and_legacy_replies_retain_turn_and_original_delivery_date(conn, tmp_path):
    (tmp_path / 'result.zip').write_bytes(b'zip')
    history, identifier = turn(conn, text='[Archive](result.zip)')
    conversation = conn.execute('SELECT conversation_id FROM agent_turns WHERE id=?', (identifier,)).fetchone()[0]
    store = PageStore(conn, now_ms=lambda: 2000)
    page = store.write(turn_id=identifier, member_id=0, conversation_id=conversation, title='Report', html='<p>Done</p>')
    store.now_ms = lambda: 999_999_999
    store.update(page['id'], '<p>Updated</p>')
    files = snapshot(conn, 0, [('workspace', tmp_path)])['files']
    assert [(item['name'], item['kind']) for item in files] == [('Report', 'page'), ('Archive', 'archive')]
    assert files[0]['at_ms'] == 2000 and files[0]['turn_id'] == identifier


def test_verified_task_artifacts_require_delivery_or_explicit_owner_output(conn, tmp_path):
    output = tmp_path / 'output'
    output.mkdir()
    (output / 'report.pdf').write_bytes(b'pdf')
    (tmp_path / 'scratch.png').write_bytes(b'work')
    history, identifier = turn(conn)
    store = TaskStore(conn, now_ms=lambda: 2000)
    task = store.create(session_id='library-task', language='en', text='Write report', member_id=0)
    store.attach_turn(task, identifier)
    store.verify_artifact(task, 'write', output / 'report.pdf', workspace=tmp_path, mime='application/pdf')
    store.verify_artifact(task, 'capture', tmp_path / 'scratch.png', workspace=tmp_path, mime='image/png')
    conn.execute("UPDATE worker_tasks SET state='done',announced=1 WHERE id=?", (task,))
    assert snapshot(conn, 0, [('workspace', tmp_path)])['files'] == []
    result = snapshot(conn, 0, [('workspace', tmp_path)], output_folder=str(output))
    assert [item['name'] for item in result['files']] == ['report.pdf']
    assert result['files'][0]['turn_id'] == identifier
    conn.execute("UPDATE worker_tasks SET announced=0 WHERE id=?", (task,))
    assert snapshot(conn, 0, output_folder=str(output))['files'] == []


def test_grouping_uses_delivery_calendar_day_and_deduplicates_latest_delivery(conn):
    tz = timezone(timedelta(hours=8))
    midnight = int(datetime(2026, 11, 8, tzinfo=tz).timestamp() * 1000)
    history, older = turn(conn, at=midnight - 1)
    media(history, older, 'older.png')
    history, newer = turn(conn, at=midnight + 1)
    media(history, newer, 'new.png', 'b' * 32 + '.png')
    files = snapshot(conn, 0, tz=tz)['files']
    assert [item['day'] for item in files] == ['2026-11-08', '2026-11-07']
    media(history, newer, 'redelivered.png')
    files = snapshot(conn, 0, tz=tz)['files']
    assert len(files) == 2
    assert next(item for item in files if item['name'] == 'redelivered.png')['turn_id'] == newer


def test_member_scope_ignores_exchanges_and_code_and_does_not_escape_roots(conn, tmp_path):
    root = tmp_path / 'workspace'
    root.mkdir()
    outside = tmp_path / 'private.txt'
    outside.write_text('private')
    history, identifier = turn(conn)
    history.add_message(identifier, 'reply', f'[Escape](../private.txt) [Absolute](<{outside}>)\n```md\n[Example](https://example.com/scratch)\n```')
    history, exchange = turn(conn, peer_id=1, scope='exchange')
    media(history, exchange)
    history, other = turn(conn, member=1)
    media(history, other)
    assert snapshot(conn, 0, [('workspace', root)])['files'] == []


async def test_rpc_compatibility_validation_and_delivered_file_open(rig, tmp_path):
    assert await rig.call('members.list', {'panel_member_id': 0}) == {'files': [], 'has_more': False}
    assert 'members' in await rig.call('members.list')
    output = tmp_path / 'output'
    output.mkdir()
    delivered = output / 'report.md'
    delivered.write_text('report')
    rig.service._settings.set('owner_output_folder', str(output))
    history, identifier = turn(rig.conn, text=f'[Report](<{delivered}>)')
    result = await rig.call('members.library', {'member_id': 0})
    assert result == await rig.call('members.list', {'panel_member_id': 0})
    file = result['files'][0]
    assert await rig.call('members.library_file', {'member_id': 0, 'id': file['id']}) == {'path': str(delivered)}
    for method, params in [('members.list', {'panel_member_id': 999}), ('members.library', {'member_id': True}),
                           ('members.list', {'panel_member_id': 0, 'panel_limit': -1}),
                           ('members.library_file', {'member_id': 0, 'id': str(delivered)}),
                           ('members.library_file', {'member_id': 1, 'id': file['id']})]:
        with pytest.raises(RpcError):
            await rig.call(method, params)
    delivered.unlink()
    with pytest.raises(RpcError):
        await rig.call('members.library_file', {'member_id': 0, 'id': file['id']})


def test_show_more_is_bounded_without_any_workspace_scan(conn, tmp_path, monkeypatch):
    import os
    monkeypatch.setattr(os, 'scandir', lambda *args: pytest.fail('Library must not scan the workspace'))
    history, identifier = turn(conn)
    for index in range(105):
        media(history, identifier, f'file-{index}.png', f'{index:032x}.png')
    assert len(snapshot(conn, 0, [('workspace', tmp_path)], 3)['files']) == 3
    assert snapshot(conn, 0, limit=3)['has_more']
    result = snapshot(conn, 0, limit=100)
    assert len(result['files']) == 100 and not result['has_more']


async def test_output_receipt_is_reverified_on_open_and_not_hashed_on_listing(rig, tmp_path, monkeypatch):
    from raphael_core.background import tasks
    output = tmp_path / 'output'
    output.mkdir()
    result = output / 'result.pdf'
    result.write_bytes(b'original')
    rig.service._settings.set('owner_output_folder', str(output))
    history, identifier = turn(rig.conn)
    store = TaskStore(rig.conn)
    task = store.create(session_id='result', language='en', text='Report', member_id=0)
    store.attach_turn(task, identifier)
    store.verify_artifact(task, 'write', result, workspace=output, mime='application/pdf')
    rig.conn.execute("UPDATE worker_tasks SET state='done',announced=1 WHERE id=?", (task,))
    original_hash = tasks._artifact_digest
    monkeypatch.setattr(tasks, '_artifact_digest', lambda *args: pytest.fail('Listing must not hash files'))
    file = (await rig.call('members.library', {'member_id': 0}))['files'][0]
    monkeypatch.setattr(tasks, '_artifact_digest', original_hash)
    assert await rig.call('members.library_file', {'member_id': 0, 'id': file['id']}) == {'path': str(result)}
    result.write_bytes(b'changed')
    with pytest.raises(RpcError):
        await rig.call('members.library_file', {'member_id': 0, 'id': file['id']})

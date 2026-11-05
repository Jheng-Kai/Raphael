"""The owner panel reads bounded existing records; it never starts a computer."""
import os

import pytest

from raphael_core.background.tasks import TaskStore
from raphael_core.members.panel import snapshot
from raphael_core.protocol import RpcError


def test_tasks_are_member_scoped_and_newest_first_with_verified_artifacts(conn, tmp_path):
    ticks = iter([100, 200, 300])
    store = TaskStore(conn, now_ms=lambda: next(ticks))
    older = store.create(session_id='sample-1', language='en', text='Older work', member_id=0)
    latest = store.create(session_id='sample-2', language='en', text='Latest work', member_id=0)
    other = store.create(session_id='sample-3', language='en', text='Other member', member_id=1)
    conn.execute("INSERT INTO task_evidence(task_id,tool_call_id,kind,uri,digest,mime,scope,verified_at_ms,verdict) VALUES (?,?,?,?,?,?,?,?,?)",
                 (latest, 'sample', 'artifact', str(tmp_path / 'result.md'), 'sample-digest', 'text/markdown', 'private', 210, 'verified'))
    result = snapshot(conn, 0)
    assert [task['id'] for task in result['tasks']] == [latest, older]
    assert other not in [task['id'] for task in result['tasks']]
    assert result['files'][0]['path'].startswith(f'task-artifact:{latest}:')


def test_workspace_listing_is_bounded_and_skips_hidden_and_escaping_links(conn, tmp_path):
    root = tmp_path / 'workspace'
    root.mkdir()
    (root / '.private').write_text('not listed')
    (root / 'sample.md').write_text('sample')
    outside = tmp_path / 'outside'
    outside.mkdir()
    (outside / 'private.txt').write_text('not listed')
    try:
        (root / 'escape').symlink_to(outside, target_is_directory=True)
    except OSError:
        pass
    for index in range(20):
        path = root / f'file-{index}.txt'
        path.write_text('sample')
        os.utime(path, (index + 1, index + 1))
    result = snapshot(conn, 0, [('workspace', root)], 3)
    assert len(result['files']) == 3 and result['has_more']
    assert all(item['path'].startswith('member-file:0:workspace:') for item in result['files'])
    names = [item['name'] for item in snapshot(conn, 0, [('workspace', root)], 100)['files']]
    assert '.private' not in names and 'private.txt' not in names


async def test_panel_reads_validate_the_member_and_limit_without_changing_roster(rig):
    assert (await rig.call('members.list', {'panel_member_id':0})) == {'tasks':[], 'files':[], 'has_more':False}
    assert 'members' in await rig.call('members.list', {})
    with pytest.raises(RpcError):
        await rig.call('members.list', {'panel_member_id':999})
    with pytest.raises(RpcError):
        await rig.call('members.list', {'panel_member_id':0, 'panel_limit':-1})


def test_show_more_stops_at_the_cap_and_does_not_walk_deep_trees(conn, tmp_path):
    for index in range(105):
        (tmp_path / f'sample-{index}.txt').write_text('sample')
    deep = tmp_path / 'one' / 'two' / 'three' / 'four'
    deep.mkdir(parents=True)
    (deep / 'too-deep.txt').write_text('not listed')
    result = snapshot(conn, 0, [('workspace', tmp_path)], 100)
    assert len(result['files']) == 100 and not result['has_more']
    assert 'too-deep.txt' not in [item['name'] for item in result['files']]

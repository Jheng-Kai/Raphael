"""Synthetic history pages exercise the complete production projection without a live brain."""

import cProfile
import json
import pstats
import statistics
import time
from collections import Counter

import pytest

from raphael_core.app import App


@pytest.mark.parametrize('size,loaded', [(10, False), (50, False), (50, True)])
async def test_history_page_projection_profile(tmp_path, size, loaded):
    app = App(data_dir=tmp_path, fake_llm=True)
    try:
        history = app.agent._history
        if loaded:
            for index in range(13):
                app.members.store.create_member(name=f'Sample {index}', role='Research')
            with app._conn:
                app._conn.executemany("INSERT INTO worker_tasks(created_at_ms,state,session_id,language,text,member_id,mode,source_turn_id) "
                    "VALUES (1,'done',?,'en',?,?,'consult',999999)",
                    [(f'old-{index}', 'x' * 22500, index % 14) for index in range(622)])
        for index in range(size):
            identifier = history.add(session_id=f'synthetic-{index}', question='Synthetic question', route='answer',
                prefix='', text='', status='running', source='app', conversation_id=app.agent.conversations.main(0))
            replies = [f'Synthetic reply {part}. ' + 'x' * 780 for part in range(4)]
            history.publish_terminal(identifier, prefix='', text='\n'.join(replies), detail=None,
                status='done', cost_usd=0, replies=replies, model='synthetic/model')
        turns = history.list(limit=size)
        member_samples = []
        for _ in range(5):
            began = time.perf_counter()
            await app.call('members.list', {'ui_language': 'en'})
            member_samples.append((time.perf_counter() - began) * 1000)
        member_queries = []
        app._conn.set_trace_callback(member_queries.append)
        await app.call('members.list', {'ui_language': 'en'})
        app._conn.set_trace_callback(None)
        active_queries = [sql for sql in member_queries if "FROM worker_tasks WHERE member_id" in sql]
        assert len(active_queries) == 1
        samples = []
        for _ in range(15):
            began = time.perf_counter()
            views = app.agent._turn_views(turns)
            samples.append((time.perf_counter() - began) * 1000)
        statements = []
        app._conn.set_trace_callback(statements.append)
        profile = cProfile.Profile()
        profile.runcall(app.agent._turn_views, turns)
        app._conn.set_trace_callback(None)
        tables = Counter()
        for query in statements:
            if query.lstrip().upper().startswith('SELECT'):
                table = query.upper().split(' FROM ', 1)[-1].split()[0]
                tables[table] += 1
        stats = pstats.Stats(profile)
        top = sorted(((value[3] * 1000, key[2], value[1]) for key, value in stats.stats.items()
                      if 'raphael_core' in key[0]), reverse=True)[:8]
        print(json.dumps({'turns': size, 'loaded_tasks': 622 if loaded else 0, 'members_median_ms': statistics.median(member_samples),
            'messages': sum(len(view['messages']) for view in views),
            'response_kib': len(json.dumps(views).encode()) / 1024, 'median_ms': statistics.median(samples),
            'selects': sum(tables.values()), 'selects_by_table': dict(tables), 'top_cumulative_ms': top}))
        assert len(views) == size and all(len(view['messages']) == 4 for view in views)
        assert sum(tables.values()) == 20
        assert tables['WORKER_TASKS'] == 2
        assert tables['MESSAGE_REACTIONS'] == tables['OWNER_QUESTIONS'] == 1
    finally:
        await app.aclose()


async def test_members_list_batch_is_byte_identical_with_active_tasks(tmp_path):
    app = App(data_dir=tmp_path, fake_llm=True)
    try:
        member = app.members.store.create_member(name='Sample', role='Research')
        store = app.background._store
        parent = store.create(session_id='synthetic-parent', language='en', text='Parent')
        child = store.create(session_id='synthetic-child', language='en', text='Child', member_id=member.id)
        with app._conn:
            app._conn.execute("UPDATE worker_tasks SET state='waiting' WHERE id=?", (parent,))
            app._conn.execute('UPDATE worker_tasks SET parent_task_id=? WHERE id=?', (parent, child))
        activity = app.members.activity
        activity.language = lambda: 'en'
        source = activity.task_batch_source
        activity.task_batch_source = None
        expected = await app.call('members.list', {'ui_language': 'en'})
        activity.task_batch_source = source
        statements = []
        app._conn.set_trace_callback(statements.append)
        actual = await app.call('members.list', {'ui_language': 'en'})
        app._conn.set_trace_callback(None)
        assert json.dumps(actual) == json.dumps(expected)
        assert len([sql for sql in statements if 'AS waiting_owner' in sql]) == 1
        assert actual['members'][0]['activity'] == 'waiting'
        assert actual['members'][0]['activity_label'] == 'Waiting for Sample’s result'
    finally:
        await app.aclose()

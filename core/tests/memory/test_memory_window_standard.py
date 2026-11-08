"""Compression and recall contracts, entirely synthetic and offline."""

import json
from datetime import timedelta

import pytest

from raphael_core.agent.ledger import Ledger
from raphael_core.brain.secrets import MemoryKeyStore
from raphael_core.brain.spend import SpendTracker
from raphael_core.memory.compression import threshold_tokens, summary_budget
from raphael_core.memory.conversation import Conversation, plan_fold
from raphael_core.memory.service import MemoryService
from raphael_core.memory.tool_events import record, RESULT_CHARS

from .conftest import FakeModel, add_turn


@pytest.fixture
async def memory(conn, tmp_path, clock):
    keys = MemoryKeyStore()
    keys.set('synthetic')
    service = MemoryService(conn, tmp_path / 'memory', FakeModel(), keys, now_ms=clock.ms, now=clock.now)
    yield service
    await service.aclose()


@pytest.mark.parametrize('window,output,uncapped', [(200000,8192,143856),(1000000,8192,495904),(64000,8192,47436),(1000,0,850)])
def test_effective_window_floor_and_cap(window, output, uncapped):
    assert threshold_tokens(window, output, 0) == uncapped
    assert threshold_tokens(window, output) == min(24000, uncapped)


def test_summary_budget_scales_and_stays_between_two_and_ten_thousand():
    assert [summary_budget(n) for n in (100,10000,20000,100000)] == [2000,2000,4000,10000]


async def test_backlog_reads_early_names_and_dates_before_advancing_watermark(conn, history, clock):
    model = FakeModel()
    conversation = Conversation(conn, model, now_ms=clock.ms)
    conversation.context_window = 20000
    ids = [add_turn(history, f'Turn {n}: ' + ('Alice 2026-12-04 ' if n == 2 else '') + 'x' * 1800) for n in range(90)]
    seen = []
    def summarize(**kwargs):
        user = kwargs['user']
        assert 'Alice' in user and '2026-12-04' in user
        seen.append(user)
        return {'summary': 'Names and numbers:\nAlice 2026-12-04'}
    ledger = Ledger(SpendTracker(conn, clock.ms), 'memory')
    for _ in range(20):
        if conversation.fold_due() is None:
            break
        model.replies.append(summarize)
        assert await conversation.fold('synthetic', ledger)
        assert conversation.summary().through_turn_id <= max(ids)
    assert len(seen) >= 2
    assert 'Turn 2:' in seen[0] and 'Turn 80:' not in seen[0]
    assert 'Alice 2026-12-04' in conversation.summary().text
    assert len(conversation.context().turns) >= 12  # opening plus newest 20 messages
    assert len(history.after(0)) == 90


async def test_giant_turn_resumes_after_restart_without_covering_unread_text(conn, history, clock):
    model = FakeModel()
    conversation = Conversation(conn, model, now_ms=clock.ms)
    conversation.context_window = 20000
    for n in range(2):
        add_turn(history, f'Opening {n}')
    giant = add_turn(history, 'Alice 2026-12-04 ' + 'amber ' * 25000 + ' FINAL_FRAGMENT')
    for n in range(35):
        add_turn(history, f'Recent {n} ' + 'x' * 2000)
    seen = []
    def summarize(**kwargs):
        seen.append(kwargs['user'])
        return {'summary': 'Alice 2026-12-04'}
    model.replies.append(summarize)
    assert await conversation.fold('synthetic', Ledger(SpendTracker(conn, clock.ms), 'memory'))
    assert conversation.summary().through_turn_id < giant
    assert conversation._fragment()[0] == giant
    conversation = Conversation(conn, model, now_ms=clock.ms)
    conversation.context_window = 20000
    for _ in range(30):
        if conversation.fold_due() is None:
            break
        model.replies.append(summarize)
        assert await conversation.fold('synthetic', Ledger(SpendTracker(conn, clock.ms), 'memory'))
    assert any('FINAL_FRAGMENT' in prompt for prompt in seen)
    assert conversation.summary().through_turn_id >= giant


async def test_running_turn_is_not_covered_before_its_answer_arrives(conn, history, clock):
    conversation = Conversation(conn, FakeModel(), now_ms=clock.ms)
    conversation.context_window = 200
    for n in range(2):
        add_turn(history, f'Opening {n}')
    waiting = add_turn(history, 'An unfinished synthetic request', status='running')
    for n in range(40):
        add_turn(history, f'Later question {n}')
    assert waiting in conversation.protected(history.after(0))
    assert conversation.fold_due() is None


async def test_persistent_recall_benchmark_five_thousand_turns(memory, history):
    import sqlite3
    import statistics
    import time
    from pathlib import Path
    from raphael_core.memory.terms import index_terms
    for n in range(5000):
        add_turn(history, f'Synthetic record {n}: ' + ('aurora release' if n % 100 == 0 else 'ordinary notebook'))
    def baseline():
        with sqlite3.connect(':memory:') as temporary:
            temporary.execute('CREATE VIRTUAL TABLE search USING fts5(pairs,chars)')
            rows = []
            for turn in history.after(0):
                terms = index_terms(turn.question + ' ' + turn.text)
                rows.append((turn.id, terms.pairs, terms.chars))
            temporary.executemany('INSERT INTO search(rowid,pairs,chars) VALUES(?,?,?)', rows)
            return temporary.execute("SELECT rowid FROM search WHERE search MATCH 'pairs:aurora AND pairs:release' LIMIT 8").fetchall()
    before, after = [], []
    for _ in range(3):
        start = time.perf_counter()
        assert baseline()
        before.append((time.perf_counter() - start) * 1000)
        start = time.perf_counter()
        assert memory.session_search(0, 'aurora release').data['hits']
        after.append((time.perf_counter() - start) * 1000)
    result = {'turns': 5000, 'samples': 3, 'before_median_ms': statistics.median(before),
              'after_median_ms': statistics.median(after), 'before_ms': before, 'after_ms': after,
              'baseline': 'rebuild in-memory FTS from all permitted turn text per query'}
    destination = Path('.test-results/hermes-recall-benchmark.json')
    destination.parent.mkdir(exist_ok=True)
    destination.write_text(json.dumps(result, indent=2), encoding='utf-8')
    assert not memory.session_search(1, 'aurora release').data['hits']


async def test_synthetic_cap_cost_comparison(conn, history, clock):
    from pathlib import Path
    from raphael_core.brain.openrouter import Completion
    from raphael_core.memory.conversation import turn_text
    from raphael_core.memory.terms import estimate_tokens
    for n in range(650):
        add_turn(history, f'Synthetic turn {n}: ' + '\u5b57' * 1000)
    rows = []
    for window in (200000, 1000000):
        for cap in (24000, 0):
            model = FakeModel()
            conversation = Conversation(conn, model, now_ms=clock.ms)
            conversation.context_window, conversation.max_output_tokens, conversation.threshold_cap = window, 8192, cap
            conversation.clear_summary()
            conversation.summary_model = lambda member: 'auxiliary-synthetic'
            inputs, outputs = [], []
            def summarize(**kwargs):
                text = 'Context:\nSynthetic records retained.'
                inputs.append(estimate_tokens(kwargs['system']) + estimate_tokens(kwargs['user']))
                outputs.append(estimate_tokens(text))
                return Completion(data={'summary': text}, model=kwargs['model'], cost_usd=0,
                                  prompt_tokens=inputs[-1], completion_tokens=outputs[-1], latency_ms=0)
            for _ in range(100):
                if conversation.fold_due() is None:
                    break
                model.replies.append(summarize)
                assert await conversation.fold('member-synthetic', Ledger(SpendTracker(conn, clock.ms), 'memory'))
            assert conversation.fold_due() is None
            context = conversation.context()
            rows.append({'window': window, 'max_output': 8192, 'cap': cap,
                         'threshold': threshold_tokens(window, 8192, cap), 'turns': 650,
                         'history_input_tokens_after_fold': estimate_tokens(context.summary) + sum(estimate_tokens(turn_text(turn, detail=True)) for turn in context.turns),
                         'auxiliary_calls': len(inputs), 'auxiliary_input_tokens_estimated': sum(inputs),
                         'auxiliary_output_tokens_estimated': sum(outputs), 'real_requests': 0})
    destination = Path('.test-results/hermes-compression-cost.json')
    destination.parent.mkdir(exist_ok=True)
    destination.write_text(json.dumps(rows, indent=2), encoding='utf-8')
    for offset in (0, 2):
        assert rows[offset]['history_input_tokens_after_fold'] < rows[offset + 1]['history_input_tokens_after_fold']


async def test_tool_result_is_redacted_searchable_private_and_deleted_with_turn(memory, history, conn):
    identifier = add_turn(history, 'Read the synthetic page')
    record(conn, identifier, 'call-1', 'web_read', {'token':'synthetic-sensitive-value','query':'aurora'},
           {'password':'synthetic-sensitive-value','text':'aurora evidence ' + 'x' * 40000}, ok=True, external=True)
    # One native retry keeps a single event rather than duplicating evidence.
    record(conn, identifier, 'call-1', 'web_read', {'query':'aurora'},
           {'password':'synthetic-sensitive-value','text':'aurora evidence ' + 'x' * 40000}, ok=True, external=True)
    assert conn.execute('SELECT count(*) FROM turn_tool_events').fetchone()[0] == 1
    result = memory.session_read(0, f'turn:{identifier}')
    assert result.ok and result.untrusted and 'aurora evidence' in result.data['text']
    assert 'synthetic-sensitive-value' not in str(result.data)
    assert memory.session_search(0, 'aurora').data['hits']
    assert not memory.session_read(1, f'turn:{identifier}').ok
    assert not memory.session_search(1, 'aurora').data['hits']
    assert conn.execute('SELECT length(redacted_result) FROM turn_tool_events').fetchone()[0] <= RESULT_CHARS
    assert history.delete(identifier)
    assert not conn.execute('SELECT 1 FROM turn_tool_events').fetchone()
    assert not memory.session_search(0, 'aurora').data['hits']
    for identifier in ('turn:\u00b2', 'turn:' + '9' * 100, 'room:9223372036854775808'):
        assert not memory.session_read(0, identifier).ok


async def test_recall_excludes_recent_before_limit_and_uses_and_before_or(memory, history):
    first = add_turn(history, 'amber release')
    recent = [add_turn(history, 'amber release') for _ in range(12)]
    add_turn(history, 'amber only')
    hits = memory._search_hits(0, 'amber release', 4, exclude=recent)
    assert [hit['id'] for hit in hits] == [f'turn:{first}']
    recalled, _ = memory.recall_result(0, 'amber release', exclude=recent)
    assert all(f'"id": "turn:{identifier}"' not in recalled for identifier in recent)
    assert memory.session_search(0, 'amber missingword').data['hits']
    assert memory._search_hits(0, 'amber release', 4, exclude=[*[turn.id for turn in history.after(0)], *range(10000, 50000)]) == []


async def test_expiry_validation_and_owner_settings(memory, conn):
    from raphael_core.brain.settings import SettingsStore
    settings = SettingsStore(conn)
    for key in ('memory_threshold_tokens_cap', 'memory_max_unused_days'):
        settings.set(key, 0)
        assert settings.get(key) == 0
        with pytest.raises(ValueError):
            settings.set(key, -1)
    own = memory.own(2)
    assert own.apply([{'action':'add','content':'Temporary review', 'until':'2026-02-30'}])['kind'] == 'bad_arguments'
    assert not own.read()


async def test_until_date_is_inclusive_and_can_be_cleared(memory, clock, conn):
    own = memory.own(2)
    today = clock.now().date().isoformat()
    assert own.apply([{'action':'add','content':'The review remains active today.', 'until':today}])['success']
    assert not own.stale_entries(clock.now().date(), 90)
    assert own.apply([{'action':'add','content':'The review remains active today.', 'until':None}])['changed']
    assert conn.execute("SELECT until_date FROM memory_entry_metadata WHERE scope='member:2'").fetchone()[0] is None


async def test_outside_content_cannot_expire_a_confirmed_duplicate(memory, conn):
    own = memory.own(2)
    content = 'The stable environment uses amber notebooks.'
    assert own.apply([{'action':'add', 'content':content}])['success']
    result = memory.update_memory(2, {'target':'memory', 'operations':[
        {'action':'add', 'content':content, 'until':'2026-01-01'}]}, untrusted=True)
    assert not result.ok and result.error == 'unconfirmed_only'
    assert conn.execute("SELECT until_date FROM memory_entry_metadata WHERE scope='member:2'").fetchone()[0] is None


async def test_until_field_migration_expiry_and_last_recalled(memory, clock, conn):
    own = memory.own(2)
    yesterday = (clock.now().date() - timedelta(days=1)).isoformat()
    assert own.apply([{'action':'add','content':'Temporary review until Friday','until':yesterday},
                      {'action':'add','content':'The stable environment uses amber notebooks and a local build cache.'}])['success']
    assert own.prune_stale(clock.now().date(), 90)['success']
    assert 'Temporary review' not in own.read()
    assert 'amber notebooks' in own.read()
    assert own.apply([{'action':'add','content':f'Another dated plan (until {yesterday})'}])['success']
    assert all('(until ' not in entry for entry in own.entries())
    assert conn.execute("SELECT until_date FROM memory_entry_metadata WHERE scope='member:2' AND until_date IS NOT NULL").fetchone()[0] == yesterday
    memory.snapshot(2)
    assert conn.execute("SELECT min(last_recalled_at_ms) FROM memory_entry_metadata WHERE scope='member:2'").fetchone()[0] == clock.ms()
    assert not memory.own(3).entries()


async def test_automatic_expiry_keeps_the_half_file_floor(memory, clock):
    own = memory.own(2)
    yesterday = (clock.now().date() - timedelta(days=1)).isoformat()
    assert own.apply([{'action':'add','content':'The large temporary plan ' + 'a' * 200, 'until':yesterday},
                      {'action':'add','content':'One short stable fact.'}])['success']
    assert own.prune_stale(clock.now().date())['kind'] == 'too_much_removed'
    assert 'temporary plan' in own.read()


async def test_new_similar_entry_does_not_inherit_an_unchanged_entry_expiry(memory, clock, conn):
    own = memory.own(2)
    assert own.apply([{'action':'add','content':'The amber release is scheduled for Thursday.', 'until':'2026-12-01'}])['success']
    # A whole owner edit can insert a similar independent entry before the original.
    assert own.edit_document('The amber release is scheduled for Friday.\n\nThe amber release is scheduled for Thursday.', None)['success']
    from raphael_core.memory.entry_metadata import entry_id
    row = conn.execute('SELECT until_date FROM memory_entry_metadata WHERE scope=? AND entry_id=?',
                       ('member:2', entry_id('The amber release is scheduled for Friday.'))).fetchone()
    assert row[0] is None


async def test_summary_uses_quick_model_or_records_why_it_retains_member(memory, caplog):
    import logging
    caplog.set_level(logging.INFO)
    assert memory.summary_model('member-model') == 'member-model'
    assert 'not_configured' in caplog.text
    memory._settings.set('quick_model', 'auxiliary-model')
    assert memory.summary_model('member-model') == 'auxiliary-model'
    memory._keys.clear()
    assert memory.summary_model('member-model') == 'member-model'
    assert 'unavailable' in caplog.text


async def test_auxiliary_failure_falls_back_once_and_keeps_memory_spend(conn, history, clock, caplog):
    from raphael_core.brain.openrouter import OpenRouterError
    model = FakeModel()
    conversation = Conversation(conn, model, now_ms=clock.ms)
    conversation.context_window = 200
    conversation.summary_model = lambda member: 'auxiliary-model'
    for n in range(35):
        add_turn(history, f'A synthetic fact {n}')
    model.replies.extend([OpenRouterError(503, 'server', 'Synthetic outage'), {'summary':'Names and numbers:\nAlice 2026-12-04'}])
    assert await conversation.fold('member-model', Ledger(SpendTracker(conn, clock.ms), 'memory'))
    assert [call['model'] for call in model.calls] == ['auxiliary-model', 'member-model']
    assert all(call['fallbacks'] == [] for call in model.calls)
    assert 'retaining member brain' in caplog.text
    assert 'server' in caplog.text
    assert conn.execute('SELECT purpose FROM spend').fetchone()[0] == 'memory'


async def test_tool_payload_is_pruned_before_summary(conn, history, clock):
    model = FakeModel()
    conversation = Conversation(conn, model, now_ms=clock.ms)
    conversation.context_window = 1000
    ids = [add_turn(history, f'Question {n} ' + 'x' * 200) for n in range(40)]
    record(conn, ids[2], 'call', 'web_read', {}, 'PRIVATE-SYNTHETIC-BODY' * 100, ok=True, external=True)
    model.replies.append({'summary':'Context:\nA page was read.'})
    assert await conversation.fold('synthetic', Ledger(SpendTracker(conn, clock.ms), 'memory'))
    user = model.calls[0]['user']
    assert 'output pruned' in user and f'session_read turn:{ids[2]}' in user
    assert 'PRIVATE-SYNTHETIC-BODY' not in user


async def test_unused_entries_are_removed_before_model_merging(memory, clock, conn):
    own = memory.own(2)
    assert own.apply([{'action':'add','content':'One short stale fact.'},
                      {'action':'add','content':'The active stable environment has a local cache and uses amber notebooks.'}])['success']
    from raphael_core.memory.entry_metadata import entry_id
    clock.advance(days=91)
    with conn:
        conn.execute("UPDATE memory_entry_metadata SET last_recalled_at_ms=? WHERE scope='member:2' AND entry_id=?",
                     (clock.ms(), entry_id(own.entries()[1])))
    assert own.prune_stale(clock.now().date(), 90)['success']
    assert 'stale fact' not in own.read() and 'amber' in own.read()


async def test_log_index_survives_service_restart_and_history_clear(memory, history, conn, tmp_path, clock):
    memory.log_memory(2, {'body':'An indexed aurora log.'})
    add_turn(history, 'aurora in a turn')
    history.clear()
    assert memory.session_search(2, 'aurora').data['hits']
    await memory.aclose()
    replacement = MemoryService(conn, tmp_path / 'memory', FakeModel(), MemoryKeyStore(), now_ms=clock.ms, now=clock.now)
    try:
        assert replacement.session_search(2, 'aurora').data['hits']
        assert not replacement.session_search(3, 'aurora').data['hits']
    finally:
        await replacement.aclose()


async def test_first_8192_tool_characters_are_indexed_and_room_scope_never_gets_private_tools(memory, history, conn):
    identifier = add_turn(history, 'Read a synthetic document')
    record(conn, identifier, 'call', 'web_read', {}, 'prefixneedle ' + 'x ' * 5000 + 'suffixneedle', ok=True, external=True)
    assert memory.session_search(0, 'prefixneedle').data['hits']
    assert not memory.session_search(0, 'suffixneedle').data['hits']
    assert not memory.session_search(0, 'prefixneedle', private=False).data['hits']
    assert not memory.session_read(0, f'turn:{identifier}', private=False).ok

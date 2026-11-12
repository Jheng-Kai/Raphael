"""Member namespaces without a guest, dependency installation or sockets."""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from raphael_core.computer import dataset_runtime, datasets
from .test_seat_tools import seat_tools, call
from .test_seat_wiring import shared_vm


def test_member_folders_isolate_databases_locks_imports_and_charts_but_keep_venv_common(tmp_path):
    root = tmp_path
    first = dataset_runtime.data_folder({'member_key': 'a' * 16}, root)
    second = dataset_runtime.data_folder({'member_key': 'b' * 16}, root)
    assert first == root / '.raphael-data/members' / ('a' * 16)
    assert second != first
    (first / 'sales.duckdb').write_bytes(b'first')
    (second / 'sales.duckdb').write_bytes(b'second')
    picture = dataset_runtime.chart(first, ['label', 'value'], [('one', 1)])
    assert str(first) in picture and not list(second.glob('chart-*'))
    assert dataset_runtime.data_folder({}, root) == root / '.raphael-data'
    command = datasets.command_for({'action': 'list', 'dataset': 'sales', 'member_key': 'a' * 16})
    assert "env=folder/" in command and 'install.lock' in command


@pytest.mark.parametrize('key', ['', 'A' * 16, 'a' * 15, '../other', None, 123])
def test_runtime_refuses_invalid_core_keys(tmp_path, key):
    with pytest.raises(ValueError, match='member key'):
        dataset_runtime.data_folder({'member_key': key}, tmp_path)


@pytest.mark.parametrize('part', ['members', 'member'])
def test_runtime_refuses_symbolic_member_folders_even_if_they_point_inside(tmp_path, monkeypatch, part):
    from pathlib import Path
    expected = tmp_path / '.raphael-data/members'
    if part == 'member':
        expected /= 'a' * 16
    original = Path.is_symlink
    monkeypatch.setattr(Path, 'is_symlink', lambda path: path == expected or original(path))
    with pytest.raises(ValueError, match='path refused'):
        dataset_runtime.data_folder({'member_key': 'a' * 16}, tmp_path)


async def test_member_cannot_supply_the_core_key_and_attachment_uses_the_core_folder(tmp_path, monkeypatch):
    from raphael_core.services.attachment_store import AttachmentStore
    from raphael_core.services.attachments import Attachment
    store = AttachmentStore(tmp_path)
    file = store.save(Attachment('a.csv', 'text/csv', b'n\n1\n'))
    sent, encoded = [], []
    monkeypatch.setattr(datasets, 'command_for', lambda args: encoded.append(args) or 'runtime')
    async def execute(name, args):
        sent.append((name, args))
        return SimpleNamespace(ok=True, text=json.dumps({'exit_code': 0, 'output': '{}'}))
    args = {'action': 'import', 'dataset': 'sales', 'sources': ['attachment:' + file.stored_id]}
    refused = await datasets.run_dataset({**args, 'member_key': 'b' * 16}, execute, store, member_key='a' * 16)
    assert refused.kind == 'bad_arguments' and not sent
    assert (await datasets.run_dataset(args, execute, store, member_key='a' * 16)).ok
    assert encoded[0]['member_key'] == 'a' * 16
    assert encoded[0]['sources'][0].startswith('.raphael-data/members/' + 'a' * 16 + '/imports/')
    assert 'is_symlink' in sent[0][1]['command']
    encoded.clear()
    assert (await datasets.run_dataset({'action': 'list', 'dataset': 'sales'}, execute)).ok
    assert 'member_key' not in encoded[0]


async def test_shared_tool_adds_stable_key_after_schema_validation(seat_tools, monkeypatch):
    hub, vm, _ = seat_tools
    execute = AsyncMock(return_value=SimpleNamespace(ok=True, blocks=[], text='{}'))
    monkeypatch.setattr(datasets, 'run_dataset', execute)
    for member in (1, 2):
        await call(hub, member, 'dataset', {'action': 'list', 'dataset': 'sales'})
        assert execute.call_args.kwargs['member_key'] == vm.key_for('', member)
        tool = next(t for t in hub.offered_for(member) if t.name == 'dataset')
        assert hub.schemas[tool.key] == datasets.SCHEMA


def test_runtime_queries_lists_locks_and_charts_follow_member_folder_with_injected_database(tmp_path, monkeypatch):
    """Exercise the runtime paths; SQLite is a transport double, not DuckDB acceptance."""
    import sqlite3
    import sys
    locks = []
    class Database:
        def __init__(self, path):
            self.connection = sqlite3.connect(path)
        def execute(self, sql):
            if sql.startswith('SET '):
                return None
            if sql == 'SHOW TABLES':
                sql = "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            return self.connection.execute(sql)
        def extract_statements(self, sql):
            return [SimpleNamespace(type='StatementType.SELECT')]
        def close(self):
            self.connection.close()
    monkeypatch.setitem(sys.modules, 'duckdb', SimpleNamespace(connect=lambda path, **kwargs: Database(path)))
    monkeypatch.setitem(sys.modules, 'fcntl', SimpleNamespace(LOCK_EX=1, flock=lambda fd, mode: locks.append(fd.name)))
    for key, value in [('a' * 16, 11), ('b' * 16, 22)]:
        folder = dataset_runtime.data_folder({'member_key': key}, tmp_path)
        with sqlite3.connect(folder / 'sales.duckdb') as conn:
            conn.execute('CREATE TABLE only_' + key + '(n INTEGER)')
            conn.execute('INSERT INTO only_' + key + ' VALUES (?)', (value,))
        args = {'member_key': key, 'dataset': 'sales', 'action': 'query', 'sql': 'SELECT n FROM only_' + key}
        assert dataset_runtime.execute(args, tmp_path)['rows'] == [(value,)]
        assert dataset_runtime.execute({**args, 'action': 'list'}, tmp_path)['rows'] == [('only_' + key,)]
        result = dataset_runtime.execute({**args, 'action': 'chart', 'sql': "SELECT 'one',n FROM only_" + key}, tmp_path)
        assert __import__('pathlib').Path(result['chart_path']).parent == folder
        assert locks[-1] == str(folder / 'sales.lock')

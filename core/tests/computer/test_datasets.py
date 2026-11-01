"""Named data work runs only through the member's existing VM boundary."""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest


async def test_dataset_request_is_data_not_shell_and_runs_via_vm_exec():
    from raphael_core.computer.datasets import run_dataset
    sent = []
    async def call(name, args):
        sent.append((name, args))
        return SimpleNamespace(ok=True, text=json.dumps({"exit_code": 0, "output": '{"columns":["total"],"rows":[[6]],"dataset":"sales"}'}))
    result = await run_dataset({"action": "query", "dataset": "sales", "sql": "SELECT ';$(touch /tmp/no)' AS total"}, call)
    assert result.ok and json.loads(result.text)["dataset"] == "sales"
    assert [name for name, args in sent] == ["vm_exec"]
    assert "$(touch /tmp/no)" not in sent[0][1]["command"]
    assert ".raphael-data" in sent[0][1]["command"]
    assert sent[0][1]["timeout_seconds"] <= 1800


async def test_dataset_obeys_forbidden_rules_in_allow_all(tmp_path, conn):
    from raphael_core.agent.gate import ToolGate
    from raphael_core.agent.ledger import Ledger
    from raphael_core.agent.safety import DENY, Proposed, SafetyGuard, SafetyRules
    from raphael_core.brain.settings import SettingsStore
    from raphael_core.brain.spend import SpendTracker
    from raphael_core.computer.vm import LocalVm
    from raphael_core.computer.vm_tools import VmTools
    from .test_vm import Runtime, EmptyHub, Bridge
    settings = SettingsStore(conn)
    settings.set('action_mode', 'bypass')
    vm = LocalVm(tmp_path, runner=Runtime(), settings=settings)
    hub = VmTools(EmptyHub(), vm, attachments=None, conn=conn, bridge=Bridge)
    await hub.prepare(0)
    tool = next(t for t in hub.offered_for(0) if t.name == 'dataset')
    rules = SafetyRules(conn)
    rules.create('Do not work on datasets', DENY)
    judge = SimpleNamespace(matching=AsyncMock(return_value=frozenset({1})))
    gate = ToolGate(hub, conn=conn, safety=SafetyGuard(rules, judge))
    assert not gate.is_vm_tool(tool.key), 'Dataset work must reach the ordinary safety screen'
    screened = await gate.screen(Proposed('computer / dataset', tool.description), language='en', ledger=Ledger(SpendTracker(conn)))
    assert screened.verdict == DENY


@pytest.mark.parametrize("arguments", [
    {"action": "import", "dataset": "../other", "sources": ["a.csv"]},
    {"action": "import", "dataset": "sales", "sources": ["/etc/passwd"]},
    {"action": "import", "dataset": "sales", "sources": ["https://private/source.csv"]},
])
async def test_invalid_dataset_names_and_sources_never_execute(arguments):
    from raphael_core.computer.datasets import run_dataset
    execute = AsyncMock()
    result = await run_dataset(arguments, execute)
    assert not result.ok and result.kind == "bad_arguments"
    execute.assert_not_awaited()


async def test_stored_csv_is_copied_into_the_member_workspace_and_first_use_logs_do_not_hide_the_table(tmp_path):
    from raphael_core.computer.datasets import run_dataset
    from raphael_core.services.attachment_store import AttachmentStore
    from raphael_core.services.attachments import Attachment
    store=AttachmentStore(tmp_path)
    file=store.save(Attachment('owner.csv','text/csv',b'region,total\nTaipei,36\n'))
    sent=[]
    async def call(name, arguments):
        sent.append(arguments['command'])
        return SimpleNamespace(ok=True,text=json.dumps({'exit_code':0,'output':'{"dataset":"sales","columns":["total"],"rows":[[36]]}\nInstalling duckdb\n'}))
    result=await run_dataset({'action':'import','dataset':'sales','sources':['attachment:'+file.stored_id]}, call, store)
    assert result.ok and json.loads(result.text)['rows'] == [[36]]
    assert len(sent) == 2 and '.raphael-data/imports/' in sent[0]
    assert all(len(command) <= 16000 for command in sent)


def test_stored_file_references_reach_model_context_even_for_binary_files():
    from raphael_core.agent.attachment_inputs import text_context
    from raphael_core.services.attachments import Attachment
    key='a'*32+'.xlsx'
    context=text_context([Attachment('input.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',b'PK',key)])
    assert key in context and 'untrusted' in context and 'input.xlsx' in context


def test_dataset_runtime_persists_duckdb_and_bounds_queries_without_image_layer():
    from raphael_core.computer.datasets import command_for
    command = command_for({"action": "import", "dataset": "sales", "sources": ["a.csv", "b.xlsx", "c.parquet"]})
    assert "--system-site-packages" not in command
    assert "duckdb==" in command and "openpyxl==" in command
    assert "Dockerfile" not in command
    from raphael_core.computer import dataset_runtime
    source = __import__("inspect").getsource(dataset_runtime)
    assert "duckdb.connect" in source and ".duckdb" in source
    assert "read_csv" in source and "read_parquet" in source and "openpyxl" in source
    assert "enable_external_access" in source and "fetchmany" in source


def test_runtime_import_union_reopen_and_sql_sandbox_with_real_duckdb(tmp_path):
    pytest.importorskip('duckdb', reason='Offline host has no DuckDB; runtime is installed only in the member workspace')
    pytest.importorskip('fcntl', reason='The production dataset runtime executes inside the Linux member computer')
    from raphael_core.computer.dataset_runtime import execute
    (tmp_path/'a.csv').write_text('region,total\nTaipei,12\n', encoding='utf-8')
    (tmp_path/'b.csv').write_text('region,total\nTaipei,24\n', encoding='utf-8')
    imported=execute({'action':'import','dataset':'sales','sources':['a.csv','b.csv']}, tmp_path)
    assert imported['count'] == 2
    result=execute({'action':'query','dataset':'sales','sql':'SELECT sum(total) FROM data'}, tmp_path)
    assert result['rows'] == [(36,)]
    with pytest.raises(Exception):
        execute({'action':'query','dataset':'sales','sql':"SELECT * FROM read_csv('/etc/passwd')"}, tmp_path)

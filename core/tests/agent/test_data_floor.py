"""Protected app data cannot be changed through an untrusted command or file tool."""

import pytest

from raphael_core.agent.data_floor import DataFloor
from raphael_core.agent.gate import ToolGate
from raphael_core.agent.policy import Action, NotApproved, Tier
from raphael_core.brain.settings import SettingsStore
from .test_gate import FakeHub, approval_for


@pytest.fixture
def floor():
    return DataFloor(environ={"APPDATA": r"C:\Users\Owner\AppData\Roaming",
                              "LOCALAPPDATA": r"C:\Users\Owner\AppData\Local",
                              "USERPROFILE": r"C:\Users\Owner"}, core_root=r"D:\Raphael\core")


@pytest.mark.parametrize("path", [
    r"%appdata%\RAPHAEL-dev\credentials.json", r"$env:LOCALAPPDATA\Raphael\db.sqlite-wal",
    r"${env:APPDATA}\Raphael\secrets", r"~\.raphael\raphael.db-shm",
    r"D:\Raphael\core\src\raphael_core\app.py", r"d:/raphael/core/../core/pyproject.toml",
    r"C:\elsewhere\raphael.db", r"C:\elsewhere\raphael.db-wal", r"C:\elsewhere\raphael.db-shm",
])
def test_resolved_app_paths_are_write_protected_and_reads_require_consent(floor, path):
    assert floor.access("mcp:local/run", {"command": f'Set-Content "{path}" hacked'}) == "write"
    assert floor.access("read_file", {"path": path}) == "read"
    assert floor.access("write_file", {"path": path, "content": "hacked"}) == "write"


def test_unrelated_work_and_management_arguments_are_not_file_operations(floor):
    assert floor.access("write_file", {"path": r"D:\Reports\result.md", "content": "raphael.db"}) is None
    assert floor.access("member_update", {"instructions": "Read raphael.db"}) is None
    assert floor.access("read_file", {"path": r"D:\Raphael\core-other\notes.txt"}) is None


@pytest.mark.parametrize("command", [
    'python -c "import sqlite3; sqlite3.connect(\'C:/data/raphael.db\').execute(\'DELETE FROM members\')"',
    'Get-Content C:/data/raphael.db | Set-Content C:/elsewhere/copied.db',
    'cmd /c del C:/data/raphael.db',
])
def test_scripts_and_pipelines_cannot_hide_a_write(floor, command):
    assert floor.access("mcp:local/run", {"command": command}) == "write"


@pytest.mark.parametrize("arguments,access", [
    ({"tool_name": "Read", "tool_input": {"file_path": r"%APPDATA%\Raphael\credentials.json"}}, "read"),
    ({"command": ["powershell", "-Command", "Get-Content C:/data/raphael.db"]}, "read"),
    ({"command": ["cmd", "/c", "del C:/data/raphael.db"]}, "write"),
    ({"fileChanges": {"C:/data/raphael.db": {"type": "delete"}}}, "write"),
    ({"toolCall": {"kind": "read", "rawInput": {"path": "C:/data/raphael.db"}}}, "read"),
    ({"toolCall": {"kind": "edit", "rawInput": {"path": "C:/data/raphael.db"}}}, "write"),
    ({"command": "Get-Content C:/data/raphael.db $(Set-Content C:/data/raphael.db hacked)"}, "write"),
])
def test_native_cli_permission_payloads_obey_the_same_floor(floor, arguments, access):
    assert floor.access("cli_permission", arguments) == access


def test_quoted_paths_with_spaces_protect_the_actual_database_even_with_another_filename(tmp_path):
    import sqlite3
    folder = tmp_path / "Data With Spaces"
    folder.mkdir()
    path = folder / "state.sqlite"
    with sqlite3.connect(path) as conn:
        guard = DataFloor(conn, environ={}, core_root=tmp_path / "unrelated")
        assert guard.access("local_exec", {"command": f'Set-Content "{path}" hacked'}) == "write"
        assert guard.access("local_exec", {"command": f'Get-Content "{path}"'}) == "read"


@pytest.mark.parametrize("mode", ["ask", "plan", "direct", "bypass"])
async def test_writes_never_reach_the_hub_even_with_exact_approval(conn, mode):
    SettingsStore(conn).set("action_mode", mode)
    hub = FakeHub(run="T0")
    gate = ToolGate(hub, conn=conn)
    action = Action("mcp:s/run", {"command": 'Set-Content "C:/data/raphael.db" hacked'})
    approval = approval_for(action)
    with pytest.raises(NotApproved):
        gate.check(action, approval)
    result = await gate.call_plugin(action.tool, action.args, approval=approval)
    assert not result.ok and result.kind == "protected_data"
    assert "management tools" in result.text
    assert not hub.calls


@pytest.mark.parametrize("mode", ["ask", "plan", "direct", "bypass"])
async def test_read_consent_is_single_use_in_every_mode(conn, mode):
    SettingsStore(conn).set("action_mode", mode)
    hub = FakeHub(read_file="T0")
    gate = ToolGate(hub, conn=conn)
    action = Action("mcp:s/read_file", {"path": "C:/data/raphael.db"})
    assert gate.tier(action.tool, action.args) == Tier.T3
    assert gate.needs_confirmation(action.tool, action.args)
    assert not gate.waived(action)
    with pytest.raises(NotApproved):
        gate.check(action, None)
    yes = approval_for(action, Tier.T3)
    assert (await gate.call_plugin(action.tool, action.args, approval=yes, action=action)).ok
    assert not (await gate.call_plugin(action.tool, action.args, approval=yes, action=action)).ok
    assert not (await gate.call_plugin(action.tool, action.args)).ok
    assert len(hub.calls) == 1

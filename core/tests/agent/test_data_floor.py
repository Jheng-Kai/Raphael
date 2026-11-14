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


@pytest.mark.parametrize('directory', ['Raphael', 'Raphael Dev'])
@pytest.mark.parametrize('appdata', [True, False])
def test_both_windows_data_directories_are_protected_even_without_appdata(directory, appdata):
    env = {'USERPROFILE':r'C:\Users\Owner'}
    if appdata:
        env['APPDATA'] = r'C:\Users\Owner\AppData\Roaming'
    guard = DataFloor(environ=env, core_root=r'D:\Core')
    path = rf'C:\Users\Owner\AppData\Roaming\{directory}\settings.json'
    assert guard.access('read_file', {'path':path}) == 'read'
    assert guard.access('local_exec', {'command':f'Get-Content "{path}"'}) == 'read'
    assert guard.access('write_file', {'path':path, 'content':'x'}) == 'write'


@pytest.mark.parametrize('key', ['RAPHAEL_DATA_DIR', 'RAPHAEL_HOME'])
def test_configured_data_directory_protects_more_than_the_database(key):
    guard = DataFloor(environ={key:r'D:\Custom Data'}, core_root=r'D:\Core')
    assert guard.access('read_file', {'path':r'D:\Custom Data\members\profile.json'}) == 'read'
    assert guard.access('write_file', {'path':r'D:\Custom Data\members\profile.json'}) == 'write'
    assert guard.access('read_file', {'path':r'D:\Custom Data Other\profile.json'}) is None


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


def test_the_actual_app_database_protects_its_configured_data_directory(tmp_path):
    import sqlite3
    folder = tmp_path / 'Configured Data'
    folder.mkdir()
    with sqlite3.connect(folder / 'raphael.db') as conn:
        guard = DataFloor(conn, environ={}, core_root=tmp_path / 'unrelated')
        path = str(folder / 'settings.json')
        assert guard.access('read_file', {'path':path}) == 'read'
        assert guard.access('write_file', {'path':path, 'content':'x'}) == 'write'


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


_DATA = r"C:\Users\Owner\AppData\Roaming\Raphael Dev"
_ATTACHED = _DATA + r"\attachments\0123456789abcdef0123456789abcdef.html"


@pytest.mark.parametrize("command", [
    f"Get-Content -LiteralPath '{_ATTACHED}' -Raw",
    f"$p='{_ATTACHED}'; if (Test-Path -LiteralPath $p) {{ Get-Content -LiteralPath $p -Raw -Encoding UTF8 }} else {{ 'TEMPLATE_NOT_FOUND' }}",
    f"Get-Item '{_ATTACHED}'; Get-ChildItem 'D:/bots' -Filter '*japanese*' | Select-Object Name,LastWriteTime; "
    "Get-Process | Where-Object {$_.MainWindowTitle -match 'NHK'} | Select-Object Id,ProcessName",
])
def test_a_member_reads_the_files_the_owner_attached_in_its_conversation(floor, command):
    """Owner, 2026-11-14: 紫苑's own attachments were refused as protected_data 5 times."""
    assert floor.access("local__local_exec", {"command": command}) is None
    assert floor.access("read_file", {"path": _ATTACHED}) is None


@pytest.mark.parametrize("command", [
    f"Set-Content '{_ATTACHED}' hacked",
    f"Get-Content '{_ATTACHED}' > 'D:/copy.html'",
    f"Remove-Item '{_ATTACHED}'",
    f"rm '{_ATTACHED}'",
    f"python -c \"open(r'{_ATTACHED}', 'w').write('x')\"",
    f"[IO.File]::WriteAllText('{_ATTACHED}', 'x')",
])
def test_an_attachment_is_still_not_written_by_a_command(floor, command):
    assert floor.access("local__local_exec", {"command": command}) == "write"
    assert floor.access("write_file", {"path": _ATTACHED, "content": "x"}) == "write"


@pytest.mark.parametrize("path", [
    _DATA + r"\raphael.db", _DATA + r"\vault.json", _DATA + r"\settings.json", _DATA + r"\.env",
    _DATA + r"\attachments", _DATA + r"\attachments\0123456789abcdef0123456789abcdef.html.json",
    _DATA + r"\attachments\notes.html", _DATA + r"\attachments\sub\0123456789abcdef0123456789abcdef.html",
    r"C:\Users\Owner\AppData\Roaming\Other\attachments\0123456789abcdef0123456789abcdef.html\..\..\Raphael\raphael.db",
])
def test_credentials_and_the_rest_of_the_data_folder_stay_protected_beside_attachments(floor, path):
    assert floor.access("read_file", {"path": path}) == "read"
    assert floor.access("local__local_exec", {"command": f"Get-Content '{path}'"}) == "read"
    assert floor.access("local__local_exec", {"command": f"Get-Content '{_ATTACHED}'; Get-Content '{path}'"}) == "read"
    assert floor.access("local__local_exec", {"command": f"$p='{path}'; if ($p) {{ Get-Content $p }}"}) == "write"

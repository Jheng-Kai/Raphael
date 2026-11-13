"""Owner-PC commands through the production harness and MCP: an ordinary turn has none (R-PC-01)."""

from unittest.mock import AsyncMock

from raphael_core.agent.gate import ToolGate
from raphael_core.agent.permissions import PermissionCards
from .test_narration import chat, typed
from .test_service import make_rig  # noqa: F401


def local_hub(conn):
    from raphael_core.computer.local_tools import LocalTools
    from computer.test_vm import EmptyHub
    host = AsyncMock()
    host.execute.return_value = {"exit_code": 0, "stdout": "cpu data", "stderr": "", "truncated": False}
    return LocalTools(EmptyHub(), conn, host=host), host


async def test_an_imported_skill_script_is_not_run_by_an_ordinary_turn(make_rig, client, conn, tmp_path):
    # R-SKILL-03 / R-PC-01: a skill's script needs the local command tool, which only a quick question has.
    from raphael_core.members.capabilities import MemberCapabilities
    from raphael_core.members.store import MemberStore
    cap = MemberCapabilities(conn, tmp_path / "local/skills", MemberStore(conn))
    cap.skill_home = tmp_path / "synthetic-home"
    source = cap.skill_home / ".codex/skills/check"
    (source / "scripts").mkdir(parents=True)
    (source / "SKILL.md").write_text("---\nname: check\ndescription: Check data\n---\nUse scripts/check.py", encoding="utf-8")
    (source / "scripts/check.py").write_text("print('synthetic')", encoding="utf-8")
    skill = cap.import_local(0, "local:" + str(source.resolve()))
    command = 'python "' + str(cap._path(0, skill["id"]).parent / "scripts/check.py") + '"'
    hub, host = local_hub(conn)
    rig = make_rig(plugins=hub, gate=ToolGate(hub, conn=conn), permissions=PermissionCards(conn))
    client.chats = [chat("Checking data.", ("local__local_exec", {"command": command})), chat('{"text":"I cannot run it here."}')]
    asked = await typed(rig, "Run the imported check skill")
    assert asked["status"] == "done"
    assert "local__local_exec" not in {tool["function"]["name"] for tool in client.chat_calls[0]["tools"]}
    host.execute.assert_not_awaited()


async def test_cli_mcp_refuses_the_local_command_tool_in_an_ordinary_turn(make_rig, conn, tmp_path):
    from members.test_cli_brains import fake_mcp
    hub, host = local_hub(conn)
    rig = make_rig(plugins=hub, gate=ToolGate(hub, conn=conn), permissions=PermissionCards(conn))
    rig.settings.set("agent_model", "cli:claude")
    fake_mcp(rig, tmp_path, [("local__local_exec", {"command": "Get-Process"})], allowed=False)
    result = await typed(rig, "幫我看一下為甚麼我電腦 CPU 使用率這麼高")
    assert result["status"] == "done"
    host.execute.assert_not_awaited()


def test_driver_schema_never_offers_a_model_session():
    from raphael_core.computer.vm_catalog import without_session
    schema = {"type": "object", "properties": {"session": {"type": "string"}, "pid": {"type": "integer"}}, "required": ["session", "pid"]}
    clean = without_session(schema)
    assert "session" not in clean["properties"] and clean["required"] == ["pid"]
    assert "session" in schema["properties"]

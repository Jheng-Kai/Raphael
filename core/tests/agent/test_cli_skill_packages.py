"""Native skill mounting uses fake CLI processes and synthetic packages only."""

import json
import os
import sys
from pathlib import Path

import pytest

from raphael_core.agent.cli.drivers import Driver


@pytest.mark.parametrize("brain", ["claude", "codex"])
async def test_only_assigned_packages_enter_the_native_skill_mechanism(tmp_path, brain):
    folder = tmp_path / "assigned"
    (folder / "scripts").mkdir(parents=True)
    (folder / "SKILL.md").write_text("---\nname: assigned\ndescription: Assigned task\n---\nUse the local command tool for scripts.", encoding="utf-8")
    (folder / "scripts/task.py").write_text("print('assigned')", encoding="utf-8")
    record = tmp_path / "record.json"
    script = tmp_path / "cli.py"
    script.write_text('''import json, sys, os, tomllib
from pathlib import Path
args = sys.argv[2:]
if "--plugin-dir" in args:
    assert "CLAUDE_CONFIG_DIR" not in os.environ
    assert "CLAUDE_CODE_OAUTH_TOKEN" not in os.environ
    assert args[args.index("--setting-sources") + 1] == ""
    assert "--strict-mcp-config" in args
    assert "--disable-slash-commands" not in args
    assert args[args.index("--tools") + 1] == "Skill"
    assert json.loads(args[args.index("--settings") + 1])["disableAllHooks"]
    root = Path(args[args.index("--plugin-dir") + 1])
    assert set(json.loads((root / ".claude-plugin/plugin.json").read_text())) == {"name", "version"}
    paths = list(root.glob("skills/*/SKILL.md"))
else:
    options = dict(item.split("=", 1) for item in args[3::2])
    assert options["features.skip_host_skill_discovery"] == "true"
    assert options["features.plugins"] == "false"
    assert options["features.shell_tool"] == "false"
    assert options["skills.include_instructions"] == "true"
    paths = [Path(item["path"]) for item in tomllib.loads("v = " + options["skills.config"])["v"] if item["enabled"]]
Path(sys.argv[1]).write_text(json.dumps({"documents": [p.read_text() for p in paths],
    "scripts": [(p.parent / "scripts/task.py").read_text() for p in paths]}))
def send(value): print(json.dumps(value), flush=True)
for line in sys.stdin:
    msg = json.loads(line)
    if "--plugin-dir" in args:
        send({"type":"result", "subtype":"success", "result":"Done"})
        break
    elif msg.get("method") == "initialize": send({"id":msg["id"], "result":{}})
    elif msg.get("method") == "thread/start": send({"id":msg["id"], "result":{"thread":{"id":"synthetic"}}})
    elif msg.get("method") == "turn/start":
        native = [item for item in msg["params"]["input"] if item["type"] == "skill"]
        assert len(native) == 1 and native[0]["name"] == "assigned"
        assert Path(native[0]["path"]) == paths[0]
        send({"method":"item/completed", "params":{"item":{"type":"agentMessage", "text":"Done"}}})
        send({"method":"turn/completed", "params":{"turn":{"status":"completed"}}})
        break
''', encoding="utf-8")
    environment = {**os.environ, "CODEX_HOME": str(tmp_path / "empty-codex")}
    (tmp_path / ".claude/skills/personal").mkdir(parents=True)
    environment["HOME"] = environment["USERPROFILE"] = str(tmp_path)
    environment.pop("CLAUDE_CONFIG_DIR", None)
    environment.pop("CLAUDE_CODE_OAUTH_TOKEN", None)
    (tmp_path / "workspace").mkdir()
    driver = Driver(brain, [sys.executable, str(script), str(record)], home=tmp_path, environ=environment)
    events = [event async for event in driver.run(user="Use assigned skill", system="Use only MCP actions",
        endpoint="http://127.0.0.1:1/mcp", token="synthetic", permission=None, cwd=str(tmp_path / "workspace"),
        skills=[{"name": "assigned", "path": str(folder / "SKILL.md")}])]
    assert events[-1].kind == "final", events
    result = json.loads(record.read_text())
    assert len(result["documents"]) == 1 and "Assigned task" in result["documents"][0]
    assert result["scripts"] == ["print('assigned')"]


async def test_claude_skill_turn_does_not_set_auth_environment_or_read_credentials(tmp_path, monkeypatch):
    folder = tmp_path / "assigned"
    folder.mkdir()
    (folder / "SKILL.md").write_text("---\nname: assigned\ndescription: Assigned task\n---\nFollow the task.", encoding="utf-8")
    script = tmp_path / "claude.py"
    script.write_text('''import json, os, sys
args = sys.argv[1:]
assert "--plugin-dir" in args
assert "CLAUDE_CONFIG_DIR" not in os.environ
assert "CLAUDE_CODE_OAUTH_TOKEN" not in os.environ
assert os.environ["HOME"] == os.environ["USERPROFILE"] == os.getcwd()
for line in sys.stdin:
    print(json.dumps({"type": "result", "subtype": "success", "result": "Normal login"}), flush=True)
    break
''', encoding="utf-8")
    read_text = Path.read_text

    def refuse_credentials(path, *args, **kwargs):
        if path.name in (".credentials.json", "credentials.json"):
            pytest.fail("Claude credentials must be managed only by the CLI")
        return read_text(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", refuse_credentials)
    environment = {key: value for key, value in os.environ.items()
                   if key not in ("CLAUDE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN")}
    environment["HOME"] = environment["USERPROFILE"] = str(tmp_path)
    driver = Driver("claude", [sys.executable, str(script)], home=tmp_path, environ=environment)
    events = [event async for event in driver.run(user="Use assigned skill", system="Use only MCP actions",
        endpoint="http://127.0.0.1:1/mcp", token="synthetic", permission=None, cwd=str(tmp_path),
        skills=[{"name": "assigned", "path": str(folder / "SKILL.md")}])]
    assert events[-1].kind == "final" and events[-1].text == "Normal login", events
    assert not (tmp_path / ".raphael/claude-brains").exists()

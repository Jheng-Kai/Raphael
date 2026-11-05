"""Synthetic plugin sets and pinned GitHub downloads; no real network or home."""

import json
import os
import sys
from pathlib import Path

import httpx
import pytest

from raphael_core.brain import db
from raphael_core.agent.cli.drivers import Driver
from raphael_core.members import skill_plugins as plugins
from raphael_core.members.store import MemberError
from raphael_core.protocol import RpcError

SHA = "a" * 40


def package(version="1.0.0", *, removed=False):
    files = {
        ".claude-plugin/plugin.json": json.dumps({"name": "desk", "version": version, "description": "Desk workflows", "hooks": "./hooks/hooks.json"}).encode(),
        "skills/write/SKILL.md": b"---\nname: write\ndescription: Write carefully\n---\nRead references/check.md and scripts/task.py.",
        "skills/write/references/check.md": b"REFERENCE-DESK",
        "skills/write/scripts/task.py": b"raise AssertionError('must never run during import')",
        "commands/review.md": b"---\ndescription: Review the request\n---\nReview $ARGUMENTS",
        ".mcp.json": json.dumps({"mcpServers": {"Desk MCP": {"command": "python", "args": ["${CLAUDE_PLUGIN_ROOT}/server.py"], "env": {"TOKEN": "not-returned"}}, "Cloud MCP": {"type": "http", "url": "https://example.invalid/mcp"}}}).encode(),
        "hooks/hooks.json": b'{"hooks":{}}',
        "agents/ignored.md": b"Never loaded",
    }
    if not removed:
        files["skills/check/SKILL.md"] = b"---\nname: check\ndescription: Check work\n---\nCheck the result."
    return files


def local(cap, tmp_path, version="1.0.0", **kwargs):
    cap.skill_home = tmp_path / "synthetic-home"
    folder = cap.skill_home / f".claude/plugins/cache/market/desk/{version}"
    for key, data in package(version, **kwargs).items():
        path = folder / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return folder


async def test_local_plugin_is_one_set_with_individual_imports_and_all_member_access(rig, tmp_path):
    cap = rig.service.capabilities
    folder = local(cap, tmp_path)
    result = await rig.call("members.skills.list", {"member_id": 0, "discover": True})
    [source] = result["sources"]
    assert source["kind"] == "plugin" and source["version"] == "1.0.0" and source["skill_count"] == 2
    assert len(source["skills"]) == 2
    standalone = cap.import_local(0, source["skills"][0]["source"])
    assert not standalone.get("set_id")
    installed = await rig.call("members.skills.import", {"member_id": 0, "shared": True, "plugin": True, "source": source["source"]})
    assert installed["set"]["skill_count"] == 2 and installed["set"]["command_count"] == 1
    member = (await rig.call("members.create", {"name": "Ada"}))["member"]["id"]
    for identifier in (0, member):
        shared = [s for s in cap.skills(identifier) if s.get("set_id")]
        assert len(shared) == 3 and all(s["shared"] for s in shared)
        write = next(s for s in shared if s["name"] == "write")
        assert "REFERENCE-DESK" in cap.read_skill(identifier, write["slash_name"])
        assert (cap._path(identifier, write["id"]).parent / "scripts/task.py").read_bytes() == package()["skills/write/scripts/task.py"]
        review = next(s for s in shared if s["name"] == "review")
        assert "Review the plan" in cap.expand(identifier, "/" + review["slash_name"] + " the plan")
        assert all(Path(s["path"]).exists() for s in cap.native_skills(identifier))
    assert folder.exists()
    servers = installed["set"]["mcp_servers"]
    assert len(servers) == 2 and servers[0]["env"] == ["TOKEN"] and "not-returned" not in json.dumps(servers)
    assert "${CLAUDE_PLUGIN_ROOT}" not in json.dumps(servers)
    assert not rig.conn.execute("SELECT 1 FROM connection_proposals").fetchone()


async def test_set_reimport_preserves_skill_ids_and_grants_and_removal_cascades(rig, tmp_path):
    cap = rig.service.capabilities
    folder = local(cap, tmp_path)
    first = await cap.import_plugin("local:" + str(folder))
    old = {s["name"]: s for s in cap.skills(0)}
    cap.update_skill(0, old["write"]["id"], False)
    cap.update_skill(0, old["check"]["id"], False)
    new_folder = local(cap, tmp_path, "2.0.0", removed=True)
    assert cap.plugin_sets()[0]["source_changed"] is True
    second = await cap.import_plugin(set_id=first["id"])
    assert second["id"] == first["id"] and second["version"] == "2.0.0" and second["source"] == "local:" + str(new_folder)
    current = {s["name"]: s for s in cap.skills(0)}
    assert current["write"]["id"] == old["write"]["id"] and current["write"]["enabled"] is False
    assert "check" not in current
    assert rig.conn.execute("SELECT COUNT(*) FROM member_skill_grants").fetchone()[0] == 1
    with pytest.raises(MemberError, match="plugin set"):
        cap.delete_skill(-1, old["write"]["id"])
    with pytest.raises(RpcError):
        await rig.call("members.skills.delete", {"member_id": 0, "set_id": first["id"]})
    await rig.call("members.skills.delete", {"member_id": 0, "shared": True, "set_id": first["id"]})
    assert cap.skills(0) == [] and cap.plugin_sets() == []
    assert rig.conn.execute("SELECT COUNT(*) FROM member_skill_grants").fetchone()[0] == 0


async def test_invalid_set_update_leaves_existing_documents_and_grants(rig, tmp_path):
    cap = rig.service.capabilities
    folder = local(cap, tmp_path)
    first = await cap.import_plugin("local:" + str(folder))
    before = cap.skills(0)
    cap.update_skill(0, before[0]["id"], False)
    changed = package("2.0.0")
    changed["skills/check/SKILL.md"] = b"invalid"
    with pytest.raises(MemberError):
        cap.install_set("local:" + str(folder.parent / "2.0.0"), changed)
    assert cap.plugin_sets()[0]["version"] == first["version"]
    assert cap.skills(0)[0]["enabled"] is False
    assert len(cap.skills(0)) == len(before)


def fake_github(monkeypatch, manifest=None, files=None, *, mode=None, truncated=False):
    files = files or package()
    manifest = manifest or {"name": "synthetic-market", "plugins": [{"name": "desk", "source": "./plugins/desk", "description": "Desk workflows"}, {"name": "npm-only", "version": "1.0.0", "source": {"source": "npm", "package": "desk"}}]}
    requests = []
    def handle(request):
        requests.append(str(request.url))
        path = request.url.path
        if "/commits/" in path:
            return httpx.Response(200, json={"sha": SHA})
        if path.endswith("/.claude-plugin/marketplace.json"):
            return httpx.Response(200, json=manifest)
        if "/git/trees/" in path:
            tree = [{"path": "plugins/desk/" + key, "type": "blob", "mode": mode or "100644", "size": len(value)} for key, value in files.items()]
            return httpx.Response(200, json={"tree": tree, "truncated": truncated})
        for key, value in files.items():
            if path.endswith("/plugins/desk/" + key):
                return httpx.Response(200, content=value)
        return httpx.Response(404)
    original = httpx.AsyncClient
    monkeypatch.setattr(plugins.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs))
    return requests, manifest


async def test_marketplace_installs_pinned_folder_and_offers_newer_version(rig, monkeypatch):
    cap = rig.service.capabilities
    files = package()
    requests, _ = fake_github(monkeypatch, files=files)
    listed = (await rig.call("members.skills.list", {"member_id": 0, "marketplace": "owner/repo"}))["marketplace"]
    assert listed["plugins"][0]["version"] == "1.0.0"
    assert listed["plugins"][1]["installable"] is False and listed["plugins"][1]["reason"]
    result = await rig.call("members.skills.import", {"member_id": 0, "shared": True, "marketplace": "owner/repo", "name": "desk"})
    assert result["set"]["version"] == "1.0.0"
    assert all(SHA in url for url in requests if "raw.githubusercontent.com" in url)
    before = cap.skills(0)[0]
    cap.update_skill(0, before["id"], False)
    files.update(package("2.0.0"))
    updated = await rig.call("members.skills.list", {"member_id": 0, "marketplace": "owner/repo"})
    assert updated["sets"][0]["source_changed"] is True
    again = await rig.call("members.skills.import", {"member_id": 0, "shared": True, "set_id": result["set"]["id"]})
    assert again["set"]["version"] == "2.0.0"
    assert cap.skills(0)[0]["id"] == before["id"] and cap.skills(0)[0]["enabled"] is False
    assert cap.plugin_sets()[0]["source_changed"] is False


@pytest.mark.parametrize("mode,truncated", [("120000", False), ("160000", False), (None, True)])
async def test_remote_links_and_incomplete_trees_are_refused_before_install(rig, monkeypatch, mode, truncated):
    fake_github(monkeypatch, mode=mode, truncated=truncated)
    with pytest.raises(MemberError):
        await rig.service.capabilities.import_plugin(marketplace="owner/repo", name="desk")
    assert rig.service.capabilities.plugin_sets() == [] and rig.service.capabilities.skills(0) == []


@pytest.mark.parametrize("path", ["../escape", "a/../../escape", "C:/escape", "a\\escape", "/absolute", "a/NUL.txt", "a/trailing."])
def test_plugin_paths_reject_traversal_and_windows_aliases(path):
    with pytest.raises(MemberError):
        plugins.relative_path(path)


@pytest.mark.parametrize("source", ["https://elsewhere.invalid/plugin", {"source":"url","url":"http://github.com/owner/repo"}, {"source":"git-subdir","url":"https://elsewhere.invalid/repo","path":"plugins/desk"}, {"source":"git-subdir","url":"https://github.com/owner/repo"}, {"source":"command","command":"never-run"}, {"source":"npm","package":"desk"}])
def test_non_github_and_executable_sources_have_an_explicit_refusal(source):
    with pytest.raises(MemberError):
        plugins.source_target(source, "owner/repo", SHA)


async def test_copy_failure_and_same_version_file_changes_preserve_the_existing_set(rig, tmp_path, monkeypatch):
    cap = rig.service.capabilities
    folder = local(cap, tmp_path)
    installed = await cap.import_plugin("local:" + str(folder))
    before = cap.skills(0)
    path = cap._path(0, before[0]["id"])
    content = path.read_bytes()
    (folder / "skills/write/scripts/task.py").write_bytes(b"changed without a version bump")
    assert cap.plugin_sets()[0]["source_changed"] is True
    root = cap.plugin_root(installed["id"]).parent
    generations = set(root.iterdir())
    def fail(*_):
        raise OSError("synthetic copy failure")
    monkeypatch.setattr(plugins, "atomic", fail)
    with pytest.raises(OSError, match="synthetic copy failure"):
        await cap.import_plugin(set_id=installed["id"])
    assert cap.skills(0) == before and path.read_bytes() == content
    assert set(root.iterdir()) == generations


async def test_download_bounds_and_listed_version_mismatch_are_fail_closed(rig, monkeypatch):
    manifest = {"name": "market", "plugins": [{"name": "desk", "source": "./plugins/desk", "version": "9.0.0"}]}
    fake_github(monkeypatch, manifest=manifest)
    data = await plugins.catalog("owner/repo")
    assert not data["plugins"][0]["installable"]
    assert "version differs" in data["plugins"][0]["reason"]
    monkeypatch.setattr(plugins, "MAX_PACKAGE_BYTES", 4)
    with pytest.raises(MemberError, match="too large"):
        await plugins.download_plugin({"repo": "owner/repo", "commit": SHA, "path": "plugins/desk"})
    assert rig.service.capabilities.plugin_sets() == []


def test_migration_62_keeps_rooms_and_existing_shared_grants(monkeypatch, tmp_path):
    path = tmp_path / "migration.db"
    with monkeypatch.context() as old:
        old.setattr(db, "LATEST_VERSION", 61)
        conn = db.connect(path)
    with conn:
        conn.execute("INSERT INTO member_skills(member_id,name,description,source) VALUES (-1,'kept','Kept','owner')")
        identifier = conn.execute("SELECT id FROM member_skills").fetchone()[0]
        conn.execute("INSERT INTO member_skill_grants VALUES (0,?,0)", (identifier,))
    conn.close()
    with monkeypatch.context() as migration:
        migration.setattr(db, "LATEST_VERSION", 62)
        reopened = db.connect(path)
    assert reopened.execute("PRAGMA user_version").fetchone()[0] == 62
    assert tuple(reopened.execute("SELECT member_id,skill_id,enabled FROM member_skill_grants").fetchone()) == (0, identifier, 0)
    assert reopened.execute("SELECT name FROM sqlite_master WHERE name='room_exchange_turns'").fetchone()
    assert reopened.execute("SELECT name FROM sqlite_master WHERE name='skill_sets'").fetchone()
    assert reopened.execute("SELECT name FROM sqlite_master WHERE name='skill_marketplaces'").fetchone()
    steps = []
    reopened.set_trace_callback(lambda sql: steps.append(int(sql.strip().rstrip(';').split('=')[1]))
                                if sql.strip().startswith('PRAGMA user_version =') else None)
    db.migrate(reopened)
    assert steps == list(range(63, db.LATEST_VERSION + 1))
    assert reopened.execute("PRAGMA user_version").fetchone()[0] == db.LATEST_VERSION
    assert tuple(reopened.execute("SELECT member_id,skill_id,enabled FROM member_skill_grants").fetchone()) == (0, identifier, 0)
    assert reopened.execute("SELECT name FROM sqlite_master WHERE name='room_exchange_turns'").fetchone()
    assert reopened.execute("SELECT name FROM sqlite_master WHERE name='vault_entries'").fetchone()
    assert reopened.execute("SELECT name FROM sqlite_master WHERE name='message_reactions'").fetchone()
    db.migrate(reopened)
    assert steps == list(range(63, db.LATEST_VERSION + 1))
    reopened.close()


@pytest.mark.parametrize("brain", ["claude", "codex"])
async def test_plugin_skills_and_commands_use_native_delivery_without_plugin_hooks(rig, tmp_path, brain):
    cap = rig.service.capabilities
    folder = local(cap, tmp_path)
    command = folder / "commands/review.md"
    command.write_bytes(command.read_bytes() + b"\n!`must-not-run`\nRead ${CLAUDE_PLUGIN_ROOT}/assets/check.txt")
    installed = await cap.import_plugin("local:" + str(folder))
    check = next(s for s in cap.skills(0) if s["name"] == "check")
    cap.update_skill(0, check["id"], False)
    script = tmp_path / "fake-cli.py"
    record = tmp_path / "native.json"
    script.write_text('''import json, sys
from pathlib import Path
args = sys.argv[2:]
if '--plugin-dir' in args:
    root = Path(args[args.index('--plugin-dir') + 1])
    assert not (root / 'hooks').exists() and not (root / 'agents').exists()
    assert json.loads(args[args.index('--settings') + 1])['disableAllHooks']
    paths = list(root.glob('skills/*/SKILL.md'))
else:
    options = dict(item.split('=', 1) for item in args[3::2])
    assert options['features.plugins'] == 'false'
    assert options['features.shell_tool'] == 'false'
    paths = [Path(item['path']) for item in json.loads(options['skills.config']) if item['enabled']]
texts = [path.read_text(encoding='utf-8') for path in paths]
assert len(texts) == 2 and any('name: write' in text for text in texts)
review = next(text for text in texts if 'name: "review"' in text)
assert '\\\\!`must-not-run`' in review and '${CLAUDE_PLUGIN_ROOT}' not in review
assert any((path.parent / 'scripts/task.py').exists() for path in paths)
Path(sys.argv[1]).write_text(json.dumps(texts), encoding='utf-8')
def send(value): print(json.dumps(value), flush=True)
for line in sys.stdin:
    msg = json.loads(line)
    if '--plugin-dir' in args:
        send({'type':'result','subtype':'success','result':'Done'}); break
    if msg.get('method') == 'initialize': send({'id':msg['id'],'result':{}})
    elif msg.get('method') == 'thread/start': send({'id':msg['id'],'result':{'thread':{'id':'synthetic'}}})
    elif msg.get('method') == 'turn/start':
        assert len([x for x in msg['params']['input'] if x['type']=='skill']) == 2
        send({'method':'item/completed','params':{'item':{'type':'agentMessage','text':'Done'}}})
        send({'method':'turn/completed','params':{'turn':{'status':'completed'}}}); break
''', encoding="utf-8")
    environment = {**os.environ, "HOME": str(tmp_path), "USERPROFILE": str(tmp_path), "CODEX_HOME": str(tmp_path / "codex-home")}
    environment.pop("CLAUDE_CONFIG_DIR", None)
    environment.pop("CLAUDE_CODE_OAUTH_TOKEN", None)
    driver = Driver(brain, [sys.executable, str(script), str(record)], home=tmp_path, environ=environment)
    events = [event async for event in driver.run(user="Review the plan", system="Use approved MCP actions only", endpoint="http://127.0.0.1:1/mcp", token="synthetic", permission=None, cwd=str(tmp_path), skills=cap.native_skills(0))]
    assert events[-1].kind == "final", events
    assert len(json.loads(record.read_text(encoding="utf-8"))) == 2
    assert cap.plugin_sets()[0]["id"] == installed["id"]

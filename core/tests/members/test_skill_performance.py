"""Owner-sized skill discovery and install responsiveness."""

import asyncio
from pathlib import Path
from statistics import median
from threading import Event
from time import perf_counter

import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.agent.team import roster_prompt
from raphael_core.members import skill_packages, skill_plugins
from raphael_core.protocol import RpcError

from .test_skill_library import installed


def test_owner_sized_roster_uses_no_skill_files(rig, monkeypatch):
    service = rig.service
    speakers = [service.speaker(service.store.create_member(name=f"Reader {i}", role="Research").id)
                for i in range(60)]
    homes = service.capabilities.homes
    root = homes.home(-1) / "skill-sets" / "pstack"
    journal = homes.state(-1) / "journal" / "20261122T100000000000-fixture.json"
    journal.parent.mkdir(parents=True)
    journal.write_text('{"path":"MEMORY.md","applied":true}', encoding="utf-8")
    with rig.conn:
        plugin = rig.conn.execute(
            "INSERT INTO skill_sets(name,version,source,description,folder,metadata,identity) VALUES(?,?,?,?,?,?,?)",
            ("pstack", "1.0.0", "github:example/pstack", "Research", "skill-sets/pstack", "{}", "pstack"),
        ).lastrowid
        rig.conn.execute("UPDATE skill_packages SET access=? WHERE key=?", ('"all"', f"set:{plugin}"))
        for i in range(58):
            name = f"skill-{i}"
            path = root / name / "SKILL.md"
            path.parent.mkdir(parents=True)
            path.write_text(f"---\nname: {name}\ndescription: Guide {i}\n---\nInstructions", encoding="utf-8")
            rig.conn.execute(
                "INSERT INTO member_skills(member_id,name,description,source,set_id,set_key,set_kind) VALUES(-1,?,?,?,?,?,'skill')",
                (f"pstack:{name}", f"Guide {i}", "plugin:pstack", plugin, name),
            )
    file_calls = []
    original = homes.safe

    def safe(path: Path):
        file_calls.append(path)
        return original(path)

    monkeypatch.setattr(homes, "safe", safe)
    statements = []
    timings = []
    warm_reads = []
    rig.conn.set_trace_callback(statements.append)
    try:
        for _ in range(3):
            statements.clear()
            began = perf_counter()
            for speaker in speakers:
                prompt = roster_prompt(service, speaker, "en")
                assert '"description": "Guide 57"' in prompt
            timings.append((perf_counter() - began) * 1000)
            warm_reads.append(sum("JOIN skill_packages p ON" in sql for sql in statements))
    finally:
        rig.conn.set_trace_callback(None)
    print(f"ROSTER_COST members=60 plugin_skills=58 ms={[round(ms, 2) for ms in timings]} "
          f"median_ms={median(timings):.2f} safe_calls={len(file_calls)}")
    assert len(file_calls) == 0
    assert warm_reads == [60, 0, 0]
    assert median(timings) < 1000


async def test_member_viewing_and_unread_changes_do_not_open_skill_paths(rig, monkeypatch):
    member = (await rig.call("members.create", {"name": "Reader"}))["member"]["id"]
    history = AgentHistory(rig.conn)
    turn = history.add(session_id="test", question="Read?", route="chat", prefix="", text="Done",
                       status="done", member_id=member)

    def unexpected_path(path):
        pytest.fail(f"a read marker tried to open a member's file: {path}")

    monkeypatch.setattr(rig.service.capabilities.homes, "safe", unexpected_path)
    rig.service.turn_arrived(turn)
    assert member in rig.service.store.unread_from()
    await rig.call("members.viewing", {"id": member})
    assert member not in rig.service.store.unread_from()
    await rig.call("members.unread", {"id": member})
    await rig.call("members.read", {"id": member})
    assert member not in rig.service.store.unread_from()


async def test_cached_skill_names_follow_all_skill_and_package_writes(rig, tmp_path):
    service = rig.service
    cap = service.capabilities
    member = service.store.create_member(name="Reader", role="Research").id
    other = service.store.create_member(name="Writer", role="Research").id
    document = "---\nname: notes\ndescription: Review notes\n---\nSteps"

    def names(who=0):
        return {item["slash_name"]: item["description"] for item in service.enabled_skill_summaries(who)}

    assert names() == names(member) == {}
    own = cap.keep_skill(0, "owner", document)
    assert names() == {"notes": "Review notes"}
    cap.rewrite_skill(0, own["id"], document.replace("Review notes", "New description"))
    assert names() == {"notes": "New description"}
    cap.update_skill(0, own["id"], False)
    assert names() == {}
    cap.update_skill(0, own["id"], True)
    command = cap.save_command(0, None, "notes", "Template", "Review {input}")
    assert names() == {"skill:notes": "New description"}
    cap.delete_command(0, command["id"])
    assert names() == {"notes": "New description"}
    cap.delete_skill(0, own["id"])
    assert names() == {}

    package = (await rig.call("skills.library.import", {"text": document, "access": [other]}))["package"]
    key = package["key"]
    assert names(other) == {"notes": "Review notes"} and names(member) == {}
    cap.copy_package_access(other, member)
    assert names(member) == names(other)
    await rig.call("skills.library.update", {"key": key, "access": [member]})
    assert names(other) == {} and names(member) == {"notes": "Review notes"}
    await rig.call("skills.library.update", {"key": key, "skill": {"id": package["skills"][0]["id"], "enabled": False}})
    assert names(member) == {}
    await rig.call("skills.library.update", {"key": key, "skill": {"id": package["skills"][0]["id"], "enabled": True}})
    assert names(member) == {"notes": "Review notes"}
    await rig.call("skills.library.update", {"key": key, "enabled": False})
    assert names(member) == {}
    await rig.call("skills.library.update", {"key": key, "enabled": True})
    assert names(member) == {"notes": "Review notes"}
    await rig.call("skills.library.delete", {"key": key})
    assert names(member) == {}

    source = "local:" + str(tmp_path / "fixture" / "1.0.0")
    files = {".claude-plugin/plugin.json": b'{"name":"fixture","version":"1.0.0"}',
             "skills/notes/SKILL.md": document.encode()}
    plugin = cap.install_set(source, files, access=[member])
    assert names(member) == {"notes": "Review notes"}
    files["skills/notes/SKILL.md"] = document.replace("Review notes", "Plugin update").encode()
    cap.install_set(source, files, expected_id=plugin["id"])
    assert names(member) == {"notes": "Plugin update"}
    cap.delete_set(plugin["id"])
    assert names(member) == {}


@pytest.mark.parametrize("kind", ["plugin-refresh", "package-import", "private-folder"])
async def test_install_writer_leaves_unrelated_rpc_under_100ms(rig, tmp_path, monkeypatch, kind):
    cap = rig.service.capabilities
    cap.skill_home = tmp_path / "cli"
    if kind == "plugin-refresh":
        folder = installed(cap.skill_home, ".claude/plugins/cache/market/fixture/1.0.0/skills/writing").parents[1]
        manifest = folder / ".claude-plugin/plugin.json"
        manifest.parent.mkdir()
        manifest.write_text('{"name":"fixture","version":"1.0.0"}', encoding="utf-8")
        package = (await rig.call("skills.library.import", {"plugin": True, "source": f"local:{folder}"}))["package"]
        method, params = "skills.library.update", {"key": package["key"], "refresh": True}
        writer = skill_plugins
    elif kind == "private-folder":
        folder = installed(cap.skill_home)
        method, params = "members.skills.import", {"member_id": 0, "source": f"local:{folder}"}
        writer = skill_packages
    else:
        method, params = "skills.library.import", {"text": "---\nname: notes\ndescription: Read notes\n---\nSteps"}
        writer = skill_packages

    loop = asyncio.get_running_loop()
    entered, release = asyncio.Event(), Event()
    atomic = writer.atomic

    def slow_write(path, data):
        loop.call_soon_threadsafe(entered.set)
        assert release.wait(2), "the event loop did not resume while the writer was open"
        atomic(path, data)

    monkeypatch.setattr(writer, "atomic", slow_write)
    install = asyncio.create_task(rig.call(method, params))
    try:
        await asyncio.wait_for(entered.wait(), 3)
        began = perf_counter()
        assert "members" in await asyncio.wait_for(rig.call("members.list"), 0.1)
        elapsed = (perf_counter() - began) * 1000
        print(f"INSTALL_RPC kind={kind} ms={elapsed:.2f}")
        assert elapsed < 100 and not install.done()
    finally:
        release.set()
        await install


async def test_refresh_rechecks_package_after_worker_writes(rig, tmp_path, monkeypatch):
    cap = rig.service.capabilities
    cap.skill_home = tmp_path / "cli"
    folder = installed(cap.skill_home, ".claude/plugins/cache/market/fixture/1.0.0/skills/writing").parents[1]
    manifest = folder / ".claude-plugin/plugin.json"
    manifest.parent.mkdir()
    manifest.write_text('{"name":"fixture","version":"1.0.0"}', encoding="utf-8")
    package = (await rig.call("skills.library.import", {"plugin": True, "source": f"local:{folder}"}))["package"]
    key = package["key"]
    root = cap.homes.home(-1) / "skills"
    original = set(root.iterdir())
    loop = asyncio.get_running_loop()
    entered, release = asyncio.Event(), Event()
    write = cap._write_set

    def stage(plan):
        staged = write(plan)
        loop.call_soon_threadsafe(entered.set)
        assert release.wait(2)
        return staged

    monkeypatch.setattr(cap, "_write_set", stage)
    refresh = asyncio.create_task(rig.call("skills.library.update", {"key": key, "refresh": True, "access": "all"}))
    try:
        await asyncio.wait_for(entered.wait(), 3)
        await rig.call("skills.library.update", {"key": key, "access": []})
    finally:
        release.set()
    with pytest.raises(RpcError, match="changed during refresh"):
        await refresh
    assert set(root.iterdir()) == original
    assert cap.read_skill(0, "writing") is None

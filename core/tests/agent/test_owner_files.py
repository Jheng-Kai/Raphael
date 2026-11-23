"""R-PC-04 and R-PC-05: members read the owner's whole computer from every turn and task, and write only in the folders
the owner chose.

The files are real ones in the test's folder (the owner's home is moved
there); the brain is a fake.
"""

import os
from types import SimpleNamespace

import pytest

from raphael_core.agent.cli.loop import CliLoop
from raphael_core.agent.gate import ToolGate
from raphael_core.agent.permissions import PermissionCards
from raphael_core.agent.policy import Tier
from raphael_core.agent.speaker import RAPHAEL
from raphael_core.background.snapshot import take_snapshot
from raphael_core.brain.settings import SettingsStore
from raphael_core.computer import owner_files
from raphael_core.computer.local_tools import _CONTEXT
from raphael_core.worker.loop import Outcome
from .test_local_commands import local_hub
from .test_narration import chat, typed
from .test_owner_pc_reach import MODES, PC_TOOLS, names
from .test_service import make_rig  # noqa: F401

READS = {"owner_files__read_file", "owner_files__glob", "owner_files__grep"}
WRITES = {"owner_files__write_file", "owner_files__edit_file"}


@pytest.fixture
def home(tmp_path, monkeypatch):
    home = tmp_path / "home"
    (home / "Documents" / "notes").mkdir(parents=True)
    (home / "Documents" / "notes" / "plan.md").write_text("# Plan\nship the Mac build\nthen rest\n", encoding="utf-8")
    (home / "Documents" / "budget.csv").write_text("item,cost\nrent,100\n", encoding="utf-8")
    (home / "project" / "node_modules" / "x").mkdir(parents=True)
    (home / "project" / "node_modules" / "x" / "plan.md").write_text("ship it\n", encoding="utf-8")
    (home / ".ssh").mkdir()
    (home / ".ssh" / "id_ed25519").write_text("PRIVATE KEY ship\n", encoding="utf-8")
    (home / "project" / ".env").write_text("TOKEN=ship\n", encoding="utf-8")
    (home / "project" / ".env.example").write_text("TOKEN=\n", encoding="utf-8")
    monkeypatch.setattr(owner_files, "_home", lambda: home)
    return home


@pytest.fixture
def files(conn):
    hub, _ = local_hub(conn)
    token = _CONTEXT.set((("chat", 0, 1), False, True, "session", False, 0))  # an ordinary turn: the owner's screen out of reach
    yield hub
    _CONTEXT.reset(token)


async def call(hub, name, arguments, approver="auto"):
    return await hub.call(f"mcp:owner_files/{name}", arguments, approver=approver)


# --- the lists -----------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("mode", MODES)
def test_every_turn_and_task_lists_the_reads_and_nothing_of_the_owners_screen(conn, mode):
    SettingsStore(conn).set("action_mode", mode)
    hub, _ = local_hub(conn)
    for kind in ({"interactive": True}, {"interactive": False}, {"routine": True, "background_management": True}):
        snapshot = take_snapshot(hub, speaker=RAPHAEL, memory=True, max_tier=Tier.T3, **kind)
        listed = set(snapshot.catalog())
        assert READS | WRITES <= listed, kind
        assert not listed & PC_TOOLS  # the hidden commands are listed too (R-PC-02); the screen is a quick question's


def test_reads_ask_nothing_and_a_write_asks_only_inside_the_owners_folders(conn, home, files):
    settings = SettingsStore(conn)
    settings.set("project_folders", [str(home / "Documents")])
    assert files.tier_for_call("mcp:owner_files/read_file", {"path": "~/.ssh/id_ed25519"}) == Tier.T0
    assert files.tier_for_call("mcp:owner_files/write_file", {"path": "~/Documents/a.md", "content": "x"}) == Tier.T2
    # Outside the folders a write is refused when called, so nothing asks the owner for it.
    assert files.tier_for_call("mcp:owner_files/write_file", {"path": "~/Desktop/a.md", "content": "x"}) == Tier.T0
    assert files.kind_of("owner_files", "grep") == "read" and files.kind_of("owner_files", "edit_file") == "write"


# --- reading ---------------------------------------------------------------------------------------------------------


async def test_a_file_anywhere_is_read_in_numbered_lines(home, files):
    result = await call(files, "read_file", {"path": "~/Documents/notes/plan.md"})
    assert result.ok and "     2\tship the Mac build" in result.text
    absolute = await call(files, "read_file", {"path": str(home / "Documents" / "budget.csv")})
    assert absolute.ok and "rent,100" in absolute.text
    missing = await call(files, "read_file", {"path": "~/Documents/notes/plna.md"})
    assert not missing.ok and missing.kind == "file_missing" and "plan.md" in missing.text


@pytest.mark.parametrize("path", ["~/.ssh/id_ed25519", "~/project/.env", "~/.ssh"])
async def test_places_of_keys_and_passwords_are_kept_from_every_read(home, files, path):
    for name, arguments in (("read_file", {"path": path}), ("glob", {"pattern": "*", "path": path}),
                            ("grep", {"pattern": "ship", "path": path})):
        result = await call(files, name, arguments)
        assert not result.ok and result.kind == "kept", (name, path)
        assert "PRIVATE" not in result.text and "TOKEN" not in result.text


async def test_a_link_to_a_kept_place_is_kept_too(home, files):
    (home / "Documents" / "innocent.txt").symlink_to(home / ".ssh" / "id_ed25519")
    result = await call(files, "read_file", {"path": "~/Documents/innocent.txt"})
    assert not result.ok and result.kind == "kept"


def _link_folder(link, target):
    """A folder link as a person makes one without special rights: a junction on Windows, a symbolic link elsewhere."""
    if os.name == "nt":
        import _winapi
        _winapi.CreateJunction(str(target), str(link))
    else:
        os.symlink(target, link, target_is_directory=True)


async def test_a_search_judges_a_linked_folder_where_it_leads(home, files):
    # The walk descends into a Windows junction, so a folder link inside a searched folder is judged by its target. The
    # file in the kept place has an ordinary name, so only where it stands keeps it.
    (home / ".ssh" / "config").write_text("Host PRIVATE\n", encoding="utf-8")
    _link_folder(home / "Documents" / "shortcut", home / ".ssh")
    matched = await call(files, "grep", {"pattern": "PRIVATE", "path": "~/Documents", "output_mode": "content"})
    assert "PRIVATE" not in matched.text
    listed = await call(files, "glob", {"pattern": "**/*", "path": "~/Documents"})
    assert "config" not in listed.text and "plan.md" in listed.text


async def test_a_search_judges_a_linked_file_where_it_leads(home, files):
    try:
        (home / "Documents" / "readme.txt").symlink_to(home / ".ssh" / "id_ed25519")
    except OSError:
        pytest.skip("this account may not make file links")
    matched = await call(files, "grep", {"pattern": "PRIVATE", "path": "~/Documents", "output_mode": "content"})
    assert "PRIVATE" not in matched.text
    listed = await call(files, "glob", {"pattern": "*.txt", "path": "~/Documents"})
    assert "readme.txt" not in listed.text


@pytest.fixture
def linked_home(tmp_path, monkeypatch):
    """The owner's home reached through a folder link, as a home moved to another drive is: `_home` gives the link, and
    every path a tool resolves lands in the folder it leads to."""
    real = tmp_path / "real-home"
    (real / ".ssh").mkdir(parents=True)
    (real / ".ssh" / "config").write_text("Host PRIVATE\n", encoding="utf-8")
    (real / "Documents").mkdir()
    (real / "Documents" / "plan.md").write_text("ship\n", encoding="utf-8")
    home = tmp_path / "home"
    _link_folder(home, real)
    monkeypatch.setattr(owner_files, "_home", lambda: home)
    return home


async def test_a_home_reached_through_a_link_keeps_its_places_of_keys(conn, linked_home, files):
    # The file has an ordinary name, so only where it stands keeps it.
    for name, arguments in (("read_file", {"path": "~/.ssh/config"}), ("glob", {"pattern": "*", "path": "~/.ssh"}),
                            ("grep", {"pattern": "PRIVATE", "path": "~/.ssh"})):
        result = await call(files, name, arguments)
        assert not result.ok and result.kind == "kept", name
    matched = await call(files, "grep", {"pattern": "PRIVATE|ship", "output_mode": "content"})
    assert "plan.md" in matched.text and "PRIVATE" not in matched.text
    SettingsStore(conn).set("project_folders", [str(linked_home)])
    written = await call(files, "write_file", {"path": "~/.ssh/config", "content": "Host leak\n"})
    assert not written.ok and written.kind == "not_writable"


async def test_a_place_of_keys_reached_through_a_link_is_kept_as_asked_and_where_it_leads(home, files, tmp_path):
    keys = tmp_path / "keys"
    keys.mkdir()
    (keys / "config").write_text("Host PRIVATE\n", encoding="utf-8")
    (home / ".ssh" / "id_ed25519").unlink()
    (home / ".ssh").rmdir()
    _link_folder(home / ".ssh", keys)
    result = await call(files, "read_file", {"path": "~/.ssh/config"})
    assert not result.ok and result.kind == "kept"
    found = await call(files, "grep", {"pattern": "PRIVATE", "path": "~/.ssh"})
    assert not found.ok and found.kind == "kept"


def test_a_walk_keeps_raphaels_own_data_behind_a_link(home, tmp_path):
    data = tmp_path / "raphael-data"
    data.mkdir()
    (data / "raphael.db").write_text("ship\n", encoding="utf-8")
    try:
        (home / "Documents" / "copy.db").symlink_to(data / "raphael.db")
    except OSError:
        pytest.skip("this account may not make file links")
    # As the data floor does, the guard answers for the path it is given: the walk must give it the place a link leads to.
    protected = lambda path: owner_files._under(path, os.path.realpath(data))  # noqa: E731
    walked = list(owner_files.Walk(os.path.realpath(home / "Documents"), protected, home=home).files())
    assert walked and not [path for path in walked if path.endswith("copy.db")]


async def test_an_example_env_file_is_no_secret(home, files):
    result = await call(files, "read_file", {"path": "~/project/.env.example"})
    assert result.ok and "TOKEN=" in result.text


async def test_glob_and_grep_walk_the_home_but_not_packages_or_kept_places(home, files):
    found = await call(files, "glob", {"pattern": "*.md"})
    assert found.ok and str(home / "Documents" / "notes" / "plan.md").replace("\\", "/") in found.text.replace("\\", "/")
    assert "node_modules" not in found.text
    matched = await call(files, "grep", {"pattern": "ship"})
    assert matched.ok and "Found 1 file" in matched.text and "plan.md" in matched.text
    assert ".ssh" not in matched.text and ".env" not in matched.text and "node_modules" not in matched.text
    content = await call(files, "grep", {"pattern": "^ship", "output_mode": "content", "after": 1})
    assert ":2:ship the Mac build" in content.text and "-3-then rest" in content.text
    counted = await call(files, "grep", {"pattern": "e", "output_mode": "count", "glob": "*.csv"})
    assert "budget.csv:" in counted.text and "plan.md" not in counted.text
    # A package's folder is searched when the search starts inside it.
    inside = await call(files, "grep", {"pattern": "ship", "path": "~/project/node_modules"})
    assert "Found 1 file" in inside.text
    bad = await call(files, "grep", {"pattern": "("})
    assert not bad.ok and bad.kind == "bad_pattern"


async def test_a_search_for_raphaels_database_by_name_is_made_and_finds_none_of_its_data(conn, home, files, monkeypatch):
    # Through the gate: the data floor reads a search's path as its place, never its pattern.
    data = home / "Raphael Data"
    data.mkdir()
    (data / "raphael.db").write_text("raphael.db SECRET ROW\n", encoding="utf-8")
    monkeypatch.setenv("RAPHAEL_DATA_DIR", str(data))
    (home / "Documents" / "setup.md").write_text("The app keeps raphael.db in its data folder.\n", encoding="utf-8")
    gate = ToolGate(files, conn=conn)
    found = await gate.call_plugin("mcp:owner_files/grep", {"pattern": "raphael.db", "path": "~", "output_mode": "content"})
    assert found.ok and "setup.md" in found.text and "SECRET" not in found.text
    named = await gate.call_plugin("mcp:owner_files/glob", {"pattern": "**/raphael.db", "path": "~"})
    assert named.ok and "No files found" in named.text
    # Where Raphael's data is the place asked for, it is refused as before: a read waits for the owner's consent, a search
    # is refused.
    read = await gate.call_plugin("mcp:owner_files/read_file", {"path": str(data / "raphael.db")})
    assert not read.ok and read.kind == "approval_required" and "SECRET" not in read.text
    searched = await gate.call_plugin("mcp:owner_files/grep", {"pattern": "SECRET", "path": str(data)})
    assert not searched.ok and searched.kind == "protected_data"


# --- writing ---------------------------------------------------------------------------------------------------------


async def test_writing_is_only_inside_the_owners_folders(conn, home, files):
    settings = SettingsStore(conn)
    refused = await call(files, "write_file", {"path": "~/Documents/new.md", "content": "hello"})
    assert not refused.ok and refused.kind == "not_writable"
    settings.set("project_folders", [str(home / "Documents" / "notes")])
    outside = await call(files, "write_file", {"path": "~/Documents/new.md", "content": "hello"})
    assert not outside.ok and outside.kind == "not_writable" and str(home / "Documents" / "notes") in outside.text
    assert not (home / "Documents" / "new.md").exists()
    # A project is writable. Existing files still need to be read before an edit.
    made = await call(files, "write_file", {"path": "~/Documents/notes/new.md", "content": "hello\n"})
    assert made.ok and (home / "Documents" / "notes" / "new.md").read_text(encoding="utf-8") == "hello\n"
    unread = await call(files, "edit_file", {"path": "~/Documents/notes/plan.md", "old_string": "then rest", "new_string": "then sleep"})
    assert not unread.ok and unread.kind == "not_read"
    await call(files, "read_file", {"path": "~/Documents/notes/plan.md"})
    edited = await call(files, "edit_file", {"path": "~/Documents/notes/plan.md", "old_string": "then rest", "new_string": "then sleep"})
    assert edited.ok and "then sleep" in (home / "Documents" / "notes" / "plan.md").read_text(encoding="utf-8")
    # A kept place inside a write folder still takes no write.
    settings.set("project_folders", [str(home / "project")])
    secret = await call(files, "write_file", {"path": "~/project/.env", "content": "TOKEN=leak"})
    assert not secret.ok and (home / "project" / ".env").read_text(encoding="utf-8") == "TOKEN=ship\n"


async def test_each_member_can_write_its_own_folder_team_and_projects(conn, home, files):
    settings = SettingsStore(conn)
    team = home / "team"
    files.owner_files.member_folders = lambda member: (home / f"member-{member}", team)
    settings.set("project_folders", [str(home / "project")])
    for path in ("~/member-0/notes/a.md", "~/team/a.md", "~/project/a.md"):
        written = await call(files, "write_file", {"path": path, "content": "a\n"})
        assert written.ok
    for path in ("~/member-7/a.md", "~/Documents/a.md"):
        refused = await call(files, "write_file", {"path": path, "content": "a\n"})
        assert not refused.ok and refused.kind == "not_writable"
    token = _CONTEXT.set((("chat", 7, 2), False, True, "session", False, 7))
    try:
        assert (await call(files, "write_file", {"path": "~/project/seven.md", "content": "a\n"})).ok
        refused = await call(files, "write_file", {"path": "~/member-0/hidden.md", "content": "a\n"})
        assert refused.kind == "not_writable"
        assert (await call(files, "read_file", {"path": "~/member-0/notes/a.md"})).ok
    finally:
        _CONTEXT.reset(token)


async def test_shared_files_remain_writable_beneath_the_app_data_floor(conn, home, files, monkeypatch):
    data = home / "app-data"
    own, team = data / "members" / "member", data / "team"
    files.owner_files.member_folders = lambda member: (own, team)
    monkeypatch.setenv("RAPHAEL_DATA_DIR", str(data))
    gate = ToolGate(files, conn=conn)
    gate.data_floor.work_file = files.shared_owner_file
    for folder in (own, team):
        args = {"path": str(folder / "note.md"), "content": "hello"}
        assert gate.data_floor.access("mcp:owner_files/write_file", args) is None
        assert (await call(files, "write_file", args)).ok
    for path in (own / ".raphael-jobs" / "1.log", data / "raphael.db", data / "members" / "peer" / "note.md"):
        assert gate.data_floor.access("mcp:owner_files/write_file", {"path": str(path), "content": "hello"}) == "write"


def test_projects_and_work_folders_validate_members_and_paths(conn, home):
    settings = SettingsStore(conn)
    project = str(home / "project")
    settings.set("project_folders", [f" {project} ", project])
    assert settings.get("project_folders") == [project]
    settings.set("member_work_folder", {"3": project})
    assert settings.get("member_work_folder") == {"3": project}
    for bad in ({"x": project}, {"3": "relative/path"}):
        with pytest.raises(ValueError):
            settings.set("member_work_folder", bad)
    with pytest.raises(TypeError):
        settings.set("member_work_folder", {"3": [project]})


async def test_a_write_that_was_not_approved_is_not_made(conn, home, files):
    SettingsStore(conn).set("project_folders", [str(home / "Documents")])
    result = await call(files, "write_file", {"path": "~/Documents/x.md", "content": "x"}, approver="none")
    assert not result.ok and result.kind == "approval_required" and not (home / "Documents" / "x.md").exists()


# --- an ordinary turn, whole ---------------------------------------------------------------------------------------


def rig_with_files(make_rig, conn):
    hub, host = local_hub(conn)
    return make_rig(plugins=hub, gate=ToolGate(hub, conn=conn), permissions=PermissionCards(conn))


@pytest.mark.parametrize("source", ["app", "telegram", "slack"])
async def test_a_turn_from_anywhere_reads_the_owners_file(make_rig, client, conn, home, source):
    rig = rig_with_files(make_rig, conn)
    client.chats = [chat("Reading.", ("owner_files__read_file", {"path": "~/Documents/notes/plan.md"})),
                    chat('{"text":"It says to ship the Mac build."}')]
    result = await rig.call("agent.ask", {"session_id": f"files-{source}", "text": "What does my plan say?",
                                          "ui_language": "en", "member_id": 0, "source": source})
    assert result["status"] == "done"
    assert READS <= names(client.chat_calls[0]["tools"])
    results = [message["content"] for message in client.chat_calls[-1]["messages"] if message["role"] == "tool"]
    assert any("ship the Mac build" in text for text in results)


async def test_a_search_for_every_match_reaches_the_model_cut_to_its_result_limit(make_rig, client, conn, home):
    # head_limit 0 asks for every match, and the tool gives them all; what the model reads of any tool's result is held to
    # the harness's result limit, its head and its tail kept, and says it was cut.
    from raphael_core.worker.guards import MAX_RESULT_CHARS
    (home / "Documents" / "log.txt").write_text("".join(f"ship entry {index:05d} {'x' * 60}\n" for index in range(2000)),
                                                encoding="utf-8")
    rig = rig_with_files(make_rig, conn)
    client.chats = [chat("Searching.", ("owner_files__grep", {"pattern": "ship entry", "path": "~/Documents",
                                                               "output_mode": "content", "head_limit": 0})),
                    chat('{"text":"There are many entries."}')]
    result = await rig.call("agent.ask", {"session_id": "files-all", "text": "List every ship entry in my log",
                                          "ui_language": "en", "member_id": 0, "source": "app"})
    assert result["status"] == "done"
    [text] = [message["content"] for message in client.chat_calls[-1]["messages"] if message["role"] == "tool"]
    assert len(text) <= MAX_RESULT_CHARS + 500 and "cut_short=true" in text and "characters left out" in text
    assert "ship entry 00000" in text and "ship entry 01999" in text


async def test_the_card_for_a_write_names_the_file_that_will_be_written(make_rig, client, conn, home):
    # The member wrote a path through a folder link; the owner approves the place the write lands, where `writable` judged.
    rig = rig_with_files(make_rig, conn)
    rig.settings.set("project_folders", [str(home / "Documents")])
    _link_folder(home / "Desk", home / "Documents")
    landing = os.path.realpath(home / "Documents" / "new.md")
    client.chats = [chat("Saving.", ("owner_files__write_file", {"path": "~/Desk/new.md", "content": "hello\n"}))]
    asked = await rig.call("agent.ask", {"session_id": "files-card", "text": "Save a note on my desk",
                                         "ui_language": "en", "member_id": 0, "source": "app"})
    assert asked["status"] == "confirm"
    card = PermissionCards(conn).get(asked["confirm"]["id"])
    assert landing in card.summary and "~/Desk" not in card.summary
    assert "~/Desk" not in asked["confirm"]["text"]
    assert not (home / "Documents" / "new.md").exists()


def test_a_card_shows_the_resolved_path_only_for_the_owners_file_writes(home):
    from raphael_core.computer.local_tools import card_arguments
    written = card_arguments("mcp:owner_files/edit_file", {"path": "~/Documents/budget.csv", "old_string": "a", "new_string": "b"})
    assert written["path"] == os.path.realpath(home / "Documents" / "budget.csv") and written["old_string"] == "a"
    for key in ("mcp:owner_files/read_file", "mcp:computer/write_file", "mcp:Notes/note"):
        assert card_arguments(key, {"path": "~/Documents/budget.csv"}) == {"path": "~/Documents/budget.csv"}


async def test_a_cli_brain_has_the_owners_file_tools(make_rig, conn, home, monkeypatch):
    rig = rig_with_files(make_rig, conn)
    rig.settings.set("agent_model", "cli:claude")
    seen = []

    async def work(loop):
        seen.append(names(loop.tools))
        loop._queue.put_nowait(Outcome("done", final="Finished."))
    monkeypatch.setattr(CliLoop, "_work", work)
    assert (await typed(rig, "What does my plan say?"))["status"] == "done"
    [tools] = seen
    assert READS <= tools and not tools & PC_TOOLS


def _clock(ticks):
    """A clock for the walk that stands still for `ticks` looks and then is long past any deadline."""
    looks = iter(range(10 ** 9))
    return SimpleNamespace(monotonic=lambda: 0 if next(looks) < ticks else 10 ** 6)


def test_a_slow_search_of_a_large_file_stops_with_the_walk_and_says_so(home, monkeypatch):
    # Python's regular expressions cannot be stopped from outside, so the search itself looks at the clock as it goes.
    big = home / "Documents" / "big.log"
    big.write_text("".join(f"ship line {index}\n" for index in range(5000)), encoding="utf-8")
    monkeypatch.setattr(owner_files, "time", _clock(20))
    monkeypatch.setattr(owner_files, "LINE_CHECK", 10, raising=False)
    result = owner_files.grep_files({"pattern": "ship line", "path": str(big), "output_mode": "content",
                                     "head_limit": 0}, lambda path: False)
    rows = [line for line in result.text.split("\n") if "ship line" in line]
    assert 0 < len(rows) < 5000
    assert f"stopped after {owner_files.WALK_SECONDS} seconds" in result.text


def test_a_walk_through_folders_without_files_stops_in_time(home, monkeypatch):
    for index in range(30):
        (home / "empty" / f"folder{index}" / "deeper").mkdir(parents=True)
    monkeypatch.setattr(owner_files, "time", _clock(2))
    walk = owner_files.Walk(os.path.realpath(home / "empty"), lambda path: False, home=home)
    assert list(walk.files()) == [] and walk.cut
    monkeypatch.setattr(owner_files, "time", _clock(2))
    listed = owner_files.glob_files({"pattern": "*.md", "path": "~/empty"}, lambda path: False)
    assert "No files found" in listed.text and f"stopped after {owner_files.WALK_SECONDS} seconds" in listed.text


def test_a_search_across_lines_takes_only_smaller_files_and_says_so(home, monkeypatch):
    (home / "Documents" / "long.md").write_bytes(b"ship\nit\n" + b"x" * 2000)
    (home / "Documents" / "short.md").write_bytes(b"ship\nit\n")
    monkeypatch.setattr(owner_files, "WHOLE_FILE_BYTES", 1000, raising=False)
    result = owner_files.grep_files({"pattern": "ship.it", "path": "~/Documents", "multiline": True},
                                    lambda path: False)
    assert "short.md" in result.text and "long.md" not in result.text
    assert "1 file was larger than" in result.text


def test_the_walk_skips_app_data_unless_it_starts_there(home):
    library = home / "Library" / "Containers" / "app"
    library.mkdir(parents=True)
    (library / "notes.md").write_text("x", encoding="utf-8")
    walked = list(owner_files.Walk(os.path.realpath(home), lambda path: False, home=home).files())
    assert not [path for path in walked if "Library" in path]
    inside = list(owner_files.Walk(os.path.realpath(library), lambda path: False, home=home).files())
    assert [os.path.basename(path) for path in inside] == ["notes.md"]

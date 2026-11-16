"""R-PC-04 and R-PC-05: members read the owner's whole computer from every turn and task, and write only in the folders
the owner chose.

The files are real ones in the test's folder (the owner's home is moved
there); the brain is a fake.
"""

import os

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
    token = _CONTEXT.set((("chat", 0, 1), False, True, "session", False))  # an ordinary turn: the owner's screen out of reach
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
    settings.set("owner_write_folders", [str(home / "Documents")])
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


# --- writing ---------------------------------------------------------------------------------------------------------


async def test_writing_is_only_inside_the_owners_folders(conn, home, files):
    settings = SettingsStore(conn)
    refused = await call(files, "write_file", {"path": "~/Documents/new.md", "content": "hello"})
    assert not refused.ok and refused.kind == "not_writable" and "no folder is chosen yet" in refused.text
    settings.set("owner_output_folder", str(home / "Documents" / "notes"))
    settings.set("owner_write_folders", [str(home / "project")])
    outside = await call(files, "write_file", {"path": "~/Documents/new.md", "content": "hello"})
    assert not outside.ok and outside.kind == "not_writable" and str(home / "project") in outside.text
    assert not (home / "Documents" / "new.md").exists()
    # The output folder and the listed ones take a write; a file there is read first, as Claude Code's Write wants.
    made = await call(files, "write_file", {"path": "~/Documents/notes/new.md", "content": "hello\n"})
    assert made.ok and (home / "Documents" / "notes" / "new.md").read_text(encoding="utf-8") == "hello\n"
    unread = await call(files, "edit_file", {"path": "~/Documents/notes/plan.md", "old_string": "then rest", "new_string": "then sleep"})
    assert not unread.ok and unread.kind == "not_read"
    await call(files, "read_file", {"path": "~/Documents/notes/plan.md"})
    edited = await call(files, "edit_file", {"path": "~/Documents/notes/plan.md", "old_string": "then rest", "new_string": "then sleep"})
    assert edited.ok and "then sleep" in (home / "Documents" / "notes" / "plan.md").read_text(encoding="utf-8")
    # A kept place inside a write folder still takes no write.
    secret = await call(files, "write_file", {"path": "~/project/.env", "content": "TOKEN=leak"})
    assert not secret.ok and (home / "project" / ".env").read_text(encoding="utf-8") == "TOKEN=ship\n"


async def test_a_write_that_was_not_approved_is_not_made(conn, home, files):
    SettingsStore(conn).set("owner_write_folders", [str(home / "Documents")])
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


def test_the_walk_skips_app_data_unless_it_starts_there(home):
    library = home / "Library" / "Containers" / "app"
    library.mkdir(parents=True)
    (library / "notes.md").write_text("x", encoding="utf-8")
    walked = list(owner_files.Walk(os.path.realpath(home), lambda path: False, home=home).files())
    assert not [path for path in walked if "Library" in path]
    inside = list(owner_files.Walk(os.path.realpath(library), lambda path: False, home=home).files())
    assert [os.path.basename(path) for path in inside] == ["notes.md"]

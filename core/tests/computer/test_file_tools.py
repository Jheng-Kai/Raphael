"""A member's file tools on its own computer, as Claude Code's Edit and Write (R-FILE-02, R-FILE-03).

The fake docker `Runtime` answers the guest's file helper by running that same helper (`files_guest.handle`) on a
folder of this test standing for the computer's workspace and team folder: no Docker, network or model.
"""

import json
import os

import httpx
import pytest

from raphael_core.agent.mcp_server import RaphaelMcp
from raphael_core.brain.settings import SettingsStore
from raphael_core.computer import file_tools, files_guest
from raphael_core.computer.vm import GUEST, SHARED, LocalVm, Result
from raphael_core.computer.vm_tools import VmTools, vm_scope
from raphael_core.services.attachment_store import AttachmentStore
from raphael_core.worker.loop import TOO_LONG, Call, ToolOutcome, _refusal

from .test_vm import Bridge, EmptyHub, Runtime, container

HELPER = '"""Guest-only reads and writes'
CHECKPOINT = '"""Guest-only file checkpoints'


class GuestRuntime(Runtime):
    """The fake docker, with a computer whose workspace and team folder are folders of the test."""

    def __init__(self, root):
        super().__init__()
        self.folders = {GUEST: root / "workspace", SHARED: root / "team"}
        for folder in self.folders.values():
            folder.mkdir(parents=True)

    def host(self, path):
        for guest, folder in self.folders.items():
            if path == guest or path.startswith(guest + "/"):
                return str(folder) + path[len(guest):]
        raise AssertionError(f"Outside the test's computer: {path}")

    async def __call__(self, args, **kwargs):
        if args[:1] == ["--host"]:
            args = args[2:]
        if args[0] == "exec" and "-c" in args and args[args.index("-c") + 1].startswith(HELPER):
            self.calls.append((args, kwargs))
            request = json.loads(kwargs["input"])
            request.update(path=self.host(request["path"]), roots=[str(self.folders[root]) for root in request["roots"]])
            return Result(0, json.dumps(files_guest.handle(request)))
        return await super().__call__(args, **kwargs)


@pytest.fixture
async def computer(tmp_path, conn):
    settings = SettingsStore(conn)
    settings.set("computer_vm_mode", "per-bot")
    runtime = GuestRuntime(tmp_path / "guest")
    vm = LocalVm(tmp_path / "data", settings=settings, runner=runtime, clock=lambda: 0)
    target = await vm.seat()
    runtime.raw = container(vm, target, runtime)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path / "attachments"), bridge=Bridge)
    await hub.prepare()
    return hub, runtime


async def use(hub, name, *, turn=7, **arguments):
    tool = next(tool for tool in hub.offered() if tool.name == name)
    with vm_scope(("turn", 0, 1), turn_id=turn):
        return await hub.call(tool.key, arguments, approver="auto")


def workspace(runtime, name=""):
    return runtime.folders[GUEST] / name


def helper_calls(runtime, action=None):
    return [kwargs for args, kwargs in runtime.calls
            if "-c" in args and args[args.index("-c") + 1].startswith(HELPER)
            and (action is None or json.loads(kwargs["input"])["action"] == action)]


def checkpoints(runtime):
    return [args for args, _ in runtime.calls if any(str(arg).startswith(CHECKPOINT) for arg in args)]


# --- write_file -----------------------------------------------------------------------------------------------------


async def test_write_file_makes_the_file_and_its_folders_and_sends_the_text_over_stdin(computer):
    hub, runtime = computer
    text = "".join(f"line {number}: {'x' * 60}\n" for number in range(700))  # 46,000 characters, past a command's 16,000
    result = await use(hub, "write_file", path="notes/plan.md", content=text)
    assert result.ok, result.text
    assert result.text == f"File created successfully at: {GUEST}/notes/plan.md (700 lines, {len(text):,} bytes)"
    assert workspace(runtime, "notes/plan.md").read_text(encoding="utf-8") == text
    write = helper_calls(runtime, "write")
    assert len(write) == 1 and text not in json.dumps([args for args, _ in runtime.calls if "-c" in args])
    exec_args = next(args for args, kwargs in runtime.calls if kwargs is write[0])
    assert exec_args[:2] == ["exec", "-i"], "the text goes over the command's stdin"


async def test_writing_over_a_file_this_run_has_not_read_is_refused_in_claude_codes_words(computer):
    hub, runtime = computer
    workspace(runtime, "report.txt").write_text("the owner's draft", encoding="utf-8")
    result = await use(hub, "write_file", path=f"{GUEST}/report.txt", content="replaced")
    assert not result.ok and result.kind == "not_read"
    assert result.text == "File has not been read yet. Read it first before writing to it."
    assert workspace(runtime, "report.txt").read_text(encoding="utf-8") == "the owner's draft"
    assert not helper_calls(runtime, "write") and not checkpoints(runtime)


async def test_a_file_this_run_wrote_can_be_written_again_but_not_by_another_run(computer):
    hub, runtime = computer
    assert (await use(hub, "write_file", path="a.txt", content="one\n")).ok
    again = await use(hub, "write_file", path="a.txt", content="two\nlines\n")
    assert again.ok and again.text == f"The file {GUEST}/a.txt has been overwritten (2 lines, 10 bytes)."
    other = await use(hub, "write_file", turn=8, path="a.txt", content="three\n")
    assert other.kind == "not_read", "a read in one turn is not a read in another"
    assert workspace(runtime, "a.txt").read_text(encoding="utf-8") == "two\nlines\n"


async def test_a_file_changed_since_this_run_saw_it_is_never_written_over(computer):
    hub, runtime = computer
    assert (await use(hub, "write_file", path="shared.md", content="mine\n")).ok
    workspace(runtime, "shared.md").write_text("a colleague's edit\n", encoding="utf-8")  # a shared computer
    for name, arguments in (("write_file", {"content": "mine again\n"}),
                            ("edit_file", {"old_string": "mine", "new_string": "ours"})):
        result = await use(hub, name, path="shared.md", **arguments)
        assert not result.ok and result.kind == "changed_since_read", name
        assert result.text.startswith("File has been modified since read") and "Read it again" in result.text
    assert workspace(runtime, "shared.md").read_text(encoding="utf-8") == "a colleague's edit\n"


async def test_a_folder_or_a_link_is_not_written_as_a_file(computer, tmp_path):
    hub, runtime = computer
    workspace(runtime, "folder").mkdir()
    assert (await use(hub, "write_file", path="folder", content="x")).kind == "not_a_file"
    outside = tmp_path / "outside.txt"
    outside.write_text("the owner's file on the host", encoding="utf-8")
    try:
        os.symlink(outside, workspace(runtime, "link.txt"))
        os.symlink(tmp_path, workspace(runtime, "linked-folder"), target_is_directory=True)
    except OSError:
        pytest.skip("This host cannot make links")
    assert (await use(hub, "write_file", path="link.txt", content="x")).kind == "not_a_file"
    assert (await use(hub, "write_file", path="linked-folder/outside.txt", content="x")).kind == "link"
    assert outside.read_text(encoding="utf-8") == "the owner's file on the host"


# --- edit_file ------------------------------------------------------------------------------------------------------


async def written(hub, runtime, name, text):
    assert (await use(hub, "write_file", path=name, content=text)).ok
    return workspace(runtime, name)


async def test_edit_replaces_the_one_exact_string_and_shows_the_numbered_lines_around_it(computer):
    hub, runtime = computer
    path = await written(hub, runtime, "app.py", "".join(f"value_{number} = {number}\n" for number in range(1, 21)))
    result = await use(hub, "edit_file", path="app.py", old_string="value_10 = 10\n", new_string="value_10 = 'ten'\nvalue_10b = 10\n")
    assert result.ok, result.text
    assert path.read_text(encoding="utf-8").splitlines()[9:11] == ["value_10 = 'ten'", "value_10b = 10"]
    lines = result.text.splitlines()
    assert lines[0].startswith(f"The file {GUEST}/app.py has been updated.")
    assert lines[1:] == [f"{number:6}\t{text}" for number, text in [
        (6, "value_6 = 6"), (7, "value_7 = 7"), (8, "value_8 = 8"), (9, "value_9 = 9"), (10, "value_10 = 'ten'"),
        (11, "value_10b = 10"), (12, "value_11 = 11"), (13, "value_12 = 12"), (14, "value_13 = 13"), (15, "value_14 = 14"),
        (16, "value_15 = 15")]]
    # The edit is this run's own: the next edit needs no read again.
    assert (await use(hub, "edit_file", path="app.py", old_string="value_20 = 20", new_string="value_20 = 0")).ok


async def test_a_string_found_more_than_once_needs_more_context_or_replace_all(computer):
    hub, runtime = computer
    path = await written(hub, runtime, "list.txt", "todo\ndone\ntodo\ntodo\n")
    result = await use(hub, "edit_file", path="list.txt", old_string="todo", new_string="done")
    assert result.kind == "string_not_unique"
    assert result.text.startswith("Found 3 matches of the string to replace, but replace_all is false.")
    assert "provide more context to uniquely identify the instance" in result.text and result.text.endswith("String: todo")
    assert path.read_text(encoding="utf-8") == "todo\ndone\ntodo\ntodo\n"
    every = await use(hub, "edit_file", path="list.txt", old_string="todo", new_string="done", replace_all=True)
    assert every.ok and "3 occurrences were replaced" in every.text
    assert path.read_text(encoding="utf-8") == "done\ndone\ndone\ndone\n"


async def test_what_is_not_there_or_changes_nothing_is_refused(computer):
    hub, runtime = computer
    await written(hub, runtime, "a.txt", "alpha\n")
    missing = await use(hub, "edit_file", path="a.txt", old_string="beta", new_string="gamma")
    assert missing.kind == "string_not_found" and missing.text == "String to replace not found in file.\nString: beta"
    same = await use(hub, "edit_file", path="a.txt", old_string="alpha", new_string="alpha")
    assert same.kind == "no_change" and same.text == "No changes to make: old_string and new_string are exactly the same."
    long = await use(hub, "edit_file", path="a.txt", old_string="z" * 5000, new_string="y")
    assert long.kind == "string_not_found" and len(long.text) < 600, "a long old_string is shown in part"
    gone = await use(hub, "edit_file", path="b.txt", old_string="alpha", new_string="beta")
    assert gone.kind == "file_missing" and gone.text == "File does not exist. Names near it: a.txt."
    assert (await use(hub, "edit_file", path="a.txt", old_string="", new_string="x")).kind == "file_exists"
    made = await use(hub, "edit_file", path="new/c.txt", old_string="", new_string="made by an edit\n")
    assert made.ok and workspace(runtime, "new/c.txt").read_text(encoding="utf-8") == "made by an edit\n"


async def test_an_edit_without_a_read_in_this_run_is_refused(computer):
    hub, runtime = computer
    workspace(runtime, "notes.md").write_text("first\n", encoding="utf-8")
    result = await use(hub, "edit_file", path="notes.md", old_string="first", new_string="second")
    assert result.kind == "not_read" and result.text == "File has not been read yet. Read it first before writing to it."
    assert workspace(runtime, "notes.md").read_text(encoding="utf-8") == "first\n" and not checkpoints(runtime)


async def test_crlf_line_ends_and_a_byte_order_mark_are_kept(computer):
    hub, runtime = computer
    path = await written(hub, runtime, "win.txt", "﻿one\r\ntwo\r\nthree\r\n")
    result = await use(hub, "edit_file", path="win.txt", old_string="one\ntwo", new_string="one\n2")
    assert result.ok, result.text
    assert path.read_bytes() == b"\xef\xbb\xbfone\r\n2\r\nthree\r\n"


async def test_a_file_that_is_not_text_or_is_too_large_is_left_to_vm_exec(computer, monkeypatch):
    hub, runtime = computer
    await written(hub, runtime, "data.bin", "seed")
    workspace(runtime, "data.bin").write_bytes(b"\x89PNG\r\n\x1a\n\xff\xfe\x00")
    # What the run last saw is the file as it is now (as a read would record it): only its kind refuses it.
    import hashlib
    run = next(iter(hub.file_reads.runs))
    hub.file_reads.saw(run, f"{GUEST}/data.bin", hashlib.sha256(workspace(runtime, "data.bin").read_bytes()).hexdigest())
    assert (await use(hub, "edit_file", path="data.bin", old_string="PNG", new_string="JPG")).kind == "not_text"
    monkeypatch.setattr(file_tools, "MAX_EDIT_BYTES", 8)
    big = await use(hub, "edit_file", path="data.bin", old_string="PNG", new_string="JPG")
    assert big.kind == "too_large" and big.text.startswith("This file is 11 bytes")


async def test_each_change_takes_the_runs_checkpoint_before_it_writes(computer):
    hub, runtime = computer
    await written(hub, runtime, "a.txt", "one\n")
    assert (await use(hub, "edit_file", path="a.txt", old_string="one", new_string="two")).ok
    order = [("checkpoint" if any(str(arg).startswith(CHECKPOINT) for arg in args) else json.loads(kwargs["input"])["action"])
             for args, kwargs in runtime.calls
             if any(str(arg).startswith((CHECKPOINT, HELPER)) for arg in args)]
    # One checkpoint for the run, before its first write (the card of changed files and its undo read it).
    assert order == ["read", "checkpoint", "write", "read", "write"]


async def test_the_file_tools_are_listed_whole_without_the_outward_sentence(computer):
    hub, _ = computer
    tools = {tool.name: tool for tool in hub.offered()}
    for name in ("write_file", "edit_file"):
        tool = tools[name]
        assert tool.server == "computer" and tool.whole and tool.pinned and not tool.deferred
        assert tool.description == file_tools.DEFINITIONS[name]["description"]
        assert "Claude Code" in tool.description and "read_file" in tool.description
    assert hub.kind_of("computer", "write_file") == hub.kind_of("computer", "edit_file") == "write"


# --- a whole file is not cut at a command's length ------------------------------------------------------------------


def test_the_loop_takes_a_whole_file_for_write_file_but_not_a_long_command():
    offered = {"computer__write_file", "computer__edit_file", "computer__vm_exec"}
    text = "x" * 60_000
    assert _refusal(Call("1", "computer__write_file", {"path": "a", "content": text}), offered, cut=False) is None
    assert _refusal(Call("2", "computer__edit_file", {"path": "a", "old_string": "y", "new_string": text}), offered, cut=False) is None
    assert _refusal(Call("3", "computer__vm_exec", {"command": text}), offered, cut=False) == TOO_LONG
    assert _refusal(Call("4", "computer__write_file", {"path": "a", "content": "x" * 250_000}), offered, cut=False) == TOO_LONG


async def test_a_cli_brain_sends_a_whole_file_through_the_computer_server():
    called = []

    async def execute(identifier, name, args):
        called.append((name, len(args.get("content", args.get("command", "")))))
        return ToolOutcome(True)
    definitions = [{"function": {"name": name, "parameters": {"type": "object"}}}
                   for name in ("computer__write_file", "computer__vm_exec")]
    async with RaphaelMcp(lambda: definitions, execute) as server, httpx.AsyncClient() as client:
        headers = {"Authorization": "Bearer " + server.token}
        for name, arguments in (("computer__write_file", {"path": "a", "content": "x" * 60_000}),
                                ("computer__vm_exec", {"command": "x" * 60_000})):
            packet = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments}}
            answer = (await client.post(server.computer_url, headers=headers, json=packet)).json()
            assert ("error" in answer) == (name == "computer__vm_exec")
    assert called == [("computer__write_file", 60_000)]

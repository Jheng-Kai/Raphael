"""The owner's paste into a member's computer, their copy out of it, and files they hand it (R-PASTE-01, R-PASTE-02,
R-COMP-FILE-01), and the files a member copies into it itself (R-COMP-FILE-02), without Docker: the driver and the upload
store are stand-ins."""
import base64
import json
from pathlib import Path

import pytest

from raphael_core.agent.policy import Tier
from raphael_core.computer import owner_files, vm_tools
from raphael_core.computer.owner_transfer import REMOTE_FILE_MAX, clipboard_text, numbered, place_copy, place_remote, safe_name
from raphael_core.computer.vm import VmError
from raphael_core.computer.vm_tools import VmTools
from raphael_core.protocol import RpcError
from raphael_core.services.attachment_store import AttachmentStore
from .test_viewer import viewer  # noqa: F401 (the fixture)
from .test_vm import CatalogBridge, EmptyHub, desktop  # noqa: F401 (the fixture)


def driver(answers):
    """A stand-in for the computer's driver: records each call and answers from `answers` by tool name."""
    calls = []
    async def call(target, name, arguments):
        calls.append((name, arguments))
        return answers.get(name)
    return calls, call


async def held(bridge):
    async def connection(target): return 6080, "synthetic"
    bridge.vm.viewer_connection = connection
    opened = await bridge.open({"member_id": 1})
    await bridge.control({**opened, "held": True})
    return opened


async def test_a_paste_hands_its_text_to_the_computers_driver_only_while_the_owner_holds_the_screen(viewer):
    bridge, _, _ = viewer
    calls, bridge.driver_call = driver({"clipboard_write": {"content": [{"type": "text", "text": "ok"}]}})
    async def connection(target): return 6080, "synthetic"
    bridge.vm.viewer_connection = connection
    watching = await bridge.open({"member_id": 1})
    with pytest.raises(RpcError, match="does not hold"):
        await bridge.clipboard({**watching, "action": "put", "text": "sk-or-v1-secret"})
    assert calls == []
    await bridge.control({**watching, "held": True})
    assert await bridge.clipboard({**watching, "action": "put", "text": "sk-or-v1-secret"}) == {"put": True}
    assert calls == [("clipboard_write", {"text": "sk-or-v1-secret"})]
    for bad in ("", 7, None, "x" * 1_000_001):
        with pytest.raises(RpcError):
            await bridge.clipboard({**watching, "action": "put", "text": bad})
    with pytest.raises(RpcError, match="put or take"):
        await bridge.clipboard({**watching, "action": "read"})


async def test_a_driver_that_fails_is_a_paste_not_handed_over_and_the_page_pastes_as_before(viewer):
    bridge, _, _ = viewer
    _, bridge.driver_call = driver({})
    opened = await held(bridge)
    assert await bridge.clipboard({**opened, "action": "put", "text": "kept"}) == {"put": False}


async def test_a_copy_brings_the_computers_text_to_the_owners_clipboard_unless_it_is_what_it_was(viewer):
    bridge, _, _ = viewer
    copied = []
    bridge.copy_to_owner = copied.append
    answer = {"clipboard_read": {"content": [{"type": "text", "text": json.dumps({"types": ["text/plain"], "text": "from the computer"})}]}}
    _, bridge.driver_call = driver(answer)
    opened = await held(bridge)
    assert await bridge.clipboard({**opened, "action": "take"}) == {"copied": True}
    assert copied == ["from the computer"]
    # Ctrl+C that copied nothing new (a terminal's interrupt) leaves the owner's clipboard as it is.
    assert await bridge.clipboard({**opened, "action": "take"}) == {"copied": False}
    # Nor is the owner's own paste, just handed to the computer, copied back to them.
    _, bridge.driver_call = driver({"clipboard_write": {"content": []}, "clipboard_read": {"structuredContent": {"text": "pasted"}}})
    await bridge.clipboard({**opened, "action": "put", "text": "pasted"})
    assert await bridge.clipboard({**opened, "action": "take"}) == {"copied": False}
    assert copied == ["from the computer"]


async def test_a_copy_with_no_text_a_clipboard_that_cannot_be_written_or_no_hold_copies_nothing(viewer):
    bridge, _, _ = viewer
    def refuse(text): raise OSError("The clipboard is busy")
    bridge.copy_to_owner = refuse
    _, bridge.driver_call = driver({"clipboard_read": {"structuredContent": {"text": "busy"}}})
    opened = await held(bridge)
    assert await bridge.clipboard({**opened, "action": "take"}) == {"copied": False}
    _, bridge.driver_call = driver({"clipboard_read": {"structuredContent": {"types": ["image/png"]}}})
    assert await bridge.clipboard({**opened, "action": "take"}) == {"copied": False}
    await bridge.control({**opened, "held": False})
    with pytest.raises(RpcError, match="does not hold"):
        await bridge.clipboard({**opened, "action": "take"})


async def test_the_viewers_own_driver_call_reaches_the_driver_while_the_owner_holds_the_screen(viewer, monkeypatch):
    from raphael_core.computer.vm_bridge import CuaBridge
    bridge, _, _ = viewer
    sent = []

    async def enter(self):
        self.process = type("Process", (), {"returncode": None})()
        return self

    async def leave(self, *exc):
        self.process = None

    async def write(self, packet):
        sent.append(packet)
        self.pending[packet["id"]].set_result({"content": [{"type": "text", "text": "ok"}]})
    monkeypatch.setattr(CuaBridge, "__aenter__", enter)
    monkeypatch.setattr(CuaBridge, "__aexit__", leave)
    monkeypatch.setattr(CuaBridge, "_write", write)
    opened = await held(bridge)
    assert bridge.vm.target(1).key in bridge.vm.held
    assert await bridge.driver_call(bridge.vm.target(1), "clipboard_write", {"text": "pasted"}) is not None
    assert [packet["params"]["name"] for packet in sent if packet["method"] == "tools/call"] == ["clipboard_write"]
    await bridge.close(opened)


async def test_a_held_computer_still_refuses_every_other_call_and_every_call_without_the_owners_hands(viewer, monkeypatch):
    from raphael_core.computer.vm_bridge import CuaBridge
    bridge, _, _ = viewer
    sent = []

    async def enter(self):
        self.process = type("Process", (), {"returncode": None})()
        return self

    async def leave(self, *exc):
        self.process = None

    async def write(self, packet):
        sent.append(packet)
        self.pending[packet["id"]].set_result({"content": [{"type": "text", "text": "ok"}]})
    monkeypatch.setattr(CuaBridge, "__aenter__", enter)
    monkeypatch.setattr(CuaBridge, "__aexit__", leave)
    monkeypatch.setattr(CuaBridge, "_write", write)
    opened = await held(bridge)
    target = bridge.vm.target(1)
    async with CuaBridge(bridge.vm, target) as client:
        # A member's own clipboard call, and any other call with the owner's hands, meet the owner's note, not the driver.
        assert (await client.request("tools/call", {"name": "clipboard_write", "arguments": {"text": "x"}}))["isError"]
        assert (await client.request("tools/call", {"name": "click", "arguments": {"x": 1, "y": 1}}, owner_hands=True))["isError"]
    assert not [packet for packet in sent if packet["method"] == "tools/call"]
    await bridge.close(opened)


def test_the_driver_answer_gives_its_text_only_from_a_text_field():
    assert clipboard_text({"structuredContent": {"text": "a"}}) == "a"
    assert clipboard_text({"content": [{"type": "text", "text": json.dumps({"text": "b", "types": []})}]}) == "b"
    assert clipboard_text({"content": [{"type": "text", "text": "Clipboard has text"}]}) is None
    assert clipboard_text({"content": [{"type": "image", "data": "..."}]}) is None
    assert clipboard_text(None) is None and clipboard_text({"structuredContent": {"text": 3}}) is None


async def test_a_file_goes_into_the_team_folder_under_its_own_name_and_a_taken_name_gets_a_number(viewer, tmp_path):
    bridge, _, _ = viewer
    stored = tmp_path / "store" / "abc123"
    stored.parent.mkdir()
    stored.write_bytes(b"\x89PNG picture")
    bridge.stored_path = lambda key: stored if key == "abc123" else (_ for _ in ()).throw(ValueError("unknown"))
    async def connection(target): return 6080, "synthetic"
    bridge.vm.viewer_connection = connection
    # Watching is enough: a file goes into a folder, not under anyone's hands.
    opened = await bridge.open({"member_id": 1})
    first = await bridge.put_file({**opened, "stored_id": "abc123", "name": "photo.png"})
    second = await bridge.put_file({**opened, "stored_id": "abc123", "name": "photo.png"})
    team = bridge.vm.target(1).shared
    assert first == {"name": "photo.png", "path": "/home/cua/team/photo.png"}
    assert second == {"name": "photo (2).png", "path": "/home/cua/team/photo (2).png"}
    assert (team / "photo.png").read_bytes() == (team / "photo (2).png").read_bytes() == b"\x89PNG picture"
    assert not [path for path in team.iterdir() if path.name.endswith(".part")]
    with pytest.raises(RpcError, match="no such upload"):
        await bridge.put_file({**opened, "stored_id": "missing", "name": "photo.png"})


async def test_a_preview_hands_the_computer_no_file(viewer, tmp_path):
    bridge, _, _ = viewer
    stored = tmp_path / "abc"
    stored.write_bytes(b"x")
    bridge.stored_path = lambda key: stored
    preview = await bridge.open({"member_id": 1, "preview": True})
    with pytest.raises(RpcError, match="preview"):
        await bridge.put_file({**preview, "stored_id": "abc", "name": "a.txt"})


async def test_a_file_for_a_computer_on_another_machine_travels_over_the_engine_and_skips_a_taken_name(viewer, tmp_path):
    bridge, _, _ = viewer
    stored = tmp_path / "abc"
    stored.write_bytes(b"remote bytes")
    requests = []
    async def file_request(target, request):
        requests.append(request)
        return {"error": "changed"} if request["path"].endswith("/notes.txt") else {"sha256": "x", "size": 12, "created": True}
    bridge.vm.file_request = file_request
    placed = await place_remote(bridge.vm, bridge.vm.target(1), stored, "notes.txt")
    assert placed == "notes (2).txt"
    assert [request["path"] for request in requests] == ["/home/cua/team/notes.txt", "/home/cua/team/notes (2).txt"]
    assert base64.b64decode(requests[-1]["data"]) == b"remote bytes" and requests[-1]["expected"] == "absent"
    # More than one request may carry is refused before anything is sent.
    requests.clear()
    stored.write_bytes(b"x" * (REMOTE_FILE_MAX + 1))
    with pytest.raises(VmError, match="file_too_large"):
        await place_remote(bridge.vm, bridge.vm.target(1), stored, "big.bin")
    assert requests == []


def copy_tool(hub):
    return next(tool for tool in hub.offered() if tool.name == "copy_from_owner")


async def test_a_member_copies_a_file_of_the_owners_computer_into_its_team_folder_and_a_taken_name_gets_a_number(desktop, tmp_path, monkeypatch):
    vm, target, _ = desktop
    home = tmp_path / "owner-home"
    (home / "Documents").mkdir(parents=True)
    sheet = home / "Documents" / "報告.xlsx"
    sheet.write_bytes(b"PK\x03\x04 a workbook")
    monkeypatch.setattr(owner_files, "_home", lambda: home)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path / "attachments"), bridge=CatalogBridge)
    await hub.prepare()
    tool = copy_tool(hub)
    # A member's own computer: it asks nothing, as its other commands, and it changes the computer's files.
    assert hub.tier_of(tool.key) == Tier.T0 and hub.kind_of("computer", "copy_from_owner") == "write"
    first = await hub.call(tool.key, {"path": "~/Documents/報告.xlsx"}, approver="auto")
    assert first.ok, first
    assert json.loads(first.text) == {"path": "/home/cua/team/報告.xlsx", "bytes": len(sheet.read_bytes())}
    second = await hub.call(tool.key, {"path": str(sheet)}, approver="auto")
    assert json.loads(second.text)["path"] == "/home/cua/team/報告 (2).xlsx"
    team = Path(target.shared)
    assert (team / "報告.xlsx").read_bytes() == (team / "報告 (2).xlsx").read_bytes() == sheet.read_bytes()
    assert not [path for path in team.iterdir() if path.name.endswith(".part")]


async def test_a_member_never_copies_where_keys_are_kept_nor_raphaels_own_data_nor_a_folder_or_a_file_too_large(desktop, tmp_path, monkeypatch):
    vm, target, _ = desktop
    home = tmp_path / "owner-home"
    (home / ".ssh").mkdir(parents=True)
    (home / ".ssh" / "config").write_text("Host *")
    raphael = home / "AppData" / "Roaming" / "Raphael Dev"
    raphael.mkdir(parents=True)
    (raphael / "raphael.db").write_bytes(b"SQLite format 3\x00")
    (home / "big.bin").write_bytes(b"x" * 8)
    monkeypatch.setattr(owner_files, "_home", lambda: home)
    monkeypatch.setenv("APPDATA", str(home / "AppData" / "Roaming"))
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path / "attachments"), bridge=CatalogBridge)
    await hub.prepare()
    tool = copy_tool(hub)
    async def copied(path):
        return await hub.call(tool.key, {"path": path}, approver="auto")
    assert (await copied("~/.ssh/config")).kind == "kept"
    assert (await copied(str(raphael / "raphael.db"))).kind == "protected_data"
    assert (await copied("~/Documents")).kind == "file_missing"
    assert (await copied("~/AppData")).kind == "not_a_file"
    monkeypatch.setattr(vm_tools, "MAX_FILE_BYTES", 7)
    too_large = await copied("~/big.bin")
    assert too_large.kind == "file_too_large" and "8 bytes" in too_large.text
    # The team folder's own folders (context, meetings, projects) are all it holds: no file went in.
    assert not [path for path in Path(target.shared).rglob("*") if path.is_file()]


@pytest.mark.parametrize("name, kept", [
    ("photo.png", "photo.png"),
    ("C:\\Users\\someone\\report.pdf", "report.pdf"),
    ("../../etc/passwd", "passwd"),
    ("a<b>c:d|e?f*.txt", "a_b_c_d_e_f_.txt"),
    ("trailing dots. . .", "trailing dots"),
    ("CON.txt", "_CON.txt"),
    ("..", "file"),
    ("", "file"),
    ("  檔案 名稱.docx  ", "檔案 名稱.docx"),
])
def test_a_dropped_name_keeps_its_last_part_without_what_a_folder_refuses(name, kept):
    assert safe_name(name) == kept


def test_a_long_name_keeps_its_extension_and_numbers_go_before_it(tmp_path):
    long = safe_name("x" * 300 + ".png")
    assert len(long) == 200 and long.endswith(".png")
    assert list(numbered("a.tar"))[:3] == ["a.tar", "a (2).tar", "a (3).tar"]
    assert list(numbered("README"))[:2] == ["README", "README (2)"]
    source = tmp_path / "source"
    source.write_bytes(b"one")
    root = tmp_path / "team"
    assert place_copy(source, root, "README") == "README"
    assert place_copy(source, root, "README") == "README (2)"
    with pytest.raises(ValueError):
        safe_name(None)

"""The owner's paste into a member's computer, their copy out of it, and files they hand it (R-PASTE-01, R-PASTE-02,
R-COMP-FILE-01), without Docker: the driver and the upload store are stand-ins."""
import base64
import json

import pytest

from raphael_core.computer.owner_transfer import clipboard_text, numbered, place_copy, safe_name
from raphael_core.protocol import RpcError
from .test_viewer import viewer  # noqa: F401 (the fixture)


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
    placed = await bridge.put_remote(bridge.vm.target(1), stored, "notes.txt")
    assert placed == "notes (2).txt"
    assert [request["path"] for request in requests] == ["/home/cua/team/notes.txt", "/home/cua/team/notes (2).txt"]
    assert base64.b64decode(requests[-1]["data"]) == b"remote bytes" and requests[-1]["expected"] == "absent"


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

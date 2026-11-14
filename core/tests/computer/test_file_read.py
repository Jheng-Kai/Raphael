"""A member reads the files of its own computer as Claude Code's Read (R-FILE-01).

The fake docker answers the guest's file helper by running it on a folder of this test (`test_file_tools`).
"""

import base64
import json

from raphael_core.computer import file_tools
from raphael_core.computer.vm import GUEST
from raphael_core.services.lines import read_lines

from .test_file_tools import GuestRuntime, computer, helper_calls, use, workspace  # noqa: F401

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")


def numbered(first, *lines):
    return "\n".join(f"{number:6}\t{line}" for number, line in enumerate(lines, first))


async def test_a_text_file_comes_as_numbered_lines_like_cat_n(computer):
    hub, runtime = computer
    workspace(runtime, "notes.md").write_text("# Plan\n\tindented\nlast\n", encoding="utf-8")
    result = await use(hub, "read_file", path="notes.md")
    assert result.ok and result.text == numbered(1, "# Plan", "\tindented", "last")
    assert (await use(hub, "read_file", path=f"{GUEST}/notes.md")).text == result.text


async def test_offset_and_limit_page_by_line_and_say_where_to_go_on(computer):
    hub, runtime = computer
    workspace(runtime, "log.txt").write_text("".join(f"entry {number}\n" for number in range(1, 5001)), encoding="utf-8")
    first = await use(hub, "read_file", path="log.txt")
    lines = first.text.splitlines()
    assert len(lines) == 2001 and lines[0] == "     1\tentry 1" and lines[1999] == "  2000\tentry 2000"
    assert lines[-1] == "[Lines 1-2,000 of 5,000 are shown. Read on with read_file (offset 2001).]"
    window = await use(hub, "read_file", path="log.txt", offset=4999, limit=10)
    assert window.text == numbered(4999, "entry 4999", "entry 5000")
    middle = await use(hub, "read_file", path="log.txt", offset=10, limit=3)
    assert middle.text.splitlines() == ["    10\tentry 10", "    11\tentry 11", "    12\tentry 12",
                                        "[Lines 10-12 of 5,000 are shown. Read on with read_file (offset 13).]"]
    # Only the part asked for crosses from the computer, from the line asked for on.
    assert json.loads(helper_calls(runtime, "read")[-1]["input"])["line"] == 10
    past = await use(hub, "read_file", path="log.txt", offset=6000)
    assert past.ok and past.text == "[The file has 5,000 lines; offset 6,000 is past its end.]"


async def test_a_line_over_two_thousand_characters_is_cut_with_a_note(computer):
    hub, runtime = computer
    workspace(runtime, "min.js").write_text("short\n" + "x" * 5000 + "\nend\n", encoding="utf-8")
    lines = (await use(hub, "read_file", path="min.js")).text.splitlines()
    assert lines[1] == "     2\t" + "x" * 2000 + "… [3,000 more characters]"
    assert lines[-1] == "[1 line longer than 2,000 characters was cut where it says so.]"


async def test_an_empty_file_a_folder_a_missing_file_and_a_binary_say_so(computer):
    hub, runtime = computer
    workspace(runtime, "empty.txt").write_bytes(b"")
    assert (await use(hub, "read_file", path="empty.txt")).text == "[The file is empty.]"
    (workspace(runtime, "src")).mkdir()
    (workspace(runtime, "src/app.py")).write_text("x", encoding="utf-8")
    folder = await use(hub, "read_file", path="src")
    assert folder.kind == "not_a_file" and "Use glob" in folder.text and "app.py" in folder.text
    missing = await use(hub, "read_file", path="notes.txt")
    assert missing.kind == "file_missing" and missing.text == "File does not exist. Names near it: empty.txt."
    workspace(runtime, "blob.bin").write_bytes(bytes(range(256)) * 8)
    binary = await use(hub, "read_file", path="blob.bin")
    assert binary.kind == "not_text" and "vm_exec" in binary.text


async def test_a_read_lets_the_same_run_edit_and_write_and_records_what_it_saw(computer):
    hub, runtime = computer
    workspace(runtime, "plan.md").write_text("draft one\n", encoding="utf-8")
    assert (await use(hub, "edit_file", path="plan.md", old_string="one", new_string="two")).kind == "not_read"
    assert (await use(hub, "read_file", path="plan.md", limit=1)).ok  # a part of the file is a read of it
    assert (await use(hub, "edit_file", path="plan.md", old_string="one", new_string="two")).ok
    assert (await use(hub, "write_file", path="plan.md", content="final\n")).ok
    assert workspace(runtime, "plan.md").read_text(encoding="utf-8") == "final\n"
    # Another turn has read nothing yet; after another member's edit, a new read is needed.
    assert (await use(hub, "write_file", turn=9, path="plan.md", content="x")).kind == "not_read"
    assert (await use(hub, "read_file", turn=9, path="plan.md")).ok
    workspace(runtime, "plan.md").write_text("a colleague's\n", encoding="utf-8")
    assert (await use(hub, "write_file", turn=9, path="plan.md", content="x")).kind == "changed_since_read"


async def test_a_picture_comes_back_as_an_image_for_a_model_that_reads_them(computer):
    hub, runtime = computer
    workspace(runtime, "chart.png").write_bytes(PNG)
    result = await use(hub, "read_file", path="chart.png")
    assert result.ok and result.text == f"Picture {GUEST}/chart.png (image/png, {len(PNG)} bytes). It is attached as an image."
    assert result.blocks == [{"type": "image", "data": base64.b64encode(PNG).decode(), "mimeType": "image/png"}]


async def test_a_picture_whose_name_does_not_say_so_is_still_read_whole(computer, monkeypatch):
    hub, runtime = computer
    monkeypatch.setattr(file_tools, "READ_BYTES", 64)  # a text read takes less than the picture is
    picture = PNG + b"\x00" * 500
    workspace(runtime, "photo").write_bytes(picture)
    result = await use(hub, "read_file", path="photo")
    assert result.ok and base64.b64decode(result.blocks[0]["data"]) == picture


async def test_a_model_that_does_not_read_pictures_is_told_what_the_vision_service_sees(computer):
    from raphael_core.computer.vm_tools import vm_scope
    hub, runtime = computer
    workspace(runtime, "chart.png").write_bytes(PNG)
    asked = []

    async def describe(images):
        asked.append([(image.name, image.mime, image.data) for image in images])
        return True, "A bar chart with three bars.", None
    tool = next(tool for tool in hub.offered() if tool.name == "read_file")
    with vm_scope(("turn", 0, 1), turn_id=7, see=(lambda: False, describe)):
        result = await hub.call(tool.key, {"path": "chart.png"}, approver="auto")
    assert result.ok and not result.blocks
    assert result.text.endswith("What the picture reader sees in it:\nA bar chart with three bars.")
    assert asked == [[("chart.png", "image/png", PNG)]]
    with vm_scope(("turn", 0, 1), turn_id=7, see=(lambda: True, describe)):
        assert (await hub.call(tool.key, {"path": "chart.png"}, approver="auto")).blocks
    assert len(asked) == 1, "a model that reads pictures gets the picture itself"


def test_whether_the_turns_model_reads_pictures_comes_from_its_brain_and_the_catalog():
    from types import SimpleNamespace

    from raphael_core.agent.service import AgentService
    settings = SimpleNamespace(model="cli:claude:opus")
    sees = {"value": False}
    service = SimpleNamespace(_read_settings=lambda speaker, conversation: settings, _on_its_service=lambda model: model,
                              _tools=SimpleNamespace(services=SimpleNamespace(reads_images=lambda model: sees["value"])))
    ask = SimpleNamespace(speaker=None, conversation_id=1)
    assert AgentService._reads_images(service, ask) is True  # a CLI brain reads the picture itself
    settings.model = "vendor/text-only"
    assert AgentService._reads_images(service, ask) is False  # the list says it reads none: the vision service
    sees["value"] = None
    assert AgentService._reads_images(service, ask) is True  # unknown: sent as a screenshot is


async def test_a_pdf_comes_as_the_text_of_its_pages(computer, monkeypatch):
    from raphael_core.services import pdf
    hub, runtime = computer
    workspace(runtime, "report.pdf").write_bytes(b"%PDF-1.7\n" + b"x" * 64)
    monkeypatch.setattr(pdf, "page_texts", lambda data: (30, [(number, f"text of page {number}") for number in range(1, 31) if number != 3], [3]))
    first = await use(hub, "read_file", path="report.pdf")
    assert first.ok and first.text.startswith(f"PDF {GUEST}/report.pdf, 30 pages.\n[Page 1]\ntext of page 1\n\n[Page 2]")
    assert "[Pages with no text layer (scans) in this range: 3.]" in first.text and "[Page 21]" not in first.text
    assert first.text.endswith('[Pages 1-20 of 30 are shown. Read on with read_file (pages "21-30").]')
    some = await use(hub, "read_file", path="report.pdf", pages="29-30")
    assert "[Page 29]" in some.text and "[Page 30]" in some.text and "[Page 28]" not in some.text
    assert (await use(hub, "read_file", path="report.pdf", pages="1-30")).kind == "bad_arguments"


def test_the_shared_line_reader_numbers_a_part_from_its_own_first_line():
    found = read_lines("c\nd\n", offset=3, limit=5, first=3, total=4)
    assert found["text"] == numbered(3, "c", "d") and found["end_reached"] and "next_offset" not in found
    more = read_lines("c\nd\n", offset=3, limit=1, first=3, total=4, again="read_attachment")
    assert more["next_offset"] == 4 and more["note"] == "[Lines 3-3 of 4 are shown. Read on with read_attachment (offset 4).]"


def test_read_file_is_listed_whole_and_its_old_rounds_shrink_to_one_line():
    from raphael_core.worker.context import one_line
    from raphael_core.worker.guards import wrap_untrusted
    from raphael_core.worker.tool_guardrails import READ_ONLY
    definition = file_tools.DEFINITIONS["read_file"]
    assert "Claude Code's Read" in definition["description"] and set(definition["parameters"]["properties"]) == {"path", "offset", "limit", "pages"}
    line = one_line("computer__read_file", json.dumps({"path": "notes.md"}), wrap_untrusted("computer__read_file", "x" * 1200, ok=True))
    assert line.startswith("[computer__read_file] read notes.md (1,200 chars)")
    assert {"read_file", "glob", "grep"} <= READ_ONLY

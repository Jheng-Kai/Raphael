"""A long text file is a file a member reads like Claude Code's Read: numbered lines, 2000 a call, a long line cut,
and the line to go on from (R-ATTACH-RAW-02, R-ATTACH-RAW-03)."""

import base64
import json
from dataclasses import replace

import pytest

from raphael_core.agent.attachment_inputs import text_context
from raphael_core.agent.ledger import Ledger
from raphael_core.agent.tools import Tools
from raphael_core.brain.spend import SpendTracker
from raphael_core.services.attachment_store import AttachmentStore
from raphael_core.services.attachments import Attachment, checked
from raphael_core.services.file_reader import LINE_CHARS, LINE_LIMIT, READ_CHARS, read_lines, read_window

from .test_earlier_files import ask
from .test_narration import chat
from .test_service import make_rig  # noqa: F401

FONT = base64.b64encode(bytes((n * 7 + n // 256) % 256 for n in range(75_000))).decode()
assert len(FONT) == 100_000


def page(rules: int) -> str:
    """The owner's design file: a 100 KB font inside `@font-face` on the first line, then the style, markup and script."""
    style = "".join(f".card-{n}{{font-family:'Brand';padding:{n}px}}\n" for n in range(rules))
    return ('<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>@font-face{font-family:"Brand";'
            f'src:url(data:font/woff2;base64,{FONT}) format("woff2")}}\n' + style
            + '</style></head><body><main class="hero"><h1>授業</h1></main>\n'
            '<script>const END_OF_PAGE = 1;</script></body></html>\n')


def file(source: str | bytes, name: str = "design.html", mime: str = "text/html") -> Attachment:
    return replace(checked(name, mime, source if isinstance(source, bytes) else source.encode()),
                   stored_id="0123456789abcdef0123456789abcdef.html")


def plain(found: dict) -> list[str]:
    """The lines of a result without their numbers, which are checked to count on from the offset."""
    rows = found["text"].split("\n") if found["text"] else []
    assert [row.split("\t", 1)[0].strip() for row in rows] == [str(n) for n in range(found["offset"], found["offset"] + len(rows))]
    return [row.split("\t", 1)[1] for row in rows]


def test_a_design_file_with_an_embedded_font_is_read_whole_with_its_style_markup_and_script():
    source = page(300)
    assert len(source) > 100_000
    found = read_lines(file(source), number=1)
    lines = plain(found)
    # The font line keeps what is around the data and shows the data as a marker; every other line is the file's.
    assert lines[0].startswith('<!doctype html><html lang="ja">') and "@font-face{font-family:\"Brand\";src:url(data:font/woff2;base64," in lines[0]
    assert "[98 KB of base64 data elided]) format(\"woff2\")}" in lines[0] and FONT[:200] not in found["text"]
    assert lines[1:] == source.split("\n")[1:-1]
    assert ".card-299{" in found["text"] and "const END_OF_PAGE = 1;" in lines[-1] and '<main class="hero">' in found["text"]
    assert found["end_reached"] is True and found["truncated"] is False and "next_offset" not in found
    assert found["total_lines"] == len(lines) == 303 and found["elided_characters"] == 100_000
    assert "long_lines_cut" not in found and "stored file is unchanged" in found["note"]


def test_a_line_over_2000_characters_is_cut_with_a_note_of_what_was_left():
    source = "first\n" + "a{b:c}" * 10_000 + "\nlast\n"
    found = read_lines(file(source, "min.css", "text/css"))
    first, long, last = plain(found)
    assert first == "first" and last == "last"
    assert long.startswith("a{b:c}" * 333) and long.endswith("… [58000 more characters]")
    assert len(long) < LINE_CHARS + 40 and found["long_lines_cut"] == 1 and "longer than 2000 characters" in found["note"]
    assert found["end_reached"] is True


def test_it_says_when_there_is_more_and_from_which_line_and_each_page_joins_the_next():
    lines = [f"line {n}" for n in range(1, 5001)]
    attachment = file("\n".join(lines) + "\n", "log.txt", "text/plain")
    first = read_lines(attachment, number=1)
    assert plain(first) == lines[:LINE_LIMIT] and first["lines"] == LINE_LIMIT and first["end_reached"] is False
    assert first["next_offset"] == 2001 and first["total_lines"] == 5000 and "read_attachment (index 1, offset 2001)" in first["note"]
    assert "Lines 1-2000 of 5000" in first["note"]
    second = read_lines(attachment, number=1, offset=2001)
    assert plain(second) == lines[2000:4000] and second["next_offset"] == 4001
    last = read_lines(attachment, number=1, offset=4001)
    assert plain(last) == lines[4000:] and last["end_reached"] is True and "next_offset" not in last and "note" not in last
    # `limit` is a number of lines.
    few = read_lines(attachment, offset=10, limit=3)
    assert plain(few) == lines[9:12] and few["next_offset"] == 13


def test_a_page_of_very_long_lines_stops_at_the_character_cap_and_goes_on_from_there():
    lines = [f"{n:04d} " + "word " * 400 for n in range(300)]
    attachment = file("\n".join(lines), "wide.txt", "text/plain")
    seen, offset = [], 1
    for _ in range(20):
        found = read_lines(attachment, offset=offset)
        assert len(found["text"]) <= READ_CHARS + 20
        seen += plain(found)
        if found["end_reached"]:
            break
        offset = found["next_offset"]
    assert found["end_reached"] and seen == [line[:LINE_CHARS] + f"… [{len(line) - LINE_CHARS} more characters]" if len(line) > LINE_CHARS else line for line in lines]
    assert offset > 1


def test_the_edges_of_a_file():
    assert read_lines(Attachment("empty.txt", "text/plain", b""))["note"] == "[The file is empty.]"
    short = read_lines(file("a\nb", "t.txt", "text/plain"), offset=5)
    assert short["text"] == "" and short["end_reached"] is True and "offset 5 is past its end" in short["note"]
    # Windows line ends and a missing final line end give the same lines.
    assert plain(read_lines(file("a\r\nb\r\n", "t.txt", "text/plain"))) == ["a", "b"]
    assert plain(read_lines(file("a\nb", "t.txt", "text/plain"))) == ["a", "b"]
    for encoding in ("utf-8-sig", "utf-16", "big5"):
        found = read_lines(file("日本語\n先生\n".encode(encoding), "t.txt", "text/plain"))
        assert plain(found) == ["日本語", "先生"]
    assert read_lines(checked("a.png", "image/png", b"\x89PNG\r\n\x1a\n")) is None


def test_the_tool_arguments_are_checked():
    assert read_window({"index": 1}) == {}
    assert read_window({"index": 1, "offset": 20, "limit": 50}) == {"offset": 20, "limit": 50}
    for bad in ({"offset": 0}, {"offset": -1}, {"offset": "5"}, {"offset": True}, {"limit": 0}, {"limit": 1.5}):
        assert read_window(bad) is None


def test_a_file_that_fits_the_message_is_still_pasted_as_written():
    source = '<style>.a{color:red}</style>\n<img src="data:image/png;base64,' + FONT[:3000] + '">\n'
    prompt = text_context([file(source)])
    assert source in prompt and "Not pasted" not in prompt and '"truncated": false' in prompt


def test_a_long_file_is_never_pasted_but_named_with_what_a_member_needs_to_read_it():
    source = page(3000)
    prompt = text_context([file(source)], {file(source).stored_id: "C:\\Raphael\\attachments\\x.html"})
    facts = json.loads(prompt[prompt.index('{"file"'):].split("\n", 1)[0])
    assert facts["lines"] == 3003 and facts["pasted"] is False and facts["size"] == len(source.encode())
    assert "read_attachment (index 1, offset 1)" in prompt and "C:\\Raphael\\attachments\\x.html" in prompt
    assert FONT[:100] not in prompt and ".card-0{" not in prompt and len(prompt) < 3000


async def test_the_read_attachment_tool_reads_the_owners_file_on_and_never_changes_it(conn, tmp_path):
    source = page(3000)
    store = AttachmentStore(tmp_path)
    saved = store.save(checked("design.html", "text/html", source.encode()))
    kept = store.path(saved.stored_id).read_bytes()
    tools, ledger = Tools(object()), Ledger(SpendTracker(conn))
    first = await tools.read_attachment(saved, "", ledger, number=1)
    assert first.ok and first.untrusted and first.data["file"] == 1 and first.data["kind"] == "text"
    assert "[98 KB of base64 data elided]" in first.data["text"] and first.data["end_reached"] is False
    # 3000 short lines are more than one call carries: it stops where it says and the next call goes on from there.
    seen = plain(first.data)
    rest = await tools.read_attachment(saved, "", ledger, number=1, offset=first.data["next_offset"])
    while not rest.data["end_reached"]:
        seen += plain(rest.data)
        rest = await tools.read_attachment(saved, "", ledger, number=1, offset=rest.data["next_offset"])
    assert seen[1:] + plain(rest.data) == source.split("\n")[1:-1]
    assert store.path(saved.stored_id).read_bytes() == kept == source.encode()


async def test_a_member_reads_on_with_offset_and_limit_through_the_tool_call(make_rig, client, tmp_path):
    source = page(3000)
    rig = make_rig(attachment_store=AttachmentStore(tmp_path))
    client.chats = [chat("", ("read_attachment", {"index": 1, "offset": 2, "limit": 2})), chat("Read it")]
    result = await rig.call("agent.ask", ask("design", "Copy this design", [("design.html", "text/html", source.encode())]))
    assert result["text"] == "Read it"
    prompt = client.chat_calls[0]["messages"][1]["content"]
    assert "Not pasted" in prompt and "read_attachment (index 1, offset 1)" in prompt and FONT[:100] not in prompt
    given = str(client.chat_calls[1]["messages"])
    assert ".card-0{font-family" in given and ".card-1{font-family" in given and ".card-2{" not in given
    assert "Lines 2-3 of 3003 are shown. Read on with read_attachment (index 1, offset 4)" in given

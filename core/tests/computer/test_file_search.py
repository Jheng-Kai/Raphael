"""A member's file search on its own computer, as Claude Code's Glob and Grep, on ripgrep (R-FILE-04, R-FILE-05).

The fake docker answers ripgrep from a script: these tests prove the command line the computer is sent and what is
made of ripgrep's answer, not ripgrep itself (it is in the computer image, `computer/image/Dockerfile`).
"""

import pytest

from raphael_core.computer.vm import GUEST, Result

from .test_file_tools import GuestRuntime, computer, use  # noqa: F401

SKIPPED = ("!.git", "!.browser-profiles", "!.raphael-checkpoints", "!.raphael-jobs")


class Ripgrep:
    """The answers ripgrep gives, one per call, and the arguments each call was given (what follows the folder)."""

    def __init__(self, runtime, *answers):
        self.answers, self.seen = list(answers), []
        original = runtime.__class__.__call__

        async def call(args, **kwargs):
            if args[0] == "exec" and "sh" in args and any("exec timeout" in str(arg) and " rg " in str(arg) for arg in args):
                script = next(index for index, arg in enumerate(args) if " rg " in str(arg))
                self.seen.append(args[script + 2:])
                return self.answers.pop(0)
            return await original(runtime, args, **kwargs)
        runtime.__call__ = call
        runtime.run = call


def answer(*rows, cwd=GUEST, code=0, stderr="", separator="\0"):
    return Result(code, cwd + "\n" + "".join(row + separator for row in rows), stderr)


def flags(seen):
    folder, *rest = seen
    return folder, rest


async def search(hub, runtime, name, *answers, **arguments):
    rg = Ripgrep(runtime, *answers)
    hub.vm.run = runtime.run
    result = await use(hub, name, **arguments)
    return result, rg


# --- grep -----------------------------------------------------------------------------------------------------------


async def test_grep_lists_the_files_that_match_newest_first_as_claude_codes_default(computer):
    hub, runtime = computer
    result, rg = await search(hub, runtime, "grep", answer("./b.py", "./sub/a.py"), pattern="def main", glob="*.py")
    assert result.ok and result.text == f"Found 2 files\n{GUEST}/b.py\n{GUEST}/sub/a.py"
    folder, sent = flags(rg.seen[0])
    assert folder == GUEST
    assert {"--files-with-matches", "--sortr=modified", "--hidden", "--null", "--no-messages"} <= set(sent)
    assert sent[-2:] == ["--regexp", "def main"]
    globs = [sent[index + 1] for index, flag in enumerate(sent) if flag == "--glob"]
    # The member's filter first and the skipped folders last: ripgrep lets the later glob win.
    assert globs == ["*.py", *SKIPPED]


async def test_grep_content_gives_numbered_lines_and_context_as_ripgrep_does(computer):
    hub, runtime = computer
    rows = ("./app.py\x003-import os", "./app.py\x004:def main():", "./app.py\x005-    pass", "--",
            "./lib/x.py\x0010:def main_loop():")
    result, rg = await search(hub, runtime, "grep", answer(*rows, separator="\n"), pattern="def main",
                              output_mode="content", path="src", after=1, before=1, ignore_case=True, type="py")
    assert result.ok
    assert result.text.splitlines() == [f"{GUEST}/app.py-3-import os", f"{GUEST}/app.py:4:def main():",
                                        f"{GUEST}/app.py-5-    pass", "--", f"{GUEST}/lib/x.py:10:def main_loop():"]
    folder, sent = flags(rg.seen[0])
    assert folder == f"{GUEST}/src"
    assert {"--line-number", "--with-filename", "--no-heading", "--ignore-case", "--sort=path"} <= set(sent)
    assert sent[sent.index("--after-context") + 1] == "1" and sent[sent.index("--before-context") + 1] == "1"
    assert sent[sent.index("--type") + 1] == "py" and "--max-columns=2000" in sent
    assert "--files-with-matches" not in sent


async def test_grep_context_multiline_and_no_line_numbers_are_passed_on(computer):
    hub, runtime = computer
    for arguments, expected, absent in (({"context": 2}, ["--context", "2"], "--line-number"),
                                        ({"context": 3}, ["--context", "3"], "--line-number"),
                                        ({"multiline": True}, ["--multiline", "--multiline-dotall"], "--no-line-number")):
        options = {"line_numbers": False} if absent == "--line-number" else {}
        result, rg = await search(hub, runtime, "grep", answer("./a.txt\x00x", separator="\n"), pattern="a.b",
                                  output_mode="content", **options, **arguments)
        assert result.ok
        sent = flags(rg.seen[0])[1]
        assert all(flag in sent for flag in expected) and absent not in sent


async def test_grep_count_says_how_many_in_each_file_and_in_all(computer):
    hub, runtime = computer
    result, rg = await search(hub, runtime, "grep", answer("./a.txt\x003", "./b.txt\x002", separator="\n"),
                              pattern="todo", output_mode="count")
    assert result.ok and result.text == (f"{GUEST}/a.txt:3\n{GUEST}/b.txt:2\n\n"
                                         "Found 5 total occurrences across 2 files.")
    assert "--count-matches" in flags(rg.seen[0])[1]


async def test_grep_pages_with_head_limit_and_offset(computer):
    hub, runtime = computer
    files = [f"./f{number:03}.txt" for number in range(300)]
    first, _ = await search(hub, runtime, "grep", answer(*files), pattern="x")
    listed = first.text.splitlines()
    assert listed[0] == "Found 300 files" and len(listed) == 1 + 250 + 1, "250 by default, as Claude Code's"
    assert listed[-1] == "[Showing results 1-250 of 300. Call again with offset 250 for the next ones.]"
    rest, _ = await search(hub, runtime, "grep", answer(*files), pattern="x", offset=250)
    assert rest.text.splitlines()[1] == f"{GUEST}/f250.txt" and len(rest.text.splitlines()) == 1 + 50
    every, _ = await search(hub, runtime, "grep", answer(*files), pattern="x", head_limit=0)
    assert len(every.text.splitlines()) == 301
    few, _ = await search(hub, runtime, "grep", answer(*files), pattern="x", head_limit=10, offset=5)
    assert few.text.splitlines()[1] == f"{GUEST}/f005.txt" and "offset 15" in few.text.splitlines()[-1]


async def test_no_match_is_a_result_and_a_bad_pattern_or_path_says_why(computer):
    hub, runtime = computer
    none, _ = await search(hub, runtime, "grep", answer(code=1), pattern="absent")
    assert none.ok and none.text == "No files found"
    none, _ = await search(hub, runtime, "grep", answer(code=1), pattern="absent", output_mode="content")
    assert none.ok and none.text == "No matches found"
    bad, _ = await search(hub, runtime, "grep", answer(code=2, stderr="regex parse error:\n    (unclosed\n    ^\nerror: unclosed group"),
                          pattern="(unclosed")
    assert not bad.ok and bad.kind == "search_failed" and "unclosed group" in bad.text
    gone, _ = await search(hub, runtime, "grep", Result(3, "", ""), pattern="x", path="nowhere")
    assert not gone.ok and gone.kind == "path_missing" and gone.text == f"Path does not exist: {GUEST}/nowhere"
    # Matches found while some files could not be read are still the matches.
    partial, _ = await search(hub, runtime, "grep", answer("./a.txt", code=2), pattern="x")
    assert partial.ok and f"{GUEST}/a.txt" in partial.text


async def test_a_pattern_that_starts_with_a_dash_is_a_pattern_and_a_file_path_is_searched_alone(computer):
    hub, runtime = computer
    result, rg = await search(hub, runtime, "grep", answer("notes.md", cwd=f"{GUEST}/docs"), pattern="-v", path="docs/notes.md")
    assert result.ok and result.text == f"Found 1 file\n{GUEST}/docs/notes.md"
    folder, sent = flags(rg.seen[0])
    assert folder == f"{GUEST}/docs/notes.md" and sent[-2:] == ["--regexp", "-v"]


# --- glob -----------------------------------------------------------------------------------------------------------


async def test_glob_lists_matching_files_newest_first_and_at_most_a_hundred(computer):
    hub, runtime = computer
    files = [f"./src/m{number}.ts" for number in range(150)]
    result, rg = await search(hub, runtime, "glob", answer(*files), pattern="src/**/*.ts")
    lines = result.text.splitlines()
    assert result.ok and lines[:2] == [f"{GUEST}/src/m0.ts", f"{GUEST}/src/m1.ts"] and len(lines) == 101
    assert lines[-1] == "(Results are truncated. Consider using a more specific path or pattern.)"
    folder, sent = flags(rg.seen[0])
    assert folder == GUEST and {"--files", "--sortr=modified", "--hidden", "--null"} <= set(sent)
    globs = [sent[index + 1] for index, flag in enumerate(sent) if flag == "--glob"]
    assert globs == ["src/**/*.ts", *SKIPPED] and "--regexp" not in sent


async def test_glob_with_nothing_found_or_no_folder(computer):
    hub, runtime = computer
    none, _ = await search(hub, runtime, "glob", answer(code=1), pattern="*.nothing", path="/home/cua/team")
    assert none.ok and none.text == "No files found"
    gone, _ = await search(hub, runtime, "glob", Result(3, "", ""), pattern="*", path="missing")
    assert gone.kind == "path_missing"


async def test_the_searches_are_reads_listed_whole(computer):
    hub, _ = computer
    tools = {tool.name: tool for tool in hub.offered()}
    for name in ("glob", "grep"):
        assert tools[name].whole and tools[name].pinned and "Claude Code" in tools[name].description
        assert hub.kind_of("computer", name) == "read"
    for option in ("ignore_case", "line_numbers", "after", "before", "context", "output_mode", "head_limit", "offset", "glob", "type", "multiline"):
        assert option in tools["grep"].schema["properties"]


@pytest.mark.parametrize("name", ["glob", "grep"])
async def test_a_search_takes_no_checkpoint_and_no_screen(computer, name):
    hub, runtime = computer
    result, _ = await search(hub, runtime, name, answer(code=1), pattern="x")
    assert result.ok
    assert not any(any(str(arg).startswith('"""Guest-only file checkpoints') for arg in args) for args, _ in runtime.calls)
    assert not hub.leases

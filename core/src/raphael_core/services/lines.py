"""Text read in lines, as Claude Code's Read gives a file: numbered like `cat -n`, 2000 lines a call from a line the
caller names, a line over 2000 characters cut with a note, and the line to go on from when there is more.

Shared by every tool that reads a text file to a model (a member's computer's `read_file`; an owner's attachment reads
in lines on their own branch, fix/u-attach-read-on, with the same numbers): one shape of a read, whatever the file is.
"""

LINE_LIMIT = 2000
LINE_CHARS = 2000
# The most characters one read returns, so that 2000 long lines never fill the window; the next read goes on from there.
READ_CHARS = 60_000


def shown(line: str) -> tuple[str, bool]:
    """A line as it is shown, and whether it was cut: what is over LINE_CHARS is left out with how much."""
    if len(line) <= LINE_CHARS:
        return line, False
    return f"{line[:LINE_CHARS]}… [{len(line) - LINE_CHARS:,} more characters]", True


def read_lines(text: str, *, offset: int = 1, limit: int | None = None, first: int = 1, total: int | None = None,
               partial: bool = False, again: str = "read_file") -> dict:
    """Lines `offset`..`offset + limit - 1` (1-based; limit 2000 by default) of a text whose first line here is line
    `first` of the file (a reader may send only the part from a line on) and which has `total` lines in all (counted
    from `text` when not given). `partial` says `text` stops before the file does. Each line is numbered as `cat -n`
    numbers it (the number and the tab are not part of the line). The answer: `text`, `offset`, `lines`, `total_lines`,
    `end_reached`, and, when there is more, `next_offset` and a note that names the call (`again`) that reads it."""
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    known = first - 1 + len(lines)
    total = known if total is None else total
    rows, used, cut = [], 0, 0
    for index in range(max(offset, first) - first, min(len(lines), offset - first + (limit or LINE_LIMIT))):
        line, was_cut = shown(lines[index].removesuffix("\r"))
        row = f"{first + index:>6}\t{line}"
        if rows and used + len(row) + 1 > READ_CHARS:
            break
        rows.append(row)
        used += len(row) + 1
        cut += was_cut
    last = offset - 1 + len(rows)
    reached = last >= total and not (partial and last >= known)
    result = {"text": "\n".join(rows), "offset": offset, "lines": len(rows), "total_lines": total,
              "end_reached": reached}
    notes = []
    if not total:
        notes.append("The file is empty.")
    elif offset > total:
        notes.append(f"The file has {total:,} lines; offset {offset:,} is past its end.")
    if cut:
        notes.append(f"{cut} line{'s' if cut > 1 else ''} longer than {LINE_CHARS:,} characters {'were' if cut > 1 else 'was'} "
                     "cut where it says so.")
    if not reached and rows:
        result["next_offset"] = last + 1
        notes.append(f"Lines {offset:,}-{last:,} of {total:,} are shown. Read on with {again} (offset {last + 1}).")
    if notes:
        result["note"] = "[" + " ".join(notes) + "]"
    return result

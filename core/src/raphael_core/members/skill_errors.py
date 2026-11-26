"""The causes of a refused skill import, each in the library's own words with what the window needs to say it.

A refusal is a `MemberError` whose kind leads the message and whose `detail` (`reason` first) the window reads to say the
cause in the owner's language: which file, how large, which limit, which line. Nothing here is a limit itself.
"""

from .store import MemberError


def size_text(number):
    """A byte count as a person reads it: `3.2 MB`."""
    value = float(number)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1024


def oversized_file(path, size, limit):
    return MemberError("size", f"{path} is {size_text(size)}, over the {size_text(limit)} a skill document may be",
                       reason="file", file=path, size=size, limit=limit)


def oversized_package(path, size, limit):
    """What one import holds in memory is the only size that is bounded; `path` is the file that crossed the limit."""
    return MemberError("size", f"the files of this import come to more than {size_text(limit)} (at {path}, {size_text(size)}): "
                       "import a smaller folder", reason="package", file=path, size=size, limit=limit)


def too_many_files(count, limit, path=""):
    return MemberError("size", f"this import holds more than {limit} files", reason="files", count=count, limit=limit,
                       file=path)


def unsafe_path(path):
    return MemberError("archive", f"{path} is not a path a skill may hold", reason="path", file=path)


def refused_entry(path, why):
    return MemberError("archive", f"{path} is {why}", reason="entry", file=path)


def unreadable_archive():
    return MemberError("archive", "this archive cannot be read", reason="unreadable")


def no_skill(where=""):
    return MemberError("not_found", "no SKILL.md was found" + (f" in {where}" if where else ""), reason="no_skill")


def not_utf8(path="SKILL.md"):
    return MemberError("skill", f"{path} must be UTF-8 Markdown", reason="encoding", file=path)


def front_matter(problem, line, path=""):
    words = {"none": "starts with no front matter (--- name and description ---)",
             "unclosed": "opens its front matter and never closes it with ---",
             "no_description": "has no description in its front matter"}[problem]
    return MemberError("skill", f"{path or 'the skill document'} {words} (line {line})", reason="front_matter",
                       problem=problem, line=line, **({"file": path} if path else {}))

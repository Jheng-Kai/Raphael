"""Markdown as the HTML subset Telegram renders, and that HTML cut into messages it accepts.

The assistant writes Markdown (the app renders it). Telegram's `parse_mode=HTML` understands only
<b> <i> <s> <code> <pre> <a> <blockquote>, so everything else is escaped and a Markdown construct
without an equivalent (a table, a list) is kept as the text it is. Nothing is summarised or cut:
the converted text has all the words of the source.
"""

import re
from html import unescape

MAX_MESSAGE_UNITS = 4096

_FENCE_OPEN = re.compile(r"^[ \t]*(`{3,}|~{3,})[ \t]*([\w+#.-]*)[^\n]*$")
_HEADING = re.compile(r"^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t#]*$")
_RULE = re.compile(r"^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$")
_QUOTE = re.compile(r"^[ \t]{0,3}>[ \t]?(.*)$")

# One inline construct per match; the order is the order of preference at one position.
_INLINE = re.compile(
    "|".join(
        [
            r"(?P<ticks>`+)(?P<code>.+?)(?<!`)(?P=ticks)(?!`)",
            r"\[(?P<label>[^\]\n]+)\]\((?P<url>(?:https?|tg|mailto):[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)\)",
            r"\*\*(?P<bold>(?!\s).+?(?<!\s))\*\*",
            r"(?<!\w)__(?P<bold2>(?!\s).+?(?<!\s))__(?!\w)",
            r"~~(?P<strike>(?!\s).+?(?<!\s))~~",
            r"(?<![\w*])\*(?P<italic>(?![\s*])[^*\n]+?(?<![\s*]))\*(?![\w*])",
            # An underscore inside a word (snake_case) is never emphasis.
            r"(?<![\w_])_(?P<italic2>(?![\s_])[^_\n]+?(?<![\s_]))_(?![\w_])",
        ]
    )
)


def escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _inline(text: str) -> str:
    out: list[str] = []
    position = 0
    for found in _INLINE.finditer(text):
        out.append(escape(text[position : found.start()]))
        position = found.end()
        if found["ticks"] is not None:
            out.append(f"<code>{escape(found['code'])}</code>")
        elif found["url"] is not None:
            href = escape(found["url"]).replace('"', "&quot;")
            out.append(f'<a href="{href}">{_inline(found["label"])}</a>')
        else:
            for group, tag in (
                ("bold", "b"), ("bold2", "b"), ("strike", "s"), ("italic", "i"), ("italic2", "i")
            ):
                if found[group] is not None:
                    out.append(f"<{tag}>{_inline(found[group])}</{tag}>")
                    break
    out.append(escape(text[position:]))
    return "".join(out)


def _is_table_row(line: str) -> bool:
    return line.lstrip().startswith("|")


def markdown_to_html(text: str) -> str:
    """`text` (Markdown) as Telegram HTML."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if (fence := _FENCE_OPEN.match(line)) is not None:
            marker, language = fence[1], fence[2]
            close = re.compile(rf"^[ \t]*{re.escape(marker[0])}{{{len(marker)},}}[ \t]*$")
            i += 1
            body: list[str] = []
            while i < len(lines) and not close.match(lines[i]):  # an unclosed fence runs to the end
                body.append(lines[i])
                i += 1
            i += 1
            if "".join(body).strip():
                shape = f' class="language-{language}"' if language else ""
                out.append(f"<pre><code{shape}>{escape(chr(10).join(body))}</code></pre>")
            continue
        if _is_table_row(line) and i + 1 < len(lines) and _is_table_row(lines[i + 1]):
            rows: list[str] = []
            while i < len(lines) and _is_table_row(lines[i]):
                rows.append(lines[i].strip())
                i += 1
            out.append(f"<pre>{escape(chr(10).join(rows))}</pre>")
            continue
        if _QUOTE.match(line):
            quoted: list[str] = []
            while i < len(lines) and (quote := _QUOTE.match(lines[i])) is not None:
                quoted.append(_inline(quote[1]))
                i += 1
            out.append(f"<blockquote>{chr(10).join(quoted)}</blockquote>")
            continue
        i += 1
        if _RULE.match(line):
            out.append("———")
        elif (heading := _HEADING.match(line)) is not None:
            out.append(f"<b>{_inline(re.sub(r'\*\*|__', '', heading[1]))}</b>")
        else:
            out.append(_inline(line))
    return "\n".join(out)


# --- cutting the HTML into messages ------------------------------------------------------------

# A tag, a character reference that must stay whole, or one character.
_ATOM = re.compile(r"<[^>]*>|&(?:amp|lt|gt|quot);|.", re.S)
_TAG_NAME = re.compile(r"</?([A-Za-z][\w-]*)")


def _units(text: str) -> int:
    """Telegram counts the length of a message in UTF-16 code units."""
    return len(text.encode("utf-16-le")) // 2


def _closers(stack: list[tuple[str, str]]) -> str:
    return "".join(f"</{name}>" for name, _ in reversed(stack))


def _advance(stack: list[tuple[str, str]], atom: str) -> list[tuple[str, str]]:
    """The tags left open once `atom` has been written (`stack` itself is never changed)."""
    if not atom.startswith("<") or (named := _TAG_NAME.match(atom)) is None:
        return stack
    if atom.startswith("</"):
        for index in range(len(stack) - 1, -1, -1):
            if stack[index][0] == named[1]:
                return stack[:index]
        return stack
    return [*stack, (named[1], atom)]


def split_html(html: str, limit: int = MAX_MESSAGE_UNITS) -> list[str]:
    """`html` in messages of at most `limit` UTF-16 units (counting its tags, which Telegram does
    not, so a message is never over), cut at a blank line, a line break or a space where one is near.
    A tag open at a cut is closed there and opened again at the start of the next message, so a
    <pre> block or a link is whole in each of its pieces."""
    atoms = _ATOM.findall(html)
    messages: list[str] = []
    start = 0
    carried: list[tuple[str, str]] = []
    while start < len(atoms):
        stack = carried
        used = _units("".join(tag for _, tag in carried))
        marks: dict[str, tuple[int, list[tuple[str, str]]]] = {}
        index = start
        while index < len(atoms):
            atom = atoms[index]
            following = _advance(stack, atom)
            if index > start and used + _units(atom) + _units(_closers(following)) > limit:
                break
            used += _units(atom)
            stack = following
            index += 1
            if atom in ("\n", " "):
                paragraph = atom == "\n" and index - 2 >= start and atoms[index - 2] == "\n"
                marks["\n\n" if paragraph else atom] = (index, stack)
        end, left_open = index, stack
        if index < len(atoms):
            for mark in ("\n\n", "\n", " "):
                found = marks.get(mark)
                if found is not None and found[0] - start >= (index - start) // 2:
                    end, left_open = found
                    break
        body = "".join(atoms[start:end]).rstrip()
        message = "".join(tag for _, tag in carried) + body + _closers(left_open)
        if re.sub(r"<[^>]*>", "", message).strip():
            messages.append(message)
        while end < len(atoms) and atoms[end] in ("\n", " ") and not left_open:
            end += 1
        start, carried = end, left_open
    return messages


def telegram_messages(text: str, limit: int = MAX_MESSAGE_UNITS) -> list[str]:
    """`text` (Markdown) as the messages of Telegram HTML to send, in order."""
    return split_html(markdown_to_html(text.strip("\n")), limit)


def plain_text(html: str) -> str:
    """The words of a message of Telegram HTML without its tags: what is sent when Telegram
    refuses the markup."""
    return unescape(re.sub(r"<[^>]*>", "", html))

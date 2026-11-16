"""What a message to an outside chat names that the owner's phone cannot open, and what goes in its place (R-MSG-LINK-03).

A member writes for the app on this computer, where a path in its own computer, an `attachment:` link, a page this PC
serves or a local address opens with a click. Over Telegram, Slack or Discord the owner reads on a phone, which reaches
the public web and nothing of this PC, of the member's computer or of a private network: there such a link is dead.
Every message to such a chat passes `deliverable` on its way out (`Switchboard.tell`, whatever made the message: a reply,
a task's report, a routine). A link `unreachable` judges a phone cannot open goes as the file it names when the core
finds one (`LinkedFiles`: the member's computer folders, the attachment store, a page of the app) and its words become
that file's name; anything else is said in plain words in its place. A public link is never touched. Nothing here reads
the words around a link, so it works the same in every language.
"""

import asyncio
import ipaddress
import json
import logging
import mimetypes
import re
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path, PurePosixPath, PureWindowsPath
from urllib.parse import unquote, urlsplit

from ..agent.opening import _LOCAL_ENDINGS as LOCAL_ENDINGS
from ..services.attachments import Attachment as File
from .words import words

logger = logging.getLogger(__name__)

# The most files the links of one delivery send, the largest one of them and the most bytes they come to.
MAX_LINKED_FILES = 10
LINKED_FILE_BYTES = 50 * 1024 * 1024
MAX_LINKED_BYTES = 100 * 1024 * 1024

# The kinds `unreachable` tells apart: a file or folder of a computer, a file of the app's store, a page this PC's page
# host serves, and any other address a phone cannot reach.
PATH, ATTACHMENT, PAGE, LOCAL = "path", "attachment", "page", "local"
# What a lookup is asked (kind, target) and answers: the file the link names, or None.
Find = Callable[[str, str], Awaitable[File | None]]

# An address's characters: printable ASCII but quotes, angle brackets and the backtick. An address that runs into the
# words of a sentence written without a space (Chinese, Japanese) ends where they begin.
_ADDRESS = r"[!#-&(-;=?-_a-~]"
# A path's characters: any script (a file may have a Chinese name), but not white space, quotes, brackets, or the
# punctuation that ends a phrase in Chinese and Japanese.
_PATH_CHAR = r"[^\s<>\"'`|*?()\[\]{}（）、。，；：！？「」『』【】《》〈〉]"
# The top folders of a Linux or a Mac computer: an absolute path under one of them is a file of a computer. A path under
# any other first folder (`/api/users`, `/r/name`) is left as words.
_ROOTS = "home|root|tmp|var|opt|mnt|media|srv|usr|etc|run|workspace|Users|Volumes|private"
_STORED_ID = r"[a-f0-9]{32}\.[a-z0-9]{1,12}"

_FENCE = re.compile(r"^[ \t]*(`{3,}|~{3,}).*?(?:^[ \t]*\1[ \t]*$|\Z)", re.M | re.S)
_MARKDOWN = re.compile(r"!?\[(?P<label>[^\]\n]*)\]\(\s*(?:<(?P<angled>[^<>\n]+)>|(?P<target>[^\s<>()]+(?:\([^\s<>()]*\)[^\s<>()]*)*))"
                       r"(?:\s+\"[^\"\n]*\")?\s*\)")
# What may stand right before a link is anything but a letter or a digit of ASCII (or the marks of an address): Chinese
# and Japanese put a link right after a word, with no space.
_URL = re.compile(r"(?<![A-Za-z0-9_.+-])[a-zA-Z][a-zA-Z0-9+.-]{1,15}://" + _ADDRESS + "+")
_FILE_URL = re.compile(r"(?<![A-Za-z0-9_.+-])(?:file|sandbox):" + _PATH_CHAR + "+", re.I)
_ATTACHMENT = re.compile(r"(?<![A-Za-z0-9_.+-])attachment:" + _ADDRESS + "+|(?<![A-Za-z0-9_/.-])attachments/" + _STORED_ID, re.I)
_BARE_HOST = re.compile(r"(?<![A-Za-z0-9_.@/:-])(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|\[[0-9A-Fa-f:.]+\]):\d{1,5}(?:/" + _ADDRESS + "*)?", re.I)
_WINDOWS = re.compile(r"(?<![A-Za-z0-9_/\\])(?:[A-Za-z]:[\\/]|\\\\[^\s\\/]+[\\/])" + _PATH_CHAR + "*")
_POSIX = re.compile(r"(?<![A-Za-z0-9_.:/~\\-])(?:~|/(?:" + _ROOTS + "))/" + _PATH_CHAR + "*")
_EXTENSION = re.compile(r"\.[A-Za-z0-9]{1,12}(?![A-Za-z0-9_])")
_TRAILING = ".,;:!?'\"…"


@dataclass(frozen=True)
class Link:
    """A link or a path in a message that a phone cannot open: its `kind` (`unreachable`), where it stands, and a Markdown
    link's words (`label`). A path in running words may end earlier than it seems (「/home/cua/team/報告.md是最終版」), so
    `ends` are the places it may end, the longest first, and `fallback` the one that stands for it when no file is found:
    the longest that ends in a file's extension."""

    kind: str
    start: int
    ends: tuple[int, ...]
    fallback: int
    label: str | None = None
    target: str = ""  # a Markdown link's target; a bare link's is the text it stands on

    def targets(self, text: str) -> list[tuple[int, str]]:
        """(end, target) for each place the link may end, the longest first."""
        if self.label is not None:
            return [(self.ends[0], self.target)]
        return [(end, text[self.start:end]) for end in self.ends]


def _local_host(host: str) -> bool:
    """Whether a phone on the public internet cannot reach `host`: no host, an address that is not a public one (this PC,
    a private network, a link-local or a shared one), a name of one label, or a name under a top-level domain of the
    local network."""
    host = host.rstrip(".").lower()
    if not host:
        return True
    try:
        return not ipaddress.ip_address(host).is_global
    except ValueError:
        pass
    labels = host.split(".")
    # A last label of digits is an address written short (`127.1`), never a public name.
    return len(labels) < 2 or labels[-1] in LOCAL_ENDINGS or labels[-1].isdigit()


def unreachable(target: str) -> str | None:
    """The kind of place `target` (a link or a path as a message writes it) is, when a phone that reaches only the public
    web cannot open it: PATH (a file or a folder of a computer: an absolute path, `~/...`, a drive letter, a network
    share, `file:` or `sandbox:`), ATTACHMENT (the app's store of files: `attachment:...`, `attachments/<id>`), PAGE (a
    page this PC's page host serves: `http://127.0.0.1:<port>/p/<token>`) or LOCAL (any other address of this PC, of a
    member's computer or of a private network, with or without its scheme). None for what a phone may open, a public
    link above all, and for anything that is no link."""
    text = target.strip()
    if text.startswith("<") and text.endswith(">"):
        text = text[1:-1].strip()
    if not text:
        return None
    lower = text.lower()
    if lower.startswith(("file:", "sandbox:")):
        return PATH
    if lower.startswith("attachment:") or re.fullmatch("attachments/" + _STORED_ID, lower):
        return ATTACHMENT
    if _WINDOWS.fullmatch(text) or _POSIX.fullmatch(text):
        return PATH
    if "://" not in text:
        if not _BARE_HOST.fullmatch(text):
            return None
        text = "http://" + text
    try:
        parts = urlsplit(text)
        host = parts.hostname or ""
    except ValueError:
        return LOCAL if lower.startswith(("http:", "https:")) else None
    if parts.scheme.lower() not in ("http", "https", "ws", "wss", "ftp", "ftps"):
        return None  # mailto:, tel:, an app's own scheme: not an address of a computer
    if not _local_host(host):
        return None
    try:
        loopback = ipaddress.ip_address(host).is_loopback
    except ValueError:
        loopback = host == "localhost"
    return PAGE if loopback and parts.path.startswith("/p/") and len(parts.path) > 3 else LOCAL


def _trim(text: str) -> str:
    """A link without the punctuation of the sentence after it: a full stop, a comma, a closing bracket it never opened."""
    while text:
        before = text
        text = text.rstrip(_TRAILING)
        for opening, closing in ("()", "[]", "{}"):
            if text.endswith(closing) and text.count(opening) < text.count(closing):
                text = text[:-1]
        if text == before:
            break
    return text


def unreachable_links(text: str) -> list[Link]:
    """Every link or path in `text` that a phone cannot open (`unreachable`), in the order they stand, never overlapping.
    A Markdown link is judged by its target and stands whole; a link in a fenced block of code is code, not a link."""
    taken: list[tuple[int, int]] = [(found.start(), found.end()) for found in _FENCE.finditer(text)]

    def free(start: int, end: int) -> bool:
        return all(end <= left or start >= right for left, right in taken)

    links: list[Link] = []
    for found in _MARKDOWN.finditer(text):
        if not free(found.start(), found.end()):
            continue
        taken.append((found.start(), found.end()))
        target = (found["angled"] or found["target"] or "").strip()
        kind = unreachable(target)
        if kind is not None:
            links.append(Link(kind, found.start(), (found.end(),), found.end(), found["label"].strip(),
                              unquote(target) if kind == PATH else target))
    # A `file:` address before any other, whose name may be in any script.
    for pattern in (_FILE_URL, _ATTACHMENT, _URL, _BARE_HOST, _WINDOWS, _POSIX):
        for found in pattern.finditer(text):
            raw = _trim(found.group())
            start, end = found.start(), found.start() + len(raw)
            if not raw or not free(start, end):
                continue
            taken.append((start, end))
            kind = unreachable(raw)
            if kind is None:
                continue
            if kind == PATH:
                # A path that runs into the words after it: each place a file's extension ends is a place it may end.
                extensions = sorted({start + mark.end() for mark in _EXTENSION.finditer(raw)}, reverse=True)
                ends = tuple(dict.fromkeys([end, *extensions]))
                links.append(Link(kind, start, ends, extensions[0] if extensions else end))
            else:
                links.append(Link(kind, start, (end,), end))
    return sorted(links, key=lambda link: link.start)


def _name(kind: str, target: str) -> str:
    """What a file a link names is called, for the words that stand in its place."""
    path = unquote(re.sub(r"^(?:file|sandbox|attachment):(?://[^/]*)?", "", target, flags=re.I)).rstrip("/\\")
    return (PureWindowsPath(path) if "\\" in path or re.match(r"[A-Za-z]:", path) else PurePosixPath(path)).name or path


def _same(one: File, other: File) -> bool:
    if one.stored_id and one.stored_id == other.stored_id:
        return True
    return one.name == other.name and len(one.data) == len(other.data) and one.data == other.data


async def deliverable(
    messages: Sequence[str], find: Find | None, language: str, *, sent: Sequence[File] = (),
) -> tuple[list[str], list[File]]:
    """`messages` as they may go to a phone, and the files their links bring. Each link `unreachable_links` finds is
    replaced: when `find` gives the file it names, by that file's name (a Markdown link by its words, and the name when
    they differ) and the file goes with the messages, once, never again when it is among `sent`; otherwise by its words
    and a plain note in the owner's language that it could not be sent (a file) or opens only on the computer (an
    address, a page). Messages with no such link are returned as they are."""
    found: list[File] = []
    total = 0
    rewritten: list[str] = []
    for message in messages:
        links = unreachable_links(message)
        if not links:
            rewritten.append(message)
            continue
        pieces, at = [], 0
        for link in links:
            file, end = None, link.fallback
            targets = link.targets(message)
            if find is not None and link.kind != LOCAL and len(found) < MAX_LINKED_FILES:
                for candidate_end, target in targets:
                    try:
                        file = await find(link.kind, target)
                    except Exception as exc:  # a lookup that breaks never stops the message
                        logger.warning("A linked file could not be looked up (%s)", type(exc).__name__)
                        file = None
                    if file is not None and total + len(file.data) > MAX_LINKED_BYTES:
                        file = None
                    if file is not None:
                        end = candidate_end
                        break
            label = link.label
            if file is not None:
                if label and file.stored_id and file.name == file.stored_id:
                    # A file of the store that keeps no name of its own is called by the words that linked it.
                    named = " ".join(re.sub(r'[\\/:*?"<>|]', " ", label).split())
                    suffix = PurePosixPath(file.name).suffix
                    if named:
                        file = replace(file, name=named if named.lower().endswith(suffix) else named + suffix)
                if not any(_same(file, other) for other in (*sent, *found)):
                    found.append(file)
                    total += len(file.data)
                words_for = label if label and file.name.startswith(label) else f"{label} ({file.name})" if label else file.name
            elif link.kind in (PATH, ATTACHMENT):
                target = link.target if label is not None else message[link.start:end]
                words_for = words(language, "link_file", name=label or _name(link.kind, target))
            else:
                note = words(language, "link_local")
                if link.start and message[link.start - 1] in "(（[" and message[end:end + 1] in ")）]":
                    note = note.strip("()（）")  # the link stood in brackets already
                words_for = (label + " " if label else "") + note
            pieces += [message[at:link.start], words_for]
            at = end
        pieces.append(message[at:])
        rewritten.append("".join(pieces))
    return rewritten, found


class LinkedFiles:
    """Where the core finds the file a link names, for a member (`__call__(member, kind, target)`):
    - a path in the member's computer (absolute, `~/`, `file:` or `sandbox:`) under one of its folders this PC keeps
      (`folders(member)`: the folder's path in the computer -> the folder here; none for a computer on another host), a
      regular file inside that folder once every link is followed, no larger than `limit`: what the member's own
      `attach_file` may take from the same two folders. A path of this PC (a drive letter, a share) is never one: a
      member delivers a file of the owner's by attaching it, as before (R-BATCH-02);
    - an `attachment:` link by the stored id of the app's store (`attachments`);
    - a page this PC serves, as the file the app saves of it (`page(url)` -> (name, html) or None).
    Anything else, and anything that cannot be read, is None."""

    def __init__(
        self,
        *,
        folders: Callable[[int], Mapping[str, Path | None]],
        home: str = "",
        attachments=None,
        page: Callable[[str], tuple[str, str] | None] | None = None,
        limit: int = LINKED_FILE_BYTES,
    ) -> None:
        self._folders, self._home, self._attachments = folders, home, attachments
        self._page, self._limit = page, limit

    async def __call__(self, member: int, kind: str, target: str) -> File | None:
        try:
            if kind == PATH:
                # Where the folders are is asked here (it reads the app's records); only the file is read in a thread.
                return await asyncio.to_thread(self._computer_file, dict(self._folders(member)), target)
            if kind == ATTACHMENT and self._attachments is not None:
                return await asyncio.to_thread(self._stored, target)
            if kind == PAGE and self._page is not None and (made := self._page(target)) is not None:
                name, html = made
                data = html.encode("utf-8")
                return File(name, "text/html", data) if len(data) <= self._limit else None
        except Exception as exc:  # a file that cannot be read is a file not found
            logger.info("A linked file was not found (%s)", type(exc).__name__)
        return None

    def _guest_path(self, target: str) -> PurePosixPath | None:
        text = target.strip()
        if text.lower().startswith("file:"):
            parts = urlsplit(text)
            if parts.netloc not in ("", "localhost"):
                return None
            text = unquote(parts.path)
        elif text.lower().startswith("sandbox:"):
            text = unquote(text.split(":", 1)[1])
        if text.startswith("~/") and self._home:
            text = self._home.rstrip("/") + text[1:]
        path = PurePosixPath(text)
        return path if path.is_absolute() and ".." not in path.parts else None

    def _computer_file(self, folders: Mapping[str, Path | None], target: str) -> File | None:
        guest = self._guest_path(target)
        if guest is None:
            return None
        for root, folder in folders.items():
            if folder is None or not guest.is_relative_to(PurePosixPath(root)):
                continue
            base = Path(folder).resolve(strict=True)
            path = base.joinpath(*guest.relative_to(PurePosixPath(root)).parts).resolve(strict=True)
            if not path.is_relative_to(base) or not path.is_file() or path.stat().st_size > self._limit:
                return None
            data = path.read_bytes()
            if len(data) > self._limit:
                return None
            return File(guest.name, mimetypes.guess_type(guest.name)[0] or "application/octet-stream", data)
        return None

    def _stored(self, target: str) -> File | None:
        key = unquote(target.split(":", 1)[1] if target.lower().startswith("attachment:") else target).strip()
        key = key.removeprefix("attachments/")
        path = self._attachments.path(key)  # only the stored-id form, inside the store
        if path.stat().st_size > self._limit:
            return None
        meta = json.loads(path.with_name(path.name + ".json").read_text(encoding="utf-8"))
        name = meta.get("name") if isinstance(meta.get("name"), str) and meta["name"].strip() else path.name
        mime = meta.get("mime") if isinstance(meta.get("mime"), str) else mimetypes.guess_type(name)[0] or "application/octet-stream"
        return File(name, mime, path.read_bytes(), path.name)

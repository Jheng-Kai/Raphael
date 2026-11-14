"""Bounded attachment readers. File content is data, never code or instructions."""

import asyncio
import io
import re
import shutil
import subprocess
import tempfile
import zipfile
from collections.abc import Awaitable, Callable
from pathlib import Path
from xml.etree import ElementTree as ET

from .attachments import Attachment
from .common import TEXT_BUDGET, fit

MAX_EXTRACT_BYTES = 8 * 1024 * 1024
MAX_MEDIA_SECONDS = 300
Transcribe = Callable[[bytes, str], Awaitable[str]]
TEXT_EXTENSIONS = {
    ".txt", ".md", ".markdown", ".html", ".htm", ".csv", ".tsv", ".json", ".jsonl",
    ".xml", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".log", ".sql",
    ".py", ".js", ".jsx", ".ts", ".tsx", ".rs", ".c", ".cpp", ".h", ".hpp",
    ".cs", ".java", ".kt", ".go", ".rb", ".php", ".sh", ".ps1", ".css", ".scss",
    ".vue", ".svelte", ".dart", ".swift", ".tex", ".r", ".ipynb", ".svg",
}


# A control character that makes a file binary rather than text (a tab and the line ends are not).
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def decoded(data: bytes, *, partial: bool = False) -> tuple[str, str] | None:
    """`data` as text and the codec that read it. `partial` says `data` is only the start of a longer file, so a
    character the cut split in two is left out rather than taken for a bad encoding."""
    for encoding in ("utf-8-sig", "utf-16" if data.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8", "big5", "cp1252"):
        try:
            try:
                text = data.decode(encoding)
            except UnicodeDecodeError as error:
                if not (partial and error.end >= len(data) and error.start >= len(data) - 4):
                    raise
                text = data[:error.start].decode(encoding)
        except UnicodeError:
            continue
        if not text or len(_CONTROL.findall(text)) / len(text) < 0.02:
            return text, encoding
    return None


def decode(data: bytes) -> str | None:
    found = decoded(data)
    return found[0] if found else None


def width(text: str, encoding: str, data: bytes) -> int:
    """How many bytes of the file `data` the start `text` is, in the codec that read it."""
    if encoding == "utf-8-sig":
        return len(text.encode("utf-8")) + (3 if data.startswith(b"\xef\xbb\xbf") else 0)
    if encoding == "utf-16":
        return len(text.encode("utf-16-be" if data.startswith(b"\xfe\xff") else "utf-16-le")) + 2
    return len(text.encode(encoding))


def is_text(attachment: Attachment) -> bool:
    """Whether the reader takes `attachment` for a text file, by its extension or its type."""
    if attachment.is_image or attachment.is_pdf:
        return False
    return (Path(attachment.name).suffix.lower() in TEXT_EXTENSIONS or attachment.mime.startswith("text/")
            or attachment.mime in ("application/json", "application/xml", "application/xhtml+xml",
                                   "application/yaml", "application/javascript"))


def read_text(attachment: Attachment, *, budget: int = TEXT_BUDGET, where: str | None = None) -> dict | None:
    """A text file as the owner wrote it. Its source is data the owner handed over: HTML keeps its style and
    script, SVG and XML their markup, code its code, and nothing is turned into "readable" text in its place. A file
    longer than `budget` characters gives its start, whole and in order, and says how many bytes were cut;
    the note, which says where the whole file is (`where`, else its stored copy), is kept beside the text, never inside it."""
    if not is_text(attachment):
        return None
    size = len(attachment.data)
    # Four bytes hold any character, so this much always reaches the budget.
    data = attachment.data[:min(size, MAX_EXTRACT_BYTES, budget * 4 + 4)]
    facts = {"name": attachment.name, "mime": attachment.mime, "size": size}
    found = decoded(data, partial=len(data) < size)
    if found is None:
        return {**facts, "limitation": "The text encoding could not be decoded."}
    text, encoding = found
    shown = text[:budget]
    cut = size - width(shown, encoding, data)
    # A prefix that stopped short of the file's end is cut even when every character of it fits the budget.
    result = {**facts, "encoding": "utf-8" if encoding == "utf-8-sig" else encoding, "text": shown, "truncated": cut > 0}
    if cut > 0:
        result.update(shown_bytes=size - cut, cut_bytes=cut)
        result["note"] = cut_note(result, where or (str(attachment.source_path) if attachment.source_path else None))
    return result


def cut_note(found: dict, where: str | None = None) -> str:
    """The words that go beside a file's start when the rest was cut: what was shown, what was left out, where the whole is."""
    place = (f"The complete original file is stored on this computer at {where}." if where
             else "The complete original file is kept on this computer as it was attached.")
    return (f"[Cut short: the file has {found['size']} bytes; the first {found['shown_bytes']} are shown above exactly as "
            f"written and the last {found['cut_bytes']} bytes were cut. {place} Read the rest from there with a file tool, "
            "or ask the owner.]")


# Reading a text file in lines, as Claude Code's Read tool does: numbered like `cat -n`, 2000 lines a call, a longer
# line cut, and the line to go on from when there is more.
LINE_LIMIT = 2000
LINE_CHARS = 2000
# The most characters one read returns, so that 2000 long lines never fill the window; the next read goes on from there.
READ_CHARS = 60_000
# Base64 inside a line that is too long is shown as a marker first: a data: URI's payload, or any other long run.
_BASE64 = re.compile(r"(?<=;base64,)[A-Za-z0-9+/=_-]{1024,}|[A-Za-z0-9+/]{1024,}={0,2}")


def _shown(line: str) -> tuple[str, int, bool]:
    """A line as it is shown: base64 data inside a long one as a marker, and what is still over LINE_CHARS cut off
    with how much. Also the characters of data left out, and whether the line was cut."""
    if len(line) <= LINE_CHARS:
        return line, 0, False
    left = 0

    def marker(match: re.Match) -> str:
        nonlocal left
        run = match.group(0)
        if len(set(run)) < 16 and line[max(match.start() - 8, 0):match.start()] != ";base64,":
            return run  # a ruler of "=" or "/" is not data
        left += len(run)
        return f"[{len(run) / 1024:.1f} KB of base64 data elided]" if len(run) < 10240 else f"[{round(len(run) / 1024)} KB of base64 data elided]"

    short = _BASE64.sub(marker, line)
    if len(short) <= LINE_CHARS:
        return short, left, False
    return f"{short[:LINE_CHARS]}… [{len(short) - LINE_CHARS} more characters]", left, True


def read_window(arguments: dict) -> dict | None:
    """Where in a text file a `read_attachment` call asks to read: its `offset` (a line, from 1) and `limit` (lines).
    Empty when it asks for neither; None when one is not a whole number of at least 1."""
    window: dict = {}
    for key in ("offset", "limit"):
        if arguments.get(key) is not None:
            if type(arguments[key]) is not int or arguments[key] < 1:
                return None
            window[key] = arguments[key]
    return window


def read_lines(attachment: Attachment, *, number: int | None = None, offset: int | None = None,
               limit: int | None = None) -> dict | None:
    """A text file as Claude Code's Read gives one: the lines from line `offset` (1-based, default 1), up to `limit` of
    them (default 2000), each numbered like `cat -n` (the number is not part of the line), a line over 2000
    characters cut with a note of what was left (base64 data inside one is first shown as a marker), and when there is
    more, `next_offset` and a note naming the call that reads it. None for a file that is not text."""
    if not is_text(attachment):
        return None
    size = len(attachment.data)
    data = attachment.data[:min(size, MAX_EXTRACT_BYTES)]
    partial = len(data) < size
    facts = {"name": attachment.name, "mime": attachment.mime, "size": size}
    found = decoded(data, partial=partial)
    if found is None:
        return {**facts, "limitation": "The text encoding could not be decoded."}
    text, encoding = found
    lines = text.split("\n")
    if len(lines) > 1 and lines[-1] == "":
        lines.pop()
    total = 0 if not text else len(lines)
    first = offset or 1
    count, used, cut, elided = 0, 0, 0, 0
    rows = []
    for index in range(first - 1, min(total, first - 1 + (limit or LINE_LIMIT))):
        shown, left, was_cut = _shown(lines[index].removesuffix("\r"))
        row = f"{index + 1:>6}\t{shown}"
        if rows and used + len(row) + 1 > READ_CHARS:
            break
        rows.append(row)
        used += len(row) + 1
        count += 1
        cut += was_cut
        elided += left
    last = first - 1 + count
    reached = last >= total and not partial
    result = {**facts, "encoding": "utf-8" if encoding == "utf-8-sig" else encoding, "text": "\n".join(rows),
              "offset": first, "lines": count, "total_lines": total, "end_reached": reached, "truncated": not reached}
    notes = []
    if first > total and total:
        notes.append(f"The file has {total} lines; offset {first} is past its end.")
    elif not text:
        notes.append("The file is empty.")
    if cut:
        result["long_lines_cut"] = cut
        notes.append(f"{cut} line{'s' if cut > 1 else ''} longer than {LINE_CHARS} characters {'were' if cut > 1 else 'was'} "
                     "cut where it says so; the stored file has the rest.")
    if elided:
        result["elided_characters"] = elided
        notes.append("Base64 data inside a long line is shown as a marker; the stored file is unchanged.")
    if partial and last >= total:
        result["limitation"] = f"Only the first {MAX_EXTRACT_BYTES} bytes of a text file can be read."
    elif not reached:
        result["next_offset"] = last + 1
        notes.append(f"Lines {first}-{last} of {total} are shown. Read on with read_attachment "
                     f"({f'index {number}, ' if number else ''}offset {last + 1}).")
    if notes:
        result["note"] = "[" + " ".join(notes) + "]"
    return result


def reference_note(found: dict, where: str | None, number: int | None, lines: int) -> str:
    """The words beside a text file too long to be pasted into a message: what it is, and how to read it."""
    place = (f"It is stored on this computer at {where}; a file tool opens it too." if where
             else "The complete original file is kept on this computer as it was attached.")
    return (f"[Not pasted: the file has {lines} lines ({found['size']} bytes), more than a message carries. Read it with "
            f"read_attachment ({f'index {number}, ' if number else ''}offset 1): numbered lines, {LINE_LIMIT} a call, "
            f"and each result says the offset to go on from. {place}]")


def line_count(attachment: Attachment) -> int:
    """How many lines a text file has (in the first 8 MB it can be read to)."""
    found = read_lines(attachment, limit=1)
    return found.get("total_lines", 0) if found else 0


def office_text(data: bytes | Path, extension: str) -> str:
    """Read only known document parts, without extraction, relationships or external entities."""
    parts = []
    used = 0
    emitted = 0
    def append(parts, value):
        nonlocal emitted
        emitted += len(value) + 1
        if emitted > MAX_EXTRACT_BYTES:
            raise ValueError("extraction_limit")
        parts.append(value)
    with zipfile.ZipFile(data if isinstance(data, Path) else io.BytesIO(data)) as archive:
        infos = sorted(archive.infolist(), key=lambda i: i.filename)
        strings: list[str] = []
        for info in infos:
            name = info.filename
            wanted = (
                extension == ".docx" and name == "word/document.xml"
                or extension == ".pptx" and name.startswith("ppt/slides/slide") and name.endswith(".xml")
                or extension == ".xlsx" and (name == "xl/sharedStrings.xml" or name.startswith("xl/worksheets/sheet") and name.endswith(".xml"))
            )
            if not wanted:
                continue
            used += info.file_size
            if used > MAX_EXTRACT_BYTES:
                parts.append("[Remaining document parts exceed the extraction limit.]")
                break
            raw = archive.read(info)
            declarations = raw.replace(b"\x00", b"").upper()
            if b"<!DOCTYPE" in declarations or b"<!ENTITY" in declarations:
                raise ValueError("xml_entities")
            root = ET.fromstring(raw)
            if name == "xl/sharedStrings.xml":
                strings = ["".join(n.itertext()) for n in root]
                continue
            if extension == ".xlsx":
                for row in root.iter():
                    if row.tag.rsplit("}", 1)[-1] != "row":
                        continue
                    cells = []
                    for cell in row:
                        value = "".join(n.text or "" for n in cell.iter() if n.tag.rsplit("}", 1)[-1] in ("v", "t"))
                        if cell.get("t") == "s" and value.isdigit():
                            value = strings[int(value)] if int(value) < len(strings) else ""
                        append(cells, value)
                    parts.append("\t".join(cells))
            else:
                for node in root.iter():
                    local = node.tag.rsplit("}", 1)[-1]
                    if local == "t" and node.text:
                        append(parts, node.text)
                    elif local in ("p", "br", "tab"):
                        append(parts, "\n")
    return "\n".join(parts)


def convert_media(attachment: Attachment) -> tuple[bytes, float | None, bool]:
    """Convert at most five minutes to mono WAV; no shell, network protocols or stderr text."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise FileNotFoundError
    extension = Path(attachment.name).suffix.lower()
    if not extension or len(extension) > 10 or not extension[1:].isalnum():
        extension = ".bin"
    with tempfile.TemporaryDirectory(prefix="raphael-media-") as directory:
        source = attachment.source_path or Path(directory) / ("input" + extension)
        target = Path(directory) / "audio.wav"
        if attachment.source_path is None:
            source.write_bytes(attachment.data)
        flags = subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0
        subprocess.run(
            [ffmpeg, "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm,mp3,wav,ogg,flac,aac", "-i", str(source),
             "-t", str(MAX_MEDIA_SECONDS), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(target)],
            check=True, timeout=60, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags,
        )
        import wave
        with wave.open(str(target), "rb") as wav:
            duration = wav.getnframes() / wav.getframerate()
        return target.read_bytes(), duration, duration >= MAX_MEDIA_SECONDS - 0.1


async def read_file(attachment: Attachment, transcribe: Transcribe | None = None) -> tuple[str, dict]:
    if (text := read_text(attachment)) is not None:
        return "text", text
    extension = Path(attachment.name).suffix.lower()
    facts = {"name": attachment.name, "mime": attachment.mime, "size": len(attachment.data)}
    video = attachment.mime.startswith("video/") or extension in (".mp4", ".mov", ".mkv")
    audio = attachment.mime.startswith("audio/") or extension in (".mp3", ".wav", ".m4a", ".ogg", ".flac", ".webm")
    if video or audio:
        kind = "video" if video else "audio"
        if transcribe is None:
            return kind, {**facts, "limitation_kind": "audio_transcriber", "limitation": "This installation cannot transcribe media attachments. Attach a text transcript and ask an administrator to check the speech recognition component; there is no setting here to add it."}
        try:
            # libsndfile can read these directly; other formats need ffmpeg's WAV conversion.
            direct = not video and len(attachment.data) <= MAX_EXTRACT_BYTES and extension in (".wav", ".mp3", ".ogg", ".flac")
            if direct:
                import soundfile
                with soundfile.SoundFile(io.BytesIO(attachment.data)) as clip:
                    duration = len(clip) / clip.samplerate
                if duration > MAX_MEDIA_SECONDS:
                    direct = False
            if direct:
                data, truncated = attachment.data, False
            else:
                data, duration, truncated = await asyncio.to_thread(convert_media, attachment)
            text = await transcribe(data, "auto")
            text, cut = fit(text)
            return kind, {**facts, "text": text, "duration": duration, "truncated": cut or truncated}
        except FileNotFoundError:
            return kind, {**facts, "limitation_kind": "audio_ffmpeg", "limitation": "The ffmpeg decoding component is missing. Attach WAV audio or a text transcript and ask an administrator to repair the installation."}
        except asyncio.CancelledError:
            raise
        except Exception:
            return kind, {**facts, "limitation_kind": "audio_decode", "limitation": "The media could not be decoded or transcribed. Attach WAV audio or a text transcript; ask an administrator to check the decoding component if it continues."}
    if extension in (".docx", ".xlsx", ".pptx"):
        try:
            text = await asyncio.to_thread(office_text, attachment.source_path or attachment.data, extension)
        except (ValueError, OSError, zipfile.BadZipFile, ET.ParseError, RuntimeError):
            return "document", {**facts, "limitation": "The Office document could not be read."}
        text, cut = fit(text)
        return "document", {**facts, "text": text, "truncated": cut}
    data = attachment.data[:512]
    text = decode(data)
    if text is not None:
        return "file", {**facts, "sniff": text, "truncated": len(data) < len(attachment.data), "limitation": "Unknown format; only a short text sample was read."}
    return "file", {**facts, "limitation": "Binary format: only file metadata is available."}

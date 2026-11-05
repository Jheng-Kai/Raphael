"""Opaque IDs for stored copies. Never use an owner-supplied name as a path."""

import asyncio
import base64
import json
import mmap
import mimetypes
import re
import os
import time
import uuid
from dataclasses import replace
from pathlib import Path

from ..protocol import invalid_params
from ..paths import local_storage_root
from .attachments import Attachment, AttachmentError, MAX_VIDEO_BYTES, checked, file_limit

ID = re.compile(r"[a-f0-9]{32}\.[a-z0-9]{1,12}")
# Native opening invokes the owner's file association. Unknown extensions must not
# acquire execution permission merely because they are missing from a denylist.
OPENABLE = frozenset("""
    txt md markdown csv tsv json jsonl xml yaml yml toml ini cfg conf log
    html htm pdf rtf doc docx xls xlsx ppt pptx odt ods odp
    png jpg jpeg gif webp avif bmp svg tif tiff ico
    mp3 wav m4a aac ogg oga opus flac wma
    mp4 webm mov m4v mkv avi wmv ogv
    zip 7z rar tar gz bz2 xz
""".split())


class AttachmentStore:
    def __init__(self, root: Path):
        self.root = root.resolve() / "attachments"
        self.uploads = {}

    def checked_root(self):
        try:
            return local_storage_root(self.root)
        except (OSError, ValueError):
            raise invalid_params("attachment is unavailable") from None

    def save(self, attachment: Attachment) -> Attachment:
        self.checked_root()
        if attachment.stored_id:
            self.path(attachment.stored_id)
            return attachment
        self.root.mkdir(parents=True, exist_ok=True)
        suffix = Path(attachment.name).suffix.lower().lstrip(".")
        suffix = suffix if re.fullmatch(r"[a-z0-9]{1,12}", suffix) else "bin"
        key = f"{uuid.uuid4().hex}.{suffix}"
        target = self.root / key
        target.write_bytes(attachment.data)
        target.with_name(key + ".json").write_text(json.dumps({"mime": attachment.mime}), encoding="utf-8")
        return replace(attachment, stored_id=key)

    def path(self, key) -> Path:
        if not isinstance(key, str) or not ID.fullmatch(key):
            raise invalid_params("invalid attachment ID")
        root = self.checked_root()
        target = (root / key).resolve()
        if target.parent != root or not target.is_file() or target.stat().st_size > MAX_VIDEO_BYTES:
            raise invalid_params("attachment is unavailable")
        return target

    def register(self, router):
        router.register("attachments.get", self.get)
        router.register("attachments.path", self.open_path)
        router.register("attachments.upload", self.upload)
        router.register("attachments.info", self.info)

    def resolve(self, item):
        """Map a validated stored copy; readers slice their existing bounded excerpts."""
        try:
            path = self.path(item.get("stored_id"))
            meta = json.loads(path.with_name(path.name + ".json").read_text(encoding="utf-8"))
            if path.stat().st_size > file_limit(meta["mime"]):
                raise AttachmentError("size")
            with path.open("rb") as source:
                data = mmap.mmap(source.fileno(), 0, access=mmap.ACCESS_READ)
            return Attachment(meta.get("name", path.name), meta["mime"], data, path.name, path)
        except (OSError, ValueError, KeyError):
            raise AttachmentError("data") from None

    async def info(self, params):
        path = self.path(params.get("id"))
        meta = json.loads(path.with_name(path.name + ".json").read_text(encoding="utf-8"))
        return {**meta, "size": path.stat().st_size, "stored_id": path.name}

    async def upload(self, params):
        """Sequential 1 MiB chunks, a bounded transfer table, and atomic publication."""
        self.checked_root()
        action, token = params.get("action"), params.get("token")
        now = time.monotonic()
        for old, entry in list(self.uploads.items()):
            if now - entry["time"] > 3600:
                entry["path"].unlink(missing_ok=True)
                del self.uploads[old]
        if action == "begin":
            name, mime, size = params.get("name"), params.get("mime"), params.get("size")
            if not isinstance(name, str) or not isinstance(mime, str) or type(size) is not int:
                raise invalid_params("invalid upload metadata")
            mime = mime.strip().lower().split(";")[0]
            if mime == "image/jpg":
                mime = "image/jpeg"
            if not re.fullmatch(r"[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+", mime) or mime == "application/octet-stream":
                mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
            if not name.strip() or not 0 < size <= file_limit(mime) or len(self.uploads) >= 20:
                raise invalid_params("upload limit")
            self.root.mkdir(parents=True, exist_ok=True)
            token = uuid.uuid4().hex
            path = self.root / (token + ".part")
            path.touch(exist_ok=False)
            self.uploads[token] = {"name": name, "mime": mime, "size": size, "path": path, "time": now, "written": 0}
            return {"token": token}
        entry = self.uploads.get(token) if isinstance(token, str) else None
        if entry is None:
            raise invalid_params("unknown upload")
        if action == "abort":
            entry["path"].unlink(missing_ok=True)
            del self.uploads[token]
            return {}
        if action == "append":
            encoded = params.get("data")
            if not isinstance(encoded, str) or len(encoded) > 1_398_104 or type(params.get("offset")) is not int or params["offset"] != entry["written"]:
                raise invalid_params("invalid upload chunk")
            try:
                chunk = base64.b64decode(encoded, validate=True)
            except ValueError:
                raise invalid_params("invalid upload chunk") from None
            if not chunk or len(chunk) > 1024 * 1024 or entry["written"] + len(chunk) > entry["size"]:
                raise invalid_params("upload size mismatch")
            with entry["path"].open("ab") as target:
                target.write(chunk)
            entry["written"] += len(chunk)
            entry["time"] = now
            return {"offset": entry["written"]}
        if action != "finish" or entry["written"] != entry["size"]:
            raise invalid_params("incomplete upload")
        with entry["path"].open("rb") as source:
            prefix = source.read(512)
        validated = checked(entry["name"], entry["mime"], prefix, max_bytes=file_limit(entry["mime"]))
        suffix = Path(validated.name).suffix.lower().lstrip(".")
        key = f"{uuid.uuid4().hex}.{suffix if re.fullmatch(r'[a-z0-9]{1,12}', suffix) else 'bin'}"
        target = self.root / key
        target.with_name(key + ".json").write_text(json.dumps({"name": validated.name, "mime": validated.mime}), encoding="utf-8")
        os.replace(entry["path"], target)
        del self.uploads[token]
        return {"stored_id": key, "size": entry["size"], "name": validated.name, "mime": validated.mime, "data": ""}

    async def get(self, params):
        path = self.path(params.get("id"))
        if path.stat().st_size > 8 * 1024 * 1024:
            raise invalid_params("large attachments require streaming")
        def read():
            meta = json.loads(path.with_name(path.name + ".json").read_text(encoding="utf-8"))
            return {"mime": meta["mime"], "data": base64.b64encode(path.read_bytes()).decode("ascii")}
        return await asyncio.to_thread(read)

    async def open_path(self, params):
        path = self.path(params.get("id"))
        if path.suffix.lstrip(".").lower() not in OPENABLE:
            raise invalid_params("unreviewed attachment types cannot be opened")
        return {"path": str(path)}

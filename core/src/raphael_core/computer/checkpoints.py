"""Guest-only file checkpoints, with hash-guarded restore preserving later edits.

Adapted from NousResearch/hermes-agent (MIT); see core/packaging/licenses.
No guest dependencies are required.
"""

import difflib
import hashlib
import json
import os
from pathlib import Path
import secrets
import stat
import sys
import time

EXCLUDED = {".raphael-checkpoints", ".browser-profiles", ".raphael-jobs", ".git", "node_modules", ".venv", "__pycache__", ".cache"}
MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_ARCHIVE_BYTES = 500 * 1024 * 1024
MAX_CHECKPOINTS = 20
MAX_FILES = 10000
WALK_SECONDS = 8.0


class CheckpointStore:
    def __init__(self, archive, roots):
        self.archive = Path(archive)
        self.roots = [Path(root).absolute() for root in roots]

    def _safe(self, path):
        path = Path(path)
        root = next((root for root in self.roots if path.is_relative_to(root) and path != root), None)
        if root is None or ".." in path.parts or any(part in EXCLUDED for part in path.relative_to(root).parts):
            raise ValueError("outside_workspace")
        for part in [path, *path.parents]:
            if part == root.parent:
                break
            if part.is_symlink():
                raise ValueError("symlink")
        return path

    def _ensure(self):
        if self.archive.is_symlink() or (self.archive / "objects").is_symlink():
            raise ValueError("symlink")
        (self.archive / "objects").mkdir(parents=True, mode=0o700, exist_ok=True)

    def _object(self, digest):
        if not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            raise ValueError("invalid_object")
        self._ensure()
        path = self.archive / "objects" / digest
        if path.is_symlink():
            raise ValueError("symlink")
        return path

    def _read(self, path, deadline):
        path = self._safe(path)
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
        with os.fdopen(descriptor, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > MAX_FILE_BYTES:
                raise ValueError("uncovered_file")
            chunks, size = [], 0
            while True:
                if time.monotonic() >= deadline:
                    raise TimeoutError()
                chunk = stream.read(min(1024 * 1024, MAX_FILE_BYTES + 1 - size))
                if not chunk:
                    break
                chunks.append(chunk); size += len(chunk)
                if size > MAX_FILE_BYTES:
                    raise ValueError("uncovered_file")
            final = os.fstat(stream.fileno())
            if (info.st_size, info.st_mtime_ns) != (final.st_size, final.st_mtime_ns):
                raise ValueError("file_changed")
        content = b"".join(chunks)
        return {"digest": hashlib.sha256(content).hexdigest(), "mode": stat.S_IMODE(info.st_mode),
                "size": info.st_size, "mtime": info.st_mtime_ns}, content

    def _records(self):
        if self.archive.is_symlink():
            raise ValueError("symlink")
        output = []
        for path in self.archive.glob("*.json"):
            try:
                value = self._get(path.stem)
                if isinstance(value.get("manifest"), dict):
                    output.append(value)
            except (ValueError, OSError):
                continue
        return sorted(output, key=lambda item: item.get("order", item["created"]))

    def _capture(self, previous, deadline, *, store):
        files, uncovered = {}, []
        self._ensure()
        total = sum(path.stat().st_size for path in (self.archive / "objects").iterdir() if not path.is_symlink()) if store else 0
        for root in self.roots:
            if root.is_symlink():
                uncovered.append(str(root))
                continue
            def failed(error):
                uncovered.append(str(error.filename or root))
            for directory, dirs, names in os.walk(root, followlinks=False, onerror=failed):
                if time.monotonic() >= deadline or len(files) >= MAX_FILES:
                    return files, uncovered + [str(directory)], True
                dirs[:] = sorted(name for name in dirs if name not in EXCLUDED and not (Path(directory) / name).is_symlink())
                for name in sorted(names):
                    if time.monotonic() >= deadline or len(files) >= MAX_FILES:
                        return files, uncovered + [str(Path(directory) / name)], True
                    path = Path(directory) / name
                    if name in EXCLUDED:
                        continue
                    key = str(path)
                    try:
                        self._safe(path)
                        info = path.stat()
                        value = {"digest": None, "size": info.st_size, "mtime": info.st_mtime_ns, "mode": stat.S_IMODE(info.st_mode)}
                        files[key] = value
                        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > MAX_FILE_BYTES:
                            raise ValueError("uncovered_file")
                        old = previous.get(key)
                        if old and old.get("digest") and (old["size"], old["mtime"]) == (value["size"], value["mtime"]) and self._object(old["digest"]).is_file():
                            files[key] = {**value, "digest": old["digest"]}
                            continue
                        value, content = self._read(path, deadline)
                        if store:
                            obj = self._object(value["digest"])
                            if not obj.exists():
                                if total + len(content) > MAX_ARCHIVE_BYTES:
                                    pinned = {item["digest"] for item in files.values() if item.get("digest")}
                                    total = self._make_room(len(content), pinned, deadline)
                                    if total + len(content) > MAX_ARCHIVE_BYTES:
                                        raise ValueError("archive_full")
                                self._atomic(obj, content)
                                total += len(content)
                        files[key] = value
                    except TimeoutError:
                        return files, uncovered + [key], True
                    except (ValueError, OSError):
                        uncovered.append(key)
        return files, uncovered, bool(uncovered)

    def _make_room(self, size, pinned, deadline):
        records = self._records()
        while records and time.monotonic() < deadline:
            oldest = records.pop(0)
            (self.archive / (oldest["id"] + ".json")).unlink()
            used = pinned | {value["digest"] for record in records for value in record["manifest"].values() if value.get("digest")}
            total = 0
            for path in (self.archive / "objects").iterdir():
                if path.is_symlink():
                    continue
                if path.name not in used:
                    path.unlink()
                else:
                    total += path.stat().st_size
            if total + size <= MAX_ARCHIVE_BYTES:
                return total
        return sum(path.stat().st_size for path in (self.archive / "objects").iterdir() if not path.is_symlink())

    def _atomic(self, path, content):
        temporary = path.with_name(secrets.token_hex(16) + ".tmp")
        try:
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(content)
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)

    def _write(self, identifier, data):
        self._ensure()
        self._atomic(self.archive / (identifier + ".json"), json.dumps(data).encode("utf-8"))

    def _get(self, identifier):
        if not isinstance(identifier, str) or len(identifier) != 32 or any(c not in "0123456789abcdef" for c in identifier):
            raise ValueError("unknown_checkpoint")
        path = self.archive / (identifier + ".json")
        if self.archive.is_symlink() or path.is_symlink():
            raise ValueError("symlink")
        return json.loads(path.read_text(encoding="utf-8"))

    @staticmethod
    def _same(left, right):
        return {path: (entry.get("digest"), entry["mode"], entry["size"]) for path, entry in left.items()} == {
            path: (entry.get("digest"), entry["mode"], entry["size"]) for path, entry in right.items()}

    def begin(self, *, member, turn):
        records = self._records()
        if any(item["member"] == member and item["turn"] == turn for item in records):
            return None
        previous = records[-1]["manifest"] if records else {}
        manifest, uncovered, partial = self._capture(previous, time.monotonic() + WALK_SECONDS, store=True)
        if records and self._same(manifest, previous) and uncovered == records[-1].get("uncovered", []) and partial == records[-1].get("partial", False):
            latest = records[-1]
            if latest["member"] != member or manifest != previous or "review" in latest or latest["state"] == "restored":
                latest.update(member=member, turn=turn, manifest=manifest, state="ready",
                              created=time.time_ns() // 1_000_000, order=time.time_ns())
                latest.pop("review", None)
                latest.pop("reviews", None)
                self._write(latest["id"], latest)
                self._prune()
            return None
        identifier = secrets.token_hex(16)
        self._write(identifier, {"id": identifier, "member": member, "turn": turn, "created": time.time_ns() // 1_000_000,
                                 "order": time.time_ns(), "state": "ready", "manifest": manifest,
                                 "uncovered": uncovered, "partial": partial})
        self._prune()
        return identifier

    def _prune(self):
        records = self._records()
        counts, retained = {}, []
        for record in reversed(records):
            member = record["member"]
            counts[member] = counts.get(member, 0) + 1
            if counts[member] > MAX_CHECKPOINTS:
                (self.archive / (record["id"] + ".json")).unlink()
            else:
                retained.append(record)
        used = {value["digest"] for record in retained for value in record["manifest"].values() if value.get("digest")}
        for path in (self.archive / "objects").iterdir():
            if path.name not in used and not path.is_symlink():
                path.unlink()

    def _bytes(self, value):
        if not value:
            return b""
        with self._object(value["digest"]).open("rb") as stream:
            content = stream.read(MAX_FILE_BYTES + 1)
        if len(content) > MAX_FILE_BYTES or hashlib.sha256(content).hexdigest() != value["digest"]:
            raise ValueError("broken_archive")
        return content

    def _changes(self, before, after, deadline):
        files = []
        for path in sorted(before.keys() | after.keys()):
            old, new = before.get(path), after.get(path)
            if old and not old.get("digest") or new and not new.get("digest"):
                continue
            if (old and (old["digest"], old["mode"])) == (new and (new["digest"], new["mode"])):
                continue
            diff = ""
            if time.monotonic() < deadline and len(files) < 20:
                try:
                    left = self._bytes(old)
                    right = self._bytes(new) if new and self._object(new["digest"]).exists() else self._read(path, deadline)[1] if new else b""
                    if b"\0" in left + right:
                        raise UnicodeError()
                    diff = "\n".join(difflib.unified_diff(left.decode().splitlines(), right.decode().splitlines(), fromfile="before", tofile="after", lineterm=""))[:12000]
                except (UnicodeError, OSError, ValueError, TimeoutError):
                    pass
            files.append({"path": path, "before": old, "after": new, "diff": diff})
        return files

    def list(self, *, member):
        records = self._records()
        if not records:
            return []
        deadline = time.monotonic() + WALK_SECONDS
        live, uncovered, partial = self._capture(records[-1]["manifest"], deadline, store=False)
        output = []
        for index, data in enumerate(records):
            if data["member"] != member:
                continue
            following = records[index + 1] if index + 1 < len(records) else None
            incomplete = data["partial"] or (following["partial"] if following else partial)
            omitted = sorted(set(data["uncovered"] + (following["uncovered"] if following else uncovered)))
            after = following["manifest"] if following else live
            # An incomplete walk cannot prove that an absent file was deleted.
            if incomplete:
                after = {**{path: value for path, value in data["manifest"].items() if path not in after}, **after}
            files = data.get("review", []) if data["state"] == "restored" else self._changes(data["manifest"], after, deadline)
            if not files and not incomplete:
                continue
            token = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()
            if data["state"] != "restored":
                reviews = data.setdefault("reviews", {})
                reviews[token] = files
                while len(reviews) > 5:
                    del reviews[next(iter(reviews))]
                data["review"] = files
                self._write(data["id"], data)
            output.append({key: data[key] for key in ("id", "member", "turn", "created", "state")} | {
                "partial": incomplete, "uncovered": omitted, "review_token": token,
                "files": [{"path": file["path"], "diff": file["diff"]} for file in files]})
        return list(reversed(output))[:MAX_CHECKPOINTS]

    def restore(self, identifier, *, member, review_token=None):
        data = self._get(identifier)
        if data.get("member") != member or data.get("state") != "ready" or "manifest" not in data:
            raise ValueError("unknown_checkpoint")
        if "review" not in data:
            self.list(member=member)
            data = self._get(identifier)
        restored, skipped = [], []
        deadline = time.monotonic() + WALK_SECONDS
        if review_token is not None and review_token not in data.get("reviews", {}):
            raise ValueError("checkpoint_changed")
        files = data.get("reviews", {}).get(review_token, data.get("review", []))
        for file in files:
            try:
                path = self._safe(file["path"])
                try:
                    current = self._read(path, deadline)[0]
                except FileNotFoundError:
                    current = None
                expected = file["after"]
                if (current and (current["digest"], current["mode"])) != (expected and (expected["digest"], expected["mode"])):
                    raise ValueError("later_change")
                original = file["before"]
                if original is None:
                    path.unlink()
                else:
                    content = self._bytes(original)
                    path.parent.mkdir(parents=True, exist_ok=True)
                    self._safe(path)
                    self._atomic(path, content)
                    path.chmod(original["mode"])
                restored.append(str(path))
            except (ValueError, OSError, TimeoutError):
                skipped.append(file["path"])
        data["state"] = "restored" if not skipped else "ready"
        self._write(identifier, data)
        return {"restored": restored, "skipped": skipped}


def main():
    action, metadata = sys.argv[1], json.loads(sys.argv[2])
    store = CheckpointStore("/home/cua/workspace/.raphael-checkpoints", ["/home/cua/workspace", "/home/cua/team"])
    if action == "begin":
        result = store.begin(member=metadata["member"], turn=metadata["turn"])
    elif action == "list":
        result = store.list(member=metadata["member"])
    elif action == "restore":
        result = store.restore(metadata["id"], member=metadata["member"], review_token=metadata.get("review_token"))
    else:
        raise ValueError("unknown_action")
    print(json.dumps(result))


if __name__ == "__main__":
    main()

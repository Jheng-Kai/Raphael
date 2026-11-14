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
# What programs write by themselves are never the member's work, whatever the folder is called or where it lies: a browser's
# user-data directory (its component updater, on-device models, extension manifests and caches), an app's own state and
# cache folders, and lock files. They are not tracked, not counted on the work card and never undone.
PROGRAM_FOLDERS = {".config", ".local", ".mozilla", ".pki", ".npm", ".tmp", ".thumbnails", ".dbus",
                   "OptGuideOnDeviceModel", "optimization_guide_model_store", "component_crx_cache", "extensions_crx_cache",
                   "WidevineCdm", "ZxcvbnData", "Safe Browsing", "GrShaderCache", "ShaderCache", "GraphiteDawnCache",
                   "Crashpad", "BrowserMetrics"}
UNTRACKED = EXCLUDED | PROGRAM_FOLDERS
LOCK_FILES = {"SingletonLock", "SingletonSocket", "SingletonCookie", ".parentlock"}
# A folder the carry-over published whole (computer/carry.py): the files of an older computer's home, put there by the core.
CARRIED = ".raphael-carried-member"
MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_ARCHIVE_BYTES = 500 * 1024 * 1024
MAX_CHECKPOINTS = 20
MAX_FILES = 10000
WALK_SECONDS = 8.0
# The change view reads text only: a file over this size or with a NUL byte in its first bytes is not compared.
TEXT_DIFF_BYTES = 1024 * 1024
SNIFF_BYTES = 8192
DIFF_FILES = 20
DIFF_SECONDS = 3.0


def program_file(name):
    return name in LOCK_FILES or name.startswith(".~lock.")


def browser_profile(names, dirs):
    """True for the folder a Chrome-family or Firefox browser keeps its profile in, which any name and place can hold."""
    if "Local State" in names and ("Default" in dirs or "First Run" in names or "Last Version" in names
                                   or any(name.startswith("Profile ") for name in dirs)):
        return True
    return "prefs.js" in names and any(name in names for name in ("places.sqlite", "compatibility.ini", "extensions.json"))


def profile_roots(paths):
    """The browser profiles a list of file paths shows (the same test as `browser_profile`, for a manifest or a review)."""
    parts = [Path(path).parts for path in paths]
    roots = set()
    for candidate in {part[:-1] for part in parts if part[-1] == "Local State"}:
        size = len(candidate)
        if any(len(part) > size and part[:size] == candidate and (part[size] in ("Default", "First Run", "Last Version") or part[size].startswith("Profile "))
               for part in parts):
            roots.add(candidate)
    return roots


class CheckpointStore:
    def __init__(self, archive, roots):
        self.archive = Path(archive)
        self.roots = [Path(root).absolute() for root in roots]

    def _safe(self, path):
        path = Path(path)
        root = next((root for root in self.roots if path.is_relative_to(root) and path != root), None)
        if root is None or ".." in path.parts or any(part in UNTRACKED for part in path.relative_to(root).parts) or program_file(path.name):
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
                if browser_profile(names, dirs):
                    dirs[:] = []
                    continue
                dirs[:] = sorted(name for name in dirs if name not in UNTRACKED and not (Path(directory) / name).is_symlink())
                for name in sorted(names):
                    if time.monotonic() >= deadline or len(files) >= MAX_FILES:
                        return files, uncovered + [str(Path(directory) / name)], True
                    path = Path(directory) / name
                    if name in UNTRACKED or program_file(name):
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

    def _relative(self, path):
        path = Path(path)
        root = next((root for root in self.roots if path.is_relative_to(root)), None)
        return path.relative_to(root).parts if root else path.parts

    def _program_paths(self, paths):
        """Which of these paths are what programs wrote by themselves (a browser's profile, an app's state and caches, lock
        files), by folder and file names and by the browser profiles the list itself shows. A checkpoint kept before the
        core left them out is read the same way, so nothing it holds of them is shown or undone."""
        paths = list(paths)
        roots = profile_roots(paths)
        output = set()
        for path in paths:
            parts = Path(path).parts
            if any(part in PROGRAM_FOLDERS for part in self._relative(path)) or program_file(parts[-1]) or any(parts[:len(root)] == root for root in roots):
                output.add(path)
        return output

    def _peek(self, value, path, deadline):
        """The first bytes of one side of a change, from the archive or, for a file that is only on the disk, from the disk."""
        if not value:
            return b""
        stored = self._object(value["digest"])
        if stored.exists():
            with stored.open("rb") as stream:
                return stream.read(SNIFF_BYTES)
        descriptor = os.open(self._safe(path), os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
        with os.fdopen(descriptor, "rb") as stream:
            return stream.read(SNIFF_BYTES)

    def _changes(self, before, after, deadline):
        # The folder a carry-over published whole in this window is the core's doing, not the member's work: its files are not listed.
        carried = {Path(path).parts[:-1] for path, value in after.items()
                   if Path(path).name == CARRIED and value.get("size") == 16 and path not in before}
        noise = self._program_paths(before.keys() | after.keys())
        files, diffed = [], 0
        # The text of a change is read only for the first files, within a few seconds, and never for a picture, a model or any file
        # past a megabyte: the list of changes must open at once, and a binary file is only named.
        diff_deadline = min(deadline, time.monotonic() + DIFF_SECONDS)
        for path in sorted(before.keys() | after.keys()):
            old, new = before.get(path), after.get(path)
            if path in noise or old and not old.get("digest") or new and not new.get("digest"):
                continue
            if (old and (old["digest"], old["mode"])) == (new and (new["digest"], new["mode"])):
                continue
            if not old and any(Path(path).parts[:len(folder)] == folder for folder in carried):
                continue
            diff, added, removed = "", None, None
            if time.monotonic() < diff_deadline and diffed < DIFF_FILES and max((old or {}).get("size", 0), (new or {}).get("size", 0)) <= TEXT_DIFF_BYTES:
                try:
                    if b"\0" in self._peek(old, path, deadline) + self._peek(new, path, deadline):
                        raise UnicodeError()
                    diffed += 1
                    left = self._bytes(old)
                    right = self._bytes(new) if new and self._object(new["digest"]).exists() else self._read(path, deadline)[1] if new else b""
                    if b"\0" in left + right:
                        raise UnicodeError()
                    lines = list(difflib.unified_diff(left.decode().splitlines(), right.decode().splitlines(), fromfile="before", tofile="after", lineterm=""))
                    # The two header lines are not content. The counts come from the whole diff, not from the shortened text kept below.
                    body = [line for line in lines[2:] if not line.startswith("@@")]
                    added, removed = sum(line.startswith("+") for line in body), sum(line.startswith("-") for line in body)
                    diff = "\n".join(lines)[:12000]
                except (UnicodeError, OSError, ValueError, TimeoutError):
                    pass
            # `added` and `removed` stay None where no text could be compared (a picture, a large file, past the twentieth text file): the owner is
            # told such a file is new, gone or changed, never "+0 -0".
            files.append({"path": path, "before": old, "after": new, "diff": diff, "added": added, "removed": removed})
        return files

    @staticmethod
    def _view(file):
        """What the owner is shown of one changed file. A file kept before `added` and `removed` existed has no counts."""
        change = "added" if not file.get("before") else "removed" if not file.get("after") else "changed"
        return {"path": file["path"], "diff": file["diff"], "change": change, "added": file.get("added"), "removed": file.get("removed")}

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
            # What lies between two checkpoints never changes, so it is read once: only the window after the newest checkpoint is
            # read again. A checkpoint kept before the core left program files out has no `review_after` and is read anew.
            window = following["id"] if following else None
            if data["state"] == "restored":
                files = data.get("review", [])
            elif window and data.get("review_after") == window and "review" in data:
                files = data["review"]
            else:
                files = self._changes(data["manifest"], after, deadline)
            if not files and not incomplete:
                continue
            token = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()
            if data["state"] != "restored":
                reviews = data.setdefault("reviews", {})
                known = token in reviews and data.get("review") == files and data.get("review_after") == window
                reviews[token] = files
                while len(reviews) > 5:
                    del reviews[next(iter(reviews))]
                data["review"] = files
                data["review_after"] = window
                if not known:
                    self._write(data["id"], data)
            output.append({key: data[key] for key in ("id", "member", "turn", "created", "state")} | {
                "partial": incomplete, "uncovered": omitted, "review_token": token,
                "files": [self._view(file) for file in files]})
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
        # A review kept before the core left program files out may still hold some: they are never put back or deleted.
        program = self._program_paths(file["path"] for file in files)
        for file in files:
            if file["path"] in program:
                continue
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

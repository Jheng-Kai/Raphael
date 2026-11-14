"""Guest-only reads and writes for a member's file tools (read_file, edit_file, write_file).

Runs in the member's computer with the image's Python and the standard library only, as checkpoints.py does. One JSON
request on stdin, one JSON answer on stdout: a file's bytes travel in base64 both ways and never on a command line, so a
whole file is not bound by the 32,767 characters a Windows command line holds for `docker exec`. A path inside a bind
mount (the workspace, the team folder) is opened one component at a time without following a link, so a link made on the
Windows side of the mount cannot lead outside it; elsewhere in the computer a path resolves as it does for `vm_exec`.
"""

import base64
import difflib
import errno
import hashlib
import json
import os
import secrets
import stat
import sys

CHUNK = 1 << 20
# A guest kernel opens without following a link, relative to a folder it holds open; a test on a host without those
# calls (Windows) walks by path with a look at each component instead.
SAFE = hasattr(os, "O_NOFOLLOW") and os.open in os.supports_dir_fd


class Folder:
    """The folder a file is in: a descriptor held open (in the guest), or its path (a host without descriptor calls)."""

    def __init__(self, path, parts, *, nofollow, create=False):
        self.nofollow = nofollow
        if not SAFE:
            for index in range(len(parts)):
                here = os.path.join(path, *parts[:index + 1])
                if nofollow and os.path.islink(here):
                    raise OSError(errno.ELOOP, "link")
                if create and not os.path.exists(here):
                    os.mkdir(here, 0o755)
            self.ref = os.path.join(path, *parts)
            return
        self.ref = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        flags = os.O_RDONLY | os.O_DIRECTORY | (os.O_NOFOLLOW if nofollow else 0)
        for part in parts:
            try:
                child = os.open(part, flags, dir_fd=self.ref)
            except FileNotFoundError:
                if not create:
                    self.close()
                    raise
                os.mkdir(part, 0o755, dir_fd=self.ref)
                child = os.open(part, flags, dir_fd=self.ref)
            os.close(self.ref)
            self.ref = child

    def close(self):
        if SAFE and self.ref is not None:
            os.close(self.ref)
        self.ref = None

    def stat(self, name):
        if SAFE:
            return os.stat(name, dir_fd=self.ref, follow_symlinks=not self.nofollow)
        path = os.path.join(self.ref, name)
        return os.lstat(path) if self.nofollow else os.stat(path)

    def open(self, name, flags, mode=0o644):
        flags |= os.O_NOFOLLOW if self.nofollow and SAFE else 0
        if SAFE:
            return os.open(name, flags, mode, dir_fd=self.ref)
        return os.open(os.path.join(self.ref, name), flags | getattr(os, "O_BINARY", 0), mode)

    def names(self):
        return os.listdir(self.ref)

    def replace(self, source, name):
        if SAFE:
            os.replace(source, name, src_dir_fd=self.ref, dst_dir_fd=self.ref)
        else:
            os.replace(os.path.join(self.ref, source), os.path.join(self.ref, name))

    def remove(self, name):
        if SAFE:
            os.unlink(name, dir_fd=self.ref)
        else:
            os.unlink(os.path.join(self.ref, name))


def locate(path, roots, *, create=False):
    """The folder of `path` and its last name. Under one of `roots` (the bind mounts) no link is followed."""
    for root in roots:
        if path == root or path.startswith(root.rstrip("/") + "/"):
            parts = [part for part in path[len(root):].split("/") if part]
            if not parts or ".." in parts:
                raise OSError(errno.EISDIR if not parts else errno.EINVAL, "path")
            return Folder(root, parts[:-1], nofollow=True, create=create), parts[-1]
    head, _, name = path.rpartition("/")
    if not name:
        raise OSError(errno.EISDIR, "path")
    parts = [part for part in head.split("/") if part]
    return Folder("/", parts, nofollow=False, create=create), name


def kind_of(mode):
    return ("file" if stat.S_ISREG(mode) else "directory" if stat.S_ISDIR(mode)
            else "link" if stat.S_ISLNK(mode) else "other")


def digest_of(folder, name, limit):
    """The whole file's sha256 and its first `limit` bytes, in one pass over it."""
    fd = folder.open(name, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0))
    digest, head = hashlib.sha256(), bytearray()
    with os.fdopen(fd, "rb") as stream:
        while chunk := stream.read(CHUNK):
            digest.update(chunk)
            if len(head) < limit:
                head.extend(chunk[:limit - len(head)])
    return digest.hexdigest(), bytes(head)


def scan(folder, name, limit, line):
    """One pass over a file: its sha256 and how many lines it has, and up to `limit` of its bytes from the start of line
    `line` on (`cut` when there were more). A file in UTF-16 is given from its start, its lines uncounted: a line end is
    two bytes there."""
    fd = folder.open(name, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0))
    digest, head, newlines, last, seen, cut, wide = hashlib.sha256(), bytearray(), 0, b"", 1, False, None
    with os.fdopen(fd, "rb") as stream:
        while chunk := stream.read(CHUNK):
            if wide is None:
                wide = chunk.startswith((b"\xff\xfe", b"\xfe\xff"))
                line = 1 if wide else line
            digest.update(chunk)
            start, position = 0, -1
            while seen < line:
                position = chunk.find(b"\n", position + 1)
                if position < 0:
                    start = len(chunk)
                    break
                seen += 1
                start = position + 1
            if seen >= line:
                piece = chunk[start:]
                room = max(0, limit - len(head))
                head.extend(piece[:room])
                cut = cut or len(piece) > room
            newlines += chunk.count(b"\n")
            last = chunk[-1:]
    return {"sha256": digest.hexdigest(), "data": base64.b64encode(head).decode(), "cut": cut,
            "start_line": line if seen >= line else None,
            "total_lines": None if wide else newlines + (1 if last and last != b"\n" else 0)}


def read(request):
    """What is at a path: a missing file says which names near it exist; a file gives its size, its sha256, its number
    of lines and up to `limit` of its bytes from line `line` on; a folder its first names."""
    try:
        folder, name = locate(request["path"], request["roots"])
    except FileNotFoundError:
        return {"exists": False, "near": []}
    try:
        try:
            info = folder.stat(name)
        except FileNotFoundError:
            try:
                near = difflib.get_close_matches(name, folder.names(), n=5, cutoff=0.5)
            except FileNotFoundError:
                near = []  # Its folder is missing too.
            return {"exists": False, "near": sorted(near)}
        kind = kind_of(info.st_mode)
        answer = {"exists": True, "kind": kind, "size": info.st_size, "mtime": info.st_mtime}
        if kind == "directory":
            answer["names"] = sorted(os.listdir(request["path"]))[:50]
        if kind == "file":
            answer.update(scan(folder, name, int(request.get("limit", 0)), max(1, int(request.get("line", 1)))))
        return answer
    finally:
        folder.close()


def write(request):
    """Write a whole file in place of what is there, only if what is there is what the caller last saw (`expected`:
    its sha256, or "absent" for a new file); parent folders are made. Written to a new name and renamed over the old,
    keeping its mode, so a reader never sees half a file."""
    data = base64.b64decode(request["data"], validate=True)
    folder, name = locate(request["path"], request["roots"], create=True)
    try:
        try:
            info = folder.stat(name)
        except FileNotFoundError:
            info, current = None, None
        else:
            if kind_of(info.st_mode) != "file":
                return {"error": "not_a_file", "kind": kind_of(info.st_mode)}
            current = digest_of(folder, name, 0)[0]
        if (current or "absent") != request["expected"]:
            return {"error": "changed", "sha256": current}
        mode = stat.S_IMODE(info.st_mode) if info else 0o644
        temporary = f".{name[:200]}.raphael-{secrets.token_hex(6)}.tmp"
        fd = folder.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            if info and hasattr(os, "chmod") and SAFE:
                os.chmod(temporary, mode, dir_fd=folder.ref)
            folder.replace(temporary, name)
        except BaseException:
            try:
                folder.remove(temporary)
            except OSError:
                pass
            raise
        return {"sha256": hashlib.sha256(data).hexdigest(), "size": len(data), "created": info is None}
    finally:
        folder.close()


ACTIONS = {"read": read, "write": write}
# By the number this system gives each (a Windows test host numbers ELOOP otherwise than Linux does).
ERRORS = {getattr(errno, name): name for name in ("EACCES", "EPERM", "ELOOP", "ENOTDIR", "EISDIR", "ENOSPC", "EROFS",
                                                  "EINVAL", "ENOENT", "EEXIST", "ENAMETOOLONG") if hasattr(errno, name)}


def handle(request):
    try:
        return ACTIONS[request["action"]](request)
    except OSError as error:
        return {"error": ERRORS.get(error.errno, "os_error")}


if __name__ == "__main__":
    sys.stdout.write(json.dumps(handle(json.loads(sys.stdin.buffer.read()))))

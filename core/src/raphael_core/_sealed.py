"""The authenticated secrets.bin document used by the macOS credential door."""

import base64
import json
import os
import secrets
import tempfile
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from keyring.errors import KeyringError

try:
    import fcntl
except ImportError:
    fcntl = None


class SealedStoreError(KeyringError):
    """An existing store or its key could not be read safely."""


Index = dict[str, list[str]]
Values = dict[str, dict[str, str]]


def _json(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def _index(value: object) -> bool:
    return isinstance(value, dict) and all(
        isinstance(accounts, list) and all(isinstance(account, str) for account in accounts)
        for accounts in value.values()
    )


class Document:
    def __init__(self, names: Index, moved: Index, box: bytes | None):
        self.names = names
        self.moved = moved
        self.box = box
        self.values: Values | None = None

    @classmethod
    def parse(cls, raw: bytes) -> "Document":
        try:
            data = json.loads(raw)
            if (set(data) != {"v", "names", "moved", "box"} or type(data["v"]) is not int or data["v"] != 1
                    or not _index(data["names"]) or not _index(data["moved"])):
                raise ValueError
            return cls(data["names"], data["moved"], base64.b64decode(data["box"], validate=True))
        except (KeyError, ValueError, TypeError, RecursionError) as error:
            raise SealedStoreError(type(error).__name__) from None

    def header(self):
        return {"v": 1, "names": self.names, "moved": self.moved}

    def knows(self, service: str, account: str) -> bool:
        return account in self.names.get(service, ()) or account in self.moved.get(service, ())

    def unlock(self, cipher: AESGCM) -> Values:
        if self.values is None:
            try:
                values = {} if self.box is None else json.loads(
                    cipher.decrypt(self.box[:12], self.box[12:], _json(self.header()))
                )
                if not isinstance(values, dict) or values.keys() != self.names.keys():
                    raise ValueError
                for service, accounts in values.items():
                    if not isinstance(accounts, dict) or accounts.keys() != set(self.names[service]):
                        raise ValueError
                    if not all(isinstance(secret, str) for secret in accounts.values()):
                        raise ValueError
            except (InvalidTag, ValueError, TypeError, RecursionError) as error:
                raise SealedStoreError(type(error).__name__) from None
            self.values = values
        return self.values


_writers = threading.Lock()


class SealedFile:
    def __init__(self, path: Path):
        self.path = path.absolute()
        self._lock = threading.Lock()
        self._stamp = None
        self._document = Document({}, {}, None)

    def load(self, *, force=False) -> Document:
        with self._lock:
            try:
                stat = self.path.stat()
                stamp = (stat.st_ino, stat.st_mtime_ns, stat.st_size)
                if force or self._stamp != stamp:
                    with self.path.open("rb") as source:
                        stat = os.fstat(source.fileno())
                        self._document = Document.parse(source.read())
                        self._stamp = (stat.st_ino, stat.st_mtime_ns, stat.st_size)
            except FileNotFoundError:
                self._document = Document({}, {}, None)
                self._stamp = None
            except OSError as error:
                raise SealedStoreError(type(error).__name__) from None
            return self._document

    @contextmanager
    def editing(self) -> Iterator[Document]:
        with _writers:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            if fcntl is None:
                yield self.load(force=True)
            else:
                with self.path.with_suffix(".lock").open("a+b") as lock:
                    fcntl.flock(lock, fcntl.LOCK_EX)
                    yield self.load(force=True)

    def save(self, cipher: AESGCM, values: Values, moved: Index) -> None:
        names = {s: sorted(accounts) for s, accounts in values.items()}
        updated = Document(names, moved, None)
        nonce = secrets.token_bytes(12)
        updated.box = nonce + cipher.encrypt(nonce, _json(values), _json(updated.header()))
        updated.values = values
        raw = _json({**updated.header(), "box": base64.b64encode(updated.box).decode("ascii")})
        target = tempfile.NamedTemporaryFile(dir=self.path.parent, delete=False)
        temp = Path(target.name)
        try:
            with target:
                target.write(raw)
                # On disk before the rename, so a crash or a power cut never leaves an empty secrets.bin.
                target.flush()
                os.fsync(target.fileno())
            stat = temp.stat()
            with self._lock:
                os.replace(temp, self.path)
                self._document = updated
                self._stamp = (stat.st_ino, stat.st_mtime_ns, stat.st_size)
        finally:
            temp.unlink(missing_ok=True)

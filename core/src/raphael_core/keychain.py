"""The one door to the owner's credential store: Windows Credential Manager or the macOS Keychain, through keyring.

Every secret of Raphael (the model keys, the secrets of plugins and apps, the members' sign-ins) is read and written here,
so how the store is asked is decided in one place.

The macOS Keychain asks the owner before a program reads the secret of an item that the program did not write, or that a
build with another signature wrote, and its "Allow" answers that one read only. A read waits until the owner answers. So,
with the Keychain (R-PRIV-KEYCHAIN-01):

- whether a secret is kept is answered from the item's attributes, which the Keychain gives without asking (`has`,
  `peek`). A status, a list or a check never puts a question to the owner. A lookup the Keychain cannot answer never
  breaks a status or a list either: `peek` then counts the secret as kept but unread, and the read when it is used says
  what is there; `has`, asked to prove something is gone, raises instead;
- a secret is read only when it is used, and at most once in a run: what was read stays in this process (`read`), and
  reads wait for one another, so one item is never asked about twice at once;
- the owner's "Deny" stands. Nothing more is asked and every read is refused at once (`Refused`) until the owner chooses
  to be asked again (`ask_again`, the button of the window's notice) or Raphael starts again. The window is told of the
  refusal at once and of a read it turned away at most once a minute (`on_refused`), so the notice is there when a
  feature needs a key.

On macOS one master key per data directory seals secrets.bin (R-PRIV-KEYCHAIN-02). Its public index answers status
checks without a Keychain read. Older items move on first use and stay in the Keychain for other editions.
Windows Credential Manager never asks, so there every call goes straight to the store, as before.

Never log or print a secret from this module.
"""

import base64
import logging
import secrets
import threading
import time
from collections.abc import Callable
from pathlib import Path

import keyring
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from keyring.errors import KeyringError, KeyringLocked, PasswordDeleteError

from ._sealed import Document, SealedFile, SealedStoreError

logger = logging.getLogger(__name__)

class _Unread:
    def __repr__(self) -> str:
        return "UNREAD"


# What `peek` gives for a secret that is kept but has not been read in this run: reading it would ask the owner.
UNREAD = _Unread()
# A refused read is told to the window at most this often (seconds).
TELL_EVERY_S = 60.0
# What the Keychain answers when the owner chose Deny: errSecUserCanceled, or errSecAuthFailed.
_DENIED = {-128, -25293}
# What the Keychain answers when there is no such item: errSecItemNotFound.
NOT_FOUND = -25300
_MASTER_SERVICE = "Raphael Safe Storage"


class Refused(KeyringLocked):
    """The owner refused Raphael the Keychain in this run; nothing more is asked until they choose to be asked again."""


def _was_refused(error: KeyringError) -> bool:
    if isinstance(error, KeyringLocked):
        return True
    cause = error.__cause__
    return bool(cause is not None and cause.args and cause.args[0] in _DENIED)


def _keychain_backend(backend: object) -> bool:
    """Whether `backend` is keyring's macOS Keychain (and not a test's own keyring, nor another system's store)."""
    try:
        from keyring.backends import macOS
    except Exception:
        return False
    return isinstance(backend, macOS.Keyring)


def _attributes_kept(service: str, account: str) -> bool:
    """Whether the Keychain keeps a generic password of `service` and `account`, from its attributes alone: the secret is
    not asked for, so the Keychain asks the owner nothing (SecItemCopyMatching with kSecReturnAttributes only)."""
    from ctypes import byref, c_void_p

    from keyring.backends.macOS import api

    found = api._found
    release = found.CFRelease
    release.argtypes, release.restype = (c_void_p,), None
    owned = [api.create_cf(service), api.create_cf(account), api.create_cf(True)]
    names = ("kSecClass", "kSecMatchLimit", "kSecAttrService", "kSecAttrAccount", "kSecReturnAttributes")
    values = (api.k_("kSecClassGenericPassword"), api.k_("kSecMatchLimitOne"), *owned)
    query = found.CFDictionaryCreate(None, (c_void_p * len(names))(*map(api.k_, names)), (c_void_p * len(values))(*values),
                                     len(names), found.kCFTypeDictionaryKeyCallBacks, found.kCFTypeDictionaryValueCallBacks)
    result = c_void_p()
    try:
        status = api.SecItemCopyMatching(query, byref(result))
    finally:
        for value in (query, result.value, *owned):
            if value:
                release(value)
    if status == 0:
        return True
    if status == api.error.item_not_found:
        return False
    raise KeyringError(f"Can't look in the keychain: {status}")


class Keychain:
    """The store, asked as the module's docstring says. `asks` forces whether reading may ask the owner (a test's);
    left None it is whether the store in use is the macOS Keychain. `look` answers whether an item is kept without
    reading it (the Keychain's attributes by default)."""

    def __init__(self, *, asks: bool | None = None, look: Callable[[str, str], bool] | None = None,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self._asks = asks
        self._look = look
        self._clock = clock
        # `_state` guards what follows for an instant; `_asking` is held across a read that may wait for the owner.
        self._state = threading.Lock()
        self._asking = threading.Lock()
        self._backend: object = None
        self._file: SealedFile | None = None
        self._cipher: AESGCM | None = None
        self._kept: dict[tuple[str, str], str] = {}
        self._present: dict[tuple[str, str], bool] = {}
        self._refused = False
        self._told_at: float | None = None
        self._lookup_failed = False
        self.on_refused: Callable[[], None] = lambda: None

    def seal(self, path: Path | None) -> None:
        """Start or end a data directory's run, forgetting its unlocked credentials."""
        with self._asking, self._state:
            self._file = SealedFile(path) if path is not None else None
            self._cipher = None
            self._kept.clear()
            self._present.clear()
            self._refused, self._told_at = False, None

    def _asks_now(self) -> bool:
        """Whether reading may ask the owner, after forgetting what belonged to another store (a test's own keyring)."""
        backend = keyring.get_keyring()
        with self._state:
            if backend is not self._backend:
                self._backend, self._kept, self._present, self._refused, self._told_at = backend, {}, {}, False, None
                self._cipher = None
                if self._file is not None:
                    self._file = SealedFile(self._file.path)
        return _keychain_backend(backend) if self._asks is None else self._asks

    def asks(self) -> bool:
        """Whether reading a secret may put a question to the owner (the macOS Keychain)."""
        return self._asks_now()

    @property
    def refused(self) -> bool:
        self._asks_now()
        with self._state:
            return self._refused

    def ask_again(self) -> None:
        """The owner chose to be asked again: the next read that needs the Keychain asks."""
        with self._state:
            self._refused, self._told_at = False, None

    def _tell(self) -> None:
        with self._state:
            now = self._clock()
            if self._told_at is not None and now - self._told_at < TELL_EVERY_S:
                return
            self._told_at = now
        try:
            self.on_refused()
        except Exception:  # a broken listener must not turn a refusal into another failure
            pass

    def read(self, service: str, account: str) -> str | None:
        """The secret, or None when none is kept. With the Keychain it may ask the owner, once in a run; it raises
        `Refused` when the owner said no."""
        if not self._asks_now():
            return keyring.get_password(service, account)
        with self._asking:
            store = self._file
            if store is None:
                return self._read_item(service, account)
            known, value = self._sealed_value(store, store.load(), service, account)
            if known:
                return value
            if not self._legacy_kept(service, account):
                return None
            # Another process may have moved or removed the item since our first look.
            with store.editing() as doc:
                known, value = self._sealed_value(store, doc, service, account)
                if known:
                    return value
                value = self._read_item(service, account)
                if value is not None:
                    self._save(store, doc, service, account, value)
                return value

    def _sealed_value(self, store: SealedFile, doc: Document, service: str, account: str) -> tuple[bool, str | None]:
        """Whether the sealed file knows the name, and its secret. Only a kept name opens the box, so asking for a
        name the file does not keep never asks the owner for the master key."""
        if account in doc.names.get(service, ()):
            return True, doc.unlock(self._master(store, doc))[service][account]
        if account in doc.moved.get(service, ()):
            return True, None
        return False, None

    def _read_item(self, service: str, account: str) -> str | None:
        """Read a Keychain item with _asking held."""
        key = (service, account)
        with self._state:
            if key in self._kept:
                return self._kept[key]
            refused = self._refused
        if refused:
            self._tell()
            raise Refused("The owner refused Raphael the Keychain")
        try:
            value = keyring.get_password(service, account)
        except KeyringError as error:
            if not _was_refused(error):
                raise
            with self._state:
                self._refused = True
            self._tell()
            raise Refused("The owner refused Raphael the Keychain") from None
        with self._state:
            self._present[key] = value is not None
            if value is not None:
                self._kept[key] = value
        return value

    def _master(self, store: SealedFile, doc: Document) -> AESGCM:
        if self._cipher is None:
            account = str(store.path.parent)
            if doc.box is not None and self._present.get((_MASTER_SERVICE, account)) is False:
                raise SealedStoreError("Missing master key")
            encoded = self._read_item(_MASTER_SERVICE, account)
            if encoded is None:
                if doc.box is not None:
                    raise SealedStoreError("Missing master key")
                raw = secrets.token_bytes(32)
                keyring.set_password(_MASTER_SERVICE, account, base64.b64encode(raw).decode("ascii"))
            else:
                try:
                    raw = base64.b64decode(encoded, validate=True)
                    if len(raw) != 32:
                        raise ValueError
                except ValueError:
                    raise SealedStoreError("Invalid master key") from None
            self._cipher = AESGCM(raw)
        return self._cipher

    def _save(self, store: SealedFile, doc: Document, service: str, account: str, value: str | None) -> None:
        cipher = self._master(store, doc)
        values = doc.unlock(cipher).copy()
        accounts = values.get(service, {}).copy()
        if value is None:
            accounts.pop(account, None)
        else:
            accounts[account] = value
        if accounts:
            values[service] = accounts
        else:
            values.pop(service, None)
        moved = {**doc.moved, service: sorted({*doc.moved.get(service, ()), account})}
        store.save(cipher, values, moved)

    def _legacy_kept(self, service: str, account: str) -> bool:
        return service != _MASTER_SERVICE and self._kept_now(service, account)

    def _sealed_peek(self, store: SealedFile, service: str, account: str) -> str | None | _Unread:
        doc = store.load()
        cipher = self._cipher
        if cipher is not None and doc.box is not None:
            doc.unlock(cipher)
        if account in doc.names.get(service, ()):
            return UNREAD if doc.values is None else doc.values[service][account]
        if account in doc.moved.get(service, ()):
            return None
        return UNREAD if self._legacy_kept(service, account) else None

    def _kept_now(self, service: str, account: str) -> bool:
        """Whether the Keychain keeps the item, from its attributes (never its secret); raises when it cannot say."""
        key = (service, account)
        with self._state:
            if key in self._kept:
                return True
            present = self._present.get(key)
        if present is None:
            present = (self._look or _attributes_kept)(service, account)
            with self._state:
                self._present[key] = present
        return present

    def peek(self, service: str, account: str) -> "str | None | _Unread":
        """The secret when it can be had without asking anyone, None when none is kept, or UNREAD when one is kept that
        has not been read in this run. Never asks the owner. A lookup the Keychain cannot answer counts as UNREAD (kept,
        not read): a status or a list never fails on it, and the read when the secret is used says what is there."""
        if not self._asks_now():
            return keyring.get_password(service, account)
        try:
            store = self._file
            if store is not None:
                return self._sealed_peek(store, service, account)
            with self._state:
                if (service, account) in self._kept:
                    return self._kept[(service, account)]
            present = self._kept_now(service, account)
        except Exception as error:  # the Keychain's own answer, or the lookup itself; never a secret
            with self._state:
                first, self._lookup_failed = not self._lookup_failed, True
            if first:
                logger.warning("The Keychain could not say whether an item is kept: %s", type(error).__name__)
            return UNREAD
        return UNREAD if present else None

    def has(self, service: str, account: str) -> bool:
        """Whether a secret is kept. Never asks the owner; raises when the Keychain cannot say, since a caller proving a
        secret gone must not take "unknown" for either answer."""
        if not self._asks_now():
            return keyring.get_password(service, account) is not None
        store = self._file
        if store is not None:
            return self._sealed_peek(store, service, account) is not None
        return self._kept_now(service, account)

    def write(self, service: str, account: str, value: str) -> None:
        asks = self._asks_now()
        with self._asking:
            if asks and self._file is not None:
                with self._file.editing() as doc:
                    self._save(self._file, doc, service, account, value)
                return
            keyring.set_password(service, account, value)
            if asks:
                with self._state:
                    self._kept[(service, account)], self._present[(service, account)] = value, True

    def remove(self, service: str, account: str) -> None:
        """Removes the secret; keyring's PasswordDeleteError when there is none."""
        asks = self._asks_now()
        with self._asking:
            store = self._file
            if not asks or store is None:
                self._delete_item(service, account, asks)
                return
            with store.editing() as doc:
                if doc.box is not None:
                    doc.unlock(self._master(store, doc))
                present = account in doc.names.get(service, ())
                legacy = service != _MASTER_SERVICE and (self._look or _attributes_kept)(service, account)
                if not present and not legacy:
                    raise PasswordDeleteError("No such item")
                # Open the store before touching the old item, including on first use.
                self._master(store, doc)
                if legacy:
                    try:
                        self._delete_item(service, account, True)
                    except PasswordDeleteError as error:
                        cause = error.__cause__
                        if not (cause and cause.args and cause.args[0] == NOT_FOUND):
                            # A tombstone hides a legacy item recreated by another edition.
                            # Callers cannot use has() to confirm this deletion.
                            if not present and doc.knows(service, account):
                                raise KeyringError(type(error).__name__) from None
                            raise
                self._save(store, doc, service, account, None)

    def _delete_item(self, service: str, account: str, asks: bool) -> None:
        try:
            keyring.delete_password(service, account)
        finally:
            if asks:
                with self._state:
                    self._kept.pop((service, account), None)
                    self._present.pop((service, account), None)


DOOR = Keychain()


def read(service: str, account: str) -> str | None:
    return DOOR.read(service, account)


def peek(service: str, account: str) -> "str | None | _Unread":
    return DOOR.peek(service, account)


def has(service: str, account: str) -> bool:
    return DOOR.has(service, account)


def write(service: str, account: str, value: str) -> None:
    DOOR.write(service, account, value)


def remove(service: str, account: str) -> None:
    DOOR.remove(service, account)


def asks() -> bool:
    return DOOR.asks()


def filled(value: "str | None | _Unread") -> bool:
    """Whether a peeked secret counts as kept: a non-blank one, or one kept but not read yet (it is not asked for only to
    see whether it is blank)."""
    return value is UNREAD or bool(isinstance(value, str) and value.strip())

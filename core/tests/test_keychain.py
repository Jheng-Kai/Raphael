"""The door to the credential store asks the owner as little as the macOS Keychain allows (R-PRIV-KEYCHAIN-01).

The Keychain is played by the in-memory keyring of tests/conftest.py, counting its reads, and a `look` that answers from
it without reading: nothing here reaches the real Keychain or Credential Manager.
"""

import base64
import json
import multiprocessing
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import keyring
import keyring.errors
import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from raphael_core import keychain
from raphael_core.brain.providers.registry import ProviderRegistry
from raphael_core.brain.providers.secrets import ProviderCredentialStore
from raphael_core.brain.secrets import CredentialKeyStore
from raphael_core.integrations.vault import CredentialVault
from raphael_core.services.keys import credential_keys


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


@pytest.fixture
def asking(memory_keyring, monkeypatch):
    """A door that behaves as with the macOS Keychain: every read of a secret is a question to the owner."""
    reads = []
    original = memory_keyring.get_password

    def counted(service, username):
        reads.append((service, username))
        return original(service, username)

    monkeypatch.setattr(memory_keyring, "get_password", counted)

    def look(service, username):
        # The store in use, unread and uncounted: what the Keychain's attributes tell.
        return type(memory_keyring).get_password(keyring.get_keyring(), service, username) is not None

    door = keychain.Keychain(asks=True, look=look, clock=Clock())
    monkeypatch.setattr(keychain, "DOOR", door)
    door.reads = reads
    door.backend = memory_keyring
    return door


def refuse(door, monkeypatch, error=None):
    """The owner chooses Deny on every question from now on."""
    def denied(service, username):
        door.reads.append((service, username))
        raise error or keyring.errors.KeyringLocked("Can't get password from keychain: (-128, 'Keychain Access Denied')")

    monkeypatch.setattr(door.backend, "get_password", denied)


def test_whether_a_secret_is_kept_is_answered_without_reading_it(asking, memory_keyring):
    memory_keyring.set_password("Raphael", "openrouter", "sk-or-v1-abc")
    store = CredentialKeyStore()
    assert store.filled() is True
    assert store.peek() is keychain.UNREAD
    assert CredentialKeyStore(username="nobody").filled() is False
    assert asking.reads == []


def test_vault_does_not_report_a_still_present_credential_as_deleted(asking, monkeypatch):
    vault = CredentialVault()
    vault.set("fixture", "synthetic-fixture")

    def failed_delete(service, username):
        raise keyring.errors.PasswordDeleteError("Deletion failed")

    monkeypatch.setattr(asking.backend, "delete_password", failed_delete)
    with pytest.raises(keyring.errors.PasswordDeleteError):
        vault.delete("fixture")
    assert vault.has("fixture") and not asking.reads
    vault.delete("missing")


def test_a_lookup_the_keychain_cannot_answer_never_breaks_a_status_and_never_proves_a_secret_gone(asking, memory_keyring):
    """A locked login keychain, or a lookup the Keychain refuses: a status counts the secret as kept but unread (the read
    when it is used says what is there), and nothing takes "unknown" for "gone"."""
    def cannot_say(service, username):
        raise keyring.errors.KeyringError("Can't look in the keychain: -25308")

    asking._look = cannot_say
    vault = CredentialVault()
    assert vault.filled("connectors:composio:key") is True
    assert keychain.peek("Raphael plugin connectors:composio:key", "secret") is keychain.UNREAD
    with pytest.raises(keyring.errors.KeyringError):
        vault.has("connectors:composio:key")
    assert asking.reads == []


def test_deleting_what_the_keychain_does_not_hold_needs_no_lookup(asking, memory_keyring, monkeypatch):
    """The macOS backend says "no such item" (errSecItemNotFound) through PasswordDeleteError's cause: that is gone, with no
    lookup that might fail; any other failure is still checked, and one that left the secret raises."""
    def cannot_say(service, username):
        raise keyring.errors.KeyringError("Can't look in the keychain: -25308")

    def not_found(service, username):
        raise keyring.errors.PasswordDeleteError("Can't delete password in keychain") from Exception(-25300, "Item not found")

    asking._look = cannot_say
    monkeypatch.setattr(asking.backend, "delete_password", not_found)
    CredentialVault().delete("messaging:member:5:telegram:bot_token")

    def refused(service, username):
        raise keyring.errors.PasswordDeleteError("Can't delete password in keychain") from Exception(-25293, "Security Auth Failure")

    asking._look = lambda service, username: True
    asking._present.clear()
    monkeypatch.setattr(asking.backend, "delete_password", refused)
    with pytest.raises(keyring.errors.PasswordDeleteError):
        CredentialVault().delete("messaging:member:5:telegram:bot_token")
    assert asking.reads == []


def test_a_secret_is_read_once_in_a_run(asking, memory_keyring):
    memory_keyring.set_password("Raphael", "openrouter", "sk-or-v1-abc")
    store = CredentialKeyStore()
    assert [store.get() for _ in range(5)] == ["sk-or-v1-abc"] * 5
    assert asking.reads == [("Raphael", "openrouter")]
    # Once read, a peek has it without asking.
    assert store.peek() == "sk-or-v1-abc"
    assert len(asking.reads) == 1


def test_reads_at_once_ask_one_question(asking, memory_keyring, monkeypatch):
    memory_keyring.set_password("Raphael", "openrouter", "sk-or-v1-abc")
    original, answering = memory_keyring.get_password, threading.Event()

    def slow(service, username):
        answering.wait(5)  # the owner takes a moment to answer
        return original(service, username)

    monkeypatch.setattr(memory_keyring, "get_password", slow)
    results = []
    threads = [threading.Thread(target=lambda: results.append(CredentialKeyStore().get())) for _ in range(4)]
    for thread in threads:
        thread.start()
    time.sleep(0.1)
    answering.set()
    for thread in threads:
        thread.join(5)
    assert results == ["sk-or-v1-abc"] * 4
    assert asking.reads == [("Raphael", "openrouter")]


def test_a_deny_stands_until_the_owner_asks_to_be_asked_again(asking, memory_keyring, monkeypatch):
    memory_keyring.set_password("Raphael", "openrouter", "sk-or-v1-abc")
    memory_keyring.set_password("Raphael plugin gmail", "secret", "token")
    told = []
    asking.on_refused = lambda: told.append(asking._clock())
    original = memory_keyring.get_password
    refuse(asking, monkeypatch)
    with pytest.raises(keychain.Refused):
        CredentialKeyStore().get()
    assert told == [1000.0] and asking.refused
    # Nothing more is asked, of this secret or any other, and the window is not told again within the minute.
    for _ in range(3):
        with pytest.raises(keychain.Refused):
            CredentialKeyStore().get()
        with pytest.raises(keychain.Refused):
            CredentialVault().get("gmail")
    assert len(asking.reads) == 1 and told == [1000.0]
    # Whether a secret is kept is still answered: it is, and reading it is what was refused.
    assert CredentialKeyStore().filled() and CredentialVault().has("gmail")
    asking._clock.now += keychain.TELL_EVERY_S
    with pytest.raises(keychain.Refused):
        CredentialKeyStore().get()
    assert told == [1000.0, 1060.0] and len(asking.reads) == 1
    # The owner presses 再問一次 and allows: the next read asks once more.
    asking.ask_again()
    monkeypatch.setattr(memory_keyring, "get_password", original)
    assert not asking.refused
    assert CredentialKeyStore().get() == "sk-or-v1-abc"


def test_an_auth_failure_is_a_deny_and_another_failure_is_not(asking, memory_keyring, monkeypatch):
    memory_keyring.set_password("Raphael", "openrouter", "sk-or-v1-abc")
    other = keyring.errors.KeyringError("Can't get password from keychain: (-25299, 'Unknown Error')")
    other.__cause__ = Exception(-25299, "Unknown Error")
    refuse(asking, monkeypatch, other)
    with pytest.raises(keyring.errors.KeyringError) as raised:
        CredentialKeyStore().get()
    assert not isinstance(raised.value, keychain.Refused) and not asking.refused
    denied = keyring.errors.KeyringError("Can't get password from keychain: (-25293, 'Security Auth Failure')")
    denied.__cause__ = Exception(-25293, "Security Auth Failure")
    refuse(asking, monkeypatch, denied)
    with pytest.raises(keychain.Refused):
        CredentialKeyStore().get()
    assert asking.refused


def test_what_is_written_is_known_and_what_is_removed_is_gone(asking, memory_keyring):
    store = CredentialKeyStore()
    store.set("sk-or-v1-new")
    assert store.get() == "sk-or-v1-new" and store.peek() == "sk-or-v1-new"
    assert asking.reads == []
    store.clear()
    assert store.peek() is None and store.filled() is False
    assert memory_keyring.credentials == {}


def test_long_provider_credentials_are_seen_without_reading_a_piece(asking, memory_keyring):
    ProviderCredentialStore("provider:p1").set("x" * 3000)
    # A new run: nothing read yet.
    asking._kept.clear()
    asking._present.clear()
    asking.reads.clear()
    stored = ProviderCredentialStore("provider:p1")
    assert stored.peek() is keychain.UNREAD and stored.filled()
    assert asking.reads == []
    assert stored.get() == "x" * 3000


def test_the_providers_and_the_service_keys_never_ask_for_a_list(asking, memory_keyring, conn):
    CredentialKeyStore().set("sk-or-v1-abc")
    ProviderCredentialStore("provider:p1").set("sk-ant-abc")
    credential_keys().set("brave", "BSA" + "a" * 28)
    asking._kept.clear()
    asking._present.clear()
    asking.reads.clear()

    class Client:
        def known_models(self):
            return []

    registry = ProviderRegistry(conn, Client(), CredentialKeyStore())
    assert registry._has_credential("openrouter", registry.config("openrouter"))
    assert registry._has_credential("p1", {"kind": "anthropic"})
    assert credential_keys().has("brave") and not credential_keys().has("tavily")
    assert asking.reads == []


def test_a_test_keyring_or_windows_is_never_asked_through_the_attributes(memory_keyring):
    # Not the macOS Keychain: every call goes to the store as before, and a change made there is seen at once.
    door = keychain.Keychain()
    memory_keyring.set_password("Raphael", "openrouter", "one")
    assert door.peek("Raphael", "openrouter") == "one"
    memory_keyring.set_password("Raphael", "openrouter", "two")
    assert door.read("Raphael", "openrouter") == "two"
    assert door.has("Raphael", "nobody") is False


def test_another_store_starts_from_nothing(asking, memory_keyring):
    CredentialKeyStore().set("sk-or-v1-abc")
    asking._refused = True
    keyring.set_keyring(type(memory_keyring)())
    try:
        assert not asking.refused
        assert CredentialKeyStore().peek() is None
    finally:
        keyring.set_keyring(memory_keyring)


@pytest.fixture
def sealed(asking, tmp_path):
    path = tmp_path / "secrets.bin"
    asking.seal(path)
    return path


def fresh_door(asking, path):
    door = keychain.Keychain(asks=True, look=asking._look)
    door.seal(path)
    return door


def test_secrets_are_sealed_with_one_master_key(asking, sealed, memory_keyring):
    asking.write("app", "account", "synthetic-private-token")
    raw = sealed.read_bytes()
    assert b"synthetic-private-token" not in raw
    header = json.loads(raw)
    box = base64.b64decode(header.pop("box"), validate=True)
    assert header == {"v": 1, "names": {"app": ["account"]}, "moved": {"app": ["account"]}}
    assert list(memory_keyring.credentials) == ["Raphael Safe Storage"]
    account, encoded = memory_keyring.credentials["Raphael Safe Storage"]
    assert account == str(sealed.parent)
    master = base64.b64decode(encoded, validate=True)
    assert len(master) == 32
    associated = json.dumps(header, sort_keys=True, separators=(",", ":")).encode()
    assert json.loads(AESGCM(master).decrypt(box[:12], box[12:], associated)) == {"app": {"account": "synthetic-private-token"}}
    assert fresh_door(asking, sealed).read("app", "account") == "synthetic-private-token"


def test_a_fresh_door_answers_from_names_without_a_keychain_read(asking, sealed):
    asking.write("app", "key", "synthetic")
    door = fresh_door(asking, sealed)
    door._look = lambda *_: pytest.fail("Unexpected attributes lookup")
    asking.reads.clear()
    assert door.peek("app", "key") is keychain.UNREAD
    assert door.has("app", "key") and keychain.filled(door.peek("app", "key"))
    assert not asking.reads


def test_five_secrets_ask_only_for_the_master_key(asking, sealed):
    for i in range(5):
        asking.write("app", str(i), str(i))
    door = fresh_door(asking, sealed)
    asking.reads.clear()
    with ThreadPoolExecutor(max_workers=5) as pool:
        assert list(pool.map(lambda i: door.read("app", str(i)), range(5))) == list("01234")
    assert asking.reads == [("Raphael Safe Storage", str(sealed.parent))]


def test_an_old_item_moves_on_first_use_and_stays_for_the_other_edition(asking, sealed, memory_keyring):
    memory_keyring.set_password("app", "key", "old")
    assert asking.peek("app", "key") is keychain.UNREAD and asking.has("app", "key")
    assert not sealed.exists() and not asking.reads
    assert asking.read("app", "key") == asking.read("app", "key") == "old"
    assert asking.reads.count(("app", "key")) == 1
    assert memory_keyring.credentials["app"] == ("key", "old")
    assert json.loads(sealed.read_bytes())["moved"] == {"app": ["key"]}
    memory_keyring.set_password("app", "key", "other edition")
    asking.reads.clear()
    assert fresh_door(asking, sealed).read("app", "key") == "old"
    assert asking.reads == [("Raphael Safe Storage", str(sealed.parent))]


def test_a_removed_old_item_cannot_return_to_the_sealed_file(asking, sealed, memory_keyring):
    memory_keyring.set_password("app", "key", "old")
    asking.write("app", "key", "new")
    assert memory_keyring.credentials["app"] == ("key", "old")
    asking.remove("app", "key")
    assert "app" not in memory_keyring.credentials
    assert json.loads(sealed.read_bytes())["names"] == {}
    with pytest.raises(keyring.errors.PasswordDeleteError):
        asking.remove("app", "key")
    memory_keyring.set_password("app", "key", "recreated elsewhere")
    door = fresh_door(asking, sealed)
    door._look = lambda *_: pytest.fail("Unexpected attributes lookup")
    assert door.peek("app", "key") is None and not door.has("app", "key")
    assert door.read("app", "key") is None


def test_a_refusal_of_the_master_key_stands_until_asked_again(asking, sealed, monkeypatch):
    asking.write("app", "key", "synthetic")
    asking.seal(sealed)
    asking.reads.clear()
    told = []
    asking.on_refused = lambda: told.append(True)
    with monkeypatch.context() as patch:
        refuse(asking, patch)
        with pytest.raises(keychain.Refused):
            asking.read("app", "key")
        with pytest.raises(keychain.Refused):
            asking.write("app", "another", "synthetic")
        assert asking.refused and told == [True]
        assert asking.reads == [("Raphael Safe Storage", str(sealed.parent))]
    asking.ask_again()
    assert asking.read("app", "key") == "synthetic"


@pytest.mark.parametrize("damage", ["wrong key", "missing key", "box", "names", "moved"])
def test_an_unreadable_file_and_its_key_are_never_replaced(asking, sealed, memory_keyring, damage):
    asking.write("app", "key", "synthetic")
    if damage == "wrong key":
        memory_keyring.set_password("Raphael Safe Storage", str(sealed.parent), base64.b64encode(bytes(32)).decode())
    elif damage == "missing key":
        memory_keyring.delete_password("Raphael Safe Storage", str(sealed.parent))
    else:
        data = json.loads(sealed.read_bytes())
        if damage == "box":
            box = bytearray(base64.b64decode(data["box"]))
            box[-1] ^= 1
            data["box"] = base64.b64encode(box).decode()
        else:
            data[damage] = {}
        sealed.write_text(json.dumps(data), encoding="utf-8")
    before = sealed.read_bytes()
    keys = memory_keyring.credentials.copy()
    door = fresh_door(asking, sealed)
    if damage == "names":
        # A name the file no longer lists is not kept, and reading it never asks for the master key.
        asking.reads.clear()
        assert door.read("app", "key") is None and asking.reads == []
    else:
        with pytest.raises(keyring.errors.KeyringError):
            door.read("app", "key")
    with pytest.raises(keyring.errors.KeyringError):
        door.write("app", "another", "synthetic")
    with pytest.raises(keyring.errors.KeyringError):
        door.remove("app", "key")
    assert sealed.read_bytes() == before and memory_keyring.credentials == keys


def test_two_doors_keep_each_others_writes_and_reload_on_read(asking, sealed):
    other = fresh_door(asking, sealed)
    start = threading.Barrier(2)

    def write(door, account):
        start.wait(5)
        door.write("app", account, account)

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(write, [asking, other], ["one", "two"]))
    assert asking.read("app", "two") == "two"
    assert other.read("app", "one") == "one"
    other.remove("app", "one")
    assert asking.peek("app", "one") is None


def test_a_failed_replacement_keeps_the_last_document_and_discards_the_temporary_file(asking, sealed, monkeypatch):
    asking.write("app", "key", "first")
    before = sealed.read_bytes()
    files = set(sealed.parent.iterdir())

    def failed_replace(source, target):
        raise PermissionError

    monkeypatch.setattr(os, "replace", failed_replace)
    with pytest.raises(PermissionError):
        asking.write("app", "key", "second")
    assert sealed.read_bytes() == before and set(sealed.parent.iterdir()) == files
    assert asking.peek("app", "key") == "first"


def test_a_writer_authenticates_the_current_file_even_with_an_unchanged_timestamp_and_size(asking, sealed):
    asking.write("app", "key", "synthetic")
    stat = sealed.stat()
    before = sealed.read_bytes()
    damaged = before.replace(b'"key"', b'"old"')
    assert damaged != before and len(damaged) == len(before)
    sealed.write_bytes(damaged)
    os.utime(sealed, ns=(stat.st_atime_ns, stat.st_mtime_ns))
    with pytest.raises(keyring.errors.KeyringError):
        asking.write("app", "another", "synthetic")
    assert sealed.read_bytes() == damaged


def test_a_legacy_item_gone_during_removal_needs_no_second_lookup(asking, sealed, monkeypatch):
    asking.write("app", "key", "synthetic")
    lookups = []

    def present(service, account):
        lookups.append((service, account))
        return True

    def disappeared(service, account):
        raise keyring.errors.PasswordDeleteError() from Exception(keychain.NOT_FOUND)

    asking._look = present
    monkeypatch.setattr(asking.backend, "delete_password", disappeared)
    asking.remove("app", "key")
    assert asking.peek("app", "key") is None
    assert lookups == [("app", "key")]


def test_each_data_directory_has_its_own_key_and_unlocked_values(asking, sealed, memory_keyring):
    asking.write("app", "key", "first")
    other = sealed.parent / "development" / "secrets.bin"
    asking.seal(other)
    assert asking.peek("app", "key") is None
    asking.write("app", "key", "second")
    assert memory_keyring.get_password("Raphael Safe Storage", str(sealed.parent)) != memory_keyring.get_password(
        "Raphael Safe Storage", str(other.parent)
    )
    asking.seal(sealed)
    assert asking.peek("app", "key") is keychain.UNREAD and asking.read("app", "key") == "first"


async def test_app_startup_can_see_a_sealed_model_key_before_the_first_model_migration(asking, tmp_path):
    from raphael_core.app import App
    from raphael_core.brain.first_models import LEGACY

    writer = fresh_door(asking, tmp_path / "secrets.bin")
    writer.write("Raphael", "openrouter", "synthetic")
    asking.reads.clear()
    app = App(data_dir=tmp_path, models_dir=tmp_path / "models", memory_dir=tmp_path / "memory")
    try:
        assert app.brain._settings.get("agent_model") == LEGACY["agent_model"]
        assert asking.peek("Raphael", "openrouter") is keychain.UNREAD
        assert not asking.reads
    finally:
        await app.aclose()
    assert asking.peek("Raphael", "openrouter") is None


def _write_in_process(path, master, account, start):
    # Each child sees the same master key through its own in-memory backend.
    from conftest import MemoryKeyring

    backend = MemoryKeyring()
    keyring.set_keyring(backend)
    backend.set_password("Raphael Safe Storage", str(path.parent), master)
    door = keychain.Keychain(asks=True)
    door.seal(path)
    start.wait(15)
    door.write("app", account, account)


@pytest.mark.skipif(os.name != "posix", reason="Inter-process locking uses flock")
def test_two_processes_keep_each_others_secrets(asking, sealed, memory_keyring):
    asking.write("app", "seed", "seed")
    _, master = memory_keyring.credentials["Raphael Safe Storage"]
    ctx = multiprocessing.get_context("spawn")
    start = ctx.Barrier(2)
    children = [ctx.Process(target=_write_in_process, args=(sealed, master, account, start)) for account in ("a", "b")]
    for child in children:
        child.start()
    for child in children:
        child.join(30)
        assert child.exitcode == 0
    assert [asking.read("app", a) for a in "ab"] == ["a", "b"]


def test_a_door_that_never_asks_still_uses_the_keyring_per_item(memory_keyring, tmp_path):
    door = keychain.Keychain(asks=False)
    door.seal(tmp_path / "secrets.bin")
    door.write("app", "key", "synthetic")
    assert memory_keyring.credentials == {"app": ("key", "synthetic")}
    assert door.peek("app", "key") == door.read("app", "key") == "synthetic"
    door.remove("app", "key")
    assert not door.has("app", "key") and not list(tmp_path.iterdir())


@pytest.mark.skipif(os.name != "posix", reason="POSIX permission bits")
def test_only_the_owner_can_read_or_write_the_sealed_file(asking, sealed):
    asking.write("app", "key", "synthetic")
    assert sealed.stat().st_mode & 0o777 == 0o600

"""The door to the credential store asks the owner as little as the macOS Keychain allows (R-PRIV-KEYCHAIN-01).

The Keychain is played by the in-memory keyring of tests/conftest.py, counting its reads, and a `look` that answers from
it without reading: nothing here reaches the real Keychain or Credential Manager.
"""

import threading
import time

import keyring
import keyring.errors
import pytest

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

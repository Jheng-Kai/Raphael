"""Fixtures for the whole test suite.

Every test runs with an in-memory keyring in place of Windows Credential Manager, so no test, in
any directory, can reach the real vault of whoever runs the suite. The guard fails closed: outside
a test's own in-memory keyring, any use of the keyring raises.

Tests marked `models` need the speech models downloaded and take a while to load them, so they are
skipped unless the environment variable RAPHAEL_TEST_MODELS is 1.

`conn` is a database in memory with the brain's schema, for the tests of what keeps its data there:
the brain, the assistant and the plugins.
"""

import gc
import os
import sqlite3
from collections.abc import Iterator

import keyring
import keyring.backend
import keyring.backends.fail
import keyring.errors
import pytest
import shard_durations

from raphael_core.brain import db


class MemoryKeyring(keyring.backend.KeyringBackend):
    """A keyring that keeps its credentials in a dict, shaped like the Windows backend's.

    Windows Credential Manager files a credential under a target name, the service, and keeps the
    username inside it. Setting a password where a credential exists first re-saves that one under
    "<username>@<service>" (keyring 25.7.0, keyring/backends/Windows.py), so an overwrite leaves
    the old value in the vault. This fake does the same, which is what lets a test see whether
    CredentialKeyStore.set leaves a stale copy behind. Like the real one, it raises
    PasswordDeleteError when there is nothing to delete.
    """

    # Zero keeps it out of keyring's own search for a backend: tests install it with set_keyring.
    priority = 0

    def __init__(self) -> None:
        super().__init__()
        self.credentials: dict[str, tuple[str, str]] = {}  # target -> (username, password)
        # The keyring that comes back when the test is over; set by the fixture below.
        self.restored_afterwards: keyring.backend.KeyringBackend | None = None

    def get_password(self, service, username):
        found = self.credentials.get(service)
        if found is None or found[0] != username:
            found = self.credentials.get(f"{username}@{service}")
        return None if found is None else found[1]

    def set_password(self, service, username, password):
        existing = self.credentials.get(service)
        if existing is not None:
            self.credentials[f"{existing[0]}@{service}"] = existing
        self.credentials[service] = (username, password)

    def delete_password(self, service, username):
        deleted = False
        for target in (service, f"{username}@{service}"):
            found = self.credentials.get(target)
            if found is not None and found[0] == username:
                del self.credentials[target]
                deleted = True
        if not deleted:
            raise keyring.errors.PasswordDeleteError(service)


def pytest_configure(config):
    """Before any test: a keyring that raises on every use, instead of the real vault."""
    keyring.set_keyring(keyring.backends.fail.Keyring())


@pytest.fixture(autouse=True)
def private_default_cli_home(tmp_path, monkeypatch):
    """Default discovery/imports must never inspect the machine owner's CLI profiles."""
    from raphael_core.agent.cli.discovery import CliBrains
    from raphael_core.integrations.imports import McpImports

    original_brains, original_imports = CliBrains.__init__, McpImports.__init__

    def brains_init(self, *, home=None, environ=None, **kwargs):
        if home is None:
            home = tmp_path / "default-cli-home"
            if environ is None:
                environ = {key: value for key, value in os.environ.items() if key != "CODEX_HOME"}
        original_brains(self, home=home, environ=environ, **kwargs)

    def imports_init(self, home=None):
        original_imports(self, home=tmp_path / "default-cli-home" if home is None else home)

    monkeypatch.setattr(CliBrains, "__init__", brains_init)
    monkeypatch.setattr(McpImports, "__init__", imports_init)


@pytest.fixture(autouse=True)
def memory_keyring():
    """A new, empty in-memory keyring for each test; the previous backend comes back afterwards."""
    backend = MemoryKeyring()
    backend.restored_afterwards = keyring.get_keyring()
    keyring.set_keyring(backend)
    yield backend
    keyring.set_keyring(backend.restored_afterwards)


@pytest.fixture(autouse=True)
def collect_garbage_after_each_test():
    """The leak of a socket, a pipe or an event loop is reported by the garbage collector whenever it finds the object,
    which is the set-up or tear-down of some later test (an error under -W error, far from its cause). Collecting here,
    after the fixtures of the test have been torn down, puts the warning on the test that left the object behind."""
    yield
    gc.collect()


@pytest.fixture
def conn() -> Iterator[sqlite3.Connection]:
    connection = db.connect(":memory:")
    yield connection
    connection.close()


def pytest_collection_modifyitems(config, items):
    """Keep this machine's share of the suite, then skip what cannot run here: the tests marked
    `models` unless RAPHAEL_TEST_MODELS=1. A module keeps only the last function of a name, so
    both must go through this one hook."""
    keep_this_share(config, items)
    skip_model_tests(items)


def keep_this_share(config, items) -> None:
    """CI runs the suite on several machines at once: RAPHAEL_TEST_SHARE=3/8 keeps the third of
    eight shares. Unset, as on a developer's machine, every test runs.

    Whole files are dealt, the heaviest first, each to the share holding the least so far. A file
    weighs the seconds recorded for it in shard-durations.json (see shard_durations.py), or its
    number of tests where nothing is recorded. Every machine collects the same tests and reads the
    same record, so all of them agree on the deal and each file lands in exactly one share. A file
    is never split: its fixtures and the order of its tests stay what they are in a single run."""
    wanted = os.environ.get("RAPHAEL_TEST_SHARE")
    if not wanted:
        return
    try:
        index, total = (int(part) for part in wanted.split("/"))
    except ValueError:
        raise pytest.UsageError(f"RAPHAEL_TEST_SHARE must look like 3/8, not {wanted!r}") from None
    if not 1 <= index <= total:
        raise pytest.UsageError(f"RAPHAEL_TEST_SHARE must name a share from 1 to {total}")
    files = [item.nodeid.split("::", 1)[0] for item in items]
    share = deal_files(files, total, shard_durations.read_record(shard_durations.RECORD))
    kept, dropped = [], []
    for item, file in zip(items, files, strict=True):
        (kept if share[file] == index else dropped).append(item)
    config.hook.pytest_deselected(items=dropped)
    items[:] = kept


def deal_files(files: list[str], shares: int, seconds: dict[str, float] | None = None) -> dict[str, int]:
    """The share, counted from 1, of each test file; `files` names a file once per test in it.
    `seconds` are the recorded seconds per file; without them every test weighs the same."""
    tests: dict[str, int] = {}
    for file in files:
        tests[file] = tests.get(file, 0) + 1
    return shard_durations.deal(tests, shares, seconds)


_RECORDED: dict[str, float] = {}


def pytest_runtest_logreport(report) -> None:
    """With RAPHAEL_RECORD_DURATIONS=<path>, add up the seconds each test file takes (set-up, test
    and tear-down), for shard_durations.py to deal the files by."""
    if os.environ.get("RAPHAEL_RECORD_DURATIONS"):
        file = report.nodeid.split("::", 1)[0]
        _RECORDED[file] = _RECORDED.get(file, 0.0) + report.duration


def pytest_sessionfinish(session) -> None:
    target = os.environ.get("RAPHAEL_RECORD_DURATIONS")
    if target and _RECORDED:
        shard_durations.merge_into(Path(target), _RECORDED)


def skip_model_tests(items) -> None:
    if os.environ.get("RAPHAEL_TEST_MODELS") == "1":
        return
    skip = pytest.mark.skip(reason="needs the speech models: set RAPHAEL_TEST_MODELS=1")
    for item in items:
        if item.get_closest_marker("models"):
            item.add_marker(skip)

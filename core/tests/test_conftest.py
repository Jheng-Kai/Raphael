"""The suite's own collection rules: a test that needs the speech models is skipped unless they are
asked for, and a CI machine keeps only its share of the test files."""

import inspect
from pathlib import Path

import conftest
import pytest


@pytest.fixture(autouse=True)
def no_share_from_the_machine(monkeypatch):
    """CI gives every machine a share. These tests call the hook themselves and name their own."""
    monkeypatch.delenv("RAPHAEL_TEST_SHARE", raising=False)


class Item:
    """Just enough of a collected test for the collection hook."""

    def __init__(self, *, models: bool) -> None:
        self.path = Path(__file__)
        self.function = test_the_collection_hook_is_defined_once
        self.models = models
        self.added: list[pytest.MarkDecorator] = []

    def get_closest_marker(self, name: str):
        return pytest.mark.models.mark if name == "models" and self.models else None

    def add_marker(self, marker: pytest.MarkDecorator) -> None:
        self.added.append(marker)

    def skip_reasons(self) -> list[str]:
        return [m.mark.kwargs.get("reason", "") for m in self.added if m.mark.name == "skip"]


def test_the_collection_hook_is_defined_once():
    # A second definition would replace the first, and the skips of the first would be lost.
    source = inspect.getsource(conftest)
    assert source.count("def pytest_collection_modifyitems(") == 1


@pytest.mark.parametrize("value", [None, "0", ""])
def test_a_models_test_is_skipped_unless_the_models_are_asked_for(monkeypatch, value):
    if value is None:
        monkeypatch.delenv("RAPHAEL_TEST_MODELS", raising=False)
    else:
        monkeypatch.setenv("RAPHAEL_TEST_MODELS", value)
    models, other = Item(models=True), Item(models=False)
    conftest.pytest_collection_modifyitems(None, [models, other])
    assert any("RAPHAEL_TEST_MODELS=1" in reason for reason in models.skip_reasons())
    assert other.skip_reasons() == []


def test_a_models_test_runs_when_the_models_are_asked_for(monkeypatch):
    monkeypatch.setenv("RAPHAEL_TEST_MODELS", "1")
    models = Item(models=True)
    conftest.pytest_collection_modifyitems(None, [models])
    assert models.skip_reasons() == []


class Collected:
    """A collected test as the share sees it: only its id."""

    def __init__(self, nodeid: str) -> None:
        self.nodeid = nodeid


class Deselections:
    """Stands in for pytest's config: it keeps what the hook reports as left out."""

    def __init__(self) -> None:
        self.hook = self
        self.left_out: list[Collected] = []

    def pytest_deselected(self, items) -> None:
        self.left_out.extend(items)


FILES = {
    "tests/a/test_three.py": 3,
    "tests/a/test_five.py": 5,
    "tests/b/test_one.py": 1,
    "tests/b/test_four.py": 4,
    "tests/test_two.py": 2,
}


def collected_suite() -> list[Collected]:
    """Fifteen tests in five files, in the order pytest would collect them."""
    return [Collected(f"{file}::test_{n}") for file, count in FILES.items() for n in range(count)]


def ids(items) -> list[str]:
    return [item.nodeid for item in items]


def share_of(suite, wanted: str, monkeypatch) -> tuple[list[str], list[str]]:
    """The ids one machine keeps and the ids it leaves out."""
    monkeypatch.setenv("RAPHAEL_TEST_SHARE", wanted)
    config, items = Deselections(), list(suite)
    conftest.keep_this_share(config, items)
    return ids(items), ids(config.left_out)


def test_every_test_runs_when_no_share_is_named():
    suite = collected_suite()
    config, items = Deselections(), list(suite)
    conftest.keep_this_share(config, items)
    assert items == suite
    assert config.left_out == []


def test_the_shares_together_run_every_test_exactly_once(monkeypatch):
    suite = collected_suite()
    ran: list[str] = []
    for index in (1, 2, 3):
        kept, left_out = share_of(suite, f"{index}/3", monkeypatch)
        # What a machine leaves out is reported, so its summary line counts the deselected tests.
        assert sorted(kept + left_out) == sorted(ids(suite))
        ran += kept
    assert sorted(ran) == sorted(ids(suite))


def test_a_file_is_never_split_between_shares(monkeypatch):
    suite = collected_suite()
    machines: dict[str, set[int]] = {}
    for index in (1, 2, 3):
        kept, _ = share_of(suite, f"{index}/3", monkeypatch)
        for nodeid in kept:
            machines.setdefault(nodeid.split("::")[0], set()).add(index)
    assert set(machines) == set(FILES)
    assert all(len(held_by) == 1 for held_by in machines.values())


def test_a_share_keeps_the_order_the_tests_were_collected_in(monkeypatch):
    suite = collected_suite()
    kept, _ = share_of(suite, "1/2", monkeypatch)
    assert kept == [nodeid for nodeid in ids(suite) if nodeid in set(kept)]


def test_the_largest_files_are_dealt_first_so_the_shares_come_out_even():
    files = ["big.py"] * 6 + ["mid.py"] * 4 + ["small.py"] * 3 + ["tiny.py"] * 3
    # big 6 | mid 4, then small joins the lighter share (4 + 3) and tiny the other (6 + 3).
    assert conftest.deal_files(files, 2) == {"big.py": 1, "mid.py": 2, "small.py": 2, "tiny.py": 1}


@pytest.mark.parametrize("wanted", ["0/8", "9/8", "3", "three/8", "1/2/3"])
def test_a_share_that_cannot_exist_stops_the_run(monkeypatch, wanted):
    monkeypatch.setenv("RAPHAEL_TEST_SHARE", wanted)
    with pytest.raises(pytest.UsageError):
        conftest.keep_this_share(Deselections(), collected_suite())

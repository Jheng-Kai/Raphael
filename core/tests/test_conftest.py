"""The suite's own collection rules: a test that needs the speech models is skipped unless they are
asked for, and a CI machine keeps only its share of the test files."""

import inspect
from pathlib import Path

import conftest
import pytest
import shard_durations


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


def test_a_slow_file_is_dealt_by_its_seconds_not_its_tests():
    files = ["slow.py"] * 2 + ["a.py"] * 5 + ["b.py"] * 5 + ["c.py"] * 5
    # By tests, slow.py is the smallest and shares a machine with a 5-test file; by seconds it
    # weighs as much as the other three together, so it stands alone.
    by_tests = conftest.deal_files(files, 2)
    by_seconds = conftest.deal_files(files, 2, {"slow.py": 30.0, "a.py": 10.0, "b.py": 10.0, "c.py": 10.0})
    assert by_tests["slow.py"] == by_tests["b.py"]
    assert len({by_seconds[name] for name in ("a.py", "b.py", "c.py")}) == 1
    assert by_seconds["slow.py"] != by_seconds["a.py"]


def test_a_file_without_a_record_weighs_its_tests_at_the_average_rate():
    # known.py took 10 s for 5 tests: 2 s a test. new.py has 3 tests and no record, so it weighs 6 s,
    # more than solo.py's 5 s, and is dealt before it.
    weights = shard_durations.weights({"known.py": 5, "new.py": 3, "solo.py": 1}, {"known.py": 10.0, "solo.py": 5.0})
    assert weights == {"known.py": 10.0, "new.py": 3 * (15.0 / 6), "solo.py": 5.0}


def test_without_any_record_every_test_weighs_the_same():
    assert shard_durations.weights({"a.py": 4, "b.py": 1}, {}) == {"a.py": 4.0, "b.py": 1.0}
    assert shard_durations.weights({"a.py": 4}, {"other.py": 9.0}) == {"a.py": 4.0}


def test_every_machine_deals_the_same_way(monkeypatch):
    seconds = {"tests/a/test_three.py": 40.0, "tests/test_two.py": 1.0}
    monkeypatch.setattr(shard_durations, "read_record", lambda path: seconds)
    suite = collected_suite()
    ran: list[str] = []
    for index in (1, 2, 3):
        kept, left_out = share_of(suite, f"{index}/3", monkeypatch)
        assert sorted(kept + left_out) == sorted(ids(suite))
        ran += kept
    assert sorted(ran) == sorted(ids(suite))


def test_the_record_in_the_repository_is_well_formed():
    seconds = shard_durations.read_record(shard_durations.RECORD)
    assert all(file.startswith("tests/") and file.endswith(".py") for file in seconds)
    # Every file in it still exists; a renamed or deleted file is a stale entry to drop on refresh.
    root = shard_durations.RECORD.parent.parent
    assert [file for file in seconds if not (root / file).is_file()] == []


def test_a_malformed_record_stops_the_run(tmp_path):
    for body in ("not json", "[1]", '{"a.py": "slow"}', '{"a.py": -1}', '{"a.py": true}'):
        path = tmp_path / "record.json"
        path.write_text(body, encoding="utf-8")
        with pytest.raises(ValueError, match="not a duration record"):
            shard_durations.read_record(path)
    assert shard_durations.read_record(tmp_path / "missing.json") == {}


def test_recording_adds_up_each_file_and_keeps_what_a_run_did_not_touch(tmp_path, monkeypatch):
    target = tmp_path / "record.json"
    shard_durations.write_record(target, {"tests/old.py": 3.0, "tests/again.py": 9.0})
    monkeypatch.setenv("RAPHAEL_RECORD_DURATIONS", str(target))
    monkeypatch.setattr(conftest, "_RECORDED", {})

    class Report:
        def __init__(self, nodeid: str, duration: float) -> None:
            self.nodeid, self.duration = nodeid, duration

    for nodeid, duration in [("tests/again.py::test_a[1]", 0.5), ("tests/again.py::test_b", 1.25), ("tests/new.py::test_c", 2.0)]:
        conftest.pytest_runtest_logreport(Report(nodeid, duration))
    conftest.pytest_sessionfinish(None)
    assert shard_durations.read_record(target) == {"tests/old.py": 3.0, "tests/again.py": 1.75, "tests/new.py": 2.0}


def test_nothing_is_recorded_unless_asked_for(tmp_path, monkeypatch):
    monkeypatch.delenv("RAPHAEL_RECORD_DURATIONS", raising=False)
    monkeypatch.setattr(conftest, "_RECORDED", {})
    conftest.pytest_runtest_logreport(type("Report", (), {"nodeid": "tests/x.py::t", "duration": 1.0})())
    assert conftest._RECORDED == {}


def test_the_merge_command_joins_the_machines_records(tmp_path, capsys):
    first, second, target = tmp_path / "1.json", tmp_path / "2.json", tmp_path / "record.json"
    shard_durations.write_record(first, {"tests/a.py": 1.0})
    shard_durations.write_record(second, {"tests/b.py": 2.0})
    assert shard_durations.main(["shard_durations.py", "merge", str(target), str(first), str(second)]) == 0
    assert shard_durations.read_record(target) == {"tests/a.py": 1.0, "tests/b.py": 2.0}
    assert "2 files" in capsys.readouterr().out
    assert shard_durations.main(["shard_durations.py"]) == 2

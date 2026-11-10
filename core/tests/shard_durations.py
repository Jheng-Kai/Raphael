"""How CI deals the test files among its machines, and the recorded seconds it deals by.

`shard-durations.json` (beside this file) maps a test file, as pytest names it from the core folder
("tests/members/test_admin.py"), to the seconds its tests took on a CI machine. conftest reads it
to give every machine about the same amount of work. A file the record does not know is weighed by
its number of tests, at the average seconds per test of the files it does know; with no record at
all every test weighs the same, which is how the suite was dealt before there was one.

Refresh the record when the suite has changed a lot (a slow file in one share shows up in the
per-share times of a CI run):

1. Every CI Python machine writes the seconds of the files it ran and uploads them as the artifact
   `python-durations-<share>`. Download the eight from one green run of the CI workflow.
2. From the core folder, merge them into the record:

       uv run python tests/shard_durations.py merge tests/shard-durations.json <the eight .json files>

3. Commit the record. Nothing else needs to change; the shares are dealt again from it.

Without CI, record a whole local run instead (it takes a long time, and a developer's machine
weighs the files a little differently from a CI machine, but the proportions hold):

    RAPHAEL_RECORD_DURATIONS=tests/shard-durations.json uv run pytest

Recording merges into an existing file: the files a run did not touch keep their seconds.
"""

import json
import sys
from pathlib import Path

RECORD = Path(__file__).with_name("shard-durations.json")


def read_record(path: Path) -> dict[str, float]:
    """The recorded seconds per file. A missing file is an empty record; a malformed one is an error."""
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("it must be one object of file names")
        seconds = {}
        for file, value in data.items():
            if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
                raise ValueError(f"{file}: {value!r} is not a number of seconds")
            seconds[file] = float(value)
        return seconds
    except (OSError, ValueError) as error:
        raise ValueError(f"{path} is not a duration record: {error}") from error


def write_record(path: Path, seconds: dict[str, float]) -> None:
    """The record as stable text: sorted names, two decimals, so a refresh shows as a small diff."""
    body = {file: round(value, 2) for file, value in sorted(seconds.items())}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")


def merge_into(path: Path, seconds: dict[str, float]) -> None:
    """Add these seconds to the record at `path`, replacing the files they name."""
    merged = read_record(path)
    merged.update(seconds)
    write_record(path, merged)


def weights(counts: dict[str, int], seconds: dict[str, float]) -> dict[str, float]:
    """What each file weighs when dealt: its recorded seconds, else its tests at the average rate."""
    known = {file: seconds[file] for file in counts if seconds.get(file, 0) > 0}
    if not known:
        return {file: float(count) for file, count in counts.items()}
    rate = sum(known.values()) / sum(counts[file] for file in known)
    return {file: known.get(file, counts[file] * rate) for file in counts}


def deal(counts: dict[str, int], shares: int, seconds: dict[str, float] | None = None) -> dict[str, int]:
    """The share, counted from 1, of each file: the heaviest first, each to the lightest share so far."""
    weight = weights(counts, seconds or {})
    load = [0.0] * shares
    share: dict[str, int] = {}
    for file in sorted(counts, key=lambda name: (-weight[name], name)):
        lightest = load.index(min(load))
        share[file] = lightest + 1
        load[lightest] += weight[file]
    return share


def main(argv: list[str]) -> int:
    if len(argv) < 4 or argv[1] != "merge":
        print("usage: shard_durations.py merge <record.json> <recorded.json>...", file=sys.stderr)
        return 2
    target = Path(argv[2])
    for source in argv[3:]:
        merge_into(target, read_record(Path(source)))
    print(f"{target}: {len(read_record(target))} files")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

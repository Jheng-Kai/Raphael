"""Whether a reply of the model is only the same few words again and again.

Adapted from NousResearch/hermes-agent agent/repetition_guard.py @ c419cf7c (MIT); see licenses/NOTICES.md.
Not taken over: `RunawayStreamWatch`, which cuts a stream while it runs. Raphael's calls are not read while
they stream.

A model in a degenerate loop can spend its whole output limit on one fragment. Such a text must not go back
into the conversation, where it would start the loop again on the next request. Deliberately cautious: only
long verbatim repeats (60 or more characters) that cover a majority of the text count.
"""

import math
from collections import Counter

# Below this length the check does not run: short texts hold repeated words without being a loop.
MIN_FRAGMENT_LENGTH = 400
# Exact-repeat window; far beyond ordinary phrasing reuse (citations, headings, similar code).
_REPEAT_WINDOW = 60
# A window repeating at least this often is a signal even for short texts.
_MIN_REPEAT_COUNT = 5
# "Dominated by repetition" = the repeated windows cover at least this fraction.
_DOMINANCE_RATIO = 0.5

# What the conversation holds in place of a reply that went round and round.
REPETITION_LOOP_INTERRUPTED = "[the reply degenerated into a repetition loop and was dropped]"

# Sampling keeps the general check linear in the size of the text: a dominant contiguous run crosses many
# of these evenly spaced anchors.
_MAX_ANCHOR_SAMPLES = 32
_MAX_ANCHOR_MATCHES = 8

# A text of several lines must be mostly copies of a few lines: batch output (distinct INSERT rows,
# similar table rows) shares long prefixes and trips the window scan, but every line is distinct.
_RUNAWAY_DISTINCT_LINE_RATIO = 0.5

# A reply that ended normally is dropped only at runaway size: real loops run to tens of thousands of
# characters, while repeats the owner asked for ("say X 50 times", identical table rows) stay in the
# low kilobytes and must be delivered.
STOP_PATH_MIN_CHARS = 16_000


def is_repetition_dominated(text: str) -> bool:
    """True when a contiguous run of at least five exact repetitions covers at least half of `text`:
    the signature of a model repetition loop. Coverage is measured with the true period, so long
    multi-line loop units count fully. Short texts never are."""
    if not isinstance(text, str):
        return False
    n = len(text)
    if n < MIN_FRAGMENT_LENGTH:
        return False
    # Fast path: one normalized line duplicated enough to cover half the text (the common echo shape).
    if _line_repetition_dominated(text, n):
        return True
    # The window count catches loops whose repeats differ by a counter or noise token; the periodic scan
    # catches long exact units whose 60-character windows each recur too rarely.
    return _window_count_dominated(text, n) or _periodic_run_dominated(text, n)


def _window_count_dominated(text: str, n: int) -> bool:
    """True when one 60-character window recurs often enough to cover half of `text`."""
    window = _REPEAT_WINDOW
    needed = max(_MIN_REPEAT_COUNT, math.ceil(n * _DOMINANCE_RATIO / window))
    counts: dict[str, int] = {}
    for i in range(n - window + 1):
        key = text[i : i + window]
        c = counts.get(key, 0) + 1
        if c >= needed:
            return True
        counts[key] = c
    return False


def _periodic_run_dominated(text: str, n: int) -> bool:
    """Detect a dominant exact periodic run from evenly spaced anchors.

    Matching a 60-character anchor at a later position supplies a candidate period. Expanding the equality
    `text[i] == text[i + period]` in both directions recovers the full run, so coverage is measured with
    the true repeating unit rather than crediting every occurrence with only 60 characters.
    """
    window = _REPEAT_WINDOW
    max_start = n - window
    if max_start < 1:
        return False

    sample_step = max(1, (max_start + _MAX_ANCHOR_SAMPLES - 2) // (_MAX_ANCHOR_SAMPLES - 1))
    sample_starts = list(range(0, max_start + 1, sample_step))
    if sample_starts[-1] != max_start:
        sample_starts.append(max_start)

    # Runs already expanded and rejected, as (left, right, period). A later anchor inside one of them whose
    # period is a multiple of that run's period would walk the same run again.
    rejected: list[tuple[int, int, int]] = []
    for start in sample_starts:
        anchor = text[start : start + window]
        search_from = start + 1
        for _ in range(_MAX_ANCHOR_MATCHES):
            match = text.find(anchor, search_from)
            if match < 0:
                break
            period = match - start
            search_from = match + 1
            if any(lo <= start < hi and period % p == 0 for lo, hi, p in rejected):
                continue
            left, right = _expand_run(text, n, start, period, window)
            if right - left >= _MIN_REPEAT_COUNT * period and right - left >= n * _DOMINANCE_RATIO:
                return True
            rejected.append((left, right, period))
    return False


def _expand_run(text: str, n: int, start: int, period: int, matched: int) -> tuple[int, int]:
    """Expand one known equal window to the `[left, right)` bounds of its exact periodic run."""
    left = start
    while left > 0 and text[left - 1] == text[left - 1 + period]:
        left -= 1

    right = start + matched
    while right + period < n and text[right] == text[right + period]:
        right += 1
    return left, right + period


def is_runaway_repetition(text: str) -> bool:
    """Stricter than `is_repetition_dominated`: when the text has lines, at most half of its non-empty
    lines may be distinct. The text is dropped when this holds, so a repetitive but correct reply
    (distinct batch rows) must not qualify."""
    if not is_repetition_dominated(text):
        return False
    lines = [line.strip() for line in text.splitlines()]
    lines = [line for line in lines if line]
    if len(lines) < _MIN_REPEAT_COUNT:
        return True  # no line structure to judge by: a dominated single-line loop
    return len(set(lines)) <= len(lines) * _RUNAWAY_DISTINCT_LINE_RATIO


def _line_repetition_dominated(text: str, n: int) -> bool:
    """True when a single normalized line covers half the text via repeats."""
    counts = Counter(norm for norm in (line.strip() for line in text.splitlines()) if norm)
    return any(c >= _MIN_REPEAT_COUNT and c * len(line) >= n * _DOMINANCE_RATIO for line, c in counts.items())

"""Explicit file requirements and value-free worker diagnostics."""

import re
import traceback
from pathlib import Path


def named_files(text):
    """Yield absolute paths, including quoted paths and paths followed by prose."""
    seen = set()
    pattern = r'''(?i)[a-z]:[\\/][^\r\n<>"`|?*]+|(?<![\w:/])/[\w.][^\r\n<>"`|?*]+'''
    for match in re.finditer(pattern, text):
        named = match.group().strip().rstrip("' ).,;。")
        candidates = [named]
        candidates.extend(named[:found.end()] for found in re.finditer(r"\.[a-zA-Z0-9]{1,12}(?=[\s)\]}',;。]|$)", named))
        candidates.extend(named[:gap.start()] for gap in list(re.finditer(r"\s+", named))[-16:][::-1])
        for candidate in candidates:
            path = Path(candidate)
            if path.is_absolute() and str(path) not in seen:
                seen.add(str(path))
                yield path


def worker_trace(error):
    """Keep only our frame locations and exception type, never values or source text."""
    root = Path(__file__).resolve().parent.parent
    frames = []
    for frame in traceback.extract_tb(error.__traceback__):
        try:
            path = Path(frame.filename).resolve().relative_to(root)
        except (OSError, ValueError):
            continue
        frames.append(f"{path.as_posix()}:{frame.lineno}")
    return (type(error).__name__ + ": " + ", ".join(frames[-3:]))[:400]

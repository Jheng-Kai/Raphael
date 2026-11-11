"""One monotonic startup origin, captured before importing the application."""

import time

PROCESS_STARTED_AT = time.perf_counter()


def elapsed_ms() -> float:
    return (time.perf_counter() - PROCESS_STARTED_AT) * 1000

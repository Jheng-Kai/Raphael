"""What an import of the Team skills tells the window while it works, and the way to stop it (R-SKILL-38).

The window starts an import with an `import_id` of its own. While it runs, the core sends `skills.import_progress` with that id and
the step it is at: `fetch` (getting the files: a download, a clone, a read of a folder), `read` (the skills in them, `done` of
`total`) and `install` (writing them into the library, which can no longer be stopped). `skills.library.cancel_import` with the same
id stops it: the clone or the download is ended, and nothing of it is kept.

The import and the threads it starts all see the same token and reporter through context variables, so no function that reads a
source needs to be handed either: a source that reports a step calls `report`, and a long wait for a program (git) calls `check`
or asks for the token to end it.
"""

import asyncio
import threading
from contextvars import ContextVar

_token = ContextVar("skill_import_token", default=None)
_reporter = ContextVar("skill_import_reporter", default=None)


class ImportCancelled(asyncio.CancelledError):
    """The owner stopped the import. A cancellation, so that no `except Exception` of a source's reader swallows it."""


class Token:
    def __init__(self):
        self.event = threading.Event()
        # Once the library is being written the import is past the point where it can be stopped without a trace.
        self.committed = False

    @property
    def cancelled(self):
        return self.event.is_set()

    def cancel(self):
        """Ask the import to stop; False when it is writing the library and will finish."""
        if self.committed:
            return False
        self.event.set()
        return True

    def check(self):
        if self.event.is_set():
            raise ImportCancelled()


def start(token, reporter):
    """Make this task's (and its threads') import report to `reporter` and stop with `token`."""
    _token.set(token)
    _reporter.set(reporter)


def token():
    return _token.get()


def check():
    """Stop here when the owner asked; called between the pieces of a read that runs in a thread."""
    held = _token.get()
    if held is not None:
        held.check()


def commit():
    """The library is about to be written: from here the import finishes, and says so (`install`)."""
    report("install")
    held = _token.get()
    if held is not None:
        held.committed = True


def report(step, done=None, total=None):
    """Say what the import is doing now. Raises `ImportCancelled` when the owner stopped it."""
    check()
    reporter = _reporter.get()
    if reporter is not None:
        reporter(step, done, total)


async def threaded(function, *args):
    """`function(*args)` in a thread that this import's cancellation waits for: the thread is told to stop (it reads the token at
    its next step, or is killed by the program it waits for), and what it started is over before the caller sees the cancellation, so
    that nothing it wrote is left behind it."""
    worker = asyncio.ensure_future(asyncio.to_thread(function, *args))
    try:
        return await asyncio.shield(worker)
    except asyncio.CancelledError:
        held = _token.get()
        if held is not None:
            held.event.set()
        try:
            await worker
        except BaseException:  # the worker's own end: it was stopped
            pass
        raise

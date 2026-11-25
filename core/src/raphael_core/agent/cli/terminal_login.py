"""A CLI's sign-in in a window of Terminal on a Mac, followed as the sign-in's process is on Windows.

Windows starts the sign-in in a console of its own and waits for that process. A Mac has no console of a
process: the sign-in runs in a Terminal window, from a small script in a private folder, which writes its
shell's process id when it starts and its exit code when the CLI ends. `TerminalSignIn` reads those files:
`wait` blocks until the code is there, `poll` says whether it is, and `terminate` ends the script's shell.
`release` leaves a window whose sign-in was found while the CLI goes on in it (Antigravity) to the owner.
A window closed by its close button hangs its shell up before the code is written: the script's HUP trap writes
`HUNG_UP` then, and a shell that is gone with no code at all counts as hung up too.
The window starts the person's own shell environment, so the script unsets the API keys a subscription
sign-in must not see (`process.API_KEYS`), as `subscription_env` leaves them out on Windows.
"""

import os
import shlex
import shutil
import signal
import subprocess
import tempfile
import threading
from collections.abc import Callable
from pathlib import Path

from .process import API_KEYS

# How long a sign-in may stay open before it counts as given up, and how often its files are looked at.
SIGN_IN_TIMEOUT_S = 30 * 60
POLL_S = 0.5
# The code of a window closed while its CLI ran (128 + SIGHUP), as a shell reports a hung-up child.
HUNG_UP = 129


class TerminalSignIn:
    def __init__(self, argv: list[str], *, opener: Callable[..., subprocess.CompletedProcess] = subprocess.run,
                 timeout_s: float = SIGN_IN_TIMEOUT_S, poll_s: float = POLL_S) -> None:
        self.folder = Path(tempfile.mkdtemp(prefix="raphael-sign-in-"))
        self._code_file, self._pid_file = self.folder / "code", self.folder / "pid"
        self._timeout_s, self._poll_s = timeout_s, poll_s
        self._released = False
        self._ended = threading.Event()
        self.returncode: int | None = None
        script = self.folder / "sign-in.command"
        script.write_text(script_text(argv, self._pid_file, self._code_file), encoding="utf-8")
        script.chmod(0o700)
        try:
            completed = opener(["/usr/bin/open", "-a", "Terminal", str(script)], capture_output=True, timeout=60, check=False)
        except (OSError, subprocess.SubprocessError):
            self._cleanup()
            raise OSError("Terminal could not be opened") from None
        if completed.returncode != 0:
            self._cleanup()
            raise OSError("Terminal could not be opened")

    def poll(self) -> int | None:
        if self.returncode is None:
            if self._code_file.exists():
                self._read_code()
            elif self._shell_gone():
                # The shell may have written its code and ended between the two looks.
                if self._code_file.exists():
                    self._read_code()
                else:
                    self._finish(HUNG_UP)
        return self.returncode

    def _read_code(self) -> None:
        try:
            self._finish(int(self._code_file.read_text(encoding="utf-8").strip() or 1))
        except (OSError, ValueError):
            self._finish(1)

    def _shell_gone(self) -> bool:
        """Whether the script's shell, named by its pid file, has ended; False while it has not started or says nothing."""
        try:
            pid = int(self._pid_file.read_text(encoding="utf-8").strip())
        except (OSError, ValueError):
            return False
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True
        except OSError:
            return False  # another user's process of that id: not ours to judge, so not gone
        return False

    def wait(self) -> int:
        waited = 0.0
        while self.poll() is None:
            if waited >= self._timeout_s and not self._released:
                self.terminate()
                break
            if self._ended.wait(self._poll_s):
                break
            waited += self._poll_s
        return self.returncode if self.returncode is not None else 1

    def release(self) -> None:
        """The sign-in was found while the CLI goes on in the window (Antigravity stays open on its conversation after
        one): the window is the owner's now. The time a sign-in may take no longer ends it, and its folder still goes when
        it ends."""
        self._released = True

    def terminate(self) -> None:
        if self.returncode is not None:
            return
        try:
            pid = int(self._pid_file.read_text(encoding="utf-8").strip())
            os.kill(pid, signal.SIGHUP)
        except (OSError, ValueError):
            pass
        self._finish(1)

    def _finish(self, code: int) -> None:
        self.returncode = code
        self._ended.set()
        self._cleanup()

    def _cleanup(self) -> None:
        shutil.rmtree(self.folder, ignore_errors=True)


def script_text(argv: list[str], pid_file: Path, code_file: Path) -> str:
    """The script the Terminal window runs."""
    part, code = shlex.quote(str(code_file) + ".part"), shlex.quote(str(code_file))
    return "\n".join([
        "#!/bin/zsh",
        f"print -r -- $$ > {shlex.quote(str(pid_file))}",
        # Closing the window hangs the shell up before `code=$?` runs: the code is written then (silently: a sign-in this app
        # ended has no folder left to write it in).
        "trap " + shlex.quote(f"{{ print -r -- {HUNG_UP} > {part} && mv {part} {code}; }} 2>/dev/null; exit {HUNG_UP}") + " HUP",
        "unset " + " ".join(sorted(API_KEYS)),
        "clear",
        shlex.join(argv),
        "code=$?",
        f"print -r -- $code > {part} && mv {part} {code}",
        "exit $code",
        "",
    ])

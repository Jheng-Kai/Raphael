"""A CLI's sign-in in a window of Terminal on a Mac, followed as the sign-in's process is on Windows.

Windows starts the sign-in in a console of its own and waits for that process. A Mac has no console of a
process: the sign-in runs in a Terminal window, from a small script in a private folder, which writes its
shell's process id when it starts and its exit code when the CLI ends. `TerminalSignIn` reads those files:
`wait` blocks until the code is there, `poll` says whether it is, and `terminate` ends the script's shell.
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


class TerminalSignIn:
    def __init__(self, argv: list[str], *, opener: Callable[..., subprocess.CompletedProcess] = subprocess.run,
                 timeout_s: float = SIGN_IN_TIMEOUT_S, poll_s: float = POLL_S) -> None:
        self.folder = Path(tempfile.mkdtemp(prefix="raphael-sign-in-"))
        self._code_file, self._pid_file = self.folder / "code", self.folder / "pid"
        self._timeout_s, self._poll_s = timeout_s, poll_s
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
        if self.returncode is None and self._code_file.exists():
            try:
                self._finish(int(self._code_file.read_text(encoding="utf-8").strip() or 1))
            except (OSError, ValueError):
                self._finish(1)
        return self.returncode

    def wait(self) -> int:
        waited = 0.0
        while self.poll() is None:
            if waited >= self._timeout_s:
                self.terminate()
                break
            if self._ended.wait(self._poll_s):
                break
            waited += self._poll_s
        return self.returncode if self.returncode is not None else 1

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
    part = shlex.quote(str(code_file) + ".part")
    return "\n".join([
        "#!/bin/zsh",
        f"print -r -- $$ > {shlex.quote(str(pid_file))}",
        "unset " + " ".join(sorted(API_KEYS)),
        "clear",
        shlex.join(argv),
        "code=$?",
        f"print -r -- $code > {part} && mv {part} {shlex.quote(str(code_file))}",
        "exit $code",
        "",
    ])

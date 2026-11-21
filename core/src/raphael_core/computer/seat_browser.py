"""Run the installed seat launcher with startup recovery, without rebuilding layer 14."""

import re

PROFILE_PARTS = (".browser-profiles", "driver", "main")
RECOVER_STALE_LOCKS = "--recover-stale-locks"
STALE_LOCK_EXIT = 75
_STALE_LOCK = re.compile(r"RAPHAEL_STALE_LOCK (Singleton[A-Za-z0-9_-]*|DevToolsActivePort)")


def stale_locks(stderr):
    return [match[1] for line in (stderr or "").splitlines() if (match := _STALE_LOCK.fullmatch(line))]


# This runs as cua inside the computer. The image owns window attribution, placement and settling.
LAUNCH = r"""
import os
import shlex
import stat
import sys
from pathlib import Path


def prepare_profile(profile, proc):
    # Match whole argv entries, including a user-data-dir supplied as two arguments.
    # Do not follow Singleton links, or a profile directory redirected through a symlink.
    if any(folder.is_symlink() for folder in (profile, profile.parent, profile.parent.parent)):
        return
    directory = os.fsencode(profile)
    flag = b"--user-data-dir"
    for cmdline in proc.glob("[0-9]*/cmdline"):
        try:
            args = cmdline.read_bytes().split(b"\0")[1:]
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
        if flag + b"=" + directory in args or (flag, directory) in zip(args, args[1:]):
            return
    blocked = False
    for artifact in (*profile.glob("Singleton*"), profile / "DevToolsActivePort"):
        try:
            if not stat.S_ISDIR(artifact.lstat().st_mode):
                artifact.unlink()
        except (FileNotFoundError, IsADirectoryError):
            pass
        except OSError:
            name = artifact.name.encode("unicode_escape").decode("ascii")
            print(f"RAPHAEL_STALE_LOCK {name}", file=sys.stderr)
            blocked = True
    return blocked


# Keep only a small tail during startup. After the launcher removes its temporary directory,
# keep draining the pipe so a browser that now owns a window can outlive its launcher.
SINK = '''
import os
import sys
from pathlib import Path

path = Path(sys.argv[1])
pending = b""
while chunk := os.read(0, 4096):
    if path.parent.exists():
        pending = (pending + chunk)[-2048:]
        try:
            path.with_suffix(".next").write_bytes(pending)
            path.with_suffix(".next").replace(path)
        except FileNotFoundError:
            pass
if path.parent.exists():
    try:
        path.with_suffix(".done").touch()
    except FileNotFoundError:
        pass
'''


def launch_script(source, profile):
    # These sites belong to the layer-12 launcher installed in layer 14. Another launcher runs as it is (None): the
    # stale locks are still cleared before it, and a computer whose browser works is never refused a start.
    if "profile=" + str(profile) + "\n" not in source:
        return None
    replacements = (
        ('main=$(browser_pid)\n# A private title', '''
log=$(mktemp -d)
trap 'rm -rf -- "$log"' EXIT
mkfifo "$log/stderr"
/usr/bin/python3 -c ''' + shlex.quote(SINK) + ''' "$log/tail" <"$log/stderr" >/dev/null 2>&1 &
browser_error() {
  echo "$1" >&2
  if [ -f "$log/tail" ]; then cat "$log/tail" >&2; fi
  exit 1
}
main=$(browser_pid)
warm=$main
# A private title'''),
        ('"$chromium" $flags --new-window "$start_page" >/dev/null 2>&1 &',
         '"$chromium" $flags --new-window "$start_page" >/dev/null 2>"$log/stderr" &'),
        ('setsid "$chromium" --remote-debugging-port=0 $flags "$start_page" >/dev/null 2>&1 &',
         'setsid "$chromium" --remote-debugging-port=0 $flags "$start_page" >/dev/null 2>"$log/stderr" &'),
        ('fi\nnew=\n', 'fi\nstarted=$!\nnew=\n'),
        ('  [ -n "$new" ] && break\n', '''  [ -n "$new" ] && break
  if [ -n "$started" ] && ! kill -0 "$started" 2>/dev/null; then
    code=0
    wait "$started" || code=$?
    started=
    # A warm launch may exit successfully after handing off to a browser that is still running.
    if [ -z "$warm" ] || [ -z "$main" ] || [ "$code" -ne 0 ]; then
      # Wait briefly for stderr EOF, even if a browser child inherited the pipe.
      for check in 1 2 3 4 5; do
        [ -f "$log/tail.done" ] && break
        sleep 0.1
      done
      browser_error "browser exited before opening a window (exit $code)"
    fi
  elif [ -n "$warm" ] && [ -z "$started" ] && [ -z "$main" ]; then
    browser_error "the running browser closed before opening a window"
  fi
'''),
        ('{ echo "no browser window appeared within 60 seconds" >&2; exit 1; }',
         'browser_error "no browser window appeared within 60 seconds"'),
        ('{ echo "browser window geometry did not settle on the screen within 30 seconds" >&2; exit 1; }',
         'browser_error "browser window geometry did not settle on the screen within 30 seconds"'),
    )
    for old, new in replacements:
        if source.count(old) != 1:
            return None
        source = source.replace(old, new)
    return source


if __name__ == "__main__":
    profile = Path("/home/cua/workspace/.browser-profiles/driver/main")
    launcher = Path("/usr/local/bin/raphael-seat-browser")
    try:
        source = launch_script(launcher.read_text(encoding="utf-8"), profile)
    except UnicodeDecodeError:
        source = None
    recover = sys.argv[1:2] == ["--recover-stale-locks"]
    if recover:
        del sys.argv[1]
    if prepare_profile(profile, Path("/proc")) and recover:
        # Let the host clear the stale entries before any browser can take this profile.
        sys.exit(75)
    if source is not None:
        os.execv("/bin/sh", ["sh", "-c", source, *sys.argv[1:]])
    else:
        # The wrapper's first argument was only the patched shell script's $0.
        os.execv(str(launcher), [str(launcher), *sys.argv[2:]])
"""

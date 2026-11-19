"""Run the installed seat launcher with startup recovery, without rebuilding layer 14."""

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
    for artifact in (*profile.glob("Singleton*"), profile / "DevToolsActivePort"):
        try:
            if not stat.S_ISDIR(artifact.lstat().st_mode):
                artifact.unlink()
        except (FileNotFoundError, IsADirectoryError):
            pass


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
    original = launcher.read_text(encoding="utf-8")
    source = launch_script(original, profile) or original
    prepare_profile(profile, Path("/proc"))
    os.execv("/bin/sh", ["sh", "-c", source, *sys.argv[1:]])
"""

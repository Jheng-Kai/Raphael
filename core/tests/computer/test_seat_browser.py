import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path, PurePosixPath

import pytest

from raphael_core.computer import seat_browser

PROFILE = PurePosixPath("/home/cua/workspace/.browser-profiles/driver/main")
LAUNCHER = Path(seat_browser.__file__).parent / "image/layer12/raphael-seat-browser"


@pytest.fixture
def guest():
    scope = {"__name__": "seat_browser_guest"}
    exec(seat_browser.LAUNCH, scope)
    return scope


@pytest.mark.parametrize("process", ["none", "other-profile", "active-equals", "active-split"])
def test_only_an_idle_profile_loses_its_startup_artifacts(tmp_path, guest, process):
    profile = tmp_path / ".browser-profiles" / "driver" / "main"
    profile.mkdir(parents=True)
    (profile / "Default").mkdir()
    (profile / "Default" / "Cookies").write_bytes(b"keep")
    (profile / "SingletonDirectory").mkdir()
    artifacts = ("SingletonLock", "SingletonCookie", "SingletonSocket", "DevToolsActivePort")
    for name in artifacts:
        (profile / name).touch()
    proc = tmp_path / "proc"
    cmdline = proc / "123" / "cmdline"
    cmdline.parent.mkdir(parents=True)
    if process != "none":
        flag = b"--user-data-dir" + (b"\0" if process == "active-split" else b"=")
        directory = profile.with_name("main-other") if process == "other-profile" else profile
        cmdline.write_bytes(b"/opt/google/chrome/chrome\0" + flag + os.fsencode(directory) + b"\0")
    guest["prepare_profile"](profile, proc)
    assert [(profile / name).exists() for name in artifacts] == [process.startswith("active-")] * len(artifacts)
    assert (profile / "Default" / "Cookies").read_bytes() == b"keep"
    assert (profile / "SingletonDirectory").is_dir()


def test_stale_browser_symlink_is_unlinked_without_following_it(tmp_path, guest):
    profile = tmp_path / ".browser-profiles" / "driver" / "main"
    profile.mkdir(parents=True)
    target = tmp_path / "unreachable" / "socket"
    lock = profile / "SingletonSocket"
    try:
        lock.symlink_to(target)
    except OSError as error:
        if getattr(error, "winerror", None) == 1314:
            pytest.skip("Windows does not allow this process to create symbolic links")
        raise
    guest["prepare_profile"](profile, tmp_path / "proc")
    assert not lock.is_symlink()


def test_browser_stderr_reader_keeps_the_tail_and_drains_after_cleanup(tmp_path, guest):
    tail = tmp_path / "tail"
    stderr = b"x" * 16000 + b"could not create SingletonLock\n"
    for destination in (tail, tmp_path / "removed" / "tail"):
        subprocess.run([sys.executable, "-B", "-c", guest["SINK"], str(destination)],
                       input=stderr, check=True, timeout=5)
    assert tail.read_bytes() == stderr[-2048:]
    assert (tmp_path / "tail.done").exists()


@pytest.mark.parametrize("warm,code", [(False, None), (False, 0), (False, 6), (True, 0), (True, 6)])
def test_browser_wait_accepts_a_live_browser_or_a_successful_warm_handoff(guest, warm, code):
    shell = shutil.which("sh")
    if shell is None:
        pytest.skip("An installed POSIX shell is required for the launcher wait test")
    script = guest["launch_script"](LAUNCHER.read_text(encoding="utf-8"), PROFILE)
    start = script.index("if [ -x /opt/google/chrome/chrome ]; then")
    end = script.index("# The flags", start)
    script = script[:start] + "chromium=fake_chrome window_class=chromium-browser\n" + script[end:]
    script = script.replace("marker=raphael-seat-$(cat /proc/sys/kernel/random/uuid)", "marker=raphael-seat-test")
    script = script.replace('  mkdir -p "$profile"\n  ended_cleanly\n', "")
    script = script.replace("raphael-browser-tabs", "browser_tabs")
    # Windows tests the FIFO reader separately; native Python cannot open the POSIX pipe from Git's shell.
    if sys.platform == "win32":
        start = script.index('mkfifo "$log/stderr"')
        end = script.index("browser_error() {", start)
        script = script[:start] + ': > "$log/stderr"\n' + script[end:]
    else:
        script = script.replace("/usr/bin/python3 -c ", f"{shlex.quote(sys.executable)} -c ", 1)
    fakes = f"warm_case={int(warm)} chrome_code={code} use_fifo={int(sys.platform != 'win32')}\n" + r'''
pgrep() { if [ "$warm_case" = 1 ] || [ -f "$log/browser-ready" ]; then echo 99; fi; }
setsid() { "$@"; }
fake_chrome() {
  printf '%s\n' 'fake browser stderr: could not create SingletonLock' >&2
  if [ "$use_fifo" = 0 ]; then
    cp "$log/stderr" "$log/tail"
    : >"$log/tail.done"
  fi
  if [ "$chrome_code" = None ]; then
    : >"$log/browser-ready"
    sleep 1
    return 0
  fi
  return "$chrome_code"
}
browser_tabs() { :; }
wmctrl() {
  case "$1" in
    -lx) if { [ "$warm_case" = 1 ] && [ "${started-unset}" = "" ]; } ||
           { [ -n "${log:-}" ] && [ -f "$log/browser-ready" ]; }; then
           echo '0x5 0 chromium-browser.Chromium-browser host raphael-seat-test'
         fi ;;
    -lpx) echo '0x5 0 99 chromium-browser.Chromium-browser host raphael-seat-test' ;;
    -lG) echo '0x5 0 1280 0 1280 851 host raphael-seat-test' ;;
    -lp) echo '0x5 0 99 host raphael-seat-test' ;;
  esac
}
'''
    result = subprocess.run([shell, "-s", "1280", "0", "1280", "900"], input=fakes + script,
                            text=True, capture_output=True, timeout=8)
    if code is None or (warm and code == 0):
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == "pid=99 window_id=5"
    else:
        assert result.returncode == 1
        assert f"browser exited before opening a window (exit {code})" in result.stderr
        assert "fake browser stderr: could not create SingletonLock" in result.stderr


def test_a_launcher_it_does_not_know_runs_as_it_is_instead_of_being_refused(guest):
    # Another image's launcher must still start its browser: the stale locks are cleared, the launcher is not patched.
    assert guest["launch_script"]("#!/bin/sh\necho other launcher\n", PROFILE) is None
    patched = guest["launch_script"](LAUNCHER.read_text(encoding="utf-8"), PROFILE)
    assert patched is not None and "browser_error" in patched

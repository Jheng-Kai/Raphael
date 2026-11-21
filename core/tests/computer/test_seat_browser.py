import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path, PurePosixPath
from unittest.mock import AsyncMock

import pytest

from raphael_core.computer import seat_browser, vm

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


@pytest.mark.parametrize("method", ["lstat", "unlink"])
def test_an_unreadable_stale_lock_is_named_and_the_other_locks_are_still_cleared(tmp_path, guest, monkeypatch, capsys, method):
    profile = tmp_path / ".browser-profiles" / "driver" / "main"
    profile.mkdir(parents=True)
    bad = profile / "SingletonCookie"
    good = profile / "DevToolsActivePort"
    bad.touch()
    good.touch()
    original = getattr(Path, method)

    def check(path, *args, **kwargs):
        if path == bad:
            raise PermissionError(13, "Permission denied", str(path))
        return original(path, *args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(Path, method, check)
        assert guest["prepare_profile"](profile, tmp_path / "no-processes")
        assert capsys.readouterr().err == "RAPHAEL_STALE_LOCK SingletonCookie\n"
        assert not good.exists()
        proc = tmp_path / "proc"
        cmdline = proc / "123" / "cmdline"
        cmdline.parent.mkdir(parents=True)
        cmdline.write_bytes(b"chrome\0--user-data-dir=" + os.fsencode(profile) + b"\0")
        good.touch()
        assert not guest["prepare_profile"](profile, proc)
        assert capsys.readouterr().err == ""
        assert good.exists()
    assert bad.exists()


@pytest.mark.parametrize("scenario", ["stale", "live", "remote", "redirected"])
async def test_the_seat_browser_retries_after_host_cleanup_only_on_a_stale_lock_verdict(tmp_path, monkeypatch, scenario):
    machine = vm.LocalVm(tmp_path, runner=AsyncMock())
    host = "remote" if scenario == "remote" else ""
    target = machine.shared_target(host, 7, 2)
    profile = machine.homes / "shared" / Path(*seat_browser.PROFILE_PARTS)
    profile.mkdir(parents=True)
    if scenario == "redirected":
        outside = tmp_path / "outside"
        profile.rmdir()
        outside.mkdir()
        try:
            profile.symlink_to(outside, target_is_directory=True)
        except OSError as error:
            if getattr(error, "winerror", None) == 1314:
                pytest.skip("Windows does not allow this process to create symbolic links")
            raise
    lock = profile / "SingletonCookie"
    untouched = profile / "SingletonSocket"
    lock.touch()
    untouched.touch()
    (profile / "Preferences").write_text("keep")
    monkeypatch.setattr("raphael_core.computer.carry.before_browser", AsyncMock())
    calls = []

    async def launch(target, args, **kwargs):
        calls.append(args)
        if len(calls) == 1:
            assert lock.exists()
            assert (seat_browser.RECOVER_STALE_LOCKS in args) is (scenario != "remote")
            if scenario != "live":
                return vm.Result(seat_browser.STALE_LOCK_EXIT, "", "RAPHAEL_STALE_LOCK SingletonCookie\n"
                                 "RAPHAEL_STALE_LOCK ../Preferences\nRAPHAEL_STALE_LOCK SingletonSocket:stream\n")
        else:
            assert seat_browser.RECOVER_STALE_LOCKS not in args
            assert lock.exists() is (scenario != "stale")
        return vm.Result(0, "pid=71 window_id=42")

    monkeypatch.setattr(machine, "run_for", launch)
    if scenario == "remote":
        with pytest.raises(vm.VmError, match="browser_window_missing"):
            await machine.seat_browser(target)
    else:
        assert await machine.seat_browser(target) == {"pid": 71, "window_id": 42}
    assert len(calls) == (2 if scenario in ("stale", "redirected") else 1)
    assert lock.exists() is (scenario != "stale")
    assert untouched.exists() and (profile / "Preferences").read_text() == "keep"


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


@pytest.mark.parametrize("kind", ["python", "native", "layer12"])
def test_the_guest_entry_cleans_the_profile_and_executes_the_launcher_with_its_arguments(tmp_path, monkeypatch, kind):
    profile = tmp_path / ".browser-profiles" / "driver" / "main"
    profile.mkdir(parents=True)
    lock = profile / "SingletonLock"
    lock.touch()
    launcher = tmp_path / "raphael-seat-browser"
    source = {
        "python": b"#!/usr/bin/python3\nprint('started')\n",
        "native": b"\x7fELF\xff",
        "layer12": LAUNCHER.read_text(encoding="utf-8").replace(str(PROFILE), str(profile)).encode(),
    }[kind]
    launcher.write_bytes(source)
    argv = ["0", "900", "1280", "900", "https://example.test/?q=two words"]
    monkeypatch.setattr(sys, "argv", ["-", "raphael-seat-browser", *argv])
    calls = []

    def execv(path, args):
        assert not lock.exists()
        calls.append((path, args))

    monkeypatch.setattr(os, "execv", execv)
    script = seat_browser.LAUNCH.replace(f'"{PROFILE}"', repr(str(profile)))
    script = script.replace('"/usr/local/bin/raphael-seat-browser"', repr(str(launcher)))
    script = script.replace('"/proc"', repr(str(tmp_path / "proc")))
    exec(script, {"__name__": "__main__"})

    assert len(calls) == 1
    path, args = calls[0]
    if kind == "layer12":
        assert path == "/bin/sh" and args[:2] == ["sh", "-c"]
        assert "browser_error" in args[2]
        assert args[3:] == ["raphael-seat-browser", *argv]
    else:
        assert path == str(launcher) and args == [str(launcher), *argv]

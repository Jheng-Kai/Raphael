"""The Chrome shown for a certificate (#345) outlives the app. The certificate the owner chose lives in that Chrome's memory
only, so when the app quits the Chrome keeps running and the next run takes it over, instead of stopping it and starting a
background Chrome that asks for the certificate again (R-COMP-CERT-01)."""

import asyncio
import contextlib
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from raphael_core.computer import host_browser, host_page
from raphael_core.computer.host_browser import (
    SHOWN_RECORD, AdoptedChrome, BrowserError, HostBrowser, Tab, kill_process_tree, process_alive,
)

PID = 4242
PATH = "/devtools/browser/0b1c2d3e-0000-4000-8000-123456789abc"


class Running:
    """A Chrome that is running: its pages, what it was told, and whether it still answers."""

    def __init__(self, pages, *, port=9333, fails=None):
        self.pages = dict(pages)
        self.calls = []
        self.reader = asyncio.get_running_loop().create_future()
        self.socket = SimpleNamespace(port=port, path=PATH)
        self.event = lambda *args: None
        self.closed = False
        self.fails = fails
        self.sequence = 0
        self.alive = None

    async def call(self, method, params=None, *, session=None):
        self.calls.append((method, params, session))
        if method == self.fails:
            raise BrowserError("chrome_command_failed")
        if method == "Target.getTargets":
            return {"targetInfos": [{"type": "page", "url": url, "targetId": target} for target, url in self.pages.items()]
                    + [{"type": "service_worker", "url": "https://sw.example.test/", "targetId": "worker"}]}
        if method == "Target.createTarget":
            self.sequence += 1
            self.pages[f"new-{self.sequence}"] = params["url"]
            return {"targetId": f"new-{self.sequence}"}
        if method == "Target.closeTarget":
            self.pages.pop(params["targetId"], None)
        if method == "Target.attachToTarget":
            return {"sessionId": "session-" + params["targetId"]}
        if method == "Page.getFrameTree":
            return {"frameTree": {"frame": {"id": "frame-" + session, "url": "about:blank"}}}
        if method == "Browser.getWindowForTarget":
            return {"windowId": 7}
        if method == "Browser.close" and self.alive is not None:
            self.alive.discard(PID)
        return {}

    async def close(self):
        self.closed = True

    def sent(self, method):
        return [params for name, params, _ in self.calls if name == method]


class Chrome:
    """The process of a Chrome that was started: still running."""

    pid, returncode = PID, None

    def kill(self):
        pass


class Tree:
    def __init__(self):
        self.released = self.ended = False

    def detach(self):
        self.released = True

    async def close(self):
        self.ended = True


@pytest.fixture
def system(monkeypatch, tmp_path):
    """Process id 4242 is running until Chrome closes (or `alive` is emptied); nothing else of this PC is touched."""
    alive = {PID}
    killed = []

    async def kill(pid):
        killed.append(pid)
        alive.discard(pid)

    monkeypatch.setattr(host_browser, "process_alive", lambda pid: pid in alive)
    monkeypatch.setattr(host_browser, "kill_process_tree", kill)
    monkeypatch.setattr(host_browser, "chrome_executable", lambda: tmp_path / "chrome")
    monkeypatch.setattr(AdoptedChrome, "CLOSE_WAIT_S", 0.05)
    return SimpleNamespace(alive=alive, killed=killed)


def shown_browser(tmp_path, pages=None):
    """The browser of a run whose Chrome was started to be seen, with members' tabs on it."""
    browser = HostBrowser(tmp_path / "profile")
    chrome = Running(pages or {"first": "about:blank", "gate": "https://ef.example.test:8443/",
                               "inbox": "https://app.example.test/inbox"})
    browser.cdp, browser.process, browser.process_tree = chrome, Chrome(), Tree()
    browser.shown, browser.shown_since = True, 1_700_000_000.0
    for identifier, member in (("gate", 1), ("inbox", 2)):
        tab = Tab(identifier, identifier, "session-" + identifier, member, tmp_path, ready=True)
        tab.cast = host_browser.Screencast(browser, tab)
        browser.tabs[identifier] = tab
        browser.owned_targets[identifier] = member
        browser.select(tab)
    browser.profile.mkdir(parents=True, exist_ok=True)
    return browser, chrome


def next_run(tmp_path, monkeypatch, chrome):
    """The next run of the app: a browser of its own on the same profile, which finds `chrome` where the record says."""
    browser = HostBrowser(tmp_path / "profile")
    endpoints = []

    async def connect(endpoint=None):
        endpoints.append(endpoint)
        gone = chrome.sent("Browser.close")  # a Chrome asked to close answers no more
        return chrome if not gone and (endpoint == (chrome.socket.port, PATH) or endpoint is None) else None

    monkeypatch.setattr(browser, "_connect", connect)
    return browser, endpoints


def launches(monkeypatch):
    """What `start` launches once it finds nothing to take over: recorded, and refused (the start then fails), as a Chrome
    that answers nothing does. Whether each was started to be seen."""
    seen = []

    class Launched:
        pid, returncode = PID, 1

        def __init__(self, argv, visible=False):
            seen.append(visible if os.name == "nt" else not any(
                item == "--headless=new" or item.startswith("--window-position") for item in argv))

        def resume(self):
            pass

        def close(self):
            pass

        def kill(self):
            pass

        async def wait(self):
            return 1

    async def exec_(*argv, **options):
        return Launched(argv)

    monkeypatch.setattr(host_browser, "DesktopChrome", Launched)
    monkeypatch.setattr(host_browser, "LaunchedChrome", Launched)
    monkeypatch.setattr(host_browser.asyncio, "create_subprocess_exec", exec_)
    monkeypatch.setattr(host_browser, "ChromeProcessTree", lambda process: Tree())
    return seen


def record_of(browser):
    return json.loads((browser.profile / SHOWN_RECORD).read_text(encoding="ascii"))


async def test_a_shown_chrome_is_left_running_when_the_app_quits(tmp_path, system):
    browser, chrome = shown_browser(tmp_path)
    tree, process = browser.process_tree, browser.process
    await browser.aclose()
    # Chrome was not asked to close, its process tree was let go of (Windows: the job that ends it with the app) and not
    # ended, and the app lets go of it entirely.
    assert not chrome.sent("Browser.close") and chrome.closed
    assert tree.released and not tree.ended and process.returncode is None and not system.killed
    assert browser.cdp is browser.process is browser.process_tree is None and not browser.shown and not browser.tabs
    assert not browser.owned_targets and not browser.current
    # Its profile says which Chrome it is, how to connect to it and when it started, in a file Chrome never reads.
    assert record_of(browser) == {"version": 1, "pid": PID, "port": 9333, "path": PATH, "started": 1_700_000_000.0}
    # The members' pages are closed but one blank one, out of the way, which keeps the windowed Chrome running.
    assert chrome.pages == {"first": "about:blank"}
    bounds = chrome.sent("Browser.setWindowBounds")[-1]["bounds"]
    assert bounds == ({"windowState": "minimized"} if sys.platform == "darwin" else {"left": -32000, "top": -32000})


async def test_a_background_chrome_is_stopped_when_the_app_quits(tmp_path, system):
    browser, chrome = shown_browser(tmp_path)
    browser.shown = False
    tree = browser.process_tree
    await browser.aclose()
    assert chrome.sent("Browser.close") and tree.ended and not tree.released
    assert not (browser.profile / SHOWN_RECORD).exists()


async def test_a_shown_chrome_that_cannot_be_noted_or_let_go_of_is_stopped_instead(tmp_path, system, monkeypatch):
    browser, chrome = shown_browser(tmp_path)
    tree = browser.process_tree

    def refuse():
        raise OSError("job_release")  # Windows could not take the Chrome out of the job that ends it with the app

    tree.detach = refuse
    await browser.aclose()
    assert chrome.sent("Browser.close") and tree.ended and not (browser.profile / SHOWN_RECORD).exists()
    browser, chrome = shown_browser(tmp_path)
    monkeypatch.setattr(browser, "_write_shown_record", lambda: False)
    await browser.aclose()
    assert chrome.sent("Browser.close") and not browser.shown


async def test_the_next_run_takes_over_the_shown_chrome_and_closes_its_old_pages(tmp_path, system, monkeypatch):
    first, chrome = shown_browser(tmp_path)
    chrome.pages.update({"leftover": "https://app.example.test/old", "second": "about:blank"})
    await first.aclose()
    chrome.pages.update({"late": "https://intranet.example.test/"})  # a page the old run left behind
    chrome.calls.clear()
    second, endpoints = next_run(tmp_path, monkeypatch, chrome)
    seen = launches(monkeypatch)
    assert await second.start() is False  # no Chrome process was started
    assert seen == [] and endpoints == [(9333, PATH)]
    assert second.cdp is chrome and second.shown and second.shown_since == 1_700_000_000.0
    assert isinstance(second.process, AdoptedChrome) and second.process.pid == PID and second.process_tree is None
    assert not chrome.sent("Browser.close") and (second.profile / SHOWN_RECORD).exists()
    # What a Chrome of this run is given, as when it is started.
    assert chrome.sent("Browser.setDownloadBehavior")[0]["behavior"] == "allowAndName"
    assert {params["permission"]["name"] for params in chrome.sent("Browser.setPermission")} >= {"notifications", "camera"}
    assert chrome.sent("Target.setDiscoverTargets") == [{"discover": True, "filter": [{"type": "page"}]}]
    # Its pages were the earlier run's: only one blank page is left (out of the way), none can be worked or collide.
    assert list(chrome.pages.values()) == ["about:blank"] and len(chrome.pages) == 1
    assert not second.tabs and not second.owned_targets and second.startup_url is None
    # A member's tab of this run is a new page of that Chrome, made far off the screen, never one of the old ones.
    stale = set(chrome.pages)
    tab, started = await second.open_tab(1, tmp_path, 10)
    assert started is False and tab.target not in stale and second.live(tab) and tab.ready
    made = chrome.sent("Target.createTarget")[-1]
    assert made["newWindow"] and made["left"] == made["top"] == -32000
    # Asked again for a certificate it comes to the front, as a Chrome shown in this run does, and starts no other.
    await second.show_for_owner(tab)
    assert len(chrome.sent("Page.bringToFront")) == 1 and not seen


async def test_a_taken_over_chrome_puts_no_window_on_a_macs_screen_until_a_certificate_step_asks_for_it(tmp_path, system, monkeypatch):
    # The owner's report: windows kept opening on the Mac. A window placed far off is put back on a Mac's screen, and bringing a
    # minimized one to the front shows it again, so at the next start nothing is shown or made, except minimized.
    monkeypatch.setattr(host_browser.sys, "platform", "darwin")
    monkeypatch.delenv("RAPHAEL_MAC_HEADED", raising=False)
    first, chrome = shown_browser(tmp_path, {"old": "https://app.example.test/old"})  # no blank page to keep: one is made
    await first.aclose()
    kept = chrome.sent("Target.createTarget")
    assert len(kept) == 1 and kept[0]["windowState"] == "minimized" and kept[0]["left"] == kept[0]["top"] == -32000
    second, _ = next_run(tmp_path, monkeypatch, chrome)
    launches(monkeypatch)
    assert await second.start() is False and second.shown
    assert [params["bounds"] for params in chrome.sent("Browser.setWindowBounds")] == [{"windowState": "minimized"}] * 2
    assert not chrome.sent("Page.bringToFront")
    tab, _ = await second.open_tab(1, tmp_path, 10)
    assert chrome.sent("Target.createTarget")[-1]["windowState"] == "minimized"
    await second.activate(tab)  # selecting the member's tab in the view shows no window either
    assert not chrome.sent("Page.bringToFront")
    assert len(chrome.sent("Browser.setWindowBounds")) == 2
    # The certificate step is what brings the window: normal, placed, in front.
    await second.show_for_owner(tab)
    assert [params["bounds"].get("windowState") for params in chrome.sent("Browser.setWindowBounds")][2:] == ["normal", None]
    assert len(chrome.sent("Page.bringToFront")) == 1


async def test_a_shown_chrome_the_same_run_let_go_of_is_taken_over_again(tmp_path, system, monkeypatch):
    # The app may close its computer (clearing the history) and use it again without quitting.
    browser, chrome = shown_browser(tmp_path)
    connected = []

    async def connect(endpoint=None):
        connected.append(endpoint)
        return chrome

    monkeypatch.setattr(browser, "_connect", connect)
    await browser.aclose()
    assert await browser.start() is False
    assert browser.shown and browser.cdp is chrome and connected == [(9333, PATH)] and not chrome.sent("Browser.close")


async def test_a_chrome_that_is_not_the_shown_one_is_stopped_before_a_new_one_starts(tmp_path, system, monkeypatch):
    # No record: a background Chrome of an earlier run, or a headed one an earlier release left on this profile.
    chrome = Running({"first": "about:blank", "page": "https://app.example.test/"})
    chrome.alive = system.alive
    browser, endpoints = next_run(tmp_path, monkeypatch, chrome)
    answers = iter([chrome])

    async def connect(endpoint=None):
        endpoints.append(endpoint)
        return next(answers, None)

    monkeypatch.setattr(browser, "_connect", connect)
    seen = launches(monkeypatch)
    with pytest.raises(BrowserError, match="chrome_start_failed"):
        await browser.start()
    assert chrome.sent("Browser.close") and chrome.closed and not browser.shown
    assert system.alive == set() and seen == [False]


async def test_a_record_of_a_chrome_that_is_gone_is_ignored_and_removed(tmp_path, system, monkeypatch):
    first, chrome = shown_browser(tmp_path)
    await first.aclose()
    system.alive.clear()  # Chrome was quit (or the Mac restarted) while no app ran
    second, endpoints = next_run(tmp_path, monkeypatch, chrome)
    seen = launches(monkeypatch)
    with pytest.raises(BrowserError, match="chrome_start_failed"):
        await second.start()
    assert not second.shown and not (second.profile / SHOWN_RECORD).exists()
    # Something else answers where the record says (the process id is another process's now): it is not taken over.
    first, chrome = shown_browser(tmp_path)
    await first.aclose()
    system.alive.add(PID)

    async def nothing(endpoint=None):
        return None

    monkeypatch.setattr(second, "_connect", nothing)
    with pytest.raises(BrowserError, match="chrome_start_failed"):
        await second.start()
    assert not (second.profile / SHOWN_RECORD).exists() and seen == [False, False]
    # A record that is not one is no record.
    (second.profile / SHOWN_RECORD).write_text("{\"pid\": \"4242\"}", encoding="ascii")
    with pytest.raises(BrowserError, match="chrome_start_failed"):
        await second.start()
    assert not (second.profile / SHOWN_RECORD).exists() and seen == [False] * 3


async def test_chrome_that_is_gone_makes_the_next_start_a_background_chrome(tmp_path, system, monkeypatch):
    # A shown Chrome that crashed (or that the owner quit) while the app ran: the next start is the background one again.
    browser, chrome = shown_browser(tmp_path)
    assert browser._write_shown_record()
    browser.process.returncode = 1
    system.alive.clear()
    chrome.reader.set_result(None)  # the connection ended with it
    seen = launches(monkeypatch)
    with pytest.raises(BrowserError, match="chrome_start_failed"):
        await browser.restart_if_disconnected()
    assert seen == [False] and not browser.shown and not (browser.profile / SHOWN_RECORD).exists()


async def test_a_dropped_connection_to_a_running_shown_chrome_connects_again_and_does_not_end_it(tmp_path, system, monkeypatch):
    browser, chrome = shown_browser(tmp_path)
    chrome.reader.set_result(None)  # the connection dropped; Chrome runs
    second = Running({"first": "about:blank"})
    connected = []

    async def connect(endpoint=None):
        connected.append(endpoint)
        return second

    monkeypatch.setattr(browser, "_connect", connect)
    await browser.restart_if_disconnected()
    assert browser.cdp is second and browser.shown and connected == [(9333, PATH)]
    assert not chrome.sent("Browser.close") and not system.killed and PID in system.alive


async def test_a_shown_chrome_that_cannot_be_worked_with_is_stopped_and_a_background_one_starts(tmp_path, system, monkeypatch):
    first, chrome = shown_browser(tmp_path)
    await first.aclose()
    chrome.fails = "Browser.setDownloadBehavior"
    chrome.alive = system.alive
    second, _ = next_run(tmp_path, monkeypatch, chrome)
    seen = launches(monkeypatch)
    with pytest.raises(BrowserError, match="chrome_start_failed"):
        await second.start()
    assert chrome.sent("Browser.close") and not second.shown and not (second.profile / SHOWN_RECORD).exists() and seen == [False]


async def test_a_taken_over_chrome_ends_when_it_is_stopped(tmp_path, system, monkeypatch):
    first, chrome = shown_browser(tmp_path)
    await first.aclose()
    chrome.alive = system.alive
    second, _ = next_run(tmp_path, monkeypatch, chrome)
    await second.start()
    await second._stop()
    assert chrome.sent("Browser.close") and system.alive == set() and not system.killed
    assert not second.shown and not (second.profile / SHOWN_RECORD).exists()
    # One that does not end when asked to is ended, with what it started.
    first, chrome = shown_browser(tmp_path)
    await first.aclose()
    system.alive.add(PID)
    second, _ = next_run(tmp_path, monkeypatch, chrome)
    await second.start()
    await second._stop()
    assert system.killed == [PID]


async def test_a_chrome_started_to_be_seen_notes_itself_in_the_profile(tmp_path, system, monkeypatch):
    # The note is made when it starts, so that a core that is killed instead of quitting still leaves it for the next run.
    browser = HostBrowser(tmp_path / "profile")
    chrome = Running({"first": "about:blank"})

    class Started:
        pid, returncode = PID, None

        def __init__(self, argv, visible=False):
            pass

        def resume(self):
            pass

        def close(self):
            pass

        def kill(self):
            pass

        async def wait(self):
            return 1

    async def exec_(*argv, **options):
        return Started(argv)

    async def started(client, port):
        return chrome

    monkeypatch.setattr(host_browser, "DesktopChrome", Started)
    monkeypatch.setattr(host_browser, "LaunchedChrome", Started)
    monkeypatch.setattr(host_browser.asyncio, "create_subprocess_exec", exec_)
    monkeypatch.setattr(host_browser, "ChromeProcessTree", lambda process: Tree())
    monkeypatch.setattr(browser, "_connect_started", started)
    await browser.start()
    assert not (browser.profile / SHOWN_RECORD).exists()  # a background Chrome is never noted
    await browser._stop()
    browser.shown = True
    await browser.start()
    note = record_of(browser)
    assert note["pid"] == PID and note["port"] == 9333 and note["path"] == PATH and note["started"] > 1_700_000_000
    assert browser.shown_since == note["started"]


@pytest.mark.parametrize("record", [
    {"version": 2, "pid": PID, "port": 9333, "path": PATH, "started": 1},
    {"version": 1, "pid": True, "port": 9333, "path": PATH, "started": 1},
    {"version": 1, "pid": PID, "port": 0, "path": PATH, "started": 1},
    {"version": 1, "pid": PID, "port": 9333, "path": None, "started": 1},
    {"version": 1, "pid": PID, "port": 9333, "path": PATH},
    [PID],
])
def test_only_a_whole_record_is_read(tmp_path, record):
    browser = HostBrowser(tmp_path)
    (tmp_path / SHOWN_RECORD).write_text(json.dumps(record), encoding="ascii")
    assert browser._shown_record() is None
    (tmp_path / SHOWN_RECORD).write_text(json.dumps({"version": 1, "pid": PID, "port": 9333, "path": PATH, "started": 1}),
                                         encoding="ascii")
    assert browser._shown_record()["pid"] == PID


def test_a_process_is_alive_while_it_runs_and_not_after():
    assert process_alive(os.getpid()) and not process_alive(0) and not process_alive(None) and not process_alive(-1)
    import subprocess
    finished = subprocess.Popen([sys.executable, "-c", "pass"])
    finished.wait()
    assert not process_alive(finished.pid)


LAUNCHER = """
import sys, time
from raphael_core.computer.host_desktop import DesktopChrome
sys.stdin.readline()
child = DesktopChrome([r"C:\\Windows\\System32\\cmd.exe", "/c", "ping", "-n", "40", "127.0.0.1"], visible=True)
child.resume()
print(child.pid, flush=True)
time.sleep(60)
"""


@pytest.mark.skipif(os.name != "nt", reason="the Windows branch")
@pytest.mark.parametrize(("allows", "survives"), [(True, True), (False, False)])
async def test_a_chrome_made_to_be_seen_leaves_the_job_of_the_app_when_the_job_allows_it(tmp_path, allows, survives):
    # The app puts the core, and what the core starts, in a job that ends them with the app (`core_process.rs`). The Chrome
    # made to be seen breaks away from it, so it outlives the app; where the job does not allow that, it starts all the same.
    import ctypes as c
    import subprocess
    from ctypes import wintypes as w

    kernel = c.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.restype = w.HANDLE
    kernel.OpenProcess.restype = w.HANDLE
    kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
    kernel.SetInformationJobObject.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD]
    kernel.CloseHandle.argtypes = [w.HANDLE]

    class Basic(c.Structure):
        _fields_ = [("a", c.c_longlong), ("b", c.c_longlong), ("flags", w.DWORD), ("min_ws", c.c_size_t),
                    ("max_ws", c.c_size_t), ("active", w.DWORD), ("affinity", c.c_size_t), ("priority", w.DWORD),
                    ("scheduling", w.DWORD)]

    class Limits(c.Structure):
        _fields_ = [("basic", Basic), ("io", c.c_ulonglong * 6), ("pm", c.c_size_t), ("jm", c.c_size_t),
                    ("pp", c.c_size_t), ("pj", c.c_size_t)]

    job = kernel.CreateJobObjectW(None, None)
    limits = Limits()
    limits.basic.flags = 0x2000 | (0x800 if allows else 0)  # KILL_ON_JOB_CLOSE, and BREAKAWAY_OK
    assert kernel.SetInformationJobObject(job, 9, c.byref(limits), c.sizeof(limits))
    source = str(Path(host_browser.__file__).parents[2])
    launcher = subprocess.Popen([sys.executable, "-c", LAUNCHER], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
                                env={**os.environ, "PYTHONPATH": source})
    pid = None
    try:
        handle = kernel.OpenProcess(0x1F0FFF, False, launcher.pid)
        assert kernel.AssignProcessToJobObject(job, handle)
        kernel.CloseHandle(handle)
        launcher.stdin.write("go\n")
        launcher.stdin.flush()
        pid = int(await asyncio.to_thread(launcher.stdout.readline))
        assert process_alive(pid)
        kernel.CloseHandle(job)  # what the OS does when the app exits: the job's last handle closes
        await asyncio.sleep(1.5)
        assert launcher.poll() is not None and process_alive(pid) is survives
    finally:
        if pid is not None and process_alive(pid):
            await kill_process_tree(pid)
        launcher.kill()
        launcher.wait()
        launcher.stdin.close()
        launcher.stdout.close()


NATIVE = pytest.mark.skipif(host_browser.chrome_executable() is None or bool(os.environ.get("CI")),
                            reason="Google Chrome is unavailable or this is CI")
SITE = b"<title>Staff area</title>Hello"


async def serve(reader, writer):
    try:
        with contextlib.suppress(asyncio.IncompleteReadError, ConnectionError):
            await reader.readuntil(b"\r\n\r\n")
            writer.write(b"HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: text/html\r\n"
                         b"Content-Length: %d\r\n\r\n" % len(SITE) + SITE)
            await writer.drain()
    finally:
        writer.close()


@NATIVE
async def test_native_chrome_shown_for_a_certificate_is_the_same_chrome_in_the_next_run(tmp_path):
    site = await asyncio.start_server(serve, "127.0.0.1", 0)
    base = f"http://localhost:{site.sockets[0].getsockname()[1]}"
    first = HostBrowser(tmp_path / "profile")
    second = HostBrowser(tmp_path / "profile")
    pid = None
    try:
        gate, _ = await first.open_tab(1, tmp_path, 10)
        assert await host_page.navigate(first, gate, base + "/gate")
        await host_page.evaluate(first, gate, "document.cookie = 'chosen=1; path=/'")  # lives in this Chrome's memory only
        await first.show_for_owner(gate)
        assert first.shown
        pid = first.process.pid
        await first.aclose()  # the app quits
        assert process_alive(pid) and first.cdp is None and (first.profile / SHOWN_RECORD).exists()
        # The next run: the same Chrome, shown, with what it held, and none of the old pages.
        tab, started = await second.open_tab(1, tmp_path, 10)
        assert not started and second.shown and second.process.pid == pid
        assert await host_page.navigate(second, tab, base + "/gate")
        assert "chosen=1" in (await host_page.evaluate(second, tab, "document.cookie"))[0]
        listing = await second.cdp.call("Target.getTargets")
        assert sorted(info["url"] for info in listing["targetInfos"] if info["type"] == "page") == ["about:blank", base + "/gate"]
        await second._stop()
        assert not second.shown and not (second.profile / SHOWN_RECORD).exists()
        async with asyncio.timeout(10):
            while process_alive(pid):
                await asyncio.sleep(0.1)
        # Chrome is gone: the next start is the background Chrome again.
        tab, started = await second.open_tab(1, tmp_path, 10)
        assert started and not second.shown
    finally:
        for browser in (first, second):
            with contextlib.suppress(Exception):
                await browser._stop()
        if pid is not None and process_alive(pid):
            await kill_process_tree(pid)
        site.close()

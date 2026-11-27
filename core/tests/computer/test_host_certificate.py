"""A page that asks for a client certificate (#345). A Chrome no one sees cannot show its chooser, so for that step Raphael's
Chrome is started once more where the owner sees it, every member's tab bound to it again, and it stays so, out of the way
once the owner is done (the choice lives in that Chrome's memory), until Chrome would start again anyway."""

import asyncio
import contextlib
import json
import os
import sys
from types import SimpleNamespace

import pytest

from raphael_core.brain.settings import SettingsStore
from raphael_core.computer import host_browser, host_page
from raphael_core.computer.host_browser import BrowserError, HostBrowser, Tab, headless_chrome, startup_pages, window_arguments
from raphael_core.computer.host_computer import HostComputerTools
from raphael_core.computer.vm import LocalVm
from raphael_core.computer.vm_tools import BROWSER_OPEN


class Launch:
    """One start of a fake Chrome: its own connection, its own targets and what it was told."""

    def __init__(self, browser, number, shown):
        self.browser, self.number, self.shown = browser, number, shown
        self.calls = []
        self.sequence = 0
        self.reader = asyncio.get_running_loop().create_future()
        self.socket = SimpleNamespace(port=9000 + number)
        self.event = browser._event
        self.closed = False
        self.cookies = []
        self.startup = f"startup-{number}"
        self.startup_url = f"http://127.0.0.1:1/{number}"

    async def call(self, method, params=None, *, session=None):
        self.calls.append((method, params, session))
        if method == "Target.getTargets":
            return {"targetInfos": [{"type": "page", "url": self.startup_url, "targetId": self.startup}]}
        if method == "Target.createTarget":
            self.sequence += 1
            return {"targetId": f"target-{self.number}-{self.sequence}"}
        if method == "Target.attachToTarget":
            return {"sessionId": "session-" + params["targetId"]}
        if method == "Page.getFrameTree":
            return {"frameTree": {"frame": {"id": "frame-" + session, "url": "about:blank"}}}
        if method == "Storage.getCookies":
            return {"cookies": self.cookies}
        if method == "Browser.getWindowForTarget":
            return {"windowId": 7}
        return {}

    async def close(self):
        self.closed = True

    def sent(self, method):
        return [(params, session) for name, params, session in self.calls if name == method]


class Machine:
    """A HostBrowser whose Chrome is a fake: every start is a Launch."""

    def __init__(self, tmp_path, monkeypatch):
        self.browser = browser = HostBrowser(tmp_path / "profile")
        self.launches = []
        self.fail_next = False
        monkeypatch.setattr(browser, "start", self.start)
        self.begin()

    def begin(self):
        launch = Launch(self.browser, len(self.launches) + 1, self.browser.shown)
        self.launches.append(launch)
        self.browser.cdp = launch
        return launch

    async def start(self):
        if self.fail_next:
            self.fail_next = False
            self.browser.cdp = None
            raise BrowserError("chrome_start_failed")
        self.browser.startup_url = self.begin().startup_url
        return True

    @property
    def now(self):
        return self.launches[-1]

    def add(self, identifier, member, tmp_path, url, *, shown=True):
        launch = self.now
        target = f"old-{identifier}"
        tab = Tab(identifier, target, "session-" + target, member, tmp_path, url=url, ready=True)
        self.browser.tabs[identifier] = tab
        self.browser.owned_targets[target] = member
        tab.cast = host_browser.Screencast(self.browser, tab)
        if shown:
            self.browser.select(tab)
        return tab


def machine(tmp_path, monkeypatch):
    return Machine(tmp_path, monkeypatch)


@pytest.mark.parametrize("system", ["darwin", "win32", "linux"])
def test_a_chrome_started_to_be_seen_has_a_window_on_the_screen_and_is_not_headless(monkeypatch, system):
    monkeypatch.setattr(host_browser.sys, "platform", system)
    monkeypatch.delenv("RAPHAEL_MAC_HEADED", raising=False)
    assert headless_chrome(shown=True) is False
    assert window_arguments("136.0.0.0", shown=True) == []
    assert startup_pages("marker", shown=True) == ["marker", "about:blank"]
    assert headless_chrome() is (system == "darwin")


async def test_a_certificate_step_shows_chrome_before_its_card_and_tucks_it_away_when_the_owner_is_done(tmp_path, conn, monkeypatch):
    tools = HostComputerTools(LocalVm(tmp_path, settings=SettingsStore(conn)), conn, BROWSER_OPEN)
    browser = tools.browser
    browser.cdp = SimpleNamespace(reader=asyncio.get_running_loop().create_future())
    tab = Tab("original", "target", "session", 1, tmp_path)
    browser.tabs[tab.id] = tab
    browser.select(tab)
    order = []

    async def show(shown):
        order.append("show")
        assert shown is tab and browser.handback[1] is tab

    async def tuck(tucked):
        order.append("tuck")
        assert tucked is tab

    async def wait(**context):
        order.append("card")

    async def snapshot(*args):
        return {"tab_id": "original"}, []

    async def dispatch(*args, **kwargs):
        return {"owner_needed": reason}, []

    monkeypatch.setattr(browser, "show_for_owner", show, raising=False)
    monkeypatch.setattr(browser, "tuck_away", tuck, raising=False)
    monkeypatch.setattr(host_page, "snapshot", snapshot)
    monkeypatch.setattr(tools, "page_call", dispatch)
    tools.cards = SimpleNamespace(wait_for_browser=wait)
    key = next(item.key for item in tools.offered(1) if item.name == "request_takeover")
    for reason, expected in (("certificate", ["show", "card", "tuck"]), ("sign_in", ["card"])):
        order.clear()
        result = await tools.call(key, {"reason": reason}, member=1, scope=("turn", 1, 3), turn_id=2, conversation_id=3,
                                  private=True, approver="auto", language="en", announce=None)
        assert result.ok and order == expected, reason


async def test_the_certificate_card_is_tucked_away_even_when_the_owner_stops(tmp_path, conn, monkeypatch):
    tools = HostComputerTools(LocalVm(tmp_path, settings=SettingsStore(conn)), conn, BROWSER_OPEN)
    browser = tools.browser
    browser.cdp = SimpleNamespace(reader=asyncio.get_running_loop().create_future())
    tab = Tab("original", "target", "session", 1, tmp_path)
    browser.tabs[tab.id] = tab
    browser.select(tab)
    tucked = []

    async def show(shown):
        pass

    async def tuck(shown):
        tucked.append(shown)

    async def wait(**context):
        raise BrowserError("browser_handback_stopped")

    async def dispatch(*args, **kwargs):
        return {"owner_needed": "certificate"}, []

    monkeypatch.setattr(browser, "show_for_owner", show, raising=False)
    monkeypatch.setattr(browser, "tuck_away", tuck, raising=False)
    monkeypatch.setattr(tools, "page_call", dispatch)
    tools.cards = SimpleNamespace(wait_for_browser=wait)
    key = next(item.key for item in tools.offered(1) if item.name == "request_takeover")
    result = await tools.call(key, {"reason": "certificate"}, member=1, scope=("turn", 1, 3), turn_id=2, conversation_id=3,
                              private=True, approver="auto", language="en", announce=None)
    assert not result.ok and result.kind == "browser_handback_stopped" and tucked == [tab]


async def test_a_navigation_remembers_where_it_was_going_until_it_has_arrived(tmp_path, monkeypatch):
    browser = HostBrowser(tmp_path / "profile")
    browser.cdp = SimpleNamespace(socket=SimpleNamespace(port=1), reader=asyncio.get_running_loop().create_future())
    tab = Tab("tab", "target", "session", 1, tmp_path)
    browser.tabs[tab.id] = tab
    answers = iter([{"errorText": "net::ERR_SSL_CLIENT_AUTH_CERT_NEEDED"}, {"loaderId": "a"}, {"errorText": "net::ERR_NAME_NOT_RESOLVED"}])

    async def command(tab, method, params=None):
        if method == "Page.navigate":
            return next(answers)
        return {"frameTree": {"frame": {"loaderId": "a"}}}

    monkeypatch.setattr(browser, "command", command)
    with pytest.raises(BrowserError, match="browser_certificate_needed"):
        await host_page.navigate(browser, tab, "https://intranet.example.test:8443/")
    assert tab.requested == "https://intranet.example.test:8443/"
    assert await host_page.navigate(browser, tab, "https://intranet.example.test:8443/")
    assert tab.requested == ""
    with pytest.raises(BrowserError, match="browser_navigation_failed"):
        await host_page.navigate(browser, tab, "https://gone.example.test/")
    assert tab.requested == ""


@pytest.mark.parametrize("system", ["darwin", "win32"])
async def test_showing_chrome_binds_every_members_tab_to_the_new_chrome_and_keeps_what_belongs_to_them(
        tmp_path, monkeypatch, system):
    monkeypatch.setattr(host_browser.sys, "platform", system)
    monkeypatch.delenv("RAPHAEL_MAC_HEADED", raising=False)
    fake = machine(tmp_path, monkeypatch)
    browser = fake.browser
    old = fake.now
    old.cookies = [
        {"name": "sid", "value": "a", "domain": "app.example.test", "path": "/", "session": True, "size": 4, "expires": -1,
         "secure": True, "httpOnly": True, "sameSite": "Lax", "priority": "Medium", "sourceScheme": "Secure", "sourcePort": 443},
        {"name": "keep", "value": "b", "domain": "app.example.test", "path": "/", "session": False, "expires": 9e9},
    ]
    gate = fake.add("gate", 1, tmp_path, "chrome-error://chromewebdata/")
    gate.requested = "https://ef.example.test:8443/"
    other = fake.add("other", 2, tmp_path, "https://app.example.test/inbox")
    blank = fake.add("blank", 2, tmp_path, "about:blank", shown=False)
    gate.work, gate.turn_id, gate.conversation = (("turn", 1, 3), 2), 2, 3
    other.title = "Inbox"
    watcher = asyncio.Queue(maxsize=1)
    other.cast.watchers.add(watcher)
    browser.handback[1] = gate
    browser.held[2] = other
    gate.dialog = {"dialog_id": "x"}
    gate.refs["p:0"] = (1, {})
    ids = {tab.id: (tab.target, tab.session) for tab in browser.tabs.values()}
    closed = []
    for tab in (gate, other, blank):
        tab.closed.set = lambda tab=tab: closed.append(tab.id)

    await browser.show_for_owner(gate)
    new = fake.now
    assert len(fake.launches) == 2 and browser.cdp is new and browser.shown and new.shown
    assert old.closed and ("Browser.close", None, None) in old.calls
    # The same tabs, under the same ids: what refers to a tab (the viewer, the card, the owner's hold) still does.
    assert list(browser.tabs) == ["gate", "other", "blank"] and not closed
    assert browser.tabs["gate"] is gate and browser.tabs["other"] is other and browser.tabs["blank"] is blank
    assert browser.handback == {1: gate} and browser.held == {2: other}
    assert browser.current == {1: "gate", 2: "other"}
    assert all(browser.live(tab) and tab.ready for tab in (gate, other, blank))
    assert all((tab.target, tab.session) != ids[tab.id] for tab in (gate, other, blank))
    assert {tab.target: tab.member for tab in (gate, other, blank)} == browser.owned_targets
    # The tab that asked for the certificate is the one in the window Chrome started with; the others are made far off.
    assert gate.target == "startup-2"
    made = new.sent("Target.createTarget")
    assert len(made) == 2 and all(params["newWindow"] and params["background"] for params, _ in made)
    assert all(params["left"] == params["top"] == -32000 for params, _ in made)
    for tab in (gate, other, blank):
        enabled = [session for params, session in new.sent("Page.enable")]
        assert tab.session in enabled and tab.viewport == (1280, 900)
    assert gate.dialog is None and gate.refs == {} and gate.title == "" and other.title == "Inbox"
    assert gate.work == (("turn", 1, 3), 2) and gate.conversation == 3
    # A member's page is opened again where it was; the one that waited for the certificate where it was going.
    await asyncio.gather(*browser.background)
    opened = {session: params["url"] for params, session in new.sent("Page.navigate")}
    assert opened == {gate.session: "https://ef.example.test:8443/", other.session: "https://app.example.test/inbox"}
    # Session cookies were gone with the old Chrome; the profile keeps the others.
    cookies, _ = new.sent("Storage.setCookies")[0]
    assert [cookie["name"] for cookie in cookies["cookies"]] == ["sid"]
    assert not {"session", "size", "expires"} & cookies["cookies"][0].keys()
    # A watched tab is streamed again from the new page; the window the owner chooses in is in front.
    assert (other.session, True) in [(session, True) for params, session in new.sent("Page.startScreencast")]
    assert gate.session in [session for params, session in new.sent("Page.bringToFront")]
    # The old Chrome's last words, such as its targets going away, forget no tab.
    old.event("Target.targetDestroyed", {"targetId": "old-gate"}, None)
    old.event("Browser.disconnected", {}, None)
    assert browser.tabs["gate"] is gate and not gate.disconnected and not closed


async def test_chrome_asked_again_for_a_certificate_comes_to_the_front_instead_of_starting_again(tmp_path, monkeypatch):
    fake = machine(tmp_path, monkeypatch)
    browser = fake.browser
    gate = fake.add("gate", 1, tmp_path, "https://ef.example.test:8443/")
    await browser.show_for_owner(gate)
    assert len(fake.launches) == 2
    await browser.tuck_away(gate)
    gate.requested = "https://ef.example.test:8443/retry"
    await browser.show_for_owner(gate)
    await asyncio.gather(*browser.background)
    assert len(fake.launches) == 2 and browser.shown
    bounds = fake.now.sent("Browser.setWindowBounds")
    assert bounds[-1][0]["bounds"]["windowState"] == "normal" and bounds[-1][0]["bounds"]["left"] >= 0
    assert fake.now.sent("Page.navigate")[-1][0]["url"] == "https://ef.example.test:8443/retry"
    # A certificate the page asks for with nothing left to load needs no new navigation.
    gate.requested = ""
    count = len(fake.now.sent("Page.navigate"))
    await browser.show_for_owner(gate)
    await asyncio.gather(*browser.background)
    assert len(fake.now.sent("Page.navigate")) == count


@pytest.mark.parametrize(("system", "bounds"), [
    ("darwin", {"windowState": "minimized"}),
    ("win32", {"left": -32000, "top": -32000}),
])
async def test_once_the_owner_is_done_chrome_stays_but_is_out_of_the_way(tmp_path, monkeypatch, system, bounds):
    monkeypatch.setattr(host_browser.sys, "platform", system)
    fake = machine(tmp_path, monkeypatch)
    gate = fake.add("gate", 1, tmp_path, "https://ef.example.test:8443/")
    await fake.browser.show_for_owner(gate)
    await fake.browser.tuck_away(gate)
    window, = [params for params, session in fake.now.sent("Browser.setWindowBounds") if params["bounds"] != {
        "windowState": "normal", "left": 60, "top": 60}][-1:]
    assert window == {"windowId": 7, "bounds": bounds}
    assert fake.browser.shown and len(fake.launches) == 2
    # Chrome that is not shown has nothing to tuck away.
    await fake.browser._stop()
    assert not fake.browser.shown
    await fake.browser.tuck_away(gate)


async def test_chrome_goes_back_to_the_background_when_it_starts_again(tmp_path, monkeypatch):
    fake = machine(tmp_path, monkeypatch)
    browser = fake.browser
    gate = fake.add("gate", 1, tmp_path, "https://ef.example.test:8443/")
    await browser.show_for_owner(gate)
    assert browser.shown
    await browser._stop()
    assert not browser.shown and not browser.tabs
    await browser.start()
    assert not fake.now.shown


async def test_a_chrome_that_cannot_be_started_to_be_seen_leaves_no_half_bound_tab(tmp_path, monkeypatch):
    fake = machine(tmp_path, monkeypatch)
    browser = fake.browser
    gate = fake.add("gate", 1, tmp_path, "https://ef.example.test:8443/")
    other = fake.add("other", 2, tmp_path, "https://app.example.test/")
    fake.fail_next = True
    with pytest.raises(BrowserError, match="chrome_start_failed"):
        await browser.show_for_owner(gate)
    assert not browser.shown and browser.cdp is None and not browser.tabs and not browser.owned_targets
    assert gate.closed.is_set() and other.closed.is_set()


async def test_a_tab_another_action_still_holds_stops_the_relaunch_before_anything_changes(tmp_path, monkeypatch):
    monkeypatch.setattr(HostBrowser, "SWAP_WAIT_S", 0.05, raising=False)
    fake = machine(tmp_path, monkeypatch)
    browser = fake.browser
    gate = fake.add("gate", 1, tmp_path, "https://ef.example.test:8443/")
    other = fake.add("other", 2, tmp_path, "https://app.example.test/")
    async with other.lock:
        with pytest.raises(BrowserError, match="browser_tab_busy"):
            await browser.show_for_owner(gate)
    assert len(fake.launches) == 1 and not browser.shown and browser.cdp is fake.launches[0]
    assert not gate.lock.locked() and not other.lock.locked()
    assert browser.tabs == {"gate": gate, "other": other}


async def test_a_tab_the_owner_opened_while_chrome_changed_is_not_left_pointing_at_the_old_chrome(tmp_path, monkeypatch):
    fake = machine(tmp_path, monkeypatch)
    browser = fake.browser
    gate = fake.add("gate", 1, tmp_path, "https://ef.example.test:8443/")
    half = fake.add("half", 1, tmp_path, "about:blank", shown=False)
    half.ready = False  # still being attached when Chrome was stopped: its target is gone with the old Chrome
    await browser.show_for_owner(gate)
    assert list(browser.tabs) == ["gate"] and half.closed.is_set()


async def test_the_launch_a_mac_makes_to_be_seen_is_a_windowed_chrome_with_its_blank_tab(tmp_path, monkeypatch):
    if os.name == "nt":
        pytest.skip("Windows starts Chrome on a desktop (DesktopChrome)")
    monkeypatch.setattr(host_browser.sys, "platform", "darwin")
    monkeypatch.delenv("RAPHAEL_MAC_HEADED", raising=False)
    executable = tmp_path / "Google Chrome.app" / "Contents" / "MacOS" / "Google Chrome"
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"")
    monkeypatch.setattr(host_browser, "chrome_executable", lambda: executable)
    started, launched = [], host_browser.LaunchedChrome

    class Chrome(launched):
        # The Chrome made to be seen outlives the app, so it is a plain subprocess (`LaunchedChrome`), never an asyncio one.
        def __init__(self, argv):
            started.append(argv)
            super().__init__([sys.executable, "-c", "raise SystemExit(13)"])

    monkeypatch.setattr(host_browser, "LaunchedChrome", Chrome)
    browser = HostBrowser(tmp_path / "profile")
    browser.shown = True
    with pytest.raises(BrowserError, match="chrome_start_failed"):
        await browser.start()
    argv = started[0]
    assert "--headless=new" not in argv and not any(item.startswith(("--window-position", "--user-agent")) for item in argv)
    assert [item for item in argv[1:] if not item.startswith("--")][1:] == ["about:blank"]


@pytest.mark.skipif(os.name != "nt", reason="the Windows branch")
async def test_on_windows_the_chrome_made_to_be_seen_is_started_on_the_owners_desktop(tmp_path, monkeypatch):
    seen = []

    class Desktop:
        def __init__(self, argv, visible=False):
            seen.append(visible)
            self.pid, self.returncode = 1, 1

        def resume(self):
            pass

        def close(self):
            pass

        def kill(self):
            pass

        async def wait(self):
            return 1

    monkeypatch.setattr(host_browser, "DesktopChrome", Desktop)
    monkeypatch.setattr(host_browser, "ChromeProcessTree", lambda process: SimpleNamespace(close=lambda: asyncio.sleep(0)))
    monkeypatch.setattr(host_browser, "chrome_executable", lambda: tmp_path / "chrome.exe")
    for shown in (False, True):
        browser = HostBrowser(tmp_path / f"profile-{shown}")
        browser.shown = shown
        with pytest.raises(BrowserError, match="chrome_start_failed"):
            await browser.start()
    assert seen == [False, True]


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


def visible_windows(pid):
    """The windows of the process on the desktop the owner works on that are on the screen (Windows): shown, not minimized
    and not placed far off it."""
    import ctypes
    from ctypes import wintypes
    user = ctypes.WinDLL("user32")
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def each(window, _):
        owner = wintypes.DWORD()
        user.GetWindowThreadProcessId(window, ctypes.byref(owner))
        rect = wintypes.RECT()
        user.GetWindowRect(window, ctypes.byref(rect))
        if owner.value == pid and user.IsWindowVisible(window) and not user.IsIconic(window) and rect.left > -10000:
            found.append(window)
        return True

    user.EnumWindows(each, 0)
    return found


async def bounds_of(browser, tab):
    cdp = browser.cdp
    window = (await cdp.call("Browser.getWindowForTarget", {"targetId": tab.target}))["windowId"]
    return (await cdp.call("Browser.getWindowBounds", {"windowId": window}))["bounds"]


@NATIVE
async def test_native_chrome_shown_for_a_certificate_keeps_the_pages_and_the_session_and_goes_back_when_it_starts_anew(tmp_path):
    site = await asyncio.start_server(serve, "127.0.0.1", 0)
    base = f"http://localhost:{site.sockets[0].getsockname()[1]}"
    browser = HostBrowser(tmp_path / "profile")
    try:
        gate, _ = await browser.open_tab(1, tmp_path, 10)
        other = await browser.new_tab(2, tmp_path, 11)
        assert await host_page.navigate(browser, gate, base + "/gate")
        assert await host_page.navigate(browser, other, base + "/inbox")
        await host_page.evaluate(browser, other, "document.cookie = 'carried=1; path=/'")
        assert not browser.shown
        if os.name == "nt":
            assert not visible_windows(browser.process.pid)  # on a desktop of its own
        ids = (gate.id, other.id)
        await browser.show_for_owner(gate)
        assert browser.shown and (gate.id, other.id) == ids and browser.tabs[gate.id] is gate and browser.live(other)
        async with asyncio.timeout(15):
            while not (gate.url.endswith("/gate") and other.url.endswith("/inbox")):
                await asyncio.sleep(0.1)
        assert (await host_page.evaluate(browser, gate, "document.title"))[0] == "Staff area"
        assert "carried=1" in (await host_page.evaluate(browser, other, "document.cookie"))[0]
        assert (await bounds_of(browser, gate))["windowState"] == "normal" and (await bounds_of(browser, gate))["left"] > -1000
        assert (await bounds_of(browser, other))["left"] == -32000
        if os.name == "nt":
            assert visible_windows(browser.process.pid)  # the owner's own desktop
        shown_process = browser.process
        await browser.tuck_away(gate)
        bounds = await bounds_of(browser, gate)
        assert (bounds["windowState"] == "minimized") if sys.platform == "darwin" else (bounds["left"] == -32000)
        if os.name == "nt":
            assert not visible_windows(shown_process.pid)
        # Chrome stays the shown one, working: the pages of every member load as before.
        assert browser.shown and await host_page.navigate(browser, other, base + "/again")
        assert (await host_page.evaluate(browser, gate, "document.title"))[0] == "Staff area"
        await browser._stop()
        assert not browser.shown
        tab, started = await browser.open_tab(1, tmp_path, 10)
        assert started and not browser.shown
        if os.name == "nt":
            assert not visible_windows(browser.process.pid)
        assert await host_page.navigate(browser, tab, base + "/back")
    finally:
        await browser.aclose()
        site.close()

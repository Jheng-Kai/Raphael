"""A page that asks for a client certificate (#345). A Chrome no one sees cannot show its chooser, so for that step Raphael's
Chrome is started once more where the owner sees it, every member's tab bound to it again, and it stays so, out of the way
once the owner is done (the choice lives in that Chrome's memory), until Chrome would start again anyway."""

import asyncio
import contextlib
import json
import os
import sys
import time
from pathlib import Path
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
        # What Page.navigate answers: nothing yet (a page waiting for a certificate), or an error text, or a loaded page.
        self.navigation = None
        self.navigated = asyncio.Event()

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
        if method == "Page.navigate" and self.navigation is not None:
            self.navigated.set()
            return await self.navigation() if callable(self.navigation) else self.navigation
        return {}

    async def close(self):
        self.closed = True

    def sent(self, method):
        return [(params, session) for name, params, session in self.calls if name == method]


class Machine:
    """A HostBrowser whose Chrome is a fake: every start is a Launch."""

    def __init__(self, tmp_path, monkeypatch):
        self.browser = browser = HostBrowser(tmp_path / "profile")
        browser.profile.mkdir(parents=True, exist_ok=True)
        self.launches = []
        self.fail_next = False
        self.next_navigation = None  # what Page.navigate answers on the next Chrome that starts
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
        launch = self.begin()
        self.browser.startup_url = launch.startup_url
        if self.next_navigation is not None:
            launch.navigation, self.next_navigation = self.next_navigation, None
        # What a real start does before it launches Chrome (R-COMP-CERT-02).
        host_browser.write_auto_select(self.browser.profile, self.browser._auto_record()["origins"])
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
        if reason == "certificate":
            assert context["detail"] == "certificate_unmatched"  # the card says why Chrome could not choose by itself

    async def snapshot(*args):
        return {"tab_id": "original"}, []

    async def dispatch(*args, **kwargs):
        return {"owner_needed": reason}, []

    async def choose(chosen):
        order.append("auto")
        assert chosen is tab
        return "certificate_unmatched"

    monkeypatch.setattr(browser, "show_for_owner", show, raising=False)
    monkeypatch.setattr(browser, "tuck_away", tuck, raising=False)
    monkeypatch.setattr(browser, "sign_in_with_certificate", choose, raising=False)
    monkeypatch.setattr(host_page, "snapshot", snapshot)
    monkeypatch.setattr(tools, "page_call", dispatch)
    tools.cards = SimpleNamespace(wait_for_browser=wait)
    key = next(item.key for item in tools.offered(1) if item.name == "request_takeover")
    for reason, expected in (("certificate", ["auto", "show", "card", "tuck"]), ("sign_in", ["card"])):
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

    async def choose(chosen):
        return ""

    async def wait(**context):
        raise BrowserError("browser_handback_stopped")

    async def dispatch(*args, **kwargs):
        return {"owner_needed": "certificate"}, []

    monkeypatch.setattr(browser, "show_for_owner", show, raising=False)
    monkeypatch.setattr(browser, "tuck_away", tuck, raising=False)
    monkeypatch.setattr(browser, "sign_in_with_certificate", choose, raising=False)
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
    # A Mac puts a window placed far off back on its screen: each opens minimized there, with its size, never on the screen.
    assert all(params.get("windowState") == "minimized" and (params["width"], params["height"]) == (1280, 900)
               for params, _ in made) is (system == "darwin")
    assert all("windowState" not in params for params, _ in made) is (system != "darwin")
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
    # In two steps: a window brought back from where it was tucked is first a normal window, then placed.
    first, second = [params["bounds"] for params, _ in fake.now.sent("Browser.setWindowBounds")[-2:]]
    assert first == {"windowState": "normal"} and second["left"] >= 0 and second["top"] >= 0 and "windowState" not in second
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


# --- Chrome chooses the certificate by itself first (R-COMP-CERT-02) ---


@pytest.mark.parametrize(("url", "origin"), [
    ("https://ef.example.test/a?b=1", "https://ef.example.test:443"),
    ("https://EF.Example.test:8443/", "https://ef.example.test:8443"),
    ("https://[::1]:9000/", "https://[::1]:9000"),
    ("http://ef.example.test/", None),
    ("about:blank", None),
    ("chrome-error://chromewebdata/", None),
    ("https://user:secret@ef.example.test/", None),
    ("", None),
])
def test_the_origin_a_certificate_is_chosen_for_is_the_secure_origin_with_its_port(url, origin):
    assert host_browser.certificate_origin(url) == origin


def chosen(profile):
    preferences = json.loads((profile / "Default" / "Preferences").read_text(encoding="utf-8"))
    return preferences["profile"]["content_settings"]["exceptions"].get("auto_select_certificate")


def test_the_preferences_tell_chrome_which_origins_choose_their_certificate_and_keep_everything_else(tmp_path):
    profile = tmp_path / "profile"
    (profile / "Default").mkdir(parents=True)
    other = {"download": {"default_directory": "x"}, "profile": {"content_settings": {"exceptions": {"cookies": {"a,*": {}}}}}}
    (profile / "Default" / "Preferences").write_text(json.dumps(other), encoding="utf-8")
    assert host_browser.write_auto_select(profile, ["https://ef.example.test:8443", "https://app.example.test:443"])
    entries = chosen(profile)
    # The very shape Chrome stores and reads (`pattern,*` and the setting's own value: a filter with nothing in it matches
    # every certificate the site asks for), measured on a real Chrome on a Mac.
    assert set(entries) == {"https://ef.example.test:8443,*", "https://app.example.test:443,*"}
    assert all(item["setting"] == {"filters": [{}]} and item["last_modified"].isdigit() for item in entries.values())
    preferences = json.loads((profile / "Default" / "Preferences").read_text(encoding="utf-8"))
    assert preferences["download"] == other["download"]
    assert preferences["profile"]["content_settings"]["exceptions"]["cookies"] == {"a,*": {}}
    # Written again as it is, nothing changes (the time an exception was made stays); another list replaces the whole setting.
    stamp = entries["https://ef.example.test:8443,*"]["last_modified"]
    assert host_browser.write_auto_select(profile, ["https://ef.example.test:8443"])
    assert chosen(profile) == {"https://ef.example.test:8443,*": {"last_modified": stamp, "setting": {"filters": [{}]}}}
    assert host_browser.write_auto_select(profile, [])
    assert chosen(profile) is None
    assert json.loads((profile / "Default" / "Preferences").read_text(encoding="utf-8"))["download"] == other["download"]


def test_preferences_chrome_cannot_read_are_left_as_they_are_and_none_are_made_up_for_a_profile_without(tmp_path):
    profile = tmp_path / "profile"
    (profile / "Default").mkdir(parents=True)
    broken = profile / "Default" / "Preferences"
    broken.write_text("{not json", encoding="utf-8")
    assert not host_browser.write_auto_select(profile, ["https://ef.example.test:443"])
    assert broken.read_text(encoding="utf-8") == "{not json"
    fresh = tmp_path / "fresh"
    assert host_browser.write_auto_select(fresh, [])  # nothing to say: nothing is made
    assert not (fresh / "Default" / "Preferences").exists()
    assert host_browser.write_auto_select(fresh, ["https://ef.example.test:443"])
    assert set(chosen(fresh)) == {"https://ef.example.test:443,*"}


async def test_every_start_of_a_chrome_writes_the_recorded_origins_before_it_launches(tmp_path, monkeypatch):
    seen = []

    class Refused:
        def __init__(self, *args, **kwargs):
            raise RuntimeError("no Chrome here")

    async def launch(*args, **kwargs):
        raise RuntimeError("no Chrome here")

    monkeypatch.setattr(host_browser, "chrome_executable", lambda: tmp_path / "chrome")
    monkeypatch.setattr(host_browser, "DesktopChrome", Refused)
    monkeypatch.setattr(host_browser, "LaunchedChrome", Refused)
    monkeypatch.setattr(host_browser.asyncio, "create_subprocess_exec", launch)
    for shown in (False, True):
        browser = HostBrowser(tmp_path / f"profile-{shown}")
        browser.profile.mkdir(parents=True)
        browser._save_auto_record({"version": 1, "origins": ["https://ef.example.test:8443"], "told": False})
        browser.shown = shown
        with pytest.raises(RuntimeError):
            await browser.start()
        # Before the Chrome launched, and also for the one shown to the owner: its other origins still choose by themselves.
        assert set(chosen(browser.profile)) == {"https://ef.example.test:8443,*"}, shown
        seen.append(shown)
    assert seen == [False, True]


def tab_at(fake, tmp_path, url="https://ef.example.test:8443/", requested=""):
    gate = fake.add("gate", 1, tmp_path, url)
    gate.requested = requested
    return gate


async def test_chrome_chooses_the_certificate_by_itself_and_no_window_comes_to_the_screen(tmp_path, monkeypatch):
    monkeypatch.setattr(host_browser.sys, "platform", "darwin")
    monkeypatch.delenv("RAPHAEL_MAC_HEADED", raising=False)
    fake = machine(tmp_path, monkeypatch)
    browser = fake.browser
    old = fake.now
    gate = tab_at(fake, tmp_path, "chrome-error://chromewebdata/", requested="https://ef.example.test:8443/inbox")
    other = fake.add("other", 2, tmp_path, "https://app.example.test/inbox")
    seen = []

    async def loaded():
        seen.append(dict(browser.signing_in))  # what the view is told while the page loads
        return {"frameId": "f", "loaderId": "l"}

    fake.next_navigation = loaded
    assert await browser.sign_in_with_certificate(gate) is None
    new = fake.now
    # A Chrome of the background kind, started again with the origin written for it, every member's tab bound to it again.
    assert len(fake.launches) == 2 and not browser.shown and not new.shown and old.closed
    assert {pattern: item["setting"] for pattern, item in chosen(browser.profile).items()} == {
        "https://ef.example.test:8443,*": {"filters": [{}]}}
    assert browser._auto_record()["origins"] == ["https://ef.example.test:8443"]
    assert browser.tabs == {"gate": gate, "other": other} and all(browser.live(tab) and tab.ready for tab in (gate, other))
    assert gate.requested == "" and browser.handback == {}
    await asyncio.gather(*browser.background)
    opened = {session: params["url"] for params, session in new.sent("Page.navigate")}
    assert opened == {gate.session: "https://ef.example.test:8443/inbox", other.session: "https://app.example.test/inbox"}
    # No window comes to the owner's screen at any point: nothing is shown, brought to the front or made normal, and a Mac's
    # Chrome here is the headless one, which has none.
    assert not new.sent("Page.bringToFront") and not new.sent("Browser.setWindowBounds")
    assert not any("windowState" in params for params, _ in new.sent("Target.createTarget"))
    # While Chrome chooses, the view says so (the host, and what macOS may ask the first time); afterwards it says nothing.
    assert seen and all(item == {1: {"host": "ef.example.test", "keychain": True}} for item in seen) and browser.signing_in == {}


async def test_the_owner_is_told_what_the_keychain_may_ask_only_once(tmp_path, monkeypatch):
    fake = machine(tmp_path, monkeypatch)
    browser = fake.browser
    told = []
    browser.profile.mkdir(parents=True, exist_ok=True)
    for system in ("darwin", "darwin", "win32"):
        monkeypatch.setattr(host_browser.sys, "platform", system)
        told.append(browser._tell_keychain())
    assert told == [True, False, False]  # a Mac, once; Windows has no keychain prompt to explain
    browser._save_auto_record({**browser._auto_record(), "told": False})
    monkeypatch.setattr(host_browser.sys, "platform", "win32")
    assert browser._tell_keychain() is False and not browser._auto_record()["told"]


async def test_chrome_that_finds_no_certificate_to_choose_hands_the_choice_to_the_owner_and_tries_no_more_for_that_origin(
        tmp_path, monkeypatch):
    monkeypatch.setattr(host_browser, "AUTO_WAIT_S", 0.05)
    fake = machine(tmp_path, monkeypatch)
    browser = fake.browser
    gate = tab_at(fake, tmp_path, requested="https://ef.example.test:8443/")
    forever = asyncio.get_running_loop().create_future()
    fake.next_navigation = lambda: forever  # a page waiting for a certificate never answers
    assert await browser.sign_in_with_certificate(gate) == "certificate_unmatched"
    assert browser._auto_record()["origins"] == [] and browser.signing_in == {} and not browser.shown
    assert forever.cancelled()  # the navigation that waited is let go of
    # The owner's own step follows as before, in a Chrome shown to them.
    await browser.show_for_owner(gate)
    assert browser.shown and len(fake.launches) == 3
    assert chosen(browser.profile) is None  # the origin is not chosen for in the Chrome the owner chooses in


async def test_a_keychain_that_does_not_let_chrome_use_the_key_is_told_apart_from_no_certificate(tmp_path, monkeypatch):
    fake = machine(tmp_path, monkeypatch)
    browser = fake.browser
    gate = tab_at(fake, tmp_path, requested="https://ef.example.test:8443/")
    fake.next_navigation = {"errorText": "net::ERR_SSL_CLIENT_AUTH_SIGNATURE_FAILED"}
    assert await browser.sign_in_with_certificate(gate) == "certificate_refused"
    assert browser._auto_record()["origins"] == []
    fake.next_navigation = {"errorText": "net::ERR_SSL_CLIENT_AUTH_CERT_NEEDED"}
    assert await browser.sign_in_with_certificate(gate) == "certificate_unmatched"
    fake.next_navigation = {"errorText": "net::ERR_NAME_NOT_RESOLVED"}
    with pytest.raises(BrowserError, match="browser_navigation_failed"):
        await browser.sign_in_with_certificate(gate)  # a page that fails for another reason is not a certificate step
    assert browser._auto_record()["origins"] == [] and browser.signing_in == {}


async def test_an_origin_chosen_for_that_still_asks_goes_to_the_owner_at_once_and_may_be_tried_again_later(tmp_path, monkeypatch):
    fake = machine(tmp_path, monkeypatch)
    browser = fake.browser
    browser._save_auto_record({"version": 1, "origins": ["https://ef.example.test:8443", "https://other.example.test:443"], "told": True})
    gate = tab_at(fake, tmp_path, requested="https://ef.example.test:8443/")
    assert await browser.sign_in_with_certificate(gate) == "certificate_unmatched"
    assert len(fake.launches) == 1  # Chrome was not started again for nothing
    assert browser._auto_record()["origins"] == ["https://other.example.test:443"]  # other origins keep choosing by themselves


async def test_a_page_with_nothing_to_choose_for_or_a_chrome_the_owner_chose_in_is_left_to_the_owner(tmp_path, monkeypatch):
    fake = machine(tmp_path, monkeypatch)
    browser = fake.browser
    plain = tab_at(fake, tmp_path, "http://ef.example.test/", requested="http://ef.example.test/")
    assert await browser.sign_in_with_certificate(plain) == "" and len(fake.launches) == 1
    secure = fake.add("secure", 2, tmp_path, "https://ef.example.test:8443/")
    browser.shown = True  # a Chrome shown for a certificate keeps the choice the owner made in it
    assert await browser.sign_in_with_certificate(secure) == "" and len(fake.launches) == 1
    assert browser._auto_record()["origins"] == []


async def test_a_busy_tab_or_a_chrome_that_cannot_start_leaves_nothing_chosen_nor_half_bound(tmp_path, monkeypatch):
    monkeypatch.setattr(HostBrowser, "SWAP_WAIT_S", 0.05, raising=False)
    fake = machine(tmp_path, monkeypatch)
    browser = fake.browser
    gate = tab_at(fake, tmp_path, requested="https://ef.example.test:8443/")
    other = fake.add("other", 2, tmp_path, "https://app.example.test/")
    async with other.lock:
        with pytest.raises(BrowserError, match="browser_tab_busy"):
            await browser.sign_in_with_certificate(gate)
    assert len(fake.launches) == 1 and browser.tabs == {"gate": gate, "other": other}
    assert browser._auto_record()["origins"] == [] and browser.signing_in == {}
    fake.fail_next = True
    with pytest.raises(BrowserError, match="chrome_start_failed"):
        await browser.sign_in_with_certificate(gate)
    assert browser.cdp is None and not browser.tabs and not browser.owned_targets and browser._auto_record()["origins"] == []
    assert browser.signing_in == {} and gate.closed.is_set() and other.closed.is_set()


async def test_a_certificate_chosen_by_chrome_ends_the_step_with_no_card_and_no_window(tmp_path, conn, monkeypatch):
    tools = HostComputerTools(LocalVm(tmp_path, settings=SettingsStore(conn)), conn, BROWSER_OPEN)
    browser = tools.browser
    browser.cdp = SimpleNamespace(reader=asyncio.get_running_loop().create_future())
    tab = Tab("original", "target", "session", 1, tmp_path)
    browser.tabs[tab.id] = tab
    browser.select(tab)
    order = []

    async def choose(chosen):
        order.append("auto")
        return None

    async def show(shown):
        order.append("show")

    async def tuck(shown):
        order.append("tuck")

    async def wait(**context):
        order.append("card")

    async def snapshot(*args):
        order.append("snapshot")
        return {"tab_id": "original"}, []

    async def dispatch(*args, **kwargs):
        return {"owner_needed": "certificate"}, []

    monkeypatch.setattr(browser, "sign_in_with_certificate", choose, raising=False)
    monkeypatch.setattr(browser, "show_for_owner", show, raising=False)
    monkeypatch.setattr(browser, "tuck_away", tuck, raising=False)
    monkeypatch.setattr(host_page, "snapshot", snapshot)
    monkeypatch.setattr(tools, "page_call", dispatch)
    tools.cards = SimpleNamespace(wait_for_browser=wait)
    key = next(item.key for item in tools.offered(1) if item.name == "request_takeover")
    result = await tools.call(key, {"reason": "certificate"}, member=1, scope=("turn", 1, 3), turn_id=2, conversation_id=3,
                              private=True, approver="auto", language="en", announce=None)
    assert result.ok and order == ["auto", "snapshot"] and json.loads(result.text)["status"] == "certificate_chosen"
    assert browser.handback == {}  # nothing is left waiting for the owner


@pytest.mark.parametrize(("system", "shown", "state"), [
    ("darwin", True, "minimized"), ("darwin", False, None), ("win32", True, None), ("win32", False, None), ("linux", True, None)])
def test_a_member_window_is_never_on_a_macs_screen(monkeypatch, system, shown, state):
    monkeypatch.setattr(host_browser.sys, "platform", system)
    monkeypatch.delenv("RAPHAEL_MAC_HEADED", raising=False)
    window = host_browser.member_window(shown)
    assert window.get("windowState") == state
    if state:
        assert window["left"] == window["top"] == -32000 and (window["width"], window["height"]) == (1280, 900)


async def test_a_minimized_mac_window_is_not_brought_back_by_selecting_its_tab(tmp_path, monkeypatch):
    # Page.bringToFront on a minimized window puts it back on the screen (measured on a Mac).
    for system, fronted in (("darwin", False), ("win32", True)):
        monkeypatch.setattr(host_browser.sys, "platform", system)
        (tmp_path / system).mkdir()
        fake = machine(tmp_path / system, monkeypatch)
        fake.browser.shown = True
        tab = fake.add("tab", 1, tmp_path, "https://ef.example.test:8443/")
        await fake.browser.activate(tab)
        assert bool(fake.now.sent("Page.bringToFront")) is fronted, system


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


MTLS = os.environ.get("RAPHAEL_MTLS_FIXTURE")  # the file `mtls_fixture.py` wrote: a client certificate and the sites
MTLS_NATIVE = pytest.mark.skipif(sys.platform not in ("darwin", "win32") or not MTLS or host_browser.chrome_executable() is None,
                                 reason="needs a Mac or Windows throwaway machine with Chrome, a client certificate in its store "
                                        "and the sites of mtls_fixture.py (the workflow of the pull request)")


def onscreen_windows(pid):
    """The windows of the process that are on the Mac's screen (not minimized, not hidden), or None without Quartz."""
    try:
        import Quartz
    except ImportError:
        return None
    found = []
    for window in Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionAll, Quartz.kCGNullWindowID):
        box = window["kCGWindowBounds"]
        if (window.get("kCGWindowOwnerPID") == pid and window.get("kCGWindowLayer", 0) == 0 and window.get("kCGWindowIsOnscreen")
                and box["Width"] * box["Height"] >= 10000):
            found.append((int(box["X"]), int(box["Y"]), int(box["Width"]), int(box["Height"])))
    return found


@MTLS_NATIVE
async def test_native_chrome_chooses_a_client_certificate_by_itself_and_no_window_of_it_is_on_the_screen(tmp_path, monkeypatch):
    fixture = json.loads(Path(MTLS).read_text(encoding="utf-8"))
    monkeypatch.setattr(host_browser, "AUTO_WAIT_S", 10)
    answer = f"CLIENT-CN={fixture['common_name']}"
    browser = HostBrowser(tmp_path / "profile")
    waiting = "browser_navigation_waiting|browser_certificate_needed"  # a Chrome with nothing to offer may answer or wait

    async def page_text(tab):
        return ((await host_page.evaluate(browser, tab, "document.body.innerText"))[0] or "").strip()

    async def windows():
        await asyncio.sleep(1.5)  # a window takes a moment to show or to go
        if sys.platform == "win32":
            return visible_windows(browser.process.pid)  # the owner's desktop: the background Chrome has its own
        return onscreen_windows(browser.process.pid)

    try:
        tab, _ = await browser.open_tab(1, tmp_path, 10)
        other = await browser.new_tab(2, tmp_path, 11)
        # The background Chrome has no chooser: the page waits, as it does for a member.
        try:
            raw = await asyncio.wait_for(browser.command(tab, "Page.navigate", {"url": fixture["site"]}), 12)
        except TimeoutError:
            raw = "waits"
        print(f"RAW first navigation with no certificate chosen: {raw}", flush=True)
        with pytest.raises(BrowserError, match=waiting):
            await host_page.navigate(browser, tab, fixture["site"])
        assert tab.requested == fixture["site"]
        began = time.monotonic()
        assert await browser.sign_in_with_certificate(tab) is None
        print(f"TIMING auto sign-in (relaunch and load): {time.monotonic() - began:.1f} s", flush=True)
        assert not browser.shown and browser.live(other) and other.ready
        if sys.platform == "win32":
            assert isinstance(browser.process, host_browser.DesktopChrome)  # still the background Chrome, on a desktop of its own
        assert await page_text(tab) == answer
        if (found := await windows()) is not None:
            assert found == []
        # Chrome starting from nothing writes the noted origin before it launches: the page needs no step at all.
        await browser._stop()
        again, _ = await browser.open_tab(1, tmp_path, 10)
        began = time.monotonic()
        assert await host_page.navigate(browser, again, fixture["site"])
        print(f"TIMING restart and load with the noted origin: {time.monotonic() - began:.1f} s", flush=True)
        assert await page_text(again) == answer
        # A site whose authority none of the certificates here is issued by: nothing to choose, so the owner's step follows.
        began = time.monotonic()
        with pytest.raises(BrowserError, match=waiting):
            await host_page.navigate(browser, again, fixture["other"])
        print(f"TIMING a page with nothing to choose: {time.monotonic() - began:.1f} s", flush=True)
        assert await browser.sign_in_with_certificate(again) == "certificate_unmatched"
        await browser.show_for_owner(again)
        assert browser.shown
        if (found := await windows()) is not None:
            assert found, "the owner's window is on the screen"  # and Chrome's own chooser, which is a window of its own
        await browser.tuck_away(again)
        member = await browser.new_tab(2, tmp_path, 11)
        await browser.activate(member)
        await browser.activate(again)
        if (found := await windows()) is not None:
            # Nothing is on the screen after the owner is done, nor for a new member window or a selected one.
            assert found == [], f"windows on the screen: {found}"
    finally:
        await browser._stop()

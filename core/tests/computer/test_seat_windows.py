"""A seat is a desktop a person can use (owner, 2026-11-14, watching a member's screen): its windows come back from the
panel, the Browser icon is a dock's, no marker page stays on screen, members use tabs, and a window stays inside its
screen above the panel. The image's scripts are read and run here without Docker; the members' tools against fakes."""

import json
from pathlib import Path
import re
import subprocess
from types import ModuleType
from unittest.mock import AsyncMock

import pytest

from raphael_core.computer import vm as module
from raphael_core.computer.browser_tabs import BLANK, new_tab_of, rows, shown_tab
from .test_seat_tools import call, seat_tools, window  # noqa: F401
from .test_seat_wiring import shared_vm  # noqa: F401

IMAGE = Path(module.__file__).parent / "image"
LAYER = IMAGE / "layer12"


def load(name, path):
    """The image's script run from its text: an import would write bytecode into the image's build context, which every
    other test that reads that folder (and the image build) refuses (test_screens.py, test_computer_acceptance.py)."""
    found = ModuleType(name)
    found.__file__ = str(path)
    exec(compile(path.read_text(encoding="utf-8"), str(path), "exec"), found.__dict__)
    return found


screens = load("layer12_screens", LAYER / "screens.py")
tabs_helper = load("layer12_browser_tabs", LAYER / "raphael-browser-tabs")


def test_layer_twelve_is_the_last_step_and_writes_over_what_earlier_steps_installed():
    dockerfile = (IMAGE / "Dockerfile").read_text(encoding="utf-8")
    eleven, twelve = dockerfile.index("COPY layer11/"), dockerfile.index("COPY layer12/")
    assert eleven < twelve < dockerfile.index('org.raphael.computer.layer="12"')
    step = dockerfile[twelve:dockerfile.index("LABEL org.raphael.computer=")]
    for line in ("install -m 0755 /opt/raphael-layer12/raphael-seat-browser /usr/local/bin/raphael-seat-browser",
                 "install -m 0755 /opt/raphael-layer12/raphael-browser /usr/local/bin/raphael-browser",
                 "install -m 0755 /opt/raphael-layer12/raphael-browser-tabs /usr/local/bin/raphael-browser-tabs",
                 "install -m 0644 /opt/raphael-layer12/screens.py /opt/raphael-desktop/screens.py",
                 "/opt/raphael-layer12/xfce4-panel.xml /home/cua/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-panel.xml",
                 "rm -rf /opt/raphael-layer12"):
        assert line in step
    # Nothing before it changes, so a PC that built layer 11 runs this one step again.
    assert "COPY layer12/" not in dockerfile[:eleven] and dockerfile.count("COPY desktop/") == 1
    assert module.IMAGE.endswith("-v12") and module.IMAGE_LABELS[f"{module.LABEL}.layer"] == "12"
    for path in LAYER.iterdir():
        assert b"\r\n" not in path.read_bytes(), f"{path.name} must keep LF line ends inside Linux"


def test_every_panel_lists_its_own_screens_windows_with_icons_only():
    # Owner, 2026-11-14: he minimized his member's browser and could not find it again; the panel had no window list.
    options = dict((name, value) for name, _, value in screens.TASKLIST_OPTIONS)
    assert options["show-labels"] == "false" and options["include-all-monitors"] == "false"
    assert options["grouping"] == "false" and options["window-scrolling"] == "false" and options["middle-click"] == "0"
    for count in (1, 6):
        commands = {path: values for path, _, values in screens.panel_commands(count)}
        for panel in range(1, count + 1):
            assert commands[f"/panels/panel-{panel}/plugin-ids"] == [*map(str, range(panel * 3 - 2, panel * 3 + 1)), str(18 + panel)]
            assert commands[f"/plugins/plugin-{18 + panel}"] == ["tasklist"]
    # A computer of one screen has no helper-written panels: its panel is the image's own configuration file.
    panel = (LAYER / "xfce4-panel.xml").read_text(encoding="utf-8")
    assert re.search(r'<value type="int" value="1"/><value type="int" value="2"/><value type="int" value="3"/><value type="int" value="19"/>', panel)
    assert '<property name="plugin-19" type="string" value="tasklist">' in panel
    for name, kind, value in screens.TASKLIST_OPTIONS:
        assert f'<property name="{name}" type="{kind}" value="{value}"/>' in panel


def test_the_window_manager_draws_no_compositor_so_the_browser_draws_no_shadow(monkeypatch):
    # With one, a seat's browser window was maximized to 1312x893 with the panel over its page, 8 launches of 8.
    calls = []

    def command(args):
        calls.append(args)
        if args[-1] == "/general/use_compositing":
            return "true\n"
        return ""
    monkeypatch.setattr(screens, "command", command)
    screens.configure_compositor()
    assert calls[-1] == ["xfconf-query", "-c", "xfwm4", "-p", "/general/use_compositing", "-n", "-t", "bool", "-s", "false"]
    calls.clear()
    monkeypatch.setattr(screens, "command", lambda args: calls.append(args) or "false\n")
    screens.configure_compositor()
    assert len(calls) == 1  # already off: nothing written


STUCK = "_NET_WM_STATE(ATOM) = _NET_WM_STATE_MAXIMIZED_HORZ, _NET_WM_STATE_MAXIMIZED_VERT\n_GTK_FRAME_EXTENTS:  not found.\n"
SHADOWED = "_NET_WM_STATE(ATOM) = \n_GTK_FRAME_EXTENTS(CARDINAL) = 16, 16, 10, 32\n_NET_FRAME_EXTENTS(CARDINAL) = 0, 0, 0, 0\n"
DECORATED = "_NET_WM_STATE(ATOM) = \n_NET_FRAME_EXTENTS(CARDINAL) = 5, 5, 29, 5\n"


@pytest.mark.parametrize("place,properties,expected", [
    # The owner's picture of 2026-11-14, measured: maximized with the shadow's size kept, cut on three sides.
    ((2544, 890, 1312, 893), STUCK, "fill"),
    ((2560, 900, 1280, 851), STUCK, None),
    # Restored and dragged half onto the screen beside: what is seen of it is put back inside, its shadow aside.
    ((3200, 950, 1200, 780), SHADOWED, ("move", 2656, 950)),
    ((2544, 890, 1232, 800), SHADOWED, None),  # only the shadow is outside
    ((2544, 890, 1400, 1000), SHADOWED, "fill"),  # larger than the screen: filled
    ((3200, 950, 1200, 780), "_NET_WM_STATE(ATOM) = _NET_WM_STATE_HIDDEN\n", None),
    ((2560, 900, 1280, 900), "_NET_WM_STATE(ATOM) = _NET_WM_STATE_FULLSCREEN\n", None),
    # A decorated window is listed at its frame's corner plus twice its decoration (measured: frame at 0,0 listed at
    # 10,58), and is moved by its frame's corner: inside as listed here, and one 5 px over the next screen put back.
    ((2570, 958, 817, 483), DECORATED, None),
    ((3028, 1321, 817, 483), DECORATED, ("move", 3013, 1234)),
])
def test_what_is_seen_of_a_window_stays_inside_its_screen_above_the_panel(place, properties, expected):
    row = dict(zip(("x", "y", "width", "height"), place), id="0x1", **{"class": "google-chrome"})
    assert screens.placement(row, properties, (2560, 900, 1280, 851)) == expected


WINDOWS = """0x00a00028 -1 0    0    3840 1800 xfdesktop.Xfdesktop  host Desktop
0x00c00003 -1 567  851  194  49   xfce4-panel.Xfce4-panel  host xfce4-panel
0x00c00007 -1 1847 851  146  49   xfce4-panel.Xfce4-panel  host xfce4-panel
0x01e00003  0 -16  -10  1312 893  google-chrome (/home/cua/workspace/.browser-profiles/driver/main).Google-chrome  host X - Google Chrome
0x01e00005  0 700  100  1000 700  xfce4-terminal.Xfce4-terminal  host Terminal
"""


def test_a_window_is_put_back_only_after_two_looks_in_the_same_place(monkeypatch):
    calls, ran = [], []

    def command(args):
        calls.append(args)
        if args[0] == "wmctrl" and args[1] == "-lGx":
            return WINDOWS
        if args[0] == "xprop":
            return STUCK if args[2] == "0x01e00003" else "_NET_WM_STATE(ATOM) = \n_NET_FRAME_EXTENTS(CARDINAL) = 4, 4, 28, 4\n"
        return ""
    monkeypatch.setattr(screens, "command", command)
    monkeypatch.setattr(screens.subprocess, "run", lambda args, **kwargs: ran.append(args))
    rectangles = screens.grid(2)[0]
    looks = {}
    screens.keep_windows_inside(rectangles, looks)
    assert not ran and not [args for args in calls if args[0] == "xprop"]  # first look: it may still be moving
    screens.keep_windows_inside(rectangles, looks)
    # The browser maximizes its own window again; another window is moved back inside its screen, frame and all.
    assert ran == [["raphael-browser-tabs", "fit", "0x01e00003", "0", "0", "1280", "900"]]
    assert ["wmctrl", "-i", "-r", "0x01e00005", "-e", "0,272,44,-1,-1"] in calls
    # The panels and the desktop are never looked at as a person's windows.
    assert not [args for args in calls if args[0] == "xprop" and args[2] in ("0x00a00028", "0x00c00003", "0x00c00007")]


def test_the_seat_launcher_settles_its_marker_and_has_the_browser_place_its_window():
    launcher = (LAYER / "raphael-seat-browser").read_text(encoding="utf-8")
    found = launcher.index('[ -n "$new" ] || { echo "no browser window appeared')
    fit = launcher.index('raphael-browser-tabs fit "$new" "$x" "$y" "$width" "$height"')
    settle = launcher.index('raphael-browser-tabs settle "$new" "$marker" "$shows"')
    assert found < fit < settle < launcher.index('echo "pid=$main window_id=$((new))"')
    # The window manager's own sequence stays only as what is done when the browser cannot be asked.
    assert launcher.index("if ! raphael-browser-tabs fit") < launcher.index("-b add,maximized_vert,maximized_horz")


def test_the_browser_icon_is_a_docks_and_makes_a_window_only_where_there_is_none():
    icon = (LAYER / "raphael-browser").read_text(encoding="utf-8")
    shared = icon[:icon.index("# A computer of a member's own")]
    assert 'raphael-browser-tabs new "$window"' in shared and "/usr/local/bin/raphael-seat-browser" in shared
    assert shared.index('if [ -z "$window" ]; then') < shared.index("/usr/local/bin/raphael-seat-browser")
    assert "--new-window" not in shared and "firefox" not in icon.lower()


class Tools:
    """The browser's DevTools as raphael-browser-tabs uses it, with the answers measured on Chrome 157."""

    def __init__(self, pages, *, swap=0, lands=()):
        self.pages_list, self.swap, self.lands, self.calls = pages, swap, list(lands), []
        self.history = [{"url": "data:text/html,<title>raphael-seat-x</title>", "title": "raphael-seat-x"}]

    def pages(self):
        return [dict(page) for page in self.pages_list]

    def call(self, method, params=None, session=None):
        self.calls.append(method)
        if method == "Target.attachToTarget":
            return {"sessionId": f"s{self.calls.count(method)}"}
        if method == "Page.navigate":
            self.history.append({"url": "chrome://new-tab-page/", "title": "New Tab"})
            return {}
        if method == "Page.getNavigationHistory":
            if self.swap:
                self.swap -= 1
                raise tabs_helper.Failure("Page.getNavigationHistory: Not attached to an active page")
            return {"currentIndex": len(self.history) - 1, "entries": list(self.history)}
        if method == "Page.resetNavigationHistory":
            self.history = self.history[-1:]
            return {}
        if method == "Target.createTarget":
            return {"targetId": f"made-{self.calls.count(method)}"}
        if method == "Browser.getWindowForTarget":
            return {"windowId": self.lands.pop(0)}
        return {}


def test_the_marker_tab_leaves_its_page_and_back_does_not_lead_to_it(monkeypatch):
    # Measured: the tab moves to another process on its way to the new tab page, and a session attached before answers
    # "Not attached to an active page" for a moment.
    tools = Tools([{"target": "T", "title": "raphael-seat-x", "url": "data:...", "window": 7}], swap=2)
    monkeypatch.setattr(tabs_helper.time, "sleep", lambda seconds: None)
    assert tabs_helper.settle(tools, 0x1e00003, "raphael-seat-x", tabs_helper.NEW_TAB)["target"] == "T"
    assert tools.history == [{"url": "chrome://new-tab-page/", "title": "New Tab"}]
    assert tools.calls.count("Target.attachToTarget") == 3 and "Page.resetNavigationHistory" in tools.calls


def test_a_new_tab_that_opens_in_another_window_is_closed_and_opened_again(monkeypatch):
    # The browser opens a tab in the window brought to the front last; another seat's may be brought there between.
    tools = Tools([], lands=[99, 7])
    monkeypatch.setattr(tabs_helper, "browser_window", lambda tools, window: (7, [], {}))
    monkeypatch.setattr(tabs_helper, "activate", lambda window: True)
    monkeypatch.setattr(tabs_helper.time, "sleep", lambda seconds: None)
    assert tabs_helper.new_tab(tools, 0x1e00003, BLANK) == {"target": "made-2", "window": 7, "url": BLANK}
    assert tools.calls.count("Target.closeTarget") == 1


def test_a_window_is_found_by_its_screen_and_then_by_its_title(monkeypatch):
    found = dict(pid=1, x=1280, y=0, width=1280, height=851, title="Page B - Google Chrome", hidden=False)
    monkeypatch.setattr(tabs_helper, "x_window", lambda window: found)
    bounds = dict(left=1280, top=0, width=1280, height=851, windowState="maximized")
    pages = [dict(target="a", url="https://a/", title="Page A", window=1, bounds=bounds),
             dict(target="b", url="https://b/", title="Page B", window=2, bounds=bounds),
             dict(target="c", url="https://c/", title="Page C", window=3, bounds=dict(bounds, left=0))]
    tools = Tools(pages)
    assert tabs_helper.browser_window(tools, 5)[0] == 2
    found["title"] = "Nobody - Google Chrome"
    monkeypatch.setattr(tabs_helper, "activate", lambda window: True)
    tools.focused = lambda target: False
    with pytest.raises(tabs_helper.Failure, match="more than one window"):
        tabs_helper.browser_window(tools, 5)


def test_which_tab_is_shown_is_the_drivers_word_or_the_browsers_for_a_tab_with_no_twin():
    driver = [dict(tab_id="1", url="chrome://newtab/", title="New Tab", active=None),
              dict(tab_id="2", url="https://a/", title="A", active=None),
              dict(tab_id="3", url=BLANK, title="", active=True)]
    assert shown_tab(driver)["tab_id"] == "3" and new_tab_of(driver)["tab_id"] == "3"
    driver[2]["active"] = None
    listing = {"tabs": [dict(url="chrome://newtab/", title="New Tab", shown=True), dict(url="https://a/", title="A", shown=False),
                        dict(url=BLANK, title="", shown=False)]}
    assert [row["shown"] for row in rows(driver, listing)] == [True, False, False]
    driver.append(dict(tab_id="4", url="chrome://newtab/", title="New Tab", active=None))
    # Two new tab pages: which of the two is shown cannot be told, and nothing is guessed.
    assert [row["shown"] for row in rows(driver, listing)] == [None, False, False, None] and shown_tab(driver, listing) is None


def page_bridge(client, tabs, navigated):
    original = client.request

    async def request(method, params, **kwargs):
        name, args = params["name"], params["arguments"]
        if name == "get_browser_state" and "window_id" in args:
            client.calls.append((name, dict(args)))
            state = dict(target_id="bt-1", tabs=[dict(tab) for tab in tabs])
            return dict(content=[dict(type="text", text="bound")], structuredContent=state)
        if name == "browser_navigate":
            client.calls.append((name, dict(args)))
            navigated.append((args["tab_id"], args["url"]))
            return dict(content=[dict(type="text", text="navigated")], structuredContent={})
        if name == "get_browser_state":
            client.calls.append((name, dict(args)))
            state = dict(target_id="bt-1", tab_id=args["tab_id"], page=dict(url=navigated[-1][1], title="Opened"))
            return dict(content=[dict(type="text", text="page")], structuredContent=state)
        return await original(method, params, **kwargs)
    client.request = request


async def own_browser(vm, client, minimized=False):
    async def launch(target):
        raise AssertionError("a seat with a window of the browser gets no second one")
    row = window(50, 1320, "Google-chrome", 99)
    row["is_on_screen"] = not minimized
    client.rows.append(row)
    vm.seat_browser = launch
    return row


async def test_a_new_tab_is_opened_in_the_members_window_under_the_unit_lock_and_the_page_goes_to_it(seat_tools):
    hub, vm, _ = seat_tools
    client, _ = hub.connections[vm.target(2).key]
    await own_browser(vm, client)
    tabs = [dict(tab_id="old", url="https://owner.example/", title="Owner", active=False),
            dict(tab_id="new", url=BLANK, title="", active=True)]
    navigated = []
    page_bridge(client, tabs, navigated)

    async def helper(target, command, window_id, *args):
        assert vm.native_busy(target)
        return {"target": "T", "window": 7}
    vm.browser_tabs = AsyncMock(side_effect=helper)
    result = await call(hub, 2, "browser_open", dict(url="https://task.example/", new_tab=True))
    assert result.ok, result.text
    vm.browser_tabs.assert_awaited_once()
    assert vm.browser_tabs.await_args.args[1:] == ("new", 50, BLANK)
    assert navigated == [("new", "https://task.example/")]
    # The member is told what else the window holds, with ids it can use.
    assert '"tab_id": "old"' in result.text and '"shown": true' in result.text


async def test_a_page_goes_to_the_tab_shown_and_never_to_one_behind_it(seat_tools):
    hub, vm, _ = seat_tools
    client, _ = hub.connections[vm.target(2).key]
    await own_browser(vm, client)
    # The driver says nothing of which is shown among the browser's own pages; the browser says the second.
    tabs = [dict(tab_id="first", url="https://owner.example/", title="Owner", active=None),
            dict(tab_id="second", url="chrome://newtab/", title="New Tab", active=None)]
    navigated = []
    page_bridge(client, tabs, navigated)
    listing = {"tabs": [dict(url="https://owner.example/", title="Owner", shown=False), dict(url="chrome://newtab/", title="New Tab", shown=True)]}
    vm.browser_tabs = AsyncMock(return_value=listing)
    assert (await call(hub, 2, "browser_open", dict(url="https://task.example/"))).ok
    assert navigated == [("second", "https://task.example/")]
    # When which one is shown cannot be told at all, a new tab is shown rather than a page behind it replaced.
    tabs[:] = [dict(tab_id="a", url="chrome://newtab/", title="New Tab", active=None),
               dict(tab_id="b", url="chrome://newtab/", title="New Tab", active=None)]
    listing = {"tabs": [dict(url="chrome://newtab/", title="New Tab", shown=True), dict(url="chrome://newtab/", title="New Tab", shown=False)]}
    answers = [listing, {"target": "T", "window": 7}]

    async def helper(target, command, window_id, *args):
        if command == "new":
            tabs.append(dict(tab_id="c", url=BLANK, title="", active=True))
        return answers.pop(0)
    vm.browser_tabs = AsyncMock(side_effect=helper)
    navigated.clear()
    assert (await call(hub, 2, "browser_open", dict(url="https://task.example/"))).ok
    assert [args.args[1] for args in vm.browser_tabs.await_args_list] == ["list", "new"] and navigated == [("c", "https://task.example/")]


async def test_a_member_lists_its_tabs_and_brings_one_to_the_front(seat_tools):
    hub, vm, _ = seat_tools
    client, _ = hub.connections[vm.target(2).key]
    await own_browser(vm, client)
    tabs = [dict(tab_id="t1", url="https://owner.example/", title="Owner", active=False),
            dict(tab_id="t2", url="https://task.example/", title="Task", active=True)]
    page_bridge(client, tabs, [])
    vm.browser_tabs = AsyncMock(return_value={"tabs": []})
    listed = await call(hub, 2, "browser_tabs", {})
    state = json.loads(listed.text.splitlines()[-1])
    state.pop("elapsed_seconds", None)  # the core says how long a call took
    assert state == {"target_id": "bt-1", "tab_id": "t2", "tabs": [
        dict(tab_id="t1", title="Owner", url="https://owner.example/", shown=False),
        dict(tab_id="t2", title="Task", url="https://task.example/", shown=True)]}

    async def helper(target, command, window_id, *args):
        if command == "show":
            assert vm.native_busy(target) and args == ("https://owner.example/", "Owner")
            tabs[0]["active"], tabs[1]["active"] = True, False
        return {"tabs": []}
    vm.browser_tabs = AsyncMock(side_effect=helper)
    shown = json.loads((await call(hub, 2, "browser_tabs", dict(show="t1"))).text.splitlines()[-1])
    assert shown["tab_id"] == "t1"
    unknown = await call(hub, 2, "browser_tabs", dict(show="made-up"))
    assert not unknown.ok and "call browser_tabs" in unknown.text


async def test_a_minimized_window_is_brought_back_and_no_second_window_is_made(seat_tools):
    # Measured on layer 11: the minimized window stayed listed, a member's browser_open went on in it unseen, and the
    # Browser icon gave the owner a second window with the marker page.
    hub, vm, _ = seat_tools
    client, _ = hub.connections[vm.target(2).key]
    await own_browser(vm, client, minimized=True)
    page_bridge(client, [dict(tab_id="t", url="https://a/", title="A", active=True)], [])
    vm.restore_window = AsyncMock()
    assert (await call(hub, 2, "browser_open", dict(url="https://b.example/"))).ok
    vm.restore_window.assert_awaited_once_with(vm.target(2), 50)


async def test_the_image_helpers_are_called_as_commands_in_the_computer(shared_vm):
    vm, runtime = shared_vm
    target = await vm.seat(1)
    vm.run_for = AsyncMock(return_value=module.Result(0, '{"window": 7, "tabs": []}'))
    assert await vm.browser_tabs(target, "list", 50) == {"window": 7, "tabs": []}
    assert vm.run_for.await_args.args[1][-3:] == ["raphael-browser-tabs", "list", "50"]
    vm.run_for.return_value = module.Result(1, "", "raphael-browser-tabs: no window 0x32")
    with pytest.raises(module.VmError, match="browser_tabs_failed"):
        await vm.browser_tabs(target, "new", 50, BLANK)
    with pytest.raises(ValueError):
        await vm.browser_tabs(target, "settle", 50)
    vm.run_for.return_value = module.Result(0, "")
    await vm.restore_window(target, 50)
    assert vm.run_for.await_args.args[1][-4:] == ["wmctrl", "-i", "-a", "50"]

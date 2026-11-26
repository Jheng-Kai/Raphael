"""drag on Raphael Chrome (#337): a press, several moves and a release on the member's own tab from a ref or x,y to a
ref or x,y, so a page sees a real pointer drag (a slider) and, through Chrome's intercepted drag, a real HTML5 drag and
drop (dragstart, dragenter, dragover, drop). It passes the checks a click passes."""

import asyncio
import contextlib
import json
import os
import re
from types import SimpleNamespace

import pytest

from raphael_core.brain.settings import SettingsStore
from raphael_core.computer import host_page
from raphael_core.computer.host_browser import BrowserError, HostBrowser, Tab, chrome_executable
from raphael_core.computer.host_computer import VIEWPORT_TOOLS, WORDS, HostComputerTools
from raphael_core.computer.vm import LocalVm
from raphael_core.computer.vm_tools import BROWSER_OPEN

NATIVE = pytest.mark.skipif(chrome_executable() is None or bool(os.environ.get("CI")),
                            reason="Google Chrome is unavailable or this is CI")
ITEM = {"items": [{"mimeType": "text/plain", "data": "card"}], "dragOperationsMask": 1}


def drag_rig(tmp_path, monkeypatch, *, target=None, intercept_at=None, boxes=None):
    """A tab whose page checks pass and whose CDP commands are recorded. `target` is what the page has under the pointer
    (a function of the point or one answer), `intercept_at` the number of moves after which Chrome reports an intercepted
    HTML5 drag, `boxes` the centre each ref's element answers (by backend node id)."""
    browser = HostBrowser(tmp_path)
    tab = Tab("tab", "target", "session", 1, tmp_path)
    browser.tabs[tab.id] = tab
    sent, moves = [], 0

    async def evaluate(browser, tab, expression):
        if "elementFromPoint" in expression:
            point = json.loads(re.search(r"\)\((\[[^\]]*\]|null), (?:true|false)\)$", expression).group(1))
            answer = target(point) if callable(target) else target
            return (answer if answer is not None else {"name": "Page", "role": "div"}), 42
        return ("" if "querySelectorAll" in expression else True), 42

    async def command(tab, method, params=None):
        nonlocal moves
        sent.append((method, params))
        if method == "Input.dispatchMouseEvent" and params["type"] == "mouseMoved" and params.get("buttons") == 1:
            moves += 1
            if intercept_at is not None and moves == intercept_at:
                browser._event("Input.dragIntercepted", {"data": ITEM}, tab.session)
        if method == "DOM.resolveNode":
            return {"object": {"objectId": str(params["backendNodeId"])}}
        if method == "Runtime.callFunctionOn":
            return {"result": {"value": (boxes or {})[int(params["objectId"])]}}
        return {}

    monkeypatch.setattr(host_page, "evaluate", evaluate)
    browser.command = command
    browser.cdp = SimpleNamespace(socket=SimpleNamespace(port=12345))
    return browser, tab, sent


def kinds(sent, method="Input.dispatchMouseEvent"):
    return [params["type"] for name, params in sent if name == method]


async def drag(browser, tab, arguments, approver="auto"):
    return await host_page.drag(browser, tab, {"steps": 4, "duration_ms": 0, **arguments}, approver)


async def test_a_drag_presses_moves_and_releases_between_the_two_points(tmp_path, monkeypatch):
    browser, tab, sent = drag_rig(tmp_path, monkeypatch)
    result = await drag(browser, tab, {"from_x": 100, "from_y": 60, "to_x": 300, "to_y": 160})
    assert result["status"] == "delivered" and result["tab_id"] == tab.id
    mouse = [params for name, params in sent if name == "Input.dispatchMouseEvent"]
    assert [event["type"] for event in mouse] == ["mouseMoved", "mousePressed", *["mouseMoved"] * 4, "mouseReleased"]
    assert (mouse[1]["x"], mouse[1]["y"], mouse[1]["button"], mouse[1]["buttons"]) == (100, 60, "left", 1)
    assert [(event["x"], event["y"]) for event in mouse[2:6]] == [(150, 85), (200, 110), (250, 135), (300, 160)]
    assert all(event["buttons"] == 1 for event in mouse[2:6])
    assert (mouse[-1]["x"], mouse[-1]["y"], mouse[-1]["buttons"]) == (300, 160, 0)
    assert not [name for name, _ in sent if name == "Input.dispatchDragEvent"]


async def test_a_page_drag_that_starts_an_html5_drag_is_dropped_where_it_ends(tmp_path, monkeypatch):
    browser, tab, sent = drag_rig(tmp_path, monkeypatch, intercept_at=2)
    result = await drag(browser, tab, {"from_x": 100, "from_y": 60, "to_x": 300, "to_y": 160})
    assert result["status"] == "delivered" and result["drag"] == "html5"
    drops = [params for name, params in sent if name == "Input.dispatchDragEvent"]
    assert [event["type"] for event in drops] == ["dragEnter", "dragOver", "dragOver", "dragOver", "drop"]
    assert all(event["data"] == ITEM for event in drops)
    assert [(event["x"], event["y"]) for event in drops][-2:] == [(300, 160), (300, 160)]
    methods = [name for name, _ in sent if name in ("Input.setInterceptDrags", "Input.dispatchDragEvent")]
    assert methods[0] == "Input.setInterceptDrags" and methods[-1] == "Input.setInterceptDrags"
    assert [params["enabled"] for name, params in sent if name == "Input.setInterceptDrags"] == [True, False]
    assert kinds(sent)[-1] == "mouseReleased" and kinds(sent).count("mouseMoved") == 3
    assert tab.drag is None


async def test_a_drag_that_starts_no_html5_drag_reports_a_pointer_drag(tmp_path, monkeypatch):
    browser, tab, sent = drag_rig(tmp_path, monkeypatch)
    result = await drag(browser, tab, {"from_x": 100, "from_y": 60, "to_x": 300, "to_y": 60})
    assert result["drag"] == "pointer" and tab.drag is None
    assert [params["enabled"] for name, params in sent if name == "Input.setInterceptDrags"] == [True, False]


async def test_refs_name_the_start_and_the_end_by_the_centre_of_their_visible_element(tmp_path, monkeypatch):
    browser, tab, sent = drag_rig(tmp_path, monkeypatch, boxes={7: [160.0, 95.5], 8: [400.0, 200.0]})
    tab.refs["thumb"] = (7, {"name": "Volume", "role": "slider", "actions": ["drag"]})
    tab.refs["zone"] = (8, {"name": "Done", "role": "group", "actions": ["drag"]})
    result = await drag(browser, tab, {"ref": "thumb", "destination_ref": "zone"})
    assert result["status"] == "delivered" and not tab.refs
    mouse = [params for name, params in sent if name == "Input.dispatchMouseEvent"]
    assert (mouse[1]["type"], mouse[1]["x"], mouse[1]["y"]) == ("mousePressed", 160.0, 95.5)
    assert (mouse[-1]["type"], mouse[-1]["x"], mouse[-1]["y"]) == ("mouseReleased", 400.0, 200.0)


async def test_a_ref_may_start_the_drag_and_a_point_end_it(tmp_path, monkeypatch):
    browser, tab, sent = drag_rig(tmp_path, monkeypatch, boxes={7: [160.0, 95.0]})
    tab.refs["thumb"] = (7, {"name": "Volume", "role": "slider", "actions": ["drag"]})
    await drag(browser, tab, {"ref": "thumb", "to_x": 500, "to_y": 95})
    mouse = [params for name, params in sent if name == "Input.dispatchMouseEvent"]
    assert (mouse[1]["x"], mouse[-1]["x"]) == (160.0, 500)


@pytest.mark.parametrize("arguments", [
    {"from_x": 1, "from_y": 1}, {"to_x": 1, "to_y": 1}, {"from_x": 1, "to_x": 5, "to_y": 5},
    {"ref": "thumb", "from_x": 1, "from_y": 1, "to_x": 5, "to_y": 5},
    {"from_x": 1, "from_y": 1, "to_x": 5, "to_y": 5, "destination_ref": "thumb"},
])
async def test_a_drag_needs_one_start_and_one_end(tmp_path, monkeypatch, arguments):
    browser, tab, sent = drag_rig(tmp_path, monkeypatch)
    tab.refs["thumb"] = (7, {"name": "Volume", "role": "slider", "actions": ["drag"]})
    with pytest.raises(BrowserError, match="browser_drag_points"):
        await drag(browser, tab, arguments)
    assert not sent


@pytest.mark.parametrize(("start", "end"), [((-1, 5), (5, 5)), ((5, 5), (1280, 5)), ((5, 900), (5, 5))])
async def test_a_drag_outside_the_screenshot_is_refused(tmp_path, monkeypatch, start, end):
    browser, tab, sent = drag_rig(tmp_path, monkeypatch)
    with pytest.raises(BrowserError, match="browser_coordinates"):
        await drag(browser, tab, {"from_x": start[0], "from_y": start[1], "to_x": end[0], "to_y": end[1]})
    assert not sent


async def test_a_ref_that_is_gone_or_has_no_drag_is_answered_with_a_current_read(tmp_path, monkeypatch):
    browser, tab, sent = drag_rig(tmp_path, monkeypatch)
    tab.refs["field"] = (3, {"name": "Name", "role": "textbox", "actions": ["type", "click"]})
    for ref in ("missing", "field"):
        with pytest.raises(BrowserError, match="browser_current_ref_required"):
            await drag(browser, tab, {"ref": ref, "to_x": 5, "to_y": 5})
    assert not sent


async def test_an_element_outside_the_visible_page_asks_to_scroll_first(tmp_path, monkeypatch):
    browser, tab, sent = drag_rig(tmp_path, monkeypatch, boxes={7: None})
    tab.refs["thumb"] = (7, {"name": "Volume", "role": "slider", "actions": ["drag"]})
    with pytest.raises(BrowserError, match="browser_drag_offscreen"):
        await drag(browser, tab, {"ref": "thumb", "to_x": 5, "to_y": 5})
    assert "scroll" in WORDS["browser_drag_offscreen"].lower() and "Input.dispatchMouseEvent" not in [name for name, _ in sent]


async def test_a_ref_that_changed_is_never_dragged(tmp_path, monkeypatch):
    browser, tab, sent = drag_rig(tmp_path, monkeypatch, boxes={7: "browser_ref_changed"})
    tab.refs["thumb"] = (7, {"name": "Volume", "role": "slider", "actions": ["drag"]})
    with pytest.raises(BrowserError, match="browser_ref_changed"):
        await drag(browser, tab, {"ref": "thumb", "to_x": 5, "to_y": 5})
    assert "Input.dispatchMouseEvent" not in [name for name, _ in sent]


@pytest.mark.parametrize(("where", "target", "owner_needed", "error"), [
    ("start", {"name": "Card number", "role": "Edit", "editable": True}, "payment", ""),
    ("end", {"reason": "two_factor"}, "two_factor", ""),
    ("end", {"name": "Send message", "role": "button"}, "", "browser_owner_approval_required"),
    ("start", {"opaque": True}, "", "browser_action_refused"),
    ("end", {"file": True, "name": "Upload", "role": "Edit"}, "", "browser_action_refused"),
])
async def test_a_drag_is_checked_at_both_ends_as_a_click_is_before_anything_is_sent(
        tmp_path, monkeypatch, where, target, owner_needed, error):
    browser, tab, sent = drag_rig(tmp_path, monkeypatch, target=lambda point: target if point == [
        100 if where == "start" else 300, 60] else None)
    arguments = {"from_x": 100, "from_y": 60, "to_x": 300, "to_y": 60}
    if error:
        with pytest.raises(BrowserError, match=error):
            await drag(browser, tab, arguments)
    else:
        assert (await drag(browser, tab, arguments))["owner_needed"] == owner_needed
    assert not [name for name, _ in sent if name.startswith("Input.")]


async def test_the_owners_yes_lets_a_drop_on_a_sending_control_through(tmp_path, monkeypatch):
    browser, tab, sent = drag_rig(tmp_path, monkeypatch, target=lambda point: {"name": "Send message", "role": "button"}
                                  if point[0] == 300 else None)
    result = await drag(browser, tab, {"from_x": 100, "from_y": 60, "to_x": 300, "to_y": 60}, "user")
    assert result["status"] == "delivered"


async def test_a_private_page_is_left_to_the_owner_without_a_move(tmp_path, monkeypatch):
    browser, tab, sent = drag_rig(tmp_path, monkeypatch)

    async def evaluate(browser, tab, expression):
        return ("sign_in" if "querySelectorAll" in expression else True), 42

    monkeypatch.setattr(host_page, "evaluate", evaluate)
    result = await drag(browser, tab, {"from_x": 1, "from_y": 1, "to_x": 5, "to_y": 5})
    assert result["owner_needed"] == "sign_in" and not sent


async def test_a_drag_that_fails_midway_releases_the_pointer_and_stops_intercepting(tmp_path, monkeypatch):
    browser, tab, sent = drag_rig(tmp_path, monkeypatch)
    command = browser.command
    moves = 0

    async def failing(tab, method, params=None):
        nonlocal moves
        if method == "Input.dispatchMouseEvent" and params["type"] == "mouseMoved" and params.get("buttons") == 1:
            moves += 1
            if moves == 2:
                raise BrowserError("chrome_command_failed")
        return await command(tab, method, params)

    browser.command = failing
    with pytest.raises(BrowserError, match="chrome_command_failed"):
        await drag(browser, tab, {"from_x": 100, "from_y": 60, "to_x": 300, "to_y": 60})
    assert kinds(sent)[-1] == "mouseReleased"
    assert [params["enabled"] for name, params in sent if name == "Input.setInterceptDrags"] == [True, False]


def test_the_host_offers_one_drag_like_the_computers_own_with_refs_too(tmp_path, conn):
    description, fields, required = VIEWPORT_TOOLS["drag"]
    assert len(description) < 260 and required == ""
    tools = HostComputerTools(LocalVm(tmp_path, settings=SettingsStore(conn)), conn, BROWSER_OPEN)
    schema = tools.definitions["drag"]["parameters"]
    assert set(schema["properties"]) == {"ref", "destination_ref", "from_x", "from_y", "to_x", "to_y", "steps", "duration_ms",
                                          "modifier", "tab_id"}
    assert schema["additionalProperties"] is False and not schema.get("required")
    assert "1280" in schema["properties"]["from_x"]["description"]
    offered = {tool.name: tool for tool in tools.offered(1)}
    assert offered["drag"].tier.name == "T2"


async def test_a_dialog_that_blocks_the_tab_answers_the_drag_without_moving(tmp_path, conn):
    tools = HostComputerTools(LocalVm(tmp_path, settings=SettingsStore(conn)), conn, BROWSER_OPEN)
    browser = tools.browser
    browser.cdp = SimpleNamespace(reader=asyncio.get_running_loop().create_future())
    tab = Tab("tab", "target", "session", 1, tmp_path)
    browser.tabs[tab.id] = tab
    browser.owned_targets[tab.target] = 1
    browser.select(tab)
    tab.dialog = {"dialog_id": "d1", "type": "alert", "message": "Hello"}
    key = next(tool.key for tool in tools.offered(1) if tool.name == "drag")
    result = await tools.call(key, {"from_x": 1, "from_y": 1, "to_x": 5, "to_y": 5}, member=1, scope=("turn", 1, 3), turn_id=1,
                              conversation_id=3, private=True, approver="auto", language="en", announce=None)
    assert result.ok and json.loads(result.text)["status"] == "dialog_open"


PAGE = b"""<title>Drag</title>
<style>body {margin: 0} #track {position: absolute; left: 100px; top: 50px; width: 400px; height: 24px; background: #ccc}
#thumb {position: absolute; top: 0; width: 24px; height: 24px; background: #333; margin-left: -12px; left: 0}
#card {position: absolute; left: 100px; top: 150px; width: 120px; height: 40px; background: #9cf}
#zone {position: absolute; left: 400px; top: 150px; width: 200px; height: 100px; background: #fc9}</style>
<div id="track" role="slider" aria-label="Volume" aria-valuenow="0"><div id="thumb"></div></div>
<div id="card" draggable="true" role="listitem" aria-label="Card">Card</div>
<div id="zone" role="group" aria-label="Done">Drop here</div>
<script>
  const log = [];
  const set = (name, value) => document.body.dataset[name] = value;
  const track = document.getElementById('track'), thumb = document.getElementById('thumb');
  const place = event => {
    const box = track.getBoundingClientRect();
    const value = Math.round(Math.min(100, Math.max(0, (event.clientX - box.left) / box.width * 100)));
    thumb.style.left = value + '%'; set('volume', value);
  };
  track.addEventListener('pointerdown', event => { track.setPointerCapture(event.pointerId); track.dragging = true; place(event); });
  track.addEventListener('pointermove', event => { if (track.dragging) place(event); });
  track.addEventListener('pointerup', () => { track.dragging = false; set('released', 'yes'); });
  const card = document.getElementById('card'), zone = document.getElementById('zone');
  card.addEventListener('dragstart', event => { event.dataTransfer.setData('text/plain', 'card-1'); log.push('start'); set('events', log.join()); });
  zone.addEventListener('dragenter', event => { event.preventDefault(); log.push('enter'); set('events', log.join()); });
  zone.addEventListener('dragover', event => { event.preventDefault(); });
  zone.addEventListener('drop', event => { event.preventDefault(); log.push('drop'); set('events', log.join());
    set('dropped', event.dataTransfer.getData('text/plain')); });
</script>"""


async def serve(reader, writer):
    try:
        with contextlib.suppress(asyncio.IncompleteReadError, ConnectionError):
            await reader.readuntil(b"\r\n\r\n")
            writer.write(f"HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: text/html\r\n"
                         f"Content-Length: {len(PAGE)}\r\n\r\n".encode() + PAGE)
            await writer.drain()
    finally:
        writer.close()


@contextlib.asynccontextmanager
async def drag_page(tmp_path):
    browser = HostBrowser(tmp_path / "profile")
    site = await asyncio.start_server(serve, "127.0.0.1", 0)
    try:
        tab, _ = await browser.open_tab(1, tmp_path, 10)
        assert await host_page.navigate(browser, tab, f"http://127.0.0.1:{site.sockets[0].getsockname()[1]}/")
        yield browser, tab
    finally:
        await browser.aclose()
        site.close()


async def dataset(browser, tab, name):
    return (await host_page.evaluate(browser, tab, f"document.body.dataset.{name} || ''"))[0]


@NATIVE
async def test_native_chrome_drags_a_slider_and_drops_a_card_on_a_drop_zone(tmp_path):
    async with drag_page(tmp_path) as (browser, tab):
        state, _ = await HostComputerTools.page_call(browser, tab, "get_browser_state", {}, "user")
        assert {row["name"] for row in state["refs"] if "drag" in row["actions"]} >= {"Volume", "Card", "Done"}

        # A pointer drag: the thumb at the left end to three quarters of the track (x 400 of 100..500).
        slid, _ = await HostComputerTools.page_call(
            browser, tab, "drag", {"from_x": 100, "from_y": 62, "to_x": 400, "to_y": 62, "steps": 6, "duration_ms": 60}, "user")
        assert slid["status"] == "delivered" and slid["drag"] == "pointer"
        assert abs(int(await dataset(browser, tab, "volume")) - 75) <= 2
        assert await dataset(browser, tab, "released") == "yes"

        # An HTML5 drag from a ref to a ref.
        state, _ = await HostComputerTools.page_call(browser, tab, "get_browser_state", {}, "user")
        # A card with no role of its own is read as the text it holds: dragging that text drags the card.
        refs = {row["name"]: row["ref"] for row in state["refs"] if row["role"] in ("StaticText", "group")}
        dropped, _ = await HostComputerTools.page_call(
            browser, tab, "drag", {"ref": refs["Card"], "destination_ref": refs["Done"]}, "user")
        assert dropped["status"] == "delivered" and dropped["drag"] == "html5"
        events = (await dataset(browser, tab, "events")).split(",")
        assert events[0] == "start" and events[-1] == "drop" and "enter" in events
        assert await dataset(browser, tab, "dropped") == "card-1"

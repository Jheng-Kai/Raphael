"""press_key on Raphael Chrome (#342): a refused chord says why and what to use, Shift with a key that types no text is
delivered with Shift down, and Alt+Left / Alt+Right go back and forward in the member's own tab through Chrome's history."""

from types import SimpleNamespace

import pytest

from raphael_core.computer import host_page
from raphael_core.computer.host_browser import BrowserError, HostBrowser, Tab
from raphael_core.computer.host_computer import WORDS, HostComputerTools


def keyed_tab(tmp_path, monkeypatch, history=None):
    """A tab whose page checks pass and whose CDP commands are recorded; `history` is [urls, current index]."""
    browser = HostBrowser(tmp_path)
    tab = Tab("tab", "target", "session", 1, tmp_path)
    browser.tabs[tab.id] = tab
    sent = []
    state = {"urls": history[0], "at": history[1]} if history else None

    async def evaluate(browser, tab, expression):
        return ({"name": "Editor", "role": "Edit", "editable": True} if "elementFromPoint" in expression else ""), 42

    async def command(tab, method, params=None):
        sent.append((method, params))
        if method == "Page.getNavigationHistory":
            return {"currentIndex": state["at"], "entries": [{"id": 100 + n, "url": url} for n, url in enumerate(state["urls"])]}
        if method == "Page.navigateToHistoryEntry":
            state["at"] = params["entryId"] - 100
        return {}

    monkeypatch.setattr(host_page, "evaluate", evaluate)
    browser.command = command
    browser.cdp = SimpleNamespace(socket=SimpleNamespace(port=12345))
    return browser, tab, sent


async def press(browser, tab, key, modifiers=()):
    return await host_page.viewport_action(browser, tab, "press_key", {"key": key, "modifiers": list(modifiers)}, "auto")


async def test_shift_with_a_letter_is_refused_with_the_tool_to_use(tmp_path, monkeypatch):
    browser, tab, sent = keyed_tab(tmp_path, monkeypatch)
    with pytest.raises(BrowserError) as refused:
        await press(browser, tab, "a", ["shift"])
    assert str(refused.value) != "browser_action_refused"
    words = WORDS[str(refused.value)]
    assert "type_text" in words and not sent


@pytest.mark.parametrize(("key", "modifiers"), [("tab", ["shift"]), ("left", ["shift"]), ("end", ["shift", "ctrl"])])
async def test_shift_with_a_key_that_types_no_text_is_delivered_with_shift_down(tmp_path, monkeypatch, key, modifiers):
    browser, tab, sent = keyed_tab(tmp_path, monkeypatch)
    result = await press(browser, tab, key, modifiers)
    assert result["status"] == "delivered"
    keys = [params for method, params in sent if method == "Input.dispatchKeyEvent"]
    assert [event["type"] for event in keys] == ["rawKeyDown", "keyUp"]
    assert all(event["modifiers"] & 8 for event in keys)


@pytest.mark.parametrize(("key", "start", "end"), [("left", 1, 0), ("right", 0, 1)])
async def test_alt_arrows_move_through_the_tabs_own_history_and_send_no_page_keys(tmp_path, monkeypatch, key, start, end):
    urls = ["https://example.com/one", "https://example.com/two"]
    browser, tab, sent = keyed_tab(tmp_path, monkeypatch, [urls, start])
    tab.refs["old"] = object()
    result = await press(browser, tab, key, ["alt"])
    assert result["status"] == "delivered" and result["tab_id"] == tab.id and not tab.refs
    assert ("Page.navigateToHistoryEntry", {"entryId": 100 + end}) in sent
    assert not [method for method, _ in sent if method == "Input.dispatchKeyEvent"]


@pytest.mark.parametrize(("key", "start"), [("left", 0), ("right", 1)])
async def test_alt_arrow_at_the_end_of_history_says_there_is_no_page_to_go_to(tmp_path, monkeypatch, key, start):
    browser, tab, sent = keyed_tab(tmp_path, monkeypatch, [["https://example.com/one", "https://example.com/two"], start])
    result = await press(browser, tab, key, ["alt"])
    assert result["status"] == "no_history" and "note" in result
    assert not [method for method, _ in sent if method in ("Page.navigateToHistoryEntry", "Input.dispatchKeyEvent")]


async def test_history_never_leaves_the_pages_navigate_allows(tmp_path, monkeypatch):
    browser, tab, sent = keyed_tab(tmp_path, monkeypatch, [["file:///C:/private.txt", "https://example.com/two"], 1])
    with pytest.raises(BrowserError, match="browser_url"):
        await press(browser, tab, "left", ["alt"])
    assert not [method for method, _ in sent if method == "Page.navigateToHistoryEntry"]


def test_press_key_says_what_it_is_not_for():
    from raphael_core.computer.host_computer import VIEWPORT_TOOLS

    assert "type_text" in VIEWPORT_TOOLS["press_key"][0]

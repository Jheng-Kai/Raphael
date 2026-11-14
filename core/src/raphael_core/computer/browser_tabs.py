"""The tabs of a member's own browser window, as the members' tools offer them.

Owner, 2026-11-14, watching a member's screen: the members never open tabs, and every new site replaced what was on it.
The driver binds a window and lists its tabs, but opens and brings to the front none, and cannot say which tab a window
shows when the tabs are the browser's own pages (it answers `active: null` for a new tab page; measured on 0.37.0). The
computer's image does both through the browser's own DevTools port (`raphael-browser-tabs`, image layer 12). Which tab a
site goes to is the member's decision: nothing here names a site or a task.
"""

NEW_TAB = ("new_tab true opens it in a new tab of your window and shows that tab, leaving the others as they are: use it "
           "when the tab shown holds a page that is not this step's (the owner's, another task's, one you may come back "
           "to), as a person opens a tab for a new site. Otherwise the tab shown is reused. ")

BROWSER_TABS = {
    "description": "List the tabs of your browser window and which one is shown on your screen (what the owner sees), or "
                   "bring one to the front with show, as a person clicks a tab. Each tab's tab_id works with the target_id "
                   "it returns in the typed browser tools; open a page in a new tab with browser_open and new_tab.",
    "parameters": {"type": "object", "properties": {
        "show": {"type": "string", "minLength": 1, "maxLength": 200, "description": "A tab_id from this list or from browser_open."}},
        "additionalProperties": False}}

# What raphael-browser-tabs opens a member's new tab on: an empty page the driver can say is shown, then navigated.
BLANK = "about:blank"


def new_tab_of(tabs):
    """The tab raphael-browser-tabs has just opened and shown, in a driver's list of the window's tabs: the blank one the
    driver says is shown, or the only blank one."""
    blank = [tab for tab in tabs if tab.get("url") == BLANK]
    shown = [tab for tab in blank if tab.get("active") is True]
    found = shown if len(shown) == 1 else blank if len(blank) == 1 else []
    return found[0] if found else None


def rows(tabs, listing=None):
    """Each tab of a driver's list with whether the window shows it: the driver's word where it has one, else the
    browser's own (`listing`, from raphael-browser-tabs list) for a tab no other tab shares an address and title with;
    None when neither can tell."""
    found = []
    for tab in tabs:
        shown = tab.get("active") if isinstance(tab.get("active"), bool) else None
        key = (tab.get("url"), tab.get("title"))
        if shown is None and listing:
            same = [row for row in listing.get("tabs", []) if (row.get("url"), row.get("title")) == key]
            twins = [other for other in tabs if (other.get("url"), other.get("title")) == key]
            if len(same) == 1 and len(twins) == 1 and isinstance(same[0].get("shown"), bool):
                shown = same[0]["shown"]
        found.append({"tab_id": tab["tab_id"], "title": tab.get("title") or "", "url": tab.get("url") or "", "shown": shown})
    return found


def shown_tab(tabs, listing=None):
    """The one tab the window shows, or None when that cannot be told."""
    shown = [tab for tab, row in zip(tabs, rows(tabs, listing)) if row["shown"] is True]
    return shown[0] if len(shown) == 1 else None

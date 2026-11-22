"""Showing a browser page exercises the production tool and viewer selection."""

import asyncio
from types import SimpleNamespace

import pytest

from raphael_core.computer import host_page
from raphael_core.computer.host_browser import Tab
from raphael_core.computer.host_computer import HostComputerTools
from raphael_core.computer.vm_tools import BROWSER_OPEN
from raphael_core.evaluate.guardian import Budget
from raphael_core.evaluate.guardian_driver import RpcDriver

from test_guardian_scenarios import FakeClient


@pytest.mark.parametrize("question", [
    "Open YouTube so I can see it.",
    "Show me YouTube inside the app on this computer.",
])
async def test_showing_youtube_opens_the_live_host_panel_without_a_link_or_takeover(tmp_path, monkeypatch, question):
    url = "https://www.youtube.com/"
    answer = "YouTube is open in the Computer panel."

    class Client(FakeClient):
        async def chat_tools(self, **kwargs):
            messages = kwargs["messages"]
            replies = [message for message in messages if message["role"] == "tool"]
            if replies:
                assert "The owner can see this page in the app's Computer panel." in str(replies[-1]["content"])
                self.turns = iter([(answer, [])])
            else:
                assert "To show a page, open it and say where to look" in messages[0]["content"]
                definitions = [tool["function"] for tool in kwargs["tools"]]
                chrome_open = next(tool for tool in definitions if "your own background Chrome tab" in tool.get("description", ""))
                self.turns = iter([("", [(chrome_open["name"], {"url": url})])])
            return await super().chat_tools(**kwargs)

    driver = RpcDriver(tmp_path, "fake/model", Client([]), Budget(5))
    app = driver.app
    app.vm.enabled = True
    host = app.vm_tools.host_computer = HostComputerTools(app.vm, app._conn, BROWSER_OPEN)
    host.cards = app.handbacks
    app.desktop_viewer.active_transport = app.vm_tools.active_transport
    app.desktop_viewer.host_browser = host.browser
    member = app.members.store.create_member(name="Browser member")
    opened = []

    async def open_tab(scope, member_id, workspace, conversation, *, new):
        tab = Tab("page", "target", "cdp", scope, member_id, workspace, conversation=conversation)
        host.browser.tabs[tab.id] = tab
        host.browser.select(tab)
        return tab, True

    async def navigate(browser, tab, page):
        opened.append((tab.id, page))
        return True

    async def snapshot(browser, tab, arguments):
        return {"tab_id": tab.id, "page": {"url": url, "title": "YouTube"}}, []

    reader = asyncio.get_running_loop().create_future()
    host.browser.cdp = SimpleNamespace(reader=reader)
    monkeypatch.setattr(host.browser, "open_tab", open_tab)
    monkeypatch.setattr(host_page, "navigate", navigate)
    monkeypatch.setattr(host_page, "snapshot", snapshot)
    try:
        result = await driver.ask(question, member=member.id)
        assert opened == [("page", url)]
        assert result["text"] == answer
        assert len(driver.traces) == 1 and driver.traces[0]["outcome"] == "ok"
        tab = host.browser.tabs["page"]
        state = await app.call("computer.viewer_status", {"member_id": member.id, "conversation_id": tab.conversation})
        assert state["target"] == "page"
        assert state["works"][0]["turn_id"] == tab.turn_id
        assert "host_request" not in state
        assert not app._conn.execute("SELECT 1 FROM handback_cards").fetchone()
    finally:
        reader.cancel()
        host.browser.cdp = None
        await driver.aclose()

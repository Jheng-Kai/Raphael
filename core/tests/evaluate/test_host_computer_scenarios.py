"""Showing a browser page exercises the production tool and viewer selection."""

import asyncio
import json
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
    app.desktop_viewer.active_transport = lambda member, _: app.vm_tools.computer_mode(member)
    app.desktop_viewer.host_browser = host.browser
    member = app.members.store.create_member(name="Browser member")
    opened = []

    async def open_tab(member_id, workspace, conversation, *, new):
        tab = Tab("page", "target", "cdp", member_id, workspace, conversation=conversation)
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
        assert not app._conn.execute("SELECT 1 FROM computer_suggestions").fetchone()
    finally:
        reader.cancel()
        host.browser.cdp = None
        await driver.aclose()


async def test_member_checks_tabs_and_uses_the_page_the_owner_opened(tmp_path, monkeypatch):
    question = "I opened the seller chat in a new tab. Read the latest reply there."
    answer = "The seller says the parcel ships tomorrow."
    calls = []

    class Client(FakeClient):
        async def chat_tools(self, **kwargs):
            tools = {tool["function"]["name"]: tool["function"] for tool in kwargs["tools"]}
            list_tabs = next(name for name in tools if name.endswith("__browser_tabs"))
            read = next(name for name in tools if name.endswith("__get_browser_state"))
            assert "including tabs the owner opened" in tools[list_tabs]["description"]
            assert "check browser_tabs" in kwargs["messages"][0]["content"]
            replies = [message for message in kwargs["messages"] if message["role"] == "tool"]
            if not replies:
                self.turns = iter([("", [(list_tabs, {})])])
            elif len(replies) == 1:
                assert "seller-chat" in str(replies[-1]["content"])
                assert "other-member" not in str(replies[-1]["content"])
                self.turns = iter([("", [(read, {"tab_id": "seller-chat"})])])
            else:
                assert "The parcel ships tomorrow." in str(replies[-1]["content"])
                self.turns = iter([(answer, [])])
            return await super().chat_tools(**kwargs)

    driver = RpcDriver(tmp_path, "fake/model", Client([]), Budget(5))
    app = driver.app
    app.vm.enabled = True
    host = app.vm_tools.host_computer = HostComputerTools(app.vm, app._conn, BROWSER_OPEN)
    member = app.members.store.create_member(name="Browser member").id
    peer = app.members.store.create_member(name="Other member").id
    reader = asyncio.get_running_loop().create_future()
    host.browser.cdp = SimpleNamespace(reader=reader)
    for identifier, owner, title in (("product", member, "Product"), ("seller-chat", member, "Seller chat"),
                                      ("other-member", peer, "Private tab")):
        tab = Tab(identifier, f"target-{identifier}", f"session-{identifier}", owner, tmp_path, title=title)
        host.browser.tabs[identifier] = tab
        host.browser.owned_targets[tab.target] = owner
        host.browser.select(tab)

    async def snapshot(browser, tab, arguments):
        calls.append(tab.id)
        return {"tab_id": tab.id, "page": {"text": "The parcel ships tomorrow."}}, []

    async def unexpected(*args, **kwargs):
        pytest.fail("The member should reuse the owner's tab")

    monkeypatch.setattr(host_page, "snapshot", snapshot)
    monkeypatch.setattr(host.browser, "open_tab", unexpected)
    try:
        result = await driver.ask(question, member=member)
        assert result["text"] == answer and calls == ["seller-chat"]
        assert [trace["outcome"] for trace in driver.traces] == ["ok", "ok"]
    finally:
        reader.cancel()
        host.browser.cdp = None
        await driver.aclose()


@pytest.mark.parametrize("installed", [True, False])
async def test_installing_a_package_on_chrome_suggests_the_vm_and_waits_for_the_owner(tmp_path, monkeypatch, installed):
    question = "Install this npm package and run it."
    reason = "Installing and running an npm package requires a shell."
    offers = []

    class Client(FakeClient):
        async def chat_tools(self, **kwargs):
            definitions = {tool["function"]["name"] for tool in kwargs["tools"]}
            offers.append(definitions)
            if "computer__vm_exec" in definitions:
                assert "computer__suggest_computer" not in definitions
                assert "The owner switched this member to the virtual machine" in str(kwargs["messages"])
                assert question in str(kwargs["messages"])
                self.turns = iter([("I can continue in the virtual machine.", [])])
            elif any(message["role"] == "tool" for message in kwargs["messages"]):
                self.turns = iter([(reason, [])])
            else:
                assert "computer__suggest_computer" in definitions
                self.turns = iter([("", [("computer__suggest_computer", {"reason": reason})])])
            return await super().chat_tools(**kwargs)

    async def docker_installed():
        return installed

    async def never_start(*args, **kwargs):
        pytest.fail("Displaying a suggestion or choosing a VM must not start it")

    driver = RpcDriver(tmp_path, "fake/model", Client([]), Budget(8))
    app = driver.app
    app.vm.enabled = True
    app.vm_tools.host_computer = HostComputerTools(app.vm, app._conn, BROWSER_OPEN)
    monkeypatch.setattr(app.vm, "installed", docker_installed)
    monkeypatch.setattr(app.vm, "start", never_start)
    member = app.members.store.create_member(name="Browser member")
    try:
        original = await driver.ask(question, member=member.id)
        turn_id = original["turn_id"]
        assert original["text"] == reason and app.vm_tools.computer_mode(member.id) == "host"
        assert [(trace["name"], trace["outcome"]) for trace in driver.traces] == [("mcp:computer/suggest_computer", "ok")]
        assert app.vm_tools.suggestions.views([turn_id])[turn_id] == {"reason": reason, "installed": installed, "state": "pending"}
        action = await app.call("agent.computer_suggestion", {"turn_id": turn_id, "action": "switch" if installed else "setup"})
        if not installed:
            assert action == {"setup": True}
            assert app.vm_tools.computer_mode(member.id) == "host" and not app.vm_tools.suggestions.tasks
        else:
            assert action == {}
            await asyncio.wait_for(asyncio.gather(*app.vm_tools.suggestions.tasks), 5)
            assert app.vm_tools.computer_mode(member.id) == "docker"
            continued = app._conn.execute("SELECT question,text FROM agent_turns WHERE source_turn_id=?", (turn_id,)).fetchall()
            assert [tuple(row) for row in continued] == [(question, "I can continue in the virtual machine.")]
            assert await app.call("agent.computer_suggestion", {"turn_id": turn_id, "action": "switch"}) == {}
            assert not app.vm_tools.suggestions.tasks
            assert "computer__vm_exec" in offers[-1]
        assert await app.call("agent.computer_suggestion", {"turn_id": turn_id, "action": "dismiss"}) == {}
        assert not app.vm_tools.suggestions.views([turn_id])
    finally:
        await driver.aclose()


@pytest.mark.parametrize("command", ["npm install example", "python -m pip install openai-whisper", "ollama pull whisper"])
async def test_a_task_cannot_install_software_through_the_owners_local_commands(tmp_path, command):
    from raphael_core.agent.plugins import tool_key
    from raphael_core.computer.local_tools import LocalTools

    driver = RpcDriver(tmp_path, "fake/model", FakeClient([]), Budget(8))
    try:
        app = driver.app
        app.vm.enabled = True
        app.vm_tools.host_computer = HostComputerTools(app.vm, app._conn, BROWSER_OPEN)
        local = LocalTools(app.vm_tools, app._conn)
        result = await local.call(tool_key("local", "local_exec"), {"command": command}, approver="user")
        assert not result.ok and result.kind == "assigned_computer_required"
    finally:
        await driver.aclose()

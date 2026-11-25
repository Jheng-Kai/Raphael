"""The real loopback relay with fake CDP, plus the opt-in native Chrome journey."""

import asyncio
import base64
import json
import os
from contextlib import aclosing, asynccontextmanager, suppress
from time import perf_counter
from types import SimpleNamespace

import httpx
import pytest

from raphael_core.computer import host_page
from raphael_core.agent.history import AgentHistory
from raphael_core.computer.handback import HandbackCards
from raphael_core.computer.host_browser import ChromeProcessTree, HostBrowser, Tab, chrome_executable, headless_chrome
from raphael_core.computer.host_computer import HostComputerTools
from raphael_core.computer.host_view import Screencast
from raphael_core.computer.viewer import DesktopViewer
from raphael_core.computer.vm import LocalVm
from raphael_core.computer.vm_tools import BROWSER_OPEN
from raphael_core.protocol import RpcError

from .test_host_computer import serve


class Cdp:
    def __init__(self, browser):
        self.browser = browser
        self.calls = []
        self.reader = asyncio.get_running_loop().create_future()

    async def call(self, method, params=None, *, session=None):
        self.calls.append((method, params, session))
        if method == "Page.startScreencast":
            self.frame(session)
        elif method == "Target.attachToTarget":
            return {"sessionId": "cdp-" + params["targetId"]}
        elif method == "Target.createTarget":
            return {"targetId": f"new-{len(self.calls)}"}
        elif method == "Target.closeTarget":
            self.browser._event("Target.targetDestroyed", {"targetId": params["targetId"]}, None)
        elif method == "Page.getFrameTree":
            return {"frameTree": {"frame": {"id": session, "url": "about:blank"}}}
        elif method == "Page.navigate":
            return {}
        elif method == "Page.captureScreenshot":
            return {"data": base64.b64encode(session.encode()).decode()}
        elif method == "Page.getNavigationHistory":
            return {"currentIndex": 1, "entries": [{"id": 17}, {"id": 23}, {"id": 29}]}

    async def close(self):
        self.reader.cancel()

    def frame(self, session):
        self.browser._event("Page.screencastFrame", {
            "sessionId": 19, "data": base64.b64encode(session.encode()).decode(),
            "metadata": {"deviceWidth": 1280, "deviceHeight": 700},
        }, session)


def host_viewer(root):
    vm = LocalVm(root)
    viewer = DesktopViewer(vm)
    viewer.active_transport = lambda member, conversation: "host"
    viewer.host_browser = HostBrowser(root / "chrome")
    return viewer, viewer.host_browser


def fake_tab(browser, member, conversation, *, turn_id=None):
    identifier = str(member) if turn_id is None else str(turn_id)
    tab = Tab(identifier, identifier, "cdp-" + identifier, member, browser.profile,
              conversation=conversation, turn_id=turn_id)
    tab.cast = Screencast(browser, tab)
    browser.tabs[identifier] = tab
    browser.owned_targets[tab.target] = member
    browser.select(tab)
    return tab


async def expect_eventually(predicate):
    async with asyncio.timeout(5):
        while not predicate():
            await asyncio.sleep(0.01)


@asynccontextmanager
async def host_frames(client, base):
    async with client.stream("GET", base + "host-frames") as feed:
        assert feed.status_code == 200
        # Like the canvas page's reader, keep the iterator alive while sending control and input requests.
        # Finalizing a one-shot iterator closes the HTTP connection and releases the viewer's lease.
        async with aclosing(feed.aiter_lines()) as lines:
            yield lines


async def test_a_renewed_panel_follows_the_active_transport_for_its_conversation(tmp_path):
    viewer, browser = host_viewer(tmp_path)
    activity = {}
    viewer.active_transport = lambda member, conversation: activity.get((member, conversation))
    browser.cdp = Cdp(browser)
    params = {"member_id": 1, "conversation_id": 10}
    try:
        assert (await viewer.status(params))["transport"] == "idle"
        fake_tab(browser, 1, 10)
        activity[1, 10] = "host"
        opened = await viewer.open(params)
        assert (await viewer.status(params))["transport"] == "host"
        activity[1, 11] = "docker"
        assert (await viewer.renew(opened))["transport"] == "host"
        activity[1, 10] = "docker"
        async def missing():
            return False
        viewer.vm.installed = missing
        moved = await viewer.renew(opened)
        assert moved["transport"] == "docker" and moved["error"] == "docker_missing"
    finally:
        await viewer.aclose()


async def test_closed_host_tab_renews_to_quiet_idle_without_a_recovery_note(tmp_path):
    viewer, browser = host_viewer(tmp_path)
    browser.cdp = Cdp(browser)
    received = []

    async def note(*args):
        received.append(args)
        return True

    viewer.problem_note = note
    params = {"member_id": 1, "conversation_id": 10}
    report = {**params, "viewer_problem": "show the screen", "observed_transport": "host"}
    try:
        tab = fake_tab(browser, 1, 10)
        opened = await viewer.open(params)
        first = {**report, "observed_target": tab.id}
        await viewer.status(first)
        await viewer.status(first)
        assert received == [(1, 10, "host", "show the screen")]
        received.clear()

        browser._event("Target.targetDestroyed", {"targetId": tab.target}, None)
        idle = await viewer.renew(opened)
        assert idle["transport"] == "host" and idle["state"] == "absent" and "error" not in idle
        assert opened["session"] not in viewer.sessions
        assert await viewer.status(first) == idle
        assert received == []
    finally:
        await viewer.aclose()


async def test_shutdown_aborts_open_host_stream_and_unparsed_connection(tmp_path):
    viewer, browser = host_viewer(tmp_path)
    cdp = browser.cdp = Cdp(browser)
    tab = fake_tab(browser, 1, 10)
    opened = await viewer.open({"member_id": 1, "conversation_id": 10})
    reader, writer = await asyncio.open_connection("127.0.0.1", int(viewer.origin.rsplit(":", 1)[1]))
    try:
        async with httpx.AsyncClient(trust_env=False, timeout=2) as client:
            async with client.stream("GET", opened["url"].replace("host.html", "host-frames")) as feed:
                lines = feed.aiter_lines()
                await anext(lines)
                assert tab.cast.watchers and viewer.sessions
                await asyncio.wait_for(viewer.aclose(), 2)
                assert not viewer.relay.thread.is_alive()
                assert await reader.read() == b""
                assert not tab.cast.watchers
                assert any(method == "Page.stopScreencast" for method, _, _ in cdp.calls)
    finally:
        writer.close()
        await writer.wait_closed()


async def test_close_kills_profile_children_even_after_the_leader_exits(tmp_path):
    browser = HostBrowser(tmp_path)
    children = {101, 102}
    closed = []

    class Job:
        def empty(self):
            return not children

        def terminate(self):
            children.clear()

        def close(self):
            closed.append(True)

    async def exited():
        return 0

    process = SimpleNamespace(wait=exited, pid=100, returncode=0)
    tree = ChromeProcessTree.__new__(ChromeProcessTree)
    tree.process, tree.job = process, Job()
    browser.process, browser.process_tree = process, tree
    await asyncio.wait_for(browser.aclose(), 3)
    assert not children and closed == [True]


async def test_host_viewer_streams_only_watched_member_tabs_and_acks_every_frame(tmp_path):
    viewer, browser = host_viewer(tmp_path)
    cdp = browser.cdp = Cdp(browser)
    one, two = fake_tab(browser, 1, 10), fake_tab(browser, 2, 20)
    try:
        same_member = await viewer.status({"member_id": 1, "conversation_id": 11})
        assert same_member["state"] == "running" and same_member["target"] == one.view
        assert (await viewer.status({"member_id": 3, "conversation_id": 10}))["state"] == "absent"
        with pytest.raises(RpcError, match="desktop unavailable"):
            await viewer.open({"member_id": 3, "conversation_id": 10})
        with pytest.raises(RpcError, match="browser tab changed"):
            await viewer.open({"member_id": 1, "conversation_id": 11, "target_id": two.view})
        first = await viewer.open({"member_id": 1, "conversation_id": 11})
        second = await viewer.open({"member_id": 2, "conversation_id": 20})
        assert first["url"].endswith("/host.html")
        assert not cdp.calls
        cdp.frame(two.session)
        await expect_eventually(lambda: len(cdp.calls) == 1)
        assert cdp.calls == [("Page.screencastFrameAck", {"sessionId": 19}, two.session)]
        async with httpx.AsyncClient(trust_env=False, timeout=5) as client:
            assert (await client.get(first["url"])).status_code == 200
            assert (await client.get(first["url"].replace("host.html", "vnc.html"))).status_code == 403
            assert not one.cast.watchers
            async with host_frames(client, first["url"].removesuffix("host.html")) as lines:
                frame = json.loads(await anext(lines))
                assert base64.b64decode(frame["image"]).decode() == one.session
                assert not two.cast.watchers
                assert ("Page.screencastFrameAck", {"sessionId": 19}, one.session) in cdp.calls
            await expect_eventually(lambda: any(call[0] == "Page.stopScreencast" for call in cdp.calls))
            assert not one.cast.watchers and one.cast.latest is None
            async with client.stream("GET", second["url"].replace("host.html", "host-frames")) as feed:
                lines = feed.aiter_lines()
                assert base64.b64decode(json.loads(await anext(lines))["image"]).decode() == two.session
                browser._event("Target.targetDestroyed", {"targetId": two.target}, None)
                assert await anext(lines, None) is None
            assert one.id in browser.tabs
    finally:
        await viewer.aclose()


async def test_host_viewer_gate_and_handback_use_the_same_tab(tmp_path):
    viewer, browser = host_viewer(tmp_path)
    cdp = browser.cdp = Cdp(browser)
    tab = fake_tab(browser, 1, 10)
    card = SimpleNamespace(id="request", turn_id=23, reason="sign_in", note="")
    finished = []

    def finish(value):
        assert not browser.held and value is card
        finished.append(value)

    viewer.handbacks = SimpleNamespace(
        browser_request=lambda member, conversation: (tab, card) if (member, conversation) == (1, 10) and not finished else (None, None),
        finish=finish,
    )
    try:
        params = {"member_id": 1, "conversation_id": 10}
        assert (await viewer.status(params))["host_request"]["request_id"] == card.id
        with pytest.raises(RpcError, match="desktop unavailable"):
            await viewer.open({**params, "preview": True})
        opened = await viewer.open(params)
        owner = {"session": opened["session"], "takeover": card.id}
        session = viewer.sessions[opened["session"]]
        base = opened["url"].removesuffix("host.html")
        url = base + "host-input"
        async with httpx.AsyncClient(trust_env=False, timeout=5) as client:
            assert not session.sockets
            with pytest.raises(RpcError, match="desktop unavailable"):
                await viewer.control({**owner, "held": True})
            async with host_frames(client, base) as lines:
                await anext(lines)
                sockets = session.sockets.copy()
                assert len(sockets) == 1
                assert viewer.host_peers[next(iter(sockets))][1] is session
                assert (await viewer.control({**owner, "held": True}))["control"] == "owner"
                assert (await client.get(base + "control")).json() == {"held": True}
            # An actual disconnect drops input authority. Only an explicit Done can resume the request.
            await expect_eventually(lambda: not session.sockets and not viewer.owners)
            assert not finished and not browser.held
            async with host_frames(client, base) as lines:
                await anext(lines)
                text = {"type": "text", "text": "Sample", "target": tab.id}
                assert (await client.post(url, json=text, headers={"Origin": viewer.origin})).status_code == 403
                assert (await viewer.control({**owner, "held": True}))["control"] == "owner"
                assert (await client.get(base + "control")).json() == {"held": True}
                assert browser.held == {tab.member: tab}
                assert (await client.post(url, json=text, headers={"Origin": "http://example.invalid"})).status_code == 403
                events = [
                    {"type": "mousePressed", "x": 20, "y": 30, "button": "left", "buttons": 1, "count": 1},
                    {"type": "keyDown", "key": "Tab", "code": "Tab", "virtual": 9},
                    text,
                ]
                for event in events:
                    assert (await client.post(url, json={**event, "target": tab.id}, headers={"Origin": viewer.origin})).status_code == 204
                assert [call[0] for call in cdp.calls if call[0].startswith("Input.")] == [
                    "Input.dispatchMouseEvent", "Input.dispatchKeyEvent", "Input.insertText"]
                assert all(call[2] == tab.session for call in cdp.calls)
                with pytest.raises(RpcError, match="desktop request changed"):
                    await viewer.control({**owner, "held": False, "takeover": "old"})
                returned = await viewer.control({**owner, "held": False})
                assert returned["control"] == "member" and "host_request" not in returned
                assert finished == [card]
                assert session.sockets and (await client.get(base + "control")).json() == {"held": False}
                cdp.frame(tab.session)
                assert base64.b64decode(json.loads(await anext(lines))["image"]).decode() == tab.session
                assert [call[1]["type"] for call in cdp.calls if call[0].startswith("Input.dispatch")][-2:] == [
                    "keyUp", "mouseReleased"]
                assert (await client.post(url, json=text, headers={"Origin": viewer.origin})).status_code == 403
                with pytest.raises(RpcError, match="desktop request changed"):
                    await viewer.control({**owner, "held": False})
    finally:
        await viewer.aclose()


async def frame_for(lines, tab, size=None):
    async with asyncio.timeout(8):
        while True:
            frame = json.loads(await anext(lines))
            if frame["target"] == tab.id and (size is None or (frame["width"], frame["height"]) == size):
                return frame


async def test_idle_screencast_starts_and_restarts_with_a_screenshot(tmp_path):
    viewer, browser = host_viewer(tmp_path)
    cdp = browser.cdp = Cdp(browser)
    cdp.frame = lambda _session: None
    tab = fake_tab(browser, 1, 10)
    tab.viewport = (1280, 900)
    try:
        opened = await viewer.open({"member_id": 1, "conversation_id": 10})
        base = opened["url"].removesuffix("host.html")
        async with httpx.AsyncClient(trust_env=False, timeout=5) as client:
            for _ in range(2):
                async with host_frames(client, base) as lines:
                    async with asyncio.timeout(1):
                        await frame_for(lines, tab, (1280, 900))
                await expect_eventually(lambda: not tab.cast.watchers)
        assert [call[0] for call in cdp.calls].count("Page.captureScreenshot") == 2
    finally:
        await viewer.aclose()
        await browser.aclose()


async def test_host_browser_toolbar_follows_popups_without_replacing_the_lease(tmp_path, monkeypatch):
    async def snapshot(browser, tab, arguments):
        return {"tab_id": tab.id}, []

    monkeypatch.setattr("raphael_core.computer.host_page.snapshot", snapshot)
    viewer, browser = host_viewer(tmp_path)
    cdp = browser.cdp = Cdp(browser)
    cdp.socket = SimpleNamespace(port=12345)
    opener = fake_tab(browser, 1, 10)
    other = fake_tab(browser, 2, 20)
    params = {"member_id": 1, "conversation_id": 10}
    try:
        first = await viewer.open(params)
        base = first["url"].removesuffix("host.html")
        origin = {"Origin": viewer.origin}
        async with httpx.AsyncClient(trust_env=False, timeout=5) as client, host_frames(client, base) as lines:
            await frame_for(lines, opener)

            async def action(name, tab, **values):
                return await client.post(base + "host-browser", json={"action": name, "tab": tab.id, **values}, headers=origin)

            assert (await action("select", other)).status_code == 403
            assert (await action("navigate", opener, url="https://example.test")).status_code == 204
            assert ("Page.navigate", {"url": "https://example.test"}, opener.session) in cdp.calls
            assert (await action("back", opener)).status_code == 204
            assert (await action("forward", opener)).status_code == 204
            assert (await action("reload", opener)).status_code == 204
            assert not browser.held
            browser._event("Target.targetCreated", {"targetInfo": {
                "type": "page", "targetId": "popup", "openerId": opener.target, "title": "Sign-in", "url": "about:blank",
            }}, None)
            await browser.wait_popups(opener.member)
            popup = browser.tab(opener.member)
            assert popup.opener is opener and popup is not opener
            await frame_for(lines, popup)
            assert popup.viewport == (1280, 900)
            model = (await client.get(base + "host-browser")).json()
            assert model["shown"] == popup.id and [tab["id"] for tab in model["tabs"]] == [opener.id, popup.id]
            assert model["tabs"][1]["title"] == "Sign-in"
            tool_view, _, _, _ = await HostComputerTools.browser_call(
                SimpleNamespace(browser=browser), "browser_tabs", {}, "auto", 1, (("turn", 1, 10), 42), 10, None)
            assert [(tab["tab_id"], tab["shown"]) for tab in tool_view["tabs"]] == [(opener.id, False), (popup.id, True)]
            assert (await viewer.renew(first))["target"] == opener.view

            assert (await action("select", opener)).status_code == 204
            await frame_for(lines, opener)
            assert browser.selected(opener.member) is opener
            assert (await viewer.renew(first))["control"] == "member"
            assert not any(call[0] == "Page.bringToFront" for call in cdp.calls)
            assert (await action("select", popup)).status_code == 204
            await frame_for(lines, popup)

            assert (await viewer.control({**first, "held": True}))["control"] == "owner"
            assert (await action("select", opener)).status_code == 204
            await frame_for(lines, opener)
            assert browser.selected(opener.member) is opener
            assert ("Page.bringToFront", None, opener.session) in cdp.calls
            assert (await action("select", popup)).status_code == 204
            await frame_for(lines, popup)
            for target, expected in ((opener.id, 403), (other.id, 403), (popup.id, 204)):
                response = await client.post(base + "host-input", json={"type": "text", "text": "Code", "target": target}, headers=origin)
                assert response.status_code == expected
            assert ("Input.insertText", {"text": "Code"}, popup.session) in cdp.calls
            assert (await action("navigate", popup, url="file:///private")).status_code == 403
            assert (await action("navigate", popup, url="http://127.0.0.1:12345")).status_code == 403
            assert (await action("navigate", popup, url="https://example.test")).status_code == 204
            assert ("Page.navigate", {"url": "https://example.test"}, popup.session) in cdp.calls
            assert (await action("back", popup)).status_code == 204
            assert (await action("forward", popup)).status_code == 204
            assert ("Page.navigateToHistoryEntry", {"entryId": 17}, popup.session) in cdp.calls
            assert ("Page.navigateToHistoryEntry", {"entryId": 29}, popup.session) in cdp.calls
            assert (await action("reload", popup)).status_code == 204
            assert ("Page.reload", None, popup.session) in cdp.calls
            assert (await action("close", other)).status_code == 403
            assert (await action("close", popup)).status_code == 204
            await frame_for(lines, opener)
            assert browser.tab(opener.member) is opener and (await viewer.renew(first))["control"] == "owner"
            assert (await action("new", opener)).status_code == 204
            new = browser.tab(opener.member)
            await frame_for(lines, new)
            assert new is not opener and new.view == opener.view
            assert ("Page.navigate", {"url": "https://www.google.com/"}, new.session) in cdp.calls
            assert (await viewer.control({**first, "held": False}))["control"] == "member"
            tool_view, _, _, _ = await HostComputerTools.browser_call(
                SimpleNamespace(browser=browser), "browser_tabs", {}, "auto", 1, (("task", 7), 43), 10, None)
            assert [(row["tab_id"], row["shown"]) for row in tool_view["tabs"]] == [(opener.id, False), (new.id, True)]
            assert browser.tab(opener.member) is new and other.id in browser.tabs
            assert (await action("close", new)).status_code == 204
            await frame_for(lines, opener)
            assert (await viewer.renew(first))["control"] == "member"
            tool_view, _, _, _ = await HostComputerTools.browser_call(
                SimpleNamespace(browser=browser), "browser_tabs", {}, "auto", 1, (("task", 7), 43), 10, None)
            assert [(row["tab_id"], row["shown"]) for row in tool_view["tabs"]] == [(opener.id, True)]
            recovery, _, tab, _ = await HostComputerTools.browser_call(
                SimpleNamespace(browser=browser), "click", {"tab_id": new.id, "x": 10, "y": 10},
                "auto", 1, (("task", 7), 43), 10, None)
            assert recovery["status"] == "tab_closed" and tab is opener
            assert not any(method == "Input.dispatchMouseEvent" for method, _, _ in cdp.calls)
            assert (await action("new", opener)).status_code == 204
            watched = browser.selected(opener.member)
            assert watched is not opener and not browser.held
            await frame_for(lines, watched)
    finally:
        await viewer.aclose()
        await browser.aclose()


async def test_host_toolbar_navigation_does_not_block_another_members_control(tmp_path):
    viewer, browser = host_viewer(tmp_path)
    cdp = browser.cdp = Cdp(browser)
    cdp.socket = SimpleNamespace(port=12345)
    first_tab = fake_tab(browser, 1, 10)
    second_tab = fake_tab(browser, 2, 20)
    navigating, finish = asyncio.Event(), asyncio.Event()
    call = cdp.call

    async def delay_navigation(method, params=None, *, session=None):
        if method == "Page.navigate" and session == first_tab.session:
            navigating.set()
            await finish.wait()
        return await call(method, params, session=session)

    cdp.call = delay_navigation
    try:
        first = await viewer.open({"member_id": 1, "conversation_id": 10})
        second = await viewer.open({"member_id": 2, "conversation_id": 20})
        first_base = first["url"].removesuffix("host.html")
        second_base = second["url"].removesuffix("host.html")
        async with (httpx.AsyncClient(trust_env=False, timeout=5) as client,
                    host_frames(client, first_base) as first_lines, host_frames(client, second_base) as second_lines):
            await frame_for(first_lines, first_tab)
            await frame_for(second_lines, second_tab)
            await viewer.control({**first, "held": True})
            request = asyncio.create_task(client.post(first_base + "host-browser", headers={"Origin": viewer.origin},
                json={"action": "navigate", "tab": first_tab.id, "url": "https://example.test"}))
            try:
                async with asyncio.timeout(2):
                    await navigating.wait()
                    assert (await viewer.control({**second, "held": True}))["control"] == "owner"
                    result = await client.post(second_base + "host-input", headers={"Origin": viewer.origin},
                        json={"type": "text", "text": "Second member", "target": second_tab.id})
                    assert result.status_code == 204
                    assert ("Input.insertText", {"text": "Second member"}, second_tab.session) in cdp.calls
            finally:
                finish.set()
                response = await request
            assert response.status_code == 204
    finally:
        await viewer.aclose()
        await browser.aclose()


async def test_popup_can_close_before_done_without_ending_its_handback(tmp_path, conn):
    viewer, browser = host_viewer(tmp_path)
    browser.cdp = Cdp(browser)
    cards = viewer.handbacks = HandbackCards(conn, None)
    turn_id = AgentHistory(conn).add(session_id="popup-handback", question="Sign in", route="answer",
                                     prefix="", text="", status="running", source="app", member_id=0)
    opener = fake_tab(browser, 0, 10, turn_id=turn_id)
    browser._event("Target.targetCreated", {"targetInfo": {
        "type": "page", "targetId": "popup", "openerId": opener.target,
    }}, None)
    await browser.wait_popups(opener.member)
    popup = browser.selected(opener.member)
    assert popup is not opener
    waiting = asyncio.create_task(cards.wait_for_browser(
        turn_id=turn_id, member_id=0, conversation_id=10, reason="sign_in", language="en", tab=popup, browser=browser))
    try:
        await expect_eventually(lambda: cards.browser_request(0, 10)[0] is popup)
        card = cards.browser_request(0, 10)[1]
        opened = await viewer.open({"member_id": 0, "conversation_id": 10})
        base = opened["url"].removesuffix("host.html")
        control = {**opened, "takeover": card.id}
        async with httpx.AsyncClient(trust_env=False, timeout=5) as client, host_frames(client, base) as lines:
            await frame_for(lines, popup)
            assert (await viewer.control({**control, "held": True}))["control"] == "owner"
            browser._event("Target.targetDestroyed", {"targetId": popup.target}, None)
            await frame_for(lines, opener)
            assert not waiting.done()
            renewed = await viewer.renew(opened)
            assert renewed["host_request"]["request_id"] == card.id and renewed["control"] == "owner"
            assert "host_request" not in (await viewer.control({**control, "held": False}))
            await asyncio.wait_for(waiting, 5)
            assert cards.store.get(card.id).state == "done"
            assert browser.tab(opener.member) is opener and not browser.held
    finally:
        waiting.cancel()
        await asyncio.gather(waiting, return_exceptions=True)
        await viewer.aclose()
        await browser.aclose()


async def test_host_live_card_and_panel_bind_the_same_tab_and_follow_its_replacement(tmp_path):
    viewer, browser = host_viewer(tmp_path)
    browser.cdp = Cdp(browser)
    params = {"member_id": 1, "conversation_id": 10}
    first = fake_tab(browser, 1, 10, turn_id=21)
    try:
        status = await viewer.status(params)
        assert status["works"][0]["turn_id"] == 21 and status["works"][0]["state"] == "running"
        binding = {**params, "transport": "host", "target_id": status["target"]}
        one, two = await viewer.open(binding), await viewer.open(binding)
        assert viewer.sessions[one["session"]].host_tab is viewer.sessions[two["session"]].host_tab is first
        first.finished = True
        assert (await viewer.renew(one))["works"][0]["state"] == "done"
        current = fake_tab(browser, 1, 10, turn_id=22)
        assert (await viewer.renew(one))["target"] == current.id
        with pytest.raises(RpcError, match="browser tab changed"):
            await viewer.open(binding)
    finally:
        await viewer.aclose()


@pytest.mark.skipif(chrome_executable() is None or bool(os.environ.get("CI")), reason="Google Chrome is unavailable or this is CI")
async def test_native_chrome_sign_in_handback_releases_input_and_resumes_same_tab(tmp_path, conn):
    viewer, _ = host_viewer(tmp_path.resolve())
    tools = HostComputerTools(viewer.vm, conn, BROWSER_OPEN)
    viewer.host_browser = browser = tools.browser
    viewer.handbacks = tools.cards = HandbackCards(conn, None)
    turn_id = AgentHistory(conn).add(session_id="native-host", question="Open the sign-in page", route="answer",
                                     prefix="", text="", status="running", source="app", member_id=0)
    params = {"member_id": 0, "conversation_id": 10}
    keys = {tool.name: tool.key for tool in tools.offered(0)}

    async def call(name, arguments):
        return await tools.call(keys[name], arguments, member=0, scope=("turn", 0, 10), turn_id=turn_id,
                                conversation_id=10, private=True, approver="auto", language="en", announce=None)

    request = None
    site = await asyncio.start_server(serve, "127.0.0.1", 0)
    async with site:
        try:
            url = f"http://127.0.0.1:{site.sockets[0].getsockname()[1]}"
            page = await call("browser_open", {"url": url})
            assert page.ok, page.text
            tab_id = json.loads(page.text)["tab_id"]
            tab = browser.tabs[tab_id]
            request = asyncio.create_task(call("request_takeover", {"reason": "sign_in", "detail": "Enter your name on the sign-in page."}))
            await expect_eventually(lambda: tools.cards.browser_request(0, 10)[0] is tab)
            wait = (await viewer.status(params))["host_request"]
            assert wait["reason"] == "sign_in" and wait["detail"] == "Enter your name on the sign-in page."
            opened = await viewer.open({**params, "transport": "host", "target_id": tab_id})
            control = {"session": opened["session"], "takeover": wait["request_id"]}
            base = opened["url"].removesuffix("host.html")
            async with httpx.AsyncClient(trust_env=False, timeout=10) as client:
                assert (await client.get(base + "host.html")).status_code == 200
                async with host_frames(client, base) as lines:
                    frame = json.loads(await anext(lines))
                    assert (frame["width"], frame["height"]) == (1280, 900)
                    assert (await viewer.control({**control, "held": True}))["control"] == "owner"
                    assert (await client.get(base + "control")).json() == {"held": True}
                    position = await browser.command(tab, "Runtime.evaluate", {
                        "expression": "document.querySelector('#name').getBoundingClientRect().toJSON()", "returnByValue": True})
                    rect = position["result"]["value"]
                    events = [
                        {"type": kind, "x": rect["x"] + 8, "y": rect["y"] + 8, "button": "left", "buttons": buttons, "count": 1}
                        for kind, buttons in (("mousePressed", 1), ("mouseReleased", 0))
                    ]
                    typed = {"type": "text", "text": "Owner signed in through the panel"}
                    headers = {"Origin": viewer.origin}
                    for event in [*events, typed]:
                        assert (await client.post(base + "host-input", json={**event, "target": tab.id}, headers=headers)).status_code == 204
                    returned = await viewer.control({**control, "held": False})
                    assert returned["control"] == "member" and "host_request" not in returned
                    assert not viewer.owners and not browser.held
                    assert (await client.get(base + "control")).json() == {"held": False}
                    assert (await client.post(base + "host-input", json=typed, headers=headers)).status_code == 403
                    result = await asyncio.wait_for(request, 5)
                    assert result.ok and json.loads(result.text)["status"] == "owner_finished"
                    assert tools.cards.store.get(wait["id"]).state == "done"
                    next_step = await call("get_browser_state", {})
                    assert next_step.ok and json.loads(next_step.text)["tab_id"] == tab_id
                    value = await browser.command(tab, "Runtime.evaluate", {
                        "expression": "document.querySelector('#name').value", "returnByValue": True})
                    assert value["result"]["value"] == typed["text"]
        finally:
            if request and not request.done():
                request.cancel()
                await asyncio.gather(request, return_exceptions=True)
            try:
                await viewer.aclose()
            finally:
                await browser.aclose()
                await asyncio.sleep(0.1)


@pytest.mark.skipif(chrome_executable() is None or bool(os.environ.get("CI")), reason="Google Chrome is unavailable or this is CI")
async def test_native_static_chrome_reconnect_and_toolbar_without_control(tmp_path):
    async def static_page(reader, writer):
        try:
            async with asyncio.timeout(2):
                await reader.readuntil(b"\r\n\r\n")
            body = b"<!doctype html><title>Static page</title><p>Static page with no animation.</p>"
            writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\nContent-Length: "
                         + str(len(body)).encode() + b"\r\n\r\n" + body)
            await writer.drain()
        except (OSError, asyncio.IncompleteReadError, TimeoutError):
            pass
        finally:
            writer.close()
            with suppress(OSError):
                await writer.wait_closed()

    viewer, browser = host_viewer(tmp_path.resolve())
    async with await asyncio.start_server(static_page, "127.0.0.1", 0) as site:
        try:
            tab, _ = await browser.open_tab(1, tmp_path, 10)
            url = f"http://127.0.0.1:{site.sockets[0].getsockname()[1]}"
            assert await host_page.navigate(browser, tab, url + "/first")
            await expect_eventually(lambda: tab.url == url + "/first")
            opened = await viewer.open({"member_id": 1, "conversation_id": 10})
            base = opened["url"].removesuffix("host.html")
            headers = {"Origin": viewer.origin}
            async with httpx.AsyncClient(trust_env=False, timeout=5) as client:
                for attempt in ("start", "reconnect"):
                    await asyncio.sleep(0.5)  # Let the static page finish painting before attachment.
                    before = perf_counter()
                    async with asyncio.timeout(1), host_frames(client, base) as lines:
                        frame = await frame_for(lines, tab, (1280, 900))
                        assert base64.b64decode(frame["image"]).startswith(b"\xff\xd8")
                        print(f"Static Chrome {attempt}: {(perf_counter() - before) * 1000:.0f} ms")
                        if attempt == "reconnect":
                            async def action(name, **params):
                                return await client.post(base + "host-browser", headers=headers,
                                                         json={"action": name, "tab": tab.id, **params})

                            assert (await action("navigate", url=url + "/second")).status_code == 204
                            await expect_eventually(lambda: tab.url == url + "/second")
                            result = await browser.command(tab, "Runtime.evaluate", {
                                "expression": "location.pathname", "returnByValue": True})
                            assert result["result"]["value"] == "/second"
                            assert browser.selected(1) is tab and not browser.held
                    await expect_eventually(lambda: not tab.cast.watchers)
        finally:
            try:
                await viewer.aclose()
            finally:
                await browser.aclose()
                await asyncio.sleep(0.1)


@pytest.mark.skipif(chrome_executable() is None or bool(os.environ.get("CI")), reason="Google Chrome is unavailable or this is CI")
async def test_native_chrome_frames_and_owner_input(tmp_path):
    viewer, browser = host_viewer(tmp_path.resolve())
    site = await asyncio.start_server(serve, "127.0.0.1", 0)
    async with site:
        try:
            await browser.start()
            one = await browser.new_tab(1, tmp_path, 10)
            two = await browser.new_tab(2, tmp_path)
            url = f"http://127.0.0.1:{site.sockets[0].getsockname()[1]}"
            for tab in (one, two):
                assert await host_page.navigate(browser, tab, url)
            first = await viewer.open({"member_id": 1, "conversation_id": 10})
            second = await viewer.open({"member_id": 2})
            async with httpx.AsyncClient(trust_env=False, timeout=10) as client:
                async with client.stream("GET", first["url"].replace("host.html", "host-frames")) as left:
                    async with client.stream("GET", second["url"].replace("host.html", "host-frames")) as right:
                        lines = [left.aiter_lines(), right.aiter_lines()]
                        for stream in lines:
                            frame = json.loads(await anext(stream))
                            assert base64.b64decode(frame["image"]).startswith(b"\xff\xd8")
                        position = await browser.command(one, "Runtime.evaluate", {"expression":
                            "JSON.stringify(document.querySelector('#name').getBoundingClientRect())", "returnByValue": True})
                        rect = json.loads(position["result"]["value"])
                        events = [
                            {"type": kind, "x": rect["x"] + 10, "y": rect["y"] + 5, "button": "left",
                             "buttons": buttons, "count": 1}
                            for kind, buttons in (("mousePressed", 1), ("mouseReleased", 0))
                        ] + [{"type": "text", "text": "Owner typed in the viewer"}]
                        endpoint = first["url"].replace("host.html", "host-input")
                        headers = {"Origin": viewer.origin}
                        assert (await client.post(endpoint, json=events[-1], headers=headers)).status_code == 403
                        await viewer.control({"session": first["session"], "held": True})
                        for event in events:
                            assert (await client.post(endpoint, json={**event, "target": one.id}, headers=headers)).status_code == 204
                        for tab, expected in ((one, events[-1]["text"]), (two, "")):
                            result = await browser.command(tab, "Runtime.evaluate", {
                                "expression": "document.querySelector('#name').value", "returnByValue": True})
                            assert result["result"]["value"] == expected
        finally:
            try:
                await viewer.aclose()
            finally:
                await browser.aclose()
                await asyncio.sleep(0.1)  # Chrome's connections to the test site end; their transports close


@pytest.mark.skipif(chrome_executable() is None or bool(os.environ.get("CI")), reason="Google Chrome is unavailable or this is CI")
async def test_native_chrome_follows_small_popups_and_blank_links_on_the_same_lease(tmp_path):
    viewer, browser = host_viewer(tmp_path.resolve())
    member = 1
    site = await asyncio.start_server(serve, "127.0.0.1", 0)

    async def evaluate(tab, expression):
        result = await browser.command(tab, "Runtime.evaluate", {"expression": expression, "returnByValue": True})
        return result["result"].get("value")

    async with site:
        try:
            await browser.start()
            opener = await browser.new_tab(member, tmp_path, 10)
            other = await browser.new_tab(2, tmp_path)
            url = f"http://127.0.0.1:{site.sockets[0].getsockname()[1]}"
            assert await host_page.navigate(browser, opener, url + "/opener")
            assert await host_page.navigate(browser, other, url)
            opened = await viewer.open({"member_id": 1, "conversation_id": 10})
            base = opened["url"].removesuffix("host.html")
            headers = {"Origin": viewer.origin}
            async with httpx.AsyncClient(trust_env=False, timeout=10) as client, host_frames(client, base) as lines:
                await frame_for(lines, opener, (1280, 900))
                assert await evaluate(opener, "[innerWidth, innerHeight]") == [1280, 900]
                assert (await viewer.control({**opened, "held": True}))["control"] == "owner"

                async def send(tab, event):
                    response = await client.post(base + "host-input", json={**event, "target": tab.id}, headers=headers)
                    assert response.status_code == 204

                async def click(tab, selector):
                    rect = await evaluate(tab, f"document.querySelector({json.dumps(selector)}).getBoundingClientRect().toJSON()")
                    for kind, buttons in (("mousePressed", 1), ("mouseReleased", 0)):
                        await send(tab, {"type": kind, "x": rect["x"] + 8, "y": rect["y"] + 8,
                                         "button": "left", "buttons": buttons, "count": 1})

                for button in ("#open-popup", "#open-tab"):
                    await click(opener, button)
                    await expect_eventually(lambda: browser.selected(member) is not opener)
                    popup = browser.selected(member)
                    assert popup and popup.opener is opener
                    frame = await frame_for(lines, popup, (1280, 900))
                    assert base64.b64decode(frame["image"]).startswith(b"\xff\xd8")
                    assert await evaluate(popup, "[innerWidth, innerHeight]") == [1280, 900]
                    model = (await client.get(base + "host-browser")).json()
                    assert model["shown"] == popup.id and {tab["id"] for tab in model["tabs"]} == {opener.id, popup.id}
                    assert (await viewer.renew(opened))["control"] == "owner"
                    await click(popup, "#name")
                    await send(popup, {"type": "text", "text": "Test code"})
                    assert await evaluate(popup, "document.querySelector('#name').value") == "Test code"
                    assert await evaluate(other, "document.querySelector('#name').value") == ""
                    if button == "#open-popup":
                        await click(popup, "#done")
                    else:
                        response = await client.post(base + "host-browser", headers=headers, json={"action": "close", "tab": popup.id})
                        assert response.status_code == 204
                    await frame_for(lines, opener, (1280, 900))
                    assert browser.tab(member) is opener and popup.id not in browser.tabs

                assert (await viewer.control({**opened, "held": False}))["control"] == "member"
                assert not browser.held
        finally:
            try:
                await viewer.aclose()
            finally:
                await browser.aclose()
                await asyncio.sleep(0.1)


def windows_on_desktop(pid, desktop=None):
    import ctypes as c
    from ctypes import wintypes as w

    user = c.WinDLL("user32", use_last_error=True)
    callback = c.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)
    user.OpenInputDesktop.argtypes = [w.DWORD, w.BOOL, w.DWORD]
    user.OpenInputDesktop.restype = w.HANDLE
    user.CloseDesktop.argtypes = [w.HANDLE]
    user.EnumDesktopWindows.argtypes = [w.HANDLE, callback, w.LPARAM]
    user.GetWindowThreadProcessId.argtypes = [w.HWND, c.POINTER(w.DWORD)]
    user.IsWindowVisible.argtypes = [w.HWND]
    user.GetForegroundWindow.restype = w.HWND
    visible = []

    @callback
    def visit(window, _):
        owner = w.DWORD()
        user.GetWindowThreadProcessId(window, c.byref(owner))
        if owner.value == pid and user.IsWindowVisible(window):
            visible.append(window)
        return True

    input_desktop = None if desktop else user.OpenInputDesktop(0, False, 0x0041)  # READOBJECTS | ENUMERATE
    try:
        assert desktop or input_desktop, c.get_last_error()
        assert user.EnumDesktopWindows(desktop or input_desktop, visit, 0), c.get_last_error()
    finally:
        if input_desktop:
            user.CloseDesktop(input_desktop)
    return visible, user.GetForegroundWindow()


def windows_on_screen(pid):
    """How many windows macOS shows on a screen for a process. Only each window's owner is read, which needs no screen
    recording permission."""
    import ctypes as c
    import ctypes.util

    foundation = c.CDLL(ctypes.util.find_library("CoreFoundation"))
    graphics = c.CDLL(ctypes.util.find_library("CoreGraphics"))
    graphics.CGWindowListCopyWindowInfo.restype = c.c_void_p
    graphics.CGWindowListCopyWindowInfo.argtypes = [c.c_uint32, c.c_uint32]
    foundation.CFArrayGetCount.restype = c.c_long
    foundation.CFArrayGetCount.argtypes = [c.c_void_p]
    foundation.CFArrayGetValueAtIndex.restype = c.c_void_p
    foundation.CFArrayGetValueAtIndex.argtypes = [c.c_void_p, c.c_long]
    foundation.CFDictionaryGetValue.restype = c.c_void_p
    foundation.CFDictionaryGetValue.argtypes = [c.c_void_p, c.c_void_p]
    foundation.CFNumberGetValue.restype = c.c_bool
    foundation.CFNumberGetValue.argtypes = [c.c_void_p, c.c_long, c.c_void_p]  # CFNumberType is a CFIndex
    foundation.CFRelease.argtypes = [c.c_void_p]
    owner = c.c_void_p.in_dll(graphics, "kCGWindowOwnerPID").value
    windows = graphics.CGWindowListCopyWindowInfo(1, 0)  # kCGWindowListOptionOnScreenOnly
    assert windows
    try:
        found = 0
        for index in range(foundation.CFArrayGetCount(windows)):
            value = foundation.CFDictionaryGetValue(foundation.CFArrayGetValueAtIndex(windows, index), owner)
            number = c.c_int64()
            if value and foundation.CFNumberGetValue(value, 4, c.byref(number)) and number.value == pid:  # SInt64
                found += 1
        return found
    finally:
        foundation.CFRelease(windows)


@pytest.mark.skipif(chrome_executable() is None or bool(os.environ.get("CI")), reason="Google Chrome is unavailable or this is CI")
async def test_native_headed_chrome_streams_off_the_owner_desktop(tmp_path):
    viewer, browser = host_viewer(tmp_path.resolve())
    site = await asyncio.start_server(serve, "127.0.0.1", 0)
    async with site:
        try:
            tab, _ = await browser.open_tab(1, tmp_path, 10)
            url = f"http://127.0.0.1:{site.sockets[0].getsockname()[1]}"
            assert await host_page.navigate(browser, tab, url)
            proof = await browser.command(tab, "Runtime.evaluate", {
                "expression": "({userAgent: navigator.userAgent, webdriver: navigator.webdriver})", "returnByValue": True,
            })
            assert "Headless" not in proof["result"]["value"]["userAgent"]
            assert proof["result"]["value"]["webdriver"] is False
            opened = await viewer.open({"member_id": 1, "conversation_id": 10})
            base = opened["url"].removesuffix("host.html")
            async with httpx.AsyncClient(trust_env=False, timeout=10) as client, host_frames(client, base) as lines:
                first = json.loads(await anext(lines))
                assert (first["width"], first["height"]) == (1280, 900)
                assert base64.b64decode(first["image"]).startswith(b"\xff\xd8")
                await browser.command(tab, "Runtime.evaluate", {"expression": "document.body.style.background = 'rgb(20,80,240)'"})
                async with asyncio.timeout(5):
                    while json.loads(await anext(lines))["image"] == first["image"]:
                        pass
                if os.name == "nt":
                    pid = browser.process.pid
                    private, _ = windows_on_desktop(pid, browser.process.desktop)
                    interactive, foreground = windows_on_desktop(pid)
                    assert private and not interactive and foreground not in private
                elif headless_chrome():
                    # A Mac runs it with no window at all (#308), and the page still sees the ordinary Chrome of a Mac.
                    # (Chrome's product string says Chrome/ in its headless mode too, so the screen is asked instead.)
                    assert windows_on_screen(browser.process.pid) == 0
                    brands = await browser.command(tab, "Runtime.evaluate", {
                        "expression": "navigator.userAgentData.brands.map(brand => brand.brand).join()", "returnByValue": True})
                    assert "Headless" not in brands["result"]["value"]
                else:
                    bounds = (await browser.cdp.call("Browser.getWindowForTarget", {"targetId": tab.target}))["bounds"]
                    assert bounds["left"] + bounds["width"] < 0 and bounds["top"] + bounds["height"] < 0
                print(f"Chrome streamed changing 1280 x 900 frames away from the input desktop: {proof['result']['value']}")
        finally:
            try:
                await viewer.aclose()
            finally:
                await browser.aclose()
                await asyncio.sleep(0.1)

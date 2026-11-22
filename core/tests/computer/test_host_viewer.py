"""The real loopback relay with fake CDP, plus the opt-in native Chrome journey."""

import asyncio
import base64
import json
import os
from contextlib import aclosing, asynccontextmanager
from types import SimpleNamespace

import httpx
import pytest

from raphael_core.computer import host_page
from raphael_core.agent.history import AgentHistory
from raphael_core.computer.handback import HandbackCards
from raphael_core.computer.host_browser import ChromeProcessTree, HostBrowser, Tab, chrome_executable
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
    scope = ("turn", member, conversation, turn_id)
    tab = Tab(identifier, identifier, "cdp-" + identifier, scope, member, browser.profile,
              conversation=conversation, turn_id=turn_id)
    tab.cast = Screencast(browser, tab)
    browser.tabs[identifier] = tab
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
        assert (await viewer.status({"member_id": 1, "conversation_id": 11}))["state"] == "absent"
        with pytest.raises(RpcError, match="desktop unavailable"):
            await viewer.open({"member_id": 1, "conversation_id": 11})
        first = await viewer.open({"member_id": 1, "conversation_id": 10})
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
                text = {"type": "text", "text": "Sample"}
                assert (await client.post(url, json=text, headers={"Origin": viewer.origin})).status_code == 403
                assert (await viewer.control({**owner, "held": True}))["control"] == "owner"
                assert (await client.get(base + "control")).json() == {"held": True}
                assert browser.held == {tab.scope}
                assert (await client.post(url, json=text, headers={"Origin": "http://example.invalid"})).status_code == 403
                events = [
                    {"type": "mousePressed", "x": 20, "y": 30, "button": "left", "buttons": 1, "count": 1},
                    {"type": "keyDown", "key": "Tab", "code": "Tab", "virtual": 9},
                    text,
                ]
                for event in events:
                    assert (await client.post(url, json=event, headers={"Origin": viewer.origin})).status_code == 204
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
                        assert (await client.post(base + "host-input", json=event, headers=headers)).status_code == 204
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
async def test_native_headless_chrome_frames_and_owner_input(tmp_path):
    viewer, browser = host_viewer(tmp_path.resolve())
    site = await asyncio.start_server(serve, "127.0.0.1", 0)
    async with site:
        try:
            await browser.start()
            one = await browser.new_tab(("turn", 1, 10), 1, tmp_path, 10)
            two = await browser.new_tab(("task", 2), 2, tmp_path)
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
                            assert (await client.post(endpoint, json=event, headers=headers)).status_code == 204
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
